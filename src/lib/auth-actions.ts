"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { hash, compare } from "bcryptjs";
import { addDays } from "date-fns";
import nodemailer from "nodemailer";
import prisma from "@/lib/db";
import { auth } from "@/auth";
import { requireOwnerOrAdmin, requireSuperAdmin } from "@/lib/tenant-context";
import {
  type Permission,
  DEFAULT_WORKER_PERMISSIONS,
  serializePermissions,
  parsePermissions,
} from "@/lib/permissions";

const db = prisma as any;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Convert a company name to a URL-safe slug (e.g. "Dave's Cleans" ? "daves-cleans"). */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Ensure a slug is unique by appending a numeric suffix if needed. */
async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let suffix = 2;
  while (await db.tenant.findUnique({ where: { slug } })) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}

function createPasswordResetToken() {
  return randomBytes(32).toString("hex");
}

function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// -----------------------------------------------------------------------------
// Owner registration — creates Tenant + User + system area + TenantSettings
// -----------------------------------------------------------------------------

export type RegisterOwnerInput = {
  name: string;           // person's full name
  companyName: string;    // trading name ? becomes Tenant.name
  email: string;
  password: string;
};

export type RegisterOwnerResult =
  | { ok: true; userId: string; tenantId: number }
  | { ok: false; error: string };

export async function registerOwner(input: RegisterOwnerInput): Promise<RegisterOwnerResult> {
  try {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    const companyName = input.companyName.trim();

    if (!name || !email || !input.password || !companyName) {
      return { ok: false, error: "All fields are required." };
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return { ok: false, error: "An account with this email already exists." };

    const passwordHash = await hash(input.password, 12);
    const slug = await uniqueSlug(toSlug(companyName));

    const result = await db.$transaction(async (tx: any) => {
      // 1. Create the Tenant
      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          slug,
        },
      });

      // 2. Create the OWNER user, linked to the new Tenant
      const user = await tx.user.create({
        data: {
          name,
          email,
          passwordHash,
          role: "OWNER",
          tenantId: tenant.id,
          onboardingComplete: false,
        },
      });

      // 3. Bootstrap TenantSettings with the company name
      await tx.tenantSettings.create({
        data: {
          tenantId: tenant.id,
          businessName: companyName,
          ownerName: name,
        },
      });

      // 4. Create a system area for one-off jobs
      await tx.area.create({
        data: {
          tenantId: tenant.id,
          name: "One-Off Jobs",
          color: "#9CA3AF",
          sortOrder: 9999,
          isSystemArea: true,
        },
      });

      return { userId: user.id, tenantId: tenant.id };
    });

    return { ok: true, ...result };
  } catch (err) {
    console.error("[registerOwner]", err);
    return { ok: false, error: "Registration failed. Please try again." };
  }
}

// -----------------------------------------------------------------------------
// Owner onboarding — save company details after first sign-in
// -----------------------------------------------------------------------------

export type OnboardingInput = {
  companyName: string;
  ownerName: string;
  phone: string;
  address: string;
  website: string;
};

export type OnboardingResult = { ok: true } | { ok: false; error: string };

const ONBOARDING_REFRESH_COOKIE = "wyndos_onboarding_refresh";

export async function completeOwnerOnboarding(input: OnboardingInput): Promise<OnboardingResult> {
  try {
    const user = await requireOwnerOrAdmin();
    const tenantId = user.tenantId;
    if (!tenantId) return { ok: false, error: "No tenant found for your account." };

    await db.$transaction(async (tx: any) => {
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          name: input.companyName.trim(),
          phone: input.phone.trim(),
          address: input.address.trim(),
          website: input.website.trim(),
          slug: await uniqueSlug(toSlug(input.companyName.trim())),
        },
      });

      await tx.tenantSettings.upsert({
        where: { tenantId },
        update: {
          businessName: input.companyName.trim(),
          ownerName: input.ownerName.trim(),
        },
        create: {
          tenantId,
          businessName: input.companyName.trim(),
          ownerName: input.ownerName.trim(),
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { onboardingComplete: true },
      });
    });

    const cookieStore = await cookies();
    cookieStore.set(ONBOARDING_REFRESH_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60,
    });

    return { ok: true };
  } catch (err: any) {
    console.error("[completeOwnerOnboarding]", err);
    return { ok: false, error: err.message ?? "Onboarding failed." };
  }
}

// -----------------------------------------------------------------------------
// Invite system — OWNER ? WORKER
// -----------------------------------------------------------------------------

