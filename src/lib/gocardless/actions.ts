"use server";

/** GoCardless actions for the app. Owner only: every one checks the signed-in owner's business. */

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { requireOwner } from "@/lib/guards";
import { goCardlessOn } from "@/lib/trial-features";
import {
  cleansToCollect, collectForJobs, createSignupLink, gcConnection, GC_MANDATE_USABLE,
  listCustomersAndMandates, suggestLinks, syncTenant, testConnection,
} from "@/lib/gocardless/core";

async function owner() {
  const actor = await requireOwner();
  if (!(await goCardlessOn(actor.tenantId))) throw new Error("Direct Debit isn't switched on for your account.");
  return actor;
}
const message = (issue: unknown) => (issue instanceof Error ? issue.message : "Something went wrong with GoCardless.");

export async function getGoCardlessOverview() {
  const actor = await owner();
  const tenantId = actor.tenantId;
  const [settings, connected, linked, waiting] = await Promise.all([
    prisma.tenantSettings.findFirst({ where: { tenantId }, select: { goCardlessCreditorName: true, goCardlessLastSyncedAt: true, goCardlessLastError: true, goCardlessAutoCollect: true, goCardlessEnvironment: true } }),
    gcConnection(tenantId),
    prisma.customer.count({ where: { tenantId, goCardlessMandateId: { not: null }, OR: [{ goCardlessMandateStatus: null }, { goCardlessMandateStatus: { in: [...GC_MANDATE_USABLE] } }] } }),
    prisma.customer.count({ where: { tenantId, goCardlessBillingRequestId: { not: null } } }),
  ]);
  return {
    connected: Boolean(connected),
    environment: connected?.base.includes("sandbox") ? "sandbox" : settings?.goCardlessEnvironment ?? "live",
    creditorName: settings?.goCardlessCreditorName ?? "",
    lastSyncedAt: settings?.goCardlessLastSyncedAt?.toISOString() ?? null,
    lastError: settings?.goCardlessLastError ?? "",
    autoCollect: settings?.goCardlessAutoCollect ?? false,
    linked,
    waiting,
  };
}

export async function testGoCardless() {
  const actor = await owner();
  try {
    const res = await testConnection(actor.tenantId);
    revalidatePath("/settings");
    return { ok: true as const, name: res.name, verification: res.verification };
  } catch (issue) {
    return { ok: false as const, error: message(issue) };
  }
}

export async function setGoCardlessAutoCollect(on: boolean) {
  const actor = await owner();
  await prisma.tenantSettings.update({
    where: { tenantId: actor.tenantId },
    // Only cleans completed from now on are collected automatically, never older ones.
    data: { goCardlessAutoCollect: on === true, goCardlessAutoCollectFrom: on === true ? new Date() : null },
  });
  revalidatePath("/payments/direct-debit");
}

/** GoCardless customers with a suggested Wyndos customer for each, for the linking screen. */
export async function getGoCardlessLinks() {
  const actor = await owner();
  const tenantId = actor.tenantId;
  try {
    const [{ customers: gcCustomers, mandates }, wyndos] = await Promise.all([
      listCustomersAndMandates(tenantId),
      prisma.customer.findMany({
        where: { tenantId, isProspect: false },
        select: { id: true, name: true, email: true, postcode: true, address: true, goCardlessCustomerReference: true, goCardlessCustomerId: true, goCardlessMandateId: true },
        orderBy: { name: "asc" },
      }),
    ]);
    const rows = suggestLinks(wyndos.map((w) => ({ ...w, email: w.email ?? "", postcode: w.postcode ?? "" })), gcCustomers, mandates);
    const linkedTo = new Map(wyndos.filter((w) => w.goCardlessCustomerId).map((w) => [w.goCardlessCustomerId!, w.id]));
    return {
      ok: true as const,
      rows: rows.map((r) => ({ ...r, linkedWyndosId: linkedTo.get(r.gcCustomerId) ?? null })),
      customers: wyndos.map((w) => ({ id: w.id, name: w.name, address: w.address })),
    };
  } catch (issue) {
    return { ok: false as const, error: message(issue) };
  }
}

