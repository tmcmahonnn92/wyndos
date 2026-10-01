"use client";

import { useRef, useState } from "react";
import { DatabaseBackup, Download, RotateCcw, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Counts = Record<string, number>;
type Preview = { createdAt: string; tenantName: string; counts: Counts };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const summary = (c: Counts) =>
  [
    `${c.customers ?? 0} customers`,
    `${c.areas ?? 0} areas`,
    `${c.workDays ?? 0} days`,
    `${c.jobs ?? 0} visits`,
    `${c.payments ?? 0} payments`,
    `${(c.expenses ?? 0) + (c.otherIncome ?? 0)} accounts entries`,
  ].join(", ");

/** Download a full backup, or put one back. Owner only (the Data tab is owner only). */
export function BackupCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const post = async (f: File, extra: Record<string, string>) => {
    const fd = new FormData();
    fd.set("file", f);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    const res = await fetch("/api/backup/restore", { method: "POST", body: fd });
    return res.json().catch(() => ({ ok: false, error: res.status === 413 ? "The file is too big to upload." : "Something went wrong." }));
  };

  const choose = async (f: File | undefined) => {
    setError(""); setDone(null); setPreview(null); setTyped("");
    if (!f) return;
    setFile(f);
    setBusy(true);
    try {
      const r = await post(f, { preview: "1" });
      if (!r.ok) { setError(r.error); setFile(null); } else setPreview(r.preview);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const restore = async () => {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const r = await post(file, { confirm: typed });
      if (!r.ok) { setError(r.error); return; }
      setDone(`Restored to ${when(r.restored.createdAt)}.`);
      setFile(null); setPreview(null); setTyped("");
      // Everything changed: reload so every screen shows the restored data.
      setTimeout(() => window.location.assign("/"), 1500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle><DatabaseBackup size={16} className="inline mr-2 text-blue-600" />Backups</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs text-slate-600">
            One file with everything: customers, areas, the schedule, history, payments, accounts, texts and settings.
            Keep it somewhere safe (your computer, Google Drive, a USB stick). Making one doesn&apos;t change anything.
          </p>
          <a href="/api/backup" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            <Download size={14} /> Download backup now
          </a>
          <p className="text-[11px] text-slate-400">Tip: download one before big changes, like a re-import or clearing data.</p>
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-3">
          <p className="text-sm font-semibold text-slate-800">Restore a backup</p>
          <p className="text-xs text-slate-600">
            Puts this business back exactly as it was when the backup was made. Anything done since is replaced.
            Your team&apos;s logins aren&apos;t changed.
          </p>
          <input ref={fileRef} type="file" accept=".gz,.json,application/gzip,application/json" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
          {!preview && (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Upload size={14} /> {busy ? "Checking…" : "Choose backup file"}
            </button>
          )}
          {preview && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">Backup from {when(preview.createdAt)}</p>
              <p className="text-xs text-amber-900">{summary(preview.counts)}.</p>
              <p className="text-xs text-amber-900">
                Restoring replaces everything in {preview.tenantName} now with this. Download a backup of now first if you might want it.
              </p>
              <label className="block text-xs text-slate-700">
                Type <strong>RESTORE</strong> to confirm
                <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={restore} disabled={busy || typed.trim().toUpperCase() !== "RESTORE"}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-40">
                  <RotateCcw size={14} /> {busy ? "Restoring…" : "Restore this backup"}
                </button>
                <button type="button" onClick={() => { setPreview(null); setFile(null); setTyped(""); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          {done && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold text-green-800">{done} Reloading…</p>}
        </div>
      </CardContent>
    </Card>
  );
}
