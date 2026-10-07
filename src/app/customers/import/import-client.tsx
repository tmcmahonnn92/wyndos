"use client";

import { Fragment, useState, useRef, useTransition, useCallback } from "react";
import Link from "next/link";
import {
  Upload,
  ChevronLeft,
  ChevronRight,
  Download,
  Check,
  X,
  AlertCircle,
  Plus,
  Trash2,
  FileText,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Clock,
  CalendarPlus,
} from "lucide-react";
import { bulkImportCustomers, deleteAllCustomers, bulkImportJobHistory } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AREA_SORT_ENABLED, GUIDED_IMPORT_ENABLED, SMART_IMPORT_ENABLED } from "@/lib/features";
import { composeAddress, type AddressParts } from "@/lib/address";
import { fixUkPhone, ukMobile } from "@/lib/text-format";

/** First line of an address, for customers with no name. */
function firstAddressLine(address: string, house = "", street = "") {
  return (address.split(",")[0] ?? "").trim() || [house.trim(), street.trim()].filter(Boolean).join(" ");
}
import {
  normalisePaymentMethod,
  parsePrice,
  parseSlip,
  parseSpreadsheetFile,
  parseUkDate,
  parseYes,
} from "@/lib/import-parsing";

// ── Types ─────────────────────────────────────────────────────────────────────

type Area = { id: number; name: string; color: string; frequencyWeeks: number };

type NewAreaConfig = {
  key: string;
  displayName: string;
  color: string;
  frequencyWeeks: number;
  rowCount: number;
};

type SourceType = "column" | "concat" | "fixed" | "skip";

interface MappingConfig {
  source: SourceType;
  column?: string;       // for "column"
  columns?: string[];    // for "concat"
  separator?: string;    // for "concat"
  value?: string;        // for "fixed" text/number/date/select
  areaId?: number;       // for "fixed" area field
}

interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  type: "text" | "number" | "area" | "date" | "select" | "boolean";
  options?: string[];
  defaultValue?: string;
}

const FIELDS: FieldDef[] = [
  { key: "name",    label: "Customer Name",    required: true,  type: "text", defaultValue: "" },
  { key: "address", label: "Address (full line)", required: false, type: "text", defaultValue: "" },
  { key: "houseNameNumber", label: "House name / number", required: false, type: "text" },
  { key: "street",  label: "Street",           required: false, type: "text" },
  { key: "town",    label: "Town / village",   required: false, type: "text" },
  { key: "postcode", label: "Postcode",        required: false, type: "text" },
  { key: "price",   label: "Price (£)",        required: true,  type: "number", defaultValue: "" },
  { key: "area",    label: "Area",             required: true,  type: "area" },
  { key: "email",   label: "Email",            required: false, type: "text" },
  { key: "phone",   label: "Phone",            required: false, type: "text" },
  { key: "notes",   label: "Notes",            required: false, type: "text" },
  { key: "jobName", label: "Job Name",         required: false, type: "text", defaultValue: "Window Cleaning" },
  { key: "nextDueDate", label: "Next Due Date", required: false, type: "date" },
  { key: "lastCompletedDate", label: "Last Cleaned", required: false, type: "date" },
  { key: "preferredPaymentMethod", label: "Payment Method", required: false, type: "select",
    options: ["", "CASH", "BACS", "CARD", "DD", "INVOICE"] },
  { key: "advanceNotice", label: "Advance Notice", required: false, type: "boolean" },
  { key: "frequencyWeeks", label: "Frequency (weeks) — a different frequency goes in its own area", required: false, type: "number", defaultValue: "" },
  { key: "slip", label: "Leave a slip", required: false, type: "boolean" },
  { key: "tags", label: "Tags (comma or ; separated)", required: false, type: "text" },
  { key: "active", label: "Active (Yes / No)", required: false, type: "boolean" },
];

const COLOUR_PALETTE = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#14B8A6", "#F97316", "#06B6D4", "#84CC16",
  "#A855F7", "#6366F1",
];

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/);
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        result.push(cur); cur = "";
      } else cur += ch;
    }
    result.push(cur);
    return result.map((v) => v.trim());
  };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).filter((l) => l.trim()).map(parseLine);
  return { headers, rows };
}

// ── Resolve a single field value from a row ───────────────────────────────────

function resolveValue(row: string[], headers: string[], cfg: MappingConfig): string {
  if (!cfg || cfg.source === "skip") return "";
  if (cfg.source === "fixed") return cfg.value ?? "";
  if (cfg.source === "column") {
    const idx = headers.indexOf(cfg.column ?? "");
    return idx >= 0 ? (row[idx] ?? "") : "";
  }
  if (cfg.source === "concat") {
    return (cfg.columns ?? [])
      .map((col) => { const idx = headers.indexOf(col); return idx >= 0 ? (row[idx] ?? "") : ""; })
      .filter(Boolean)
      .join(cfg.separator ?? " ");
  }
  return "";
}

// ── Auto-detect initial mapping by matching headers to field labels/keys ──────

function buildAutoMapping(headers: string[]): Record<string, MappingConfig> {
  const lower = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const aliases: Record<string, string> = {
    name: "name", customername: "name", fullname: "name", customer: "name",
    address: "address", addr: "address",
    price: "price", cost: "price", charge: "price", amount: "price",
    area: "area",
    email: "email",
    phone: "phone", mobile: "phone", telephone: "phone", tel: "phone",
    notes: "notes", note: "notes",
    jobname: "jobName", jobtype: "jobName", type: "jobName",
    nextduedate: "nextDueDate", duedate: "nextDueDate", nextdue: "nextDueDate",
    paymentmethod: "preferredPaymentMethod", preferredpaymentmethod: "preferredPaymentMethod",
    advancenotice: "advanceNotice",
    frequencyweeks: "frequencyWeeks", frequency: "frequencyWeeks", freq: "frequencyWeeks", weeks: "frequencyWeeks",
    cashbacs: "preferredPaymentMethod", payment: "preferredPaymentMethod", pays: "preferredPaymentMethod", paidby: "preferredPaymentMethod",
    slip: "slip", slips: "slip", leaveslip: "slip", callingcard: "slip",
    comments: "notes", info: "notes", details: "notes",
    postcode: "postcode", postalcode: "postcode", street: "street", streetname: "street", road: "street",
    property: "address", address1: "address", addressline1: "address",
    housenumber: "houseNameNumber", houseno: "houseNameNumber", number: "houseNameNumber", no: "houseNameNumber",
    housename: "houseNameNumber", housenamenumber: "houseNameNumber",
    village: "area", town: "area", round: "area", route: "area",
    telephonenumber: "phone", phonenumber: "phone", contact: "phone", mobilenumber: "phone", mobilephone: "phone",
    // Headings used by Wyndos' own export, so an export can be re-imported as-is.
    housenoname: "houseNameNumber", everyweeks: "frequencyWeeks", usuallypays: "preferredPaymentMethod",
    lastcleaned: "lastCompletedDate", lastclean: "lastCompletedDate", lastdone: "lastCompletedDate", lastcompleted: "lastCompletedDate",
    tags: "tags", tag: "tags", active: "active",
  };
  const out: Record<string, MappingConfig> = {};
  FIELDS.forEach((f) => {
    const match = lower.findIndex((lh) => aliases[lh] === f.key);
    if (match >= 0) {
      out[f.key] = { source: "column", column: headers[match] };
    } else if (f.defaultValue !== undefined && f.defaultValue !== "") {
      out[f.key] = { source: "fixed", value: f.defaultValue };
    } else {
      out[f.key] = { source: f.required ? "column" : "skip" };
    }
  });
  // A sheet with its own Area column: "Town" is the town part of the address, not the area.
  const areaHeader = lower.findIndex((lh) => lh === "area" || lh === "round" || lh === "route");
  const townHeader = lower.findIndex((lh) => lh === "town" || lh === "village" || lh === "towncity" || lh === "townvillage");
  if (areaHeader >= 0 && townHeader >= 0) {
    out.area = { source: "column", column: headers[areaHeader] };
    out.town = { source: "column", column: headers[townHeader] };
  }

  // Many sheets use the address as the name ("2 lake view"): use it for both.
  // Not when the sheet has separate street/house columns: the line is built from those.
  const hasPartColumns = ["houseNameNumber", "street"].some((k) => out[k]?.source === "column" && out[k]?.column);
  if (hasPartColumns && out.address?.source === "column" && !out.address.column) out.address = { source: "skip" };
  if (!hasPartColumns && (out.address?.source !== "column" || !out.address.column)) {
    if (out.name?.source === "column" && out.name.column) out.address = { source: "column", column: out.name.column };
  }
  if (out.name?.source !== "column" || !out.name.column) {
    const first = headers[0];
    if (first) out.name = { source: "column", column: first };
  }
  // A column with no heading is usually notes.
  if (out.notes?.source === "skip") {
    const unnamed = headers.find((h) => /^Column [A-Z]+$/.test(h));
    if (unnamed) out.notes = { source: "column", column: unnamed };
  }
  return out;
}

