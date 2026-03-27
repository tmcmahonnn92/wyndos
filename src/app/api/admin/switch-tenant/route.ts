import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import prisma from "@/lib/db";
import { ACTIVE_TENANT_COOKIE } from "@/lib/tenant-context";

const db = prisma as any;

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.id || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const tenantId = typeof body.tenantId === "number" ? body.tenantId : null;

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  // Verify the tenant exists
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  // Set a secure cookie that tells subsequent requests which tenant to query
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TENANT_COOKIE, String(tenantId), {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours
  });

  return NextResponse.json({ ok: true, tenantId, tenantName: tenant.name });
}
