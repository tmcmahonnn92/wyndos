"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCustomerPlaceAfter } from "@/lib/day-order-actions";

/** "Always after" link set by moving this customer's job on a day. */
export function PlaceAfter({ customerId, afterName }: { customerId: number; afterName: string | null }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  if (!afterName) return null;
  return (
    <div className="px-4 pb-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
        <p className="flex-1 text-slate-700 dark:text-slate-200">
          On days with <b>{afterName}</b>, this customer always comes straight after them.
        </p>
        <button type="button" disabled={busy}
          onClick={() => start(async () => { await setCustomerPlaceAfter(customerId, null); router.refresh(); })}
          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Remove</button>
      </div>
    </div>
  );
}
