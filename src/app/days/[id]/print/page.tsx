import { notFound } from "next/navigation";
import { getWorkDay } from "@/lib/actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { fmtCurrency } from "@/lib/utils";
import { PrintButton } from "./print-button";
import { preferenceLabel } from "@/lib/payment-preference";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * A4 run sheet for a day: route order, price, how they pay, slip, full notes,
 * and boxes to tick and write cash in. Works as a paper backup with no signal,
 * or for a worker who doesn't use the app. Workers only see their own jobs.
 */
export default async function PrintDayPage({ params }: Props) {
  await requirePermission("schedule");
  const user = await getActiveUserContext();
  const hidePrices = user.role === "WORKER" && !(user.permissions ?? []).includes("viewprices");
  const { id } = await params;
  const day = await getWorkDay(Number(id));
  if (!day) notFound();

  const jobs = day.jobs.filter((job) => job.status !== "MOVED");
  const total = jobs.reduce((sum, job) => sum + job.price, 0);
  const dateLabel = new Date(day.date).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const worker = day.assignedUser?.name ?? day.assignedUser?.email ?? null;

  const owes = (job: (typeof jobs)[number]) =>
    job.customer.jobs
      .filter((previous) => previous.id !== job.id)
      .reduce((sum, previous) => {
        const paid = previous.allocations.reduce((s, allocation) => s + allocation.amount, 0);
        return sum + Math.max(0, previous.price - paid);
      }, 0);

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
          <h1 className="text-xl font-bold">{day.area?.name ?? "Round"} — {dateLabel}</h1>
          <p className="text-sm text-slate-600">
            {jobs.length} job{jobs.length === 1 ? "" : "s"}
            {!hidePrices && ` · ${fmtCurrency(total)}`}
            {worker && ` · ${worker}`}
          </p>
        </div>
        <PrintButton />
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
                  <div className="font-semibold">{job.customer.name}</div>
                  {job.customer.address && job.customer.address !== job.customer.name && (
                    <div className="text-slate-600">{job.customer.address}</div>
                  )}
                  {title && <div className="text-slate-600">{title}</div>}
                  {job.customer.phone && <div className="text-slate-600">{job.customer.phone}</div>}
                </td>
                {!hidePrices && (
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {fmtCurrency(job.price)}
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
