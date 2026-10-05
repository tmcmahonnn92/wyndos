import Stripe from "stripe";
import prisma from "@/lib/db";
import { INTRO_PENCE, STANDARD_PENCE, priceLabelFor, tenantOnIntro } from "@/lib/pricing";

/**
 * Wyndos subscriptions: one monthly price for everything, 15-day free trial with no card.
 * Price: £9.99 for life for businesses that joined during the introductory offer, then £14.99
 * (see pricing.ts).
 *
 * The trial is kept by Wyndos (from when the business signed up), so nobody needs a card
 * to start. Subscribing during the trial uses Stripe Checkout with trial_end set to the
 * end of the trial, so the first charge lands when the trial would have ended.
 * Stripe is the source of truth after that: webhooks (and the return from Checkout) copy
 * the subscription's status onto the Tenant.
 */

export const TRIAL_DAYS = 15;
/** Stripe lookup keys. The £9.99 one keeps its original key so existing prices are found. */
const INTRO_LOOKUP_KEY = "wyndos_monthly_gbp";
const STANDARD_LOOKUP_KEY = "wyndos_monthly_gbp_1499";
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
  /** What this business pays a month, e.g. "£9.99". */
  priceLabel: string;
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
    priceLabel: priceLabelFor(t.createdAt),
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

/**
 * The monthly price for this business: £9.99 if it joined during the introductory offer, else £14.99.
 * Set STRIPE_PRICE_ID (£9.99) / STRIPE_PRICE_ID_STANDARD (£14.99) to pin them, otherwise they're
 * found by lookup key (and made the first time).
 */
export async function monthlyPriceId(tenantCreatedAt: Date) {
  const intro = tenantOnIntro(tenantCreatedAt);
  const fixed = (intro ? process.env.STRIPE_PRICE_ID : process.env.STRIPE_PRICE_ID_STANDARD)?.trim();
  if (fixed) return fixed;
  const lookupKey = intro ? INTRO_LOOKUP_KEY : STANDARD_LOOKUP_KEY;
  const s = stripe();
  const found = await s.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1, expand: ["data.product"] });
  if (found.data[0]) {
    // Stripe needs a tax code on the product (e.g. for Managed Payments). Add it to older products.
    const product = found.data[0].product;
    if (product && typeof product === "object" && !("deleted" in product && product.deleted) && !(product as Stripe.Product).tax_code) {
      await s.products.update((product as Stripe.Product).id, { tax_code: TAX_CODE });
    }
    // The price must include any tax Stripe adds, so customers always pay a flat £9.99 / £14.99.
    const current = found.data[0];
    if (current.tax_behavior === "inclusive") return current.id;
    if (current.tax_behavior === "unspecified" || !current.tax_behavior) {
      await s.prices.update(current.id, { tax_behavior: "inclusive" });
      return current.id;
    }
    // Was set to "exclusive" (VAT on top): that can't be changed, so make an inclusive one and move the key to it.
    const productId = typeof current.product === "string" ? current.product : current.product.id;
    const replacement = await s.prices.create({
      product: productId,
      currency: "gbp",
      unit_amount: intro ? INTRO_PENCE : STANDARD_PENCE,
      recurring: { interval: "month" },
      tax_behavior: "inclusive",
      lookup_key: lookupKey,
      transfer_lookup_key: true,
      nickname: current.nickname ?? undefined,
    });
    await s.prices.update(current.id, { active: false });
    return replacement.id;
  }
  // Both prices hang off one "Wyndos" product.
  const other = await s.prices.list({ lookup_keys: [intro ? STANDARD_LOOKUP_KEY : INTRO_LOOKUP_KEY], active: true, limit: 1 });
  const existingProduct = other.data[0] ? (typeof other.data[0].product === "string" ? other.data[0].product : other.data[0].product.id) : null;
  const product = existingProduct ? { id: existingProduct } : await s.products.create({
    name: "Wyndos",
    description: "Round planner for window cleaners: scheduling, customers, payments, texts and accounts.",
    tax_code: TAX_CODE,
  });
  const price = await s.prices.create({
    product: product.id,
    currency: "gbp",
    unit_amount: intro ? INTRO_PENCE : STANDARD_PENCE,
    recurring: { interval: "month" },
    tax_behavior: "inclusive", // any tax comes out of the price, never on top
    lookup_key: lookupKey,
    nickname: intro ? "Wyndos monthly (introductory, for life)" : "Wyndos monthly",
  });
  return price.id;
}

/** The business's Stripe customer, made on first use. */
export async function ensureStripeCustomer(tenantId: number, email: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, stripeCustomerId: true } });
  if (tenant.stripeCustomerId) {
    // A customer saved in test mode doesn't exist in live mode (and vice versa): start fresh then.
    try {
      const existing = await stripe().customers.retrieve(tenant.stripeCustomerId);
      if (!("deleted" in existing && existing.deleted)) return tenant.stripeCustomerId;
    } catch (e) {
      if (!(e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "resource_missing")) throw e;
    }
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { stripeCustomerId: null, stripeSubscriptionId: null, subscriptionStatus: "", currentPeriodEnd: null, cancelAtPeriodEnd: false },
    });
  }
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
