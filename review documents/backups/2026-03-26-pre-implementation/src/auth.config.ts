import type { NextAuthConfig } from "next-auth";

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
  },
  // Fallback secret so the edge middleware can verify JWTs even without AUTH_SECRET in env.
  secret: process.env.AUTH_SECRET ?? "dev-secret-change-me",
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
