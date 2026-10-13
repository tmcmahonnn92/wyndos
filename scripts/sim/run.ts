/**
 * Long simulation: a business works its rounds day by day for months, with skips, missed
 * houses, moves, carry-overs, late finishes, dragged runs, reopened days, area changes, price
 * changes, payments, voids and undos. After every action the rules in lib.ts are checked and
 * the first time each kind of problem appears is reported with what caused it.
 *
 *   DAYS=120 SEED=1 npx tsx --tsconfig scripts/sim/tsconfig.json scripts/sim/run.ts
 */
import prisma from "@/lib/db";
import { addDaysIso, checkRules, createBusiness, isoOf, pick, rand, setSeed, setToday, settle, summarise, today, type Problem } from "./lib";
import { unwrapAll } from "./lib";

const DAYS = Number(process.env.DAYS ?? 120);
const START = process.env.START ?? "2026-11-02";
setSeed(Number(process.env.SEED ?? 1));

type A = typeof import("@/lib/actions");
let act: A;
let tenantId = 0;
const firstSeen = new Map<string, { when: string; action: string; detail: string }>();
const counts = new Map<string, number>();
let known = new Set<string>();
const errors = new Map<string, { count: number; example: string }>();
let actions = 0;

async function step(label: string, fn: () => Promise<unknown>) {
  actions++;
  try {
    await fn();
    await settle();
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0].slice(0, 160) : String(e);
    const k = `${label.split(" ")[0]}: ${msg}`;
    const hit = errors.get(k) ?? { count: 0, example: `${today()} ${label}` };
    hit.count++;
    errors.set(k, hit);
    return;
  }
  const problems = await checkRules(tenantId);
  const keys = new Set(problems.map((p) => p.key));
  for (const p of problems) {
    if (known.has(p.key)) continue;
    counts.set(p.rule, (counts.get(p.rule) ?? 0) + 1);
    if (!firstSeen.has(p.rule)) firstSeen.set(p.rule, { when: today(), action: label, detail: p.detail });
  }
  known = keys;
}

const pendingOn = (dayId: number) => prisma.job.findMany({ where: { tenantId, workDayId: dayId, status: "PENDING" }, select: { id: true, customerId: true, price: true } });

async function unpaidJobs(customerId: number) {
  const jobs = await prisma.job.findMany({
    where: { tenantId, customerId, status: "COMPLETE", isQuote: false },
    select: { id: true, price: true, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } },
  });
  return jobs.map((j) => ({ id: j.id, due: Math.round((j.price - j.allocations.reduce((s, a) => s + a.amount, 0)) * 100) / 100 })).filter((j) => j.due > 0.004);
}

async function workDay(day: { id: number; date: Date; areaId: number | null }, lateBy = 0) {
  const label = `day ${day.id} (${isoOf(day.date)})`;
  await step(`startDay ${label}`, () => act.startDay(day.id));
  for (const j of await pendingOn(day.id)) {
    const r = rand();
    if (r < 0.74) {
      await step(`completeJob ${j.id}`, () => act.completeJob(j.id));
      if (rand() < 0.45) {
        await step(`recordPayment on-the-day ${j.id}`, () => act.recordPayment({ customerId: j.customerId, allocations: [{ jobId: j.id, amount: j.price }], method: pick(["CASH", "BACS", "CARD"] as const) }));
      }
      if (rand() < 0.03) await step(`uncompleteJob ${j.id}`, () => act.uncompleteJob(j.id));
    } else if (r < 0.82) await step(`skipJob ${j.id}`, () => act.skipJob(j.id));
    else if (r < 0.86) await step(`markJobOutstanding ${j.id}`, () => act.markJobOutstanding(j.id));
    else if (r < 0.90) await step(`rescheduleJobToDate ${j.id}`, () => act.rescheduleJobToDate(j.id, addDaysIso(today(), 1 + Math.floor(rand() * 4))));
    // else: left unfinished
  }
  const left = await pendingOn(day.id);
  const carry = left.filter(() => rand() < 0.5).map((j) => j.id);
  if (carry.length) await step(`carry ${carry.length} from ${label}`, () => act.moveOverdueJobsToDay(carry, { kind: "new", dateISO: addDaysIso(today(), 2), sourceAreaName: "Sim" }));
  const skips = (await pendingOn(day.id)).map((j) => ({ jobId: j.id, action: "skip" as const }));
  const finishedOn = addDaysIso(today(), -lateBy);
  await step(`completeDay ${label} on ${finishedOn}`, () => act.completeDay(day.id, skips, finishedOn));
}

