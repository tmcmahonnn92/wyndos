"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { requireOwner } from "@/lib/guards";

function refreshEverything() {
  for (const path of ["/", "/days", "/scheduler", "/customers", "/areas", "/payments", "/accounting", "/quotes", "/messages"]) {
    revalidatePath(path);
  }
}

/** Counts shown before clearing, so the owner knows what will go. */
export async function getDataCounts() {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;
  const [customers, areas, workDays, jobs, payments, expenses, otherIncome, texts] = await Promise.all([
    prisma.customer.count({ where: { tenantId } }),
    prisma.area.count({ where: { tenantId, isSystemArea: false } }),
    prisma.workDay.count({ where: { tenantId } }),
    prisma.job.count({ where: { tenantId } }),
    prisma.payment.count({ where: { tenantId } }),
    prisma.expense.count({ where: { tenantId } }),
    prisma.otherIncome.count({ where: { tenantId } }),
    prisma.messageLog.count({ where: { tenantId } }),
  ]);
  return { customers, areas, workDays, jobs, payments, expenses, otherIncome, texts };
}

/** Delete work days, visits, customer payments and texts. Keeps customers, areas and business money records. */
async function wipeScheduleAndHistory(tenantId: number) {
  await prisma.$transaction([
    prisma.paymentAllocation.deleteMany({ where: { tenantId } }),
    prisma.payment.deleteMany({ where: { tenantId } }),
    prisma.job.deleteMany({ where: { tenantId } }),
    prisma.workDay.deleteMany({ where: { tenantId } }),
    prisma.messageLog.deleteMany({ where: { tenantId } }),
  ]);
}

/**
 * Clear the schedule and all history, keep the customers.
 * Every customer and area stays (price, frequency, notes, area, order), but all
 * work days, visits (done or not), payments and texts are deleted and "last cleaned"
 * dates reset, so you can start scheduling from scratch.
 */
export async function clearScheduleAndHistory(confirmWord: string) {
  const actor = await requireOwner();
  if (confirmWord.trim().toUpperCase() !== "CLEAR") throw new Error("Type CLEAR to confirm.");
  const tenantId = actor.tenantId;
  await wipeScheduleAndHistory(tenantId);
  await prisma.$transaction([
    prisma.customer.updateMany({ where: { tenantId }, data: { nextDueDate: null, lastCompletedDate: null, skipNextAreaRun: false } }),
    prisma.area.updateMany({ where: { tenantId }, data: { nextDueDate: null, lastCompletedDate: null } }),
    // Temporary "Overdue – …" groups have nothing left in them.
    prisma.area.deleteMany({ where: { tenantId, isSystemArea: true, name: { startsWith: "Overdue" }, customers: { none: {} } } }),
  ]);
  refreshEverything();
  return { ok: true };
}

/**
 * Clear everything: customers, areas, schedule, history, payments, expenses, tags,
 * holidays and texts. Keeps the business details, settings, templates and team.
 */
export async function clearAllData(confirmWord: string) {
  const actor = await requireOwner();
  if (confirmWord.trim().toUpperCase() !== "DELETE EVERYTHING") throw new Error("Type DELETE EVERYTHING to confirm.");
  const tenantId = actor.tenantId;
  await wipeScheduleAndHistory(tenantId);
  await prisma.customer.updateMany({ where: { tenantId }, data: { paidByCustomerId: null } });
  await prisma.$transaction([
    prisma.customerTag.deleteMany({ where: { customer: { tenantId } } }),
    prisma.customer.deleteMany({ where: { tenantId } }),
    prisma.area.deleteMany({ where: { tenantId } }),
    prisma.tag.deleteMany({ where: { tenantId } }),
    prisma.holiday.deleteMany({ where: { tenantId } }),
    prisma.expense.deleteMany({ where: { tenantId } }),
    prisma.otherIncome.deleteMany({ where: { tenantId } }),
  ]);
  refreshEverything();
  return { ok: true };
}
