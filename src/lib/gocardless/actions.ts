"use server";

/** GoCardless actions for the app. Owner only: every one checks the signed-in owner's business. */

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { requireOwner } from "@/lib/guards";
import { GOCARDLESS_ENABLED } from "@/lib/features";
import {
  cleansToCollect, collectForJobs, createSignupLink, gcConnection, GC_MANDATE_USABLE,
  listCustomersAndMandates, suggestLinks, syncTenant, testConnection,
} from "@/lib/gocardless/core";

async function owner() {
  if (!GOCARDLESS_ENABLED) throw new Error("Direct Debit isn't switched on.");
  return requireOwner();
}
const message = (issue: unknown) => (issue instanceof Error ? issue.message : "Something went wrong with GoCardless.");

export async function getGoCardlessOverview() {
  const actor = await owner();
  const tenantId = actor.tenantId;
  const [settings, connected, linked, waiting] = await Promise.all([
    prisma.tenantSettings.findFirst({ where: { tenantId }, select: { goCardlessCreditorName: true, goCardlessLastSyncedAt: true, goCardlessLastError: true, goCardlessAutoCollect: true, goCardlessEnvironment: true } }),
    gcConnection(tenantId),
    prisma.customer.count({ where: { tenantId, goCardlessMandateId: { not: null } } }),
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
    return { ok: true as const, name: res.name };
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
      select: { id: true, price: true, goCardlessStatus: true, workDay: { select: { date: true } }, customer: { select: { id: true, name: true } } },
      orderBy: { id: "desc" }, take: 300,
    }),
    prisma.job.findMany({
      where: { tenantId, goCardlessStatus: { in: ["failed", "cancelled", "customer_approval_denied", "charged_back"] }, status: "COMPLETE" },
      select: { id: true, price: true, goCardlessStatus: true, workDay: { select: { date: true } }, customer: { select: { id: true, name: true } } },
      orderBy: { id: "desc" }, take: 100,
    }),
    prisma.customer.findMany({
      where: { tenantId, OR: [{ goCardlessMandateId: { not: null } }, { goCardlessBillingRequestId: { not: null } }, { preferredPaymentMethod: "DD" }] },
      select: { id: true, name: true, address: true, goCardlessMandateId: true, goCardlessMandateStatus: true, goCardlessBillingRequestId: true, active: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    due: due.filter((j) => !j.goCardlessPaymentId).map((j) => ({ jobId: j.id, customerId: j.customer.id, customer: j.customer.name, date: iso(j.workDay.date), amount: j.due, mandateStatus: j.customer.goCardlessMandateStatus })),
    inProgress: inProgress.map((j) => ({ jobId: j.id, customerId: j.customer.id, customer: j.customer.name, date: iso(j.workDay.date), amount: j.price, status: j.goCardlessStatus ?? "" })),
    failed: failed.map((j) => ({ jobId: j.id, customerId: j.customer.id, customer: j.customer.name, date: iso(j.workDay.date), amount: j.price, status: j.goCardlessStatus ?? "" })),
    people: people.map((c) => ({
      id: c.id, name: c.name, address: c.address, active: c.active,
      state: c.goCardlessMandateId ? (c.goCardlessMandateStatus ?? "linked") : c.goCardlessBillingRequestId ? "link_sent" : "not_set_up",
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
