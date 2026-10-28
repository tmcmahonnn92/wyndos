"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Copy, ExternalLink, MessageSquare, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { getPayByBank, makePayByBankLink, stopPayByBankLink } from "@/lib/gocardless/actions";
import { smsHref } from "@/components/phone-send-queue";
import { ukMobile } from "@/lib/text-format";
import { fmtCurrency } from "@/lib/utils";

type Data = Extract<Awaited<ReturnType<typeof getPayByBank>>, { ok: true }>;

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * Pay by Bank: a GoCardless link the customer opens, picks their bank and approves. Confirmed in
 * minutes, then recorded on the cleans. Open it on your phone for them, or text it.
 */
export function PayByBankButton({ customerId, customerName, phone, jobIds, className, label = "Pay by bank" }: {
  customerId: number; customerName: string; phone?: string | null; jobIds?: number[]; className?: string; label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [link, setLink] = useState<{ url: string; amount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setError(""); setData(null); setLink(null);
    const res = await getPayByBank(customerId);
    if (!res.ok) { setError(res.error); return; }
    setData(res);
    const wanted = jobIds?.length ? res.cleans.filter((c) => jobIds.includes(c.jobId)) : res.cleans;
    setChosen(new Set(wanted.map((c) => c.jobId)));
  };
  const start = () => { setOpen(true); void load(); };
  const make = async () => {
    setBusy(true); setError("");
    const res = await makePayByBankLink(customerId, [...chosen]);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setLink({ url: res.url, amount: res.amount });
    router.refresh();
  };
  const stop = async (id: number) => {
    setBusy(true);
    const res = await stopPayByBankLink(id);
    setBusy(false);
    if (!res.ok) setError(res.error);
    await load();
  };
  const total = (data?.cleans ?? []).filter((c) => chosen.has(c.jobId)).reduce((s, c) => s + c.due, 0);
  const mobile = phone ? ukMobile(phone) : null;
  const text = link ? `Hi ${customerName.split(/\s+/)[0]}, here's the link to pay ${fmtCurrency(link.amount)} for your window cleaning straight from your bank: ${link.url}` : "";

  return (
    <>
      <button type="button" onClick={start} className={className ?? "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"}>
        <Landmark size={15} /> {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Pay by bank">
        <div className="space-y-3 text-sm">
          {!data && !error && <p className="text-slate-500">Loading…</p>}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          {data && !link && (
            <>
              <p className="text-xs text-slate-500">
                {customerName} pays from their banking app (no card, no Direct Debit). It&apos;s confirmed in minutes and goes on these cleans.
              </p>
              {data.cleans.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">Nothing owing that can be paid by bank (cleans being collected by Direct Debit aren&apos;t shown).</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {data.cleans.map((c) => (
                    <li key={c.jobId}>
                      <label className="flex items-center gap-2 px-3 py-2">
                        <input type="checkbox" checked={chosen.has(c.jobId)} onChange={(e) => setChosen((s) => { const n = new Set(s); if (e.target.checked) n.add(c.jobId); else n.delete(c.jobId); return n; })} />
                        <span className="flex-1">{c.name} · {day(c.date)}</span>
                        <span className="font-semibold">{fmtCurrency(c.due)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {data.cleans.length > 0 && (
                <button type="button" onClick={make} disabled={busy || chosen.size === 0 || total < 1}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {busy ? "Making link…" : `Make a link for ${fmtCurrency(total)}`}
                </button>
              )}
              {data.open.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-slate-600">Links sent, not paid yet</p>
                  <ul className="space-y-1">
                    {data.open.map((o) => (
                      <li key={o.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                        <span className="flex-1">{fmtCurrency(o.amount)} · made {day(o.createdAt.slice(0, 10))}</span>
                        <button type="button" onClick={() => { void navigator.clipboard?.writeText(o.url); }} className="font-semibold text-blue-700">Copy</button>
                        <button type="button" onClick={() => stop(o.id)} disabled={busy} className="inline-flex items-center gap-0.5 font-semibold text-red-700"><X size={12} /> Stop</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {link && (
            <>
              <p className="rounded-lg bg-green-50 px-3 py-2 text-green-800">Link ready for {fmtCurrency(link.amount)}. It shows as paid here once GoCardless confirms it (usually a few minutes).</p>
              <a href={link.url} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700">
                <ExternalLink size={15} /> Open (they pay on this phone)
              </a>
              <div className="grid grid-cols-2 gap-2">
                {mobile ? (
                  <a href={smsHref(mobile, text)} className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700"><MessageSquare size={14} /> Text it</a>
                ) : <span className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">No mobile number</span>}
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700">
                  <Copy size={14} /> {copied ? "Copied" : "Copy link"}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
