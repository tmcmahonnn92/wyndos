"use server";

import prisma from "@/lib/db";
import { requirePerm, visibleJobWhere } from "@/lib/guards";

/**
 * How busy each date is, for date pickers: jobs booked per day (not moved away) and
 * how many areas. Only what the viewer can see. Range is capped at about two months.
 */
export async function getDateLoad(fromISO: string, toISO: string): Promise<Record<string, { jobs: number; areas: number; holiday?: string }>> {
  const actor = await requirePerm("schedule");
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(fromISO) || !iso.test(toISO)) return {};
  const from = new Date(`${fromISO}T00:00:00.000Z`);
  let to = new Date(`${toISO}T00:00:00.000Z`);
  if (to.getTime() - from.getTime() > 70 * 86400000) to = new Date(from.getTime() + 70 * 86400000);
  const [days, holidays] = await Promise.all([
    prisma.workDay.findMany({
      where: { tenantId: actor.tenantId, date: { gte: from, lte: to } },
      select: { date: true, areaId: true, _count: { select: { jobs: { where: { status: { not: "MOVED" }, ...visibleJobWhere(actor) } } } } },
    }),
    prisma.holiday.findMany({
      where: { tenantId: actor.tenantId, startDate: { lte: to }, endDate: { gte: from } },
      select: { startDate: true, endDate: true, label: true },
    }),
  ]);
  const out: Record<string, { jobs: number; areas: number; holiday?: string }> = {};
  for (const d of days) {
    if (d._count.jobs === 0) continue;
    const key = d.date.toISOString().slice(0, 10);
    const e = (out[key] ??= { jobs: 0, areas: 0 });
    e.jobs += d._count.jobs;
    e.areas += 1;
  }
  for (const h of holidays) {
    const day0 = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    for (let t = Math.max(day0(h.startDate), from.getTime()); t <= Math.min(day0(h.endDate), to.getTime()); t += 86400000) {
      const key = new Date(t).toISOString().slice(0, 10);
      (out[key] ??= { jobs: 0, areas: 0 }).holiday = h.label || "Holiday";
    }
  }
  return out;
}
