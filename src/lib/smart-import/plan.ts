/**
 * Smart import: the reading plan and how it's applied. Pure code, used in the browser
 * (to build the preview from every row) and on the server (to check what the AI sent).
 *
 * The AI never sees the whole file and never writes customer records. It only returns a
 * plan: which columns hold what, how to read dates, frequencies and payment words. The
 * plan is checked here and then applied to every row by ordinary code.
 */

import { composeAddress } from "@/lib/address";
import { fixUkPhone } from "@/lib/text-format";
import { normalisePaymentMethod, parsePrice } from "@/lib/import-parsing";

export const PLAN_FIELDS = [
  "name", "fullAddress", "houseNumber", "street", "town", "postcode", "phone", "email",
  "price", "frequency", "lastCleaned", "nextDue", "notes", "payment", "area", "status", "jobName",
] as const;
export type PlanField = (typeof PLAN_FIELDS)[number];

export const PAY_METHODS = ["CASH", "BACS", "CARD", "DD", "INVOICE", ""] as const;

export type ImportPlan = {
  /** What the file is. Only "customers" can be imported here. */
  kind: "customers" | "job_history" | "not_customers";
  /** Row (0-based) holding the column headings; -1 when there are none. */
  headerRow: number;
  /** First row (0-based) with a customer in it. */
  firstDataRow: number;
  /** For each field, the columns (0-based) that hold it, joined in this order. */
  columns: Record<PlanField, number[]>;
  dateOrder: "DMY" | "MDY" | "YMD";
  frequencyMap: Array<{ text: string; weeks: number }>;
  defaultFrequencyWeeks: number;
  paymentMap: Array<{ text: string; method: (typeof PAY_METHODS)[number] }>;
  /** Values in the status column that mean the customer has stopped / is inactive. */
  inactiveValues: string[];
  /** Area to use when the file has none for a row. */
  defaultArea: string;
  summary: string;
  warnings: string[];
  /** The owner's feedback wasn't about reading this file (it was ignored). */
  feedbackOffTopic: boolean;
};

const clip = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

/** Check and tidy a plan (from the AI or anywhere else). Anything odd is dropped, never trusted. */
export function cleanPlan(raw: unknown, columnCount: number, rowCount: number): ImportPlan {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cols = (r.columns && typeof r.columns === "object" ? r.columns : {}) as Record<string, unknown>;
  const columns = Object.fromEntries(PLAN_FIELDS.map((f) => {
    const list = Array.isArray(cols[f]) ? (cols[f] as unknown[]) : cols[f] == null ? [] : [cols[f]];
    const ok = [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < columnCount))].slice(0, 8);
    return [f, ok];
  })) as Record<PlanField, number[]>;
  const int = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  const headerRow = int(r.headerRow, -1, Math.min(rowCount - 1, 50), 0);
  return {
    kind: r.kind === "job_history" || r.kind === "not_customers" ? r.kind : "customers",
    headerRow,
    firstDataRow: int(r.firstDataRow, 0, Math.min(rowCount, 60), headerRow + 1),
    columns,
    dateOrder: r.dateOrder === "MDY" || r.dateOrder === "YMD" ? r.dateOrder : "DMY",
    frequencyMap: (Array.isArray(r.frequencyMap) ? r.frequencyMap : []).slice(0, 80).flatMap((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      const weeks = Number(o.weeks);
      const text = clip(o.text, 40).toLowerCase();
      return text && Number.isInteger(weeks) && weeks >= 1 && weeks <= 52 ? [{ text, weeks }] : [];
    }),
    defaultFrequencyWeeks: int(r.defaultFrequencyWeeks, 1, 52, 4),
    paymentMap: (Array.isArray(r.paymentMap) ? r.paymentMap : []).slice(0, 80).flatMap((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      const text = clip(o.text, 40).toLowerCase();
      const method = String(o.method ?? "");
      return text && (PAY_METHODS as readonly string[]).includes(method) ? [{ text, method: method as ImportPlan["paymentMap"][number]["method"] }] : [];
    }),
    inactiveValues: (Array.isArray(r.inactiveValues) ? r.inactiveValues : []).slice(0, 30).map((v) => clip(v, 40).toLowerCase()).filter(Boolean),
    defaultArea: clip(r.defaultArea, 60) || "Imported",
    summary: clip(r.summary, 600),
    warnings: (Array.isArray(r.warnings) ? r.warnings : []).slice(0, 6).map((w) => clip(w, 200)).filter(Boolean),
    feedbackOffTopic: r.feedbackOffTopic === true,
  };
}

