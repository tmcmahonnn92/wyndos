import "server-only";
import { createHmac } from "node:crypto";
import prisma from "@/lib/db";

/**
 * Stop "delete the account, sign up again, get another free trial". When a business is deleted
 * its owners' emails are kept as a keyed hash (not the address). A new sign-up with one of
 * those emails starts with its trial already over, so they go straight to subscribing.
 *
 * Emails are compared loosely: case, "+anything" and (for Gmail) dots don't make a new address.
 */
export function normaliseEmail(raw: string) {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  let local = email.slice(0, at).split("+")[0];
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export function emailHash(email: string) {
  const key = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "wyndos-deleted-accounts";
  return createHmac("sha256", key).update(normaliseEmail(email)).digest("hex");
}

/** Remember these emails as having had a business (call before deleting it). */
export async function rememberDeletedOwners(emails: Array<string | null | undefined>) {
  for (const e of new Set(emails.filter((x): x is string => Boolean(x && x.includes("@"))))) {
    const emailHash_ = emailHash(e);
    await prisma.deletedAccount.upsert({ where: { emailHash: emailHash_ }, create: { emailHash: emailHash_ }, update: { deletedAt: new Date() } });
  }
}

export async function hadTrialBefore(email: string) {
  if (!email) return false;
  return Boolean(await prisma.deletedAccount.findUnique({ where: { emailHash: emailHash(email) }, select: { emailHash: true } }));
}
