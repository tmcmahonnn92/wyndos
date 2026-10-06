"use server";

import { normalisePreference } from "@/lib/payment-preference";
import { INACTIVE_AREA_NAME } from "@/lib/system-areas";
import { pickPlain } from "@/lib/safe-input";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { queueNotification } from "@/lib/notifications";
import type { Prisma } from "@/generated/prisma/client";
import { matchesLooseCustomerSearch } from "@/lib/customer-search";
import { getExpenseCategory, getOtherIncomeCategory, getTaxTreatment, EXPENSE_CATEGORIES, OTHER_INCOME_CATEGORIES, TAX_TREATMENT_OPTIONS } from "@/lib/accounting";
import { calcNextDue } from "@/lib/utils";
import { addDays, startOfDay } from "date-fns";
import { requireAuth } from "@/lib/tenant-context";
import { orderDays } from "@/lib/day-order";
import {
  getActor,
  requireMember,
  requireOwner,
  requirePerm,
  hasPermission,
  visibleJobWhere,
  visibleWorkDayWhere,
  requireVisibleWorkDay,
  requireReorder,
  AccessDeniedError,
  type Actor,
} from "@/lib/guards";
import { decryptSettingsSecrets, encryptSecret } from "@/lib/secrets";
import { creditFor, queueCleanedTexts } from "@/lib/texts";
import { referenceKeys } from "@/lib/bank-import/match";
import {
  EMPTY_ADDRESS,
  addressPartsOf,
  collectKnownTowns,
  compareByStreet,
  composeAddress,
  normalisePostcode,
  splitAddress,
  type AddressParts,
} from "@/lib/address";

type PaymentMethodValue = "CASH" | "BACS" | "CARD";

/** Normalise any Date to UTC midnight so date-input strings and DB values always match. */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Customers due within this many days after a run's date are included in that run. */

function addUtcDays(d: Date, days: number): Date {
  const base = utcDay(d);
  return new Date(base.getTime() + days * 86_400_000);
}

async function requireTenantArea(tenantId: number, areaId: number) {
  const area = await prisma.area.findFirst({ where: { id: areaId, tenantId } });
  if (!area) throw new Error("Area not found");
  return area;
}

/**
 * Delete jobs that haven't been done, without breaking payment records.
 * Allocations from voided payments are cleared first; a job that still has
 * real money allocated to it is kept (deleting it would lose the payment).
 * Returns the ids that were kept.
 */
async function deleteUnpaidJobs(tenantId: number, jobIds: number[]): Promise<number[]> {
  if (jobIds.length === 0) return [];
  await prisma.paymentAllocation.deleteMany({
    where: { tenantId, jobId: { in: jobIds }, payment: { voidedAt: { not: null } } },
  });
  const paid = await prisma.paymentAllocation.findMany({
    where: { tenantId, jobId: { in: jobIds } },
    select: { jobId: true },
  });
  const keep = new Set(paid.map((p) => p.jobId));
  const toDelete = jobIds.filter((id) => !keep.has(id));
  if (toDelete.length) await prisma.job.deleteMany({ where: { tenantId, id: { in: toDelete } } });
  return [...keep];
}

/**
 * A split area run is one "main" day plus "part" days (partOfId = main id).
 * Returns the run's pieces so completion can wait for all of them.
 */
async function runPieces(tenantId: number, day: { id: number; partOfId: number | null; areaId: number | null }) {
  const rootId = day.partOfId ?? day.id;
  if (!day.areaId) return { rootId, pieces: [] as Array<{ id: number; date: Date; status: string }>, split: false };
  const pieces = await prisma.workDay.findMany({
    where: { tenantId, OR: [{ id: rootId }, { partOfId: rootId }] },
    select: { id: true, date: true, status: true },
    orderBy: { date: "asc" },
  });
  return { rootId, pieces, split: pieces.length > 1 };
}

/** Before a day is deleted, hand its "main day" role to its earliest part (if it has parts). */
async function promoteRunParts(tenantId: number, dayId: number) {
  const parts = await prisma.workDay.findMany({ where: { tenantId, partOfId: dayId }, orderBy: { date: "asc" }, select: { id: true } });
  if (parts.length === 0) return;
  const [first, ...rest] = parts;
  await prisma.workDay.update({ where: { id: first.id }, data: { partOfId: null } });
  if (rest.length) await prisma.workDay.updateMany({ where: { id: { in: rest.map((p) => p.id) } }, data: { partOfId: first.id } });
}

/** Delete a not-yet-done day that has no jobs left. */
async function removeDayIfEmpty(tenantId: number, dayId: number) {
  const wd = await prisma.workDay.findFirst({ where: { id: dayId, tenantId }, include: { _count: { select: { jobs: true } } } });
  if (!wd || wd._count.jobs > 0 || wd.status === "COMPLETE") return;
  await promoteRunParts(tenantId, wd.id);
  await prisma.workDay.delete({ where: { id: wd.id } });
}

/**
 * Move jobs to another date, keeping each job in its own area. An area job goes onto that
 * area's day on the new date (made as a "part" of the same run if there isn't one), so the
 * area stays one run: its next visit is booked once every part is done.
 */
/** Position at the end of a day's jobs, so added or moved jobs go last, not first. */
async function endOfDay(workDayId: number) {
  const m = await prisma.job.aggregate({ where: { workDayId }, _max: { sortOrder: true } });
  return (m._max.sortOrder ?? -1) + 1;
}

/** Position at the end of an area's walking order. */
async function endOfArea(tenantId: number, areaId: number) {
  const m = await prisma.customer.aggregate({ where: { tenantId, areaId }, _max: { sortOrder: true } });
  return (m._max.sortOrder ?? -1) + 1;
}

async function moveJobsToDateFor(
  actor: Awaited<ReturnType<typeof requirePerm>>,
  jobIds: number[],
  dateISO: string,
) {
  const tenantId = actor.tenantId;
  const d = isoToUTC(dateISO);
  const jobs = await prisma.job.findMany({
    where: { tenantId, id: { in: jobIds }, status: { not: "COMPLETE" }, ...visibleJobWhere(actor) },
    include: { workDay: { include: { area: { select: { name: true } } } } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const targets = new Map<string, { id: number; assignedUserId: string | null }>();
  const sources = new Set<number>();
  let moved = 0;
  for (const job of jobs) {
    const src = job.workDay;
    if (src.date.getTime() === d.getTime()) continue;
    const key = src.areaId ? `area-${src.areaId}` : "standalone";
    let target = targets.get(key);
    if (!target) {
      if (src.areaId) {
        const existing = await prisma.workDay.findFirst({ where: { tenantId, date: d, areaId: src.areaId }, select: { id: true, status: true, assignedUserId: true } });
        if (existing?.status === "COMPLETE") {
          throw new Error(`${src.area?.name ?? "That area"} is already completed on that date. Pick another date.`);
        }
        target = existing ?? await prisma.workDay.create({
          data: {
            tenantId,
            date: d,
            areaId: src.areaId,
            partOfId: src.status === "COMPLETE" ? null : (src.partOfId ?? src.id),
            assignedUserId: src.assignedUserId ?? undefined,
          },
          select: { id: true, assignedUserId: true },
        });
      } else {
        target = await prisma.workDay.create({ data: { tenantId, date: d, assignedUserId: src.assignedUserId ?? undefined }, select: { id: true, assignedUserId: true } });
      }
      targets.set(key, target);
    }
    const keepWorker = job.assignedUserId ?? src.assignedUserId ?? null;
    await prisma.job.update({
      where: { id: job.id },
      data: {
        workDayId: target.id,
        status: "PENDING",
        sortOrder: await endOfDay(target.id),
        afterJobId: null,
        assignedUserId: keepWorker && keepWorker !== target.assignedUserId ? keepWorker : null,
      },
    });
    sources.add(src.id);
    moved += 1;
  }
  for (const sourceId of sources) await removeDayIfEmpty(tenantId, sourceId);
  return { moved, dayIds: [...targets.values()].map((t) => t.id) };
}

/** Move chosen jobs (e.g. part of an area) to another date. See moveJobsToDateFor. */
export async function moveJobsToDate(jobIds: number[], dateISO: string) {
  const actor = await requirePerm("schedule");
  if (!Array.isArray(jobIds) || jobIds.length === 0 || !dateISO) return { moved: 0, dayIds: [] as number[] };
  const result = await moveJobsToDateFor(actor, jobIds, dateISO);
  revalidatePath("/scheduler");
  revalidatePath("/days");
  revalidatePath("/");
  return result;
}

async function requireTenantJob(tenantId: number, jobId: number) {
  const actor = await getActor();
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId, ...visibleJobWhere(actor) } });
  if (!job) throw new Error("Job not found");
  return job;
}

async function requireTenantWorkDay(tenantId: number, workDayId: number) {
  const actor = await getActor();
  const workDay = await prisma.workDay.findFirst({
    where: { id: workDayId, tenantId, ...visibleWorkDayWhere(actor) },
  });
  if (!workDay) throw new Error("Work day not found");
  return workDay;
}

async function requireTenantExpense(tenantId: number, expenseId: number) {
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, tenantId } });
  if (!expense) throw new Error("Expense not found");
  return expense;
}

async function requireTenantOtherIncome(tenantId: number, otherIncomeId: number) {
  const income = await prisma.otherIncome.findFirst({ where: { id: otherIncomeId, tenantId } });
  if (!income) throw new Error("Income entry not found");
  return income;
}

async function requireTenantPayment(tenantId: number, paymentId: number) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, tenantId } });
  if (!payment) throw new Error("Payment not found");
  return payment;
}

async function requireTenantCustomer(tenantId: number, customerId: number) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!customer) throw new Error("Customer not found");
  return customer;
}

async function resolveAssignedWorkerId(
  tenantId: number,
  assignedUserId?: string | null,
  options: { allowOwner?: boolean } = {}
) {
  if (assignedUserId === undefined) return undefined;
  if (!assignedUserId) return null;

  const membership = await prisma.membership.findFirst({
    where: { tenantId, userId: assignedUserId, ...(options.allowOwner ? {} : { role: "WORKER" }) },
    select: { userId: true },
  });
  if (!membership) {
    throw new Error("Selected worker does not belong to this company.");
  }

  return membership.userId;
}

async function getVisibleWorkDayWhere(tenantId: number) {
  const actor = await getActor();
  return { tenantId, ...visibleWorkDayWhere(actor) };
}

function normaliseGoCardlessReference(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, "") ?? "";
}

function parseWyndosCustomerId(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function minorUnitsToCurrency(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Number((parsed / 100).toFixed(2));
}

async function createAllocatedPayment(data: {
  tenantId: number;
  customerId: number;
  allocations: Array<{ jobId: number; amount: number }>;
  method: PaymentMethodValue;
  notes?: string;
  paidAt?: Date;
  goCardlessPaymentId?: string;
  goCardlessStatus?: string;
  goCardlessReference?: string;
  collectedByUserId?: string | null;
  clientRequestId?: string | null;
  /** Paid on top of the jobs above: kept as credit for the next cleans. */
  extra?: number;
}) {
  await requireTenantCustomer(data.tenantId, data.customerId);

  // Offline retries resend the same clientRequestId: return the first payment instead of paying twice.
  if (data.clientRequestId) {
    const existing = await prisma.payment.findUnique({ where: { clientRequestId: data.clientRequestId } });
    if (existing) {
      if (existing.tenantId !== data.tenantId) throw new Error("Payment not found");
      return existing;
    }
  }

  let allocationData = data.allocations
    .filter((allocation) => allocation.amount > 0.005)
    .map((allocation) => ({ ...allocation }));
  let extra = Number(Math.max(0, data.extra ?? 0).toFixed(2));
  if (allocationData.length === 0 && extra <= 0) {
    throw new Error("Enter an amount to record");
  }

  const totalAmount = Number((allocationData.reduce((sum, allocation) => sum + allocation.amount, 0) + extra).toFixed(2));
  const jobIds = allocationData.map((allocation) => allocation.jobId);
  const jobs = await prisma.job.findMany({
    where: {
      id: { in: jobIds },
      tenantId: data.tenantId,
      customerId: data.customerId,
    },
    select: {
      id: true,
      price: true,
      allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
    },
  });
  if (jobs.length !== new Set(jobIds).size) {
    throw new Error("One or more jobs not found or do not belong to this customer");
  }
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  // More than a job still owes (e.g. credit already paid part of it): the rest is kept as credit.
  let overflow = 0;
  for (const allocation of allocationData) {
    const job = jobById.get(allocation.jobId)!;
    const paid = job.allocations.reduce((sum, entry) => sum + entry.amount, 0);
    const due = Math.max(0, Number((job.price - paid).toFixed(2)));
    if (allocation.amount - due > 0.005) {
      overflow += allocation.amount - due;
      allocation.amount = due;
    }
  }
  if (extra > 0 || overflow > 0.005) {
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: data.tenantId }, select: { allowCustomerCredit: true } });
    if (settings && !settings.allowCustomerCredit) {
      throw new Error(overflow > 0.005
        ? "That's more than is owed. Customer credit is turned off in Settings."
        : "Customer credit is turned off in Settings.");
    }
  }
  if (overflow > 0) {
    extra = Number((extra + overflow).toFixed(2));
    allocationData = allocationData.filter((allocation) => allocation.amount > 0.005);
  }

  const created = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        tenantId: data.tenantId,
        customerId: data.customerId,
        amount: totalAmount,
        method: data.method,
        notes: data.notes ?? null,
        paidAt: data.paidAt ?? new Date(),
        goCardlessPaymentId: data.goCardlessPaymentId ?? null,
        goCardlessStatus: data.goCardlessStatus ?? null,
        goCardlessReference: data.goCardlessReference ?? null,
        collectedByUserId: data.collectedByUserId ?? null,
        clientRequestId: data.clientRequestId ?? null,
      },
    });

    if (allocationData.length > 0) {
      await tx.paymentAllocation.createMany({
        data: allocationData.map((allocation) => ({
          tenantId: data.tenantId,
          paymentId: payment.id,
          jobId: allocation.jobId,
          amount: Number(allocation.amount.toFixed(2)),
        })),
      });
    }

    return payment;
  });
  if (extra > 0) await applyCredit(data.tenantId, [data.customerId]);
  return created;
}

const round2 = (n: number) => Number(n.toFixed(2));

/**
 * Credit = money paid that isn't on a clean yet (paid extra, or paid in advance).
 * It lives on the payment itself: the part of a payment not allocated to any job.
 */
async function sparePayments(tenantId: number, customerIds: number[]) {
  const payments = await prisma.payment.findMany({
    where: { tenantId, customerId: { in: customerIds }, voidedAt: null },
    select: { id: true, customerId: true, amount: true, allocations: { select: { amount: true } } },
    orderBy: [{ paidAt: "asc" }, { id: "asc" }],
  });
  return payments
    .map((p) => ({ id: p.id, customerId: p.customerId, spare: round2(p.amount - p.allocations.reduce((s, a) => s + a.amount, 0)) }))
    .filter((p) => p.spare > 0.005);
}

/**
 * Use any credit to pay completed cleans that aren't paid yet, oldest first. A payer's
 * credit also covers the customers they pay for. Part-covered cleans keep the rest owing.
 */
async function applyCredit(tenantId: number, payerIds: Array<number | null | undefined>) {
  const ids = [...new Set(payerIds.filter((id): id is number => typeof id === "number"))];
  for (const payerId of ids) {
    const spare = await sparePayments(tenantId, [payerId]);
    if (spare.length === 0) continue;
    const jobs = await prisma.job.findMany({
      where: {
        tenantId, status: "COMPLETE", isQuote: false,
        customerId: payerId,
      },
      select: { id: true, price: true, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } },
      orderBy: [{ workDay: { date: "asc" } }, { id: "asc" }],
    });
    const rows: Array<{ tenantId: number; paymentId: number; jobId: number; amount: number }> = [];
    let p = 0;
    for (const job of jobs) {
      if (p >= spare.length) break;
      let due = round2(job.price - job.allocations.reduce((s, a) => s + a.amount, 0));
      while (due > 0.005 && p < spare.length) {
        const take = round2(Math.min(due, spare[p].spare));
        rows.push({ tenantId, paymentId: spare[p].id, jobId: job.id, amount: take });
        spare[p].spare = round2(spare[p].spare - take);
        due = round2(due - take);
        if (spare[p].spare <= 0.005) p++;
      }
    }
    if (rows.length > 0) await prisma.paymentAllocation.createMany({ data: rows });
  }
}

/** A job's price went down below what's been paid on it: the extra goes back to credit. */
async function releaseOverpaid(tenantId: number, jobId: number) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, tenantId },
    select: {
      price: true, customerId: true,
      allocations: { where: { payment: { voidedAt: null } }, select: { id: true, amount: true }, orderBy: { id: "desc" } },
    },
  });
  if (!job) return;
  let over = round2(job.allocations.reduce((s, a) => s + a.amount, 0) - job.price);
  for (const allocation of job.allocations) {
    if (over <= 0.005) break;
    if (allocation.amount <= over + 0.005) {
      await prisma.paymentAllocation.delete({ where: { id: allocation.id } });
      over = round2(over - allocation.amount);
    } else {
      await prisma.paymentAllocation.update({ where: { id: allocation.id }, data: { amount: round2(allocation.amount - over) } });
      over = 0;
    }
  }
  await applyCredit(tenantId, [job.customerId]);
}

/** Record money paid in advance (or extra) as credit. It pays any cleans owing first. */
export async function addCustomerCredit(data: {
  customerId: number;
  amount: number;
  method: PaymentMethodValue;
  notes?: string;
  paidAt?: Date;
}) {
  const actor = await requirePerm("payments");
  const amount = round2(Number(data.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount above zero.");
  await createAllocatedPayment({
    tenantId: actor.tenantId,
    customerId: data.customerId,
    allocations: [],
    extra: amount,
    method: data.method,
    notes: data.notes?.trim() || "Paid in advance",
    paidAt: data.paidAt,
    collectedByUserId: actor.userId,
  });
  revalidatePath("/payments");
  revalidatePath(`/customers/${data.customerId}`);
}

/** Credit a customer holds right now. */
export async function getCustomerCredit(customerId: number) {
  const actor = await requireMember();
  if (!hasPermission(actor, "customers") && !hasPermission(actor, "payments")) throw new AccessDeniedError();
  return (await creditFor(actor.tenantId, [customerId])).get(customerId) ?? 0;
}

/** Validate a "paid by" customer link. undefined = leave unchanged, null = clear. */

async function requireTenantTag(tenantId: number, tagId: number) {
  const tag = await prisma.tag.findFirst({ where: { id: tagId, tenantId } });
  if (!tag) throw new Error("Tag not found");
  return tag;
}

async function requireTenantHoliday(tenantId: number, holidayId: number) {
  const holiday = await prisma.holiday.findFirst({ where: { id: holidayId, tenantId } });
  if (!holiday) throw new Error("Holiday not found");
  return holiday;
}

/**
 * Calculate the next run date for an area after a given date.
 *  - WEEKLY:  fromDate + frequencyWeeks
 *  - MONTHLY: next occurrence of monthlyDay in a calendar month after fromDate
 */
function nextRunAfter(
  area: { scheduleType: string; frequencyWeeks: number; monthlyDay: number | null },
  fromDate: Date
): Date {
  if (area.scheduleType === "MONTHLY") {
    const day = area.monthlyDay ?? 1;
    const from = utcDay(fromDate);
    // Try the same calendar month first
    const sameMonth = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), day));
    if (sameMonth > from) return sameMonth;
    // Otherwise use next calendar month
    return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, day));
  }
  return addUtcDays(fromDate, (area.frequencyWeeks ?? 4) * 7);
}

/**
 * How many days after a run's date a customer can be due and still go on it. Keeps an area
 * together: someone slightly out of step is cleaned a little early rather than waiting a
 * whole extra cycle. Area setting, else business setting, else half the area's frequency.
 */
async function runDueWindow(tenantId: number, area: { frequencyWeeks: number; dueWindowDays?: number | null }) {
  if (area.dueWindowDays != null && area.dueWindowDays >= 0) return area.dueWindowDays;
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { runDueWindowDays: true } });
  if (settings?.runDueWindowDays != null && settings.runDueWindowDays >= 0) return settings.runDueWindowDays;
  return Math.max(3, Math.round(((area.frequencyWeeks || 4) * 7) / 2));
}

/** Customers actually cleaned on a day: last cleaned that day, next due one area-cycle later. */
async function markCustomersCleaned(
  tenantId: number,
  workDayId: number,
  cleanedOn: Date,
  area: { scheduleType: string; frequencyWeeks: number; monthlyDay: number | null } | null | undefined
) {
  // Monthly areas (e.g. "the 15th of every month") follow the calendar, not every 4 weeks.
  const nextDue = area?.scheduleType === "MONTHLY"
    ? nextRunAfter(area, cleanedOn)
    : addUtcDays(cleanedOn, (area?.frequencyWeeks || 4) * 7);
  const cleanedJobs = await prisma.job.findMany({
    where: { tenantId, workDayId, status: "COMPLETE" },
    select: { customerId: true },
  });
  for (const cleaned of cleanedJobs) {
    await prisma.customer.update({
      where: { id: cleaned.customerId },
      data: {
        lastCompletedDate: cleanedOn,
        nextDueDate: nextDue,
      },
    });
  }
}

