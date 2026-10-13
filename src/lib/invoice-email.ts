import "server-only";
import prisma from "@/lib/db";
import { DD_INVOICE_TEXT, renderInvoicePdf } from "@/lib/invoice-build";
import { paysByDirectDebit } from "@/lib/gocardless/status";
import { tenantMailer } from "@/lib/tenant-email";
import { fmtCurrency } from "@/lib/utils";

type Settings = Parameters<typeof renderInvoicePdf>[0] & { businessName: string };
type Job = Parameters<typeof renderInvoicePdf>[2][number];

const escHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email one invoice (PDF attached) to a customer from the business's own email account
 * (Settings → Email), never from Wyndos's. Logged in the messages log.
 */
export async function emailInvoice(input: {
  tenantId: number;
  settings: Settings;
  customer: { id: number; name: string; address: string | null; email: string | null; goCardlessMandateId?: string | null; goCardlessMandateStatus?: string | null };
  jobs: Job[];
  invoiceNumber: string;
  workDayId?: number | null;
  sentByUserId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { tenantId, settings, customer, jobs, invoiceNumber } = input;
  const to = (customer.email ?? "").trim();
  if (!EMAIL_RE.test(to)) return { ok: false, error: "This customer hasn't got a valid email address." };
  const mailer = await tenantMailer(tenantId);
  if (!mailer) return { ok: false, error: "Set up your own email in Settings → Email first, so invoices come from you." };
  const due = jobs.reduce((s, j) => s + Math.max(0, j.price - j.allocations.reduce((p, a) => p + a.amount, 0)), 0);
  const total = jobs.reduce((s, j) => s + j.price, 0);
  const business = settings.businessName || "Your window cleaner";
  const first = (customer.name.trim().split(/\s+/)[0] || "").replace(/^(mr|mrs|ms|miss|dr)\.?$/i, "") || "there";
  const dates = [...new Set(jobs.map((j) => j.workDay.date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })))];
  const dd = paysByDirectDebit(customer);
  const lines = [
    `Hi ${first},`,
    "",
    `Thanks for having your windows cleaned${dates.length === 1 ? ` on ${dates[0]}` : ""}. Invoice ${invoiceNumber} is attached${due > 0.005 ? (dd ? ` (${fmtCurrency(due)})` : `: ${fmtCurrency(due)} to pay`) : `, already paid (${fmtCurrency(total)})`}.`,
    dd ? (due > 0.005 ? DD_INVOICE_TEXT : "") : (settings.invoicePaymentTerms ?? "").trim(),
    !dd && due > 0.005 && (settings.bankDetails ?? "").trim() ? `\nHow to pay:\n${(settings.bankDetails ?? "").trim()}` : "",
    "",
    `Thanks,\n${(settings.ownerName ?? "").trim() || business}`,
  ].filter((l, i, all) => l !== "" || all[i - 1] !== "");
  const text = lines.join("\n");
  let status = "SENT", error = "";
  try {
    const pdf = await renderInvoicePdf(settings, customer, jobs, invoiceNumber);
    const replyTo = (settings.email ?? "").trim();
    await mailer.send({
      to,
      replyTo: replyTo && replyTo.toLowerCase() !== mailer.fromEmail.toLowerCase() ? replyTo : undefined,
      subject: `Invoice ${invoiceNumber} from ${business}`,
      text,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1e293b">${escHtml(text).replace(/\n/g, "<br>")}</div>`,
      attachments: [{ filename: `${invoiceNumber}.pdf`, content: pdf, contentType: "application/pdf" }],
    });
  } catch (issue) {
    status = "FAILED";
    error = issue instanceof Error ? issue.message.slice(0, 300) : "Couldn't send";
  }
  await prisma.messageLog.create({
    data: { tenantId, customerId: customer.id, workDayId: input.workDayId ?? null, kind: "INVOICE_EMAIL", toNumber: to.slice(0, 120), body: `Invoice ${invoiceNumber} · ${fmtCurrency(due)}`, status, error, sentByUserId: input.sentByUserId ?? null },
  });
  return status === "SENT" ? { ok: true } : { ok: false, error: "The email couldn't be sent. Try again in a minute." };
}
