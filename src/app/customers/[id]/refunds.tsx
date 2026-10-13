"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { getRefundInfo, refundCustomerCredit, refundPayment } from "@/lib/actions";
import { fmtCurrency } from "@/lib/utils";

type How = "GOCARDLESS" | "CASH" | "BACS" | "CARD";
const HOW_LABEL: Record<How, string> = { GOCARDLESS: "Back through GoCardless", CASH: "Cash", BACS: "Bank transfer", CARD: "Card" };

/** Refund button on a payment: how much, how it goes back, and what happens to the clean. */
export function RefundPaymentButton({ paymentId }: { paymentId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getRefundInfo>> | null>(null);
  const [amount, setAmount] = useState("");
  const [how, setHow] = useState<How>("BACS");
  const [outcome, setOutcome] = useState<"WRITE_OFF" | "OWING">("WRITE_OFF");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const start = async () => {
    setOpen(true); setError(""); setInfo(null); setReason("");
    try {
      const i = await getRefundInfo(paymentId);
      setInfo(i); setAmount(i.left.toFixed(2)); setHow(i.viaGc ? "GOCARDLESS" : i.method === "CASH" ? "CASH" : i.method === "CARD" ? "CARD" : "BACS");
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load this payment."); }
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      await refundPayment(paymentId, { amount: Number(amount), outcome, how, reason });
      setOpen(false); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't refund."); }
    setBusy(false);
  };
  const hows: How[] = info?.viaGc ? ["GOCARDLESS", "BACS", "CASH", "CARD"] : ["BACS", "CASH", "CARD"];

  return (
    <>
      <button onClick={start} className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors flex-shrink-0" title="Refund">
        <RotateCcw size={13} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Refund">
        {!info ? <p className="text-sm text-slate-500">{error || "Loading…"}</p> : info.left <= 0.004 ? (
          <p className="text-sm text-slate-600">This payment has already been refunded in full.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block font-medium text-slate-700">Amount (up to {fmtCurrency(info.left)})</span>
              <input type="number" min="0.01" step="0.01" max={info.left} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
            </label>
            <div>
              <span className="mb-1 block font-medium text-slate-700">How it goes back</span>
              <div className="grid grid-cols-2 gap-2">
                {hows.map((h) => (
                  <button key={h} type="button" onClick={() => setHow(h)} className={`rounded-lg border px-3 py-2 text-left text-xs font-semibold ${how === h ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-700"}`}>{HOW_LABEL[h]}</button>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {how === "GOCARDLESS" ? "GoCardless sends the money back to their bank (a few working days). GoCardless emails them." : "Give the money back yourself; this records it."}
                {info.gcPending && " GoCardless can't refund this one yet: it hasn't been collected."}
              </p>
            </div>
            {info.onCleans > 0.004 && (
              <div>
                <span className="mb-1 block font-medium text-slate-700">The clean</span>
                <label className="flex items-start gap-2 py-1"><input type="radio" checked={outcome === "WRITE_OFF"} onChange={() => setOutcome("WRITE_OFF")} className="mt-1" />
                  <span>Write it off <span className="block text-xs text-slate-500">They don&apos;t owe it (poor job, goodwill). The clean&apos;s price comes down.</span></span></label>
                <label className="flex items-start gap-2 py-1"><input type="radio" checked={outcome === "OWING"} onChange={() => setOutcome("OWING")} className="mt-1" />
                  <span>Leave it owing <span className="block text-xs text-slate-500">They still owe for the clean (paid by mistake, charged twice). It shows as unpaid again.</span></span></label>
              </div>
            )}
            <label className="block">
              <span className="mb-1 block font-medium text-slate-700">Reason (optional)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Missed the back windows" className="w-full rounded-lg border border-slate-200 px-3 py-2" />
            </label>
            <p className="text-xs text-slate-500">The refund comes off your money in and your accounts on today&apos;s date. The original payment stays as it was.</p>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            <button type="button" onClick={save} disabled={busy || !(Number(amount) > 0)} className="w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
              {busy ? "Refunding…" : `Refund ${fmtCurrency(Number(amount) || 0)}`}
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}

/** Give back a customer's spare credit. */
export function RefundCreditButton({ customerId, credit }: { customerId: number; credit: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(credit.toFixed(2));
  const [how, setHow] = useState<"CASH" | "BACS" | "CARD">("BACS");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try { await refundCustomerCredit(customerId, { amount: Number(amount), how, reason }); setOpen(false); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't refund."); }
    setBusy(false);
  };
  return (
    <>
      <button type="button" onClick={() => { setAmount(credit.toFixed(2)); setOpen(true); }} className="text-xs font-semibold text-slate-500 hover:text-amber-700 hover:underline">Refund credit</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Refund credit">
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium text-slate-700">Amount (up to {fmtCurrency(credit)})</span>
            <input type="number" min="0.01" step="0.01" max={credit} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2" />
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["BACS", "CASH", "CARD"] as const).map((h) => (
              <button key={h} type="button" onClick={() => setHow(h)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${how === h ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-700"}`}>{HOW_LABEL[h]}</button>
            ))}
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Reason (optional), e.g. Moving away" className="w-full rounded-lg border border-slate-200 px-3 py-2" />
          <p className="text-xs text-slate-500">Give the money back yourself; this records it. It comes off your money in and accounts today.</p>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <button type="button" onClick={save} disabled={busy || !(Number(amount) > 0)} className="w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
            {busy ? "Refunding…" : `Refund ${fmtCurrency(Number(amount) || 0)}`}
          </button>
        </div>
      </Modal>
    </>
  );
}
