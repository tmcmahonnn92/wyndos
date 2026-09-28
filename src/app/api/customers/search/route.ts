import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requirePerm, hasPermission, visibleWorkDayWhere, type Actor } from "@/lib/guards";
import { matchesLooseCustomerSearch } from "@/lib/customer-search";

/** Workers without the Customers permission get only what they need on the round. */
function shapeCustomer<T extends Record<string, unknown>>(actor: Actor, customer: T) {
  if (hasPermission(actor, "customers")) {
    return hasPermission(actor, "viewprices") ? customer : { ...customer, price: null };
  }
  const { id, name, address, areaId, area, notes, jobName, slip } = customer as Record<string, unknown>;
  return {
    id, name, address, areaId, area, notes, jobName, slip,
    price: hasPermission(actor, "viewprices") ? customer.price : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requirePerm("schedule");
    const tenantId = actor.tenantId;
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const areaIdParam = req.nextUrl.searchParams.get("areaId");
    const workDayIdParam = req.nextUrl.searchParams.get("workDayId");

    // Return customers already on a specific work day
    if (workDayIdParam) {
      const workDayId = parseInt(workDayIdParam, 10);
      if (!isNaN(workDayId)) {
        const workDay = await prisma.workDay.findFirst({
          where: { id: workDayId, tenantId, ...visibleWorkDayWhere(actor) },
          select: { id: true },
        });
        if (!workDay) {
          return NextResponse.json({ error: "Work day not found" }, { status: 404 });
        }

        const jobs = await prisma.job.findMany({
          where: { workDayId, tenantId },
          include: { customer: true },
          orderBy: { customer: { name: "asc" } },
        });
        return NextResponse.json(jobs.map((j) => shapeCustomer(actor, { ...j.customer, price: j.price })));
      }
    }

    // If areaId is provided, return all active customers in that area
    if (areaIdParam) {
      const areaId = parseInt(areaIdParam, 10);
      if (!isNaN(areaId)) {
        const area = await prisma.area.findFirst({
          where: { id: areaId, tenantId },
          select: { id: true },
        });
        if (!area) {
          return NextResponse.json({ error: "Area not found" }, { status: 404 });
        }

        const customers = await prisma.customer.findMany({
          where: { tenantId, active: true, areaId },
          orderBy: { name: "asc" },
          take: 100,
        });
        return NextResponse.json(customers.map((customer) => shapeCustomer(actor, customer)));
      }
    }

    const customers = await prisma.customer.findMany({
      where: {
        tenantId,
        active: true,
      },
      include: { area: true },
      orderBy: [{ area: { sortOrder: "asc" } }, { name: "asc" }],
    });

    const matchedCustomers = customers
      .filter((customer) => matchesLooseCustomerSearch(
        q,
        hasPermission(actor, "customers")
          ? [customer.name, customer.address, customer.email, customer.phone]
          : [customer.name, customer.address],
      ))
      .slice(0, 20);

    return NextResponse.json(matchedCustomers.map((customer) => shapeCustomer(actor, customer)));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 403 }
    );
  }
}
