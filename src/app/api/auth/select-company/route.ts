import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ACTIVE_TENANT_COOKIE } from "@/lib/auth-cookies";
import { normalizeMemberships } from "@/lib/memberships";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/auth/signin", request.url));
  }

  if (session.user.role === "SUPER_ADMIN") {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  const formData = await request.formData();
  const tenantId = Number.parseInt(String(formData.get("tenantId") ?? ""), 10);
  const memberships = normalizeMemberships(session.user.memberships);

  if (!Number.isInteger(tenantId) || !memberships.some((membership) => membership.tenantId === tenantId)) {
    return NextResponse.redirect(new URL("/auth/company-select", request.url));
  }

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(ACTIVE_TENANT_COOKIE, String(tenantId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}