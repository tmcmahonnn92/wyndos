import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireOwner } from "@/lib/guards";
import { appUrl } from "@/lib/platform-email";
import { ensurePortalConfiguration, stripe, stripeConfigured } from "@/lib/billing";

export const runtime = "nodejs";

/** Stripe's own page for card details, invoices and cancelling (owner only). */
export async function POST() {
  let actor;
  try {
    actor = await requireOwner();
  } catch {
    return NextResponse.json({ error: "Only the owner can manage billing." }, { status: 403 });
  }
  if (!stripeConfigured()) return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });
  const tenant = await prisma.tenant.findUnique({ where: { id: actor.tenantId }, select: { stripeCustomerId: true } });
  if (!tenant?.stripeCustomerId) return NextResponse.json({ error: "There's no subscription to manage yet." }, { status: 400 });
  try {
    const configuration = await ensurePortalConfiguration();
    const session = await stripe().billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      configuration,
      return_url: appUrl("/billing"),
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[stripe/portal]", e);
    return NextResponse.json({ error: "Couldn't open billing. Please try again." }, { status: 502 });
  }
}
