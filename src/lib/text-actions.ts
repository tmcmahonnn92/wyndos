"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { requireOwner, requirePerm, visibleJobWhere, visibleWorkDayWhere } from "@/lib/guards";
import {
  balancesFor,
  deliverTexts,
  isLive,
  liveSendingAllowedByServer,
  loadTextSettings,
  money,
  renderText,
  runPaymentReminders,
  textDate,
  ukMobile,
  varsFor,
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
  };
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
      jobs: {
        where: { status: "PENDING", ...visibleJobWhere(actor) },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          price: true,
          customer: { select: { id: true, name: true, address: true, phone: true, area: { select: { name: true } } } },
        },
      },
    },
  });
  const { balance } = await balancesFor(tenantId, days.flatMap((d) => d.jobs.map((j) => j.customer.id)));
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
        vars: settings
          ? varsFor({ ...job.customer, price: job.price }, settings, {
              jobDate: textDate(day.date),
              amountDue: money(balance.get(job.customer.id) ?? 0),
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
  const result = await deliverTexts(tenantId, settings, "DAY_REMINDER", texts, actor.userId);
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
  const { balance } = await balancesFor(tenantId, customers.map((c) => c.id));
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
  }));
}

/** Bulk message with placeholders to the chosen customers. */
export async function sendBulkTexts(input: { customerIds: number[]; template: string }) {
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
      })),
    });
  }
  const result = await deliverTexts(tenantId, settings, "BULK", texts, actor.userId);
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
    where: { tenantId: actor.tenantId },
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
