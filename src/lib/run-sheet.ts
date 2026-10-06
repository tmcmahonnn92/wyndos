import type { getWorkDay } from "@/lib/actions";
import { orderDays, orderJobs } from "@/lib/day-order";
import { addressPartsOf, collectKnownTowns, compareByStreet, withTownFallback } from "@/lib/address";

type Day = NonNullable<Awaited<ReturnType<typeof getWorkDay>>>;
export type RunSheetJob = Day["jobs"][number];

/**
 * The jobs for a printed / shared run sheet: one or more area days, in route or street order,
 * optionally only one person's jobs ("me" = the viewer, which includes jobs nobody was given).
 */
export function buildRunSheet(
  days: Day[],
  options: { sort: "area" | "street"; worker?: string | null; viewer: { id: string; name?: string | null } },
) {
  const areaById = new Map(days.map((d) => [d.id, d.area]));
  const dayWorker = new Map(days.map((d) => [d.id, d.assignedUserId ?? null]));
  const workerOf = (job: RunSheetJob) => job.assignedUserId ?? dayWorker.get(job.workDayId) ?? null;

  // The day's own working order: areas in order, each area's order, then any links.
  let jobs: RunSheetJob[] = orderJobs(days).filter((job) => job.status !== "MOVED");
  const worker = options.worker || null;
  if (worker) {
    jobs = jobs.filter((job) => {
      const who = workerOf(job);
      return worker === "me" ? who === null || who === options.viewer.id : who === worker;
    });
  }
  if (options.sort === "street") {
    const towns = collectKnownTowns(jobs.map((j) => j.customer.address));
    const key = new Map(jobs.map((j) => {
      const area = areaById.get(j.workDayId);
      const fallback = area && !area.isSystemArea ? area.name : j.customer.area?.name;
      return [j.id, withTownFallback(addressPartsOf(j.customer, towns), fallback)];
    }));
    jobs = [...jobs].sort((a, b) => compareByStreet(key.get(a.id)!, key.get(b.id)!));
  }

  // Name of the person this sheet is for.
  const people = new Map<string, string>();
  for (const d of days) if (d.assignedUser) people.set(d.assignedUser.id, d.assignedUser.name || d.assignedUser.email || "");
  for (const j of days.flatMap((d) => d.jobs)) if (j.assignedUser) people.set(j.assignedUser.id, j.assignedUser.name || j.assignedUser.email || "");
  const workerName = !worker ? null : worker === "me" ? options.viewer.name || "Me" : people.get(worker) ?? "Worker";
  const everyone = [...new Set(jobs.map((j) => {
    const who = workerOf(j);
    return who ? people.get(who) ?? "" : options.viewer.name ?? "";
  }).filter(Boolean))];

  const owes = (job: RunSheetJob) =>
    job.customer.jobs
      .filter((previous) => previous.id !== job.id)
      .reduce((sum, previous) => {
        const paid = previous.allocations.reduce((s, allocation) => s + allocation.amount, 0);
        return sum + Math.max(0, previous.price - paid);
      }, 0);

  return {
    jobs,
    total: jobs.reduce((sum, job) => sum + job.price, 0),
    multi: days.length > 1,
    areaName: (job: RunSheetJob) => areaById.get(job.workDayId)?.name ?? "One-off",
    title: days.length > 1 ? orderDays(days).map((d) => d.area?.name ?? "One-off").join(", ") : days[0]?.area?.name ?? "Round",
    workerName,
    peopleLabel: workerName ?? everyone.join(", "),
    owes,
  };
}

export function runSheetDateLabel(dateISO: string) {
  return new Date(`${dateISO}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
