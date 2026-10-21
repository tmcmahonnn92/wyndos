/**
 * Day order: moves on the day view (today's order) and on the schedule (the area's order)
 * must both show as made, whichever came last.
 *   DATABASE_URL=... AUTH_SECRET=x TZ=UTC npx tsx --tsconfig scripts/sim/tsconfig.json scripts/sim/day-order-check.ts
 */
import prisma from "@/lib/db";
import { createBusiness, setToday, settle } from "./lib";
import { orderJobs } from "@/lib/day-order";

let failed = 0;
const check = (label: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : " " + extra}`); if (!ok) failed++; };

async function main() {
  const act = await import("@/lib/actions");
  const ord = await import("@/lib/day-order-actions");
  setToday("2026-10-13");
  const { tenantId } = await createBusiness("dayorder");
  await act.bulkImportCustomers(["A", "B"].flatMap((a) => [1, 2, 3, 4].map((i) => ({ name: `${a}${i}`, address: `${i} ${a} Rd, Testford, ZZ99 1AA`, price: 20, nextDueDate: "2026-10-16", frequencyWeeks: 4, areaName: a, areaFrequencyWeeks: 4 }))) as never, { createMissingAreas: true, bookRuns: true } as never);
  await settle();
  const days = await prisma.workDay.findMany({ where: { tenantId, date: new Date("2026-10-16T00:00:00Z") }, include: { area: true }, orderBy: { id: "asc" } });
  const dayIds = days.map((d) => d.id);
  const names = async () => {
    const ds = await prisma.workDay.findMany({ where: { id: { in: dayIds } }, include: { area: true, jobs: { include: { customer: true } } } });
    return orderJobs(ds as never).map((j: { customer: { name: string } }) => j.customer.name).join(" ");
  };
  const jobs = await prisma.job.findMany({ where: { workDayId: { in: dayIds } }, include: { customer: true } });
  const id = (n: string) => jobs.find((j) => j.customer.name === n)!.id;
  const want = (s: string) => s.split(" ").map(id);

  // Day view: whole day dragged into a mixed order.
  const mixed = "B2 A1 A3 B1 A2 A4 B3 B4";
  await ord.setTodayOrder(dayIds, want(mixed), true);
  check("day view mixed order shows", (await names()) === mixed, await names());

  // Quick moves one after another (each saves the whole list): the last one wins.
  for (const s of ["A1 B2 A3 B1 A2 A4 B3 B4", "A1 A3 B2 B1 A2 A4 B3 B4", "A4 A1 A3 B2 B1 A2 B3 B4"]) await ord.setTodayOrder(dayIds, want(s), true);
  check("several quick moves: last one shows", (await names()) === "A4 A1 A3 B2 B1 A2 B3 B4", await names());

  // Schedule: area A reordered there. A's jobs then follow that order (not the old day-view links).
  const dayA = days.find((d) => d.area?.name === "A")!.id;
  await act.reorderDayJobs(dayA, want("A2 A4 A1 A3"));
  const after = (await names()).split(" ").filter((n) => n.startsWith("A")).join(" ");
  check("schedule reorder of area A shows on the day", after === "A2 A4 A1 A3", await names());

  // Then the day view again: back to exactly what was dropped.
  await ord.setTodayOrder(dayIds, want(mixed), true);
  check("day view after schedule", (await names()) === mixed, await names());

  // Always-after customer: a schedule move still puts it where it was put.
  const a2 = jobs.find((j) => j.customer.name === "A2")!;
  await prisma.customer.update({ where: { id: a2.customerId }, data: { placeAfterCustomerId: jobs.find((j) => j.customer.name === "B4")!.customerId } });
  await act.reorderDayJobs(dayA, want("A1 A2 A3 A4"));
  const a = (await names()).split(" ").filter((n) => n.startsWith("A")).join(" ");
  check("schedule move beats an always-after link", a === "A1 A2 A3 A4", await names());

  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  console.log(failed ? `${failed} FAILED` : "all passed");
  process.exit(failed ? 1 : 0);
}
main();
