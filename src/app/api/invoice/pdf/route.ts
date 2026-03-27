import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import React from "react";
import prisma from "@/lib/db";
import { getBusinessSettings, claimNextInvoiceNumber } from "@/lib/actions";
import { InvoicePDF, InvoiceData } from "@/lib/invoice-pdf";
import { getActiveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";

function fmtDate(d: Date | string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { customerId: number; jobIds: number[]; claimNumber?: boolean };
    const { customerId, jobIds, claimNumber = true } = body;
    const tenantId = await getActiveTenantId();
    const requestedJobIds = [...new Set(jobIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];

    if (!Number.isInteger(customerId) || customerId <= 0 || requestedJobIds.length === 0) {
      return NextResponse.json({ error: "Invalid invoice request" }, { status: 400 });
    }

    const [customer, settings, jobs] = await Promise.all([
      prisma.customer.findFirst({ where: { id: customerId, tenantId }, include: { area: true } }),
      getBusinessSettings(),
      prisma.job.findMany({
        where: { id: { in: requestedJobIds }, customerId, tenantId },
        include: { workDay: true, payments: true },
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

    const invoiceData: InvoiceData = {
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
        const paid = job.payments.reduce((s, p) => s + p.amount, 0);
        return {
          id: job.id,
          date: fmtDate(job.workDay.date),
          description: `Window cleaning${job.isOneOff ? " (one-off)" : ""}${job.notes ? ` — ${job.notes}` : ""}`,
          price: job.price,
          paid,
        };
      }),
      subtotal: jobs.reduce((s, j) => s + j.price, 0),
      totalPaid: jobs.reduce((s, j) => s + j.payments.reduce((ps, p) => ps + p.amount, 0), 0),
      amountDue: jobs.reduce((s, j) => {
        const paid = j.payments.reduce((ps, p) => ps + p.amount, 0);
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
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
