import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import prisma from "@/lib/db";
import { ACTIVE_TENANT_COOKIE, SUPPORT_ACCESS_COOKIE } from "@/lib/auth-cookies";

const db = prisma as any;

export async function POST() {
  const session = await auth();

  if (!session?.user?.id || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cookieStore = await cookies();
  const rawLogId = cookieStore.get(SUPPORT_ACCESS_COOKIE)?.value;
  const logId = rawLogId ? parseInt(rawLogId, 10) : NaN;

  if (!Number.isNaN(logId) && logId > 0) {
    await db.supportAccessLog.updateMany({
      where: {
        id: logId,
        superAdminUserId: session.user.id,
        endedAt: null,
      },
      data: {
        endedAt: new Date(),
        endedByUserId: session.user.id,
      },
    });
  }

  cookieStore.delete(ACTIVE_TENANT_COOKIE);
  cookieStore.delete(SUPPORT_ACCESS_COOKIE);

  return NextResponse.json({ ok: true });
}
