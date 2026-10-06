/**
 * The order of work on a date, shared by the day view, printed sheets and the PDF.
 *
 *  1. Areas in the order set for that date (WorkDay.dayOrder), else their normal order.
 *  2. Inside each area, the day's own job order (Job.sortOrder, copied from the area order).
 *  3. Then links move single jobs, even between another area's jobs:
 *     - today only (Job.afterJobId): after that job; 0 = first of the day; -1 = stay in its area;
 *     - always (Customer.placeAfterCustomerId): after that customer, when both are on the date.
 *     A link to someone who isn't on the date is ignored, so the job just stays in its area.
 */

export type OrderDay = { id: number; dayOrder?: number | null; area?: { sortOrder?: number | null } | null };
export type OrderJob = {
  id: number;
  workDayId: number;
  customerId: number;
  sortOrder: number;
  afterJobId?: number | null;
  customer: { name: string; placeAfterCustomerId?: number | null };
};

/** Areas on a date, in the order to work them. */
export function orderDays<D extends OrderDay>(days: D[]): D[] {
  return days
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      const ka = a.d.dayOrder ?? 100000 + (a.d.area?.sortOrder ?? 0);
      const kb = b.d.dayOrder ?? 100000 + (b.d.area?.sortOrder ?? 0);
      return ka - kb || a.i - b.i;
    })
    .map((x) => x.d);
}

/** Where a job is linked to on this date, if anywhere: a job id, "first", or null (its area). */
function linkOf(job: OrderJob, byId: Map<number, OrderJob>, byCustomer: Map<number, OrderJob>): number | "first" | null {
  const today = job.afterJobId;
  if (today === -1) return null;
  if (today === 0) return "first";
  if (today != null && today !== job.id && byId.has(today)) return today;
  const always = job.customer.placeAfterCustomerId;
  if (always != null && always !== job.customerId) {
    const target = byCustomer.get(always);
    if (target && target.id !== job.id) return target.id;
  }
  return null;
}

/**
 * Every job on the date in working order. `days` should already be in area order
 * (orderDays) or will be put in it; each day's jobs are sorted by sortOrder here.
 */
export function orderJobs<D extends OrderDay & { jobs: OrderJob[] }>(days: D[]): D["jobs"][number][] {
  type J = D["jobs"][number];
  const base: J[] = orderDays(days).flatMap((d) =>
    [...d.jobs].sort((a, b) => a.sortOrder - b.sortOrder || a.customer.name.localeCompare(b.customer.name) || a.id - b.id),
  );
  const byId = new Map(base.map((j) => [j.id, j]));
  const byCustomer = new Map<number, J>();
  for (const j of base) if (!byCustomer.has(j.customerId)) byCustomer.set(j.customerId, j);

  const links = new Map<number, number | "first">();
  for (const j of base) {
    const link = linkOf(j, byId, byCustomer);
    if (link !== null) links.set(j.id, link);
  }
  if (links.size === 0) return base;

  const out: J[] = base.filter((j) => !links.has(j.id));
  const firsts = base.filter((j) => links.get(j.id) === "first");
  out.unshift(...firsts);
  // Linked jobs go straight after their target, keeping their own order among themselves.
  // Chains work (A after B after C); a loop is broken by leaving the rest in their areas.
  let waiting = base.filter((j) => typeof links.get(j.id) === "number");
  const tail = new Map<number, number>(); // target id -> id of the last job placed after it
  while (waiting.length) {
    const next: J[] = [];
    for (const j of waiting) {
      const target = links.get(j.id) as number;
      const anchorId = tail.get(target) ?? target;
      const at = out.findIndex((o) => o.id === anchorId);
      if (at === -1) { next.push(j); continue; }
      out.splice(at + 1, 0, j);
      tail.set(target, j.id);
    }
    if (next.length === waiting.length) {
      // Loop: put them back where they'd normally be (end of their area's jobs).
      for (const j of next) {
        const lastSame = out.map((o) => o.workDayId).lastIndexOf(j.workDayId);
        out.splice(lastSame === -1 ? out.length : lastSame + 1, 0, j);
      }
      break;
    }
    waiting = next;
  }
  return out;
}

/** True when a job sits away from its own area's jobs because of a link. */
export function isLinked(job: OrderJob, all: OrderJob[]): boolean {
  const byId = new Map(all.map((j) => [j.id, j]));
  const byCustomer = new Map<number, OrderJob>();
  for (const j of all) if (!byCustomer.has(j.customerId)) byCustomer.set(j.customerId, j);
  return linkOf(job, byId, byCustomer) !== null;
}
