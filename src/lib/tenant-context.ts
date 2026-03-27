import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ACTIVE_TENANT_COOKIE, SUPPORT_ACCESS_COOKIE } from "@/lib/auth-cookies";

export { ACTIVE_TENANT_COOKIE, SUPPORT_ACCESS_COOKIE };

export async function requireTenantSelected(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  if (session.user.role === "SUPER_ADMIN") {
    const cookieStore = await cookies();
    const tenantId = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
    const supportId = cookieStore.get(SUPPORT_ACCESS_COOKIE)?.value;
    if (!tenantId || !supportId) {
      redirect("/admin");
    }
  }
}

export async function requirePermission(permission: string): Promise<void> {
  await requireTenantSelected();

  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const { role, permissions } = session.user;

  if (role === "SUPER_ADMIN" || role === "OWNER") return;

  if (!(permissions ?? []).includes(permission)) {
    redirect("/");
  }
}

export async function getActiveTenantId(): Promise<number> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error("You must be signed in to perform this action.");
  }

  const { role, tenantId } = session.user;

  if (role === "SUPER_ADMIN") {
    const cookieStore = await cookies();
    const rawTenant = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
    const rawSupport = cookieStore.get(SUPPORT_ACCESS_COOKIE)?.value;
    const id = rawTenant ? parseInt(rawTenant, 10) : NaN;
    const supportId = rawSupport ? parseInt(rawSupport, 10) : NaN;

    if (!id || Number.isNaN(id) || !supportId || Number.isNaN(supportId)) {
      throw new Error(
        "No audited support session is active. Open tenant access from the admin console first.",
      );
    }

    return id;
  }

  if (!tenantId) {
    throw new Error(
      "Your account is not linked to a tenant. Please complete onboarding or contact your administrator.",
    );
  }

  return tenantId;
}

export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("You must be signed in.");
  }
  return session.user;
}

export async function requireSuperAdmin() {
  const user = await requireAuth();
  if (user.role !== "SUPER_ADMIN") {
    throw new Error("Access denied. This area is restricted to super admins.");
  }
  return user;
}

export async function requireOwnerOrAdmin() {
  const user = await requireAuth();
  if (user.role !== "OWNER" && user.role !== "SUPER_ADMIN") {
    throw new Error("Access denied. Only account owners can perform this action.");
  }
  return user;
}