// ── Template CSV ──────────────────────────────────────────────────────────────

const TEMPLATE_HEADERS = "Name,House no./name,Street,Town,Postcode,Area,Price,Every (weeks),Next due,Last cleaned,Phone,Email,Usually pays,Slip,Advance notice,Job name,Tags,Notes";
const TEMPLATE_SAMPLE = `John Smith,29,Beardsley Road,Edwinstowe,NG21 9AA,Edwinstowe,15.00,4,19/10/2026,21/09/2026,07700 900123,john@example.com,Cash,Yes,No,Window Cleaning,,Side gate code 1234
Jane Doe,Eden House,Main Street,Cuckney,NG20 9NB,Cuckney,40.00,8,,,07700 900456,,Bank transfer,No,Yes,Windows + conservatory roof,VIP; Gutters,Ring before`;

// ── History fields & helpers ─────────────────────────────────────────────────

const HISTORY_FIELDS = [
  { key: "customerName",  label: "Customer Name",     required: true },
  { key: "address",       label: "Address (match)",   required: false },
  { key: "date",          label: "Date (YYYY-MM-DD)", required: true },
  { key: "price",         label: "Price (£)",         required: false },
  { key: "paid",          label: "Paid (£)",          required: false },
  { key: "paymentMethod", label: "Payment Method",    required: false },
  { key: "notes",         label: "Notes",             required: false },
] as const;

function buildAutoHistoryMapping(headers: string[]): Record<string, string> {
  const lower = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const aliases: Record<string, string> = {
    customername: "customerName", name: "customerName", customer: "customerName", fullname: "customerName",
    address: "address", addr: "address",
    date: "date", visitdate: "date", cleandate: "date", jobdate: "date", servicedate: "date",
    price: "price", cost: "price", charge: "price",
    paid: "paid", amountpaid: "paid", paidamount: "paid",
    paymentmethod: "paymentMethod", method: "paymentMethod",
    notes: "notes", note: "notes",
  };
  const out: Record<string, string> = {};
  HISTORY_FIELDS.forEach((f) => {
    const match = lower.findIndex((lh) => aliases[lh] === f.key);
    out[f.key] = match >= 0 ? headers[match] : "";
  });
  return out;
}

const HISTORY_TEMPLATE_CSV =
  "Customer Name,Address,Date,Price,Paid,Payment Method,Notes\n" +
  "John Smith,123 High Street Nottingham,2026-03-15,35.00,35.00,CASH,\n" +
  "Jane Doe,456 Oak Avenue Mansfield,2026-03-12,28.00,0,,Still owes";

// ── Preview row type ──────────────────────────────────────────────────────────

type PreviewRow = {
  index: number;
  raw: string[];
  name: string;
  address: string;
  addressParts: AddressParts | null; // set when the sheet has separate address columns
  price: string;
  area: string;
  areaId: number | null;
  areaIsNew: boolean;  // area name not found — will be created if createMissingAreas is on
  email: string;
  phone: string;
  notes: string;
  jobName: string;
  nextDueDate: string;
  preferredPaymentMethod: string;
  advanceNotice: string;
  frequencyWeeks: string;
  slip: boolean | undefined;
  lastCompletedDate: string;
  tags: string[];
  active: boolean | undefined;
  noMobile: boolean;
  newAreaKey: string | null;  // key into newAreaConfigs (set when areaIsNew=true)
  errors: string[];
};

type HistoryPreviewRow = {
  index: number;
  customerName: string;
  address: string;
  date: string;
  price: string;
  paid: string;
  paymentMethod: string;
  notes: string;
  errors: string[];
};

// ── Main component ────────────────────────────────────────────────────────────

