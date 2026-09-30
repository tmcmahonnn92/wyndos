import prisma from "@/lib/db";
import { getActor, hasPermission } from "@/lib/guards";

/**
 * Business numbers for the owner's dashboard: what the round is worth, what this year
 * should bring in on the current schedule, how well money comes in, how the days are
 * going, and how each person is doing. Everything is worked out from the live schedule,
 * so it moves as areas are booked, moved, split or completed.
 */

const DAY = 86_400_000;
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const round2 = (n: number) => Math.round(n * 100) / 100;

function nextVisit(area: { scheduleType: string; frequencyWeeks: number; monthlyDay: number | null }, from: Date) {
  if (area.scheduleType === "MONTHLY") {
    const day = area.monthlyDay ?? 1;
    const same = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), day));
    if (same > from) return same;
    return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, day));
  }
  return addDays(from, Math.max(1, area.frequencyWeeks || 4) * 7);
}

export type MonthPoint = { month: number; label: string; cleaned: number; projected: number };
export type WorkerRow = {
  id: string;
  name: string;
  days: number;
  jobs: number;
  value: number;
  perDay: number;
  cash: number;
  skipped: number;
};

export async function getDashboardInsights() {
  const actor = await getActor();
  // Business-wide money is for the owner and anyone trusted with the accounts.
  if (actor.isWorker && !hasPermission(actor, "accounting")) return null;
  const tenantId = actor.tenantId;

  const now = new Date();
  const today = utcDay(now);
  const year = today.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1)); // exclusive
  const last90 = addDays(today, -90);
  const last28 = addDays(today, -28);
  const last30 = addDays(today, -30);

  const [areas, completedYear, completedRecent, skippedRecent, openDays, paymentsYear, owedJobs, members, newCustomers] = await Promise.all([
    prisma.area.findMany({
      where: { tenantId, isSystemArea: false },
      select: {
        id: true, name: true, scheduleType: true, frequencyWeeks: true, monthlyDay: true, nextDueDate: true,
        customers: { where: { active: true }, select: { price: true } },
      },
    }),
    // Cleans done this year (by the day they were done).
    prisma.job.findMany({
      where: { tenantId, status: "COMPLETE", isQuote: false, workDay: { date: { gte: yearStart, lt: yearEnd } } },
      select: { price: true, workDay: { select: { date: true } } },
    }),
    // Cleans in the last 90 days, with who did them.
    prisma.job.findMany({
      where: { tenantId, status: "COMPLETE", isQuote: false, workDay: { date: { gte: last90, lte: today } } },
      select: {
        price: true, completedByUserId: true, assignedUserId: true,
        workDay: { select: { date: true, assignedUserId: true } },
      },
    }),
    prisma.job.findMany({
      where: { tenantId, status: "SKIPPED", workDay: { date: { gte: last90, lte: today } } },
      select: { assignedUserId: true, workDay: { select: { date: true, assignedUserId: true } } },
    }),
    // Booked, not done yet: the real start of each area's future.
    prisma.workDay.findMany({
      where: { tenantId, status: { not: "COMPLETE" } },
      select: {
        date: true, areaId: true, partOfId: true, area: { select: { isSystemArea: true } },
        jobs: { where: { status: "PENDING", isQuote: false }, select: { price: true } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.payment.findMany({
      where: { tenantId, voidedAt: null, paidAt: { gte: yearStart < last90 ? yearStart : last90 } },
      select: { amount: true, method: true, paidAt: true, collectedByUserId: true },
    }),
    prisma.job.findMany({
      where: { tenantId, status: "COMPLETE", isQuote: false },
      select: {
        price: true, workDay: { select: { date: true } },
        allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
      },
    }),
    prisma.membership.findMany({
      where: { tenantId },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
    }),
    prisma.customer.count({ where: { tenantId, active: true, createdAt: { gte: last90 }, area: { isSystemArea: false } } }),
  ]);

  // ── The round ─────────────────────────────────────────────────────────────
  let activeCustomers = 0;
  let runRate = 0; // a year of cleans at today's prices and frequencies
  let priceSum = 0;
  for (const area of areas) {
    const perYear = area.scheduleType === "MONTHLY" ? 12 : 52 / Math.max(1, area.frequencyWeeks || 4);
    for (const c of area.customers) {
      activeCustomers += 1;
      priceSum += c.price;
      runRate += c.price * perYear;
    }
  }
  const avgPrice = activeCustomers ? priceSum / activeCustomers : 0;

  // ── This year: cleaned so far + what the schedule says is still to come ─────
  const months: MonthPoint[] = Array.from({ length: 12 }, (_, m) => ({
    month: m,
    label: new Date(Date.UTC(year, m, 1)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
    cleaned: 0,
    projected: 0,
  }));
  for (const job of completedYear) months[job.workDay.date.getUTCMonth()].cleaned += job.price;

  // Booked days still to do this year count at their actual jobs (incl. one-offs).
  const bookedByArea = new Map<number, Date>();
  for (const day of openDays) {
    const d = utcDay(day.date);
    const effective = d < today ? today : d; // overdue: assume it's done now
    if (effective < yearEnd) {
      months[effective.getUTCMonth()].projected += day.jobs.reduce((s, j) => s + j.price, 0);
    }
    if (day.areaId && !day.area?.isSystemArea && day.partOfId === null) {
      const prev = bookedByArea.get(day.areaId);
      if (!prev || d < prev) bookedByArea.set(day.areaId, d);
    }
  }
  // After each area's next booked run (or its due date), repeat at its frequency to year end.
  for (const area of areas) {
    const areaValue = area.customers.reduce((s, c) => s + c.price, 0);
    if (!areaValue) continue;
    const booked = bookedByArea.get(area.id);
    let visit: Date;
    if (booked) {
      visit = nextVisit(area, booked < today ? today : booked);
    } else {
      const due = area.nextDueDate ? utcDay(area.nextDueDate) : today;
      visit = due < today ? today : due;
    }
    let guard = 0;
    while (visit < yearEnd && guard++ < 400) {
      months[visit.getUTCMonth()].projected += areaValue;
      visit = nextVisit(area, visit);
    }
  }
  months.forEach((m) => { m.cleaned = round2(m.cleaned); m.projected = round2(m.projected); });
  const cleanedYtd = round2(months.reduce((s, m) => s + m.cleaned, 0));
  const projectedRest = round2(months.reduce((s, m) => s + m.projected, 0));
  const collectedYtd = round2(paymentsYear.filter((p) => p.paidAt >= yearStart).reduce((s, p) => s + p.amount, 0));

  // ── Money coming in ───────────────────────────────────────────────────────
  const cleaned90 = completedRecent.reduce((s, j) => s + j.price, 0);
  const pay90 = paymentsYear.filter((p) => p.paidAt >= last90);
  const collected90 = pay90.reduce((s, p) => s + p.amount, 0);
  const methodTotals = { CASH: 0, BACS: 0, CARD: 0 } as Record<string, number>;
  for (const p of pay90) methodTotals[p.method] = (methodTotals[p.method] ?? 0) + p.amount;
  const aged = { d30: 0, d60: 0, d90: 0, older: 0 };
  let owedTotal = 0;
  for (const job of owedJobs) {
    const due = job.price - job.allocations.reduce((s, a) => s + a.amount, 0);
    if (due <= 0.005) continue;
    owedTotal += due;
    const age = Math.floor((today.getTime() - utcDay(job.workDay.date).getTime()) / DAY);
    if (age <= 30) aged.d30 += due;
    else if (age <= 60) aged.d60 += due;
    else if (age <= 90) aged.d90 += due;
    else aged.older += due;
  }

  // ── How the days are going (last 4 weeks) ───────────────────────────────────
  const recent28 = completedRecent.filter((j) => j.workDay.date >= last28);
  const workingDates = new Set(recent28.map((j) => utcDay(j.workDay.date).getTime()));
  const value28 = recent28.reduce((s, j) => s + j.price, 0);
  const skipped28 = skippedRecent.filter((j) => j.workDay.date >= last28).length;
  const booked28 = openDays
    .filter((d) => d.date >= today && d.date < addDays(today, 28))
    .reduce((s, d) => s + d.jobs.reduce((t, j) => t + j.price, 0), 0);

  // ── Each person (last 30 days) ──────────────────────────────────────────────
  const owner = members.find((m) => m.role === "OWNER");
  const nameOf = (id: string) => {
    const m = members.find((x) => x.userId === id);
    return m?.user.name || m?.user.email?.split("@")[0] || "Someone";
  };
  const whoDid = (j: { completedByUserId: string | null; assignedUserId: string | null; workDay: { assignedUserId: string | null } }) =>
    j.completedByUserId ?? j.assignedUserId ?? j.workDay.assignedUserId ?? owner?.userId ?? "owner";
  const rows = new Map<string, WorkerRow & { dates: Set<number> }>();
  const rowFor = (id: string) => {
    if (!rows.has(id)) rows.set(id, { id, name: id === "owner" ? "Owner" : nameOf(id), days: 0, jobs: 0, value: 0, perDay: 0, cash: 0, skipped: 0, dates: new Set() });
    return rows.get(id)!;
  };
  for (const job of completedRecent.filter((j) => j.workDay.date >= last30)) {
    const r = rowFor(whoDid(job));
    r.jobs += 1;
    r.value += job.price;
    r.dates.add(utcDay(job.workDay.date).getTime());
  }
  for (const job of skippedRecent.filter((j) => j.workDay.date >= last30)) {
    rowFor(job.assignedUserId ?? job.workDay.assignedUserId ?? owner?.userId ?? "owner").skipped += 1;
  }
  for (const p of pay90.filter((x) => x.paidAt >= last30 && x.method === "CASH")) {
    rowFor(p.collectedByUserId ?? owner?.userId ?? "owner").cash += p.amount;
  }
  const workers: WorkerRow[] = [...rows.values()]
    .map(({ dates, ...r }) => ({
      ...r,
      days: dates.size,
      value: round2(r.value),
      cash: round2(r.cash),
      perDay: dates.size ? round2(r.value / dates.size) : 0,
    }))
    .filter((r) => r.jobs > 0 || r.skipped > 0 || r.cash > 0)
    .sort((a, b) => b.value - a.value);

  return {
    year,
    round: {
      activeCustomers,
      avgPrice: round2(avgPrice),
      runRate: round2(runRate),
      perMonth: round2(runRate / 12),
      newCustomers90: newCustomers,
    },
    thisYear: {
      cleanedYtd,
      collectedYtd,
      projectedRest,
      projectedTotal: round2(cleanedYtd + projectedRest),
      months,
      currentMonth: today.getUTCMonth(),
    },
    money: {
      owedTotal: round2(owedTotal),
      aged: { d30: round2(aged.d30), d60: round2(aged.d60), d90: round2(aged.d90), older: round2(aged.older) },
      collectionRate: cleaned90 > 0 ? Math.min(1, collected90 / cleaned90) : null,
      cleaned90: round2(cleaned90),
      collected90: round2(collected90),
      methods: [
        { key: "CASH", label: "Cash", amount: round2(methodTotals.CASH ?? 0) },
        { key: "BACS", label: "Bank", amount: round2(methodTotals.BACS ?? 0) },
        { key: "CARD", label: "Card", amount: round2(methodTotals.CARD ?? 0) },
      ],
    },
    days: {
      workingDays: workingDates.size,
      jobs: recent28.length,
      value: round2(value28),
      perDay: workingDates.size ? round2(value28 / workingDates.size) : 0,
      jobsPerDay: workingDates.size ? Math.round((recent28.length / workingDates.size) * 10) / 10 : 0,
      skipRate: recent28.length + skipped28 > 0 ? skipped28 / (recent28.length + skipped28) : 0,
      bookedNext28: round2(booked28),
    },
    workers,
  };
}

export type DashboardInsights = NonNullable<Awaited<ReturnType<typeof getDashboardInsights>>>;
