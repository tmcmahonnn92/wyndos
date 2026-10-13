"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { listCustomersBrief, movePaymentToCustomer, useCreditForCustomer } from "@/lib/actions";
import { fmtCurrency } from "@/lib/utils";
import { unwrap } from "@/lib/outcome";

type Brief = { id: number; name: string; address: string | null };

function CustomerPicker({ exclude, picked, onPick }: { exclude: number; picked: Brief | null; onPick: (c: Brief) => void }) {
  const [list, setList] = useState<Brief[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { listCustomersBrief().then(setList).catch(() => setList([])); }, []);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list ?? []).filter((c) => c.id !== exclude && (!t || `${c.name} ${c.address ?? ""}`.toLowerCase().includes(t))).slice(0, 30);
  }, [list, q, exclude]);
  return (
    <div className="space-y-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or address" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
        {list === null ? <li className="px-3 py-2 text-xs text-slate-500">Loading…</li> : shown.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onPick(c)} className={`w-full px-3 py-2 text-left text-sm ${picked?.id === c.id ? "bg-blue-50 font-semibold text-blue-800" : "hover:bg-slate-50"}`}>
              {c.name}<span className="block truncate text-xs text-slate-500">{c.address}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Payment on the wrong customer: move it to the right one. */
export function MovePaymentButton({ paymentId, customerId, amount }: { paymentId: number; customerId: number; amount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<Brief | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button onClick={() => { setOpen(true); setTo(null); setError(""); }} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors flex-shrink-0" title="Move to another customer">
        <ArrowLeftRight size={13} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Move payment to another customer">
        <div className="space-y-3 text-sm">
          <p className="text-xs text-slate-500">For a payment put on the wrong customer. The {fmtCurrency(amount)} then pays the other customer&apos;s unpaid cleans (oldest first); anything left is their credit. Cleans it paid here owe again.</p>
          {open && <CustomerPicker exclude={customerId} picked={to} onPick={setTo} />}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <button type="button" disabled={!to || busy} onClick={async () => {
            setBusy(true); setError("");
            try { await unwrap(movePaymentToCustomer(paymentId, to!.id)); setOpen(false); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't move it."); }
            setBusy(false);
          }} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Moving…" : to ? `Move to ${to.name}` : "Choose a customer"}
          </button>
        </div>
      </Modal>
    </>
  );
}

/** This customer's credit pays another customer's unpaid cleans (one payer for two houses). */
export function UseCreditButton({ customerId, credit }: { customerId: number; credit: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<Brief | null>(null);
  const [amount, setAmount] = useState(credit.toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setTo(null); setAmount(credit.toFixed(2)); setError(""); }} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100">
        <ArrowLeftRight size={12} /> Use for another customer
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Use credit for another customer">
        <div className="space-y-3 text-sm">
          <p className="text-xs text-slate-500">For one payer covering two customers (e.g. two properties on one Direct Debit). The credit pays the other customer&apos;s unpaid cleans, oldest first. It isn&apos;t counted as new money.</p>
          <label className="block"><span className="mb-1 block font-medium text-slate-700">Up to (credit {fmtCurrency(credit)})</span>
            <input type="number" min="0.01" step="0.01" max={credit} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
          </label>
          {open && <CustomerPicker exclude={customerId} picked={to} onPick={setTo} />}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <button type="button" disabled={!to || busy || !(Number(amount) > 0)} onClick={async () => {
            setBusy(true); setError("");
            try { await unwrap(useCreditForCustomer(customerId, to!.id, Number(amount))); setOpen(false); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't do that."); }
            setBusy(false);
          }} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Saving…" : to ? `Pay ${to.name}'s cleans` : "Choose a customer"}
          </button>
        </div>
      </Modal>
    </>
  );
}