async function syncAreaScheduleAfterCompletion(
  tenantId: number,
  workDay: {
    id: number;
    areaId: number | null;
    assignedUserId: string | null;
    area: { id: number; name: string; frequencyWeeks: number; scheduleType: string; monthlyDay: number | null; dueWindowDays?: number | null } | null;
  },
  fallbackCompletedDate: Date,
  splitRun?: { runDate: Date; runDayIds: number[] }
) {
  if (!workDay.area || !workDay.areaId) return null;

  // System areas ("One-Off Jobs", "Overdue – …") have no cadence (frequencyWeeks 9999):
  // never auto-schedule them, or the next run lands centuries away.
  const areaRow = await prisma.area.findUnique({ where: { id: workDay.area.id }, select: { isSystemArea: true } });
  if (areaRow?.isSystemArea) return null;

  const latestCompleted = await prisma.workDay.findFirst({
    where: { tenantId, areaId: workDay.area.id, status: "COMPLETE" },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const lastCompleted = splitRun?.runDate ?? latestCompleted?.date ?? fallbackCompletedDate;
  const nextDue = nextRunAfter(workDay.area, lastCompleted);

  await prisma.area.update({
    where: { id: workDay.area.id },
    data: { lastCompletedDate: lastCompleted, nextDueDate: nextDue },
  });

  // Only customers actually cleaned on this day count as cleaned. Skipped / not-done
  // customers keep their own due date. Frequency belongs to the area (a different
  // frequency means a different area, e.g. "Cuckney 8 weekly").
  await markCustomersCleaned(tenantId, workDay.id, fallbackCompletedDate, workDay.area);
  // Everyone cleaned on any part of a split run stays together on the next run.
  const runCustomerIds = splitRun
    ? (await prisma.job.findMany({ where: { tenantId, workDayId: { in: splitRun.runDayIds }, status: "COMPLETE" }, select: { customerId: true } })).map((j) => j.customerId)
    : [];

  // Setting: the next run goes to the same worker (default), or is left for the owner to give out.
  const keepWorker = (await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { keepWorkerOnNextRun: true } }))?.keepWorkerOnNextRun ?? true;
  const nextWorker = keepWorker ? workDay.assignedUserId ?? null : null;
  const targetNextWorkDay = await prisma.workDay.upsert({
    where: { tenantId_date_areaId: { tenantId, date: nextDue, areaId: workDay.area.id } },
    update: keepWorker ? { assignedUserId: nextWorker } : {},
    create: { tenantId, date: nextDue, areaId: workDay.area.id, assignedUserId: nextWorker ?? undefined },
  });

  const sourceNextWorkDay = await prisma.workDay.findFirst({
    where: {
      tenantId,
      areaId: workDay.area.id,
      status: { not: "COMPLETE" },
      id: { notIn: [workDay.id, targetNextWorkDay.id] },
    },
    include: { jobs: { select: { id: true, customerId: true } } },
    orderBy: { date: "asc" },
  });

  const targetJobs = await prisma.job.findMany({
    where: { tenantId, workDayId: targetNextWorkDay.id },
    select: { customerId: true },
  });
  const targetCustomerIds = new Set(targetJobs.map((job) => job.customerId));

  if (sourceNextWorkDay && sourceNextWorkDay.id !== targetNextWorkDay.id) {
    for (const sourceJob of sourceNextWorkDay.jobs) {
      if (targetCustomerIds.has(sourceJob.customerId)) {
        const kept = await deleteUnpaidJobs(tenantId, [sourceJob.id]);
        if (kept.length === 0) continue;
        // Paid already: keep it by moving it onto the target day like any other job.
      }
      await prisma.job.update({
        where: { id: sourceJob.id },
        data: { workDayId: targetNextWorkDay.id },
      });
      targetCustomerIds.add(sourceJob.customerId);
    }

    const remainingJobs = await prisma.job.count({ where: { tenantId, workDayId: sourceNextWorkDay.id } });
    if (remainingJobs === 0) {
      await prisma.workDay.delete({ where: { id: sourceNextWorkDay.id } });
    }
  }

  // Customers due by this run, or within the area's window after it, are included.
  const eligibleCustomers = await prisma.customer.findMany({
    where: {
      tenantId,
      areaId: workDay.area.id,
      active: true,
      OR: [
        { nextDueDate: null },
        { nextDueDate: { lte: addUtcDays(nextDue, await runDueWindow(tenantId, workDay.area)) } },
        ...(runCustomerIds.length ? [{ id: { in: runCustomerIds } }] : []),
      ],
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const newJobs = eligibleCustomers.filter((customer) => !targetCustomerIds.has(customer.id));
  if (newJobs.length > 0) {
    await prisma.job.createMany({
      data: newJobs.map((customer) => ({
        tenantId,
        workDayId: targetNextWorkDay.id,
        customerId: customer.id,
        price: customer.price,
        sortOrder: customer.sortOrder,
        name: customer.jobName || "Window Cleaning",
        status: customer.skipNextAreaRun ? "SKIPPED" : "PENDING",
        notes: customer.skipNextAreaRun ? "Completed via another area run" : null,
      })),
    });
    const toReset = newJobs.filter((customer) => customer.skipNextAreaRun).map((customer) => customer.id);
    if (toReset.length > 0) {
      await prisma.customer.updateMany({ where: { tenantId, id: { in: toReset } }, data: { skipNextAreaRun: false } });
    }
  }

  return { nextDue, nextWorkDayId: targetNextWorkDay.id, areaName: workDay.area.name };
}

// ─── Areas ─────────────────────────────────────────────────────────────────

export async function createArea(data: {
  name: string;
  sortOrder?: number;
  scheduleType?: string;
  frequencyWeeks?: number;
  monthlyDay?: number;
  nextDueDate?: Date;
}) {
  const actor = await requirePerm("areas");
  const tenantId = actor.tenantId;
  const name = data.name.trim();
  if (!name) throw new Error("Give the area a name.");
  const area = await prisma.area.create({ data: { tenantId,
      name,
      sortOrder: data.sortOrder ?? 0,
      scheduleType: data.scheduleType ?? "WEEKLY",
      frequencyWeeks: data.frequencyWeeks ?? 4,
      monthlyDay: data.monthlyDay ?? null,
      nextDueDate: data.nextDueDate ?? null,
    },
    select: { id: true, name: true, frequencyWeeks: true, nextDueDate: true },
  });
  revalidatePath("/days");
  revalidatePath("/areas");
  revalidatePath("/");
  return area;
}

export async function updateArea(
  id: number,
  data: {
    name?: string;
    color?: string;
    sortOrder?: number;
    scheduleType?: string;
    frequencyWeeks?: number;
    monthlyDay?: number | null;
    nextDueDate?: Date | null;
    dueWindowDays?: number | null;
  }
) {
  const actor = await requirePerm("areas");
  const tenantId = actor.tenantId;
  const area = await requireTenantArea(tenantId, id);
  await prisma.area.update({
    where: { id: area.id },
    data: pickPlain(data, ["name", "color", "sortOrder", "scheduleType", "frequencyWeeks", "monthlyDay", "nextDueDate", "dueWindowDays"] as const),
  });
  // Frequency belongs to the area: every customer in it follows the area.
  if (data.frequencyWeeks !== undefined && !area.isSystemArea) {
    await prisma.customer.updateMany({ where: { tenantId, areaId: area.id }, data: { frequencyWeeks: data.frequencyWeeks } });
  }
  revalidatePath("/days");
  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/");
}

/** The hidden area inactive customers are kept in when their old area is deleted. */
async function getOrCreateInactiveArea(tenantId: number) {
  const existing = await prisma.area.findFirst({ where: { tenantId, isSystemArea: true, name: INACTIVE_AREA_NAME } });
  if (existing) return existing;
  return prisma.area.create({
    data: { tenantId, name: INACTIVE_AREA_NAME, color: "#94A3B8", isSystemArea: true, sortOrder: 9997, frequencyWeeks: 9999 },
  });
}

/**
 * Delete an area. Active customers must be moved first. Inactive ones are moved to the
 * hidden "Inactive customers" area, keeping their details, history and balance.
 */
export async function deleteArea(id: number) {
  const actor = await requirePerm("areas");
  const tenantId = actor.tenantId;
  const area = await requireTenantArea(tenantId, id);
  if (area.isSystemArea) throw new Error("That area can't be deleted.");
  const activeCount = await prisma.customer.count({ where: { tenantId, areaId: area.id, active: true } });
  if (activeCount > 0) {
    throw new Error(
      `${area.name} still has ${activeCount} active customer${activeCount === 1 ? "" : "s"}. Move them to another area (or switch them off) first.`
    );
  }
  const inactive = await prisma.customer.findMany({ where: { tenantId, areaId: area.id }, select: { id: true } });
  if (inactive.length) {
    const ids = inactive.map((c) => c.id);
    const keep = await getOrCreateInactiveArea(tenantId);
    // Anything still waiting on an unfinished day for them goes; done work stays as history.
    await prisma.job.deleteMany({
      where: { tenantId, customerId: { in: ids }, status: "PENDING", workDay: { status: { not: "COMPLETE" } }, allocations: { none: {} } },
    });
    await prisma.customer.updateMany({ where: { tenantId, id: { in: ids } }, data: { areaId: keep.id, nextDueDate: null } });
  }
  await prisma.area.delete({ where: { id: area.id } });
  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/scheduler");
  revalidatePath("/days");
  revalidatePath("/");
}

export async function getAreas() {
  const actor = await requireMember();
  const tenantId = actor.tenantId;
  return prisma.area.findMany({ where: { tenantId, isSystemArea: false }, orderBy: { sortOrder: "asc" } });
}

export async function getAreaSchedules() {
  const actor = await requireMember();
  const tenantId = actor.tenantId;
  if (actor.isWorker && !hasPermission(actor, "scheduler") && !hasPermission(actor, "areas")) {
    return [];
  }
  const areas = await prisma.area.findMany({ where: { tenantId, isSystemArea: false },
    include: {
      _count: { select: { customers: true } },
      customers: {
        where: { active: true },
        select: {
          id: true,
          name: true,
          address: true,
          price: true,
          sortOrder: true,
          jobs: {
            where: { status: "COMPLETE" },
            select: {
              id: true,
              price: true,
              allocations: {
                where: { payment: { voidedAt: null } },
                select: { amount: true },
              },
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
    },
    orderBy: { sortOrder: "asc" },
  });
  return areas.map((a) => ({
    ...a,
    estimatedValue: a.customers.reduce((sum, customer) => sum + customer.price, 0),
    outstandingDebt: Number(
      a.customers.reduce((sum, customer) =>
        sum + customer.jobs.reduce((jobSum, j) => {
          const paid = j.allocations.reduce((s, al) => s + al.amount, 0);
          return jobSum + Math.max(0, j.price - paid);
        }, 0)
      , 0).toFixed(2)
    ),
  }));
}

/** Find or create the hidden system area used for one-off (no-schedule) customers. */
async function getOrCreateOneOffSystemArea(tenantId: number) {
  // The one-off bucket is the system area that is NOT one of the temporary "Overdue – …" groups.
  const existing = await prisma.area.findFirst({
    where: { tenantId, isSystemArea: true, NOT: [{ name: { startsWith: "Overdue – " } }, { name: INACTIVE_AREA_NAME }] },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.area.create({ data: { tenantId,
      name: "One-Off Jobs",
      color: "#9CA3AF",
      isSystemArea: true,
      sortOrder: 9999,
      frequencyWeeks: 9999,
    },
  });
}

/** The one-off customers' hidden area (made if missing). Owner only: used by imports. */
export async function oneOffAreaIdForImport() {
  const actor = await requireOwner();
  return (await getOrCreateOneOffSystemArea(actor.tenantId)).id;
}

/** How many active one-off customers there are (for the quick link on Customers). */
export async function countOneOffCustomers() {
  const actor = await requirePerm("customers");
  return prisma.customer.count({
    where: { tenantId: actor.tenantId, active: true, area: { isSystemArea: true, NOT: [{ name: { startsWith: "Overdue – " } }, { name: INACTIVE_AREA_NAME }] } },
  });
}

/**
 * Find or create a hidden "Overdue – [source area]" grouping area. Used when overdue/unfinished
 * jobs are moved off a completed day onto a fresh day as a temporary one-off batch. Marked as a
 * system area so it never appears as a schedulable round, but its work days still show in the
 * day list and day detail view.
 */
async function getOrCreateOverdueArea(tenantId: number, sourceAreaName: string) {
  const trimmed = (sourceAreaName || "Area").trim() || "Area";
  const name = `Overdue – ${trimmed}`.slice(0, 80);
  const existing = await prisma.area.findFirst({ where: { tenantId, name } });
  if (existing) return existing;
  return prisma.area.create({
    data: {
      tenantId,
      name,
      color: "#F59E0B",
      isSystemArea: true,
      sortOrder: 9998,
      frequencyWeeks: 9999,
    },
  });
}

/**
 * Move several overdue/unfinished jobs together onto another day.
 * - target.kind "existing": add them to an existing future work day (alongside that day's area).
 * - target.kind "new": create a temporary "Overdue – [source area]" grouping on the given date.
 *
 * Each customer's recurring area schedule is left untouched — the next cycle is still created
 * normally when the original day is completed, so this only relocates the current cycle's leftover.
 */
export async function moveOverdueJobsToDay(
  jobIds: number[],
  target:
    | { kind: "existing"; workDayId: number }
    | { kind: "new"; dateISO: string; sourceAreaName: string }
): Promise<{ targetWorkDayId: number } | null> {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  if (!Array.isArray(jobIds) || jobIds.length === 0) return null;

  const jobs = await prisma.job.findMany({
    where: { tenantId, id: { in: jobIds }, ...visibleJobWhere(actor) },
    select: { id: true, workDayId: true, assignedUserId: true, workDay: { select: { assignedUserId: true } } },
  });
  if (jobs.length === 0) return null;
  const validIds = jobs.map((j) => j.id);
  const sourceDayIds = Array.from(new Set(jobs.map((j) => j.workDayId)));

  let targetWorkDayId: number;
  if (target.kind === "existing") {
    await requireTenantWorkDay(tenantId, target.workDayId);
    targetWorkDayId = target.workDayId;
  } else {
    const date = isoToUTC(target.dateISO);
    const overdueArea = await getOrCreateOverdueArea(tenantId, target.sourceAreaName);
    // A worker moving their own leftovers keeps them: the new day is theirs.
    const dayWorkers = new Set(jobs.map((job) => job.assignedUserId ?? job.workDay.assignedUserId ?? null));
    const sharedWorker = dayWorkers.size === 1 ? [...dayWorkers][0] : null;
    const newDayWorker = actor.isWorker ? actor.userId : sharedWorker;
    const workDay = await prisma.workDay.upsert({
      where: { tenantId_date_areaId: { tenantId, date, areaId: overdueArea.id } },
      update: {},
      create: { tenantId, date, areaId: overdueArea.id, status: "PLANNED", assignedUserId: newDayWorker ?? undefined },
    });
    targetWorkDayId = workDay.id;
  }

  // Don't move a job onto the day it's already on.
  const idsToMove = validIds.filter((id) => {
    const job = jobs.find((j) => j.id === id);
    return job && job.workDayId !== targetWorkDayId;
  });
  // Each moved job keeps the worker it had (its own assignment, else its old day's).
  for (const id of idsToMove) {
    const job = jobs.find((j) => j.id === id)!;
    await prisma.job.update({
      where: { id },
      data: {
        workDayId: targetWorkDayId,
        status: "PENDING",
        sortOrder: await endOfDay(targetWorkDayId),
        afterJobId: null,
        assignedUserId: job.assignedUserId ?? job.workDay.assignedUserId ?? null,
      },
    });
  }

  for (const dayId of sourceDayIds) revalidatePath(`/days/${dayId}`);
  revalidatePath(`/days/${targetWorkDayId}`);
  revalidatePath("/days");
  revalidatePath("/scheduler");
  return { targetWorkDayId };
}


export async function reorderAreaCustomers(areaId: number, orderedIds: number[]) {
  const actor = await requirePerm("areas");
  const tenantId = actor.tenantId;
  const area = await requireTenantArea(tenantId, areaId);
  const customers = await prisma.customer.findMany({
    where: { tenantId, areaId: area.id, id: { in: orderedIds } },
    select: { id: true },
  });
  if (customers.length !== orderedIds.length) {
    throw new Error("One or more customers do not belong to this area.");
  }

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.customer.update({ where: { id }, data: { sortOrder: index } })
    )
  );
  revalidatePath("/areas");
  revalidatePath("/customers");
  revalidatePath("/scheduler");
  revalidatePath("/days");
}

/** Parse a YYYY-MM-DD string as UTC midnight — unambiguous, timezone-proof. */
function isoToUTC(dateISO: string): Date {
  const d = new Date(dateISO + "T00:00:00.000Z");
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${dateISO}`);
  return d;
}

async function getConflictingOpenAreaDay(
  tenantId: number,
  areaId: number,
  excludeWorkDayId?: number
) {
  return prisma.workDay.findFirst({
    where: {
      tenantId,
      areaId,
      status: { in: ["PLANNED", "IN_PROGRESS"] },
      ...(excludeWorkDayId ? { id: { not: excludeWorkDayId } } : {}),
    },
    select: { id: true, date: true, status: true },
    orderBy: { date: "asc" },
  });
}

async function findOpenAreaDayConflict(
  tenantId: number,
  areaId: number,
  targetDate: Date,
  excludeWorkDayId?: number
): Promise<{ workDayId: number; message: string } | null> {
  const conflictingDay = await getConflictingOpenAreaDay(tenantId, areaId, excludeWorkDayId);
  if (!conflictingDay) return null;

  if (conflictingDay.date.getTime() === targetDate.getTime()) {
    return null;
  }

  const conflictDate = conflictingDay.date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const statusLabel = conflictingDay.status === "IN_PROGRESS" ? "an in-progress" : "a planned";
  return {
    workDayId: conflictingDay.id,
    message: `This area already has ${statusLabel} day on ${conflictDate}. Open that day, or complete or remove it, before scheduling another run.`,
  };
}

async function assertNoConflictingOpenAreaDay(
  tenantId: number,
  areaId: number,
  targetDate: Date,
  excludeWorkDayId?: number
) {
  const conflict = await findOpenAreaDayConflict(tenantId, areaId, targetDate, excludeWorkDayId);
  if (conflict) throw new Error(conflict.message);
}

/**
 * Check, without changing anything, whether scheduling this area on this
 * date would clash with a day that is still planned or in progress.
 *
 * The create actions still refuse the clash (and throw), but a thrown error's
 * message is hidden in production builds -- and uncaught, it replaces the
 * whole page with "Application error". Callers check first and show this
 * message instead.
 */
export async function checkAreaRunConflict(
  areaId: number,
  dateISO: string
): Promise<{ workDayId: number; message: string } | null> {
  const actor = await requirePerm("scheduler");
  await requireTenantArea(actor.tenantId, areaId);
  return findOpenAreaDayConflict(actor.tenantId, areaId, isoToUTC(dateISO));
}

/**
 * Create a single WorkDay for the dropped date, populate it with eligible
 * customers for the area, and mark the area's nextDueDate as this date.
 * (Completion auto-schedules the subsequent run.)
 */
export async function scheduleAreaRun(areaId: number, dateISO: string, assignedUserId?: string | null) {
  const actor = await requirePerm("scheduler");
  const tenantId = actor.tenantId;
  const d = isoToUTC(dateISO);
  const area = await requireTenantArea(tenantId, areaId);
  const workerId = await resolveAssignedWorkerId(tenantId, assignedUserId);

  await assertNoConflictingOpenAreaDay(tenantId, areaId, d);

  const windowDays = await runDueWindow(tenantId, area);
  const [, eligibleCustomers] = await Promise.all([
    area,
    // Customers due by this date or within the area's window after it. New customers
    // (no due date) are always included.
    prisma.customer.findMany({ where: { tenantId, areaId, active: true,
        OR: [{ nextDueDate: null }, { nextDueDate: { lte: addUtcDays(d, windowDays) } }],
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  // Create (or find existing) work day for the dropped date
  const workDay = await prisma.workDay.upsert({
    where: { tenantId_date_areaId: { tenantId, date: d, areaId } },
    update: workerId === undefined ? {} : { assignedUserId: workerId },
    create: { tenantId, date: d, areaId, assignedUserId: workerId ?? undefined },
  });

  // Populate with eligible customers (avoid duplicates)
  const existing = await prisma.job.findMany({ where: { tenantId, workDayId: workDay.id },
    select: { customerId: true },
  });
  const existingIds = new Set(existing.map((j) => j.customerId));
  const newJobs = eligibleCustomers.filter((c) => !existingIds.has(c.id));
  if (newJobs.length > 0) {
    await prisma.job.createMany({ data: newJobs.map((c) => ({ tenantId,
        workDayId: workDay.id,
        customerId: c.id,
        price: c.price,
        name: c.jobName || "Window Cleaning",
        sortOrder: c.sortOrder,
        // Auto-skip customers who were already serviced via another area's one-off run
        status: c.skipNextAreaRun ? ("SKIPPED" as const) : ("PENDING" as const),
        notes: c.skipNextAreaRun ? "Completed via another area run" : null,
      })),
    });
    // Clear the one-off skip flag now that it has been applied
    const toReset = newJobs.filter((c) => c.skipNextAreaRun).map((c) => c.id);
    if (toReset.length > 0) {
      await prisma.customer.updateMany({ where: { tenantId, id: { in: toReset } }, data: { skipNextAreaRun: false } });
    }
  }

  // Set nextDueDate to this scheduled date so the area shows as "scheduled"
  await prisma.area.update({ where: { id: area.id }, data: { nextDueDate: d } });

  revalidatePath("/days");
  revalidatePath("/scheduler");
  revalidatePath("/");
  return workDay;
}

/**
 * Create a one-off job for an existing customer on a specific date.
 * Finds or creates a WorkDay for that date (with no area if none exists).
 */
export async function createOneOffJob(data: {
  date: Date;
  customerId: number;
  name: string;
  price?: number;
  notes?: string;
}) {
  // Workers can add one-offs too (e.g. asked on the doorstep); theirs go on their own day.
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const d = utcDay(data.date);
  if (isNaN(d.getTime())) throw new Error("Invalid date — please select a valid date.");

  const customer = await requireTenantCustomer(tenantId, data.customerId);

  // Keep each one-off on its own standalone (area-less) work day so they always stay
  // separate in the scheduler instead of being grouped under the first job's name.
  // Guard against booking the same customer twice as a one-off on the same date.
  const existing = await prisma.job.findFirst({
    where: {
      tenantId,
      customerId: data.customerId,
      isOneOff: true,
      workDay: { date: d, areaId: null },
    },
    include: { workDay: true },
  });
  if (existing && existing.workDay) {
    revalidatePath(`/days/${existing.workDayId}`);
    return { workDay: existing.workDay, job: existing, alreadyExisted: true };
  }

  const workDay = await prisma.workDay.create({ data: { tenantId, date: d, ...(actor.isWorker ? { assignedUserId: actor.userId } : {}) } });

  const job = await prisma.job.create({ data: { tenantId,
      workDayId: workDay.id,
      customerId: data.customerId,
      name: data.name,
      price: data.price ?? customer.price,
      notes: data.notes ?? null,
      isOneOff: true,
    },
  });

  revalidatePath(`/days/${workDay.id}`);
  revalidatePath("/days");
  return { workDay, job, alreadyExisted: false };
}

// ─── Customers ─────────────────────────────────────────────────────────────

export async function getCustomers(areaIds?: number[], search?: string, includeInactive = false, tagIds?: number[], onlyOneOff = false) {
  const actor = await requireMember();
  if (!(["customers", "areas", "scheduler", "settings"] as const).some((perm) => hasPermission(actor, perm))) {
    throw new AccessDeniedError();
  }
  const tenantId = actor.tenantId;
  const customers = await prisma.customer.findMany({ where: { tenantId,
      ...(includeInactive ? {} : { active: true }),
      ...(onlyOneOff
        ? { area: { isSystemArea: true, NOT: { name: INACTIVE_AREA_NAME } } }
        : areaIds && areaIds.length > 0 ? { areaId: { in: areaIds } } : {}),
      ...(tagIds && tagIds.length > 0 ? { tags: { some: { tagId: { in: tagIds } } } } : {}),
    },
    include: {
      area: true,
      tags: { include: { tag: true } },
      jobs: {
        where: { status: "COMPLETE" },
        select: {
          price: true,
          allocations: {
            where: { payment: { voidedAt: null } },
            select: { amount: true },
          },
        },
      },
    },
    orderBy: [{ area: { sortOrder: "asc" } }, { name: "asc" }],
  });

  if (!search?.trim()) {
    return customers;
  }

  return customers.filter((customer) =>
    matchesLooseCustomerSearch(search, [customer.name, customer.address, customer.email, customer.phone])
  );
}

/** Minimal list of customers for pickers (e.g. "Paid by"). */
export async function getCustomerPickList() {
  const actor = await requirePerm("customers");
  return prisma.customer.findMany({
    where: { tenantId: actor.tenantId, active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function getCustomer(id: number) {
  const actor = await requirePerm("customers");
  const tenantId = actor.tenantId;
  return prisma.customer.findFirst({
    where: { id, tenantId },
    include: {
      area: true,
      tags: { include: { tag: true } },
      jobs: {
        include: {
          workDay: true,
          allocations: {
            where: { payment: { voidedAt: null } },
            select: { amount: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
      payments: {
        where: { voidedAt: null },
        include: { allocations: true },
        orderBy: { paidAt: "desc" },
        take: 50,
      },
    },
  });
}

export async function bulkImportCustomers(
  records: Array<{
    name: string;
    address: string;           // full line; may be "" when the sheet has separate columns
    houseNameNumber?: string;
    street?: string;
    town?: string;
    postcode?: string;
    price: number;
    areaId?: number;           // undefined when areaName is provided for creation
    areaName?: string;         // raw area name — used when createMissingAreas is true
    areaColor?: string;        // colour to apply when creating the new area
    areaFrequencyWeeks?: number; // frequency to set on the new area
    email?: string;
    phone?: string;
    notes?: string;
    jobName?: string;
    advanceNotice?: boolean;
    preferredPaymentMethod?: string;
    nextDueDate?: string;
    frequencyWeeks?: number;
    slip?: boolean;
    lastCompletedDate?: string;
    tags?: string[];
    active?: boolean;
  }>,
  options: {
    createMissingAreas?: boolean;
    /** Old flag: true = overwrite. Use existingMode instead. */
    updateExisting?: boolean;
    /**
     * A row that matches a customer already in Wyndos:
     * skip = leave them alone; fill = only fill details they're missing (never touches area,
     * price, dates or the schedule); overwrite = replace their details (area moves carry their
     * booked jobs across).
     */
    existingMode?: "skip" | "fill" | "overwrite";
    matchField?: "name" | "nameAddress";
    /** Book each area's next run on the schedule from the customers' dates. */
    bookRuns?: boolean;
  } = {}
): Promise<{
  created: number; updated: number; skipped: number; errors: Array<{ row: number; message: string }>; areasCreated: string[];
  runsBooked: Array<{ area: string; date: string }>;
}> {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;
  const errors: Array<{ row: number; message: string }> = [];
  const datedAreaIds = new Set<number>();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const areasCreated: string[] = [];
  // Cache newly-created area names → ids so we don't duplicate within one import
  const areaNameCache = new Map<string, number>();

  // Colour palette — assigned cyclically to every new area created during this import
  const AREA_COLOURS = [
    "#3B82F6", // blue
    "#10B981", // emerald
    "#F59E0B", // amber
    "#EF4444", // red
    "#8B5CF6", // violet
    "#EC4899", // pink
    "#14B8A6", // teal
    "#F97316", // orange
    "#06B6D4", // cyan
    "#84CC16", // lime
    "#A855F7", // purple
    "#6366F1", // indigo
  ];
  // Start offset from existing area count so re-imports get fresh colours
  const existingAreaCount = await prisma.area.count({ where: { tenantId } });
  let colourIndex = existingAreaCount % AREA_COLOURS.length;

  // Tags by name, created on first use (one lookup per name for the whole import).
  const tagIds = new Map<string, number>();
  const linkImportTags = async (customerId: number, names?: string[]) => {
    for (const raw of names ?? []) {
      const name = raw.trim().slice(0, 40);
      if (!name) continue;
      let tagId = tagIds.get(name.toLowerCase());
      if (!tagId) {
        const tag = await prisma.tag.upsert({
          where: { tenantId_name: { tenantId, name } },
          create: { tenantId, name },
          update: {},
        });
        tagId = tag.id;
        tagIds.set(name.toLowerCase(), tagId);
      }
      await prisma.customerTag.upsert({
        where: { customerId_tagId: { customerId, tagId } },
        create: { customerId, tagId },
        update: {},
      });
    }
  };

  // Towns seen anywhere in the sheet help split "eden house cuckney" into name + town.
  const knownTowns = collectKnownTowns(records.map((r) => r.address ?? ""));
  const importAddress = (r: (typeof records)[number]) => {
    const hasParts = [r.houseNameNumber, r.street, r.town, r.postcode].some((v) => v && v.trim());
    if (hasParts) {
      const parts: AddressParts = {
        houseNameNumber: r.houseNameNumber?.trim() ?? "",
        street: r.street?.trim() ?? "",
        town: r.town?.trim() ?? "",
        postcode: normalisePostcode(r.postcode ?? ""),
      };
      return { ...parts, address: composeAddress(parts) || r.address.trim() };
    }
    return { ...splitAddress(r.address, knownTowns), address: r.address.trim() };
  };

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    try {
      // ── Resolve areaId ──────────────────────────────────────────────────────
      let resolvedAreaId = r.areaId;
      if (!resolvedAreaId && r.areaName && options.createMissingAreas) {
        const trimmed = r.areaName.trim();
        const cacheHit = areaNameCache.get(trimmed.toLowerCase());
        if (cacheHit) {
          resolvedAreaId = cacheHit;
        } else {
          // upsert so re-running the import is idempotent
          const colour = r.areaColor ?? AREA_COLOURS[colourIndex % AREA_COLOURS.length];
          const area = await prisma.area.upsert({
            where: { tenantId_name: { tenantId, name: trimmed } },
            create: { tenantId, name: trimmed, color: colour, frequencyWeeks: r.areaFrequencyWeeks ?? 4 },
            update: {},
          });
          if (!areaNameCache.has(trimmed.toLowerCase())) {
            areasCreated.push(trimmed);
            colourIndex++;
          }
          areaNameCache.set(trimmed.toLowerCase(), area.id);
          resolvedAreaId = area.id;
        }
      }
      if (!resolvedAreaId) throw new Error(`Area not resolved for row ${i + 1}`);

      const area = await prisma.area.findFirst({ where: { id: resolvedAreaId, tenantId } });
      if (!area) throw new Error(`Area ID ${resolvedAreaId} not found`);

      const addressFields = importAddress(r);
      if (!addressFields.address) throw new Error("No address");
      const customerData = {
        ...addressFields,
        email: r.email?.trim() ?? "",
        phone: r.phone?.trim() ?? "",
        areaId: resolvedAreaId,
        price: r.price,
        // "Usually pays" is a fixed list. Anything else ("under the mat", "neighbour") is kept as a note.
        notes: [r.notes?.trim(), r.preferredPaymentMethod?.trim() && !normalisePreference(r.preferredPaymentMethod) ? `Usually pays: ${r.preferredPaymentMethod.trim()}` : ""].filter(Boolean).join("\n") || null,
        jobName: r.jobName?.trim() || "Window Cleaning",
        advanceNotice: r.advanceNotice ?? false,
        preferredPaymentMethod: normalisePreference(r.preferredPaymentMethod),
        frequencyWeeks: area.frequencyWeeks, // frequency belongs to the area
        // Next due from the sheet, else one cycle after they were last cleaned.
        nextDueDate: r.nextDueDate
          ? new Date(r.nextDueDate + "T00:00:00.000Z")
          : r.lastCompletedDate
            ? nextRunAfter(area, new Date(r.lastCompletedDate + "T00:00:00.000Z"))
            : null,
        // The order of rows in the sheet is the walking order of the round.
        sortOrder: i,
        ...(r.slip !== undefined ? { slip: r.slip } : {}),
        ...(r.active !== undefined ? { active: r.active } : {}),
        ...(r.lastCompletedDate ? { lastCompletedDate: new Date(r.lastCompletedDate + "T00:00:00.000Z") } : {}),
      };

      // ── Create, skip, fill in or overwrite ─────────────────────────────────
      const mode = options.existingMode ?? (options.updateExisting ? "overwrite" : "skip");
      const matchField = options.matchField ?? "name";
      const existing = await prisma.customer.findFirst({
        where: matchField === "nameAddress"
          ? { tenantId, name: r.name.trim(), address: addressFields.address }
          : { tenantId, name: r.name.trim() },
      });
      const datesGiven = Boolean(r.nextDueDate || r.lastCompletedDate);
      if (!existing) {
        const made = await prisma.customer.create({ data: { tenantId, name: r.name.trim(), ...customerData } });
        if (datesGiven) datedAreaIds.add(resolvedAreaId);
        await linkImportTags(made.id, r.tags);
        created++;
      } else if (mode === "skip") {
        skipped++;
      } else if (mode === "fill") {
        // Only what's missing. Area, price, frequency, dates, order and active are left
        // exactly as they are, so nothing on the schedule moves.
        const blank = (v: string | null | undefined) => !v || !v.trim();
        const fill: Record<string, unknown> = {};
        if (blank(existing.phone) && customerData.phone) fill.phone = customerData.phone;
        if (blank(existing.email) && customerData.email) fill.email = customerData.email;
        if (blank(existing.notes) && customerData.notes) fill.notes = customerData.notes;
        if (blank(existing.preferredPaymentMethod) && customerData.preferredPaymentMethod) fill.preferredPaymentMethod = customerData.preferredPaymentMethod;
        if (blank(existing.postcode) && addressFields.postcode) fill.postcode = addressFields.postcode;
        if (blank(existing.street) && addressFields.street) fill.street = addressFields.street;
        if (blank(existing.town) && addressFields.town) fill.town = addressFields.town;
        if (blank(existing.houseNameNumber) && addressFields.houseNameNumber) fill.houseNameNumber = addressFields.houseNameNumber;
        if (!existing.advanceNotice && r.advanceNotice) fill.advanceNotice = true;
        if (Object.keys(fill).length) await prisma.customer.update({ where: { id: existing.id }, data: fill });
        await linkImportTags(existing.id, r.tags);
        if (Object.keys(fill).length || (r.tags && r.tags.length)) updated++; else skipped++;
      } else {
        // Overwrite: blanks in the sheet never wipe a date, and moving area takes
        // their booked jobs with them.
        const data: Record<string, unknown> = { ...customerData };
        if (!r.nextDueDate && !r.lastCompletedDate) delete data.nextDueDate;
        if (!r.lastCompletedDate) delete data.lastCompletedDate;
        await prisma.customer.update({ where: { id: existing.id }, data });
        if (datesGiven) datedAreaIds.add(resolvedAreaId);
        if (existing.areaId !== resolvedAreaId) {
          await removeCustomerFromPreviousAreaScheduledDays(tenantId, existing.id, existing.areaId, resolvedAreaId);
          await autoAddToScheduledDays(tenantId, existing.id, resolvedAreaId);
        }
        await syncCustomerOpenJobs(tenantId, existing.id, {
          price: r.price !== existing.price ? r.price : undefined,
          jobName: undefined,
        });
        await linkImportTags(existing.id, r.tags);
        updated++;
      }
    } catch (e) {
      errors.push({ row: i + 1, message: String(e) });
    }
  }

  const runsBooked = options.bookRuns ? await bookImportedAreaRuns(tenantId, [...datedAreaIds]) : [];

  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/scheduler");
  return { created, updated, skipped, errors, areasCreated, runsBooked };
}

/** Book imported areas' next runs (used by the CleanerPlanner import). Owner only, own areas only. */
export async function bookAreaRunsAfterImport(areaIds: number[]) {
  const actor = await requireOwner();
  return bookImportedAreaRuns(actor.tenantId, (Array.isArray(areaIds) ? areaIds : []).filter((n) => Number.isInteger(n)).slice(0, 500));
}

/**
 * After an import with dates: each area's last clean and next run come from its customers.
 * The run goes on the earliest date anyone is due (today if that's already passed).
 * Areas that already have a run booked are left alone. No history is created.
 */
async function bookImportedAreaRuns(tenantId: number, areaIds: number[]) {
  const booked: Array<{ area: string; date: string }> = [];
  const today = utcDay(new Date());
  for (const areaId of areaIds) {
    const area = await prisma.area.findFirst({ where: { id: areaId, tenantId } });
    if (!area || area.isSystemArea) continue;
    const customers = await prisma.customer.findMany({
      where: { tenantId, areaId, active: true },
      select: { nextDueDate: true, lastCompletedDate: true },
    });
    const lastCleaned = customers.reduce<Date | null>((m, c) => (c.lastCompletedDate && (!m || c.lastCompletedDate > m) ? c.lastCompletedDate : m), null);
    const firstDue = customers.reduce<Date | null>((m, c) => (c.nextDueDate && (!m || c.nextDueDate < m) ? c.nextDueDate : m), null);
    if (lastCleaned && (!area.lastCompletedDate || lastCleaned > area.lastCompletedDate)) {
      await prisma.area.update({ where: { id: areaId }, data: { lastCompletedDate: lastCleaned } });
    }
    if (!firstDue) continue;
    const open = await prisma.workDay.findFirst({
      where: { tenantId, areaId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
      select: { id: true },
    });
    if (open) continue;
    const runDate = firstDue < today ? today : utcDay(firstDue);
    const iso = runDate.toISOString().slice(0, 10);
    try {
      await scheduleAreaRun(areaId, iso);
      booked.push({ area: area.name, date: iso });
    } catch (e) {
      console.error("[bookImportedAreaRuns]", area.name, e);
    }
  }
  return booked;
}

export async function deleteAllCustomers(): Promise<{ deleted: number }> {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;
  const customers = await prisma.customer.findMany({
    select: { id: true },
    where: { tenantId, area: { isSystemArea: false } },
  });
  const ids = customers.map((c) => c.id);
  if (ids.length > 0) {
    await prisma.payment.deleteMany({ where: { tenantId, customerId: { in: ids } } });
    await prisma.job.deleteMany({ where: { tenantId, customerId: { in: ids } } });
    await prisma.customerTag.deleteMany({ where: { customer: { tenantId, id: { in: ids } } } });
    await prisma.customer.deleteMany({ where: { tenantId, id: { in: ids } } });
  }

  // Delete all non-system areas (they now have 0 customers) and their WorkDays
  const nonSystemAreas = await prisma.area.findMany({ where: { tenantId, isSystemArea: false },
    select: { id: true },
  });
  const areaIds = nonSystemAreas.map((a) => a.id);
  if (areaIds.length > 0) {
    const workDays = await prisma.workDay.findMany({ where: { tenantId, areaId: { in: areaIds } },
      select: { id: true },
    });
    const workDayIds = workDays.map((w) => w.id);
    if (workDayIds.length > 0) {
      await prisma.job.deleteMany({ where: { tenantId, workDayId: { in: workDayIds } } });
      await prisma.workDay.deleteMany({ where: { tenantId, id: { in: workDayIds } } });
    }
    await prisma.area.deleteMany({ where: { tenantId, id: { in: areaIds } } });
  }

  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/scheduler");
  revalidatePath("/days");
  return { deleted: ids.length };
}

export async function bulkImportJobHistory(
  records: Array<{
    customerName: string;
    address?: string;
    date: string;           // YYYY-MM-DD
    price?: number;
    paid?: number;
    paymentMethod?: string;
    notes?: string;
  }>,
  options: { matchField?: "name" | "nameAddress" } = {}
): Promise<{ created: number; errors: Array<{ row: number; message: string }> }> {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;
  const errors: Array<{ row: number; message: string }> = [];
  let created = 0;
  // Cache "areaId:dateStr" → workDayId so we don't create duplicate work days
  const workDayCache = new Map<string, number>();

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    try {
      const matchField = options.matchField ?? "name";
      const customer = await prisma.customer.findFirst({
        where: matchField === "nameAddress" && r.address?.trim()
          ? { tenantId, name: r.customerName.trim(), address: r.address.trim() }
          : { tenantId, name: r.customerName.trim() },
      });
      if (!customer) throw new Error(`Customer "${r.customerName}" not found`);

      const workDate = new Date(r.date + "T00:00:00.000Z");
      const cacheKey = `${customer.areaId}:${r.date}`;

      let workDayId = workDayCache.get(cacheKey);
      if (!workDayId) {
        const existing = await prisma.workDay.findFirst({ where: { tenantId, areaId: customer.areaId, date: workDate },
        });
        if (existing) {
          workDayId = existing.id;
        } else {
          const wd = await prisma.workDay.create({ data: { tenantId, date: workDate, areaId: customer.areaId, status: "COMPLETE" },
          });
          workDayId = wd.id;
        }
        workDayCache.set(cacheKey, workDayId);
      }

      const jobPrice = r.price ?? customer.price;
      const job = await prisma.job.create({ data: { tenantId,
          workDayId,
          customerId: customer.id,
          name: customer.jobName || "Window Cleaning",
          status: "COMPLETE",
          price: jobPrice,
          completedAt: workDate,
          notes: r.notes?.trim() || null,
        },
      });

      if (r.paid && r.paid > 0) {
        // "Bank transfer", "bacs", "card" etc. are understood. Anything else ("under mat",
        // "neighbour") is recorded as cash with the words kept on the payment.
        const raw = (r.paymentMethod ?? "").trim();
        const pref = normalisePreference(raw);
        const method: "CASH" | "BACS" | "CARD" = pref === "CARD" ? "CARD" : pref === "BACS" || pref === "DD" || pref === "INVOICE" ? "BACS" : "CASH";
        const paidNote = raw && !pref ? `Paid by: ${raw}` : null;
        // Paid more than the clean? The extra stays on the payment as credit.
        const onJob = Math.min(r.paid, jobPrice);
        await prisma.$transaction(async (tx) => {
          const payment = await tx.payment.create({
            data: { tenantId, customerId: customer.id, amount: r.paid!, method, paidAt: workDate, notes: paidNote },
          });
          if (onJob > 0) {
            await tx.paymentAllocation.create({
              data: { tenantId, paymentId: payment.id, jobId: job.id, amount: onJob },
            });
          }
        });
      }

      created++;
    } catch (e) {
      errors.push({ row: i + 1, message: String(e) });
    }
  }

  revalidatePath("/customers");
  revalidatePath("/days");
  return { created, errors };
}

/**
 * Internal: ensures the customer has a PENDING job on every PLANNED or
 * IN_PROGRESS work day for their area where they are eligible.
 * Safe to call multiple times — never creates duplicates.
 */
/**
 * Put a customer (new, reactivated or just moved area) on their area's next booked run.
 * Only that run, only once (main day or any split part counts), and only if they're due
 * by then (within the area's keep-together window); otherwise they join the run after.
 */
async function autoAddToScheduledDays(tenantId: number, customerId: number, areaId: number) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { active: true, price: true, jobName: true, skipNextAreaRun: true, nextDueDate: true, sortOrder: true },
  });
  if (!customer?.active) return;
  const area = await prisma.area.findFirst({
    where: { id: areaId, tenantId },
    select: { isSystemArea: true, frequencyWeeks: true, dueWindowDays: true },
  });
  if (!area || area.isSystemArea) return;

  const run = await prisma.workDay.findFirst({
    where: { tenantId, areaId, partOfId: null, status: { in: ["PLANNED", "IN_PROGRESS"] } },
    orderBy: { date: "asc" },
    select: { id: true, date: true },
  });
  if (!run) return;
  const parts = await prisma.workDay.findMany({ where: { tenantId, partOfId: run.id }, select: { id: true } });
  const onRun = await prisma.job.findFirst({
    where: { tenantId, customerId, workDayId: { in: [run.id, ...parts.map((p) => p.id)] } },
    select: { id: true },
  });
  if (onRun) return;
  if (customer.nextDueDate && customer.nextDueDate > addUtcDays(run.date, await runDueWindow(tenantId, area))) return;

  await prisma.job.create({
    data: {
      tenantId,
      workDayId: run.id,
      customerId,
      price: customer.price,
      sortOrder: customer.sortOrder,
      name: customer.jobName || "Window Cleaning",
      // Auto-skip if they were already serviced via another area's one-off run
      status: customer.skipNextAreaRun ? "SKIPPED" : "PENDING",
      notes: customer.skipNextAreaRun ? "Completed via another area run" : null,
    },
  });
  if (customer.skipNextAreaRun) {
    await prisma.customer.updateMany({ where: { tenantId, id: customerId }, data: { skipNextAreaRun: false } });
  }
  revalidatePath(`/days/${run.id}`);
  revalidatePath("/days");
}

async function removeCustomerFromPreviousAreaScheduledDays(
  tenantId: number,
  customerId: number,
  oldAreaId: number,
  newAreaId: number
) {
  if (oldAreaId === newAreaId) return;

  const staleJobs = await prisma.job.findMany({
    where: {
      tenantId,
      customerId,
      workDay: {
        areaId: oldAreaId,
        status: { in: ["PLANNED", "IN_PROGRESS"] },
      },
    },
    select: { id: true, workDayId: true },
  });

  if (staleJobs.length === 0) return;

  const staleJobIds = staleJobs.map((job) => job.id);
  const affectedDayIds = [...new Set(staleJobs.map((job) => job.workDayId))];

  await deleteUnpaidJobs(tenantId, staleJobIds);

  for (const dayId of affectedDayIds) {
    revalidatePath(`/days/${dayId}`);
  }
  revalidatePath("/days");
}

async function syncCustomerOpenJobs(
  tenantId: number,
  customerId: number,
  updates: {
    price?: number;
    jobName?: string;
  }
) {
  const jobData: { price?: number; name?: string } = {};

  if (updates.price !== undefined) {
    jobData.price = updates.price;
  }
  if (updates.jobName !== undefined) {
    jobData.name = updates.jobName;
  }

  if (Object.keys(jobData).length === 0) return;

  const openJobs = await prisma.job.findMany({
    where: {
      tenantId,
      customerId,
      // Never overwrite one-off jobs — they have deliberately custom name/price
      // (e.g. the original one-off booking that must stay intact when converting
      // a one-off customer into a regular one).
      isOneOff: false,
      workDay: {
        status: { in: ["PLANNED", "IN_PROGRESS"] },
      },
    },
    select: { id: true, workDayId: true },
  });

  if (openJobs.length === 0) return;

  await prisma.job.updateMany({
    where: { tenantId, id: { in: openJobs.map((job) => job.id) } },
    data: jobData,
  });

  for (const dayId of new Set(openJobs.map((job) => job.workDayId))) {
    revalidatePath(`/days/${dayId}`);
  }
  revalidatePath("/days");
}

type AddressInput = {
  address?: string;
  houseNameNumber?: string;
  street?: string;
  town?: string;
  postcode?: string;
};

/**
 * Parts win: if any part is given, the display line is rebuilt from them.
 * If only a free-text line is given (old forms, API, import), split it into parts.
 */
function resolveAddress(data: AddressInput): { address: string } & AddressParts | null {
  const hasParts = [data.houseNameNumber, data.street, data.town, data.postcode].some((v) => v !== undefined);
  if (hasParts) {
    const parts: AddressParts = {
      houseNameNumber: (data.houseNameNumber ?? "").trim(),
      street: (data.street ?? "").trim(),
      town: (data.town ?? "").trim(),
      postcode: normalisePostcode(data.postcode ?? ""),
    };
    return { ...parts, address: composeAddress(parts) || (data.address ?? "").trim() };
  }
  if (data.address !== undefined) {
    return { ...splitAddress(data.address), address: data.address.trim() };
  }
  return null;
}

function addressForCreate(data: AddressInput) {
  const fields = resolveAddress(data);
  if (!fields?.address) throw new Error("Address is required");
  return fields;
}

/** Customers with their address split into parts, for the "Tidy addresses" screen. */
export async function getAddressReview() {
  const actor = await requirePerm("customers");
  const customers = await prisma.customer.findMany({
    where: { tenantId: actor.tenantId },
    select: {
      id: true, name: true, address: true, active: true, isProspect: true,
      houseNameNumber: true, street: true, town: true, postcode: true,
      area: { select: { name: true, sortOrder: true, isSystemArea: true } },
    },
    orderBy: [{ area: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
  });
  const knownTowns = collectKnownTowns(customers.map((c) => c.address));
  return customers.map((c) => {
    const saved = Boolean(c.houseNameNumber || c.street || c.town || c.postcode);
    let parts = addressPartsOf(c, knownTowns);
    // No town in the old line: the area is usually the village, so suggest it.
    if (!saved && !parts.town && c.area && !c.area.isSystemArea) parts = { ...parts, town: c.area.name };
    return {
      id: c.id,
      name: c.name,
      address: c.address,
      areaName: c.area?.name ?? "",
      active: c.active && !c.isProspect,
      saved,
      parts,
    };
  });
}

/** Save the address parts for many customers at once; the display line is rebuilt from them. */
export async function saveAddressParts(rows: Array<{ id: number } & AddressParts>) {
  const actor = await requirePerm("customers");
  const tenantId = actor.tenantId;
  const ids = rows.map((r) => r.id);
  const owned = await prisma.customer.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } });
  const allowed = new Set(owned.map((c) => c.id));
  let saved = 0;
  for (const row of rows) {
    if (!allowed.has(row.id)) continue;
    const fields = resolveAddress(row);
    if (!fields?.address) continue; // never blank an address
    await prisma.customer.update({ where: { id: row.id }, data: fields });
    saved++;
  }
  revalidatePath("/customers");
  revalidatePath("/days");
  return { saved };
}

export async function createCustomer(data: AddressInput & {
  name: string;
  email?: string;
  phone?: string;
  areaId: number;
  frequencyWeeks?: number;
  price: number;
  notes?: string;
  jobName?: string;
  advanceNotice?: boolean;
  preferredPaymentMethod?: string;
  goCardlessCustomerReference?: string;
  goCardlessCustomerId?: string;
  goCardlessMandateId?: string;
  nextDueDate?: Date;
  slip?: boolean;
}) {
  const actor = await requirePerm("customers");
  const tenantId = actor.tenantId;
  // Frequency defaults to the area's, but each customer can have their own (e.g. 8-weekly in a 4-weekly area).
  const area = await requireTenantArea(tenantId, data.areaId);
  const lastInArea = await prisma.customer.findFirst({
    where: { tenantId, areaId: data.areaId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const customer = await prisma.customer.create({ data: { tenantId,
      name: data.name,
      ...addressForCreate(data),
      email: data.email ?? "",
      phone: data.phone ?? "",
      areaId: data.areaId,
      price: data.price,
      notes: data.notes ?? null,
      jobName: data.jobName ?? "Window Cleaning",
      advanceNotice: data.advanceNotice ?? false,
      preferredPaymentMethod: data.preferredPaymentMethod ?? "",
      goCardlessCustomerReference: data.goCardlessCustomerReference?.trim() ?? "",
      goCardlessCustomerId: data.goCardlessCustomerId?.trim() || null,
      goCardlessMandateId: data.goCardlessMandateId?.trim() || null,
      frequencyWeeks: area?.frequencyWeeks ?? 4, // frequency belongs to the area
      nextDueDate: data.nextDueDate ?? null,   // null = never cleaned; picked up on first area run
      slip: data.slip ?? true,
      sortOrder: (lastInArea?.sortOrder ?? -1) + 1, // new customers go to the end of the round
    },
  });
  revalidatePath("/customers");
  revalidatePath("/areas");
  await autoAddToScheduledDays(tenantId, customer.id, customer.areaId!);
  return customer;
}

export async function updateCustomer(
  id: number,
  data: AddressInput & {
    name?: string;
    email?: string;
    phone?: string;
    areaId?: number;
    frequencyWeeks?: number;
    price?: number;
    notes?: string;
    nextDueDate?: Date | null;
    active?: boolean;
    jobName?: string;
    advanceNotice?: boolean;
    preferredPaymentMethod?: string;
    goCardlessCustomerReference?: string;
    goCardlessCustomerId?: string;
    goCardlessMandateId?: string;
    slip?: boolean;
    }
) {
  const actor = await requirePerm("customers");
  const tenantId = actor.tenantId;
  const current = await prisma.customer.findFirst({
    where: { id, tenantId },
    select: { areaId: true, price: true, jobName: true, active: true },
  });
  if (!current) throw new Error("Customer not found");

  const resolvedAreaId = data.areaId ?? current.areaId;
  const areaChanged = current.areaId !== resolvedAreaId;
  const area = await requireTenantArea(tenantId, resolvedAreaId);
  // Switching someone back on who's in the hidden "Inactive customers" area: they need a real area.
  if (data.active === true && !current.active && area.isSystemArea && area.name === INACTIVE_AREA_NAME) {
    throw new Error("Pick an area for them first: open the customer and use Change Area, then switch them on.");
  }

  const { address: _a, houseNameNumber: _h, street: _s, town: _t, postcode: _p, ...rest } = data;
  const addressFields = resolveAddress(data);
  const updateData = {
    // Only these fields, as plain values (see safe-input.ts).
    ...pickPlain(rest, ["name", "email", "phone", "price", "notes", "nextDueDate", "active", "jobName", "advanceNotice", "preferredPaymentMethod", "slip"] as const),
    ...(addressFields ?? {}),
    ...(data.goCardlessCustomerReference !== undefined && {
      goCardlessCustomerReference: data.goCardlessCustomerReference.trim(),
    }),
    ...(data.goCardlessCustomerId !== undefined && {
      goCardlessCustomerId: data.goCardlessCustomerId.trim() || null,
    }),
    ...(data.goCardlessMandateId !== undefined && {
      goCardlessMandateId: data.goCardlessMandateId.trim() || null,
    }),
    areaId: resolvedAreaId,
    // Frequency belongs to the area.
    frequencyWeeks: area?.frequencyWeeks ?? 4,
  };

  await prisma.customer.update({ where: { id }, data: updateData });
  if (areaChanged) {
    await removeCustomerFromPreviousAreaScheduledDays(tenantId, id, current.areaId, resolvedAreaId);
  }
  await syncCustomerOpenJobs(tenantId, id, {
    price: data.price !== undefined && data.price !== current.price ? updateData.price : undefined,
    jobName: data.jobName !== undefined && data.jobName !== current.jobName
      ? (updateData.jobName as string | undefined) ?? "Window Cleaning"
      : undefined,
  });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  revalidatePath("/areas");
  revalidatePath("/scheduler");
  // Only a move to another area (or switching back on) puts them on a booked run; a normal
  // edit never re-adds someone who was taken off a day.
  if (areaChanged || (data.active === true && !current.active)) {
    await autoAddToScheduledDays(tenantId, id, resolvedAreaId);
  }
}

export async function bulkUpdateCustomers(
  updates: Array<{
    id: number;
    name?: string;
    address?: string;
    areaId?: number;
    price?: number;
    frequencyWeeks?: number;
    notes?: string;
    active?: boolean;
    houseNameNumber?: string;
    street?: string;
    town?: string;
    postcode?: string;
    phone?: string;
    email?: string;
    preferredPaymentMethod?: string;
    slip?: boolean;
    advanceNotice?: boolean;
  }>
) {
  const actor = await requirePerm("customers");
  const tenantId = actor.tenantId;
  const previousCustomers = await prisma.customer.findMany({
    where: { tenantId, id: { in: updates.map((update) => update.id) } },
    select: { id: true, areaId: true },
  });
  const previousAreaByCustomerId = new Map(previousCustomers.map((customer) => [customer.id, customer.areaId]));

  await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      const current = await tx.customer.findFirst({
        where: { id: update.id, tenantId },
        select: { areaId: true },
      });
      if (!current) continue;

      const resolvedAreaId = update.areaId ?? current.areaId;
      const area = await tx.area.findFirst({
        where: { id: resolvedAreaId, tenantId },
        select: { frequencyWeeks: true },
      });
      if (!area) continue;

      const { id, frequencyWeeks: _f, address: _a, houseNameNumber: _h, street: _s, town: _t, postcode: _p, ...rest } = update;
      // Address parts rebuild the display line; each customer keeps their own frequency.
      const addressFields = resolveAddress(update);
      await tx.customer.update({
        where: { id },
        data: {
          ...pickPlain(rest, ["name", "price", "notes", "active", "phone", "email", "preferredPaymentMethod", "slip", "advanceNotice"] as const),
          ...(addressFields?.address ? addressFields : {}),
          areaId: resolvedAreaId,
          frequencyWeeks: area?.frequencyWeeks ?? 4, // frequency belongs to the area
        },
      });
    }
  });
  for (const update of updates) {
    if (update.areaId === undefined) continue;

    const previousAreaId = previousAreaByCustomerId.get(update.id);
    if (previousAreaId === undefined || previousAreaId === update.areaId) continue;

    await removeCustomerFromPreviousAreaScheduledDays(tenantId, update.id, previousAreaId, update.areaId);
    await autoAddToScheduledDays(tenantId, update.id, update.areaId);
  }
  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/scheduler");
  revalidatePath("/");
}

export async function rescheduleCustomer(id: number, newDate: Date) {
  const actor = await requirePerm("customers");
  const tenantId = actor.tenantId;
  await requireTenantCustomer(tenantId, id);
  await prisma.customer.update({
    where: { id },
    data: { nextDueDate: newDate },
  });
  revalidatePath(`/customers/${id}`);
  revalidatePath("/");
}

// ─── Work Days ──────────────────────────────────────────────────────────────

export async function getWorkDays() {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const where = await getVisibleWorkDayWhere(tenantId);
  return prisma.workDay.findMany({
    where,
    include: {
      area: true,
      assignedUser: { select: { id: true, name: true, email: true } },
      jobs: {
        where: visibleJobWhere(actor),
        include: {
          assignedUser: { select: { id: true, name: true, email: true } },
          completedBy: { select: { id: true, name: true, email: true } },
          customer: {
            include: {
              area: true,
              jobs: {
                where: { status: "COMPLETE" },
                select: {
                  id: true,
                  name: true,
                  price: true,
                  isOneOff: true,
                  workDay: { select: { date: true } },
                  allocations: {
                    where: { payment: { voidedAt: null } },
                    select: { amount: true },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { customer: { name: "asc" } }],
      },
    },
    orderBy: { date: "desc" },
  });
}

function workDayInclude(actor: Actor) {
  return {
      area: true,
      assignedUser: { select: { id: true, name: true, email: true } },
      jobs: {
        where: visibleJobWhere(actor),
        include: {
          assignedUser: { select: { id: true, name: true, email: true } },
          completedBy: { select: { id: true, name: true, email: true } },
          allocations: {
            where: { payment: { voidedAt: null } },
            select: {
              amount: true,
              payment: { select: { paidAt: true } },
            },
          },
          customer: {
            include: {
              area: true,
              // To work out credit (paid in advance / paid extra): payment minus what's on cleans.
              payments: {
                where: { voidedAt: null },
                select: { amount: true, allocations: { select: { amount: true } } },
              },
              // COMPLETE jobs only — used to compute per-job outstanding balance
              jobs: {
                where: { status: "COMPLETE" },
                select: {
                  id: true,
                  name: true,
                  price: true,
                  isOneOff: true,
                  workDay: { select: { date: true } },
                  allocations: {
                    where: { payment: { voidedAt: null } },
                    select: { amount: true },
                  },
                },
                orderBy: [{ workDay: { date: "asc" } }, { createdAt: "asc" }],
              },
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { customer: { name: "asc" } }],
      },
    } satisfies Prisma.WorkDayInclude;
}

export async function getWorkDay(id: number) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const where = await getVisibleWorkDayWhere(tenantId);
  return prisma.workDay.findFirst({
    where: { id, ...where },
    include: workDayInclude(actor),
  });
}

/**
 * Every area day on one date the user can see, for the whole-day view.
 * Areas in the order they were created (then name); jobs in each area's route order.
 */
export async function getWorkDaysOnDate(dateISO: string) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const where = await getVisibleWorkDayWhere(tenantId);
  const days = await prisma.workDay.findMany({
    where: { ...where, date: isoToUTC(dateISO) },
    include: workDayInclude(actor),
    orderBy: [{ area: { sortOrder: "asc" } }, { id: "asc" }],
  });
  // A worker only sees area days that have at least one of their jobs. Areas in the order set for the date.
  return orderDays(actor.isWorker ? days.filter((day) => day.jobs.length > 0) : days);
}

export async function createWorkDay(date: Date, areaId?: number, assignedUserId?: string | null) {
  const actor = await requirePerm("scheduler");
  const tenantId = actor.tenantId;
  const d = utcDay(date);
  const workerId = await resolveAssignedWorkerId(tenantId, assignedUserId);
  let day;
  if (areaId) {
    await requireTenantArea(tenantId, areaId);
    await assertNoConflictingOpenAreaDay(tenantId, areaId, d);
    // For area-linked days: enforce one per (date, area) pair
    day = await prisma.workDay.upsert({
      where: { tenantId_date_areaId: { tenantId, date: d, areaId } },
      update: workerId === undefined ? {} : { assignedUserId: workerId },
      create: { tenantId, date: d, areaId, assignedUserId: workerId ?? undefined },
    });
  } else {
    // No area: just create a standalone day (one-off / manual)
    day = await prisma.workDay.create({ data: { tenantId, date: d, assignedUserId: workerId ?? undefined } });
  }
  revalidatePath("/days");
  return day;
}

export async function addJobToDay(workDayId: number, customerId: number) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const [customer, workDay] = await Promise.all([
    requireTenantCustomer(tenantId, customerId),
    requireTenantWorkDay(tenantId, workDayId),
  ]);
  const job = await prisma.job.create({ data: { tenantId, workDayId, customerId, price: customer.price, status: "PENDING", sortOrder: await endOfDay(workDayId) },
  });
  revalidatePath(`/days/${workDayId}`);
  return job;
}

/**
 * Put a customer on their area's day for a date (e.g. after taking them off a day).
 * Uses the area's day on that date if there is one; otherwise makes one, as a part of the
 * area's next open run so the area still books its next visit as one.
 */
export async function addCustomerToDate(customerId: number, dateISO: string) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const customer = await requireTenantCustomer(tenantId, customerId);
  const d = isoToUTC(dateISO);
  let day = await prisma.workDay.findFirst({ where: { tenantId, date: d, areaId: customer.areaId }, select: { id: true, status: true } });
  if (day?.status === "COMPLETE") throw new Error("That area is already completed on that date. Pick another date.");
  if (!day) {
    const openRun = await prisma.workDay.findFirst({
      where: { tenantId, areaId: customer.areaId, status: { not: "COMPLETE" }, partOfId: null },
      orderBy: { date: "asc" },
      select: { id: true },
    });
    day = await prisma.workDay.create({
      data: { tenantId, date: d, areaId: customer.areaId, partOfId: openRun?.id ?? null },
      select: { id: true, status: true },
    });
  }
  const already = await prisma.job.findFirst({ where: { tenantId, workDayId: day.id, customerId, isOneOff: false, status: { not: "COMPLETE" } }, select: { id: true } });
  if (!already) {
    await prisma.job.create({
      data: {
        tenantId,
        workDayId: day.id,
        customerId,
        price: customer.price,
        name: customer.jobName || "Window Cleaning",
        sortOrder: customer.sortOrder,
        status: "PENDING",
        assignedUserId: actor.isWorker ? actor.userId : null,
      },
    });
  }
  revalidatePath(`/customers/${customerId}`);
  revalidatePath(`/days/${day.id}`);
  revalidatePath("/scheduler");
  revalidatePath("/days");
  return { workDayId: day.id };
}

export async function addOneOffJobToDay(
  workDayId: number,
  customerId: number,
  opts: { name?: string; price?: number; notes?: string }
) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  // An extra one-off job (e.g. gutters) is added alongside the customer's regular cleans;
  // it never cancels their normal visit.
  const [customer] = await Promise.all([
    requireTenantCustomer(tenantId, customerId),
    requireTenantWorkDay(tenantId, workDayId),
  ]);
  await prisma.job.create({ data: { tenantId,
      workDayId,
      customerId,
      name: opts.name?.trim() || customer.jobName || "Window Cleaning",
      price: opts.price ?? customer.price,
      notes: opts.notes?.trim() || null,
      isOneOff: true,
      sortOrder: await endOfDay(workDayId),
      assignedUserId: actor.isWorker ? actor.userId : null,
    },
  });

  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/scheduler");
}

/**
 * Bring a customer from another area onto this day. If the customer already has a
 * pending visit booked elsewhere, that visit is MOVED here (one job, one owner) so
 * nothing is marked done until someone actually does it. Otherwise a new job is added.
 */
export async function addJobFromOtherArea(targetWorkDayId: number, customerId: number) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const [customer, targetWorkDay] = await Promise.all([
    requireTenantCustomer(tenantId, customerId),
    requireTenantWorkDay(tenantId, targetWorkDayId),
  ]);
  // Workers who don't plan the diary may only add to their own day, and only take jobs they can see.
  const limited = actor.isWorker && !hasPermission(actor, "scheduler");
  if (limited) await requireVisibleWorkDay(actor, targetWorkDayId);

  const existing = await prisma.job.findFirst({ where: { tenantId, workDayId: targetWorkDayId, customerId } });
  if (!existing) {
    const pendingElsewhere = await prisma.job.findFirst({
      where: {
        tenantId,
        ...(limited ? visibleJobWhere(actor) : {}),
        customerId,
        status: "PENDING",
        isOneOff: false,
        workDayId: { not: targetWorkDayId },
        workDay: { status: { not: "COMPLETE" } },
      },
      orderBy: { workDay: { date: "asc" } },
    });
    if (pendingElsewhere) {
      await prisma.job.update({
        where: { id: pendingElsewhere.id },
        data: { workDayId: targetWorkDay.id, assignedUserId: null, sortOrder: await endOfDay(targetWorkDay.id), afterJobId: null },
      });
      revalidatePath(`/days/${pendingElsewhere.workDayId}`);
    } else {
      await prisma.job.create({ data: {
        tenantId,
        workDayId: targetWorkDayId,
        customerId,
        price: customer.price,
        name: customer.jobName || "Window Cleaning",
        isOneOff: true,
        sortOrder: await endOfDay(targetWorkDayId),
      } });
    }
  }

  revalidatePath(`/days/${targetWorkDayId}`);
  revalidatePath("/days");
  revalidatePath("/scheduler");
}

// Create a brand-new customer and immediately add them to a specific work day.
export async function createCustomerAndAddToDay(
  data: {
    name: string;
    address: string;
    price: number;
    areaId: number;
    email?: string;
    phone?: string;
    notes?: string;
    jobName?: string;
  },
  workDayId: number
) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  await requireTenantWorkDay(tenantId, workDayId);
  const area = await requireTenantArea(tenantId, data.areaId);
  const customer = await prisma.customer.create({ data: { tenantId,
      name: data.name,
      ...addressForCreate(data),
      email: data.email ?? "",
      phone: data.phone ?? "",
      areaId: data.areaId,
      price: data.price,
      notes: data.notes ?? null,
      jobName: data.jobName ?? "Window Cleaning",
      frequencyWeeks: area?.frequencyWeeks ?? 4,
    },
  });
  await prisma.job.create({ data: { tenantId, workDayId, customerId: customer.id, price: customer.price, sortOrder: await endOfDay(workDayId) },
  });
  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/days");
  return customer;
}

/**
 * Create a brand-new one-off customer (no recurring schedule) and add them to a day.
 * They are placed in the hidden system area so they are still viewable in customer records.
 */
export async function createOneOffCustomerAndAddToDay(
  data: {
    name: string;
    address: string;
    price: number;
    email?: string;
    phone?: string;
    notes?: string;
    jobName?: string;
    areaId?: number;
    frequencyWeeks?: number;
  },
  workDayId: number
) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  await requireTenantWorkDay(tenantId, workDayId);
  let areaId: number;
  let freqWeeks: number;
  if (data.areaId) {
    const area = await requireTenantArea(tenantId, data.areaId);
    areaId = area.id;
    freqWeeks = area.frequencyWeeks;
  } else {
    const systemArea = await getOrCreateOneOffSystemArea(tenantId);
    areaId = systemArea.id;
    freqWeeks = 9999; // never scheduled
  }
  const customer = await prisma.customer.create({ data: { tenantId,
      name: data.name,
      ...addressForCreate(data),
      email: data.email ?? "",
      phone: data.phone ?? "",
      areaId,
      price: data.price,
      notes: data.notes ?? null,
      jobName: data.jobName ?? "Window Cleaning",
      frequencyWeeks: freqWeeks,
    },
  });
  await prisma.job.create({ data: { tenantId, workDayId, customerId: customer.id, price: customer.price, isOneOff: true, sortOrder: await endOfDay(workDayId) },
  });
  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/customers");
  revalidatePath("/days");
  return customer;
}

/** Like createOneOffCustomerAndAddToDay but takes a date instead of a workDayId.
 *  Finds or creates an area-less one-off WorkDay for that date. */
export async function createOneOffCustomerAndBookByDate(
  data: {
    name: string;
    address: string;
    price: number;
    email?: string;
    phone?: string;
    notes?: string;
    jobName?: string;
    areaId?: number;
    frequencyWeeks?: number;
  },
  date: Date
) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const d = utcDay(date);
  if (isNaN(d.getTime())) throw new Error("Invalid date — please select a valid date.");

  let areaId: number;
  let freqWeeks: number;
  // A worker's new customer is a one-off; the owner decides whether they join a round.
  if (data.areaId && !actor.isWorker) {
    const area = await requireTenantArea(tenantId, data.areaId);
    areaId = area.id;
    freqWeeks = area.frequencyWeeks;
  } else {
    const systemArea = await getOrCreateOneOffSystemArea(tenantId);
    areaId = systemArea.id;
    freqWeeks = 9999;
  }

  const customer = await prisma.customer.create({ data: { tenantId,
      name: data.name,
      ...addressForCreate(data),
      email: data.email ?? "",
      phone: data.phone ?? "",
      areaId,
      price: data.price,
      notes: data.notes ?? null,
      jobName: data.jobName ?? "Window Cleaning",
      frequencyWeeks: freqWeeks,
    },
  });

  // Each one-off books onto its own standalone (area-less) work day so they stay
  // separate in the scheduler rather than being grouped under the first job.
  const workDay = await prisma.workDay.create({ data: { tenantId, date: d, ...(actor.isWorker ? { assignedUserId: actor.userId } : {}) } });

  await prisma.job.create({ data: { tenantId, workDayId: workDay.id, customerId: customer.id, price: customer.price, isOneOff: true },
  });

  revalidatePath(`/days/${workDay.id}`);
  revalidatePath("/customers");
  revalidatePath("/days");
  return customer;
}

// ─── Quotes ─────────────────────────────────────────────────────────────────
//
// A quote visit is a job on a day, clearly marked as a quote, for a prospect
// customer (full customer details, but not live: never scheduled or repeated).
// The worker marks it "quoted" with a price; the owner then marks the customer
// live (they join their area's runs like any other customer) or lost.

export type QuoteStatus = "TO_VISIT" | "QUOTED" | "WON" | "LOST";

/** Book a quote visit for a new prospect on a date (optionally for a worker). */
export async function createQuoteVisit(
  data: {
    name: string;
    address: string;
    phone?: string;
    email?: string;
    notes?: string;
    areaId?: number;
    estimate?: number;
  },
  dateISO: string,
  assignedUserId?: string | null,
) {
  // Workers can book quote visits too (asked on the doorstep); they go on the worker's own day.
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const date = isoToUTC(dateISO);
  if (!data.name?.trim() || !data.address?.trim()) throw new Error("Name and address are required.");

  const area = data.areaId && !actor.isWorker ? await requireTenantArea(tenantId, data.areaId) : await getOrCreateOneOffSystemArea(tenantId);
  const workerId = actor.isWorker ? actor.userId : await resolveAssignedWorkerId(tenantId, assignedUserId);

  const customer = await prisma.customer.create({ data: {
    tenantId,
    name: data.name.trim(),
    ...addressForCreate(data),
    phone: data.phone?.trim() ?? "",
    email: data.email?.trim() ?? "",
    notes: data.notes?.trim() || null,
    areaId: area.id,
    price: data.estimate ?? 0,
    frequencyWeeks: area.isSystemArea ? 4 : area.frequencyWeeks,
    active: false,
    isProspect: true,
  } });

  // Each quote gets its own standalone day, like other one-offs.
  const workDay = await prisma.workDay.create({ data: { tenantId, date, assignedUserId: workerId ?? undefined } });
  await prisma.job.create({ data: {
    tenantId,
    workDayId: workDay.id,
    customerId: customer.id,
    name: "Quote",
    price: 0,
    isOneOff: true,
    isQuote: true,
    quoteStatus: "TO_VISIT",
    notes: data.estimate ? `Estimate £${data.estimate.toFixed(2)}` : null,
  } });

  revalidatePath("/days");
  revalidatePath("/scheduler");
  revalidatePath("/quotes");
  return { customerId: customer.id, workDayId: workDay.id };
}

/** Worker or owner: the quote visit happened and a price was given. */
export async function markQuoted(jobId: number, data: { price: number; frequencyWeeks?: number; notes?: string }) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId, isQuote: true, ...visibleJobWhere(actor) } });
  if (!job) throw new Error("Quote not found");
  const price = Number(data.price);
  if (!Number.isFinite(price) || price < 0) throw new Error("Enter the price you quoted.");
  const frequencyWeeks = data.frequencyWeeks && data.frequencyWeeks > 0 ? Math.round(data.frequencyWeeks) : null;

  const now = new Date();
  await prisma.job.update({ where: { id: job.id }, data: {
    status: "COMPLETE",
    completedAt: now,
    completedByUserId: actor.userId,
    quoteStatus: job.quoteStatus === "WON" ? "WON" : "QUOTED",
    quotedPrice: price,
    quotedFrequencyWeeks: frequencyWeeks,
    quotedAt: now,
    notes: data.notes?.trim() ? data.notes.trim() : job.notes,
  } });
  // Keep the prospect's details in step with the quote.
  await prisma.customer.update({ where: { id: job.customerId }, data: { price } });
  await prisma.workDay.updateMany({ where: { id: job.workDayId, tenantId, status: "PLANNED" }, data: { status: "IN_PROGRESS" } });

  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/quotes");
}

/**
 * Owner: the customer accepted. They become a normal live customer in an area,
 * with their own price and frequency, and join that area's runs from now on.
 */
export async function markQuoteWon(
  jobId: number,
  data: { areaId: number; price: number; frequencyWeeks: number; firstCleanISO?: string; preferredPaymentMethod?: string },
) {
  const actor = await requirePerm("customers");
  const tenantId = actor.tenantId;
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId, isQuote: true } });
  if (!job) throw new Error("Quote not found");
  const area = await requireTenantArea(tenantId, data.areaId);
  if (area.isSystemArea) throw new Error("Choose the area this customer will be cleaned in.");
  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Enter the regular price.");
  // Frequency comes from the area they join (a different frequency = a different area).
  const frequencyWeeks = area.frequencyWeeks || 4;

  const lastInArea = await prisma.customer.findFirst({
    where: { tenantId, areaId: area.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  await prisma.customer.update({ where: { id: job.customerId }, data: {
    active: true,
    isProspect: false,
    areaId: area.id,
    price,
    frequencyWeeks,
    nextDueDate: data.firstCleanISO ? isoToUTC(data.firstCleanISO) : null,
    sortOrder: (lastInArea?.sortOrder ?? -1) + 1,
    ...(data.preferredPaymentMethod !== undefined ? { preferredPaymentMethod: data.preferredPaymentMethod } : {}),
  } });

  const now = new Date();
  await prisma.job.update({ where: { id: job.id }, data: {
    quoteStatus: "WON",
    quotedPrice: job.quotedPrice ?? price,
    quotedFrequencyWeeks: job.quotedFrequencyWeeks ?? frequencyWeeks,
    quotedAt: job.quotedAt ?? now,
    ...(job.status === "PENDING" ? { status: "COMPLETE", completedAt: now, completedByUserId: actor.userId } : {}),
  } });

  // Join the area's upcoming runs like any other customer.
  await autoAddToScheduledDays(tenantId, job.customerId, area.id);

  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/quotes");
  revalidatePath("/customers");
  revalidatePath(`/customers/${job.customerId}`);
  revalidatePath("/scheduler");
}

/** Owner: the customer said no (or never replied). */
export async function markQuoteLost(jobId: number, reason?: string) {
  const actor = await requirePerm("customers");
  const tenantId = actor.tenantId;
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId, isQuote: true } });
  if (!job) throw new Error("Quote not found");
  await prisma.job.update({ where: { id: job.id }, data: {
    quoteStatus: "LOST",
    ...(job.status === "PENDING" ? { status: "SKIPPED" } : {}),
    ...(reason?.trim() ? { notes: [job.notes, `Lost: ${reason.trim()}`].filter(Boolean).join(" · ") } : {}),
  } });
  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/quotes");
}

/** Put a lost quote back into "quoted" (e.g. they came back). */
export async function reopenQuote(jobId: number) {
  const actor = await requirePerm("customers");
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId: actor.tenantId, isQuote: true, quoteStatus: "LOST" } });
  if (!job) throw new Error("Quote not found");
  await prisma.job.update({ where: { id: job.id }, data: { quoteStatus: job.quotedPrice != null ? "QUOTED" : "TO_VISIT" } });
  revalidatePath("/quotes");
}

/** All quote visits, newest first, for the Quotes screen. */
export async function getQuotes() {
  const actor = await requirePerm("customers");
  const jobs = await prisma.job.findMany({
    where: { tenantId: actor.tenantId, isQuote: true },
    include: {
      customer: { select: { id: true, name: true, address: true, phone: true, email: true, notes: true, areaId: true, price: true, frequencyWeeks: true, preferredPaymentMethod: true } },
      workDay: { select: { id: true, date: true, assignedUser: { select: { name: true, email: true } } } },
      assignedUser: { select: { name: true, email: true } },
      completedBy: { select: { name: true, email: true } },
    },
    orderBy: [{ workDay: { date: "desc" } }, { id: "desc" }],
    take: 500,
  });
  return jobs;
}

export async function removeJobFromDay(jobId: number) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const job = await requireTenantJob(tenantId, jobId);
  if (job.status === "COMPLETE") throw new Error("Cannot remove a completed job");
  const kept = await deleteUnpaidJobs(tenantId, [job.id]);
  if (kept.length) throw new Error("This job has already been paid for. Undo the payment first, or move the job to another day instead.");
  // Tidy up empty standalone (area-less) one-off days so they don't linger on the calendar.
  const remaining = await prisma.job.count({ where: { tenantId, workDayId: job.workDayId } });
  if (remaining === 0) {
    const wd = await prisma.workDay.findFirst({ where: { id: job.workDayId, tenantId } });
    if (wd && wd.areaId === null && wd.status !== "COMPLETE") {
      await prisma.workDay.delete({ where: { id: wd.id } });
    }
  }
  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/scheduler");
}

export async function startDay(workDayId: number) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const workDay = await requireTenantWorkDay(tenantId, workDayId);
  await prisma.workDay.update({
    where: { id: workDay.id },
    data: { status: "IN_PROGRESS" },
  });
  if (workDay.status === "PLANNED") {
    await queueNotification({ tenantId, kind: "DAY_STARTED", workDayId: workDay.id, actorUserId: actor.userId });
  }
  revalidatePath(`/days/${workDay.id}`);
}

/**
 * Delete all PLANNED work days from today onwards (and their jobs).
 * Used to wipe the future schedule so the user can rebuild via drag-and-drop.
 * Does NOT touch IN_PROGRESS or COMPLETE days (preserves history).
 */
export async function clearFutureSchedule() {
  const actor = await requirePerm("scheduler");
  const tenantId = actor.tenantId;
  const today = utcDay(new Date());

  const futureDays = await prisma.workDay.findMany({ where: { tenantId, date: { gte: today }, status: "PLANNED" },
    select: { id: true },
  });

  const ids = futureDays.map((d) => d.id);
  if (ids.length === 0) return 0;

  // Delete jobs first (no cascade defined in schema). Jobs already paid for stay, with their day.
  const jobs = await prisma.job.findMany({ where: { tenantId, workDayId: { in: ids } }, select: { id: true, workDayId: true } });
  const kept = new Set(await deleteUnpaidJobs(tenantId, jobs.map((j) => j.id)));
  const keepDays = new Set(jobs.filter((j) => kept.has(j.id)).map((j) => j.workDayId));
  await prisma.workDay.deleteMany({ where: { tenantId, id: { in: ids.filter((id) => !keepDays.has(id)) } } });

  revalidatePath("/scheduler");
  revalidatePath("/days");
  revalidatePath("/");
  return ids.length;
}

export async function deleteWorkDay(workDayId: number): Promise<{ removed: boolean; keptPaid: number; keptDone: number }> {
  const actor = await requirePerm("scheduler");
  const tenantId = actor.tenantId;
  const wd = await prisma.workDay.findFirst({
    where: { id: workDayId, tenantId },
    include: { jobs: { select: { id: true, status: true } } },
  });
  // Already gone (double click, or removed on another screen): nothing to do.
  if (!wd) return { removed: true, keptPaid: 0, keptDone: 0 };

  // Delete jobs not yet done. Completed jobs and jobs already paid for stay, so history and money are never lost.
  const notDone = wd.jobs.filter((j) => j.status !== "COMPLETE").map((j) => j.id);
  const keptPaid = await deleteUnpaidJobs(tenantId, notDone);
  const keptDone = wd.jobs.filter((j) => j.status === "COMPLETE").length;

  let removed = false;
  if (keptDone === 0 && keptPaid.length === 0) {
    await promoteRunParts(tenantId, wd.id);
    await prisma.workDay.delete({ where: { id: wd.id } });
    removed = true;
  }

  revalidatePath("/scheduler");
  revalidatePath("/days");
  return { removed, keptPaid: keptPaid.length, keptDone };
}

/**
 * Copy a customer from another area/day onto this work day (this time only).
 * Uses existing addJobToDay logic.
 */
export async function addCustomerToDay(workDayId: number, customerId: number) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  return addJobToDay(workDayId, customerId);
}

/**
 * Re-sync a work day with all currently eligible area customers.
 * Useful when a customer was added to an area AFTER the work day was already
 * created/populated by a previous run's completeDay snapshot.
 * Adds any missing customers (active, nextDueDate <= workDay.date or null).
 */
export async function syncWorkDayCustomers(workDayId: number): Promise<{ added: number }> {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  await requireTenantWorkDay(tenantId, workDayId);
  const workDay = await prisma.workDay.findFirst({
    where: { id: workDayId, tenantId },
    include: { area: true },
  });
  if (!workDay || !workDay.areaId || workDay.area?.isSystemArea) return { added: 0 };

  const eligibleCustomers = await prisma.customer.findMany({ where: { tenantId,
      areaId: workDay.areaId,
      active: true,
      OR: [{ nextDueDate: null }, { nextDueDate: { lte: addUtcDays(workDay.date, await runDueWindow(tenantId, workDay.area!)) } }],
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const existingJobs = await prisma.job.findMany({ where: { tenantId, workDayId },
    select: { customerId: true },
  });
  const existingIds = new Set(existingJobs.map((j) => j.customerId));
  const missing = eligibleCustomers.filter((c) => !existingIds.has(c.id));

  if (missing.length > 0) {
    await prisma.job.createMany({
      data: missing.map((c) => ({
        tenantId,
        workDayId,
        customerId: c.id,
        price: c.price,
        status: "PENDING" as const,
        name: c.jobName || "Window Cleaning",
        sortOrder: c.sortOrder,
      })),
    });
  }

  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/days");
  return { added: missing.length };
}

/**
 * Permanently move a customer to a new area (going forward) and also add
 * them to the given work day if not already present.
 */
export async function moveCustomerToArea(
  customerId: number,
  newAreaId: number,
  addToWorkDayId?: number
) {
  const actor = await requirePerm("customers");
  const tenantId = actor.tenantId;
  const [customer] = await Promise.all([
    requireTenantCustomer(tenantId, customerId),
    requireTenantArea(tenantId, newAreaId),
    addToWorkDayId ? requireTenantWorkDay(tenantId, addToWorkDayId) : Promise.resolve(null),
  ]);
  const oldAreaId = customer.areaId;
  // Clear skip flag — moving to a new area is a clean slate. They go to the end of its walking order.
  await prisma.customer.updateMany({
    where: { tenantId, id: customerId },
    data: { areaId: newAreaId, skipNextAreaRun: false, ...(oldAreaId !== newAreaId ? { sortOrder: await endOfArea(tenantId, newAreaId) } : {}) },
  });
  await removeCustomerFromPreviousAreaScheduledDays(tenantId, customerId, oldAreaId, newAreaId);
  revalidatePath("/customers");

  if (addToWorkDayId) {
    await addJobToDay(addToWorkDayId, customerId);
  }
  await autoAddToScheduledDays(tenantId, customerId, newAreaId);
  revalidatePath("/days");
}

/**
 * Move multiple customers to a new area in one shot.
 */
export async function bulkMoveCustomersToArea(customerIds: number[], newAreaId: number) {
  const actor = await requirePerm("customers");
  const tenantId = actor.tenantId;
  await requireTenantArea(tenantId, newAreaId);
  const customers = await prisma.customer.findMany({ where: { tenantId, id: { in: customerIds } }, select: { id: true, areaId: true } });
  if (customers.length !== customerIds.length) throw new Error("One or more customers were not found");
  // Clear skip flag — moving to a new area is a clean slate. Newcomers go to the end of its
  // walking order, in the order they had before.
  let next = await endOfArea(tenantId, newAreaId);
  const movers = await prisma.customer.findMany({
    where: { tenantId, id: { in: customerIds }, areaId: { not: newAreaId } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  for (const m of movers) await prisma.customer.update({ where: { id: m.id }, data: { sortOrder: next++ } });
  await prisma.customer.updateMany({
    where: { tenantId, id: { in: customerIds } },
    data: { areaId: newAreaId, skipNextAreaRun: false },
  });
  for (const customer of customers) {
    await removeCustomerFromPreviousAreaScheduledDays(tenantId, customer.id, customer.areaId, newAreaId);
    await autoAddToScheduledDays(tenantId, customer.id, newAreaId);
  }
  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/days");
}


// ─── Jobs ───────────────────────────────────────────────────────────────────

export async function completeJob(jobId: number) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const job = await prisma.job.findFirst({
    where: { id: jobId, tenantId, ...visibleJobWhere(actor) },
    include: { customer: true },
  });
  if (!job) throw new Error("Job not found");
  if (job.isQuote) throw new Error("This is a quote visit: use \"Mark quoted\" instead.");
  // Idempotent: an offline retry of the same tap does nothing the second time.
  if (job.status === "COMPLETE") return;

  const now = new Date();
  await prisma.job.update({
    where: { id: jobId },
    // A job that was re-opened keeps the person who actually did it.
    data: { status: "COMPLETE", completedAt: now, completedByUserId: job.completedByUserId ?? actor.userId },
  });
  // Credit (paid in advance / paid extra) pays this clean straight away, in full or part.
  await applyCredit(tenantId, [job.customerId]);

  // Auto-start the work day if still PLANNED — removes the need to tap "Start Area" separately
  const autoStarted = await prisma.workDay.updateMany({
    where: { id: job.workDayId, tenantId, status: "PLANNED" },
    data: { status: "IN_PROGRESS" },
  });
  if (autoStarted.count > 0) {
    await queueNotification({ tenantId, kind: "DAY_STARTED", workDayId: job.workDayId, actorUserId: actor.userId });
  }

  // Only the customer's regular service moves their due date; an extra one-off
  // (e.g. gutters) does not. Each customer keeps their own frequency.
  const isRegularService = !job.isOneOff || job.name === (job.customer.jobName || "Window Cleaning");
  if (isRegularService) {
    await prisma.customer.update({
      where: { id: job.customerId },
      data: {
        nextDueDate: calcNextDue(now, job.customer.frequencyWeeks),
        lastCompletedDate: now,
      },
    });
  }

  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath(`/customers/${job.customerId}`);
}

export async function uncompleteJob(jobId: number) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const job = await prisma.job.findFirst({
    where: { id: jobId, tenantId, ...visibleJobWhere(actor) },
    include: {
      allocations: {
        where: { payment: { voidedAt: null } },
        select: {
          id: true,
          amount: true,
          payment: { select: { id: true, amount: true, createdAt: true, allocations: { select: { id: true, jobId: true, amount: true } } } },
        },
      },
    },
  });
  if (!job) throw new Error("Job not found");

  // Undo is a roll-back of a mistaken "Done" or "Done & Paid":
  // - a payment taken when it was ticked is cancelled whole (including any extra, and any
  //   older cleans it paid off at the same time, which go back to owing);
  // - credit the customer already had, which was used on this clean, goes back to them as credit.
  // Who did the job is kept.
  const tickedAt = job.completedAt ? job.completedAt.getTime() - 5000 : null;
  await prisma.$transaction(async (tx) => {
    const voided = new Set<number>();
    for (const allocation of job.allocations) {
      const payment = allocation.payment;
      const takenWhenTicked = tickedAt !== null && payment.createdAt.getTime() >= tickedAt;
      if (!takenWhenTicked) {
        await tx.paymentAllocation.delete({ where: { id: allocation.id } }); // earlier credit: released
        continue;
      }
      if (voided.has(payment.id)) continue;
      voided.add(payment.id);
      await tx.paymentAllocation.deleteMany({ where: { paymentId: payment.id } });
      await tx.payment.update({
        where: { id: payment.id },
        data: { voidedAt: new Date(), voidReason: "Undone: job marked as not done" },
      });
    }
    await tx.job.update({
      where: { id: jobId },
      data: { status: "PENDING", completedAt: null },
    });
  });

  // Put the customer's dates back to how they were before this clean was ticked:
  // last cleaned = their previous completed clean, due = one cycle after that.
  if (job.status === "COMPLETE") {
    const customer = await prisma.customer.findFirst({
      where: { id: job.customerId, tenantId },
      select: { frequencyWeeks: true, jobName: true, area: { select: { scheduleType: true, frequencyWeeks: true, monthlyDay: true } } },
    });
    const isRegularService = !job.isOneOff || job.name === (customer?.jobName || "Window Cleaning");
    if (customer && isRegularService) {
      const previous = await prisma.job.findFirst({
        where: {
          tenantId, customerId: job.customerId, status: "COMPLETE", id: { not: job.id }, isQuote: false,
          OR: [{ isOneOff: false }, { name: customer.jobName || "Window Cleaning" }],
        },
        orderBy: { workDay: { date: "desc" } },
        select: { completedAt: true, workDay: { select: { date: true } } },
      });
      const day = await prisma.workDay.findFirst({ where: { id: job.workDayId, tenantId }, select: { date: true } });
      const lastDone = previous ? previous.workDay.date : null;
      await prisma.customer.update({
        where: { id: job.customerId },
        data: {
          lastCompletedDate: lastDone,
          nextDueDate: lastDone
            ? customer.area?.scheduleType === "MONTHLY"
              ? nextRunAfter(customer.area, lastDone)
              : addUtcDays(lastDone, (customer.frequencyWeeks || 4) * 7)
            : (day?.date ?? null),
        },
      });
    }
  }

  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath(`/customers/${job.customerId}`);
  revalidatePath("/payments");
}

export async function skipJob(jobId: number) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const job = await prisma.job.findFirst({
    where: { id: jobId, tenantId, ...visibleJobWhere(actor) },
    include: { customer: true, workDay: true },
  });
  if (!job) throw new Error("Job not found");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "SKIPPED" },
  });

  // Advance by this customer's own frequency (may differ from area frequency)
  const nextDue = calcNextDue(job.workDay.date, job.customer.frequencyWeeks);
  await prisma.customer.update({
    where: { id: job.customerId },
    data: {
      nextDueDate: nextDue,
    },
  });

  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/outstanding");
}

export async function markJobOutstanding(jobId: number) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const job = await prisma.job.findFirst({
    where: { id: jobId, tenantId, ...visibleJobWhere(actor) },
    include: { customer: true, workDay: true },
  });
  if (!job) throw new Error("Job not found");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "OUTSTANDING" },
  });

  // Advance by this customer's own frequency (may differ from area frequency)
  const nextDue = calcNextDue(job.workDay.date, job.customer.frequencyWeeks);
  await prisma.customer.update({
    where: { id: job.customerId },
    data: {
      nextDueDate: nextDue,
    },
  });

  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/outstanding");
}

export async function moveJobToDay(jobId: number, newWorkDayId: number) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const [job, targetDay] = await Promise.all([
    requireTenantJob(tenantId, jobId),
    requireTenantWorkDay(tenantId, newWorkDayId),
  ]);

  const oldDayId = job.workDayId;
  const oldDay = await prisma.workDay.findUnique({ where: { id: oldDayId }, select: { assignedUserId: true } });
  // The job keeps whoever was doing it, unless the target day already belongs to them.
  const worker = job.assignedUserId ?? oldDay?.assignedUserId ?? null;

  await prisma.job.update({
    where: { id: jobId },
    data: {
      workDayId: newWorkDayId,
      status: "PENDING",
      assignedUserId: worker && worker !== targetDay.assignedUserId ? worker : null,
    },
  });

  revalidatePath(`/days/${oldDayId}`);
  revalidatePath(`/days/${newWorkDayId}`);
}

/**
 * Move a work day to a new date.
 * mode "one-off"   → just moves this work day. Area nextDueDate unchanged.
 * mode "recurring" → shifts this work day AND all future non-completed work days
 *                    for the same area by the same day delta, then recalculates
 *                    area.nextDueDate from the last shifted run.
 * newDateISO: YYYY-MM-DD string (local calendar date from the client).
 */
export async function rescheduleWorkDay(
  workDayId: number,
  newDateISO: string,
  mode: "one-off" | "recurring"
) {
  const actor = await requirePerm("scheduler");
  const tenantId = actor.tenantId;
  const d = isoToUTC(newDateISO);

  const workDay = await prisma.workDay.findFirst({
    where: { id: workDayId, tenantId },
    include: { area: true },
  });
  if (!workDay) throw new Error("Work day not found");

  if (mode === "one-off") {
    // Guard against collision for one-off moves only
    if (workDay.areaId) {
      const collision = await prisma.workDay.findFirst({ where: { tenantId, date: d, areaId: workDay.areaId, id: { not: workDayId } },
      });
      if (collision) {
        if (collision.status === "COMPLETE" || workDay.status === "COMPLETE") {
          throw new Error("There is already a work day for that area on that date.");
        }
        // Same area already on that date: put this day's jobs onto it (joins a split run back together).
        const jobIds = (await prisma.job.findMany({ where: { tenantId, workDayId, status: { not: "COMPLETE" } }, select: { id: true } })).map((j) => j.id);
        await moveJobsToDateFor(actor, jobIds, newDateISO);
        revalidatePath("/days");
        revalidatePath("/scheduler");
        revalidatePath("/");
        return collision.id;
      }
    }
    await prisma.workDay.update({ where: { id: workDay.id }, data: { date: d } });
    // If this is the area's next open run, the area is now due on the new date
    // (otherwise it shows as "overdue" against the old date).
    if (workDay.area && !workDay.area.isSystemArea && workDay.status !== "COMPLETE") {
      const nextOpen = await prisma.workDay.findFirst({
        where: { tenantId, areaId: workDay.area.id, status: { not: "COMPLETE" }, partOfId: null },
        orderBy: { date: "asc" },
        select: { date: true },
      });
      if (nextOpen) {
        await prisma.area.update({ where: { id: workDay.area.id }, data: { nextDueDate: nextOpen.date } });
      }
    }
  } else {
    // "recurring" mode: shift this work day AND all future PLANNED work days by the same delta
    const oldDate = utcDay(new Date(workDay.date));
    const deltaDays = Math.round((d.getTime() - oldDate.getTime()) / 86_400_000);

    if (deltaDays === 0) return workDayId; // nothing to do

    // Fetch all non-completed work days for this area on or after the dragged day's date.
    // COMPLETE days are historical records and must never be moved.
    const futureShiftable = workDay.areaId
      ? await prisma.workDay.findMany({ where: { tenantId,
            areaId: workDay.areaId,
            date: { gte: oldDate },
            status: { not: "COMPLETE" },
          },
          orderBy: { date: "asc" },
        })
      : [workDay];

    if (futureShiftable.length === 0) return workDayId;

    // Process in reverse order when shifting forward (avoids unique-constraint conflicts)
    const ordered = deltaDays > 0 ? [...futureShiftable].reverse() : futureShiftable;

    for (const wd of ordered) {
      const base = new Date(Date.UTC(
        wd.date.getUTCFullYear(),
        wd.date.getUTCMonth(),
        wd.date.getUTCDate()
      ));
      const shifted = new Date(base.getTime() + deltaDays * 86_400_000);
      await prisma.workDay.update({ where: { id: wd.id }, data: { date: shifted } });
    }

    // Recalculate area.nextDueDate from the last (latest) shifted work day
    if (workDay.area && futureShiftable.length > 0) {
      const lastOldDate = futureShiftable[futureShiftable.length - 1].date;
      const lastBase = new Date(Date.UTC(
        lastOldDate.getUTCFullYear(),
        lastOldDate.getUTCMonth(),
        lastOldDate.getUTCDate()
      ));
      const lastNewDate = new Date(lastBase.getTime() + deltaDays * 86_400_000);
      const nextDue = nextRunAfter(workDay.area, lastNewDate);
      await prisma.area.update({ where: { id: workDay.area.id }, data: { nextDueDate: nextDue } });
    }
  }

  revalidatePath("/days");
  revalidatePath("/scheduler");
  revalidatePath("/");
  return workDayId;
}

/** Fetch work days within a date range (inclusive). */
export async function getWorkDaysInRange(from: Date, to: Date) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const where = await getVisibleWorkDayWhere(tenantId);
  return prisma.workDay.findMany({ where: { ...where, date: { gte: utcDay(from), lte: utcDay(to) } },
    include: {
      area: true,
      assignedUser: { select: { id: true, name: true, email: true } },
      jobs: { include: { customer: { include: { area: true } } } },
    },
    orderBy: { date: "asc" },
  });
}

export async function assignWorkDayWorker(workDayId: number, assignedUserId?: string | null) {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;
  const workDay = await prisma.workDay.findFirst({ where: { id: workDayId, tenantId } });
  if (!workDay) throw new Error("Work day not found");

  const workerId = await resolveAssignedWorkerId(tenantId, assignedUserId);
  await prisma.workDay.update({
    where: { id: workDayId },
    data: { assignedUserId: workerId ?? null },
  });
  // Jobs explicitly set to the new day worker now simply follow the day.
  if (workerId) {
    await prisma.job.updateMany({
      where: { tenantId, workDayId, assignedUserId: workerId },
      data: { assignedUserId: null },
    });
    if (workerId !== workDay.assignedUserId) {
      await queueNotification({ tenantId, kind: "WORK_ASSIGNED", workDayId, userId: workerId, actorUserId: actor.userId });
    }
  }
  revalidatePath("/scheduler");
  revalidatePath("/days");
  revalidatePath(`/days/${workDayId}`);
}

/**
 * Assign individual jobs to a worker (or to the owner), optionally moving them to
 * another date. userId null = follow the day's worker.
 *
 * Moving to a date puts the jobs on that person's day for that date if one exists,
 * otherwise on a new standalone day assigned to them.
 */
export async function assignJobs(jobIds: number[], userId: string | null, dateISO?: string) {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;
  if (!Array.isArray(jobIds) || jobIds.length === 0) return;

  const assignee = userId ? await resolveAssignedWorkerId(tenantId, userId, { allowOwner: true }) : null;
  // A new date moves the jobs first, keeping each in its own area (a split of the run).
  if (dateISO) await moveJobsToDateFor(actor, jobIds, dateISO);
  const jobs = await prisma.job.findMany({
    where: { tenantId, id: { in: jobIds }, status: { not: "COMPLETE" } },
    include: { workDay: { select: { id: true, date: true, assignedUserId: true } } },
  });
  if (jobs.length === 0) return;
  const touchedDays = new Set<number>();
  for (const job of jobs) {
    const dayWorker = job.workDay.assignedUserId;
    // Owner on an unassigned day, or the day's own worker, = just follow the day.
    const followsDay = assignee === null
      || assignee === dayWorker
      || (assignee === actor.userId && dayWorker === null);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        assignedUserId: followsDay ? null : assignee,
        status: "PENDING",
      },
    });
    touchedDays.add(job.workDayId);
  }

  if (assignee) {
    await queueNotification({ tenantId, kind: "WORK_ASSIGNED", userId: assignee, jobIds: jobs.map((job) => job.id), actorUserId: actor.userId });
  }
  for (const dayId of touchedDays) revalidatePath(`/days/${dayId}`);
  revalidatePath("/days");
  revalidatePath("/scheduler");
}

/**
 * Take work back from a worker.
 * - No jobIds: the whole day comes back to the owner. Unfinished jobs return;
 *   jobs the worker already completed stay completed and credited to them.
 * - jobIds: only those unfinished jobs come back (optionally to another date).
 */
export async function takeBackWork(workDayId: number, jobIds?: number[], dateISO?: string) {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;
  const workDay = await prisma.workDay.findFirst({ where: { id: workDayId, tenantId } });
  if (!workDay) throw new Error("Work day not found");

  if (jobIds && jobIds.length > 0) {
    const ids = (await prisma.job.findMany({
      where: { tenantId, workDayId, id: { in: jobIds }, status: { not: "COMPLETE" } },
      select: { id: true },
    })).map((job) => job.id);
    await assignJobs(ids, actor.userId, dateISO);
    return;
  }

  const previousWorker = workDay.assignedUserId;
  await prisma.workDay.update({ where: { id: workDayId }, data: { assignedUserId: null } });
  // Unfinished jobs individually given to workers on this day also come back.
  await prisma.job.updateMany({
    where: { tenantId, workDayId, status: { not: "COMPLETE" }, assignedUserId: { not: null } },
    data: { assignedUserId: null },
  });
  if (previousWorker && workDay.areaId) {
    // Future runs of this area no longer go to that worker automatically.
    await prisma.workDay.updateMany({
      where: { tenantId, areaId: workDay.areaId, status: "PLANNED", assignedUserId: previousWorker, date: { gt: workDay.date } },
      data: { assignedUserId: null },
    });
  }
  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/days");
  revalidatePath("/scheduler");
}

/**
 * Worker pay report for a date range: for each team member, the days they worked,
 * how many jobs they completed and their value, and the cash they collected.
 * Covers both day-rate and percentage pay without recording per-job shares.
 */
export async function getWorkerReport(fromISO: string, toISO: string) {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;
  const from = isoToUTC(fromISO);
  const toExclusive = addUtcDays(isoToUTC(toISO), 1);

  const [members, jobs, payments] = await Promise.all([
    prisma.membership.findMany({
      where: { tenantId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    prisma.job.findMany({
      where: { tenantId, status: "COMPLETE", completedByUserId: { not: null }, completedAt: { gte: from, lt: toExclusive } },
      select: { completedByUserId: true, completedAt: true, price: true },
    }),
    prisma.payment.findMany({
      where: { tenantId, voidedAt: null, method: "CASH", collectedByUserId: { not: null }, paidAt: { gte: from, lt: toExclusive } },
      select: { collectedByUserId: true, amount: true },
    }),
  ]);

  return members.map((member) => {
    const mine = jobs.filter((job) => job.completedByUserId === member.userId);
    const days = new Set(mine.map((job) => job.completedAt!.toISOString().slice(0, 10)));
    const cash = payments
      .filter((payment) => payment.collectedByUserId === member.userId)
      .reduce((sum, payment) => sum + payment.amount, 0);
    return {
      userId: member.userId,
      name: member.user.name || member.user.email,
      role: member.role,
      daysWorked: days.size,
      dates: [...days].sort(),
      jobsCompleted: mine.length,
      valueCompleted: Number(mine.reduce((sum, job) => sum + job.price, 0).toFixed(2)),
      cashCollected: Number(cash.toFixed(2)),
    };
  });
}

/** Team members who can be given work (owner first). Owner only. */
export async function getAssignableTeam() {
  const actor = await requireOwner();
  const members = await prisma.membership.findMany({
    where: { tenantId: actor.tenantId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  return members.map((member) => ({
    id: member.user.id,
    name: member.user.name || member.user.email,
    role: member.role,
    isMe: member.user.id === actor.userId,
  }));
}

// ─── Complete Day ───────────────────────────────────────────────────────────

/**
 * Resolve all outstanding PENDING jobs and mark the day COMPLETE.
 * resolutions: array of { jobId, action: "skip" | "outstanding" | "move", targetDayId? }
 */
export async function completeDay(
  workDayId: number,
  resolutions: Array<{
    jobId: number;
    action: "complete" | "skip" | "outstanding" | "move";
    targetDayId?: number;
  }>,
  completedDateISO?: string
) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  await requireTenantWorkDay(tenantId, workDayId);
  const workDayBefore = await prisma.workDay.findFirst({
    where: { id: workDayId, tenantId },
    include: { area: true },
  });
  if (!workDayBefore) throw new Error("Work day not found");

  for (const r of resolutions) {
    if (r.action === "complete") {
      await completeJob(r.jobId);
    } else if (r.action === "skip") {
      await skipJob(r.jobId);
    } else if (r.action === "outstanding") {
      await markJobOutstanding(r.jobId);
    } else if (r.action === "move" && r.targetDayId) {
      await moveJobToDay(r.jobId, r.targetDayId);
    }
  }

  // A shared day (e.g. Jake's day with one job kept by the owner) only completes once
  // everyone's jobs are resolved. Until then it stays in progress.
  const stillPending = await prisma.job.count({ where: { tenantId, workDayId, status: "PENDING" } });
  if (stillPending > 0) {
    await prisma.workDay.update({ where: { id: workDayId }, data: { status: "IN_PROGRESS" } });
    revalidatePath(`/days/${workDayId}`);
    revalidatePath("/days");
    return null;
  }

  // Move this work day's date to today if there is no collision, so history
  // reflects when the run actually happened rather than when it was scheduled.
  const requestedCompletedDate = completedDateISO ? isoToUTC(completedDateISO) : utcDay(new Date());
  const alreadyCompletedDate = workDayBefore.date.getTime() === requestedCompletedDate.getTime();
  const collision = !alreadyCompletedDate && workDayBefore.areaId
    ? await prisma.workDay.findFirst({ where: { tenantId, date: requestedCompletedDate, areaId: workDayBefore.areaId, id: { not: workDayId } },
      })
    : null;
  const finalDate = (!alreadyCompletedDate && !collision) ? requestedCompletedDate : utcDay(new Date(workDayBefore.date));

  const workDay = await prisma.workDay.update({
    where: { id: workDayId },
    data: { status: "COMPLETE", date: finalDate },
    include: { area: true },
  });
  await queueNotification({ tenantId, kind: "DAY_COMPLETED", workDayId, actorUserId: actor.userId });

  // Auto-schedule next run when a day is completed.
  // nextRunAfter preserves day-of-week for weekly schedules (addWeeks keeps weekday).
  let nextRunResult: { nextDue: Date; nextWorkDayId: number | null; areaName: string } | null = null;

  // A split run (main day + parts on other dates) books the next visit only when every
  // part is done, counted from the main day, and keeps the whole area together.
  const run = await runPieces(tenantId, workDay);
  const openParts = run.pieces.filter((piece) => piece.id !== workDay.id && piece.status !== "COMPLETE");
  if (openParts.length > 0) {
    await markCustomersCleaned(tenantId, workDay.id, finalDate, workDay.area);
  } else {
    const root = run.pieces.find((piece) => piece.id === run.rootId);
    nextRunResult = await syncAreaScheduleAfterCompletion(
      tenantId, workDay, finalDate,
      run.split ? { runDate: root?.date ?? finalDate, runDayIds: run.pieces.map((piece) => piece.id) } : undefined,
    );
  }

  // "Windows cleaned, here's how to pay" texts (if turned on). Runs now, so anyone
  // who paid on the doorstep today is already marked paid and gets skipped.
  // A texting problem must never stop a day being completed.
  try {
    await queueCleanedTexts(tenantId, workDayId, actor.userId);
  } catch (issue) {
    console.error("[texts] cleaned texts failed", issue);
  }

  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/days");
  revalidatePath("/scheduler");
  revalidatePath("/");

  return nextRunResult;
}

export async function reopenDay(workDayId: number) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const workDay = await requireTenantWorkDay(tenantId, workDayId);

  if (workDay.areaId) {
    // Completing this day auto-schedules the area's next run (a future PLANNED day).
    // Re-opening undoes that completion, so remove the auto-generated upcoming run and
    // roll the area's schedule back to this day, otherwise re-opening would leave two
    // open runs for the same area.
    const upcoming = await prisma.workDay.findFirst({
      where: {
        tenantId,
        areaId: workDay.areaId,
        status: { in: ["PLANNED", "IN_PROGRESS"] },
        id: { not: workDayId },
        date: { gt: workDay.date },
      },
      orderBy: { date: "asc" },
      select: { id: true },
    });
    if (upcoming) {
      const upcomingJobs = await prisma.job.findMany({ where: { tenantId, workDayId: upcoming.id }, select: { id: true } });
      const kept = await deleteUnpaidJobs(tenantId, upcomingJobs.map((j) => j.id));
      if (kept.length === 0) await prisma.workDay.delete({ where: { id: upcoming.id } });
    }

    // Point the area (and its customers) back at this run as the next due work.
    const prevCompleted = await prisma.workDay.findFirst({
      where: { tenantId, areaId: workDay.areaId, status: "COMPLETE", id: { not: workDayId } },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    await prisma.area.update({
      where: { id: workDay.areaId },
      data: { lastCompletedDate: prevCompleted?.date ?? null, nextDueDate: workDay.date },
    });
    // Only customers who were on this day are rolled back; others keep their own dates.
    const dayCustomerIds = (await prisma.job.findMany({
      where: { tenantId, workDayId, status: "COMPLETE" },
      select: { customerId: true },
    })).map((job) => job.customerId);
    await prisma.customer.updateMany({
      where: { tenantId, id: { in: dayCustomerIds } },
      data: { lastCompletedDate: prevCompleted?.date ?? null, nextDueDate: workDay.date },
    });
  }

  await prisma.workDay.update({
    where: { id: workDayId },
    data: { status: "PLANNED" },
  });
  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/days");
  revalidatePath("/scheduler");
  revalidatePath("/");
}

export async function updateWorkDayNotes(workDayId: number, notes: string) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  await requireTenantWorkDay(tenantId, workDayId);
  await prisma.workDay.update({
    where: { id: workDayId },
    data: { notes: notes.trim() || null },
  });
  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/days");
  revalidatePath("/");
}

// ─── Split / copy area (creates "Name - Day 2" clone without customers) ──────

export async function splitArea(areaId: number) {
  const actor = await requirePerm("areas");
  const tenantId = actor.tenantId;
  const area = await requireTenantArea(tenantId, areaId);
  // Strip any existing " - Day N" suffix and append the next number
  const base = area.name.replace(/ - Day \d+$/, "");
  // Find all areas whose name starts with the same base to pick the next number
  const existing = await prisma.area.findMany({ where: { tenantId, name: { startsWith: base } },
    select: { name: true },
  });
  const usedNumbers = existing
    .map((a) => {
      const m = a.name.match(/ - Day (\d+)$/);
      return m ? parseInt(m[1], 10) : 1;
    })
    .filter(Boolean);
  const nextNum = Math.max(...usedNumbers, 1) + 1;
  const newName = `${base} - Day ${nextNum}`;
  const created = await prisma.area.create({ data: { tenantId,
      name: newName,
      color: area.color,
      sortOrder: area.sortOrder + 1,
      scheduleType: area.scheduleType,
      frequencyWeeks: area.frequencyWeeks,
      monthlyDay: area.monthlyDay ?? null,
      nextDueDate: area.nextDueDate ?? null,
    },
    include: { customers: true, _count: { select: { customers: true } } },
  });
  revalidatePath("/scheduler");
  revalidatePath("/days");
  revalidatePath("/");
  return { ...created, estimatedValue: 0 };
}

// ─── Update completed work day date ─────────────────────────────────────────

export async function updateCompletedWorkDayDate(workDayId: number, isoDate: string) {
  // Planning action: only the owner or someone allowed to use the scheduler.
  const actor = await requirePerm("scheduler");
  const tenantId = actor.tenantId;
  const newDate = isoToUTC(isoDate);
  const workDay = await prisma.workDay.findFirst({
    where: { id: workDayId, tenantId, status: "COMPLETE" },
    include: { area: true },
  });
  if (!workDay) throw new Error("Work day not found");

  await prisma.workDay.update({
    where: { id: workDayId },
    data: { date: newDate },
  });

  await prisma.job.updateMany({
    where: { tenantId, workDayId, status: "COMPLETE" },
    data: { completedAt: newDate },
  });

  const run = await runPieces(tenantId, workDay);
  const refreshed = run.pieces.map((piece) => (piece.id === workDay.id ? { ...piece, date: newDate } : piece));
  if (refreshed.some((piece) => piece.status !== "COMPLETE")) {
    // Part of a split run that isn't finished: just this day's customers.
    await markCustomersCleaned(tenantId, workDay.id, newDate, workDay.area);
  } else {
    const root = refreshed.find((piece) => piece.id === run.rootId);
    await syncAreaScheduleAfterCompletion(
      tenantId, workDay, newDate,
      run.split ? { runDate: root?.date ?? newDate, runDayIds: refreshed.map((piece) => piece.id) } : undefined,
    );
  }

  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/days");
  revalidatePath("/scheduler");
  revalidatePath("/");
}

// ─── Payments ───────────────────────────────────────────────────────────────

/**
 * Record a payment event with explicit per-job allocations.
 * Creates one Payment row and N PaymentAllocation rows in a single transaction.
 */
export async function recordPayment(data: {
  customerId: number;
  allocations: Array<{ jobId: number; amount: number }>;
  method: PaymentMethodValue;
  notes?: string;
  paidAt?: Date;
  clientRequestId?: string;
  /** Paid on top of the selected jobs: kept as credit. */
  extra?: number;
}) {
  const actor = await requirePerm("schedule").catch(() => requirePerm("payments"));
  const tenantId = actor.tenantId;
  // Workers without the Payments permission can still take payment for jobs on their own round.
  if (!hasPermission(actor, "payments")) {
    const jobIds = data.allocations.map((allocation) => allocation.jobId);
    if (jobIds.length === 0) throw new AccessDeniedError();
    const visible = await prisma.job.count({ where: { tenantId, id: { in: jobIds }, ...visibleJobWhere(actor) } });
    if (visible !== new Set(jobIds).size) throw new AccessDeniedError();
  }
  // Only what a payment needs; tenantId always comes from the signed-in user.
  await createAllocatedPayment({
    tenantId,
    customerId: Number(data.customerId),
    allocations: (Array.isArray(data.allocations) ? data.allocations : []).map((a) => ({ jobId: Number(a.jobId), amount: Number(a.amount) })),
    method: data.method,
    notes: typeof data.notes === "string" ? data.notes.slice(0, 500) : undefined,
    paidAt: data.paidAt instanceof Date ? data.paidAt : undefined,
    clientRequestId: typeof data.clientRequestId === "string" ? data.clientRequestId.slice(0, 100) : undefined,
    extra: typeof data.extra === "number" ? data.extra : undefined,
    collectedByUserId: actor.userId,
  });

  revalidatePath("/payments");
  revalidatePath(`/customers/${data.customerId}`);
}

type GoCardlessPaymentRecord = {
  id: string;
  amount: number | string;
  currency?: string | null;
  status?: string | null;
  reference?: string | null;
  description?: string | null;
  created_at?: string | null;
  charge_date?: string | null;
  metadata?: Record<string, string | null | undefined>;
  links?: { mandate?: string | null };
};

type GoCardlessMandateRecord = {
  id: string;
  reference?: string | null;
  metadata?: Record<string, string | null | undefined>;
  links?: { customer?: string | null };
};

type GoCardlessPaymentsPage = {
  payments?: GoCardlessPaymentRecord[];
  meta?: { cursors?: { after?: string | null } };
};

async function fetchGoCardlessJson<T>(
  baseUrl: string,
  accessToken: string,
  path: string,
  searchParams?: URLSearchParams
): Promise<T> {
  const url = new URL(path, baseUrl);
  if (searchParams) {
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "GoCardless-Version": "2015-07-06",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage =
      (json as { error?: { message?: string }; errors?: Array<{ message?: string }> }).error?.message ||
      (json as { errors?: Array<{ message?: string }> }).errors?.[0]?.message;
    throw new Error(apiMessage || `GoCardless request failed (${response.status})`);
  }

  return json as T;
}

function buildUniqueCustomerIndex<T extends { id: number }>(
  rows: T[],
  getKey: (row: T) => string
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = getKey(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const unique = new Map<string, T>();
  for (const row of rows) {
    const key = getKey(row);
    if (!key) continue;
    if (counts.get(key) === 1) {
      unique.set(key, row);
    }
  }

  return unique;
}

function extractGoCardlessReference(
  payment: GoCardlessPaymentRecord,
  mandate?: GoCardlessMandateRecord | null
) {
  return [
    payment.reference,
    payment.description,
    payment.metadata?.wyndosCustomerRef,
    payment.metadata?.customerReference,
    payment.metadata?.customer_reference,
    mandate?.reference,
    mandate?.metadata?.wyndosCustomerRef,
    mandate?.metadata?.customerReference,
    mandate?.metadata?.customer_reference,
  ].find((value) => typeof value === "string" && value.trim().length > 0) ?? null;
}

export async function syncGoCardlessPayments() {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;

  const settings = await loadBusinessSettings(tenantId);
  const accessToken = settings.goCardlessAccessToken.trim();
  if (!accessToken) {
    throw new Error("Add your GoCardless access token in Settings before syncing payments.");
  }

  const baseUrl = settings.goCardlessEnvironment === "sandbox"
    ? "https://api-sandbox.gocardless.com"
    : "https://api.gocardless.com";

  const [customers, existingGoCardlessPayments] = await Promise.all([
    prisma.customer.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        goCardlessCustomerReference: true,
        goCardlessCustomerId: true,
        goCardlessMandateId: true,
        jobs: {
          where: { status: { in: ["COMPLETE", "OUTSTANDING"] } },
          select: {
            id: true,
            price: true,
            workDay: { select: { date: true } },
            allocations: {
              where: { payment: { voidedAt: null } },
              select: { amount: true },
            },
          },
          orderBy: [{ workDay: { date: "asc" } }, { id: "asc" }],
        },
      },
    }),
    prisma.payment.findMany({
      where: { tenantId, goCardlessPaymentId: { not: null } },
      select: { goCardlessPaymentId: true },
    }),
  ]);

  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const customerByReference = buildUniqueCustomerIndex(
    customers,
    (customer) => normaliseGoCardlessReference(customer.goCardlessCustomerReference)
  );
  const customerByGoCardlessCustomerId = buildUniqueCustomerIndex(
    customers,
    (customer) => customer.goCardlessCustomerId?.trim() ?? ""
  );
  const customerByMandateId = buildUniqueCustomerIndex(
    customers,
    (customer) => customer.goCardlessMandateId?.trim() ?? ""
  );
  const seenPaymentIds = new Set(
    existingGoCardlessPayments
      .map((payment) => payment.goCardlessPaymentId)
      .filter((paymentId): paymentId is string => Boolean(paymentId))
  );

  const scannedPayments: GoCardlessPaymentRecord[] = [];
  let afterCursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const params = new URLSearchParams({ limit: "100" });
    if (afterCursor) {
      params.set("after", afterCursor);
    }

    const payload: GoCardlessPaymentsPage = await fetchGoCardlessJson<GoCardlessPaymentsPage>(
      baseUrl,
      accessToken,
      "/payments",
      params
    );

    const pagePayments = payload.payments ?? [];
    scannedPayments.push(...pagePayments);

    afterCursor = payload.meta?.cursors?.after ?? null;
    if (!afterCursor || pagePayments.length === 0) break;
  }

  const mandateIds = Array.from(
    new Set(
      scannedPayments
        .map((payment) => payment.links?.mandate?.trim())
        .filter((mandateId): mandateId is string => Boolean(mandateId))
    )
  );
  const mandateEntries = await Promise.all(
    mandateIds.map(async (mandateId) => {
      try {
        const payload = await fetchGoCardlessJson<{ mandates?: GoCardlessMandateRecord; mandate?: GoCardlessMandateRecord }>(
          baseUrl,
          accessToken,
          `/mandates/${mandateId}`
        );
        return [mandateId, payload.mandates ?? payload.mandate ?? null] as const;
      } catch {
        return [mandateId, null] as const;
      }
    })
  );
  const mandateMap = new Map(mandateEntries);

  const receivedStatuses = new Set(["confirmed", "paid_out"]);
  const unmatched: Array<{ paymentId: string; reason: string; customerName?: string | null }> = [];
  const matchedCustomerIds = new Set<number>();
  let importedCount = 0;
  let skippedCount = 0;

  for (const payment of scannedPayments) {
    if (!payment.id) {
      skippedCount++;
      continue;
    }
    if (seenPaymentIds.has(payment.id)) {
      skippedCount++;
      continue;
    }

    const status = payment.status?.trim().toLowerCase() ?? "";
    if (!receivedStatuses.has(status)) {
      skippedCount++;
      continue;
    }

    const amount = minorUnitsToCurrency(payment.amount);
    if (amount <= 0) {
      skippedCount++;
      continue;
    }

    const mandate = payment.links?.mandate ? mandateMap.get(payment.links.mandate) ?? null : null;
    const metadata = payment.metadata ?? {};

    const localCustomerId =
      parseWyndosCustomerId(metadata.wyndosCustomerId) ??
      parseWyndosCustomerId(metadata.customerId) ??
      parseWyndosCustomerId(metadata.customer_id);

    let customer = localCustomerId ? customerById.get(localCustomerId) ?? null : null;

    if (!customer && payment.links?.mandate) {
      customer = customerByMandateId.get(payment.links.mandate.trim()) ?? null;
    }

    if (!customer && mandate?.links?.customer) {
      customer = customerByGoCardlessCustomerId.get(mandate.links.customer.trim()) ?? null;
    }

    if (!customer) {
      const referenceCandidates = [
        extractGoCardlessReference(payment, mandate),
        metadata.wyndosCustomerRef ?? null,
        metadata.customerReference ?? null,
        metadata.customer_reference ?? null,
      ];

      for (const candidate of referenceCandidates) {
        const normalised = normaliseGoCardlessReference(candidate ?? undefined);
        if (!normalised) continue;
        const byReference = customerByReference.get(normalised);
        if (byReference) {
          customer = byReference;
          break;
        }
      }
    }

    if (!customer) {
      unmatched.push({ paymentId: payment.id, reason: "No Wyndos customer matched the GoCardless payment or mandate reference." });
      continue;
    }

    const unpaidJobs = customer.jobs
      .map((job) => {
        const paid = job.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
        const due = Number(Math.max(0, job.price - paid).toFixed(2));
        return { id: job.id, due };
      })
      .filter((job) => job.due > 0.005);

    let remaining = amount;
    const allocations: Array<{ jobId: number; amount: number }> = [];
    for (const job of unpaidJobs) {
      if (remaining <= 0.005) break;
      const allocationAmount = Number(Math.min(job.due, remaining).toFixed(2));
      if (allocationAmount <= 0.005) continue;
      allocations.push({ jobId: job.id, amount: allocationAmount });
      remaining = Number((remaining - allocationAmount).toFixed(2));
    }

    if (allocations.length === 0) {
      unmatched.push({ paymentId: payment.id, customerName: customer.name, reason: "Matched customer has no unpaid jobs to allocate this payment against." });
      continue;
    }

    if (remaining > 0.01) {
      unmatched.push({ paymentId: payment.id, customerName: customer.name, reason: `Payment exceeds the matched customer's outstanding balance by £${remaining.toFixed(2)}.` });
      continue;
    }

    await createAllocatedPayment({
      tenantId,
      customerId: customer.id,
      allocations,
      method: "BACS",
      notes: `Imported from GoCardless${extractGoCardlessReference(payment, mandate) ? ` · ${extractGoCardlessReference(payment, mandate)}` : ""}`,
      paidAt: payment.charge_date
        ? new Date(`${payment.charge_date}T00:00:00.000Z`)
        : payment.created_at
          ? new Date(payment.created_at)
          : new Date(),
      goCardlessPaymentId: payment.id,
      goCardlessStatus: payment.status ?? undefined,
      goCardlessReference: extractGoCardlessReference(payment, mandate) ?? undefined,
    });

    seenPaymentIds.add(payment.id);
    matchedCustomerIds.add(customer.id);
    importedCount++;
  }

  await prisma.tenantSettings.update({
    where: { tenantId },
    data: { goCardlessLastSyncedAt: new Date() },
  });

  if (importedCount > 0) {
    revalidatePath("/payments");
    revalidatePath("/customers");
    for (const customerId of matchedCustomerIds) {
      revalidatePath(`/customers/${customerId}`);
    }
  }
  revalidatePath("/settings");

  return {
    scannedCount: scannedPayments.length,
    importedCount,
    skippedCount,
    unmatched: unmatched.slice(0, 12),
  };
}

export async function voidPayment(paymentId: number, reason?: string) {
  const actor = await requirePerm("payments");
  const tenantId = actor.tenantId;
  const payment = await requireTenantPayment(tenantId, paymentId);
  await prisma.payment.update({
    where: { id: payment.id },
    data: { voidedAt: new Date(), voidReason: reason ?? null },
  });
  revalidatePath("/payments");
  revalidatePath(`/customers/${payment.customerId}`);
}

export async function restorePayment(paymentId: number) {
  const actor = await requirePerm("payments");
  const tenantId = actor.tenantId;
  const payment = await requireTenantPayment(tenantId, paymentId);
  await prisma.payment.update({
    where: { id: payment.id },
    data: { voidedAt: null, voidReason: null },
  });
  revalidatePath("/payments");
  revalidatePath(`/customers/${payment.customerId}`);
}

export async function updatePaymentMeta(
  paymentId: number,
  data: {
    method?: "CASH" | "BACS" | "CARD";
    paidAt?: Date;
    notes?: string;
  }
) {
  const actor = await requirePerm("payments");
  const tenantId = actor.tenantId;
  const payment = await requireTenantPayment(tenantId, paymentId);
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      ...(data.method !== undefined && { method: data.method }),
      ...(data.paidAt !== undefined && { paidAt: data.paidAt }),
      ...(data.notes !== undefined && { notes: data.notes || null }),
    },
  });
  revalidatePath("/payments");
  revalidatePath(`/customers/${payment.customerId}`);
}

// ─── Dashboard data ─────────────────────────────────────────────────────────

/** Worker home: only their own days and jobs, plus what they did and collected this week. */
async function getWorkerDashboardData(actor: Actor) {
  const tenantId = actor.tenantId;
  const today = utcDay(new Date());
  const weekStart = addUtcDays(today, -((today.getUTCDay() + 6) % 7)); // Monday
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const mine = { tenantId, completedByUserId: actor.userId, status: "COMPLETE" as const, isQuote: false };
  const [upcomingDays, doneThisWeek, doneThisMonth, doneAllTime, cashThisWeek, recentJobs, businesses] = await Promise.all([
    prisma.workDay.findMany({
      where: { tenantId, date: { gte: today }, ...visibleWorkDayWhere(actor) },
      include: {
        area: true,
        jobs: { where: visibleJobWhere(actor), include: { customer: true } },
      },
      orderBy: { date: "asc" },
      take: 7,
    }),
    prisma.job.aggregate({ where: { ...mine, completedAt: { gte: weekStart } }, _count: { _all: true }, _sum: { price: true } }),
    prisma.job.aggregate({ where: { ...mine, completedAt: { gte: monthStart } }, _count: { _all: true }, _sum: { price: true } }),
    prisma.job.aggregate({ where: mine, _count: { _all: true }, _sum: { price: true } }),
    // Cash they took that hasn't been handed to the owner yet.
    prisma.payment.aggregate({
      where: { tenantId, collectedByUserId: actor.userId, method: "CASH", voidedAt: null, handoverId: null },
      _sum: { amount: true },
    }),
    prisma.job.findMany({
      where: mine,
      select: { id: true, price: true, name: true, completedAt: true, workDayId: true, customer: { select: { name: true, address: true } } },
      orderBy: { completedAt: "desc" },
      take: 10,
    }),
    prisma.membership.findMany({
      where: { userId: actor.userId },
      select: { tenantId: true, role: true, tenant: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const upcomingJobs = upcomingDays.flatMap((d) => d.jobs).filter((j) => j.status === "PENDING" && !j.isQuote);
  return {
    isWorker: true as const,
    upcomingDays,
    jobsDoneThisWeek: doneThisWeek._count._all,
    valueDoneThisWeek: Number(doneThisWeek._sum.price ?? 0),
    cashCollectedThisWeek: Number(cashThisWeek._sum.amount ?? 0),
    worker: {
      monthJobs: doneThisMonth._count._all,
      monthValue: Number(doneThisMonth._sum.price ?? 0),
      allJobs: doneAllTime._count._all,
      allValue: Number(doneAllTime._sum.price ?? 0),
      upcomingJobs: upcomingJobs.length,
      upcomingValue: Number(upcomingJobs.reduce((s, j) => s + j.price, 0).toFixed(2)),
      recentJobs,
      businesses: businesses.map((b) => ({ tenantId: b.tenantId, name: b.tenant.name, role: b.role, current: b.tenantId === tenantId })),
    },
    totalRoundValue: 0,
    totalEarnings: 0,
    customerCount: 0,
    overdueCount: 0,
    totalOwing: 0,
    recentPayments: [],
    customersWithDebt: [],
  };
}

export async function getDashboardData() {
  const actor = await requirePerm("dashboard");
  if (actor.isWorker) return getWorkerDashboardData(actor);
  const tenantId = actor.tenantId;
  const today = startOfDay(new Date());

  const [
    upcomingDays,
    totalRoundValue,
    totalEarnings,
    customerCount,
    overdueCount,
    completedJobs,
    recentPayments,
    customersForDebt,
  ] = await Promise.all([
    prisma.workDay.findMany({ where: { tenantId, date: { gte: today } },
      include: {
        area: true,
        jobs: { include: { customer: true } },
      },
      orderBy: { date: "asc" },
      take: 7,
    }),
    prisma.customer.aggregate({ where: { tenantId, active: true }, _sum: { price: true } }),
    prisma.payment.aggregate({ where: { tenantId, voidedAt: null }, _sum: { amount: true } }),
    prisma.customer.count({ where: { tenantId, active: true } }),
    prisma.area.count({ where: { tenantId, isSystemArea: false, nextDueDate: { lt: today } } }),
    prisma.job.aggregate({ where: { tenantId, status: "COMPLETE" }, _sum: { price: true } }),
    prisma.payment.findMany({
      where: { tenantId, voidedAt: null },
      include: { customer: true },
      orderBy: { paidAt: "desc" },
      take: 5,
    }),
    prisma.customer.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        address: true,
        jobs: {
          where: { status: "COMPLETE" },
          select: {
            price: true,
            allocations: {
              where: { payment: { voidedAt: null } },
              select: { amount: true },
            },
          },
        },
      },
    }),
  ]);

  const customersWithDebt = customersForDebt
    .map((customer) => ({
      id: customer.id,
      name: customer.name,
      address: customer.address,
      debt: Number(
        customer.jobs.reduce((sum, j) => {
          const paid = j.allocations.reduce((s, a) => s + a.amount, 0);
          return sum + Math.max(0, j.price - paid);
        }, 0).toFixed(2)
      ),
    }))
    .filter((customer) => customer.debt > 0.005)
    .sort((a, b) => b.debt - a.debt);
  const owingTotal = customersWithDebt.reduce((sum, customer) => sum + customer.debt, 0);

  return {
    isWorker: false as const,
    worker: null,
    jobsDoneThisWeek: 0,
    valueDoneThisWeek: 0,
    cashCollectedThisWeek: 0,
    upcomingDays,
    totalRoundValue: Number(totalRoundValue._sum.price ?? 0),
    totalEarnings: Number(totalEarnings._sum.amount ?? 0),
    customerCount,
    overdueCount,
    totalOwing: Number(owingTotal.toFixed(2)),
    recentPayments,
    customersWithDebt: customersWithDebt.slice(0, 10),
  };
}

/**
 * For each given day that belongs to a split run: the run's other days (with their status).
 * The area's next visit is only booked once all of them are complete.
 */
export async function getRunSiblings(dayIds: number[]) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  if (dayIds.length === 0) return {} as Record<number, Array<{ id: number; date: string; status: string }>>;
  const days = await prisma.workDay.findMany({
    where: { tenantId, id: { in: dayIds }, areaId: { not: null } },
    select: { id: true, partOfId: true },
  });
  const rootIds = [...new Set(days.map((d) => d.partOfId ?? d.id))];
  const pieces = await prisma.workDay.findMany({
    where: { tenantId, OR: [{ id: { in: rootIds } }, { partOfId: { in: rootIds } }] },
    select: { id: true, partOfId: true, date: true, status: true },
    orderBy: { date: "asc" },
  });
  const out: Record<number, Array<{ id: number; date: string; status: string }>> = {};
  for (const d of days) {
    const root = d.partOfId ?? d.id;
    const run = pieces.filter((p) => p.id === root || p.partOfId === root);
    if (run.length < 2) continue;
    out[d.id] = run
      .filter((p) => p.id !== d.id)
      .map((p) => ({ id: p.id, date: p.date.toISOString().slice(0, 10), status: p.status }));
  }
  return out;
}

export async function getSchedulerTodoSummary() {
  const actor = await requirePerm("scheduler");
  const tenantId = actor.tenantId;
  const today = startOfDay(new Date());

  const [
    overdueAreas,
    holidays,
    openWorkDays,
    customersForDebt,
  ] = await Promise.all([
    prisma.area.findMany({
      where: { tenantId, isSystemArea: false, nextDueDate: { lt: today } },
      select: { id: true, name: true, nextDueDate: true },
      orderBy: { nextDueDate: "asc" },
      take: 8,
    }),
    prisma.holiday.findMany({
      where: { tenantId },
      select: { startDate: true, endDate: true, label: true },
    }),
    prisma.workDay.findMany({
      where: { tenantId, status: { in: ["PLANNED", "IN_PROGRESS"] }, areaId: { not: null } },
      select: { id: true, date: true, areaId: true, partOfId: true, status: true, area: { select: { name: true, isSystemArea: true } } },
    }),
    prisma.customer.findMany({
      where: { tenantId },
      select: {
        id: true,
        jobs: {
          where: { status: "COMPLETE" },
          select: {
            price: true,
            allocations: {
              where: { payment: { voidedAt: null } },
              select: { amount: true },
            },
          },
        },
      },
    }),
  ]);

  // Runs that can't book their next visit yet: a split part (or the main day) still open
  // after another part was done, or a day left "in progress" from before today.
  const splitRoots = new Set(openWorkDays.filter((d) => d.partOfId).map((d) => d.partOfId!));
  const completedPieces = await prisma.workDay.findMany({
    where: {
      tenantId,
      status: "COMPLETE",
      OR: [
        { id: { in: [...splitRoots] } },
        { partOfId: { in: openWorkDays.filter((d) => !d.partOfId).map((d) => d.id) } },
      ],
    },
    select: { id: true, partOfId: true },
  });
  const rootWithDonePiece = new Set(completedPieces.map((p) => p.partOfId ?? p.id));
  const unfinishedRuns = openWorkDays
    .filter((d) => !d.area?.isSystemArea)
    .filter((d) => rootWithDonePiece.has(d.partOfId ?? d.id) || (d.status === "IN_PROGRESS" && d.date < today))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const holidayConflicts = openWorkDays.filter((workDay) =>
    holidays.some((holiday) => workDay.date >= holiday.startDate && workDay.date <= holiday.endDate)
  );

  const customersOwing = customersForDebt
    .map((customer) => ({
      id: customer.id,
      debt: Number(customer.jobs.reduce((sum, job) => {
        const paid = job.allocations.reduce((paidSum, allocation) => paidSum + allocation.amount, 0);
        return sum + Math.max(0, job.price - paid);
      }, 0).toFixed(2)),
    }))
    .filter((customer) => customer.debt > 0.005);

  return {
    overdueAreas: {
      count: overdueAreas.length,
      items: overdueAreas.map((area) => ({
        id: area.id,
        name: area.name,
        dueDate: area.nextDueDate,
      })),
    },
    holidayConflicts: {
      count: holidayConflicts.length,
      items: holidayConflicts.slice(0, 6).map((workDay) => ({
        id: workDay.id,
        name: workDay.area?.name ?? "Scheduled day",
        date: workDay.date,
      })),
    },
    unfinishedRuns: {
      count: unfinishedRuns.length,
      items: unfinishedRuns.slice(0, 6).map((workDay) => ({
        id: workDay.id,
        name: workDay.area?.name ?? "Area",
        date: workDay.date,
        reason: workDay.status === "IN_PROGRESS" && workDay.date < today ? "still in progress" : "split part not done",
      })),
    },
    customersOwing: {
      count: customersOwing.length,
      totalAmount: Number(customersOwing.reduce((sum, customer) => sum + customer.debt, 0).toFixed(2)),
    },
  };
}

export async function getPaymentsPage() {
  const actor = await requirePerm("payments");
  const tenantId = actor.tenantId;
  const [payments, customers] = await Promise.all([
    prisma.payment.findMany({
      where: { tenantId, voidedAt: null },
      include: {
        customer: true,
        allocations: { include: { job: { include: { workDay: true } } } },
      },
      orderBy: { paidAt: "desc" },
      take: 500, // the page shows the latest 50; search looks further back
    }),
    prisma.customer.findMany({
      where: { tenantId },
      include: {
        area: true,
        jobs: {
          where: { status: "COMPLETE" },
          include: {
            workDay: true,
            allocations: {
              where: { payment: { voidedAt: null } },
              select: { amount: true },
            },
          },
          orderBy: [{ workDay: { date: "asc" } }, { createdAt: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  const credit = await creditFor(tenantId, customers.map((customer) => customer.id));

  const debtors = customers
    .map((customer) => {
      const unpaidJobs = customer.jobs
        .map((j) => {
          const paid = j.allocations.reduce((s, a) => s + a.amount, 0);
          const due = Number(Math.max(0, j.price - paid).toFixed(2));
          return {
            id: j.id,
            name: j.name,
            price: j.price,
            paid: Number(paid.toFixed(2)),
            due,
            isOneOff: j.isOneOff,
            date: j.workDay?.date,
            notes: j.notes ?? "",
          };
        })
        .filter((j) => j.due > 0.005);

      const debt = Number(unpaidJobs.reduce((sum, j) => sum + j.due, 0).toFixed(2));

      return {
        id: customer.id,
        name: customer.name,
        address: customer.address,
        email: customer.email,
        phone: customer.phone,
        areaId: customer.areaId,
        areaName: customer.area?.name ?? "",
        debt,
        jobIds: unpaidJobs.map((j) => j.id),
        unpaidJobs,
        credit: credit.get(customer.id) ?? 0,
      };
    });

  const withCredit = debtors
    .filter((customer) => customer.credit > 0.005)
    .map((customer) => ({ id: customer.id, name: customer.name, address: customer.address, areaName: customer.areaName, credit: customer.credit }))
    .sort((a, b) => b.credit - a.credit);
  // Everyone, for "Add credit" (paid in advance) — the customer may owe nothing.
  const allCustomers = debtors.map((customer) => ({ id: customer.id, name: customer.name, address: customer.address, credit: customer.credit }));

  return {
    payments,
    customersWithDebt: debtors.filter((customer) => customer.debt > 0.005).sort((a, b) => b.debt - a.debt),
    customersWithCredit: withCredit,
    allCustomers,
  };
}

const ACCOUNTING_MONTHS = 12;
const REPEAT_UNITS = ["DAY", "WEEK", "MONTH", "YEAR"] as const;

function isValidRepeatUnit(value: string | null | undefined): value is (typeof REPEAT_UNITS)[number] {
  return REPEAT_UNITS.includes((value ?? "") as (typeof REPEAT_UNITS)[number]);
}

function addRepeatInterval(date: Date, count: number, unit: (typeof REPEAT_UNITS)[number]) {
  switch (unit) {
    case "DAY":
      return addUtcDays(date, count);
    case "WEEK":
      return addUtcDays(date, count * 7);
    case "MONTH":
      return addUtcMonths(date, count);
    case "YEAR":
      return new Date(Date.UTC(date.getUTCFullYear() + count, date.getUTCMonth(), date.getUTCDate()));
  }
}

function getNextScheduledDate(anchorDate: Date, repeatEvery: number, repeatUnit: (typeof REPEAT_UNITS)[number]) {
  const today = utcDay(new Date());
  let next = utcDay(anchorDate);
  while (next <= today) {
    next = utcDay(addRepeatInterval(next, repeatEvery, repeatUnit));
  }
  return next;
}

function normaliseRecurringSchedule(data: {
  isRecurring?: boolean;
  repeatEvery?: number | null;
  repeatUnit?: string | null;
  repeatAnchorDate?: Date | null;
  repeatEndsAt?: Date | null;
  entryDate: Date;
}) {
  const recurring = Boolean(data.isRecurring);
  if (!recurring) {
    return {
      isRecurring: false,
      repeatEvery: null,
      repeatUnit: null,
      repeatAnchorDate: null,
      nextScheduledAt: null,
      repeatEndsAt: null,
    };
  }

  const repeatEvery = Number(data.repeatEvery);
  if (!Number.isInteger(repeatEvery) || repeatEvery <= 0) {
    throw new Error("Repeat schedule must be every 1 or more units.");
  }
  if (!isValidRepeatUnit(data.repeatUnit)) {
    throw new Error("Repeat unit must be day, week, month, or year.");
  }

  const repeatAnchorDate = utcDay(data.repeatAnchorDate ? new Date(data.repeatAnchorDate) : data.entryDate);
  if (Number.isNaN(repeatAnchorDate.getTime())) {
    throw new Error("Repeat anchor date is invalid.");
  }

  const repeatEndsAt = data.repeatEndsAt ? utcDay(new Date(data.repeatEndsAt)) : null;
  if (repeatEndsAt && Number.isNaN(repeatEndsAt.getTime())) {
    throw new Error("Repeat end date is invalid.");
  }

  const nextScheduledAt = getNextScheduledDate(repeatAnchorDate, repeatEvery, data.repeatUnit);
  if (repeatEndsAt && nextScheduledAt > repeatEndsAt) {
    throw new Error("Repeat end date falls before the next scheduled date.");
  }

  return {
    isRecurring: true,
    repeatEvery,
    repeatUnit: data.repeatUnit,
    repeatAnchorDate,
    nextScheduledAt,
    repeatEndsAt,
  };
}

function getUtcMonthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function getMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(date: Date) {
  return date.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

function getTaxYearStartDate(taxYearStart: number) {
  return new Date(Date.UTC(taxYearStart, 3, 6));
}

function getTaxYearLabel(taxYearStart: number) {
  return `${taxYearStart}/${String((taxYearStart + 1) % 100).padStart(2, "0")}`;
}

function getCurrentTaxYearStart(now = new Date()) {
  const year = now.getUTCFullYear();
  return now >= getTaxYearStartDate(year) ? year : year - 1;
}

function calculateTaxBreakdown(amount: number, taxTreatmentValue: string | null | undefined) {
  const taxTreatment = getTaxTreatment(taxTreatmentValue);
  const rate = taxTreatment.vatRate;
  if (rate <= 0) {
    return {
      taxTreatment: taxTreatment.value,
      vatRate: rate,
      vatAmount: 0,
      netAmount: Number(amount.toFixed(2)),
    };
  }

  const netAmount = Number((amount / (1 + rate / 100)).toFixed(2));
  const vatAmount = Number((amount - netAmount).toFixed(2));
  return {
    taxTreatment: taxTreatment.value,
    vatRate: rate,
    vatAmount,
    netAmount,
  };
}

async function materialiseRecurringExpenseTemplates(tenantId: number) {
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

    await prisma.$transaction(async (tx) => {
      while (nextScheduledAt <= today && (!repeatEndsAt || nextScheduledAt <= repeatEndsAt)) {
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

        nextScheduledAt = utcDay(addRepeatInterval(nextScheduledAt, repeatEvery, repeatUnit));
      }

      await tx.expense.update({
        where: { id: template.id },
        data: { nextScheduledAt: repeatEndsAt && nextScheduledAt > repeatEndsAt ? null : nextScheduledAt },
      });
    });
  }
}

async function materialiseRecurringOtherIncomeTemplates(tenantId: number) {
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

    await prisma.$transaction(async (tx) => {
      while (nextScheduledAt <= today && (!repeatEndsAt || nextScheduledAt <= repeatEndsAt)) {
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

        nextScheduledAt = utcDay(addRepeatInterval(nextScheduledAt, repeatEvery, repeatUnit));
      }

      await tx.otherIncome.update({
        where: { id: template.id },
        data: { nextScheduledAt: repeatEndsAt && nextScheduledAt > repeatEndsAt ? null : nextScheduledAt },
      });
    });
  }
}

export async function createExpense(data: {
  category: string;
  supplier?: string;
  amount: number;
  taxTreatment?: string;
  expenseDate: Date;
  notes?: string;
  isRecurring?: boolean;
  repeatEvery?: number | null;
  repeatUnit?: string | null;
  repeatAnchorDate?: Date | null;
  repeatEndsAt?: Date | null;
}) {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  const category = getExpenseCategory(data.category);
  const amount = Number(data.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Expense amount must be greater than zero.");
  }

  const expenseDate = new Date(data.expenseDate);
  if (Number.isNaN(expenseDate.getTime())) {
    throw new Error("Expense date is invalid.");
  }

  const recurringSchedule = normaliseRecurringSchedule({
    isRecurring: data.isRecurring,
    repeatEvery: data.repeatEvery,
    repeatUnit: data.repeatUnit,
    repeatAnchorDate: data.repeatAnchorDate,
    repeatEndsAt: data.repeatEndsAt,
    entryDate: expenseDate,
  });
  const taxBreakdown = calculateTaxBreakdown(amount, data.taxTreatment);

  await prisma.expense.create({
    data: {
      tenantId,
      category: category.value,
      hmrcCategory: category.hmrcCategory,
      supplier: data.supplier?.trim() || "",
      amount,
      netAmount: taxBreakdown.netAmount,
      vatAmount: taxBreakdown.vatAmount,
      vatRate: taxBreakdown.vatRate,
      taxTreatment: taxBreakdown.taxTreatment,
      expenseDate,
      notes: data.notes?.trim() || null,
      isRecurring: recurringSchedule.isRecurring,
      repeatEvery: recurringSchedule.repeatEvery,
      repeatUnit: recurringSchedule.repeatUnit,
      repeatAnchorDate: recurringSchedule.repeatAnchorDate,
      nextScheduledAt: recurringSchedule.nextScheduledAt,
      repeatEndsAt: recurringSchedule.repeatEndsAt,
    },
  });

  revalidatePath("/accounting");
}

export async function updateExpense(
  expenseId: number,
  data: {
    category?: string;
    supplier?: string;
    amount?: number;
    taxTreatment?: string;
    expenseDate?: Date;
    notes?: string;
  }
) {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  const existing = await prisma.expense.findFirst({
    where: { id: expenseId, tenantId },
  });
  if (!existing) throw new Error("Expense not found.");

  const updates: Record<string, unknown> = {};

  if (data.category !== undefined) {
    const category = getExpenseCategory(data.category);
    updates.category = category.value;
    updates.hmrcCategory = category.hmrcCategory;
  }
  if (data.supplier !== undefined) updates.supplier = data.supplier.trim();
  if (data.notes !== undefined) updates.notes = data.notes.trim() || null;

  if (data.amount !== undefined) {
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Expense amount must be greater than zero.");
    }
    const taxBreakdown = calculateTaxBreakdown(
      amount,
      data.taxTreatment ?? existing.taxTreatment
    );
    updates.amount = amount;
    updates.netAmount = taxBreakdown.netAmount;
    updates.vatAmount = taxBreakdown.vatAmount;
    updates.vatRate = taxBreakdown.vatRate;
    updates.taxTreatment = taxBreakdown.taxTreatment;
  } else if (data.taxTreatment !== undefined) {
    const taxBreakdown = calculateTaxBreakdown(existing.amount, data.taxTreatment);
    updates.netAmount = taxBreakdown.netAmount;
    updates.vatAmount = taxBreakdown.vatAmount;
    updates.vatRate = taxBreakdown.vatRate;
    updates.taxTreatment = taxBreakdown.taxTreatment;
  }

  if (data.expenseDate !== undefined) {
    const d = new Date(data.expenseDate);
    if (Number.isNaN(d.getTime())) throw new Error("Expense date is invalid.");
    updates.expenseDate = d;
  }

  await prisma.expense.update({
    where: { id: expenseId },
    data: updates,
  });

  revalidatePath("/accounting");
}

/**
 * Starting figures for a business that moves onto Wyndos part-way through the tax year:
 * what it earned and spent this tax year before Wyndos. Stored as one "Earnings before
 * Wyndos" income entry and one "Expenses before Wyndos" expense, dated the day entered.
 */
export async function getOpeningFigures() {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  const taxYear = getCurrentTaxYearStart();
  const from = getTaxYearStartDate(taxYear);
  const to = getTaxYearStartDate(taxYear + 1);
  const [income, expense] = await Promise.all([
    prisma.otherIncome.findFirst({ where: { tenantId, category: "OPENING", receivedAt: { gte: from, lt: to } }, orderBy: { receivedAt: "desc" } }),
    prisma.expense.findFirst({ where: { tenantId, category: "OPENING", expenseDate: { gte: from, lt: to } }, orderBy: { expenseDate: "desc" } }),
  ]);
  return {
    taxYearLabel: `${taxYear}/${String((taxYear + 1) % 100).padStart(2, "0")}`,
    taxYearStart: from.toISOString().slice(0, 10),
    income: income?.amount ?? 0,
    expenses: expense?.amount ?? 0,
    incomeVat: income?.vatAmount ?? 0,
    expensesVat: expense?.vatAmount ?? 0,
    asAt: (income?.receivedAt ?? expense?.expenseDate ?? null)?.toISOString().slice(0, 10) ?? null,
  };
}

export async function saveOpeningFigures(data: { income: number; expenses: number; incomeVat?: number; expensesVat?: number; asAt: string }) {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  const income = Math.round(Number(data.income) * 100) / 100;
  const expenses = Math.round(Number(data.expenses) * 100) / 100;
  // VAT inside those totals (VAT charged on what you earned, VAT paid on what you spent).
  const incomeVat = Math.round(Number(data.incomeVat ?? 0) * 100) / 100;
  const expensesVat = Math.round(Number(data.expensesVat ?? 0) * 100) / 100;
  if (!Number.isFinite(income) || income < 0 || !Number.isFinite(expenses) || expenses < 0) throw new Error("Amounts can't be negative.");
  if (!Number.isFinite(incomeVat) || incomeVat < 0 || !Number.isFinite(expensesVat) || expensesVat < 0) throw new Error("VAT can't be negative.");
  if (incomeVat > income || expensesVat > expenses) throw new Error("VAT can't be more than the total it's part of.");
  const vatTreatment = (gross: number, vat: number) => {
    if (vat <= 0) return { netAmount: gross, vatAmount: 0, vatRate: 0, taxTreatment: "NO_VAT" };
    const net = Math.round((gross - vat) * 100) / 100;
    return { netAmount: net, vatAmount: vat, vatRate: net > 0 ? Math.round((vat / net) * 10000) / 100 : 0, taxTreatment: "MIXED" };
  };
  const taxYear = getCurrentTaxYearStart();
  const from = getTaxYearStartDate(taxYear);
  const to = getTaxYearStartDate(taxYear + 1);
  const asAt = /^\d{4}-\d{2}-\d{2}$/.test(data.asAt) ? isoToUTC(data.asAt) : utcDay(new Date());
  if (asAt < from || asAt >= to) throw new Error("The date must be in this tax year.");

  await prisma.$transaction(async (tx) => {
    await tx.otherIncome.deleteMany({ where: { tenantId, category: "OPENING", receivedAt: { gte: from, lt: to } } });
    await tx.expense.deleteMany({ where: { tenantId, category: "OPENING", expenseDate: { gte: from, lt: to } } });
    const note = "Starting figure: this tax year before using Wyndos";
    if (income > 0) {
      await tx.otherIncome.create({ data: {
        tenantId, category: "OPENING", source: "Earnings before Wyndos", amount: income, ...vatTreatment(income, incomeVat),
        receivedAt: asAt, notes: note,
      } });
    }
    if (expenses > 0) {
      const cat = getExpenseCategory("OPENING");
      await tx.expense.create({ data: {
        tenantId, category: "OPENING", hmrcCategory: cat.hmrcCategory, supplier: "Expenses before Wyndos", amount: expenses,
        ...vatTreatment(expenses, expensesVat), expenseDate: asAt, notes: note,
      } });
    }
  });
  revalidatePath("/accounting");
  revalidatePath("/");
}

export async function createOtherIncome(data: {
  category: string;
  source?: string;
  amount: number;
  taxTreatment?: string;
  receivedAt: Date;
  notes?: string;
  isRecurring?: boolean;
  repeatEvery?: number | null;
  repeatUnit?: string | null;
  repeatAnchorDate?: Date | null;
  repeatEndsAt?: Date | null;
}) {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  const category = getOtherIncomeCategory(data.category);
  const amount = Number(data.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Income amount must be greater than zero.");
  }

  const receivedAt = new Date(data.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) {
    throw new Error("Income date is invalid.");
  }

  const recurringSchedule = normaliseRecurringSchedule({
    isRecurring: data.isRecurring,
    repeatEvery: data.repeatEvery,
    repeatUnit: data.repeatUnit,
    repeatAnchorDate: data.repeatAnchorDate,
    repeatEndsAt: data.repeatEndsAt,
    entryDate: receivedAt,
  });
  const taxBreakdown = calculateTaxBreakdown(amount, data.taxTreatment);

  await prisma.otherIncome.create({
    data: {
      tenantId,
      category: category.value,
      source: data.source?.trim() || "",
      amount,
      netAmount: taxBreakdown.netAmount,
      vatAmount: taxBreakdown.vatAmount,
      vatRate: taxBreakdown.vatRate,
      taxTreatment: taxBreakdown.taxTreatment,
      receivedAt,
      notes: data.notes?.trim() || null,
      isRecurring: recurringSchedule.isRecurring,
      repeatEvery: recurringSchedule.repeatEvery,
      repeatUnit: recurringSchedule.repeatUnit,
      repeatAnchorDate: recurringSchedule.repeatAnchorDate,
      nextScheduledAt: recurringSchedule.nextScheduledAt,
      repeatEndsAt: recurringSchedule.repeatEndsAt,
    },
  });

  revalidatePath("/accounting");
}

export async function deleteExpense(expenseId: number) {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  const expense = await requireTenantExpense(tenantId, expenseId);
  await prisma.expense.delete({ where: { id: expense.id } });
  revalidatePath("/accounting");
}

export async function deleteOtherIncome(otherIncomeId: number) {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  const income = await requireTenantOtherIncome(tenantId, otherIncomeId);
  await prisma.otherIncome.delete({ where: { id: income.id } });
  revalidatePath("/accounting");
}

export async function getAccountingPage(options?: {
  taxYearStart?: number | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
}) {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  await Promise.all([
    materialiseRecurringExpenseTemplates(tenantId),
    materialiseRecurringOtherIncomeTemplates(tenantId),
  ]);

  const currentTaxYearStart = getCurrentTaxYearStart();
  const selectedTaxYearStart = Number.isInteger(options?.taxYearStart)
    ? Number(options?.taxYearStart)
    : currentTaxYearStart;
  const taxYearRangeStart = getTaxYearStartDate(selectedTaxYearStart);
  const taxYearRangeEnd = getTaxYearStartDate(selectedTaxYearStart + 1);
  const customDateFrom = options?.dateFrom ? utcDay(new Date(options.dateFrom)) : null;
  const customDateToExclusive = options?.dateTo ? addUtcDays(utcDay(new Date(options.dateTo)), 1) : null;
  const rangeStart = customDateFrom && customDateFrom > taxYearRangeStart ? customDateFrom : taxYearRangeStart;
  const rangeEnd = customDateToExclusive && customDateToExclusive < taxYearRangeEnd ? customDateToExclusive : taxYearRangeEnd;
  const monthSeriesStart = getUtcMonthStart(rangeStart);

  const [payments, expenses, otherIncomeEntries] = await Promise.all([
    prisma.payment.findMany({
      where: { tenantId, voidedAt: null, paidAt: { gte: rangeStart, lt: rangeEnd } },
      select: { id: true, amount: true, paidAt: true, method: true, customer: { select: { id: true, name: true } } },
      orderBy: { paidAt: "desc" },
    }),
    prisma.expense.findMany({
      where: { tenantId, expenseDate: { gte: rangeStart, lt: rangeEnd } },
      orderBy: { expenseDate: "desc" },
    }),
    prisma.otherIncome.findMany({
      where: { tenantId, receivedAt: { gte: rangeStart, lt: rangeEnd } },
      orderBy: { receivedAt: "desc" },
    }),
  ]);

  const incomeByMonth = new Map<string, number>();
  const expenseByMonth = new Map<string, number>();
  const expenseCountByMonth = new Map<string, number>();
  const paymentCountByMonth = new Map<string, number>();
  const expenseCategoryBreakdown = new Map<string, Record<string, number>>();
  const incomeVatByMonth = new Map<string, number>();
  const expenseVatByMonth = new Map<string, number>();

  for (const payment of payments) {
    const key = getMonthKey(payment.paidAt);
    incomeByMonth.set(key, Number(((incomeByMonth.get(key) ?? 0) + payment.amount).toFixed(2)));
    paymentCountByMonth.set(key, (paymentCountByMonth.get(key) ?? 0) + 1);
  }

  for (const income of otherIncomeEntries) {
    const key = getMonthKey(income.receivedAt);
    incomeByMonth.set(key, Number(((incomeByMonth.get(key) ?? 0) + income.amount).toFixed(2)));
    paymentCountByMonth.set(key, (paymentCountByMonth.get(key) ?? 0) + 1);
    incomeVatByMonth.set(key, Number(((incomeVatByMonth.get(key) ?? 0) + income.vatAmount).toFixed(2)));
  }

  for (const expense of expenses) {
    const key = getMonthKey(expense.expenseDate);
    expenseByMonth.set(key, Number(((expenseByMonth.get(key) ?? 0) + expense.amount).toFixed(2)));
    expenseCountByMonth.set(key, (expenseCountByMonth.get(key) ?? 0) + 1);
    expenseVatByMonth.set(key, Number(((expenseVatByMonth.get(key) ?? 0) + expense.vatAmount).toFixed(2)));

    const current = expenseCategoryBreakdown.get(key) ?? {};
    current[expense.category] = Number(((current[expense.category] ?? 0) + expense.amount).toFixed(2));
    expenseCategoryBreakdown.set(key, current);
  }

  const monthStarts: Date[] = [];
  for (let cursor = monthSeriesStart; cursor < rangeEnd; cursor = addUtcMonths(cursor, 1)) {
    monthStarts.push(cursor);
  }

  const monthlySummaries = monthStarts.map((monthStart) => {
    const monthKey = getMonthKey(monthStart);
    const income = incomeByMonth.get(monthKey) ?? 0;
    const expenseTotal = expenseByMonth.get(monthKey) ?? 0;
    return {
      monthKey,
      monthLabel: getMonthLabel(monthStart),
      income,
      incomeVat: incomeVatByMonth.get(monthKey) ?? 0,
      expenses: expenseTotal,
      expenseVat: expenseVatByMonth.get(monthKey) ?? 0,
      net: Number((income - expenseTotal).toFixed(2)),
      paymentCount: paymentCountByMonth.get(monthKey) ?? 0,
      expenseCount: expenseCountByMonth.get(monthKey) ?? 0,
      categoryBreakdown: expenseCategoryBreakdown.get(monthKey) ?? {},
    };
  });

  const totalIncome = Number(monthlySummaries.reduce((sum, month) => sum + month.income, 0).toFixed(2));
  const totalExpenses = Number(monthlySummaries.reduce((sum, month) => sum + month.expenses, 0).toFixed(2));
  const totalIncomeVat = Number(monthlySummaries.reduce((sum, month) => sum + month.incomeVat, 0).toFixed(2));
  const totalExpenseVat = Number(monthlySummaries.reduce((sum, month) => sum + month.expenseVat, 0).toFixed(2));
  const totalNet = Number((totalIncome - totalExpenses).toFixed(2));

  return {
    monthlySummaries,
    recentExpenses: expenses.slice(0, 40).map((expense) => ({
      ...expense,
      categoryLabel: getExpenseCategory(expense.category).label,
      hmrcLabel: getExpenseCategory(expense.category).hmrcLabel,
      taxTreatmentLabel: getTaxTreatment(expense.taxTreatment).label,
    })),
    recentPayments: payments.slice(0, 25).map((payment) => ({ ...payment, sourceLabel: "Customer payment", sourceType: "PAYMENT" as const })),
    recentOtherIncome: otherIncomeEntries.slice(0, 25).map((income) => ({
      ...income,
      categoryLabel: getOtherIncomeCategory(income.category).label,
      sourceLabel: income.source || getOtherIncomeCategory(income.category).label,
      taxTreatmentLabel: getTaxTreatment(income.taxTreatment).label,
      sourceType: "OTHER_INCOME" as const,
    })),
    totals: {
      income: totalIncome,
      expenses: totalExpenses,
      net: totalNet,
      incomeVat: totalIncomeVat,
      expenseVat: totalExpenseVat,
    },
    selectedTaxYearStart,
    selectedTaxYearLabel: getTaxYearLabel(selectedTaxYearStart),
    activeDateFrom: rangeStart.toISOString().slice(0, 10),
    activeDateTo: addUtcDays(rangeEnd, -1).toISOString().slice(0, 10),
    availableTaxYears: Array.from({ length: 5 }, (_, index) => {
      const yearStart = currentTaxYearStart - index;
      return { value: yearStart, label: getTaxYearLabel(yearStart) };
    }),
    expenseCategories: EXPENSE_CATEGORIES,
    otherIncomeCategories: OTHER_INCOME_CATEGORIES,
    taxTreatmentOptions: TAX_TREATMENT_OPTIONS,
    exportGeneratedAt: new Date().toISOString(),
  };
}

export async function getOutstandingJobs() {
  const actor = await requirePerm("payments");
  const tenantId = actor.tenantId;
  return prisma.job.findMany({ where: { tenantId, status: "OUTSTANDING" },
    include: {
      customer: { include: { area: true } },
      workDay: true,
    },
    orderBy: { workDay: { date: "asc" } },
  });
}

export async function getCustomerBalance(customerId: number) {
  const actor = await requireMember();
  if (!hasPermission(actor, "customers") && !hasPermission(actor, "payments")) throw new AccessDeniedError();
  const tenantId = actor.tenantId;
  const jobs = await prisma.job.findMany({
    where: { customerId, tenantId, status: "COMPLETE" },
    select: {
      price: true,
      allocations: {
        where: { payment: { voidedAt: null } },
        select: { amount: true },
      },
    },
  });
  return Number(
    jobs.reduce((sum, j) => {
      const paid = j.allocations.reduce((s, a) => s + a.amount, 0);
      return sum + Math.max(0, j.price - paid);
    }, 0).toFixed(2)
  );
}

// ── Business Settings ────────────────────────────────────────────────────────

/**
 * Business settings for display (invoices, customer page, payments). Provider
 * credentials are never returned: only whether they are configured.
 */
export async function getBusinessSettings() {
  const actor = await requireMember();
  if (!(["customers", "payments", "settings"] as const).some((perm) => hasPermission(actor, perm))) {
    throw new AccessDeniedError();
  }
  const settings = await loadBusinessSettings(actor.tenantId);
  return {
    ...settings,
    smtpPass: "",
    voodooApiKey: "",
    twilioAuthToken: "",
    metaAccessToken: "",
    goCardlessAccessToken: "",
    goCardlessConfigured: Boolean(settings.goCardlessAccessToken),
  };
}

/** Internal: full settings row with decrypted credentials. Never return this to a client. */
async function loadBusinessSettings(tenantId: number) {
  const settings = await loadBusinessSettingsRaw(tenantId);
  return decryptSettingsSecrets(settings);
}

async function loadBusinessSettingsRaw(tenantId: number) {
  let settings = await prisma.tenantSettings.findFirst({ where: { tenantId } });

  const [tenant, owner] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: tenantId }, select: { name: true, phone: true, address: true } }),
    prisma.user.findFirst({ where: { tenantId, role: "OWNER" }, select: { name: true, email: true } }),
  ]);

  const seededValues = {
    businessName: settings?.businessName?.trim() || tenant?.name || "My Window Cleaning",
    ownerName: settings?.ownerName?.trim() || owner?.name?.trim() || "",
    email: settings?.email?.trim() || owner?.email || "",
    phone: settings?.phone?.trim() || tenant?.phone || "",
    address: settings?.address?.trim() || tenant?.address || "",
  };

  if (!settings) {
    settings = await prisma.tenantSettings.create({ data: { tenantId, ...seededValues } });
    return settings;
  }

  const updateData = Object.fromEntries(
    Object.entries(seededValues).filter(([key, value]) => {
      const currentEntry = (settings as Record<string, unknown> | null)?.[key];
      const currentValue = typeof currentEntry === "string" ? currentEntry.trim() : currentEntry;
      return (
        (typeof currentValue !== "string" || currentValue.length === 0) &&
        typeof value === "string" &&
        value.length > 0
      );
    })
  );

  if (Object.keys(updateData).length > 0) {
    settings = await prisma.tenantSettings.update({ where: { tenantId }, data: updateData });
  }

  return settings;
}

const PROVIDER_SECRET_FIELDS = [
  "smtpPass",
  "voodooApiKey",
  "twilioAuthToken",
  "metaAccessToken",
  "goCardlessAccessToken",
] as const;

const OWNER_PROVIDER_FIELDS = [
  "smtpProvider",
  "smtpHost",
  "smtpPort",
  "smtpUser",
  "smtpPass",
  "smtpFromName",
  "voodooApiKey",
  "voodooSender",
  "messagingProvider",
  "twilioAccountSid",
  "twilioAuthToken",
  "twilioFromNumber",
  "metaPhoneNumberId",
  "metaAccessToken",
  "metaWabaId",
  "goCardlessAccessToken",
  "goCardlessEnvironment",
  "goCardlessReferencePrefix",
  "tmplCleaningReminder",
  "tmplJobComplete",
  "tmplPaymentReminder1",
  "tmplPaymentReminder2",
  "tmplPaymentReminder3",
  "tmplPaymentReceived",
  "tmplJobAndPayment",
  "tmplInvoiceNote",
] as const;

export async function getBusinessSettingsForClient() {
  const actor = await requirePerm("settings");
  const settings = await loadBusinessSettings(actor.tenantId);
  const canManageProviderSettings = !actor.isWorker;

  return {
    businessName: settings.businessName,
    ownerName: settings.ownerName,
    phone: settings.phone,
    email: settings.email,
    address: settings.address,
    bankDetails: settings.bankDetails,
    vatNumber: settings.vatNumber,
    invoicePrefix: settings.invoicePrefix,
    nextInvoiceNum: settings.nextInvoiceNum,
    invoiceNumbersStarted: settings.invoiceNumbersStarted,
    invoiceVatEnabled: settings.invoiceVatEnabled,
    allowCustomerCredit: settings.allowCustomerCredit,
    keepWorkerOnNextRun: settings.keepWorkerOnNextRun,
    invoiceVatRate: settings.invoiceVatRate,
    invoicePaymentTerms: settings.invoicePaymentTerms,
    logoBase64: settings.logoBase64,
    goCardlessEnvironment: settings.goCardlessEnvironment,
    goCardlessReferencePrefix: settings.goCardlessReferencePrefix,
    goCardlessAccessTokenConfigured: Boolean(settings.goCardlessAccessToken),
    goCardlessLastSyncedAt: settings.goCardlessLastSyncedAt?.toISOString() ?? null,
    smtpProvider: settings.smtpProvider,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpFromName: settings.smtpFromName,
    smtpPassConfigured: Boolean(settings.smtpPass),
    voodooSender: settings.voodooSender,
    voodooApiKeyConfigured: Boolean(settings.voodooApiKey),
    messagingProvider: settings.messagingProvider,
    twilioAccountSid: settings.twilioAccountSid,
    twilioAuthTokenConfigured: Boolean(settings.twilioAuthToken),
    twilioFromNumber: settings.twilioFromNumber,
    metaPhoneNumberId: settings.metaPhoneNumberId,
    metaAccessTokenConfigured: Boolean(settings.metaAccessToken),
    metaWabaId: settings.metaWabaId,
    tmplCleaningReminder: settings.tmplCleaningReminder,
    tmplJobComplete: settings.tmplJobComplete,
    tmplPaymentReminder1: settings.tmplPaymentReminder1,
    tmplPaymentReminder2: settings.tmplPaymentReminder2,
    tmplPaymentReminder3: settings.tmplPaymentReminder3,
    tmplPaymentReceived: settings.tmplPaymentReceived,
    tmplJobAndPayment: settings.tmplJobAndPayment,
    tmplInvoiceNote: settings.tmplInvoiceNote,
    tmplCleanedBank: settings.tmplCleanedBank,
    textsTestMode: settings.textsTestMode,
    textSendMethod: settings.textSendMethod,
    textCleanedEnabled: settings.textCleanedEnabled,
    textSkipCleanedIfPaid: settings.textSkipCleanedIfPaid,
    textPaymentReminderDays: settings.textPaymentReminderDays,
    textPaymentReminder2Days: settings.textPaymentReminder2Days,
    runDueWindowDays: settings.runDueWindowDays ?? null,
    textsServerLive: process.env.MESSAGING_LIVE === "true",
    canManageProviderSettings,
  };
}

const SETTINGS_FIELDS = ["businessName", "ownerName", "phone", "email", "address", "bankDetails", "vatNumber", "invoicePrefix", "nextInvoiceNum", "invoiceVatEnabled", "allowCustomerCredit", "keepWorkerOnNextRun", "invoiceVatRate", "invoicePaymentTerms", "logoBase64", "goCardlessAccessToken", "goCardlessEnvironment", "goCardlessReferencePrefix", "smtpProvider", "smtpHost", "smtpPort", "smtpUser", "smtpPass", "smtpFromName", "voodooApiKey", "voodooSender", "messagingProvider", "twilioAccountSid", "twilioAuthToken", "twilioFromNumber", "metaPhoneNumberId", "metaAccessToken", "metaWabaId", "tmplCleaningReminder", "tmplJobComplete", "tmplPaymentReminder1", "tmplPaymentReminder2", "tmplPaymentReminder3", "tmplPaymentReceived", "tmplJobAndPayment", "tmplInvoiceNote", "tmplCleanedBank", "textSendMethod", "textsTestMode", "textCleanedEnabled", "textSkipCleanedIfPaid", "textPaymentReminderDays", "textPaymentReminder2Days", "runDueWindowDays"] as const;

export async function updateBusinessSettings(data: {
  businessName?: string;
  ownerName?: string;
  phone?: string;
  email?: string;
  address?: string;
  bankDetails?: string;
  vatNumber?: string;
  invoicePrefix?: string;
  /** First invoice number. Only accepted until the first invoice is issued. */
  nextInvoiceNum?: number;
  invoiceVatEnabled?: boolean;
  allowCustomerCredit?: boolean;
  keepWorkerOnNextRun?: boolean;
  invoiceVatRate?: number;
  invoicePaymentTerms?: string;
  logoBase64?: string | null;
  goCardlessAccessToken?: string;
  goCardlessEnvironment?: string;
  goCardlessReferencePrefix?: string;
  smtpProvider?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFromName?: string;
  voodooApiKey?: string;
  voodooSender?: string;
  // Messaging / Twilio
  messagingProvider?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  // Meta WhatsApp Cloud API
  metaPhoneNumberId?: string;
  metaAccessToken?: string;
  metaWabaId?: string;
  // Message templates
  tmplCleaningReminder?: string;
  tmplJobComplete?: string;
  tmplPaymentReminder1?: string;
  tmplPaymentReminder2?: string;
  tmplPaymentReminder3?: string;
  tmplPaymentReceived?: string;
  tmplJobAndPayment?: string;
  tmplInvoiceNote?: string;
  tmplCleanedBank?: string;
  // Automatic texts
  textSendMethod?: string;
  textsTestMode?: boolean;
  textCleanedEnabled?: boolean;
  textSkipCleanedIfPaid?: boolean;
  textPaymentReminderDays?: number;
  textPaymentReminder2Days?: number;
  // Scheduling
  runDueWindowDays?: number | null;
}) {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;
  const user = await requireAuth();
  const canManageProviderSettings = !actor.isWorker;
  // Only these fields, as plain values (see safe-input.ts).
  const updateData: Record<string, unknown> = pickPlain(data, SETTINGS_FIELDS);
  if (typeof updateData.logoBase64 === "string" && !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(updateData.logoBase64)) {
    throw new Error("The logo must be a PNG, JPG or WebP picture.");
  }
  const businessName = typeof updateData.businessName === "string" ? updateData.businessName.trim() : undefined;
  const ownerName = typeof updateData.ownerName === "string" ? updateData.ownerName.trim() : undefined;
  const phone = typeof updateData.phone === "string" ? updateData.phone.trim() : undefined;
  const email = typeof updateData.email === "string" ? updateData.email.trim().toLowerCase() : undefined;
  const address = typeof updateData.address === "string" ? updateData.address.trim() : undefined;
  const goCardlessEnvironment = typeof updateData.goCardlessEnvironment === "string"
    ? updateData.goCardlessEnvironment.trim().toLowerCase()
    : undefined;
  const goCardlessReferencePrefix = typeof updateData.goCardlessReferencePrefix === "string"
    ? updateData.goCardlessReferencePrefix.trim().toUpperCase()
    : undefined;

  if (updateData.invoiceVatRate !== undefined) {
    const rate = Number(updateData.invoiceVatRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("VAT rate must be between 0 and 100.");
    updateData.invoiceVatRate = Math.round(rate * 100) / 100;
  }
  if (typeof updateData.invoicePaymentTerms === "string") updateData.invoicePaymentTerms = updateData.invoicePaymentTerms.slice(0, 1000);
  if (updateData.nextInvoiceNum !== undefined) {
    const n = Math.floor(Number(updateData.nextInvoiceNum));
    const current = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { invoiceNumbersStarted: true, nextInvoiceNum: true } });
    if (current?.invoiceNumbersStarted) {
      // Locked: invoices already carry numbers, so changing it could duplicate or skip them.
      delete updateData.nextInvoiceNum;
    } else if (!Number.isFinite(n) || n < 1 || n > 9999999) {
      throw new Error("Invoice start number must be a whole number from 1.");
    } else {
      updateData.nextInvoiceNum = n;
    }
  }
  if (businessName !== undefined) updateData.businessName = businessName;
  if (ownerName !== undefined) updateData.ownerName = ownerName;
  if (phone !== undefined) updateData.phone = phone;
  if (email !== undefined) updateData.email = email;
  if (address !== undefined) updateData.address = address;
  if (goCardlessEnvironment !== undefined) {
    updateData.goCardlessEnvironment = goCardlessEnvironment === "sandbox" ? "sandbox" : "live";
  }
  if (goCardlessReferencePrefix !== undefined) {
    updateData.goCardlessReferencePrefix = goCardlessReferencePrefix || "WD";
  }

  if (!canManageProviderSettings) {
    for (const field of OWNER_PROVIDER_FIELDS) {
      delete updateData[field];
    }
  }

  for (const field of PROVIDER_SECRET_FIELDS) {
    const value = updateData[field];
    if (typeof value === "string" && value.trim() === "") {
      delete updateData[field];
    } else if (typeof value === "string") {
      updateData[field] = encryptSecret(value.trim());
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.tenantSettings.upsert({ where: { tenantId },
      create: { tenantId, ...updateData },
      update: updateData,
    });

    const tenantUpdate: Record<string, unknown> = {};
    if (businessName !== undefined) tenantUpdate.name = businessName;
    if (phone !== undefined) tenantUpdate.phone = phone;
    if (address !== undefined) tenantUpdate.address = address;

    if (Object.keys(tenantUpdate).length > 0) {
      await tx.tenant.update({
        where: { id: tenantId },
        data: tenantUpdate,
      });
    }

    if ((user.role === "OWNER" || user.role === "SUPER_ADMIN") && ownerName !== undefined && ownerName.length > 0) {
      const owner = await tx.user.findFirst({
        where: { tenantId, role: "OWNER" },
        select: { id: true },
      });

      if (owner) {
        await tx.user.update({
          where: { id: owner.id },
          data: { name: ownerName },
        });
      }
    }
  });
  revalidatePath("/settings");
}

/** Mark cleans as invoiced by hand (no PDF), or clear the mark. */
export async function markJobsInvoiced(customerId: number, jobIds: number[], invoiced: boolean) {
  const actor = await requireMember();
  if (!hasPermission(actor, "payments") && !hasPermission(actor, "customers")) throw new AccessDeniedError();
  const ids = jobIds.filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return { count: 0 };
  const r = await prisma.job.updateMany({
    where: { id: { in: ids }, customerId, tenantId: actor.tenantId },
    data: invoiced ? { invoicedAt: new Date() } : { invoicedAt: null, invoiceNumber: "" },
  });
  revalidatePath(`/customers/${customerId}`);
  return { count: r.count };
}

export async function claimNextInvoiceNumber(): Promise<string> {
  const actor = await requirePerm("payments");
  const tenantId = actor.tenantId;
  await loadBusinessSettings(tenantId); // makes sure the settings row exists
  // Atomic, so two invoices at once never get the same number. The first one locks the start number.
  const row = await prisma.tenantSettings.update({ where: { tenantId },
    data: { nextInvoiceNum: { increment: 1 }, invoiceNumbersStarted: true },
    select: { nextInvoiceNum: true, invoicePrefix: true },
  });
  const num = row.nextInvoiceNum - 1;
  return `${row.invoicePrefix}-${String(num).padStart(4, "0")}`;
}

// ── Tags ─────────────────────────────────────────────────────────────────────

export async function getTags() {
  const actor = await requireMember();
  const tenantId = actor.tenantId;
  return prisma.tag.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
}

export async function createTag(data: { name: string; color: string }) {
  const actor = await requirePerm("customers");
  const tenantId = actor.tenantId;
  await prisma.tag.create({ data: { name: String(data?.name ?? "").trim().slice(0, 40), color: String(data?.color ?? "#3B82F6").slice(0, 20), tenantId } });
  revalidatePath("/settings");
}

export async function deleteTag(id: number) {
  const actor = await requirePerm("customers");
  const tenantId = actor.tenantId;
  const tag = await requireTenantTag(tenantId, id);
  await prisma.tag.delete({ where: { id: tag.id } });
  revalidatePath("/settings");
}

// ─── Job ordering & notes ──────────────────────────────────────────────────

/**
 * Persist a custom job order within a work day.
 * orderedJobIds: all jobIds for that day in the desired order (index = sortOrder).
 */
type RouteOrderingMode = "MANUAL" | "OPTIMISED";

function serialiseRouteOrder(jobIds: number[]) {
  return JSON.stringify(jobIds);
}

function parseRouteOrder(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is number => Number.isInteger(value))
      : [];
  } catch {
    return [];
  }
}

function resolveRouteOrderSnapshot(snapshotIds: number[], liveIds: number[]) {
  const liveIdSet = new Set(liveIds);
  const ordered = snapshotIds.filter((id) => liveIdSet.has(id));
  const orderedSet = new Set(ordered);
  return [...ordered, ...liveIds.filter((id) => !orderedSet.has(id))];
}

async function persistRouteOrder(
  tx: any,
  workDayId: number,
  orderedJobIds: number[],
  mode: RouteOrderingMode,
) {
  await Promise.all(
    orderedJobIds.map((id, index) =>
      tx.job.update({ where: { id }, data: { sortOrder: index } })
    )
  );

  await tx.workDay.update({
    where: { id: workDayId },
    data: mode === "MANUAL"
      ? {
          routeOrderingMode: mode,
          manualRouteOrder: serialiseRouteOrder(orderedJobIds),
        }
      : {
          routeOrderingMode: mode,
          optimizedRouteOrder: serialiseRouteOrder(orderedJobIds),
        },
  });
}

async function requireRouteOptimiserPermission() {
  await requirePerm("routeoptimiser");
}

export async function reorderDayJobs(
  workDayId: number,
  orderedJobIds: number[],
  mode: RouteOrderingMode = "MANUAL",
) {
  const actor = await requireReorder();
  const tenantId = actor.tenantId;
  await requireTenantWorkDay(tenantId, workDayId);
  const jobs = await prisma.job.findMany({ where: { tenantId, workDayId, id: { in: orderedJobIds } }, select: { id: true } });
  if (jobs.length !== orderedJobIds.length) throw new Error("One or more jobs were not found for this day");
  await prisma.$transaction(async (tx) => {
    await persistRouteOrder(tx, workDayId, orderedJobIds, mode);
  });
  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/scheduler");
}

export async function applyOptimizedRouteOrder(workDayId: number, orderedJobIds: number[]) {
  await requireRouteOptimiserPermission();
  await reorderDayJobs(workDayId, orderedJobIds, "OPTIMISED");
}

export async function setWorkDayRouteOrderingMode(workDayId: number, mode: RouteOrderingMode) {
  if (mode === "OPTIMISED") {
    await requireRouteOptimiserPermission();
  }

  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  await requireTenantWorkDay(tenantId, workDayId);
  const workDay = await prisma.workDay.findFirst({
    where: { id: workDayId, tenantId },
    select: {
      id: true,
      manualRouteOrder: true,
      optimizedRouteOrder: true,
      jobs: {
        select: { id: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!workDay) {
    throw new Error("Work day not found");
  }

  const liveIds = workDay.jobs.map((job) => job.id);
  const snapshot = mode === "MANUAL"
    ? parseRouteOrder(workDay.manualRouteOrder)
    : parseRouteOrder(workDay.optimizedRouteOrder);

  if (snapshot.length === 0) {
    throw new Error(
      mode === "MANUAL"
        ? "No saved manual route exists for this day yet."
        : "No optimised route has been saved for this day yet.",
    );
  }

  const resolvedOrder = resolveRouteOrderSnapshot(snapshot, liveIds);

  await prisma.$transaction(async (tx) => {
    await persistRouteOrder(tx, workDayId, resolvedOrder, mode);
  });

  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/scheduler");
}

/** Update the notes field on a specific job (day-specific note, separate from customer notes). */
export async function updateJobNotes(jobId: number, notes: string) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  await requireTenantJob(tenantId, jobId);
  const job = await prisma.job.update({
    where: { id: jobId },
    data: { notes: notes.trim() || null },
  });
  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/scheduler");
  revalidatePath("/payments");
  revalidatePath(`/customers/${job.customerId}`);
}

export async function updateJobPrice(jobId: number, price: number) {
  const actor = await requirePerm("schedule");
  if (!hasPermission(actor, "viewprices")) throw new AccessDeniedError();
  const tenantId = actor.tenantId;
  if (!Number.isFinite(price) || price < 0) throw new Error("Price must be zero or greater.");
  await requireTenantJob(tenantId, jobId);
  const job = await prisma.job.update({
    where: { id: jobId },
    data: { price },
  });
  if (job.status === "COMPLETE") await releaseOverpaid(tenantId, jobId);
  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/scheduler");
  revalidatePath(`/customers/${job.customerId}`);
  revalidatePath("/payments");
}

/** Update a job's descriptor (name) and/or price in one call. Used by the Log Payment screen. */
export async function updateJobDetails(
  jobId: number,
  data: { name?: string; price?: number }
) {
  const actor = await requirePerm("schedule");
  if (data.price !== undefined && !hasPermission(actor, "viewprices")) throw new AccessDeniedError();
  const tenantId = actor.tenantId;
  await requireTenantJob(tenantId, jobId);

  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) {
    updates.name = data.name.trim() || "Window Cleaning";
  }
  if (data.price !== undefined) {
    const price = Number(data.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error("Job amount must be zero or greater.");
    }
    updates.price = price;
  }
  if (Object.keys(updates).length === 0) return;

  const job = await prisma.job.update({
    where: { id: jobId },
    data: updates,
  });
  if (data.price !== undefined && job.status === "COMPLETE") await releaseOverpaid(tenantId, jobId);
  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/scheduler");
  revalidatePath(`/customers/${job.customerId}`);
  revalidatePath("/payments");
}

export async function addJobToWorkDay(workDayId: number, customerId: number, price?: number) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const [customer] = await Promise.all([
    requireTenantCustomer(tenantId, customerId),
    requireTenantWorkDay(tenantId, workDayId),
  ]);
  const existing = await prisma.job.findFirst({ where: { tenantId, workDayId, customerId } });
  if (existing) throw new Error("Customer already on this day");
  const job = await prisma.job.create({ data: { tenantId,
      workDayId,
      customerId,
      name: "Window Cleaning",
      price: price ?? customer.price,
      status: "PENDING",
      sortOrder: await endOfDay(workDayId),
    },
  });
  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/scheduler");
  return job;
}

export async function setCustomerTags(customerId: number, tagIds: number[]) {
  const actor = await requirePerm("customers");
  const tenantId = actor.tenantId;
  await requireTenantCustomer(tenantId, customerId);
  if (tagIds.length > 0) {
    const tags = await prisma.tag.findMany({ where: { tenantId, id: { in: tagIds } }, select: { id: true } });
    if (tags.length !== tagIds.length) throw new Error("One or more tags were not found");
  }
  await prisma.$transaction([
    prisma.customerTag.deleteMany({ where: { customerId } }),
    ...(tagIds.length > 0
      ? [prisma.customerTag.createMany({
          data: tagIds.map((tagId) => ({ customerId, tagId })),
        })]
      : []),
  ]);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
}

// ─── Unfinished Jobs (for scheduler rescheduling) ──────────────────────────

/**
 * Returns all PENDING or IN_PROGRESS jobs whose work day date is on or before
 * today. These are jobs that were scheduled but not completed or explicitly
 * skipped — they can be dragged onto a new day in the scheduler.
 */
export async function getPendingUnfinishedJobs() {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const today = utcDay(new Date());
  return prisma.job.findMany({ where: { tenantId,
      status: "PENDING",
      workDay: { date: { lt: today } },  // strictly before today — today's jobs are still in-progress
      ...visibleJobWhere(actor),
    },
    include: {
      customer: { include: { area: true } },
      workDay: { include: { area: true } },
    },
    orderBy: { workDay: { date: "asc" } },
  });
}

/**
 * Move a single job to a different date without altering the customer's
 * recurring nextDueDate. Finds or creates a work day on the target date
 * using the same area as the job's current work day.
 */
export async function rescheduleJobToDate(jobId: number, dateISO: string) {
  await moveJobsToDate([jobId], dateISO);
}

// ─── Update job completedAt date ─────────────────────────────────────────────

export async function updateJobCompletedAt(jobId: number, isoDate: string) {
  const actor = await requirePerm("schedule");
  const tenantId = actor.tenantId;
  const d = isoToUTC(isoDate);

  const job = await prisma.job.findFirst({
    where: { id: jobId, tenantId, ...visibleJobWhere(actor) },
    include: { customer: true, workDay: { select: { areaId: true } } },
  });
  if (!job) throw new Error("Job not found");

  await prisma.job.update({
    where: { id: jobId },
    data: { completedAt: d },
  });

  const latestCompleted = await prisma.job.findFirst({ where: { tenantId, customerId: job.customerId, status: "COMPLETE" },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });

  await prisma.customer.update({
    where: { id: job.customerId },
    data: {
      lastCompletedDate: latestCompleted?.completedAt ?? d,
      nextDueDate: calcNextDue(latestCompleted?.completedAt ?? d, job.customer.frequencyWeeks),
    },
  });

  if (job.workDay.areaId) {
    const area = await prisma.area.findFirst({
      where: { id: job.workDay.areaId, tenantId },
      select: { id: true, scheduleType: true, frequencyWeeks: true, monthlyDay: true },
    });

    if (area) {
      const latestCompletedDay = await prisma.workDay.findFirst({
        where: { tenantId, areaId: area.id, status: "COMPLETE" },
        orderBy: { date: "desc" },
        select: { date: true },
      });

      if (latestCompletedDay) {
        const nextDue = nextRunAfter(area, latestCompletedDay.date);
        await prisma.area.update({
          where: { id: area.id },
          data: { lastCompletedDate: latestCompletedDay.date, nextDueDate: nextDue },
        });
      }
    }
  }

  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath(`/customers/${job.customerId}`);
  revalidatePath("/days");
  revalidatePath("/scheduler");
}

// ─── Holidays ───────────────────────────────────────────────────────────────

export async function getHolidays() {
  const actor = await requireMember();
  const tenantId = actor.tenantId;
  return prisma.holiday.findMany({
    where: { tenantId },
    orderBy: [{ startDate: "asc" }, { endDate: "asc" }],
  });
}

export async function createHoliday(data: { startDate: string; endDate: string; label: string }) {
  const actor = await requirePerm("scheduler");
  const tenantId = actor.tenantId;
  const startDate = isoToUTC(data.startDate);
  const endDate = isoToUTC(data.endDate);

  if (endDate < startDate) throw new Error("End date must be on or after start date");

  await prisma.holiday.create({ data: { tenantId,
      startDate,
      endDate,
      label: data.label.trim() || "Holiday",
    },
  });

  revalidatePath("/scheduler");
}

export async function updateHoliday(id: number, data: { startDate: string; endDate: string; label: string }) {
  const actor = await requirePerm("scheduler");
  const tenantId = actor.tenantId;
  const startDate = isoToUTC(data.startDate);
  const endDate = isoToUTC(data.endDate);

  if (endDate < startDate) throw new Error("End date must be on or after start date");

  const holiday = await requireTenantHoliday(tenantId, id);
  await prisma.holiday.update({
    where: { id: holiday.id },
    data: {
      startDate,
      endDate,
      label: data.label.trim() || "Holiday",
    },
  });

  revalidatePath("/scheduler");
}

export async function deleteHoliday(id: number) {
  const actor = await requirePerm("scheduler");
  const tenantId = actor.tenantId;
  const holiday = await requireTenantHoliday(tenantId, id);
  await prisma.holiday.delete({ where: { id: holiday.id } });
  revalidatePath("/scheduler");
}



/** Pin a customer to a map position (overrides the address lookup), or clear it with null. */
export async function setCustomerPin(customerId: number, pin: { latitude: number; longitude: number } | null) {
  const actor = await requirePerm("customers");
  await requireTenantCustomer(actor.tenantId, customerId);
  if (pin) {
    const { latitude, longitude } = pin;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new Error("That isn't a valid map position.");
    }
  }
  await prisma.customer.update({
    where: { id: customerId },
    data: { latitude: pin?.latitude ?? null, longitude: pin?.longitude ?? null },
  });
  revalidatePath(`/customers/${customerId}`);
}

/** Change who cleaned a finished job (owner only). Used for worker pay. */
export async function updateJobCompletedBy(jobId: number, userId: string) {
  const actor = await requireOwner();
  const job = await requireTenantJob(actor.tenantId, jobId);
  const member = await prisma.membership.findFirst({ where: { tenantId: actor.tenantId, userId }, select: { id: true } });
  if (!member) throw new Error("That person isn't in your team.");
  await prisma.job.update({ where: { id: jobId }, data: { completedByUserId: userId } });
  revalidatePath(`/days/${job.workDayId}`);
}

// ─── Bank statement / spreadsheet payment import ─────────────────────────────
// The file is read in the browser and never sent here. Only rows the user has
// checked and ticked arrive, with just the fields needed to record a payment.

const IMPORT_HASH = /^[a-f0-9]{64}$/;
const IMPORT_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Everything the import screen needs to suggest matches: what's owed, and learned references. */
export async function getBankImportData() {
  const actor = await requirePerm("payments");
  const tenantId = actor.tenantId;
  const [settings, customers, jobs, references] = await Promise.all([
    prisma.tenantSettings.findUnique({ where: { tenantId }, select: { goCardlessReferencePrefix: true, allowCustomerCredit: true } }),
    prisma.customer.findMany({
      where: { tenantId, isProspect: false },
      select: { id: true, name: true, address: true, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.job.findMany({
      where: { tenantId, status: "COMPLETE", isQuote: false },
      select: {
        id: true, price: true, customerId: true, name: true,
        customer: { select: { name: true } },
        workDay: { select: { date: true } },
        allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
      },
      orderBy: [{ workDay: { date: "asc" } }, { id: "asc" }],
    }),
    prisma.payerReference.findMany({ where: { tenantId }, select: { key: true, customerId: true, ignore: true } }),
  ]);
  const prefix = settings?.goCardlessReferencePrefix || "WD";
  const unpaidBy = new Map<number, Array<{ jobId: number; due: number; date: string | null; label: string }>>();
  for (const job of jobs) {
    const due = round2(job.price - job.allocations.reduce((s, a) => s + a.amount, 0));
    if (due <= 0.005) continue;
    const entry = {
      jobId: job.id,
      due,
      date: job.workDay?.date ? job.workDay.date.toISOString().slice(0, 10) : null,
      label: job.name,
    };
    const list = unpaidBy.get(job.customerId) ?? [];
    list.push(entry);
    unpaidBy.set(job.customerId, list);
  }
  return {
    tenantId,
    allowCredit: settings?.allowCustomerCredit ?? true,
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      address: c.address,
      active: c.active,
      reference: c.address.split(",")[0]?.trim() || c.name,
      wyndosRef: `${prefix}-C${c.id}`,
      unpaid: unpaidBy.get(c.id) ?? [],
    })),
    references,
  };
}

/** Which of these line fingerprints were already dealt with in an earlier import. */
export async function findImportedLines(hashes: string[]) {
  const actor = await requirePerm("payments");
  const clean = [...new Set(hashes.filter((h) => typeof h === "string" && IMPORT_HASH.test(h)))].slice(0, 5000);
  if (clean.length === 0) return [];
  const found = await prisma.importedLine.findMany({ where: { tenantId: actor.tenantId, hash: { in: clean } }, select: { hash: true } });
  return found.map((f) => f.hash);
}

export type BankImportRow =
  | { action: "pay"; hash: string; date: string; amount: number; text: string; customerId: number; allocations: Array<{ jobId: number; amount: number }>; extra: number; learn: boolean }
  | { action: "ignore"; hash: string; text: string; learn: boolean };

async function learnReference(tenantId: number, text: string, customerId: number | null) {
  const label = text.trim().slice(0, 60);
  for (const key of referenceKeys(text).slice(0, 4)) {
    await prisma.payerReference.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { customerId, ignore: customerId === null, label, lastUsedAt: new Date() },
      create: { tenantId, key, label, customerId, ignore: customerId === null },
    });
  }
}

