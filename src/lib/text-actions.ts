"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { requireOwner, requirePerm, visibleJobWhere, visibleWorkDayWhere } from "@/lib/guards";
import {
  balancesFor,
  deliverTexts,
  isLive,
  liveSendingAllowedByServer,
  sendMethodOf,
  type SendMethod,
  loadTextSettings,
  money,
  renderText,
  runPaymentReminders,
  textDate,
  ukMobile,
  varsFor,
  workerFirstName,
  type OutgoingText,
} from "@/lib/texts";

/** Is sending live, and the default templates, for the text screens. */
export async function getTextSetup() {
  const actor = await requirePerm("messaging");
  const settings = await loadTextSettings(actor.tenantId);
  return {
    live: isLive(settings),
    serverAllowsLive: liveSendingAllowedByServer(),
    testMode: settings?.textsTestMode ?? true,
    provider: settings?.messagingProvider ?? "voodoosms",
    dayReminderTemplate: settings?.tmplCleaningReminder ?? "",
    businessName: settings?.businessName ?? "",
    ownerFirstName: workerFirstName(null, settings ?? {}),
    sendMethod: sendMethodOf(settings),
    voodooConfigured: Boolean(settings?.voodooApiKey),
    // The saved wording from Settings → Templates, to start any text from.
    templates: settings
      ? [
          { key: "dayReminder", label: "Day reminder", body: settings.tmplCleaningReminder },
          { key: "cleanedBank", label: "Cleaned — how to pay", body: settings.tmplCleanedBank },
          { key: "jobComplete", label: "Job complete", body: settings.tmplJobComplete },
          { key: "jobAndPayment", label: "Job complete + payment due", body: settings.tmplJobAndPayment },
          { key: "payment1", label: "Payment reminder 1", body: settings.tmplPaymentReminder1 },
          { key: "payment2", label: "Payment reminder 2", body: settings.tmplPaymentReminder2 },
          { key: "payment3", label: "Payment reminder 3 (final)", body: settings.tmplPaymentReminder3 },
          { key: "paymentReceived", label: "Payment received", body: settings.tmplPaymentReceived },
        ].filter((t) => t.body?.trim())
      : [],
  };
}

