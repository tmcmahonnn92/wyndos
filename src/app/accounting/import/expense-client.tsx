"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, LifeBuoy, Loader2, RotateCcw, Sparkles, Upload } from "lucide-react";
import { parseCSVText } from "@/lib/import-parsing";
import { HMRC_EXPENSE_CATEGORIES } from "@/lib/accounting";
import {
  applyExpensePlan, EXPENSE_FIELDS, IMPORT_CATEGORIES, merchantKey, templateExpensePlan,
  type ExpenseField, type ExpensePlan, type ExpenseRow,
} from "@/lib/smart-import/expense-plan";
import { aiExpensePlan, importExpenses, type ExpensePlanRequest } from "@/lib/smart-import/expense-actions";
import { NotImportedList, type NotImportedRow } from "@/components/not-imported-list";
import { cn, fmtCurrency } from "@/lib/utils";

type Stage = "upload" | "reading" | "preview" | "importing" | "done";
const FIELD_LABELS: Record<ExpenseField, string> = { date: "Date", supplier: "Supplier", description: "Description", amount: "Amount", moneyOut: "Money out", moneyIn: "Money in", vat: "VAT", category: "Category", notes: "Notes" };
const catOf = new Map(IMPORT_CATEGORIES.map((c) => [c.value, c]));
const fmtDate = (iso: string) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "—");
const SOURCE: Record<ExpenseRow["categorySource"], string> = { file: "from file", ai: "AI", rule: "usual", default: "not sure" };

async function readGrid(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  const data = await file.arrayBuffer();
  if (/\.(csv|txt|tsv)$/.test(name)) {
    let text = new TextDecoder().decode(data);
    if (name.endsWith(".tsv") || (!text.includes(",") && text.includes("\t"))) text = text.split("\n").map((l) => l.split("\t").map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    return parseCSVText(text);
  }
  const XLSX = await import("xlsx");
  const book = XLSX.read(data, { type: "array", cellDates: true });
  let best: string[][] = [];
  for (const sheet of book.SheetNames) {
    const g = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet], { header: 1, raw: false, defval: "", dateNF: "dd/mm/yyyy" }).map((r) => r.map((c) => String(c ?? "")));
    if (g.filter((r) => r.some((c) => c.trim())).length > best.filter((r) => r.some((c) => c.trim())).length) best = g;
  }
  return best;
}

/** The AI sample: top rows, a few later ones, and every distinct supplier (shortened). */
function sampleFor(fileName: string, grid: string[][]): Omit<ExpensePlanRequest, "feedback" | "previousPlan" | "attempt"> {
  const columnCount = Math.min(60, Math.max(1, ...grid.slice(0, 200).map((r) => r.length)));
  const top = grid.slice(0, 12).map((cells, index) => ({ index, cells }));
  const later = [Math.floor(grid.length * 0.5), grid.length - 2, grid.length - 1].filter((i, k, all) => i >= 12 && i < grid.length && all.indexOf(i) === k).map((index) => ({ index, cells: grid[index] }));
  // Text columns (not dates or money): their shortened values are the suppliers to categorise.
  const counts = new Map<string, number>();
  for (let c = 0; c < columnCount; c++) {
    const values = grid.slice(1, 3000).map((r) => String(r[c] ?? "").trim()).filter(Boolean);
    const texty = values.filter((v) => /[a-z]{3}/i.test(v) && !/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(v)).length;
    if (values.length && texty / values.length > 0.7 && new Set(values).size > 3) for (const v of values) { const k = merchantKey(v); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
  }
  const suppliers = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 250).map(([k]) => k);
  return { fileName, rows: [...top, ...later], columnCount, rowCount: grid.length, suppliers };
}

