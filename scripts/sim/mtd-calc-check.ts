/** Quick checks of the MTD sums. Run: npx tsx --tsconfig scripts/sim/tsconfig.json scripts/sim/mtd-calc-check.ts */
import { capitalAllowancesFor, totalsFor, type MtdInputs } from "../../src/lib/mtd/calc";

let fails = 0;
const eq = (name: string, got: number, want: number) => {
  const ok = Math.abs(got - want) < 0.01;
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got}${ok ? "" : ` (want ${want})`}`);
};
const base = (): MtdInputs => ({
  basis: "CASH", periodType: "STANDARD", vatRegistered: false, salesVatRate: 0,
  payments: [], completedJobs: [], otherIncome: [], expenses: [], trips: [], homeMonths: [], assets: [],
} as unknown as MtdInputs);

// Use of home: April is in the new tax year (month stored mid-month).
{
  const i = base();
  i.homeMonths = [{ month: "2026-03-15", hours: 30 }, { month: "2026-04-15", hours: 60 }, { month: "2026-05-15", hours: 120 }];
  eq("home 2026/27 Q1 (Apr 60h=£18 + May 120h=£26)", totalsFor(i, "2026-04-06", "2026-07-05").homeClaim, 44);
  eq("home 2025/26 (Mar 30h=£10)", totalsFor(i, "2025-04-06", "2026-04-05").homeClaim, 10);
}
// Mileage 55p first 10,000, then 25p.
{
  const i = base();
  i.trips = [{ date: "2026-05-01", miles: 12000, vehicleKind: "VAN" }];
  eq("mileage 12,000 van miles", totalsFor(i, "2026-04-06", "2027-04-05").mileageClaim, 10000 * 0.55 + 2000 * 0.25);
}
// Car in main pool: 18% to 2025/26, 14% from 2026/27.
{
  const i = base();
  i.assets = [{ id: 1, description: "Car", boughtAt: "2025-06-01", cost: 10000, kind: "CAR", carEmissions: "LOW", businessPct: 100, disposedAt: null, disposalValue: null }];
  eq("main pool 2025/26 (18%)", capitalAllowancesFor(i, 2025, "STANDARD").capitalAllowanceMainPool, 1800);
  eq("main pool 2026/27 (14% of 8,200)", capitalAllowancesFor(i, 2026, "STANDARD").capitalAllowanceMainPool, 1148);
  // Sold in 2026/27 for £5,000: pool 8,200 − 5,000 = 3,200, WDA 14% = 448, no balancing allowance.
  i.assets[0].disposedAt = "2026-09-01"; i.assets[0].disposalValue = 5000;
  const y = capitalAllowancesFor(i, 2026, "STANDARD");
  eq("pooled sale: WDA on what's left", y.capitalAllowanceMainPool, 448);
  eq("pooled sale: no balancing allowance", y.allowanceOnSales, 0);
  eq("pooled sale: carries on next year (14% of 2,752)", capitalAllowancesFor(i, 2027, "STANDARD").capitalAllowanceMainPool, 385.28);
  // Sold for more than the pool: balancing charge.
  i.assets[0].disposalValue = 9000;
  eq("pooled sale above value: charge", capitalAllowancesFor(i, 2026, "STANDARD").balancingChargeOther, 800);
}
// Private-use car (single asset pool): balancing allowance on sale.
{
  const i = base();
  i.assets = [{ id: 1, description: "Car", boughtAt: "2025-06-01", cost: 10000, kind: "CAR", carEmissions: "LOW", businessPct: 50, disposedAt: "2026-09-01", disposalValue: 5000 }];
  eq("single pool sale: allowance (8,200 − 5,000) × 50%", capitalAllowancesFor(i, 2026, "STANDARD").allowanceOnSales, 1600);
}
// Electric car bought before 6 Apr 2027: 100%.
{
  const i = base();
  i.assets = [{ id: 1, description: "EV", boughtAt: "2026-06-01", cost: 30000, kind: "CAR", carEmissions: "ZERO", businessPct: 100, disposedAt: null, disposalValue: null }];
  eq("zero-emission FYA", capitalAllowancesFor(i, 2026, "STANDARD").zeroEmissionsCarAllowance, 30000);
  i.assets[0].boughtAt = "2027-05-01";
  eq("zero-emission after 5 Apr 2027 → main pool 14%", capitalAllowancesFor(i, 2027, "STANDARD").capitalAllowanceMainPool, 4200);
}
// UK date for a payment just after midnight BST.
{
  const at = new Date("2026-07-05T23:30:00Z");
  const uk = at.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  console.log(`${uk === "2026-07-06" ? "ok  " : "FAIL"} 00:30 BST on 6 Jul is 6 Jul: ${uk}`);
  if (uk !== "2026-07-06") fails++;
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
