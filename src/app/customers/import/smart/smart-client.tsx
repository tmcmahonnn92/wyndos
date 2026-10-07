"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, LifeBuoy, Loader2, RotateCcw, Sparkles, Upload } from "lucide-react";
import { unzipSync, strFromU8, gunzipSync } from "fflate";
import { parseCSVText } from "@/lib/import-parsing";
import { applyPlan, looksLikeCleanerPlanner, wyndosExportPlan, PLAN_FIELDS, type ImportPlan, type PlanField, type SmartRow } from "@/lib/smart-import/plan";
import { aiImportPlan, type PlanRequest } from "@/lib/smart-import/actions";
import { bulkImportCustomers } from "@/lib/actions";
import { cn, fmtCurrency } from "@/lib/utils";

type AreaOption = { id: number; name: string; frequencyWeeks: number };
type Stage = "upload" | "reading" | "preview" | "importing" | "done" | "elsewhere";

const COLOURS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316", "#06B6D4", "#84CC16", "#A855F7", "#6366F1"];
const MAX_ROWS = 5000;
const FIELD_LABELS: Record<PlanField, string> = {
  name: "Name", fullAddress: "Address", houseNumber: "House", street: "Street", town: "Town", postcode: "Postcode",
  phone: "Phone", email: "Email", price: "Price", frequency: "How often", lastCleaned: "Last cleaned", nextDue: "Next due",
  notes: "Notes", payment: "Usually pays", area: "Area", status: "Active?", jobName: "Job",
};

/** Every cell as text, first sheet with data (xlsx/xls/ods/csv). */
async function readGrid(name: string, data: ArrayBuffer): Promise<string[][]> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    let text = new TextDecoder().decode(data);
    if (lower.endsWith(".tsv") || (!text.includes(",") && text.includes("\t"))) text = text.split("\n").map((l) => l.split("\t").map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    return parseCSVText(text);
  }
  const XLSX = await import("xlsx");
  const book = XLSX.read(data, { type: "array", cellDates: true });
  let best: string[][] = [];
  for (const sheetName of book.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheetName], { header: 1, raw: false, defval: "", dateNF: "dd/mm/yyyy" })
      .map((row) => row.map((c) => String(c ?? "")));
    if (grid.filter((r) => r.some((c) => c.trim())).length > best.filter((r) => r.some((c) => c.trim())).length) best = grid;
  }
  return best;
}

/** What goes to the AI: the top of the file, a few rows further down, and short value lists. */
function sampleFor(fileName: string, grid: string[][]): Omit<PlanRequest, "feedback" | "previousPlan" | "attempt"> {
  const columnCount = Math.min(60, Math.max(1, ...grid.slice(0, 200).map((r) => r.length)));
  const top = grid.slice(0, 12).map((cells, index) => ({ index, cells }));
  const later = [Math.floor(grid.length * 0.4), Math.floor(grid.length * 0.7), grid.length - 2, grid.length - 1]
    .filter((i, k, all) => i >= 12 && i < grid.length && all.indexOf(i) === k)
    .map((index) => ({ index, cells: grid[index] }));
  const shortValues: PlanRequest["shortValues"] = [];
  for (let c = 0; c < columnCount; c++) {
    const seen = new Set<string>();
    for (const row of grid.slice(0, 2000)) {
      const v = String(row[c] ?? "").trim();
      if (v) seen.add(v.slice(0, 30));
      if (seen.size > 40) break;
    }
    if (seen.size > 0 && seen.size <= 40) shortValues.push({ column: c, values: [...seen] });
  }
  return { fileName, rows: [...top, ...later], columnCount, rowCount: grid.length, shortValues };
}

