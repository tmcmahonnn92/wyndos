"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, History, LifeBuoy, Loader2, RotateCcw, Sparkles, Upload, Users } from "lucide-react";
import { unzipSync, strFromU8, gunzipSync } from "fflate";
import { parseCSVText } from "@/lib/import-parsing";
import {
  applyHistoryPlan, applyPlan, looksLikeCleanerPlanner, matchHistory, wyndosExportPlan, PLAN_FIELDS,
  type DroppedRow, type HistoryRow, type ImportPlan, type MatchCandidate, type PlanField, type SmartRow,
} from "@/lib/smart-import/plan";
import { aiImportPlan, type PlanRequest } from "@/lib/smart-import/actions";
import { bookAreaRunsAfterImport, bulkImportCustomers, bulkImportJobHistory, getCustomersForMatching, importQuotes } from "@/lib/actions";
import { cn, fmtCurrency } from "@/lib/utils";
import { NotImportedList, type NotImportedRow } from "@/components/not-imported-list";

type AreaOption = { id: number; name: string; frequencyWeeks: number };
type ExistingCustomer = { id: number; name: string; address: string; postcode: string };
type Stage = "upload" | "reading" | "preview" | "importing" | "done" | "elsewhere";
/** One file, or one sheet of a workbook: read with its own plan. */
type Part = { id: number; label: string; grid: string[][]; plan: ImportPlan; source: "wyndos" | "ai"; attempt: number; offTopic: boolean };
type Result = { created: number; skipped: number; errors: number; areas: string[]; quotes: number; visits: number; visitsSkipped: number; unmatched: number; notImported: NotImportedRow[]; historyNotImported: NotImportedRow[] };

const COLOURS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316", "#06B6D4", "#84CC16", "#A855F7", "#6366F1"];
const MAX_ROWS = 20000;
const MAX_PARTS = 4;
const FIELD_LABELS: Record<PlanField, string> = {
  name: "Name", fullAddress: "Address", houseNumber: "House", street: "Street", town: "Town", postcode: "Postcode",
  phone: "Phone", email: "Email", price: "Price", frequency: "How often", lastCleaned: "Last cleaned", nextDue: "Next due",
  notes: "Notes", payment: "Pays", area: "Area", status: "Active?", jobName: "Job",
  customerRef: "Customer ref", visitDate: "Date", amountPaid: "Paid", paidStatus: "Paid?",
};
const nonEmpty = (g: string[][]) => g.filter((r) => r.some((c) => String(c).trim())).length;
const fmtDate = (iso: string) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "—");
/** Name + first line of the address: how a saved customer is found again (Wyndos may add the town/postcode). */
const custKey = (name: string, address: string) => [name, address.split(",")[0] ?? ""].map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "")).join("|");

/** Every sheet with data in a file, each as a grid of text. */
async function readSheets(name: string, data: ArrayBuffer): Promise<Array<{ label: string; grid: string[][] }>> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    let text = new TextDecoder().decode(data);
    if (lower.endsWith(".tsv") || (!text.includes(",") && text.includes("\t"))) text = text.split("\n").map((l) => l.split("\t").map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    return [{ label: name, grid: parseCSVText(text) }];
  }
  const XLSX = await import("xlsx");
  const book = XLSX.read(data, { type: "array", cellDates: true });
  return book.SheetNames.map((sheetName) => ({
    label: book.SheetNames.length > 1 ? `${name} · ${sheetName}` : name,
    grid: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheetName], { header: 1, raw: false, defval: "", dateNF: "dd/mm/yyyy" }).map((row) => row.map((c) => String(c ?? ""))),
  })).filter((s) => nonEmpty(s.grid) >= 2);
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

