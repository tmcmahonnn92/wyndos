"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Zap, UserPlus } from "lucide-react";
import { createOneOffJob, createOneOffCustomerAndBookByDate } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { fmtCurrency, cn } from "@/lib/utils";

interface SearchResult {
  id: number;
  name: string;
  address: string;
  price: number;
  area: { name: string } | null;
}

interface Area {
  id: number;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type Mode = "search" | "new-customer";

export function OneOffJobModal({ open, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("search");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<SearchResult | null>(null);
  const [customPrice, setCustomPrice] = useState("");
  const [jobName, setJobName] = useState("Window Cleaning");
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // New customer form fields
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [areas, setAreas] = useState<Area[]>([]);
  const [newAreaId, setNewAreaId] = useState("");
  const [newFrequency, setNewFrequency] = useState("4");

  const handleClose = () => {
    setQuery("");
    setResults([]);
    setSelectedCustomer(null);
    setCustomPrice("");
    setJobName("Window Cleaning");
    setNotes("");
    setMode("search");
    setNewName("");
    setNewAddress("");
    setNewPrice("");
    setNewNotes("");
    setNewAreaId("");
    setNewFrequency("4");
    onClose();
  };

  const handleSearch = async () => {
    if (query.trim().length < 2) return;
    const res = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setResults(data);
  };

  const handleSelectCustomer = (c: SearchResult) => {
    setSelectedCustomer(c);
    setCustomPrice(String(c.price));
    setResults([]);
    setQuery(c.name);
  };

  const handleSubmit = () => {
    if (!selectedCustomer) return;
    startTransition(async () => {
      await createOneOffJob({
        date: new Date(date),
        customerId: selectedCustomer.id,
        name: jobName.trim() || "Window Cleaning",
        price: customPrice ? parseFloat(customPrice) : selectedCustomer.price,
        notes: notes || undefined,
      });
      router.refresh();
      handleClose();
    });
  };

  const handleLoadAreas = async () => {
    if (areas.length > 0) return;
    try {
      const r = await fetch("/api/areas");
      if (r.ok) setAreas(await r.json());
    } catch { /* ignore */ }
  };

  const handleCreateOneOffNewCustomer = () => {
    if (!newName.trim() || !newAddress.trim() || !newPrice) return;
    startTransition(async () => {
      await createOneOffCustomerAndBookByDate({
        name: newName.trim(),
        address: newAddress.trim(),
        price: parseFloat(newPrice),
        notes: newNotes || undefined,
        jobName: jobName.trim() || "Window Cleaning",
        areaId: newAreaId ? Number(newAreaId) : undefined,
        frequencyWeeks: newAreaId ? (Number(newFrequency) || 4) : undefined,
      }, new Date(date));
      router.refresh();
      handleClose();
    });
  };

  return (
    <Modal open={open} onClose={handleClose} title="One-off Job">
      <div className="space-y-4">
        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Mode switch */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
          <button
            onClick={() => setMode("search")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors",
              mode === "search"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Search size={13} />
            Existing Customer
          </button>
          <button
            onClick={() => { setMode("new-customer"); handleLoadAreas(); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors",
              mode === "new-customer"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            <UserPlus size={13} />
            New Customer
          </button>
        </div>

        {mode === "search" && (
          <>
            {/* Customer search */}
            {!selectedCustomer ? (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Search by name or address…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Button onClick={handleSearch} size="sm" variant="outline">
                    <Search size={14} />
                  </Button>
                </div>

                {results.length > 0 && (
                  <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                    {results.map((c) => (
                      <li
                        key={c.id}
                        onClick={() => handleSelectCustomer(c)}
                        className="flex items-center justify-between px-3 py-3 hover:bg-slate-50 cursor-pointer"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-800">{c.name}</p>
                          <p className="text-xs text-slate-500">{c.address} · {c.area?.name}</p>
                        </div>
                        <span className="text-sm font-semibold text-slate-700">{fmtCurrency(c.price)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                {/* Selected customer */}
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-xl border border-blue-200">
                  <div>
                    <p className="text-sm font-semibold text-blue-900">{selectedCustomer.name}</p>
                    <p className="text-xs text-blue-600">{selectedCustomer.address}</p>
                  </div>
                  <button
                    onClick={() => { setSelectedCustomer(null); setQuery(""); }}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    Change
                  </button>
                </div>

                {/* Job name */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Job name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={jobName}
                    onChange={(e) => setJobName(e.target.value)}
                    placeholder="e.g. Window Cleaning, Conservatory Clean…"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Custom price */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Price (£) <span className="text-slate-400 font-normal">— edit if different</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Notes <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. conservatory only, new build…"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={handleSubmit}
                    disabled={isPending || !jobName.trim()}
                    className="flex-1"
                  >
                    <Zap size={14} />
                    {isPending ? "Adding…" : "Add One-off Job"}
                  </Button>
                  <Button variant="outline" onClick={handleClose}>Cancel</Button>
                </div>
              </>
            )}
          </>
        )}

        {mode === "new-customer" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Job name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  placeholder="e.g. Window Cleaning, Conservatory Clean…"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Full name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="John Smith"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="1 High Street"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Price (£)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Area <span className="text-slate-400 font-normal">(optional)</span></label>
                <select
                  value={newAreaId}
                  onChange={(e) => { setNewAreaId(e.target.value); setNewFrequency("4"); }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">– No area (one-off only) –</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              {newAreaId && (
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Frequency</label>
                  <div className="flex flex-wrap gap-1.5">
                    {["1", "2", "4", "6", "8", "12"].map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setNewFrequency(w)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors",
                          newFrequency === w
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-slate-600 border-slate-200 hover:border-blue-400"
                        )}
                      >
                        {w}w
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!newAreaId && (
                <div className="col-span-2 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
                  <p className="text-[11px] text-purple-700">
                    No area selected — this customer will be created without a regular schedule and added to this day as a one-off.
                  </p>
                </div>
              )}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Notes <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Dog in garden, ring bell…"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                onClick={handleCreateOneOffNewCustomer}
                disabled={isPending || !newName.trim() || !newAddress.trim() || !newPrice || !jobName.trim()}
                className="flex-1"
              >
                <Zap size={14} />
                {isPending ? "Creating…" : newAreaId ? "Create Customer & Add to Day" : "Create One-off & Add to Day"}
              </Button>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
