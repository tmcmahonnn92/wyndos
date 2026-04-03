"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Receipt,
  RefreshCw,
  MessageSquare,
  CheckSquare,
  Square,
  Send,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtCurrency } from "@/lib/utils";
import { syncGoCardlessPayments } from "@/lib/actions";
import { LogPaymentForm, type PaymentCustomerOption } from "./log-payment-form";

export type Debtor = PaymentCustomerOption & {
  email: string;
  phone: string;
  jobIds: number[];
};

type AreaFilter = {
  id: number;
  name: string;
  color?: string | null;
};

export function PaymentsToolbar({
  customers,
  goCardlessConfigured,
  goCardlessLastSyncedAt,
}: {
  customers: Debtor[];
  goCardlessConfigured: boolean;
  goCardlessLastSyncedAt: string | null;
}) {
  const router = useRouter();
  const [syncResult, setSyncResult] = useState<null | {
    scannedCount: number;
    importedCount: number;
    skippedCount: number;
    unmatched: Array<{ paymentId: string; reason: string; customerName?: string | null }>;
  }>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncing, startSyncTransition] = useTransition();

  const handleSync = () => {
    setSyncError(null);
    startSyncTransition(async () => {
      try {
        const result = await syncGoCardlessPayments();
        setSyncResult(result);
        router.refresh();
      } catch (error) {
        setSyncError(String(error));
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      <div className="text-right hidden sm:block">
        <p className="text-[11px] font-medium text-slate-500">GoCardless</p>
        <p className="text-[11px] text-slate-400">{goCardlessLastSyncedAt ? `Last sync ${new Date(goCardlessLastSyncedAt).toLocaleString("en-GB")}` : "Not synced yet"}</p>
      </div>
      <button
        type="button"
        onClick={handleSync}
        disabled={!goCardlessConfigured || isSyncing}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        title={!goCardlessConfigured ? "Configure GoCardless in Settings first" : "Sync confirmed GoCardless payments"}
      >
        <RefreshCw size={14} className={cn(isSyncing && "animate-spin")} />
        {isSyncing ? "Syncing..." : "Sync GoCardless"}
      </button>
      <LogPaymentForm customers={customers} />

      {(syncError || syncResult) && (
        <div className="fixed bottom-4 right-4 z-50 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">GoCardless sync</p>
              {syncError ? (
                <p className="mt-1 text-sm text-red-600">{syncError}</p>
              ) : syncResult ? (
                <div className="mt-1 space-y-1 text-sm text-slate-600">
                  <p>Scanned {syncResult.scannedCount} payment{syncResult.scannedCount !== 1 ? "s" : ""}.</p>
                  <p>Imported {syncResult.importedCount}, skipped {syncResult.skippedCount}.</p>
                  {syncResult.unmatched.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      {syncResult.unmatched.length} payment{syncResult.unmatched.length !== 1 ? "s" : ""} still need manual matching.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <button type="button" onClick={() => { setSyncError(null); setSyncResult(null); }} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X size={14} />
            </button>
          </div>
          {syncResult && syncResult.unmatched.length > 0 && (
            <ul className="mt-3 space-y-2 text-xs text-slate-600">
              {syncResult.unmatched.map((item) => (
                <li key={item.paymentId} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="font-semibold text-slate-700">{item.paymentId}</span>
                  {item.customerName ? ` · ${item.customerName}` : ""}
                  {` · ${item.reason}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const SMS_TEMPLATES = [
  {
    label: "1st reminder",
    color: "bg-blue-50 border-blue-200 text-blue-700",
    selectedColor: "bg-blue-600 border-blue-600 text-white",
    msg: (name: string, amount: string, biz: string) =>
      `Hi ${name}, just a friendly reminder that you have an outstanding balance of ${amount} for window cleaning. Please arrange payment at your earliest convenience. Many thanks, ${biz}`,
  },
  {
    label: "2nd reminder",
    color: "bg-amber-50 border-amber-200 text-amber-700",
    selectedColor: "bg-amber-500 border-amber-500 text-white",
    msg: (name: string, amount: string, biz: string) =>
      `Hi ${name}, this is a second reminder that your window cleaning balance of ${amount} is now overdue. Please make payment as soon as possible or contact us to discuss. Thanks, ${biz}`,
  },
  {
    label: "3rd reminder",
    color: "bg-red-50 border-red-200 text-red-700",
    selectedColor: "bg-red-600 border-red-600 text-white",
    msg: (name: string, amount: string, biz: string) =>
      `Hi ${name}, this is a final reminder regarding your outstanding window cleaning balance of ${amount}. Please contact us immediately to arrange payment. ${biz}`,
  },
];

function SmsModal({
  debtor,
  businessName,
  templates,
  onClose,
}: {
  debtor: Debtor;
  businessName: string;
  templates?: string[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<0 | 1 | 2>(0);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tpl = SMS_TEMPLATES[selected];
  const amount = fmtCurrency(debtor.debt);
  const firstName = debtor.name.split(" ")[0];

  // Use settings template if provided and non-empty, otherwise fall back to hardcoded
  const settingsTmpl = templates?.[selected]?.trim();
  const message = settingsTmpl
    ? settingsTmpl
        .replaceAll("{{customerName}}", debtor.name)
        .replaceAll("{{customerFirstName}}", firstName)
        .replaceAll("{{amountDue}}", amount)
        .replaceAll("{{businessName}}", businessName)
        .replaceAll("{{areaName}}", debtor.areaName ?? "")
        .replaceAll("{{customerAddress}}", debtor.address ?? "")
    : tpl.msg(firstName, amount, businessName);

  const handleSend = async () => {
    const phone = debtor.phone?.trim();
    if (!phone) { setError("This customer has no phone number saved. Edit their profile to add one."); return; }
    setSending(true);
    setError(null);
    try {
      const r = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: debtor.id, to: phone, message }),
      });
      const data = await r.json();
      if (!r.ok || data.error) { setError(data.error ?? "Failed to send"); }
      else { setDone(true); }
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-800 text-base">Send Reminder — {debtor.name}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 size={36} className="text-green-500" />
            <p className="font-semibold text-slate-700">Reminder sent!</p>
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-sm font-semibold text-slate-700 hover:bg-slate-200">Close</button>
          </div>
        ) : (
          <>
            {/* Reminder level selector */}
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2">Reminder level</p>
              <div className="flex gap-2">
                {SMS_TEMPLATES.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => setSelected(i as 0 | 1 | 2)}
                    className={cn(
                      "flex-1 py-2 rounded-lg border text-xs font-bold transition-colors",
                      selected === i ? t.selectedColor : t.color
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1.5">Message preview</p>
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                {message}
              </div>
              <p className="text-[10px] text-slate-400 mt-1">{message.length} chars · to {debtor.phone || "no number saved"}</p>
            </div>

            {error && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
                <AlertCircle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function InvoiceResult({ result, onClose }: { result: { ok: boolean; msg: string }; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4 text-center" onClick={(e) => e.stopPropagation()}>
        {result.ok
          ? <CheckCircle2 size={40} className="text-green-500 mx-auto" />
          : <AlertCircle size={40} className="text-red-500 mx-auto" />}
        <p className={cn("text-sm font-semibold", result.ok ? "text-slate-700" : "text-red-700")}>{result.msg}</p>
        <button onClick={onClose} className="px-6 py-2 rounded-lg bg-slate-100 text-sm font-semibold text-slate-700 hover:bg-slate-200">Close</button>
      </div>
    </div>
  );
}

export function DebtorsPanel({
  debtors,
  areas,
  businessName,
  smsTemplates,
}: {
  debtors: Debtor[];
  areas: AreaFilter[];
  businessName: string;
  smsTemplates?: string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [smsDebtor, setSmsDebtor] = useState<Debtor | null>(null);
  const [invoicing, setInvoicing] = useState<Set<number>>(new Set());
  const [bulkInvoicing, setBulkInvoicing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const emailInvoicingEnabled = false;
  const smsRemindersEnabled = false;

  const filteredDebtors = useMemo(
    () => selectedAreaId ? debtors.filter((debtor) => debtor.areaId === selectedAreaId) : debtors,
    [debtors, selectedAreaId]
  );

  const totalDebt = filteredDebtors.reduce((sum, customer) => sum + Number(customer.debt), 0);
  const allSelected = filteredDebtors.length > 0 && filteredDebtors.every((debtor) => selected.has(debtor.id));

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        filteredDebtors.forEach((debtor) => next.delete(debtor.id));
      } else {
        filteredDebtors.forEach((debtor) => next.add(debtor.id));
      }
      return next;
    });
  };

  const sendInvoice = async (debtor: Debtor) => {
    if (!emailInvoicingEnabled) {
      setResult({ ok: false, msg: "Invoice email delivery is disabled during the current production-readiness pass." });
      return;
    }
    if (!debtor.jobIds.length) {
      setResult({ ok: false, msg: "No completed jobs found to invoice." });
      return;
    }
    setInvoicing((prev) => new Set(prev).add(debtor.id));
    try {
      const r = await fetch("/api/invoice/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: debtor.id, jobIds: debtor.jobIds }),
      });
      const data = await r.json();
      if (!r.ok || data.error) setResult({ ok: false, msg: data.error ?? "Failed to send invoice" });
      else setResult({ ok: true, msg: `Invoice sent to ${debtor.email || debtor.name}!` });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setInvoicing((prev) => { const n = new Set(prev); n.delete(debtor.id); return n; });
    }
  };

  const sendBulkInvoices = async () => {
    if (!emailInvoicingEnabled) {
      setResult({ ok: false, msg: "Invoice email delivery is disabled during the current production-readiness pass." });
      return;
    }
    const targets = filteredDebtors.filter((d) => selected.has(d.id));
    if (!targets.length) return;
    setBulkInvoicing(true);
    let sent = 0, failed = 0;
    for (const d of targets) {
      if (!d.jobIds.length) { failed++; continue; }
      try {
        const r = await fetch("/api/invoice/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: d.id, jobIds: d.jobIds }),
        });
        if (r.ok) sent++; else failed++;
      } catch { failed++; }
    }
    setBulkInvoicing(false);
    setSelected(new Set());
    setResult({
      ok: failed === 0,
      msg: `${sent} invoice${sent !== 1 ? "s" : ""} sent${failed ? `, ${failed} failed (check email/job setup)` : ""}.`,
    });
    startTransition(() => router.refresh());
  };

  if (debtors.length === 0) return null;

  return (
    <>
      {areas.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => setSelectedAreaId(null)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              selectedAreaId === null
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50"
            )}
          >
            All areas
          </button>
          {areas.map((area) => {
            const active = selectedAreaId === area.id;
            const color = area.color || "#3B82F6";
            return (
              <button
                key={area.id}
                onClick={() => setSelectedAreaId((prev) => prev === area.id ? null : area.id)}
                className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
                style={active
                  ? { backgroundColor: color, borderColor: color, color: "white" }
                  : { borderColor: `${color}66`, color, backgroundColor: "white" }}
              >
                {area.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <button onClick={toggleAll} className="p-0.5 text-slate-400 hover:text-blue-600">
            {allSelected ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} />}
          </button>
          <span className="text-xs text-slate-500">
            {selected.size > 0 ? `${selected.size} selected` : `${filteredDebtors.length} owing · `}
          </span>
          {selected.size === 0 && (
            <span className="text-xs font-bold text-red-600">{fmtCurrency(totalDebt)} total</span>
          )}
        </div>
        {selected.size > 0 && emailInvoicingEnabled && (
          <button
            onClick={sendBulkInvoices}
            disabled={bulkInvoicing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-60"
          >
            {bulkInvoicing ? <Loader2 size={12} className="animate-spin" /> : <Receipt size={12} />}
            {bulkInvoicing ? "Sending…" : `Invoice ${selected.size} selected`}
          </button>
        )}
      </div>

      {!emailInvoicingEnabled && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Email invoicing and SMS reminders are currently disabled while the rollout hardening work is in progress. PDF invoice generation remains available through the protected API route.
        </div>
      )}

      {/* Debtor rows */}
      <div className="divide-y divide-slate-100">
        {filteredDebtors.map((c) => (
          <div key={c.id} className={cn(
            "flex items-center gap-2 py-3 px-1 transition-colors",
            selected.has(c.id) && "bg-blue-50/60"
          )}>
            <button onClick={() => toggleSelect(c.id)} className="p-0.5 text-slate-300 hover:text-blue-600 flex-shrink-0">
              {selected.has(c.id)
                ? <CheckSquare size={15} className="text-blue-600" />
                : <Square size={15} />}
            </button>
            <Link href={`/customers/${c.id}`} className="flex-1 min-w-0 group">
              <p className="text-sm font-medium text-slate-800 group-hover:text-blue-600 truncate">{c.name}</p>
              <p className="text-xs text-slate-400 truncate">{c.address}{c.areaName ? ` · ${c.areaName}` : ""}</p>
              <p className="text-[11px] text-slate-400 truncate">{c.unpaidJobs.length} unpaid job{c.unpaidJobs.length !== 1 ? "s" : ""}</p>
            </Link>
            <span className="text-sm font-bold text-red-600 flex-shrink-0">{fmtCurrency(Number(c.debt))}</span>

            {/* Invoice button */}
            <button
              onClick={() => sendInvoice(c)}
              disabled={!emailInvoicingEnabled || invoicing.has(c.id)}
              title={emailInvoicingEnabled ? (c.email ? `Invoice ${c.email}` : "No email — add one to their profile") : "Email invoicing is disabled for this rollout pass"}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-semibold transition-colors flex-shrink-0",
                emailInvoicingEnabled && c.email
                  ? "border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white hover:border-blue-600"
                  : "border-slate-200 text-slate-400 cursor-not-allowed",
                "disabled:opacity-60"
              )}
            >
              {invoicing.has(c.id)
                ? <Loader2 size={11} className="animate-spin" />
                : <Receipt size={11} />}
              Invoice
            </button>

            {/* SMS reminder button */}
            <button
              onClick={() => smsRemindersEnabled && setSmsDebtor(c)}
              title={smsRemindersEnabled ? (c.phone ? `Text ${c.phone}` : "No phone — add one to their profile") : "SMS reminders are disabled for this rollout pass"}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-semibold transition-colors flex-shrink-0",
                smsRemindersEnabled && c.phone
                  ? "border-slate-200 text-slate-600 hover:bg-slate-700 hover:text-white hover:border-slate-700"
                  : "border-slate-200 text-slate-400 cursor-not-allowed"
              )}
            >
              <MessageSquare size={11} />
              Remind
            </button>

            <LogPaymentForm
              customers={debtors}
              initialCustomerId={c.id}
              buttonLabel="Log Payment"
              buttonVariant="outline"
              buttonClassName="text-xs"
            />
          </div>
        ))}
      </div>

      {filteredDebtors.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No customers owing in this area.
        </div>
      )}

      {smsDebtor && (
        <SmsModal
          debtor={smsDebtor}
          businessName={businessName}
          templates={smsTemplates}
          onClose={() => setSmsDebtor(null)}
        />
      )}
      {result && <InvoiceResult result={result} onClose={() => setResult(null)} />}
    </>
  );
}
