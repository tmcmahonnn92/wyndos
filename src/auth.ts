import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import prisma from "@/lib/db";
import authConfig from "@/auth.config";

const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

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
 * The email address that owns the app (super-admin).
 * Set SUPER_ADMIN_EMAIL in your .env to enable universal admin access.
 */
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();

// Cast to `any` while the Prisma client regenerates in the TypeScript language server.
const db = prisma as any;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db),
  secret: getAuthSecret(),
  providers: [
    Credentials({
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const user = await db.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;

        const isValid = await compare(password, user.passwordHash);
        if (!isValid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          tenantId: user.tenantId,
          onboardingComplete: user.onboardingComplete,
        } as never;
      },
    }),
    ...(googleEnabled
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID!,
            clientSecret: process.env.AUTH_GOOGLE_SECRET!,
          }),
        ]
      : []),
  ],
  callbacks: {
    /**
     * Runs every time a JWT is created or refreshed.
     * Re-reads from the DB so role/tenant changes are reflected promptly.
     */
    async jwt({ token, user, trigger, session }) {
      if (user?.id) {
        token.sub = user.id;
      }

      if (trigger === "update" && session) {
        if (typeof session.name === "string") {
          token.name = session.name;
        }
        if (typeof session.onboardingComplete === "boolean") {
          token.onboardingComplete = session.onboardingComplete;
        }
      }

      if (token.sub) {
        const current = await db.user.findUnique({ where: { id: token.sub } });
        if (current) {
          token.name = current.name;
          token.email = current.email;
          token.picture = current.image;
          token.role = current.role;
          token.tenantId = current.tenantId;
          token.onboardingComplete = current.onboardingComplete;
          // Only persist workerPermissions for WORKER accounts
          token.workerPermissions = current.role === "WORKER" ? current.workerPermissions : "[]";
        }
      }

      return token;
    },

    /**
     * Runs on every sign-in attempt.
     * - Ensures the SUPER_ADMIN email always gets the SUPER_ADMIN role.
     * - Keeps name/image up to date from OAuth providers.
     */
    async signIn({ user }) {
      if (!user?.id) return true;

      const current = await db.user.findUnique({ where: { id: user.id } });
      if (!current) return true;

      const isSuperAdmin =
        SUPER_ADMIN_EMAIL.length > 0 &&
        typeof current.email === "string" &&
        current.email.toLowerCase() === SUPER_ADMIN_EMAIL;

      const nextRole = isSuperAdmin ? "SUPER_ADMIN" : current.role;
      const updates: Record<string, unknown> = {};

      if (current.role !== nextRole) updates.role = nextRole;
      if (!current.name && user.name) updates.name = user.name;
      if (!current.image && user.image) updates.image = user.image;

      // SUPER_ADMIN never belongs to a tenant
      if (isSuperAdmin && current.tenantId !== null) updates.tenantId = null;

      if (Object.keys(updates).length > 0) {
        await db.user.update({ where: { id: user.id }, data: updates });
      }

      return true;
    },

    /** Exposes safe JWT fields on the client-visible session. */
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.name = token.name;
        session.user.email = typeof token.email === "string" ? token.email : "";
        session.user.image = typeof token.picture === "string" ? token.picture : null;
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
});
