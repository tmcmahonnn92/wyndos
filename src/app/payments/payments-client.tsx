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
  StickyNote,
  FileUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { syncGoCardlessPayments } from "@/lib/actions";
import { LogPaymentForm, type PaymentCustomerOption } from "./log-payment-form";
import { AddCreditForm, type CreditCustomerOption } from "./add-credit-form";
import { smsHref } from "@/components/phone-send-queue";
import { fillTemplate } from "@/components/text-placeholders";
import { greetingName } from "@/lib/text-format";
import { logPhoneText, queuePhoneTexts } from "@/lib/text-actions";
import { SendOnPhone } from "@/components/send-on-phone";
import { ukMobile } from "@/lib/text-format";
import { GOCARDLESS_ENABLED, INVOICE_EMAIL_ENABLED } from "@/lib/features";

export type Debtor = PaymentCustomerOption & {
  email: string;
  phone: string;
  jobIds: number[];
  credit?: number;
  daysOwing?: number;
  late?: boolean;
};

type AreaFilter = {
  id: number;
  name: string;
  color?: string | null;
};

export function PaymentsToolbar({
  customers,
  allCustomers,
  allowCredit = true,
  goCardlessConfigured,
  goCardlessLastSyncedAt,
}: {
  customers: Debtor[];
  allCustomers: CreditCustomerOption[];
  allowCredit?: boolean;
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
      {GOCARDLESS_ENABLED && goCardlessConfigured && <div className="text-right hidden sm:block">
        <p className="text-[11px] font-medium text-slate-500">GoCardless</p>
        <p className="text-[11px] text-slate-400">{goCardlessLastSyncedAt ? `Last sync ${new Date(goCardlessLastSyncedAt).toLocaleString("en-GB")}` : "Not synced yet"}</p>
      </div>}
      {GOCARDLESS_ENABLED && goCardlessConfigured && <button
        type="button"
        onClick={handleSync}
        disabled={!goCardlessConfigured || isSyncing}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        title={!goCardlessConfigured ? "Configure GoCardless in Settings first" : "Sync confirmed GoCardless payments"}
      >
        <RefreshCw size={14} className={cn(isSyncing && "animate-spin")} />
        {isSyncing ? "Syncing..." : "Sync GoCardless"}
      </button>}
      <Link
        href="/payments/import"
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        title="Match payments from a bank statement or spreadsheet"
      >
        <FileUp size={14} />
        <span className="hidden sm:inline">Bank statement</span>
      </Link>
      {allowCredit && <AddCreditForm customers={allCustomers} buttonClassName="whitespace-nowrap" />}
      <LogPaymentForm customers={customers} buttonClassName="whitespace-nowrap" allowCredit={allowCredit} />

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
  textVars = {},
  onClose,
}: {
  debtor: Debtor;
  businessName: string;
  templates?: string[];
  textVars?: Record<string, string>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<0 | 1 | 2>(0);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // On a computer the text is saved for the phone; these are its ids.
  const [queuedIds, setQueuedIds] = useState<number[] | null>(null);
  const onComputer = typeof navigator !== "undefined" && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const tpl = SMS_TEMPLATES[selected];
  const amount = fmtCurrency(debtor.debt);
  const firstName = debtor.name.split(" ")[0];

  // Use settings template if provided and non-empty, otherwise fall back to hardcoded
  const settingsTmpl = templates?.[selected]?.trim();
  const message = settingsTmpl
    ? fillTemplate(settingsTmpl, {
        ...textVars,
        customerName: debtor.name,
        customerFirstName: greetingName(debtor.name, debtor.address ?? ""),
        amountDue: amount,
        businessName,
        areaName: debtor.areaName ?? "",
        customerAddress: debtor.address ?? "",
        paymentReference: (debtor.address ?? "").split(",")[0]?.trim() || debtor.name,
      })
    : tpl.msg(firstName, amount, businessName);

  const handleSend = async () => {
    const phone = debtor.phone?.trim();
    if (!phone) { setError("This customer has no phone number saved. Edit their profile to add one."); return; }
    const to = ukMobile(phone);
    if (!to) { setError("That number isn't a UK mobile, so it can't take a text."); return; }
    setSending(true);
    setError(null);
    // Texts go from your own phone: log it (so it shows in the text log), then open Messages.
    try {
      await logPhoneText({ customerId: debtor.id, body: message, kind: selected === 0 ? "PAYMENT_REMINDER_1" : selected === 1 ? "PAYMENT_REMINDER_2" : "BULK" });
    } catch {
      // Not allowed to see texts, or offline: still let them send it.
    }
    setSending(false);
    setDone(true);
    window.location.href = smsHref(to, message);
  };

  const handleQueueForPhone = async () => {
    const to = ukMobile(debtor.phone?.trim() ?? "");
    if (!to) { setError("This customer has no UK mobile saved."); return; }
    setSending(true);
    setError(null);
    try {
      const result = await queuePhoneTexts({
        items: [{ customerId: debtor.id, body: message }],
        kind: selected === 0 ? "PAYMENT_REMINDER_1" : selected === 1 ? "PAYMENT_REMINDER_2" : "PAYMENT_CHASE",
      });
      setQueuedIds(result.ids);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Couldn't save the text.");
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

        {queuedIds ? (
          <div className="space-y-3">
            <SendOnPhone ids={queuedIds} />
            <button onClick={onClose} className="w-full rounded-lg bg-slate-100 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">Done</button>
          </div>
        ) : done ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 size={36} className="text-green-500" />
            <p className="font-semibold text-slate-700">Opened in Messages</p>
            <p className="text-xs text-slate-500">Press Send on your phone. It&apos;s in the text log.</p>
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
                {sending ? "Opening…" : "Open in Messages"}
              </button>
            </div>
            {onComputer && (
              <button
                onClick={handleQueueForPhone}
                disabled={sending}
                className="w-full rounded-lg border border-blue-200 bg-blue-50 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
              >
                On a computer? Send from my phone instead
              </button>
            )}
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

/** Search by name, address or amount ("14", "£14.00", "14.5"). */
export function matchesPaymentSearch(query: string, texts: string[], amounts: number[]) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (texts.some((t) => t.toLowerCase().includes(q))) return true;
  const num = q.replace(/[£,\s]/g, "");
  if (/^\d+(\.\d{0,2})?$/.test(num)) {
    return amounts.some((a) => {
      const fixed = a.toFixed(2);
      return fixed === Number(num).toFixed(2) || fixed.startsWith(num) || String(a).startsWith(num);
    });
  }
  return false;
}

export function DebtorsPanel({
  debtors,
  areas,
  businessName,
  smsTemplates,
  textVars,
  query = "",
  onlyLate = false,
}: {
  debtors: Debtor[];
  areas: AreaFilter[];
  businessName: string;
  smsTemplates?: string[];
  textVars?: Record<string, string>;
  query?: string;
  onlyLate?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [smsDebtor, setSmsDebtor] = useState<Debtor | null>(null);
  const [invoicing, setInvoicing] = useState<Set<number>>(new Set());
  const [bulkInvoicing, setBulkInvoicing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const emailInvoicingEnabled = INVOICE_EMAIL_ENABLED;
  // Reminders open in the phone's own Messages app.
  const smsRemindersEnabled = true;

  const filteredDebtors = useMemo(
    () => (selectedAreaId ? debtors.filter((debtor) => debtor.areaId === selectedAreaId) : debtors)
      .filter((debtor) => !onlyLate || debtor.late)
      .filter((debtor) => matchesPaymentSearch(query, [debtor.name, debtor.address, debtor.areaName ?? "", ...debtor.unpaidJobs.map((j) => j.notes ?? "")], [Number(debtor.debt)])),
    [debtors, selectedAreaId, query, onlyLate]
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


      {/* Debtor rows */}
      <ul className="divide-y divide-slate-100 dark:divide-[#1E2840]">
        {filteredDebtors.map((c) => (
          <li key={c.id} className={cn("py-3 transition-colors", selected.has(c.id) && "bg-blue-50/60")}>
            <div className="flex items-start gap-2.5">
              <button onClick={() => toggleSelect(c.id)} className="mt-0.5 flex-shrink-0 p-0.5 text-slate-300 hover:text-blue-600" aria-label="Select">
                {selected.has(c.id) ? <CheckSquare size={15} className="text-blue-600" /> : <Square size={15} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/customers/${c.id}`} className="min-w-0 truncate text-[15px] font-semibold text-slate-800 hover:text-blue-600 dark:text-slate-100">
                    {c.name}
                  </Link>
                  <span className="flex-shrink-0 text-sm font-bold tabular-nums text-red-600">{fmtCurrency(Number(c.debt))}</span>
                </div>
                {c.address && c.address !== c.name && <p className="truncate text-xs text-slate-500">{c.address}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {c.areaName && <span className="font-medium text-slate-600">{c.areaName}</span>}
                  <span className="text-slate-400">{c.unpaidJobs.length} unpaid</span>
                  {c.late && (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-600 ring-1 ring-red-200">
                      {c.daysOwing} days
                    </span>
                  )}
                  {(c.credit ?? 0) > 0.005 && (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 font-semibold text-green-700 ring-1 ring-green-200">
                      {fmtCurrency(c.credit ?? 0)} credit
                    </span>
                  )}
                </div>
                <ul className="mt-2 space-y-1">
                  {c.unpaidJobs.map((job) => (
                    <li key={job.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-[#131929]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-slate-600">{job.name || "Window Cleaning"} · {fmtDate(job.date ?? null)}</span>
                        <span className="flex-shrink-0 font-semibold tabular-nums text-slate-700">{fmtCurrency(job.due)}</span>
                      </div>
                      {job.notes && (
                        <p className="mt-0.5 flex items-start gap-1 text-[11px] text-amber-800">
                          <StickyNote size={10} className="mt-0.5 flex-shrink-0" />
                          <span><b className="font-semibold">Completion notes:</b> {job.notes}</span>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {emailInvoicingEnabled && (
                    <button
                      onClick={() => sendInvoice(c)}
                      disabled={invoicing.has(c.id)}
                      className="flex items-center gap-1 rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                    >
                      {invoicing.has(c.id) ? <Loader2 size={11} className="animate-spin" /> : <Receipt size={11} />}
                      Invoice
                    </button>
                  )}
                  <button
                    onClick={() => smsRemindersEnabled && setSmsDebtor(c)}
                    title={c.phone ? `Text ${c.phone}` : "No phone — add one to their profile"}
                    className={cn(
                      "flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors",
                      c.phone ? "border-slate-200 text-slate-600 hover:bg-slate-100" : "border-slate-200 text-slate-400 cursor-not-allowed",
                    )}
                  >
                    <MessageSquare size={11} />
                    Remind
                  </button>
                  <LogPaymentForm
                    customers={debtors}
                    initialCustomerId={c.id}
                    buttonLabel="Log payment"
                    buttonVariant="outline"
                    buttonClassName="text-xs"
                  />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {filteredDebtors.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          {onlyLate ? "Nobody is late paying." : "No customers owing here."}
        </div>
      )}

      {smsDebtor && (
        <SmsModal
          debtor={smsDebtor}
          businessName={businessName}
          templates={smsTemplates}
          textVars={textVars}
          onClose={() => setSmsDebtor(null)}
        />
      )}
      {result && <InvoiceResult result={result} onClose={() => setResult(null)} />}
    </>
  );
}
