/**
 * Simulation toolkit: runs the real server actions against the database with a pretend
 * login and a movable clock, then checks the data still makes sense.
 *
 *   npx tsx --tsconfig scripts/sim/tsconfig.json scripts/sim/run.ts
 *
 * Use a test database only: it creates businesses and changes data.
 */
import prisma from "@/lib/db";

// ── Clock ───────────────────────────────────────────────────────────────────
const RealDate = Date;
let offsetMs = 0;
class SimDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + offsetMs);
    else super(...(args as [string]));
  }
  static now() { return RealDate.now() + offsetMs; }
}
(globalThis as unknown as { Date: DateConstructor }).Date = SimDate as unknown as DateConstructor;

/** Pretend it's this date (UTC), at the given hour. */
export function setToday(iso: string, hour = 9) {
  offsetMs = RealDate.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), hour) - RealDate.now();
}
export function today() { return new Date().toISOString().slice(0, 10); }
export function addDaysIso(iso: string, n: number) {
  const d = new RealDate(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const isoOf = (d: Date | null | undefined) => (d ? new RealDate(d.getTime()).toISOString().slice(0, 10) : "");

// ── Login ───────────────────────────────────────────────────────────────────
const g = globalThis as unknown as { __simSession?: unknown; __simAfter?: Promise<unknown>[] };
export function loginAs(userId: string, tenantId: number, tenantName = "Sim") {
  g.__simSession = { user: { id: userId, role: "OWNER", tenantId, memberships: [{ tenantId, tenantName, role: "OWNER", permissions: [] }], onboardingComplete: true } };
}
/** Wait for anything the action ran "after" responding (texts, invoices…). */
export async function settle() { const list = g.__simAfter ?? []; g.__simAfter = []; await Promise.all(list); }

export async function createBusiness(label: string) {
  const slug = `sim-${label}-${RealDate.now()}`;
  const tenant = await prisma.tenant.create({ data: { name: `Sim ${label}`, slug, billingExempt: true } });
  const user = await prisma.user.create({ data: { email: `${slug}@sim.test`, name: "Sim Owner", role: "OWNER", tenantId: tenant.id, onboardingComplete: true } });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: "OWNER" } });
  await prisma.tenantSettings.create({ data: { tenantId: tenant.id, businessName: `Sim ${label}` } });
  loginAs(user.id, tenant.id, tenant.name);
  return { tenantId: tenant.id, userId: user.id };
}

// ── Random ──────────────────────────────────────────────────────────────────
let seed = 12345;
export function setSeed(s: number) { seed = s; }
export function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
export function pick<T>(list: T[]): T { return list[Math.floor(rand() * list.length)]; }

// ── Rule checks ─────────────────────────────────────────────────────────────
export type Problem = { rule: string; key: string; detail: string };

