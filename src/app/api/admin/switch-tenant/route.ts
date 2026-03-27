import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import prisma from "@/lib/db";
import { ACTIVE_TENANT_COOKIE, SUPPORT_ACCESS_COOKIE } from "@/lib/auth-cookies";

const db = prisma as any;
const SUPPORT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 2;
const MIN_REASON_LENGTH = 12;

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.id || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const tenantId = typeof body.tenantId === "number" ? body.tenantId : null;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  if (reason.length < MIN_REASON_LENGTH) {
    return NextResponse.json(
      { error: `Support reason must be at least ${MIN_REASON_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const ipAddress = forwardedFor.split(",")[0]?.trim() ?? "";
  const userAgent = req.headers.get("user-agent") ?? "";

  const cookieStore = await cookies();
  const rawPriorLogId = cookieStore.get(SUPPORT_ACCESS_COOKIE)?.value;
  const priorLogId = rawPriorLogId ? parseInt(rawPriorLogId, 10) : NaN;

  if (!Number.isNaN(priorLogId) && priorLogId > 0) {
    await db.supportAccessLog.updateMany({
      where: {
        id: priorLogId,
        superAdminUserId: session.user.id,
        endedAt: null,
      },
      data: {
        endedAt: new Date(),
        endedByUserId: session.user.id,
      },
    });
  }

  const log = await db.supportAccessLog.create({
    data: {
      tenantId,
      superAdminUserId: session.user.id,
      reason,
      ipAddress,
      userAgent,
    },
  });

  const cookieOptions = {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SUPPORT_SESSION_MAX_AGE_SECONDS,
  };

  cookieStore.set(ACTIVE_TENANT_COOKIE, String(tenantId), cookieOptions);
  cookieStore.set(SUPPORT_ACCESS_COOKIE, String(log.id), cookieOptions);

  return NextResponse.json({ ok: true, tenantId, tenantName: tenant.name, supportLogId: log.id });
}
