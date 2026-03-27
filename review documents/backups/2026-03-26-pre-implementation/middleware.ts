import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);

/** Routes anyone (signed-in or not) can always visit. */
const PUBLIC_ROUTES = new Set(["/auth/signin", "/auth/signup"]);

/**
 * Pattern for routes that are publicly accessible by token (invite links).
 * These are allowed through without auth so the page can validate the token.
 */
const PUBLIC_PREFIXES = ["/auth/invite/"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;
  const isLoggedIn = Boolean(user);

  // 1. Always allow NextAuth API routes
  if (pathname.startsWith("/api/auth")) return NextResponse.next();

  // 2. Allow public prefix routes (invite links) unconditionally
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    // Redirect already-signed-in users back to home (they don't need to accept)
    if (isLoggedIn) return NextResponse.redirect(new URL("/", req.nextUrl));
    return NextResponse.next();
  }

  // 3. Unauthenticated users can only visit public routes
  if (!isLoggedIn && !PUBLIC_ROUTES.has(pathname)) {
    const url = new URL("/auth/signin", req.nextUrl);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  // 4. Signed-in users visiting sign-in/sign-up are sent home
  if (isLoggedIn && PUBLIC_ROUTES.has(pathname)) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  if (isLoggedIn) {
    const role = user?.role;

    // 5. Non-super-admins cannot access /admin
    if (pathname.startsWith("/admin") && role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }

    // 5b. SUPER_ADMIN with no tenant selected must pick one from /admin first
    if (
      role === "SUPER_ADMIN" &&
      !pathname.startsWith("/admin") &&
      !pathname.startsWith("/api/") &&
      !req.cookies.get("wyndos_active_tenant")?.value
    ) {
      return NextResponse.redirect(new URL("/admin", req.nextUrl));
    }

    // 6. OWNER/WORKER who haven't completed onboarding must finish it first
    if (
      role !== "SUPER_ADMIN" &&
      !user?.onboardingComplete &&
      pathname !== "/auth/onboarding" &&
      !pathname.startsWith("/api/")
    ) {
      return NextResponse.redirect(new URL("/auth/onboarding", req.nextUrl));
    }

    // 7. Once onboarding is complete, block revisiting the onboarding page
    if (pathname === "/auth/onboarding" && user?.onboardingComplete) {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
