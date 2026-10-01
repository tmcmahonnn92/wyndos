/**
 * Text (SMS) helpers used by server actions and the cron route.
 *
 * SAFETY: nothing is really sent unless BOTH
 *   - the server has MESSAGING_LIVE=true in its environment, and
 *   - the business has turned Test mode off in Settings → Messaging.
 * Otherwise every text is written to the message log with status TEST.
 */

import prisma from "@/lib/db";
import { interpolateTemplate, sendWithSettings, type MessageVars } from "@/lib/messaging";
import { decryptSettingsSecrets } from "@/lib/secrets";
import { AUTO_SMS_ENABLED } from "@/lib/features";

export type TextKind = "DAY_REMINDER" | "CLEANED" | "PAYMENT_REMINDER_1" | "PAYMENT_REMINDER_2" | "BULK";

export const TEXT_KIND_LABELS: Record<TextKind, string> = {
  DAY_REMINDER: "Day reminder",
  CLEANED: "Cleaned / how to pay",
  PAYMENT_REMINDER_1: "Payment reminder 1",
  PAYMENT_REMINDER_2: "Payment reminder 2",
  BULK: "Bulk message",
};

export function liveSendingAllowedByServer() {
  return process.env.MESSAGING_LIVE === "true";
}

export async function loadTextSettings(tenantId: number) {
  const [raw, tenant] = await Promise.all([
    prisma.tenantSettings.findFirst({ where: { tenantId } }),
    prisma.tenant.findFirst({ where: { id: tenantId }, select: { name: true, phone: true } }),
  ]);
  if (!raw) return null;
  const settings = decryptSettingsSecrets(raw);
  return {
    ...settings,
    businessName: settings.businessName?.trim() || tenant?.name || "",
    phone: settings.phone?.trim() || tenant?.phone || "",
  };
}
export type TextSettings = NonNullable<Awaited<ReturnType<typeof loadTextSettings>>>;

/** True when a text would really go out (not just be logged). */
export function isLive(settings: TextSettings | null) {
  return Boolean(settings && liveSendingAllowedByServer() && !settings.textsTestMode && settings.messagingProvider !== "none");
}

import { greetingName, money, textDate, ukMobile } from "@/lib/text-format";
export { greetingName, money, textDate, ukMobile };

type CustomerForText = {
  id: number;
  name: string;
  address: string;
  phone: string;
  price?: number;
  area?: { name: string } | null;
};

/** First name of a team member for texts ("Jake"), falling back to the owner / business. */
export function workerFirstName(
  user: { name?: string | null; email?: string | null } | null | undefined,
  settings: { ownerName?: string | null; businessName?: string | null },
) {
  const name = user?.name?.trim() || user?.email?.split("@")[0]?.trim() || settings.ownerName?.trim() || "";
  return name ? name.split(/\s+/)[0] : settings.businessName?.trim() || "";
}

export function varsFor(
  customer: CustomerForText,
  settings: Pick<TextSettings, "businessName" | "phone" | "bankDetails"> & { ownerName?: string | null },
  extra: Partial<MessageVars> = {},
): MessageVars {
  return {
    workerName: workerFirstName(null, settings),
    customerName: customer.name,
    customerFirstName: greetingName(customer.name, customer.address),
    customerAddress: customer.address,
    areaName: customer.area?.name ?? "",
    jobPrice: customer.price !== undefined ? money(customer.price) : "",
    businessName: settings.businessName,
    businessPhone: settings.phone,
    bankDetails: settings.bankDetails?.replace(/\s*\n\s*/g, ", ") ?? "",
    paymentReference: customer.address.split(",")[0]?.trim() || customer.name,
    ...extra,
  };
}

export const renderText = interpolateTemplate;

