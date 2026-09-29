import { fmtCurrency } from "@/lib/utils";
import { preferenceLabel } from "@/lib/payment-preference";
import { buildRunSheet, runSheetDateLabel } from "@/lib/run-sheet";
import type { getWorkDay } from "@/lib/actions";
import { PrintButton } from "./[id]/print/print-button";

type Day = NonNullable<Awaited<ReturnType<typeof getWorkDay>>>;

/**
 * A4 run sheet: route order (or by street), price, how they pay, slip, full notes,
 * and boxes to tick and write cash in. Works as a paper backup with no signal,
 * or for a worker who doesn't use the app. Workers only see their own jobs.
 */
export function PrintSheet({
  days,
  dateISO,
  hidePrices,
  sort,
  backHref,
  worker = null,
  viewer,
  pdfHref,
}: {
  days: Day[];
  dateISO: string;
  hidePrices: boolean;
  sort: "area" | "street";
  backHref: string;
  /** Only this person's jobs ("me" = the viewer). */
  worker?: string | null;
  viewer: { id: string; name?: string | null };
  pdfHref: string;
}) {
  const sheet = buildRunSheet(days, { sort, worker, viewer });
  const { jobs, total, multi, title, owes } = sheet;
  const dateLabel = runSheetDateLabel(dateISO);
  const areaOf = { get: (id: number) => days.find((d) => d.id === id)?.area?.name ?? "One-off" };
  const workers = sheet.peopleLabel ? [sheet.peopleLabel] : [];

  return (
    <div className="print-sheet mx-auto max-w-4xl bg-white px-4 py-5 text-slate-900 print:max-w-none print:px-0 print:py-0">
      <style>{`
        @page { size: A4 portrait; margin: 12mm; }
        @media print {
          body { background: #fff !important; }
          .print-sheet tr { break-inside: avoid; page-break-inside: avoid; }
          .print-sheet thead { display: table-header-group; }
        }
      `}</style>

      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{dateLabel}</h1>
          <p className="text-sm font-semibold">{title}{sort === "street" ? " · by street" : ""}</p>
          <p className="text-sm text-slate-600">
            {jobs.length} job{jobs.length === 1 ? "" : "s"}
            {!hidePrices && ` · ${fmtCurrency(total)}`}
            {workers.length > 0 && ` · ${sheet.workerName ? "For " : ""}${workers.join(", ")}`}
          </p>
        </div>
        <PrintButton backHref={backHref} pdfHref={pdfHref} fileName={`run-sheet-${dateISO}${sheet.workerName ? `-${sheet.workerName}` : ""}.pdf`} />
      </div>

      <table className="w-full border-collapse text-[12px] leading-snug">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left">
            <th className="w-6 py-1 pr-1">#</th>
            <th className="py-1 pr-2">Customer / address</th>
            {!hidePrices && <th className="w-14 py-1 pr-2 text-right">Price</th>}
            <th className="w-14 py-1 pr-2">Usually</th>
            <th className="w-10 py-1 pr-2">Slip</th>
            <th className="py-1 pr-2">Notes</th>
            <th className="w-10 py-1 pr-2 text-center">Done</th>
            <th className="w-16 py-1 text-center">Cash £</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job, index) => {
            const debt = owes(job);
            const notes = [job.notes, job.customer.notes].filter(Boolean).join(" · ");
            const title = job.name && job.name !== "Window Cleaning" ? job.name : null;
            return (
              <tr key={job.id} className="border-b border-slate-300 align-top">
                <td className="py-1.5 pr-1 font-semibold">{index + 1}</td>
                <td className="py-1.5 pr-2">
                  <div className="font-semibold">
                    {job.customer.name}
                    {multi && <span className="ml-1 font-normal text-slate-500">[{areaOf.get(job.workDayId)}]</span>}
                  </div>
                  {job.customer.address && job.customer.address !== job.customer.name && (
                    <div className="text-slate-600">{job.customer.address}</div>
                  )}
                  {title && !job.isQuote && <div className="text-slate-600">{title}</div>}
                  {job.isQuote && <div className="font-semibold">QUOTE VISIT — price: £______ every ____ weeks</div>}
                  {job.customer.phone && <div className="text-slate-600">{job.customer.phone}</div>}
                </td>
                {!hidePrices && (
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {job.isQuote ? <strong>QUOTE</strong> : fmtCurrency(job.price)}
                    {debt > 0.005 && <div className="text-[10px] font-semibold">owes {fmtCurrency(debt)}</div>}
                  </td>
                )}
                <td className="py-1.5 pr-2">{preferenceLabel(job.customer.preferredPaymentMethod, "short")}</td>
                <td className="py-1.5 pr-2">{job.customer.slip === false ? "No" : "Yes"}</td>
                <td className="py-1.5 pr-2 whitespace-pre-wrap">{notes}</td>
                <td className="py-1.5 pr-2 text-center text-base">{job.status === "COMPLETE" ? "☑" : "☐"}</td>
                <td className="py-1.5 text-center text-slate-400">______</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-5 grid grid-cols-2 gap-6 text-sm">
        <div className="space-y-3">
          {!hidePrices && <p><span className="font-semibold">Day total:</span> {fmtCurrency(total)}</p>}
          <p><span className="font-semibold">Cash collected:</span> £__________</p>
        </div>
        <div>
          <p className="font-semibold">Not done / why:</p>
          <div className="mt-2 space-y-4">
            <div className="border-b border-slate-400" />
            <div className="border-b border-slate-400" />
            <div className="border-b border-slate-400" />
          </div>
        </div>
      </div>
    </div>
  );
}
