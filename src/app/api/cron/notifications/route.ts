import { NextResponse } from "next/server";
import { processDueNotifications } from "@/lib/notifications";

/**
 * Sends email notifications that have waited their minute. The app also runs this
 * on its own timer; calling it every few minutes from cron is a backstop after restarts:
 *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://wyndos.io/api/cron/notifications
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await processDueNotifications()) });
}
