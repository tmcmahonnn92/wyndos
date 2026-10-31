"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { BEDROOMS, CATEGORIES, UNIT_LABEL, type PricingConfig, type Unit } from "@/lib/pricing-calc";
import { resetPricing, savePricing } from "@/lib/pricing-actions";
import { cn } from "@/lib/utils";

const SECTIONS = ["Houses", "Items", "Adjustments", "Frequency", "Rules"] as const;
const cell = "w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900";
const num = (v: string) => (v === "" ? 0 : Number(v));
const newId = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;

/** Owner: change the price list the calculator uses. */
export function PriceListEditor({ initial, saved }: { initial: PricingConfig; saved: boolean }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<PricingConfig>(initial);
  const [section, setSection] = useState<(typeof SECTIONS)[number]>("Houses");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);
  const up = (patch: Partial<PricingConfig>) => { setCfg((c) => ({ ...c, ...patch })); setDirty(true); setMsg(""); };

  const save = async () => {
    setBusy(true);
    try { setCfg(await savePricing(cfg)); setDirty(false); setMsg("Saved."); router.refresh(); } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save."); }
    setBusy(false);
  };
  const reset = async () => {
    if (!window.confirm("Put the price list back to the example UK prices?")) return;
    setBusy(true);
    await resetPricing(); setBusy(false); setMsg("Back to the example prices."); setDirty(false); router.refresh();
    window.location.reload();
  };

  return (
    <div className="space-y-4">
      {!saved && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">These are example UK prices to get you started. Change them to your own and press Save.</p>}
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {SECTIONS.map((s) => (
          <button key={s} type="button" onClick={() => setSection(s)} className={cn("flex-1 rounded-lg px-2 py-2 text-xs font-semibold", section === s ? "bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-white" : "text-slate-500")}>{s}</button>
        ))}
      </div>

      {section === "Houses" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">The quick price for a house by type and bedrooms, and roughly how long it takes (minutes).</p>
          {cfg.presets.map((p, pi) => (
            <div key={p.id} className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <input value={p.name} onChange={(e) => up({ presets: cfg.presets.map((x, j) => (j === pi ? { ...x, name: e.target.value } : x)) })} className={cn(cell, "font-semibold")} aria-label="Property type" />
                <button type="button" aria-label={`Remove ${p.name}`} onClick={() => up({ presets: cfg.presets.filter((_, j) => j !== pi) })} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={15} /></button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-xs">
                  <thead><tr className="text-slate-500"><th className="text-left font-medium" />{BEDROOMS.map((b) => <th key={b} className="font-medium">{b} bed</th>)}</tr></thead>
                  <tbody>
                    {(["prices", "minutes"] as const).map((k) => (
                      <tr key={k}>
                        <td className="pr-2 text-slate-500">{k === "prices" ? "£" : "Min"}</td>
                        {BEDROOMS.map((b) => (
                          <td key={b} className="p-0.5"><input type="number" step={k === "prices" ? "0.5" : "1"} value={p[k][b] ?? 0} aria-label={`${p.name} ${b} bed ${k}`}
                            onChange={(e) => up({ presets: cfg.presets.map((x, j) => (j === pi ? { ...x, [k]: { ...x[k], [b]: num(e.target.value) } } : x)) })} className={cn(cell, "text-center")} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <button type="button" onClick={() => up({ presets: [...cfg.presets, { id: newId("p"), name: "New property type", prices: Object.fromEntries(BEDROOMS.map((b) => [b, 0])), minutes: Object.fromEntries(BEDROOMS.map((b) => [b, 0])) }] })} className="flex items-center gap-1 text-sm font-semibold text-blue-600"><Plus size={14} /> Add a property type</button>
        </div>
      )}

      {section === "Items" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Anything you count: windows by type, doors, frames, solar panels, gutters, cladding. Price and minutes are per unit. Tick "Height" for items priced up by storey.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="font-medium">Name</th><th className="font-medium">Group</th><th className="font-medium">Unit</th><th className="font-medium">£</th><th className="font-medium">Min</th><th className="font-medium">Height</th><th /></tr></thead>
              <tbody>
                {cfg.items.map((it, i) => {
                  const set = (patch: Partial<typeof it>) => up({ items: cfg.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                  return (
                    <tr key={it.id}>
                      <td className="p-0.5"><input value={it.name} onChange={(e) => set({ name: e.target.value })} className={cell} aria-label="Item name" /></td>
                      <td className="p-0.5"><select value={it.category} onChange={(e) => set({ category: e.target.value })} className={cell} aria-label="Group">{[...new Set([...CATEGORIES, it.category])].map((c) => <option key={c}>{c}</option>)}</select></td>
                      <td className="p-0.5"><select value={it.unit} onChange={(e) => set({ unit: e.target.value as Unit })} className={cell} aria-label="Unit">{Object.entries(UNIT_LABEL).map(([u, l]) => <option key={u} value={u}>{l}</option>)}</select></td>
                      <td className="w-20 p-0.5"><input type="number" step="0.01" value={it.price} onChange={(e) => set({ price: num(e.target.value) })} className={cell} aria-label="Price" /></td>
                      <td className="w-16 p-0.5"><input type="number" step="0.5" value={it.minutes} onChange={(e) => set({ minutes: num(e.target.value) })} className={cell} aria-label="Minutes" /></td>
                      <td className="text-center"><input type="checkbox" checked={Boolean(it.usesStorey)} onChange={(e) => set({ usesStorey: e.target.checked })} aria-label="Priced by height" /></td>
                      <td><button type="button" aria-label={`Remove ${it.name}`} onClick={() => up({ items: cfg.items.filter((_, j) => j !== i) })} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => up({ items: [...cfg.items, { id: newId("i"), name: "New item", category: "Other", unit: "each", price: 0, minutes: 0 }] })} className="flex items-center gap-1 text-sm font-semibold text-blue-600"><Plus size={14} /> Add an item</button>
        </div>
      )}

      {section === "Adjustments" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Ticked in the calculator when they apply. % of the price, or a fixed £ amount. Use a minus for a discount.</p>
          {cfg.adjustments.map((a, i) => {
            const set = (patch: Partial<typeof a>) => up({ adjustments: cfg.adjustments.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div key={a.id} className="flex items-center gap-2">
                <input value={a.name} onChange={(e) => set({ name: e.target.value })} className={cell} aria-label="Adjustment name" />
                <input type="number" step="0.5" value={a.value} onChange={(e) => set({ value: num(e.target.value) })} className={cn(cell, "w-20")} aria-label="Amount" />
                <select value={a.kind} onChange={(e) => set({ kind: e.target.value as "percent" | "fixed" })} className={cn(cell, "w-20")} aria-label="Type"><option value="percent">%</option><option value="fixed">£</option></select>
                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => up({ adjustments: cfg.adjustments.filter((_, j) => j !== i) })} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            );
          })}
          <button type="button" onClick={() => up({ adjustments: [...cfg.adjustments, { id: newId("a"), name: "New adjustment", kind: "percent", value: 10 }] })} className="flex items-center gap-1 text-sm font-semibold text-blue-600"><Plus size={14} /> Add an adjustment</button>
        </div>
      )}

      {section === "Frequency" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">How the price changes with how often they&apos;re done. 1 = the price as set; 1.2 = 20% more. Weeks 0 = a one-off.</p>
          {cfg.frequencies.map((f, i) => {
            const set = (patch: Partial<typeof f>) => up({ frequencies: cfg.frequencies.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div key={i} className="flex items-center gap-2">
                <input value={f.label} onChange={(e) => set({ label: e.target.value })} className={cell} aria-label="Label" />
                <label className="flex items-center gap-1 text-xs text-slate-500">Weeks<input type="number" min={0} value={f.weeks} onChange={(e) => set({ weeks: num(e.target.value) })} className={cn(cell, "w-16")} /></label>
                <label className="flex items-center gap-1 text-xs text-slate-500">×<input type="number" step="0.05" value={f.multiplier} onChange={(e) => set({ multiplier: num(e.target.value) })} className={cn(cell, "w-20")} /></label>
                <button type="button" aria-label="Remove" onClick={() => up({ frequencies: cfg.frequencies.filter((_, j) => j !== i) })} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            );
          })}
          <button type="button" onClick={() => up({ frequencies: [...cfg.frequencies, { weeks: 3, label: "Every 3 weeks", multiplier: 1 }] })} className="flex items-center gap-1 text-sm font-semibold text-blue-600"><Plus size={14} /> Add a frequency</button>
        </div>
      )}

      {section === "Rules" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["minimumCharge", "Minimum charge (£)", "0.5"], ["callOut", "Call-out charge (£)", "0.5"], ["rounding", "Round to the nearest (£)", "0.5"],
            ["hourlyRate", "Labour rate per person (£/hour)", "0.5"], ["margin", "Margin on labour (%)", "1"], ["vatRate", "VAT rate (%)", "0.5"],
          ] as const).map(([k, label, step]) => (
            <label key={k} className="text-xs font-medium text-slate-600">{label}
              <input type="number" step={step} value={cfg[k]} onChange={(e) => up({ [k]: num(e.target.value) } as Partial<PricingConfig>)} className={cell} />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.addVat} onChange={(e) => up({ addVat: e.target.checked })} /> Add VAT to prices</label>
          <div className="sm:col-span-2">
            <p className="mb-1 text-xs font-medium text-slate-600">Height: multiply the price of "Height" items by storey</p>
            <div className="grid grid-cols-6 gap-1">
              {["1", "2", "3", "4", "5", "6"].map((s) => (
                <label key={s} className="text-center text-xs text-slate-500">{s === "1" ? "1st" : `${s}${s === "2" ? "nd" : s === "3" ? "rd" : "th"}`}
                  <input type="number" step="0.05" value={cfg.storeyMultipliers[s] ?? 1} onChange={(e) => up({ storeyMultipliers: { ...cfg.storeyMultipliers, [s]: num(e.target.value) } })} className={cn(cell, "text-center")} />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-slate-200 bg-white/95 py-3 dark:border-slate-700 dark:bg-slate-950/95">
        <button type="button" onClick={save} disabled={busy || !dirty} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? "Saving…" : "Save price list"}</button>
        <button type="button" onClick={reset} disabled={busy} className="text-sm font-semibold text-slate-500 hover:text-slate-800">Reset to example prices</button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
