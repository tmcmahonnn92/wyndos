import type { NextAuthConfig } from "next-auth";
import { normalizeMemberships } from "@/lib/memberships";

function getAuthSecret() {
  if (process.env.AUTH_SECRET) {
    return process.env.AUTH_SECRET;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set in production.");
  }

  return "dev-secret-change-me";
}

/**
 * Edge-safe NextAuth config — no Node.js-only imports (Prisma, bcrypt).
 * Used exclusively by middleware. Full provider/callback config is in auth.ts.
 */
const authConfig = {
  providers: [],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/signin",
  },
  session: {
    strategy: "jwt",
    // 30 days, refreshed while in use: cleaners open the app on a doorstep and must
    // not be asked for a password every morning. Access is re-checked against the
    // database on every server action (src/lib/guards.ts), so removing a worker
    // takes effect immediately.
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  secret: getAuthSecret(),
  callbacks: {
    /**
     * Edge-safe session callback — only reads fields already stored in the JWT.
     * No Prisma or bcrypt imports, so this is safe for the edge runtime.
     * This is what makes req.auth?.user?.role available in middleware.
     */
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = typeof token.role === "string"
          ? (token.role as "SUPER_ADMIN" | "OWNER" | "WORKER")
          : undefined;
        session.user.tenantId = typeof token.tenantId === "number" ? token.tenantId : null;
        session.user.onboardingComplete = Boolean(token.onboardingComplete);
        session.user.memberships = normalizeMemberships(token.memberships);
        try {
          session.user.permissions = JSON.parse(
            typeof token.workerPermissions === "string" ? token.workerPermissions : "[]"
          );
        } catch {
          session.user.permissions = [];
        }
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