/** Save the rows the user ticked. Each row is recorded on its own; one bad row doesn't stop the rest. */
export async function commitBankImport(input: { rows: BankImportRow[] }) {
  const actor = await requirePerm("payments");
  const tenantId = actor.tenantId;
  const rows = Array.isArray(input?.rows) ? input.rows : [];
  if (rows.length === 0) throw new Error("Tick at least one row first.");
  if (rows.length > 2000) throw new Error("Too many rows in one go. Split the statement into smaller dates.");

  const already = new Set(await findImportedLines(rows.map((r) => r.hash)));
  const batch = await prisma.paymentImport.create({ data: { tenantId, createdByUserId: actor.userId } });
  const results: Array<{ hash: string; ok: boolean; message?: string }> = [];
  let paidCount = 0;
  let ignoredCount = 0;
  let total = 0;
  const touched = new Set<number>();

  for (const row of rows) {
    const hash = String(row?.hash ?? "");
    try {
      if (!IMPORT_HASH.test(hash)) throw new Error("Row not recognised.");
      if (already.has(hash)) { results.push({ hash, ok: false, message: "Already imported." }); continue; }
      already.add(hash);
      const text = String(row.text ?? "").replace(/\s+/g, " ").trim().slice(0, 140);

      if (row.action === "ignore") {
        await prisma.importedLine.create({ data: { tenantId, importId: batch.id, hash, ignored: true } });
        if (row.learn) await learnReference(tenantId, text, null);
        ignoredCount++;
        results.push({ hash, ok: true });
        continue;
      }
      if (row.action !== "pay") throw new Error("Row not recognised.");

      const amount = round2(Number(row.amount));
      const customerId = Number(row.customerId);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error("Amount not valid.");
      if (!IMPORT_DATE.test(String(row.date))) throw new Error("Date not valid.");
      const paidAt = new Date(`${row.date}T12:00:00.000Z`);
      if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 2 * 86_400_000) throw new Error("Date not valid.");
      if (!Number.isInteger(customerId) || customerId <= 0) throw new Error("Choose a customer.");
      const allocations = (Array.isArray(row.allocations) ? row.allocations : [])
        .map((a) => ({ jobId: Number(a.jobId), amount: round2(Number(a.amount)) }))
        .filter((a) => Number.isInteger(a.jobId) && a.amount > 0.005);
      const extra = round2(Math.max(0, Number(row.extra) || 0));
      const sum = round2(allocations.reduce((s, a) => s + a.amount, 0) + extra);
      if (Math.abs(sum - amount) > 0.01) throw new Error("The amounts on the jobs don't add up to the payment.");

      const payment = await createAllocatedPayment({
        tenantId,
        customerId,
        allocations,
        extra,
        method: "BACS",
        notes: text ? `Bank: ${text}` : "Bank import",
        paidAt,
        collectedByUserId: actor.userId,
      });
      try {
        await prisma.importedLine.create({ data: { tenantId, importId: batch.id, hash, paymentId: payment.id } });
      } catch (error) {
        // Imported at the same moment elsewhere: don't keep a second payment.
        await prisma.payment.update({ where: { id: payment.id }, data: { voidedAt: new Date(), voidReason: "Duplicate bank import" } });
        throw error;
      }
      if (row.learn) await learnReference(tenantId, text, customerId);
      paidCount++;
      total = round2(total + amount);
      touched.add(customerId);
      results.push({ hash, ok: true });
    } catch (error) {
      results.push({ hash, ok: false, message: error instanceof Error ? error.message : "Couldn't save this row." });
    }
  }

  if (paidCount === 0 && ignoredCount === 0) {
    await prisma.paymentImport.delete({ where: { id: batch.id } });
  } else {
    await prisma.paymentImport.update({ where: { id: batch.id }, data: { paidCount, ignoredCount, total } });
  }
  revalidatePath("/payments");
  for (const id of touched) revalidatePath(`/customers/${id}`);
  return { importId: paidCount + ignoredCount > 0 ? batch.id : null, paidCount, ignoredCount, total, results };
}

