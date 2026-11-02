"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "@/components/ui/modal";

/** Payments → Export: who paid and when, as a spreadsheet, for a date range and filters. */

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function presets() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  // UK tax year starts 6 April.
  const taxStart = new Date(now >= new Date(y, 3, 6) ? y : y - 1, 3, 6);
  return [
    { key: "week", label: "Last 7 days", from: iso(new Date(y, m, now.getDate() - 6)), to: iso(now) },
    { key: "month", label: "This month", from: iso(new Date(y, m, 1)), to: iso(now) },
    { key: "lastMonth", label: "Last month", from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { key: "tax", label: "This tax year", from: iso(taxStart), to: iso(now) },
    { key: "lastTax", label: "Last tax year", from: iso(new Date(taxStart.getFullYear() - 1, 3, 6)), to: iso(new Date(taxStart.getFullYear(), 3, 5)) },
  ];
}

export function ExportPaymentsButton({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const ranges = useMemo(presets, []);
  const [from, setFrom] = useState(ranges[1].from);
  const [to, setTo] = useState(ranges[1].to);
  const [method, setMethod] = useState("ALL");
  const [area, setArea] = useState("");
  const [worker, setWorker] = useState("");
  const [refunds, setRefunds] = useState(true);
  const [pending, setPending] = useState(false);
  const [options, setOptions] = useState<{ areas: Array<{ id: number; name: string }>; people: Array<{ id: string; name: string }> } | null>(null);

  useEffect(() => {
    if (!open || options) return;
    fetch("/api/export/payments?options=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setOptions).catch(() => setOptions({ areas: [], people: [] }));
  }, [open, options]);

  const href = `/api/export/payments?${new URLSearchParams({
    ...(from ? { from } : {}), ...(to ? { to } : {}), method,
    ...(area ? { area } : {}), ...(worker ? { worker } : {}), refunds: refunds ? "1" : "0",
    ...(pending ? { pending: "1" } : {}),
  })}`;
  const field = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
  const label = "mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} title="Download who paid and when, as a spreadsheet">
        <Download size={15} /> Export
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Export payments">
        <div className="space-y-4">
          <div>
            <p className={label}>Dates paid</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {ranges.map((r) => (
                <button key={r.key} type="button" onClick={() => { setFrom(r.from); setTo(r.to); }}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${from === r.from && to === r.to ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"}`}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-500">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} /></label>
              <label className="text-xs text-slate-500">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} /></label>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label><span className={label}>How paid</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
                <option value="ALL">All</option><option value="CASH">Cash</option><option value="BACS">Bank transfer</option>
                <option value="CARD">Card</option><option value="DD">Direct Debit</option>
              </select>
            </label>
            <label><span className={label}>Area</span>
              <select value={area} onChange={(e) => setArea(e.target.value)} className={field}>
                <option value="">All areas</option>
                {(options?.areas ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label><span className={label}>Taken by</span>
              <select value={worker} onChange={(e) => setWorker(e.target.value)} className={field}>
                <option value="">Anyone</option>
                {(options?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={refunds} onChange={(e) => setRefunds(e.target.checked)} /> Include refunds (as minus amounts)
          </label>
          <label className={`flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200 ${(method === "ALL" || method === "DD") && !worker ? "" : "opacity-50"}`}>
            <input type="checkbox" className="mt-0.5" checked={pending} disabled={!((method === "ALL" || method === "DD") && !worker)} onChange={(e) => setPending(e.target.checked)} />
            <span>Add Direct Debits on their way <span className="block text-xs text-slate-500">Taken but not paid yet, listed separately with when they&apos;re due. Not in the total.</span></span>
          </label>
          <p className="text-xs text-slate-500">
            One row per payment: date, customer, address, area, how paid, amount, which cleans it paid for (and any credit), who took it and the reference.
            Opens in Excel or Google Sheets. Credit added by hand isn&apos;t included (it isn&apos;t money received).
          </p>
          <a href={href} onClick={() => setTimeout(() => setOpen(false), 300)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
            <Download size={15} /> Download spreadsheet
          </a>
        </div>
      </Modal>
    </>
  );
}
