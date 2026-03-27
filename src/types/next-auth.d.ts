import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      /**
       * SUPER_ADMIN — the app owner (you). No tenant, can view any tenant.
       * OWNER        — a window cleaner who signed up. Has their own tenant.
       * WORKER       — an employee invited by an OWNER to access their round.
       */
      role?: "SUPER_ADMIN" | "OWNER" | "WORKER";
      /** Null for SUPER_ADMIN; set for OWNER and WORKER. */
      tenantId?: number | null;
      onboardingComplete?: boolean;
      /**
       * For WORKER accounts: the list of permissions granted by the OWNER.
       * OWNER and SUPER_ADMIN always have full access (this will be []).
       * See src/lib/permissions.ts for the Permission type.
       */
      permissions?: string[];
    };
  }

  interface User {
    role?: "SUPER_ADMIN" | "OWNER" | "WORKER";
    tenantId?: number | null;
    onboardingComplete?: boolean;
    permissions?: string[];
  }
}
