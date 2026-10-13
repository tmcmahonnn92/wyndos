import prisma from "@/lib/db";
import { createBusiness, setToday, settle } from "./lib";
async function main() {
  const act = await import("@/lib/actions");
  setToday("2026-10-13");
  const { tenantId } = await createBusiness("twoarea");
  // Two areas, both due on Fri 16 Oct (future), 4-weekly.
  await act.bulkImportCustomers(["A", "B"].flatMap((a) => [1, 2, 3].map((i) => ({ name: `${a}${i}`, address: `${i} ${a} Rd, Testford, ZZ99 1AA`, price: 20, nextDueDate: "2026-10-16", frequencyWeeks: 4, areaName: a, areaFrequencyWeeks: 4 }))) as never, { createMissingAreas: true, bookRuns: true } as never);
  await settle();
  const show = async (label: string) => {
    const days = await prisma.workDay.findMany({ where: { tenantId }, include: { area: true, _count: { select: { jobs: true } } }, orderBy: [{ date: "asc" }, { id: "asc" }] });
    console.log(label); for (const d of days) console.log("  ", d.id, d.date.toISOString().slice(0, 10), d.area?.name, d.status, "jobs", d._count.jobs);
  };
  await show("start");
  const [dA, dB] = await prisma.workDay.findMany({ where: { tenantId, date: new Date("2026-10-16T00:00:00Z") }, include: { area: true }, orderBy: { id: "asc" } });
  // Area A: all done, completed via "Complete area" with default date (today).
  for (const j of await prisma.job.findMany({ where: { workDayId: dA.id } })) await act.completeJob(j.id);
  await act.completeDay(dA.id, [], "2026-10-13");
  await show("after A completed (date today)");
  // B already has its next run booked by hand on Fri 13 Nov, one customer marked "skip".
  const areaB = (await prisma.area.findFirst({ where: { tenantId, name: "B" } }))!;
  const pre = await prisma.workDay.create({ data: { tenantId, areaId: areaB.id, date: new Date("2026-11-13T00:00:00Z") } });
  const b1 = (await prisma.customer.findFirst({ where: { tenantId, name: "B1" } }))!;
  await prisma.job.create({ data: { tenantId, workDayId: pre.id, customerId: b1.id, price: 20, status: "SKIPPED", notes: "Completed via another area run" } });
  await show("B pre-booked 13 Nov");
  // Area B: one done, rest skipped, completed on a different day (the 15th).
  const jb = await prisma.job.findMany({ where: { workDayId: dB.id }, orderBy: { id: "asc" } });
  await act.completeJob(jb[0].id);
  await act.completeDay(dB.id, jb.slice(1).map((j) => ({ jobId: j.id, action: "skip" as const })), "2026-10-15");
  await show("after B completed (15th, rest skipped)");
  const bRuns = await prisma.workDay.count({ where: { tenantId, areaId: areaB.id, status: { not: "COMPLETE" } } });
  console.log(bRuns === 1 ? "PASS one open B run" : `FAIL ${bRuns} open B runs`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
