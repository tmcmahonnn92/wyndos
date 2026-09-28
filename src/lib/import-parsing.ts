/**
 * Helpers that turn a cleaner's own spreadsheet (as-is) into import rows.
 * Pure functions, safe to use in the browser.
 */

export type ParsedSheet = { headers: string[]; rows: string[][]; ignoredRows: number };

function columnLetter(index: number) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/**
 * Give every column a usable, unique header. A column with no heading
 * (very common: a notes column) becomes "Column E" instead of disappearing.
 */
export function normaliseHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((value, index) => {
    const base = String(value ?? "").trim() || `Column ${columnLetter(index)}`;
    const count = seen.get(base.toLowerCase()) ?? 0;
    seen.set(base.toLowerCase(), count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

/** Drop blank spacer rows and "total" rows (a row that is only a number, like 509). */
export function dropJunkRows(rows: string[][]): { rows: string[][]; ignored: number } {
  const kept: string[][] = [];
  let ignored = 0;
  for (const row of rows) {
    const cells = row.map((cell) => String(cell ?? "").trim());
    const filled = cells.filter(Boolean);
    const isBlank = filled.length === 0;
    const isTotal = filled.length === 1 && /^£?\s*[\d,]+(\.\d+)?$/.test(filled[0]) && !cells[0];
    const isTotalLabel = /^(total|totals|sub ?total)$/i.test(cells[0] ?? "");
    if (isBlank || isTotal || isTotalLabel) {
      ignored++;
      continue;
    }
    kept.push(cells);
  }
  return { rows: kept, ignored };
}

export function parseCSVText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function toSheet(matrix: string[][]): ParsedSheet {
  const width = Math.max(0, ...matrix.map((row) => row.length));
  const padded = matrix.map((row) => Array.from({ length: width }, (_, i) => String(row[i] ?? "").trim()));
  // The header row is the first row with at least two filled cells.
  const headerIndex = padded.findIndex((row) => row.filter(Boolean).length >= 2);
  if (headerIndex === -1) return { headers: [], rows: [], ignoredRows: 0 };
  const headers = normaliseHeaders(padded[headerIndex]);
  const { rows, ignored } = dropJunkRows(padded.slice(headerIndex + 1));
  return { headers, rows, ignoredRows: ignored };
}

/** Read a .csv, .xlsx or .xls file (first sheet) into headers + rows. */
export async function parseSpreadsheetFile(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return toSheet(parseCSVText(await file.text()));
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".ods")) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", dateNF: "dd/mm/yyyy" });
    return toSheet(matrix.map((row) => row.map((cell) => String(cell ?? ""))));
  }
  throw new Error("Please upload a spreadsheet: .xlsx, .xls or .csv");
}

/** Accept UK dates (31/12/2026, 31-12-26), ISO (2026-12-31). Returns YYYY-MM-DD or "" if invalid. */
export function parseUkDate(value: string): string {
  const v = value.trim();
  if (!v) return "";
  let y: number, m: number, d: number;
  let match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = v.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else {
    return "";
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "";
  return date.toISOString().slice(0, 10);
}

/** "£12.50", "12", "12.0" -> "12.50"-style number string, or "" if not a price. */
export function parsePrice(value: string): string {
  const cleaned = value.replace(/[£,\s]/g, "");
  if (!cleaned) return "";
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? String(n) : "";
}

/** Free-text payment method -> CASH / BACS / CARD / DD / INVOICE, or "" (not set, e.g. "both"). */
export function normalisePaymentMethod(value: string): "" | "CASH" | "BACS" | "CARD" | "DD" | "INVOICE" {
  const v = value.trim().toLowerCase();
  if (!v) return "";
  if (/\bboth\b|\/|&|\band\b/.test(v)) return "";
  if (/direct debit|gocardless|\bdd\b/.test(v)) return "DD";
  if (/invoice|later|account/.test(v)) return "INVOICE";
  if (/cash/.test(v)) return "CASH";
  if (/bacs|bank|transfer|\bbt\b|online|standing order/.test(v)) return "BACS";
  if (/card/.test(v)) return "CARD";
  return "";
}

/** Slip column: "slip"/"yes"/"y"/"1" -> true; "no"/"n"/"0"/"no slip"/blank -> false. */
export function parseSlip(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (/^(no|n|0|false|no slip|none)$/.test(v)) return false;
  return true;
}

/** Truthy values for yes/no columns such as "Advance notice". */
export function parseYes(value: string): boolean {
  return /^(true|yes|y|1|x|✓)$/i.test(value.trim());
}
