"use client";

/**
 * Bank statement matching.
 *
 * Security: the statement is read here, in the browser, and is never uploaded,
 * saved, cached or written to browser storage. The file input is cleared as soon
 * as it has been read. Only rows the user ticks are sent, and only the fields
 * needed to record each payment. Everything is dropped from memory after saving
 * or when the page is left.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, CheckCircle2, EyeOff, RotateCcw, Search, Upload, X } from "lucide-react";
import { commitBankImport, findImportedLines, undoBankImport, type BankImportRow } from "@/lib/actions";
import { cn, fmtCurrency } from "@/lib/utils";
import {
  detectColumns,
  extractLines,
  findHeaderRow,
  guessWithoutHeader,
  lineHash,
  readStatementFile,
  type BankLine,
  type ColumnMapping,
} from "@/lib/bank-import/parse";
import { allocateOldestFirst, suggestFor, type LearnedReference, type LineSuggestion, type MatchCustomer } from "@/lib/bank-import/match";

type Customer = MatchCustomer & { address: string; active: boolean };
type Recent = { id: number; createdAt: string; undoneAt: string | null; paidCount: number; ignoredCount: number; total: number };

type RowState = {
  line: BankLine;
  hash: string;
  suggestion: LineSuggestion;
  customerId: number | null;
  /** Job ids ticked to pay, oldest first. */
  jobIds: number[];
  decision: "none" | "pay" | "ignore";
  learn: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function jobsFor(customer: Customer | undefined, amount: number) {
  if (!customer) return [];
  return allocateOldestFirst(amount, customer.unpaid).allocations.map((a) => a.jobId);
}

/** Split the amount across the ticked jobs, oldest first; the rest is credit. */
function splitAmount(amount: number, customer: Customer | undefined, jobIds: number[]) {
  const ticked = (customer?.unpaid ?? []).filter((j) => jobIds.includes(j.jobId));
  return allocateOldestFirst(amount, ticked);
}

