"use client";

import { useEffect, useState } from "react";
import { normalisePreference } from "@/lib/payment-preference";
import { paysByDirectDebit } from "@/lib/gocardless/status";

/** How a customer pays, for filtering: a working Direct Debit wins over their "usually pays by". */
export type PaysBy = "CASH" | "BACS" | "CARD" | "DD" | "INVOICE" | "NONE";
export const PAYS_BY: Array<{ key: PaysBy; label: string }> = [
  { key: "CASH", label: "Cash" },
  { key: "BACS", label: "Bank" },
  { key: "CARD", label: "Card" },
  { key: "DD", label: "Direct Debit" },
  { key: "INVOICE", label: "Invoice" },
  { key: "NONE", label: "Not set" },
];

export function paysByOf(c: { preferredPaymentMethod?: string | null; goCardlessMandateId?: string | null; goCardlessMandateStatus?: string | null }): PaysBy {
  if (paysByDirectDebit(c)) return "DD";
  return (normalisePreference(c.preferredPaymentMethod) || "NONE") as PaysBy;
}

/** Chosen pay types, remembered on this device per screen (empty = everyone). */
export function usePaysByChoice(storageKey: string) {
  const [chosen, setChosen] = useState<Set<PaysBy>>(new Set());
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(saved)) setChosen(new Set(saved.filter((k) => PAYS_BY.some((p) => p.key === k))));
    } catch { /* not available */ }
  }, [storageKey]);
  const update = (next: Set<PaysBy>) => {
    setChosen(next);
    try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* not available */ }
  };
  return [chosen, update] as const;
}

/** "Pays by" chips: tap to show only those; tap again to clear. Counts show how many of each. */
export function PaysByFilter({ counts, chosen, onChange }: { counts: Partial<Record<PaysBy, number>>; chosen: Set<PaysBy>; onChange: (next: Set<PaysBy>) => void }) {
  const shown = PAYS_BY.filter((p) => (counts[p.key] ?? 0) > 0 || chosen.has(p.key));
  if (shown.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="font-medium text-slate-500">Pays by:</span>
      <button type="button" onClick={() => onChange(new Set())}
        className={`rounded-full border px-2.5 py-1 font-semibold ${chosen.size === 0 ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
        All
      </button>
      {shown.map((p) => {
        const on = chosen.has(p.key);
        return (
          <button key={p.key} type="button"
            onClick={() => { const next = new Set(chosen); if (on) next.delete(p.key); else next.add(p.key); onChange(next); }}
            className={`rounded-full border px-2.5 py-1 font-semibold ${on ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
            {p.label} <span className="opacity-60">{counts[p.key] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