export function SmartImport({ available, areas, customers, mode = "all" }: { available: boolean; areas: AreaOption[]; customers: ExistingCustomer[]; mode?: "all" | "history" }) {
  const [stage, setStage] = useState<Stage>("upload");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackPart, setFeedbackPart] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [elsewhere, setElsewhere] = useState<{ title: string; text: string; href?: string; link?: string } | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
  const [bookRuns, setBookRuns] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpText, setHelpText] = useState("");
  const [helpSent, setHelpSent] = useState(false);
  const [busy, setBusy] = useState(false);

  // ── Customers ──
  const [rows, droppedCustomers] = useMemo(() => {
    const dropped: DroppedRow[] = [];
    const all: SmartRow[] = parts.flatMap((p) => (p.plan.kind === "customers" ? applyPlan(p.grid, p.plan, dropped) : []));
    return [all, dropped] as const;
  }, [parts]);
  const custRows = useMemo(() => rows.filter((r) => !r.quote), [rows]);
  const quoteRows = useMemo(() => rows.filter((r) => r.quote), [rows]);
  const areaSummary = useMemo(() => {
    const map = new Map<string, { name: string; count: number; value: number; existing: AreaOption | undefined }>();
    for (const r of custRows) {
      const key = r.area.toLowerCase();
      const e = map.get(key) ?? { name: r.area, count: 0, value: 0, existing: areas.find((a) => a.name.toLowerCase() === key) };
      e.count++;
      e.value += r.price ?? 0;
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [custRows, areas]);
  const withProblems = rows.filter((r) => r.problems.length > 0);
  const noAddress = rows.filter((r) => !r.address).length;
  const inactive = custRows.filter((r) => !r.active).length;
  const shown = (problemsOnly ? withProblems : rows).slice(0, 60);

  // ── Job history: matched against customers already in Wyndos and the ones in this upload ──
  const [visits, droppedVisits] = useMemo(() => {
    const dropped: DroppedRow[] = [];
    const all: HistoryRow[] = parts.flatMap((p) => (p.plan.kind === "job_history" ? applyHistoryPlan(p.grid, p.plan, dropped) : []));
    return [all, dropped] as const;
  }, [parts]);
  const visitMatch = useMemo(() => {
    if (visits.length === 0) return [] as Array<string | null>;
    // Someone in the upload who's already in Wyndos counts once (as the existing customer, with the upload's ref).
    const newByKey = new Map(rows.map((r, i) => [custKey(r.name, r.address), i]));
    const oldKeys = new Set(customers.map((c) => custKey(c.name, c.address)));
    const candidates: Array<MatchCandidate<string>> = [
      ...customers.map((c) => ({ key: `old:${c.id}`, name: c.name, address: c.address, postcode: c.postcode, ref: rows[newByKey.get(custKey(c.name, c.address)) ?? -1]?.ref })),
      ...rows.flatMap((r, i) => (oldKeys.has(custKey(r.name, r.address)) ? [] : [{ key: `new:${i}`, name: r.name, address: r.address, postcode: r.postcode, ref: r.ref }])),
    ];
    return matchHistory(visits, candidates);
  }, [visits, rows, customers]);
  const matchedName = (key: string | null) => {
    if (!key) return "";
    const [kind, id] = key.split(":");
    return kind === "old" ? customers.find((c) => c.id === Number(id))?.name ?? "" : `${rows[Number(id)]?.name ?? ""} (new)`;
  };
  const unmatched = visits.filter((_, i) => !visitMatch[i]);
  const usableVisits = visits.filter((v, i) => visitMatch[i] && v.date);
  // What won't be imported, shown in the preview so nothing goes missing silently.
  const existingKeys = useMemo(() => new Set(customers.map((c) => custKey(c.name, c.address))), [customers]);
  const willSkipCustomers: NotImportedRow[] = [
    ...droppedCustomers.map((d) => ({ row: d.sheetRow, name: d.name, reason: d.reason })),
    ...rows.filter((r) => existingKeys.has(custKey(r.name, r.address))).map((r) => ({ row: r.sheetRow, name: r.name, reason: "Already in Wyndos (same name and address), will be left as it is" })),
  ].sort((a, b) => Number(a.row) - Number(b.row));
  const willSkipVisits: NotImportedRow[] = [
    ...droppedVisits.map((d) => ({ row: d.sheetRow, name: d.name, reason: d.reason })),
    ...visits.flatMap((v, i) => (!visitMatch[i] ? [{ row: v.sheetRow, name: v.name || v.address || v.ref, reason: "No matching customer (by reference, address or name)" }] : !v.date ? [{ row: v.sheetRow, name: v.name || v.address, reason: "No date" }] : [])),
  ].sort((a, b) => Number(a.row) - Number(b.row));
  const visitDates = usableVisits.map((v) => v.date).sort();
  const visitIdx = visits.map((_, i) => i).filter((i) => !unmatchedOnly || !visitMatch[i]).slice(0, 60);

  const anyCustomers = rows.length > 0;
  const anyHistory = visits.length > 0;
  const nothingToImport = !anyCustomers && usableVisits.length === 0;
  const maxAttempt = Math.max(0, ...parts.map((p) => p.attempt));

  const reset = () => {
    setStage("upload"); setError(null); setFiles([]); setParts([]); setProgress("");
    setFeedbackOpen(false); setFeedback(""); setFeedbackPart(0); setElsewhere(null); setResult(null);
    setHelpOpen(false); setHelpText(""); setHelpSent(false); setProblemsOnly(false); setUnmatchedOnly(false);
  };

  const readWithAi = async (label: string, grid: string[][], previous?: ImportPlan, said?: string, n = 1) => {
    const res = await aiImportPlan({ ...sampleFor(label, grid), feedback: said || undefined, previousPlan: previous, attempt: n })
      .catch(() => ({ ok: false as const, error: "Couldn't reach Wyndos. Check your connection and try again." }));
    return res;
  };

  const onFiles = async (list: File[]) => {
    reset();
    const picked = list.slice(0, MAX_PARTS);
    setFiles(picked);
    setStage("reading");
    try {
      const sheets: Array<{ label: string; grid: string[][] }> = [];
      for (const f of picked) {
        const lower = f.name.toLowerCase();
        if (f.size > 15 * 1024 * 1024) throw new Error(`${f.name} is very big. Ask us to import it for you.`);
        const data = await f.arrayBuffer();
        if (lower.endsWith(".zip")) {
          const entries = unzipSync(new Uint8Array(data));
          const names = Object.keys(entries);
          if (looksLikeCleanerPlanner(names)) {
            setElsewhere({ title: "This is a CleanerPlanner backup", text: "CleanerPlanner backups have their own importer, which brings across rounds, due dates, history and balances.", href: "/customers/import/cleanerplanner", link: "Use the CleanerPlanner import" });
            setStage("elsewhere");
            return;
          }
          const inside = names.filter((n) => /\.(csv|xlsx|xls|ods|txt)$/i.test(n) && !n.startsWith("__MACOSX"));
          if (inside.length === 0) throw new Error(`There's no spreadsheet in ${f.name}.`);
          for (const n of inside) sheets.push(...await readSheets(n.split("/").pop() ?? n, entries[n].slice().buffer));
        } else if (lower.endsWith(".gz") || lower.endsWith(".json")) {
          const text = lower.endsWith(".gz") ? strFromU8(gunzipSync(new Uint8Array(data))) : new TextDecoder().decode(data);
          if (text.includes('"wyndos-backup"')) {
            setElsewhere({ title: "This is a Wyndos backup", text: "Backups are put back from Settings → Data, which restores everything exactly as it was.", href: "/settings", link: "Go to Settings" });
            setStage("elsewhere");
            return;
          }
          throw new Error(`${f.name} can't be read here. Use spreadsheets (.xlsx, .xls, .csv), or ask us to import it.`);
        } else {
          sheets.push(...await readSheets(f.name, data));
        }
      }
      const usable = sheets.filter((s) => nonEmpty(s.grid) >= 2).slice(0, MAX_PARTS);
      if (usable.length === 0) throw new Error("That file looks empty.");
      const made: Part[] = [];
      for (const [i, s] of usable.entries()) {
        const grid = s.grid.slice(0, MAX_ROWS + 50);
        // Our own export: read it exactly, no AI needed.
        const own = wyndosExportPlan(grid[0] ?? []);
        if (own) { made.push({ id: i, label: s.label, grid, plan: own, source: "wyndos", attempt: 0, offTopic: false }); continue; }
        if (!available) throw new Error("Smart import isn't available right now. Use the normal import, or ask us to import it for you.");
        setProgress(usable.length > 1 ? `Reading ${s.label} (${i + 1} of ${usable.length})…` : "");
        const res = await readWithAi(s.label, grid);
        if (!res.ok) throw new Error(res.error);
        made.push({ id: i, label: s.label, grid, plan: res.plan, source: "ai", attempt: 1, offTopic: false });
      }
      setParts(made);
      setStage("preview");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "That file couldn't be read.");
      setStage("upload");
    }
  };

  const retry = async () => {
    const part = parts[feedbackPart];
    if (!part) return;
    setBusy(true);
    setError(null);
    const res = await readWithAi(part.label, part.grid, part.plan, feedback, part.attempt + 1);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setParts((all) => all.map((p, i) => (i === feedbackPart ? { ...p, plan: res.plan, source: "ai", attempt: p.attempt + 1, offTopic: res.plan.feedbackOffTopic } : p)));
    setFeedbackOpen(false);
    setFeedback("");
  };

  const doImport = async () => {
    setStage("importing");
    setError(null);
    const r: Result = { created: 0, skipped: 0, errors: 0, areas: [], quotes: 0, visits: 0, visitsSkipped: 0, unmatched: unmatched.length, notImported: droppedCustomers.map((d) => ({ row: d.sheetRow, name: d.name, reason: d.reason })), historyNotImported: droppedVisits.map((d) => ({ row: d.sheetRow, name: d.name, reason: d.reason })) };
    const freqOf = new Map<string, number>();
    for (const a of areaSummary) {
      const counts = new Map<number, number>();
      for (const c of custRows) if (c.area.toLowerCase() === a.name.toLowerCase() && c.frequencyWeeks) counts.set(c.frequencyWeeks, (counts.get(c.frequencyWeeks) ?? 0) + 1);
      freqOf.set(a.name.toLowerCase(), [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 4);
    }
    const areasMade = new Set<string>();
    const datedAreas = new Set<number>();
    try {
      // 1. Customers
      for (let i = 0; i < custRows.length; i += 400) {
        setProgress(`Adding customers… ${Math.min(i + 400, custRows.length)} of ${custRows.length}`);
        const batch = custRows.slice(i, i + 400);
        const res = await bulkImportCustomers(batch.map((c) => {
          const existing = areas.find((a) => a.name.toLowerCase() === c.area.toLowerCase());
          const newIndex = areaSummary.findIndex((a) => a.name.toLowerCase() === c.area.toLowerCase());
          return {
            name: c.name, address: c.address,
            houseNameNumber: c.houseNameNumber || undefined, street: c.street || undefined, town: c.town || undefined, postcode: c.postcode || undefined,
            price: c.price ?? 0,
            areaId: existing?.id,
            areaName: existing ? undefined : c.area,
            areaColor: existing ? undefined : COLOURS[(areas.length + newIndex) % COLOURS.length],
            areaFrequencyWeeks: existing ? undefined : freqOf.get(c.area.toLowerCase()),
            email: c.email || undefined, phone: c.phone || undefined, notes: c.notes || undefined, jobName: c.jobName || undefined,
            preferredPaymentMethod: c.preferredPaymentMethod || undefined,
            nextDueDate: c.nextDueDate || undefined, lastCompletedDate: c.lastCompletedDate || undefined,
            frequencyWeeks: c.frequencyWeeks ?? undefined,
            active: c.active,
          };
        }), { createMissingAreas: true, existingMode: "skip", matchField: "nameAddress", bookRuns: false });
        r.created += res.created;
        r.skipped += res.skipped;
        r.errors += res.errors.length;
        for (const e of res.errors) r.notImported.push({ row: batch[e.row - 1]?.sheetRow, name: batch[e.row - 1]?.name, reason: e.message });
        for (const e of res.skippedRows) r.notImported.push({ row: batch[e.row - 1]?.sheetRow, name: batch[e.row - 1]?.name, reason: e.reason });
        res.areasCreated.forEach((a) => areasMade.add(a));
        res.datedAreaIds.forEach((id) => datedAreas.add(id));
      }
      // 2. Quotes
      for (let i = 0; i < quoteRows.length; i += 400) {
        const batch = quoteRows.slice(i, i + 400);
        const res = await importQuotes(batch.map((q) => ({
          name: q.name, address: q.address, houseNameNumber: q.houseNameNumber || undefined, street: q.street || undefined,
          town: q.town || undefined, postcode: q.postcode || undefined, phone: q.phone || undefined, email: q.email || undefined,
          notes: q.notes || undefined, price: q.price ?? 0, frequencyWeeks: q.frequencyWeeks ?? undefined,
          preferredPaymentMethod: q.preferredPaymentMethod || undefined,
        })));
        r.quotes += res.created;
        r.skipped += res.skipped;
        for (const e of res.skippedRows) r.notImported.push({ row: batch[e.row - 1]?.sheetRow, name: batch[e.row - 1]?.name, reason: `Quote: ${e.reason}` });
      }
      // 3. History, matched again against everyone now in Wyndos (refs come from this upload's customers).
      if (usableVisits.length > 0) {
        setProgress("Matching history to customers…");
        const fresh = await getCustomersForMatching();
        const refOf = new Map(rows.filter((c) => c.ref).map((c) => [custKey(c.name, c.address), c.ref]));
        const keys = matchHistory(visits, fresh.map((c) => ({ key: c.id, name: c.name, address: c.address, postcode: c.postcode, ref: refOf.get(custKey(c.name, c.address)) })));
        const toSave = visits.flatMap((v, i) => (keys[i] && v.date ? [{ v, customerId: keys[i]! }] : []));
        r.unmatched = visits.length - toSave.length;
        visits.forEach((v, i) => { if (!keys[i]) r.historyNotImported.push({ row: v.sheetRow, name: v.name || v.address || v.ref, reason: "No matching customer (by reference, address or name)" }); else if (!v.date) r.historyNotImported.push({ row: v.sheetRow, name: v.name || v.address, reason: "No date" }); });
        for (let i = 0; i < toSave.length; i += 400) {
          setProgress(`Adding history… ${Math.min(i + 400, toSave.length)} of ${toSave.length}`);
          const batch = toSave.slice(i, i + 400);
          const res = await bulkImportJobHistory(batch.map(({ v, customerId }) => ({
            customerName: v.name, customerId, date: v.date, price: v.price ?? undefined, paid: v.paid ?? undefined,
            paymentMethod: v.paymentMethod || undefined, notes: v.notes || undefined,
          })), { skipDuplicates: true });
          r.visits += res.created;
          r.visitsSkipped += res.skipped;
          r.errors += res.errors.length;
          for (const e of [...res.errors.map((x) => ({ row: x.row, reason: x.message })), ...res.skippedRows]) r.historyNotImported.push({ row: batch[e.row - 1]?.v.sheetRow, name: batch[e.row - 1]?.v.name, reason: e.reason });
        }
      }
      // 4. Book each round's next run once everything is in.
      if (bookRuns && datedAreas.size) {
        setProgress("Booking runs…");
        await bookAreaRunsAfterImport([...datedAreas]);
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "The import stopped part way. Check Customers before trying again.");
    }
    r.areas = [...areasMade];
    r.notImported.sort((a, b) => Number(a.row) - Number(b.row));
    r.historyNotImported.sort((a, b) => Number(a.row) - Number(b.row));
    setResult(r);
    setProgress("");
    setStage("done");
  };

  const sendForHelp = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("kind", "I have a question");
    form.set("section", "Importing customers");
    form.set("subject", `Please import my data: ${files.map((f) => f.name).join(", ")}`.slice(0, 150));
    form.set("message", [
      helpText.trim() || "Smart import couldn't get this right. Please import it for me.",
      ...parts.map((p) => `\n${p.label}: ${p.plan.kind}, ${p.grid.length} rows. ${p.plan.summary}`),
    ].join("\n"));
    form.set("page", "/customers/import/smart");
    for (const f of files) form.append("files", f);
    const res = await fetch("/api/support", { method: "POST", body: form }).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't send it. Check your connection." }));
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
          <span className="text-base font-semibold text-slate-800">{stage === "reading" ? "Reading your files…" : mode === "history" ? "Choose your job history file" : "Choose your files"}</span>
          <span className="text-sm text-slate-500">
            {stage === "reading"
              ? progress || "Working out which columns are which. This takes a few seconds."
              : mode === "history"
                ? "Past cleans and payments: Excel or CSV, any layout. Add your customer list too if they aren't in Wyndos yet."
                : "Customer list, job history, or both (pick several files at once). Excel, CSV, Wyndos exports, CleanerPlanner backups. Any layout."}
          </span>
          <input type="file" multiple className="hidden" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods,.zip,.json,.gz"
            onChange={(e) => { const list = Array.from(e.target.files ?? []); if (list.length) void onFiles(list); e.target.value = ""; }} />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <p className="text-xs text-slate-400">
          To work out the layout, the headings and a few sample rows of each file are read by AI (emails and phone numbers partly hidden).
          The whole file is never sent. History is matched to customers by reference, address or name.
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
        <p className="flex items-center gap-2 text-base font-semibold text-green-700"><CheckCircle2 size={18} /> Import finished</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          {(result.created > 0 || anyCustomers) && <li>{result.created} customer{result.created === 1 ? "" : "s"} added</li>}
          {result.quotes > 0 && <li>{result.quotes} quote{result.quotes === 1 ? "" : "s"} added, waiting for an answer (see Quotes)</li>}
          {result.areas.length > 0 && <li>New areas: {result.areas.join(", ")}</li>}
          {result.skipped > 0 && <li>{result.skipped} already in Wyndos, left as they were</li>}
          {(result.visits > 0 || anyHistory) && <li>{result.visits} past clean{result.visits === 1 ? "" : "s"} added to history</li>}
          {result.visitsSkipped > 0 && <li>{result.visitsSkipped} cleans were already in Wyndos, not added twice</li>}
          {result.unmatched > 0 && <li>{result.unmatched} history row{result.unmatched === 1 ? "" : "s"} didn&apos;t match a customer and were left out</li>}
          {result.errors > 0 && <li>{result.errors} row{result.errors === 1 ? "" : "s"} couldn&apos;t be added</li>}
        </ul>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <NotImportedList rows={result.notImported} title="Customers not imported" fileName="customers-not-imported.csv" />
        <NotImportedList rows={result.historyNotImported} title="History not imported" fileName="history-not-imported.csv" />
        <div className="flex flex-wrap gap-2">
          <Link href="/customers" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">See customers</Link>
          <Link href="/scheduler" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Plan the round</Link>
        </div>
      </div>
    );
  }

  if (parts.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* What we understood, per file */}
      {parts.map((part) => {
        const headings = part.plan.headerRow >= 0 ? part.grid[part.plan.headerRow] ?? [] : [];
        const used = PLAN_FIELDS.filter((f) => part.plan.columns[f].length > 0);
        const kindLabel = part.plan.kind === "customers" ? "Customer list" : part.plan.kind === "job_history" ? "Job history" : "Not customer data";
        return (
          <div key={part.id} className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-blue-900">
              <Sparkles size={15} /> {part.source === "wyndos" ? "Wyndos export" : kindLabel}
              <span className="font-normal text-blue-700">{part.label}</span>
            </p>
            {part.plan.summary && <p className="mt-1 text-sm text-blue-900">{part.plan.summary}</p>}
            {part.offTopic && (
              <p className="mt-2 rounded-lg bg-white px-3 py-2 text-xs text-amber-800">
                That box is only for fixing how your file is read (which column is which, how to read dates or prices), so nothing changed.
              </p>
            )}
            {part.plan.kind === "not_customers" && <p className="mt-2 text-xs text-amber-800">This doesn&apos;t look like customers or history, so it won&apos;t be imported. If it is, say what&apos;s in it with &quot;Not quite, try again&quot;.</p>}
            {part.plan.warnings.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-amber-800">
                {part.plan.warnings.map((w, i) => <li key={i} className="flex gap-1"><AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />{w}</li>)}
              </ul>
            )}
            {used.length > 0 && headings.length > 0 && (
              <p className="mt-2 text-[11px] text-blue-800">
                {used.map((f) => `${FIELD_LABELS[f]} ← ${part.plan.columns[f].map((c) => headings[c]?.trim() || `column ${c + 1}`).join(" + ")}`).join(" · ")}
              </p>
            )}
          </div>
        );
      })}

      {anyCustomers && (
        <>
          <p className="flex items-center gap-2 pt-1 text-sm font-semibold text-slate-700"><Users size={15} /> Customers</p>
          {noAddress > 0 && noAddress >= Math.max(3, rows.length * 0.1) && (
            <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span><b>{noAddress} of {rows.length} customers have no address.</b> That usually means the wrong column was used. Press &quot;Not quite, try again&quot; and say which column has the address.</span>
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Customers" value={String(custRows.length)} sub={quoteRows.length ? `+ ${quoteRows.length} quote${quoteRows.length === 1 ? "" : "s"}` : undefined} />
            <Stat label="Areas" value={String(areaSummary.length)} sub={`${areaSummary.filter((a) => !a.existing).length} new`} />
            <Stat label="Round value" value={fmtCurrency(custRows.filter((c) => c.active).reduce((s, c) => s + (c.price ?? 0), 0))} />
            <Stat label="To check" value={String(withProblems.length)} sub={inactive ? `${inactive} inactive` : undefined} warn={withProblems.length > 0} />
          </div>

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
                  {shown.map((c, i) => (
                    <tr key={`${c.sheetRow}-${i}`} className={cn(c.problems.length ? "bg-amber-50/60" : "", !c.active && "text-slate-400")}>
                      <td className="px-2.5 py-1.5 text-slate-400">{c.sheetRow}</td>
                      <td className="max-w-[180px] truncate px-2.5 py-1.5 font-medium text-slate-800">{c.name}</td>
                      <td className="max-w-[280px] truncate px-2.5 py-1.5">{c.address}</td>
                      <td className="px-2.5 py-1.5">{c.area}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{c.price === null ? "—" : fmtCurrency(c.price)}</td>
                      <td className="px-2.5 py-1.5">{c.frequencyWeeks ? `${c.frequencyWeeks}w` : "—"}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">{fmtDate(c.nextDueDate)}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">{c.phone || "—"}</td>
                      <td className="px-2.5 py-1.5">{c.preferredPaymentMethod || "—"}</td>
                      <td className="max-w-[200px] truncate px-2.5 py-1.5 text-slate-500">{c.notes.replace(/\n/g, " · ")}</td>
                      <td className="px-2.5 py-1.5 text-amber-700">{[...c.problems, c.quote ? "Quote" : c.active ? "" : "Inactive"].filter(Boolean).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {anyHistory && (
        <>
          <p className="flex items-center gap-2 pt-1 text-sm font-semibold text-slate-700"><History size={15} /> Job history</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Past cleans" value={String(usableVisits.length)} sub={visitDates.length ? `${fmtDate(visitDates[0])} – ${fmtDate(visitDates[visitDates.length - 1])}` : undefined} />
            <Stat label="Value" value={fmtCurrency(usableVisits.reduce((s, v) => s + (v.price ?? 0), 0))} />
            <Stat label="Paid" value={fmtCurrency(usableVisits.reduce((s, v) => s + (v.paid ?? 0), 0))} />
            <Stat label="Not matched" value={String(unmatched.length)} sub={unmatched.length ? "left out" : "all matched"} warn={unmatched.length > 0} />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {unmatchedOnly ? `Not matched (${unmatched.length})` : `First ${Math.min(60, visits.length)} of ${visits.length}`}
              </p>
              {unmatched.length > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={unmatchedOnly} onChange={(e) => setUnmatchedOnly(e.target.checked)} className="accent-blue-600" /> Only not matched
                </label>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-500">
                    {["Row", "Date", "In the file", "Matched to", "Price", "Paid", "How", "Notes"].map((h) => <th key={h} className="px-2.5 py-2 font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visitIdx.map((i) => {
                    const v = visits[i];
                    const m = visitMatch[i];
                    return (
                      <tr key={`${v.sheetRow}-${i}`} className={cn(!m || !v.date ? "bg-amber-50/60" : "")}>
                        <td className="px-2.5 py-1.5 text-slate-400">{v.sheetRow}</td>
                        <td className="whitespace-nowrap px-2.5 py-1.5">{v.date ? fmtDate(v.date) : <span className="text-amber-700">No date</span>}</td>
                        <td className="max-w-[260px] truncate px-2.5 py-1.5">{[v.ref && `#${v.ref}`, v.name, v.address].filter(Boolean).join(" · ")}</td>
                        <td className="max-w-[200px] truncate px-2.5 py-1.5 font-medium text-slate-800">{m ? matchedName(m) : <span className="font-normal text-amber-700">No match</span>}</td>
                        <td className="px-2.5 py-1.5 tabular-nums">{v.price === null ? "—" : fmtCurrency(v.price)}</td>
                        <td className="px-2.5 py-1.5 tabular-nums">{v.paid === null ? "—" : fmtCurrency(v.paid)}</td>
                        <td className="px-2.5 py-1.5">{v.paymentMethod || "—"}</td>
                        <td className="max-w-[180px] truncate px-2.5 py-1.5 text-slate-500">{v.notes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <NotImportedList rows={willSkipCustomers} title="Customers that won't be imported" fileName="customers-not-imported.csv" />
      <NotImportedList rows={willSkipVisits} title="History that won't be imported" fileName="history-not-imported.csv" />

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Decide */}
      {!feedbackOpen && !helpOpen && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">Does this look right?</p>
          {custRows.some((c) => c.nextDueDate) && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={bookRuns} onChange={(e) => setBookRuns(e.target.checked)} className="accent-blue-600" />
              Put each area&apos;s next run on the schedule from the due dates
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {!nothingToImport && (
              <button type="button" disabled={stage === "importing"} onClick={doImport}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {stage === "importing" ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {stage === "importing" ? progress || "Importing…" : `Yes, import ${[
                  custRows.length ? `${custRows.length} customers` : "",
                  quoteRows.length ? `${quoteRows.length} quote${quoteRows.length === 1 ? "" : "s"}` : "",
                  usableVisits.length ? `${usableVisits.length} past cleans` : "",
                ].filter(Boolean).join(" + ")}`}
              </button>
            )}
            {available && (
              <button type="button" disabled={stage === "importing" || parts.every((p) => p.attempt >= 4)} onClick={() => { setFeedbackPart(0); setFeedbackOpen(true); }}
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
          <p className="text-xs text-slate-400">
            Customers already in Wyndos (same name and address) are left as they are.
            {anyHistory && " Cleans already in Wyndos on the same date aren't added twice; history that doesn't match a customer is left out."}
          </p>
        </div>
      )}

      {feedbackOpen && (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">What&apos;s wrong with the preview?</p>
          {parts.length > 1 && (
            <select value={feedbackPart} onChange={(e) => setFeedbackPart(Number(e.target.value))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {parts.map((p, i) => <option key={p.id} value={i} disabled={p.attempt >= 4}>{p.label}</option>)}
            </select>
          )}
          <p className="text-xs text-slate-500">
            Say what to change about how the file is read, e.g. &quot;the Round column is the area&quot;, &quot;prices are in column G&quot;,
            &quot;this is job history, not customers&quot;, &quot;skip the first 3 rows&quot;.
          </p>
          <textarea value={feedback} onChange={(e) => setFeedback(e.target.value.slice(0, 500))} rows={3} maxLength={500}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="e.g. The 'Rnd' column is the area, and 'Freq' is in months" />
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy || feedback.trim().length < 3} onClick={retry}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {busy ? "Reading again…" : "Try again"}
            </button>
            <button type="button" onClick={() => setFeedbackOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
            <span className="ml-auto text-[11px] text-slate-400">{feedback.length}/500 · {Math.max(0, 4 - (parts[feedbackPart]?.attempt ?? maxAttempt))} tries left</span>
          </div>
        </div>
      )}

      {helpOpen && (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          {helpSent ? (
            <p className="flex items-center gap-2 text-sm text-green-700"><CheckCircle2 size={16} /> Sent. We&apos;ll import it for you and email you when it&apos;s done.</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-800">We&apos;ll import it for you</p>
              <p className="text-xs text-slate-500">Your file{files.length === 1 ? " is" : "s are"} sent to Wyndos support. Add anything we should know (optional).</p>
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
