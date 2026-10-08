/**
 * GoCardless (Direct Debit), server only. Not a "use server" file: nothing here is callable
 * from the browser. Owner-checked wrappers live in ./actions.ts; the scheduled sync calls
 * syncTenant from /api/cron/gocardless.
 *
 * How it works (pasted access token, no webhooks):
 *  - Link customers to their GoCardless mandate, or send them a sign-up link.
 *  - Collect: one GoCardless payment per completed clean (job), keyed so it can't be taken twice.
 *  - Sync (button or every ~15 min): mandate and payment statuses come back. Money received
 *    becomes a Wyndos payment on that clean; failed / charged back puts the clean back to unpaid.
 */

import prisma from "@/lib/db";
import { decryptSettingsSecrets } from "@/lib/secrets";

export const GC_RECEIVED = new Set(["confirmed", "paid_out"]);
export const GC_FAILED = new Set(["failed", "cancelled", "customer_approval_denied", "charged_back"]);
/** Mandate statuses a payment can be taken against. */
export const GC_MANDATE_USABLE = new Set(["pending_customer_approval", "pending_submission", "submitted", "active"]);

const round2 = (n: number) => Number(n.toFixed(2));

type Conn = { tenantId: number; token: string; base: string };

export class GoCardlessError extends Error {
  constructor(message: string, public status: number, public body: Record<string, unknown>) {
    super(message);
  }
}

/** The business's GoCardless connection, or null when no token is saved. */
/**
 * Local development only: a sandbox token from GOCARDLESS_DEV_TOKEN, used when the business
 * hasn't saved one. Never used on the live server (NODE_ENV=production) or for live tokens.
 */
export function devToken() {
  const t = process.env.GOCARDLESS_DEV_TOKEN?.trim() ?? "";
  return process.env.NODE_ENV !== "production" && t.startsWith("sandbox_") ? t : "";
}

export async function gcConnection(tenantId: number): Promise<Conn | null> {
  const raw = await prisma.tenantSettings.findFirst({ where: { tenantId } });
  if (!raw) return null;
  const settings = decryptSettingsSecrets(raw);
  const token = String(settings.goCardlessAccessToken ?? "").trim() || devToken();
  if (!token) return null;
  // GoCardless tokens say which they are (sandbox_… / live_…), so the setting can't get it wrong.
  const sandbox = token.startsWith("sandbox_") || (!token.startsWith("live_") && settings.goCardlessEnvironment === "sandbox");
  const base = process.env.GOCARDLESS_API_BASE?.trim() || (sandbox ? "https://api-sandbox.gocardless.com" : "https://api.gocardless.com");
  return { tenantId, token, base: base.replace(/\/$/, "") };
}

export async function requireConnection(tenantId: number) {
  const conn = await gcConnection(tenantId);
  if (!conn) throw new Error("Connect GoCardless in Settings first (paste your access token).");
  return conn;
}

