import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getWorkDay, getWorkDaysOnDate } from "@/lib/actions";
import { getActiveUserContext } from "@/lib/tenant-context";
import { buildRunSheet, runSheetDateLabel } from "@/lib/run-sheet";
import { RunSheetPDF } from "@/lib/run-sheet-pdf";
import { preferenceLabel } from "@/lib/payment-preference";
import { fmtCurrency } from "@/lib/utils";

export const runtime = "nodejs";

/** PDF run sheet for sharing: ?day=ID (one area) or ?date=YYYY-MM-DD (whole day), &sort=street, &worker=ID|me. */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const user = await getActiveUserContext();
    const hidePrices = user.role === "WORKER" && !(user.permissions ?? []).includes("viewprices");
    const dayId = Number(params.get("day"));
    const date = params.get("date");
    const days = dayId
      ? [await getWorkDay(dayId)].filter((d): d is NonNullable<typeof d> => Boolean(d))
      : date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? await getWorkDaysOnDate(date)
      : [];
    if (days.length === 0) return NextResponse.json({ error: "Day not found" }, { status: 404 });
    const dateISO = new Date(days[0].date).toISOString().slice(0, 10);
    const sheet = buildRunSheet(days, {
      sort: params.get("sort") === "street" ? "street" : "area",
      worker: params.get("worker"),
      viewer: { id: user.id, name: user.name },
    });
    const rows = sheet.jobs.map((job, i) => {
      const debt = sheet.owes(job);
      return {
        n: i + 1,
        name: job.customer.name,
        address: job.customer.address,
        area: sheet.multi ? sheet.areaName(job) : null,
        phone: job.customer.phone ?? "",
        job: job.name && job.name !== "Window Cleaning" && !job.isQuote ? job.name : null,
        quote: Boolean(job.isQuote),
        price: fmtCurrency(job.price),
        owes: debt > 0.005 ? fmtCurrency(debt) : null,
        usually: preferenceLabel(job.customer.preferredPaymentMethod, "short") || "",
        slip: job.customer.slip === false ? "No" : "Yes",
        notes: [job.customer.notes, job.notes ? `This visit: ${job.notes}` : ""].filter(Boolean).join(" / "),
        done: job.status === "COMPLETE",
      };
    });
    const subtitle = [
      `${sheet.jobs.length} job${sheet.jobs.length === 1 ? "" : "s"}`,
      hidePrices ? null : fmtCurrency(sheet.total),
      sheet.peopleLabel ? `${sheet.workerName ? "For " : ""}${sheet.peopleLabel}` : null,
    ].filter(Boolean).join(" · ");
    const buffer = await renderToBuffer(
      RunSheetPDF({
        title: `${runSheetDateLabel(dateISO)} — ${sheet.title}`,
        subtitle,
        rows,
        showPrices: !hidePrices,
        total: fmtCurrency(sheet.total),
      }),
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="run-sheet-${dateISO}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (issue) {
    console.error("[run-sheet pdf]", issue);
    return NextResponse.json({ error: "Could not make the PDF." }, { status: 500 });
  }
}
