"use client";

import { useState } from "react";
import Link from "next/link";
import { PoundSterling, Search, TrendingUp, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtCurrency, fmtDate } from "@/lib/utils";
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
};

/** Customers owing + payment history, with one search box over both. */
export function PaymentsBody({
  debtors,
  areas,
  businessName,
  smsTemplates,
  payments,
}: {
  debtors: Debtor[];
  areas: Array<{ id: number; name: string; color?: string | null }>;
  businessName: string;
  smsTemplates: string[];
  payments: PaymentRow[];
}) {
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const shownPayments = payments
    .filter((p) => matchesPaymentSearch(query, [p.name, p.address, p.notes ?? "", p.method], [p.amount]))
    .slice(0, searching ? 200 : 50);
  const matchingDebtors = debtors.filter((d) => matchesPaymentSearch(query, [d.name, d.address, d.areaName ?? ""], [Number(d.debt)])).length;

  return (
    <>
      <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 dark:border-[#1E2840] dark:bg-[#131929]">
        <Search size={16} className="flex-shrink-0 text-slate-400" />
        <input
          type="text"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search customer, address or amount"
          aria-label="Search payments"
          className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
        />
        {searching && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        )}
      </label>

      {debtors.length > 0 && (!searching || matchingDebtors > 0) && (
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5">
              <TrendingUp size={14} className="text-amber-500" />
              Customers Owing ({searching ? `${matchingDebtors} of ${debtors.length}` : debtors.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <DebtorsPanel debtors={debtors} areas={areas} businessName={businessName} smsTemplates={smsTemplates} query={query} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <PoundSterling size={14} className="text-green-500" />
            Payment History{searching && ` (${shownPayments.length} found)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {shownPayments.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-500">{searching ? "No payments match that search." : "No payments logged yet."}</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-[#1E2840]">
              {shownPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/customers/${p.customerId}`} className="text-sm font-medium text-slate-800 hover:text-blue-600 hover:underline dark:text-slate-100">
                      {p.name}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {p.address && p.address !== p.name ? `${p.address} · ` : ""}{p.method} · {fmtDate(p.paidAt)}
                      {p.notes ? ` · ${p.notes}` : ""}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-green-700">+{fmtCurrency(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