export type CreateInviteResult =
  | { ok: true; token: string; link: string }
  | { ok: false; error: string };

/**
 * OWNER creates a worker invite.
 * Returns the invite link to share with the worker.
 */
export async function createInvite(
  email: string,
  permissions: Permission[] = DEFAULT_WORKER_PERMISSIONS
): Promise<CreateInviteResult> {
  try {
    const user = await requireOwnerOrAdmin();
    const tenantId = user.tenantId;
    if (!tenantId) return { ok: false, error: "No tenant associated with your account." };

    const normEmail = email.trim().toLowerCase();
    if (!normEmail) return { ok: false, error: "A valid email address is required." };

    // Check the person isn't already a user in this tenant
    const alreadyUser = await db.user.findFirst({
      where: { email: normEmail, tenantId },
    });
    if (alreadyUser) return { ok: false, error: "This person already has an account in your round." };

    // Expire any existing pending invite for this email+tenant
    await db.invite.deleteMany({
      where: { email: normEmail, tenantId, acceptedAt: null },
    });

    const invite = await db.invite.create({
      data: {
        email: normEmail,
        role: "WORKER",
        tenantId,
        permissions: serializePermissions(permissions),
        expiresAt: addDays(new Date(), 7),
      },
    });

    const baseUrl = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
    const link = `${baseUrl}/auth/invite/${invite.token}`;

    return { ok: true, token: invite.token, link };
  } catch (err: any) {
    console.error("[createInvite]", err);
    return { ok: false, error: err.message ?? "Failed to create invite." };
  }
}

// -----------------------------------------------------------------------------
// Accept an invite — creates a WORKER account
// -----------------------------------------------------------------------------

export type InviteInfo = {
  tenantName: string;
  email: string;
  role: string;
  expiresAt: Date;
};

/** Look up invite details (used on the invite-acceptance page). */
export async function getInviteInfo(token: string): Promise<InviteInfo | null> {
  const invite = await db.invite.findUnique({
    where: { token },
    include: { tenant: { select: { name: true } } },
  });

  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return null;

  return {
    tenantName: invite.tenant.name,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
  };
}

export type AcceptInviteInput = {
  token: string;
  name: string;
  password: string;
};

export type AcceptInviteResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

export async function acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteResult> {
  try {
    const invite = await db.invite.findUnique({
      where: { token: input.token },
    });

    if (!invite) return { ok: false, error: "Invite not found." };
    if (invite.acceptedAt) return { ok: false, error: "This invite has already been used." };
    if (invite.expiresAt < new Date()) return { ok: false, error: "This invite has expired." };

    const existingUser = await db.user.findUnique({ where: { email: invite.email } });
    if (existingUser) return { ok: false, error: "An account with this email already exists. Please sign in." };

    const passwordHash = await hash(input.password, 12);

    await db.$transaction(async (tx: any) => {
      await tx.user.create({
        data: {
          name: input.name.trim(),
          email: invite.email,
          passwordHash,
          role: invite.role,
          tenantId: invite.tenantId,
          onboardingComplete: true, // workers skip onboarding
          workerPermissions: invite.permissions ?? serializePermissions(DEFAULT_WORKER_PERMISSIONS),
        },
      });

      await tx.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    });

    return { ok: true, email: invite.email };
  } catch (err: any) {
    console.error("[acceptInvite]", err);
    return { ok: false, error: err.message ?? "Failed to accept invite." };
  }
}

// -----------------------------------------------------------------------------
// Team management — OWNER views their workers and pending invites
// -----------------------------------------------------------------------------

export type TeamMember = {
  id: string;
  name: string | null;
  email: string;
  role: "OWNER" | "WORKER";
  permissions: string[]; // parsed Permission[] for WORKER; [] for OWNER (has all)
  joinedAt: Date;
};

export type PendingInvite = {
  id: number;
  email: string;
  expiresAt: Date;
  createdAt: Date;
};

/** List current team members (OWNER + WORKERs) for the caller's tenant. */
export async function listTeamMembers(): Promise<TeamMember[]> {
  const user = await requireOwnerOrAdmin();
  const tenantId = user.tenantId;
  if (!tenantId) return [];

  const members = await db.user.findMany({
    where: { tenantId, role: { in: ["OWNER", "WORKER"] } },
    select: { id: true, name: true, email: true, role: true, createdAt: true, workerPermissions: true },
    orderBy: { createdAt: "asc" },
  });

  return members.map((m: any) => ({
    id: m.id as string,
    name: m.name,
    email: m.email,
    role: m.role as "OWNER" | "WORKER",
    permissions: parsePermissions(m.workerPermissions),
    joinedAt: m.createdAt,
  }));
}

