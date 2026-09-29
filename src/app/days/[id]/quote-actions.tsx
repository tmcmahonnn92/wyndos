"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, UserCheck, X } from "lucide-react";
import { markQuoted, markQuoteLost, markQuoteWon } from "@/lib/actions";
import { PAYMENT_PREFERENCES } from "@/lib/payment-preference";
import { fmtCurrency, cn } from "@/lib/utils";

type QuoteJob = {
  id: number;
  status: string;
  quoteStatus: string | null;
  quotedPrice: number | null;
  quotedFrequencyWeeks: number | null;
  customer: { areaId: number; frequencyWeeks: number; price: number; preferredPaymentMethod?: string | null };
};

const FREQUENCIES = [1, 2, 4, 6, 8, 12, 26, 52];

export function quoteStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "QUOTED": return "Quoted";
    case "WON": return "Live customer";
    case "LOST": return "Lost";
    default: return "To quote";
  }
}

/**
 * Buttons on a quote visit card. Workers mark it quoted (price + how often);
 * owners can also mark the customer live straight away, or lost.
 */
export function QuoteActions({ job, canMarkLive }: { job: QuoteJob; canMarkLive: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [panel, setPanel] = useState<"none" | "quoted" | "live">("none");
  const [price, setPrice] = useState(job.quotedPrice != null ? String(job.quotedPrice) : job.customer.price ? String(job.customer.price) : "");
  const [frequency, setFrequency] = useState(String(job.quotedFrequencyWeeks ?? job.customer.frequencyWeeks ?? 4));
  const [note, setNote] = useState("");
  const [areas, setAreas] = useState<Array<{ id: number; name: string }>>([]);
  const [areaId, setAreaId] = useState("");
  const [firstClean, setFirstClean] = useState("");
  const [paysBy, setPaysBy] = useState(job.customer.preferredPaymentMethod ?? "");
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        setPanel("none");
        router.refresh();
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Could not save.");
      }
    });
  };

  const openLive = async () => {
    setPanel("live");
    if (areas.length === 0) {
      try {
        const response = await fetch("/api/areas");
        if (response.ok) {
          const list = (await response.json()) as Array<{ id: number; name: string }>;
          setAreas(list);
          if (list.some((area) => area.id === job.customer.areaId)) setAreaId(String(job.customer.areaId));
        }
      } catch { /* offline: areas stay empty */ }
    }
  };

  const status = job.quoteStatus ?? "TO_VISIT";
  if (status === "WON" || status === "LOST") return null;

  return (
    <div className="border-t border-purple-100 bg-purple-50/60" onClick={(event) => event.stopPropagation()}>
      <div className="flex">
        {status === "TO_VISIT" && (
          <button
            type="button"
            onClick={() => setPanel(panel === "quoted" ? "none" : "quoted")}
            className="flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-semibold text-purple-800 hover:bg-purple-100"
          >
            <ClipboardCheck size={15} /> Mark quoted
          </button>
        )}
        {canMarkLive && (
          <button
            type="button"
            onClick={() => (panel === "live" ? setPanel("none") : openLive())}
            className="flex flex-1 items-center justify-center gap-2 border-l border-purple-100 py-2.5 text-sm font-semibold text-green-800 hover:bg-green-50"
          >
            <UserCheck size={15} /> Mark live customer
          </button>
        )}
      </div>

      {panel === "quoted" && (
        <div className="space-y-2 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-medium text-purple-900">
              Price quoted (£)
              <input type="number" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
                className="mt-1 w-full rounded-lg border border-purple-200 bg-white px-2 py-2 text-sm" />
            </label>
            <label className="text-[11px] font-medium text-purple-900">
              Every
              <select value={frequency} onChange={(e) => setFrequency(e.target.value)}
                className="mt-1 w-full rounded-lg border border-purple-200 bg-white px-2 py-2 text-sm">
                {FREQUENCIES.map((weeks) => <option key={weeks} value={weeks}>{weeks} week{weeks === 1 ? "" : "s"}</option>)}
              </select>
            </label>
          </div>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, e.g. wants a callback Friday"
            className="w-full rounded-lg border border-purple-200 bg-white px-2 py-2 text-sm" />
          <button
            type="button"
            disabled={isPending || price === ""}
            onClick={() => run(() => markQuoted(job.id, { price: parseFloat(price), frequencyWeeks: Number(frequency), notes: note }))}
            className="w-full rounded-lg bg-purple-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Save quote
          </button>
        </div>
      )}

      {panel === "live" && (
        <div className="space-y-2 p-3">
          <p className="text-[11px] text-green-900">They said yes: add them as a normal customer. They join the area&apos;s runs from now on.</p>
          <label className="block text-[11px] font-medium text-green-900">
            Area
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-green-200 bg-white px-2 py-2 text-sm">
              <option value="">Choose area…</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}{"frequencyWeeks" in area && area.frequencyWeeks ? ` · every ${area.frequencyWeeks} wks` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-medium text-green-900">
              Price (£)
              <input type="number" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
                className="mt-1 w-full rounded-lg border border-green-200 bg-white px-2 py-2 text-sm" />
            </label>
            <label className="text-[11px] font-medium text-green-900">
              First clean <span className="font-normal">(optional)</span>
              <input type="date" value={firstClean} onChange={(e) => setFirstClean(e.target.value)}
                className="mt-1 w-full rounded-lg border border-green-200 bg-white px-2 py-2 text-sm" />
            </label>
            <label className="text-[11px] font-medium text-green-900">
              Usually pays by
              <select value={paysBy} onChange={(e) => setPaysBy(e.target.value)}
                className="mt-1 w-full rounded-lg border border-green-200 bg-white px-2 py-2 text-sm">
                <option value="">Not set</option>
                {PAYMENT_PREFERENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending || !areaId || !price}
              onClick={() => run(() => markQuoteWon(job.id, {
                areaId: Number(areaId),
                price: parseFloat(price),
                frequencyWeeks: Number(frequency),
                firstCleanISO: firstClean || undefined,
                preferredPaymentMethod: paysBy,
              }))}
              className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Make live customer
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => markQuoteLost(job.id))}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600"
            >
              <X size={13} /> Lost
            </button>
          </div>
        </div>
      )}
      {error && <p className="mx-3 mb-3 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** Small summary badge text for a quote card, e.g. "Quoted £18 every 4w". */
export function quoteSummary(job: { quoteStatus: string | null; quotedPrice: number | null; quotedFrequencyWeeks: number | null }) {
  const label = quoteStatusLabel(job.quoteStatus);
  if (job.quotedPrice == null) return label;
  return `${label} ${fmtCurrency(job.quotedPrice)}${job.quotedFrequencyWeeks ? ` every ${job.quotedFrequencyWeeks}w` : ""}`;
}

export const quoteCardClass = (status: string | null | undefined) => cn(
  "bg-purple-50 border-purple-300 shadow-sm",
  status === "LOST" && "opacity-60",
);
