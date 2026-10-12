import "server-only";
import nodemailer from "nodemailer";
import prisma from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";

/** Same presets as Settings → Email. */
const PRESETS: Record<string, { host: string; port: number }> = {
  gmail: { host: "smtp.gmail.com", port: 587 },
  icloud: { host: "smtp.mail.me.com", port: 587 },
  microsoft365: { host: "smtp.office365.com", port: 587 },
};

export type TenantMailer = {
  fromEmail: string;
  fromName: string;
  send: (mail: { to: string; subject: string; text: string; html: string; replyTo?: string; attachments?: Array<{ filename: string; content: Buffer; contentType?: string }> }) => Promise<void>;
};

/**
 * The business's own email account (Settings → Email), for anything sent to their customers
 * as them, e.g. invoices. Null when it isn't set up. Never falls back to Wyndos's own account.
 */
export async function tenantMailer(tenantId: number): Promise<TenantMailer | null> {
  const s = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { smtpProvider: true, smtpHost: true, smtpPort: true, smtpUser: true, smtpPass: true, smtpFromName: true, businessName: true },
  });
  if (!s?.smtpUser?.trim() || !s.smtpPass) return null;
  const preset = PRESETS[s.smtpProvider || "gmail"];
  const host = (s.smtpHost || preset?.host || "").trim();
  const port = Number(s.smtpPort) > 0 ? Number(s.smtpPort) : preset?.port ?? 587;
  const user = s.smtpUser.trim();
  const pass = decryptSecret(s.smtpPass);
  if (!host || !pass) return null;
  const fromName = (s.smtpFromName || s.businessName || "").replace(/["\r\n]/g, "").trim() || user;
  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  return {
    fromEmail: user,
    fromName,
    send: async (mail) => {
      await transporter.sendMail({ from: `"${fromName}" <${user}>`, ...mail });
    },
  };
}

/** Is the business's own email set up? (for showing the options) */
export async function tenantEmailReady(tenantId: number) {
  const s = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { smtpUser: true, smtpPass: true } });
  return Boolean(s?.smtpUser?.trim() && s.smtpPass);
}
