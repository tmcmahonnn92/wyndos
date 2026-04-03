import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ACTIVE_TENANT_COOKIE, SUPPORT_ACCESS_COOKIE } from "@/lib/auth-cookies";
import {
  normalizeMemberships,
  resolveActiveMembership,
  resolveActivePermissions,
  resolveActiveRole,
  type CompanyMembership,
} from "@/lib/memberships";

export { ACTIVE_TENANT_COOKIE, SUPPORT_ACCESS_COOKIE };

type ActiveUserContext = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  onboardingComplete?: boolean;
  memberships: CompanyMembership[];
  activeMembership: CompanyMembership | null;
  role: "SUPER_ADMIN" | "OWNER" | "WORKER";
  tenantId: number | null;
  permissions: string[];
};

function parseCookieTenantId(rawValue: string | undefined) {
  const tenantId = rawValue ? Number.parseInt(rawValue, 10) : NaN;
  return Number.isInteger(tenantId) && tenantId > 0 ? tenantId : null;
}

async function resolveUserContext(): Promise<ActiveUserContext> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("You must be signed in.");
  }

  const memberships = normalizeMemberships(session.user.memberships);

  if (session.user.role === "SUPER_ADMIN") {
    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
      onboardingComplete: session.user.onboardingComplete,
      memberships,
      activeMembership: null,
      role: "SUPER_ADMIN",
      tenantId: null,
      permissions: [],
    };
  }

  const cookieStore = await cookies();
  const preferredTenantId = parseCookieTenantId(cookieStore.get(ACTIVE_TENANT_COOKIE)?.value);
  const activeMembership = resolveActiveMembership(session.user, preferredTenantId);
  const role = resolveActiveRole(session.user, preferredTenantId);

  if (!activeMembership || !role) {
    throw new Error(
      "Your account is not linked to a tenant. Please complete onboarding or contact your administrator.",
    );
  }

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
    onboardingComplete: session.user.onboardingComplete,
    memberships,
    activeMembership,
    role,
    tenantId: activeMembership.tenantId,
    permissions: resolveActivePermissions(session.user, preferredTenantId),
  };
}

export async function getActiveUserContext() {
  return resolveUserContext();
}

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
    return;
  }

  const memberships = normalizeMemberships(session.user.memberships);
  if (memberships.length > 1) {
    const cookieStore = await cookies();
    const tenantId = parseCookieTenantId(cookieStore.get(ACTIVE_TENANT_COOKIE)?.value);
    if (!tenantId || !memberships.some((membership) => membership.tenantId === tenantId)) {
      redirect("/auth/company-select");
    }
  }
}

export async function requirePermission(permission: string): Promise<void> {
  await requireTenantSelected();

  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const cookieStore = await cookies();
  const preferredTenantId = parseCookieTenantId(cookieStore.get(ACTIVE_TENANT_COOKIE)?.value);
  const role = resolveActiveRole(session.user, preferredTenantId);
  const permissions = resolveActivePermissions(session.user, preferredTenantId);

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

  if (session.user.role === "SUPER_ADMIN") {
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

  const user = await resolveUserContext();
  if (!user.tenantId) {
    throw new Error(
      "Your account is not linked to a tenant. Please complete onboarding or contact your administrator.",
    );
  }

  return user.tenantId;
}

export async function requireAuth() {
  return resolveUserContext();
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
