import { prisma } from "../src/lib/db";

function utc(s: string) {
  return new Date(`${s}T00:00:00.000Z`);
}

async function main() {
  const area = await prisma.area.findFirst({
    where: { name: { contains: "Welbeck & Norton" } },
    select: {
      id: true,
      name: true,
      frequencyWeeks: true,
      nextDueDate: true,
      lastCompletedDate: true,
    },
  });

  console.log("AREA", area);
  if (!area) return;

  const days = await prisma.workDay.findMany({
    where: {
      areaId: area.id,
      date: { gte: utc("2026-03-01"), lte: utc("2026-05-31") },
    },
    include: {
      jobs: {
        include: {
          customer: {
            select: { id: true, name: true, nextDueDate: true, frequencyWeeks: true },
          },
        },
      },
    },
    orderBy: { date: "asc" },
  });

  console.log("\nWORKDAYS");
  for (const d of days) {
    console.log(d.id, d.date.toISOString(), d.status, "jobs=", d.jobs.length);
  }

  const customers = await prisma.customer.findMany({
    where: { areaId: area.id, active: true },
    select: {
      id: true,
      name: true,
      nextDueDate: true,
      lastCompletedDate: true,
      frequencyWeeks: true,
    },
    orderBy: { name: "asc" },
  });

  console.log("\nCUSTOMERS", customers.length);
  const byDate = new Map<string, number>();
  for (const c of customers) {
    const key = c.nextDueDate ? c.nextDueDate.toISOString() : "null";
    byDate.set(key, (byDate.get(key) ?? 0) + 1);
  }
  console.log("\nNEXT DUE SUMMARY");
  console.log([...byDate.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

  const mar23 = days.find((d) => d.date.toISOString().startsWith("2026-03-23"));
  const apr20 = days.find((d) => d.date.toISOString().startsWith("2026-04-20"));

  function printDay(label: string, day: (typeof days)[number] | undefined) {
    if (!day) {
      console.log(`\n${label}: NO DAY`);
      return;
    }
    console.log(`\n${label}:`, day.id, day.date.toISOString(), "jobs", day.jobs.length);
    for (const j of day.jobs) {
      console.log(
        `${j.customer?.name} | status=${j.status} | custNextDue=${j.customer?.nextDueDate?.toISOString() ?? "null"} | freq=${j.customer?.frequencyWeeks}`
      );
    }
  }

  printDay("MAR23", mar23);
  printDay("APR20", apr20);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
