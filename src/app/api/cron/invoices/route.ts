import { NextResponse } from "next/server";
import { processDueInvoiceEmails } from "@/lib/invoice-queue";

/**
 * Emails invoices whose delay has passed (trial "Invoice emails"). The app also runs this on a
 * timer when a day is finished; cron every 15 minutes is the backstop (restarts, long delays):
 *   5,20,35,50 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/invoices
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await processDueInvoiceEmails()) });
}