/** Each customer's most recent text (sent, test, or waiting on the phone): kind and when. */
async function lastTextFor(tenantId: number, customerIds: number[]) {
  const out = new Map<number, { kind: string; at: string; status: string }>();
  if (customerIds.length === 0) return out;
  const logs = await prisma.messageLog.findMany({
    where: { tenantId, customerId: { in: customerIds }, status: { not: "FAILED" } },
    select: { customerId: true, kind: true, createdAt: true, status: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  for (const log of logs) {
    if (log.customerId && !out.has(log.customerId)) {
      out.set(log.customerId, { kind: log.kind, at: log.createdAt.toISOString(), status: log.status });
    }
  }
  return out;
}

/** Every text to one customer, newest first (for their page). */
export async function getCustomerTexts(customerId: number) {
  const actor = await requirePerm("customers");
  return prisma.messageLog.findMany({
    where: { tenantId: actor.tenantId, customerId },
    select: { id: true, kind: true, status: true, body: true, createdAt: true, error: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/** Everyone booked on these area days, with whether they can get a text. */
export async function getDayReminderRecipients(workDayIds: number[]) {
  const actor = await requirePerm("messaging");
  const tenantId = actor.tenantId;
  const settings = await loadTextSettings(tenantId);
  const days = await prisma.workDay.findMany({
    where: { tenantId, id: { in: workDayIds }, ...visibleWorkDayWhere(actor) },
    select: {
      id: true,
      date: true,
      area: { select: { name: true } },
      assignedUser: { select: { name: true, email: true } },
      jobs: {
        where: { status: "PENDING", ...visibleJobWhere(actor) },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          price: true,
          assignedUser: { select: { name: true, email: true } },
          customer: { select: { id: true, name: true, address: true, phone: true, area: { select: { name: true } } } },
        },
      },
    },
  });
  const { balance } = await balancesFor(tenantId, days.flatMap((d) => d.jobs.map((j) => j.customer.id)));
  // Who already had (or has waiting on the phone) a reminder for these days: don't text them twice.
  const earlier = await prisma.messageLog.findMany({
    where: { tenantId, kind: "DAY_REMINDER", workDayId: { in: days.map((d) => d.id) }, status: { not: "FAILED" } },
    select: { customerId: true, createdAt: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  const remindedAt = new Map<number, { at: string; waiting: boolean }>();
  for (const log of earlier) {
    if (log.customerId && !remindedAt.has(log.customerId)) {
      remindedAt.set(log.customerId, { at: log.createdAt.toISOString(), waiting: log.status === "TO_SEND" });
    }
  }
  const seen = new Set<number>();
  const recipients = [];
  for (const day of days) {
    for (const job of day.jobs) {
      if (seen.has(job.customer.id)) continue;
      seen.add(job.customer.id);
      const to = ukMobile(job.customer.phone);
      recipients.push({
        customerId: job.customer.id,
        jobId: job.id,
        workDayId: day.id,
        name: job.customer.name,
        address: job.customer.address,
        phone: job.customer.phone,
        to,
        reminded: remindedAt.get(job.customer.id) ?? null,
        vars: settings
          ? varsFor({ ...job.customer, price: job.price }, settings, {
              jobDate: textDate(day.date),
              amountDue: money(balance.get(job.customer.id) ?? 0),
              workerName: workerFirstName(job.assignedUser ?? day.assignedUser, settings),
            })
          : {},
      });
    }
  }
  return recipients;
}

/** Send (or, in test mode, log) the day reminder to the chosen customers. The text can be edited each time. */
export async function sendDayReminders(input: {
  workDayIds: number[];
  customerIds: number[];
  template: string;
  saveAsDefault?: boolean;
  method?: SendMethod;
}) {
  const actor = await requirePerm("messaging");
  const tenantId = actor.tenantId;
  if (!input.template.trim()) throw new Error("Write the message first.");
  const settings = await loadTextSettings(tenantId);
  const wanted = new Set(input.customerIds);
  const recipients = (await getDayReminderRecipients(input.workDayIds)).filter((r) => wanted.has(r.customerId) && r.to);
  const texts: OutgoingText[] = recipients.map((r) => ({
    customerId: r.customerId,
    jobId: r.jobId,
    workDayId: r.workDayId,
    to: r.to!,
    body: renderText(input.template, r.vars),
  }));
  if (input.saveAsDefault && !actor.isWorker) {
    await prisma.tenantSettings.update({ where: { tenantId }, data: { tmplCleaningReminder: input.template } });
  }
  const result = await deliverTexts(tenantId, settings, "DAY_REMINDER", texts, actor.userId, input.method ?? sendMethodOf(settings));
  revalidatePath("/messages");
  return result;
}

/** Customers for the bulk message screen, with area and what they owe. */
export async function getBulkRecipients() {
  const actor = await requirePerm("messaging");
  const tenantId = actor.tenantId;
  const customers = await prisma.customer.findMany({
    where: { tenantId, active: true },
    select: {
      id: true, name: true, address: true, phone: true, isProspect: true, nextDueDate: true, price: true,
      area: { select: { id: true, name: true, color: true, isSystemArea: true } },
      tags: { select: { tag: { select: { id: true, name: true } } } },
    },
    orderBy: [{ area: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });
  const ids = customers.map((c) => c.id);
  const [{ balance, unpaidJobs }, nextBooked, settings, reminded] = await Promise.all([
    balancesFor(tenantId, ids),
    nextBookedCleans(tenantId, ids),
    loadTextSettings(tenantId),
    prisma.messageLog.findMany({
      where: { tenantId, kind: { in: ["PAYMENT_REMINDER_1", "PAYMENT_REMINDER_2"] }, customerId: { in: ids } },
      select: { kind: true, jobId: true },
    }),
  ]);
  const lastTexts = await lastTextFor(tenantId, ids);
  const done = new Set(reminded.map((r) => `${r.kind}:${r.jobId}`));
  // Same rule as the automatic reminders; if they're off, anything unpaid 14+ days counts as due.
  const first = settings?.textPaymentReminderDays || 14;
  const second = settings?.textPaymentReminder2Days || 0;
  const now = Date.now();
  const reminderStage = (customerId: number) => {
    const jobs = (unpaidJobs.get(customerId) ?? []).filter((j) => j.completedAt);
    if (jobs.length === 0) return null;
    const oldest = jobs.reduce((a, b) => (a.completedAt! < b.completedAt! ? a : b));
    const age = Math.floor((now - oldest.completedAt!.getTime()) / 86_400_000);
    const stage = second > 0 && age >= second ? 2 : age >= first ? 1 : null;
    if (!stage || done.has(`PAYMENT_REMINDER_${stage}:${oldest.id}`)) return null;
    return { stage, age };
  };
  return customers.map((c) => ({
    id: c.id,
    name: c.name,
    address: c.address,
    phone: c.phone,
    mobile: ukMobile(c.phone),
    isProspect: c.isProspect,
    price: c.price,
    owed: balance.get(c.id) ?? 0,
    nextDue: c.nextDueDate ? textDate(c.nextDueDate) : "",
    area: c.area && !c.area.isSystemArea ? { id: c.area.id, name: c.area.name, color: c.area.color } : null,
    tags: c.tags.map((t) => t.tag),
    unpaidCleans: (unpaidJobs.get(c.id) ?? []).length,
    reminderDue: reminderStage(c.id),
    lastText: lastTexts.get(c.id) ?? null,
    nextClean: nextBooked.get(c.id)
      ? {
          date: nextBooked.get(c.id)!.date.toISOString().slice(0, 10),
          label: textDate(nextBooked.get(c.id)!.date),
          worker: workerFirstName(nextBooked.get(c.id)!.worker, settings ?? {}),
        }
      : null,
  }));
}

/** Each customer's next booked (not yet done) clean from today. */
async function nextBookedCleans(tenantId: number, customerIds: number[]) {
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const jobs = await prisma.job.findMany({
    where: { tenantId, customerId: { in: customerIds }, status: "PENDING", isQuote: false, workDay: { date: { gte: today } } },
    select: {
      customerId: true,
      assignedUser: { select: { name: true, email: true } },
      workDay: { select: { id: true, date: true, assignedUser: { select: { name: true, email: true } } } },
    },
    orderBy: { workDay: { date: "asc" } },
  });
  const next = new Map<number, { date: Date; workDayId: number; worker: { name: string | null; email: string } | null }>();
  for (const job of jobs) {
    if (!next.has(job.customerId)) {
      next.set(job.customerId, { date: job.workDay.date, workDayId: job.workDay.id, worker: job.assignedUser ?? job.workDay.assignedUser ?? null });
    }
  }
  return next;
}

/** Bulk message with placeholders to the chosen customers. */
export async function sendBulkTexts(input: { customerIds: number[]; template: string; method?: SendMethod }) {
  const actor = await requirePerm("messaging");
  const tenantId = actor.tenantId;
  if (!input.template.trim()) throw new Error("Write the message first.");
  if (input.customerIds.length === 0) throw new Error("Choose who to send it to.");
  const settings = await loadTextSettings(tenantId);
  if (!settings) throw new Error("Save your business settings first.");
  const customers = await prisma.customer.findMany({
    where: { tenantId, id: { in: input.customerIds } },
    select: { id: true, name: true, address: true, phone: true, price: true, nextDueDate: true, area: { select: { name: true } } },
  });
  const { balance } = await balancesFor(tenantId, customers.map((c) => c.id));
  const nextBooked = await nextBookedCleans(tenantId, customers.map((c) => c.id));
  const texts: OutgoingText[] = [];
  for (const c of customers) {
    const to = ukMobile(c.phone);
    if (!to) continue;
    texts.push({
      customerId: c.id,
      to,
      body: renderText(input.template, varsFor(c, settings, {
        amountDue: money(balance.get(c.id) ?? 0),
        nextDueDate: c.nextDueDate ? textDate(c.nextDueDate) : "",
        jobDate: nextBooked.get(c.id) ? textDate(nextBooked.get(c.id)!.date) : "",
        workerName: workerFirstName(nextBooked.get(c.id)?.worker, settings),
      })),
    });
  }
  const result = await deliverTexts(tenantId, settings, "BULK", texts, actor.userId, input.method ?? sendMethodOf(settings));
  revalidatePath("/messages");
  return { ...result, noMobile: customers.length - texts.length };
}

/** Run the payment reminder rules now (the daily job does the same). */
export async function runPaymentRemindersNow() {
  const actor = await requireOwner();
  const result = await runPaymentReminders(actor.tenantId, actor.userId);
  revalidatePath("/messages");
  return result;
}

export async function getMessageLog(limit = 200) {
  const actor = await requirePerm("messaging");
  const logs = await prisma.messageLog.findMany({
    where: { tenantId: actor.tenantId, clearedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const customerIds = [...new Set(logs.map((l) => l.customerId).filter((id): id is number => id !== null))];
  const customers = await prisma.customer.findMany({
    where: { tenantId: actor.tenantId, id: { in: customerIds } },
    select: { id: true, name: true },
  });
  const names = new Map(customers.map((c) => [c.id, c.name]));
  return logs.map((l) => ({ ...l, customerName: l.customerId ? names.get(l.customerId) ?? "" : "" }));
}

/**
 * Clear texts from the log: the chosen ones, or everything matching a filter.
 * They're hidden, not deleted, so reminders and "cleaned" texts are never sent twice.
 * Clearing a text still waiting on the phone takes it out of the phone queue too.
 */
export async function clearMessageLogs(input: { ids?: number[]; kind?: string; status?: string; all?: boolean }) {
  const actor = await requirePerm("messaging");
  if (!input.all && !(input.ids && input.ids.length)) return { cleared: 0 };
  const result = await prisma.messageLog.updateMany({
    where: {
      tenantId: actor.tenantId,
      clearedAt: null,
      ...(input.all ? {} : { id: { in: input.ids } }),
      ...(input.all && input.kind ? { kind: input.kind } : {}),
      ...(input.all && input.status ? { status: input.status } : {}),
    },
    data: { clearedAt: new Date() },
  });
  revalidatePath("/messages");
  return { cleared: result.count };
}

// ── Sending from the user's own phone ─────────────────────────────────────────

/** Texts waiting to be sent from a phone (all, or just for some area days / some ids). */
export async function getPhoneOutbox(filter: { workDayIds?: number[]; ids?: number[] } = {}) {
  const actor = await requirePerm("messaging");
  const logs = await prisma.messageLog.findMany({
    where: {
      tenantId: actor.tenantId,
      status: "TO_SEND",
      clearedAt: null,
      ...(filter.ids ? { id: { in: filter.ids } } : {}),
      ...(filter.workDayIds ? { workDayId: { in: filter.workDayIds } } : {}),
    },
    orderBy: { id: "asc" },
    take: 500,
  });
  const customers = await prisma.customer.findMany({
    where: { tenantId: actor.tenantId, id: { in: logs.map((l) => l.customerId).filter((id): id is number => id !== null) } },
    select: { id: true, name: true },
  });
  const names = new Map(customers.map((c) => [c.id, c.name]));
  return logs.map((l) => ({
    id: l.id,
    kind: l.kind,
    to: l.toNumber,
    body: l.body,
    workDayId: l.workDayId,
    name: l.customerId ? names.get(l.customerId) ?? "" : "",
  }));
}

export async function getPhoneOutboxCount() {
  const actor = await requirePerm("messaging");
  return prisma.messageLog.count({ where: { tenantId: actor.tenantId, status: "TO_SEND", clearedAt: null } });
}

/** The text was opened in the phone's Messages app (we can't see the tap on Send itself). */
export async function markPhoneTextOpened(id: number, editedBody?: string) {
  const actor = await requirePerm("messaging");
  await prisma.messageLog.updateMany({
    where: { id, tenantId: actor.tenantId, status: "TO_SEND" },
    data: { status: "PHONE", sentByUserId: actor.userId, ...(editedBody?.trim() ? { body: editedBody } : {}) },
  });
}

/** Record a single text opened on the phone from elsewhere (e.g. Remind on Payments), so it shows in the log. */
export async function logPhoneText(input: { customerId: number; body: string; kind?: "PAYMENT_REMINDER_1" | "PAYMENT_REMINDER_2" | "BULK" }) {
  const actor = await requirePerm("messaging");
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId: actor.tenantId }, select: { id: true, phone: true } });
  const to = customer ? ukMobile(customer.phone) : null;
  if (!customer || !to) throw new Error("No mobile number saved for this customer.");
  await prisma.messageLog.create({
    data: { tenantId: actor.tenantId, customerId: customer.id, kind: input.kind ?? "BULK", toNumber: to, body: input.body.slice(0, 2000), status: "PHONE", sentByUserId: actor.userId },
  });
  revalidatePath("/messages");
  return { to };
}

/** Drop texts that are waiting to go (e.g. changed your mind). */
export async function discardPhoneTexts(ids: number[]) {
  const actor = await requirePerm("messaging");
  await prisma.messageLog.deleteMany({ where: { tenantId: actor.tenantId, status: "TO_SEND", id: { in: ids } } });
  revalidatePath("/messages");
}
