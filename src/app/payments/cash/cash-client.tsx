"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, ChevronDown, ChevronUp, Undo2 } from "lucide-react";
import { recordCashHandover, undoCashHandover } from "@/lib/cash-actions";
import { fmtCurrency } from "@/lib/utils";
import { textDate } from "@/lib/text-format";

type Held = { userId: string; name: string; amount: number; payments: Array<{ id: number; amount: number; paidAt: string; customer: string; notes: string }> };
type Handover = { id: number; name: string; amount: number; notes: string; createdAt: string; payments: number };

// Same text on the server and in the browser (locale formatting can differ between them).
const day = (iso: string) => textDate(iso);

export function CashClient({ held, handovers }: { held: Held[]; handovers: Handover[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, Set<number>>>({});
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const chosen = (h: Held) => picked[h.userId] ?? new Set(h.payments.map((p) => p.id));
  const toggle = (h: Held, id: number) =>
    setPicked((prev) => {
      const next = new Set(chosen(h));
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...prev, [h.userId]: next };
    });

  const receive = (h: Held) => {
    const ids = [...chosen(h)];
    setError("");
    start(async () => {
      try {
        await recordCashHandover({ workerUserId: h.userId, paymentIds: ids });
        router.refresh();
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Couldn't save that.");
      }
    });
  };

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {held.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500 shadow-sm">
          Nobody is holding any cash. All handed over.
        </div>
      ) : (
        <ul className="space-y-3">
          {held.map((h) => {
            const sel = chosen(h);
            const selTotal = h.payments.filter((p) => sel.has(p.id)).reduce((s, p) => s + p.amount, 0);
            return (
              <li key={h.userId} className="rounded-2xl border border-amber-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-[15px] font-semibold text-slate-800">{h.name}</p>
                    <p className="text-xs text-slate-500">{h.payments.length} cash payment{h.payments.length === 1 ? "" : "s"} since {day(h.payments[0].paidAt)}</p>
                  </div>
                  <p className="text-lg font-bold tabular-nums text-amber-700">{fmtCurrency(h.amount)}</p>
                </div>
                <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5">
                  <button
                    onClick={() => receive(h)}
                    disabled={pending || sel.size === 0}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    <Banknote size={15} /> Received {fmtCurrency(selTotal)}
                  </button>
                  <button onClick={() => setOpen(open === h.userId ? null : h.userId)} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">
                    Details {open === h.userId ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
                {open === h.userId && (
                  <ul className="divide-y divide-slate-100 border-t border-slate-100">
                    {h.payments.map((p) => (
                      <li key={p.id}>
                        <label className="flex items-center gap-3 px-4 py-2 text-sm">
                          <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(h, p.id)} />
                          <span className="min-w-0 flex-1 truncate text-slate-700">{p.customer}<span className="text-slate-400"> · {day(p.paidAt)}</span></span>
                          <span className="tabular-nums text-slate-700">{fmtCurrency(p.amount)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {handovers.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <h2 className="px-4 pt-3 pb-1 text-sm font-semibold text-slate-800">Handed over</h2>
          <ul className="divide-y divide-slate-100">
            {handovers.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate text-slate-700">{h.name}<span className="text-slate-400"> · {day(h.createdAt)} · {h.payments} payment{h.payments === 1 ? "" : "s"}</span></span>
                <span className="flex items-center gap-2">
                  <b className="tabular-nums text-green-700">{fmtCurrency(h.amount)}</b>
                  <button
                    title="Undo"
                    onClick={() => { if (confirm("Undo this handover? The cash goes back to being with them.")) start(async () => { await undoCashHandover(h.id); router.refresh(); }); }}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <Undo2 size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
