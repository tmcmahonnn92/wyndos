import Link from "next/link";
import { redirect } from "next/navigation";
import { getWorkerReport } from "@/lib/actions";
import { getActiveUserContext } from "@/lib/tenant-context";
import { Card, CardContent } from "@/components/ui/card";
import { fmtCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ from?: string; to?: string }>;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function thisWeek() {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

/** Owner-only: what each worker did in a date range, for day-rate or percentage pay. */
export default async function WorkerReportPage({ searchParams }: Props) {
  const user = await getActiveUserContext();
  if (user.role !== "OWNER" && user.role !== "SUPER_ADMIN") redirect("/");

  const params = await searchParams;
  const week = thisWeek();
  const from = params.from && ISO.test(params.from) ? params.from : week.from;
  const to = params.to && ISO.test(params.to) ? params.to : week.to;
  const rows = await getWorkerReport(from, to);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Worker pay report</h1>
        <p className="text-sm text-slate-500">Days worked and value of jobs completed. Use it for a day rate or a percentage.</p>
      </div>

      <form className="flex flex-wrap items-end gap-2" method="get">
        <label className="text-xs font-medium text-slate-600">
          From
          <input type="date" name="from" defaultValue={from} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          To
          <input type="date" name="to" defaultValue={to} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white">Show</button>
        <Link href="/reports/workers" className="px-2 py-2 text-sm text-blue-600">This week</Link>
      </form>

      <div className="space-y-3">
        {rows.map((row) => (
          <Card key={row.userId}>
            <CardContent className="space-y-2 py-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-800">{row.name}</p>
                <span className="text-xs uppercase tracking-wide text-slate-400">{row.role === "OWNER" ? "Owner" : "Worker"}</span>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-slate-500">Days worked</dt><dd className="font-bold">{row.daysWorked}</dd></div>
                <div><dt className="text-xs text-slate-500">Jobs done</dt><dd className="font-bold">{row.jobsCompleted}</dd></div>
                <div><dt className="text-xs text-slate-500">Value done</dt><dd className="font-bold">{fmtCurrency(row.valueCompleted)}</dd></div>
                <div><dt className="text-xs text-slate-500">Cash collected</dt><dd className="font-bold">{fmtCurrency(row.cashCollected)}</dd></div>
              </dl>
              {row.dates.length > 0 && (
                <p className="text-xs text-slate-500">
                  {row.dates.map((date) => new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })).join(" · ")}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
