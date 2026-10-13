/**
 * Repeat expenses and repeat other income: the entries due up to today are added when a page
 * that reads them is opened (Accounting, MTD, exports). No cron is needed; each entry is added
 * once, on its own date, however long it's been.
 */

import prisma from "@/lib/db";

export const REPEAT_UNITS = ["DAY", "WEEK", "MONTH", "YEAR"] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];

export function isValidRepeatUnit(value: string | null | undefined): value is RepeatUnit {
  return REPEAT_UNITS.includes((value ?? "") as RepeatUnit);
}

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Add whole days/weeks/months/years. Months keep the day of the month (anchorDay if given), clamped to the month's length. */
export function addRepeatInterval(date: Date, count: number, unit: RepeatUnit, anchorDay?: number) {
  switch (unit) {
    case "DAY":
      return new Date(utcDay(date).getTime() + count * 86_400_000);
    case "WEEK":
      return new Date(utcDay(date).getTime() + count * 7 * 86_400_000);
    case "MONTH": {
      const y = date.getUTCFullYear(), m = date.getUTCMonth() + count;
      const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return new Date(Date.UTC(y, m, Math.min(anchorDay ?? date.getUTCDate(), lastDay)));
    }
    case "YEAR": {
      const y = date.getUTCFullYear() + count, m = date.getUTCMonth();
      const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay)));
    }
  }
}

/** Add any repeat expenses and repeat income due up to today. Safe to call often. */
export async function materialiseRecurring(tenantId: number) {
  await Promise.all([materialiseRecurringExpenseTemplates(tenantId), materialiseRecurringOtherIncomeTemplates(tenantId)]);
}

export async function materialiseRecurringExpenseTemplates(tenantId: number) {
  const today = utcDay(new Date());
  const templates = await prisma.expense.findMany({
    where: {
      tenantId,
      isRecurring: true,
      recurrenceTemplateId: null,
      nextScheduledAt: { not: null, lte: today },
    },
    orderBy: { id: "asc" },
  });

  for (const template of templates) {
    if (!template.nextScheduledAt || !template.repeatEvery || !isValidRepeatUnit(template.repeatUnit)) continue;

    let nextScheduledAt = utcDay(template.nextScheduledAt);
    const repeatEndsAt = template.repeatEndsAt ? utcDay(template.repeatEndsAt) : null;
    const repeatEvery = template.repeatEvery;
    const repeatUnit = template.repeatUnit;
    // Monthly repeats keep their day of the month (a bill on the 15th stays on the 15th; the 31st
    // falls on the last day of shorter months).
    const anchorDay = utcDay(template.repeatAnchorDate ?? template.nextScheduledAt).getUTCDate();

    await prisma.$transaction(async (tx) => {
      for (let guard = 0; guard < 400 && nextScheduledAt <= today && (!repeatEndsAt || nextScheduledAt <= repeatEndsAt); guard++) {
        const existing = await tx.expense.findFirst({
          where: {
            tenantId,
            recurrenceTemplateId: template.id,
            expenseDate: nextScheduledAt,
          },
          select: { id: true },
        });

        if (!existing) {
          await tx.expense.create({
            data: {
              tenantId,
              recurrenceTemplateId: template.id,
              category: template.category,
              hmrcCategory: template.hmrcCategory,
              // Same business share and vehicle as the original (e.g. a phone that's 70% business).
              businessPct: template.businessPct,
              vehicleId: template.vehicleId,
              supplier: template.supplier,
              amount: template.amount,
              netAmount: template.netAmount,
              vatAmount: template.vatAmount,
              vatRate: template.vatRate,
              taxTreatment: template.taxTreatment,
              expenseDate: nextScheduledAt,
              notes: template.notes,
              isRecurring: false,
            },
          });
        }

        nextScheduledAt = utcDay(addRepeatInterval(nextScheduledAt, repeatEvery, repeatUnit, anchorDay));
      }

      await tx.expense.update({
        where: { id: template.id },
        data: { nextScheduledAt: repeatEndsAt && nextScheduledAt > repeatEndsAt ? null : nextScheduledAt },
      });
    });
  }
}

export async function materialiseRecurringOtherIncomeTemplates(tenantId: number) {
  const today = utcDay(new Date());
  const templates = await prisma.otherIncome.findMany({
    where: {
      tenantId,
      isRecurring: true,
      recurrenceTemplateId: null,
      nextScheduledAt: { not: null, lte: today },
    },
    orderBy: { id: "asc" },
  });

  for (const template of templates) {
    if (!template.nextScheduledAt || !template.repeatEvery || !isValidRepeatUnit(template.repeatUnit)) continue;

    let nextScheduledAt = utcDay(template.nextScheduledAt);
    const repeatEndsAt = template.repeatEndsAt ? utcDay(template.repeatEndsAt) : null;
    const repeatEvery = template.repeatEvery;
    const repeatUnit = template.repeatUnit;
    // Monthly repeats keep their day of the month (a bill on the 15th stays on the 15th; the 31st
    // falls on the last day of shorter months).
    const anchorDay = utcDay(template.repeatAnchorDate ?? template.nextScheduledAt).getUTCDate();

    await prisma.$transaction(async (tx) => {
      for (let guard = 0; guard < 400 && nextScheduledAt <= today && (!repeatEndsAt || nextScheduledAt <= repeatEndsAt); guard++) {
        const existing = await tx.otherIncome.findFirst({
          where: {
            tenantId,
            recurrenceTemplateId: template.id,
            receivedAt: nextScheduledAt,
          },
          select: { id: true },
        });

        if (!existing) {
          await tx.otherIncome.create({
            data: {
              tenantId,
              recurrenceTemplateId: template.id,
              category: template.category,
              source: template.source,
              amount: template.amount,
              netAmount: template.netAmount,
              vatAmount: template.vatAmount,
              vatRate: template.vatRate,
              taxTreatment: template.taxTreatment,
              receivedAt: nextScheduledAt,
              notes: template.notes,
              isRecurring: false,
            },
          });
        }

        nextScheduledAt = utcDay(addRepeatInterval(nextScheduledAt, repeatEvery, repeatUnit, anchorDay));
      }

      await tx.otherIncome.update({
        where: { id: template.id },
        data: { nextScheduledAt: repeatEndsAt && nextScheduledAt > repeatEndsAt ? null : nextScheduledAt },
      });
    });
  }
}
