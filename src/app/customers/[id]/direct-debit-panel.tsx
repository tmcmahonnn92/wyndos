"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, Landmark, Loader2 } from "lucide-react";
import { getDirectDebitSharing, sendDirectDebitLink, shareDirectDebit, stopUsingDirectDebit } from "@/lib/gocardless/actions";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const [sharing, setSharing] = useState<{ sharedWith: Brief[]; options: Brief[] } | null>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => { getDirectDebitSharing(customerId).then(setSharing).catch(() => setSharing(null)); }, [customerId, mandateId]);

  return (
    <section className="mx-auto max-w-lg px-4 pb-4">
      <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-[#1E2840] dark:bg-[#131929]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><Landmark size={15} /> Direct Debit</p>
          <span className={ok ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800" : mandateId ? "rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700" : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600"}>{status}</span>
        </div>
        {mandateId && <p className="text-xs text-slate-500">Mandate {mandateId}{reference ? ` · reference ${reference}` : ""}</p>}
        {sharing && sharing.sharedWith.length > 0 && (
          <p className="rounded-lg bg-blue-50 px-2 py-1.5 text-xs text-blue-900">
            <b>Shared Direct Debit</b>: also used by {sharing.sharedWith.map((c, i) => (
              <span key={c.id}>{i > 0 ? ", " : ""}<Link href={`/customers/${c.id}`} className="font-semibold underline">{c.name}</Link></span>
            ))}. Each customer&apos;s cleans are collected separately, with the address on each payment.
          </p>
        )}
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
        {!ok && sharing && sharing.options.length > 0 && !picking && (
          <button type="button" onClick={() => setPicking(true)} className="text-xs font-semibold text-blue-700 hover:underline">
            Someone else pays? Use another customer&apos;s Direct Debit
          </button>
        )}
        {picking && <ShareDirectDebitPicker customerId={customerId} options={sharing?.options ?? []} onDone={() => { setPicking(false); router.refresh(); }} onCancel={() => setPicking(false)} />}
        {mandateId && (
          <button type="button" disabled={pending} onClick={() => {
            if (!window.confirm(sharing?.sharedWith.length
              ? "Stop this customer using the shared Direct Debit? The others carry on using it. Nothing changes in GoCardless."
              : "Stop using this Direct Debit in Wyndos? Nothing more will be collected for this customer. The Direct Debit itself isn't cancelled in GoCardless.")) return;
            start(async () => {
              setError("");
              const res = await stopUsingDirectDebit(customerId);
              if (res.ok) router.refresh(); else setError(res.error);
            });
          }} className="block text-xs text-slate-400 hover:text-red-600 hover:underline">Stop using this Direct Debit</button>
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
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/payments/direct-debit" className="text-xs font-semibold text-blue-700">Collect, sync and link customers →</Link>
          <Link href="/guide/direct-debit" className="text-xs text-slate-500 hover:underline">How Direct Debit works</Link>
        </div>
      </div>
    </section>
  );
}

type Brief = { id: number; name: string; address: string | null };

/** Pick the customer whose Direct Debit also pays for this one. Saves straight away. */
export function ShareDirectDebitPicker({ customerId, options, onDone, onCancel }: {
  customerId: number; options: Brief[]; onDone: (shared: { mandateId: string; gcCustomerId: string }) => void; onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return options.filter((o) => !t || `${o.name} ${o.address ?? ""}`.toLowerCase().includes(t)).slice(0, 20);
  }, [options, q]);
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-2">
      <p className="text-xs text-slate-600">Who pays for this customer? Their Direct Debit will also pay this customer&apos;s cleans (each collected separately).</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or address" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
      <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
        {shown.map((o) => (
          <li key={o.id}>
            <button type="button" disabled={pending} onClick={() => start(async () => {
              setError("");
              const res = await shareDirectDebit(customerId, o.id);
              if (res.ok) onDone(res); else setError(res.error);
            })} className="w-full px-2 py-1.5 text-left text-sm hover:bg-slate-50">
              {o.name}<span className="block truncate text-xs text-slate-500">{o.address}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-2 py-1.5 text-xs text-slate-500">No customers with a Direct Debit match.</li>}
      </ul>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button type="button" onClick={onCancel} className="text-xs text-slate-500 hover:underline">Cancel</button>
    </div>
  );
}

/** In Edit customer: "Pays through someone else's Direct Debit". */
export function EditShareDirectDebit({ customerId, onShared }: { customerId: number; onShared: (shared: { mandateId: string; gcCustomerId: string }) => void }) {
  const router = useRouter();
  const [data, setData] = useState<{ sharedWith: Brief[]; options: Brief[]; hasOwn: boolean } | null>(null);
  const [picking, setPicking] = useState(false);
  const load = () => getDirectDebitSharing(customerId).then(setData).catch(() => setData(null));
  useEffect(() => { void load(); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;
  if (data.sharedWith.length > 0) {
    return <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900"><b>Shared Direct Debit</b> with {data.sharedWith.map((c) => c.name).join(", ")}. Change it under Direct Debit on their page.</p>;
  }
  if (data.hasOwn || data.options.length === 0) return null;
  return picking
    ? <ShareDirectDebitPicker customerId={customerId} options={data.options} onDone={(shared) => { setPicking(false); onShared(shared); void load(); router.refresh(); }} onCancel={() => setPicking(false)} />
    : <button type="button" onClick={() => setPicking(true)} className="text-sm font-semibold text-blue-700 hover:underline">Someone else pays? Use another customer&apos;s Direct Debit</button>;
}
