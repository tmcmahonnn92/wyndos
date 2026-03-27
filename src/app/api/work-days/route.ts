import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getActiveTenantId } from "@/lib/tenant-context";

export async function GET() {
  try {
    const tenantId = await getActiveTenantId();
    const days = await prisma.workDay.findMany({
      where: { tenantId },
      select: {
        id: true,
        date: true,
        status: true,
        area: { select: { name: true } },
        _count: { select: { jobs: true } },
      },
      orderBy: { date: "desc" },
      take: 60,
    });
    return NextResponse.json(days);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}