export function ExpenseImport({ available }: { available: boolean }) {
  const [stage, setStage] = useState<Stage>("upload");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [grid, setGrid] = useState<string[][]>([]);
  const [plan, setPlan] = useState<ExpensePlan | null>(null);
  const [source, setSource] = useState<"template" | "ai">("ai");
  const [attempt, setAttempt] = useState(0);
  const [offTopic, setOffTopic] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [putBack, setPutBack] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpText, setHelpText] = useState("");
  const [helpSent, setHelpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ created: number; total: number; notImported: NotImportedRow[] } | null>(null);

  const all = useMemo(() => (plan && plan.kind !== "not_expenses" ? applyExpensePlan(grid, plan) : []), [grid, plan]);
  // Owner's changes: a category picked for one row applies to every row from that supplier.
  const rows = useMemo(() => all.map((r) => ({
    ...r,
    category: overrides[r.key] ?? r.category,
    categorySource: overrides[r.key] ? ("file" as const) : r.categorySource,
    skip: r.skip === "personal" && putBack.has(r.key) ? ("" as const) : r.skip,
  })), [all, overrides, putBack]);
  const toImport = rows.filter((r) => !r.skip);
  const skipped = rows.filter((r) => r.skip);
  const personal = useMemo(() => {
    const m = new Map<string, { key: string; supplier: string; count: number; total: number }>();
    for (const r of all.filter((x) => x.skip === "personal")) {
      const e = m.get(r.key) ?? { key: r.key, supplier: r.supplier, count: 0, total: 0 };
      e.count++; e.total += r.amount; m.set(r.key, e);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [all]);
  const byHmrc = HMRC_EXPENSE_CATEGORIES.map((h) => {
    const list = toImport.filter((r) => catOf.get(r.category)?.hmrcCategory === h.key);
    return { ...h, count: list.length, total: list.reduce((s, r) => s + r.amount, 0) };
  }).filter((h) => h.count > 0);
  const total = toImport.reduce((s, r) => s + r.amount, 0);
  const vat = toImport.reduce((s, r) => s + r.vat, 0);
  const dates = toImport.map((r) => r.date).sort();
  const unsure = toImport.filter((r) => r.categorySource === "default").length;
  const shown = toImport.filter((r) => !filter || (filter === "UNSURE" ? r.categorySource === "default" : r.category === filter)).slice(0, 200);
  const notImportedPreview: NotImportedRow[] = skipped.map((r) => ({ row: r.sheetRow, name: [fmtDate(r.date), r.supplier, r.amount ? fmtCurrency(r.amount) : ""].filter((x) => x && x !== "—").join(" · "), reason: r.skipReason }));

  const reset = () => {
    setStage("upload"); setError(null); setFile(null); setGrid([]); setPlan(null); setAttempt(0); setOffTopic(false);
    setOverrides({}); setPutBack(new Set()); setFilter(""); setFeedbackOpen(false); setFeedback(""); setHelpOpen(false); setHelpSent(false); setResult(null);
  };

  const askAi = async (g: string[][], f: File, previous: ExpensePlan | null, said: string, n: number) => {
    const res = await aiExpensePlan({ ...sampleFor(f.name, g), feedback: said || undefined, previousPlan: previous ?? undefined, attempt: n })
      .catch(() => ({ ok: false as const, error: "Couldn't reach Wyndos. Check your connection and try again." }));
    if (!res.ok) { setError(res.error); return false; }
    setPlan(res.plan); setSource("ai"); setAttempt(n); setOffTopic(res.plan.feedbackOffTopic);
    return true;
  };

  const onFile = async (f: File) => {
    reset();
    setFile(f);
    setStage("reading");
    try {
      if (f.size > 15 * 1024 * 1024) throw new Error("That file is very big. Split it, or ask us to import it.");
      const g = (await readGrid(f)).slice(0, 20050);
      if (g.filter((r) => r.some((c) => String(c).trim())).length < 2) throw new Error("That file looks empty.");
      setGrid(g);
      const tpl = templateExpensePlan(g[0] ?? []);
      if (tpl) { setPlan(tpl); setSource("template"); setStage("preview"); return; }
      if (!available) throw new Error("Smart import isn't available right now. Use the Wyndos template instead (download it below).");
      if (await askAi(g, f, null, "", 1)) setStage("preview"); else setStage("upload");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "That file couldn't be read.");
      setStage("upload");
    }
  };

  const retry = async () => {
    if (!file || !plan) return;
    setBusy(true); setError(null);
    if (await askAi(grid, file, plan, feedback, attempt + 1)) { setFeedbackOpen(false); setFeedback(""); }
    setBusy(false);
  };

  const doImport = async () => {
    setStage("importing"); setError(null);
    const notImported: NotImportedRow[] = [...notImportedPreview];
    let created = 0, sum = 0;
    try {
      for (let i = 0; i < toImport.length; i += 400) {
        setProgress(`Saving… ${Math.min(i + 400, toImport.length)} of ${toImport.length}`);
        const batch = toImport.slice(i, i + 400);
        const res = await importExpenses(batch.map((r) => ({ row: r.sheetRow, date: r.date, supplier: r.supplier, amount: r.amount, vat: r.vat, category: r.category, notes: r.notes })));
        created += res.created;
        const skippedRows = new Set(res.notImported.map((n) => n.row));
        sum += batch.filter((r) => !skippedRows.has(r.sheetRow)).reduce((s, r) => s + r.amount, 0);
        notImported.push(...res.notImported);
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "The import stopped part way. Check Accounting before trying again.");
    }
    setResult({ created, total: sum, notImported: notImported.sort((a, b) => Number(a.row) - Number(b.row)) });
    setProgress("");
    setStage("done");
  };

  const sendForHelp = async () => {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.set("kind", "I have a question");
    form.set("section", "Accounting");
    form.set("subject", `Please import my expenses: ${file.name}`.slice(0, 150));
    form.set("message", [helpText.trim() || "Smart expense import couldn't get this right. Please import it for me.", plan?.summary ? `\nWhat smart import thought: ${plan.summary}` : ""].join("\n"));
    form.set("page", "/accounting/import");
    form.append("files", file);
    const res = await fetch("/api/support", { method: "POST", body: form }).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't send it." }));
    setBusy(false);
    if (res.ok) setHelpSent(true); else setError(res.error || "Couldn't send it.");
  };

  // ── Screens ────────────────────────────────────────────────────────────────

  const templateCard = (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-800">Prefer to fill in a spreadsheet?</p>
        <a href="/templates/expense-import-template.csv" download className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Download size={13} /> Download the template</a>
      </div>
      <p className="mt-1 text-xs text-slate-500">Columns: Date, Supplier, Description, Category, Amount (including VAT), VAT, Notes. Use a category name from the list below (or leave it blank and Wyndos will suggest one).</p>
      <details className="mt-2 text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold text-blue-700">Categories and the HMRC box each goes in</summary>
        <table className="mt-2 w-full">
          <tbody className="divide-y divide-slate-100">
            {IMPORT_CATEGORIES.map((c) => <tr key={c.value}><td className="py-1 pr-3 font-medium text-slate-800">{c.label}</td><td className="py-1 text-slate-500">{c.hmrcLabel}</td></tr>)}
          </tbody>
        </table>
      </details>
    </div>
  );

  if (stage === "upload" || stage === "reading") {
    return (
      <div className="space-y-3">
        <label className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-12 text-center hover:border-blue-400 hover:bg-blue-50/40", stage === "reading" && "pointer-events-none opacity-70")}>
          {stage === "reading" ? <Loader2 size={28} className="animate-spin text-blue-600" /> : <Upload size={28} className="text-blue-600" />}
          <span className="text-base font-semibold text-slate-800">{stage === "reading" ? "Reading your file…" : "Choose your expenses file"}</span>
          <span className="text-sm text-slate-500">{stage === "reading" ? "Working out the columns and sorting suppliers into categories." : "Bank or card statement export, receipts spreadsheet, or the Wyndos template. Excel or CSV."}</span>
          <input type="file" className="hidden" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {templateCard}
        <p className="text-xs text-slate-400">To work out the layout, the headings, a few sample rows and the supplier names are read by AI (long numbers and emails partly hidden). The whole file is never sent.</p>
      </div>
    );
  }

  if (stage === "done" && result) {
    return (
      <div className="space-y-3 rounded-2xl border border-green-200 bg-white p-5">
        <p className="flex items-center gap-2 text-base font-semibold text-green-700"><CheckCircle2 size={18} /> {result.created} expense{result.created === 1 ? "" : "s"} added ({fmtCurrency(result.total)})</p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <NotImportedList rows={result.notImported} title="Not imported" fileName="expenses-not-imported.csv" />
        <div className="flex flex-wrap gap-2">
          <Link href="/accounting" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">See accounting</Link>
          <button type="button" onClick={reset} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Import another file</button>
        </div>
      </div>
    );
  }

  if (!plan) return null;
  const headings = plan.headerRow >= 0 ? grid[plan.headerRow] ?? [] : [];
  const used = EXPENSE_FIELDS.filter((f) => plan.columns[f].length > 0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-blue-900"><Sparkles size={15} /> {source === "template" ? "Wyndos template" : plan.kind === "bank_statement" ? "Bank statement" : "Expenses"} <span className="font-normal text-blue-700">{file?.name}</span></p>
        {plan.summary && <p className="mt-1 text-sm text-blue-900">{plan.summary}</p>}
        {offTopic && <p className="mt-2 rounded-lg bg-white px-3 py-2 text-xs text-amber-800">That box is only for fixing how your file is read or how suppliers are categorised, so nothing changed.</p>}
        {plan.warnings.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-amber-800">{plan.warnings.map((w, i) => <li key={i} className="flex gap-1"><AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />{w}</li>)}</ul>}
        {used.length > 0 && headings.length > 0 && <p className="mt-2 text-[11px] text-blue-800">{used.map((f) => `${FIELD_LABELS[f]} ← ${plan.columns[f].map((c) => headings[c]?.trim() || `column ${c + 1}`).join(" + ")}`).join(" · ")}</p>}
      </div>

      {plan.kind === "not_expenses" ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">This doesn&apos;t look like expenses or a bank statement. If it is, say what&apos;s in it with &quot;Not quite, try again&quot;.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Expenses" value={String(toImport.length)} sub={dates.length ? `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}` : undefined} />
            <Stat label="Total" value={fmtCurrency(total)} sub={vat ? `incl. ${fmtCurrency(vat)} VAT` : undefined} />
            <Stat label="Category to check" value={String(unsure)} sub="put in Other" warn={unsure > 0} />
            <Stat label="Won't import" value={String(skipped.length)} sub="money in, transfers…" />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white">
            <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">By HMRC category (Making Tax Digital)</p>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {byHmrc.map((h) => <tr key={h.key}><td className="px-3 py-1.5 text-slate-700">{h.label}</td><td className="px-3 py-1.5 text-right text-xs text-slate-400">{h.count}</td><td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmtCurrency(h.total)}</td></tr>)}
              </tbody>
            </table>
          </div>

          {personal.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Left out: looks like transfers, tax or personal</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {personal.map((p) => (
                  <button key={p.key} type="button" onClick={() => setPutBack((s) => { const n = new Set(s); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n; })}
                    className={cn("rounded-full border px-2.5 py-1 text-xs", putBack.has(p.key) ? "border-green-300 bg-green-50 text-green-800" : "border-slate-200 bg-slate-50 text-slate-600")}>
                    {p.supplier.slice(0, 30)} · {p.count} · {fmtCurrency(p.total)} {putBack.has(p.key) ? "✓ included" : "+ include"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Showing {shown.length} of {toImport.length}. Change a category and every expense from that supplier follows.</p>
              <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
                <option value="">All categories</option>
                {unsure > 0 && <option value="UNSURE">Not sure ({unsure})</option>}
                {IMPORT_CATEGORIES.filter((c) => toImport.some((r) => r.category === c.value)).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-500">{["Row", "Date", "Supplier", "Amount", "VAT", "Category", ""].map((h) => <th key={h} className="px-2.5 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((r) => (
                    <tr key={r.sheetRow} className={cn(r.categorySource === "default" && "bg-amber-50/60")}>
                      <td className="px-2.5 py-1.5 text-slate-400">{r.sheetRow}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">{fmtDate(r.date)}</td>
                      <td className="max-w-[260px] truncate px-2.5 py-1.5 font-medium text-slate-800" title={r.notes || r.supplier}>{r.supplier}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtCurrency(r.amount)}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-500">{r.vat ? fmtCurrency(r.vat) : ""}</td>
                      <td className="px-2.5 py-1.5">
                        <select value={r.category} onChange={(e) => setOverrides((o) => ({ ...o, [r.key]: e.target.value }))} className="w-full min-w-[170px] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs">
                          {IMPORT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-[11px] text-slate-400">{SOURCE[r.categorySource]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <NotImportedList rows={notImportedPreview} title="Won't be imported" fileName="expenses-not-imported.csv" />
        </>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!feedbackOpen && !helpOpen && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">Does this look right?</p>
          <div className="flex flex-wrap gap-2">
            {toImport.length > 0 && (
              <button type="button" disabled={stage === "importing"} onClick={doImport} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {stage === "importing" ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {stage === "importing" ? progress || "Saving…" : `Yes, add ${toImport.length} expenses (${fmtCurrency(total)})`}
              </button>
            )}
            {available && source === "ai" && (
              <button type="button" disabled={stage === "importing" || attempt >= 4} onClick={() => setFeedbackOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RotateCcw size={15} /> Not quite, try again</button>
            )}
            <button type="button" disabled={stage === "importing"} onClick={() => setHelpOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><LifeBuoy size={15} /> Ask Wyndos to import it for me</button>
            <button type="button" onClick={reset} className="px-2 text-sm text-slate-500 hover:text-slate-800">Start again</button>
          </div>
          <p className="text-xs text-slate-400">Expenses already in Wyndos (same date, supplier and amount) are skipped, so it&apos;s safe to import overlapping statements.</p>
        </div>
      )}

      {feedbackOpen && (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">What&apos;s wrong with the preview?</p>
          <p className="text-xs text-slate-500">e.g. &quot;spending is the positive numbers&quot;, &quot;column F is VAT&quot;, &quot;Halfords is equipment, not van repairs&quot;, &quot;skip the first 4 rows&quot;.</p>
          <textarea value={feedback} onChange={(e) => setFeedback(e.target.value.slice(0, 500))} rows={3} maxLength={500} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy || feedback.trim().length < 3} onClick={retry} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {busy ? "Reading again…" : "Try again"}</button>
            <button type="button" onClick={() => setFeedbackOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
            <span className="ml-auto text-[11px] text-slate-400">{feedback.length}/500 · {Math.max(0, 4 - attempt)} tries left</span>
          </div>
        </div>
      )}

      {helpOpen && (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          {helpSent ? <p className="flex items-center gap-2 text-sm text-green-700"><CheckCircle2 size={16} /> Sent. We&apos;ll import it for you and email you when it&apos;s done.</p> : (
            <>
              <p className="text-sm font-semibold text-slate-800">We&apos;ll import it for you</p>
              <textarea value={helpText} onChange={(e) => setHelpText(e.target.value.slice(0, 2000))} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Anything we should know (optional)" />
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={sendForHelp} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><LifeBuoy size={15} /> Send to Wyndos</button>
                <button type="button" onClick={() => setHelpOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, warn = false }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-white px-3 py-2", warn ? "border-amber-200" : "border-slate-200")}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("text-lg font-bold tabular-nums", warn ? "text-amber-700" : "text-slate-800")}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}
