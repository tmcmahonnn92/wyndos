"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CheckSquare, Plus, Square } from "lucide-react";
import { logPayment, logPaymentForSelectedJobs } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn, fmtCurrency, fmtDate } from "@/lib/utils";

export type PaymentJobOption = {
  id: number;
  name?: string;
  price: number;
  paid: number;
  due: number;
  isOneOff?: boolean;
  date?: Date | string | null;
};

export type PaymentCustomerOption = {
  id: number;
  name: string;
  address: string;
  areaId?: number | null;
  areaName?: string;
  debt: number;
  unpaidJobs: PaymentJobOption[];
};

export function LogPaymentForm({
  customers,
  initialCustomerId,
  buttonLabel = "Log Payment",
  buttonVariant = "primary",
  buttonClassName,
  size = "sm",
}: {
  customers: PaymentCustomerOption[];
  initialCustomerId?: number;
  buttonLabel?: string;
  buttonVariant?: "primary" | "outline" | "ghost";
  buttonClassName?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [customerId, setCustomerId] = useState("");
  const [mode, setMode] = useState<"selected-jobs" | "amount-only">("selected-jobs");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "BACS" | "CARD">("CASH");
  const [notes, setNotes] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());

  const selectedCustomer = useMemo(
    () => customers.find((customer) => String(customer.id) === customerId) ?? null,
    [customerId, customers]
  );

  const selectedJobTotal = useMemo(() => {
    if (!selectedCustomer) return 0;
    return Number(
      selectedCustomer.unpaidJobs
        .filter((job) => selectedJobIds.has(job.id))
        .reduce((sum, job) => sum + job.due, 0)
        .toFixed(2)
    );
  }, [selectedCustomer, selectedJobIds]);

  const resetForm = (nextCustomerId?: number) => {
    const id = nextCustomerId ? String(nextCustomerId) : "";
    const customer = customers.find((entry) => entry.id === nextCustomerId) ?? null;
    setCustomerId(id);
    setMode("selected-jobs");
    setAmount(customer ? customer.debt.toFixed(2) : "");
    setMethod("CASH");
    setNotes("");
    setPaidAt(today);
    setSelectedJobIds(new Set(customer?.unpaidJobs.map((job) => job.id) ?? []));
  };

  const handleOpen = () => {
    resetForm(initialCustomerId);
    setOpen(true);
  };

  const handleCustomerChange = (nextId: string) => {
    setCustomerId(nextId);
    const customer = customers.find((entry) => String(entry.id) === nextId) ?? null;
    setAmount(customer ? customer.debt.toFixed(2) : "");
    setSelectedJobIds(new Set(customer?.unpaidJobs.map((job) => job.id) ?? []));
  };

  const toggleJob = (jobId: number) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!selectedCustomer) return;
    startTransition(async () => {
      if (mode === "selected-jobs") {
        await logPaymentForSelectedJobs({
          customerId: selectedCustomer.id,
          jobIds: Array.from(selectedJobIds),
          method,
          notes: notes || undefined,
          paidAt: new Date(paidAt),
        });
      } else {
        await logPayment({
          customerId: selectedCustomer.id,
          amount: Number(amount),
          method,
          notes: notes || undefined,
          paidAt: new Date(paidAt),
        });
      }
      setOpen(false);
      resetForm(initialCustomerId);
      router.refresh();
    });
  };

  const jobsSelected = selectedJobIds.size;
  const submitDisabled =
    isPending ||
    !selectedCustomer ||
    (mode === "selected-jobs"
      ? jobsSelected === 0 || selectedJobTotal <= 0
      : !amount || Number(amount) <= 0);

  return (
    <>
      <Button
        onClick={handleOpen}
        size={size}
        variant={buttonVariant}
        className={buttonClassName}
        disabled={customers.length === 0}
      >
        <Plus size={15} />
        {buttonLabel}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Log Payment">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Customer owing</label>
            <select
              value={customerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">– Select customer –</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} – {customer.address}
                </option>
              ))}
            </select>
          </div>

          {selectedCustomer && (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <p className="text-sm font-semibold text-amber-800">{selectedCustomer.name}</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Owes {fmtCurrency(selectedCustomer.debt)}
                  {selectedCustomer.areaName ? ` · ${selectedCustomer.areaName}` : ""}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">How to log this payment</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("selected-jobs")}
                    className={cn(
                      "py-2 rounded-lg border text-sm font-medium transition-colors",
                      mode === "selected-jobs"
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 text-slate-600 hover:border-blue-300"
                    )}
                  >
                    Specific jobs
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("amount-only");
                      setAmount(selectedCustomer.debt.toFixed(2));
                    }}
                    className={cn(
                      "py-2 rounded-lg border text-sm font-medium transition-colors",
                      mode === "amount-only"
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 text-slate-600 hover:border-blue-300"
                    )}
                  >
                    Amount only
                  </button>
                </div>
              </div>

              {mode === "selected-jobs" ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-slate-700">Which jobs are being paid</label>
                    <div className="flex items-center gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => setSelectedJobIds(new Set(selectedCustomer.unpaidJobs.map((job) => job.id)))}
                        className="text-blue-600 hover:underline"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedJobIds(new Set())}
                        className="text-slate-400 hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {selectedCustomer.unpaidJobs.length === 0 ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                      No unpaid completed jobs found for this customer.
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-60 overflow-y-auto">
                      {selectedCustomer.unpaidJobs.map((job) => {
                        const checked = selectedJobIds.has(job.id);
                        return (
                          <button
                            key={job.id}
                            type="button"
                            onClick={() => toggleJob(job.id)}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors",
                              checked ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-slate-300 bg-white"
                            )}
                          >
                            {checked ? (
                              <CheckSquare size={16} className="text-blue-600 flex-shrink-0" />
                            ) : (
                              <Square size={16} className="text-slate-400 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-700 truncate">
                                {job.name || "Window Cleaning"}
                              </p>
                              <p className="text-xs text-slate-400 truncate">
                                {fmtDate(job.date ?? null)}
                                {job.isOneOff ? " · one-off" : ""}
                                {job.paid > 0 ? ` · paid ${fmtCurrency(job.paid)}` : ""}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-xs text-slate-400">{fmtCurrency(job.price)}</p>
                              <p className="text-sm font-semibold text-red-600">{fmtCurrency(job.due)} due</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between">
                    <p className="text-sm text-slate-600">{jobsSelected} job{jobsSelected !== 1 ? "s" : ""} selected</p>
                    <p className="text-sm font-bold text-slate-800">{fmtCurrency(selectedJobTotal)}</p>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Amount (£)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 15.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Use this when you just want to log an amount without choosing jobs.
                  </p>
                </div>
              )}
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Method</label>
            <div className="grid grid-cols-3 gap-2">
              {(["CASH", "BACS", "CARD"] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => setMethod(entry)}
                  className={cn(
                    "py-2 rounded-lg border text-sm font-medium transition-colors",
                    method === entry
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 text-slate-600 hover:border-blue-300"
                  )}
                >
                  {entry}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
            <input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
            <input
              type="text"
              placeholder="e.g. paid at door"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={handleSubmit} disabled={submitDisabled} className="flex-1">
              <Banknote size={14} />
              {isPending
                ? "Logging..."
                : mode === "selected-jobs"
                  ? `Mark Paid · ${fmtCurrency(selectedJobTotal)}`
                  : `Log Payment · ${fmtCurrency(Number(amount) || 0)}`}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
