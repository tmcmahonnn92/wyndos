/** MTD and expenses checks through the real actions. Run like scenarios.ts. */
import prisma from "@/lib/db";
import { createBusiness, setToday } from "./lib";
import { unwrapAll } from "./lib";

let fails = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`); };

async function main() {
  const act = unwrapAll(await import("@/lib/actions"));
  const mtd = await import("@/lib/mtd/actions");
  setToday("2026-10-13");
  const { tenantId } = await createBusiness("mtd");

  // Repeat started on an old date catches up, without opening the Accounting page.
  await act.createExpense({ category: "PHONE", supplier: "Phone co", amount: 30, businessPct: 70, taxTreatment: "NO_VAT", expenseDate: new Date("2026-07-31"), notes: "", isRecurring: true, repeatEvery: 1, repeatUnit: "MONTH", repeatAnchorDate: null, repeatEndsAt: null } as never);
  const ov = await mtd.getMtdOverview(2026);
  const phones = await prisma.expense.findMany({ where: { tenantId, supplier: "Phone co" }, orderBy: { expenseDate: "asc" } });
  check("monthly repeat from 31 Jul fills Aug, Sep (30th), up to today", phones.map((p) => p.expenseDate.toISOString().slice(0, 10)).join(",") === "2026-07-31,2026-08-31,2026-09-30", phones.map((p) => p.expenseDate.toISOString().slice(0, 10)).join(","));
  check("copies keep 70% business", phones.every((p) => p.businessPct === 70));
  const template = phones[0];
  check("next due 31 Oct", template.nextScheduledAt?.toISOString().slice(0, 10) === "2026-10-31", template.nextScheduledAt?.toISOString());
  await act.stopRepeating("expense", template.id);
  const stopped = await prisma.expense.findUnique({ where: { id: template.id } });
  check("stop repeating", stopped?.isRecurring === false && stopped.nextScheduledAt === null);
  check("no warnings yet", ov.checks.length === 0, ov.checks.join(" | "));

  // Mileage vehicle + unlinked fuel → warning.
  await mtd.saveVehicle({ name: "Van", registration: "", kind: "VAN", method: "MILEAGE", businessPct: 100 });
  await act.createExpense({ category: "FUEL", supplier: "Shell", amount: 60, taxTreatment: "NO_VAT", expenseDate: new Date("2026-09-01"), notes: "" } as never);
  const ov2 = await mtd.getMtdOverview(2026);
  check("unlinked fuel with a mileage vehicle is flagged", ov2.checks.some((c) => c.includes("fuel or vehicle cost")), ov2.checks.join(" | "));
  const van = (await prisma.vehicle.findFirst({ where: { tenantId } }))!;
  await mtd.addMileageTrip({ vehicleId: van.id, date: "2026-09-02", miles: 40 } as never);
  const sw = await mtd.saveVehicle({ id: van.id, name: "Van", registration: "", kind: "VAN", method: "ACTUAL", businessPct: 100 });
  check("can't switch a mileage vehicle with trips to actual costs", !sw.ok, sw.ok ? "" : sw.error);

  // Locked quarter: payments, settings and opening figures can't change.
  await act.bulkImportCustomers([{ name: "Pay Me", address: "1 Test Rd, Testford, ZZ99 1AA", price: 20, frequencyWeeks: 4, areaName: "A", areaFrequencyWeeks: 4, nextDueDate: "2026-10-20" }] as never, { createMissingAreas: true } as never);
  const cust = (await prisma.customer.findFirst({ where: { tenantId } }))!;
  await prisma.payment.create({ data: { tenantId, customerId: cust.id, amount: 20, method: "CASH", paidAt: new Date("2026-05-10T10:00:00Z") } });
  const pay = (await prisma.payment.findFirst({ where: { tenantId } }))!;
  const lk = await mtd.lockQuarter(2026, 1);
  check("lock Q1", lk.ok);
  let msg = ""; try { await act.voidPayment(pay.id); } catch (e) { msg = (e as Error).message; }
  check("can't void a payment in a submitted quarter (cash basis)", msg.includes("submitted"), msg);
  msg = ""; try { await act.updatePaymentMeta(pay.id, { paidAt: new Date("2026-08-01") }); } catch (e) { msg = (e as Error).message; }
  check("can't move a payment out of a submitted quarter", msg.includes("submitted"), msg);
  msg = ""; try { await act.updatePaymentMeta(pay.id, { notes: "hi" }); } catch (e) { msg = (e as Error).message; }
  check("notes still editable", msg === "", msg);
  const st = await mtd.setAccountsSettings({ basis: "ACCRUALS" });
  check("can't change basis with a submitted quarter", !st.ok, st.ok ? "" : st.error);
  msg = ""; try { await act.saveOpeningFigures({ income: 100, expenses: 0, asAt: "2026-04-10" }); } catch (e) { msg = (e as Error).message; }
  check("opening figures in a submitted quarter blocked", msg.includes("submitted"), msg);

  // Home use: April counts in the new tax year; locked Q1 blocks April.
  const hh = await mtd.setHomeHours("2026-04", 60);
  check("April home hours blocked by locked Q1", !hh.ok);
  await mtd.unlockQuarter(2026, 1);
  await mtd.setHomeHours("2026-04", 60);
  const ov3 = await mtd.getMtdOverview(2026);
  check("April home use in 2026/27 Q1", ov3.periods[0].period.homeClaim === 18, String(ov3.periods[0].period.homeClaim));
  const ov4 = await mtd.getMtdOverview(2025);
  check("…and not in 2025/26", ov4.year.homeClaim === 0, String(ov4.year.homeClaim));

  await prisma.tenant.update({ where: { id: tenantId }, data: { name: "Sim mtd (done)" } });
  console.log(fails ? `${fails} failed` : "all passed");
}
main().then(() => process.exit(fails ? 1 : 0), (e) => { console.error(e); process.exit(1); });
