"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, Landmark, Loader2 } from "lucide-react";
import { sendDirectDebitLink } from "@/lib/gocardless/actions";

const STATUS: Record<string, string> = {
  pending_customer_approval: "Waiting for the customer", pending_submission: "Being set up", submitted: "Submitted to the bank",
  active: "Active", failed: "Failed", cancelled: "Cancelled", expired: "Expired", consumed: "Replaced", blocked: "Blocked",
  suspended_by_payer: "Suspended by the customer",
};
const USABLE = new Set(["pending_customer_approval", "pending_submission", "submitted", "active"]);

/** Direct Debit on the customer page (businesses with GoCardless switched on, owner only). */
export function DirectDebitPanel({ customerId, mandateId, mandateStatus, waitingForSignup, reference, plan = null }: {
  customerId: number; mandateId: string | null; mandateStatus: string | null; waitingForSignup: boolean; reference: string;
  /** Active GoCardless plan (subscription), e.g. "£15.00 a month". */
  plan?: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const status = mandateId ? STATUS[mandateStatus ?? ""] ?? (mandateStatus || "Linked") : waitingForSignup ? "Sign-up link sent, not filled in yet" : "Not set up";
  const ok = mandateId && USABLE.has(mandateStatus ?? "");

  return (
    <section className="mx-auto max-w-lg px-4 pb-4">
      <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-[#1E2840] dark:bg-[#131929]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><Landmark size={15} /> Direct Debit</p>
          <span className={ok ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800" : mandateId ? "rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700" : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600"}>{status}</span>
        </div>
        {mandateId && <p className="text-xs text-slate-500">Mandate {mandateId}{reference ? ` · reference ${reference}` : ""}</p>}
        {plan && <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900">On a GoCardless plan ({plan}). The plan pays their regular cleans (GoCardless takes it, Wyndos records it). Extra jobs, like gutters, are collected separately on the same Direct Debit. To switch to paying per clean, cancel the plan in GoCardless.</p>}
        {!ok && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} onClick={() => start(async () => {
              setError(""); setUrl(null);
              const res = await sendDirectDebitLink(customerId);
              if (res.ok) setUrl(res.url); else setError(res.error);
            })} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
              {pending && <Loader2 size={13} className="animate-spin" />} {waitingForSignup ? "Get a new sign-up link" : "Get sign-up link"}
            </button>
            <span className="text-xs text-slate-500">Send it to the customer: they fill in their bank details with GoCardless.</span>
          </div>
        )}
        {url && (
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs dark:bg-slate-800">
            <span className="min-w-0 flex-1 truncate font-mono">{url}</span>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-700">
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Link href="/payments/direct-debit" className="inline-block text-xs font-semibold text-blue-700">Collect, sync and link customers →</Link>
      </div>
    </section>
  );
}
