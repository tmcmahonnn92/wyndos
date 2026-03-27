import { prisma } from "../src/lib/db";

async function main() {
  const areas = await prisma.area.findMany({
    where: { isSystemArea: false },
    include: { _count: { select: { customers: true } } },
  });

  const empty = areas.filter((a) => a._count.customers === 0);

  if (empty.length === 0) {
    console.log("No empty areas found.");
    return;
  }

  console.log(`Found ${empty.length} empty area(s):`);
  for (const a of empty) {
    console.log(`  - ${a.name} (id: ${a.id})`);
  }

  const areaIds = empty.map((a) => a.id);

  // Delete associated WorkDays (and their jobs) first
  const workDays = await prisma.workDay.findMany({
    where: { areaId: { in: areaIds } },
    select: { id: true },
  });
  const workDayIds = workDays.map((w) => w.id);
  if (workDayIds.length > 0) {
    await prisma.job.deleteMany({ where: { workDayId: { in: workDayIds } } });
    await prisma.workDay.deleteMany({ where: { id: { in: workDayIds } } });
    console.log(`Deleted ${workDayIds.length} work day(s) associated with empty areas.`);
  }

  await prisma.area.deleteMany({ where: { id: { in: areaIds } } });
  console.log(`Deleted ${empty.length} empty area(s).`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
