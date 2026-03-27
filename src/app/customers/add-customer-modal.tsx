"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createCustomer } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface Area {
  id: number;
  name: string;
  frequencyWeeks: number;
  nextDueDate: Date | string | null;
}

export function AddCustomerModal({ areas }: { areas: Area[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const [form, setForm] = useState({
    name: "",
    address: "",
    areaId: "",
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

  const handleSubmit = () => {
    if (!form.name || !form.areaId || !form.price) return;
    startTransition(async () => {
      await createCustomer({
        name: form.name,
        address: form.address,
        areaId: Number(form.areaId),
        price: Number(form.price),
        phone: form.phone || undefined,
        email: form.email || undefined,
        jobName: form.jobName || "Window Cleaning",
        advanceNotice: form.advanceNotice,
        preferredPaymentMethod: form.preferredPaymentMethod || undefined,
        notes: form.notes || undefined,
      });
      setForm({ name: "", address: "", areaId: "", price: "", phone: "", email: "", jobName: "Window Cleaning", advanceNotice: false, preferredPaymentMethod: "", notes: "" });
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus size={15} />
        Add Customer
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Add Customer">
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

          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
            <input
              type="text"
              placeholder="Street address"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

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
              <label className="block text-sm font-medium text-slate-700 mb-1">Area *</label>
              <select
                value={form.areaId}
                onChange={(e) => set("areaId", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">– Select –</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Price (£) *</label>
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Preferred Payment</label>
              <select
                value={form.preferredPaymentMethod}
                onChange={(e) => set("preferredPaymentMethod", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">– No preference –</option>
                <option value="CASH">Cash</option>
                <option value="BACS">BACS</option>
                <option value="CARD">Card</option>
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
              disabled={isPending || !form.name || !form.areaId || !form.price}
              className="flex-1"
            >
              {isPending ? "Adding..." : "Add Customer"}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
