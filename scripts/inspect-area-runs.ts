import { prisma } from "../src/lib/db";

const names = ["Welbeck & Norton", "Edwinstowe"];

async function main() {
  for (const name of names) {
    const areas = await prisma.area.findMany({
      where: { name: { contains: name } },
      select: {
        id: true,
        name: true,
        scheduleType: true,
        frequencyWeeks: true,
        nextDueDate: true,
        lastCompletedDate: true,
        customers: {
          where: { active: true },
          select: {
            id: true,
            name: true,
            active: true,
            frequencyWeeks: true,
            nextDueDate: true,
            lastCompletedDate: true,
          },
          orderBy: { name: "asc" },
        },
        workDays: {
          include: {
            jobs: {
              include: {
                customer: {
                  select: {
                    id: true,
                    name: true,
                    frequencyWeeks: true,
                    nextDueDate: true,
                  },
                },
              },
            },
          },
          orderBy: { date: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });

    console.log(`\n===== ${name} =====`);
    if (areas.length === 0) {
      console.log("No matching area");
      continue;
    }

    for (const area of areas) {
      console.log("\nAREA", {
        id: area.id,
        name: area.name,
        scheduleType: area.scheduleType,
        frequencyWeeks: area.frequencyWeeks,
        nextDueDate: area.nextDueDate?.toISOString() ?? null,
        lastCompletedDate: area.lastCompletedDate?.toISOString() ?? null,
        activeCustomers: area.customers.length,
      });

      const freqSummary = new Map<number, number>();
      for (const c of area.customers) {
        freqSummary.set(c.frequencyWeeks, (freqSummary.get(c.frequencyWeeks) ?? 0) + 1);
      }
      console.log("Customer frequencies", Object.fromEntries(freqSummary));

      const dueSummary = new Map<string, number>();
      for (const c of area.customers) {
        const k = c.nextDueDate?.toISOString() ?? "null";
        dueSummary.set(k, (dueSummary.get(k) ?? 0) + 1);
      }
      console.log("Customer nextDue summary", [...dueSummary.entries()].sort((a, b) => a[0].localeCompare(b[0])));

      console.log("WORKDAYS");
      for (const wd of area.workDays) {
        console.log({
          id: wd.id,
          date: wd.date.toISOString(),
          status: wd.status,
          jobs: wd.jobs.length,
          completed: wd.jobs.filter((j) => j.status === "COMPLETE").length,
          pending: wd.jobs.filter((j) => j.status === "PENDING").length,
        });
      }

      const future = area.workDays.filter((w) => w.status === "PLANNED");
      for (const wd of future) {
        console.log(`\nFuture day ${wd.date.toISOString()} jobs:`);
        for (const j of wd.jobs) {
          console.log(`- ${j.customer?.name} | freq=${j.customer?.frequencyWeeks} | nextDue=${j.customer?.nextDueDate?.toISOString() ?? "null"}`);
        }
      }
    }
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
