"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Car, CheckCircle2, ChevronDown, ChevronUp, Download, Home, Loader2, Lock, Package, Trash2, Unlock } from "lucide-react";
import { HMRC_EXPENSE_CATEGORIES } from "@/lib/accounting";
import { HMRC_EXPENSE_FIELDS, homeRate, mileageRate } from "@/lib/mtd/calc";
import {
  addMileageTrip, deleteAsset, deleteMileageTrip, getMtdTransactions, lockQuarter, saveAsset, saveVehicle, setAccountsSettings,
  setHomeHours, unlockQuarter, type getMtdOverview,
} from "@/lib/mtd/actions";
import { cn, fmtCurrency } from "@/lib/utils";

type Overview = Awaited<ReturnType<typeof getMtdOverview>>;
type Tab = "quarters" | "vehicles" | "home" | "assets" | "settings";
const LABEL = Object.fromEntries(HMRC_EXPENSE_CATEGORIES.map((c) => [c.key, c.label])) as Record<string, string>;
const STATUS: Record<string, [string, string]> = {
  submitted: ["Submitted", "bg-green-100 text-green-800"],
  ready: ["Ready to send", "bg-blue-100 text-blue-800"],
  overdue: ["Overdue", "bg-red-100 text-red-800"],
  open: ["In progress", "bg-slate-100 text-slate-700"],
  future: ["Not started", "bg-slate-50 text-slate-400"],
};
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const today = () => new Date().toISOString().slice(0, 10);

