import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ACTIVE_TENANT_COOKIE } from "@/lib/auth-cookies";
import { normalizeMemberships } from "@/lib/memberships";

// Relative redirects: behind nginx, request.url is the internal address (localhost:3000),
// so an absolute URL built from it sends the browser to localhost. 303 turns the POST into a GET.
function go(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return go("/auth/signin");
  }

  if (session.user.role === "SUPER_ADMIN") {
    return go("/admin");
  }

  const formData = await request.formData();
  const tenantId = Number.parseInt(String(formData.get("tenantId") ?? ""), 10);
  const memberships = normalizeMemberships(session.user.memberships);

  if (!Number.isInteger(tenantId) || !memberships.some((membership) => membership.tenantId === tenantId)) {
    return go("/auth/company-select");
  }

  const response = go("/");
  response.cookies.set(ACTIVE_TENANT_COOKIE, String(tenantId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}