/** What each customer owes across completed visits (unpaid part only). */
export async function balancesFor(tenantId: number, customerIds: number[]) {
  const jobs = await prisma.job.findMany({
    where: { tenantId, customerId: { in: customerIds }, status: "COMPLETE" },
    select: {
      id: true,
      customerId: true,
      price: true,
      completedAt: true,
      allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
    },
  });
  const balance = new Map<number, number>();
  const unpaidJobs = new Map<number, Array<{ id: number; due: number; completedAt: Date | null }>>();
  for (const job of jobs) {
    const due = Math.max(0, job.price - job.allocations.reduce((s, a) => s + a.amount, 0));
    if (due <= 0.005) continue;
    balance.set(job.customerId, (balance.get(job.customerId) ?? 0) + due);
    unpaidJobs.set(job.customerId, [...(unpaidJobs.get(job.customerId) ?? []), { id: job.id, due, completedAt: job.completedAt }]);
  }
  return { balance, unpaidJobs };
}

export type OutgoingText = {
  customerId: number | null;
  jobId?: number | null;
  workDayId?: number | null;
  to: string;
  body: string;
};

export type SendMethod = "PHONE" | "VOODOO";

/** How this business sends texts: from their own phone (default) or via VoodooSMS. */
export function sendMethodOf(settings: Pick<TextSettings, "textSendMethod"> | null): SendMethod {
  if (!AUTO_SMS_ENABLED) return "PHONE";
  return settings?.textSendMethod === "VOODOO" ? "VOODOO" : "PHONE";
}

/**
 * PHONE: every text is saved as TO_SEND, waiting to be sent one tap at a time from a phone.
 * VOODOO: log every text; really send only when live (otherwise status TEST).
 */
export async function deliverTexts(
  tenantId: number,
  settings: TextSettings | null,
  kind: TextKind,
  texts: OutgoingText[],
  sentByUserId: string | null,
  method: SendMethod = sendMethodOf(settings),
) {
  if (!AUTO_SMS_ENABLED) method = "PHONE";
  const live = method === "VOODOO" && isLive(settings);
  let sent = 0;
  let failed = 0;
  const ids: number[] = [];
  for (const text of texts) {
    let status = method === "PHONE" ? "TO_SEND" : "TEST";
    let error = "";
    if (live) {
      try {
        await sendWithSettings(settings, { to: text.to, message: text.body });
        status = "SENT";
        sent++;
      } catch (issue) {
        status = "FAILED";
        error = issue instanceof Error ? issue.message : String(issue);
        failed++;
      }
    }
    const log = await prisma.messageLog.create({
      data: {
        tenantId,
        customerId: text.customerId,
        jobId: text.jobId ?? null,
        workDayId: text.workDayId ?? null,
        kind,
        toNumber: text.to,
        body: text.body,
        status,
        error,
        sentByUserId,
      },
      select: { id: true },
    });
    ids.push(log.id);
  }
  return { logged: texts.length, sent, failed, test: method === "VOODOO" && !live, phone: method === "PHONE", ids };
}

/**
 * "Your windows have been cleaned, here's how to pay" — run when an area day is completed,
 * so anyone who paid on the doorstep that day is already marked paid and can be skipped.
 */
export async function queueCleanedTexts(tenantId: number, workDayId: number, sentByUserId: string | null) {
  const settings = await loadTextSettings(tenantId);
  if (!settings?.textCleanedEnabled) return null;

  const jobs = await prisma.job.findMany({
    where: { tenantId, workDayId, status: "COMPLETE", isQuote: false },
    select: {
      id: true,
      price: true,
      completedBy: { select: { name: true, email: true } },
      assignedUser: { select: { name: true, email: true } },
      workDay: { select: { assignedUser: { select: { name: true, email: true } } } },
      allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
      customer: {
        select: { id: true, name: true, address: true, phone: true, preferredPaymentMethod: true, paidByCustomerId: true, area: { select: { name: true } } },
      },
    },
  });
  const already = new Set(
    (await prisma.messageLog.findMany({
      where: { tenantId, kind: "CLEANED", jobId: { in: jobs.map((j) => j.id) } },
      select: { jobId: true },
    })).map((m) => m.jobId),
  );
  const { balance } = await balancesFor(tenantId, jobs.map((j) => j.customer.id));

  const texts: OutgoingText[] = [];
  for (const job of jobs) {
    if (already.has(job.id)) continue;
    const c = job.customer;
    const to = ukMobile(c.phone);
    if (!to) continue;
    if (c.preferredPaymentMethod === "DD" || c.paidByCustomerId) continue; // paid by Direct Debit or by someone else
    const paidToday = job.price - job.allocations.reduce((s, a) => s + a.amount, 0) <= 0.005;
    if (paidToday && settings.textSkipCleanedIfPaid) continue;
    const owed = balance.get(c.id) ?? 0;
    texts.push({
      customerId: c.id,
      jobId: job.id,
      workDayId,
      to,
      body: renderText(settings.tmplCleanedBank, varsFor(c, settings, {
        amountDue: money(owed),
        jobPrice: money(job.price),
        workerName: workerFirstName(job.completedBy ?? job.assignedUser ?? job.workDay.assignedUser, settings),
      })),
    });
  }
  return deliverTexts(tenantId, settings, "CLEANED", texts, sentByUserId);
}