/** List pending (unaccepted, not expired) invites for the caller's tenant. */
export async function listPendingInvites(): Promise<PendingInvite[]> {
  const user = await requireOwnerOrAdmin();
  const tenantId = user.tenantId;
  if (!tenantId) return [];

  const invites = await db.invite.findMany({
    where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  return invites.map((i: any) => ({
    id: i.id,
    email: i.email,
    expiresAt: i.expiresAt,
    createdAt: i.createdAt,
  }));
}

/** Revoke a pending invite by id (OWNER only). */
export async function revokeInvite(inviteId: number): Promise<void> {
  const user = await requireOwnerOrAdmin();
  const tenantId = user.tenantId;
  if (!tenantId) throw new Error("No tenant.");
  await db.invite.deleteMany({ where: { id: inviteId, tenantId } });
}

/** Remove a worker from the tenant (OWNER only — cannot remove self or OWNER). */
export async function removeTeamMember(memberId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const caller = await requireOwnerOrAdmin();
    const tenantId = caller.tenantId;
    if (!tenantId) return { ok: false, error: "No tenant." };
    if (caller.id === memberId) return { ok: false, error: "You cannot remove yourself." };
    const member = await db.user.findFirst({ where: { id: memberId, tenantId, role: "WORKER" } });
    if (!member) return { ok: false, error: "Worker not found." };
    await db.user.delete({ where: { id: memberId } });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message ?? "Failed to remove member." };
  }
}

