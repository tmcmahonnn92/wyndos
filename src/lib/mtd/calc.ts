/**
 * Making Tax Digital (Income Tax, self-employment): the figures a quarterly update and the
 * end-of-year summary need, worked out from Wyndos's records. Pure code, no database.
 *
 * Field names match HMRC's Self-Employment Business API (periodIncome, periodExpenses,
 * periodDisallowableExpenses, annual allowances/adjustments) so bridging software can map them 1:1.
 *
 * Rules used (check with an accountant for anything unusual):
 *  - Cash basis: income when paid, expenses when paid. Accruals: income when the clean is done.
 *  - VAT registered: figures exclude VAT; otherwise they include it.
 *  - Expense totals include any private part; the private part also goes in the matching
 *    "…Disallowable" field (HMRC deducts it). Entertainment and depreciation are always disallowable.
 *  - Vehicles on the mileage method: fuel, repairs, tax and insurance for them are disallowable
 *    (the flat rate replaces them); parking and tolls are still allowed.
 *  - Mileage: cars and vans 45p (55p from 2026/27) for the first 10,000 business miles a year
 *    (all cars and vans together), then 25p; motorcycles 24p. Goes in carVanTravelExpenses.
 *  - Use of home: £10 / £18 / £26 a month for 25–50 / 51–100 / 101+ hours. Goes in premisesRunningCosts.
 *  - Assets: on the cash basis, equipment and vans are an expense when bought (otherExpenses) and
 *    sale proceeds are income; cars always get capital allowances. On accruals, equipment and vans
 *    get the Annual Investment Allowance. Cars: electric 100%, ≤50g/km 18% a year, >50g/km 6% a year,
 *    reducing balance; private use = its own pool, claim reduced by the business %.
 */

export const HMRC_EXPENSE_FIELDS = [
  "costOfGoods", "paymentsToSubcontractors", "wagesAndStaffCosts", "carVanTravelExpenses", "premisesRunningCosts",
  "maintenanceCosts", "adminCosts", "businessEntertainmentCosts", "advertisingCosts", "interestOnBankOtherLoans",
  "financeCharges", "irrecoverableDebts", "professionalFees", "depreciation", "otherExpenses",
] as const;
export type HmrcExpenseField = (typeof HMRC_EXPENSE_FIELDS)[number];
const ALWAYS_DISALLOWED = new Set<string>(["businessEntertainmentCosts", "depreciation"]);
const MILEAGE_REPLACES = new Set(["FUEL", "VEHICLE_MAINTENANCE", "VEHICLE_COSTS"]);
/** Other-income categories that are really sales (turnover), not "other business income". */
const TURNOVER_INCOME = new Set(["COMMERCIAL", "BONUS", "OPENING"]);
export const CONSOLIDATED_LIMIT = 90000;

