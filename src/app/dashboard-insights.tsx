import Link from "next/link";
import { BarChart3, CalendarRange, PoundSterling, TrendingUp, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtCurrency } from "@/lib/utils";
import type { DashboardInsights as Insights } from "@/lib/insights";

const whole = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

// Projected money uses the same blue as cleaned money, drawn hatched, so the two read as
// one measure (done vs still to come) without relying on colour alone.
const HATCH = "repeating-linear-gradient(135deg, #2563eb 0 2px, rgba(37,99,235,0.12) 2px 6px)";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-[#1E2840] dark:bg-[#131929]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function YearChart({ months, currentMonth }: { months: Insights["thisYear"]["months"]; currentMonth: number }) {
  const max = Math.max(1, ...months.map((m) => m.cleaned + m.projected));
  return (
    <div>
      <div className="flex h-40 items-end gap-1" role="img" aria-label="Money cleaned and projected by month">
        {months.map((m) => {
          const total = m.cleaned + m.projected;
          const cleanedH = (m.cleaned / max) * 100;
          const projectedH = (m.projected / max) * 100;
          return (
            <div key={m.month} className="group relative flex h-full flex-1 flex-col justify-end">
              {/* Tooltip */}
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[11px] text-white shadow group-hover:block">
                <p className="font-semibold">{m.label}: {whole(total)}</p>
                {m.cleaned > 0 && <p>Cleaned {whole(m.cleaned)}</p>}
                {m.projected > 0 && <p>To come {whole(m.projected)}</p>}
              </div>
              {projectedH > 0 && (
                <div className="w-full rounded-t-[4px] border border-blue-600" style={{ height: `${projectedH}%`, background: HATCH }} />
              )}
              {cleanedH > 0 && (
                <div
                  className={projectedH > 0 ? "mt-[2px] w-full bg-blue-600" : "w-full rounded-t-[4px] bg-blue-600"}
                  style={{ height: `${cleanedH}%` }}
                />
              )}
              {total === 0 && <div className="h-px w-full bg-slate-200" />}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 border-t border-slate-200 pt-1">
        {months.map((m) => (
          <span key={m.month} className={`flex-1 text-center text-[10px] ${m.month === currentMonth ? "font-bold text-slate-800 dark:text-slate-100" : "text-slate-400"}`}>
            {m.label.slice(0, 1)}<span className="hidden sm:inline">{m.label.slice(1)}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-slate-600 dark:text-slate-300">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-blue-600" /> Cleaned</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-blue-600" style={{ background: HATCH }} /> Still to come on the schedule</span>
      </div>
    </div>
  );
}

export function DashboardInsights({ data }: { data: Insights }) {
  const { round, thisYear, money, days, workers } = data;
  const agedRows = [
    { label: "Under 30 days", amount: money.aged.d30 },
    { label: "31–60 days", amount: money.aged.d60 },
    { label: "61–90 days", amount: money.aged.d90 },
    { label: "Over 90 days", amount: money.aged.older },
  ];
  const methodTotal = money.methods.reduce((s, m) => s + m.amount, 0);

  return (
    <div className="space-y-5">
      {/* This year */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-1.5"><TrendingUp size={14} className="text-blue-600" /> {data.year} on this schedule</CardTitle>
          <Link href="/accounting" className="text-xs text-blue-600 hover:underline">Accounting</Link>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-3xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">{whole(thisYear.projectedTotal)}</p>
            <p className="text-xs text-slate-500">
              projected for the year: {whole(thisYear.cleanedYtd)} cleaned so far + {whole(thisYear.projectedRest)} still booked or due
            </p>
          </div>
          <YearChart months={thisYear.months} currentMonth={thisYear.currentMonth} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Cleaned this year" value={whole(thisYear.cleanedYtd)} />
            <Stat label="Money in this year" value={whole(thisYear.collectedYtd)} />
            <Stat label="Booked next 4 weeks" value={whole(days.bookedNext28)} />
          </div>
          <p className="text-[11px] text-slate-400">
            Worked out from every area&apos;s booked days, frequency and current prices. It changes as you book, move, split or complete areas.
            {thisYear.openingYtd > 0 && <> Includes {whole(thisYear.openingYtd)} earned before Wyndos (from Accounting).</>}
          </p>
        </CardContent>
      </Card>

      {/* The round */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-1.5"><CalendarRange size={14} className="text-indigo-500" /> Your round</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <Stat label="Worth a year" value={whole(round.runRate)} sub="every customer, at their frequency" />
          <Stat label="Per month" value={whole(round.perMonth)} sub="on average" />
          <Stat label="Average clean" value={fmtCurrency(round.avgPrice)} />
          <Stat label="Active customers" value={String(round.activeCustomers)} sub={`${round.newCustomers90} new in 90 days`} />
        </CardContent>
      </Card>

      {/* Money */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-1.5"><PoundSterling size={14} className="text-amber-500" /> Getting paid</CardTitle>
          <Link href="/messages" className="text-xs text-blue-600 hover:underline">Chase unpaid</Link>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="Paid vs cleaned"
              value={money.collectionRate === null ? "–" : pct(money.collectionRate)}
              sub={`last 90 days: ${whole(money.collected90)} in of ${whole(money.cleaned90)}`}
            />
            <Stat label="Owed" value={whole(money.owedTotal)} sub="across all customers" />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-600">How long it&apos;s been owed</p>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm dark:divide-[#1E2840] dark:border-[#1E2840]">
              {agedRows.map((row, i) => (
                <li key={row.label} className="flex items-center justify-between px-3 py-2">
                  <span className="text-slate-600 dark:text-slate-300">{row.label}</span>
                  <span className={`font-semibold tabular-nums ${i >= 2 && row.amount > 0 ? "text-red-600" : "text-slate-800 dark:text-slate-100"}`}>{whole(row.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
          {methodTotal > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600">How people paid (90 days)</p>
              <div className="space-y-1.5">
                {money.methods.map((m) => (
                  <div key={m.key} className="flex items-center gap-2 text-sm">
                    <span className="w-12 text-slate-600 dark:text-slate-300">{m.label}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-[#1E2840]">
                      <div className="h-full rounded-full bg-blue-600" style={{ width: `${(m.amount / methodTotal) * 100}%` }} />
                    </div>
                    <span className="w-20 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">{whole(m.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Days */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-1.5"><BarChart3 size={14} className="text-green-600" /> Last 4 weeks</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Days worked" value={String(days.workingDays)} />
          <Stat label="Money per day" value={whole(days.perDay)} sub="cleaned, on days worked" />
          <Stat label="Houses per day" value={String(days.jobsPerDay)} />
          <Stat label="Cleaned" value={whole(days.value)} sub={`${days.jobs} houses`} />
          <Stat label="Skipped" value={pct(days.skipRate)} sub="of visits" />
        </CardContent>
      </Card>

      {/* Team */}
      {workers.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-1.5"><Users size={14} className="text-indigo-500" /> Who did what (30 days)</CardTitle>
            <Link href="/reports/workers" className="text-xs text-blue-600 hover:underline">Pay report</Link>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:border-[#1E2840]">
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-2 py-2 text-right font-medium">Days</th>
                  <th className="px-2 py-2 text-right font-medium">Houses</th>
                  <th className="px-2 py-2 text-right font-medium">Cleaned</th>
                  <th className="px-2 py-2 text-right font-medium">Per day</th>
                  <th className="px-2 py-2 text-right font-medium">Cash in</th>
                  <th className="px-4 py-2 text-right font-medium">Skipped</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1E2840]">
                {workers.map((w) => (
                  <tr key={w.id}>
                    <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{w.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{w.days}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{w.jobs}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{whole(w.value)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{whole(w.perDay)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{whole(w.cash)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{w.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
