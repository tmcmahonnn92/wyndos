"use server";

/** Making Tax Digital accounts: figures by quarter, vehicles, mileage, use of home, assets, submitted quarters. */

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { requireOwner, requirePerm } from "@/lib/guards";
import {
  CONSOLIDATED_LIMIT, capitalAllowancesFor, quartersFor, taxYearLabel, taxYearOf, totalsFor, yearSpan,
  type FieldTotals,
} from "@/lib/mtd/calc";
import { assertNotLocked, loadMtdInputs, mtdSettings } from "@/lib/mtd/data";
import { materialiseRecurring } from "@/lib/recurring";

const iso = (x: Date) => x.toISOString().slice(0, 10);
const day = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) throw new Error("Enter a valid date.");
  return new Date(`${s}T12:00:00Z`);
};
const pct = (n: unknown) => Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
const refresh = () => { revalidatePath("/accounting"); revalidatePath("/accounting/mtd"); };

export async function getMtdOverview(taxYearArg?: number) {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  // Repeat expenses/income due up to today first, so the quarters are complete.
  await materialiseRecurring(tenantId);
  const settings = await mtdSettings(tenantId);
  const taxYear = Number.isInteger(taxYearArg) ? Number(taxYearArg) : taxYearOf(iso(new Date()));
  const span = yearSpan(taxYear, settings.periodType);
  const input = await loadMtdInputs(tenantId, span.start, span.end);
  const today = iso(new Date());
  const locks = await prisma.mtdQuarterLock.findMany({ where: { tenantId } });
  const periods = quartersFor(taxYear, settings.periodType).map((p) => {
    const period = totalsFor(input, p.start, p.end);
    const cumulative = totalsFor(input, span.start, p.end);
    const lock = locks.find((l) => iso(l.periodStart) === p.start);
    let changedSinceLock = false;
    if (lock) {
      try {
        const sent = JSON.parse(lock.snapshot) as FieldTotals;
        changedSinceLock = JSON.stringify(sent.expenses) !== JSON.stringify(cumulative.expenses) || JSON.stringify(sent.disallowable ?? {}) !== JSON.stringify(cumulative.disallowable) || sent.turnover !== cumulative.turnover || sent.other !== cumulative.other;
      } catch { changedSinceLock = true; }
    }
    return {
      ...p, period, cumulative,
      status: lock ? "submitted" : p.end >= today ? (p.start > today ? "future" : "open") : p.due < today ? "overdue" : "ready",
      lockedAt: lock?.lockedAt.toISOString() ?? null,
      changedSinceLock,
    };
  });
  const year = totalsFor(input, span.start, span.end);
  const allowances = capitalAllowancesFor(input, taxYear, settings.periodType);
  const [vehicles, trips, home, assets] = await Promise.all([
    prisma.vehicle.findMany({ where: { tenantId }, orderBy: [{ archived: "asc" }, { name: "asc" }] }),
    prisma.mileageTrip.findMany({ where: { tenantId, date: { gte: new Date(`${span.start}T00:00:00Z`), lte: new Date(`${span.end}T23:59:59Z`) } }, orderBy: { date: "desc" }, take: 500 }),
    prisma.homeUseMonth.findMany({ where: { tenantId, month: { gte: new Date(`${span.start.slice(0, 7)}-01T00:00:00Z`), lt: new Date(`${span.end.slice(0, 7)}-01T00:00:00Z`) } }, orderBy: { month: "asc" } }),
    prisma.businessAsset.findMany({ where: { tenantId }, orderBy: { boughtAt: "desc" } }),
  ]);
  const current = taxYearOf(today);
  // Things worth a second look. Wyndos can't know the answer, so these are prompts, not errors.
  const checks: string[] = [];
  const onMileage = vehicles.filter((v) => v.method === "MILEAGE" && !v.archived);
  if (onMileage.length) {
    const loose = input.expenses.filter((e) => !e.vehicleMethod && ["FUEL", "VEHICLE_MAINTENANCE", "VEHICLE_COSTS"].includes(e.category));
    if (loose.length) checks.push(`${loose.length} fuel or vehicle cost${loose.length === 1 ? " isn't" : "s aren't"} linked to a vehicle, and ${onMileage.map((v) => v.name).join(", ")} ${onMileage.length === 1 ? "is" : "are"} on the mileage rate. Costs for a vehicle on the mileage rate can't be claimed as well, so link each one to its vehicle (Edit the expense).`);
    if (assets.some((a) => a.kind === "CAR" || a.kind === "VAN")) checks.push("You have a vehicle on the mileage rate and a car or van under Assets. A vehicle on the mileage rate can't also get capital allowances, so remove it from Assets if it's the same vehicle.");
  }
  if (input.expenses.some((e) => e.businessPct === 0)) checks.push("Some expenses are set to 0% business use, so none of them is claimed. Check that's right.");
  return {
    checks,
    taxYear, taxYearLabel: taxYearLabel(taxYear), span, settings, periods, year, allowances,
    // HMRC's test is turnover below the VAT threshold.
    consolidatedAllowed: year.turnover < CONSOLIDATED_LIMIT,
    taxYears: Array.from({ length: 5 }, (_, i) => current + 1 - i).filter((y) => y <= current + (today >= `${current + 1}-03-01` ? 1 : 0)).map((y) => ({ value: y, label: taxYearLabel(y) })),
    vehicles: vehicles.map((v) => ({ id: v.id, name: v.name, registration: v.registration, kind: v.kind, method: v.method, businessPct: v.businessPct, archived: v.archived })),
    trips: trips.map((t) => ({ id: t.id, vehicleId: t.vehicleId, date: iso(t.date), miles: t.miles, notes: t.notes ?? "" })),
    homeMonths: home.map((h) => ({ month: iso(h.month).slice(0, 7), hours: h.hours })),
    assets: assets.map((a) => ({ id: a.id, description: a.description, boughtAt: iso(a.boughtAt), cost: a.cost, kind: a.kind, carEmissions: a.carEmissions, businessPct: a.businessPct, disposedAt: a.disposedAt ? iso(a.disposedAt) : null, disposalValue: a.disposalValue, notes: a.notes ?? "" })),
  };
}

