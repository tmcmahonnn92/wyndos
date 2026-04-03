export type AppRole = "SUPER_ADMIN" | "OWNER" | "WORKER";
export type MembershipRole = Exclude<AppRole, "SUPER_ADMIN">;

export type CompanyMembership = {
  tenantId: number;
  tenantName: string;
  role: MembershipRole;
  permissions: string[];
};

type UserLike = {
  role?: AppRole | null;
  tenantId?: number | null;
  permissions?: string[] | null;
  memberships?: unknown;
};

function parseRawMemberships(value: unknown): unknown[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return Array.isArray(value) ? value : [];
}

export function normalizeMemberships(value: unknown): CompanyMembership[] {
  const rawMemberships = parseRawMemberships(value);
  const seen = new Set<number>();
  const memberships: CompanyMembership[] = [];

  for (const rawMembership of rawMemberships) {
    if (!rawMembership || typeof rawMembership !== "object") continue;

    const membership = rawMembership as {
      tenantId?: unknown;
      tenantName?: unknown;
      role?: unknown;
      permissions?: unknown;
    };

    const tenantId = Number(membership.tenantId);
    if (!Number.isInteger(tenantId) || tenantId <= 0 || seen.has(tenantId)) continue;

    const role = membership.role === "OWNER" ? "OWNER" : membership.role === "WORKER" ? "WORKER" : null;
    if (!role) continue;

    const permissions = Array.isArray(membership.permissions)
      ? membership.permissions.filter((entry): entry is string => typeof entry === "string")
      : [];

    memberships.push({
      tenantId,
      tenantName: typeof membership.tenantName === "string" ? membership.tenantName : "",
      role,
      permissions,
    });
    seen.add(tenantId);
  }

  memberships.sort((left, right) => {
    if (left.role !== right.role) {
      return left.role === "OWNER" ? -1 : 1;
    }
    return left.tenantName.localeCompare(right.tenantName);
  });

  return memberships;
}

export function serializeMemberships(memberships: CompanyMembership[]): string {
  return JSON.stringify(memberships);
}

export function getDefaultMembership(memberships: CompanyMembership[]): CompanyMembership | null {
  return memberships[0] ?? null;
}

export function resolveActiveMembership(user: UserLike, preferredTenantId?: number | null): CompanyMembership | null {
  if (user.role === "SUPER_ADMIN") return null;

  const memberships = normalizeMemberships(user.memberships);
  if (memberships.length > 0) {
    if (preferredTenantId) {
      const matched = memberships.find((membership) => membership.tenantId === preferredTenantId);
      if (matched) return matched;
    }
    return getDefaultMembership(memberships);
  }

  if (user.tenantId) {
    return {
      tenantId: user.tenantId,
      tenantName: "",
      role: user.role === "WORKER" ? "WORKER" : "OWNER",
      permissions: user.role === "WORKER" ? user.permissions ?? [] : [],
    };
  }

  return null;
}

export function resolveActiveRole(user: UserLike, preferredTenantId?: number | null): AppRole | undefined {
  if (user.role === "SUPER_ADMIN") return "SUPER_ADMIN";
  return resolveActiveMembership(user, preferredTenantId)?.role;
}

export function resolveActivePermissions(user: UserLike, preferredTenantId?: number | null): string[] {
  if (user.role === "SUPER_ADMIN") return [];
  const membership = resolveActiveMembership(user, preferredTenantId);
  if (!membership || membership.role !== "WORKER") return [];
  return membership.permissions;
}
