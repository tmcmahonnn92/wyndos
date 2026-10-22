/**
 * Direct Debit money safety: every way a clean can be ticked, undone, re-ticked, collected,
 * failed, retried, charged back, refunded or shared, checked against what GoCardless (the
 * stand-in, scripts/sim/gc-mock.cjs) actually holds.
 *
 * After every step the money rules are checked:
 *  - never two live collections for one clean
 *  - never collect more than a clean's price
 *  - every payment GoCardless received is recorded exactly once in Wyndos, for the same amount
 *  - failed / charged-back money isn't counted
 *  - no clean is ever paid more than its price; no negative credit
 *  - refunds never add up to more than the payment, in GoCardless or in Wyndos
 *
 * Run: node scripts/sim/gc-mock.cjs &  then
 *   WYNDOS_SANDBOX=1 GOCARDLESS_API_BASE=http://127.0.0.1:4600 DATABASE_URL=… AUTH_SECRET=x TZ=UTC \
 *   npx tsx --tsconfig scripts/sim/tsconfig.json scripts/sim/gc-money-check.ts
 */
import prisma from "@/lib/db";
import { createBusiness, setToday, settle, unwrapAll } from "./lib";

let fails = 0, passes = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` (${d})` : ""}`); };
const r2 = (n: number) => Math.round(n * 100) / 100;
const mock = (path: string, body: unknown = {}) => fetch(`http://127.0.0.1:4600${path}`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
type MockPayment = { id: string; amount: number; status: string; metadata?: Record<string, string>; links: { mandate: string } };
type MockState = { payments: MockPayment[]; refunds: Array<{ id: string; amount: number; status: string; links: { payment: string } }>; posts: Array<{ path: string; key: string }> };
const gcState = () => mock("/_test/state") as Promise<MockState>;
const LIVE = new Set(["pending_customer_approval", "pending_submission", "submitted", "confirmed", "paid_out"]);
const RECEIVED = new Set(["confirmed", "paid_out"]);

let tenantId = 0;
/** Cleans where a test forces GoCardless to take two payments (to check Wyndos still counts both). */
const forcedDouble = new Set<number>();
let workDayId = 0;
let n = 0;

/** The money rules, checked across the whole business. */
async function rules(step: string) {
  const st = await gcState();
  const problems: string[] = [];
  // 1. Never two live collections for one clean; never more than its price.
  const byJob = new Map<number, MockPayment[]>();
  for (const p of st.payments) { const j = Number(p.metadata?.wyndosJobId); if (j && LIVE.has(p.status)) byJob.set(j, [...(byJob.get(j) ?? []), p]); }
  for (const [jobId, ps] of byJob) {
    if (ps.length > 1 && !forcedDouble.has(jobId)) problems.push(`clean ${jobId} has ${ps.length} live collections`);
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { price: true } });
    const live = ps.reduce((s, p) => s + p.amount, 0) / 100;
    if (job && live > job.price + 0.004 && !ps.every((p) => RECEIVED.has(p.status))) problems.push(`clean ${jobId}: £${live} being collected for a £${job.price} clean`);
  }
  // 2. Every received GoCardless payment recorded once, same amount; failed ones not counted.
  const recorded = await prisma.payment.findMany({ where: { tenantId, goCardlessPaymentId: { not: null } }, select: { goCardlessPaymentId: true, amount: true, voidedAt: true } });
  const recById = new Map(recorded.map((r) => [r.goCardlessPaymentId!, r]));
  for (const p of st.payments) {
    const rec = recById.get(p.id);
    if (RECEIVED.has(p.status) && (!rec || rec.voidedAt)) problems.push(`GoCardless received ${p.id} (£${p.amount / 100}) but Wyndos hasn't counted it`);
    if (rec && !rec.voidedAt && r2(rec.amount) !== r2(p.amount / 100)) problems.push(`${p.id}: GoCardless £${p.amount / 100}, Wyndos £${rec.amount}`);
    if (rec && !rec.voidedAt && ["failed", "charged_back", "cancelled"].includes(p.status)) problems.push(`${p.id} is ${p.status} but still counted in Wyndos`);
  }
  // 3. No clean paid more than its price; no negative money on a clean.
  const jobs = await prisma.job.findMany({ where: { tenantId }, select: { id: true, price: true, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } } });
  for (const j of jobs) {
    const paid = r2(j.allocations.reduce((s, a) => s + a.amount, 0));
    if (paid > j.price + 0.004) problems.push(`clean ${j.id} paid £${paid} on a £${j.price} price`);
    if (paid < -0.004) problems.push(`clean ${j.id} has £${paid} paid`);
  }
  // 4. No payment over-allocated (negative credit).
  const pays = await prisma.payment.findMany({ where: { tenantId, voidedAt: null, amount: { gt: 0 } }, select: { id: true, amount: true, allocations: { select: { amount: true } } } });
  const refundRows = await prisma.payment.findMany({ where: { tenantId, voidedAt: null, refundOfId: { not: null } }, select: { refundOfId: true, amount: true } });
  for (const p of pays) {
    const used = r2(p.allocations.reduce((s, a) => s + a.amount, 0));
    if (used > p.amount + 0.004) problems.push(`payment ${p.id} £${p.amount} allocated £${used}`);
    const refunded = r2(-refundRows.filter((r) => r.refundOfId === p.id).reduce((s, r) => s + r.amount, 0));
    if (refunded > p.amount + 0.004) problems.push(`payment ${p.id} £${p.amount} refunded £${refunded}`);
  }
  // 5. GoCardless refunds never more than their payment.
  for (const p of st.payments) {
    const back = st.refunds.filter((r) => r.links.payment === p.id && !["cancelled", "bounced", "funds_returned"].includes(r.status)).reduce((s, r) => s + r.amount, 0);
    if (back > p.amount) problems.push(`GoCardless refunded £${back / 100} of £${p.amount / 100} on ${p.id}`);
  }
  check(`rules hold after: ${step}`, problems.length === 0, problems.join("; "));
}

