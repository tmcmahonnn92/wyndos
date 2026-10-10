"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Columns3, History, LifeBuoy, Loader2, RotateCcw, Sparkles, Upload, Users } from "lucide-react";
import { ColumnMapper, type MapperField } from "@/components/column-mapper";
import { unzipSync, strFromU8, gunzipSync } from "fflate";
import { parseCSVText } from "@/lib/import-parsing";
import {
  applyHistoryPlan, applyPlan, describePlanChanges, looksLikeCleanerPlanner, matchHistory, wyndosExportPlan, PLAN_FIELDS,
  type DroppedRow, type HistoryRow, type ImportPlan, type MatchCandidate, type PlanField, type SmartRow,
} from "@/lib/smart-import/plan";
import { aiImportPlan, type PlanRequest } from "@/lib/smart-import/actions";
import { bookAreaRunsAfterImport, bulkImportCustomers, bulkImportJobHistory, createFormerCustomers, getCustomersForMatching, importQuotes, saveCustomerAliases } from "@/lib/actions";
import { cn, fmtCurrency } from "@/lib/utils";
import { NotImportedList, type NotImportedRow } from "@/components/not-imported-list";

type AreaOption = { id: number; name: string; frequencyWeeks: number };
type ExistingCustomer = { id: number; name: string; address: string; postcode: string; active?: boolean; aliases?: Array<{ kind: string; label: string }> };
/** The owner's changes to a customer row in the preview. */
type RowEdit = { name?: string; address?: string; area?: string; price?: number | null; frequencyWeeks?: number | null; nextDueDate?: string; phone?: string; email?: string; notes?: string; active?: boolean; skip?: boolean };
type VisitEdit = { date?: string; price?: number | null; paid?: number | null; skip?: boolean };
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Unmatched history rows that are clearly the same person go together, so they're sorted once. */
const visitGroup = (v: { ref: string; name: string; address: string }) => `${normKey(v.ref)}|${normKey(v.name)}|${normKey(v.address.split(",")[0] ?? "")}`;
type Stage = "upload" | "reading" | "preview" | "importing" | "done" | "elsewhere";
/** One file, or one sheet of a workbook: read with its own plan. */
type Part = { id: number; label: string; grid: string[][]; plan: ImportPlan; source: "wyndos" | "ai"; attempt: number; offTopic: boolean; /** After "try again": what changed (empty = nothing did). */ changes?: string[]; /** Several same-layout sheets read together: where each row came from. */ origins?: string[] };
type Sheet = { label: string; file: string; sheet: string; grid: string[][] };
type Result = { former?: number; created: number; skipped: number; errors: number; areas: string[]; quotes: number; visits: number; visitsSkipped: number; unmatched: number; notImported: NotImportedRow[]; historyNotImported: NotImportedRow[] };

const COLOURS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316", "#06B6D4", "#84CC16", "#A855F7", "#6366F1"];
const MAX_ROWS = 20000;
/** Files at once; worksheets in total; different layouts (each one is an AI call). */
const MAX_FILES = 10;
const MAX_SHEETS = 80;
const MAX_LAYOUTS = 6;
const FIELD_LABELS: Record<PlanField, string> = {
  name: "Name", fullAddress: "Address", houseNumber: "House", street: "Street", town: "Town", postcode: "Postcode",
  phone: "Phone", email: "Email", price: "Price", frequency: "How often", lastCleaned: "Last cleaned", nextDue: "Next due",
  notes: "Notes", payment: "Pays", area: "Area", status: "Active?", jobName: "Job",
  customerRef: "Customer ref", visitDate: "Date", amountPaid: "Paid", paidStatus: "Paid?",
};
/** Sort "not imported" rows by sheet then row number ("Round 2 row 9" before "Round 2 row 10"). */
const byRow = (a: NotImportedRow, b: NotImportedRow) => String(a.row ?? "").localeCompare(String(b.row ?? ""), undefined, { numeric: true });
const nonEmpty = (g: string[][]) => g.filter((r) => r.some((c) => String(c).trim())).length;
const fmtDate = (iso: string) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "—");
/** Name + first line of the address: how a saved customer is found again (Wyndos may add the town/postcode). */
const custKey = (name: string, address: string) => [name, address.split(",")[0] ?? ""].map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "")).join("|");

/** Every sheet with data in a file, each as a grid of text. */
async function readSheets(name: string, data: ArrayBuffer): Promise<Sheet[]> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    let text = new TextDecoder().decode(data);
    if (lower.endsWith(".tsv") || (!text.includes(",") && text.includes("\t"))) text = text.split("\n").map((l) => l.split("\t").map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    return [{ label: name, file: name, sheet: name, grid: parseCSVText(text) }];
  }
  const XLSX = await import("xlsx");
  const book = XLSX.read(data, { type: "array", cellDates: true });
  return book.SheetNames.map((sheetName) => ({
    label: book.SheetNames.length > 1 ? `${name} · ${sheetName}` : name,
    file: name,
    sheet: sheetName,
    grid: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheetName], { header: 1, raw: false, defval: "", dateNF: "dd/mm/yyyy" }).map((row) => row.map((c) => String(c ?? ""))),
  })).filter((s) => nonEmpty(s.grid) >= 2);
}

/**
 * Worksheets with the same headings (e.g. one per round) are read together: one AI call, one
 * preview. Their rows are joined under one heading row, with a "Sheet" column holding each
 * row's worksheet name (often the round), and each row remembers where it came from.
 */
