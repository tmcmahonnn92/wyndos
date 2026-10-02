"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { saveOpeningFigures } from "@/lib/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtCurrency } from "@/lib/utils";

type Props = { taxYearLabel: string; taxYearStart: string; income: number; expenses: number; incomeVat?: number; expensesVat?: number; asAt: string | null };

/** Starting figures for this tax year, for businesses that start using Wyndos part-way through. */
export function OpeningFigures({ taxYearLabel, taxYearStart, income, expenses, incomeVat = 0, expensesVat = 0, asAt }: Props) {
  const router = useRouter();
  const hasFigures = income > 0 || expenses > 0;
  const [editing, setEditing] = useState(!hasFigures);
  const [inc, setInc] = useState(income ? String(income) : "");
  const [exp, setExp] = useState(expenses ? String(expenses) : "");
  const [incVat, setIncVat] = useState(incomeVat ? String(incomeVat) : "");
  const [expVat, setExpVat] = useState(expensesVat ? String(expensesVat) : "");
  const [showVat, setShowVat] = useState(incomeVat > 0 || expensesVat > 0);
  const [date, setDate] = useState(asAt ?? new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const fmtDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  const save = () => {
    setError("");
    start(async () => {
      try {
        await saveOpeningFigures({
          income: Number(inc) || 0,
          expenses: Number(exp) || 0,
          incomeVat: showVat ? Number(incVat) || 0 : 0,
          expensesVat: showVat ? Number(expVat) || 0 : 0,
          asAt: date,
        });
        setEditing(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : "Couldn't save.");
      }
    });
  };

  const field = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Flag size={14} className="text-blue-600" />Before Wyndos ({taxYearLabel})</CardTitle>
        {hasFigures && !editing && <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-blue-600 hover:underline">Change</button>}
      </CardHeader>
      <CardContent className="space-y-3">
        {!editing ? (
          <p className="text-sm text-slate-600">
            Earned <strong>{fmtCurrency(income)}</strong>{incomeVat > 0 ? ` (VAT ${fmtCurrency(incomeVat)})` : ""} and spent <strong>{fmtCurrency(expenses)}</strong>{expensesVat > 0 ? ` (VAT ${fmtCurrency(expensesVat)})` : ""} from {fmtDate(taxYearStart)} up to {asAt ? fmtDate(asAt) : "starting Wyndos"}. Included in the totals above.
          </p>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              Started using Wyndos part-way through the tax year? Add what you earned and spent since {fmtDate(taxYearStart)} so your totals are right from day one.
              Rough totals from your bank or old records are fine.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="op-inc" className="mb-1 block text-xs font-semibold text-slate-600">Earned so far (£)</label>
                <input id="op-inc" type="number" min="0" step="0.01" inputMode="decimal" value={inc} onChange={(e) => setInc(e.target.value)} placeholder="0" className={field} />
              </div>
              <div>
                <label htmlFor="op-exp" className="mb-1 block text-xs font-semibold text-slate-600">Spent so far (£)</label>
                <input id="op-exp" type="number" min="0" step="0.01" inputMode="decimal" value={exp} onChange={(e) => setExp(e.target.value)} placeholder="0" className={field} />
              </div>
              <div>
                <label htmlFor="op-date" className="mb-1 block text-xs font-semibold text-slate-600">Up to</label>
                <input id="op-date" type="date" min={taxYearStart} value={date} onChange={(e) => setDate(e.target.value)} className={field} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <input type="checkbox" checked={showVat} onChange={(e) => setShowVat(e.target.checked)} />
              I&apos;m VAT registered: add the VAT in these totals
            </label>
            {showVat && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="op-inc-vat" className="mb-1 block text-xs font-semibold text-slate-600">VAT charged in that (£)</label>
                  <input id="op-inc-vat" type="number" min="0" step="0.01" inputMode="decimal" value={incVat} onChange={(e) => setIncVat(e.target.value)} placeholder="0" className={field} />
                  {Number(inc) > 0 && <button type="button" onClick={() => setIncVat((Number(inc) / 6).toFixed(2))} className="mt-1 text-[11px] text-blue-600 hover:underline">All at 20%: {fmtCurrency(Number(inc) / 6)}</button>}
                </div>
                <div>
                  <label htmlFor="op-exp-vat" className="mb-1 block text-xs font-semibold text-slate-600">VAT paid in that (£)</label>
                  <input id="op-exp-vat" type="number" min="0" step="0.01" inputMode="decimal" value={expVat} onChange={(e) => setExpVat(e.target.value)} placeholder="0" className={field} />
                  {Number(exp) > 0 && <button type="button" onClick={() => setExpVat((Number(exp) / 6).toFixed(2))} className="mt-1 text-[11px] text-blue-600 hover:underline">All at 20%: {fmtCurrency(Number(exp) / 6)}</button>}
                </div>
                <p className="text-[11px] text-slate-500 sm:pt-5">Totals above include VAT. Not everything you buy has VAT on it, so use the figure from your records if you have it.</p>
              </div>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save starting figures"}</Button>
              {hasFigures && <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
