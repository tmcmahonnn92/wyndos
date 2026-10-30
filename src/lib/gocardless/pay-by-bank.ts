import "server-only";
import prisma from "@/lib/db";
import { gc, GoCardlessError, requireConnection, GC_RECEIVED, GC_FAILED } from "@/lib/gocardless/core";

/**
 * Pay by Bank (GoCardless instant bank payment, Faster Payments): a link the customer opens on
 * their phone, picks their bank and approves. Confirmed in minutes. For cleans paid on the day,
 * a missed-window catch-up, an extra job.
 *
 * - One link per customer for chosen cleans (what they still owe). Making a new link for the same
 *   cleans cancels the old one, so it can't be paid twice.
 * - While a link is open, those cleans aren't collected by Direct Debit.
 * - The sync records the money on those cleans once GoCardless confirms it (anything over stays
 *   as credit). Links not paid within 7 days are cancelled.
 */

const round2 = (n: number) => Number(n.toFixed(2));
const EXPIRE_DAYS = 7;
const appUrl = () => (process.env.APP_URL || process.env.NEXTAUTH_URL || "https://wyndos.io").replace(/\/$/, "");
export const jobIdsOf = (raw: string) => { try { const l = JSON.parse(raw); return Array.isArray(l) ? l.map(Number).filter(Boolean) : []; } catch { return []; } };

/** Cleans with an open Pay by Bank link (not to be collected by Direct Debit meanwhile). */
export async function jobsAwaitingPayByBank(tenantId: number): Promise<Set<number>> {
  const open = await prisma.payByBankRequest.findMany({ where: { tenantId, status: "pending" }, select: { jobIds: true } });
  return new Set(open.flatMap((r) => jobIdsOf(r.jobIds)));
}

/** What each of these cleans still owes, and whether it can go on a Pay by Bank link. */
async function owing(tenantId: number, customerId: number, jobIds: number[]) {
  const jobs = await prisma.job.findMany({
    where: { tenantId, customerId, id: { in: jobIds }, status: "COMPLETE", isQuote: false },
    select: { id: true, name: true, price: true, goCardlessPaymentId: true, goCardlessStatus: true, workDay: { select: { date: true } }, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } },
    orderBy: [{ workDay: { date: "asc" } }, { id: "asc" }],
  });
  return jobs.map((j) => ({
    ...j,
    due: round2(j.price - j.allocations.reduce((s, a) => s + a.amount, 0)),
    // A Direct Debit on its way (or being retried) for this clean: not taken twice.
    collecting: Boolean(j.goCardlessPaymentId) && !["failed", "cancelled", "customer_approval_denied", "charged_back"].includes(j.goCardlessStatus ?? ""),
  }));
}

/** Cleans a customer could pay by bank now: done, owing, not being collected by Direct Debit. */
export async function payByBankChoices(tenantId: number, customerId: number) {
  const all = await prisma.job.findMany({ where: { tenantId, customerId, status: "COMPLETE", isQuote: false }, select: { id: true }, orderBy: { id: "desc" }, take: 200 });
  const rows = await owing(tenantId, customerId, all.map((j) => j.id));
  const open = await prisma.payByBankRequest.findMany({ where: { tenantId, customerId, status: "pending" }, orderBy: { id: "desc" }, select: { id: true, url: true, amount: true, jobIds: true, createdAt: true } });
  return {
    cleans: rows.filter((j) => j.due > 0.005 && !j.collecting).map((j) => ({ jobId: j.id, name: j.name || "Window Cleaning", date: j.workDay.date.toISOString().slice(0, 10), due: j.due })),
    open: open.map((r) => ({ id: r.id, url: r.url, amount: r.amount, jobIds: jobIdsOf(r.jobIds), createdAt: r.createdAt.toISOString() })),
  };
}

