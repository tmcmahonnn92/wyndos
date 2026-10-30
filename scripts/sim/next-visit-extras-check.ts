/**
 * Extras for the next visit ("conservatory next time"): added to the customer's next booked clean,
 * straight away if it's booked, otherwise when it is (e.g. when today's run is finished). Once only.
 *   DATABASE_URL=... AUTH_SECRET=x TZ=UTC npx tsx --tsconfig scripts/sim/tsconfig.json scripts/sim/next-visit-extras-check.ts
 */
import prisma from "@/lib/db";
import { createBusiness, setToday, settle } from "./lib";
import { attachNextVisitExtras } from "@/lib/next-visit-extras";

let failed = 0;
const check = (label: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : " " + extra}`); if (!ok) failed++; };

async function main() {
  const act = await import("@/lib/actions");
  setToday("2026-10-13");
  const { tenantId } = await createBusiness("extras");
  await act.bulkImportCustomers([1, 2, 3].map((i) => ({ name: `A${i}`, address: `${i} A Rd, Testford, ZZ99 1AA`, price: 20, nextDueDate: "2026-10-13", frequencyWeeks: 4, areaName: "A", areaFrequencyWeeks: 4 })) as never, { createMissingAreas: true, bookRuns: true } as never);
  await settle();
  const a1 = await prisma.customer.findFirstOrThrow({ where: { tenantId, name: "A1" } });
  const a2 = await prisma.customer.findFirstOrThrow({ where: { tenantId, name: "A2" } });
  const today = await prisma.workDay.findFirstOrThrow({ where: { tenantId, areaId: a1.areaId! }, orderBy: { date: "asc" } });
  const jobsOn = (dayId: number, customerId: number) => prisma.job.findMany({ where: { workDayId: dayId, customerId }, select: { name: true, price: true, isOneOff: true, notes: true } });

  // Same name as their normal clean: refused.
  const same = await act.addNextVisitExtra(a1.id, { name: "Window Cleaning", price: 10 });
  check("an extra named like their normal clean is refused", !same.ok);

  // Both ask today for something "next time": it waits for the next run (not today's visit),
  // whether today's clean is done yet or not.
  for (const j of await prisma.job.findMany({ where: { workDayId: today.id, customerId: a2.id } })) await act.completeJob(j.id);
  const r1 = await act.addNextVisitExtra(a1.id, { name: "Conservatory", price: 15, notes: "Roof too" });
  const r2 = await act.addNextVisitExtra(a2.id, { name: "Gutter clear", price: 40 });
  check("A1 (today's visit not done yet): waits, not put on today", r1.ok && !r1.value.addedToBookedVisit && !(await jobsOn(today.id, a1.id)).some((j) => j.name === "Conservatory"), JSON.stringify(r1));
  check("A2 (already done today): waits", r2.ok && !r2.value.addedToBookedVisit && (await prisma.customer.findUniqueOrThrow({ where: { id: a2.id } })).nextVisitExtras !== "[]");

  // Finish today's run: the next run is booked and A2's extra goes onto it.
  for (const j of await prisma.job.findMany({ where: { workDayId: today.id, status: "PENDING" } })) await act.completeJob(j.id);
  await act.completeDay(today.id, [], "2026-10-13");
  await settle();
  const next = await prisma.workDay.findFirst({ where: { tenantId, areaId: a1.areaId!, date: { gt: today.date } }, orderBy: { date: "asc" } });
  check("next run booked", !!next);
  const a2Next = next ? await jobsOn(next.id, a2.id) : [];
  check("A2's gutter clear is on their next run, with their clean", a2Next.some((j) => j.name === "Gutter clear" && j.price === 40) && a2Next.some((j) => !j.isOneOff), JSON.stringify(a2Next));
  const a1Next = next ? await jobsOn(next.id, a1.id) : [];
  check("A1's conservatory is on their next run, with price and note", a1Next.some((j) => j.name === "Conservatory" && j.price === 15 && j.isOneOff && j.notes === "Roof too"), JSON.stringify(a1Next));
  check("A2's waiting list is cleared", (await prisma.customer.findUniqueOrThrow({ where: { id: a2.id } })).nextVisitExtras === "[]");

  // Calling again (or twice at once) never adds it twice.
  await Promise.all([attachNextVisitExtras(tenantId), attachNextVisitExtras(tenantId)]);
  const again = next ? (await jobsOn(next.id, a2.id)).filter((j) => j.name === "Gutter clear").length : 0;
  check("never added twice", again === 1, String(again));

  // Next run already booked: added straight away.
  const r3 = await act.addNextVisitExtra(a1.id, { name: "Fascias", price: 25 });
  check("next run already booked: added straight away", r3.ok && r3.value.addedToBookedVisit && !!next && (await jobsOn(next.id, a1.id)).some((j) => j.name === "Fascias"), JSON.stringify(r3));
  // Two at once for the same customer.
  await prisma.customer.update({ where: { id: a1.id }, data: { nextVisitExtras: JSON.stringify([{ name: "Sills", price: 5 }]) } });
  await Promise.all([attachNextVisitExtras(tenantId, [a1.id]), attachNextVisitExtras(tenantId, [a1.id])]);
  const sills = next ? (await jobsOn(next.id, a1.id)).filter((j) => j.name === "Sills").length : 0;
  check("two attaches at once: added once", sills === 1, String(sills));

  // Remove one still waiting.
  await prisma.customer.update({ where: { id: a1.id }, data: { nextVisitExtras: JSON.stringify([{ name: "X", price: 1 }, { name: "Y", price: 2 }]) } });
  await prisma.job.deleteMany({ where: { customerId: a1.id, status: "PENDING" } });
  await act.removeNextVisitExtra(a1.id, 0);
  const left = JSON.parse((await prisma.customer.findUniqueOrThrow({ where: { id: a1.id } })).nextVisitExtras);
  check("remove takes off just that one", left.length === 1 && left[0].name === "Y", JSON.stringify(left));

  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  console.log(failed ? `${failed} FAILED` : "all passed");
  process.exit(failed ? 1 : 0);
}
main();