/** Update the permissions for a worker account (OWNER only). */
export async function updateWorkerPermissions(
  memberId: string,
  permissions: Permission[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    const caller = await requireOwnerOrAdmin();
    const tenantId = caller.tenantId;
    if (!tenantId) return { ok: false, error: "No tenant." };
    const member = await db.user.findFirst({ where: { id: memberId, tenantId, role: "WORKER" } });
    if (!member) return { ok: false, error: "Worker not found." };
    await db.user.update({
      where: { id: memberId },
      data: { workerPermissions: serializePermissions(permissions) },
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message ?? "Failed to update permissions." };
  }
}

// -----------------------------------------------------------------------------
// Super-admin helpers
// -----------------------------------------------------------------------------

export type TenantSummary = {
  id: number;
  name: string;
  slug: string;
  ownerEmail: string | null;
  createdAt: Date;
  userCount: number;
};

// -----------------------------------------------------------------------------
// Password reset (unauthenticated) + change password (authenticated)
// -----------------------------------------------------------------------------

const SMTP_PRESETS: Record<string, { host: string; port: number }> = {
  gmail:        { host: "smtp.gmail.com",     port: 587 },
  icloud:       { host: "smtp.mail.me.com",   port: 587 },
  microsoft365: { host: "smtp.office365.com", port: 587 },
};

export type RequestResetResult =
  | { ok: true; emailSent: true }
  | { ok: true; emailSent: false; resetLink: string }
  | { ok: false; error: string };

/**
 * Create a password reset token and (optionally) send an email with the reset link.
 * If SMTP is not configured, the reset link is returned directly so the UI can display it.
 * Always returns ok:true for valid emails to avoid user enumeration.
 */
export async function requestPasswordReset(email: string): Promise<RequestResetResult> {
  try {
    const normEmail = email.trim().toLowerCase();
    if (!normEmail) return { ok: false, error: "Email is required." };

    const user = await db.user.findUnique({ where: { email: normEmail } });
    // Silently succeed for unknown emails / Google-only accounts to avoid enumeration
    if (!user?.passwordHash) return { ok: true, emailSent: true };

    // Expire previous tokens for this user
    await db.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    const resetToken = createPasswordResetToken();
    const record = await db.passwordResetToken.create({
      data: {
        userId: user.id,
        token: hashPasswordResetToken(resetToken),
        expiresAt: addDays(new Date(), 1),
      },
    });

    const baseUrl = (process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const resetLink = `${baseUrl}/auth/reset-password/${resetToken}`;

    // Try to send via the user's tenant SMTP settings
    let smtpSettings: any = null;
    if (user.tenantId) {
      smtpSettings = await db.tenantSettings.findFirst({ where: { tenantId: user.tenantId } });
    }

    if (smtpSettings?.smtpUser && smtpSettings?.smtpPass) {
      try {
        const preset = SMTP_PRESETS[smtpSettings.smtpProvider ?? "gmail"];
        const host = smtpSettings.smtpHost || preset?.host || "";
        const port = smtpSettings.smtpPort || preset?.port || 587;
        const fromName = smtpSettings.smtpFromName || smtpSettings.businessName || "Wyndos";

        const transporter = nodemailer.createTransport({ host, port, secure: false, auth: { user: smtpSettings.smtpUser, pass: smtpSettings.smtpPass } });
        await transporter.sendMail({
          from: `"${fromName}" <${smtpSettings.smtpUser}>`,
          to: normEmail,
          subject: "Reset your Wyndos password",
          html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="margin:0 0 16px">Reset your password</h2><p style="margin:0 0 20px;color:#475569">Click the button below to set a new password. This link expires in 24 hours.</p><a href="${resetLink}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px">Reset password</a><p style="margin:24px 0 0;color:#94a3b8;font-size:12px">If you didn't request this, you can safely ignore this email.</p></div>`,
          text: `Reset your password: ${resetLink}\n\nThis link expires in 24 hours.`,
        });
        return { ok: true, emailSent: true };
      } catch (emailErr) {
        console.error("[requestPasswordReset] email failed:", emailErr);
        // Fall through to return link directly
      }
    }

    // No SMTP or send failed — return the link for display in the UI
    return { ok: true, emailSent: false, resetLink };
  } catch (err: any) {
    console.error("[requestPasswordReset]", err);
    return { ok: false, error: "Failed to process request. Please try again." };
  }
}

/** Validate a reset token and look up basic user info for the reset page. */
export async function getResetTokenInfo(token: string): Promise<{ valid: true; email: string } | { valid: false; error: string }> {
  try {
    const record = await db.passwordResetToken.findUnique({
      where: { token: hashPasswordResetToken(token.trim()) },
    });
    if (!record) return { valid: false, error: "Invalid or expired reset link." };
    if (record.usedAt) return { valid: false, error: "This reset link has already been used." };
    if (record.expiresAt < new Date()) return { valid: false, error: "This reset link has expired. Please request a new one." };
    const user = await db.user.findUnique({ where: { id: record.userId }, select: { email: true } });
    if (!user) return { valid: false, error: "Account not found." };
    return { valid: true, email: user.email };
  } catch {
    return { valid: false, error: "Could not validate reset link." };
  }
}

/** Apply a password reset using a valid token. */
export async function resetPassword(token: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!newPassword || newPassword.length < 8) {
      return { ok: false, error: "Password must be at least 8 characters." };
    }
    const record = await db.passwordResetToken.findUnique({
      where: { token: hashPasswordResetToken(token.trim()) },
    });
    if (!record) return { ok: false, error: "Invalid or expired reset link." };
    if (record.usedAt) return { ok: false, error: "This reset link has already been used." };
    if (record.expiresAt < new Date()) return { ok: false, error: "This reset link has expired. Please request a new one." };

    const passwordHash = await hash(newPassword, 12);
    await db.$transaction(async (tx: any) => {
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    });
    return { ok: true };
  } catch (err: any) {
    console.error("[resetPassword]", err);
    return { ok: false, error: "Failed to reset password. Please try again." };
  }
}

/** Change password for the currently authenticated user. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { ok: false, error: "Not authenticated." };
    if (!newPassword || newPassword.length < 8) {
      return { ok: false, error: "New password must be at least 8 characters." };
    }
    const user = await db.user.findUnique({ where: { id: session.user.id } });
    if (!user?.passwordHash) {
      return { ok: false, error: "Password change is not available for Google sign-in accounts." };
    }
    const isValid = await compare(currentPassword, user.passwordHash);
    if (!isValid) return { ok: false, error: "Current password is incorrect." };
    const passwordHash = await hash(newPassword, 12);
    await db.user.update({ where: { id: user.id }, data: { passwordHash } });
    return { ok: true };
  } catch (err: any) {
    console.error("[changePassword]", err);
    return { ok: false, error: "Failed to change password. Please try again." };
  }
}

// -----------------------------------------------------------------------------
/** List all tenants (SUPER_ADMIN only). */
export async function listAllTenants(): Promise<TenantSummary[]> {
  await requireSuperAdmin();

  const tenants = await db.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      users: {
        where: { role: "OWNER" },
        select: { email: true },
        take: 1,
      },
      _count: { select: { users: true } },
    },
  });

  return tenants.map((t: any) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    ownerEmail: t.users[0]?.email ?? null,
    createdAt: t.createdAt,
    userCount: t._count.users,
  }));
}