/** Make a Pay by Bank link for these cleans (all must be the customer's, done and owing). */
export async function createPayByBankLink(tenantId: number, customerId: number, jobIds: number[]) {
  const conn = await requireConnection(tenantId);
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!customer) throw new Error("Customer not found.");
  const ids = [...new Set(jobIds.map(Number).filter(Boolean))].sort((a, b) => a - b);
  if (!ids.length) throw new Error("Choose at least one clean.");
  const rows = await owing(tenantId, customerId, ids);
  if (rows.length !== ids.length) throw new Error("Those cleans aren't all done and on this customer.");
  if (rows.some((j) => j.collecting)) throw new Error("One of those cleans is already being collected by Direct Debit.");
  const amount = round2(rows.reduce((s, j) => s + Math.max(0, j.due), 0));
  if (amount < 1) throw new Error("Nothing owing on those cleans.");

  // The same cleans asked for again (a double tap, or a fresh link): one link only.
  const overlapping = (await prisma.payByBankRequest.findMany({ where: { tenantId, customerId, status: "pending" } }))
    .filter((r) => jobIdsOf(r.jobIds).some((id) => ids.includes(id)));
  const same = overlapping.find((r) => jobIdsOf(r.jobIds).join(",") === ids.join(",") && Math.abs(r.amount - amount) < 0.005);
  if (same) return { url: same.url, amount: same.amount, reused: true };
  for (const r of overlapping) {
    // Never two open links for the same clean: if the old one can't be stopped, don't make another.
    if (!(await cancelRequest(tenantId, r.id, r.billingRequestId))) throw new Error("There's already a Pay by Bank link for that clean that may have been paid. Sync, then try again.");
  }

  const when = rows.length === 1 ? ` on ${rows[0].workDay.date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : ` (${rows.length} cleans)`;
  const description = `${rows.length === 1 ? rows[0].name || "Window cleaning" : "Window cleaning"}${when}`.slice(0, 100);
  let brId: string;
  try {
    brId = (await gc<{ billing_requests: { id: string } }>(conn, "POST", "/billing_requests", {
      idempotencyKey: `wyndos-pbb-t${tenantId}-c${customerId}-j${ids.join("_")}-${Math.round(amount * 100)}-${Math.floor(Date.now() / 600_000)}`,
      body: { billing_requests: {
        payment_request: { description, amount: String(Math.round(amount * 100)), currency: "GBP", scheme: "faster_payments" },
        metadata: { wyndosCustomerId: String(customerId), wyndosPayByBank: "1" },
        ...(customer.goCardlessCustomerId ? { links: { customer: customer.goCardlessCustomerId } } : {}),
      } },
    })).billing_requests.id;
  } catch (issue) {
    const conflict = issue instanceof GoCardlessError && issue.status === 409
      ? ((issue.body.error as { errors?: Array<{ links?: { conflicting_resource_id?: string } }> })?.errors?.[0]?.links?.conflicting_resource_id)
      : null;
    if (!conflict) throw issue;
    brId = conflict;
  }
  const parts = customer.name.trim().split(/\s+/);
  const flow = await gc<{ billing_request_flows: { authorisation_url: string } }>(conn, "POST", "/billing_request_flows", {
    body: { billing_request_flows: {
      redirect_uri: `${appUrl()}/paid-by-bank`,
      exit_uri: `${appUrl()}/paid-by-bank?stopped=1`,
      links: { billing_request: brId },
      ...(customer.goCardlessCustomerId ? {} : { prefilled_customer: {
        given_name: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] ?? "",
        family_name: parts.length > 1 ? parts[parts.length - 1] : "",
        ...(customer.email ? { email: customer.email } : {}),
      } }),
    } },
  });
  const url = flow.billing_request_flows.authorisation_url;
  try {
    await prisma.payByBankRequest.create({ data: { tenantId, customerId, billingRequestId: brId, url, jobIds: JSON.stringify(ids), amount } });
  } catch (issue) {
    // Two taps at once: the other one saved it; hand back that link.
    if ((issue as { code?: string })?.code !== "P2002") throw issue;
    const saved = await prisma.payByBankRequest.findUnique({ where: { billingRequestId: brId } });
    if (saved) return { url: saved.url, amount: saved.amount, reused: true };
  }
  return { url, amount, reused: false };
}

/** Cancel a link in GoCardless and here. False if it couldn't be stopped (paid already, or no answer). */
async function cancelRequest(tenantId: number, id: number, billingRequestId: string, status: "cancelled" | "expired" = "cancelled"): Promise<boolean> {
  const conn = await requireConnection(tenantId);
  try {
    await gc(conn, "POST", `/billing_requests/${billingRequestId}/actions/cancel`, { body: {} });
  } catch {
    // Refused: already paid (the sync records it) or already cancelled. No answer: unknown, keep it.
    const now = await gc<{ billing_requests: { status: string } }>(conn, "GET", `/billing_requests/${billingRequestId}`).catch(() => null);
    if (now?.billing_requests.status !== "cancelled") return false;
  }
  await prisma.payByBankRequest.updateMany({ where: { id, status: "pending" }, data: { status } });
  return true;
}

/** Stop a link before it's paid (the owner changed their mind, or it was sent to the wrong person). */
export async function cancelPayByBankLink(tenantId: number, id: number) {
  const r = await prisma.payByBankRequest.findFirst({ where: { id, tenantId, status: "pending" } });
  if (r && !(await cancelRequest(tenantId, r.id, r.billingRequestId))) throw new Error("Couldn't stop that link: it may have just been paid. Sync to check.");
}

/** Cleans paid another way (cash, card…) or un-ticked: any open Pay by Bank link for them is stopped, so it isn't paid twice. */
export async function cancelLinksForCleans(tenantId: number, jobIds: number[]) {
  const open = await prisma.payByBankRequest.findMany({ where: { tenantId, status: "pending" } });
  for (const r of open.filter((x) => jobIdsOf(x.jobIds).some((id) => jobIds.includes(id)))) {
    // Not stopped (no answer, or just paid): if it's paid, the money is kept as credit.
    await cancelRequest(tenantId, r.id, r.billingRequestId).catch(() => false);
  }
}

type GcPay = { id: string; amount: number; status: string; charge_date?: string | null; reference?: string | null };

/** Record a confirmed Pay by Bank payment on its cleans (what they still owe); the rest is credit. */
async function recordPaid(tenantId: number, r: { id: number; customerId: number; jobIds: string }, p: GcPay) {
  if (await prisma.payment.count({ where: { goCardlessPaymentId: p.id } })) {
    await prisma.payByBankRequest.update({ where: { id: r.id }, data: { status: "paid", goCardlessPaymentId: p.id } });
    return false;
  }
  const amount = round2(p.amount / 100);
  const rows = await owing(tenantId, r.customerId, jobIdsOf(r.jobIds));
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({ data: {
      tenantId, customerId: r.customerId, amount, method: "BACS", paidAt: new Date(),
      notes: "Pay by Bank (GoCardless)",
      goCardlessPaymentId: p.id, goCardlessStatus: p.status, goCardlessReference: p.reference ?? null,
    } });
    let left = amount;
    for (const j of rows) {
      if (left <= 0.005) break;
      const take = round2(Math.min(j.due, left));
      if (take <= 0.005) continue;
      await tx.paymentAllocation.create({ data: { tenantId, paymentId: payment.id, jobId: j.id, amount: take } });
      left = round2(left - take);
    }
    await tx.payByBankRequest.update({ where: { id: r.id }, data: { status: "paid", goCardlessPaymentId: p.id } });
  });
  return true;
}

/** Part of the GoCardless sync: follow open links, record what's been paid, cancel stale ones. */
export async function syncPayByBank(tenantId: number) {
  const out = { received: 0, problems: [] as string[] };
  const open = await prisma.payByBankRequest.findMany({ where: { tenantId, status: "pending" } });
  if (!open.length) return out;
  const conn = await requireConnection(tenantId);
  for (const r of open) {
    try {
      const br = (await gc<{ billing_requests: { status: string; links?: { payment_request_payment?: string } } }>(conn, "GET", `/billing_requests/${r.billingRequestId}`)).billing_requests;
      const paymentId = br.links?.payment_request_payment ?? r.goCardlessPaymentId;
      if (paymentId) {
        const p = (await gc<{ payments: GcPay }>(conn, "GET", `/payments/${paymentId}`)).payments;
        if (GC_RECEIVED.has(p.status)) { if (await recordPaid(tenantId, r, p)) out.received++; continue; }
        if (GC_FAILED.has(p.status)) { await prisma.payByBankRequest.update({ where: { id: r.id }, data: { status: "failed", goCardlessPaymentId: p.id } }); continue; }
        if (!r.goCardlessPaymentId) await prisma.payByBankRequest.update({ where: { id: r.id }, data: { goCardlessPaymentId: p.id } });
        continue; // on its way
      }
      if (br.status === "cancelled") { await prisma.payByBankRequest.update({ where: { id: r.id }, data: { status: "cancelled" } }); continue; }
      if (br.status !== "fulfilled" && Date.now() - r.createdAt.getTime() > EXPIRE_DAYS * 86_400_000) await cancelRequest(tenantId, r.id, r.billingRequestId, "expired");
    } catch (issue) {
      out.problems.push(`Pay by Bank ${r.billingRequestId}: ${issue instanceof Error ? issue.message : issue}`);
    }
  }
  return out;
}
