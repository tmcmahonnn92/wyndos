import { NextRequest, NextResponse } from "next/server";
import { renderInvoicePdf } from "@/lib/invoice-build";
import prisma from "@/lib/db";
import { getBusinessSettings, claimNextInvoiceNumber } from "@/lib/actions";
import { requireMember, hasPermission, AccessDeniedError } from "@/lib/guards";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { customerId: number; jobIds: number[]; claimNumber?: boolean; markInvoiced?: boolean };
    const { customerId, jobIds, claimNumber = true, markInvoiced = false } = body;
    const actor = await requireMember();
    if (!hasPermission(actor, "payments") && !hasPermission(actor, "customers")) throw new AccessDeniedError();
    const tenantId = actor.tenantId;
    const requestedJobIds = [...new Set(jobIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];

    if (!Number.isInteger(customerId) || customerId <= 0 || requestedJobIds.length === 0) {
      return NextResponse.json({ error: "Invalid invoice request" }, { status: 400 });
    }

    const [customer, settings, jobs] = await Promise.all([
      prisma.customer.findFirst({ where: { id: customerId, tenantId }, include: { area: true } }),
      getBusinessSettings(),
      prisma.job.findMany({
        where: { id: { in: requestedJobIds }, customerId, tenantId },
        include: {
          workDay: true,
          allocations: {
            where: { payment: { voidedAt: null } },
            select: { amount: true },
          },
        },
        orderBy: { workDay: { date: "asc" } },
      }),
    ]);

    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    if (jobs.length !== requestedJobIds.length) {
      return NextResponse.json({ error: "One or more jobs were not found for this customer" }, { status: 404 });
    }

    const invoiceNumber = claimNumber
      ? await claimNextInvoiceNumber()
      : `${settings.invoicePrefix}-PREVIEW`;

    if (claimNumber && markInvoiced) {
      await prisma.job.updateMany({
        where: { id: { in: requestedJobIds }, customerId, tenantId },
        data: { invoicedAt: new Date(), invoiceNumber },
      });
    }

    const buffer = await renderInvoicePdf(settings, customer, jobs, invoiceNumber);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoiceNumber}.pdf"`,
      },
    });
  } catch (err) {
    console.error("[invoice/pdf]", err);
    return NextResponse.json({ error: "Couldn't make the invoice. Please try again." }, { status: 500 });
  }
}
