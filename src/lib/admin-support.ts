import prisma from "@/lib/db";
import { auth } from "@/auth";
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
  /** The super admin belongs to this business (e.g. it's their own). */
  mine: boolean;
  myRole: string | null;
};

export type SupportTicketSummary = {
  id: number;
  tenantName: string;
  fromName: string;
  fromEmail: string;
  copyTo: string;
  kind: string;
  section: string;
  subject: string;
  message: string;
  page: string;
  files: string;
  status: string;
  createdAt: Date;
  replies: Array<{ id: number; body: string; kind: string; createdAt: Date }>;
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
    openTicketCount: number;
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
  tickets: SupportTicketSummary[];
};

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  await requireSuperAdmin();
  const session = await auth();
  const myMemberships = await db.membership.findMany({ where: { userId: session?.user?.id ?? "" }, select: { tenantId: true, role: true } });
  const myRoleByTenant = new Map<number, string>(myMemberships.map((m: { tenantId: number; role: string }) => [m.tenantId, m.role]));

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
      take: 40,
      include: {
        tenant: { select: { name: true, slug: true } },
        superAdminUser: { select: { email: true, name: true } },
      },
    }),
    db.supportAccessLog.findMany({
      where: { endedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        tenant: { select: { name: true, slug: true } },
        superAdminUser: { select: { email: true, name: true } },
      },
    }),
    db.$queryRaw`SELECT 1`,
  ]);
  const [tickets, openTicketCount] = await Promise.all([
    db.supportTicket.findMany({
      orderBy: [{ status: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: { replies: { orderBy: { createdAt: "asc" } } },
    }),
    db.supportTicket.count({ where: { status: "OPEN" } }),
  ]);
  const tenantNames = new Map<number, string>(tenants.map((t: any) => [t.id, t.name]));

  return {
    stats: {
      tenantCount,
      userCount,
      customerCount,
      workDayCount,
      openSupportSessionCount,
      openTicketCount,
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
      mine: myRoleByTenant.has(tenant.id),
      myRole: myRoleByTenant.get(tenant.id) ?? null,
    })),
    tickets: tickets.map((t: any) => ({
      id: t.id,
      tenantName: (t.tenantId && tenantNames.get(t.tenantId)) || "",
      fromName: t.fromName,
      fromEmail: t.fromEmail,
      copyTo: t.copyTo,
      kind: t.kind,
      section: t.section,
      subject: t.subject,
      message: t.message,
      page: t.page,
      files: t.files,
      status: t.status,
      createdAt: t.createdAt,
      replies: t.replies.map((r: any) => ({ id: r.id, body: r.body, kind: r.kind, createdAt: r.createdAt })),
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
