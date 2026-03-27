"use client";

import { useState, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Users,
  GripVertical,
  MapPin,
  ChevronDown,
  ArrowRight,
  CheckSquare,
  Square,
  X,
  Pencil,
  UserPlus,
  CalendarClock,
  PoundSterling,
  Plus,
} from "lucide-react";
import { bulkMoveCustomersToArea, updateArea, createCustomer, createArea } from "@/lib/actions";
import { fmtCurrency, cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Area = {
  id: number;
  name: string;
  sortOrder: number;
  scheduleType: string;
  frequencyWeeks: number;
  monthlyDay: number | null;
  nextDueDate: Date | string | null;
  estimatedValue: number;
  _count: { customers: number };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtShort(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

function cadenceLabel(area: Area): string {
  if (area.scheduleType === "MONTHLY") return `Monthly (day ${area.monthlyDay ?? "?"})`;
  return `Every ${area.frequencyWeeks}w`;
}

type Customer = {
  id: number;
  name: string;
  address: string;
  price: number;
  areaId: number;
  area: { id: number; name: string } | null;
};

// ── Customer row (left column) ────────────────────────────────────────────────

function SourceRow({
  customer,
  selected,
  onToggle,
  onDragStart,
  hidePrices = false,
}: {
  customer: Customer;
  selected: boolean;
  onToggle: (id: number, additive: boolean) => void;
  onDragStart: (id: number) => void;
  hidePrices?: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(customer.id); }}
      onClick={(e) => onToggle(customer.id, e.ctrlKey || e.metaKey)}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer select-none transition-all group",
        selected
          ? "bg-blue-50 border-blue-300 shadow-sm"
          : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
      )}
    >
      {/* Checkbox */}
      <div className="flex-shrink-0">
        {selected
          ? <CheckSquare size={15} className="text-blue-600" />
          : <Square size={15} className="text-slate-300 group-hover:text-slate-400" />}
      </div>
      {/* Grip */}
      <GripVertical size={13} className="text-slate-300 flex-shrink-0" />
      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{customer.name}</p>
        <p className="text-[11px] text-slate-400 truncate flex items-center gap-0.5">
          <MapPin size={9} />{customer.address}
        </p>
      </div>
      {/* Area + price */}
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <span className="text-xs font-bold text-slate-600 tabular-nums">{hidePrices ? null : fmtCurrency(customer.price)}</span>
        <span className="text-[10px] text-slate-400 truncate max-w-[80px]">{customer.area?.name ?? "—"}</span>
      </div>
    </div>
  );
}

// ── Customer row (right column) ───────────────────────────────────────────────

function TargetRow({ customer, hidePrices = false }: { customer: Customer; hidePrices?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border bg-white border-slate-200">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{customer.name}</p>
        <p className="text-[11px] text-slate-400 truncate flex items-center gap-0.5">
          <MapPin size={9} />{customer.address}
        </p>
      </div>
      <span className="text-xs font-bold text-slate-600 tabular-nums flex-shrink-0">{hidePrices ? null : fmtCurrency(customer.price)}</span>
    </div>
  );
}

// ── Add Area Modal ────────────────────────────────────────────────────────────

function AddAreaModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [scheduleType, setScheduleType] = useState("WEEKLY");
  const [frequencyWeeks, setFrequencyWeeks] = useState("4");
  const [monthlyDay, setMonthlyDay] = useState("1");
  const [nextDueDate, setNextDueDate] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = () => {
    if (!name.trim()) { setError("Area name is required."); return; }
    setError("");
    startTransition(async () => {
      await createArea({
        name: name.trim(),
        scheduleType,
        frequencyWeeks: scheduleType === "WEEKLY" ? (Number(frequencyWeeks) || 4) : 4,
        monthlyDay: scheduleType === "MONTHLY" ? (Number(monthlyDay) || 1) : undefined,
        nextDueDate: nextDueDate ? new Date(nextDueDate) : undefined,
      });
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">Add New Area</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={16} className="text-slate-500" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{error}</p>}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Area Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Town Centre, Oakfield"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Schedule Type</label>
            <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="WEEKLY">Weekly / Every N weeks</option>
              <option value="MONTHLY">Monthly (fixed day)</option>
            </select>
          </div>
          {scheduleType === "MONTHLY" ? (
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Day of month</label>
              <input type="number" min={1} max={28} value={monthlyDay} onChange={(e) => setMonthlyDay(e.target.value)}
                placeholder="e.g. 15"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          ) : (
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Frequency (weeks)</label>
              <div className="flex gap-2">
                {["1","2","4","6","8","12"].map((w) => (
                  <button key={w} type="button" onClick={() => setFrequencyWeeks(w)}
                    className={cn("flex-1 py-1.5 rounded-lg border text-sm font-semibold transition-colors",
                      frequencyWeeks === w ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300")}>
                    {w}w
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">First due date (optional)</label>
            <input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose}
            className="flex-1 py-2 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={isPending}
            className="flex-1 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50">
            {isPending ? "Creating…" : "Create Area"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Area Modal ───────────────────────────────────────────────────────────

function EditAreaModal({ area, onClose }: { area: Area; onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(area.name);
  const [scheduleType, setScheduleType] = useState(area.scheduleType);
  const [frequencyWeeks, setFrequencyWeeks] = useState(String(area.frequencyWeeks));
  const [monthlyDay, setMonthlyDay] = useState(String(area.monthlyDay ?? ""));
  const [nextDueDate, setNextDueDate] = useState(
    area.nextDueDate ? new Date(area.nextDueDate).toISOString().slice(0, 10) : ""
  );
  const [sortOrder, setSortOrder] = useState(String(area.sortOrder));

  const handleSave = () => {
    startTransition(async () => {
      await updateArea(area.id, {
        name: name.trim() || area.name,
        scheduleType,
        frequencyWeeks: Number(frequencyWeeks) || 4,
        monthlyDay: scheduleType === "MONTHLY" ? (Number(monthlyDay) || null) : null,
        nextDueDate: nextDueDate ? new Date(nextDueDate) : null,
        sortOrder: Number(sortOrder) || 0,
      });
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">Edit Area</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={16} className="text-slate-500" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Area Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Schedule Type</label>
            <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="WEEKLY">Weekly / Every N weeks</option>
              <option value="MONTHLY">Monthly (fixed day)</option>
            </select>
          </div>
          {scheduleType === "MONTHLY" ? (
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Day of month</label>
              <input type="number" min={1} max={28} value={monthlyDay} onChange={(e) => setMonthlyDay(e.target.value)}
                placeholder="e.g. 15"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          ) : (
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Frequency (weeks)</label>
              <input type="number" min={1} value={frequencyWeeks} onChange={(e) => setFrequencyWeeks(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Next Due Date</label>
            <input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Sort Order</label>
            <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose}
            className="flex-1 py-2 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={isPending}
            className="flex-1 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50">
            {isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Customer Modal ────────────────────────────────────────────────────────

function AddCustomerModal({ area, onClose }: { area: Area; onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const handleAdd = () => {
    if (!name.trim() || !address.trim() || !price) { setError("Name, address and price are required."); return; }
    setError("");
    startTransition(async () => {
      await createCustomer({ name: name.trim(), address: address.trim(), areaId: area.id, price: parseFloat(price), notes: notes.trim() || undefined });
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-800">Add New Customer</h2>
            <p className="text-xs text-slate-400 mt-0.5">to {area.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={16} className="text-slate-500" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{error}</p>}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Full Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Smith"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Address</label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 12 Oak Road, Town"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Price per clean (£)</label>
            <input type="number" min={0} step={0.5} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 12.00"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="Gate code, access info, etc."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose}
            className="flex-1 py-2 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">Cancel</button>
          <button onClick={handleAdd} disabled={isPending}
            className="flex-1 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50">
            {isPending ? "Adding…" : "Add Customer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main client component ─────────────────────────────────────────────────────

export function AreasClient({
  customers,
  areas,
  hidePrices = false,
}: {
  customers: Customer[];
  areas: Area[];
  hidePrices?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Left column state
  const [search, setSearch] = useState("");
  const [filterAreaId, setFilterAreaId] = useState<number | "">("");

  // Right column state
  const [targetAreaId, setTargetAreaId] = useState<number | "">(areas[0]?.id ?? "");

  // Modal state
  const [editOpen, setEditOpen] = useState(false);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [addAreaOpen, setAddAreaOpen] = useState(false);

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Drag state
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropOver, setDropOver] = useState(false);

  // ── Derived ──────────────────────────────────────────────────────────────

  const filteredCustomers = customers.filter((c) => {
    const matchArea = filterAreaId === "" || c.areaId === filterAreaId;
    const q = search.toLowerCase();
    const matchSearch = !q || c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q);
    return matchArea && matchSearch;
  });

  const targetArea = areas.find((a) => a.id === targetAreaId) ?? null;
  const targetCustomers = customers.filter((c) => c.areaId === targetAreaId);
  const targetValue = targetCustomers.reduce((s, c) => s + c.price, 0);

  // ── Selection ─────────────────────────────────────────────────────────────

  const toggleSelect = useCallback((id: number, additive: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (additive) {
        if (next.has(id)) next.delete(id); else next.add(id);
      } else {
        if (next.size === 1 && next.has(id)) {
          next.clear();
        } else {
          next.clear();
          next.add(id);
        }
      }
      return next;
    });
  }, []);

  const selectAll = () => {
    setSelected(new Set(filteredCustomers.map((c) => c.id)));
  };

  const clearSelection = () => setSelected(new Set());

  // ── Move ──────────────────────────────────────────────────────────────────

  const doMove = useCallback((ids: number[]) => {
    if (!targetAreaId || ids.length === 0) return;
    startTransition(async () => {
      await bulkMoveCustomersToArea(ids, Number(targetAreaId));
      setSelected(new Set());
      setDragId(null);
      router.refresh();
    });
  }, [targetAreaId, router]);

  // ── Drag ─────────────────────────────────────────────────────────────────

  const handleDragStart = useCallback((id: number) => {
    setDragId(id);
    // If the dragged item isn't selected, select just it
    setSelected((prev) => {
      if (!prev.has(id)) return new Set([id]);
      return prev;
    });
  }, []);

  const handleDrop = useCallback(() => {
    setDropOver(false);
    if (!dragId) return;
    // Move all selected (dragId is guaranteed to be in selected)
    const ids = selected.size > 0 ? [...selected] : [dragId];
    doMove(ids);
  }, [dragId, selected, doMove]);

  // ── Render ────────────────────────────────────────────────────────────────

  const selectedCount = selected.size;
  const selectedNotInTarget = [...selected].filter(
    (id) => customers.find((c) => c.id === id)?.areaId !== targetAreaId
  );

  return (
    <>
      {addAreaOpen && (
        <AddAreaModal onClose={() => setAddAreaOpen(false)} />
      )}
      {editOpen && targetArea && (
        <EditAreaModal area={targetArea} onClose={() => setEditOpen(false)} />
      )}
      {addCustomerOpen && targetArea && (
        <AddCustomerModal area={targetArea} onClose={() => setAddCustomerOpen(false)} />
      )}

    <div className="h-[calc(100vh-4rem)] md:h-screen flex flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <Users size={18} className="text-slate-500" />
          <h1 className="text-lg font-bold text-slate-800">Area Management</h1>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-slate-400 hidden sm:block">{customers.length} customers · {areas.length} areas</p>
          <button
            onClick={() => setAddAreaOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
          >
            <Plus size={14} />
            Add Area
          </button>
        </div>
      </div>

      {/* Two-column body */}
      <div className="flex-1 flex overflow-hidden gap-px bg-slate-200">

        {/* ── LEFT COLUMN: All customers ────────────────────────────────── */}
        <div className="flex flex-col bg-white w-1/2 min-w-0">
          {/* Column header */}
          <div className="px-4 pt-3 pb-2.5 border-b border-slate-100 flex-shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">All Customers</p>
              {selectedCount > 0 && (
                <button
                  onClick={clearSelection}
                  className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700"
                >
                  <X size={11} /> Clear
                </button>
              )}
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search name or address…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>

            {/* Area filter */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <select
                  value={filterAreaId}
                  onChange={(e) => setFilterAreaId(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full appearance-none pl-3 pr-7 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
                >
                  <option value="">All areas</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
              <button
                onClick={selectAll}
                className="text-[11px] text-blue-600 font-semibold hover:underline whitespace-nowrap"
              >
                Select all ({filteredCustomers.length})
              </button>
            </div>

            {/* Selection action bar */}
            {selectedNotInTarget.length > 0 && targetAreaId !== "" && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                <span className="text-xs text-blue-700 font-semibold flex-1">
                  {selectedNotInTarget.length} selected
                </span>
                <button
                  onClick={() => doMove(selectedNotInTarget)}
                  disabled={isPending}
                  className="flex items-center gap-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  <ArrowRight size={12} />
                  Move to {targetArea?.name ?? "area"}
                </button>
              </div>
            )}
          </div>

          {/* Customer list */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
            {filteredCustomers.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10">No customers match.</p>
            ) : (
              filteredCustomers.map((c) => (
                <SourceRow
                  key={c.id}
                  customer={c}
                  selected={selected.has(c.id)}
                  onToggle={toggleSelect}
                  onDragStart={handleDragStart}
                  hidePrices={hidePrices}
                />
              ))
            )}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-slate-100 flex-shrink-0">
            <p className="text-[10px] text-slate-400">
              Click to select · Ctrl+click for multiple · Drag to right column
            </p>
          </div>
        </div>

        {/* ── RIGHT COLUMN: Target area ──────────────────────────────────── */}
        <div
          className={cn(
            "flex flex-col bg-white w-1/2 min-w-0 transition-colors",
            dropOver && targetAreaId !== "" ? "bg-blue-50" : ""
          )}
          onDragOver={(e) => { e.preventDefault(); setDropOver(true); }}
          onDragLeave={() => setDropOver(false)}
          onDrop={(e) => { e.preventDefault(); handleDrop(); }}
        >
          {/* Column header */}
          <div className="px-4 pt-3 pb-2.5 border-b border-slate-100 flex-shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Target Area</p>
              {targetArea && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setAddCustomerOpen(true)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-1 rounded-lg transition-colors"
                  >
                    <UserPlus size={11} /> Add Customer
                  </button>
                  <button
                    onClick={() => setEditOpen(true)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg transition-colors"
                  >
                    <Pencil size={11} /> Edit
                  </button>
                </div>
              )}
            </div>

            {/* Area selector */}
            <div className="relative">
              <select
                value={targetAreaId}
                onChange={(e) => {
                  setTargetAreaId(e.target.value === "" ? "" : Number(e.target.value));
                  setEditOpen(false);
                  setAddCustomerOpen(false);
                }}
                className="w-full appearance-none pl-3 pr-7 py-2 text-sm font-semibold border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800"
              >
                <option value="">— Select an area —</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>

            {/* Area stats */}
            {targetArea && (
              <div className="grid grid-cols-2 gap-1.5">
                <div className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5">
                  <Users size={12} className="text-slate-400 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-400">Customers</p>
                    <p className="text-xs font-bold text-slate-700">{targetCustomers.length}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5">
                  <PoundSterling size={12} className="text-slate-400 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-400">Value / run</p>
                    <p className="text-xs font-bold text-slate-700">{hidePrices ? "–" : fmtCurrency(targetValue)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5">
                  <CalendarClock size={12} className="text-slate-400 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-400">Cadence</p>
                    <p className="text-xs font-bold text-slate-700">{cadenceLabel(targetArea)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5">
                  <CalendarClock size={12} className="text-slate-400 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-400">Next due</p>
                    <p className="text-xs font-bold text-slate-700">{fmtShort(targetArea.nextDueDate)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Drop zone + customer list */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
            {!targetAreaId ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-300 py-20">
                <ArrowRight size={32} />
                <p className="text-sm">Select a target area above</p>
              </div>
            ) : dropOver ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 rounded-xl border-2 border-dashed border-blue-400 bg-blue-50 py-20">
                <ArrowRight size={28} className="text-blue-400" />
                <p className="text-sm font-semibold text-blue-600">
                  Drop to move {selected.size > 1 ? `${selected.size} customers` : "customer"} here
                </p>
              </div>
            ) : targetCustomers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 rounded-xl border-2 border-dashed border-slate-200 py-20">
                <Users size={28} className="text-slate-300" />
                <p className="text-sm text-slate-400">No customers in this area yet</p>
                <p className="text-xs text-slate-400">Drag customers here or use the Move button</p>
              </div>
            ) : (
              targetCustomers.map((c) => <TargetRow key={c.id} customer={c} hidePrices={hidePrices} />)
            )}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-slate-100 flex-shrink-0">
            <p className="text-[10px] text-slate-400">
              {isPending ? "Moving…" : "Drop customers here to reassign them to this area"}
            </p>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
