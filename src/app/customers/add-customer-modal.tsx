"use client";

import { PAYMENT_PREFERENCES } from "@/lib/payment-preference";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createArea, createCustomer } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useActionParam } from "@/lib/use-action-param";
import { AddressFields } from "@/components/address-fields";
import { EMPTY_ADDRESS, type AddressParts } from "@/lib/address";

interface Area {
  id: number;
  name: string;
  frequencyWeeks: number;
  nextDueDate: Date | string | null;
}

const NEW_AREA = "__new";
const FREQUENCIES = [1, 2, 4, 6, 8, 12];

export function AddCustomerModal({ areas: initialAreas }: { areas: Area[] }) {
  const { open, setOpen, close } = useActionParam("new-customer");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Areas made here are added straight to the list, so a brand-new account can add its first customer.
  const [areas, setAreas] = useState<Area[]>(initialAreas);
  const [newAreaName, setNewAreaName] = useState("");
  const [newAreaWeeks, setNewAreaWeeks] = useState(4);
  const [areaError, setAreaError] = useState("");
  const [creatingArea, startAreaTransition] = useTransition();

  const [addressParts, setAddressParts] = useState<AddressParts>(EMPTY_ADDRESS);
  const [form, setForm] = useState({
    name: "",
    areaId: initialAreas.length === 0 ? NEW_AREA : "",
    price: "",
    phone: "",
    email: "",
    jobName: "Window Cleaning",
    advanceNotice: false,
    preferredPaymentMethod: "",
    notes: "",
  });

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const selectedArea = areas.find((a) => String(a.id) === form.areaId);
  const addingArea = form.areaId === NEW_AREA;

  const addArea = () => {
    const name = newAreaName.trim();
    if (!name) { setAreaError("Give the area a name, e.g. the village or estate."); return; }
    if (areas.some((a) => a.name.toLowerCase() === name.toLowerCase())) { setAreaError("You already have an area with that name."); return; }
    setAreaError("");
    startAreaTransition(async () => {
      try {
        const area = await createArea({ name, frequencyWeeks: newAreaWeeks });
        setAreas((prev) => [...prev, area]);
        set("areaId", String(area.id));
        setNewAreaName("");
      } catch (e) {
        setAreaError(e instanceof Error && e.message ? e.message : "Couldn't add the area.");
      }
    });
  };
  const hasAddress = Boolean(addressParts.houseNameNumber.trim() || addressParts.street.trim());

  const handleSubmit = () => {
    if (!form.name || !form.areaId || addingArea || !form.price || !hasAddress) return;
    startTransition(async () => {
      await createCustomer({
        name: form.name,
        ...addressParts,
        areaId: Number(form.areaId),
        price: Number(form.price),
        phone: form.phone || undefined,
        email: form.email || undefined,
        jobName: form.jobName || "Window Cleaning",
        advanceNotice: form.advanceNotice,
        preferredPaymentMethod: form.preferredPaymentMethod || undefined,
        notes: form.notes || undefined,
      });
      setAddressParts(EMPTY_ADDRESS);
      setForm({ name: "", areaId: areas.length === 0 ? NEW_AREA : "", price: "", phone: "", email: "", jobName: "Window Cleaning", advanceNotice: false, preferredPaymentMethod: "", notes: "" });
      close();
      router.refresh();
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus size={15} />
        Add Customer
      </Button>

      <Modal open={open} onClose={close} title="Add Customer">
        <div className="space-y-3">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
            <input
              type="text"
              placeholder="Full name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <AddressFields value={addressParts} onChange={setAddressParts} />

          {/* Phone + Email */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input
                type="tel"
                placeholder="e.g. 07700 900000"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                placeholder="email@example.com"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Area + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 flex min-h-[1.375rem] items-center justify-between gap-2">
                <label className="block text-sm font-medium text-slate-700">Area *</label>
                {!addingArea && (
                  <button
                    type="button"
                    onClick={() => { set("areaId", NEW_AREA); setAreaError(""); }}
                    className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    + New area
                  </button>
                )}
              </div>
              <select
                value={form.areaId}
                onChange={(e) => set("areaId", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">– Select –</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
                <option value={NEW_AREA}>+ New area…</option>
              </select>
            </div>
            <div>
              <label className="mb-1 flex min-h-[1.375rem] items-center text-sm font-medium text-slate-700">Price (£) *</label>
              <input
                type="number"
                min="0"
                step="0.50"
                placeholder="e.g. 15"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {addingArea && (
            <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
              <p className="text-xs font-semibold text-blue-800 dark:text-blue-200">
                {areas.length === 0 ? "Add your first area. An area is a group of streets you clean on the same run." : "New area"}
              </p>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  type="text"
                  autoFocus
                  placeholder="e.g. Worksop North"
                  value={newAreaName}
                  onChange={(e) => setNewAreaName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addArea(); } }}
                  aria-label="Area name"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
                <select
                  value={newAreaWeeks}
                  onChange={(e) => setNewAreaWeeks(Number(e.target.value))}
                  aria-label="How often"
                  className="border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {FREQUENCIES.map((w) => <option key={w} value={w}>Every {w} week{w === 1 ? "" : "s"}</option>)}
                </select>
              </div>
              {areaError && <p className="text-xs text-red-600">{areaError}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={addArea} disabled={creatingArea}>{creatingArea ? "Adding…" : "Add area"}</Button>
                {areas.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => { set("areaId", ""); setAreaError(""); }}>Cancel</Button>
                )}
              </div>
            </div>
          )}

          {selectedArea && (
            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
              Schedule: every <strong>{selectedArea.frequencyWeeks} week{selectedArea.frequencyWeeks !== 1 ? "s" : ""}</strong>
              {selectedArea.nextDueDate && (
                <> · next run <strong>{new Date(selectedArea.nextDueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</strong></>
              )}
            </p>
          )}

          {/* Job Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Job Type / Name</label>
            <input
              type="text"
              placeholder="Window Cleaning"
              value={form.jobName}
              onChange={(e) => set("jobName", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Preferred Payment + Advance Notice */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Usually pays by</label>
              <select
                value={form.preferredPaymentMethod}
                onChange={(e) => set("preferredPaymentMethod", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">– Not set –</option>
                {PAYMENT_PREFERENCES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col justify-end pb-0.5">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={form.advanceNotice}
                    onChange={(e) => set("advanceNotice", e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 rounded-full peer-checked:bg-blue-500 transition-colors" />
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                </div>
                <span className="text-sm font-medium text-slate-700 leading-tight">Advance notice<br/><span className="text-xs text-slate-400 font-normal">required</span></span>
              </label>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              placeholder="Any special instructions..."
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleSubmit}
              disabled={isPending || !form.name || !form.areaId || addingArea || !form.price || !hasAddress}
              className="flex-1"
            >
              {isPending ? "Adding..." : "Add Customer"}
            </Button>
            <Button variant="outline" onClick={close} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
