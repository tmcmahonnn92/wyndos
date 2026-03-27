import { prisma } from "../src/lib/db";

async function main() {
  const areas = await prisma.area.findMany({
    where: { nextDueDate: { not: null } },
    select: {
      id: true,
      name: true,
      frequencyWeeks: true,
      nextDueDate: true,
      _count: { select: { customers: true } },
    },
    orderBy: { name: "asc" },
  });

  console.log(`Syncing customer cycles for ${areas.length} scheduled areas`);

  for (const area of areas) {
    const result = await prisma.customer.updateMany({
      where: { areaId: area.id, active: true },
      data: {
        frequencyWeeks: area.frequencyWeeks,
        nextDueDate: area.nextDueDate,
      },
    });

    console.log(
      `${area.name}: synced ${result.count} customers -> every ${area.frequencyWeeks}w, nextDue=${area.nextDueDate?.toISOString()}`
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
