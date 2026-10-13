import { createHmac, timingSafeEqual } from "crypto";
import { after, NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

export const runtime = "nodejs";

type GcEvent = { id: string; resource_type: string; action: string; links?: { organisation?: string; [k: string]: string | undefined } };

const g = globalThis as unknown as { __wyndosGcHook?: Map<number, ReturnType<typeof setTimeout>> };

/**
 * GoCardless webhooks for businesses connected with "Connect GoCardless" (the partner app).
 * Signed with GOCARDLESS_WEBHOOK_SECRET (the app's webhook secret). Each event names the
 * business's GoCardless account (links.organisation). Wyndos then syncs that business, which
 * records confirmed payments (payment_confirmed), failures, charge-backs and mandate changes,
 * the same as pressing Sync. A disconnect forgets the token.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.GOCARDLESS_WEBHOOK_SECRET?.trim();
  const raw = await req.text();
  if (!secret) return NextResponse.json({ error: "Webhooks not set up" }, { status: 498 });
  const sent = req.headers.get("webhook-signature") ?? "";
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  // GoCardless's convention for a bad signature is 498.
  if (sent.length !== expected.length || !timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 498 });
  }
  let events: GcEvent[] = [];
  try { events = ((JSON.parse(raw) as { events?: GcEvent[] }).events ?? []).slice(0, 500); } catch { return NextResponse.json({ error: "Bad body" }, { status: 400 }); }

  const orgIds = [...new Set(events.map((e) => e.links?.organisation).filter((x): x is string => Boolean(x)))];
  const tenants = orgIds.length
    ? await prisma.tenantSettings.findMany({ where: { goCardlessOrganisationId: { in: orgIds } }, select: { tenantId: true, goCardlessOrganisationId: true } })
    : [];
  const tenantOf = new Map(tenants.map((t) => [t.goCardlessOrganisationId!, t.tenantId]));
  const toSync = new Set<number>();
  for (const e of events) {
    const tenantId = e.links?.organisation ? tenantOf.get(e.links.organisation) : undefined;
    if (!tenantId) continue;
    // They disconnected Wyndos in GoCardless (or closed the account): the token no longer works.
    if (e.resource_type === "organisations" && e.action === "disconnected") {
      await prisma.tenantSettings.update({ where: { tenantId }, data: { goCardlessAccessToken: "", goCardlessOrganisationId: null, goCardlessLastError: "GoCardless was disconnected. Connect it again in Settings." } });
      toSync.delete(tenantId);
      continue;
    }
    if (["payments", "mandates", "billing_requests", "subscriptions", "refunds"].includes(e.resource_type)) toSync.add(tenantId);
  }

  // Reply straight away (GoCardless waits only a few seconds); sync afterwards, once per business
  // even if several webhooks arrive close together.
  after(() => {
    g.__wyndosGcHook ??= new Map();
    for (const tenantId of toSync) {
      const timers = g.__wyndosGcHook;
      if (timers.has(tenantId)) clearTimeout(timers.get(tenantId)!);
      timers.set(tenantId, setTimeout(async () => {
        timers.delete(tenantId);
        try {
          const { syncTenant } = await import("@/lib/gocardless/core");
          await syncTenant(tenantId);
        } catch (issue) {
          console.error("[gocardless webhook] sync failed", tenantId, issue);
        }
      }, 5_000));
    }
  });
  return NextResponse.json({ ok: true });
}
