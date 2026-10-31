import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { AccessDeniedError, requirePerm } from "@/lib/guards";

export const dynamic = "force-dynamic";

/**
 * Payments export (CSV for Excel / Google Sheets): who paid, when, how much, how, and what for.
 * GET /api/export/payments?from=YYYY-MM-DD&to=YYYY-MM-DD&method=ALL|CASH|BACS|CARD|DD&area=<id>&worker=<userId>&refunds=1&pending=1 (add Direct Debits on their way)
 * GET /api/export/payments?options=1 → the areas and people to filter by.
 */

function csv(rows: Array<Array<string | number | null | undefined>>) {
  const cell = (value: string | number | null | undefined) => {
    let text = value === null || value === undefined ? "" : String(value);
    // Stop Excel treating a name or note as a formula.
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const gbp = (n: number) => n.toFixed(2);
const ukDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

export async function GET(request: Request) {
  try {
    const actor = await requirePerm("payments");
    const tenantId = actor.tenantId;
    const q = new URL(request.url).searchParams;

    if (q.get("options")) {
      const [areas, members] = await Promise.all([
        prisma.area.findMany({ where: { tenantId, isSystemArea: false }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
        prisma.membership.findMany({ where: { tenantId }, select: { user: { select: { id: true, name: true, email: true } } } }),
      ]);
      return NextResponse.json({ areas, people: members.map((m) => ({ id: m.user.id, name: m.user.name || m.user.email })) });
    }

    const from = isoDay.test(q.get("from") ?? "") ? new Date(`${q.get("from")}T00:00:00.000Z`) : null;
    const toDay = isoDay.test(q.get("to") ?? "") ? new Date(`${q.get("to")}T00:00:00.000Z`) : null;
    const to = toDay ? new Date(toDay.getTime() + 86_400_000) : null; // up to the end of that day
    const method = q.get("method") ?? "ALL";
    const areaId = Number(q.get("area")) || null;
    const worker = q.get("worker") || null;
    const withRefunds = q.get("refunds") !== "0";
    const withPending = q.get("pending") === "1" && (method === "ALL" || method === "DD") && !worker;

    const payments = await prisma.payment.findMany({
      where: {
        tenantId,
        voidedAt: null,
        broughtForward: false, // credit carried over / added by hand isn't money received
        ...(from || to ? { paidAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
        ...(method === "CASH" || method === "CARD" ? { method } : {}),
        ...(method === "BACS" ? { method: "BACS", goCardlessPaymentId: null } : {}),
        ...(method === "DD" ? { goCardlessPaymentId: { not: null } } : {}),
        ...(areaId ? { customer: { areaId } } : {}),
        ...(worker ? { collectedByUserId: worker } : {}),
        ...(withRefunds ? {} : { amount: { gt: 0 } }),
      },
      select: {
        id: true, amount: true, method: true, paidAt: true, notes: true, refundOfId: true,
        goCardlessPaymentId: true, goCardlessReference: true, collectedByUserId: true,
        customer: { select: { name: true, address: true, area: { select: { name: true } } } },
        allocations: { select: { amount: true, job: { select: { name: true, workDay: { select: { date: true } } } } } },
      },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }],
      take: 20000,
    });

    const userIds = [...new Set(payments.map((p) => p.collectedByUserId).filter((id): id is string => Boolean(id)))];
    const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name || u.email]));
    const how = (p: (typeof payments)[number]) => p.notes?.startsWith("Pay by Bank") ? "Pay by Bank" : p.goCardlessPaymentId ? "Direct Debit" : p.method === "CASH" ? "Cash" : p.method === "CARD" ? "Card" : "Bank transfer";

    let total = 0;
    const rows = payments.map((p) => {
      total += p.amount;
      const onCleans = p.allocations.filter((a) => Math.abs(a.amount) > 0.004);
      const used = onCleans.reduce((s, a) => s + a.amount, 0);
      const spare = p.amount > 0 ? p.amount - used : 0;
      const paidFor = [
        ...onCleans.map((a) => `${a.job.name || "Window Cleaning"} ${ukDate(a.job.workDay.date)} £${gbp(Math.abs(a.amount))}`),
        ...(spare > 0.004 ? [`£${gbp(spare)} credit`] : []),
      ].join("; ");
      return [
        ukDate(p.paidAt), p.customer.name, p.customer.address, p.customer.area?.name ?? "",
        how(p), gbp(p.amount), p.amount < 0 || p.refundOfId ? "Refund" : "Payment",
        paidFor, p.collectedByUserId ? users.get(p.collectedByUserId) ?? "" : "",
        p.goCardlessReference || p.goCardlessPaymentId || "", p.notes ?? "",
      ];
    });

    // Direct Debits on their way (taken, not failed, not yet paid): every one, whatever the dates,
    // listed after the payments and not in the total. Date = when GoCardless expects to take it.
    const pendingRows: Array<Array<string>> = [];
    let pendingTotal = 0;
    if (withPending) {
      const jobs = await prisma.job.findMany({
        where: {
          tenantId,
          goCardlessPaymentId: { not: null },
          NOT: { goCardlessStatus: { in: ["failed", "cancelled", "customer_approval_denied", "charged_back"] } },
          ...(areaId ? { customer: { areaId } } : {}),
        },
        select: {
          name: true, price: true, goCardlessPaymentId: true, goCardlessStatus: true, goCardlessChargeDate: true,
          workDay: { select: { date: true } },
          customer: { select: { name: true, address: true, area: { select: { name: true } } } },
          allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } },
        },
        orderBy: [{ goCardlessChargeDate: "asc" }, { id: "asc" }],
        take: 20000,
      });
      const STATUS: Record<string, string> = { pending_customer_approval: "Waiting for customer", pending_submission: "Waiting to go to the bank", submitted: "Sent to the bank", confirmed: "Collected, being paid out", retrying: "Being retried" };
      for (const j of jobs) {
        const due = Math.max(0, j.price - j.allocations.reduce((sum, a) => sum + a.amount, 0));
        if (due < 0.005) continue; // already recorded as paid
        pendingTotal += due;
        pendingRows.push([
          j.goCardlessChargeDate ? ukDate(j.goCardlessChargeDate) : "", j.customer.name, j.customer.address, j.customer.area?.name ?? "",
          "Direct Debit", gbp(due), "Pending Direct Debit",
          `${j.name || "Window Cleaning"} ${ukDate(j.workDay.date)}`, "", j.goCardlessPaymentId ?? "", STATUS[j.goCardlessStatus ?? ""] ?? (j.goCardlessStatus ?? ""),
        ]);
      }
    }

    const body = csv([
      ["Date paid", "Customer", "Address", "Area", "How paid", "Amount (£)", "Type", "What it paid for", "Taken by", "Reference", "Notes"],
      ...rows,
      [],
      ["Total", `${rows.length} payment${rows.length === 1 ? "" : "s"}`, "", "", "", gbp(total)],
      ...(withPending ? [
        [],
        ["Direct Debits on their way (not paid yet, not in the total above). Date = expected collection date."],
        ...pendingRows,
        [],
        ["Pending total", `${pendingRows.length} Direct Debit${pendingRows.length === 1 ? "" : "s"}`, "", "", "", gbp(pendingTotal)],
      ] : []),
    ]);
    const name = `wyndos-payments-${q.get("from") || "start"}-to-${q.get("to") || new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(body, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
    });
  } catch (issue) {
    if (issue instanceof AccessDeniedError) return NextResponse.json({ error: "You don't have access to payments." }, { status: 403 });
    throw issue;
  }
}
