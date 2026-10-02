"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { removeBankReference } from "@/lib/actions";

/** Bank references learned from confirmed statement matches. Only used as suggestions. */
export function BankReferences({ refs }: { refs: Array<{ id: number; label: string }> }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  if (refs.length === 0) return null;
  return (
    <div className="px-4 pb-8 max-w-3xl mx-auto">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Bank references</p>
        <p className="mt-0.5 text-xs text-slate-500">Used to suggest this customer when you match a bank statement. You still check every payment.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {refs.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {r.label}
              <button type="button" disabled={busy} aria-label={`Remove ${r.label}`}
                onClick={() => start(async () => { await removeBankReference(r.id); router.refresh(); })}
                className="text-slate-400 hover:text-red-600"><X size={12} /></button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
