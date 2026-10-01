import prisma from "@/lib/db";
import { requireMember } from "@/lib/guards";
import { billingStateForTenant, stripe, stripeConfigured, syncCustomer, PRICE_LABEL, TRIAL_DAYS } from "@/lib/billing";
import { BillingClient } from "./billing-client";

export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const actor = await requireMember();
  const { session_id } = await searchParams;

  // Back from Checkout: read the result straight away rather than waiting for the webhook.
  if (session_id && stripeConfigured() && actor.role === "OWNER") {
    try {
      const session = await stripe().checkout.sessions.retrieve(session_id);
      const tenant = await prisma.tenant.findUnique({ where: { id: actor.tenantId }, select: { stripeCustomerId: true } });
      const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (customer && customer === tenant?.stripeCustomerId) await syncCustomer(customer);
    } catch (e) {
      console.error("[billing] return from checkout", e);
    }
  }

  const state = await billingStateForTenant(actor.tenantId);
  return (
    <BillingClient
      state={state}
      isOwner={actor.role === "OWNER"}
      justSubscribed={Boolean(session_id)}
      price={PRICE_LABEL}
      trialDays={TRIAL_DAYS}
      ready={stripeConfigured()}
    />
  );
}