/** Everything that should always be true for a business. */
export async function checkRules(tenantId: number): Promise<Problem[]> {
  const out: Problem[] = [];
  const add = (rule: string, key: string, detail: string) => out.push({ rule, key: `${rule}:${key}`, detail });
  const now = today();

  const [areas, customers, days, payments] = await Promise.all([
    prisma.area.findMany({ where: { tenantId } }),
    prisma.customer.findMany({ where: { tenantId }, include: { area: true } }),
    prisma.workDay.findMany({ where: { tenantId }, include: { jobs: { include: { allocations: { include: { payment: { select: { voidedAt: true } } } } } } } }),
    prisma.payment.findMany({ where: { tenantId }, include: { allocations: true } }),
  ]);
  const areaById = new Map(areas.map((a) => [a.id, a]));

  // ── Schedule ──
  const openRunsByArea = new Map<number, typeof days>();
  for (const d of days) {
    if (d.status === "COMPLETE" || !d.areaId) continue;
    openRunsByArea.set(d.areaId, [...(openRunsByArea.get(d.areaId) ?? []), d]);
  }
  for (const a of areas) {
    if (a.isSystemArea) continue;
    const open = (openRunsByArea.get(a.id) ?? []).filter((d) => !d.partOfId).sort((x, y) => x.date.getTime() - y.date.getTime());
    const members = customers.filter((c) => c.areaId === a.id && c.active);
    if (members.length && open.length === 0) add("area-no-run", String(a.id), `${a.name}: ${members.length} active customers but no booked run`);
    if (open.length > 1) add("area-two-runs", String(a.id), `${a.name}: ${open.length} open runs (${open.map((d) => isoOf(d.date)).join(", ")})`);
    if (open[0] && a.nextDueDate && isoOf(a.nextDueDate) !== isoOf(open[0].date)) add("area-due-mismatch", String(a.id), `${a.name}: area due ${isoOf(a.nextDueDate)} but next run ${isoOf(open[0].date)}`);
    if (open[0] && isoOf(open[0].date) < addDaysIso(now, -14)) add("run-stale", String(a.id), `${a.name}: next run ${isoOf(open[0].date)} is over 2 weeks ago`);
  }

  // Each active round customer: on exactly one open run of their own area (or one carried-over day).
  for (const c of customers) {
    if (!c.active || !c.area || c.area.isSystemArea) continue;
    const openJobs = days.filter((d) => d.status !== "COMPLETE").flatMap((d) => d.jobs.filter((j) => j.customerId === c.id && j.status === "PENDING" && !j.isOneOff && !j.isQuote).map((j) => ({ j, d })));
    const ownArea = openJobs.filter(({ d }) => d.areaId === c.areaId);
    const elsewhere = openJobs.filter(({ d }) => d.areaId !== c.areaId && !(d.areaId && areaById.get(d.areaId)?.isSystemArea));
    // Any visit (done or not) on an open day of their area counts: a re-opened day keeps its done cleans.
    // …and so does a visit on any piece (part) of their area's open run, even one already finished.
    const openRunIds = new Set(days.filter((d) => d.status !== "COMPLETE" && d.areaId === c.areaId).map((d) => d.partOfId ?? d.id));
    const onOpenDay = days.some((d) => d.areaId === c.areaId && (openRunIds.has(d.id) || (d.partOfId != null && openRunIds.has(d.partOfId))) && d.jobs.some((j) => j.customerId === c.id && !j.isQuote));
    if (openJobs.length === 0 && !onOpenDay) {
      const due = isoOf(c.nextDueDate);
      const run = (openRunsByArea.get(c.areaId) ?? []).filter((d) => !d.partOfId).sort((x, y) => x.date.getTime() - y.date.getTime())[0];
      // Not on the next run although due by then (plus the area's window).
      if (run && due && due <= addDaysIso(isoOf(run.date), (c.area.dueWindowDays ?? 7))) add("customer-missed", String(c.id), `${c.name} (${c.area.name}) due ${due} but not on the next run ${isoOf(run.date)}`);
      if (!run && due && due < now) add("customer-missed", String(c.id), `${c.name} (${c.area.name}) due ${due}, no run booked`);
    }
    if (ownArea.length > 1) add("customer-twice", String(c.id), `${c.name}: on ${ownArea.length} open runs (${ownArea.map(({ d }) => isoOf(d.date)).join(", ")})`);
    if (elsewhere.length) add("customer-other-area", String(c.id), `${c.name} (${c.area.name}) has a round job on another area's day ${elsewhere.map(({ d }) => `${areaById.get(d.areaId!)?.name} ${isoOf(d.date)}`).join(", ")}`);
    // Due date far from their area's run.
    const run = (openRunsByArea.get(c.areaId) ?? []).filter((d) => !d.partOfId).sort((x, y) => x.date.getTime() - y.date.getTime())[0];
    if (run && c.nextDueDate && Math.abs((run.date.getTime() - c.nextDueDate.getTime()) / 86400000) > (c.area.dueWindowDays ?? 7) + 7 && ownArea.some(({ d }) => d.id === run.id) && !days.some((d) => d.status !== "COMPLETE" && d.id !== run.id && d.jobs.some((j) => j.customerId === c.id && j.status === "PENDING"))) {
      add("customer-drift", String(c.id), `${c.name}: due ${isoOf(c.nextDueDate)} but area run ${isoOf(run.date)}`);
    }
    if (c.nextDueDate && isoOf(c.nextDueDate) < addDaysIso(now, -21) && openJobs.length === 0) add("customer-overdue-lost", String(c.id), `${c.name}: due ${isoOf(c.nextDueDate)}, 3+ weeks overdue and not booked anywhere`);
  }

  for (const d of days) {
    const seen = new Set<number>();
    for (const j of d.jobs) {
      if (j.isQuote) continue;
      if (seen.has(j.customerId) && !j.isOneOff) add("duplicate-job", `${d.id}:${j.customerId}`, `Customer ${j.customerId} twice on ${isoOf(d.date)}`);
      if (!j.isOneOff) seen.add(j.customerId);
      if (j.status === "COMPLETE" && isoOf(d.date) > now) add("done-in-future", String(j.id), `Job ${j.id} done but its day is ${isoOf(d.date)} (today ${now})`);
    }
    if (d.status === "COMPLETE" && d.jobs.some((j) => j.status === "PENDING")) add("pending-on-finished-day", String(d.id), `Finished day ${isoOf(d.date)} still has ${d.jobs.filter((j) => j.status === "PENDING").length} pending jobs`);
    if (d.status !== "COMPLETE" && d.jobs.length === 0 && d.areaId && !areaById.get(d.areaId)?.isSystemArea) add("empty-run", String(d.id), `Empty open day ${isoOf(d.date)} for ${areaById.get(d.areaId)?.name}`);
  }

  // ── Money ──
  const live = payments.filter((p) => !p.voidedAt);
  const allJobs = days.flatMap((d) => d.jobs);
  const jobById = new Map(allJobs.map((j) => [j.id, j]));
  for (const p of live) {
    const used = p.allocations.reduce((s, a) => s + a.amount, 0);
    if (used > p.amount + 0.005) add("payment-overallocated", String(p.id), `Payment ${p.id} £${p.amount} allocated £${used.toFixed(2)}`);
    for (const a of p.allocations) {
      const j = jobById.get(a.jobId);
      if (!j) add("allocation-orphan", `${p.id}:${a.jobId}`, `Payment ${p.id} allocated to missing job ${a.jobId}`);
      else if (j.status !== "COMPLETE") add("money-on-unfinished-job", `${p.id}:${j.id}`, `£${a.amount} of payment ${p.id} is on job ${j.id} which is ${j.status} (not counted as paid or credit)`);
    }
  }
  const owed = new Map<number, number>();
  for (const j of allJobs) {
    const paid = j.allocations.filter((a) => !a.payment.voidedAt).reduce((s, a) => s + a.amount, 0);
    if (paid > j.price + 0.005) add("job-overpaid", String(j.id), `Job ${j.id} price £${j.price} but £${paid.toFixed(2)} allocated`);
    if (j.status === "COMPLETE" && !j.isQuote) owed.set(j.customerId, (owed.get(j.customerId) ?? 0) + Math.max(0, j.price - paid));
  }
  const credit = new Map<number, number>();
  for (const p of live) credit.set(p.customerId, (credit.get(p.customerId) ?? 0) + Math.max(0, p.amount - p.allocations.reduce((s, a) => s + a.amount, 0)));
  for (const c of customers) {
    const o = owed.get(c.id) ?? 0, cr = credit.get(c.id) ?? 0;
    if (o > 0.005 && cr > 0.005) add("owing-and-credit", String(c.id), `${c.name}: owes £${o.toFixed(2)} and has £${cr.toFixed(2)} credit`);
  }
  // Money in = paid on cleans + credit (nothing vanishes).
  const moneyIn = live.reduce((s, p) => s + p.amount, 0);
  const onCompleteJobs = allJobs.filter((j) => j.status === "COMPLETE").reduce((s, j) => s + j.allocations.filter((a) => !a.payment.voidedAt).reduce((x, a) => x + a.amount, 0), 0);
  const credits = [...credit.values()].reduce((s, v) => s + v, 0);
  if (Math.abs(moneyIn - onCompleteJobs - credits) > 0.02) add("money-vanished", "total", `£${moneyIn.toFixed(2)} paid in, but £${onCompleteJobs.toFixed(2)} on finished cleans + £${credits.toFixed(2)} credit`);
  return out;
}

export function summarise(problems: Problem[]) {
  const by = new Map<string, number>();
  for (const p of problems) by.set(p.rule, (by.get(p.rule) ?? 0) + 1);
  return [...by.entries()].map(([k, v]) => `${k}=${v}`).join(" ");
}

/** Actions that return { ok, value | error }: make them throw / return the value, like before. */
export function unwrapAll<T extends Record<string, unknown>>(mod: T): T {
  return new Proxy(mod, {
    get(target, key) {
      const fn = target[key as keyof T];
      if (typeof fn !== "function") return fn;
      return async (...args: unknown[]) => {
        const r = await (fn as (...a: unknown[]) => Promise<unknown>)(...args);
        if (r && typeof r === "object" && "ok" in r && ("value" in r || "error" in r)) {
          const o = r as { ok: boolean; value?: unknown; error?: string };
          if (!o.ok) throw new Error(o.error);
          return o.value;
        }
        return r;
      };
    },
  });
}