/** Recent imports, newest first, for the Undo list. */
export async function getRecentBankImports() {
  const actor = await requirePerm("payments");
  return prisma.paymentImport.findMany({
    where: { tenantId: actor.tenantId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, undoneAt: true, paidCount: true, ignoredCount: true, total: true },
  });
}

/** Undo a whole import: its payments are cancelled and its lines can be imported again. */
export async function undoBankImport(importId: number) {
  const actor = await requirePerm("payments");
  const tenantId = actor.tenantId;
  const batch = await prisma.paymentImport.findFirst({ where: { id: Number(importId), tenantId }, select: { id: true, undoneAt: true } });
  if (!batch) throw new Error("Import not found.");
  if (batch.undoneAt) return;
  const lines = await prisma.importedLine.findMany({ where: { tenantId, importId: batch.id }, select: { paymentId: true } });
  const paymentIds = lines.map((l) => l.paymentId).filter((id): id is number => typeof id === "number");
  const payments = await prisma.payment.findMany({ where: { tenantId, id: { in: paymentIds } }, select: { customerId: true } });
  await prisma.$transaction([
    prisma.payment.updateMany({ where: { tenantId, id: { in: paymentIds }, voidedAt: null }, data: { voidedAt: new Date(), voidReason: "Bank import undone" } }),
    prisma.importedLine.deleteMany({ where: { tenantId, importId: batch.id } }),
    prisma.paymentImport.update({ where: { id: batch.id }, data: { undoneAt: new Date() } }),
  ]);
  revalidatePath("/payments");
  for (const id of new Set(payments.map((p) => p.customerId))) revalidatePath(`/customers/${id}`);
}

/** Bank references learned for one customer (shown on the customer page). */
export async function getCustomerBankReferences(customerId: number) {
  const actor = await requirePerm("payments");
  const refs = await prisma.payerReference.findMany({
    where: { tenantId: actor.tenantId, customerId: Number(customerId) },
    orderBy: { lastUsedAt: "desc" },
    select: { id: true, label: true },
  });
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.label) ? false : (seen.add(r.label), true)));
}

export async function removeBankReference(referenceId: number) {
  const actor = await requirePerm("payments");
  const ref = await prisma.payerReference.findFirst({ where: { id: Number(referenceId), tenantId: actor.tenantId }, select: { id: true, customerId: true } });
  if (!ref) return;
  // One statement line is learned as a few keys with the same label: remove them together.
  const label = (await prisma.payerReference.findUnique({ where: { id: ref.id }, select: { label: true } }))?.label ?? "";
  await prisma.payerReference.deleteMany({ where: { tenantId: actor.tenantId, customerId: ref.customerId, label } });
  if (ref.customerId) revalidatePath(`/customers/${ref.customerId}`);
}