async function gc<T>(conn: Conn, method: "GET" | "POST", path: string, opts: { params?: Record<string, string>; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const url = new URL(conn.base + path);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${conn.token}`,
    "GoCardless-Version": "2015-07-06",
    Accept: "application/json",
  };
  if (opts.body) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(url.toString(), { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new GoCardlessError("Couldn't reach GoCardless. Try again in a minute.", 0, {});
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const err = (json.error ?? {}) as { message?: string; errors?: Array<{ message?: string; field?: string }> };
    const detail = err.errors?.map((e) => [e.field, e.message].filter(Boolean).join(" ")).filter(Boolean).join("; ");
    let message = err.message || `GoCardless said no (${response.status})`;
    if (response.status === 401) message = "GoCardless didn't accept the access token. Check it in Settings (and that sandbox/live matches).";
    if (response.status === 403) message = "The GoCardless access token is read-only. Create a read-write token.";
    throw new GoCardlessError(detail ? `${message}: ${detail}` : message, response.status, json);
  }
  return json as T;
}

/** All pages of a GoCardless list (capped). */
async function gcList<T>(conn: Conn, path: string, key: string, params: Record<string, string> = {}, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const res: Record<string, unknown> = await gc(conn, "GET", path, { params: { limit: "500", ...params, ...(after ? { after } : {}) } });
    const items = (res[key] as T[] | undefined) ?? [];
    out.push(...items);
    after = ((res.meta as { cursors?: { after?: string | null } } | undefined)?.cursors?.after) ?? null;
    if (!after || items.length === 0) break;
  }
  return out;
}

type GcPayment = {
  id: string; amount: number; status: string; charge_date?: string | null; created_at?: string | null;
  reference?: string | null; description?: string | null;
  metadata?: Record<string, string | null | undefined>; links?: { mandate?: string | null };
};
type GcMandate = { id: string; status: string; reference?: string | null; created_at?: string | null; metadata?: Record<string, string | null | undefined>; links?: { customer?: string | null } };
export type GcCustomer = { id: string; email?: string | null; given_name?: string | null; family_name?: string | null; company_name?: string | null; address_line1?: string | null; postal_code?: string | null; metadata?: Record<string, string | null | undefined> };

// ── Connection ───────────────────────────────────────────────────────────────

export async function testConnection(tenantId: number) {
  const conn = await requireConnection(tenantId);
  const res = await gc<{ creditors?: Array<{ name?: string }> }>(conn, "GET", "/creditors", { params: { limit: "1" } });
  const name = res.creditors?.[0]?.name?.trim() || "GoCardless account";
  await prisma.tenantSettings.update({ where: { tenantId }, data: { goCardlessCreditorName: name, goCardlessLastError: "" } });
  return { name };
}

// ── Linking customers ───────────────────────────────────────────────────────

export async function listCustomersAndMandates(tenantId: number) {
  const conn = await requireConnection(tenantId);
  const [customers, mandates] = await Promise.all([
    gcList<GcCustomer>(conn, "/customers", "customers"),
    gcList<GcMandate>(conn, "/mandates", "mandates"),
  ]);
  return { customers, mandates };
}

const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Suggest which GoCardless customer is which Wyndos customer: email, then name + postcode, then reference. */
export function suggestLinks(
  wyndos: Array<{ id: number; name: string; email: string; postcode: string; address: string; goCardlessCustomerReference: string }>,
  gcCustomers: GcCustomer[],
  mandates: GcMandate[],
) {
  const byEmail = new Map<string, number[]>();
  const byNamePc = new Map<string, number[]>();
  const byRef = new Map<string, number[]>();
  const add = (m: Map<string, number[]>, k: string, id: number) => { if (k) m.set(k, [...(m.get(k) ?? []), id]); };
  for (const c of wyndos) {
    add(byEmail, c.email.trim().toLowerCase(), c.id);
    const pc = norm(c.postcode || (c.address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)?.[0] ?? ""));
    add(byNamePc, `${norm(c.name)}|${pc}`, c.id);
    const surname = c.name.trim().split(/\s+/).pop() ?? "";
    add(byNamePc, `~${norm(surname)}|${pc}`, c.id);
    add(byRef, norm(c.goCardlessCustomerReference), c.id);
  }
  const mandateFor = (gcId: string) => {
    const mine = mandates.filter((m) => m.links?.customer === gcId);
    return mine.find((m) => m.status === "active") ?? mine.find((m) => GC_MANDATE_USABLE.has(m.status)) ?? mine[0] ?? null;
  };
  const one = (ids: number[] | undefined) => (ids && ids.length === 1 ? ids[0] : null);
  return gcCustomers.map((g) => {
    const mandate = mandateFor(g.id);
    const pc = norm(g.postal_code);
    const fullName = norm(`${g.given_name ?? ""} ${g.family_name ?? ""}`);
    const byMeta = Number(g.metadata?.wyndosCustomerId) || null;
    const wyndosId =
      (byMeta && wyndos.some((w) => w.id === byMeta) ? byMeta : null) ??
      one(byEmail.get(String(g.email ?? "").trim().toLowerCase())) ??
      (pc ? one(byNamePc.get(`${fullName}|${pc}`)) ?? one(byNamePc.get(`~${norm(g.family_name)}|${pc}`)) : null) ??
      one(byRef.get(norm(mandate?.reference)));
    return {
      gcCustomerId: g.id,
      name: [g.given_name, g.family_name].filter(Boolean).join(" ") || g.company_name || g.email || g.id,
      email: g.email ?? "",
      postcode: g.postal_code ?? "",
      address: g.address_line1 ?? "",
      mandateId: mandate?.id ?? null,
      mandateStatus: mandate?.status ?? null,
      suggestedWyndosId: wyndosId,
    };
  });
}

/** A GoCardless-hosted page where the customer sets up their Direct Debit. */
export async function createSignupLink(tenantId: number, customerId: number) {
  const conn = await requireConnection(tenantId);
  const c = await prisma.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!c) throw new Error("Customer not found");
  const br = await gc<{ billing_requests: { id: string } }>(conn, "POST", "/billing_requests", {
    body: { billing_requests: {
      mandate_request: { scheme: "bacs" },
      metadata: { wyndosCustomerId: String(c.id) },
      ...(c.goCardlessCustomerId ? { links: { customer: c.goCardlessCustomerId } } : {}),
    } },
  });
  const parts = c.name.trim().split(/\s+/);
  const appUrl = (process.env.APP_URL || process.env.NEXTAUTH_URL || "https://wyndos.io").replace(/\/$/, "");
  const flow = await gc<{ billing_request_flows: { authorisation_url: string } }>(conn, "POST", "/billing_request_flows", {
    body: { billing_request_flows: {
      redirect_uri: `${appUrl}/direct-debit-done`,
      exit_uri: `${appUrl}/direct-debit-done`,
      links: { billing_request: br.billing_requests.id },
      ...(c.goCardlessCustomerId ? {} : { prefilled_customer: {
        given_name: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] ?? "",
        family_name: parts.length > 1 ? parts[parts.length - 1] : "",
        ...(c.email ? { email: c.email } : {}),
        ...(c.houseNameNumber || c.street ? { address_line1: [c.houseNameNumber, c.street].filter(Boolean).join(" ") } : {}),
        ...(c.town ? { city: c.town } : {}),
        ...(c.postcode ? { postal_code: c.postcode } : {}),
      } }),
    } },
  });
  await prisma.customer.update({ where: { id: c.id }, data: { goCardlessBillingRequestId: br.billing_requests.id } });
  return { url: flow.billing_request_flows.authorisation_url };
}

// ── Collecting ──────────────────────────────────────────────────────────────

/** Completed cleans still owing money for customers with a Direct Debit, not already being collected. */
export async function cleansToCollect(tenantId: number, opts: { since?: Date | null; customerIds?: number[] } = {}) {
  const jobs = await prisma.job.findMany({
    where: {
      tenantId, status: "COMPLETE", isQuote: false, price: { gt: 0 },
      customer: { goCardlessMandateId: { not: null }, ...(opts.customerIds ? { id: { in: opts.customerIds } } : {}) },
      ...(opts.since ? { completedAt: { gte: opts.since } } : {}),
    },
    select: {
      id: true, name: true, price: true, completedAt: true, goCardlessPaymentId: true, goCardlessStatus: true,
      workDay: { select: { date: true } },
      customer: { select: { id: true, name: true, goCardlessMandateId: true, goCardlessMandateStatus: true } },
      allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
    },
    orderBy: [{ workDay: { date: "asc" } }, { id: "asc" }],
    take: 2000,
  });
  return jobs
    .map((j) => ({ ...j, due: round2(j.price - j.allocations.reduce((s, a) => s + a.amount, 0)) }))
    .filter((j) => j.due > 0.005 && (!j.goCardlessPaymentId || GC_FAILED.has(j.goCardlessStatus ?? "")));
}

/** Take a Direct Debit for each of these cleans (what's still owed on it). */
export async function collectForJobs(tenantId: number, jobIds: number[]) {
  const conn = await requireConnection(tenantId);
  const due = await cleansToCollect(tenantId);
  const wanted = new Set(jobIds);
  const collected: Array<{ jobId: number; amount: number; paymentId: string }> = [];
  const skipped: Array<{ jobId: number; reason: string }> = [];
  for (const id of jobIds) if (!due.some((j) => j.id === id)) skipped.push({ jobId: id, reason: "Not owing, already being collected, or no Direct Debit" });
  for (const j of due.filter((d) => wanted.has(d.id))) {
    const mandate = j.customer.goCardlessMandateId!;
    if (j.customer.goCardlessMandateStatus && !GC_MANDATE_USABLE.has(j.customer.goCardlessMandateStatus)) {
      skipped.push({ jobId: j.id, reason: `Direct Debit is ${j.customer.goCardlessMandateStatus.replace(/_/g, " ")}` });
      continue;
    }
    const pence = Math.round(j.due * 100);
    // One key per attempt: retrying the same clean after a failure needs a new key.
    const key = `wyndos-t${tenantId}-job${j.id}-${j.goCardlessPaymentId ?? "first"}`;
    const date = j.workDay.date.toISOString().slice(0, 10);
    try {
      let payment: GcPayment;
      try {
        payment = (await gc<{ payments: GcPayment }>(conn, "POST", "/payments", {
          idempotencyKey: key,
          body: { payments: {
            amount: pence, currency: "GBP",
            description: `${j.name || "Window cleaning"} ${date}`.slice(0, 100),
            metadata: { wyndosCustomerId: String(j.customer.id), wyndosJobId: String(j.id) },
            links: { mandate },
          } },
        })).payments;
      } catch (issue) {
        // Already created with this key (e.g. a retry after a timeout): use that payment.
        const conflict = issue instanceof GoCardlessError && issue.status === 409
          ? ((issue.body.error as { errors?: Array<{ links?: { conflicting_resource_id?: string } }> })?.errors?.[0]?.links?.conflicting_resource_id)
          : null;
        if (!conflict) throw issue;
        payment = (await gc<{ payments: GcPayment }>(conn, "GET", `/payments/${conflict}`)).payments;
      }
      await prisma.job.update({ where: { id: j.id }, data: { goCardlessPaymentId: payment.id, goCardlessStatus: payment.status } });
      collected.push({ jobId: j.id, amount: j.due, paymentId: payment.id });
    } catch (issue) {
      skipped.push({ jobId: j.id, reason: issue instanceof Error ? issue.message : "GoCardless said no" });
    }
  }
  return { collected, skipped };
}

// ── Sync ────────────────────────────────────────────────────────────────────

/** Record money GoCardless received against a clean (or as credit when there's no clean). */
async function recordReceived(tenantId: number, customerId: number, p: GcPayment, jobId: number | null) {
  const amount = round2(p.amount / 100);
  const paidAt = p.charge_date ? new Date(`${p.charge_date}T00:00:00.000Z`) : new Date();
  let onJob = 0;
  if (jobId) {
    const job = await prisma.job.findFirst({ where: { id: jobId, tenantId }, select: { price: true, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } } });
    if (job) onJob = Math.max(0, Math.min(amount, round2(job.price - job.allocations.reduce((s, a) => s + a.amount, 0))));
  }
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({ data: {
      tenantId, customerId, amount, method: "BACS", paidAt,
      notes: "Direct Debit (GoCardless)",
      goCardlessPaymentId: p.id, goCardlessStatus: p.status, goCardlessReference: p.reference ?? null,
    } });
    if (jobId && onJob > 0.005) await tx.paymentAllocation.create({ data: { tenantId, paymentId: payment.id, jobId, amount: round2(onJob) } });
  });
}

export async function syncTenant(tenantId: number) {
  const conn = await requireConnection(tenantId);
  const summary = { mandatesLinked: 0, mandatesUpdated: 0, received: 0, failed: 0, imported: 0, autoCollected: 0, problems: [] as string[] };
  try {
    // 1. Sign-up links that have been completed → link the new mandate.
    const waiting = await prisma.customer.findMany({ where: { tenantId, goCardlessBillingRequestId: { not: null } }, select: { id: true, goCardlessBillingRequestId: true } });
    for (const c of waiting) {
      try {
        const br = (await gc<{ billing_requests: { status: string; links?: { customer?: string; mandate_request_mandate?: string } } }>(conn, "GET", `/billing_requests/${c.goCardlessBillingRequestId}`)).billing_requests;
        if (br.status === "fulfilled") {
          let mandateId = br.links?.mandate_request_mandate ?? null;
          if (!mandateId && br.links?.customer) {
            const ms = await gcList<GcMandate>(conn, "/mandates", "mandates", { customer: br.links.customer }, 1);
            mandateId = ms.find((m) => GC_MANDATE_USABLE.has(m.status))?.id ?? null;
          }
          await prisma.customer.update({ where: { id: c.id }, data: {
            goCardlessBillingRequestId: null,
            ...(mandateId ? { goCardlessMandateId: mandateId, goCardlessMandateStatus: "pending_submission", preferredPaymentMethod: "DD" } : {}),
            ...(br.links?.customer ? { goCardlessCustomerId: br.links.customer } : {}),
          } });
          if (mandateId) summary.mandatesLinked++;
        } else if (br.status === "cancelled") {
          await prisma.customer.update({ where: { id: c.id }, data: { goCardlessBillingRequestId: null } });
        }
      } catch (issue) {
        summary.problems.push(`Sign-up link: ${issue instanceof Error ? issue.message : issue}`);
      }
    }

    // 2. Mandate statuses (cancelled, expired, …).
    const linked = await prisma.customer.findMany({ where: { tenantId, goCardlessMandateId: { not: null } }, select: { id: true, goCardlessMandateId: true, goCardlessMandateStatus: true } });
    const mandateById = new Map<string, GcMandate>();
    if (linked.length) for (const m of await gcList<GcMandate>(conn, "/mandates", "mandates")) mandateById.set(m.id, m);
    for (const c of linked) {
      const m = mandateById.get(c.goCardlessMandateId!);
      if (m && m.status !== c.goCardlessMandateStatus) {
        await prisma.customer.update({ where: { id: c.id }, data: { goCardlessMandateStatus: m.status, ...(m.links?.customer ? { goCardlessCustomerId: m.links.customer } : {}) } });
        summary.mandatesUpdated++;
      }
    }

    // 3. Payments from the last ~100 days.
    const since = new Date(Date.now() - 100 * 86400000).toISOString();
    const payments = await gcList<GcPayment>(conn, "/payments", "payments", { "created_at[gte]": since });
    const paymentById = new Map(payments.map((p) => [p.id, p]));
    const recorded = new Map((await prisma.payment.findMany({ where: { tenantId, goCardlessPaymentId: { not: null } }, select: { id: true, goCardlessPaymentId: true, voidedAt: true } })).map((p) => [p.goCardlessPaymentId!, p]));

    // 3a. Cleans we're collecting for.
    const collecting = await prisma.job.findMany({
      where: { tenantId, goCardlessPaymentId: { not: null }, NOT: { goCardlessStatus: { in: ["failed", "cancelled", "customer_approval_denied", "charged_back"] } } },
      select: { id: true, customerId: true, goCardlessPaymentId: true, goCardlessStatus: true },
    });
    for (const job of collecting) {
      let p = paymentById.get(job.goCardlessPaymentId!);
      if (!p) {
        try { p = (await gc<{ payments: GcPayment }>(conn, "GET", `/payments/${job.goCardlessPaymentId}`)).payments; } catch { continue; }
      }
      if (p.status !== job.goCardlessStatus) await prisma.job.update({ where: { id: job.id }, data: { goCardlessStatus: p.status } });
      const existing = recorded.get(p.id);
      if (GC_RECEIVED.has(p.status) && !existing) {
        await recordReceived(tenantId, job.customerId, p, job.id);
        summary.received++;
      } else if (existing && GC_RECEIVED.has(p.status)) {
        await prisma.payment.update({ where: { id: existing.id }, data: { goCardlessStatus: p.status } });
      } else if (GC_FAILED.has(p.status) && p.status !== job.goCardlessStatus) {
        summary.failed++;
        // Money taken back (charged back) after it was recorded: undo the payment so the clean owes again.
        if (existing && !existing.voidedAt) {
          await prisma.payment.update({ where: { id: existing.id }, data: { voidedAt: new Date(), voidReason: `Direct Debit ${p.status.replace(/_/g, " ")}`, goCardlessStatus: p.status } });
        }
      }
    }

    // 3b. Money received for payments made outside Wyndos (e.g. set up in GoCardless): match by mandate.
    const collectingIds = new Set((await prisma.job.findMany({ where: { tenantId, goCardlessPaymentId: { not: null } }, select: { goCardlessPaymentId: true } })).map((j) => j.goCardlessPaymentId!));
    const customersByMandate = new Map((await prisma.customer.findMany({ where: { tenantId, goCardlessMandateId: { not: null } }, select: { id: true, goCardlessMandateId: true } })).map((c) => [c.goCardlessMandateId!, c.id]));
    for (const p of payments) {
      if (!GC_RECEIVED.has(p.status) || recorded.has(p.id) || collectingIds.has(p.id) || p.metadata?.wyndosJobId) continue;
      const metaId = Number(p.metadata?.wyndosCustomerId) || null;
      const customerId = (metaId && await prisma.customer.count({ where: { id: metaId, tenantId } }) ? metaId : null) ?? customersByMandate.get(p.links?.mandate ?? "") ?? null;
      if (!customerId) continue;
      // Pay the oldest unpaid clean it covers; anything left over stays as credit on the payment.
      const open = await prisma.job.findMany({
        where: { tenantId, customerId, status: "COMPLETE", isQuote: false, goCardlessPaymentId: null },
        select: { id: true, price: true, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } },
        orderBy: [{ workDay: { date: "asc" } }, { id: "asc" }],
        take: 200,
      });
      const oldest = open.find((j) => j.price - j.allocations.reduce((s, a) => s + a.amount, 0) > 0.005);
      await recordReceived(tenantId, customerId, p, oldest?.id ?? null);
      summary.imported++;
    }

    // 4. Auto-collect cleans completed since auto-collect was turned on.
    const settings = await prisma.tenantSettings.findFirst({ where: { tenantId }, select: { goCardlessAutoCollect: true, goCardlessAutoCollectFrom: true } });
    if (settings?.goCardlessAutoCollect && settings.goCardlessAutoCollectFrom) {
      const due = await cleansToCollect(tenantId, { since: settings.goCardlessAutoCollectFrom });
      // Never auto-retry a failed collection: the owner decides.
      const fresh = due.filter((j) => !j.goCardlessPaymentId);
      if (fresh.length) {
        const res = await collectForJobs(tenantId, fresh.map((j) => j.id));
        summary.autoCollected = res.collected.length;
      }
    }

    await prisma.tenantSettings.update({ where: { tenantId }, data: { goCardlessLastSyncedAt: new Date(), goCardlessLastError: summary.problems[0] ?? "" } });
    return summary;
  } catch (issue) {
    const message = issue instanceof Error ? issue.message : "GoCardless sync failed";
    await prisma.tenantSettings.update({ where: { tenantId }, data: { goCardlessLastError: message.slice(0, 300) } }).catch(() => undefined);
    throw issue;
  }
}
