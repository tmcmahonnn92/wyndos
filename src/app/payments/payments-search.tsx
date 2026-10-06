"use client";

import { useState } from "react";
import Link from "next/link";
import { History, PiggyBank, Search, StickyNote, TrendingUp, X } from "lucide-react";
import { cn, fmtCurrency, fmtDate } from "@/lib/utils";
import { DebtorsPanel, matchesPaymentSearch, type Debtor } from "./payments-client";

export type PaymentRow = {
  id: number;
  customerId: number;
  name: string;
  address: string;
  method: string;
  paidAt: string;
  notes: string | null;
  amount: number;
  /** Part of the payment not on any clean yet. */
  credit: number;
  jobs: Array<{ id: number; name: string; date: string | null; notes: string; amount: number }>;
};

type CreditRow = { id: number; name: string; address: string; areaName: string; credit: number };
type Tab = "owing" | "history" | "credit";

const METHOD_LABEL: Record<string, string> = { CASH: "Cash", BACS: "Bank", CARD: "Card", GOCARDLESS: "Direct Debit" };

/** Owing, history and credit, with one search box over all three. */
export function PaymentsBody({
  debtors,
  lateAfter,
  startLate,
  startTab,
  takenThisMonth,
  credits,
  areas,
  businessName,
  smsTemplates,
  textVars,
  payments,
}: {
  debtors: Debtor[];
  lateAfter: number;
  startLate: boolean;
  startTab: Tab;
  takenThisMonth: number;
  credits: CreditRow[];
  areas: Array<{ id: number; name: string; color?: string | null }>;
  businessName: string;
  smsTemplates: string[];
  textVars?: Record<string, string>;
  payments: PaymentRow[];
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>(startTab);
  const [onlyLate, setOnlyLate] = useState(startLate);
  const searching = query.trim().length > 0;

  const totalOwed = debtors.reduce((sum, d) => sum + Number(d.debt), 0);
  const late = debtors.filter((d) => d.late);
  const lateTotal = late.reduce((sum, d) => sum + Number(d.debt), 0);
  const totalCredit = credits.reduce((sum, c) => sum + c.credit, 0);

  const shownPayments = payments
    .filter((p) => matchesPaymentSearch(query, [p.name, p.address, p.notes ?? "", p.method, ...p.jobs.map((j) => j.notes)], [p.amount]))
    .slice(0, searching ? 200 : 60);
  const shownCredits = credits.filter((c) => matchesPaymentSearch(query, [c.name, c.address, c.areaName], [c.credit]));
  const matchingDebtors = debtors
    .filter((d) => !onlyLate || d.late)
    .filter((d) => matchesPaymentSearch(query, [d.name, d.address, d.areaName ?? "", ...d.unpaidJobs.map((j) => j.notes ?? "")], [Number(d.debt)])).length;

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: "owing", label: "Owing", count: searching ? matchingDebtors : debtors.length },
    { key: "history", label: "History", count: shownPayments.length },
    { key: "credit", label: "Credit", count: shownCredits.length },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Owed" value={fmtCurrency(totalOwed)} detail={`${debtors.length} customer${debtors.length === 1 ? "" : "s"}`} tone={totalOwed > 0 ? "warning" : "default"}
          onClick={() => { setTab("owing"); setOnlyLate(false); }} />
        <Tile label="Late" value={String(late.length)} detail={late.length ? `${fmtCurrency(lateTotal)} · over ${lateAfter} days` : `Nothing over ${lateAfter} days`} tone={late.length ? "danger" : "default"}
          onClick={() => { setTab("owing"); setOnlyLate(true); }} />
        <Tile label="Taken" value={fmtCurrency(takenThisMonth)} detail="This month" onClick={() => setTab("history")} />
        <Tile label="Credit" value={fmtCurrency(totalCredit)} detail={`${credits.length} customer${credits.length === 1 ? "" : "s"} in credit`} tone={totalCredit > 0 ? "good" : "default"}
          onClick={() => setTab("credit")} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-3 dark:border-[#1E2840] dark:bg-[#131929]">
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 focus-within:ring-2 focus-within:ring-blue-500 dark:border-[#1E2840] dark:bg-[#131929]">
          <Search size={16} className="flex-shrink-0 text-slate-400" />
          <input
            type="text"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, address, note or amount"
            aria-label="Search payments"
            className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
          />
          {searching && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          )}
        </label>
        <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-[#0B1020]" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex-1 rounded-lg px-2 py-1.5 text-sm font-semibold transition-colors",
                tab === t.key ? "bg-white text-slate-900 shadow-sm dark:bg-[#1E2840] dark:text-white" : "text-slate-500",
              )}
            >
              {t.label} <span className="text-xs font-medium text-slate-400">{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === "owing" && (
        <section className="rounded-2xl border border-slate-200 bg-white px-4 pt-3 pb-1 shadow-sm dark:border-[#1E2840] dark:bg-[#131929]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <TrendingUp size={14} className="text-amber-500" /> Customers owing
            </h2>
            <button
              type="button"
              onClick={() => setOnlyLate((v) => !v)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-semibold",
                onlyLate ? "border-red-500 bg-red-500 text-white" : "border-slate-200 text-slate-600",
              )}
            >
              Late only
            </button>
          </div>
          {debtors.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Nobody owes anything. Nice.</p>
          ) : (
            <DebtorsPanel debtors={debtors} areas={areas} businessName={businessName} smsTemplates={smsTemplates} textVars={textVars} query={query} onlyLate={onlyLate} />
          )}
        </section>
      )}

      {tab === "history" && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-[#1E2840] dark:bg-[#131929]">
          <h2 className="flex items-center gap-1.5 px-4 pt-3 pb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <History size={14} className="text-green-500" /> Payment history
          </h2>
          {shownPayments.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-slate-500">{searching ? "No payments match that search." : "No payments logged yet."}</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-[#1E2840]">
              {shownPayments.map((p) => (
                <li key={p.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/customers/${p.customerId}`} className="min-w-0 truncate text-[15px] font-semibold text-slate-800 hover:text-blue-600 dark:text-slate-100">
                      {p.name}
                    </Link>
                    <span className="flex-shrink-0 text-sm font-bold tabular-nums text-green-700">+{fmtCurrency(p.amount)}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600 dark:bg-[#0B1020] dark:text-slate-300">
                      {METHOD_LABEL[p.method] ?? p.method}
                    </span>
                    <span>{fmtDate(p.paidAt)}</span>
                    {p.address && p.address !== p.name && <span className="truncate">{p.address}</span>}
                  </div>
                  {p.notes && <p className="mt-1 text-xs text-slate-600">“{p.notes}”</p>}
                  {(p.jobs.length > 0 || p.credit > 0.005) && (
                    <ul className="mt-1.5 space-y-1">
                      {p.jobs.map((job) => (
                        <li key={job.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-[#0B1020]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-slate-600">{job.name || "Window Cleaning"} · {fmtDate(job.date)}</span>
                            <span className="flex-shrink-0 tabular-nums text-slate-600">{fmtCurrency(job.amount)}</span>
                          </div>
                          {job.notes && (
                            <p className="mt-0.5 flex items-start gap-1 text-[11px] text-amber-800">
                              <StickyNote size={10} className="mt-0.5 flex-shrink-0" />
                              <span>{job.notes}</span>
                            </p>
                          )}
                        </li>
                      ))}
                      {p.credit > 0.005 && (
                        <li className="flex items-center justify-between rounded-lg bg-green-50 px-2.5 py-1.5 text-xs text-green-800">
                          <span>Kept as credit</span>
                          <span className="tabular-nums">{fmtCurrency(p.credit)}</span>
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "credit" && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-[#1E2840] dark:bg-[#131929]">
          <h2 className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <PiggyBank size={14} className="text-green-600" /> In credit
          </h2>
          <p className="px-4 pb-2 text-xs text-slate-500">Paid in advance or paid extra. It comes off their next cleans by itself.</p>
          {shownCredits.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-slate-500">Nobody is in credit. Use “Add credit” when someone pays in advance.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-[#1E2840]">
              {shownCredits.map((c) => (
                <li key={c.id}>
                  <Link href={`/customers/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-[#0B1020]">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-slate-800 dark:text-slate-100">{c.name}</p>
                      <p className="truncate text-xs text-slate-500">{c.address}{c.areaName ? ` · ${c.areaName}` : ""}</p>
                    </div>
                    <span className="flex-shrink-0 text-sm font-bold tabular-nums text-green-700">{fmtCurrency(c.credit)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  detail,
  tone = "default",
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warning" | "danger" | "good";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border bg-white px-3 py-2 text-left shadow-sm transition-colors hover:border-blue-300 dark:bg-[#131929]",
        tone === "warning" && "border-amber-200 bg-amber-50/60",
        tone === "danger" && "border-red-200 bg-red-50/60",
        tone === "good" && "border-green-200 bg-green-50/60",
        tone === "default" && "border-slate-200 dark:border-[#1E2840]",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="truncate text-[11px] text-slate-500">{detail}</p>
    </button>
  );
}
