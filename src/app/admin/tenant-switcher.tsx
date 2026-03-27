"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Users, ArrowRight, ShieldAlert, ClipboardList, CalendarDays } from "lucide-react";

type Tenant = {
  id: number;
  name: string;
  slug: string;
  ownerEmail: string | null;
  createdAt: Date;
  userCount: number;
  customerCount: number;
  areaCount: number;
  workDayCount: number;
};

const MIN_REASON_LENGTH = 12;

export function TenantSwitcher({ tenants }: { tenants: Tenant[] }) {
  const router = useRouter();
  const [switching, setSwitching] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [reasons, setReasons] = useState<Record<number, string>>({});

  const sortedTenants = useMemo(
    () => tenants.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [tenants],
  );

  async function handleSelect(tenantId: number) {
    const reason = (reasons[tenantId] ?? "").trim();

    if (reason.length < MIN_REASON_LENGTH) {
      setError(`Enter a support reason of at least ${MIN_REASON_LENGTH} characters before opening tenant access.`);
      return;
    }

    setSwitching(tenantId);
    setError("");

    try {
      const res = await fetch("/api/admin/switch-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, reason }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to open support session.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-800/60 bg-amber-950/30 p-4 text-sm text-amber-100">
        <p className="font-semibold">Support access is audited.</p>
        <p className="mt-1 text-amber-200/85">
          Opening a tenant creates a logged support session with your reason, timestamp, and duration. Use this only for legitimate support or compliance work.
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {sortedTenants.map((tenant) => {
        const reason = reasons[tenant.id] ?? "";
        const tooShort = reason.trim().length < MIN_REASON_LENGTH;

        return (
          <div
            key={tenant.id}
            className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-slate-700"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-white">{tenant.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {tenant.ownerEmail ?? "No owner email"} · slug: {tenant.slug}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400 md:flex md:flex-wrap md:items-center md:gap-3">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />{tenant.userCount} users</span>
                    <span className="flex items-center gap-1"><ClipboardList className="h-3 w-3" />{tenant.customerCount} customers</span>
                    <span>{tenant.areaCount} areas</span>
                    <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{tenant.workDayCount} work days</span>
                    <span>Joined {new Date(tenant.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor={`support-reason-${tenant.id}`} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                <ShieldAlert className="h-3.5 w-3.5" />
                Support reason
              </label>
              <textarea
                id={`support-reason-${tenant.id}`}
                value={reason}
                onChange={(event) => setReasons((current) => ({ ...current, [tenant.id]: event.target.value }))}
                placeholder="Example: Owner requested billing investigation for missing payment recorded on 26 Mar."
                rows={3}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-blue-500"
              />
              <div className="flex items-center justify-between gap-4 text-xs text-slate-500">
                <span>{reason.trim().length}/{MIN_REASON_LENGTH} minimum characters</span>
                <button
                  onClick={() => handleSelect(tenant.id)}
                  disabled={switching !== null || tooShort}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ArrowRight className="h-4 w-4" />
                  {switching === tenant.id ? "Opening…" : "Open support session"}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
