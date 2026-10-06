import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import React from "react";
import prisma from "@/lib/db";
import { getBusinessSettings, claimNextInvoiceNumber } from "@/lib/actions";
import { InvoicePDF, InvoiceData } from "@/lib/invoice-pdf";
import { requireMember, hasPermission, AccessDeniedError } from "@/lib/guards";

export const runtime = "nodejs";

function fmtDate(d: Date | string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

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

    // VAT invoice: needs the setting and a VAT number. Prices include VAT, split per line.
    const vatRate = settings.invoiceVatEnabled && settings.vatNumber?.trim() ? Number(settings.invoiceVatRate) || 0 : null;
    const vatOf = (gross: number) => (vatRate == null ? 0 : Math.round((gross - gross / (1 + vatRate / 100)) * 100) / 100);

    const invoiceData: InvoiceData = {
      vat: vatRate == null ? null : {
        rate: vatRate,
        net: Math.round(jobs.reduce((s, j) => s + j.price - vatOf(j.price), 0) * 100) / 100,
        vat: Math.round(jobs.reduce((s, j) => s + vatOf(j.price), 0) * 100) / 100,
      },
      paymentTerms: settings.invoicePaymentTerms?.trim() || "",
      note: settings.tmplInvoiceNote?.trim() || "",
      invoiceNumber,
      invoiceDate: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
      business: {
        name: settings.businessName,
        ownerName: settings.ownerName,
        phone: settings.phone,
        email: settings.email,
        address: settings.address,
        bankDetails: settings.bankDetails,
        vatNumber: settings.vatNumber,
        logoBase64: settings.logoBase64 ?? null,
      },
      customer: {
        name: customer.name,
        address: customer.address,
        email: customer.email,
      },
      jobs: jobs.map((job) => {
        const paid = job.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
        return {
          id: job.id,
          date: fmtDate(job.workDay.date),
          description: `Window cleaning${job.isOneOff ? " (one-off)" : ""}${job.notes ? ` — ${job.notes}` : ""}`,
          price: job.price,
          vat: vatOf(job.price),
          paid,
        };
      }),
      subtotal: jobs.reduce((s, j) => s + j.price, 0),
      totalPaid: jobs.reduce((sum, job) => sum + job.allocations.reduce((paid, allocation) => paid + allocation.amount, 0), 0),
      amountDue: jobs.reduce((s, j) => {
        const paid = j.allocations.reduce((paidSum, allocation) => paidSum + allocation.amount, 0);
        return s + Math.max(0, j.price - paid);
      }, 0),
    };

    const buffer = await renderToBuffer(
      React.createElement(InvoicePDF, { data: invoiceData }) as React.ReactElement<DocumentProps>
    );

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