/** Save the links the owner confirmed. Each mandate is checked against their GoCardless account. */
export async function saveGoCardlessLinks(links: Array<{ wyndosId: number; gcCustomerId: string }>) {
  const actor = await owner();
  const tenantId = actor.tenantId;
  const list = (Array.isArray(links) ? links : []).slice(0, 5000).filter((l) => Number.isInteger(l.wyndosId) && typeof l.gcCustomerId === "string" && /^[A-Z0-9]{4,40}$/.test(l.gcCustomerId));
  try {
    const { mandates } = await listCustomersAndMandates(tenantId);
    let saved = 0;
    for (const l of list) {
      const mine = mandates.filter((m) => m.links?.customer === l.gcCustomerId);
      const mandate = mine.find((m) => m.status === "active") ?? mine.find((m) => GC_MANDATE_USABLE.has(m.status)) ?? mine[0];
      const res = await prisma.customer.updateMany({
        where: { id: l.wyndosId, tenantId },
        data: {
          goCardlessCustomerId: l.gcCustomerId,
          goCardlessMandateId: mandate?.id ?? null,
          goCardlessMandateStatus: mandate?.status ?? null,
          ...(mandate && GC_MANDATE_USABLE.has(mandate.status) ? { preferredPaymentMethod: "DD" } : {}),
        },
      });
      saved += res.count;
    }
    revalidatePath("/payments/direct-debit");
    revalidatePath("/customers");
    return { ok: true as const, saved };
  } catch (issue) {
    return { ok: false as const, error: message(issue) };
  }
}

export async function unlinkGoCardless(customerId: number) {
  const actor = await owner();
  await prisma.customer.updateMany({
    where: { id: Number(customerId), tenantId: actor.tenantId },
    data: { goCardlessCustomerId: null, goCardlessMandateId: null, goCardlessMandateStatus: null, goCardlessBillingRequestId: null },
  });
  revalidatePath("/payments/direct-debit");
  revalidatePath(`/customers/${customerId}`);
}

/** A link the customer opens to set up their Direct Debit with GoCardless. */
export async function sendDirectDebitLink(customerId: number) {
  const actor = await owner();
  try {
    const res = await createSignupLink(actor.tenantId, Number(customerId));
    revalidatePath("/payments/direct-debit");
    return { ok: true as const, url: res.url };
  } catch (issue) {
    return { ok: false as const, error: message(issue) };
  }
}

