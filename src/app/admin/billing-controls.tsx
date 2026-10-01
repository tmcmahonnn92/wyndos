"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { extendTrial, setFreeForever } from "@/lib/admin-billing";

type Row = {
  id: number;
  name: string;
  createdAt: string;
  billingExempt: boolean;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  state: { kind: string; daysLeft: number; trialEndsAt: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean };
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function statusOf(r: Row) {
  switch (r.state.kind) {
    case "free": return { text: "Free forever", cls: "bg-violet-950/60 text-violet-300" };
    case "subscribed": return { text: r.state.cancelAtPeriodEnd ? `Paying · ends ${r.state.currentPeriodEnd ? day(r.state.currentPeriodEnd) : ""}` : `Paying (${r.subscriptionStatus})`, cls: "bg-emerald-950/60 text-emerald-300" };
    case "past_due": return { text: "Payment failed", cls: "bg-amber-950/60 text-amber-300" };
    case "trial": return { text: `Trial · ${r.state.daysLeft} day${r.state.daysLeft === 1 ? "" : "s"} left`, cls: "bg-blue-950/60 text-blue-300" };
    default: return { text: "Trial ended", cls: "bg-red-950/60 text-red-300" };
  }
}

/** Admin only: free forever and trial extensions. Businesses never see these settings. */
export function BillingControls({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [days, setDays] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  const run = (fn: () => Promise<unknown>) => start(async () => {
    setError("");
    try { await fn(); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  });

  return (
    <div className="space-y-2">
      {error && <p className="rounded-xl border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}
      {rows.map((r) => {
        const s = statusOf(r);
        return (
          <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-white">{r.name}</p>
              <p className="text-xs text-slate-500">
                Joined {day(r.createdAt)}{r.state.kind === "trial" || r.state.kind === "ended" ? ` · trial ${r.state.kind === "ended" ? "ended" : "ends"} ${day(r.state.trialEndsAt)}` : ""}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.cls}`}>{s.text}</span>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={r.billingExempt} disabled={pending} onChange={(e) => run(() => setFreeForever(r.id, e.target.checked))} />
              Free forever
            </label>
            {!r.billingExempt && (
              <div className="flex items-center gap-1.5">
                <input type="number" min={1} max={3650} placeholder="days" value={days[r.id] ?? ""} onChange={(e) => setDays((d) => ({ ...d, [r.id]: e.target.value }))}
                  className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white" aria-label={`Extend ${r.name}'s trial by days`} />
                <button type="button" disabled={pending || !Number(days[r.id])}
                  onClick={() => run(async () => { await extendTrial(r.id, Number(days[r.id])); setDays((d) => ({ ...d, [r.id]: "" })); })}
                  className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40">
                  Extend trial
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
