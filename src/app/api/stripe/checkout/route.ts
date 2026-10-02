import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireOwner } from "@/lib/guards";
import { appUrl } from "@/lib/platform-email";
import { ensureStripeCustomer, monthlyPriceId, stripe, stripeConfigured, trialEndOf } from "@/lib/billing";

export const runtime = "nodejs";

/** Start Stripe Checkout for the £9.99/month subscription (owner only). */
export async function POST() {
  let actor;
  try {
    actor = await requireOwner();
  } catch {
    return NextResponse.json({ error: "Only the owner can subscribe." }, { status: 403 });
  }
  if (!stripeConfigured()) return NextResponse.json({ error: "Payments aren't set up yet. Please contact support." }, { status: 503 });

  try {
    const [tenant, user] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { createdAt: true, trialEndsAt: true, subscriptionStatus: true } }),
      prisma.user.findUnique({ where: { id: actor.userId }, select: { email: true } }),
    ]);
    if (["active", "trialing", "past_due"].includes(tenant.subscriptionStatus)) {
      return NextResponse.json({ error: "You're already subscribed. Use Manage billing to change it." }, { status: 400 });
    }
    const customer = await ensureStripeCustomer(actor.tenantId, user?.email ?? "");
    const price = await monthlyPriceId();
    // Still in the free trial: first payment when the trial ends (Stripe needs 2+ days' notice).
    const trialEnd = trialEndOf(tenant);
    const keepTrial = trialEnd.getTime() - Date.now() > 2 * 86_400_000 + 60_000;

    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: String(actor.tenantId),
      line_items: [{ price, quantity: 1 }],
      subscription_data: {
        metadata: { tenantId: String(actor.tenantId) },
        ...(keepTrial ? { trial_end: Math.floor(trialEnd.getTime() / 1000) } : {}),
      },
      // Adds VAT on top of the price (needs Stripe Tax set up in the Stripe dashboard).
      ...(process.env.STRIPE_AUTOMATIC_TAX === "1" ? { automatic_tax: { enabled: true } } : {}),
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      customer_update: { address: "auto", name: "auto" },
      success_url: appUrl("/billing?session_id={CHECKOUT_SESSION_ID}"),
      cancel_url: appUrl("/billing"),
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[stripe/checkout]", e);
    const stripeMessage = e && typeof e === "object" && "type" in e && String((e as { type: unknown }).type).startsWith("Stripe")
      ? String((e as { message?: unknown }).message ?? "")
      : "";
    return NextResponse.json({ error: stripeMessage ? `Stripe: ${stripeMessage}` : "Couldn't open checkout. Please try again." }, { status: 502 });
  }
}
