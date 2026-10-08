"use client";

import { AlertTriangle, Download } from "lucide-react";

export type NotImportedRow = {
  /** Row number in the file (as the spreadsheet shows it), when known. */
  row?: number | string;
  /** Who / what the row was: a customer name, supplier, date… */
  name?: string;
  reason: string;
};

/**
 * Every row an import left out, and why, so nothing goes missing silently.
 * Shown after an import (and in previews); can be downloaded to fix and re-import.
 */
export function NotImportedList({ rows, title = "Not imported", fileName = "not-imported.csv", tone = "amber" }: {
  rows: NotImportedRow[];
  title?: string;
  fileName?: string;
  tone?: "amber" | "red";
}) {
  if (rows.length === 0) return null;
  const download = () => {
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["Row,Name,Reason", ...rows.map((r) => [r.row ?? "", r.name ?? "", r.reason].map(cell).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };
  const red = tone === "red";
  return (
    <div className={`overflow-hidden rounded-xl border ${red ? "border-red-200" : "border-amber-200"}`}>
      <div className={`flex items-center justify-between gap-2 border-b px-4 py-2.5 ${red ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
        <span className={`flex items-center gap-2 text-sm font-semibold ${red ? "text-red-700" : "text-amber-800"}`}>
          <AlertTriangle size={14} /> {title}: {rows.length} row{rows.length === 1 ? "" : "s"}
        </span>
        <button type="button" onClick={download} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          <Download size={12} /> Download list
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-100 text-left text-slate-500">
              <th className="w-16 px-3 py-1.5 font-semibold">Row</th>
              <th className="px-3 py-1.5 font-semibold">Name</th>
              <th className="px-3 py-1.5 font-semibold">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-3 py-1.5 font-mono text-slate-400">{r.row ?? "—"}</td>
                <td className="max-w-[220px] truncate px-3 py-1.5 text-slate-700">{r.name || "—"}</td>
                <td className={`px-3 py-1.5 ${red ? "text-red-700" : "text-amber-800"}`}>{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