/** Every transaction in the tax year with its HMRC field, for the export. */
export async function getMtdTransactions(taxYear: number) {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  await materialiseRecurring(tenantId);
  const settings = await mtdSettings(tenantId);
  const span = yearSpan(Number(taxYear), settings.periodType);
  const from = new Date(`${span.start}T00:00:00Z`), to = new Date(`${span.end}T23:59:59Z`);
  const [payments, other, expenses, vehicles] = await Promise.all([
    prisma.payment.findMany({ where: { tenantId, voidedAt: null, broughtForward: false, paidAt: { gte: new Date(+from - 3600_000), lte: to } }, select: { id: true, paidAt: true, amount: true, method: true, customer: { select: { name: true } } }, orderBy: { paidAt: "asc" } }),
    prisma.otherIncome.findMany({ where: { tenantId, receivedAt: { gte: from, lte: to } }, orderBy: { receivedAt: "asc" } }),
    prisma.expense.findMany({ where: { tenantId, expenseDate: { gte: from, lte: to } }, orderBy: { expenseDate: "asc" } }),
    prisma.vehicle.findMany({ where: { tenantId }, select: { id: true, name: true } }),
  ]);
  const vName = new Map(vehicles.map((v) => [v.id, v.name]));
  return {
    payments: payments.filter((p) => { const day = p.paidAt.toLocaleDateString("en-CA", { timeZone: "Europe/London" }); return day >= span.start && day <= span.end; }).map((p) => ({ id: p.id, date: p.paidAt.toLocaleDateString("en-CA", { timeZone: "Europe/London" }), customer: p.customer.name, method: p.method, amount: p.amount })),
    otherIncome: other.map((o) => ({ id: o.id, date: iso(o.receivedAt), source: o.source, category: o.category, amount: o.amount, net: o.netAmount, vat: o.vatAmount })),
    expenses: expenses.map((e) => ({ id: e.id, date: iso(e.expenseDate), supplier: e.supplier, category: e.category, hmrcCategory: e.hmrcCategory, amount: e.amount, net: e.netAmount, vat: e.vatAmount, businessPct: e.businessPct, vehicle: e.vehicleId ? vName.get(e.vehicleId) ?? "" : "", notes: e.notes ?? "" })),
  };
}

