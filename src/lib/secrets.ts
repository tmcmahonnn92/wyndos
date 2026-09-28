import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * At-rest encryption for provider credentials stored in TenantSettings
 * (SMTP password, GoCardless / Twilio / Meta / VoodooSMS tokens).
 *
 * Key: SETTINGS_ENCRYPTION_KEY if set, else AUTH_SECRET. Changing the key makes
 * stored secrets unreadable, so set SETTINGS_ENCRYPTION_KEY once and keep it.
 *
 * Values written before encryption existed are plain text; decryptSecret returns
 * them unchanged, and they are encrypted the next time settings are saved.
 */

const PREFIX = "enc:v1:";

function getKey() {
  const material = process.env.SETTINGS_ENCRYPTION_KEY || process.env.AUTH_SECRET || "dev-secret-change-me";
  return createHash("sha256").update(material).digest();
}

export function encryptSecret(value: string): string {
  if (!value || value.startsWith(PREFIX)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, data].map((part) => part.toString("base64")).join(":");
}

export function decryptSecret(value: string | null | undefined): string {
  if (!value) return "";
  if (!value.startsWith(PREFIX)) return value;
  try {
    const [iv, tag, data] = value.slice(PREFIX.length).split(":").map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    console.error("[secrets] Could not decrypt a stored credential. Was the encryption key changed?");
    return "";
  }
}

export const SECRET_SETTING_FIELDS = [
  "smtpPass",
  "voodooApiKey",
  "twilioAuthToken",
  "metaAccessToken",
  "goCardlessAccessToken",
] as const;

export function decryptSettingsSecrets<T extends Record<string, unknown>>(settings: T): T {
  const copy: Record<string, unknown> = { ...settings };
  for (const field of SECRET_SETTING_FIELDS) {
    if (typeof copy[field] === "string") copy[field] = decryptSecret(copy[field] as string);
  }
  return copy as T;
}
