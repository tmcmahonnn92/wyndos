"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  PoundSterling,
  CalendarClock,
  AlertTriangle,
  GripVertical,
  Check,
  X,
  UserPlus,
  GitBranch,
} from "lucide-react";
import { createArea, updateArea, deleteArea, reorderAreaCustomers, updateCustomer, createCustomer, splitArea } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { fmtCurrency, cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type AreaCustomer = {
  id: number;
  name: string;
  address: string;
  price: number;
  sortOrder: number;
};

type Area = {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
  scheduleType: string;
  frequencyWeeks: number;
  monthlyDay: number | null;
  nextDueDate: Date | string | null;
  estimatedValue: number;
  _count: { customers: number };
  customers: AreaCustomer[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORDINAL = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

function cadenceLabel(area: Area): string {
  if (area.scheduleType === "MONTHLY") return `Monthly — ${ORDINAL(area.monthlyDay ?? 1)}`;
  const fw = area.frequencyWeeks ?? 4;
  if (fw === 1) return "Every week";
  return `Every ${fw} weeks`;
}

// ── Area Form State ───────────────────────────────────────────────────────────

interface AreaFormState {
  name: string;
  color: string;
  scheduleType: "WEEKLY" | "MONTHLY";
  frequencyWeeks: string;
  monthlyDay: string;
  nextDueDate: string;
}

function defaultForm(area?: Area): AreaFormState {
  return {
    name: area?.name ?? "",
    color: area?.color ?? "#3B82F6",
    scheduleType: area?.scheduleType === "MONTHLY" ? "MONTHLY" : "WEEKLY",
    frequencyWeeks: String(area?.frequencyWeeks ?? 4),
    monthlyDay: String(area?.monthlyDay ?? 1),
    nextDueDate: area?.nextDueDate ? new Date(area.nextDueDate).toISOString().slice(0, 10) : "",
  };
}

// ── Edit Area Modal (settings + customers) ───────────────────────────────────

interface EditAreaModalProps {
  open: boolean;
  onClose: () => void;
  area: Area;
  onSaveSettings: (form: AreaFormState) => void;
  isSettingsPending: boolean;
}

function EditAreaModal({ open, onClose, area, onSaveSettings, isSettingsPending }: EditAreaModalProps) {
  // ── Area settings form ────────────────────────────────────────────────────
  const [form, setForm] = useState<AreaFormState>(defaultForm(area));

  function setField<K extends keyof AreaFormState>(key: K, val: AreaFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  // ── Customer list state ───────────────────────────────────────────────────
  type LocalCustomer = AreaCustomer & { priceText: string; dirty: boolean };

  const toLocal = (cs: AreaCustomer[]): LocalCustomer[] =>
    [...cs]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((c) => ({ ...c, priceText: c.price.toFixed(2), dirty: false }));

  const [localCustomers, setLocalCustomers] = useState<LocalCustomer[]>([]);
  const [editingPriceId, setEditingPriceId] = useState<number | null>(null);
  const [orderChanged, setOrderChanged] = useState(false);
  const [isSavingCustomers, startSavingCustomers] = useTransition();
  const router = useRouter();

  // Drag state
  const dragIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Add customer inline form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", address: "", price: "" });
  const [isAddingCustomer, startAddingCustomer] = useTransition();

  // Sync form + customer list whenever the modal opens or the target area changes
  useEffect(() => {
    if (open) {
      setForm(defaultForm(area));
      setLocalCustomers(toLocal(area.customers));
      setOrderChanged(false);
      setEditingPriceId(null);
      setDragOverIdx(null);
      dragIdxRef.current = null;
      setShowAddForm(false);
      setAddForm({ name: "", address: "", price: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, area.id]);

  // ── Drag-to-reorder ───────────────────────────────────────────────────────
  const handleDrop = (toIdx: number) => {
    const fromIdx = dragIdxRef.current;
    if (fromIdx === null || fromIdx === toIdx) {
      dragIdxRef.current = null;
      setDragOverIdx(null);
      return;
    }
    const next = [...localCustomers];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setLocalCustomers(next);
    setOrderChanged(true);
    dragIdxRef.current = null;
    setDragOverIdx(null);
  };

  // ── Price editing ─────────────────────────────────────────────────────────
  const commitPrice = (id: number, text: string) => {
    const parsed = parseFloat(text);
    const price = !isNaN(parsed) && parsed >= 0 ? parsed : null;
    setLocalCustomers((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (price === null) return { ...c, priceText: c.price.toFixed(2) }; // revert bad input
        const changed = Math.abs(price - c.price) > 0.001;
        return { ...c, price, priceText: price.toFixed(2), dirty: c.dirty || changed };
      })
    );
    setEditingPriceId(null);
  };

  // ── Add a new customer to this area inline ─────────────────────────────
  const handleAddCustomer = () => {
    const price = parseFloat(addForm.price);
    if (!addForm.name.trim() || !addForm.address.trim() || isNaN(price) || price < 0) return;
    startAddingCustomer(async () => {
      const newCustomer = await createCustomer({
        name: addForm.name.trim(),
        address: addForm.address.trim(),
        price,
        areaId: area.id,
      });
      setLocalCustomers((prev) => [
        ...prev,
        {
          id: newCustomer.id,
          name: newCustomer.name,
          address: newCustomer.address,
          price: newCustomer.price,
          sortOrder: (newCustomer as { sortOrder?: number }).sortOrder ?? prev.length,
          priceText: newCustomer.price.toFixed(2),
          dirty: false,
        },
      ]);
      setAddForm({ name: "", address: "", price: "" });
      setShowAddForm(false);
      router.refresh();
    });
  };

  // ── Save customers (prices + order) ──────────────────────────────────────
  const hasDirtyPrices = localCustomers.some((c) => c.dirty);
  const hasChanges = orderChanged || hasDirtyPrices;

  const handleSaveCustomers = () => {
    startSavingCustomers(async () => {
      if (hasDirtyPrices) {
        await Promise.all(
          localCustomers
            .filter((c) => c.dirty)
            .map((c) => updateCustomer(c.id, { price: c.price }))
        );
      }
      if (orderChanged) {
        await reorderAreaCustomers(area.id, localCustomers.map((c) => c.id));
      }
      setLocalCustomers((prev) => prev.map((c) => ({ ...c, dirty: false })));
      setOrderChanged(false);
      router.refresh();
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit — ${area.name}`} className="sm:max-w-xl">
      <div className="space-y-5">

        {/* ── Area Settings ──────────────────────────────────────── */}
        <div className="space-y-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Area Settings</p>

          {/* Name + Colour */}
          <div className="flex gap-3 items-start">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-1">Area name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => e.key === "Enter" && form.name.trim() && onSaveSettings(form)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Colour</label>
              <input
                type="color"
                value={form.color}
                onChange={(e) => setField("color", e.target.value)}
                className="w-10 h-10 rounded-lg border border-slate-200 p-1 cursor-pointer"
                title="Pick area colour"
              />
            </div>
          </div>

          {/* Schedule type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Schedule type</label>
            <div className="flex gap-2">
              {(["WEEKLY", "MONTHLY"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setField("scheduleType", t)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                    form.scheduleType === t
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 text-slate-600 hover:border-blue-300"
                  }`}
                >
                  {t === "WEEKLY" ? "Weekly interval" : "Monthly (set date)"}
                </button>
              ))}
            </div>
          </div>

          {form.scheduleType === "WEEKLY" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Repeat every</label>
              <div className="flex gap-2">
                {["1", "2", "4", "6", "8", "12"].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setField("frequencyWeeks", w)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                      form.frequencyWeeks === w
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 text-slate-600 hover:border-blue-300"
                    }`}
                  >
                    {w}w
                  </button>
                ))}
              </div>
            </div>
          )}

          {form.scheduleType === "MONTHLY" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Day of month</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={form.monthlyDay}
                  onChange={(e) => setField("monthlyDay", e.target.value)}
                  className="w-24 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-semibold text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-sm text-slate-500">
                  {ORDINAL(Number(form.monthlyDay) || 1)} of every month
                </p>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Use 1–28 to avoid end-of-month issues.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Next due date</label>
            <input
              type="date"
              value={form.nextDueDate}
              onChange={(e) => setField("nextDueDate", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Changing this will not move any already-scheduled work day.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => onSaveSettings(form)}
              disabled={isSettingsPending || !form.name.trim()}
              className="flex-1"
            >
              {isSettingsPending ? "Saving…" : "Save Area Settings"}
            </Button>
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>

        {/* ── Customers ──────────────────────────────────────────── */}
        <div className="border-t border-slate-100 pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Customers ({localCustomers.length})
            </p>
            <div className="flex items-center gap-3">
              {localCustomers.length > 0 && (
                <p className="text-[11px] text-slate-400">Drag to reorder · click price to edit</p>
              )}
              <button
                type="button"
                onClick={() => setShowAddForm((v) => !v)}
                className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 transition-colors"
              >
                <UserPlus size={12} />
                {showAddForm ? "Cancel" : "Add Customer"}
              </button>
            </div>
          </div>

            {localCustomers.length === 0 && !showAddForm && (
              <p className="text-sm text-slate-400 text-center py-3">No customers in this area yet.</p>
            )}

            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
              {localCustomers.map((customer, idx) => (
                <div
                  key={customer.id}
                  draggable
                  onDragStart={() => { dragIdxRef.current = idx; }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(idx); }}
                  onDragEnd={() => { dragIdxRef.current = null; setDragOverIdx(null); }}
                  className={cn(
                    "flex items-center gap-2 px-2 py-2 rounded-lg border bg-white transition-all select-none group",
                    dragOverIdx === idx && dragIdxRef.current !== idx
                      ? "border-blue-400 ring-2 ring-blue-200 bg-blue-50"
                      : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  {/* Drag handle */}
                  <GripVertical
                    size={14}
                    className="text-slate-300 flex-shrink-0 cursor-grab active:cursor-grabbing"
                  />

                  {/* Position number */}
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>

                  {/* Name + address */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{customer.name}</p>
                    <p className="text-[11px] text-slate-400 truncate">{customer.address}</p>
                  </div>

                  {/* Unsaved indicator */}
                  {customer.dirty && (
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 flex-shrink-0">
                      edited
                    </span>
                  )}

                  {/* Price — click to edit inline */}
                  {editingPriceId === customer.id ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-xs text-slate-500">£</span>
                      <input
                        autoFocus
                        type="number"
                        step="0.01"
                        min="0"
                        value={customer.priceText}
                        onChange={(e) =>
                          setLocalCustomers((prev) =>
                            prev.map((c) =>
                              c.id === customer.id ? { ...c, priceText: e.target.value } : c
                            )
                          )
                        }
                        onBlur={() => commitPrice(customer.id, customer.priceText)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitPrice(customer.id, customer.priceText);
                          if (e.key === "Escape") {
                            setLocalCustomers((prev) =>
                              prev.map((c) =>
                                c.id === customer.id ? { ...c, priceText: c.price.toFixed(2) } : c
                              )
                            );
                            setEditingPriceId(null);
                          }
                        }}
                        className="w-20 border border-blue-400 rounded-lg px-2 py-1 text-sm font-semibold text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <button
                        onClick={() => commitPrice(customer.id, customer.priceText)}
                        className="p-1 rounded-full bg-green-100 text-green-700 hover:bg-green-200"
                      >
                        <Check size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingPriceId(customer.id)}
                      className="flex items-center gap-1 flex-shrink-0 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                      title="Click to edit price"
                    >
                      <span className="text-sm font-bold text-slate-700">{fmtCurrency(customer.price)}</span>
                      <Pencil size={11} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Inline add customer form */}
            {showAddForm && (
              <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 space-y-2">
                <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">New Customer</p>
                <div className="space-y-1.5">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Name"
                    value={addForm.name}
                    onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    placeholder="Address"
                    value={addForm.address}
                    onChange={(e) => setAddForm((p) => ({ ...p, address: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-500 flex-shrink-0">£</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Price"
                      value={addForm.price}
                      onChange={(e) => setAddForm((p) => ({ ...p, price: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && handleAddCustomer()}
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleAddCustomer}
                    disabled={isAddingCustomer || !addForm.name.trim() || !addForm.address.trim() || addForm.price === ""}
                    className="flex-1 bg-blue-600 hover:bg-blue-700"
                  >
                    {isAddingCustomer ? "Adding…" : "Add"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setShowAddForm(false); setAddForm({ name: "", address: "", price: "" }); }}
                    className="flex-shrink-0"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Customer changes save bar */}
            {hasChanges && (
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSaveCustomers}
                  disabled={isSavingCustomers}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  size="sm"
                >
                  {isSavingCustomers ? "Saving…" : "Save Customer Changes"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLocalCustomers(toLocal(area.customers));
                    setOrderChanged(false);
                  }}
                  className="flex-shrink-0"
                >
                  <X size={13} className="mr-1" />
                  Discard
                </Button>
              </div>
            )}
          </div>

      </div>
    </Modal>
  );
}

// ── Add Area Modal ────────────────────────────────────────────────────────────

interface AddAreaModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (form: AreaFormState) => void;
  isPending: boolean;
}

function AddAreaModal({ open, onClose, onSave, isPending }: AddAreaModalProps) {
  const blank: AreaFormState = {
    name: "", color: "#3B82F6", scheduleType: "WEEKLY",
    frequencyWeeks: "4", monthlyDay: "1", nextDueDate: "",
  };
  const [form, setForm] = useState<AreaFormState>(blank);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) setForm(blank); }, [open]);

  function set<K extends keyof AreaFormState>(key: K, val: AreaFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  return (
    <Modal open={open} onClose={onClose} title="Add New Area">
      <div className="space-y-4">
        <div className="flex gap-3 items-start">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">Area name</label>
            <input
              type="text" value={form.name} onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. North Zone"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => e.key === "Enter" && form.name.trim() && onSave(form)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Colour</label>
            <input type="color" value={form.color} onChange={(e) => set("color", e.target.value)}
              className="w-10 h-10 rounded-lg border border-slate-200 p-1 cursor-pointer" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Schedule type</label>
          <div className="flex gap-2">
            {(["WEEKLY", "MONTHLY"] as const).map((t) => (
              <button key={t} type="button" onClick={() => set("scheduleType", t)}
                className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                  form.scheduleType === t
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-200 text-slate-600 hover:border-blue-300"
                }`}
              >
                {t === "WEEKLY" ? "Weekly interval" : "Monthly (set date)"}
              </button>
            ))}
          </div>
        </div>

        {form.scheduleType === "WEEKLY" && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Repeat every</label>
            <div className="flex gap-2">
              {["1", "2", "4", "6", "8", "12"].map((w) => (
                <button key={w} type="button" onClick={() => set("frequencyWeeks", w)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                    form.frequencyWeeks === w
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 text-slate-600 hover:border-blue-300"
                  }`}>
                  {w}w
                </button>
              ))}
            </div>
          </div>
        )}

        {form.scheduleType === "MONTHLY" && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Day of month</label>
            <div className="flex items-center gap-3">
              <input type="number" min={1} max={28} value={form.monthlyDay}
                onChange={(e) => set("monthlyDay", e.target.value)}
                className="w-24 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-semibold text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-sm text-slate-500">{ORDINAL(Number(form.monthlyDay) || 1)} of every month</p>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Use 1–28 to avoid end-of-month issues.</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Next due date</label>
          <input type="date" value={form.nextDueDate} onChange={(e) => set("nextDueDate", e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div className="flex gap-2 pt-1">
          <Button onClick={() => onSave(form)} disabled={isPending || !form.name.trim()} className="flex-1">
            {isPending ? "Creating…" : "Create Area"}
          </Button>
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Delete Confirmation Modal ─────────────────────────────────────────────────

interface DeleteModalProps {
  open: boolean;
  onClose: () => void;
  area: Area | null;
  onConfirm: () => void;
  isPending: boolean;
  error: string | null;
}

function DeleteModal({ open, onClose, area, onConfirm, isPending, error }: DeleteModalProps) {
  if (!area) return null;
  const hasCustomers = area._count.customers > 0;
  return (
    <Modal open={open} onClose={onClose} title="Delete Area">
      <div className="space-y-4">
        {hasCustomers ? (
          <div className="flex gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              <strong>{area.name}</strong> has {area._count.customers} customer{area._count.customers === 1 ? "" : "s"} assigned.
              Move them to another area before deleting.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            Are you sure you want to delete <strong>{area.name}</strong>? This cannot be undone.
          </p>
        )}
        {error && (
          <div className="flex gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        <div className="flex gap-2">
          {hasCustomers ? (
            <Button onClick={onClose} className="flex-1">OK</Button>
          ) : (
            <>
              <Button onClick={onConfirm} disabled={isPending}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white border-red-600">
                {isPending ? "Deleting…" : "Delete Area"}
              </Button>
              <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AreaManage({ areas }: { areas: Area[] }) {
  const router = useRouter();
  const [isSettingsPending, startSettingsTransition] = useTransition();
  const [addPending, startAddTransition] = useTransition();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Area | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Area | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleAdd(form: AreaFormState) {
    if (!form.name.trim()) return;
    startAddTransition(async () => {
      await createArea({
        name: form.name.trim(),
        scheduleType: form.scheduleType,
        frequencyWeeks: form.scheduleType === "WEEKLY" ? (Number(form.frequencyWeeks) || 4) : 4,
        monthlyDay: form.scheduleType === "MONTHLY" ? (Number(form.monthlyDay) || 1) : undefined,
        nextDueDate: form.nextDueDate ? new Date(form.nextDueDate) : undefined,
        sortOrder: (Math.max(0, ...areas.map((a) => a.sortOrder)) + 1),
      });
      setAddOpen(false);
      router.refresh();
    });
  }

  function handleEditSettings(form: AreaFormState) {
    if (!editTarget || !form.name.trim()) return;
    startSettingsTransition(async () => {
      await updateArea(editTarget.id, {
        name: form.name.trim(),
        color: form.color,
        scheduleType: form.scheduleType,
        frequencyWeeks: form.scheduleType === "WEEKLY" ? (Number(form.frequencyWeeks) || 4) : 4,
        monthlyDay: form.scheduleType === "MONTHLY" ? (Number(form.monthlyDay) || 1) : null,
        nextDueDate: form.nextDueDate ? new Date(form.nextDueDate) : null,
      });
      setEditTarget(null);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    startDeleteTransition(async () => {
      try {
        await deleteArea(deleteTarget.id);
        setDeleteTarget(null);
        router.refresh();
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Delete failed.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {areas.length} area{areas.length === 1 ? "" : "s"} configured
        </p>
        <Button onClick={() => setAddOpen(true)} className="flex items-center gap-1.5">
          <Plus size={14} />
          Add Area
        </Button>
      </div>

      {/* Area list */}
      {areas.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <CalendarClock size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No areas yet</p>
          <p className="text-xs mt-1">Click &quot;Add Area&quot; to get started.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
          {areas.map((area) => (
            <div
              key={area.id}
              className="flex items-center gap-4 px-4 py-3 bg-white hover:bg-slate-50 transition-colors"
            >
              <div
                className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-black/10"
                style={{ backgroundColor: area.color ?? "#94a3b8" }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{area.name}</p>
                <p className="text-[11px] text-slate-400">{cadenceLabel(area)}</p>
              </div>
              <div className="hidden sm:flex flex-col items-center min-w-[72px]">
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Next due</p>
                <p className="text-xs font-semibold text-slate-700">{fmtDate(area.nextDueDate)}</p>
              </div>
              <div className="hidden sm:flex items-center gap-1 min-w-[52px] text-slate-500">
                <Users size={12} />
                <span className="text-xs font-semibold">{area._count.customers}</span>
              </div>
              <div className="hidden md:flex items-center gap-1 min-w-[72px] text-slate-500">
                <PoundSterling size={12} />
                <span className="text-xs font-semibold">{fmtCurrency(area.estimatedValue)}</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => splitArea(area.id).then((newArea) => { router.refresh(); setEditTarget({ ...newArea, customers: [] }); })}
                  className="p-1.5 rounded-lg text-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors"
                  title="Copy as Day 2 area"
                >
                  <GitBranch size={14} />
                </button>
                <button
                  onClick={() => setEditTarget(area)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                  title="Edit area"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => { setDeleteError(null); setDeleteTarget(area); }}
                  className="p-1.5 rounded-lg text-red-400 hover:text-red-700 hover:bg-red-50 transition-colors"
                  title="Delete area"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      <AddAreaModal open={addOpen} onClose={() => setAddOpen(false)} onSave={handleAdd} isPending={addPending} />

      {editTarget && (
        <EditAreaModal
          open={true}
          onClose={() => setEditTarget(null)}
          area={editTarget}
          onSaveSettings={handleEditSettings}
          isSettingsPending={isSettingsPending}
        />
      )}

      <DeleteModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        area={deleteTarget}
        onConfirm={handleDelete}
        isPending={isDeleting}
        error={deleteError}
      />
    </div>
  );
}
