"use client";

import { useState, useTransition, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, RotateCcw, Save, ChevronLeft, Check, X, ChevronDown, TrendingUp, MapPin, StickyNote, Square, CheckSquare } from "lucide-react";
import Link from "next/link";
import { bulkUpdateCustomers } from "@/lib/actions";
import { cn } from "@/lib/utils";

type Area = { id: number; name: string; frequencyWeeks: number };
type Customer = {
  id: number;
  name: string;
  address: string;
  areaId: number;
  price: number;
  frequencyWeeks: number;
  notes: string | null;
  active: boolean;
};

type Draft = {
  name: string;
  address: string;
  areaId: number;
  price: string; // string for input control
  frequencyWeeks: number;
  notes: string;
  active: boolean;
};

function initDraft(c: Customer): Draft {
  return {
    name: c.name,
    address: c.address,
    areaId: c.areaId,
    price: c.price.toFixed(2),
    frequencyWeeks: c.frequencyWeeks,
    notes: c.notes ?? "",
    active: c.active,
  };
}

function isDirty(original: Customer, draft: Draft): boolean {
  return (
    draft.name.trim() !== original.name ||
    draft.address.trim() !== original.address ||
    draft.areaId !== original.areaId ||
    parseFloat(draft.price) !== original.price ||
    draft.frequencyWeeks !== original.frequencyWeeks ||
    draft.notes.trim() !== (original.notes ?? "") ||
    draft.active !== original.active
  );
}