function groupSheets(sheets: Sheet[]) {
  const firstRow = (g: string[][]) => g.findIndex((r) => r.some((c) => String(c).trim()));
  const signature = (g: string[][]) => (g[firstRow(g)] ?? []).map((c) => String(c).trim().toLowerCase()).filter(Boolean).join("|");
  const groups = new Map<string, Sheet[]>();
  for (const sh of sheets) groups.set(signature(sh.grid), [...(groups.get(signature(sh.grid)) ?? []), sh]);
  return [...groups.values()].map((list) => {
    const fromBook = sheets.filter((x) => x.file === list[0].file).length > 1;
    if (list.length === 1 && !fromBook) return { label: list[0].label, grid: list[0].grid, origins: undefined as string[] | undefined };
    const head = firstRow(list[0].grid);
    const width = Math.max(...list.map((sh) => Math.max(...sh.grid.map((r) => r.length))));
    const pad = (r: string[]) => [...r, ...Array(Math.max(0, width - r.length)).fill("")];
    const grid: string[][] = [[...pad(list[0].grid[head]), "Sheet"]];
    const origins: string[] = [""];
    for (const sh of list) {
      const h = firstRow(sh.grid);
      sh.grid.forEach((row, i) => {
        if (i <= h || !row.some((c) => String(c).trim())) return;
        grid.push([...pad(row), sh.sheet]);
        origins.push(`${sh.sheet} row ${i + 1}`);
      });
    }
    const names = list.map((sh) => sh.sheet);
    if (list.length === 1) return { label: `${list[0].file} · ${list[0].sheet}`, grid, origins };
    return { label: `${list[0].file} · ${list.length} sheets (${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""})`, grid, origins };
  });
}

/** Joined worksheets: if nothing else says which round a row is on, the sheet name is the area. */
function withSheetArea(plan: ImportPlan, grid: string[][]): ImportPlan {
  const head = grid[Math.max(0, plan.headerRow)] ?? [];
  const at = head.length - 1;
  if (plan.kind !== "customers" || plan.columns.area.length > 0 || plan.fixedValues?.area || String(head[at] ?? "") !== "Sheet") return plan;
  return { ...plan, columns: { ...plan.columns, area: [at] } };
}

