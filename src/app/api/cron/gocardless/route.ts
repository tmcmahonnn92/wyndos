import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { GOCARDLESS_ENABLED } from "@/lib/features";
import { syncTenant } from "@/lib/gocardless/core";

/**
 * GoCardless sync for every business with a token saved: mandate and payment statuses,
 * money received, auto-collect. Run every 15 minutes from cron on the server:
 *   0,15,30,45 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://wyndos.io/api/cron/gocardless
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!GOCARDLESS_ENABLED) return NextResponse.json({ ok: true, skipped: "GoCardless is switched off" });
  const tenants = await prisma.tenantSettings.findMany({ where: { NOT: { goCardlessAccessToken: "" } }, select: { tenantId: true } });
  const results = [];
  for (const { tenantId } of tenants) {
    try {
      results.push({ tenantId, ...(await syncTenant(tenantId)) });
    } catch (issue) {
      results.push({ tenantId, error: issue instanceof Error ? issue.message : String(issue) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