/** Cleans owing money from customers with a Direct Debit, and any collections in progress. */
export async function getDirectDebitBoard() {
  const actor = await owner();
  const tenantId = actor.tenantId;
  const [due, inProgress, failed, people] = await Promise.all([
    cleansToCollect(tenantId),
    prisma.job.findMany({
      where: { tenantId, goCardlessPaymentId: { not: null }, goCardlessStatus: { in: ["pending_customer_approval", "pending_submission", "submitted", "confirmed"] } },
      select: { id: true, price: true, goCardlessStatus: true, workDay: { select: { date: true } }, customer: { select: { id: true, name: true, address: true } } },
      orderBy: { id: "desc" }, take: 300,
    }),
    prisma.job.findMany({
      where: { tenantId, goCardlessStatus: { in: ["failed", "cancelled", "customer_approval_denied", "charged_back"] }, status: "COMPLETE" },
      select: { id: true, price: true, goCardlessStatus: true, workDay: { select: { date: true } }, customer: { select: { id: true, name: true, address: true } }, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } },
      orderBy: { id: "desc" }, take: 100,
    }),
    prisma.customer.findMany({
      where: { tenantId, OR: [{ goCardlessMandateId: { not: null } }, { goCardlessBillingRequestId: { not: null } }, { preferredPaymentMethod: "DD" }] },
      select: { id: true, name: true, address: true, goCardlessMandateId: true, goCardlessMandateStatus: true, goCardlessBillingRequestId: true, goCardlessPlan: true, active: true, goCardlessLinkedAt: true },
      orderBy: { name: "asc" },
    }),
  ]);
  // Customers sharing one Direct Debit: the first linked is the one paying.
  const byMandate = new Map<string, typeof people>();
  for (const c of people) if (c.goCardlessMandateId) byMandate.set(c.goCardlessMandateId, [...(byMandate.get(c.goCardlessMandateId) ?? []), c]);
  const payerOf = (group: typeof people) => [...group].sort((a, b) => (a.goCardlessLinkedAt?.getTime() ?? 0) - (b.goCardlessLinkedAt?.getTime() ?? 0) || a.id - b.id)[0];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    // Customers whose Direct Debit was cancelled or failed aren't offered for collection.
    due: due.filter((j) => !j.goCardlessPaymentId && (!j.customer.goCardlessMandateStatus || GC_MANDATE_USABLE.has(j.customer.goCardlessMandateStatus))).map((j) => ({ jobId: j.id, customerId: j.customer.id, customer: j.customer.name, date: iso(j.workDay.date), amount: j.due, mandateStatus: j.customer.goCardlessMandateStatus, address: j.customer.address ?? "" })),
    inProgress: inProgress.map((j) => ({ jobId: j.id, customerId: j.customer.id, customer: j.customer.name, address: j.customer.address ?? "", date: iso(j.workDay.date), amount: j.price, status: j.goCardlessStatus ?? "" })),
    // A failed collection that's since been paid another way (cash, a later Direct Debit) is done with.
    failed: failed.filter((j) => j.price - j.allocations.reduce((sum, a) => sum + a.amount, 0) > 0.005).map((j) => ({ jobId: j.id, customerId: j.customer.id, customer: j.customer.name, address: j.customer.address ?? "", date: iso(j.workDay.date), amount: j.price, status: j.goCardlessStatus ?? "" })),
    people: people.map((c) => ({
      id: c.id, name: c.name, address: c.address, active: c.active, plan: c.goCardlessPlan ?? null,
      state: c.goCardlessMandateId ? (c.goCardlessMandateStatus ?? "linked") : c.goCardlessBillingRequestId ? "link_sent" : "not_set_up",
      ...(() => {
        const group = c.goCardlessMandateId ? byMandate.get(c.goCardlessMandateId) ?? [] : [];
        if (group.length < 2) return { sharedWith: [] as Array<{ id: number; name: string }>, pays: false };
        const payer = payerOf(group);
        return { sharedWith: group.filter((o) => o.id !== c.id).map((o) => ({ id: o.id, name: o.name + (o.id === payer.id ? " (pays)" : "") })), pays: payer.id === c.id };
      })(),
    })),
  };
}

export async function collectDirectDebits(jobIds: number[]) {
  const actor = await owner();
  const ids = (Array.isArray(jobIds) ? jobIds : []).map(Number).filter(Number.isInteger).slice(0, 1000);
  try {
    const res = await collectForJobs(actor.tenantId, ids);
    revalidatePath("/payments/direct-debit");
    return { ok: true as const, collected: res.collected.length, total: res.collected.reduce((s, c) => s + c.amount, 0), skipped: res.skipped };
  } catch (issue) {
    return { ok: false as const, error: message(issue) };
  }
}

export async function syncGoCardlessNow() {
  const actor = await owner();
  try {
    const res = await syncTenant(actor.tenantId);
    revalidatePath("/payments");
    revalidatePath("/payments/direct-debit");
    revalidatePath("/customers");
    return { ok: true as const, ...res };
  } catch (issue) {
    return { ok: false as const, error: message(issue) };
  }
}


// ─── One Direct Debit paying for several customers ──────────────────────────
// Each customer keeps their own cleans and balance; they just use the same mandate. Each clean is
// still collected on its own (tied to that clean), so nothing has to be shared out afterwards.

