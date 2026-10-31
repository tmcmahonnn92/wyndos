"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calculator as CalcIcon, ChevronLeft } from "lucide-react";
import type { CalcInput, PricingConfig } from "@/lib/pricing-calc";
import { openQuotesForPricing, priceQuote } from "@/lib/pricing-actions";
import { Modal } from "@/components/ui/modal";
import { fmtCurrency, cn } from "@/lib/utils";
import { Calculator } from "./calculator";
import { PriceListEditor } from "./price-list-editor";

type OpenQuote = Awaited<ReturnType<typeof openQuotesForPricing>>[number];

/** Quotes → Price calculator: work out a price on the spot, put it on a quote, or edit the price list. */
export function CalculatorPage({ config, canEdit, canUse, saved }: { config: PricingConfig; canEdit: boolean; canUse: boolean; saved: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"calc" | "list">(canUse ? "calc" : "list");
  const [pending, setPending] = useState<{ input: CalcInput; price: number } | null>(null);
  const [quotes, setQuotes] = useState<OpenQuote[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const choose = async (input: CalcInput, price: number) => {
    setPending({ input, price }); setMsg(""); setQuotes(null);
    setQuotes(await openQuotesForPricing());
  };
  const apply = async (q: OpenQuote) => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await priceQuote(q.id, pending.input);
      setMsg(`${q.name}: quoted ${fmtCurrency(r.price)}.`);
      setPending(null);
      router.refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save."); }
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-5">
      <Link href="/quotes" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft size={15} /> Quotes</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-white"><CalcIcon size={20} /> Price calculator</h1>
        {canEdit && canUse && (
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {([["calc", "Calculator"], ["list", "Price list"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold", tab === k ? "bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-white" : "text-slate-500")}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {msg && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{msg} <Link href="/quotes" className="font-semibold underline">See quotes</Link></p>}
      {tab === "calc" ? <Calculator config={config} onUse={choose} useLabel="Put this price on a quote" /> : <PriceListEditor initial={config} saved={saved} />}

      <Modal open={Boolean(pending)} onClose={() => setPending(null)} title={`Quote ${pending ? fmtCurrency(pending.price) : ""} to…`}>
        <div className="space-y-2 text-sm">
          {!quotes ? <p className="text-slate-500">Loading…</p> : quotes.length === 0 ? (
            <p className="text-slate-600">No open quotes. Book the quote visit first (Quotes → Book quote), then put the price on it.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {quotes.map((q) => (
                <li key={q.id}>
                  <button type="button" disabled={busy} onClick={() => apply(q)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                    <span className="min-w-0 flex-1"><span className="block font-medium">{q.name}</span><span className="block truncate text-xs text-slate-500">{q.address}</span></span>
                    {q.quotedPrice != null && <span className="text-xs text-slate-500">was {fmtCurrency(q.quotedPrice)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}