export function SmartImport({ available, areas }: { available: boolean; areas: AreaOption[] }) {
  const [stage, setStage] = useState<Stage>("upload");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [grid, setGrid] = useState<string[][]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [source, setSource] = useState<"wyndos" | "ai">("ai");
  const [attempt, setAttempt] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [offTopic, setOffTopic] = useState(false);
  const [elsewhere, setElsewhere] = useState<{ title: string; text: string; href?: string; link?: string } | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [bookRuns, setBookRuns] = useState(true);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: number; areas: string[] } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpText, setHelpText] = useState("");
  const [helpSent, setHelpSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows: SmartRow[] = useMemo(() => (plan && plan.kind === "customers" ? applyPlan(grid, plan) : []), [grid, plan]);
  const headings = plan && plan.headerRow >= 0 ? grid[plan.headerRow] ?? [] : [];
  const areaSummary = useMemo(() => {
    const map = new Map<string, { name: string; count: number; value: number; existing: AreaOption | undefined }>();
    for (const r of rows) {
      const key = r.area.toLowerCase();
      const e = map.get(key) ?? { name: r.area, count: 0, value: 0, existing: areas.find((a) => a.name.toLowerCase() === key) };
      e.count++;
      e.value += r.price ?? 0;
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [rows, areas]);
  const withProblems = rows.filter((r) => r.problems.length > 0);
  const inactive = rows.filter((r) => !r.active).length;
  const shown = (problemsOnly ? withProblems : rows).slice(0, 60);

  const reset = () => {
    setStage("upload"); setError(null); setFile(null); setGrid([]); setPlan(null); setAttempt(0);
    setFeedbackOpen(false); setFeedback(""); setOffTopic(false); setElsewhere(null); setResult(null);
    setHelpOpen(false); setHelpText(""); setHelpSent(false);
  };

  const askAi = async (g: string[][], f: File, previous: ImportPlan | null, said: string, n: number) => {
    setBusy(true);
    setError(null);
    const res = await aiImportPlan({ ...sampleFor(f.name, g), feedback: said || undefined, previousPlan: previous ?? undefined, attempt: n })
      .catch(() => ({ ok: false as const, error: "Couldn't reach Wyndos. Check your connection and try again." }));
    setBusy(false);
    if (!res.ok) { setError(res.error); if (!previous) setStage("upload"); return; }
    setOffTopic(res.plan.feedbackOffTopic);
    setPlan(res.plan);
    setSource("ai");
    setAttempt(n);
    setFeedbackOpen(false);
    setFeedback("");
    setStage("preview");
  };

  const onFile = async (f: File) => {
    reset();
    setFile(f);
    setStage("reading");
    try {
      const lower = f.name.toLowerCase();
      const data = await f.arrayBuffer();
      if (f.size > 15 * 1024 * 1024) throw new Error("That file is very big. Ask us to import it for you.");
      let name = f.name;
      let content: ArrayBuffer = data;
      if (lower.endsWith(".zip")) {
        const entries = unzipSync(new Uint8Array(data));
        const names = Object.keys(entries);
        if (looksLikeCleanerPlanner(names)) {
          setElsewhere({ title: "This is a CleanerPlanner backup", text: "CleanerPlanner backups have their own importer, which brings across rounds, due dates and balances too.", href: "/customers/import/cleanerplanner", link: "Use the CleanerPlanner import" });
          setStage("elsewhere");
          return;
        }
        const sheet = names.find((n) => /\.(csv|xlsx|xls|ods|txt)$/i.test(n) && !n.startsWith("__MACOSX"));
        if (!sheet) throw new Error("There's no spreadsheet in that zip file.");
        name = sheet;
        content = entries[sheet].slice().buffer;
      } else if (lower.endsWith(".gz") || lower.endsWith(".json")) {
        const text = lower.endsWith(".gz") ? strFromU8(gunzipSync(new Uint8Array(data))) : new TextDecoder().decode(data);
        if (text.includes('"wyndos-backup"')) {
          setElsewhere({ title: "This is a Wyndos backup", text: "Backups are put back from Settings → Data, which restores everything exactly as it was.", href: "/settings", link: "Go to Settings" });
          setStage("elsewhere");
          return;
        }
        throw new Error("That file type can't be read here. Use a spreadsheet (.xlsx, .xls, .csv), or ask us to import it.");
      }
      const g = (await readGrid(name, content)).slice(0, MAX_ROWS + 50);
      if (g.filter((r) => r.some((c) => String(c).trim())).length < 2) throw new Error("That file looks empty.");
      setGrid(g);
      // Our own export: read it exactly, no AI needed.
      const own = wyndosExportPlan(g[0] ?? []);
      if (own) { setPlan(own); setSource("wyndos"); setStage("preview"); return; }
      if (!available) throw new Error("Smart import isn't available right now. Use the normal import, or ask us to import it for you.");
      await askAi(g, f, null, "", 1);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "That file couldn't be read.");
      setStage("upload");
    }
  };

  const doImport = async () => {
    if (!plan) return;
    setStage("importing");
    setError(null);
    const freqOf = new Map<string, number>();
    for (const a of areaSummary) {
      const counts = new Map<number, number>();
      for (const r of rows) if (r.area.toLowerCase() === a.name.toLowerCase() && r.frequencyWeeks) counts.set(r.frequencyWeeks, (counts.get(r.frequencyWeeks) ?? 0) + 1);
      freqOf.set(a.name.toLowerCase(), [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? plan.defaultFrequencyWeeks);
    }
    let created = 0, skipped = 0, errors = 0;
    const areasMade = new Set<string>();
    try {
      for (let i = 0; i < rows.length; i += 400) {
        const chunk = rows.slice(i, i + 400);
        const res = await bulkImportCustomers(chunk.map((r) => {
          const existing = areas.find((a) => a.name.toLowerCase() === r.area.toLowerCase());
          const newIndex = areaSummary.findIndex((a) => a.name.toLowerCase() === r.area.toLowerCase());
          return {
            name: r.name,
            address: r.address,
            houseNameNumber: r.houseNameNumber || undefined,
            street: r.street || undefined,
            town: r.town || undefined,
            postcode: r.postcode || undefined,
            price: r.price ?? 0,
            areaId: existing?.id,
            areaName: existing ? undefined : r.area,
            areaColor: existing ? undefined : COLOURS[(areas.length + newIndex) % COLOURS.length],
            areaFrequencyWeeks: existing ? undefined : freqOf.get(r.area.toLowerCase()),
            email: r.email || undefined,
            phone: r.phone || undefined,
            notes: r.notes || undefined,
            jobName: r.jobName || undefined,
            preferredPaymentMethod: r.preferredPaymentMethod || undefined,
            nextDueDate: r.nextDueDate || undefined,
            lastCompletedDate: r.lastCompletedDate || undefined,
            frequencyWeeks: r.frequencyWeeks ?? undefined,
            active: r.active,
          };
        }), { createMissingAreas: true, existingMode: "skip", matchField: "nameAddress", bookRuns: bookRuns && i + 400 >= rows.length });
        created += res.created;
        skipped += res.skipped;
        errors += res.errors.length;
        res.areasCreated.forEach((a) => areasMade.add(a));
      }
      setResult({ created, skipped, errors, areas: [...areasMade] });
      setStage("done");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "The import stopped part way. Check Customers before trying again.");
      setResult({ created, skipped, errors, areas: [...areasMade] });
      setStage("done");
    }
  };

  const sendForHelp = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("kind", "I have a question");
    form.set("section", "Importing customers");
    form.set("subject", `Please import my customers: ${file.name}`.slice(0, 150));
    form.set("message", [
      helpText.trim() || "Smart import couldn't get this file right. Please import it for me.",
      plan?.summary ? `\nWhat smart import thought: ${plan.summary}` : "",
      `\nRows in file: ${grid.length}`,
    ].join("\n"));
    form.set("page", "/customers/import/smart");
    form.append("files", file);
    const res = await fetch("/api/support", { method: "POST", body: form }).then((r) => r.json()).catch(() => ({ ok: false, error: "Couldn't send it. Check your connection." }));
    setBusy(false);
    if (res.ok) setHelpSent(true);
    else setError(res.error || "Couldn't send it.");
  };

  // ── Screens ────────────────────────────────────────────────────────────────

  if (stage === "upload" || stage === "reading") {
    return (
      <div className="space-y-3">
        {!available && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Smart import isn&apos;t switched on for this server yet. Wyndos exports still work here; for anything else use the{" "}
            <Link href="/customers/import" className="font-semibold underline">normal import</Link>.
          </p>
        )}
        <label className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-12 text-center hover:border-blue-400 hover:bg-blue-50/40", stage === "reading" && "pointer-events-none opacity-70")}>
          {stage === "reading" ? <Loader2 size={28} className="animate-spin text-blue-600" /> : <Upload size={28} className="text-blue-600" />}
          <span className="text-base font-semibold text-slate-800">{stage === "reading" ? "Reading your file…" : "Choose your customer file"}</span>
          <span className="text-sm text-slate-500">
            {stage === "reading" ? "Working out which columns are which. This takes a few seconds." : "Excel, CSV, a Wyndos export, or a CleanerPlanner backup (.zip). Any layout."}
          </span>
          <input type="file" className="hidden" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods,.zip,.json,.gz"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <p className="text-xs text-slate-400">
          To work out the layout, the headings and a few sample rows are read by AI (emails and phone numbers partly hidden).
          The whole file is never sent.
        </p>
      </div>
    );
  }

  if (stage === "elsewhere" && elsewhere) {
    return (
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-base font-semibold text-slate-800">{elsewhere.title}</p>
        <p className="text-sm text-slate-600">{elsewhere.text}</p>
        <div className="flex gap-2">
          {elsewhere.href && <Link href={elsewhere.href} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">{elsewhere.link}</Link>}
          <button type="button" onClick={reset} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Choose another file</button>
        </div>
      </div>
    );
  }

  if (stage === "done" && result) {
    return (
      <div className="space-y-3 rounded-2xl border border-green-200 bg-white p-5">
        <p className="flex items-center gap-2 text-base font-semibold text-green-700"><CheckCircle2 size={18} /> {result.created} customer{result.created === 1 ? "" : "s"} added</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          {result.areas.length > 0 && <li>New areas: {result.areas.join(", ")}</li>}
          {result.skipped > 0 && <li>{result.skipped} already in Wyndos, left as they were</li>}
          {result.errors > 0 && <li>{result.errors} couldn&apos;t be added</li>}
        </ul>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Link href="/customers" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">See customers</Link>
          <Link href="/scheduler" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Plan the round</Link>
        </div>
      </div>
    );
  }

  if (!plan) return null;
  const notCustomers = plan.kind !== "customers";
  const used = PLAN_FIELDS.filter((f) => plan.columns[f].length > 0);

  return (
    <div className="space-y-4">
      {/* What we understood */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-blue-900">
          <Sparkles size={15} /> {source === "wyndos" ? "Wyndos export" : "Here's how we read"} <span className="font-normal text-blue-700">{file?.name}</span>
        </p>
        {plan.summary && <p className="mt-1 text-sm text-blue-900">{plan.summary}</p>}
        {offTopic && (
          <p className="mt-2 rounded-lg bg-white px-3 py-2 text-xs text-amber-800">
            That box is only for fixing how your file is read (which column is which, how to read dates or prices), so nothing changed.
          </p>
        )}
        {plan.warnings.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-amber-800">
            {plan.warnings.map((w, i) => <li key={i} className="flex gap-1"><AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />{w}</li>)}
          </ul>
        )}
        {used.length > 0 && headings.length > 0 && (
          <p className="mt-2 text-[11px] text-blue-800">
            {used.map((f) => `${FIELD_LABELS[f]} ← ${plan.columns[f].map((c) => headings[c]?.trim() || `column ${c + 1}`).join(" + ")}`).join(" · ")}
          </p>
        )}
      </div>

      {notCustomers ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {plan.kind === "job_history"
            ? <>This looks like a history of cleans or payments, not a customer list. Add your customers first, then bring history in with <Link href="/customers/import" className="font-semibold underline">Job history</Link> in the normal import.</>
            : "This doesn't look like a list of customers. If it is, tell us below what's in it."}
        </div>
      ) : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Customers" value={String(rows.length)} />
            <Stat label="Areas" value={String(areaSummary.length)} sub={`${areaSummary.filter((a) => !a.existing).length} new`} />
            <Stat label="Round value" value={fmtCurrency(rows.reduce((s, r) => s + (r.price ?? 0), 0))} />
            <Stat label="To check" value={String(withProblems.length)} sub={inactive ? `${inactive} inactive` : undefined} warn={withProblems.length > 0} />
          </div>

          {/* Areas */}
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Areas</p>
            <div className="flex flex-wrap gap-1.5">
              {areaSummary.slice(0, 40).map((a) => (
                <span key={a.name} className={cn("rounded-full border px-2.5 py-1 text-xs", a.existing ? "border-slate-200 bg-slate-50 text-slate-700" : "border-blue-200 bg-blue-50 text-blue-800")}>
                  {a.name} <b>{a.count}</b>{a.existing ? "" : " · new"}
                </span>
              ))}
              {areaSummary.length > 40 && <span className="text-xs text-slate-500">+{areaSummary.length - 40} more</span>}
            </div>
          </div>

          {/* Rows */}
          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {problemsOnly ? `Rows to check (${withProblems.length})` : `First ${Math.min(60, rows.length)} of ${rows.length}`}
              </p>
              {withProblems.length > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} className="accent-blue-600" /> Only rows to check
                </label>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-500">
                    {["Row", "Name", "Address", "Area", "Price", "Every", "Next due", "Phone", "Pays", "Notes", ""].map((h) => <th key={h} className="px-2.5 py-2 font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((r) => (
                    <tr key={r.sheetRow} className={cn(r.problems.length ? "bg-amber-50/60" : "", !r.active && "text-slate-400")}>
                      <td className="px-2.5 py-1.5 text-slate-400">{r.sheetRow}</td>
                      <td className="max-w-[180px] truncate px-2.5 py-1.5 font-medium text-slate-800">{r.name}</td>
                      <td className="max-w-[280px] truncate px-2.5 py-1.5">{r.address}</td>
                      <td className="px-2.5 py-1.5">{r.area}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{r.price === null ? "—" : fmtCurrency(r.price)}</td>
                      <td className="px-2.5 py-1.5">{r.frequencyWeeks ? `${r.frequencyWeeks}w` : "—"}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">{r.nextDueDate ? new Date(`${r.nextDueDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "—"}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">{r.phone || "—"}</td>
                      <td className="px-2.5 py-1.5">{r.preferredPaymentMethod || "—"}</td>
                      <td className="max-w-[200px] truncate px-2.5 py-1.5 text-slate-500">{r.notes.replace(/\n/g, " · ")}</td>
                      <td className="px-2.5 py-1.5 text-amber-700">{[...r.problems, r.active ? "" : "Inactive"].filter(Boolean).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Decide */}
      {!feedbackOpen && !helpOpen && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">Does this look right?</p>
          {!notCustomers && rows.some((r) => r.nextDueDate) && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={bookRuns} onChange={(e) => setBookRuns(e.target.checked)} className="accent-blue-600" />
              Put each area&apos;s next run on the schedule from the due dates
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {!notCustomers && (
              <button type="button" disabled={stage === "importing" || rows.length === 0} onClick={doImport}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {stage === "importing" ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {stage === "importing" ? "Adding customers…" : `Yes, add ${rows.length} customers`}
              </button>
            )}
            {available && (
              <button type="button" disabled={stage === "importing" || attempt >= 4} onClick={() => setFeedbackOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <RotateCcw size={15} /> Not quite, try again
              </button>
            )}
            <button type="button" disabled={stage === "importing"} onClick={() => setHelpOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <LifeBuoy size={15} /> Ask Wyndos to import it for me
            </button>
            <button type="button" onClick={reset} className="px-2 text-sm text-slate-500 hover:text-slate-800">Start again</button>
          </div>
          <p className="text-xs text-slate-400">Customers already in Wyndos (same name and address) are left as they are.</p>
        </div>
      )}

      {feedbackOpen && file && (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">What&apos;s wrong with the preview?</p>
          <p className="text-xs text-slate-500">
            Say what to change about how your file is read, e.g. &quot;the Round column is the area&quot;, &quot;prices are in column G&quot;,
            &quot;frequency is in months&quot;, &quot;skip the first 3 rows&quot;.
          </p>
          <textarea value={feedback} onChange={(e) => setFeedback(e.target.value.slice(0, 500))} rows={3} maxLength={500}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="e.g. The 'Rnd' column is the area, and 'Freq' is in months" />
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy || feedback.trim().length < 3} onClick={() => askAi(grid, file, plan, feedback, attempt + 1)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {busy ? "Reading again…" : "Try again"}
            </button>
            <button type="button" onClick={() => setFeedbackOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
            <span className="ml-auto text-[11px] text-slate-400">{feedback.length}/500 · {Math.max(0, 4 - attempt)} tries left</span>
          </div>
        </div>
      )}

      {helpOpen && file && (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          {helpSent ? (
            <p className="flex items-center gap-2 text-sm text-green-700"><CheckCircle2 size={16} /> Sent. We&apos;ll import it for you and email you when it&apos;s done.</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-800">We&apos;ll import it for you</p>
              <p className="text-xs text-slate-500">Your file is sent to Wyndos support. Add anything we should know (optional).</p>
              <textarea value={helpText} onChange={(e) => setHelpText(e.target.value.slice(0, 2000))} rows={3}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="e.g. Column D is the round, anyone marked X has stopped" />
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={sendForHelp} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <LifeBuoy size={15} />} Send to Wyndos
                </button>
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