export function MtdClient({ overview, isOwner, initialTab }: { overview: Overview; isOwner: boolean; initialTab: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<Tab>((["quarters", "vehicles", "home", "assets", "settings"].includes(initialTab) ? initialTab : "quarters") as Tab);
  const [open, setOpen] = useState<number | null>(overview.periods.find((p) => p.status === "ready" || p.status === "overdue" || p.status === "open")?.index ?? 1);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [exporting, setExporting] = useState(false);
  const { periods, year, allowances, settings } = overview;

  const act = (fn: () => Promise<unknown>) => start(async () => {
    setError(null);
    try {
      const res = await fn() as { ok?: boolean; error?: string } | undefined;
      if (res && res.ok === false) setError(res.error ?? "Something went wrong.");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
  });
  const goYear = (y: number) => router.push(`${pathname}?year=${y}&tab=${tab}`);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const tx = await getMtdTransactions(overview.taxYear);
      const book = XLSX.utils.book_new();
      const fieldRows = (pick: (p: (typeof periods)[number]) => (typeof periods)[number]["period"]) => [
        ["HMRC field", "Description", ...periods.map((p) => `Q${p.index} ${p.start} to ${p.end}`)],
        ["turnover", "Turnover, takings, fees, sales", ...periods.map((p) => pick(p).turnover)],
        ["other", "Other business income", ...periods.map((p) => pick(p).other)],
        ...HMRC_EXPENSE_FIELDS.map((f) => [f, LABEL[f], ...periods.map((p) => pick(p).expenses[f])]),
        ...HMRC_EXPENSE_FIELDS.map((f) => [`${f}Disallowable`, `${LABEL[f]} (disallowable part)`, ...periods.map((p) => pick(p).disallowable[f])]),
        ["consolidatedExpenses", `All allowable expenses in one figure (only if turnover is under £90,000; otherwise use the fields above)`, ...periods.map((p) => pick(p).consolidatedExpenses)],
      ];
      const about = [
        ["Business accounts for Making Tax Digital (Income Tax, self-employment)"],
        ["Tax year", overview.taxYearLabel],
        ["Basis", settings.basis === "CASH" ? "Cash basis" : "Accruals (traditional)"],
        ["Quarterly periods", settings.periodType === "CALENDAR" ? "Calendar quarters" : "Standard quarters (6 April)"],
        ["VAT registered", settings.vatRegistered ? "Yes: figures exclude VAT" : "No: figures include VAT"],
        ["Exported", new Date().toLocaleString("en-GB")],
        [],
        ["Sheets"],
        ["Cumulative", "Year-to-date totals per HMRC field at the end of each quarter. Quarterly updates are cumulative: send these."],
        ["By quarter", "The same fields for each quarter on its own."],
        ["Year end", "Capital allowances and adjustments for the end-of-year summary."],
        ["Transactions", "Every entry behind the figures."],
        ["Mileage, Use of home, Assets", "Simplified expenses and assets."],
        [],
        ["Expense fields include any private part; the matching …Disallowable field holds that part. Check figures with your accountant."],
      ];
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(about), "About");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(fieldRows((p) => p.cumulative)), "Cumulative");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(fieldRows((p) => p.period)), "By quarter");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
        ["HMRC field", "Description", "Amount"],
        ["annualInvestmentAllowance", "Annual Investment Allowance", allowances.annualInvestmentAllowance],
        ["capitalAllowanceMainPool", "Main pool writing-down allowance (18%)", allowances.capitalAllowanceMainPool],
        ["capitalAllowanceSpecialRatePool", "Special rate pool writing-down allowance (6%)", allowances.capitalAllowanceSpecialRatePool],
        ["capitalAllowanceSingleAssetPool", "Single asset pools (private use cars)", allowances.capitalAllowanceSingleAssetPool],
        ["zeroEmissionsCarAllowance", "Zero-emission car first-year allowance", allowances.zeroEmissionsCarAllowance],
        ["allowanceOnSales", "Balancing allowance on sales", allowances.allowanceOnSales],
        ["balancingChargeOther", "Balancing charges", allowances.balancingChargeOther],
        [],
        ["Asset", "Pool", "Opening", "Additions", "Claim", "Closing", "Balancing", "Note"],
        ...allowances.assets.map((a) => [a.description, a.pool, a.opening, a.additions, a.claim, a.closing, a.balancing, a.note]),
      ]), "Year end");
      const txRows: Array<Array<string | number>> = [
        ...tx.payments.map((p) => [p.date, "Income: customer payment", `${p.customer} (${p.method})`, "turnover", p.amount, "", "", "", "", ""]),
        ...tx.otherIncome.map((o) => [o.date, "Income: other", o.source || o.category, ["COMMERCIAL", "BONUS", "OPENING"].includes(o.category) ? "turnover" : "other", o.amount, o.vat, o.net, "", "", ""]),
        ...tx.expenses.map((e) => [e.date, "Expense", e.supplier || e.category, e.hmrcCategory, e.amount, e.vat, e.net, e.businessPct, e.vehicle, e.notes]),
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0])));
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Date", "Type", "Description", "HMRC field", "Gross", "VAT", "Net", "Business %", "Vehicle", "Notes"], ...txRows]), "Transactions");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
        ["Date", "Vehicle", "Business miles", "Notes"],
        ...overview.trips.map((t) => [t.date, overview.vehicles.find((v) => v.id === t.vehicleId)?.name ?? "", t.miles, t.notes]),
        [], ["Total claim (in carVanTravelExpenses)", "", year.mileageClaim],
      ]), "Mileage");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
        ["Month", "Hours worked at home", "Flat rate"],
        ...overview.homeMonths.map((h) => [h.month, h.hours, homeRate(h.hours)]),
        [], ["Total claim (in premisesRunningCosts)", "", year.homeClaim],
      ]), "Use of home");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
        ["Description", "Type", "Bought", "Cost", "Business %", "Sold", "Sale price", "Notes"],
        ...overview.assets.map((a) => [a.description, a.kind === "CAR" ? `Car (${a.carEmissions})` : a.kind === "VAN" ? "Van" : "Equipment", a.boughtAt, a.cost, a.businessPct, a.disposedAt ?? "", a.disposalValue ?? "", a.notes]),
      ]), "Assets");
      XLSX.writeFile(book, `mtd-${overview.taxYearLabel.replace("/", "-")}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    }
    setExporting(false);
  };

  const tabs: Array<[Tab, string]> = [["quarters", "Quarters"], ["vehicles", "Vehicles & mileage"], ["home", "Use of home"], ["assets", "Assets"], ["settings", "Settings"]];
  const yearProfit = year.profit - allowances.total;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select value={overview.taxYear} onChange={(e) => goYear(Number(e.target.value))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium">
            {overview.taxYears.map((y) => <option key={y.value} value={y.value}>Tax year {y.label}</option>)}
          </select>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{settings.basis === "CASH" ? "Cash basis" : "Accruals"} · {settings.periodType === "CALENDAR" ? "calendar quarters" : "standard quarters"}{settings.vatRegistered ? " · excl. VAT" : ""}</span>
        </div>
        <button type="button" onClick={exportXlsx} disabled={exporting} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export for bridging software (Excel)
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Turnover" value={fmtCurrency(year.turnover)} />
        <Stat label="Other income" value={fmtCurrency(year.other)} />
        <Stat label="Allowable expenses" value={fmtCurrency(year.consolidatedExpenses)} />
        <Stat label="Capital allowances" value={fmtCurrency(allowances.total)} />
        <Stat label="Estimated profit" value={fmtCurrency(yearProfit)} strong />
      </div>
      <p className="text-xs text-slate-500">Estimated taxable profit for {overview.taxYearLabel} so far. {overview.consolidatedAllowed ? "Turnover is under £90,000, so you can send one total for expenses (consolidated) if you prefer." : "Turnover is £90,000 or more, so expenses must be sent by category."}</p>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {tabs.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", tab === k ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800")}>{l}</button>)}
      </div>

      {tab === "quarters" && (
        <div className="space-y-3">
          {periods.map((p) => {
            const [statusText, statusCls] = STATUS[p.status];
            const isOpen = open === p.index;
            const exp = p.period.consolidatedExpenses;
            return (
              <div key={p.index} className={cn("rounded-2xl border bg-white", p.status === "overdue" ? "border-red-200" : "border-slate-200")}>
                <button type="button" onClick={() => setOpen(isOpen ? null : p.index)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">{p.label} <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", statusCls)}>{statusText}</span></p>
                    <p className="text-xs text-slate-500">Send by {fmtDay(p.due)}{p.lockedAt ? ` · marked submitted ${fmtDay(p.lockedAt.slice(0, 10))}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span>In <b className="text-green-700">{fmtCurrency(p.period.turnover + p.period.other)}</b></span>
                    <span>Out <b className="text-red-700">{fmtCurrency(exp)}</b></span>
                    <span>Profit <b>{fmtCurrency(p.period.profit)}</b></span>
                    {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                  </div>
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-slate-100 px-4 py-3">
                    {p.changedSinceLock && <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle size={13} /> Figures have changed since this was marked submitted (e.g. a customer payment was edited). Send a corrected update with your bridging software, then mark it submitted again.</p>}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-slate-100 text-left text-slate-500"><th className="py-1.5 pr-3 font-semibold">HMRC box</th><th className="py-1.5 pr-3 text-right font-semibold">This quarter</th><th className="py-1.5 pr-3 text-right font-semibold">Year to date (send this)</th><th className="py-1.5 text-right font-semibold">Disallowable YTD</th></tr></thead>
                        <tbody className="divide-y divide-slate-50">
                          <Row label="Turnover" field="turnover" a={p.period.turnover} b={p.cumulative.turnover} />
                          <Row label="Other business income" field="other" a={p.period.other} b={p.cumulative.other} />
                          {HMRC_EXPENSE_FIELDS.filter((f) => p.cumulative.expenses[f] || p.period.expenses[f]).map((f) => (
                            <Row key={f} label={LABEL[f]} field={f} a={p.period.expenses[f]} b={p.cumulative.expenses[f]} c={p.cumulative.disallowable[f]} />
                          ))}
                          {overview.consolidatedAllowed && <Row label="Or: consolidated expenses" field="consolidatedExpenses" a={p.period.consolidatedExpenses} b={p.cumulative.consolidatedExpenses} muted />}
                        </tbody>
                      </table>
                    </div>
                    {(p.period.mileageClaim > 0 || p.period.homeClaim > 0) && <p className="text-[11px] text-slate-500">Includes mileage {fmtCurrency(p.period.mileageClaim)} and use of home {fmtCurrency(p.period.homeClaim)} at HMRC flat rates.</p>}
                    {isOwner && p.status !== "future" && (
                      <div className="flex flex-wrap items-center gap-2">
                        {p.lockedAt ? (
                          <>
                            {p.changedSinceLock && <button type="button" disabled={pending} onClick={() => act(() => lockQuarter(overview.taxYear, p.index))} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"><Lock size={12} /> I&apos;ve sent the correction</button>}
                            <button type="button" disabled={pending} onClick={() => act(() => unlockQuarter(overview.taxYear, p.index))} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"><Unlock size={12} /> Unlock to make changes</button>
                          </>
                        ) : (
                          <button type="button" disabled={pending} onClick={() => act(() => lockQuarter(overview.taxYear, p.index))} className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white"><CheckCircle2 size={12} /> Mark as submitted to HMRC</button>
                        )}
                        <span className="text-[11px] text-slate-400">Submitted quarters can&apos;t have expenses or income added, changed or deleted.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">How to send a quarterly update</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>Press <b>Export for bridging software</b> and open the Excel file.</li>
              <li>In your bridging software (HMRC-recognised), choose the &quot;Cumulative&quot; sheet and match each HMRC field once. Most remember it.</li>
              <li>Check the figures and send. Then press <b>Mark as submitted</b> here.</li>
            </ol>
          </div>
        </div>
      )}

      {tab === "vehicles" && <Vehicles overview={overview} act={act} pending={pending} />}
      {tab === "home" && <HomeUse overview={overview} act={act} pending={pending} />}
      {tab === "assets" && <Assets overview={overview} act={act} pending={pending} />}

      {tab === "settings" && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <div>
            <p className="font-semibold text-slate-800">Accounting basis</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {[["CASH", "Cash basis", "Income when you're paid, expenses when you pay. The default for sole traders."], ["ACCRUALS", "Accruals", "Income when the clean is done, whether paid or not."]].map(([v, l, d]) => (
                <button key={v} type="button" disabled={!isOwner || pending} onClick={() => act(() => setAccountsSettings({ basis: v }))} className={cn("max-w-xs rounded-xl border px-3 py-2 text-left", settings.basis === v ? "border-blue-400 bg-blue-50" : "border-slate-200")}>
                  <p className="font-semibold">{l}</p><p className="text-xs text-slate-500">{d}</p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Quarterly periods</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {[["STANDARD", "Standard", "6 Apr–5 Jul, 6 Jul–5 Oct, 6 Oct–5 Jan, 6 Jan–5 Apr"], ["CALENDAR", "Calendar quarters", "1 Apr–30 Jun, 1 Jul–30 Sep, 1 Oct–31 Dec, 1 Jan–31 Mar (you must tell HMRC you've chosen these)"]].map(([v, l, d]) => (
                <button key={v} type="button" disabled={!isOwner || pending} onClick={() => act(() => setAccountsSettings({ periodType: v }))} className={cn("max-w-xs rounded-xl border px-3 py-2 text-left", settings.periodType === v ? "border-blue-400 bg-blue-50" : "border-slate-200")}>
                  <p className="font-semibold">{l}</p><p className="text-xs text-slate-500">{d}</p>
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-500">VAT: {settings.vatRegistered ? "you have a VAT number in Settings, so figures exclude VAT." : "no VAT number in Settings, so figures include VAT."} {!isOwner && "Only the owner can change these."}</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, field, a, b, c, muted }: { label: string; field: string; a: number; b: number; c?: number; muted?: boolean }) {
  return (
    <tr className={cn(muted && "text-slate-400")}>
      <td className="py-1.5 pr-3"><span className="text-slate-700">{label}</span> <span className="font-mono text-[10px] text-slate-400">{field}</span></td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{fmtCurrency(a)}</td>
      <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">{fmtCurrency(b)}</td>
      <td className="py-1.5 text-right tabular-nums text-slate-500">{c ? fmtCurrency(c) : ""}</td>
    </tr>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("text-lg font-bold tabular-nums", strong ? "text-blue-800" : "text-slate-800")}>{value}</p>
    </div>
  );
}

type Act = (fn: () => Promise<unknown>) => void;
const input = "rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm";

function Vehicles({ overview, act, pending }: { overview: Overview; act: Act; pending: boolean }) {
  const [v, setV] = useState({ id: 0, name: "", registration: "", kind: "VAN", method: "ACTUAL", businessPct: "100" });
  const mileageVehicles = overview.vehicles.filter((x) => x.method === "MILEAGE" && !x.archived);
  const [trip, setTrip] = useState({ vehicleId: mileageVehicles[0]?.id ? String(mileageVehicles[0].id) : "", date: today(), miles: "", notes: "" });
  const miles = overview.trips.reduce((s, t) => s + t.miles, 0);
  // A vehicle added after the page opened: default to the first one on the mileage rate.
  const tripVehicle = trip.vehicleId && mileageVehicles.some((x) => String(x.id) === trip.vehicleId) ? trip.vehicleId : String(mileageVehicles[0]?.id ?? "");
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold text-slate-800"><Car size={15} /> Vehicles</p>
        <p className="mt-0.5 text-xs text-slate-500">
          <b>Actual costs:</b> claim fuel, repairs, insurance and tax, less the personal share. <b>Mileage rate:</b> claim {Math.round(mileageRate(overview.taxYear) * 100)}p a mile for the first 10,000 business miles this year, then 25p (motorbikes 24p), instead of those costs. Parking and tolls can be claimed either way. Once you use the mileage rate for a vehicle you must keep using it.
        </p>
        <div className="mt-2 divide-y divide-slate-100">
          {overview.vehicles.map((x) => (
            <div key={x.id} className={cn("flex items-center justify-between gap-2 py-1.5", x.archived && "text-slate-400")}>
              <span>{x.name} {x.registration && <span className="text-xs text-slate-400">{x.registration}</span>} <span className="text-xs text-slate-500">· {x.kind.toLowerCase()} · {x.method === "MILEAGE" ? "mileage rate" : `actual costs, ${x.businessPct}% business`}{x.archived ? " · no longer used" : ""}</span></span>
              <button type="button" onClick={() => setV({ id: x.id, name: x.name, registration: x.registration, kind: x.kind, method: x.method, businessPct: String(x.businessPct) })} className="text-xs font-semibold text-blue-700">Edit</button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-2">
          <input className={input} placeholder="Name (e.g. Transit)" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          <input className={cn(input, "w-28")} placeholder="Reg" value={v.registration} onChange={(e) => setV({ ...v, registration: e.target.value })} />
          <select className={input} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="VAN">Van</option><option value="CAR">Car</option><option value="MOTORCYCLE">Motorbike</option></select>
          <select className={input} value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}><option value="ACTUAL">Actual costs</option><option value="MILEAGE">Mileage rate</option></select>
          {v.method === "ACTUAL" && <label className="text-xs text-slate-600">Business % <input type="number" min={0} max={100} className={cn(input, "w-20")} value={v.businessPct} onChange={(e) => setV({ ...v, businessPct: e.target.value })} /></label>}
          <button type="button" disabled={pending || !v.name.trim()} onClick={() => { act(() => saveVehicle({ ...v, id: v.id || undefined, businessPct: Number(v.businessPct) })); setV({ id: 0, name: "", registration: "", kind: "VAN", method: "ACTUAL", businessPct: "100" }); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{v.id ? "Save" : "Add vehicle"}</button>
          {v.id > 0 && <button type="button" onClick={() => act(() => saveVehicle({ ...v, id: v.id, businessPct: Number(v.businessPct), archived: true }))} className="text-xs text-slate-500">No longer used</button>}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <p className="font-semibold text-slate-800">Business miles ({overview.taxYearLabel})</p>
        <p className="text-xs text-slate-500">{Math.round(miles).toLocaleString("en-GB")} miles · claim {fmtCurrency(overview.year.mileageClaim)}. Log each trip, each day or a monthly total. Keep a note of where you went.</p>
        {mileageVehicles.length === 0 ? <p className="mt-2 text-xs text-amber-700">Add a vehicle on the mileage rate first.</p> : (
          <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-2">
            <select className={input} value={tripVehicle} onChange={(e) => setTrip({ ...trip, vehicleId: e.target.value })}>{mileageVehicles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <input type="date" className={input} value={trip.date} onChange={(e) => setTrip({ ...trip, date: e.target.value })} />
            <input type="number" min={0} step="0.1" className={cn(input, "w-24")} placeholder="Miles" value={trip.miles} onChange={(e) => setTrip({ ...trip, miles: e.target.value })} />
            <input className={cn(input, "min-w-[160px] flex-1")} placeholder="Where (e.g. Oakfield round)" value={trip.notes} onChange={(e) => setTrip({ ...trip, notes: e.target.value })} />
            <button type="button" disabled={pending || !trip.miles} onClick={() => { act(() => addMileageTrip({ vehicleId: Number(tripVehicle), date: trip.date, miles: Number(trip.miles), notes: trip.notes })); setTrip({ ...trip, miles: "", notes: "" }); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Add</button>
          </div>
        )}
        <div className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto">
          {overview.trips.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 py-1 text-xs">
              <span>{fmtDay(t.date)} · {overview.vehicles.find((x) => x.id === t.vehicleId)?.name} · <b>{t.miles}</b> miles {t.notes && <span className="text-slate-400">· {t.notes}</span>}</span>
              <button type="button" onClick={() => act(() => deleteMileageTrip(t.id))} className="text-slate-400 hover:text-red-600" aria-label="Delete trip"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HomeUse({ overview, act, pending }: { overview: Overview; act: Act; pending: boolean }) {
  const months: string[] = [];
  const [y, m] = overview.span.start.slice(0, 7).split("-").map(Number);
  for (let i = 0; i < 12; i++) months.push(new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7));
  const hoursOf = new Map(overview.homeMonths.map((h) => [h.month, h.hours]));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-slate-800"><Home size={15} /> Working from home</p>
      <p className="mt-0.5 text-xs text-slate-500">Hours you work at home each month (admin, quotes, bookings). HMRC flat rate: 25–50 hours £10, 51–100 £18, 101+ £26 a month. Phone and internet are claimed separately as expenses. Total this year: <b>{fmtCurrency(overview.year.homeClaim)}</b>.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {months.map((mo) => (
          <label key={mo} className="rounded-xl border border-slate-200 p-2 text-xs">
            <span className="font-semibold text-slate-700">{new Date(`${mo}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}</span>
            <input type="number" min={0} max={744} defaultValue={hoursOf.get(mo) ?? ""} placeholder="Hours" disabled={pending}
              onBlur={(e) => { const h = Number(e.target.value) || 0; if (h !== (hoursOf.get(mo) ?? 0)) act(() => setHomeHours(mo, h)); }}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm" />
            <span className="mt-0.5 block text-slate-400">{fmtCurrency(homeRate(hoursOf.get(mo) ?? 0))}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Assets({ overview, act, pending }: { overview: Overview; act: Act; pending: boolean }) {
  const blank = { id: 0, description: "", boughtAt: today(), cost: "", kind: "EQUIPMENT", carEmissions: "LOW", businessPct: "100", disposedAt: "", disposalValue: "", notes: "" };
  const [a, setA] = useState(blank);
  const cash = overview.settings.basis === "CASH";
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold text-slate-800"><Package size={15} /> Things you&apos;ve bought to keep</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Vans, ladders, water-fed pole systems, pressure washers. {cash
            ? "On the cash basis, equipment and vans are claimed as an expense when bought (and money from selling them later counts as income). Cars get capital allowances."
            : "On accruals, equipment and vans get the Annual Investment Allowance (100% when bought). Cars get capital allowances."} Cars: electric 100%, up to 50g/km CO2 18% a year, over 50g/km 6% a year.
        </p>
        <div className="mt-2 divide-y divide-slate-100">
          {overview.assets.map((x) => (
            <div key={x.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
              <span><b className="text-slate-800">{x.description}</b> · {x.kind === "CAR" ? `car (${x.carEmissions === "ZERO" ? "electric" : x.carEmissions === "HIGH" ? ">50g/km" : "≤50g/km"})` : x.kind.toLowerCase()} · {fmtDay(x.boughtAt)} · {fmtCurrency(x.cost)}{x.businessPct < 100 ? ` · ${x.businessPct}% business` : ""}{x.disposedAt ? ` · sold ${fmtDay(x.disposedAt)} for ${fmtCurrency(x.disposalValue ?? 0)}` : ""}</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => setA({ id: x.id, description: x.description, boughtAt: x.boughtAt, cost: String(x.cost), kind: x.kind, carEmissions: x.carEmissions ?? "LOW", businessPct: String(x.businessPct), disposedAt: x.disposedAt ?? "", disposalValue: x.disposalValue != null ? String(x.disposalValue) : "", notes: x.notes })} className="font-semibold text-blue-700">Edit</button>
                <button type="button" onClick={() => act(() => deleteAsset(x.id))} className="text-slate-400 hover:text-red-600" aria-label="Delete asset"><Trash2 size={12} /></button>
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-2">
          <input className={cn(input, "min-w-[160px] flex-1")} placeholder="What (e.g. Water-fed pole system)" value={a.description} onChange={(e) => setA({ ...a, description: e.target.value })} />
          <select className={input} value={a.kind} onChange={(e) => setA({ ...a, kind: e.target.value })}><option value="EQUIPMENT">Equipment</option><option value="VAN">Van</option><option value="CAR">Car</option></select>
          {a.kind === "CAR" && <select className={input} value={a.carEmissions} onChange={(e) => setA({ ...a, carEmissions: e.target.value })}><option value="ZERO">Electric</option><option value="LOW">Up to 50g/km</option><option value="HIGH">Over 50g/km</option></select>}
          <label className="text-xs text-slate-600">Bought <input type="date" className={input} value={a.boughtAt} onChange={(e) => setA({ ...a, boughtAt: e.target.value })} /></label>
          <input type="number" min={0} step="0.01" className={cn(input, "w-28")} placeholder="Cost £" value={a.cost} onChange={(e) => setA({ ...a, cost: e.target.value })} />
          <label className="text-xs text-slate-600">Business % <input type="number" min={0} max={100} className={cn(input, "w-20")} value={a.businessPct} onChange={(e) => setA({ ...a, businessPct: e.target.value })} /></label>
          <label className="text-xs text-slate-600">Sold <input type="date" className={input} value={a.disposedAt} onChange={(e) => setA({ ...a, disposedAt: e.target.value })} /></label>
          {a.disposedAt && <input type="number" min={0} step="0.01" className={cn(input, "w-28")} placeholder="Sold for £" value={a.disposalValue} onChange={(e) => setA({ ...a, disposalValue: e.target.value })} />}
          <button type="button" disabled={pending || !a.description.trim() || !a.cost} onClick={() => { act(() => saveAsset({ id: a.id || undefined, description: a.description, boughtAt: a.boughtAt, cost: Number(a.cost), kind: a.kind, carEmissions: a.carEmissions, businessPct: Number(a.businessPct), disposedAt: a.disposedAt || null, disposalValue: a.disposalValue ? Number(a.disposalValue) : null, notes: a.notes })); setA(blank); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{a.id ? "Save" : "Add"}</button>
          {a.id > 0 && <button type="button" onClick={() => setA(blank)} className="text-xs text-slate-500">Cancel</button>}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">Bought something you&apos;ve also entered as an expense? Delete the expense so it isn&apos;t counted twice.</p>
      </div>

      {overview.allowances.assets.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <p className="font-semibold text-slate-800">Capital allowances {overview.taxYearLabel} (for the end-of-year summary)</p>
          <table className="mt-2 w-full text-xs">
            <thead><tr className="border-b border-slate-100 text-left text-slate-500"><th className="py-1 font-semibold">Asset</th><th className="py-1 font-semibold">Pool</th><th className="py-1 text-right font-semibold">Claim</th><th className="py-1 text-right font-semibold">Value left</th></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {overview.allowances.assets.map((x) => <tr key={x.id}><td className="py-1">{x.description}{x.note && <span className="block text-[10px] text-slate-400">{x.note}</span>}</td><td className="py-1 text-slate-500">{x.pool}</td><td className="py-1 text-right tabular-nums">{fmtCurrency(x.claim)}{x.balancing ? ` (${x.balancing > 0 ? "+" : ""}${fmtCurrency(x.balancing)})` : ""}</td><td className="py-1 text-right tabular-nums">{fmtCurrency(x.closing)}</td></tr>)}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-600">Total allowances: <b>{fmtCurrency(overview.allowances.total)}</b></p>
        </div>
      )}
    </div>
  );
}
