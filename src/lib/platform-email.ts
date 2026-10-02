import nodemailer from "nodemailer";

/**
 * Wyndos's own email account (Brevo), from the PLATFORM_SMTP_* settings on the server.
 * Used for things Wyndos sends itself: notifications, resets, invites.
 */
export function platformEmailConfigured() {
  return Boolean(process.env.PLATFORM_SMTP_HOST?.trim() && process.env.PLATFORM_SMTP_USER?.trim() && process.env.PLATFORM_SMTP_PASS);
}

export type PlatformEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  cc?: string | string[];
  bcc?: string;
  replyTo?: string | string[];
  /** Override the sender, e.g. '"Wyndos Support" <support@wyndos.io>'. */
  from?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
};

export async function sendPlatformEmail(input: PlatformEmail) {
  if (!platformEmailConfigured()) throw new Error("Email isn't set up on the server (PLATFORM_SMTP_*).");
  const port = Number(process.env.PLATFORM_SMTP_PORT) > 0 ? Number(process.env.PLATFORM_SMTP_PORT) : 587;
  const secureSetting = String(process.env.PLATFORM_SMTP_SECURE ?? "").trim().toLowerCase();
  const user = String(process.env.PLATFORM_SMTP_USER).trim();
  const transporter = nodemailer.createTransport({
    host: String(process.env.PLATFORM_SMTP_HOST).trim(),
    port,
    secure: secureSetting ? secureSetting === "true" : port === 465,
    auth: { user, pass: String(process.env.PLATFORM_SMTP_PASS) },
  });
  const fromName = String(process.env.PLATFORM_SMTP_FROM_NAME ?? "Wyndos").trim() || "Wyndos";
  const fromEmail = String(process.env.PLATFORM_SMTP_FROM_EMAIL ?? user).trim() || user;
  const { from, ...rest } = input;
  await transporter.sendMail({ from: from || `"${fromName}" <${fromEmail}>`, ...rest });
}

/** Where support messages and new sign-ups go, and who gets a copy (Tom). Env overrides. */
export const SUPPORT_TO = process.env.SUPPORT_EMAIL?.trim() || "support@wyndos.io";
export const SUPPORT_COPY = (process.env.SUPPORT_COPY_EMAIL ?? process.env.SUPPORT_BCC_EMAIL ?? "").trim() || "tmcmahon.tom@gmail.com";

export function appUrl(path = "") {
  const base = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}
