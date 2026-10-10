"use client";

import { Plus, X } from "lucide-react";

export type MapperField = { key: string; label: string; multi?: boolean; hint?: string; defaultPlaceholder?: string };

const letter = (i: number) => {
  let s = "", n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/**
 * Change how a file is read, after the AI (or a template) has had a go: which column(s) feed
 * each field, which row has the headings, and a value to use when a cell is blank.
 */
export function ColumnMapper({ grid, headerRow, columns, defaults, fixed = {}, fields, onChange }: {
  grid: string[][];
  headerRow: number;
  columns: Record<string, number[]>;
  defaults: Record<string, string | undefined>;
  /** Value used on every row, whatever the file says (set by "try again"). */
  fixed?: Record<string, string | undefined>;
  fields: MapperField[];
  onChange: (next: { columns: Record<string, number[]>; defaults: Record<string, string | undefined>; fixed: Record<string, string | undefined>; headerRow: number; firstDataRow: number }) => void;
}) {
  const width = Math.min(60, Math.max(1, ...grid.slice(0, 50).map((r) => r.length)));
  const headings = headerRow >= 0 ? grid[headerRow] ?? [] : [];
  const sample = grid.slice(Math.max(0, headerRow + 1), headerRow + 40).find((r) => r.some((c) => String(c).trim())) ?? [];
  const option = (i: number) => {
    const h = String(headings[i] ?? "").trim();
    const eg = String(sample[i] ?? "").trim().slice(0, 24);
    return `${letter(i)}${h ? ` · ${h}` : ""}${eg ? ` (e.g. ${eg})` : ""}`;
  };
  const set = (key: string, list: number[]) => onChange({ columns: { ...columns, [key]: list }, defaults, fixed, headerRow, firstDataRow: headerRow + 1 });
  const setDefault = (key: string, value: string) => onChange({ columns, defaults: { ...defaults, [key]: value || undefined }, fixed, headerRow, firstDataRow: headerRow + 1 });
  const clearFixed = (key: string) => onChange({ columns, defaults, fixed: { ...fixed, [key]: undefined }, headerRow, firstDataRow: headerRow + 1 });

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-slate-600">
        Headings are on row
        <input type="number" min={0} max={50} value={headerRow + 1}
          onChange={(e) => { const h = Math.max(0, Math.min(50, (Number(e.target.value) || 0) - 1)); onChange({ columns, defaults, fixed, headerRow: h, firstDataRow: h + 1 }); }}
          className="w-16 rounded border border-slate-200 px-1.5 py-0.5" />
        <span className="text-slate-400">(0 = no heading row)</span>
      </label>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-slate-100 text-left text-slate-500"><th className="py-1.5 pr-2 font-semibold">Field</th><th className="py-1.5 pr-2 font-semibold">Column(s) in your file</th><th className="py-1.5 font-semibold">If blank, use</th></tr></thead>
          <tbody className="divide-y divide-slate-50">
            {fields.map((f) => {
              const list = columns[f.key] ?? [];
              const shown = list.length ? list : [-1];
              return (
                <tr key={f.key} className="align-top">
                  <td className="py-1.5 pr-2"><span className="font-medium text-slate-700">{f.label}</span>{f.hint && <span className="block text-[10px] text-slate-400">{f.hint}</span>}</td>
                  <td className="py-1.5 pr-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {shown.map((c, idx) => (
                        <span key={idx} className="flex items-center gap-0.5">
                          <select value={c} onChange={(e) => {
                            const v = Number(e.target.value);
                            const next = [...list];
                            if (v < 0) next.splice(idx, 1); else if (idx < next.length) next[idx] = v; else next.push(v);
                            set(f.key, [...new Set(next.filter((n) => n >= 0))]);
                          }} className="max-w-[230px] rounded border border-slate-200 bg-white px-1.5 py-1">
                            <option value={-1}>— not in file —</option>
                            {Array.from({ length: width }, (_, i) => <option key={i} value={i}>{option(i)}</option>)}
                          </select>
                          {list.length > 1 && <button type="button" onClick={() => set(f.key, list.filter((_, j) => j !== idx))} className="text-slate-400 hover:text-red-600" aria-label="Remove column"><X size={12} /></button>}
                        </span>
                      ))}
                      {f.multi && list.length > 0 && list.length < 4 && (
                        <button type="button" onClick={() => set(f.key, [...list, list[list.length - 1] + 1 < width ? list[list.length - 1] + 1 : 0])} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-blue-700"><Plus size={11} /> join another</button>
                      )}
                    </div>
                  </td>
                  <td className="py-1.5">
                    {fixed[f.key] ? (
                      <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-1 text-blue-800">
                        Every row: <b>{fixed[f.key]}</b>
                        <button type="button" onClick={() => clearFixed(f.key)} className="text-blue-400 hover:text-red-600" aria-label="Stop using this for every row"><X size={12} /></button>
                      </span>
                    ) : <input value={defaults[f.key] ?? ""} onChange={(e) => setDefault(f.key, e.target.value)} placeholder={f.defaultPlaceholder ?? "—"} className="w-36 rounded border border-slate-200 px-1.5 py-1" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