export function BulkEditClient({
  customers,
  areas,
}: {
  customers: Customer[];
  areas: Area[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(customers.map((c) => [c.id, initDraft(c)]))
  );
  const [search, setSearch] = useState("");
  const [filterArea, setFilterArea] = useState<string>("all");
  const [filterDirty, setFilterDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaFreqById = useMemo(
    () => Object.fromEntries(areas.map((a) => [a.id, a.frequencyWeeks])),
    [areas]
  );

  // ── Selection ──
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const update = useCallback((id: number, patch: Partial<Draft>) => {
    setDrafts((prev) => {
      const nextPatch = { ...patch };
      if (nextPatch.areaId !== undefined) {
        nextPatch.frequencyWeeks = areaFreqById[nextPatch.areaId] ?? prev[id].frequencyWeeks;
      }
      return { ...prev, [id]: { ...prev[id], ...nextPatch } };
    });
    setSaved(false);
  }, [areaFreqById]);

  const dirtyIds = useMemo(
    () => customers.filter((c) => isDirty(c, drafts[c.id])).map((c) => c.id),
    [customers, drafts]
  );

  const visible = useMemo(() => {
    return customers.filter((c) => {
      if (filterDirty && !dirtyIds.includes(c.id)) return false;
      if (filterArea !== "all" && c.areaId !== Number(filterArea)) return false;
      const q = search.toLowerCase();
      if (q && !c.name.toLowerCase().includes(q) && !c.address.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [customers, search, filterArea, filterDirty, dirtyIds]);

  // ── Bulk action panel ──
  type BulkMode = null | "price" | "area" | "note";
  const [bulkMode, setBulkMode] = useState<BulkMode>(null);
  const [bulkPriceValue, setBulkPriceValue] = useState("");
  const [bulkPriceType, setBulkPriceType] = useState<"amount" | "percent">("amount");
  const [bulkPriceDir, setBulkPriceDir] = useState<"increase" | "decrease">("increase");
  const [bulkAreaId, setBulkAreaId] = useState<string>("");
  const [bulkNote, setBulkNote] = useState("");
  const [bulkNoteMode, setBulkNoteMode] = useState<"append" | "replace">("append");

  const toggleSelect = (id: number) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelected(new Set(visible.map((c) => c.id)));
  const clearSelection = () => { setSelected(new Set()); setBulkMode(null); };
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  const applyBulkPrice = () => {
    const v = parseFloat(bulkPriceValue);
    if (isNaN(v) || v <= 0) return;
    const signed = bulkPriceDir === "decrease" ? -v : v;
    setDrafts((prev) => {
      const next = { ...prev };
      selected.forEach((id) => {
        const current = parseFloat(next[id].price) || 0;
        const newPrice = bulkPriceType === "percent"
          ? current * (1 + signed / 100)
          : current + signed;
        next[id] = { ...next[id], price: Math.max(0, newPrice).toFixed(2) };
      });
      return next;
    });
    setSaved(false);
    setBulkPriceValue("");
    setBulkMode(null);
  };

  const applyBulkArea = () => {
    if (!bulkAreaId) return;
    const areaId = Number(bulkAreaId);
    setDrafts((prev) => {
      const next = { ...prev };
      selected.forEach((id) => {
        next[id] = {
          ...next[id],
          areaId,
          frequencyWeeks: areaFreqById[areaId] ?? next[id].frequencyWeeks,
        };
      });
      return next;
    });
    setSaved(false);
    setBulkAreaId("");
    setBulkMode(null);
  };

  const applyBulkNote = () => {
    if (!bulkNote.trim()) return;
    setDrafts((prev) => {
      const next = { ...prev };
      selected.forEach((id) => {
        const existing = next[id].notes.trim();
        next[id] = {
          ...next[id],
          notes: bulkNoteMode === "append"
            ? existing ? `${existing}; ${bulkNote.trim()}` : bulkNote.trim()
            : bulkNote.trim(),
        };
      });
      return next;
    });
    setSaved(false);
    setBulkNote("");
    setBulkMode(null);
  };

  const resetAll = () => {
    setDrafts(Object.fromEntries(customers.map((c) => [c.id, initDraft(c)])));
    setSaved(false);
    setError(null);
  };

  const handleSave = () => {
    setError(null);
    const updates = customers
      .filter((c) => isDirty(c, drafts[c.id]))
      .map((c) => {
        const d = drafts[c.id];
        const price = parseFloat(d.price);
        if (isNaN(price) || price < 0) throw new Error(`Invalid price for ${c.name}`);
        return {
          id: c.id,
          name: d.name.trim(),
          address: d.address.trim(),
          areaId: d.areaId,
          price,
          frequencyWeeks: d.frequencyWeeks,
          notes: d.notes.trim() || undefined,
          active: d.active,
        };
      });
    if (updates.length === 0) return;
    startTransition(async () => {
      try {
        await bulkUpdateCustomers(updates);
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap items-center gap-2">
        <Link
          href="/customers"
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mr-1"
        >
          <ChevronLeft size={14} />
          Customers
        </Link>
        <span className="text-slate-300 hidden sm:block">|</span>
        <h1 className="font-bold text-slate-800 text-sm hidden sm:block">Bulk Edit</h1>

        {/* Search */}
        <div className="relative flex-1 min-w-[140px] max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search name / address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        {/* Area filter */}
        <select
          value={filterArea}
          onChange={(e) => setFilterArea(e.target.value)}
          className="text-sm rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">All areas</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        {/* Dirty filter */}
        <button
          onClick={() => setFilterDirty((v) => !v)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
            filterDirty
              ? "bg-amber-100 border-amber-400 text-amber-800"
              : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
          )}
        >
          {dirtyIds.length > 0 ? `${dirtyIds.length} changed` : "No changes"}
        </button>

        <div className="flex-1" />

        {/* Reset */}
        {dirtyIds.length > 0 && (
          <button
            onClick={resetAll}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            <RotateCcw size={13} />
            Reset
          </button>
        )}

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={dirtyIds.length === 0 || isPending}
          className={cn(
            "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40",
            saved
              ? "bg-green-600 text-white"
              : "bg-blue-600 hover:bg-blue-700 text-white"
          )}
        >
          {saved ? <Check size={14} /> : <Save size={14} />}
          {isPending ? "Saving…" : saved ? "Saved!" : `Save ${dirtyIds.length > 0 ? dirtyIds.length : ""} changes`}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <X size={14} />
          {error}
        </div>
      )}

      {/* ── Bulk action bar ── */}
      {selected.size > 0 && (
        <div className="border-b border-violet-200 bg-violet-50 px-4 py-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-violet-800 mr-1">{selected.size} selected</span>

          {/* Price */}
          <button
            onClick={() => setBulkMode(bulkMode === "price" ? null : "price")}
            className={cn("flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold transition-colors",
              bulkMode === "price" ? "bg-violet-600 text-white border-violet-600" : "bg-white border-violet-300 text-violet-700 hover:bg-violet-100")
            }>
            <TrendingUp size={12} /> Price
          </button>

          {/* Area */}
          <button
            onClick={() => setBulkMode(bulkMode === "area" ? null : "area")}
            className={cn("flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold transition-colors",
              bulkMode === "area" ? "bg-violet-600 text-white border-violet-600" : "bg-white border-violet-300 text-violet-700 hover:bg-violet-100")
            }>
            <MapPin size={12} /> Area
          </button>

          {/* Note */}
          <button
            onClick={() => setBulkMode(bulkMode === "note" ? null : "note")}
            className={cn("flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold transition-colors",
              bulkMode === "note" ? "bg-violet-600 text-white border-violet-600" : "bg-white border-violet-300 text-violet-700 hover:bg-violet-100")
            }>
            <StickyNote size={12} /> Note
          </button>

          <button onClick={clearSelection} className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
            <X size={12} /> Deselect all
          </button>

          {/* Price sub-panel */}
          {bulkMode === "price" && (
            <div className="w-full flex flex-wrap items-center gap-2 pt-1">
              {/* Direction: Increase / Decrease */}
              <div className="flex rounded-lg overflow-hidden border border-violet-300">
                <button onClick={() => setBulkPriceDir("increase")}
                  className={cn("px-3 py-1 text-xs font-semibold transition-colors",
                    bulkPriceDir === "increase" ? "bg-green-600 text-white" : "bg-white text-slate-600 hover:bg-green-50")}>
                  ↑ Increase
                </button>
                <button onClick={() => setBulkPriceDir("decrease")}
                  className={cn("px-3 py-1 text-xs font-semibold transition-colors",
                    bulkPriceDir === "decrease" ? "bg-red-500 text-white" : "bg-white text-slate-600 hover:bg-red-50")}>
                  ↓ Decrease
                </button>
              </div>
              {/* Type: £ / % */}
              <div className="flex rounded-lg overflow-hidden border border-violet-300">
                <button onClick={() => setBulkPriceType("amount")}
                  className={cn("px-3 py-1 text-xs font-semibold transition-colors",
                    bulkPriceType === "amount" ? "bg-violet-600 text-white" : "bg-white text-violet-700 hover:bg-violet-50")}>
                  £ amount
                </button>
                <button onClick={() => setBulkPriceType("percent")}
                  className={cn("px-3 py-1 text-xs font-semibold transition-colors",
                    bulkPriceType === "percent" ? "bg-violet-600 text-white" : "bg-white text-violet-700 hover:bg-violet-50")}>
                  % percent
                </button>
              </div>
              <div className="relative">
                {bulkPriceType === "amount" && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">£</span>}
                <input type="number" min="0" step={bulkPriceType === "percent" ? "0.1" : "0.50"}
                  placeholder={bulkPriceType === "amount" ? "e.g. 1.00" : "e.g. 5"}
                  value={bulkPriceValue}
                  onChange={(e) => setBulkPriceValue(e.target.value)}
                  className={cn("w-28 rounded-lg border border-violet-300 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400",
                    bulkPriceType === "amount" ? "pl-5 pr-2" : "px-3")} />
                {bulkPriceType === "percent" && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">%</span>}
              </div>
              <p className={cn("text-xs font-medium", bulkPriceDir === "decrease" ? "text-red-600" : "text-green-700")}>
                {bulkPriceValue && !isNaN(parseFloat(bulkPriceValue)) && parseFloat(bulkPriceValue) > 0
                  ? `Will ${bulkPriceDir} price of ${selected.size} customer${selected.size !== 1 ? "s" : ""} by ${bulkPriceType === "percent" ? `${parseFloat(bulkPriceValue)}%` : `£${parseFloat(bulkPriceValue).toFixed(2)}`}`
                  : `Enter an amount to ${bulkPriceDir} prices for ${selected.size} customer${selected.size !== 1 ? "s" : ""}`}
              </p>
              <button onClick={applyBulkPrice} disabled={!bulkPriceValue || isNaN(parseFloat(bulkPriceValue)) || parseFloat(bulkPriceValue) <= 0}
                className={cn("px-4 py-1 rounded-lg text-white text-xs font-bold disabled:opacity-40 transition-colors",
                  bulkPriceDir === "decrease" ? "bg-red-500 hover:bg-red-600" : "bg-green-600 hover:bg-green-700")}>
                Apply
              </button>
            </div>
          )}

          {/* Area sub-panel */}
          {bulkMode === "area" && (
            <div className="w-full flex flex-wrap items-center gap-2 pt-1">
              <select value={bulkAreaId} onChange={(e) => setBulkAreaId(e.target.value)}
                className="rounded-lg border border-violet-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white">
                <option value="">— Select area —</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <p className="text-xs text-slate-500">Assign {selected.size} customer{selected.size !== 1 ? "s" : ""} to this area</p>
              <button onClick={applyBulkArea} disabled={!bulkAreaId}
                className="px-4 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold disabled:opacity-40">
                Apply
              </button>
            </div>
          )}

          {/* Note sub-panel */}
          {bulkMode === "note" && (
            <div className="w-full flex flex-wrap items-center gap-2 pt-1">
              <div className="flex rounded-lg overflow-hidden border border-violet-300">
                <button onClick={() => setBulkNoteMode("append")}
                  className={cn("px-3 py-1 text-xs font-semibold transition-colors",
                    bulkNoteMode === "append" ? "bg-violet-600 text-white" : "bg-white text-violet-700 hover:bg-violet-50")}>
                  Append
                </button>
                <button onClick={() => setBulkNoteMode("replace")}
                  className={cn("px-3 py-1 text-xs font-semibold transition-colors",
                    bulkNoteMode === "replace" ? "bg-violet-600 text-white" : "bg-white text-violet-700 hover:bg-violet-50")}>
                  Replace
                </button>
              </div>
              <input type="text" placeholder="Note text…" value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
                className="flex-1 min-w-[180px] rounded-lg border border-violet-300 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
              <p className="text-xs text-slate-500">
                {bulkNoteMode === "append" ? "Appended after existing notes" : "Replaces existing notes"} for {selected.size} customer{selected.size !== 1 ? "s" : ""}
              </p>
              <button onClick={applyBulkNote} disabled={!bulkNote.trim()}
                className="px-4 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold disabled:opacity-40">
                Apply
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-full text-sm border-separate border-spacing-0">
          <thead className="sticky top-0 z-[5] bg-slate-50">
            <tr>
              {/* Select-all checkbox */}
              <th className="border-b border-slate-200 px-3 py-2.5 w-8">
                <button onClick={allVisibleSelected ? clearSelection : selectAll} className="text-slate-400 hover:text-violet-600">
                  {allVisibleSelected ? <CheckSquare size={15} className="text-violet-600" /> : <Square size={15} />}
                </button>
              </th>
              {[
                { label: "Name", w: "min-w-[160px]" },
                { label: "Address", w: "min-w-[220px]" },
                { label: "Area", w: "min-w-[130px]" },
                { label: "Price (£)", w: "min-w-[90px]" },
                { label: "Frequency", w: "min-w-[150px]" },
                { label: "Active", w: "min-w-[70px] text-center" },
                { label: "Notes", w: "min-w-[200px]" },
              ].map(({ label, w }) => (
                <th
                  key={label}
                  className={cn(
                    "border-b border-slate-200 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500",
                    w
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => {
              const d = drafts[c.id];
              const dirty = isDirty(c, d);
              return (
                <tr
                  key={c.id}
                  className={cn(
                    "group transition-colors",
                    selected.has(c.id) ? "bg-violet-50" : dirty ? "bg-amber-50 hover:bg-amber-100/70" : "bg-white hover:bg-slate-50"
                  )}
                >
                  {/* Checkbox */}
                  <td className={cn("border-b border-slate-100 px-3 py-1.5", dirty && "border-amber-200")}>
                    <button onClick={() => toggleSelect(c.id)} className="text-slate-300 hover:text-violet-600">
                      {selected.has(c.id)
                        ? <CheckSquare size={15} className="text-violet-600" />
                        : <Square size={15} />}
                    </button>
                  </td>
                  {/* Name */}
                  <td className={cn("border-b border-slate-100 px-3 py-1.5", dirty && "border-amber-200")}>
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) => update(c.id, { name: e.target.value })}
                      className="w-full rounded border border-transparent px-1 py-0.5 text-sm text-slate-800 bg-transparent focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </td>

                  {/* Address */}
                  <td className={cn("border-b border-slate-100 px-3 py-1.5", dirty && "border-amber-200")}>
                    <input
                      type="text"
                      value={d.address}
                      onChange={(e) => update(c.id, { address: e.target.value })}
                      className="w-full rounded border border-transparent px-1 py-0.5 text-sm text-slate-600 bg-transparent focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </td>

                  {/* Area */}
                  <td className={cn("border-b border-slate-100 px-3 py-1.5", dirty && "border-amber-200")}>
                    <select
                      value={d.areaId}
                      onChange={(e) => update(c.id, { areaId: Number(e.target.value) })}
                      className="w-full rounded border border-slate-200 px-1.5 py-0.5 text-sm text-slate-700 bg-white focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      {areas.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </td>

                  {/* Price */}
                  <td className={cn("border-b border-slate-100 px-3 py-1.5", dirty && "border-amber-200")}>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">£</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={d.price}
                        onChange={(e) => update(c.id, { price: e.target.value })}
                        className="w-full rounded border border-slate-200 pl-5 pr-1 py-0.5 text-sm text-slate-800 bg-white focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                  </td>

                  {/* Frequency */}
                  <td className={cn("border-b border-slate-100 px-3 py-1.5", dirty && "border-amber-200")}>
                    <div className="rounded border border-slate-200 px-2 py-1 text-sm text-slate-600 bg-slate-50">
                      Every {d.frequencyWeeks} week{d.frequencyWeeks !== 1 ? "s" : ""}
                      <span className="ml-2 text-xs text-slate-400">(from area)</span>
                    </div>
                  </td>

                  {/* Active */}
                  <td className={cn("border-b border-slate-100 px-3 py-1.5 text-center", dirty && "border-amber-200")}>
                    <button
                      onClick={() => update(c.id, { active: !d.active })}
                      className={cn(
                        "w-8 h-4.5 rounded-full border-2 relative transition-colors inline-flex items-center",
                        d.active
                          ? "bg-green-500 border-green-600"
                          : "bg-slate-300 border-slate-400"
                      )}
                      title={d.active ? "Active — click to deactivate" : "Inactive — click to activate"}
                    >
                      <span
                        className={cn(
                          "absolute w-3 h-3 rounded-full bg-white shadow transition-transform duration-150",
                          d.active ? "translate-x-3.5" : "translate-x-0.5"
                        )}
                      />
                    </button>
                  </td>

                  {/* Notes */}
                  <td className={cn("border-b border-slate-100 px-3 py-1.5", dirty && "border-amber-200")}>
                    <input
                      type="text"
                      value={d.notes}
                      onChange={(e) => update(c.id, { notes: e.target.value })}
                      placeholder="Add a note…"
                      className="w-full rounded border border-transparent px-1 py-0.5 text-sm text-slate-600 bg-transparent placeholder:text-slate-300 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400 text-sm">
                  No customers match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer summary */}
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 flex items-center gap-3 text-xs text-slate-500 flex-wrap">
        <span>{visible.length} of {customers.length} customers shown</span>
        {selected.size > 0 && (
          <><span className="text-slate-300">·</span>
          <span className="font-semibold text-violet-700">{selected.size} selected</span></>
        )}
        {dirtyIds.length > 0 && (
          <><span className="text-slate-300">·</span>
          <span className="font-semibold text-amber-700">{dirtyIds.length} unsaved change{dirtyIds.length !== 1 ? "s" : ""}</span></>
        )}
      </div>
    </div>
  );
}
