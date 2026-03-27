import { prisma } from "../src/lib/db";

function londonDateParts(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day") };
}

async function main() {
  const customers = await prisma.customer.findMany({
    where: { nextDueDate: { not: null } },
    select: { id: true, name: true, nextDueDate: true },
  });

  const broken = customers.filter(
    (c) => c.nextDueDate && new Date(c.nextDueDate).getUTCHours() !== 0
  );

  console.log(`Repairing customer nextDueDate rows: ${broken.length}`);

  for (const customer of broken) {
    const { y, m, d } = londonDateParts(customer.nextDueDate as Date);
    const fixed = new Date(`${y}-${m}-${d}T00:00:00.000Z`);

    await prisma.customer.update({
      where: { id: customer.id },
      data: { nextDueDate: fixed },
    });

    console.log(`fixed ${customer.id}: ${customer.name} -> ${fixed.toISOString()}`);
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
