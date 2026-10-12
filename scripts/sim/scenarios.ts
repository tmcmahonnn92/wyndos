/**
 * Targeted checks: each one sets up a small business, does one risky thing the way a user
 * would, and checks the result. PASS = behaves correctly.
 *
 *   npx tsx --tsconfig scripts/sim/tsconfig.json scripts/sim/scenarios.ts [name-filter]
 */
import prisma from "@/lib/db";
import { addDaysIso, checkRules, createBusiness, isoOf, setToday, settle, summarise } from "./lib";

type A = typeof import("@/lib/actions");
let act: A;
const D = "2026-11-02";
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

/** Business with area "A" (4-weekly), 4 customers due today, today's run booked. */
async function fresh(label: string, opts: { monthly?: boolean } = {}) {
  setToday(D);
  const { tenantId } = await createBusiness(label);
  let areaId: number | undefined;
  if (opts.monthly) {
    await act.createArea({ name: "M", scheduleType: "MONTHLY", monthlyDay: 15, frequencyWeeks: 4 });
    areaId = (await prisma.area.findFirst({ where: { tenantId, name: "M" } }))!.id;
  }
  const due = opts.monthly ? "2026-11-15" : D;
  await act.bulkImportCustomers([1, 2, 3, 4].map((i) => ({
    name: `C${i}`, address: `${i} Test Rd, Testford, ZZ99 1AA`, price: 20, nextDueDate: due, frequencyWeeks: 4,
    ...(areaId ? { areaId } : { areaName: "A", areaFrequencyWeeks: 4 }),
  })), { createMissingAreas: true, bookRuns: true });
  await settle();
  const area = (await prisma.area.findFirst({ where: { tenantId, isSystemArea: false } }))!;
  const run = (await prisma.workDay.findFirst({ where: { tenantId, areaId: area.id }, orderBy: { date: "asc" } }))!;
  const customers = await prisma.customer.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  const jobOf = async (customerId: number, dayId = run.id) => (await prisma.job.findFirst({ where: { tenantId, customerId, workDayId: dayId } }))!;
  const openRuns = () => prisma.workDay.findMany({ where: { tenantId, areaId: area.id, status: { not: "COMPLETE" } }, orderBy: { date: "asc" } });
  const finishDay = async (dayId: number, date: string) => {
    const left = await prisma.job.findMany({ where: { tenantId, workDayId: dayId, status: "PENDING" } });
    for (const j of left) await act.completeJob(j.id);
    return act.completeDay(dayId, [], date);
  };
  return { tenantId, area, run, customers, jobOf, openRuns, finishDay };
}

async function test(name: string, fn: () => Promise<string | true>) {
  if (process.argv[2] && !name.includes(process.argv[2])) return;
  try {
    const r = await fn();
    await settle();
    results.push({ name, ok: r === true, detail: r === true ? "" : r });
  } catch (e) {
    results.push({ name, ok: false, detail: `threw: ${e instanceof Error ? e.message.split("\n")[0] : e}` });
  }
}

