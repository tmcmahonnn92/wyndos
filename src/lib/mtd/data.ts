/** Server only (not callable from the browser): load a business's records for the MTD figures. */

import prisma from "@/lib/db";
import type { Basis, MtdInputs, PeriodType } from "@/lib/mtd/calc";

const d = (x: Date) => x.toISOString().slice(0, 10);

export async function mtdSettings(tenantId: number) {
  const s = await prisma.tenantSettings.findFirst({ where: { tenantId }, select: { accountingBasis: true, mtdPeriodType: true, vatNumber: true, invoiceVatEnabled: true, invoiceVatRate: true } });
  return {
    basis: (s?.accountingBasis === "ACCRUALS" ? "ACCRUALS" : "CASH") as Basis,
    periodType: (s?.mtdPeriodType === "CALENDAR" ? "CALENDAR" : "STANDARD") as PeriodType,
    vatRegistered: Boolean(s?.vatNumber?.trim()),
    salesVatRate: s?.vatNumber?.trim() && s?.invoiceVatEnabled ? Number(s.invoiceVatRate) || 0 : 0,
  };
}

/** Everything dated between start and end (ISO, inclusive), plus every asset. */
export async function loadMtdInputs(tenantId: number, start: string, end: string): Promise<MtdInputs> {
  const settings = await mtdSettings(tenantId);
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T23:59:59.999Z`);
  const [payments, jobs, other, expenses, vehicles, trips, home, assets] = await Promise.all([
    prisma.payment.findMany({ where: { tenantId, voidedAt: null, paidAt: { gte: from, lte: to } }, select: { paidAt: true, amount: true } }),
    settings.basis === "ACCRUALS"
      ? prisma.job.findMany({ where: { tenantId, status: "COMPLETE", isQuote: false, workDay: { date: { gte: from, lte: to } } }, select: { price: true, workDay: { select: { date: true } } } })
      : Promise.resolve([] as Array<{ price: number; workDay: { date: Date } }>),
    prisma.otherIncome.findMany({ where: { tenantId, receivedAt: { gte: from, lte: to } }, select: { receivedAt: true, amount: true, netAmount: true, category: true } }),
    prisma.expense.findMany({ where: { tenantId, expenseDate: { gte: from, lte: to } }, select: { id: true, expenseDate: true, amount: true, netAmount: true, hmrcCategory: true, category: true, businessPct: true, vehicleId: true } }),
    prisma.vehicle.findMany({ where: { tenantId }, select: { id: true, kind: true, method: true } }),
    prisma.mileageTrip.findMany({ where: { tenantId, date: { gte: from, lte: to } }, select: { date: true, miles: true, vehicleId: true } }),
    prisma.homeUseMonth.findMany({ where: { tenantId, month: { gte: from, lte: to } }, select: { month: true, hours: true } }),
    prisma.businessAsset.findMany({ where: { tenantId } }),
  ]);
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  return {
    ...settings,
    payments: payments.map((p) => ({ date: d(p.paidAt), amount: p.amount })),
    completedJobs: jobs.map((j) => ({ date: d(j.workDay.date), amount: j.price })),
    otherIncome: other.map((o) => ({ date: d(o.receivedAt), amount: o.amount, netAmount: o.netAmount, category: o.category })),
    expenses: expenses.map((e) => ({
      id: e.id, date: d(e.expenseDate), amount: e.amount, netAmount: e.netAmount, hmrcCategory: e.hmrcCategory, category: e.category, businessPct: e.businessPct,
      vehicleMethod: e.vehicleId ? ((vehicleById.get(e.vehicleId)?.method as "MILEAGE" | "ACTUAL" | undefined) ?? null) : null,
    })),
    trips: trips.map((t) => ({ date: d(t.date), miles: t.miles, vehicleKind: vehicleById.get(t.vehicleId)?.kind ?? "VAN" })),
    homeMonths: home.map((h) => ({ month: d(h.month), hours: h.hours })),
    assets: assets.map((a) => ({
      id: a.id, description: a.description, boughtAt: d(a.boughtAt), cost: a.cost, kind: a.kind, carEmissions: a.carEmissions, businessPct: a.businessPct,
      disposedAt: a.disposedAt ? d(a.disposedAt) : null, disposalValue: a.disposalValue,
    })),
  };
}

/** Throws if the date falls in a quarter marked as submitted to HMRC. */
export async function assertNotLocked(tenantId: number, ...dates: Array<Date | string | null | undefined>) {
  const days = dates.filter(Boolean).map((x) => (typeof x === "string" ? x.slice(0, 10) : d(x as Date)));
  if (!days.length) return;
  const locks = await prisma.mtdQuarterLock.findMany({ where: { tenantId }, select: { periodStart: true, periodEnd: true } });
  for (const day of days) {
    const hit = locks.find((l) => day >= d(l.periodStart) && day <= d(l.periodEnd));
    if (hit) throw new Error(`That date is in a quarter you've marked as submitted to HMRC (${d(hit.periodStart)} to ${d(hit.periodEnd)}). Unlock it in Accounting → MTD first.`);
  }
}
