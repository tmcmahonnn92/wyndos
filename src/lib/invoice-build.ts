import "server-only";
import React from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { InvoicePDF, type InvoiceData } from "@/lib/invoice-pdf";
import { flattenLogo } from "@/lib/logo-image";

type Settings = {
  businessName: string; ownerName?: string | null; phone?: string | null; email?: string | null; address?: string | null;
  bankDetails?: string | null; vatNumber?: string | null; invoiceVatEnabled?: boolean | null; invoiceVatRate?: number | null;
  invoicePaymentTerms?: string | null; tmplInvoiceNote?: string | null; logoBase64?: string | null;
};
type Customer = { name: string; address: string | null; email: string | null };
type Job = { id: number; price: number; isOneOff: boolean; notes: string | null; workDay: { date: Date }; allocations: Array<{ amount: number }> };

const fmtDate = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** The invoice PDF for some of a customer's cleans (used by the download and by emailed invoices). */
export async function renderInvoicePdf(settings: Settings, customer: Customer, jobs: Job[], invoiceNumber: string): Promise<Buffer> {
  // VAT invoice: needs the setting and a VAT number. Prices include VAT, split per line.
  const vatRate = settings.invoiceVatEnabled && settings.vatNumber?.trim() ? Number(settings.invoiceVatRate) || 0 : null;
  const vatOf = (gross: number) => (vatRate == null ? 0 : Math.round((gross - gross / (1 + vatRate / 100)) * 100) / 100);
  const paidOf = (j: Job) => j.allocations.reduce((s, a) => s + a.amount, 0);

  const data: InvoiceData = {
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
      ownerName: settings.ownerName ?? "",
      phone: settings.phone ?? "",
      email: settings.email ?? "",
      address: settings.address ?? "",
      bankDetails: settings.bankDetails ?? "",
      vatNumber: settings.vatNumber ?? "",
      logoBase64: await flattenLogo(settings.logoBase64),
    },
    customer: { name: customer.name, address: customer.address ?? "", email: customer.email ?? "" },
    jobs: jobs.map((job) => ({
      id: job.id,
      date: fmtDate(job.workDay.date),
      description: `Window cleaning${job.isOneOff ? " (one-off)" : ""}${job.notes ? ` — ${job.notes}` : ""}`,
      price: job.price,
      vat: vatOf(job.price),
      paid: paidOf(job),
    })),
    subtotal: jobs.reduce((s, j) => s + j.price, 0),
    totalPaid: jobs.reduce((s, j) => s + paidOf(j), 0),
    amountDue: jobs.reduce((s, j) => s + Math.max(0, j.price - paidOf(j)), 0),
  };
  return renderToBuffer(React.createElement(InvoicePDF, { data }) as React.ReactElement<DocumentProps>);
}