async function setAccountsSettingsImpl(data: { basis?: string; periodType?: string }) {
  const actor = await requireOwner();
  // Changing the basis or the quarters would rewrite figures already sent to HMRC.
  const current = await mtdSettings(actor.tenantId);
  const changing = (data.basis && data.basis !== current.basis) || (data.periodType && data.periodType !== current.periodType);
  if (changing && await prisma.mtdQuarterLock.count({ where: { tenantId: actor.tenantId, periodEnd: { gte: new Date(`${yearSpan(taxYearOf(iso(new Date())) - 1, current.periodType).start}T00:00:00Z`) } } })) {
    throw new Error("You've marked quarters as submitted, so the basis and quarters can't change now (it would change figures HMRC already has). Unlock those quarters first if you really need to.");
  }
  await prisma.tenantSettings.update({
    where: { tenantId: actor.tenantId },
    data: {
      ...(data.basis ? { accountingBasis: data.basis === "ACCRUALS" ? "ACCRUALS" : "CASH" } : {}),
      ...(data.periodType ? { mtdPeriodType: data.periodType === "CALENDAR" ? "CALENDAR" : "STANDARD" } : {}),
    },
  });
  refresh();
}

// ── Vehicles and mileage ─────────────────────────────────────────────────────

async function saveVehicleImpl(data: { id?: number; name: string; registration?: string; kind: string; method: string; businessPct: number; archived?: boolean }) {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  const fields = {
    name: String(data.name ?? "").trim().slice(0, 60) || "Van",
    registration: String(data.registration ?? "").trim().toUpperCase().slice(0, 12),
    kind: ["CAR", "VAN", "MOTORCYCLE"].includes(data.kind) ? data.kind : "VAN",
    method: data.method === "MILEAGE" ? "MILEAGE" : "ACTUAL",
    businessPct: pct(data.businessPct),
    archived: data.archived === true,
  };
  if (data.id) {
    // HMRC: once a vehicle is on the mileage rate it stays on it; and a vehicle whose costs have
    // been claimed can't move to the mileage rate. Only a vehicle with nothing recorded can switch.
    const before = await prisma.vehicle.findFirst({ where: { id: Number(data.id), tenantId }, select: { method: true } });
    if (before && before.method !== fields.method) {
      const [trips, costs] = await Promise.all([
        prisma.mileageTrip.count({ where: { tenantId, vehicleId: Number(data.id) } }),
        prisma.expense.count({ where: { tenantId, vehicleId: Number(data.id) } }),
      ]);
      if (trips || costs) throw new Error(before.method === "MILEAGE"
        ? "This vehicle has miles logged at the mileage rate. HMRC says you keep using the mileage rate for as long as you use it for the business."
        : "This vehicle already has costs claimed against it, so it can't move to the mileage rate. If you've changed vehicle, add the new one.");
    }
    const res = await prisma.vehicle.updateMany({ where: { id: Number(data.id), tenantId }, data: fields });
    if (!res.count) throw new Error("Vehicle not found");
  } else {
    await prisma.vehicle.create({ data: { tenantId, ...fields } });
  }
  refresh();
}

