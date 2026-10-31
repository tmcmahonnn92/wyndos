"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Search, ShieldAlert, Trash2 } from "lucide-react";
import { adminDeleteBusiness, adminDeletePreview } from "@/lib/admin-delete";

type Tenant = {
  id: number;
  name: string;
  slug: string;
  ownerEmail: string | null;
  createdAt: string | Date;
  userCount: number;
  customerCount: number;
  areaCount: number;
  workDayCount: number;
  mine: boolean;
  myRole: string | null;
};

const MIN_REASON_LENGTH = 12;

/**
 * Businesses. Your own open straight away, as you. Anyone else's needs an audited
 * support session with a reason (it closes itself after 2 hours).
 */
export function BusinessesPanel({ tenants, mode }: { tenants: Tenant[]; mode: "mine" | "all" }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "name" | "customers">("newest");
  const [openFor, setOpenFor] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [deleteFor, setDeleteFor] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof adminDeletePreview>> | null>(null);

  const startDelete = async (id: number) => {
    if (deleteFor === id) { setDeleteFor(null); return; }
    setDeleteFor(id); setTyped(""); setPreview(null); setError(""); setOpenFor(null);
    try { setPreview(await adminDeletePreview(id)); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load that business."); }
  };
  const confirmDelete = async (t: Tenant) => {
    setBusy(t.id); setError("");
    try {
      await adminDeleteBusiness(t.id, typed);
      setDeleteFor(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const joined = (t: Tenant) => new Date(t.createdAt).getTime();
    const by = {
      newest: (a: Tenant, b: Tenant) => joined(b) - joined(a),
      oldest: (a: Tenant, b: Tenant) => joined(a) - joined(b),
      name: (a: Tenant, b: Tenant) => a.name.localeCompare(b.name),
      customers: (a: Tenant, b: Tenant) => b.customerCount - a.customerCount || joined(b) - joined(a),
    }[sort];
    return tenants
      .filter((t) => !q || `${t.name} ${t.ownerEmail ?? ""} ${t.slug}`.toLowerCase().includes(q))
      .sort(by);
  }, [tenants, query, sort]);

  const post = async (url: string, body: object, tenantId: number) => {
    setBusy(tenantId);
    setError("");
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "That didn't work.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search business, owner email"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none"
          />
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort businesses"
          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A–Z</option>
          <option value="customers">Most customers</option>
        </select>
        <span className="text-xs text-slate-500">{shown.length} of {tenants.length}</span>
      </div>
      {error && <p className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}

      <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {shown.map((t) => (
          <li key={t.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <Building2 className="h-4 w-4 flex-shrink-0 text-blue-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">
                  {t.name}
                  {t.mine && <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">Yours · {t.myRole === "OWNER" ? "owner" : "worker"}</span>}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {t.ownerEmail ?? "No owner"} · {t.customerCount} customers · {t.userCount} users · joined {new Date(t.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              {t.mine ? (
                <button
                  onClick={() => post("/api/admin/own-business", { tenantId: t.id }, t.id)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {busy === t.id ? "Opening…" : "Open"} <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={() => { setOpenFor(openFor === t.id ? null : t.id); setDeleteFor(null); setReason(""); setError(""); }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-200 hover:border-slate-500"
                >
                  <ShieldAlert className="h-4 w-4 text-amber-400" /> Support access
                </button>
              )}
              <button
                onClick={() => startDelete(t.id)}
                title={`Delete ${t.name}`}
                aria-label={`Delete ${t.name}`}
                className="inline-flex items-center rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:border-red-700 hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {deleteFor === t.id && (
              <div className="mt-3 space-y-2 rounded-lg border border-red-900/70 bg-red-950/20 p-3 text-sm text-red-200/90">
                <p className="font-semibold text-red-300">Delete {t.name} for good?</p>
                {!preview ? <p className="text-xs text-slate-400">Checking…</p> : (
                  <ul className="list-disc space-y-0.5 pl-5 text-xs">
                    <li>Removes its {preview.customers} customers, {preview.payments} payments, schedule, accounts and settings, and cancels its subscription.</li>
                    <li>{preview.loginsRemoved} login{preview.loginsRemoved === 1 ? "" : "s"} only used for this business {preview.loginsRemoved === 1 ? "is" : "are"} removed.</li>
                    {preview.loginsKept.length > 0 && <li>Kept (they also work for another business, only their place here goes): {preview.loginsKept.join(", ")}.</li>}
                    {preview.goCardless && <li>GoCardless is connected: Wyndos stops tracking it, but anything already sent to GoCardless still collects in their GoCardless account.</li>}
                    <li>No other business is touched. This can&apos;t be undone.</li>
                  </ul>
                )}
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={`Type "${t.name}" to confirm`}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-600"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setDeleteFor(null)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-300">Cancel</button>
                  <button
                    onClick={() => confirmDelete(t)}
                    disabled={busy !== null || !preview || typed.trim().toLowerCase() !== t.name.trim().toLowerCase()}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40"
                  >
                    {busy === t.id ? "Deleting…" : "Delete business"}
                  </button>
                </div>
              </div>
            )}
            {openFor === t.id && !t.mine && (
              <div className="mt-3 space-y-2 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
                <p className="text-xs text-amber-200/90">Logged with your reason. Closes itself after 2 hours, or end it from the Access log.</p>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Why, e.g. Owner asked about a missing payment on 26 Sep (ticket #12)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">{reason.trim().length}/{MIN_REASON_LENGTH} characters</span>
                  <button
                    onClick={() => post("/api/admin/switch-tenant", { tenantId: t.id, reason: reason.trim() }, t.id)}
                    disabled={busy !== null || reason.trim().length < MIN_REASON_LENGTH}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {busy === t.id ? "Opening…" : "Open support session"}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No businesses match.</li>}
      </ul>
    </div>
  );
}
