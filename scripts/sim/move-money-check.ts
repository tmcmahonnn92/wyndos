import prisma from "@/lib/db";
import { createBusiness, setToday, settle } from "./lib";
let fails = 0; const check = (n: string, ok: boolean, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` (${d})` : ""}`); };
const r2 = (n: number) => Math.round(n * 100) / 100;
async function main() {
  const act = await import("@/lib/actions");
  setToday("2026-11-02");
  const { tenantId } = await createBusiness("move");
  await act.bulkImportCustomers([1, 2].map((i) => ({ name: `H${i}`, address: `${i} Test Rd, Testford, ZZ99 1AA`, price: 20, nextDueDate: "2026-11-02", frequencyWeeks: 4, areaName: "A", areaFrequencyWeeks: 4 })) as never, { createMissingAreas: true, bookRuns: true } as never);
  await settle();
  const [h1, h2] = await prisma.customer.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  for (const c of [h1, h2]) { const j = (await prisma.job.findFirst({ where: { tenantId, customerId: c.id } }))!; await act.completeJob(j.id); }
  const owed = async (cid: number) => { const js = await prisma.job.findMany({ where: { tenantId, customerId: cid, status: "COMPLETE" }, select: { price: true, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } } }); return r2(js.reduce((s, j) => s + j.price - j.allocations.reduce((t, a) => t + a.amount, 0), 0)); };
  const credit = async (cid: number) => { const ps = await prisma.payment.findMany({ where: { tenantId, customerId: cid, voidedAt: null }, select: { amount: true, allocations: { select: { amount: true } } } }); return r2(ps.reduce((s, p) => s + p.amount - p.allocations.reduce((t, a) => t + a.amount, 0), 0)); };
  // £40 for both houses landed on H1: H1 paid + £20 credit, H2 owes £20.
  const j1 = (await prisma.job.findFirst({ where: { tenantId, customerId: h1.id } }))!;
  await act.recordPayment({ customerId: h1.id, allocations: [{ jobId: j1.id, amount: 20 }], method: "BACS", extra: 20 });
  check("before: H1 credit 20, H2 owes 20", (await credit(h1.id)) === 20 && (await owed(h2.id)) === 20);
  await act.useCreditForCustomer(h1.id, h2.id);
  check("use credit: H2 paid", (await owed(h2.id)) === 0, String(await owed(h2.id)));
  check("use credit: H1 no credit left", (await credit(h1.id)) === 0, String(await credit(h1.id)));
  const moneyIn = r2((await prisma.payment.aggregate({ where: { tenantId, voidedAt: null }, _sum: { amount: true } }))._sum.amount ?? 0);
  check("money in unchanged (40)", moneyIn === 40, String(moneyIn));
  // Move the whole payment to H2: H2's clean paid, rest credit; H1's clean owes again.
  const pay = (await prisma.payment.findFirst({ where: { tenantId } }))!;
  await act.movePaymentToCustomer(pay.id, h2.id);
  check("move: H1 owes 20", (await owed(h1.id)) === 20, String(await owed(h1.id)));
  check("move: H2 paid with 20 credit", (await owed(h2.id)) === 0 && (await credit(h2.id)) === 20, `${await owed(h2.id)} / ${await credit(h2.id)}`);
  console.log(fails ? `${fails} failed` : "all passed");
}
main().then(() => process.exit(fails ? 1 : 0), (e) => { console.error(e); process.exit(1); });