/** The first rows as a plan reads them: sent with "try again" so the AI sees what the owner saw. */
function previewFor(grid: string[][], plan: ImportPlan): Array<Record<string, string>> {
  if (plan.kind === "job_history") {
    return applyHistoryPlan(grid, plan).slice(0, 8).map((v) => ({
      Date: v.date, Name: v.name, Address: v.address, Ref: v.ref, Price: v.price == null ? "" : String(v.price), Paid: v.paid == null ? "" : String(v.paid), Method: v.paymentMethod,
    }));
  }
  return applyPlan(grid, plan).slice(0, 8).map((c) => ({
    Name: c.name, Address: c.address, Area: c.area, Price: c.price == null ? "" : String(c.price), "Every weeks": c.frequencyWeeks == null ? `(default ${plan.defaultFrequencyWeeks})` : String(c.frequencyWeeks),
    "Next due": c.nextDueDate, "Last cleaned": c.lastCompletedDate, Phone: c.phone, Email: c.email, Pays: c.preferredPaymentMethod, Notes: c.notes.slice(0, 60), Status: c.quote ? "quote" : c.active ? "active" : "stopped",
  }));
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
  const [rowEdits, setRowEdits] = useState<Record<string, RowEdit>>({});
  const [visitEdits, setVisitEdits] = useState<Record<string, VisitEdit>>({});
  /** Unmatched history, per group: "skip", "former" (add as a former customer), "old:<id>" or "new:<rowKey>". */
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [rememberAliases, setRememberAliases] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [mapperOpen, setMapperOpen] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  // ── Customers ──
  const [rows, droppedCustomers] = useMemo(() => {
    const dropped: DroppedRow[] = [];
    const all: SmartRow[] = parts.flatMap((p) => {
      if (p.plan.kind !== "customers") return [];
      const mine: DroppedRow[] = [];
      const out = applyPlan(p.grid, p.plan, mine).flatMap((raw) => {
        const rowKey = `${p.id}:${raw.sheetRow}`;
        const where = p.origins?.[raw.sheetRow - 1];
        const e = rowEdits[rowKey];
        if (e?.skip) { dropped.push({ sheetRow: raw.sheetRow, where, name: raw.name, reason: "Left out by you" }); return []; }
        const r: SmartRow = { ...raw, rowKey, where, ...(e ?? {}) } as SmartRow;
        if (e) {
          // Re-check what the owner fixed.
          r.problems = raw.problems.filter((x) => !(x === "No price" && r.price !== null) && !(x === "No address" && r.address));
          if (e.active === false) r.quote = false;
        }
        return [r];
      });
      dropped.push(...mine.map((d) => ({ ...d, where: p.origins?.[d.sheetRow - 1] })));
      return out;
    });
    return [all, dropped] as const;
  }, [parts, rowEdits]);
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
  const q = search.trim().toLowerCase();
  const filtered = (problemsOnly ? withProblems : rows).filter((r) => !q || `${r.name} ${r.address} ${r.area}`.toLowerCase().includes(q));
  const shown = showAll ? filtered.slice(0, 3000) : filtered.slice(0, 60);
  const leftOut = Object.values(rowEdits).filter((e) => e.skip).length + Object.values(visitEdits).filter((e) => e.skip).length;
  const updatePlan = (id: number, patch: Partial<ImportPlan>) => setParts((all) => all.map((p) => (p.id === id ? { ...p, plan: { ...p.plan, ...patch } } : p)));

  // ── Job history: matched against customers already in Wyndos and the ones in this upload ──
  const [visits, droppedVisits] = useMemo(() => {
    const dropped: DroppedRow[] = [];
    const all: HistoryRow[] = parts.flatMap((p) => {
      if (p.plan.kind !== "job_history") return [];
      const mine: DroppedRow[] = [];
      const out = applyHistoryPlan(p.grid, p.plan, mine).flatMap((raw) => {
        const rowKey = `${p.id}:${raw.sheetRow}`;
        const where = p.origins?.[raw.sheetRow - 1];
        const e = visitEdits[rowKey];
        if (e?.skip) { dropped.push({ sheetRow: raw.sheetRow, where, name: raw.name || raw.address, reason: "Left out by you" }); return []; }
        return [{ ...raw, rowKey, where, ...(e ?? {}), problems: e?.date ? raw.problems.filter((x) => x !== "No date") : raw.problems } as HistoryRow];
      });
      dropped.push(...mine.map((d) => ({ ...d, where: p.origins?.[d.sheetRow - 1] })));
      return out;
    });
    return [all, dropped] as const;
  }, [parts, visitEdits]);
  const autoMatch = useMemo(() => {
    if (visits.length === 0) return [] as Array<string | null>;
    // Someone in the upload who's already in Wyndos counts once (as the existing customer, with the upload's ref).
    const newByKey = new Map(rows.map((r, i) => [custKey(r.name, r.address), i]));
    const oldKeys = new Set(customers.map((c) => custKey(c.name, c.address)));
    const candidates: Array<MatchCandidate<string>> = [
      ...customers.map((c) => ({ key: `old:${c.id}`, name: c.name, address: c.address, postcode: c.postcode, ref: rows[newByKey.get(custKey(c.name, c.address)) ?? -1]?.ref })),
      // Other names, old addresses and references they've been matched by before.
      ...customers.flatMap((c) => (c.aliases ?? []).map((a) => ({
        key: `old:${c.id}`,
        name: a.kind === "NAME" ? a.label : c.name,
        address: a.kind === "ADDRESS" ? a.label : c.address,
        ref: a.kind === "REF" ? a.label : undefined,
      }))),
      ...rows.flatMap((r) => (oldKeys.has(custKey(r.name, r.address)) ? [] : [{ key: `new:${r.rowKey}`, name: r.name, address: r.address, postcode: r.postcode, ref: r.ref }])),
    ];
    return matchHistory(visits, candidates);
  }, [visits, rows, customers]);
  // The owner's choices for history that didn't match automatically.
  const visitMatch = useMemo(() => visits.map((v, i) => {
    if (autoMatch[i]) return autoMatch[i];
    const choice = resolutions[visitGroup(v)];
    if (!choice || choice === "skip") return null;
    return choice === "former" ? `former:${visitGroup(v)}` : choice;
  }), [visits, autoMatch, resolutions]);
  const matchedName = (key: string | null) => {
    if (!key) return "";
    const [kind, ...rest] = key.split(":");
    const id = rest.join(":");
    if (kind === "former") return "Former customer (will be added)";
    return kind === "old" ? customers.find((c) => c.id === Number(id))?.name ?? "" : `${rows.find((r) => r.rowKey === id)?.name ?? ""} (new)`;
  };
  /** History rows nothing matched, grouped by person, for the owner to sort out. */
  const unmatchedGroups = useMemo(() => {
    const groups = new Map<string, { key: string; ref: string; name: string; address: string; postcode: string; count: number; total: number; lastPrice: number | null; lastDate: string }>();
    visits.forEach((v, i) => {
      if (autoMatch[i]) return;
      const g = visitGroup(v);
      const e = groups.get(g) ?? { key: g, ref: v.ref, name: v.name, address: v.address, postcode: v.postcode, count: 0, total: 0, lastPrice: null, lastDate: "" };
      e.count++;
      e.total += v.price ?? 0;
      if (v.date >= e.lastDate) { e.lastDate = v.date; e.lastPrice = v.price; }
      groups.set(g, e);
    });
    return [...groups.values()].sort((a, b) => b.count - a.count);
  }, [visits, autoMatch]);
  const unmatched = visits.filter((_, i) => !visitMatch[i]);
  const usableVisits = visits.filter((v, i) => visitMatch[i] && v.date);
  // What won't be imported, shown in the preview so nothing goes missing silently.
  const existingKeys = useMemo(() => new Set(customers.map((c) => custKey(c.name, c.address))), [customers]);
  const willSkipCustomers: NotImportedRow[] = [
    ...droppedCustomers.map((d) => ({ row: d.where ?? d.sheetRow, name: d.name, reason: d.reason })),
    ...rows.filter((r) => existingKeys.has(custKey(r.name, r.address))).map((r) => ({ row: r.where ?? r.sheetRow, name: r.name, reason: "Already in Wyndos (same name and address), will be left as it is" })),
  ].sort(byRow);
  const willSkipVisits: NotImportedRow[] = [
    ...droppedVisits.map((d) => ({ row: d.where ?? d.sheetRow, name: d.name, reason: d.reason })),
    ...visits.flatMap((v, i) => (!visitMatch[i] ? [{ row: v.where ?? v.sheetRow, name: v.name || v.address || v.ref, reason: resolutions[visitGroup(v)] === "skip" ? "Left out by you" : "No matching customer: choose one below, or add them as a former customer" }] : !v.date ? [{ row: v.where ?? v.sheetRow, name: v.name || v.address, reason: "No date" }] : [])),
  ].sort(byRow);
  const visitDates = usableVisits.map((v) => v.date).sort();
  const visitIdx = visits.map((_, i) => i).filter((i) => !unmatchedOnly || !visitMatch[i]).slice(0, 60);

  const anyCustomers = rows.length > 0;
  const anyHistory = visits.length > 0;
  const nothingToImport = !anyCustomers && usableVisits.length === 0;
  const maxAttempt = Math.max(0, ...parts.map((p) => p.attempt));

  const reset = () => {
    setRowEdits({}); setVisitEdits({}); setResolutions({}); setEditing(null); setMapperOpen(null);
    setStage("upload"); setError(null); setFiles([]); setParts([]); setProgress("");
    setFeedbackOpen(false); setFeedback(""); setFeedbackPart(0); setElsewhere(null); setResult(null);
    setHelpOpen(false); setHelpText(""); setHelpSent(false); setProblemsOnly(false); setUnmatchedOnly(false);
  };

  const readWithAi = async (label: string, grid: string[][], previous?: ImportPlan, said?: string, n = 1) => {
    const res = await aiImportPlan({ ...sampleFor(label, grid), feedback: said || undefined, previousPlan: previous, attempt: n, previewRows: previous ? previewFor(grid, previous) : undefined })
      .catch(() => ({ ok: false as const, error: "Couldn't reach Wyndos. Check your connection and try again." }));
    return res;
  };

  const onFiles = async (list: File[]) => {
    reset();
    const picked = list.slice(0, MAX_FILES);
    setFiles(picked);
    setStage("reading");
    try {
      const sheets: Sheet[] = [];
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
      const filled = sheets.filter((s) => nonEmpty(s.grid) >= 2);
      if (filled.length === 0) throw new Error("That file looks empty.");
      if (filled.length > MAX_SHEETS) throw new Error(`That's ${filled.length} worksheets. Up to ${MAX_SHEETS} can be read at once: split the file, or ask us to import it for you.`);
      const usable = groupSheets(filled);
      if (usable.length > MAX_LAYOUTS) throw new Error(`Those sheets have ${usable.length} different layouts. Up to ${MAX_LAYOUTS} can be read at once: import them in a few goes, or ask us to import it for you.`);
      const made: Part[] = [];
      for (const [i, s] of usable.entries()) {
        const grid = s.grid.slice(0, MAX_ROWS + 50);
        // Our own export: read it exactly, no AI needed.
        const own = wyndosExportPlan(grid[0] ?? []);
        if (own) { made.push({ id: i, label: s.label, grid, plan: own, source: "wyndos", attempt: 0, offTopic: false, origins: s.origins }); continue; }
        if (!available) throw new Error("Smart import isn't available right now. Use the normal import, or ask us to import it for you.");
        setProgress(usable.length > 1 ? `Reading ${s.label} (${i + 1} of ${usable.length})…` : "");
        const res = await readWithAi(s.label, grid);
        if (!res.ok) throw new Error(res.error);
        made.push({ id: i, label: s.label, grid, plan: withSheetArea(res.plan, grid), source: "ai", attempt: 1, offTopic: false, origins: s.origins });
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
    const next = withSheetArea(res.plan, part.grid);
    const labels = Object.fromEntries([...HISTORY_MAP_FIELDS, ...CUSTOMER_MAP_FIELDS].map((f) => [f.key, f.label]));
    const changes = res.plan.feedbackOffTopic ? [] : describePlanChanges(part.plan, next, part.grid[Math.max(0, part.plan.headerRow)] ?? [], labels);
    setParts((all) => all.map((p, i) => (i === feedbackPart ? { ...p, plan: next, source: "ai", attempt: p.attempt + 1, offTopic: res.plan.feedbackOffTopic, changes } : p)));
    setFeedbackOpen(false);
    setFeedback("");
  };

  const doImport = async () => {
    setStage("importing");
    setError(null);
    const r: Result = { created: 0, skipped: 0, errors: 0, areas: [], quotes: 0, visits: 0, visitsSkipped: 0, unmatched: unmatched.length, notImported: droppedCustomers.map((d) => ({ row: d.where ?? d.sheetRow, name: d.name, reason: d.reason })), historyNotImported: droppedVisits.map((d) => ({ row: d.where ?? d.sheetRow, name: d.name, reason: d.reason })) };
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
        for (const e of res.errors) r.notImported.push({ row: batch[e.row - 1]?.where ?? batch[e.row - 1]?.sheetRow, name: batch[e.row - 1]?.name, reason: e.message });
        for (const e of res.skippedRows) r.notImported.push({ row: batch[e.row - 1]?.where ?? batch[e.row - 1]?.sheetRow, name: batch[e.row - 1]?.name, reason: e.reason });
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
        for (const e of res.skippedRows) r.notImported.push({ row: batch[e.row - 1]?.where ?? batch[e.row - 1]?.sheetRow, name: batch[e.row - 1]?.name, reason: `Quote: ${e.reason}` });
      }
      // Remember each customer's reference from the other program, so a history file on its own matches later.
      const withRef = rows.filter((c) => c.ref);
      if (withRef.length) {
        const freshForRefs = await getCustomersForMatching();
        const idOf = new Map(freshForRefs.map((c) => [custKey(c.name, c.address), c.id]));
        const refs = withRef.flatMap((c) => { const id = idOf.get(custKey(c.name, c.address)); return id ? [{ customerId: id, ref: c.ref }] : []; });
        for (let i = 0; i < refs.length; i += 1000) await saveCustomerAliases(refs.slice(i, i + 1000));
      }
      // 3. History, matched again against everyone now in Wyndos (refs come from this upload's customers).
      if (usableVisits.length > 0) {
        // Former customers the owner chose to add (people only in the history).
        const formerIds = new Map<string, number>();
        const former = unmatchedGroups.filter((g) => resolutions[g.key] === "former");
        if (former.length) {
          setProgress(`Adding ${former.length} former customer${former.length === 1 ? "" : "s"}…`);
          for (const x of await createFormerCustomers(former.map((g) => ({ key: g.key, name: g.name, address: g.address, postcode: g.postcode, ref: g.ref, price: g.lastPrice ?? 0 })))) formerIds.set(x.key, x.id);
          r.former = formerIds.size;
        }
        setProgress("Matching history to customers…");
        const fresh = await getCustomersForMatching();
        const refOf = new Map(rows.filter((c) => c.ref).map((c) => [custKey(c.name, c.address), c.ref]));
        const freshId = new Map(fresh.map((c) => [custKey(c.name, c.address), c.id]));
        const auto = matchHistory(visits, [
          ...fresh.map((c) => ({ key: c.id, name: c.name, address: c.address, postcode: c.postcode, ref: refOf.get(custKey(c.name, c.address)) })),
          ...fresh.flatMap((c) => c.aliases.map((a) => ({ key: c.id, name: a.kind === "NAME" ? a.label : c.name, address: a.kind === "ADDRESS" ? a.label : c.address, ref: a.kind === "REF" ? a.label : undefined }))),
        ]);
        // Owner's choices for the rest.
        const chosenId = (choice: string | undefined, group: string): number | null => {
          if (!choice || choice === "skip") return null;
          if (choice === "former") return formerIds.get(group) ?? null;
          if (choice.startsWith("old:")) return Number(choice.slice(4)) || null;
          if (choice.startsWith("new:")) { const row = rows.find((x) => x.rowKey === choice.slice(4)); return row ? freshId.get(custKey(row.name, row.address)) ?? null : null; }
          return null;
        };
        const keys = visits.map((v, i) => auto[i] ?? chosenId(resolutions[visitGroup(v)], visitGroup(v)));
        // Remember the other names / addresses / references they were matched by, for next time.
        if (rememberAliases) {
          const aliases = unmatchedGroups.flatMap((g) => {
            const choice = resolutions[g.key];
            const id = choice && choice !== "former" ? chosenId(choice, g.key) : null;
            return id ? [{ customerId: id, ref: g.ref || undefined, name: g.name || undefined, address: g.address || undefined }] : [];
          });
          if (aliases.length) await saveCustomerAliases(aliases);
        }
        const toSave = visits.flatMap((v, i) => (keys[i] && v.date ? [{ v, customerId: keys[i]! }] : []));
        r.unmatched = visits.length - toSave.length;
        visits.forEach((v, i) => { if (!keys[i]) r.historyNotImported.push({ row: v.where ?? v.sheetRow, name: v.name || v.address || v.ref, reason: resolutions[visitGroup(v)] === "skip" ? "Left out by you" : "No matching customer (by reference, address or name)" }); else if (!v.date) r.historyNotImported.push({ row: v.where ?? v.sheetRow, name: v.name || v.address, reason: "No date" }); });
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
          for (const e of [...res.errors.map((x) => ({ row: x.row, reason: x.message })), ...res.skippedRows]) r.historyNotImported.push({ row: batch[e.row - 1]?.v.where ?? batch[e.row - 1]?.v.sheetRow, name: batch[e.row - 1]?.v.name, reason: e.reason });
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
    r.notImported.sort(byRow);
    r.historyNotImported.sort(byRow);
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
                : "Customer list, job history, or both (pick several files at once). Excel (any number of sheets), CSV, Wyndos exports, CleanerPlanner backups. Any layout."}
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
          {(result.former ?? 0) > 0 && <li>{result.former} former customer{result.former === 1 ? "" : "s"} added (inactive, with their history)</li>}
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
            {!part.offTopic && part.changes && (part.changes.length > 0 ? (
              <div className="mt-2 rounded-lg bg-white px-3 py-2 text-xs text-emerald-800">
                <p className="font-semibold">Changed:</p>
                <ul className="mt-0.5 list-disc pl-4">{part.changes.slice(0, 12).map((c, i) => <li key={i}>{c}</li>)}</ul>
              </div>
            ) : (
              <p className="mt-2 rounded-lg bg-white px-3 py-2 text-xs text-amber-800">
                The AI didn&apos;t change anything this time. Use <b>Change columns</b> below to set it yourself: pick the column for each field, or type a value to use when blank.
              </p>
            ))}
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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setMapperOpen(mapperOpen === part.id ? null : part.id)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100">
                <Columns3 size={12} /> {mapperOpen === part.id ? "Done" : "Change columns or defaults"}
              </button>
              {Object.values(part.plan.defaults ?? {}).some(Boolean) && <span className="text-[11px] text-blue-800">Defaults for blanks: {Object.entries(part.plan.defaults ?? {}).filter(([, v]) => v).map(([k, v]) => `${FIELD_LABELS[k as PlanField]} = ${v}`).join(", ")}</span>}
            </div>
            {mapperOpen === part.id && (
              <div className="mt-2 space-y-2 rounded-xl bg-white p-3">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  This file is
                  <select value={part.plan.kind} onChange={(e) => updatePlan(part.id, { kind: e.target.value as ImportPlan["kind"] })} className="rounded border border-slate-200 px-1.5 py-1">
                    <option value="customers">a customer list</option>
                    <option value="job_history">job history (past cleans / payments)</option>
                    <option value="not_customers">not for importing</option>
                  </select>
                </label>
                <ColumnMapper
                  grid={part.grid}
                  headerRow={part.plan.headerRow}
                  columns={part.plan.columns}
                  defaults={(part.plan.defaults ?? {}) as Record<string, string | undefined>}
                  fixed={(part.plan.fixedValues ?? {}) as Record<string, string | undefined>}
                  fields={part.plan.kind === "job_history" ? HISTORY_MAP_FIELDS : CUSTOMER_MAP_FIELDS}
                  onChange={(next) => updatePlan(part.id, { columns: next.columns as ImportPlan["columns"], defaults: next.defaults as ImportPlan["defaults"], fixedValues: next.fixed as ImportPlan["fixedValues"], headerRow: next.headerRow, firstDataRow: next.firstDataRow })}
                />
                <p className="text-[11px] text-slate-400">Changes show in the preview straight away. No AI is used for these.</p>
              </div>
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
                Showing {shown.length} of {filtered.length}{problemsOnly ? " to check" : ""} · tap a row to change it
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, address, area" className="w-48 rounded-lg border border-slate-200 px-2 py-1 text-xs" />
                {filtered.length > 60 && <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-blue-600" /> Show all</label>}
                {withProblems.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} className="accent-blue-600" /> Only rows to check
                  </label>
                )}
              </div>
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
                    <Fragment key={c.rowKey ?? `${c.sheetRow}-${i}`}>
                    <tr onClick={() => setEditing(editing === `c:${c.rowKey}` ? null : `c:${c.rowKey}`)} className={cn("cursor-pointer hover:bg-blue-50/50", c.problems.length ? "bg-amber-50/60" : "", !c.active && "text-slate-400", rowEdits[c.rowKey ?? ""] && "outline outline-1 -outline-offset-1 outline-blue-300")}>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-slate-400">{c.where ?? c.sheetRow}</td>
                      <td className="max-w-[180px] truncate px-2.5 py-1.5 font-medium text-slate-800">{c.name}</td>
                      <td className="max-w-[280px] truncate px-2.5 py-1.5">{c.address}</td>
                      <td className="px-2.5 py-1.5">{c.area}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{c.price === null ? "—" : fmtCurrency(c.price)}</td>
                      <td className="px-2.5 py-1.5">{c.frequencyWeeks ? `${c.frequencyWeeks}w` : "—"}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">{fmtDate(c.nextDueDate)}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">{c.phone || "—"}</td>
                      <td className="px-2.5 py-1.5">{c.preferredPaymentMethod || "—"}</td>
                      <td className="max-w-[200px] truncate px-2.5 py-1.5 text-slate-500">{c.notes.replace(/\n/g, " · ")}</td>
                      <td className="px-2.5 py-1.5 text-amber-700">{[...c.problems, c.quote ? "Quote" : c.active ? "" : "Inactive", rowEdits[c.rowKey ?? ""] ? "Changed" : ""].filter(Boolean).join(", ")}</td>
                    </tr>
                    {editing === `c:${c.rowKey}` && (
                      <tr><td colSpan={11} className="bg-blue-50/60 px-3 py-2">
                        <CustomerEditor row={c} areas={[...new Set([...areas.map((a) => a.name), ...areaSummary.map((a) => a.name)])]}
                          onSave={(e) => { setRowEdits((all) => ({ ...all, [c.rowKey!]: { ...all[c.rowKey!], ...e } })); setEditing(null); }}
                          onReset={() => { setRowEdits((all) => { const n = { ...all }; delete n[c.rowKey!]; return n; }); setEditing(null); }}
                          onSkip={() => { setRowEdits((all) => ({ ...all, [c.rowKey!]: { ...all[c.rowKey!], skip: true } })); setEditing(null); }} />
                      </td></tr>
                    )}
                    </Fragment>
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
                      <Fragment key={v.rowKey ?? `${v.sheetRow}-${i}`}>
                      <tr onClick={() => setEditing(editing === `v:${v.rowKey}` ? null : `v:${v.rowKey}`)} className={cn("cursor-pointer hover:bg-blue-50/50", !m || !v.date ? "bg-amber-50/60" : "", visitEdits[v.rowKey ?? ""] && "outline outline-1 -outline-offset-1 outline-blue-300")}>
                        <td className="whitespace-nowrap px-2.5 py-1.5 text-slate-400">{v.where ?? v.sheetRow}</td>
                        <td className="whitespace-nowrap px-2.5 py-1.5">{v.date ? fmtDate(v.date) : <span className="text-amber-700">No date</span>}</td>
                        <td className="max-w-[260px] truncate px-2.5 py-1.5">{[v.ref && `#${v.ref}`, v.name, v.address].filter(Boolean).join(" · ")}</td>
                        <td className="max-w-[200px] truncate px-2.5 py-1.5 font-medium text-slate-800">{m ? matchedName(m) : <span className="font-normal text-amber-700">No match</span>}</td>
                        <td className="px-2.5 py-1.5 tabular-nums">{v.price === null ? "—" : fmtCurrency(v.price)}</td>
                        <td className="px-2.5 py-1.5 tabular-nums">{v.paid === null ? "—" : fmtCurrency(v.paid)}</td>
                        <td className="px-2.5 py-1.5">{v.paymentMethod || "—"}</td>
                        <td className="max-w-[180px] truncate px-2.5 py-1.5 text-slate-500">{v.notes}</td>
                      </tr>
                      {editing === `v:${v.rowKey}` && (
                        <tr><td colSpan={8} className="bg-blue-50/60 px-3 py-2">
                          <VisitEditor row={v}
                            onSave={(e) => { setVisitEdits((all) => ({ ...all, [v.rowKey!]: { ...all[v.rowKey!], ...e } })); setEditing(null); }}
                            onReset={() => { setVisitEdits((all) => { const n = { ...all }; delete n[v.rowKey!]; return n; }); setEditing(null); }}
                            onSkip={() => { setVisitEdits((all) => ({ ...all, [v.rowKey!]: { ...all[v.rowKey!], skip: true } })); setEditing(null); }} />
                        </td></tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {unmatchedGroups.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-amber-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">History that didn&apos;t match a customer ({unmatchedGroups.length})</p>
          <p className="text-xs text-slate-500">
            Old addresses, different spellings, or customers who&apos;ve stopped. For each, choose who it is, add them as a <b>former customer</b> (kept inactive with their history), or leave it out.
          </p>
          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {unmatchedGroups.map((g) => (
              <div key={g.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{[g.ref && `#${g.ref}`, g.name, g.address].filter(Boolean).join(" · ") || "(no details)"}</p>
                  <p className="text-slate-500">{g.count} clean{g.count === 1 ? "" : "s"} · {fmtCurrency(g.total)}{g.lastDate ? ` · last ${fmtDate(g.lastDate)}` : ""}</p>
                </div>
                <select value={resolutions[g.key] ?? ""} onChange={(e) => setResolutions((r) => ({ ...r, [g.key]: e.target.value }))} className={cn("w-72 max-w-full rounded-lg border px-2 py-1", resolutions[g.key] ? "border-blue-300 bg-blue-50" : "border-amber-300")}>
                  <option value="">Choose…</option>
                  <option value="former">Add as a former customer</option>
                  <option value="skip">Leave out</option>
                  {rows.length > 0 && <optgroup label="New in this import">{rows.map((r) => <option key={r.rowKey} value={`new:${r.rowKey}`}>{r.name} · {r.address}</option>)}</optgroup>}
                  {customers.length > 0 && <optgroup label="Already in Wyndos">{customers.map((c) => <option key={c.id} value={`old:${c.id}`}>{c.name} · {c.address}{c.active === false ? " (inactive)" : ""}</option>)}</optgroup>}
                </select>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-2 text-xs">
            <button type="button" onClick={() => setResolutions((r) => ({ ...r, ...Object.fromEntries(unmatchedGroups.filter((g) => !r[g.key]).map((g) => [g.key, "former"])) }))} className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50">Add all the rest as former customers</button>
            <label className="flex items-center gap-1.5 text-slate-600"><input type="checkbox" checked={rememberAliases} onChange={(e) => setRememberAliases(e.target.checked)} className="accent-blue-600" /> Remember these other names and addresses for next time</label>
          </div>
        </div>
      )}

      {leftOut > 0 && (
        <p className="text-xs text-slate-500">{leftOut} row{leftOut === 1 ? "" : "s"} left out by you. <button type="button" onClick={() => { setRowEdits((all) => Object.fromEntries(Object.entries(all).map(([k, e]) => [k, { ...e, skip: false }]))); setVisitEdits((all) => Object.fromEntries(Object.entries(all).map(([k, e]) => [k, { ...e, skip: false }]))); }} className="font-semibold text-blue-700 underline">Put them all back</button></p>
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

const CUSTOMER_MAP_FIELDS: MapperField[] = [
  { key: "name", label: "Name", multi: true, hint: "Join first name + surname", defaultPlaceholder: "1st line of address" },
  { key: "fullAddress", label: "Address (one cell)", multi: true, hint: "Or use the parts below" },
  { key: "houseNumber", label: "House no./name" },
  { key: "street", label: "Street" },
  { key: "town", label: "Town", defaultPlaceholder: "e.g. Leeds" },
  { key: "postcode", label: "Postcode" },
  { key: "area", label: "Area / round", multi: true, defaultPlaceholder: "e.g. Monday" },
  { key: "price", label: "Price", defaultPlaceholder: "e.g. 15" },
  { key: "frequency", label: "How often", hint: "Weeks, or words like monthly", defaultPlaceholder: "e.g. 4" },
  { key: "nextDue", label: "Next due" },
  { key: "lastCleaned", label: "Last cleaned" },
  { key: "phone", label: "Phone", multi: true },
  { key: "email", label: "Email" },
  { key: "payment", label: "How they pay", defaultPlaceholder: "e.g. Cash" },
  { key: "status", label: "Active / stopped", hint: "Values meaning stopped are set by the AI" },
  { key: "jobName", label: "Job name", defaultPlaceholder: "Window cleaning" },
  { key: "notes", label: "Notes", multi: true },
  { key: "customerRef", label: "Their reference / ID", hint: "Links job history to them" },
];
const HISTORY_MAP_FIELDS: MapperField[] = [
  { key: "customerRef", label: "Customer reference / ID" },
  { key: "name", label: "Customer name", multi: true },
  { key: "fullAddress", label: "Address", multi: true },
  { key: "postcode", label: "Postcode" },
  { key: "visitDate", label: "Date of clean / payment" },
  { key: "price", label: "Price of the clean", defaultPlaceholder: "e.g. 15" },
  { key: "amountPaid", label: "Amount paid" },
  { key: "paidStatus", label: "Paid? (yes/no column)", hint: "If there's no amount paid" },
  { key: "payment", label: "How it was paid", defaultPlaceholder: "e.g. Cash" },
  { key: "notes", label: "Notes", multi: true },
];

const box = "rounded border border-slate-200 bg-white px-1.5 py-1 text-xs";

/** Change one customer before it's imported (values override what the file says). */
function CustomerEditor({ row, areas, onSave, onReset, onSkip }: { row: SmartRow; areas: string[]; onSave: (e: RowEdit) => void; onReset: () => void; onSkip: () => void }) {
  const [f, setF] = useState({
    name: row.name, address: row.address, area: row.area, price: row.price === null ? "" : String(row.price),
    frequencyWeeks: row.frequencyWeeks ? String(row.frequencyWeeks) : "", nextDueDate: row.nextDueDate, phone: row.phone, email: row.email, notes: row.notes, active: row.active,
  });
  const listId = `areas-${row.rowKey}`;
  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[11px] text-slate-500">Name<input className={cn(box, "w-full")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="text-[11px] text-slate-500 sm:col-span-2">Address<input className={cn(box, "w-full")} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
        <label className="text-[11px] text-slate-500">Area<input list={listId} className={cn(box, "w-full")} value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /><datalist id={listId}>{areas.map((a) => <option key={a} value={a} />)}</datalist></label>
        <label className="text-[11px] text-slate-500">Price £<input type="number" step="0.01" className={cn(box, "w-full")} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
        <label className="text-[11px] text-slate-500">Every (weeks)<input type="number" min={1} max={52} className={cn(box, "w-full")} value={f.frequencyWeeks} onChange={(e) => setF({ ...f, frequencyWeeks: e.target.value })} /></label>
        <label className="text-[11px] text-slate-500">Next due<input type="date" className={cn(box, "w-full")} value={f.nextDueDate} onChange={(e) => setF({ ...f, nextDueDate: e.target.value })} /></label>
        <label className="text-[11px] text-slate-500">Phone<input className={cn(box, "w-full")} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="text-[11px] text-slate-500">Email<input className={cn(box, "w-full")} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="text-[11px] text-slate-500 sm:col-span-2">Notes<input className={cn(box, "w-full")} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="accent-blue-600" /> Active customer</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onSave({
          name: f.name.trim(), address: f.address.trim(), area: f.area.trim() || row.area, price: f.price === "" ? null : Math.max(0, Number(f.price) || 0),
          frequencyWeeks: f.frequencyWeeks ? Math.min(52, Math.max(1, Math.round(Number(f.frequencyWeeks)))) : null,
          nextDueDate: f.nextDueDate, phone: f.phone.trim(), email: f.email.trim(), notes: f.notes, active: f.active,
        })} className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white">Use these values</button>
        <button type="button" onClick={onReset} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">Back to what the file says</button>
        <button type="button" onClick={onSkip} className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700">Leave this row out</button>
      </div>
    </div>
  );
}

/** Change one past clean before it's imported. */
function VisitEditor({ row, onSave, onReset, onSkip }: { row: HistoryRow; onSave: (e: VisitEdit) => void; onReset: () => void; onSkip: () => void }) {
  const [f, setF] = useState({ date: row.date, price: row.price === null ? "" : String(row.price), paid: row.paid === null ? "" : String(row.paid) });
  return (
    <div className="flex flex-wrap items-end gap-2" onClick={(e) => e.stopPropagation()}>
      <label className="text-[11px] text-slate-500">Date<input type="date" className={cn(box, "block")} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      <label className="text-[11px] text-slate-500">Price £<input type="number" step="0.01" className={cn(box, "block w-24")} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
      <label className="text-[11px] text-slate-500">Paid £<input type="number" step="0.01" className={cn(box, "block w-24")} value={f.paid} onChange={(e) => setF({ ...f, paid: e.target.value })} /></label>
      <button type="button" onClick={() => onSave({ date: f.date, price: f.price === "" ? null : Math.max(0, Number(f.price) || 0), paid: f.paid === "" ? null : Math.max(0, Number(f.paid) || 0) })} className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white">Use these values</button>
      <button type="button" onClick={onReset} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">Back to the file</button>
      <button type="button" onClick={onSkip} className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700">Leave out</button>
      <span className="text-[11px] text-slate-400">To change who it belongs to, use the list of history that didn&apos;t match, or fix the customer.</span>
    </div>
  );
}
