import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requirePerm, visibleWorkDayWhere } from "@/lib/guards";

export async function GET() {
  try {
    const actor = await requirePerm("schedule");
    // Recent and coming days (saved on the phone for no signal): yesterday to two weeks ahead,
    // not just the latest 60 (a round booked months ahead would push out the next fortnight).
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const to = new Date(from.getTime() + 16 * 86_400_000);
    const days = await prisma.workDay.findMany({
      where: { tenantId: actor.tenantId, ...visibleWorkDayWhere(actor), date: { gte: from, lt: to } },
      select: {
        id: true,
        date: true,
        status: true,
        area: { select: { name: true } },
        _count: { select: { jobs: true } },
      },
      orderBy: { date: "asc" },
      take: 120,
    });
    return NextResponse.json(days);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}