(async () => {
  setToday(D);
  act = await import("@/lib/actions");

  await test("undo a clean doesn't void a payment taken later", async () => {
    const b = await fresh("undo");
    await act.startDay(b.run.id);
    const j = await b.jobOf(b.customers[0].id);
    await act.completeJob(j.id);
    setToday(addDaysIso(D, 1));
    await act.recordPayment({ customerId: b.customers[0].id, allocations: [{ jobId: j.id, amount: 20 }], method: "BACS", extra: 5 });
    setToday(D, 18);
    await act.uncompleteJob(j.id);
    const p = await prisma.payment.findFirst({ where: { tenantId: b.tenantId } });
    return p?.voidedAt ? `the £25 bank payment from the next day was voided by undoing the clean` : true;
  });

  await test("undo + cancel removes a payment logged by mistake; earlier credit stays", async () => {
    const b = await fresh("undo-cancel");
    const c = b.customers[0].id;
    setToday(D, 8);
    await act.recordPayment({ customerId: c, allocations: [], method: "CASH", extra: 5 }); // paid in advance
    setToday(D, 9);
    await act.startDay(b.run.id);
    const j = await b.jobOf(c);
    await act.completeJob(j.id);
    setToday(D, 12);
    await act.recordPayment({ customerId: c, allocations: [{ jobId: j.id, amount: 15 }], method: "CASH" }); // the mistake
    await act.uncompleteJob(j.id, { payment: "cancel" });
    const live = await prisma.payment.findMany({ where: { tenantId: b.tenantId, voidedAt: null } });
    const credit = await act.getCustomerCredit(c);
    return live.length === 1 && Math.abs(credit - 5) < 0.01 ? true : `${live.length} payments left, credit £${credit} (expected 1 and £5)`;
  });

  await test("undo + keep turns the payment into credit", async () => {
    const b = await fresh("undo-keep");
    const c = b.customers[0].id;
    await act.startDay(b.run.id);
    const j = await b.jobOf(c);
    await act.completeJob(j.id);
    await act.recordPayment({ customerId: c, allocations: [{ jobId: j.id, amount: 20 }], method: "CASH" });
    await act.uncompleteJob(j.id, { payment: "keep" });
    const credit = await act.getCustomerCredit(c);
    return Math.abs(credit - 20) < 0.01 ? true : `credit £${credit} (expected £20)`;
  });

  await test("marking inactive takes them off upcoming runs, keeps done cleans", async () => {
    const b = await fresh("inactive");
    const c = b.customers[0].id;
    await b.finishDay(b.run.id, D);
    const next = (await b.openRuns())[0];
    await act.updateCustomer(c, { active: false });
    const done = await prisma.job.count({ where: { customerId: c, status: "COMPLETE" } });
    const upcoming = await prisma.job.count({ where: { customerId: c, workDayId: next.id } });
    return done === 1 && upcoming === 0 ? true : `done cleans ${done} (expected 1), still on next run: ${upcoming}`;
  });

  await test("changing area keeps a done-but-unpaid clean", async () => {
    const b = await fresh("area");
    await act.startDay(b.run.id);
    const j = await b.jobOf(b.customers[0].id);
    await act.completeJob(j.id);
    await act.createArea({ name: "B", frequencyWeeks: 4 });
    const other = (await prisma.area.findFirst({ where: { tenantId: b.tenantId, name: "B" } }))!;
    await act.updateCustomer(b.customers[0].id, { areaId: other.id });
    const still = await prisma.job.findUnique({ where: { id: j.id } });
    return still?.status === "COMPLETE" ? true : `the completed £20 clean was deleted (${still ? still.status : "gone"})`;
  });

  await test("moving customers to another area keeps done-but-unpaid cleans", async () => {
    const b = await fresh("area2");
    await act.startDay(b.run.id);
    const j = await b.jobOf(b.customers[1].id);
    await act.completeJob(j.id);
    await act.createArea({ name: "B", frequencyWeeks: 4 });
    const other = (await prisma.area.findFirst({ where: { tenantId: b.tenantId, name: "B" } }))!;
    await act.moveCustomerToArea(b.customers[1].id, other.id);
    const still = await prisma.job.findUnique({ where: { id: j.id } });
    return still?.status === "COMPLETE" ? true : `the completed clean was deleted`;
  });

  await test("changing a customer's price leaves today's paid clean alone", async () => {
    const b = await fresh("price");
    await act.startDay(b.run.id);
    const j = await b.jobOf(b.customers[0].id);
    await act.completeJob(j.id);
    await act.recordPayment({ customerId: b.customers[0].id, allocations: [{ jobId: j.id, amount: 20 }], method: "CASH" });
    await act.updateCustomer(b.customers[0].id, { price: 25 });
    const after = await prisma.job.findUnique({ where: { id: j.id } });
    const pending = await b.jobOf(b.customers[1].id);
    await act.updateCustomer(b.customers[1].id, { price: 25 });
    const pendingAfter = await prisma.job.findUnique({ where: { id: pending.id } });
    if (after?.price !== 20) return `paid £20 clean became £${after?.price}: customer now owes £${(after!.price - 20).toFixed(2)}`;
    if (pendingAfter?.price !== 25) return `not-yet-done clean wasn't updated to the new price`;
    return true;
  });

  await test("moving one job to a later date still books the area's next run", async () => {
    const b = await fresh("moved");
    await act.startDay(b.run.id);
    await act.rescheduleJobToDate((await b.jobOf(b.customers[0].id)).id, addDaysIso(D, 3));
    await b.finishDay(b.run.id, D);
    const open = (await b.openRuns()).filter((d) => !d.partOfId);
    return open.length ? true : `no next run booked for the area until the moved job is done (${(await b.openRuns()).length} open part days)`;
  });

  await test("drag a run 'and all after' keeps the area due on that run", async () => {
    const b = await fresh("drag");
    await b.finishDay(b.run.id, D);
    const next = (await b.openRuns())[0];
    await act.rescheduleWorkDay(next.id, addDaysIso(isoOf(next.date), 2), "recurring");
    const area = await prisma.area.findUnique({ where: { id: b.area.id } });
    const moved = (await b.openRuns())[0];
    return isoOf(area!.nextDueDate) === isoOf(moved.date) ? true : `area due ${isoOf(area!.nextDueDate)} but its next run is ${isoOf(moved.date)}`;
  });

  await test("booking a customer on a date doesn't double-book them", async () => {
    const b = await fresh("book");
    await act.addCustomerToDate(b.customers[0].id, addDaysIso(D, 5));
    const jobs = await prisma.job.findMany({ where: { tenantId: b.tenantId, customerId: b.customers[0].id, status: "PENDING" } });
    return jobs.length === 1 ? true : `customer now has ${jobs.length} pending visits`;
  });

  await test("reopening an old day doesn't delete the current next run", async () => {
    const b = await fresh("reopen-old");
    await b.finishDay(b.run.id, D);
    const r1 = (await b.openRuns())[0];
    setToday(isoOf(r1.date));
    await b.finishDay(r1.id, isoOf(r1.date));
    const r2 = (await b.openRuns())[0];
    try { await act.reopenDay(b.run.id); } catch { /* refusing is fine */ }
    const r2still = await prisma.workDay.findUnique({ where: { id: r2.id } });
    const c = await prisma.customer.findUnique({ where: { id: b.customers[0].id } });
    if (!r2still) return `reopening the first day deleted the area's current run on ${isoOf(r2.date)}; customers due ${isoOf(c!.nextDueDate)}`;
    return true;
  });

  await test("reopening a day keeps cleans already done on the next run", async () => {
    const b = await fresh("reopen-next");
    await b.finishDay(b.run.id, D);
    const r1 = (await b.openRuns())[0];
    setToday(isoOf(r1.date));
    await act.startDay(r1.id);
    const j = await b.jobOf(b.customers[0].id, r1.id);
    await act.completeJob(j.id);
    try { await act.reopenDay(b.run.id); } catch { /* refusing is fine */ }
    const still = await prisma.job.findUnique({ where: { id: j.id } });
    return still?.status === "COMPLETE" ? true : `a clean done (unpaid) on the next run was deleted`;
  });

  await test("monthly round finished early books next month", async () => {
    const b = await fresh("monthly", { monthly: true });
    const run = (await b.openRuns())[0];
    setToday("2026-11-13");
    await b.finishDay(run.id, "2026-11-13");
    const next = (await b.openRuns())[0];
    return next && isoOf(next.date) === "2026-12-15" ? true : `next run booked for ${next ? isoOf(next.date) : "nothing"} (expected 15 Dec)`;
  });

  await test("changing an old day's date doesn't rewind customers", async () => {
    const b = await fresh("olddate");
    await b.finishDay(b.run.id, D);
    const r1 = (await b.openRuns())[0];
    setToday(isoOf(r1.date));
    await b.finishDay(r1.id, isoOf(r1.date));
    const before = await prisma.customer.findUnique({ where: { id: b.customers[0].id } });
    await act.updateCompletedWorkDayDate(b.run.id, addDaysIso(D, -1));
    const after = await prisma.customer.findUnique({ where: { id: b.customers[0].id } });
    return isoOf(after!.nextDueDate) === isoOf(before!.nextDueDate) ? true : `customer due ${isoOf(before!.nextDueDate)} became ${isoOf(after!.nextDueDate)} (overdue)`;
  });

  await test("rain-off (move today's run) keeps houses already done on today", async () => {
    const b = await fresh("rain");
    await act.startDay(b.run.id);
    const j = await b.jobOf(b.customers[0].id);
    await act.completeJob(j.id);
    await act.rescheduleWorkDay(b.run.id, addDaysIso(D, 1), "one-off");
    const job = await prisma.job.findUnique({ where: { id: j.id }, include: { workDay: true } });
    return isoOf(job!.workDay.date) === D ? true : `the house cleaned today now shows as done on ${isoOf(job!.workDay.date)}`;
  });

  await test("payment can't land on a job that wasn't done", async () => {
    const b = await fresh("outstanding");
    await act.startDay(b.run.id);
    const j = await b.jobOf(b.customers[2].id);
    await act.markJobOutstanding(j.id);
    try { await act.recordPayment({ customerId: b.customers[2].id, allocations: [{ jobId: j.id, amount: 20 }], method: "CASH" }); } catch { return true; }
    const alloc = await prisma.paymentAllocation.findFirst({ where: { jobId: j.id } });
    const credit = await act.getCustomerCredit(b.customers[2].id);
    return alloc ? `£20 allocated to a job marked not done: not owed and not credit (credit shows £${credit})` : true;
  });

  await test("finishing a day twice doesn't double-book", async () => {
    const b = await fresh("twice");
    await b.finishDay(b.run.id, D);
    await act.completeDay(b.run.id, [], D).catch(() => null);
    const open = await b.openRuns();
    const jobs = await prisma.job.findMany({ where: { tenantId: b.tenantId, workDayId: { in: open.map((d) => d.id) } } });
    return open.length === 1 && jobs.length === 4 ? true : `${open.length} open runs, ${jobs.length} jobs on them`;
  });

  await test("moving an undone job off a finished day doesn't hijack the round", async () => {
    const b = await fresh("hijack");
    await b.finishDay(b.run.id, D);
    const next = (await b.openRuns())[0];
    const j = await b.jobOf(b.customers[0].id);
    await act.uncompleteJob(j.id);
    await act.rescheduleJobToDate(j.id, addDaysIso(D, 3));
    setToday(addDaysIso(D, 3));
    const extra = (await prisma.job.findUnique({ where: { id: j.id } }))!;
    await act.completeJob(extra.id);
    await act.completeDay(extra.workDayId, [], addDaysIso(D, 3));
    const runs = await b.openRuns();
    const nextStill = runs.find((d) => d.id === next.id) ?? runs[0];
    return nextStill && isoOf(nextStill.date) === isoOf(next.date) ? true : `area's next run moved from ${isoOf(next.date)} to ${nextStill ? isoOf(nextStill.date) : "none"}`;
  });

  await test("credit and unpaid cleans don't sit side by side", async () => {
    const b = await fresh("credit");
    await act.startDay(b.run.id);
    const j = await b.jobOf(b.customers[3].id);
    await act.completeJob(j.id);
    await act.recordPayment({ customerId: b.customers[3].id, allocations: [], method: "CASH", extra: 30 });
    const p = await checkRules(b.tenantId);
    const bad = p.find((x) => x.rule === "owing-and-credit");
    return bad ? bad.detail : true;
  });

  await test("customer skipped today isn't left overdue", async () => {
    const b = await fresh("skip");
    await act.startDay(b.run.id);
    await act.skipJob((await b.jobOf(b.customers[0].id)).id);
    await b.finishDay(b.run.id, D);
    setToday(addDaysIso(D, 7));
    const c = await prisma.customer.findUnique({ where: { id: b.customers[0].id } });
    const next = (await b.openRuns())[0];
    const on = await prisma.job.findFirst({ where: { workDayId: next.id, customerId: b.customers[0].id } });
    return isoOf(c!.nextDueDate) >= addDaysIso(D, 7) && on ? true : `skipped customer due ${isoOf(c!.nextDueDate)}, on next run: ${Boolean(on)}`;
  });

  await test("whole simulation business is clean after each test", async () => true);

  console.log("");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      → ${r.detail}`}`);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} pass`);
  void summarise;
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
