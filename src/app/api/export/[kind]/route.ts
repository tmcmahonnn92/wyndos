import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { AccessDeniedError, requireOwner } from "@/lib/guards";

/** Owner-only CSV exports (open in Excel / Google Sheets). */

const KINDS = ["customers", "jobs", "history", "finances"] as const;
type Kind = (typeof KINDS)[number];

function csv(rows: Array<Array<string | number | boolean | null | undefined>>) {
  const cell = (value: string | number | boolean | null | undefined) => {
    let text = value === null || value === undefined ? "" : String(value);
    // Stop Excel treating a customer's name or note as a formula (=, +, -, @).
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  // BOM so Excel reads £ correctly.
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const gbp = (n: number) => n.toFixed(2);

async function build(kind: Kind, tenantId: number) {
  if (kind === "customers") {
    const customers = await prisma.customer.findMany({
      where: { tenantId },
      include: {
        area: { select: { name: true } },
        tags: { select: { tag: { select: { name: true } } } },
        jobs: { where: { status: "COMPLETE" }, select: { price: true, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } } },
      },
      orderBy: [{ area: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    });
    return csv([
      ["Name", "House no./name", "Street", "Town", "Postcode", "Address", "Area", "Price", "Every (weeks)", "Next due", "Last cleaned",
        "Phone", "Email", "Usually pays", "Slip", "Advance notice", "Active", "Quote only", "Tags", "Owes", "Notes"],
      ...customers.map((c) => [
        c.name, c.houseNameNumber, c.street, c.town, c.postcode, c.address, c.area?.name, gbp(c.price), c.frequencyWeeks,
        day(c.nextDueDate), day(c.lastCompletedDate), c.phone, c.email, c.preferredPaymentMethod, c.slip ? "Yes" : "No",
        c.advanceNotice ? "Yes" : "No", c.active ? "Yes" : "No", c.isProspect ? "Yes" : "No",
        c.tags.map((t) => t.tag.name).join("; "),
        gbp(c.jobs.reduce((s, j) => s + Math.max(0, j.price - j.allocations.reduce((a, x) => a + x.amount, 0)), 0)),
        c.notes,
      ]),
    ]);
  }

  if (kind === "jobs" || kind === "history") {
    const jobs = await prisma.job.findMany({
      where: { tenantId, status: kind === "jobs" ? "PENDING" : { not: "PENDING" } },
      include: {
        workDay: { select: { date: true, area: { select: { name: true } }, assignedUser: { select: { name: true, email: true } } } },
        customer: { select: { name: true, address: true } },
        assignedUser: { select: { name: true, email: true } },
        completedBy: { select: { name: true, email: true } },
        allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
      },
      orderBy: [{ workDay: { date: kind === "jobs" ? "asc" : "desc" } }, { sortOrder: "asc" }],
    });
    const who = (u: { name: string | null; email: string } | null | undefined) => u?.name || u?.email || "";
    if (kind === "jobs") {
      return csv([
        ["Date", "Area", "Customer", "Address", "Job", "Price", "Worker", "Quote visit", "Notes"],
        ...jobs.map((j) => [
          day(j.workDay.date), j.workDay.area?.name, j.customer.name, j.customer.address, j.name, gbp(j.price),
          who(j.assignedUser ?? j.workDay.assignedUser), j.isQuote ? "Yes" : "No", j.notes,
        ]),
      ]);
    }
    return csv([
      ["Date", "Completed at", "Area", "Customer", "Address", "Job", "Price", "Status", "Done by", "Paid", "Owes", "Notes"],
      ...jobs.map((j) => {
        const paid = j.allocations.reduce((s, a) => s + a.amount, 0);
        return [
          day(j.workDay.date), j.completedAt ? j.completedAt.toISOString().slice(0, 16).replace("T", " ") : "", j.workDay.area?.name,
          j.customer.name, j.customer.address, j.name, gbp(j.price), j.status, who(j.completedBy), gbp(paid),
          j.status === "COMPLETE" ? gbp(Math.max(0, j.price - paid)) : "", j.notes,
        ];
      }),
    ]);
  }

  const [payments, expenses, income] = await Promise.all([
    prisma.payment.findMany({ where: { tenantId }, include: { customer: { select: { name: true } } }, orderBy: { paidAt: "desc" } }),
    prisma.expense.findMany({ where: { tenantId }, orderBy: { expenseDate: "desc" } }),
    prisma.otherIncome.findMany({ where: { tenantId }, orderBy: { receivedAt: "desc" } }),
  ]);
  const rows: Array<{ date: Date; row: Array<string | number | null> }> = [
    ...payments.map((p) => ({ date: p.paidAt, row: [day(p.paidAt), "Customer payment", p.customer.name, "", p.method, gbp(p.amount), "", "", p.voidedAt ? "Yes" : "No", p.notes] })),
    ...expenses.map((e) => ({ date: e.expenseDate, row: [day(e.expenseDate), "Expense", e.supplier, e.category, "", gbp(-e.amount), gbp(-e.netAmount), gbp(-e.vatAmount), "No", e.notes] })),
    ...income.map((i) => ({ date: i.receivedAt, row: [day(i.receivedAt), "Other income", i.source, i.category, "", gbp(i.amount), gbp(i.netAmount), gbp(i.vatAmount), "No", i.notes] })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
  return csv([
    ["Date", "Type", "Customer / supplier", "Category", "Method", "Amount", "Net", "VAT", "Voided", "Notes"],
    ...rows.map((r) => r.row),
  ]);
}

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!KINDS.includes(kind as Kind)) return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  try {
    const actor = await requireOwner();
    const body = await build(kind as Kind, actor.tenantId);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="wyndos-${kind}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (issue) {
    if (issue instanceof AccessDeniedError) return NextResponse.json({ error: "Only the owner can export." }, { status: 403 });
    throw issue;
  }
}
