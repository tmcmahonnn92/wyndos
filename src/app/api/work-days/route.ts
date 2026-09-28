import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requirePerm, visibleWorkDayWhere } from "@/lib/guards";

export async function GET() {
  try {
    const actor = await requirePerm("schedule");
    const days = await prisma.workDay.findMany({
      where: { tenantId: actor.tenantId, ...visibleWorkDayWhere(actor) },
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