(async () => {
  setToday(addDaysIso(START, -1));
  ({ tenantId } = await createBusiness(`run${process.env.SEED ?? 1}`));
  act = unwrapAll(await import("@/lib/actions"));

  // Set up: three 4-weekly rounds, one 8-weekly, one monthly (15th).
  const monthly = await act.createArea({ name: "Monthly 15th", scheduleType: "MONTHLY", monthlyDay: 15, frequencyWeeks: 4 }).then(() => prisma.area.findFirst({ where: { tenantId, name: "Monthly 15th" } }));
  const rows = [];
  const rounds = [["North", 4, 0], ["South", 4, 1], ["East", 4, 2], ["West 8 weekly", 8, 3]] as const;
  let n = 0;
  for (const [area, every, offset] of rounds) {
    for (let k = 0; k < 12; k++) {
      n++;
      rows.push({ name: `Cust ${n}`, address: `${n} Sim Street, Simton, ZZ99 ${String(n).padStart(3, "0").slice(0, 1)}AA`, price: 10 + (n % 6) * 2, areaName: area, areaFrequencyWeeks: every, nextDueDate: addDaysIso(START, offset * 2 + (k % 3 === 0 ? 1 : 0)), frequencyWeeks: every });
    }
  }
  for (let k = 0; k < 8; k++) { n++; rows.push({ name: `Cust ${n}`, address: `${n} Month Road, Simton, ZZ99 9AA`, price: 30, areaId: monthly!.id, nextDueDate: "2026-11-15", frequencyWeeks: 4 }); }
  await step("bulkImportCustomers", () => act.bulkImportCustomers(rows, { createMissingAreas: true, bookRuns: true }));
  console.log("setup:", summarise(await checkRules(tenantId)) || "clean");

  for (let i = 0; i < DAYS; i++) {
    const day = addDaysIso(START, i);
    setToday(day);
    const open = await prisma.workDay.findMany({ where: { tenantId, status: { not: "COMPLETE" }, date: { lte: new Date(`${day}T00:00:00Z`) } }, orderBy: { date: "asc" }, select: { id: true, date: true, areaId: true } });
    for (const d of open) {
      if (rand() < 0.08) continue; // not got to it today
      await workDay(d, rand() < 0.1 ? 1 : 0);
    }

    // Things that happen in the office.
    const custs = await prisma.customer.findMany({ where: { tenantId, active: true }, select: { id: true, areaId: true, price: true } });
    const areas = await prisma.area.findMany({ where: { tenantId, isSystemArea: false }, select: { id: true } });
    const futureRuns = await prisma.workDay.findMany({ where: { tenantId, status: "PLANNED", date: { gt: new Date(`${day}T00:00:00Z`) } }, select: { id: true, date: true } });
    if (futureRuns.length && rand() < 0.05) { const w = pick(futureRuns); const to = addDaysIso(isoOf(w.date), pick([-2, -1, 1, 2, 3])); const mode = rand() < 0.5 ? "one-off" : "recurring"; await step(`rescheduleWorkDay ${w.id} ${isoOf(w.date)}→${to} ${mode}`, () => act.rescheduleWorkDay(w.id, to, mode)); }
    if (rand() < 0.04) { const c = pick(custs); const to = pick(areas.filter((a) => a.id !== c.areaId)); await step(`moveCustomerToArea ${c.id}→${to.id}`, () => act.moveCustomerToArea(c.id, to.id)); }
    if (rand() < 0.05) { const c = pick(custs); await step(`updateCustomer price ${c.id}`, () => act.updateCustomer(c.id, { price: c.price + pick([-2, 2, 5]) })); }
    if (rand() < 0.12) {
      const c = pick(custs); const due = await unpaidJobs(c.id);
      if (due.length) { const extra = rand() < 0.3 ? 5 : 0; await step(`recordPayment owed ${c.id} (+${extra} extra)`, () => act.recordPayment({ customerId: c.id, allocations: due.map((j) => ({ jobId: j.id, amount: j.due })), method: "BACS", extra })); }
    }
    if (rand() < 0.03) { const c = pick(custs); await step(`recordPayment in advance ${c.id}`, () => act.recordPayment({ customerId: c.id, allocations: [], method: "CASH", extra: 20 })); }
    if (rand() < 0.03) { const p = await prisma.payment.findFirst({ where: { tenantId, voidedAt: null }, orderBy: { id: "desc" }, skip: Math.floor(rand() * 5) }); if (p) await step(`voidPayment ${p.id}`, () => act.voidPayment(p.id, "sim")); }
    if (rand() < 0.03) { const done = await prisma.workDay.findFirst({ where: { tenantId, status: "COMPLETE", date: { gte: new Date(`${addDaysIso(day, -10)}T00:00:00Z`) } }, orderBy: { date: "desc" } }); if (done) { await step(`reopenDay ${done.id} (${isoOf(done.date)})`, () => act.reopenDay(done.id)); await step(`completeDay again ${done.id}`, async () => { const left = await pendingOn(done.id); return act.completeDay(done.id, left.map((j) => ({ jobId: j.id, action: "skip" as const })), day); }); } }
    if (rand() < 0.02) { const c = pick(custs); await step(`addCustomerToDate ${c.id}`, () => act.addCustomerToDate(c.id, addDaysIso(day, 3))); }
  }

  const final = await checkRules(tenantId);
  console.log(`\n=== ${DAYS} days, ${actions} actions, seed ${process.env.SEED ?? 1}, business ${tenantId} ===`);
  console.log("still wrong at the end:", summarise(final) || "nothing");
  console.log("\nNew problems seen (rule: times) and the first cause:");
  for (const [rule, info] of firstSeen) console.log(`- ${rule} ×${counts.get(rule)}: ${info.when} after "${info.action}"\n    ${info.detail}`);
  console.log("\nActions that threw (may be fine, e.g. validation):");
  for (const [k, v] of [...errors.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 15)) console.log(`- ×${v.count} ${k}   (e.g. ${v.example})`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