export type SmartRow = {
  /** Row number in the file, counting from 1 as a spreadsheet does. */
  sheetRow: number;
  name: string;
  address: string;
  houseNameNumber: string;
  street: string;
  town: string;
  postcode: string;
  phone: string;
  email: string;
  price: number | null;
  frequencyWeeks: number | null;
  nextDueDate: string;
  lastCompletedDate: string;
  notes: string;
  preferredPaymentMethod: string;
  area: string;
  jobName: string;
  active: boolean;
  problems: string[];
};

const pad = (n: number) => String(n).padStart(2, "0");
function isoOf(y: number, m: number, d: number) {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : "";
}

/** A date in the plan's order (also ISO, Excel serial numbers and "12 Mar 2026"). "" if it isn't one. */
export function readDate(value: string, order: ImportPlan["dateOrder"]): string {
  const v = value.trim();
  if (!v) return "";
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return order === "MDY" ? isoOf(+m[3], +m[1], +m[2]) : isoOf(+m[3], +m[2], +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const n = Math.floor(Number(v));
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = v.toLowerCase().match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{2,4})/);
  if (m && months.includes(m[2])) return isoOf(+m[3], months.indexOf(m[2]) + 1, +m[1]);
  return "";
}

/** Weeks between cleans from words like "4", "4w", "monthly", "8 weekly", "2 months". */
export function readFrequency(value: string, plan: ImportPlan): number | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const mapped = plan.frequencyMap.find((e) => e.text === v);
  if (mapped) return mapped.weeks;
  if (/fortnight/.test(v)) return 2;
  if (/^(weekly|every week)$/.test(v)) return 1;
  if (/^(monthly|every month)$/.test(v)) return 4;
  let m = v.match(/(\d+(?:\.\d+)?)\s*(?:m|mo|mon|month|months|monthly)\b/);
  if (m) return Math.min(52, Math.max(1, Math.round(Number(m[1]) * 4)));
  m = v.match(/(\d+)/);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 52 ? n : null;
  }
  return null;
}