export function ImportClient({ areas }: { areas: Area[] }) {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [dragOver, setDragOver] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [parseError, setParseError] = useState("");
  const [mappings, setMappings] = useState<Record<string, MappingConfig>>({});
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [importResult, setImportResult] = useState<{
    created: number;
    updated: number;
    skippedExisting: number;
    areasCreated: string[];
    historyCreated: number;
    runsBooked: Array<{ area: string; date: string }>;
    errors: Array<{ row: number; message: string }>;
    historyErrors: Array<{ row: number; message: string }>;
  } | null>(null);
  // A new account has no areas yet, so every area in the sheet is new: create them by default.
  const [createMissingAreas, setCreateMissingAreas] = useState(areas.filter((a) => !("isSystemArea" in a && a.isSystemArea)).length === 0);
  const [newAreaConfigs, setNewAreaConfigs] = useState<Record<string, NewAreaConfig>>({});
  // What to do with rows for customers already in Wyndos (re-running an import).
  const [existingMode, setExistingMode] = useState<"skip" | "fill" | "overwrite">("skip");
  const updateExisting = existingMode !== "skip";
  const [matchField, setMatchField] = useState<"name" | "nameAddress">("name");
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  // ── Start-fresh / history state ───────────────────────────────────────────────
  const [startFresh, setStartFresh] = useState(false);
  const [confirmFreshText, setConfirmFreshText] = useState("");
  const [importHistory, setImportHistory] = useState(false);
  // Book each area's next run from the Last Cleaned / Next Due columns.
  const [bookRuns, setBookRuns] = useState(true);
  const [nameFromAddress, setNameFromAddress] = useState(true);
  const [historyDragOver, setHistoryDragOver] = useState(false);
  const [historyHeaders, setHistoryHeaders] = useState<string[]>([]);
  const [historyRows, setHistoryRows] = useState<string[][]>([]);
  const [historyParseError, setHistoryParseError] = useState("");
  const [historyMappings, setHistoryMappings] = useState<Record<string, string>>({});
  const [historyPreview, setHistoryPreview] = useState<HistoryPreviewRow[]>([]);
  const historyFileRef = useRef<HTMLInputElement>(null);

  // ── Preview pagination / filter ───────────────────────────────────────────────
  const PAGE_SIZE = 50;
  const [previewPage, setPreviewPage] = useState(0);
  const [errorsOnly, setErrorsOnly] = useState(false);
  // ── Inline row editing ────────────────────────────────────────────────────────
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null); // 1-based row index
  const [editingRowData, setEditingRowData] = useState<Partial<PreviewRow>>({});
  const [historyPage, setHistoryPage] = useState(0);
  const [historyErrorsOnly, setHistoryErrorsOnly] = useState(false);

  // ── CSV ingestion ────────────────────────────────────────────────────────────

  const [ignoredRows, setIgnoredRows] = useState(0);

  const ingestFile = useCallback((file: File) => {
    setParseError("");
    parseSpreadsheetFile(file)
      .then(({ headers: h, rows: r, ignoredRows: ignored }) => {
        if (h.length === 0) throw new Error("No headers detected.");
        if (r.length === 0) throw new Error("No data rows found.");
        setHeaders(h);
        setRows(r);
        setIgnoredRows(ignored);
        setMappings(buildAutoMapping(h));
        setStep(1);
      })
      .catch((err) => setParseError(err instanceof Error ? err.message : String(err)));
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) ingestFile(file);
  };

  const ingestHistoryFile = useCallback((file: File) => {
    setHistoryParseError("");
    if (!file.name.endsWith(".csv")) { setHistoryParseError("Please upload a .csv file."); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const { headers: h, rows: r } = parseCSV(text);
        if (h.length === 0) throw new Error("No headers detected.");
        if (r.length === 0) throw new Error("No data rows found.");
        setHistoryHeaders(h);
        setHistoryRows(r);
        setHistoryMappings(buildAutoHistoryMapping(h));
      } catch (err) {
        setHistoryParseError(String(err));
      }
    };
    reader.readAsText(file);
  }, []);

  // ── Mapping helpers ───────────────────────────────────────────────────────────

  const setMapping = (key: string, patch: Partial<MappingConfig>) =>
    setMappings((m) => ({ ...m, [key]: { ...m[key], ...patch } }));

  const addConcatCol = (key: string) =>
    setMappings((m) => ({
      ...m,
      [key]: { ...m[key], source: "concat", columns: [...(m[key]?.columns ?? []), ""] },
    }));

  const setConcatCol = (key: string, idx: number, val: string) =>
    setMappings((m) => {
      const cols = [...(m[key]?.columns ?? [])];
      cols[idx] = val;
      return { ...m, [key]: { ...m[key], columns: cols } };
    });

  const removeConcatCol = (key: string, idx: number) =>
    setMappings((m) => {
      const cols = (m[key]?.columns ?? []).filter((_, i) => i !== idx);
      return { ...m, [key]: { ...m[key], columns: cols } };
    });

  // ── Build preview ─────────────────────────────────────────────────────────────

  const buildPreview = () => {
    const areaLookup = new Map(areas.map((a) => [a.name.toLowerCase(), a.id]));

    const resolved: PreviewRow[] = rows.map((row, i) => {
      const g = (key: string) => resolveValue(row, headers, mappings[key] ?? { source: "skip" });
      const errors: string[] = [];

      // No name: use the first line of the address (house name/number and street).
      const name = g("name").trim() || (nameFromAddress ? firstAddressLine(g("address"), g("houseNameNumber"), g("street")) : "");
      const partValues: AddressParts = {
        houseNameNumber: g("houseNameNumber").trim(),
        street: g("street").trim(),
        town: g("town").trim(),
        postcode: g("postcode").trim(),
      };
      const addressParts = Object.values(partValues).some(Boolean) ? partValues : null;
      const address = g("address").trim() || (addressParts ? composeAddress(addressParts) : "");
      const priceStr = parsePrice(g("price"));
      const areaStr = mappings["area"]?.source === "fixed" && !mappings["area"]?.areaId
        ? (mappings["area"]?.value ?? "")
        : g("area");

      if (!name.trim()) errors.push("Name is required");
      if (!address.trim()) errors.push("Address is required");

      const price = parseFloat(priceStr);
      if (!priceStr.trim() || isNaN(price) || price < 0) errors.push("Invalid price");

      // Area resolution
      let areaId: number | null = null;
      let areaIsNew = false;
      if (mappings["area"]?.source === "fixed" && mappings["area"]?.areaId) {
        areaId = mappings["area"].areaId;
      } else if (mappings["area"]?.source === "fixed" && mappings["area"]?.value?.trim()) {
        // A brand-new area typed in on the mapping screen: always created on import.
        const typed = mappings["area"].value.trim();
        const found = areaLookup.get(typed.toLowerCase());
        if (found) areaId = found; else areaIsNew = true;
      } else {
        const found = areaLookup.get(areaStr.toLowerCase().trim());
        if (found) {
          areaId = found;
        } else if (createMissingAreas && areaStr.trim()) {
          areaIsNew = true; // will be created on import
        } else {
          errors.push(`Area "${areaStr}" doesn't exist yet: tick "Create new areas automatically", or click the row to choose or create one`);
        }
      }

      // Each frequency has its own area: a customer on a different frequency from their
      // area goes into "<area> (N weekly)" (created if it doesn't exist yet).
      let areaNameOverride: string | null = null;
      const rowFreq = parseInt(g("frequencyWeeks").replace(/[^0-9]/g, ""), 10);
      if (areaId && rowFreq > 0) {
        const existingArea = areas.find((a) => a.id === areaId);
        if (existingArea && existingArea.frequencyWeeks !== rowFreq) {
          const altName = `${existingArea.name} (${rowFreq} weekly)`;
          const altId = areaLookup.get(altName.toLowerCase());
          if (altId) {
            areaId = altId;
          } else {
            areaId = null;
            areaIsNew = true;
            areaNameOverride = altName;
          }
        }
      }

      // Dates: UK style (31/12/2026) or ISO (2026-12-31)
      const rawDate = g("nextDueDate");
      const dateStr = parseUkDate(rawDate);
      if (rawDate.trim() && !dateStr) {
        errors.push("Next due date not recognised (use 31/12/2026)");
      }
      const rawLast = g("lastCompletedDate");
      const lastDate = parseUkDate(rawLast);
      if (rawLast.trim() && !lastDate) errors.push("Last cleaned date not recognised (use 31/12/2026)");

      return {
        index: i + 1,
        raw: row,
        name, address, addressParts,
        price: priceStr,
        area: areaId ? (areas.find((a) => a.id === areaId)?.name ?? areaStr) : (areaNameOverride ?? areaStr.trim()),
        areaId,
        areaIsNew,
        email: g("email"),
        phone: fixUkPhone(g("phone")),
        // "Usually pays" is a fixed list: anything else ("under mat", "neighbour") is kept as a note.
        notes: [g("notes"), g("preferredPaymentMethod").trim() && !normalisePaymentMethod(g("preferredPaymentMethod")) ? `Usually pays: ${g("preferredPaymentMethod").trim()}` : ""].filter(Boolean).join("\n"),
        jobName: g("jobName") || "Window Cleaning",
        nextDueDate: dateStr,
        preferredPaymentMethod: normalisePaymentMethod(g("preferredPaymentMethod")),
        advanceNotice: parseYes(g("advanceNotice")) ? "true" : "false",
        frequencyWeeks: g("frequencyWeeks").replace(/[^0-9]/g, ""),
        slip: mappings["slip"]?.source === "skip" || !mappings["slip"] ? undefined : parseSlip(g("slip")),
        lastCompletedDate: lastDate,
        tags: g("tags").split(/[;,]/).map((t) => t.trim()).filter(Boolean),
        active: mappings["active"]?.source === "skip" || !mappings["active"] ? undefined : !/^(no|n|false|0|inactive)$/i.test(g("active").trim()),
        noMobile: Boolean(g("phone").trim()) && !ukMobile(fixUkPhone(g("phone"))),
        newAreaKey: null,
        errors,
      };
    });

    // ── New areas: one per name. Customers keep their own frequency, so a village with
    // 4- and 8-weekly customers stays one area (8-weeklies join every other run).
    if (createMissingAreas || mappings["area"]?.source === "fixed" || resolved.some((row) => row.areaIsNew)) {
      // New areas: one per name AND frequency (each frequency has its own area).
      // If a name comes with several frequencies, the most common keeps the plain name
      // and the others become "<name> (N weekly)".
      const byName = new Map<string, { origName: string; byFreq: Map<number, number[]> }>();
      resolved.forEach((row, idx) => {
        if (!row.areaIsNew) return;
        const lowerName = row.area.toLowerCase();
        if (!byName.has(lowerName)) byName.set(lowerName, { origName: row.area, byFreq: new Map() });
        const parsed = parseInt(row.frequencyWeeks, 10);
        const freq = !isNaN(parsed) && parsed > 0 ? parsed : 4;
        const entry = byName.get(lowerName)!;
        entry.byFreq.set(freq, [...(entry.byFreq.get(freq) ?? []), idx]);
      });

      const newConfigs: Record<string, NewAreaConfig> = {};
      let colourIdx = areas.length;
      byName.forEach(({ origName, byFreq }, lowerName) => {
        const freqs = [...byFreq.entries()].sort((a, b) => b[1].length - a[1].length);
        freqs.forEach(([freq, indices], rank) => {
          const key = `${lowerName}|||${freq}`;
          const displayName = rank === 0 ? origName : `${origName} (${freq} weekly)`;
          newConfigs[key] = newAreaConfigs[key]
            ? { ...newAreaConfigs[key], rowCount: indices.length }
            : { key, displayName, color: COLOUR_PALETTE[colourIdx % COLOUR_PALETTE.length], frequencyWeeks: freq, rowCount: indices.length };
          colourIdx++;
          indices.forEach((idx) => { resolved[idx].newAreaKey = key; });
        });
      });

      setNewAreaConfigs(newConfigs);
    } else {
      setNewAreaConfigs({});
    }

    setPreview(resolved);

    // Build history preview if history CSV is loaded
    if (importHistory && historyRows.length > 0) {
      const hResolved: HistoryPreviewRow[] = historyRows.map((row, j) => {
        const g = (key: string) => {
          const col = historyMappings[key];
          if (!col) return "";
          const idx = historyHeaders.indexOf(col);
          return idx >= 0 ? (row[idx] ?? "") : "";
        };
        const errs: string[] = [];
        const customerName = g("customerName");
        const date = g("date");
        if (!customerName.trim()) errs.push("Customer name required");
        if (!date.trim()) errs.push("Date required");
        else if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) errs.push("Date must be YYYY-MM-DD");
        const priceStr = g("price");
        if (priceStr && isNaN(parseFloat(priceStr))) errs.push("Invalid price");
        const paidStr = g("paid");
        if (paidStr && isNaN(parseFloat(paidStr))) errs.push("Invalid paid amount");
        return {
          index: j + 1,
          customerName, address: g("address"), date, price: priceStr,
          paid: paidStr, paymentMethod: g("paymentMethod"), notes: g("notes"),
          errors: errs,
        };
      });
      setHistoryPreview(hResolved);
    } else {
      setHistoryPreview([]);
    }

    setStep(2);
  };

  // ── Import ────────────────────────────────────────────────────────────────────

  const handleImport = () => {
    const valid = preview.filter((r) => r.errors.length === 0);
    const validHistory = historyPreview.filter((r) => r.errors.length === 0);
    startTransition(async () => {
      if (startFresh) await deleteAllCustomers();
      // When startFresh is on, all previewed area IDs have just been deleted —
      // always pass areaName so the upsert recreates them from scratch.
      const forceName = startFresh;
      const result = await bulkImportCustomers(
        valid.map((r) => ({
          name: r.name,
          address: r.address,
          ...(r.addressParts ?? {}),
          price: parseFloat(r.price),
          areaId: (!forceName && !r.areaIsNew) ? (r.areaId ?? undefined) : undefined,
          areaName: (forceName || r.areaIsNew)
            ? (r.newAreaKey && newAreaConfigs[r.newAreaKey] ? newAreaConfigs[r.newAreaKey].displayName : r.area)
            : undefined,
          areaColor: (r.areaIsNew && r.newAreaKey && newAreaConfigs[r.newAreaKey]) ? newAreaConfigs[r.newAreaKey].color : undefined,
          areaFrequencyWeeks: (r.areaIsNew && r.newAreaKey && newAreaConfigs[r.newAreaKey]) ? newAreaConfigs[r.newAreaKey].frequencyWeeks : undefined,
          email: r.email || undefined,
          phone: r.phone || undefined,
          notes: r.notes || undefined,
          jobName: r.jobName || undefined,
          nextDueDate: r.nextDueDate || undefined,
          preferredPaymentMethod: r.preferredPaymentMethod || undefined,
          advanceNotice: r.advanceNotice === "true",
          frequencyWeeks: r.frequencyWeeks ? parseInt(r.frequencyWeeks, 10) || undefined : undefined,
          slip: r.slip,
          lastCompletedDate: r.lastCompletedDate || undefined,
          tags: r.tags.length ? r.tags : undefined,
          active: r.active,
        })),
        {
          createMissingAreas: forceName || createMissingAreas || valid.some((r) => r.areaIsNew),
          existingMode,
          matchField,
          bookRuns: bookRuns && previewHasDates,
        }
      );
      let historyCreated = 0;
      let historyErrors: Array<{ row: number; message: string }> = [];
      if (importHistory && validHistory.length > 0) {
        const hResult = await bulkImportJobHistory(
          validHistory.map((r) => ({
            customerName: r.customerName,
            address: r.address || undefined,
            date: r.date,
            price: r.price ? parseFloat(r.price) : undefined,
            paid: r.paid ? parseFloat(r.paid) : undefined,
            paymentMethod: r.paymentMethod || undefined,
            notes: r.notes || undefined,
          })),
          { matchField }
        );
        historyCreated = hResult.created;
        historyErrors = hResult.errors;
      }
      const skipped = preview.filter((r) => r.errors.length > 0);
      const skippedHistory = historyPreview.filter((r) => r.errors.length > 0);
      setImportResult({
        created: result.created,
        updated: result.updated,
        skippedExisting: result.skipped,
        areasCreated: result.areasCreated,
        runsBooked: result.runsBooked,
        historyCreated,
        errors: [
          ...skipped.map((r) => ({ row: r.index, message: r.errors.join("; ") })),
          ...result.errors,
        ],
        historyErrors: [
          ...skippedHistory.map((r) => ({ row: r.index, message: r.errors.join("; ") })),
          ...historyErrors,
        ],
      });
      setStep(3);
    });
  };

  // ── Template download ─────────────────────────────────────────────────────────

  const downloadTemplate = () => {
    const csv = TEMPLATE_HEADERS + "\n" + TEMPLATE_SAMPLE;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "customer-import-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Inline row edit helpers ───────────────────────────────────────────────────

  const openRowEdit = (row: PreviewRow) => {
    setEditingRowIndex(row.index);
    setEditingRowData({ name: row.name, address: row.address, price: row.price, areaId: row.areaId, area: row.area, areaIsNew: row.areaIsNew, newAreaKey: row.newAreaKey });
  };

  const commitRowEdit = () => {
    if (editingRowIndex === null) return;
    setPreview((prev) => prev.map((row) => {
      if (row.index !== editingRowIndex) return row;
      const address = editingRowData.address ?? row.address;
      const name = (editingRowData.name ?? row.name).trim() || firstAddressLine(address);
      const priceStr = editingRowData.price ?? row.price;
      const areaId = editingRowData.areaId !== undefined ? editingRowData.areaId : row.areaId;
      const area = editingRowData.area !== undefined ? editingRowData.area : row.area;
      const areaIsNew = editingRowData.areaIsNew !== undefined ? editingRowData.areaIsNew : row.areaIsNew;
      const newAreaKey = editingRowData.newAreaKey !== undefined ? editingRowData.newAreaKey : row.newAreaKey;
      const errors: string[] = [];
      if (!name.trim()) errors.push("Name is required");
      if (!address.trim()) errors.push("Address is required");
      const price = parseFloat(priceStr);
      if (!priceStr.trim() || isNaN(price) || price < 0) errors.push("Invalid price");
      if (!areaId && !areaIsNew) errors.push(`Area "${area}" not found`);
      const addressParts = address === row.address ? row.addressParts : null;
      return { ...row, name, address, addressParts, price: priceStr, areaId, area, areaIsNew, newAreaKey, errors };
    }));
    setEditingRowIndex(null);
    setEditingRowData({});
  };
  // Area names in the file that don't exist yet and aren't already set to be created:
  // offered in the row editor so one can be made without re-running the import.
  const unknownFileAreas = (() => {
    const known = new Set(areas.map((a) => a.name.toLowerCase()));
    Object.values(newAreaConfigs).forEach((c) => known.add(c.displayName.toLowerCase()));
    const names = new Map<string, string>();
    preview.forEach((r) => {
      const name = r.area.trim();
      if (name && !known.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    });
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  })();
  const validCount = preview.filter((r) => r.errors.length === 0).length;
  const datesMapped = ["lastCompletedDate", "nextDueDate"].some((k) => mappings[k] && mappings[k].source !== "skip");
  const previewHasDates = preview.some((r) => r.errors.length === 0 && (r.nextDueDate || r.lastCompletedDate));
  const newAreaCount = preview.filter((r) => r.errors.length === 0 && r.areaIsNew).length;
  const uniqueNewAreaCount = Object.keys(newAreaConfigs).length;
  const errorCount = preview.filter((r) => r.errors.length > 0).length;
  const historyValidCount = historyPreview.filter((r) => r.errors.length === 0).length;
  const historyErrorCount = historyPreview.filter((r) => r.errors.length > 0).length;

  const filteredPreview = errorsOnly ? preview.filter((r) => r.errors.length > 0) : preview;
  const previewPageCount = Math.max(1, Math.ceil(filteredPreview.length / PAGE_SIZE));
  const pagedPreview = filteredPreview.slice(previewPage * PAGE_SIZE, (previewPage + 1) * PAGE_SIZE);

  const filteredHistory = historyErrorsOnly ? historyPreview.filter((r) => r.errors.length > 0) : historyPreview;
  const historyPageCount = Math.max(1, Math.ceil(filteredHistory.length / PAGE_SIZE));
  const pagedHistory = filteredHistory.slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    // Matching and checking rows use the full width; upload and the finish page stay narrow.
    <div className={cn("px-4 py-5 mx-auto space-y-5", step === 1 || step === 2 ? "max-w-none" : "max-w-3xl")}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/customers" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
          <ChevronLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-800">Import Customers</h1>
          <p className="text-xs text-slate-500 mt-0.5">Upload your spreadsheet (.xlsx or .csv) as it is</p>
        </div>
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <Download size={14} />
          Template CSV
        </button>
      </div>

      {GUIDED_IMPORT_ENABLED && (
        <Link href="/customers/import/guided" className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 hover:bg-blue-100">
          <span><b>Messy spreadsheet?</b> Try the guided import: we work out your columns, tidy the data and suggest areas.</span>
          <span className="flex-shrink-0 font-semibold">Try it →</span>
        </Link>
      )}

      {SMART_IMPORT_ENABLED && (
        <Link href="/customers/import/smart" className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 hover:bg-blue-100">
          <span><b>Smart import:</b> upload your list in any layout (or from another program). Wyndos works out the columns and shows you a preview first.</span>
          <span className="flex-shrink-0 font-semibold text-blue-700">Try it →</span>
        </Link>
      )}
      <Link href="/customers/import/cleanerplanner" className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 hover:bg-slate-50">
        <span><b>Moving from CleanerPlanner?</b> Upload your CleanerPlanner backup and bring customers, rounds, due dates and balances across.</span>
        <span className="flex-shrink-0 font-semibold text-blue-700">Start →</span>
      </Link>

      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {["Upload", "Map Columns", "Preview", "Done"].map((label, i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 flex-shrink-0",
              step > i ? "bg-green-600 border-green-600 text-white" :
              step === i ? "bg-blue-600 border-blue-600 text-white" :
              "bg-white border-slate-200 text-slate-400"
            )}>
              {step > i ? <Check size={13} /> : i + 1}
            </div>
            <span className={cn(
              "ml-1.5 text-xs font-medium whitespace-nowrap",
              step === i ? "text-blue-700" : step > i ? "text-green-700" : "text-slate-400"
            )}>{label}</span>
            {i < 3 && <div className={cn("flex-1 h-px mx-2", step > i ? "bg-green-300" : "bg-slate-200")} />}
          </div>
        ))}
      </div>

      {/* ── Step 0: Upload ────────────────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-4">
          <div
            className={cn(
              "border-2 border-dashed rounded-2xl p-10 text-center transition-colors cursor-pointer",
              dragOver ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-blue-300 hover:bg-slate-50"
            )}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={36} className={cn("mx-auto mb-3", dragOver ? "text-blue-500" : "text-slate-300")} />
            <p className="text-sm font-semibold text-slate-600">Drop your spreadsheet here, or tap to choose (.xlsx, .xls or .csv)</p>
            <p className="text-xs text-slate-400 mt-1">Headers must be on the first row · UTF-8 encoding</p>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) ingestFile(f); }} />
          </div>

          {parseError && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle size={15} className="flex-shrink-0" />
              {parseError}
            </div>
          )}

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Expected columns</p>
            <div className="flex flex-wrap gap-1.5">
              {FIELDS.map((f) => (
                <span key={f.key} className={cn(
                  "px-2 py-0.5 rounded-full text-xs font-medium",
                  f.required ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                )}>
                  {f.label}{f.required && " *"}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">* Required. Download the template for a ready-to-fill example.</p>
          </div>
        </div>
      )}

      {/* ── Step 1: Column Mapping ────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              <strong>{rows.length}</strong> customers detected · <strong>{headers.length}</strong> columns.
              {ignoredRows > 0 && <> {ignoredRows} blank or total row{ignoredRows === 1 ? "" : "s"} ignored.</>}
              Map each field below.
            </p>
            <button onClick={() => setStep(0)} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
              <ChevronLeft size={13} /> Re-upload
            </button>
          </div>

          {/* Import options */}
          <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Import options</p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={createMissingAreas}
                onChange={(e) => setCreateMissingAreas(e.target.checked)}
                className="mt-0.5 accent-blue-600"
              />
              <div>
                <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <Sparkles size={13} className="text-amber-500" />
                  Create new areas automatically
                </span>
                <p className="text-xs text-slate-500 mt-0.5">
                  If a row's area name doesn't match any existing area, a new area will be created with default settings.
                  You can adjust it afterwards in Areas.
                </p>
              </div>
            </label>
            <div className="flex items-start gap-3">
              <RefreshCw size={15} className="mt-0.5 flex-shrink-0 text-blue-500" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-semibold text-slate-700">Customers already in Wyndos</span>
                <p className="text-xs text-slate-500 mt-0.5">
                  Running the import again? Choose what happens to rows that match someone you already have.
                  New customers in the file are always added.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {([
                    { v: "skip", title: "Leave them alone", desc: "Only add customers who aren't in yet." },
                    { v: "fill", title: "Fill in missing details", desc: "Adds phone, email, postcode etc. only where blank. Area, price, dates and the schedule don't change." },
                    { v: "overwrite", title: "Overwrite their details", desc: "Replaces details from the file, including area and price. Can change their booked days." },
                  ] as const).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setExistingMode(o.v)}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-left transition-colors",
                        existingMode === o.v ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-slate-200 bg-white hover:border-blue-300"
                      )}
                    >
                      <span className={cn("block text-xs font-bold", o.v === "overwrite" ? "text-amber-700" : "text-slate-800")}>
                        {o.title}{o.v === "fill" ? " (safe)" : ""}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{o.desc}</span>
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="text-xs text-slate-500">Match by</span>
                  {(["name", "nameAddress"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setMatchField(v)}
                      className={cn(
                        "px-3 py-1 text-xs font-semibold rounded-lg border transition-colors",
                        matchField === v
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                      )}
                    >
                      {v === "name" ? "Name" : "Name + address"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {datesMapped && (
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bookRuns}
                  onChange={(e) => setBookRuns(e.target.checked)}
                  className="mt-0.5 accent-blue-600"
                />
                <div>
                  <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                    <CalendarPlus size={13} className="text-blue-600" />
                    Put areas on the schedule from these dates
                  </span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Last Cleaned starts each customer&apos;s cycle (next due = last cleaned + the area&apos;s frequency, unless you give Next Due).
                    Each area&apos;s next run is booked on the earliest date someone in it is due, or today if that&apos;s passed.
                    Areas already booked are left alone. No past cleans are added.
                  </p>
                </div>
              </label>
            )}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={startFresh}
                onChange={(e) => { setStartFresh(e.target.checked); setConfirmFreshText(""); }}
                className="mt-0.5 accent-red-600"
              />
              <div>
                <span className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
                  <Trash2 size={13} className="text-red-500" />
                  Start fresh — delete all existing customers first
                </span>
                <p className="text-xs text-slate-500 mt-0.5">
                  All existing customers (and their job &amp; payment history) will be permanently deleted before the import runs.
                </p>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={importHistory}
                onChange={(e) => setImportHistory(e.target.checked)}
                className="mt-0.5 accent-blue-600"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <Clock size={13} className="text-slate-500" />
                  Import job history (optional second CSV)
                </span>
                <p className="text-xs text-slate-500 mt-0.5">
                  Upload a separate CSV of past cleans. Each row creates a completed job and optional payment record.
                </p>
                {importHistory && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-600">
                        {historyRows.length > 0
                          ? `${historyRows.length} history rows loaded`
                          : "Upload history CSV"}
                      </p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const blob = new Blob([HISTORY_TEMPLATE_CSV], { type: "text/csv" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url; a.download = "job-history-template.csv"; a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600 border border-slate-200 rounded-lg px-2 py-1 hover:bg-slate-50"
                      >
                        <Download size={11} /> Template
                      </button>
                    </div>
                    <div
                      onClick={(e) => { e.stopPropagation(); historyFileRef.current?.click(); }}
                      onDragOver={(e) => { e.preventDefault(); setHistoryDragOver(true); }}
                      onDragLeave={() => setHistoryDragOver(false)}
                      onDrop={(e) => { e.preventDefault(); setHistoryDragOver(false); const f = e.dataTransfer.files[0]; if (f) ingestHistoryFile(f); }}
                      className={cn(
                        "border-2 border-dashed rounded-xl p-4 text-center text-xs cursor-pointer transition-colors",
                        historyRows.length > 0 ? "border-green-300 bg-green-50 text-green-700" :
                        historyDragOver ? "border-blue-400 bg-blue-50 text-blue-600" :
                        "border-slate-200 hover:border-blue-300 hover:bg-slate-50 text-slate-500"
                      )}
                    >
                      {historyRows.length > 0
                        ? <span className="flex items-center justify-center gap-1.5"><CheckCircle2 size={13} /> {historyRows.length} rows ready — click to replace</span>
                        : <span className="flex items-center justify-center gap-1.5"><Upload size={13} /> Drop or click to upload history CSV</span>}
                      <input ref={historyFileRef} type="file" accept=".csv" className="hidden"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) ingestHistoryFile(f); }} />
                    </div>
                    {historyParseError && (
                      <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={11} />{historyParseError}</p>
                    )}
                    {historyRows.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        {HISTORY_FIELDS.map((hf) => (
                          <div key={hf.key} className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                              {hf.label}{hf.required && <span className="text-red-500">*</span>}
                            </label>
                            <select
                              value={historyMappings[hf.key] ?? ""}
                              onChange={(e) => setHistoryMappings((m) => ({ ...m, [hf.key]: e.target.value }))}
                              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                              <option value="">— skip —</option>
                              {historyHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </label>
          </div>

          <div className="space-y-3">
            {FIELDS.map((field) => {
              const cfg = mappings[field.key] ?? { source: "skip" };
              return (
                <div key={field.key} className="border border-slate-200 rounded-xl p-3.5 space-y-3 bg-white">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{field.label}</span>
                      {field.required && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">Required</span>}
                      {field.key === "name" && (
                        <label className="flex items-center gap-1.5 text-xs text-slate-600">
                          <input type="checkbox" checked={nameFromAddress} onChange={(e) => setNameFromAddress(e.target.checked)} className="accent-blue-600" />
                          If blank, use first line of address
                        </label>
                      )}
                    </div>
                    {/* Source selector */}
                    <div className="flex gap-1">
                      {(["column", "concat", "fixed", "skip"] as SourceType[]).map((src) => {
                        if (field.type === "area" && src === "concat") return null;
                        const labels: Record<SourceType, string> = {
                          column: "Column", concat: "Concat", fixed: "Fixed", skip: "Skip",
                        };
                        return (
                          <button key={src} onClick={() => setMapping(field.key, { source: src })}
                            className={cn(
                              "px-2 py-1 text-[11px] font-semibold rounded-lg border transition-colors",
                              cfg.source === src
                                ? "border-blue-600 bg-blue-600 text-white"
                                : "border-slate-200 text-slate-500 hover:border-blue-300"
                            )}>
                            {labels[src]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Column source: single column picker (not area — handled below) */}
                  {cfg.source === "column" && field.type !== "area" && (
                    <select
                      value={cfg.column ?? ""}
                      onChange={(e) => setMapping(field.key, { column: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— select column —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  )}

                  {/* Concat source: multi-column + separator */}
                  {cfg.source === "concat" && (
                    <div className="space-y-2">
                      {(cfg.columns ?? []).map((col, ci) => (
                        <div key={ci} className="flex gap-2 items-center">
                          <select
                            value={col}
                            onChange={(e) => setConcatCol(field.key, ci, e.target.value)}
                            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">— select column —</option>
                            {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                          </select>
                          <button onClick={() => removeConcatCol(field.key, ci)}
                            className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => addConcatCol(field.key)}
                          className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 px-2 py-1 rounded-lg border border-blue-200 hover:bg-blue-50"
                        >
                          <Plus size={11} /> Add column
                        </button>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-500">Separator:</span>
                          <input
                            type="text"
                            value={cfg.separator ?? " "}
                            onChange={(e) => setMapping(field.key, { separator: e.target.value })}
                            className="w-16 border border-slate-200 rounded px-2 py-1 text-xs text-center bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                            placeholder=" "
                          />
                        </div>
                        {(cfg.columns ?? []).length >= 2 && (
                          <span className="text-[11px] text-slate-400 italic">
                            Preview: {(cfg.columns ?? []).map((_, i) => `[col${i + 1}]`).join(cfg.separator ?? " ")}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Fixed source */}
                  {cfg.source === "fixed" && field.type !== "area" && field.type !== "boolean" && field.type !== "select" && (
                    <input
                      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                      value={cfg.value ?? ""}
                      onChange={(e) => setMapping(field.key, { value: e.target.value })}
                      placeholder={`Fixed value for ${field.label}`}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                  {cfg.source === "fixed" && field.type === "select" && (
                    <select
                      value={cfg.value ?? ""}
                      onChange={(e) => setMapping(field.key, { value: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {(field.options ?? []).map((o) => <option key={o} value={o}>{o || "— none —"}</option>)}
                    </select>
                  )}
                  {cfg.source === "fixed" && field.type === "boolean" && (
                    <div className="flex gap-2">
                      {["true", "false"].map((v) => (
                        <button key={v} onClick={() => setMapping(field.key, { value: v })}
                          className={cn(
                            "flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-colors",
                            (cfg.value ?? "false") === v ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300"
                          )}>
                          {v === "true" ? "Yes" : "No"}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Area: column = match by name; fixed = pick from list */}
                  {field.type === "area" && cfg.source === "column" && (
                    <div className="space-y-2">
                      <select
                        value={cfg.column ?? ""}
                        onChange={(e) => setMapping(field.key, { column: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">— select column —</option>
                        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <p className="text-[11px] text-slate-400">Column values will be matched to area names (case-insensitive).</p>
                    </div>
                  )}
                  {field.type === "area" && cfg.source === "fixed" && (
                    <div className="space-y-2">
                      {areas.length > 0 && (
                        <select
                          value={cfg.areaId ?? ""}
                          onChange={(e) => setMapping(field.key, { areaId: Number(e.target.value) || undefined })}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">— new area (type below) —</option>
                          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      )}
                      {!cfg.areaId && (
                        <input
                          type="text"
                          value={cfg.value ?? ""}
                          onChange={(e) => setMapping(field.key, { value: e.target.value })}
                          placeholder="New area name, e.g. Cuckney"
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      )}
                    </div>
                  )}

                  {/* Sample value preview for column / concat */}
                  {(cfg.source === "column" || cfg.source === "concat") && rows.length > 0 && field.type !== "area" && (
                    <p className="text-[11px] text-slate-400">
                      First row preview: <span className="font-mono text-slate-600">
                        "{resolveValue(rows[0], headers, cfg) || "—"}"
                      </span>
                    </p>
                  )}
                  {cfg.source === "column" && rows.length > 0 && field.type === "area" && cfg.column && (
                    <p className="text-[11px] text-slate-400">
                      First row: <span className="font-mono text-slate-600">"{resolveValue(rows[0], headers, cfg) || "—"}"</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={buildPreview} className="flex-1">
              Preview {rows.length} rows
              <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Preview ───────────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-3 flex-wrap">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-green-700">
                <CheckCircle2 size={15} /> {validCount} ready
              </span>
              {newAreaCount > 0 && (
                <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                  <Sparkles size={15} /> {uniqueNewAreaCount} new area{uniqueNewAreaCount !== 1 ? "s" : ""} to create ({newAreaCount} customer{newAreaCount !== 1 ? "s" : ""})
                </span>
              )}
              {updateExisting && (
                <span className="flex items-center gap-1.5 text-sm font-semibold text-blue-600">
                  <RefreshCw size={14} /> {existingMode === "fill" ? "customers already in Wyndos get missing details filled in" : "customers already in Wyndos will be overwritten"}
                </span>
              )}
              {errorCount > 0 && (
                <span className="flex items-center gap-1.5 text-sm font-semibold text-red-600">
                  <AlertCircle size={15} /> {errorCount} with errors (will be skipped)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {errorCount > 0 && (
                <button
                  onClick={() => { setErrorsOnly((v) => !v); setPreviewPage(0); }}
                  className={cn(
                    "text-xs flex items-center gap-1 px-2.5 py-1 rounded-lg border transition-colors",
                    errorsOnly
                      ? "bg-red-100 border-red-300 text-red-700 font-semibold"
                      : "border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-600"
                  )}
                >
                  <AlertCircle size={12} /> {errorsOnly ? "Show all" : "Errors only"}
                </button>
              )}
              <button onClick={() => setStep(1)} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                <ChevronLeft size={13} /> Back to mapping
              </button>
            </div>
          </div>

          {/* ── New areas to create ────────────────────────────────────────────── */}
          {Object.keys(newAreaConfigs).length > 0 && (
            <div className="border border-amber-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border-b border-amber-200">
                <Sparkles size={14} className="text-amber-600" />
                <span className="text-sm font-semibold text-amber-800">
                  {Object.keys(newAreaConfigs).length} new area{Object.keys(newAreaConfigs).length !== 1 ? "s" : ""} to be created
                </span>
                <span className="text-xs text-amber-600 ml-auto">Set colour and frequency before importing</span>
              </div>
              <div className="p-3 grid gap-3">
                {Object.values(newAreaConfigs).map((cfg) => (
                  <div key={cfg.key} className="bg-white rounded-lg border border-amber-200 p-3 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={cfg.displayName}
                        onChange={(e) => setNewAreaConfigs((prev) => ({ ...prev, [cfg.key]: { ...prev[cfg.key], displayName: e.target.value } }))}
                        className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
                      />
                      <span className="flex-shrink-0 text-xs text-slate-500 font-medium bg-slate-100 px-2 py-1 rounded-full">
                        {cfg.rowCount} customer{cfg.rowCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-slate-500 flex-shrink-0 w-14">Colour:</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {COLOUR_PALETTE.map((c) => (
                          <button
                            key={c}
                            onClick={() => setNewAreaConfigs((prev) => ({ ...prev, [cfg.key]: { ...prev[cfg.key], color: c } }))}
                            className={cn("w-5 h-5 rounded-full transition-transform border-2", cfg.color === c ? "border-slate-700 scale-125" : "border-transparent hover:scale-110")}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-slate-500 flex-shrink-0 w-14">Frequency:</span>
                      {[1, 2, 4, 8, 12, 26, 52].map((f) => (
                        <button
                          key={f}
                          onClick={() => setNewAreaConfigs((prev) => ({ ...prev, [cfg.key]: { ...prev[cfg.key], frequencyWeeks: f } }))}
                          className={cn(
                            "px-2 py-1 text-xs font-semibold rounded-lg border transition-colors",
                            cfg.frequencyWeeks === f ? "border-amber-600 bg-amber-600 text-white" : "border-slate-200 text-slate-600 hover:border-amber-300 hover:bg-amber-50"
                          )}
                        >
                          {f}w
                        </button>
                      ))}
                      <input
                        type="number"
                        min={1}
                        max={52}
                        value={cfg.frequencyWeeks}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) setNewAreaConfigs((prev) => ({ ...prev, [cfg.key]: { ...prev[cfg.key], frequencyWeeks: v } })); }}
                        className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs text-center bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
                      />
                      <span className="text-xs text-slate-500">weeks</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {startFresh && (
            <div className="border-2 border-red-400 rounded-xl p-4 bg-red-50 space-y-3">
              <p className="text-sm font-bold text-red-700 flex items-center gap-2">
                <Trash2 size={15} /> Warning: all existing customers will be permanently deleted
              </p>
              <p className="text-xs text-red-600">This cannot be undone. Type <strong>DELETE</strong> below to confirm, then click Import.</p>
              <input
                type="text"
                value={confirmFreshText}
                onChange={(e) => setConfirmFreshText(e.target.value)}
                placeholder="Type DELETE to confirm"
                className="w-full border-2 border-red-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-400 placeholder:text-red-300"
              />
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-500 w-8">#</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-500">Name</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-500">Address</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-500">Price</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-500">Area</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-500">Email</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-500">Phone</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-slate-500 w-40">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedPreview.map((row) => {
                  const isEditing = editingRowIndex === row.index;
                  return (
                  <Fragment key={row.index}>
                  <tr className={cn(
                    row.errors.length > 0 ? "bg-red-50" : "bg-white hover:bg-slate-50"
                  )}>
                    <td className="px-3 py-2 text-slate-400">{row.index}</td>
                    <td className="px-3 py-2 font-medium text-slate-800 max-w-[220px]">
                      {(
                        <span className="truncate block cursor-pointer hover:text-blue-700" onClick={() => openRowEdit(row)}>
                          {row.name || <span className="text-red-400 italic">missing</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600 max-w-[360px]">
                      {(
                        <span className="truncate block cursor-pointer hover:text-blue-700" onClick={() => openRowEdit(row)}>
                          {row.address || <span className="text-red-400 italic">missing</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {(
                        <span className="cursor-pointer hover:text-blue-700" onClick={() => openRowEdit(row)}>
                          {row.price ? `£${row.price}` : <span className="text-red-400 italic">—</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.areaIsNew ? (
                        <span className="flex items-center gap-1 text-amber-700 font-medium cursor-pointer" onClick={() => openRowEdit(row)}>
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: row.newAreaKey && newAreaConfigs[row.newAreaKey] ? newAreaConfigs[row.newAreaKey].color : "#F59E0B" }}
                          />
                          {row.newAreaKey && newAreaConfigs[row.newAreaKey] ? newAreaConfigs[row.newAreaKey].displayName : row.area}
                          <span className="text-[10px] text-amber-500 font-normal">(new)</span>
                        </span>
                      ) : row.areaId ? (
                        <span className="flex items-center gap-1 cursor-pointer hover:text-blue-700" onClick={() => openRowEdit(row)}>
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: areas.find(a => a.id === row.areaId)?.color || "#94a3b8" }} />
                          {row.area}
                        </span>
                      ) : <span className="text-red-400 italic cursor-pointer" onClick={() => openRowEdit(row)}>{row.area || "missing"}</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-500 max-w-[200px] truncate">{row.email || "—"}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {row.phone || "—"}
                      {row.noMobile && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800" title="Texts only go to UK mobiles (07…)">not a mobile</span>}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <span className="text-[10px] font-semibold text-blue-700">Editing…</span>
                      ) : row.errors.length > 0 ? (
                        <div className="space-y-0.5">
                          {row.errors.map((e, i) => (
                            <p key={i} className="text-red-600 font-medium">{e}</p>
                          ))}
                          <button onClick={() => openRowEdit(row)} className="text-[10px] text-blue-600 hover:underline mt-0.5">Edit row</button>
                        </div>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="text-green-600 font-semibold flex items-center gap-1"><Check size={11} /> OK</span>
                          <button onClick={() => openRowEdit(row)} className="text-[10px] text-blue-600 hover:underline">Edit</button>
                        </span>
                      )}
                    </td>
                  </tr>
                  {isEditing && (
                    // Edit this row in a form on its own line, so it fits any screen.
                    <tr className="bg-blue-50">
                      <td colSpan={8} className="px-3 py-3">
                        <div className="sticky left-3 w-[min(40rem,calc(100vw-4rem))] space-y-2">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <label className="block text-[11px] font-semibold text-slate-600">Name
                              <input
                          autoFocus
                          type="text"
                          value={editingRowData.name ?? row.name}
                          onChange={(e) => setEditingRowData((d) => ({ ...d, name: e.target.value }))}
                          className="w-full border border-blue-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                            </label>
                            <label className="block text-[11px] font-semibold text-slate-600">Price (£)
                              <input
                          type="number" step="0.01" min="0"
                          value={editingRowData.price ?? row.price}
                          onChange={(e) => setEditingRowData((d) => ({ ...d, price: e.target.value }))}
                          className="w-full border border-blue-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                            </label>
                            <label className="block text-[11px] font-semibold text-slate-600 sm:col-span-2">Address
                              <input
                          type="text"
                          value={editingRowData.address ?? row.address}
                          onChange={(e) => setEditingRowData((d) => ({ ...d, address: e.target.value }))}
                          className="w-full border border-blue-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                            </label>
                            <label className="block text-[11px] font-semibold text-slate-600 sm:col-span-2">Area
                              <select
                          value={(() => {
                            const isNew = editingRowData.areaIsNew ?? row.areaIsNew;
                            const key = editingRowData.newAreaKey !== undefined ? editingRowData.newAreaKey : row.newAreaKey;
                            if (isNew && key) return `new:${key}`;
                            return String(editingRowData.areaId ?? row.areaId ?? "");
                          })()}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v.startsWith("create:")) {
                              const name = v.slice(7);
                              const parsed = parseInt(row.frequencyWeeks, 10);
                              const freq = !isNaN(parsed) && parsed > 0 ? parsed : 4;
                              const key = `${name.toLowerCase()}|||${freq}`;
                              setNewAreaConfigs((prev) => prev[key] ? prev : {
                                ...prev,
                                [key]: { key, displayName: name, color: COLOUR_PALETTE[(areas.length + Object.keys(prev).length) % COLOUR_PALETTE.length], frequencyWeeks: freq, rowCount: 1 },
                              });
                              setEditingRowData((d) => ({ ...d, areaId: null, areaIsNew: true, newAreaKey: key, area: name }));
                              // Other rows with the same missing area join the new area too.
                              setPreview((prev) => prev.map((other) => (
                                other.index !== row.index && !other.areaId && !other.areaIsNew && other.area.trim().toLowerCase() === name.toLowerCase()
                                  ? { ...other, areaIsNew: true, newAreaKey: key, errors: other.errors.filter((e) => !e.startsWith("Area ")) }
                                  : other
                              )));
                              return;
                            }
                            if (v.startsWith("new:")) {
                              const key = v.slice(4);
                              setEditingRowData((d) => ({ ...d, areaId: null, areaIsNew: true, newAreaKey: key, area: newAreaConfigs[key]?.displayName ?? key }));
                              return;
                            }
                            const id = Number(v) || null;
                            const name = areas.find((a) => a.id === id)?.name ?? "";
                            setEditingRowData((d) => ({ ...d, areaId: id, areaIsNew: false, newAreaKey: null, area: name }));
                          }}
                          className="w-full border border-blue-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        >
                          <option value="">— select area —</option>
                          {areas.length > 0 && (
                            <optgroup label="Your areas">
                              {[...areas].sort((a, b) => a.name.localeCompare(b.name)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </optgroup>
                          )}
                          {unknownFileAreas.length > 0 && (
                            <optgroup label="Create as a new area">
                              {unknownFileAreas.map((name) => (
                                <option key={name} value={`create:${name}`}>+ {name}</option>
                              ))}
                            </optgroup>
                          )}
                          {Object.keys(newAreaConfigs).length > 0 && (
                            <optgroup label="New areas from this file">
                              {Object.values(newAreaConfigs).sort((a, b) => a.displayName.localeCompare(b.displayName)).map((c) => (
                                <option key={c.key} value={`new:${c.key}`}>{c.displayName} (new)</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                            </label>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={commitRowEdit} className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Save row</button>
                            <button onClick={() => { setEditingRowIndex(null); setEditingRowData({}); }} className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {previewPageCount > 1 && (
            <div className="flex items-center justify-between text-xs text-slate-500 px-1 select-none">
              <span>
                Showing {previewPage * PAGE_SIZE + 1}–{Math.min((previewPage + 1) * PAGE_SIZE, filteredPreview.length)} of {filteredPreview.length}{errorsOnly ? " (errors only)" : ""}
              </span>
              <div className="flex items-center gap-1">
                <button disabled={previewPage === 0} onClick={() => setPreviewPage(0)} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-slate-100">«</button>
                <button disabled={previewPage === 0} onClick={() => setPreviewPage((p) => p - 1)} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-slate-100">‹</button>
                <span className="px-2 font-medium">Page {previewPage + 1} / {previewPageCount}</span>
                <button disabled={previewPage >= previewPageCount - 1} onClick={() => setPreviewPage((p) => p + 1)} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-slate-100">›</button>
                <button disabled={previewPage >= previewPageCount - 1} onClick={() => setPreviewPage(previewPageCount - 1)} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-slate-100">»</button>
              </div>
            </div>
          )}

          {importHistory && historyPreview.length > 0 && (
            <details className="border border-slate-200 rounded-xl overflow-hidden" open={historyErrorCount > 0}>
              <summary className="flex items-center justify-between gap-2 px-4 py-3 bg-slate-50 cursor-pointer text-sm font-semibold text-slate-700 hover:bg-slate-100">
                <span className="flex items-center gap-2">
                  <Clock size={14} className="text-slate-500" />
                  Job history: {historyValidCount} rows ready{historyErrorCount > 0 ? `, ${historyErrorCount} with errors` : ""}
                </span>
                {historyErrorCount > 0 && (
                  <button
                    onClick={(e) => { e.preventDefault(); setHistoryErrorsOnly((v) => !v); setHistoryPage(0); }}
                    className={cn(
                      "text-xs flex items-center gap-1 px-2.5 py-1 rounded-lg border transition-colors",
                      historyErrorsOnly
                        ? "bg-red-100 border-red-300 text-red-700 font-semibold"
                        : "border-slate-200 text-slate-400 hover:border-red-300 hover:text-red-600"
                    )}
                  >
                    <AlertCircle size={12} /> {historyErrorsOnly ? "Show all" : "Errors only"}
                  </button>
                )}
              </summary>
              <div className="overflow-x-auto">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2 text-left font-semibold text-slate-500 w-8">#</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Customer</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Date</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Price</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Paid</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Method</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500 w-36">Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pagedHistory.map((row) => (
                      <tr key={row.index} className={cn(row.errors.length > 0 ? "bg-red-50" : "bg-white hover:bg-slate-50")}>
                        <td className="px-3 py-2 text-slate-400">{row.index}</td>
                        <td className="px-3 py-2 font-medium text-slate-800 max-w-[120px] truncate">{row.customerName || <span className="text-red-400 italic">missing</span>}</td>
                        <td className="px-3 py-2 text-slate-600 font-mono">{row.date || <span className="text-red-400 italic">—</span>}</td>
                        <td className="px-3 py-2 text-slate-700">{row.price ? `£${row.price}` : <span className="text-slate-400">—</span>}</td>
                        <td className="px-3 py-2 text-slate-700">{row.paid ? `£${row.paid}` : <span className="text-slate-400">—</span>}</td>
                        <td className="px-3 py-2 text-slate-500">{row.paymentMethod || "—"}</td>
                        <td className="px-3 py-2">
                          {row.errors.length > 0
                            ? row.errors.map((e, i) => <p key={i} className="text-red-600 font-medium">{e}</p>)
                            : <span className="text-green-600 font-semibold flex items-center gap-1"><Check size={11} /> OK</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {historyPageCount > 1 && (
                <div className="flex items-center justify-between text-xs text-slate-500 px-3 py-2 border-t border-slate-100 select-none">
                  <span>
                    Showing {historyPage * PAGE_SIZE + 1}–{Math.min((historyPage + 1) * PAGE_SIZE, filteredHistory.length)} of {filteredHistory.length}{historyErrorsOnly ? " (errors only)" : ""}
                  </span>
                  <div className="flex items-center gap-1">
                    <button disabled={historyPage === 0} onClick={() => setHistoryPage(0)} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-slate-100">«</button>
                    <button disabled={historyPage === 0} onClick={() => setHistoryPage((p) => p - 1)} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-slate-100">‹</button>
                    <span className="px-2 font-medium">Page {historyPage + 1} / {historyPageCount}</span>
                    <button disabled={historyPage >= historyPageCount - 1} onClick={() => setHistoryPage((p) => p + 1)} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-slate-100">›</button>
                    <button disabled={historyPage >= historyPageCount - 1} onClick={() => setHistoryPage(historyPageCount - 1)} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-slate-100">»</button>
                  </div>
                </div>
              )}
            </details>
          )}

          {validCount === 0 ? (
            <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
              <AlertCircle size={15} />
              No valid rows to import. Fix the mapping or correct your spreadsheet and re-upload.
            </div>
          ) : (
            <Button
              onClick={handleImport}
              disabled={isPending || (startFresh && confirmFreshText !== "DELETE")}
              className="w-full" size="lg"
            >
              {isPending ? "Importing…" : [
                updateExisting ? "Import / update" : "Import",
                ` ${validCount} customer${validCount !== 1 ? "s" : ""}`,
                uniqueNewAreaCount > 0 ? ` · create ${uniqueNewAreaCount} area${uniqueNewAreaCount !== 1 ? "s" : ""}` : "",
                importHistory && historyValidCount > 0 ? ` · ${historyValidCount} history row${historyValidCount !== 1 ? "s" : ""}` : "",
                errorCount > 0 ? ` (${errorCount} skipped)` : "",
              ].join("")}
            </Button>
          )}
        </div>
      )}

      {/* ── Step 3: Done ─────────────────────────────────────────────────────── */}
      {step === 3 && importResult && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 size={36} className="text-green-600" />
            </div>
            <div className="space-y-1">
              {importResult.created > 0 && (
                <p className="text-sm text-slate-600">
                  <span className="text-2xl font-bold text-slate-800">{importResult.created}</span>{" "}
                  customer{importResult.created !== 1 ? "s" : ""} created
                </p>
              )}
              {importResult.updated > 0 && (
                <p className="text-sm text-slate-600">
                  <span className="text-2xl font-bold text-blue-700">{importResult.updated}</span>{" "}
                  customer{importResult.updated !== 1 ? "s" : ""} updated
                </p>
              )}
              {importResult.skippedExisting > 0 && (
                <p className="text-sm text-slate-600">
                  <span className="text-2xl font-bold text-slate-500">{importResult.skippedExisting}</span>{" "}
                  already in Wyndos, left as they were
                </p>
              )}
              {importResult.areasCreated.length > 0 && (
                <p className="text-sm text-amber-700 font-medium flex items-center justify-center gap-1.5 mt-1">
                  <Sparkles size={14} />
                  New areas created: {importResult.areasCreated.join(", ")}
                </p>
              )}
              {importResult.runsBooked.length > 0 && (
                <div className="mx-auto mt-1 max-w-sm rounded-lg bg-blue-50 px-3 py-2 text-left text-sm text-blue-800">
                  <p className="font-semibold">Runs booked on the schedule</p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {importResult.runsBooked.map((r) => (
                      <li key={r.area} className="flex justify-between gap-3">
                        <span className="truncate">{r.area}</span>
                        <span className="flex-shrink-0">{new Date(r.date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {importResult.historyCreated > 0 && (
                <p className="text-sm text-slate-600">
                  <span className="text-2xl font-bold text-slate-700">{importResult.historyCreated}</span>{" "}
                  history record{importResult.historyCreated !== 1 ? "s" : ""} imported
                </p>
              )}
            </div>
          </div>

          {AREA_SORT_ENABLED && <a href="/customers/organise" className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 hover:bg-blue-100">
            <span><b>Sort them into areas</b> · a few quick questions and we&apos;ll suggest a day&apos;s work for each area</span>
            <span className="font-semibold">Go →</span>
          </a>}

          {importResult.errors.length > 0 && (
            <div className="border border-red-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border-b border-red-200">
                <AlertCircle size={14} className="text-red-500" />
                <span className="text-sm font-semibold text-red-700">{importResult.errors.length} row{importResult.errors.length !== 1 ? "s" : ""} skipped</span>
              </div>
              <ul className="divide-y divide-red-100 max-h-48 overflow-y-auto">
                {importResult.errors.map((e, i) => (
                  <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="text-xs text-red-400 font-mono w-8 flex-shrink-0">#{e.row}</span>
                    <span className="text-xs text-red-700">{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {importResult.historyErrors.length > 0 && (
            <div className="border border-orange-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-orange-50 border-b border-orange-200">
                <Clock size={14} className="text-orange-500" />
                <span className="text-sm font-semibold text-orange-700">{importResult.historyErrors.length} history row{importResult.historyErrors.length !== 1 ? "s" : ""} skipped</span>
              </div>
              <ul className="divide-y divide-orange-100 max-h-48 overflow-y-auto">
                {importResult.historyErrors.map((e, i) => (
                  <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="text-xs text-orange-400 font-mono w-8 flex-shrink-0">#{e.row}</span>
                    <span className="text-xs text-orange-700">{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <Link href="/customers" className="flex-1">
              <Button variant="outline" className="w-full">
                <FileText size={15} />
                View Customers
              </Button>
            </Link>
            <Button
              onClick={() => { setStep(0); setHeaders([]); setRows([]); setPreview([]); setImportResult(null); setHistoryHeaders([]); setHistoryRows([]); setHistoryPreview([]); setConfirmFreshText(""); }}
              variant="outline"
              className="flex-1"
            >
              <Upload size={15} />
              Import Another File
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
