import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import prisma from "@/lib/db";
import { ACTIVE_TENANT_COOKIE, SUPPORT_ACCESS_COOKIE } from "@/lib/auth-cookies";

/** Super admin opens a business they belong to (their own), as themselves: no support session. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const tenantId = typeof body.tenantId === "number" ? body.tenantId : null;
  if (!tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: session.user.id, tenantId } },
    select: { id: true },
  });
  if (!membership) return NextResponse.json({ error: "You're not a member of that business." }, { status: 403 });

  const cookieStore = await cookies();
  // Close any support session still open from this browser.
  const rawLogId = cookieStore.get(SUPPORT_ACCESS_COOKIE)?.value;
  const logId = rawLogId ? parseInt(rawLogId, 10) : NaN;
  if (!Number.isNaN(logId) && logId > 0) {
    await prisma.supportAccessLog.updateMany({
      where: { id: logId, superAdminUserId: session.user.id, endedAt: null },
      data: { endedAt: new Date(), endedByUserId: session.user.id },
    });
  }
  cookieStore.delete(SUPPORT_ACCESS_COOKIE);
  cookieStore.set(ACTIVE_TENANT_COOKIE, String(tenantId), {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
  });
  return NextResponse.json({ ok: true });
}
