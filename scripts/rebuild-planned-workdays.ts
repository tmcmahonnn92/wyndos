import { prisma } from "../src/lib/db";

async function main() {
  const plannedDays = await prisma.workDay.findMany({
    where: { status: "PLANNED", areaId: { not: null } },
    select: { id: true, date: true, areaId: true },
    orderBy: [{ date: "asc" }, { areaId: "asc" }],
  });

  console.log(`Rebuilding planned work days: ${plannedDays.length}`);

  for (const day of plannedDays) {
    if (!day.areaId) continue;

    await prisma.job.deleteMany({ where: { workDayId: day.id } });

    const customers = await prisma.customer.findMany({
      where: {
        areaId: day.areaId,
        active: true,
        OR: [{ nextDueDate: null }, { nextDueDate: { lte: day.date } }],
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, price: true },
    });

    if (customers.length > 0) {
      await prisma.job.createMany({
        data: customers.map((customer) => ({
          workDayId: day.id,
          customerId: customer.id,
          price: customer.price,
          status: "PENDING",
        })),
      });
    }

    console.log(`rebuilt day ${day.id} ${day.date.toISOString()} -> ${customers.length} jobs`);
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