/**
 * Chase unpaid customers: 1st reminder X days after the oldest unpaid clean, 2nd after Y days.
 * Each reminder goes once per unpaid clean. Direct Debit customers are never chased.
 */
export async function runPaymentReminders(tenantId: number, sentByUserId: string | null, now = new Date()) {
  const settings = await loadTextSettings(tenantId);
  const first = settings?.textPaymentReminderDays ?? 0;
  const second = settings?.textPaymentReminder2Days ?? 0;
  if (!settings || (first <= 0 && second <= 0)) return { logged: 0, sent: 0, failed: 0, test: true, phone: false, skipped: "off" as const };

  const customers = await prisma.customer.findMany({
    where: { tenantId, active: true, isProspect: false, paidByCustomerId: null, NOT: { preferredPaymentMethod: "DD" } },
    select: { id: true, name: true, address: true, phone: true, area: { select: { name: true } } },
  });
  const withMobile = customers.filter((c) => ukMobile(c.phone));
  const { balance, unpaidJobs } = await balancesFor(tenantId, withMobile.map((c) => c.id));
  const logs = await prisma.messageLog.findMany({
    where: { tenantId, kind: { in: ["PAYMENT_REMINDER_1", "PAYMENT_REMINDER_2"] }, customerId: { in: withMobile.map((c) => c.id) } },
    select: { kind: true, jobId: true },
  });
  const done = new Set(logs.map((l) => `${l.kind}:${l.jobId}`));

  const byKind: Record<"PAYMENT_REMINDER_1" | "PAYMENT_REMINDER_2", OutgoingText[]> = { PAYMENT_REMINDER_1: [], PAYMENT_REMINDER_2: [] };
  for (const c of withMobile) {
    const jobs = (unpaidJobs.get(c.id) ?? []).filter((j) => j.completedAt);
    if (jobs.length === 0) continue;
    const oldest = jobs.reduce((a, b) => (a.completedAt! < b.completedAt! ? a : b));
    const ageDays = Math.floor((now.getTime() - oldest.completedAt!.getTime()) / 86_400_000);
    const kind = second > 0 && ageDays >= second ? "PAYMENT_REMINDER_2" : first > 0 && ageDays >= first ? "PAYMENT_REMINDER_1" : null;
    if (!kind || done.has(`${kind}:${oldest.id}`)) continue;
    const template = kind === "PAYMENT_REMINDER_2" ? settings.tmplPaymentReminder2 : settings.tmplPaymentReminder1;
    byKind[kind].push({
      customerId: c.id,
      jobId: oldest.id,
      to: ukMobile(c.phone)!,
      body: renderText(template, varsFor(c, settings, { amountDue: money(balance.get(c.id) ?? 0) })),
    });
  }
  const a = await deliverTexts(tenantId, settings, "PAYMENT_REMINDER_1", byKind.PAYMENT_REMINDER_1, sentByUserId);
  const b = await deliverTexts(tenantId, settings, "PAYMENT_REMINDER_2", byKind.PAYMENT_REMINDER_2, sentByUserId);
  return { logged: a.logged + b.logged, sent: a.sent + b.sent, failed: a.failed + b.failed, test: a.test, phone: a.phone, skipped: null };
}
