import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { runPaymentReminders } from "@/lib/texts";

/**
 * Daily payment reminders for every business that has them turned on.
 * Call once a day, e.g. from cron on the server:
 *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://wyndos.io/api/cron/texts
 * In test mode (the default) texts are only written to the message log.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const tenants = await prisma.tenantSettings.findMany({
    where: { OR: [{ textPaymentReminderDays: { gt: 0 } }, { textPaymentReminder2Days: { gt: 0 } }] },
    select: { tenantId: true },
  });
  const results = [];
  for (const { tenantId } of tenants) {
    try {
      results.push({ tenantId, ...(await runPaymentReminders(tenantId, null)) });
    } catch (issue) {
      results.push({ tenantId, error: issue instanceof Error ? issue.message : String(issue) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
