import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getBusinessSettings, claimNextInvoiceNumber } from "@/lib/actions";
import { requireMember, hasPermission, AccessDeniedError } from "@/lib/guards";
import { emailInvoice, EMAIL_RE } from "@/lib/invoice-email";
import { hasTrialFeature } from "@/lib/trial-features";

export const runtime = "nodejs";

/**
 * Email an invoice for some of a customer's cleans. Only for businesses trialling invoice
 * emails (Admin), and only to customers set to "Email invoices" with an email address.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { customerId: number; jobIds: number[]; markInvoiced?: boolean };
    const actor = await requireMember();
    if (!hasPermission(actor, "payments") && !hasPermission(actor, "customers")) throw new AccessDeniedError();
    const tenantId = actor.tenantId;
    if (!(await hasTrialFeature(tenantId, "auto_invoice"))) return NextResponse.json({ error: "Invoice emails aren't switched on for your account yet." }, { status: 403 });
    const customerId = Number(body.customerId);
    const jobIds = [...new Set((Array.isArray(body.jobIds) ? body.jobIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 200);
    if (!Number.isInteger(customerId) || customerId <= 0 || jobIds.length === 0) return NextResponse.json({ error: "Choose at least one clean." }, { status: 400 });

    const [customer, settings, jobs] = await Promise.all([
      prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true, name: true, address: true, email: true, emailInvoices: true } }),
      getBusinessSettings(),
      prisma.job.findMany({
        where: { id: { in: jobIds }, customerId, tenantId },
        include: { workDay: true, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } },
        orderBy: { workDay: { date: "asc" } },
      }),
    ]);
    if (!customer) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
    if (!customer.emailInvoices) return NextResponse.json({ error: "Tick \"Email invoices to this customer\" on their details first." }, { status: 400 });
    if (!EMAIL_RE.test(customer.email?.trim() ?? "")) return NextResponse.json({ error: "Add an email address to this customer first." }, { status: 400 });
    if (jobs.length !== jobIds.length) return NextResponse.json({ error: "Some of those cleans weren't found." }, { status: 404 });

    const invoiceNumber = await claimNextInvoiceNumber();
    if (body.markInvoiced !== false) {
      await prisma.job.updateMany({ where: { id: { in: jobIds }, customerId, tenantId }, data: { invoicedAt: new Date(), invoiceNumber } });
    }
    const res = await emailInvoice({ tenantId, settings, customer, jobs, invoiceNumber, sentByUserId: actor.userId });
    if (!res.ok) {
      if (body.markInvoiced !== false) await prisma.job.updateMany({ where: { id: { in: jobIds }, tenantId, invoiceNumber }, data: { invoicedAt: null } });
      return NextResponse.json({ error: res.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, invoiceNumber, to: customer.email });
  } catch (err) {
    if (err instanceof AccessDeniedError) return NextResponse.json({ error: "You can't send invoices." }, { status: 403 });
    console.error("[invoice/email]", err);
    return NextResponse.json({ error: "Couldn't send the invoice. Please try again." }, { status: 500 });
  }
}