async function addMileageTripImpl(data: { vehicleId: number; date: string; miles: number; notes?: string }) {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  const vehicle = await prisma.vehicle.findFirst({ where: { id: Number(data.vehicleId), tenantId } });
  if (!vehicle) throw new Error("Choose a vehicle");
  if (vehicle.method !== "MILEAGE") throw new Error("That vehicle is on actual costs. Switch it to the mileage rate to log miles.");
  const miles = Math.round(Number(data.miles) * 10) / 10;
  if (!Number.isFinite(miles) || miles <= 0 || miles > 20000) throw new Error("Enter the business miles.");
  const date = day(data.date);
  await assertNotLocked(tenantId, date);
  await prisma.mileageTrip.create({ data: { tenantId, vehicleId: vehicle.id, date, miles, notes: String(data.notes ?? "").trim().slice(0, 200) || null } });
  refresh();
}

async function deleteMileageTripImpl(id: number) {
  const actor = await requirePerm("accounting");
  const trip = await prisma.mileageTrip.findFirst({ where: { id: Number(id), tenantId: actor.tenantId } });
  if (!trip) return;
  await assertNotLocked(actor.tenantId, trip.date);
  await prisma.mileageTrip.delete({ where: { id: trip.id } });
  refresh();
}

// ── Use of home ──────────────────────────────────────────────────────────────

async function setHomeHoursImpl(month: string, hours: number) {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error("Choose a month");
  const start = new Date(`${month}-01T00:00:00Z`);
  // A month counts in the quarter it mostly falls in (April is in the new tax year).
  await assertNotLocked(tenantId, `${month}-15`);
  const h = Math.max(0, Math.min(744, Math.round(Number(hours) || 0)));
  if (h === 0) await prisma.homeUseMonth.deleteMany({ where: { tenantId, month: start } });
  else await prisma.homeUseMonth.upsert({ where: { tenantId_month: { tenantId, month: start } }, create: { tenantId, month: start, hours: h }, update: { hours: h } });
  refresh();
}

// ── Assets ───────────────────────────────────────────────────────────────────

async function saveAssetImpl(data: { id?: number; description: string; boughtAt: string; cost: number; kind: string; carEmissions?: string | null; businessPct: number; disposedAt?: string | null; disposalValue?: number | null; notes?: string }) {
  const actor = await requirePerm("accounting");
  const tenantId = actor.tenantId;
  const cost = Math.round(Number(data.cost) * 100) / 100;
  if (!Number.isFinite(cost) || cost <= 0) throw new Error("Enter what it cost.");
  const kind = ["EQUIPMENT", "VAN", "CAR"].includes(data.kind) ? data.kind : "EQUIPMENT";
  const fields = {
    description: String(data.description ?? "").trim().slice(0, 120) || "Equipment",
    boughtAt: day(data.boughtAt), cost, kind,
    carEmissions: kind === "CAR" ? (["ZERO", "LOW", "HIGH"].includes(String(data.carEmissions)) ? String(data.carEmissions) : "LOW") : null,
    businessPct: pct(data.businessPct),
    disposedAt: data.disposedAt ? day(data.disposedAt) : null,
    disposalValue: data.disposedAt ? Math.max(0, Math.round((Number(data.disposalValue) || 0) * 100) / 100) : null,
    notes: String(data.notes ?? "").trim().slice(0, 300) || null,
  };
  await assertNotLocked(tenantId, fields.boughtAt, fields.disposedAt);
  if (data.id) {
    const existing = await prisma.businessAsset.findFirst({ where: { id: Number(data.id), tenantId } });
    if (!existing) throw new Error("Asset not found");
    await assertNotLocked(tenantId, existing.boughtAt, existing.disposedAt);
    await prisma.businessAsset.update({ where: { id: existing.id }, data: fields });
  } else {
    await prisma.businessAsset.create({ data: { tenantId, ...fields } });
  }
  refresh();
}

