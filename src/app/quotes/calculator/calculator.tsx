"use client";

import { useMemo, useState } from "react";
import { Building2, Home, LayoutList, Minus, Plus, Trash2, Clock } from "lucide-react";
import { BEDROOMS, CATEGORIES, UNIT_LABEL, calculate, type CalcInput, type CalcLine, type PricingConfig } from "@/lib/pricing-calc";
import { fmtCurrency, cn } from "@/lib/utils";

const MODES = [
  { key: "quick", label: "House", icon: Home },
  { key: "detailed", label: "Detailed", icon: LayoutList },
  { key: "commercial", label: "Commercial", icon: Building2 },
] as const;

const field = "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const chip = (on: boolean) => cn("rounded-full border px-3 py-1.5 text-sm font-semibold", on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200");

/** Rows of items with quantity and storey, plus "Add" by category. */
function LinesEditor({ config, lines, onChange }: { config: PricingConfig; lines: CalcLine[]; onChange: (l: CalcLine[]) => void }) {
  const [adding, setAdding] = useState("");
  const byId = new Map(config.items.map((i) => [i.id, i]));
  const set = (i: number, patch: Partial<CalcLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const cats = [...new Set([...CATEGORIES, ...config.items.map((i) => i.category)])].filter((c) => config.items.some((i) => i.category === c));
  return (
    <div className="space-y-2">
      {lines.map((l, i) => {
        const it = byId.get(l.itemId);
        if (!it) return null;
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{it.name}</p>
              <p className="text-xs text-slate-500">{fmtCurrency(it.price)} {UNIT_LABEL[it.unit]}</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Less" onClick={() => set(i, { qty: Math.max(0, (l.qty || 0) - 1) })} className="rounded-md border border-slate-200 p-1.5 dark:border-slate-700"><Minus size={13} /></button>
              <input type="number" inputMode="decimal" min={0} value={l.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} className="w-16 rounded-md border border-slate-200 px-2 py-1 text-center text-sm dark:border-slate-700 dark:bg-slate-900" aria-label={`${it.name} quantity`} />
              <button type="button" aria-label="More" onClick={() => set(i, { qty: (l.qty || 0) + 1 })} className="rounded-md border border-slate-200 p-1.5 dark:border-slate-700"><Plus size={13} /></button>
            </div>
            {it.usesStorey && (
              <select value={l.storey ?? 1} onChange={(e) => set(i, { storey: Number(e.target.value) })} className="rounded-md border border-slate-200 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900" aria-label="Storey">
                {[1, 2, 3, 4, 5, 6].map((s) => <option key={s} value={s}>{s === 1 ? "Ground/1st" : `Storey ${s}`}</option>)}
              </select>
            )}
            <button type="button" aria-label={`Remove ${it.name}`} onClick={() => onChange(lines.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
          </div>
        );
      })}
      <select value={adding} onChange={(e) => { if (e.target.value) onChange([...lines, { itemId: e.target.value, qty: 1, storey: 1 }]); setAdding(""); }} className={field} aria-label="Add an item">
        <option value="">+ Add windows, doors, solar panels…</option>
        {cats.map((c) => (
          <optgroup key={c} label={c}>
            {config.items.filter((i) => i.category === c).map((i) => <option key={i.id} value={i.id}>{i.name} ({fmtCurrency(i.price)} {UNIT_LABEL[i.unit]})</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/**
 * The price calculator. Standalone (Quotes → Price calculator) or inside a quote ("Work it out"),
 * where `onUse` takes the answers and price.
 */
export function Calculator({ config, initial, onUse, useLabel = "Use this price", busy = false }: {
  config: PricingConfig;
  initial?: CalcInput | null;
  onUse?: (input: CalcInput, perVisit: number) => void;
  useLabel?: string;
  busy?: boolean;
}) {
  const [input, setInput] = useState<CalcInput>(() => initial ?? { mode: "quick", frequencyWeeks: 4, presetId: config.presets[2]?.id ?? config.presets[0]?.id, bedrooms: "3", lines: [], buildings: [{ name: "Building 1", lines: [] }], adjustmentIds: [], crew: 1, equipmentCost: 0, pricing: "items" });
  const [showWorkings, setShowWorkings] = useState(false);
  const res = useMemo(() => calculate(config, input), [config, input]);
  const up = (patch: Partial<CalcInput>) => setInput((i) => ({ ...i, ...patch }));
  const buildings = input.buildings?.length ? input.buildings : [{ name: "Building 1", lines: [] }];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      {/* Phones: the price stays in view while filling in. */}
      <div className="sticky top-14 z-10 flex items-center justify-between rounded-xl border border-slate-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur lg:hidden dark:border-slate-700 dark:bg-slate-900/95">
        <span className="text-xl font-bold text-slate-900 dark:text-white">{fmtCurrency(res.perVisit)}</span>
        <span className="text-xs text-slate-500">{res.frequencyLabel} · about {res.hoursLabel.split(" with")[0]}</span>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {MODES.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => up({ mode: key })}
              className={cn("flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold", input.mode === key ? "bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-white" : "text-slate-500")}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {input.mode !== "commercial" && (
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{input.mode === "quick" ? "Property" : "Start from a property (optional)"}</p>
            <div className="flex flex-wrap gap-1.5">
              {input.mode === "detailed" && <button type="button" onClick={() => up({ presetId: "" })} className={chip(!input.presetId)}>None</button>}
              {config.presets.map((p) => <button key={p.id} type="button" onClick={() => up({ presetId: p.id })} className={chip(input.presetId === p.id)}>{p.name}</button>)}
            </div>
            {input.presetId && (
              <div className="flex flex-wrap gap-1.5">
                {BEDROOMS.map((b) => <button key={b} type="button" onClick={() => up({ bedrooms: b })} className={chip(input.bedrooms === b)}>{b} bed</button>)}
              </div>
            )}
          </section>
        )}

        {input.mode !== "commercial" && (
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{input.mode === "quick" ? "Extras" : "Windows, doors and extras"}</p>
            <LinesEditor config={config} lines={input.lines ?? []} onChange={(lines) => up({ lines })} />
          </section>
        )}

        {input.mode === "commercial" && (
          <section className="space-y-3">
            {buildings.map((b, bi) => (
              <div key={bi} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                <div className="flex items-center gap-2">
                  <input value={b.name} onChange={(e) => up({ buildings: buildings.map((x, j) => (j === bi ? { ...x, name: e.target.value } : x)) })} className={cn(field, "font-semibold")} aria-label="Building or elevation name" />
                  {buildings.length > 1 && <button type="button" aria-label="Remove building" onClick={() => up({ buildings: buildings.filter((_, j) => j !== bi) })} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={15} /></button>}
                </div>
                <LinesEditor config={config} lines={b.lines} onChange={(lines) => up({ buildings: buildings.map((x, j) => (j === bi ? { ...x, lines } : x)) })} />
              </div>
            ))}
            <button type="button" onClick={() => up({ buildings: [...buildings, { name: `Building ${buildings.length + 1}`, lines: [] }] })} className="text-sm font-semibold text-blue-600">+ Add a building or elevation</button>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium text-slate-600">People on the job<input type="number" min={1} value={input.crew ?? 1} onChange={(e) => up({ crew: Number(e.target.value) })} className={field} /></label>
              <label className="text-xs font-medium text-slate-600">Access kit / hire (£)<input type="number" min={0} step="0.01" value={input.equipmentCost ?? 0} onChange={(e) => up({ equipmentCost: Number(e.target.value) })} className={field} /></label>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {(["items", "time"] as const).map((m) => (
                <button key={m} type="button" onClick={() => up({ pricing: m })} className={cn("rounded-lg py-2 text-xs font-semibold", (input.pricing ?? "items") === m ? "bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-white" : "text-slate-500")}>
                  {m === "items" ? `Price by items (${fmtCurrency(res.itemsTotal)})` : `Price by time (${fmtCurrency(res.timePrice ?? 0)})`}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">By time: {fmtCurrency(config.hourlyRate)} an hour per person + {config.margin}% margin.</p>
          </section>
        )}

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">How often</p>
          <div className="flex flex-wrap gap-1.5">
            {config.frequencies.map((f) => <button key={f.weeks} type="button" onClick={() => up({ frequencyWeeks: f.weeks })} className={chip(input.frequencyWeeks === f.weeks)}>{f.label}</button>)}
          </div>
        </section>

        {config.adjustments.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Adjustments</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {config.adjustments.map((a) => {
                const on = (input.adjustmentIds ?? []).includes(a.id);
                return (
                  <label key={a.id} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", on ? "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40" : "border-slate-200 dark:border-slate-700")}>
                    <input type="checkbox" checked={on} onChange={(e) => up({ adjustmentIds: e.target.checked ? [...(input.adjustmentIds ?? []), a.id] : (input.adjustmentIds ?? []).filter((x) => x !== a.id) })} />
                    <span className="flex-1">{a.name}</span>
                    <span className="text-xs text-slate-500">{a.kind === "percent" ? `${a.value > 0 ? "+" : ""}${a.value}%` : `${a.value >= 0 ? "+" : "−"}${fmtCurrency(Math.abs(a.value))}`}</span>
                  </label>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <aside className="h-fit space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-4 dark:border-slate-700 dark:bg-slate-900">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Price per visit</p>
          <p className="text-4xl font-bold text-slate-900 dark:text-white">{fmtCurrency(res.perVisit)}</p>
          <p className="text-xs text-slate-500">
            {res.frequencyLabel}{res.vat > 0 ? ` · ${fmtCurrency(res.net)} + ${fmtCurrency(res.vat)} VAT` : ""}{res.minimumApplied ? " · minimum charge" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <Clock size={15} className="text-slate-400" /> About {res.hoursLabel}
        </div>
        {res.visitsPerYear > 1 && (
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-slate-50 px-2 py-2 dark:bg-slate-800"><p className="text-xs text-slate-500">A month</p><p className="font-bold">{fmtCurrency(res.perMonth)}</p></div>
            <div className="rounded-lg bg-slate-50 px-2 py-2 dark:bg-slate-800"><p className="text-xs text-slate-500">A year ({res.visitsPerYear} visits)</p><p className="font-bold">{fmtCurrency(res.perYear)}</p></div>
          </div>
        )}
        <button type="button" onClick={() => setShowWorkings((s) => !s)} className="text-xs font-semibold text-blue-600">{showWorkings ? "Hide workings" : "Show workings"}</button>
        {showWorkings && (
          <div className="space-y-1 border-t border-slate-100 pt-2 text-xs dark:border-slate-800">
            {res.lines.map((l, i) => (
              <div key={i} className="flex justify-between gap-2"><span className="text-slate-600 dark:text-slate-300">{l.group ? `${l.group}: ` : ""}{l.label}<span className="block text-slate-400">{l.detail}</span></span><span>{fmtCurrency(l.amount)}</span></div>
            ))}
            {res.adjustments.map((a, i) => <div key={`a${i}`} className="flex justify-between gap-2"><span className="text-slate-600 dark:text-slate-300">{a.label}</span><span>{a.amount < 0 ? "−" : "+"}{fmtCurrency(Math.abs(a.amount))}</span></div>)}
            {res.frequencyFactor !== 1 && <div className="flex justify-between gap-2"><span className="text-slate-600 dark:text-slate-300">{res.frequencyLabel}</span><span>×{res.frequencyFactor}</span></div>}
            <p className="pt-1 text-slate-400">Rounded to the nearest {fmtCurrency(config.rounding)}.</p>
          </div>
        )}
        {onUse && (
          <button type="button" disabled={busy || !(res.perVisit > 0)} onClick={() => onUse(input, res.perVisit)}
            className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
            {busy ? "Saving…" : useLabel}
          </button>
        )}
      </aside>
    </div>
  );
}
