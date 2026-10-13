import "server-only";
import { coveredByPlan } from "@/lib/gocardless/status";
import prisma from "@/lib/db";
import { emailInvoice, EMAIL_RE } from "@/lib/invoice-email";
import { tenantEmailReady } from "@/lib/tenant-email";
import { featureList } from "@/lib/trial-features";

/**
 * Trial "Invoice emails" → Settings "Email invoices when a day is finished".
 * A clean is emailed once its day is finished and the business's delay has passed (so a price
 * change or a payment in the meantime is picked up). Only customers set to "Email invoices",
 * only cleans done since it was switched on, only what's still unpaid, each clean once.
 * Runs on a timer after a day is finished, and from /api/cron/invoices as a backstop.
 */
export async function processDueInvoiceEmails(onlyTenantId?: number) {
  const tenants = await prisma.tenantSettings.findMany({
    where: { autoInvoiceEmail: true, autoInvoiceSince: { not: null }, ...(onlyTenantId ? { tenantId: onlyTenantId } : {}) },
    include: { tenant: { select: { name: true, trialFeatures: true } } },
  });
  let sent = 0, failed = 0;
  const now = Date.now();
  for (const s of tenants) {
    if (!featureList(s.tenant.trialFeatures).includes("auto_invoice")) continue;
    // Their own email must be set up: invoices never go from Wyndos's account.
    if (!(await tenantEmailReady(s.tenantId))) continue;
    const tenantId = s.tenantId;
    const cutoff = new Date(now - Math.max(0, s.autoInvoiceDelayMinutes) * 60_000);
    const jobs = await prisma.job.findMany({
      where: {
        tenantId, status: "COMPLETE", isQuote: false, invoicedAt: null, price: { gt: 0 },
        completedAt: { gte: s.autoInvoiceSince!, lte: cutoff },
        workDay: { status: "COMPLETE" },
        customer: { emailInvoices: true, email: { not: "" } },
        // Regular cleans on a Direct Debit plan are paid by the plan: no invoice for each one.
        NOT: { isOneOff: false, customer: { goCardlessPlan: { not: null } } },
      },
      include: {
        workDay: { select: { date: true, id: true } },
        allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
        customer: { select: { id: true, name: true, address: true, email: true, goCardlessMandateId: true, goCardlessMandateStatus: true, goCardlessPlan: true, jobName: true } },
      },
      orderBy: { id: "asc" },
      take: 1000,
    });
    // Don't keep retrying a customer whose email just failed: try again after a few hours.
    const recentFails = new Set((await prisma.messageLog.findMany({
      where: { tenantId, kind: "INVOICE_EMAIL", status: "FAILED", createdAt: { gte: new Date(now - 6 * 3600_000) } },
      select: { customerId: true },
    })).map((m) => m.customerId));
    const byCustomer = new Map<number, typeof jobs>();
    for (const job of jobs) {
      const unpaid = job.price - job.allocations.reduce((sum, a) => sum + a.amount, 0) > 0.005;
      if (!unpaid || coveredByPlan(job, job.customer) || recentFails.has(job.customerId) || !EMAIL_RE.test(job.customer.email?.trim() ?? "")) continue;
      byCustomer.set(job.customerId, [...(byCustomer.get(job.customerId) ?? []), job]);
    }
    const settings = { ...s, businessName: s.businessName?.trim() || s.tenant.name || "Your window cleaner" };
    for (const list of byCustomer.values()) {
      // Claim the number and mark the cleans first, so nothing is ever invoiced twice.
      const row = await prisma.tenantSettings.update({ where: { tenantId }, data: { nextInvoiceNum: { increment: 1 }, invoiceNumbersStarted: true }, select: { nextInvoiceNum: true, invoicePrefix: true } });
      const invoiceNumber = `${row.invoicePrefix}-${String(row.nextInvoiceNum - 1).padStart(4, "0")}`;
      const marked = await prisma.job.updateMany({ where: { tenantId, id: { in: list.map((j) => j.id) }, invoicedAt: null }, data: { invoicedAt: new Date(), invoiceNumber } });
      if (marked.count === 0) continue;
      const res = await emailInvoice({ tenantId, settings, customer: list[0].customer, jobs: list, invoiceNumber, workDayId: list[0].workDay.id });
      if (res.ok) sent++;
      else {
        failed++;
        await prisma.job.updateMany({ where: { tenantId, id: { in: list.map((j) => j.id) }, invoiceNumber }, data: { invoicedAt: null } });
      }
    }
  }
  return { sent, failed };
}

const g = globalThis as unknown as { __wyndosInvoiceTimers?: Map<number, ReturnType<typeof setTimeout>> };

/** Check this business's invoices after `ms` (e.g. its delay). The cron route is the backstop. */
export function scheduleInvoiceRun(tenantId: number, ms: number) {
  g.__wyndosInvoiceTimers ??= new Map();
  const timers = g.__wyndosInvoiceTimers;
  if (timers.has(tenantId)) clearTimeout(timers.get(tenantId)!);
  // Timers longer than a day aren't worth holding: cron picks those up.
  if (ms > 24 * 3600_000) return;
  timers.set(tenantId, setTimeout(() => {
    timers.delete(tenantId);
    processDueInvoiceEmails(tenantId).catch((issue) => console.error("[auto-invoice]", issue));
  }, Math.max(1_000, ms)));
}