async function deleteAssetImpl(id: number) {
  const actor = await requirePerm("accounting");
  const a = await prisma.businessAsset.findFirst({ where: { id: Number(id), tenantId: actor.tenantId } });
  if (!a) return;
  await assertNotLocked(actor.tenantId, a.boughtAt, a.disposedAt);
  await prisma.businessAsset.delete({ where: { id: a.id } });
  refresh();
}

// ── Submitted quarters ──────────────────────────────────────────────────────

/** Mark a quarter as submitted: its entries can't change, and the cumulative figures sent are kept. */
async function lockQuarterImpl(taxYear: number, index: number) {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;
  const settings = await mtdSettings(tenantId);
  const p = quartersFor(Number(taxYear), settings.periodType)[Number(index) - 1];
  if (!p) throw new Error("Quarter not found");
  const span = yearSpan(Number(taxYear), settings.periodType);
  const cumulative = totalsFor(await loadMtdInputs(tenantId, span.start, p.end), span.start, p.end);
  await prisma.mtdQuarterLock.upsert({
    where: { tenantId_periodStart: { tenantId, periodStart: new Date(`${p.start}T00:00:00Z`) } },
    create: { tenantId, periodStart: new Date(`${p.start}T00:00:00Z`), periodEnd: new Date(`${p.end}T23:59:59Z`), snapshot: JSON.stringify(cumulative) },
    update: { snapshot: JSON.stringify(cumulative), lockedAt: new Date() },
  });
  refresh();
}

async function unlockQuarterImpl(taxYear: number, index: number) {
  const actor = await requireOwner();
  const settings = await mtdSettings(actor.tenantId);
  const p = quartersFor(Number(taxYear), settings.periodType)[Number(index) - 1];
  if (!p) return;
  await prisma.mtdQuarterLock.deleteMany({ where: { tenantId: actor.tenantId, periodStart: new Date(`${p.start}T00:00:00Z`) } });
  refresh();
}

/**
 * Production builds hide the text of errors thrown in server actions, so these return the
 * message instead ("That date is in a submitted quarter…") for the page to show.
 */
async function safely(fn: () => Promise<unknown>) {
  try {
    await fn();
    return { ok: true as const };
  } catch (issue) {
    return { ok: false as const, error: issue instanceof Error ? issue.message : "Something went wrong." };
  }
}

export async function setAccountsSettings(...args: Parameters<typeof setAccountsSettingsImpl>) { return safely(() => setAccountsSettingsImpl(...args)); }
export async function saveVehicle(...args: Parameters<typeof saveVehicleImpl>) { return safely(() => saveVehicleImpl(...args)); }
export async function addMileageTrip(...args: Parameters<typeof addMileageTripImpl>) { return safely(() => addMileageTripImpl(...args)); }
export async function deleteMileageTrip(...args: Parameters<typeof deleteMileageTripImpl>) { return safely(() => deleteMileageTripImpl(...args)); }
export async function setHomeHours(...args: Parameters<typeof setHomeHoursImpl>) { return safely(() => setHomeHoursImpl(...args)); }
export async function saveAsset(...args: Parameters<typeof saveAssetImpl>) { return safely(() => saveAssetImpl(...args)); }
export async function deleteAsset(...args: Parameters<typeof deleteAssetImpl>) { return safely(() => deleteAssetImpl(...args)); }
export async function lockQuarter(...args: Parameters<typeof lockQuarterImpl>) { return safely(() => lockQuarterImpl(...args)); }
export async function unlockQuarter(...args: Parameters<typeof unlockQuarterImpl>) { return safely(() => unlockQuarterImpl(...args)); }

/** For forms: the reason a date can't be changed (it's in a submitted quarter), or null. */
export async function lockedReason(dates: string[]) {
  const actor = await requirePerm("accounting");
  try {
    await assertNotLocked(actor.tenantId, ...(Array.isArray(dates) ? dates : []).slice(0, 4).map((x) => String(x).slice(0, 10)));
    return null;
  } catch (issue) {
    return issue instanceof Error ? issue.message : "That quarter is submitted.";
  }
}