let act: Awaited<ReturnType<typeof load>>["act"];
let core: Awaited<ReturnType<typeof load>>["core"];
let gca: Awaited<ReturnType<typeof load>>["gca"];
async function load() {
  return { act: unwrapAll(await import("@/lib/actions")), core: await import("@/lib/gocardless/core"), gca: await import("@/lib/gocardless/actions") };
}

/** A customer with their own active Direct Debit and one clean on today's run. */
async function customer(name: string, price = 20, mandate?: string) {
  const id = mandate ?? `MDM${++n}`;
  if (!mandate) await mock("/_test/mandate", { id, status: "active", links: { customer: `CU${id}` } });
  const area = await prisma.workDay.findUniqueOrThrow({ where: { id: workDayId }, select: { areaId: true } });
  const c = await prisma.customer.create({ data: {
    tenantId, areaId: area.areaId!, name, address: `${n} Test St, Testford, ZZ9 9ZZ`, houseNameNumber: String(n), street: "Test St", price, frequencyWeeks: 4,
    preferredPaymentMethod: "DD", goCardlessMandateId: id, goCardlessMandateStatus: "active", goCardlessCustomerId: `CU${id}`, goCardlessLinkedAt: new Date("2026-10-01"),
  } });
  const job = await prisma.job.create({ data: { tenantId, workDayId, customerId: c.id, price, name: "Window Cleaning" } });
  return { c, job, mandate: id };
}
const livePayments = async (jobId: number) => (await gcState()).payments.filter((p) => Number(p.metadata?.wyndosJobId) === jobId && LIVE.has(p.status));
const allPayments = async (jobId: number) => (await gcState()).payments.filter((p) => Number(p.metadata?.wyndosJobId) === jobId);
const jobRow = (id: number) => prisma.job.findUniqueOrThrow({ where: { id }, select: { status: true, price: true, goCardlessPaymentId: true, goCardlessStatus: true, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } } });
const owed = async (jobId: number) => { const j = await jobRow(jobId); return j.status === "COMPLETE" ? r2(j.price - j.allocations.reduce((s, a) => s + a.amount, 0)) : 0; };
const credit = async (cid: number) => { const ps = await prisma.payment.findMany({ where: { tenantId, customerId: cid, voidedAt: null }, select: { amount: true, allocations: { select: { amount: true } } } }); return r2(ps.reduce((s, p) => s + p.amount - p.allocations.reduce((t, a) => t + a.amount, 0), 0)); };
const status = (id: string, s: string) => mock("/_test/status", { id, status: s });
const tick = async (jobId: number) => { await act.completeJob(jobId); await settle(); };