export type Basis = "CASH" | "ACCRUALS";
export type PeriodType = "STANDARD" | "CALENDAR";
export type Period = { index: number; label: string; start: string; end: string; due: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const fmt = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The tax year (by its starting calendar year) a date falls in: 6 Apr 2026 → 2026, 5 Apr 2026 → 2025. */
export function taxYearOf(dateIso: string) {
  const [y, m, d] = dateIso.slice(0, 10).split("-").map(Number);
  return m > 4 || (m === 4 && d >= 6) ? y : y - 1;
}
export const taxYearLabel = (y: number) => `${y}/${String((y + 1) % 100).padStart(2, "0")}`;

/** The four quarterly update periods for a tax year, with their deadlines. */
export function quartersFor(taxYear: number, type: PeriodType): Period[] {
  const y = taxYear, n = taxYear + 1;
  const spans: Array<[string, string, string]> = type === "CALENDAR"
    ? [[iso(y, 4, 1), iso(y, 6, 30), iso(y, 8, 7)], [iso(y, 7, 1), iso(y, 9, 30), iso(y, 11, 7)], [iso(y, 10, 1), iso(y, 12, 31), iso(n, 2, 7)], [iso(n, 1, 1), iso(n, 3, 31), iso(n, 5, 7)]]
    : [[iso(y, 4, 6), iso(y, 7, 5), iso(y, 8, 7)], [iso(y, 7, 6), iso(y, 10, 5), iso(y, 11, 7)], [iso(y, 10, 6), iso(n, 1, 5), iso(n, 2, 7)], [iso(n, 1, 6), iso(n, 4, 5), iso(n, 5, 7)]];
  return spans.map(([start, end, due], i) => ({ index: i + 1, label: `Q${i + 1} · ${fmt(start)} – ${fmt(end)}`, start, end, due }));
}
export const yearSpan = (taxYear: number, type: PeriodType) => {
  const q = quartersFor(taxYear, type);
  return { start: q[0].start, end: q[3].end };
};

export type MtdInputs = {
  basis: Basis;
  vatRegistered: boolean;
  /** Output VAT rate on cleans when VAT registered (e.g. 20). */
  salesVatRate: number;
  payments: Array<{ date: string; amount: number }>;
  completedJobs: Array<{ date: string; amount: number }>;
  otherIncome: Array<{ date: string; amount: number; netAmount: number; category: string }>;
  expenses: Array<{ id: number; date: string; amount: number; netAmount: number; hmrcCategory: string; category: string; businessPct: number; vehicleMethod: "MILEAGE" | "ACTUAL" | null }>;
  trips: Array<{ date: string; miles: number; vehicleKind: string }>;
  homeMonths: Array<{ month: string; hours: number }>;
  assets: Array<{ id: number; description: string; boughtAt: string; cost: number; kind: string; carEmissions: string | null; businessPct: number; disposedAt: string | null; disposalValue: number | null }>;
};

export type FieldTotals = {
  turnover: number;
  other: number;
  expenses: Record<HmrcExpenseField, number>;
  disallowable: Record<HmrcExpenseField, number>;
  /** Allowable total (expenses − disallowable): what "consolidatedExpenses" would be. */
  consolidatedExpenses: number;
  mileageClaim: number;
  homeClaim: number;
  profit: number;
};

const emptyFields = () => Object.fromEntries(HMRC_EXPENSE_FIELDS.map((f) => [f, 0])) as Record<HmrcExpenseField, number>;
const asField = (k: string): HmrcExpenseField => ((HMRC_EXPENSE_FIELDS as readonly string[]).includes(k) ? (k as HmrcExpenseField) : "otherExpenses");
export const mileageRate = (taxYear: number) => (taxYear >= 2026 ? 0.55 : 0.45);
export const homeRate = (hours: number) => (hours >= 101 ? 26 : hours >= 51 ? 18 : hours >= 25 ? 10 : 0);

/** Mileage claim for each trip, applying the 10,000-mile split in date order across the tax year. */
export function mileageByTrip(trips: MtdInputs["trips"]) {
  const sorted = [...trips].sort((a, b) => a.date.localeCompare(b.date));
  const usedByYear = new Map<number, number>();
  return sorted.map((t) => {
    const ty = taxYearOf(t.date);
    if (t.vehicleKind === "MOTORCYCLE") return { ...t, claim: r2(t.miles * 0.24) };
    const used = usedByYear.get(ty) ?? 0;
    const high = Math.max(0, Math.min(t.miles, 10000 - used));
    usedByYear.set(ty, used + t.miles);
    return { ...t, claim: r2(high * mileageRate(ty) + (t.miles - high) * 0.25) };
  });
}

/** Totals per HMRC field for every record dated between start and end (inclusive). */
export function totalsFor(input: MtdInputs, start: string, end: string): FieldTotals {
  const inRange = (d: string) => d >= start && d <= end;
  const expenses = emptyFields();
  const disallowable = emptyFields();
  const vatOut = (gross: number) => (input.vatRegistered && input.salesVatRate > 0 ? gross / (1 + input.salesVatRate / 100) : gross);

  let turnover = (input.basis === "CASH" ? input.payments : input.completedJobs).filter((p) => inRange(p.date)).reduce((s, p) => s + vatOut(p.amount), 0);
  let other = 0;
  for (const o of input.otherIncome.filter((x) => inRange(x.date))) {
    const value = input.vatRegistered ? o.netAmount || o.amount : o.amount;
    if (TURNOVER_INCOME.has(o.category)) turnover += value; else other += value;
  }

  for (const e of input.expenses.filter((x) => inRange(x.date))) {
    const field = asField(e.hmrcCategory);
    const value = input.vatRegistered ? (e.netAmount || e.amount) : e.amount;
    expenses[field] += value;
    let privatePart = value * (1 - Math.min(100, Math.max(0, e.businessPct)) / 100);
    if (ALWAYS_DISALLOWED.has(field) || (e.vehicleMethod === "MILEAGE" && MILEAGE_REPLACES.has(e.category))) privatePart = value;
    disallowable[field] += privatePart;
  }

  const mileageClaim = mileageByTrip(input.trips).filter((t) => inRange(t.date)).reduce((s, t) => s + t.claim, 0);
  expenses.carVanTravelExpenses += mileageClaim;
  const homeClaim = input.homeMonths.filter((h) => inRange(h.month)).reduce((s, h) => s + homeRate(h.hours), 0);
  expenses.premisesRunningCosts += homeClaim;

  // Cash basis: equipment and vans are an expense when bought; money from selling them is income.
  if (input.basis === "CASH") {
    for (const a of input.assets) {
      if (a.kind === "CAR") continue;
      if (inRange(a.boughtAt)) {
        expenses.otherExpenses += a.cost;
        disallowable.otherExpenses += a.cost * (1 - a.businessPct / 100);
      }
      if (a.disposedAt && inRange(a.disposedAt) && a.disposalValue) other += a.disposalValue * (a.businessPct / 100);
    }
  }

  for (const f of HMRC_EXPENSE_FIELDS) { expenses[f] = r2(expenses[f]); disallowable[f] = r2(disallowable[f]); }
  const allowable = HMRC_EXPENSE_FIELDS.reduce((s, f) => s + expenses[f] - disallowable[f], 0);
  return {
    turnover: r2(turnover), other: r2(other), expenses, disallowable,
    consolidatedExpenses: r2(allowable), mileageClaim: r2(mileageClaim), homeClaim: r2(homeClaim),
    profit: r2(turnover + other - allowable),
  };
}

export type AssetYear = { id: number; description: string; kind: string; pool: string; opening: number; additions: number; claim: number; closing: number; balancing: number; note: string };
export type CapitalAllowances = {
  annualInvestmentAllowance: number;
  capitalAllowanceMainPool: number;
  capitalAllowanceSpecialRatePool: number;
  capitalAllowanceSingleAssetPool: number;
  zeroEmissionsCarAllowance: number;
  allowanceOnSales: number;
  balancingChargeOther: number;
  total: number;
  assets: AssetYear[];
};

/** Capital allowances for one tax year (for the end-of-year summary). */
export function capitalAllowancesFor(input: MtdInputs, taxYear: number, type: PeriodType): CapitalAllowances {
  const out: CapitalAllowances = { annualInvestmentAllowance: 0, capitalAllowanceMainPool: 0, capitalAllowanceSpecialRatePool: 0, capitalAllowanceSingleAssetPool: 0, zeroEmissionsCarAllowance: 0, allowanceOnSales: 0, balancingChargeOther: 0, total: 0, assets: [] };
  for (const a of input.assets) {
    const pct = Math.min(100, Math.max(0, a.businessPct)) / 100;
    const boughtYear = taxYearOf(a.boughtAt);
    const soldYear = a.disposedAt ? taxYearOf(a.disposedAt) : null;
    if (boughtYear > taxYear || (soldYear !== null && soldYear < taxYear)) continue;
    // Cash basis: equipment and vans are expenses, not allowances.
    if (input.basis === "CASH" && a.kind !== "CAR") continue;

    if (a.kind !== "CAR" || a.carEmissions === "ZERO") {
      // 100% in the year bought (AIA, or first-year allowance for an electric car).
      const pool = a.kind === "CAR" ? "Zero-emission car (100%)" : "Annual Investment Allowance";
      const additions = boughtYear === taxYear ? a.cost : 0;
      const claim = additions * pct;
      let balancing = 0;
      if (soldYear === taxYear && a.disposalValue) balancing = -a.disposalValue * pct;
      if (a.kind === "CAR") out.zeroEmissionsCarAllowance += claim; else out.annualInvestmentAllowance += claim;
      if (balancing < 0) out.balancingChargeOther += -balancing;
      out.assets.push({ id: a.id, description: a.description, kind: a.kind, pool, opening: boughtYear === taxYear ? 0 : 0, additions, claim: r2(claim), closing: 0, balancing: r2(balancing), note: soldYear === taxYear ? "Sold this year: the sale price comes back as a balancing charge" : "" });
      continue;
    }

    // Cars with CO2: writing-down allowance on a reducing balance, year by year from purchase.
    const rate = a.carEmissions === "HIGH" ? 0.06 : 0.18;
    const single = pct < 1;
    const pool = single ? "Single asset pool (private use)" : a.carEmissions === "HIGH" ? "Special rate pool (6%)" : "Main pool (18%)";
    let value = a.cost;
    let opening = a.cost, claim = 0, balancing = 0, additions = 0;
    for (let y = boughtYear; y <= taxYear; y++) {
      opening = y === boughtYear ? 0 : value;
      additions = y === boughtYear ? a.cost : 0;
      if (soldYear === y) {
        const diff = value - (a.disposalValue ?? 0);
        balancing = diff;
        claim = 0;
        value = 0;
        break;
      }
      claim = value * rate;
      value -= claim;
    }
    const businessClaim = claim * pct;
    if (single) out.capitalAllowanceSingleAssetPool += businessClaim;
    else if (a.carEmissions === "HIGH") out.capitalAllowanceSpecialRatePool += businessClaim;
    else out.capitalAllowanceMainPool += businessClaim;
    if (soldYear === taxYear) {
      if (balancing > 0) out.allowanceOnSales += balancing * pct; else out.balancingChargeOther += -balancing * pct;
    }
    out.assets.push({ id: a.id, description: a.description, kind: a.kind, pool, opening: r2(opening), additions: r2(additions), claim: r2(businessClaim), closing: r2(value), balancing: r2(balancing * pct), note: pct < 1 ? `Claim reduced to ${Math.round(pct * 100)}% business use` : "" });
  }
  for (const k of ["annualInvestmentAllowance", "capitalAllowanceMainPool", "capitalAllowanceSpecialRatePool", "capitalAllowanceSingleAssetPool", "zeroEmissionsCarAllowance", "allowanceOnSales", "balancingChargeOther"] as const) out[k] = r2(out[k]);
  out.total = r2(out.annualInvestmentAllowance + out.capitalAllowanceMainPool + out.capitalAllowanceSpecialRatePool + out.capitalAllowanceSingleAssetPool + out.zeroEmissionsCarAllowance + out.allowanceOnSales - out.balancingChargeOther);
  void type;
  return out;
}
