import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { applySubscription, stripe, syncCustomer } from "@/lib/billing";

export const runtime = "nodejs";

/**
 * Stripe → Wyndos. Add this endpoint in Stripe (Developers → Webhooks):
 *   https://wyndos.io/api/stripe/webhook
 * with the events below, and put its signing secret in STRIPE_WEBHOOK_SECRET.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Webhook secret not set" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "No signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.customer) {
          await syncCustomer(typeof session.customer === "string" ? session.customer : session.customer.id);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        await applySubscription(event.data.object as Stripe.Subscription);
        break;
      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer) await syncCustomer(typeof invoice.customer === "string" ? invoice.customer : invoice.customer.id);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("[stripe/webhook]", event.type, e);
    // 500 makes Stripe retry later.
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
