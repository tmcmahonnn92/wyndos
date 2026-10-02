"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { endSupportSessions } from "@/lib/admin-tickets";

type Open = { id: number; tenantName: string; superAdminLabel: string; reason: string; createdAt: string };
type Log = Open & { endedAt: string | null };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const minutes = (from: string, to: string | null) => Math.max(1, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 60000));

/** Open support sessions (end one or all) and the audit log. */
export function SessionsPanel({ open, recent, currentId }: { open: Open[]; recent: Log[]; currentId: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const end = (id?: number) =>
    start(async () => {
      // Ending the one this browser is in also clears its cookies.
      if (!id || id === currentId) await fetch("/api/admin/end-support-session", { method: "POST" }).catch(() => {});
      await endSupportSessions(id);
      router.refresh();
    });

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Open now ({open.length})</h2>
          {open.length > 1 && (
            <button onClick={() => end()} disabled={pending} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60">
              End all
            </button>
          )}
        </div>
        {open.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-4 text-sm text-slate-500">No support sessions open.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-amber-900/50 bg-slate-900">
            {open.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">
                    {s.tenantName}
                    {s.id === currentId && <span className="ml-2 rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] text-blue-300">this browser</span>}
                  </p>
                  <p className="truncate text-xs text-slate-400">{s.reason}</p>
                  <p className="text-xs text-slate-500">{s.superAdminLabel} · since {when(s.createdAt)} · {minutes(s.createdAt, null)} min</p>
                </div>
                <button onClick={() => end(s.id)} disabled={pending} className="rounded-lg border border-red-700 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-950 disabled:opacity-60">
                  End
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-white">Recent access</h2>
        <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
          {recent.map((log) => (
            <li key={log.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="text-slate-200">{log.tenantName} <span className="text-slate-500">· {log.superAdminLabel}</span></p>
                <p className="truncate text-xs text-slate-500">{log.reason}</p>
              </div>
              <p className="flex-shrink-0 text-right text-xs text-slate-500">
                {when(log.createdAt)}<br />
                {log.endedAt ? `${minutes(log.createdAt, log.endedAt)} min` : <span className="text-emerald-400">open</span>}
              </p>
            </li>
          ))}
          {recent.length === 0 && <li className="px-4 py-4 text-sm text-slate-500">Nothing yet.</li>}
        </ul>
      </section>
    </div>
  );
}