export function BankImportClient({
  tenantId,
  allowCredit,
  customers,
  references,
  recent,
}: {
  tenantId: number;
  allowCredit: boolean;
  customers: Customer[];
  references: LearnedReference[];
  recent: Recent[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [matrix, setMatrix] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(-1);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [alreadyCount, setAlreadyCount] = useState(0);
  const [filter, setFilter] = useState<"all" | "suggested" | "check" | "unmatched" | "ready">("all");
  const [result, setResult] = useState<null | { importId: number | null; paidCount: number; ignoredCount: number; total: number; failed: Array<{ line: BankLine; message: string }> }>(null);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  /** Drop everything read from the statement. */
  const forget = () => {
    setStep((current) => (current === 3 ? 3 : 0));
    setMatrix([]);
    setRows([]);
    setMapping(null);
    setHeaderRow(-1);
    setAlreadyCount(0);
    if (fileRef.current) fileRef.current.value = "";
  };
  // Leaving the page forgets the statement too, including when the browser keeps the page
  // in its back/forward cache or the tab is closed.
  useEffect(() => {
    const onHide = () => forget();
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); forget(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function ingest(file: File) {
    setError(null);
    try {
      const grid = await readStatementFile(file);
      if (fileRef.current) fileRef.current.value = ""; // never keep hold of the file
      const header = findHeaderRow(grid);
      const map = header >= 0 ? detectColumns(grid[header]) : guessWithoutHeader(grid);
      setMatrix(grid);
      setHeaderRow(header);
      setMapping(map);
      setStep(1);
    } catch (e) {
      if (fileRef.current) fileRef.current.value = "";
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    }
  }

  const headers = useMemo(() => {
    if (headerRow >= 0) return matrix[headerRow] ?? [];
    const width = Math.max(0, ...matrix.slice(0, 20).map((r) => r.length));
    return Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  }, [matrix, headerRow]);

  const extracted = useMemo(() => (mapping ? extractLines(matrix, headerRow, mapping) : { lines: [], skipped: 0 }), [matrix, headerRow, mapping]);
  const mappingOk = mapping && mapping.date >= 0 && (mapping.amount >= 0 || mapping.moneyIn >= 0);

  async function buildRows() {
    setError(null);
    const counts = new Map<string, number>();
    const built: RowState[] = [];
    for (const line of extracted.lines) {
      const sig = `${line.date}|${line.amount}|${line.text}`;
      const occurrence = counts.get(sig) ?? 0;
      counts.set(sig, occurrence + 1);
      const suggestion = suggestFor(line, customers, references);
      const top = suggestion.status === "suggested" || suggestion.status === "check" ? suggestion.candidates[0]?.customerId ?? null : null;
      built.push({
        line,
        hash: await lineHash(tenantId, line, occurrence),
        suggestion,
        customerId: top,
        jobIds: top ? jobsFor(customerById.get(top), line.amount) : [],
        decision: "none", // never ticked for you: every row is checked by a person
        learn: true,
      });
    }
    startTransition(async () => {
      try {
        const seen = new Set(await findImportedLines(built.map((r) => r.hash)));
        const fresh = built.filter((r) => !seen.has(r.hash));
        setAlreadyCount(built.length - fresh.length);
        const order = { suggested: 0, check: 1, ignore: 2, unmatched: 3 } as const;
        fresh.sort((a, b) => order[a.suggestion.status] - order[b.suggestion.status] || a.line.date.localeCompare(b.line.date));
        setRows(fresh);
        setMatrix([]); // the raw sheet isn't needed any more
        setStep(2);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't check for earlier imports.");
      }
    });
  }

  const update = (hash: string, change: (row: RowState) => RowState) =>
    setRows((current) => current.map((r) => (r.hash === hash ? change(r) : r)));

  const ready = rows.filter((r) => r.decision !== "none");
  const readyTotal = round2(ready.filter((r) => r.decision === "pay").reduce((s, r) => s + r.line.amount, 0));
  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "ready" ? r.decision !== "none" : r.suggestion.status === filter || (filter === "unmatched" && r.suggestion.status === "ignore"));

  function save() {
    setError(null);
    const payload: BankImportRow[] = ready.map((r) => {
      if (r.decision === "ignore") return { action: "ignore", hash: r.hash, text: r.line.text, learn: r.learn };
      const split = splitAmount(r.line.amount, customerById.get(r.customerId!), r.jobIds);
      return {
        action: "pay",
        hash: r.hash,
        date: r.line.date,
        amount: r.line.amount,
        text: r.line.text,
        customerId: r.customerId!,
        allocations: split.allocations,
        extra: split.extra,
        learn: r.learn,
      };
    });
    startTransition(async () => {
      try {
        const res = await commitBankImport({ rows: payload });
        const byHash = new Map(rows.map((r) => [r.hash, r.line]));
        setResult({
          importId: res.importId,
          paidCount: res.paidCount,
          ignoredCount: res.ignoredCount,
          total: res.total,
          failed: res.results.filter((x) => !x.ok).map((x) => ({ line: byHash.get(x.hash)!, message: x.message ?? "Not saved" })).filter((x) => x.line),
        });
        forget();
        setStep(3);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save.");
      }
    });
  }

  function undo(importId: number) {
    if (!confirm("Undo this import? Its payments will be cancelled and the lines can be imported again.")) return;
    startTransition(async () => {
      try {
        await undoBankImport(importId);
        setResult(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't undo.");
      }
    });
  }

  return (
    <div className="space-y-5 pb-24">
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle size={15} className="flex-shrink-0" /> {error}
        </div>
      )}

      {step === 0 && (
        <div className="space-y-4">
          <div
            className="border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer border-slate-200 hover:border-blue-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void ingest(f); }}
          >
            <Upload size={36} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Drop your statement here, or tap to choose</p>
            <p className="text-xs text-slate-400 mt-1">Export it from your bank as CSV or Excel. Any layout works.</p>
            <input ref={fileRef} type="file" className="hidden" accept=".csv,.txt,.xlsx,.xls,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void ingest(f); }} />
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <p className="font-semibold">Your statement stays on this device</p>
            <p className="mt-1">The file is read on your phone or computer. It is never uploaded or saved. Only the payments you confirm are recorded.</p>
          </div>
          {recent.length > 0 && <RecentImports recent={recent} onUndo={undo} busy={busy} />}
        </div>
      )}

      {step === 1 && mapping && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">Check the columns. We only use money coming in.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ColumnSelect label="Date" value={mapping.date} headers={headers} onChange={(v) => setMapping({ ...mapping, date: v })} />
            <ColumnSelect label="Money in (or one amount column)" value={mapping.moneyIn >= 0 ? mapping.moneyIn : mapping.amount} headers={headers}
              onChange={(v) => setMapping(mapping.moneyOut >= 0 || mapping.moneyIn >= 0 ? { ...mapping, moneyIn: v, amount: -1 } : { ...mapping, amount: v })} />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5">Who paid / reference (choose any that help)</p>
            <div className="flex flex-wrap gap-2">
              {headers.map((h, i) => (
                <button key={i} type="button"
                  onClick={() => setMapping({ ...mapping, text: mapping.text.includes(i) ? mapping.text.filter((x) => x !== i) : [...mapping.text, i] })}
                  className={cn("rounded-full border px-3 py-1 text-xs", mapping.text.includes(i) ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950" : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300")}>
                  {h || `Column ${i + 1}`}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
            <p className="px-3 py-2 text-xs text-slate-500">{extracted.lines.length} payments in · {extracted.skipped} other rows skipped</p>
            {extracted.lines.slice(0, 5).map((l) => (
              <div key={l.row} className="px-3 py-2 text-sm flex gap-3">
                <span className="text-slate-500 w-24 shrink-0">{fmtDate(l.date)}</span>
                <span className="font-semibold w-20 shrink-0">{fmtCurrency(l.amount)}</span>
                <span className="truncate text-slate-600 dark:text-slate-300">{l.text || "—"}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { forget(); setStep(0); }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm dark:border-slate-700">Start again</button>
            <button type="button" disabled={!mappingOk || extracted.lines.length === 0 || busy} onClick={() => void buildRows()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Checking…" : "Find matches"}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {([
              ["all", `All ${rows.length}`],
              ["suggested", `Suggested ${rows.filter((r) => r.suggestion.status === "suggested").length}`],
              ["check", `Check ${rows.filter((r) => r.suggestion.status === "check").length}`],
              ["unmatched", `Not matched ${rows.filter((r) => r.suggestion.status === "unmatched" || r.suggestion.status === "ignore").length}`],
              ["ready", `Done ${ready.length}`],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setFilter(key)}
                className={cn("rounded-full px-3 py-1 text-xs font-medium border", filter === key ? "bg-slate-800 text-white border-slate-800 dark:bg-slate-100 dark:text-slate-900" : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300")}>
                {label}
              </button>
            ))}
          </div>
          {(() => {
            const sure = rows.filter((r) => r.decision === "none" && r.suggestion.status === "suggested" && r.customerId !== null
              && (allowCredit || splitAmount(r.line.amount, customerById.get(r.customerId), r.jobIds).extra <= 0.005));
            return sure.length > 0 ? (
              <button type="button" onClick={() => setRows((all) => all.map((r) => (sure.includes(r) ? { ...r, decision: "pay" } : r)))}
                className="w-full rounded-xl border border-green-600 bg-green-50 px-4 py-2.5 text-sm font-semibold text-green-800 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-200">
                Accept all {sure.length} good matches
              </button>
            ) : null;
          })()}
          {alreadyCount > 0 && <p className="text-xs text-slate-500">{alreadyCount} line{alreadyCount === 1 ? " was" : "s were"} already imported before and {alreadyCount === 1 ? "is" : "are"} hidden.</p>}
          {rows.length === 0 && <p className="text-sm text-slate-500">Nothing new to match in this file.</p>}
          {shown.map((row) => (
            <RowCard key={row.hash} row={row} customers={customers} customer={row.customerId ? customerById.get(row.customerId) : undefined}
              allowCredit={allowCredit} onChange={(change) => update(row.hash, change)} />
          ))}
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <button type="button" onClick={() => { forget(); setStep(0); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">Cancel</button>
              <p className="flex-1 text-xs text-slate-500">{ready.filter((r) => r.decision === "pay").length} to save · {fmtCurrency(readyTotal)}</p>
              <button type="button" disabled={ready.length === 0 || busy} onClick={save}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-green-200 bg-green-50 p-5 dark:border-green-900 dark:bg-green-950/40">
            <CheckCircle2 className="text-green-600" />
            <p className="mt-2 font-semibold text-slate-800 dark:text-slate-100">{result.paidCount} payment{result.paidCount === 1 ? "" : "s"} recorded ({fmtCurrency(result.total)})</p>
            {result.ignoredCount > 0 && <p className="text-sm text-slate-600 dark:text-slate-300">{result.ignoredCount} ignored</p>}
            <p className="mt-1 text-xs text-slate-500">The statement has been cleared from this page.</p>
          </div>
          {result.failed.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
              <p className="font-semibold text-amber-800 dark:text-amber-200">Not saved</p>
              {result.failed.map((f, i) => (
                <p key={i} className="mt-1 text-amber-800 dark:text-amber-200">{fmtDate(f.line.date)} · {fmtCurrency(f.line.amount)} · {f.line.text}: {f.message}</p>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            {result.importId && (
              <button type="button" disabled={busy} onClick={() => undo(result.importId!)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-sm dark:border-slate-700">
                <RotateCcw size={14} /> Undo this import
              </button>
            )}
            <button type="button" onClick={() => { setResult(null); setStep(0); }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Import another</button>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function ColumnSelect({ label, value, headers, onChange }: { label: string; value: number; headers: string[]; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
        <option value={-1}>Not in this file</option>
        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
      </select>
    </label>
  );
}

const BADGE: Record<LineSuggestion["status"], { label: string; cls: string }> = {
  suggested: { label: "Suggested", cls: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200" },
  check: { label: "Check", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  unmatched: { label: "Not matched", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  ignore: { label: "Usually ignored", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
};

function RowCard({ row, customers, customer, allowCredit, onChange }: {
  row: RowState;
  customers: Customer[];
  customer: Customer | undefined;
  allowCredit: boolean;
  onChange: (change: (row: RowState) => RowState) => void;
}) {
  const split = splitAmount(row.line.amount, customer, row.jobIds);
  const creditBlocked = split.extra > 0.005 && !allowCredit;
  const badge = BADGE[row.suggestion.status];
  const top = row.suggestion.candidates.find((c) => c.customerId === row.customerId);
  const canTick = row.customerId !== null && !creditBlocked;

  return (
    <div className={cn("rounded-2xl border p-3 space-y-2.5 bg-white dark:bg-slate-900",
      row.decision === "pay" ? "border-green-400 ring-1 ring-green-300" : row.decision === "ignore" ? "border-slate-300 opacity-70" : "border-slate-200 dark:border-slate-700")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm"><span className="font-bold">{fmtCurrency(row.line.amount)}</span> <span className="text-slate-500">· {fmtDate(row.line.date)}</span></p>
          <p className="truncate text-xs text-slate-600 dark:text-slate-300">{row.line.text || "No reference"}</p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", badge.cls)}>{badge.label}</span>
      </div>

      {row.decision !== "ignore" && (
        <>
          <CustomerPicker customers={customers} suggestion={row.suggestion} value={row.customerId}
            onPick={(id) => onChange((r) => ({ ...r, customerId: id, jobIds: jobsFor(customers.find((c) => c.id === id), r.line.amount), decision: "none" }))} />
          {top && <p className="text-[11px] text-slate-500">{top.reasons.join(" · ")}</p>}
          {row.suggestion.warning && <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">{row.suggestion.warning}</p>}

          {customer && (
            <div className="space-y-1.5">
              {customer.unpaid.length === 0 && <p className="text-xs text-slate-500">Nothing owing.{allowCredit ? " This will be kept as credit." : ""}</p>}
              {customer.unpaid.length > 0 && <p className="text-[11px] font-semibold text-slate-500">Pays for</p>}
              <div className="flex flex-wrap gap-1.5">
                {customer.unpaid.map((job) => {
                  const on = row.jobIds.includes(job.jobId);
                  return (
                    <button key={job.jobId} type="button"
                      onClick={() => onChange((r) => ({ ...r, decision: "none", jobIds: on ? r.jobIds.filter((id) => id !== job.jobId) : [...r.jobIds, job.jobId] }))}
                      className={cn("rounded-lg border px-2 py-1 text-xs", on ? "border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200" : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300")}>
                      {job.date ? fmtDate(job.date) : "No date"} · {fmtCurrency(job.due)}{job.label && job.label !== "Window Cleaning" ? ` · ${job.label}` : ""}
                    </button>
                  );
                })}
              </div>
              {split.extra > 0.005 && (
                <p className={cn("text-xs", creditBlocked ? "text-red-600" : "text-slate-500")}>
                  {creditBlocked ? `${fmtCurrency(split.extra)} more than the cleans chosen, and customer credit is off. Choose more cleans.` : `${fmtCurrency(split.extra)} kept as credit`}
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" disabled={!canTick && row.decision !== "pay"}
          onClick={() => onChange((r) => ({ ...r, decision: r.decision === "pay" ? "none" : "pay" }))}
          className={cn("inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-40",
            row.decision === "pay" ? "bg-green-600 text-white" : "border border-green-600 text-green-700 dark:text-green-300")}>
          <Check size={14} /> {row.decision === "pay" ? "Matched" : customer ? `Yes, ${customer.name.split(" ")[0] || customer.name} paid this` : "Choose who paid"}
        </button>
        <button type="button" onClick={() => onChange((r) => ({ ...r, decision: r.decision === "ignore" ? "none" : "ignore" }))}
          className={cn("inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm",
            row.decision === "ignore" ? "bg-slate-700 text-white" : "border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300")}>
          <EyeOff size={14} /> {row.decision === "ignore" ? "Skipped" : "Not a customer"}
        </button>
        {row.line.text && (
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" checked={row.learn} onChange={(e) => onChange((r) => ({ ...r, learn: e.target.checked }))} />
            {row.decision === "ignore" ? "Always suggest ignoring this" : "Remember this reference"}
          </label>
        )}
      </div>
    </div>
  );
}

function CustomerPicker({ customers, suggestion, value, onPick }: {
  customers: Customer[];
  suggestion: LineSuggestion;
  value: number | null;
  onPick: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const chosen = customers.find((c) => c.id === value);
  const suggestedIds = suggestion.candidates.map((c) => c.customerId);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return suggestedIds.map((id) => customers.find((c) => c.id === id)).filter((c): c is Customer => Boolean(c));
    return customers.filter((c) => c.name.toLowerCase().includes(needle) || c.address.toLowerCase().includes(needle)).slice(0, 8);
  }, [q, customers, suggestedIds]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm dark:border-slate-700">
        {chosen ? (
          <span className="min-w-0 flex-1 truncate"><span className="font-semibold">{chosen.name}</span> <span className="text-slate-500">· {chosen.reference}</span></span>
        ) : (
          <span className="flex-1 text-slate-400">Choose customer…</span>
        )}
        <Search size={14} className="text-slate-400" />
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-blue-300 p-2 space-y-1">
      <div className="flex items-center gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or address"
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" />
        <button type="button" onClick={() => { setOpen(false); setQ(""); }} className="p-1 text-slate-400"><X size={16} /></button>
      </div>
      {list.length === 0 && <p className="px-1 py-1 text-xs text-slate-500">{q ? "No customers found." : "Type to search."}</p>}
      {list.map((c) => (
        <button key={c.id} type="button" onClick={() => { onPick(c.id); setOpen(false); setQ(""); }}
          className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
          <span className="font-semibold">{c.name}</span> <span className="text-slate-500">· {c.reference}</span>
          {c.unpaid.length > 0 && <span className="text-xs text-slate-500"> · owes {fmtCurrency(round2(c.unpaid.reduce((s, j) => s + j.due, 0)))}</span>}
          {!c.active && <span className="text-xs text-slate-400"> · inactive</span>}
        </button>
      ))}
    </div>
  );
}

function RecentImports({ recent, onUndo, busy }: { recent: Recent[]; onUndo: (id: number) => void; busy: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700">
      <p className="px-3 py-2 text-xs font-semibold text-slate-500">Recent imports</p>
      {recent.map((r) => (
        <div key={r.id} className="flex items-center gap-3 border-t border-slate-100 px-3 py-2 text-sm dark:border-slate-800">
          <span className="flex-1 text-slate-600 dark:text-slate-300">
            {new Date(r.createdAt).toLocaleDateString("en-GB")} · {r.paidCount} paid ({fmtCurrency(r.total)}){r.ignoredCount ? ` · ${r.ignoredCount} ignored` : ""}
          </span>
          {r.undoneAt ? <span className="text-xs text-slate-400">Undone</span> : (
            <button type="button" disabled={busy} onClick={() => onUndo(r.id)} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-red-600 dark:text-slate-300">
              <RotateCcw size={12} /> Undo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
