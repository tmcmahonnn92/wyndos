import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/auth.config";
import { ACTIVE_TENANT_COOKIE, SUPPORT_ACCESS_COOKIE } from "@/lib/auth-cookies";

const { auth } = NextAuth(authConfig);
const ONBOARDING_REFRESH_COOKIE = "wyndos_onboarding_refresh";
const PUBLIC_ROUTES = new Set(["/auth/signin", "/auth/signup"]);
const PUBLIC_PREFIXES = ["/auth/invite/"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;
  const isLoggedIn = Boolean(user);
  const hasOnboardingRefreshCookie = req.cookies.get(ONBOARDING_REFRESH_COOKIE)?.value === "1";

  if (pathname.startsWith("/api/auth")) return NextResponse.next();
  if (pathname === "/api/health") return NextResponse.next();

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    if (isLoggedIn) return NextResponse.redirect(new URL("/", req.nextUrl));
    return NextResponse.next();
  }

  if (!isLoggedIn && !PUBLIC_ROUTES.has(pathname)) {
    const url = new URL("/auth/signin", req.nextUrl);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  if (isLoggedIn && PUBLIC_ROUTES.has(pathname)) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  if (isLoggedIn) {
    const role = user?.role;

    if (pathname.startsWith("/admin") && role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }

    const hasTenantCookie = Boolean(req.cookies.get(ACTIVE_TENANT_COOKIE)?.value);
    const hasSupportCookie = Boolean(req.cookies.get(SUPPORT_ACCESS_COOKIE)?.value);

    if (
      role === "SUPER_ADMIN" &&
      !pathname.startsWith("/admin") &&
      !pathname.startsWith("/api/") &&
      (!hasTenantCookie || !hasSupportCookie)
    ) {
      return NextResponse.redirect(new URL("/admin", req.nextUrl));
    }

    if (
      role !== "SUPER_ADMIN" &&
      !user?.onboardingComplete &&
      !hasOnboardingRefreshCookie &&
      pathname !== "/auth/onboarding" &&
      !pathname.startsWith("/api/")
    ) {
      return NextResponse.redirect(new URL("/auth/onboarding", req.nextUrl));
    }

    if (pathname === "/auth/onboarding" && (user?.onboardingComplete || hasOnboardingRefreshCookie)) {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
