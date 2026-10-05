import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/auth.config";
import { ACTIVE_TENANT_COOKIE, SUPPORT_ACCESS_COOKIE } from "@/lib/auth-cookies";
import { normalizeMemberships, resolveActiveMembership } from "@/lib/memberships";

const { auth } = NextAuth(authConfig);
const ONBOARDING_REFRESH_COOKIE = "wyndos_onboarding_refresh";
const PUBLIC_ROUTES = new Set(["/auth/signin", "/auth/signup", "/home"]);
/** Legal pages: open to everyone, signed in or not. */
const LEGAL_ROUTES = new Set(["/privacy", "/terms", "/cookies", "/guide"]);
const PUBLIC_PREFIXES = ["/auth/invite/", "/auth/verify-email", "/screens/"];

function parseTenantId(rawValue: string | undefined) {
  const tenantId = rawValue ? Number.parseInt(rawValue, 10) : NaN;
  return Number.isInteger(tenantId) && tenantId > 0 ? tenantId : null;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;
  const isLoggedIn = Boolean(user);
  const hasOnboardingRefreshCookie = req.cookies.get(ONBOARDING_REFRESH_COOKIE)?.value === "1";

  if (pathname.startsWith("/api/auth")) return NextResponse.next();
  if (pathname === "/api/health") return NextResponse.next();
  // Stripe calls this; it checks Stripe's signature itself.
  if (pathname === "/api/stripe/webhook") return NextResponse.next();
  // Cron endpoints check their own CRON_SECRET bearer token.
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();

  if (LEGAL_ROUTES.has(pathname)) {
    const headers = new Headers(req.headers);
    headers.set("x-wyndos-path", pathname);
    return NextResponse.next({ request: { headers } });
  }

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  if (!isLoggedIn && !PUBLIC_ROUTES.has(pathname)) {
    const url = new URL("/auth/signin", req.nextUrl);
    url.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (isLoggedIn && PUBLIC_ROUTES.has(pathname)) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  if (isLoggedIn) {
    const role = user?.role;
    const memberships = normalizeMemberships(user?.memberships);
    const selectedTenantId = parseTenantId(req.cookies.get(ACTIVE_TENANT_COOKIE)?.value);
    const activeMembership = resolveActiveMembership(user ?? {}, selectedTenantId);
    const activeRole = role === "SUPER_ADMIN" ? "SUPER_ADMIN" : activeMembership?.role;

    if (pathname.startsWith("/admin") && role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }

    const hasTenantCookie = Boolean(req.cookies.get(ACTIVE_TENANT_COOKIE)?.value);
    const hasSupportCookie = Boolean(req.cookies.get(SUPPORT_ACCESS_COOKIE)?.value);

    // A super admin may use a business they belong to (their own) without a support session.
    const ownBusiness = role === "SUPER_ADMIN" && selectedTenantId !== null && memberships.some((m) => m.tenantId === selectedTenantId);
    if (
      role === "SUPER_ADMIN" &&
      !ownBusiness &&
      !pathname.startsWith("/admin") &&
      !pathname.startsWith("/api/") &&
      (!hasTenantCookie || !hasSupportCookie)
    ) {
      return NextResponse.redirect(new URL("/admin", req.nextUrl));
    }

    if (role !== "SUPER_ADMIN") {
      if (memberships.length > 1 && pathname !== "/auth/company-select" && !pathname.startsWith("/api/")) {
        if (!selectedTenantId || !memberships.some((membership) => membership.tenantId === selectedTenantId)) {
          return NextResponse.redirect(new URL("/auth/company-select", req.nextUrl));
        }
      }

      if (pathname === "/auth/company-select" && memberships.length <= 1) {
        return NextResponse.redirect(new URL("/", req.nextUrl));
      }
    }

    if (
      activeRole === "OWNER" &&
      role !== "SUPER_ADMIN" &&
      !user?.onboardingComplete &&
      !hasOnboardingRefreshCookie &&
      pathname !== "/auth/onboarding" &&
      pathname !== "/auth/company-select" &&
      !pathname.startsWith("/api/")
    ) {
      return NextResponse.redirect(new URL("/auth/onboarding", req.nextUrl));
    }

    if (
      pathname === "/auth/onboarding" &&
      (activeRole !== "OWNER" || user?.onboardingComplete || hasOnboardingRefreshCookie)
    ) {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }
  }

  // Lets the layout know which page it's drawing (for the billing lock screen).
  const headers = new Headers(req.headers);
  headers.set("x-wyndos-path", pathname);
  return NextResponse.next({ request: { headers } });
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw\\.js|offline\\.html|manifest\\.json|icons/).*)"],
};
