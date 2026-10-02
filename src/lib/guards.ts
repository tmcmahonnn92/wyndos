import prisma from "@/lib/db";
import { auth } from "@/auth";
import { getActiveTenantId } from "@/lib/tenant-context";
import { parsePermissions, type Permission } from "@/lib/permissions";

/**
 * Server-side authorisation for server actions.
 *
 * Server actions are public POST endpoints: hiding a page or a button does not
 * stop a signed-in worker from calling them. Every exported action must start
 * with one of the guards below.
 *
 * Role and permissions are read from the database on every call (not from the
 * JWT), so removing a worker or changing their permissions takes effect
 * immediately even with long-lived sessions.
 */

export type Actor = {
  userId: string;
  tenantId: number;
  role: "OWNER" | "WORKER" | "SUPER_ADMIN";
  permissions: Permission[];
  isWorker: boolean;
};

export class AccessDeniedError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export async function getActor(): Promise<Actor> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new AccessDeniedError("You must be signed in to perform this action.");

  const tenantId = await getActiveTenantId();

  if (session.user.role === "SUPER_ADMIN") {
    // Their own business: act exactly as their membership there.
    const own = await prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: { role: true, permissions: true },
    });
    if (own) {
      const ownRole = own.role === "OWNER" ? "OWNER" : "WORKER";
      return { userId, tenantId, role: ownRole, permissions: ownRole === "WORKER" ? parsePermissions(own.permissions) : [], isWorker: ownRole === "WORKER" };
    }
    // Anyone else's business: getActiveTenantId already required an audited support session.
    return { userId, tenantId, role: "SUPER_ADMIN", permissions: [], isWorker: false };
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { role: true, permissions: true },
  });
  if (!membership) throw new AccessDeniedError("You are no longer a member of this business.");

  const role = membership.role === "OWNER" ? "OWNER" : "WORKER";
  return {
    userId,
    tenantId,
    role,
    permissions: role === "WORKER" ? parsePermissions(membership.permissions) : [],
    isWorker: role === "WORKER",
  };
}

export function hasPermission(actor: Actor, permission: Permission) {
  return !actor.isWorker || actor.permissions.includes(permission);
}

/** Any member of the business (owner or worker). */
export async function requireMember(): Promise<Actor> {
  return getActor();
}

/** Owner (or audited super-admin support session) only. */
export async function requireOwner(): Promise<Actor> {
  const actor = await getActor();
  if (actor.isWorker) throw new AccessDeniedError("Only the account owner can do that.");
  return actor;
}

/** Owner, or a worker who has been granted `permission`. */
export async function requirePerm(permission: Permission): Promise<Actor> {
  const actor = await getActor();
  if (!hasPermission(actor, permission)) throw new AccessDeniedError();
  return actor;
}

/**
 * Prisma `where` fragment for the jobs a worker may see / act on:
 * jobs assigned to them, jobs on a day assigned to them that are not assigned
 * to someone else, and jobs they completed. Owners see everything.
 */
export function visibleJobWhere(actor: Actor) {
  if (!actor.isWorker) return {};
  return {
    OR: [
      { assignedUserId: actor.userId },
      { assignedUserId: null, workDay: { assignedUserId: actor.userId } },
      { completedByUserId: actor.userId },
    ],
  };
}

/** Work days a worker may open: any day holding at least one of their jobs. */
export function visibleWorkDayWhere(actor: Actor) {
  if (!actor.isWorker) return {};
  return {
    OR: [
      { assignedUserId: actor.userId },
      { jobs: { some: visibleJobWhere(actor) } },
    ],
  };
}

/** Throws unless the job exists in the tenant and the actor may act on it. */
export async function requireVisibleJob(actor: Actor, jobId: number) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, tenantId: actor.tenantId, ...visibleJobWhere(actor) },
  });
  if (!job) throw new Error("Job not found");
  return job;
}

/** Throws unless the work day exists in the tenant and the actor may open it. */
export async function requireVisibleWorkDay(actor: Actor, workDayId: number) {
  const workDay = await prisma.workDay.findFirst({
    where: { id: workDayId, tenantId: actor.tenantId, ...visibleWorkDayWhere(actor) },
  });
  if (!workDay) throw new Error("Work day not found");
  return workDay;
}

/** Effective worker of a job: its own assignment, else the day's. Null = owner. */
export function effectiveWorkerId(job: { assignedUserId: string | null }, workDay: { assignedUserId: string | null }) {
  return job.assignedUserId ?? workDay.assignedUserId ?? null;
}
