/**
 * Tenant context utilities.
 *
 * Every piece of business data (customers, areas, jobs, etc.) belongs to a
 * Tenant.  Call `getActiveTenantId()` at the top of any server action or API
 * route that touches that data.
 *
 * - OWNER / WORKER  → tenantId comes from their session.
 * - SUPER_ADMIN     → tenantId comes from the "wyndos_active_tenant" cookie
 *                     set when they select a tenant on the admin dashboard.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** Cookie name used to store the SUPER_ADMIN's currently-selected tenant. */
export const ACTIVE_TENANT_COOKIE = "wyndos_active_tenant";

/**
 * Call at the top of any page (server component) that loads tenant data.
 * If the current user is SUPER_ADMIN and hasn't selected a tenant yet,
 * they are hard-redirected to /admin to choose one first.
 * No-op for OWNER / WORKER — their tenant is always set from the session.
 */
export async function requireTenantSelected(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  if (session.user.role === "SUPER_ADMIN") {
    const cookieStore = await cookies();
    if (!cookieStore.get(ACTIVE_TENANT_COOKIE)?.value) {
      redirect("/admin");
    }
  }
}

/**
 * Guard for pages that require a specific permission.
 *
 * - SUPER_ADMIN: passes (as long as a tenant is selected)
 * - OWNER: always passes
 * - WORKER: must have the named permission in their workerPermissions array
 *
 * Redirects to "/" if the worker lacks the permission.
 * Call this instead of requireTenantSelected() on all data pages.
 */
export async function requirePermission(permission: string): Promise<void> {
  // Ensure SUPER_ADMIN has selected a tenant before proceeding
  await requireTenantSelected();

  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const { role, permissions } = session.user;

  // SUPER_ADMIN and OWNER have unconditional access once a tenant is selected
  if (role === "SUPER_ADMIN" || role === "OWNER") return;

  // WORKER: check specific permission
  if (!(permissions ?? []).includes(permission)) {
    redirect("/");
  }
}

/**
 * Returns the active tenant ID for the current request.
 * Throws a descriptive error if auth is missing or no tenant is selected.
 */
export async function getActiveTenantId(): Promise<number> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error("You must be signed in to perform this action.");
  }

  const { role, tenantId } = session.user;

  if (role === "SUPER_ADMIN") {
    const cookieStore = await cookies();
    const raw = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
    const id = raw ? parseInt(raw, 10) : NaN;

    if (!id || isNaN(id)) {
      throw new Error(
        "No tenant selected. Please choose a tenant from the admin dashboard before proceeding."
      );
    }

    return id;
  }

  if (!tenantId) {
    throw new Error(
      "Your account is not linked to a tenant. Please complete onboarding or contact your administrator."
    );
  }

  return tenantId;
}

/**
 * Returns the session user's role, or throws if unauthenticated.
 */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("You must be signed in.");
  }
  return session.user;
}

/**
 * Returns the session user only if they are SUPER_ADMIN.
 * Throws for any other role.
 */
export async function requireSuperAdmin() {
  const user = await requireAuth();
  if (user.role !== "SUPER_ADMIN") {
    throw new Error("Access denied. This area is restricted to super admins.");
  }
  return user;
}

/**
 * Returns the session user only if they are OWNER or SUPER_ADMIN.
 */
export async function requireOwnerOrAdmin() {
  const user = await requireAuth();
  if (user.role !== "OWNER" && user.role !== "SUPER_ADMIN") {
    throw new Error("Access denied. Only account owners can perform this action.");
  }
  return user;
}
