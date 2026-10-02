"use server";

import prisma from "@/lib/db";
import { hasPermission, requirePerm } from "@/lib/guards";
import { balancesFor, ukMobile } from "@/lib/texts";

const DAY = 86_400_000;

function utcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type TodoItem = {
  key: string;
  tone: "red" | "amber" | "blue" | "green";
  title: string;
  detail: string;
  href: string;
  action: string;
};

/**
 * The scheduler's to-do list: reminders to send, payments to chase,
 * "windows cleaned" texts not sent yet, texts waiting on the phone, overdue areas.
 */
export async function getAdminTodo(): Promise<TodoItem[]> {
  const actor = await requirePerm("schedule");
  if (actor.isWorker && !hasPermission(actor, "scheduler")) return [];
  const tenantId = actor.tenantId;
  const canText = hasPermission(actor, "messaging");
  const canPay = hasPermission(actor, "payments");
  const today = utcDay(new Date());
  const items: TodoItem[] = [];

  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { textPaymentReminderDays: true },
  });

  // 1. Reminders for the next two days' work.
  if (canText) {
    const soonDays = await prisma.workDay.findMany({
      where: { tenantId, status: { in: ["PLANNED", "IN_PROGRESS"] }, date: { gte: today, lt: new Date(today.getTime() + 3 * DAY) } },
      select: {
        id: true,
        date: true,
        area: { select: { name: true } },
        jobs: { where: { status: "PENDING", isQuote: false }, select: { customerId: true, customer: { select: { phone: true } } } },
      },
      orderBy: { date: "asc" },
    });
    const reminded = await prisma.messageLog.findMany({
      where: { tenantId, kind: "DAY_REMINDER", workDayId: { in: soonDays.map((d) => d.id) }, status: { not: "FAILED" } },
      select: { workDayId: true, customerId: true },
    });
    const done = new Set(reminded.map((r) => `${r.workDayId}:${r.customerId}`));
    for (const day of soonDays) {
      const left = day.jobs.filter((j) => ukMobile(j.customer.phone) && !done.has(`${day.id}:${j.customerId}`)).length;
      if (left === 0) continue;
      const when = day.date.getTime() === today.getTime() ? "today" : day.date.getTime() === today.getTime() + DAY ? "tomorrow" : day.date.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
      items.push({
        key: `remind-${day.id}`,
        tone: "blue",
        title: `Send reminders: ${day.area?.name ?? "One-off"} ${when}`,
        detail: `${left} customer${left === 1 ? "" : "s"} not told yet`,
        href: `/days/${day.id}?remind=1`,
        action: "Send",
      });
    }
  }

  // 2. "Windows cleaned" texts not sent for days finished in the last two weeks.
  if (canText) {
    const doneDays = await prisma.workDay.findMany({
      where: { tenantId, status: "COMPLETE", date: { gte: new Date(today.getTime() - 14 * DAY) } },
      select: {
        id: true,
        date: true,
        area: { select: { name: true } },
        jobs: {
          where: { status: "COMPLETE", isQuote: false },
          select: { id: true, customer: { select: { phone: true, preferredPaymentMethod: true, paidByCustomerId: true } } },
        },
      },
      orderBy: { date: "desc" },
    });
    const jobIds = doneDays.flatMap((d) => d.jobs.map((j) => j.id));
    const texted = new Set(
      (await prisma.messageLog.findMany({ where: { tenantId, kind: "CLEANED", jobId: { in: jobIds } }, select: { jobId: true } }))
        .map((m) => m.jobId),
    );
    for (const day of doneDays) {
      const left = day.jobs.filter((j) =>
        ukMobile(j.customer.phone) && j.customer.preferredPaymentMethod !== "DD" && !j.customer.paidByCustomerId && !texted.has(j.id),
      ).length;
      if (left === 0) continue;
      items.push({
        key: `cleaned-${day.id}`,
        tone: "green",
        title: `Tell customers: ${day.area?.name ?? "One-off"} cleaned`,
        detail: `${left} customer${left === 1 ? "" : "s"} · ${day.date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`,
        href: `/days/${day.id}?cleaned=1`,
        action: "Text",
      });
    }
  }

  // 3. Payments to chase: owing for longer than the reminder setting (or 14 days).
  if (canPay) {
    const chaseAfter = settings?.textPaymentReminderDays && settings.textPaymentReminderDays > 0 ? settings.textPaymentReminderDays : 14;
    const customers = await prisma.customer.findMany({
      where: { tenantId, paidByCustomerId: null, NOT: { preferredPaymentMethod: "DD" } },
      select: { id: true },
    });
    const { balance, unpaidJobs } = await balancesFor(tenantId, customers.map((c) => c.id));
    const cutoff = today.getTime() - chaseAfter * DAY;
    const recentChase = new Set(
      (await prisma.messageLog.findMany({
        where: {
          tenantId,
          kind: { in: ["PAYMENT_CHASE", "PAYMENT_REMINDER_1", "PAYMENT_REMINDER_2"] },
          createdAt: { gte: new Date(today.getTime() - 7 * DAY) },
        },
        select: { customerId: true },
      })).map((m) => m.customerId),
    );
    let count = 0;
    let total = 0;
    for (const [customerId, jobs] of unpaidJobs) {
      const late = jobs.some((j) => j.completedAt && j.completedAt.getTime() < cutoff);
      if (!late || recentChase.has(customerId)) continue;
      count++;
      total += balance.get(customerId) ?? 0;
    }
    if (count > 0) {
      items.push({
        key: "chase",
        tone: "red",
        title: `Chase payment from ${count} customer${count === 1 ? "" : "s"}`,
        detail: `Owing over ${chaseAfter} days · £${total.toFixed(2)}`,
        href: "/payments?late=1",
        action: "Chase",
      });
    }
  }

  // 4. Texts saved on a computer, waiting to go from a phone.
  if (canText) {
    const waiting = await prisma.messageLog.count({ where: { tenantId, status: "TO_SEND", clearedAt: null } });
    if (waiting > 0) {
      items.push({
        key: "outbox",
        tone: "amber",
        title: `${waiting} text${waiting === 1 ? "" : "s"} waiting to send`,
        detail: "Open on your phone to send",
        href: "/send",
        action: "Send",
      });
    }
  }

  // 5. Areas past their due date with nothing booked.
  const overdue = await prisma.area.findMany({
    where: { tenantId, isSystemArea: false, nextDueDate: { lt: today } },
    select: { id: true },
  });
  if (overdue.length > 0) {
    items.push({
      key: "overdue",
      tone: "amber",
      title: `${overdue.length} area${overdue.length === 1 ? "" : "s"} overdue`,
      detail: "Put them on a day",
      href: "/scheduler",
      action: "Plan",
    });
  }

  return items;
}