async function main() {
  ({ act, core, gca } = await load());
  await mock("/_test/reset");
  setToday("2026-11-02");
  ({ tenantId } = await createBusiness("gc-money"));
  await prisma.tenantSettings.update({ where: { tenantId }, data: { goCardlessAccessToken: "sandbox_test_token", goCardlessEnvironment: "sandbox" } });
  await prisma.tenant.update({ where: { id: tenantId }, data: { trialFeatures: "gocardless" } });
  await act.bulkImportCustomers([{ name: "Seed", address: "1 Seed Rd, Testford, ZZ9 9ZZ", price: 10, nextDueDate: "2026-11-02", frequencyWeeks: 4, areaName: "A", areaFrequencyWeeks: 4 }] as never, { createMissingAreas: true, bookRuns: true } as never);
  await settle();
  workDayId = (await prisma.workDay.findFirstOrThrow({ where: { tenantId } })).id;
  await gca.setGoCardlessAutoCollect(true);

  // ── S1 Basic: tick → one collection → money arrives → recorded once (syncing again changes nothing).
  {
    const { c, job } = await customer("S1 Basic");
    await tick(job.id);
    const live = await livePayments(job.id);
    check("S1 ticking Done collects once, for the price", live.length === 1 && live[0].amount === 2000, JSON.stringify(live.map((p) => p.amount)));
    await status(live[0].id, "paid_out");
    await core.syncTenant(tenantId); await core.syncTenant(tenantId); await core.syncTenant(tenantId);
    check("S1 money arrives: clean paid, recorded once", (await owed(job.id)) === 0 && (await prisma.payment.count({ where: { tenantId, goCardlessPaymentId: live[0].id } })) === 1 && (await credit(c.id)) === 0);
    await rules("S1");
  }

  // ── S2 Double taps / offline replays / everyone collecting at once → one collection.
  {
    const { job } = await customer("S2 Doubles");
    await Promise.all([act.completeJob(job.id), act.completeJob(job.id), act.completeJob(job.id)]);
    await Promise.all([settle(), core.collectForJobs(tenantId, [job.id]), core.collectForJobs(tenantId, [job.id]), core.syncTenant(tenantId), gca.collectDirectDebits([job.id])]);
    const all = await allPayments(job.id);
    check("S2 three ticks + three collects + a sync at once: one collection", all.length === 1, `${all.length} made, ${(await livePayments(job.id)).length} live`);
    await rules("S2");
  }

  // ── S3 Connection lost after GoCardless made the payment → collecting again picks that one up.
  {
    const { job } = await customer("S3 Dropped");
    await gca.setGoCardlessAutoCollect(false);
    await act.completeJob(job.id); await settle();
    await mock("/_test/drop-next");
    const first = await core.collectForJobs(tenantId, [job.id]);
    check("S3 lost answer: reported as not collected", first.collected.length === 0);
    const again = await core.collectForJobs(tenantId, [job.id]);
    const all = await allPayments(job.id);
    check("S3 collecting again links the payment GoCardless already made (no second one)", again.collected.length === 1 && all.length === 1 && (await jobRow(job.id)).goCardlessPaymentId === all[0].id, `${all.length}`);
    await gca.setGoCardlessAutoCollect(true);
    await rules("S3");
  }

  // ── S4 Undo before it goes to the bank → cancelled; tick again → a NEW collection (was the bug).
  {
    const { c, job } = await customer("S4 Undo early");
    await tick(job.id);
    const first = (await livePayments(job.id))[0];
    const u = await act.uncompleteJob(job.id);
    const afterUndo = await allPayments(job.id);
    check("S4 undo: collection cancelled in GoCardless", u.directDebit === "cancelled" && afterUndo[0].status === "cancelled" && (await livePayments(job.id)).length === 0, u.directDebit);
    await rules("S4 undo");
    await new Promise((r) => setTimeout(r, 5)); // a later tick
    await tick(job.id);
    const live = await livePayments(job.id);
    check("S4 tick again: one new live collection, not the cancelled one", live.length === 1 && live[0].id !== first.id && (await jobRow(job.id)).goCardlessStatus === "pending_submission", JSON.stringify(live.map((p) => p.id)));
    // and once more: undo + redo again
    await act.uncompleteJob(job.id); await tick(job.id);
    check("S4 undo + tick a second time: still exactly one live collection", (await livePayments(job.id)).length === 1);
    await status((await livePayments(job.id))[0].id, "paid_out");
    await core.syncTenant(tenantId);
    check("S4 paid once, nothing owed, no credit", (await owed(job.id)) === 0 && (await credit(c.id)) === 0);
    await rules("S4");
  }

  // ── S5 Undo too late (already at the bank) then tick again → not collected twice.
  {
    const { c, job } = await customer("S5 Undo late");
    await tick(job.id);
    const p = (await livePayments(job.id))[0];
    await status(p.id, "submitted");
    const u = await act.uncompleteJob(job.id);
    check("S5 undo too late: said so", u.directDebit === "too_late", u.directDebit);
    await tick(job.id);
    check("S5 tick again: no second collection", (await allPayments(job.id)).length === 1);
    await status(p.id, "paid_out"); await core.syncTenant(tenantId);
    check("S5 money arrives: pays the clean, no credit", (await owed(job.id)) === 0 && (await credit(c.id)) === 0);
    await rules("S5");
  }

  // ── S5b Undo too late and NOT ticked again → the money arrives as credit (never lost).
  {
    const { c, job } = await customer("S5b Late, left");
    await tick(job.id);
    const p = (await livePayments(job.id))[0];
    await status(p.id, "submitted");
    await act.uncompleteJob(job.id);
    await status(p.id, "paid_out"); await core.syncTenant(tenantId);
    check("S5b money kept as £20 credit, clean not paid (not done)", (await credit(c.id)) === 20 && (await jobRow(job.id)).status === "PENDING", String(await credit(c.id)));
    await tick(job.id);
    check("S5b ticked later: credit pays it, nothing more collected", (await owed(job.id)) === 0 && (await credit(c.id)) === 0 && (await allPayments(job.id)).length === 1);
    await rules("S5b");
  }

  // ── S6 Undo after the money arrived → becomes credit; tick again → credit pays it, no new collection.
  {
    const { c, job } = await customer("S6 Undo paid");
    await tick(job.id);
    const p = (await livePayments(job.id))[0];
    await status(p.id, "paid_out"); await core.syncTenant(tenantId);
    await act.uncompleteJob(job.id);
    check("S6 undo after paid: money kept as credit", (await credit(c.id)) === 20 && (await prisma.payment.count({ where: { tenantId, goCardlessPaymentId: p.id, voidedAt: null } })) === 1);
    await tick(job.id);
    check("S6 tick again: paid from credit, not collected again", (await owed(job.id)) === 0 && (await credit(c.id)) === 0 && (await allPayments(job.id)).length === 1);
    await rules("S6");
  }

  // ── S7 Failed → Try again → new collection → paid once; the failed one never counted.
  {
    const { c, job } = await customer("S7 Failed");
    await tick(job.id);
    const p1 = (await livePayments(job.id))[0];
    await status(p1.id, "failed"); await core.syncTenant(tenantId);
    check("S7 failed: clean owes, not retried automatically", (await owed(job.id)) === 20 && (await allPayments(job.id)).length === 1);
    await core.syncTenant(tenantId);
    check("S7 a later sync still doesn't retry it on its own", (await allPayments(job.id)).length === 1);
    const t1 = await core.collectForJobs(tenantId, [job.id]);
    const t2 = await core.collectForJobs(tenantId, [job.id]);
    check("S7 Try again (twice): one new collection", t1.collected.length === 1 && t2.collected.length === 0 && (await livePayments(job.id)).length === 1);
    await status((await livePayments(job.id))[0].id, "paid_out"); await core.syncTenant(tenantId);
    check("S7 paid once", (await owed(job.id)) === 0 && (await credit(c.id)) === 0);
    await rules("S7");
  }

  // ── S8 Failed, but GoCardless is retrying it itself → Try again doesn't make a second one.
  {
    const { job } = await customer("S8 GC retrying");
    await tick(job.id);
    const p1 = (await livePayments(job.id))[0];
    await status(p1.id, "failed"); await core.syncTenant(tenantId);
    await status(p1.id, "pending_submission"); // GoCardless retried it
    const t = await core.collectForJobs(tenantId, [job.id]);
    check("S8 Try again while GoCardless retries: refused", t.collected.length === 0 && (await allPayments(job.id)).length === 1, JSON.stringify(t.skipped));
    await rules("S8");
  }

  // ── S9 Worst case: an old failed payment is later taken anyway after a new one → recorded as credit.
  {
    const { c, job } = await customer("S9 Both taken");
    forcedDouble.add(job.id);
    await tick(job.id);
    const p1 = (await livePayments(job.id))[0];
    await status(p1.id, "failed"); await core.syncTenant(tenantId);
    await core.collectForJobs(tenantId, [job.id]);
    const p2 = (await livePayments(job.id))[0];
    await status(p2.id, "paid_out"); await status(p1.id, "paid_out");
    await core.syncTenant(tenantId);
    check("S9 both recorded: clean paid, the extra £20 shown as credit (refundable)", (await owed(job.id)) === 0 && (await credit(c.id)) === 20, String(await credit(c.id)));
    await rules("S9");
  }

  // ── S10 Charged back after it was recorded → payment undone, clean owes again, not re-collected by itself.
  {
    const { job } = await customer("S10 Charge-back");
    await tick(job.id);
    const p = (await livePayments(job.id))[0];
    await status(p.id, "paid_out"); await core.syncTenant(tenantId);
    await status(p.id, "charged_back"); await core.syncTenant(tenantId); await core.syncTenant(tenantId);
    check("S10 charge-back: clean owes again, nothing new collected", (await owed(job.id)) === 20 && (await allPayments(job.id)).length === 1);
    await rules("S10");
  }

  // ── S11 Part paid in cash → only the rest is collected.
  {
    const { job, c } = await customer("S11 Part cash", 25);
    await gca.setGoCardlessAutoCollect(false);
    await act.completeJob(job.id); await settle();
    await act.recordPayment({ customerId: c.id, allocations: [{ jobId: job.id, amount: 10 }], method: "CASH" });
    await core.collectForJobs(tenantId, [job.id]);
    const live = await livePayments(job.id);
    check("S11 £25 clean, £10 cash: collects £15", live.length === 1 && live[0].amount === 1500, JSON.stringify(live.map((p) => p.amount)));
    await status(live[0].id, "paid_out"); await core.syncTenant(tenantId);
    check("S11 paid in full, no credit", (await owed(job.id)) === 0 && (await credit(c.id)) === 0);
    await gca.setGoCardlessAutoCollect(true);
    await rules("S11");
  }

  // ── S12 Credit covers the clean → nothing collected.
  {
    const { job, c } = await customer("S12 Credit");
    await act.recordPayment({ customerId: c.id, allocations: [], method: "CASH", extra: 20 });
    await tick(job.id);
    check("S12 £20 credit: clean paid from credit, nothing collected", (await owed(job.id)) === 0 && (await allPayments(job.id)).length === 0);
    await rules("S12");
  }

  // ── S13 Price changed after the collection was made → no second collection; never over-paid.
  {
    const { job, c } = await customer("S13 Price change");
    await tick(job.id);
    await act.updateJobPrice(job.id, 15);
    await core.collectForJobs(tenantId, [job.id]); await core.syncTenant(tenantId);
    check("S13 price lowered: still one collection", (await allPayments(job.id)).length === 1);
    await status((await livePayments(job.id))[0].id, "paid_out"); await core.syncTenant(tenantId);
    check("S13 £20 taken for a £15 clean: clean paid, £5 credit", (await owed(job.id)) === 0 && (await credit(c.id)) === 5, String(await credit(c.id)));
    await rules("S13");
  }

  // ── S14 Direct Debit cancelled while collecting → collection cancelled, clean owes, not collected again.
  {
    const { job, mandate } = await customer("S14 Mandate cancelled");
    await tick(job.id);
    await mock("/_test/mandate-status", { id: mandate, status: "cancelled" });
    await core.syncTenant(tenantId);
    check("S14 clean owes, Direct Debit shown cancelled", (await owed(job.id)) === 20 && (await prisma.customer.findFirstOrThrow({ where: { goCardlessMandateId: mandate } })).goCardlessMandateStatus === "cancelled");
    const t = await core.collectForJobs(tenantId, [job.id]);
    check("S14 can't collect on a cancelled Direct Debit", t.collected.length === 0 && (await livePayments(job.id)).length === 0);
    await rules("S14");
  }

  // ── S15 Several syncs at once while money arrives → each payment recorded once.
  {
    const made = [await customer("S15 a"), await customer("S15 b"), await customer("S15 c")];
    for (const m of made) await tick(m.job.id);
    for (const m of made) await status((await livePayments(m.job.id))[0].id, "paid_out");
    await Promise.all([core.syncTenant(tenantId), core.syncTenant(tenantId), core.syncTenant(tenantId), core.syncTenant(tenantId)]);
    const counts = await Promise.all(made.map(async (m) => prisma.payment.count({ where: { tenantId, customerId: m.c.id, voidedAt: null } })));
    check("S15 four syncs at once: each recorded once", counts.every((x) => x === 1), counts.join(","));
    await rules("S15");
  }

  // ── S16 Refunds: full, double-clicked, too much, part then the rest.
  {
    const { job, c } = await customer("S16 Refund", 30);
    await tick(job.id);
    const p = (await livePayments(job.id))[0];
    await status(p.id, "paid_out"); await core.syncTenant(tenantId);
    const pay = await prisma.payment.findFirstOrThrow({ where: { tenantId, goCardlessPaymentId: p.id } });
    const both = await Promise.all([
      act.refundPayment(pay.id, { amount: 10, outcome: "WRITE_OFF", how: "GOCARDLESS" }).then(() => "ok", (e) => String(e)),
      act.refundPayment(pay.id, { amount: 10, outcome: "WRITE_OFF", how: "GOCARDLESS" }).then(() => "ok", (e) => String(e)),
    ]);
    const st = await gcState();
    check("S16 refund double-clicked: one £10 refund in GoCardless", st.refunds.filter((r) => r.links.payment === p.id).length === 1, both.join(" | "));
    check("S16 …and one in Wyndos", (await prisma.payment.count({ where: { tenantId, refundOfId: pay.id, voidedAt: null } })) === 1);
    const tooMuch = await act.refundPayment(pay.id, { amount: 25, outcome: "WRITE_OFF", how: "GOCARDLESS" }).then(() => "ok", (e) => String(e));
    check("S16 refunding more than is left is refused", tooMuch !== "ok", tooMuch);
    await act.refundPayment(pay.id, { amount: 20, outcome: "OWING", how: "GOCARDLESS" });
    const back = (await gcState()).refunds.filter((r) => r.links.payment === p.id).reduce((s, r) => s + r.amount, 0);
    check("S16 the rest refunded: £30 back in total, never more", back === 3000, String(back));
    // Back through GoCardless is always written off ("leave it owing" isn't offered): it would never be collected again.
    check("S16 clean: all £30 written off, nothing owing", (await owed(job.id)) === 0 && (await jobRow(job.id)).price === 0 && (await credit(c.id)) === 0, `${await owed(job.id)} / price ${(await jobRow(job.id)).price}`);
    await rules("S16");
    // A refund GoCardless cancels is undone, and refunding again works (a new key).
    const rf = (await gcState()).refunds.find((r) => r.links.payment === p.id && r.amount === 2000)!;
    await status(rf.id, "cancelled"); await core.syncTenant(tenantId);
    check("S16 refund cancelled by GoCardless: undone in Wyndos", (await owed(job.id)) === 0, String(await owed(job.id)));
    const again = await act.refundPayment(pay.id, { amount: 20, outcome: "OWING", how: "GOCARDLESS" }).then(() => "ok", (e) => String(e));
    check("S16 refunding that £20 again works", again === "ok", again);
    await rules("S16 refunds");
  }

  // ── S17 Refund whose answer was lost → trying again records it once, no second refund.
  {
    const { job } = await customer("S17 Refund lost", 20);
    await tick(job.id);
    const p = (await livePayments(job.id))[0];
    await status(p.id, "paid_out"); await core.syncTenant(tenantId);
    const pay = await prisma.payment.findFirstOrThrow({ where: { tenantId, goCardlessPaymentId: p.id } });
    await mock("/_test/drop-next");
    const first = await act.refundPayment(pay.id, { amount: 20, outcome: "WRITE_OFF", how: "GOCARDLESS" }).then(() => "ok", (e) => String(e));
    const second = await act.refundPayment(pay.id, { amount: 20, outcome: "WRITE_OFF", how: "GOCARDLESS" }).then(() => "ok", (e) => String(e));
    const refunds = (await gcState()).refunds.filter((r) => r.links.payment === p.id);
    check("S17 lost answer then retry: one refund in GoCardless, recorded once in Wyndos", refunds.length === 1 && (await prisma.payment.count({ where: { tenantId, refundOfId: pay.id, voidedAt: null } })) === 1, `${first} | ${second}`);
    await core.syncTenant(tenantId);
    check("S17 a sync doesn't add it a second time", (await prisma.payment.count({ where: { tenantId, refundOfId: pay.id, voidedAt: null } })) === 1);
    await rules("S17");
  }

  // ── S18 Shared Direct Debit: undo and re-tick one house; each house collected separately.
  {
    const payer = await customer("S18 Payer");
    const house = await customer("S18 House", 15, payer.mandate);
    await tick(payer.job.id); await tick(house.job.id);
    await act.uncompleteJob(house.job.id); await tick(house.job.id);
    const st = await gcState();
    const live = st.payments.filter((p) => p.links.mandate === payer.mandate && LIVE.has(p.status));
    check("S18 shared: one live collection per house (£20 + £15)", live.length === 2 && live.map((p) => p.amount).sort().join(",") === "1500,2000", live.map((p) => p.amount).join(","));
    for (const p of live) await status(p.id, "paid_out");
    await core.syncTenant(tenantId);
    check("S18 each house's clean paid on its own customer, no credit", (await owed(payer.job.id)) === 0 && (await owed(house.job.id)) === 0 && (await credit(payer.c.id)) === 0 && (await credit(house.c.id)) === 0);
    await rules("S18");
  }

  // ── S19 Completing the whole day (Complete Day) with auto-collect, after some were ticked → no duplicates.
  {
    const a = await customer("S19 a"); const b = await customer("S19 b");
    await tick(a.job.id);
    const day = await prisma.workDay.findUniqueOrThrow({ where: { id: workDayId }, select: { status: true } });
    if (day.status !== "COMPLETE") {
      const pending = await prisma.job.findMany({ where: { workDayId, status: "PENDING" }, select: { id: true } });
      await act.completeDay(workDayId, pending.map((j) => ({ jobId: j.id, action: j.id === b.job.id ? "complete" : "skip" })) as never).catch((e: unknown) => console.log("   completeDay:", String(e)));
      await settle();
    } else await tick(b.job.id);
    if ((await jobRow(b.job.id)).status !== "COMPLETE") await tick(b.job.id);
    check("S19 one collection each after Complete Day", (await allPayments(a.job.id)).length === 1 && (await allPayments(b.job.id)).length === 1, `${(await allPayments(a.job.id)).length}/${(await allPayments(b.job.id)).length}`);
    await rules("S19");
  }

  // ── S20 A payment taken in GoCardless itself plus Wyndos collections → both counted, nothing doubled.
  {
    const { job, c, mandate } = await customer("S20 Outside");
    await tick(job.id);
    await mock("/_test/payment", { amount: 1000, status: "paid_out", charge_date: "2026-11-02", links: { mandate } });
    await status((await livePayments(job.id))[0].id, "paid_out");
    await core.syncTenant(tenantId); await core.syncTenant(tenantId);
    check("S20 clean paid by its collection; the £10 outside payment is credit", (await owed(job.id)) === 0 && (await credit(c.id)) === 10, String(await credit(c.id)));
    await rules("S20");
  }

  // ── S21 Auto-collect off → ticking collects nothing; Collect by hand works once.
  {
    await gca.setGoCardlessAutoCollect(false);
    const { job } = await customer("S21 Manual");
    await tick(job.id);
    check("S21 auto-collect off: nothing collected on tick", (await allPayments(job.id)).length === 0);
    await Promise.all([gca.collectDirectDebits([job.id]), gca.collectDirectDebits([job.id])]);
    check("S21 Collect pressed twice: one collection", (await allPayments(job.id)).length === 1);
    await gca.setGoCardlessAutoCollect(true);
    await rules("S21");
  }

  // ── S22 Clean un-ticked while its collection is still being made → never left with a live payment for an un-done clean.
  {
    const { job } = await customer("S22 Undo during");
    await act.completeJob(job.id);
    await Promise.all([settle(), act.uncompleteJob(job.id)]);
    const live = await livePayments(job.id);
    const row = await jobRow(job.id);
    check("S22 undo at the same moment as collecting: no live collection for an un-done clean", live.length === 0 || (row.status === "COMPLETE" && row.goCardlessPaymentId === live[0].id), `live ${live.length}, status ${row.status}`);
    await rules("S22");
  }

  // ── S24 Failed, then GoCardless takes it after all (its own retry) → recorded, clean paid.
  {
    const { c, job } = await customer("S24 Late success");
    await tick(job.id);
    const p = (await livePayments(job.id))[0];
    await status(p.id, "failed"); await core.syncTenant(tenantId);
    await status(p.id, "paid_out"); await core.syncTenant(tenantId);
    check("S24 failed then taken after all: recorded, clean paid, no credit", (await owed(job.id)) === 0 && (await credit(c.id)) === 0, `${await owed(job.id)} / ${await credit(c.id)}`);
    await rules("S24");
  }

  // ── S25 Charge-back reversed (money comes back) → counted again.
  {
    const { c, job } = await customer("S25 Charge-back reversed");
    await tick(job.id);
    const p = (await livePayments(job.id))[0];
    await status(p.id, "paid_out"); await core.syncTenant(tenantId);
    await status(p.id, "charged_back"); await core.syncTenant(tenantId);
    check("S25 charged back: owes", (await owed(job.id)) === 20);
    const t = await core.collectForJobs(tenantId, [job.id]);
    check("S25 a charge-back isn't collected again by Wyndos", t.collected.length === 0 && (await allPayments(job.id)).length === 1, JSON.stringify(t.skipped));
    await status(p.id, "paid_out"); await core.syncTenant(tenantId);
    check("S25 charge-back reversed: paid again, counted once", (await owed(job.id)) === 0 && (await credit(c.id)) === 0 && (await prisma.payment.count({ where: { tenantId, goCardlessPaymentId: p.id, voidedAt: null } })) === 1);
    await rules("S25");
  }

  // ── S26 Undo too late, then the clean is deleted → the money still arrives as credit.
  {
    const { c, job } = await customer("S26 Clean deleted");
    await tick(job.id);
    const p = (await livePayments(job.id))[0];
    await status(p.id, "submitted");
    await act.uncompleteJob(job.id);
    await prisma.job.delete({ where: { id: job.id } });
    await status(p.id, "paid_out"); await core.syncTenant(tenantId);
    check("S26 clean deleted: £20 received kept as credit", (await credit(c.id)) === 20 && (await prisma.payment.count({ where: { tenantId, goCardlessPaymentId: p.id } })) === 1, String(await credit(c.id)));
    await rules("S26");
  }

  // ── S27 Spare credit never pays a clean whose Direct Debit is already on its way.
  {
    const { c, job } = await customer("S27 Credit vs collecting");
    await tick(job.id);
    await act.recordPayment({ customerId: c.id, allocations: [], method: "CASH", extra: 20 });
    const job2 = await prisma.job.create({ data: { tenantId, workDayId, customerId: c.id, price: 20, name: "Window Cleaning" } });
    await tick(job2.id);
    check("S27 credit pays the next clean, not the one being collected", (await owed(job2.id)) === 0 && (await allPayments(job2.id)).length === 0 && (await livePayments(job.id)).length === 1);
    await status((await livePayments(job.id))[0].id, "paid_out"); await core.syncTenant(tenantId);
    check("S27 both paid, no credit, charged £20 once by Direct Debit", (await owed(job.id)) === 0 && (await credit(c.id)) === 0);
    await rules("S27");
  }

  // ── S28 Paid in cash at the door while its Direct Debit was on its way → Direct Debit stopped.
  {
    const { c, job } = await customer("S28 Cash too");
    await tick(job.id);
    await act.recordPayment({ customerId: c.id, allocations: [{ jobId: job.id, amount: 20 }], method: "CASH" });
    check("S28 cash for a clean being collected: Direct Debit cancelled", (await livePayments(job.id)).length === 0 && (await owed(job.id)) === 0 && (await credit(c.id)) === 0);
    await rules("S28");
  }

  // ── S29 A GoCardless plan set up since the last sync → regular cleans not charged on top.
  {
    const { job, mandate } = await customer("S29 New plan");
    await mock("/_test/subscription", { amount: 2000, links: { mandate } });
    await tick(job.id);
    check("S29 plan made in GoCardless: regular clean not collected on top", (await allPayments(job.id)).length === 0);
    await rules("S29");
  }

  // ── S30 Undo racing the collection, 20 times with different timings.
  {
    let bad = 0;
    for (let i = 0; i < 20; i++) {
      const { job } = await customer(`S30 Race ${i}`);
      await act.completeJob(job.id);
      const work = [settle(), new Promise((r) => setTimeout(r, i * 3)).then(() => act.uncompleteJob(job.id))];
      if (i % 2) work.push(core.collectForJobs(tenantId, [job.id]));
      await Promise.all(work);
      const row = await jobRow(job.id);
      const live = await livePayments(job.id);
      if (row.status === "PENDING" && live.length > 0) bad++;
      if (live.length > 1) bad++;
    }
    check("S30 undo racing collection (20 runs): never a live collection for an un-done clean", bad === 0, String(bad));
    await rules("S30");
  }

  // ── S23 Final sweep: sync twice more; all rules still hold.
  await core.syncTenant(tenantId); await core.syncTenant(tenantId);
  await rules("final syncs");

  await prisma.tenant.update({ where: { id: tenantId }, data: { name: "Sim gc-money (done)" } });
  console.log(fails ? `${fails} FAILED, ${passes} passed` : `all ${passes} passed`);
}
main().then(() => process.exit(fails ? 1 : 0), (e) => { console.error(e); process.exit(1); });
