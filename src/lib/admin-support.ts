import prisma from "@/lib/db";
import { requireSuperAdmin } from "@/lib/tenant-context";

const db = prisma as any;

export type AdminTenantSummary = {
  id: number;
  name: string;
  slug: string;
  ownerEmail: string | null;
  createdAt: Date;
  userCount: number;
  customerCount: number;
  areaCount: number;
  workDayCount: number;
};

export type SupportAccessAuditSummary = {
  id: number;
  tenantName: string;
  tenantSlug: string;
  superAdminLabel: string;
  reason: string;
  createdAt: Date;
  endedAt: Date | null;
};

export type ActiveSupportSessionSummary = {
  id: number;
  tenantName: string;
  tenantSlug: string;
  superAdminLabel: string;
  reason: string;
  createdAt: Date;
};

export type AdminDashboardData = {
  stats: {
    tenantCount: number;
    userCount: number;
    customerCount: number;
    workDayCount: number;
    openSupportSessionCount: number;
  };
  health: {
    databaseOk: boolean;
    authUrl: string;
    appUrl: string;
    superAdminEmailConfigured: boolean;
    checkedAt: string;
  };
  tenants: AdminTenantSummary[];
  recentSupportLogs: SupportAccessAuditSummary[];
  activeSupportSessions: ActiveSupportSessionSummary[];
};

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  await requireSuperAdmin();

  const [tenantCount, userCount, customerCount, workDayCount, openSupportSessionCount, tenants, recentSupportLogs, activeSupportSessions, dbOk] = await Promise.all([
    db.tenant.count(),
    db.user.count(),
    db.customer.count(),
    db.workDay.count(),
    db.supportAccessLog.count({ where: { endedAt: null } }),
    db.tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        users: {
          where: { role: "OWNER" },
          select: { email: true },
          take: 1,
        },
        _count: {
          select: {
            users: true,
            customers: true,
            areas: true,
            workDays: true,
          },
        },
      },
    }),
    db.supportAccessLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        tenant: { select: { name: true, slug: true } },
        superAdminUser: { select: { email: true, name: true } },
      },
    }),
    db.supportAccessLog.findMany({
      where: { endedAt: null },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        tenant: { select: { name: true, slug: true } },
        superAdminUser: { select: { email: true, name: true } },
      },
    }),
    db.$queryRaw`SELECT 1`,
  ]);

  return {
    stats: {
      tenantCount,
      userCount,
      customerCount,
      workDayCount,
      openSupportSessionCount,
    },
    health: {
      databaseOk: Array.isArray(dbOk),
      authUrl: process.env.AUTH_URL ?? "",
      appUrl: process.env.APP_URL ?? "",
      superAdminEmailConfigured: Boolean((process.env.SUPER_ADMIN_EMAIL ?? "").trim()),
      checkedAt: new Date().toISOString(),
    },
    tenants: tenants.map((tenant: any) => ({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      ownerEmail: tenant.users[0]?.email ?? null,
      createdAt: tenant.createdAt,
      userCount: tenant._count.users,
      customerCount: tenant._count.customers,
      areaCount: tenant._count.areas,
      workDayCount: tenant._count.workDays,
    })),
    recentSupportLogs: recentSupportLogs.map((log: any) => ({
      id: log.id,
      tenantName: log.tenant.name,
      tenantSlug: log.tenant.slug,
      superAdminLabel: log.superAdminUser.name || log.superAdminUser.email || "Super Admin",
      reason: log.reason,
      createdAt: log.createdAt,
      endedAt: log.endedAt,
    })),
    activeSupportSessions: activeSupportSessions.map((log: any) => ({
      id: log.id,
      tenantName: log.tenant.name,
      tenantSlug: log.tenant.slug,
      superAdminLabel: log.superAdminUser.name || log.superAdminUser.email || "Super Admin",
      reason: log.reason,
      createdAt: log.createdAt,
    })),
  };
}
