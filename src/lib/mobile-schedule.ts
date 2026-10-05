"use server";

/**
 * Light data for the phone scheduler: open runs coming up, and areas with nothing booked.
 * Moving, booking and assigning reuse the same actions as the desktop scheduler.
 */

import prisma from "@/lib/db";
import { requirePerm, visibleWorkDayWhere } from "@/lib/guards";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type MobileDay = {
  id: number;
  date: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETE";
  areaId: number | null;
  areaName: string;
  color: string;
  workerId: string | null;
  workerName: string | null;
  jobs: number;
  pending: number;
  /** Jobs not done yet (pending or outstanding): what moves when a started day is moved. */
  leftIds: number[];
  done: number;
  value: number;
};

export type MobileArea = {
  id: number;
  name: string;
  color: string;
  customers: number;
  value: number;
  nextDue: string | null;
  frequencyWeeks: number;
};

export async function getMobileSchedule(): Promise<{ today: string; days: MobileDay[]; unbooked: MobileArea[]; canAssign: boolean }> {
  const actor = await requirePerm("scheduler");
  const tenantId = actor.tenantId;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(today.getTime() - 28 * 86400000); // unfinished runs from the last 4 weeks
  const to = new Date(today.getTime() + 56 * 86400000); // and the next 8 weeks

  const [workDays, areas] = await Promise.all([
    prisma.workDay.findMany({
      where: {
        tenantId,
        ...visibleWorkDayWhere(actor),
        date: { gte: from, lte: to },
        OR: [{ status: { not: "COMPLETE" } }, { date: { gte: today } }],
      },
      select: {
        id: true,
        date: true,
        status: true,
        areaId: true,
        area: { select: { name: true, color: true } },
        assignedUser: { select: { id: true, name: true, email: true } },
        jobs: { select: { id: true, status: true, price: true } },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    prisma.area.findMany({
      where: { tenantId, isSystemArea: false },
      select: {
        id: true,
        name: true,
        color: true,
        nextDueDate: true,
        frequencyWeeks: true,
        customers: { where: { active: true }, select: { price: true } },
        workDays: { where: { status: { not: "COMPLETE" } }, select: { id: true }, take: 1 },
      },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const days: MobileDay[] = workDays.map((d) => ({
    id: d.id,
    date: iso(d.date),
    status: d.status,
    areaId: d.areaId,
    areaName: d.area?.name ?? "One-off jobs",
    color: d.area?.color ?? "#9CA3AF",
    workerId: d.assignedUser?.id ?? null,
    workerName: d.assignedUser ? d.assignedUser.name || d.assignedUser.email : null,
    jobs: d.jobs.length,
    pending: d.jobs.filter((j) => j.status === "PENDING").length,
    leftIds: d.jobs.filter((j) => j.status === "PENDING" || j.status === "OUTSTANDING").map((j) => j.id),
    done: d.jobs.filter((j) => j.status === "COMPLETE").length,
    value: d.jobs.reduce((s, j) => s + j.price, 0),
  }));

  const unbooked: MobileArea[] = areas
    .filter((a) => a.workDays.length === 0 && a.customers.length > 0)
    .map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color,
      customers: a.customers.length,
      value: a.customers.reduce((s, c) => s + c.price, 0),
      nextDue: a.nextDueDate ? iso(a.nextDueDate) : null,
      frequencyWeeks: a.frequencyWeeks,
    }))
    .sort((a, b) => (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999"));

  return { today: iso(today), days, unbooked, canAssign: !actor.isWorker };
}
