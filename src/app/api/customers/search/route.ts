import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getActiveTenantId } from "@/lib/tenant-context";

export async function GET(req: NextRequest) {
  try {
    const tenantId = await getActiveTenantId();
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const areaIdParam = req.nextUrl.searchParams.get("areaId");
    const workDayIdParam = req.nextUrl.searchParams.get("workDayId");

    // Return customers already on a specific work day
    if (workDayIdParam) {
      const workDayId = parseInt(workDayIdParam, 10);
      if (!isNaN(workDayId)) {
        const workDay = await prisma.workDay.findFirst({
          where: { id: workDayId, tenantId },
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
        return NextResponse.json(jobs.map((j) => ({ ...j.customer, price: j.price })));
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
        return NextResponse.json(customers);
      }
    }

    const customers = await prisma.customer.findMany({
      where: {
        tenantId,
        active: true,
        OR: [
          { name: { contains: q } },
          { address: { contains: q } },
        ],
      },
      include: { area: true },
      orderBy: [{ area: { sortOrder: "asc" } }, { name: "asc" }],
      take: 20,
    });

    return NextResponse.json(customers);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}
