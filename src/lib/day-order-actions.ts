"use server";

/** Saving the order of work on a date. How the order is worked out: src/lib/day-order.ts. */

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { requirePerm, requireReorder, visibleJobWhere, type Actor } from "@/lib/guards";

const int = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : NaN);

function refresh() {
  revalidatePath("/days", "layout");
  revalidatePath("/scheduler");
}

async function visibleJob(actor: Actor, jobId: number) {
  const job = await prisma.job.findFirst({
    where: { id: int(jobId), tenantId: actor.tenantId, ...visibleJobWhere(actor) },
    select: { id: true, workDayId: true, customerId: true, workDay: { select: { date: true } }, customer: { select: { areaId: true, placeAfterCustomerId: true } } },
  });
  if (!job) throw new Error("Job not found");
  return job;
}

/**
 * New order for one area's jobs on a day, after a job was moved within its own area.
 * The moved job stops following any link today (so it stays where it was put).
 */
export async function placeJobInArea(workDayId: number, orderedJobIds: number[], movedJobId: number) {
  const actor = await requireReorder();
  const moved = await visibleJob(actor, movedJobId);
  const ids = (Array.isArray(orderedJobIds) ? orderedJobIds : []).map(int);
  const jobs = await prisma.job.findMany({
    where: { tenantId: actor.tenantId, workDayId: int(workDayId), id: { in: ids }, ...visibleJobWhere(actor) },
    select: { id: true },
  });
  if (jobs.length !== new Set(ids).size || moved.workDayId !== workDayId) throw new Error("Those jobs aren't all on this area's day.");
  await prisma.$transaction([
    ...ids.map((id, index) => prisma.job.update({ where: { id }, data: { sortOrder: index } })),
    prisma.job.update({ where: { id: moved.id }, data: { afterJobId: moved.customer.placeAfterCustomerId ? -1 : null } }),
  ]);
  refresh();
}

/** Today only: put a job straight after another job on the same date (any area), or first (0). */
export async function placeJobAfter(jobId: number, afterJobId: number) {
  const actor = await requireReorder();
  const job = await visibleJob(actor, jobId);
  const after = int(afterJobId);
  if (after !== 0) {
    const target = await visibleJob(actor, after);
    if (target.id === job.id || target.workDay.date.getTime() !== job.workDay.date.getTime()) throw new Error("That job isn't on the same day.");
  }
  await prisma.job.update({ where: { id: job.id }, data: { afterJobId: after } });
  refresh();
}

/**
 * Always: this customer goes straight after that customer whenever both are on the same day.
 * Null removes the link. `jobId` (the job just moved) drops its today-only placement.
 */
export async function setCustomerPlaceAfter(customerId: number, afterCustomerId: number | null, jobId?: number) {
  const actor = await requirePerm("areas");
  const tenantId = actor.tenantId;
  const customer = await prisma.customer.findFirst({ where: { id: int(customerId), tenantId }, select: { id: true } });
  if (!customer) throw new Error("Customer not found");
  if (afterCustomerId !== null) {
    const target = await prisma.customer.findFirst({ where: { id: int(afterCustomerId), tenantId }, select: { id: true, placeAfterCustomerId: true } });
    if (!target || target.id === customer.id) throw new Error("Choose another customer.");
  }
  await prisma.customer.update({ where: { id: customer.id }, data: { placeAfterCustomerId: afterCustomerId } });
  if (jobId) await prisma.job.updateMany({ where: { id: int(jobId), tenantId, customerId: customer.id }, data: { afterJobId: null } });
  revalidatePath(`/customers/${customer.id}`);
  refresh();
}

/**
 * Always: move a customer in their area's walking order, straight after one customer
 * (or straight before one, when they now come first). Removes any always-after link.
 */
export async function placeCustomerInArea(customerId: number, place: { after?: number | null; before?: number | null }, jobId?: number) {
  const actor = await requirePerm("areas");
  const tenantId = actor.tenantId;
  const customer = await prisma.customer.findFirst({ where: { id: int(customerId), tenantId }, select: { id: true, areaId: true } });
  if (!customer) throw new Error("Customer not found");
  const list = await prisma.customer.findMany({
    where: { tenantId, areaId: customer.areaId, id: { not: customer.id } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  const ids = list.map((c) => c.id);
  let at = ids.length;
  if (place.after != null && ids.includes(place.after)) at = ids.indexOf(place.after) + 1;
  else if (place.before != null && ids.includes(place.before)) at = ids.indexOf(place.before);
  ids.splice(at, 0, customer.id);
  await prisma.$transaction([
    ...ids.map((id, index) => prisma.customer.update({ where: { id }, data: { sortOrder: index } })),
    prisma.customer.update({ where: { id: customer.id }, data: { placeAfterCustomerId: null } }),
    ...(jobId ? [prisma.job.updateMany({ where: { id: int(jobId), tenantId, customerId: customer.id }, data: { afterJobId: null } })] : []),
  ]);
  revalidatePath("/areas");
  revalidatePath(`/customers/${customer.id}`);
  refresh();
}

/** Order of the areas on one date (the area days, first to last). */
export async function setDateAreaOrder(workDayIds: number[]) {
  const actor = await requireReorder();
  const ids = (Array.isArray(workDayIds) ? workDayIds : []).map(int);
  const days = await prisma.workDay.findMany({ where: { tenantId: actor.tenantId, id: { in: ids } }, select: { id: true, date: true } });
  if (days.length !== new Set(ids).size || new Set(days.map((d) => d.date.getTime())).size > 1) throw new Error("Those areas aren't all on the same day.");
  await prisma.$transaction(ids.map((id, index) => prisma.workDay.update({ where: { id }, data: { dayOrder: index } })));
  refresh();
}

/** Back to normal: area order, each area's walking order, today's links removed. */
export async function resetDayOrder(workDayIds: number[]) {
  const actor = await requireReorder();
  const tenantId = actor.tenantId;
  const ids = (Array.isArray(workDayIds) ? workDayIds : []).map(int);
  const days = await prisma.workDay.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } });
  if (days.length !== new Set(ids).size) throw new Error("Day not found");
  const jobs = await prisma.job.findMany({ where: { tenantId, workDayId: { in: ids } }, select: { id: true, customer: { select: { sortOrder: true } } } });
  await prisma.$transaction([
    prisma.workDay.updateMany({ where: { tenantId, id: { in: ids } }, data: { dayOrder: null } }),
    ...jobs.map((j) => prisma.job.update({ where: { id: j.id }, data: { sortOrder: j.customer.sortOrder, afterJobId: null } })),
  ]);
  refresh();
}
