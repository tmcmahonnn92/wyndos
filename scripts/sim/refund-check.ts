/** Refund checks through the real actions. Run like scenarios.ts. */
import prisma from "@/lib/db";
import { createBusiness, setToday, settle } from "./lib";

let fails = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`); };
const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const act = await import("@/lib/actions");
  setToday("2026-11-02");
  const { tenantId } = await createBusiness("refund");
  await act.bulkImportCustomers([1, 2].map((i) => ({ name: `R${i}`, address: `${i} Test Rd, Testford, ZZ99 1AA`, price: 20, nextDueDate: "2026-11-02", frequencyWeeks: 4, areaName: "A", areaFrequencyWeeks: 4 })) as never, { createMissingAreas: true, bookRuns: true } as never);
  await settle();
  const [c1, c2] = await prisma.customer.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  const jobOf = async (cid: number) => (await prisma.job.findFirst({ where: { tenantId, customerId: cid, isQuote: false } }))!;
  const owed = async (cid: number) => { const j = await prisma.job.findFirst({ where: { tenantId, customerId: cid }, select: { price: true, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } } }); return r2(j!.price - j!.allocations.reduce((s, a) => s + a.amount, 0)); };
  const credit = async (cid: number) => { const ps = await prisma.payment.findMany({ where: { tenantId, customerId: cid, voidedAt: null }, select: { amount: true, allocations: { select: { amount: true } } } }); return r2(ps.reduce((s, p) => s + p.amount - p.allocations.reduce((t, a) => t + a.amount, 0), 0)); };
  const moneyIn = async () => r2((await prisma.payment.aggregate({ where: { tenantId, voidedAt: null }, _sum: { amount: true } }))._sum.amount ?? 0);

  // 1. Paid £20, refunded in full and written off.
  const j1 = await jobOf(c1.id);
  await act.completeJob(j1.id);
  await act.recordPayment({ customerId: c1.id, allocations: [{ jobId: j1.id, amount: 20 }], method: "CASH" });
  const p1 = (await prisma.payment.findFirst({ where: { tenantId, customerId: c1.id } }))!;
  await act.refundPayment(p1.id, { amount: 20, outcome: "WRITE_OFF", how: "CASH", reason: "poor job" });
  check("write-off: clean not owed", (await owed(c1.id)) === 0, String(await owed(c1.id)));
  check("write-off: clean price now 0", (await jobOf(c1.id)).price === 0);
  check("write-off: no credit left", (await credit(c1.id)) === 0, String(await credit(c1.id)));
  let msg = ""; try { await act.refundPayment(p1.id, { amount: 1, outcome: "OWING", how: "CASH" }); } catch (e) { msg = (e as Error).message; }
  check("can't refund more than was paid", msg.includes("up to £0.00"), msg);
  // Undo it.
  const ref1 = (await prisma.payment.findFirst({ where: { tenantId, refundOfId: p1.id } }))!;
  await act.voidPayment(ref1.id, "test undo");
  check("undo refund: clean price back to £20", (await jobOf(c1.id)).price === 20);
  check("undo refund: clean paid again", (await owed(c1.id)) === 0);

  // 2. Paid £30 on a £20 clean (£10 credit). Refund £5 of the clean, leave it owing; refund the £10 credit.
  const j2 = await jobOf(c2.id);
  await act.completeJob(j2.id);
  await act.recordPayment({ customerId: c2.id, allocations: [{ jobId: j2.id, amount: 20 }], method: "BACS", extra: 10 });
  check("credit £10 before", (await credit(c2.id)) === 10, String(await credit(c2.id)));
  await act.refundCustomerCredit(c2.id, { amount: 10, how: "BACS", reason: "leaving" });
  check("credit refunded", (await credit(c2.id)) === 0, String(await credit(c2.id)));
  msg = ""; try { await act.refundCustomerCredit(c2.id, { amount: 1, how: "BACS" }); } catch (e) { msg = (e as Error).message; }
  check("can't refund credit they don't have", msg.includes("credit"), msg);
  const p2 = (await prisma.payment.findFirst({ where: { tenantId, customerId: c2.id, amount: { gt: 0 } } }))!;
  await act.refundPayment(p2.id, { amount: 5, outcome: "OWING", how: "BACS", reason: "charged twice" });
  check("leave owing: clean owes £5", (await owed(c2.id)) === 5, String(await owed(c2.id)));
  check("leave owing: price unchanged", (await jobOf(c2.id)).price === 20);
  msg = ""; try { await act.voidPayment(p2.id); } catch (e) { msg = (e as Error).message; }
  check("can't void a payment with a refund on it", msg.includes("refund"), msg);
  // Money in: 20 (c1) + 30 (c2) − 10 credit − 5 = 35.
  check("money in reflects refunds", (await moneyIn()) === 35, String(await moneyIn()));

  await prisma.tenant.update({ where: { id: tenantId }, data: { name: "Sim refund (done)" } });
  console.log(fails ? `${fails} failed` : "all passed");
}
main().then(() => process.exit(fails ? 1 : 0), (e) => { console.error(e); process.exit(1); });
