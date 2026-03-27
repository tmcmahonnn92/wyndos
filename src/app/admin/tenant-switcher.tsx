"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Users, ArrowRight, Check } from "lucide-react";

type Tenant = {
  id: number;
  name: string;
  slug: string;
  ownerEmail: string | null;
  createdAt: Date;
  userCount: number;
};

export function TenantSwitcher({ tenants }: { tenants: Tenant[] }) {
  const router = useRouter();
  const [switching, setSwitching] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function handleSelect(tenantId: number) {
    setSwitching(tenantId);
    setError("");

    try {
      const res = await fetch("/api/admin/switch-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to switch tenant.");
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
    <div className="space-y-3">
      {error && (
        <p className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {tenants.map((t) => (
        <div
          key={t.id}
          className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-slate-700"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-white">{t.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {t.ownerEmail ?? "No owner email"} · slug: {t.slug}
              </p>
              <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {t.userCount} {t.userCount === 1 ? "user" : "users"}
                </span>
                <span>·</span>
                <span>
                  Joined{" "}
                  {new Date(t.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={() => handleSelect(t.id)}
            disabled={switching !== null}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {switching === t.id ? (
              <Check className="h-4 w-4 animate-pulse" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {switching === t.id ? "Switching…" : "View round"}
          </button>
        </div>
      ))}
    </div>
  );
}
