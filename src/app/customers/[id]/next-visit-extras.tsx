"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, X } from "lucide-react";
import { removeNextVisitExtra } from "@/lib/actions";
import { fmtCurrency } from "@/lib/utils";

type Extra = { name: string; price: number; notes?: string | null };

function parse(raw: string | null | undefined): Extra[] {
  try { const l = JSON.parse(raw || "[]"); return Array.isArray(l) ? l.filter((x) => x?.name) : []; } catch { return []; }
}

/** Extras waiting for this customer's next visit (added to it once it's booked). */
export function NextVisitExtras({ customerId, raw, hidePrices = false }: { customerId: number; raw: string | null | undefined; hidePrices?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const extras = parse(raw);
  if (!extras.length) return null;
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-violet-900"><CalendarPlus size={15} /> For their next visit</p>
      <p className="mb-2 text-xs text-violet-700">Added to their next clean as soon as it&apos;s booked.</p>
      <ul className="space-y-1">
        {extras.map((x, i) => (
          <li key={`${x.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium text-slate-800">{x.name}</span>
              {x.notes && <span className="block truncate text-xs text-slate-500">{x.notes}</span>}
            </span>
            {!hidePrices && <span className="text-slate-700">{fmtCurrency(x.price)}</span>}
            <button type="button" disabled={pending} aria-label={`Remove ${x.name}`} title="Remove"
              onClick={() => start(async () => { await removeNextVisitExtra(customerId, i); router.refresh(); })}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600">
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
