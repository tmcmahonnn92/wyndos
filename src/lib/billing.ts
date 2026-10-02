import Stripe from "stripe";
import prisma from "@/lib/db";

/**
 * Wyndos subscriptions: £9.99 a month for everything, 15-day free trial with no card.
 *
 * The trial is kept by Wyndos (from when the business signed up), so nobody needs a card
 * to start. Subscribing during the trial uses Stripe Checkout with trial_end set to the
 * end of the trial, so the first charge lands when the trial would have ended.
 * Stripe is the source of truth after that: webhooks (and the return from Checkout) copy
 * the subscription's status onto the Tenant.
 */

export const TRIAL_DAYS = 15;
export const PRICE_PENCE = 999;
export const PRICE_LABEL = "£9.99";
const PRICE_LOOKUP_KEY = "wyndos_monthly_gbp";
/** Software as a service, business use. Override with STRIPE_TAX_CODE if needed. */
const TAX_CODE = process.env.STRIPE_TAX_CODE?.trim() || "txcd_10103001";

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

let client: Stripe | null = null;
export function stripe() {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    if (!key) throw new Error("Payments aren't set up on the server yet (STRIPE_SECRET_KEY).");
    client = new Stripe(key, { appInfo: { name: "Wyndos", url: "https://wyndos.io" } });
  }
  return client;
}

type TenantBilling = {
  createdAt: Date;
  trialEndsAt: Date | null;
  billingExempt: boolean;
  subscriptionStatus: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type BillingState = {
  /** May use the app. */
  access: boolean;
  kind: "free" | "subscribed" | "trial" | "past_due" | "ended";
  trialEndsAt: string;
  daysLeft: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Has paid before (so "subscription ended" rather than "trial ended"). */
  hadSubscription: boolean;
};

const PAID = new Set(["active", "trialing"]);

export function trialEndOf(t: Pick<TenantBilling, "createdAt" | "trialEndsAt">) {
  return t.trialEndsAt ?? new Date(t.createdAt.getTime() + TRIAL_DAYS * 86_400_000);
}

export function billingStateOf(t: TenantBilling, now = new Date()): BillingState {
  const trialEnd = trialEndOf(t);
  const daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / 86_400_000));
  const base = {
    trialEndsAt: trialEnd.toISOString(),
    daysLeft,
    currentPeriodEnd: t.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: t.cancelAtPeriodEnd,
    hadSubscription: Boolean(t.subscriptionStatus),
  };
  if (t.billingExempt) return { ...base, access: true, kind: "free" };
  if (PAID.has(t.subscriptionStatus)) return { ...base, access: true, kind: "subscribed" };
  // Card failed: Stripe keeps retrying for a while. Keep working, but say so.
  if (t.subscriptionStatus === "past_due") return { ...base, access: true, kind: "past_due" };
  if (now < trialEnd) return { ...base, access: true, kind: "trial" };
  return { ...base, access: false, kind: "ended" };
}

export async function billingStateForTenant(tenantId: number) {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { createdAt: true, trialEndsAt: true, billingExempt: true, subscriptionStatus: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
  });
  return t ? billingStateOf(t) : null;
}

/** The £9.99/month price, found by lookup key (made the first time if it doesn't exist). */
export async function monthlyPriceId() {
  const fixed = process.env.STRIPE_PRICE_ID?.trim();
  if (fixed) return fixed;
  const s = stripe();
  const found = await s.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1, expand: ["data.product"] });
  if (found.data[0]) {
    // Stripe needs a tax code on the product (e.g. for Managed Payments). Add it to older products.
    const product = found.data[0].product;
    if (product && typeof product === "object" && !("deleted" in product && product.deleted) && !(product as Stripe.Product).tax_code) {
      await s.products.update((product as Stripe.Product).id, { tax_code: TAX_CODE });
    }
    return found.data[0].id;
  }
  const product = await s.products.create({
    name: "Wyndos",
    description: "Round planner for window cleaners: scheduling, customers, payments, texts and accounts.",
    tax_code: TAX_CODE,
  });
  const price = await s.prices.create({
    product: product.id,
    currency: "gbp",
    unit_amount: PRICE_PENCE,
    recurring: { interval: "month" },
    // £9.99 is before VAT: Stripe adds VAT on top when tax is switched on.
    tax_behavior: "exclusive",
    lookup_key: PRICE_LOOKUP_KEY,
    nickname: "Wyndos monthly",
  });
  return price.id;
}

/** The business's Stripe customer, made on first use. */
export async function ensureStripeCustomer(tenantId: number, email: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, stripeCustomerId: true } });
  if (tenant.stripeCustomerId) return tenant.stripeCustomerId;
  const customer = await stripe().customers.create({
    email: email || undefined,
    name: tenant.name,
    metadata: { tenantId: String(tenantId) },
  });
  await prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/** The customer portal needs a configuration; make a sensible one if the account has none. */
export async function ensurePortalConfiguration() {
  const s = stripe();
  const existing = await s.billingPortal.configurations.list({ is_default: true, limit: 1 });
  if (existing.data[0]) return existing.data[0].id;
  const config = await s.billingPortal.configurations.create({
    business_profile: { headline: "Manage your Wyndos subscription" },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address", "name"] },
      subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] } },
    },
  });
  return config.id;
}

function periodEndOf(sub: Stripe.Subscription): Date | null {
  // Newer API versions keep the period on each item; older ones on the subscription.
  const itemEnd = sub.items?.data?.[0]?.current_period_end;
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end;
  const ts = itemEnd ?? legacy;
  return ts ? new Date(ts * 1000) : null;
}

/** Copy a subscription's state onto its business. */
export async function applySubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const tenantIdFromMeta = Number(sub.metadata?.tenantId);
  const tenant = await prisma.tenant.findFirst({
    where: Number.isInteger(tenantIdFromMeta) && tenantIdFromMeta > 0 ? { OR: [{ id: tenantIdFromMeta }, { stripeCustomerId: customerId }] } : { stripeCustomerId: customerId },
    select: { id: true, stripeSubscriptionId: true },
  });
  if (!tenant) {
    console.warn("[billing] no business for subscription", sub.id);
    return;
  }
  // An old cancelled subscription mustn't overwrite a newer live one.
  if (tenant.stripeSubscriptionId && tenant.stripeSubscriptionId !== sub.id && !PAID.has(sub.status) && sub.status !== "past_due") return;
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      currentPeriodEnd: periodEndOf(sub),
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end || sub.cancel_at),
    },
  });
}

/** Re-read a customer's newest subscription from Stripe (after Checkout, or any invoice event). */
export async function syncCustomer(customerId: string) {
  const subs = await stripe().subscriptions.list({ customer: customerId, status: "all", limit: 5 });
  const best = subs.data.find((s) => PAID.has(s.status) || s.status === "past_due") ?? subs.data[0];
  if (best) await applySubscription(best);
}
