import "server-only";
import prisma from "@/lib/db";
import { GOCARDLESS_ENABLED } from "@/lib/features";

/** Features being tried out with a few businesses first. Turned on per business in Admin only. */
export const TRIAL_FEATURES = [
  { key: "auto_invoice", label: "Invoice emails", hint: "Customer page: Send email on invoices; Settings: email invoices automatically when a day is finished" },
  { key: "gocardless", label: "Direct Debit (GoCardless)", hint: "Settings → GoCardless, Payments → Direct Debit, nightly sync" },
] as const;
export type TrialFeature = (typeof TRIAL_FEATURES)[number]["key"];

export const featureList = (raw: string | null | undefined) => String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Sandbox / demo copies (running locally with `npm run dev`, or a server started with
 * WYNDOS_SANDBOX=1): every trial feature is on for every business, so they can be tested
 * without switching them on in Admin. Never set WYNDOS_SANDBOX on the live server.
 */
export const ALL_TRIALS_ON = process.env.NODE_ENV === "development" || process.env.WYNDOS_SANDBOX === "1";

export async function hasTrialFeature(tenantId: number, key: TrialFeature) {
  if (ALL_TRIALS_ON) return true;
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { trialFeatures: true } });
  return featureList(t?.trialFeatures).includes(key);
}

/** Direct Debit: on for the whole server (dev/staging build flag) or for businesses trialling it. */
export async function goCardlessOn(tenantId: number) {
  return GOCARDLESS_ENABLED || hasTrialFeature(tenantId, "gocardless");
}
