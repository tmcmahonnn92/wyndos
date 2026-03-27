import { prisma } from "../src/lib/db";

async function main() {
  const [workDayCount, jobCount, holidayCount] = await Promise.all([
    prisma.workDay.count(),
    prisma.job.count(),
    prisma.holiday.count(),
  ]);

  console.log("Resetting scheduler data...");
  console.log({ workDayCount, jobCount, holidayCount });

  await prisma.$transaction(async (tx) => {
    await tx.payment.updateMany({
      where: { jobId: { not: null } },
      data: { jobId: null },
    });

    await tx.job.deleteMany({});
    await tx.workDay.deleteMany({});
    await tx.holiday.deleteMany({});

    await tx.area.updateMany({
      data: {
        nextDueDate: null,
        lastCompletedDate: null,
      },
    });

    await tx.customer.updateMany({
      data: {
        nextDueDate: null,
        lastCompletedDate: null,
      },
    });
  });

  const [remainingDays, remainingJobs, remainingHolidays, scheduledAreas, scheduledCustomers] = await Promise.all([
    prisma.workDay.count(),
    prisma.job.count(),
    prisma.holiday.count(),
    prisma.area.count({ where: { OR: [{ nextDueDate: { not: null } }, { lastCompletedDate: { not: null } }] } }),
    prisma.customer.count({ where: { OR: [{ nextDueDate: { not: null } }, { lastCompletedDate: { not: null } }] } }),
  ]);

  console.log("Scheduler reset complete.");
  console.log({
    remainingDays,
    remainingJobs,
    remainingHolidays,
    scheduledAreas,
    scheduledCustomers,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
