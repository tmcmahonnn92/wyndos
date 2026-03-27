import { prisma } from "../src/lib/db";

function addUtcWeeks(date: Date, weeks: number) {
  const base = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return new Date(base.getTime() + weeks * 7 * 86_400_000);
}

async function main() {
  const customers = await prisma.customer.findMany({
    select: {
      id: true,
      name: true,
      frequencyWeeks: true,
      nextDueDate: true,
      lastCompletedDate: true,
      areaId: true,
      area: { select: { name: true, frequencyWeeks: true } },
    },
    orderBy: [{ areaId: "asc" }, { name: "asc" }],
  });

  const mismatches = customers.filter(
    (customer) => customer.area && (
      customer.frequencyWeeks !== customer.area.frequencyWeeks ||
      (customer.lastCompletedDate && customer.nextDueDate &&
        customer.nextDueDate.getTime() !== addUtcWeeks(customer.lastCompletedDate, customer.area.frequencyWeeks).getTime())
    )
  );

  console.log(`Customers with mismatched frequency: ${mismatches.length}`);

  for (const customer of mismatches) {
    if (!customer.area) continue;
    const nextDueDate = customer.lastCompletedDate
      ? addUtcWeeks(customer.lastCompletedDate, customer.area.frequencyWeeks)
      : customer.nextDueDate;

    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        frequencyWeeks: customer.area.frequencyWeeks,
        nextDueDate,
      },
    });
    console.log(
      `fixed ${customer.id}: ${customer.name} (${customer.area.name}) ${customer.frequencyWeeks}w -> ${customer.area.frequencyWeeks}w; nextDue=${nextDueDate?.toISOString() ?? "null"}`
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