/** Turn every row of the file into a customer using the plan. */
export function applyPlan(grid: string[][], plan: ImportPlan): SmartRow[] {
  const out: SmartRow[] = [];
  const cell = (row: string[], i: number) => String(row[i] ?? "").trim();
  const get = (row: string[], f: PlanField, sep: string) =>
    plan.columns[f].map((i) => cell(row, i)).filter(Boolean).join(sep);
  const first = (row: string[], f: PlanField) => plan.columns[f].map((i) => cell(row, i)).find(Boolean) ?? "";

  for (let r = Math.max(plan.firstDataRow, plan.headerRow + 1); r < grid.length; r++) {
    const row = grid[r] ?? [];
    const filled = row.map((c) => String(c ?? "").trim()).filter(Boolean);
    if (filled.length === 0) continue;
    if (/^(total|totals|sub ?total)$/i.test(filled[0]) || (filled.length === 1 && /^£?\s*[\d,]+(\.\d+)?$/.test(filled[0]))) continue;

    const houseNameNumber = get(row, "houseNumber", " ");
    const street = get(row, "street", " ");
    const town = get(row, "town", ", ");
    const postcode = get(row, "postcode", " ").toUpperCase();
    const parts = { houseNameNumber, street, town, postcode };
    const address = get(row, "fullAddress", ", ") || composeAddress(parts);
    // Blank-ish names ("Mr", "-", "n/a", "?") count as no name: use the first line of the address.
    let name = get(row, "name", " ").replace(/^(mr|mrs|ms|miss|dr)\.?$/i, "").replace(/^[-–?.\s]*$|^(n\/?a|none|unknown|tbc)$/i, "").trim();
    const problems: string[] = [];
    if (!name) name = (address.split(",")[0] ?? "").trim() || [houseNameNumber, street].filter(Boolean).join(" ");
    if (!name && !address) continue; // nothing to go on
    if (!address) problems.push("No address");

    // Excel can save phone numbers as 7.7009E+09, losing digits: can't be rebuilt, so flag it.
    if (plan.columns.phone.some((i) => /^\d(\.\d+)?e\+\d+$/i.test(cell(row, i)))) problems.push("Phone number cut short by the spreadsheet");
    const priceText = parsePrice(first(row, "price"));
    const price = priceText && !Number.isNaN(Number(priceText)) ? Math.max(0, Number(priceText)) : null;
    if (price === null) problems.push("No price");
    const freqText = first(row, "frequency");
    const frequencyWeeks = freqText ? readFrequency(freqText, plan) : null;
    if (freqText && frequencyWeeks === null) problems.push(`Frequency "${freqText.slice(0, 20)}" not understood`);

    const payText = first(row, "payment");
    const mappedPay = plan.paymentMap.find((e) => e.text === payText.toLowerCase());
    const preferredPaymentMethod = mappedPay ? mappedPay.method : normalisePaymentMethod(payText);
    const notes = [
      get(row, "notes", " · "),
      payText && !preferredPaymentMethod ? `Usually pays: ${payText}` : "",
    ].filter(Boolean).join("\n");
    const status = get(row, "status", " ").toLowerCase();

    out.push({
      sheetRow: r + 1,
      name: name.slice(0, 120),
      address: address.slice(0, 300),
      houseNameNumber, street, town, postcode,
      phone: (plan.columns.phone.map((i) => fixUkPhone(cell(row, i))).find((p) => !/e\+/i.test(p) && /\d{6}/.test(p.replace(/\D/g, ""))) ?? "").slice(0, 40),
      email: first(row, "email").slice(0, 160),
      price,
      frequencyWeeks,
      nextDueDate: readDate(first(row, "nextDue"), plan.dateOrder),
      lastCompletedDate: readDate(first(row, "lastCleaned"), plan.dateOrder),
      notes: notes.slice(0, 2000),
      preferredPaymentMethod,
      area: (get(row, "area", " ") || plan.defaultArea).slice(0, 60),
      jobName: first(row, "jobName").slice(0, 80),
      active: !(status && plan.inactiveValues.some((v) => status === v || status.includes(v))),
      problems,
    });
  }
  return out;
}

/** Wyndos's own customer export (Data → Export customers): read without the AI. */
export function wyndosExportPlan(headers: string[]): ImportPlan | null {
  const h = headers.map((x) => x.trim().toLowerCase());
  const at = (label: string) => h.indexOf(label.toLowerCase());
  const needed = ["Name", "Area", "Price", "Every (weeks)", "Next due", "Usually pays"];
  if (needed.some((n) => at(n) === -1)) return null;
  const one = (label: string) => (at(label) >= 0 ? [at(label)] : []);
  const columns = Object.fromEntries(PLAN_FIELDS.map((f) => [f, [] as number[]])) as Record<PlanField, number[]>;
  Object.assign(columns, {
    name: one("Name"), houseNumber: one("House no./name"), street: one("Street"), town: one("Town"), postcode: one("Postcode"),
    fullAddress: one("Address"), area: one("Area"), price: one("Price"), frequency: one("Every (weeks)"), nextDue: one("Next due"),
    lastCleaned: one("Last cleaned"), phone: one("Phone"), email: one("Email"), payment: one("Usually pays"), status: one("Active"),
    notes: one("Notes"),
  });
  return {
    kind: "customers", headerRow: 0, firstDataRow: 1, columns, dateOrder: "YMD", frequencyMap: [], defaultFrequencyWeeks: 4,
    paymentMap: [], inactiveValues: ["no"], defaultArea: "Imported",
    summary: "This is a Wyndos customer export, so it's read exactly as Wyndos wrote it.", warnings: [], feedbackOffTopic: false,
  };
}

/** What a file looks like before anything is read. */
export function looksLikeCleanerPlanner(names: string[]) {
  const base = names.map((n) => (n.split(/[\\/]/).pop() ?? "").toLowerCase());
  return base.includes("jobs.csv") && (base.includes("customers.csv") || base.includes("rounds.csv"));
}
