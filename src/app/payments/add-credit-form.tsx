"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PiggyBank } from "lucide-react";
import { addCustomerCredit } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn, fmtCurrency } from "@/lib/utils";

export type CreditCustomerOption = { id: number; name: string; address: string; credit: number };

/** Paid in advance, or paid extra: kept as credit that comes off the next cleans. */
export function AddCreditForm({
  customers,
  initialCustomerId,
  buttonLabel = "Add credit",
  buttonClassName,
}: {
  customers: CreditCustomerOption[];
  initialCustomerId?: number;
  buttonLabel?: string;
  buttonClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "BACS" | "CARD">("BACS");
  const [notes, setNotes] = useState("");
  const [paidAt, setPaidAt] = useState(today);

  const selected = customers.find((c) => String(c.id) === customerId) ?? null;
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers.slice(0, 30);
    return customers.filter((c) => `${c.name} ${c.address}`.toLowerCase().includes(q)).slice(0, 30);
  }, [customers, search]);

  const reset = () => {
    setCustomerId(initialCustomerId ? String(initialCustomerId) : "");
    setSearch("");
    setAmount("");
    setMethod("BACS");
    setNotes("");
    setPaidAt(today);
    setError(null);
  };

  const submit = () => {
    if (!selected) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) { setError("Enter an amount above £0."); return; }
    setError(null);
    startTransition(async () => {
      try {
        await addCustomerCredit({ customerId: selected.id, amount: value, method, notes: notes || undefined, paidAt: new Date(paidAt) });
        setOpen(false);
        router.refresh();
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Couldn't save that.");
      }
    });
  };

  return (
    <>
      <Button size="sm" variant="outline" className={buttonClassName} onClick={() => { reset(); setOpen(true); }}>
        <PiggyBank size={15} />
        {buttonLabel}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add credit">
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            For money paid in advance, or paid extra. It pays anything they owe first, then comes off their next cleans.
            If it doesn&apos;t cover a whole clean, the rest is still owing.
          </p>

          {selected ? (
            <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-green-900">{selected.name}</p>
                <p className="truncate text-xs text-green-800">
                  {selected.credit > 0.005 ? `${fmtCurrency(selected.credit)} credit now` : "No credit now"}
                </p>
              </div>
              {!initialCustomerId && (
                <button type="button" onClick={() => setCustomerId("")} className="text-xs text-green-800 underline">Change</button>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer"
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <ul className="max-h-48 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                {matches.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setCustomerId(String(c.id))} className="w-full px-3 py-2 text-left hover:bg-slate-50">
                      <p className="truncate text-sm font-medium text-slate-700">{c.name}</p>
                      <p className="truncate text-xs text-slate-400">{c.address}</p>
                    </button>
                  </li>
                ))}
                {matches.length === 0 && <li className="px-3 py-2 text-xs text-slate-400">No match.</li>}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Amount (£)</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Date</span>
              <input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {([["CASH", "Cash"], ["BACS", "Bank"], ["CARD", "Card"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMethod(value)}
                className={cn(
                  "rounded-lg border py-2 text-sm font-medium",
                  method === value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Note, e.g. paid for 3 cleans"
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={submit} disabled={isPending || !selected || !amount} className="flex-1">
              {isPending ? "Saving…" : "Add credit"}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