/** Who else uses this customer's Direct Debit, and whose Direct Debit they could use. */
export async function getDirectDebitSharing(customerId: number) {
  const actor = await owner();
  const me = await prisma.customer.findFirst({ where: { id: Number(customerId), tenantId: actor.tenantId }, select: { id: true, goCardlessMandateId: true, goCardlessMandateStatus: true } });
  if (!me) throw new Error("Customer not found.");
  const sharedWith = me.goCardlessMandateId
    ? await prisma.customer.findMany({ where: { tenantId: actor.tenantId, goCardlessMandateId: me.goCardlessMandateId, id: { not: me.id } }, select: { id: true, name: true, address: true }, orderBy: { name: "asc" } })
    : [];
  const options = await prisma.customer.findMany({
    where: { tenantId: actor.tenantId, id: { not: me.id }, goCardlessMandateId: { not: null }, OR: [{ goCardlessMandateStatus: null }, { goCardlessMandateStatus: { in: [...GC_MANDATE_USABLE] } }] },
    select: { id: true, name: true, address: true, goCardlessMandateId: true },
    orderBy: { name: "asc" },
  });
  const hasOwn = Boolean(me.goCardlessMandateId && (!me.goCardlessMandateStatus || GC_MANDATE_USABLE.has(me.goCardlessMandateStatus)));
  return { sharedWith, options, hasOwn };
}

/** This customer's cleans are paid by another customer's Direct Debit. */
export async function shareDirectDebit(customerId: number, fromCustomerId: number) {
  const actor = await owner();
  try {
    const tenantId = actor.tenantId;
    const [me, from] = await Promise.all([
      prisma.customer.findFirst({ where: { id: Number(customerId), tenantId }, select: { id: true, goCardlessMandateId: true, goCardlessMandateStatus: true } }),
      prisma.customer.findFirst({ where: { id: Number(fromCustomerId), tenantId }, select: { id: true, name: true, goCardlessMandateId: true, goCardlessMandateStatus: true, goCardlessCustomerId: true } }),
    ]);
    if (!me || !from) throw new Error("Customer not found.");
    if (me.id === from.id) throw new Error("Choose a different customer.");
    if (!from.goCardlessMandateId || (from.goCardlessMandateStatus && !GC_MANDATE_USABLE.has(from.goCardlessMandateStatus))) throw new Error(`${from.name} hasn't got a working Direct Debit.`);
    if (me.goCardlessMandateId === from.goCardlessMandateId) return { ok: true as const, mandateId: from.goCardlessMandateId, gcCustomerId: from.goCardlessCustomerId ?? "" };
    if (me.goCardlessMandateId && (!me.goCardlessMandateStatus || GC_MANDATE_USABLE.has(me.goCardlessMandateStatus))) {
      throw new Error("This customer already has their own Direct Debit. Stop using it first (Stop using this Direct Debit), then choose the other one.");
    }
    // Cleans already being collected on an old Direct Debit carry on; new ones use the shared one.
    await prisma.customer.update({ where: { id: me.id }, data: {
      goCardlessMandateId: from.goCardlessMandateId, goCardlessMandateStatus: from.goCardlessMandateStatus ?? "active",
      goCardlessCustomerId: from.goCardlessCustomerId, goCardlessBillingRequestId: null,
      // Payments the payer made before now are already accounted for: only new ones are matched.
      goCardlessLinkedAt: new Date(), preferredPaymentMethod: "DD",
    } });
    revalidatePath(`/customers/${me.id}`);
    revalidatePath(`/customers/${from.id}`);
    revalidatePath("/payments/direct-debit");
    return { ok: true as const, mandateId: from.goCardlessMandateId, gcCustomerId: from.goCardlessCustomerId ?? "" };
  } catch (issue) {
    return { ok: false as const, error: message(issue) };
  }
}

/**
 * Stop this customer using a Direct Debit (theirs or a shared one). Only Wyndos changes: the
 * Direct Debit itself stays in GoCardless, and anyone else using it carries on.
 */
export async function stopUsingDirectDebit(customerId: number) {
  const actor = await owner();
  try {
    const me = await prisma.customer.findFirst({ where: { id: Number(customerId), tenantId: actor.tenantId }, select: { id: true, goCardlessMandateId: true } });
    if (!me?.goCardlessMandateId) throw new Error("No Direct Debit to stop.");
    await prisma.customer.update({ where: { id: me.id }, data: { goCardlessMandateId: null, goCardlessMandateStatus: null, goCardlessCustomerId: null, goCardlessBillingRequestId: null, goCardlessPlan: null } });
    revalidatePath(`/customers/${me.id}`);
    revalidatePath("/payments/direct-debit");
    return { ok: true as const };
  } catch (issue) {
    return { ok: false as const, error: message(issue) };
  }
}
