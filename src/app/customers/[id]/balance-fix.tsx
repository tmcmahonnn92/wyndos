"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eraser } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { addCreditAdjustment, removeCredit, writeOffDebt } from "@/lib/actions";
import { fmtCurrency } from "@/lib/utils";
import { unwrap } from "@/lib/outcome";

/** Write off debt, or remove credit that shouldn't be there. */
export function BalanceFixButton({ customerId, kind, max }: { customerId: number; kind: "debt" | "credit" | "add"; max: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(kind === "add" ? "" : max.toFixed(2));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const debt = kind === "debt";
  const add = kind === "add";
  return (
    <>
      <button type="button" onClick={() => { setAmount(add ? "" : max.toFixed(2)); setReason(""); setError(""); setOpen(true); }}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
        <Eraser size={12} /> {add ? "Add credit" : debt ? "Write off" : "Remove credit"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={add ? "Add credit" : debt ? "Write off what they owe" : "Remove credit"}>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-slate-500">
            {add
              ? "Credit you're giving them that isn't money received (goodwill, a correction). It isn't counted as income. If they paid you in advance, use Paid in advance instead. Any unpaid cleans are paid from it first."
              : debt
              ? "For money that isn't really owed (a wrong import, goodwill, a bad debt). It comes off the unpaid cleans' prices, newest first, and they stop showing as owing."
              : "Takes the credit off, whatever it came from. It's recorded today as \"Credit removed\" (undo it on their payments to put it back). Credit from money you received comes off today's money in. Tip: if it belongs to another customer, Use for another customer keeps your figures right."}
          </p>
          <label className="block"><span className="mb-1 block font-medium text-slate-700">Amount{add ? "" : ` (up to ${fmtCurrency(max)})`}</span>
            <input type="number" min="0.01" step="0.01" max={add ? undefined : max} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
          </label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} placeholder="Reason (optional), e.g. Wrong on import" className="w-full rounded-lg border border-slate-200 px-3 py-2" />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <button type="button" disabled={busy || !(Number(amount) > 0)} onClick={async () => {
            setBusy(true); setError("");
            try { if (add) await unwrap(addCreditAdjustment(customerId, Number(amount), reason)); else if (debt) await unwrap(writeOffDebt(customerId, Number(amount), reason)); else await unwrap(removeCredit(customerId, Number(amount), reason)); setOpen(false); router.refresh(); }
            catch (e) { setError(e instanceof Error ? e.message : "Couldn't do that."); }
            setBusy(false);
          }} className="w-full rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Saving…" : `${add ? "Add" : debt ? "Write off" : "Remove"} ${fmtCurrency(Number(amount) || 0)}`}
          </button>
        </div>
      </Modal>
    </>
  );
}
