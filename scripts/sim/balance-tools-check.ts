/** Edge cases for refunds, moving money, adding/removing credit and write-offs, through the real actions. */
import prisma from "@/lib/db";
import { createBusiness, setToday, settle } from "./lib";

let fails = 0;
const check = (n: string, ok: boolean, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` (${d})` : ""}`); };
const r2 = (n: number) => Math.round(n * 100) / 100;
const err = async (f: () => Promise<unknown>) => { try { await f(); return ""; } catch (e) { return (e as Error).message; } };

async function main() {
  const act = await import("@/lib/actions");
  const mtd = await import("@/lib/mtd/actions");
  setToday("2026-11-02");
  const { tenantId } = await createBusiness("balance");
  await act.bulkImportCustomers([1, 2, 3].map((i) => ({ name: `C${i}`, address: `${i} Test Rd, Testford, ZZ99 1AA`, price: 20, nextDueDate: "2026-11-02", frequencyWeeks: 4, areaName: "A", areaFrequencyWeeks: 4 })) as never, { createMissingAreas: true, bookRuns: true } as never);
  await settle();
  const [c1, c2, c3] = await prisma.customer.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  const day = (await prisma.workDay.findFirst({ where: { tenantId } }))!;
  // Each customer: two done cleans (an extra one-off of £10 on the same day).
  for (const c of [c1, c2, c3]) {
    const j = (await prisma.job.findFirst({ where: { tenantId, customerId: c.id } }))!;
    await act.completeJob(j.id);
    const extra = await prisma.job.create({ data: { tenantId, workDayId: day.id, customerId: c.id, price: 10, name: "Gutters", isOneOff: true } });
    await act.completeJob(extra.id);
  }
  const owed = async (cid: number) => { const js = await prisma.job.findMany({ where: { tenantId, customerId: cid, status: "COMPLETE" }, select: { price: true, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } } }); return r2(js.reduce((s, j) => s + j.price - j.allocations.reduce((t, a) => t + a.amount, 0), 0)); };
  const credit = async (cid: number) => { const ps = await prisma.payment.findMany({ where: { tenantId, customerId: cid, voidedAt: null }, select: { amount: true, allocations: { select: { amount: true } } } }); return r2(ps.reduce((s, p) => s + p.amount - p.allocations.reduce((t, a) => t + a.amount, 0), 0)); };
  const income = async () => r2((await prisma.payment.aggregate({ where: { tenantId, voidedAt: null, broughtForward: false }, _sum: { amount: true } }))._sum.amount ?? 0);
  const pageCredit = async (cid: number) => ((await act.getPaymentsPage()) as { customersWithCredit?: Array<{ id: number; credit: number }> }).customersWithCredit?.find((c) => c.id === cid)?.credit ?? 0;
  check("start: each owes £30", (await owed(c1.id)) === 30 && (await owed(c2.id)) === 30 && (await owed(c3.id)) === 30);

  // C1 pays £70: both cleans (£30) + £40 credit.
  const c1jobs = await prisma.job.findMany({ where: { tenantId, customerId: c1.id, status: "COMPLETE" } });
  await act.recordPayment({ customerId: c1.id, allocations: c1jobs.map((j) => ({ jobId: j.id, amount: j.price })), method: "BACS", extra: 40 });
  check("C1 settled with £40 credit", (await owed(c1.id)) === 0 && (await credit(c1.id)) === 40);
  check("Payments page shows the same credit", (await pageCredit(c1.id)) === 40, String(await pageCredit(c1.id)));

  // Use £15 of C1's credit for C2 (partial: C2 still owes £15).
  await act.useCreditForCustomer(c1.id, c2.id, 15);
  check("use part credit: C1 credit 25", (await credit(c1.id)) === 25, String(await credit(c1.id)));
  check("use part credit: C2 owes 15", (await owed(c2.id)) === 15, String(await owed(c2.id)));
  check("use credit: income unchanged (70)", (await income()) === 70, String(await income()));
  // Use the rest: only £15 can be used (C2's debt); C1 keeps £10.
  await act.useCreditForCustomer(c1.id, c2.id);
  check("use rest: C2 settled, C1 keeps £10", (await owed(c2.id)) === 0 && (await credit(c1.id)) === 10, `${await owed(c2.id)} / ${await credit(c1.id)}`);
  check("nothing to pay → refused", (await err(() => act.useCreditForCustomer(c1.id, c2.id))).includes("no unpaid"));
  check("same customer → refused", (await err(() => act.useCreditForCustomer(c1.id, c1.id))).includes("different"));

  // Credit later isn't spent twice: "use credit on unpaid" changes nothing.
  const allocsBefore = await prisma.paymentAllocation.count({ where: { tenantId } });
  await act.useCreditOnUnpaid([c1.id, c2.id]);
  check("no double spending", (await prisma.paymentAllocation.count({ where: { tenantId } })) === allocsBefore);

  // Remove C1's last £10 credit (not real).
  await act.removeCredit(c1.id, 4, "test");
  check("remove part credit: £6 left", (await credit(c1.id)) === 6, String(await credit(c1.id)));
  await act.removeCredit(c1.id, 6);
  check("remove rest: £0, cleans still paid", (await credit(c1.id)) === 0 && (await owed(c1.id)) === 0 && (await owed(c2.id)) === 0);
  check("remove credit: income down by £10 (60)", (await income()) === 60, String(await income()));
  check("remove more than there is → refused", (await err(() => act.removeCredit(c1.id, 5))).includes("No credit"));

  // Add credit (not income) to C3 who owes £30: it pays the oldest cleans.
  await act.addCreditAdjustment(c3.id, 25, "goodwill");
  check("add credit pays cleans: C3 owes 5", (await owed(c3.id)) === 5, String(await owed(c3.id)));
  check("add credit: not income (still 60)", (await income()) === 60, String(await income()));
  const tx = await mtd.getMtdTransactions(2026);
  check("add credit: not in the MTD export", !tx.payments.some((p) => p.customer === "C3"));

  // Write off part of C3's £5, then refuse writing off when nothing owed.
  await act.writeOffDebt(c3.id, 2);
  check("write off part: C3 owes 3", (await owed(c3.id)) === 3, String(await owed(c3.id)));
  await act.writeOffDebt(c3.id, null);
  check("write off rest: C3 owes 0", (await owed(c3.id)) === 0);
  check("write off nothing → refused", (await err(() => act.writeOffDebt(c3.id, null))).includes("Nothing owed"));

  // Move C1's payment to C3: C1's cleans owe again, C3 gets the money (its cleans already settled → credit).
  const p1 = (await prisma.payment.findFirst({ where: { tenantId, customerId: c1.id, voidedAt: null } }))!;
  await act.movePaymentToCustomer(p1.id, c3.id);
  check("move: C1 owes £30 again", (await owed(c1.id)) === 30, String(await owed(c1.id)));
  check("move: C2's cleans (paid from C1's credit) owe again", (await owed(c2.id)) === 30, String(await owed(c2.id)));
  check("move: C3 holds the money as credit", (await credit(c3.id)) === r2(p1.amount + 0), `${await credit(c3.id)} vs ${p1.amount}`);
  check("move: income unchanged (60)", (await income()) === 60, String(await income()));

  // Credit added by hand can't be "refunded" as if it were money in.
  const adj = (await prisma.payment.findFirst({ where: { tenantId, customerId: c3.id, broughtForward: true } }))!;
  check("can't refund added credit", (await err(() => act.refundPayment(adj.id, { amount: 1, outcome: "OWING", how: "BACS" }))).includes("Remove credit"));

  // Refund vs locked quarter (cash basis): lock Q3 (6 Oct–5 Jan) and try to remove credit/refund.
  await mtd.lockQuarter(2026, 3);
  check("locked quarter: remove credit refused", (await err(() => act.removeCredit(c3.id, 1))).includes("submitted"));
  check("locked quarter: refund refused", (await err(() => act.refundPayment(p1.id, { amount: 1, outcome: "OWING", how: "BACS" }))).includes("submitted"));
  check("locked quarter: add credit still fine (not income)", (await err(() => act.addCreditAdjustment(c3.id, 1))) === "");
  await mtd.unlockQuarter(2026, 3);

  await prisma.tenant.update({ where: { id: tenantId }, data: { name: "Sim balance (done)" } });
  console.log(fails ? `${fails} failed` : "all passed");
}
main().then(() => process.exit(fails ? 1 : 0), (e) => { console.error(e); process.exit(1); });
