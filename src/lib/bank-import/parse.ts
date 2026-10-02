/**
 * Read a bank statement (or any payments spreadsheet) in the browser.
 *
 * Security: these are pure functions. The file is read into memory here and is
 * never uploaded, saved, cached or put in browser storage. Only the rows the user
 * confirms are sent to the server, and only the fields needed to record a payment.
 */
import { parseCSVText, parseUkDate } from "@/lib/import-parsing";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_LINES = 2000;

export type ColumnMapping = {
  date: number;
  /** Columns joined to make the line's text (reference, description, counter party…). */
  text: number[];
  /** One signed amount column (money in is positive)… */
  amount: number;
  /** …or separate "paid in" / "paid out" columns. */
  moneyIn: number;
  moneyOut: number;
};

export type BankLine = {
  /** Row number in the file (1-based, for the user). */
  row: number;
  date: string; // YYYY-MM-DD
  amount: number; // always > 0 (money in)
  text: string; // what the bank shows, trimmed, max 140 chars
};

/** Read the first sheet of a .csv / .xlsx / .xls / .ods file into a grid of strings. */
export async function readStatementFile(file: File): Promise<string[][]> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is too big. Bank statements are usually well under 5 MB.");
  const name = file.name.toLowerCase();
  let matrix: string[][];
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = await file.text();
    matrix = parseCSVText(sniffDelimiter(text) === ";" ? text.replace(/;/g, ",") : text);
  } else if (/\.(xlsx|xls|ods)$/.test(name)) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", dateNF: "dd/mm/yyyy" });
    matrix = rows.map((row) => row.map((cell) => String(cell ?? "")));
  } else {
    throw new Error("Please choose a .csv, .xlsx or .xls file.");
  }
  return matrix.map((row) => row.map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim()));
}

/** A few European banks export with ";" — only switch when the first lines clearly use it. */
function sniffDelimiter(text: string): "," | ";" {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const semi = (head.match(/;/g) ?? []).length;
  const comma = (head.match(/,/g) ?? []).length;
  return semi > comma * 2 && semi >= 4 ? ";" : ",";
}

const HEADER_WORDS = [
  "date", "description", "details", "reference", "narrative", "memo", "payee", "counter party", "counterparty",
  "name", "amount", "value", "paid in", "money in", "credit", "credits", "paid out", "money out", "debit", "debits",
  "balance", "type", "transaction", "transactions",
];

/** The header row is the row (in the first 25) that looks most like column names. */
export function findHeaderRow(matrix: string[][]): number {
  let best = -1;
  let bestScore = 1;
  for (let i = 0; i < Math.min(matrix.length, 25); i++) {
    const cells = matrix[i].map((c) => c.toLowerCase());
    const score = cells.filter((c) => c && c.length < 40 && HEADER_WORDS.some((w) => c.includes(w))).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

const has = (header: string, ...words: string[]) => words.some((w) => header.includes(w));

/** Guess which column is which from the header names. -1 = not found. */
export function detectColumns(headers: string[]): ColumnMapping {
  const h = headers.map((x) => x.toLowerCase());
  const find = (test: (x: string) => boolean) => h.findIndex(test);

  const date = find((x) => has(x, "date") && !has(x, "time")) !== -1 ? find((x) => has(x, "date") && !has(x, "time")) : find((x) => has(x, "date"));
  const moneyIn = find((x) => has(x, "paid in", "money in", "credit", "credits", "in (") && !has(x, "card"));
  const moneyOut = find((x) => has(x, "paid out", "money out", "debit", "debits", "out (") && !has(x, "card"));
  const amount = find((x) => has(x, "amount", "value") && !has(x, "local", "original", "fee"));

  const text: number[] = [];
  const textOrder: string[][] = [
    ["counter party", "counterparty", "payee", "payer", "name"],
    ["reference", "ref"],
    ["description", "details", "narrative", "memo", "transactions", "transaction description", "notes"],
  ];
  for (const words of textOrder) {
    const index = find((x) => has(x, ...words) && !has(x, "account name", "account number", "sort code", "id", "category", "emoji"));
    if (index !== -1 && !text.includes(index) && index !== date && index !== amount) text.push(index);
  }

  return {
    date,
    text,
    amount: moneyIn !== -1 ? -1 : amount,
    moneyIn,
    moneyOut,
  };
}

/**
 * Some banks (HSBC, for one) export with no header row. Guess from the values:
 * the column that is mostly dates, the column that is mostly amounts, the longest text column.
 */
export function guessWithoutHeader(matrix: string[][]): ColumnMapping {
  const sample = matrix.filter((row) => row.some(Boolean)).slice(0, 50);
  const width = Math.max(0, ...sample.map((row) => row.length));
  const share = (col: number, test: (v: string) => boolean) =>
    sample.filter((row) => test(row[col] ?? "")).length / Math.max(1, sample.length);
  let date = -1, amount = -1, text = -1, textLen = 0;
  for (let col = 0; col < width; col++) {
    if (date === -1 && share(col, (v) => Boolean(parseBankDate(v))) > 0.6) { date = col; continue; }
    if (amount === -1 && share(col, (v) => parseAmount(v) !== null) > 0.6) { amount = col; continue; }
    const avg = sample.reduce((sum, row) => sum + (row[col] ?? "").length, 0) / Math.max(1, sample.length);
    if (avg > textLen && share(col, (v) => /[A-Za-z]/.test(v)) > 0.5) { text = col; textLen = avg; }
  }
  return { date, text: text === -1 ? [] : [text], amount, moneyIn: -1, moneyOut: -1 };
}

/** "£1,234.50", "1234.5", "(12.00)", "12.00 CR", "-5" -> number, or null. */
export function parseAmount(value: string): number | null {
  let v = value.trim().toUpperCase();
  if (!v) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(v)) { sign = -1; v = v.slice(1, -1); }
  if (/\bDR\b$/.test(v)) { sign = -1; v = v.replace(/\bDR\b$/, ""); }
  v = v.replace(/\bCR\b$/, "");
  v = v.replace(/GBP|£|,|\s/g, "");
  if (v.startsWith("+")) v = v.slice(1);
  if (v.startsWith("-")) { sign = -sign; v = v.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v) * sign;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** UK bank dates: 02/10/2026, 2/10/26, 2026-10-02, 02 Oct 2026, 2-Oct-26, with or without a time. */
export function parseBankDate(value: string): string {
  const v = value.trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?Z?$/i, "").trim();
  const simple = parseUkDate(v);
  if (simple) return simple;
  const m = v.match(/^(\d{1,2})[\s\-/]([A-Za-z]{3,9})[\s\-/,]+(\d{2}|\d{4})$/);
  if (!m) return "";
  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  if (month === -1) return "";
  return parseUkDate(`${m[1]}/${month + 1}/${m[3]}`);
}

/** Turn the grid into money-in lines. Rows that aren't money in (or aren't rows) are skipped. */
export function extractLines(matrix: string[][], headerRow: number, mapping: ColumnMapping): { lines: BankLine[]; skipped: number } {
  const lines: BankLine[] = [];
  let skipped = 0;
  for (let i = headerRow + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.every((c) => !c)) continue;
    const date = mapping.date >= 0 ? parseBankDate(row[mapping.date] ?? "") : "";
    let amount: number | null = null;
    if (mapping.moneyIn >= 0) {
      const paidIn = parseAmount(row[mapping.moneyIn] ?? "");
      amount = paidIn !== null && paidIn > 0 ? paidIn : null;
    } else if (mapping.amount >= 0) {
      amount = parseAmount(row[mapping.amount] ?? "");
    }
    if (!date || amount === null || amount <= 0) {
      skipped++;
      continue;
    }
    const text = mapping.text
      .map((index) => row[index] ?? "")
      .filter(Boolean)
      .filter((part, index, all) => all.indexOf(part) === index)
      .join(" · ")
      .slice(0, 140);
    lines.push({ row: i + 1, date, amount, text });
    if (lines.length >= MAX_LINES) break;
  }
  return { lines, skipped };
}

/** Upper case, letters and digits only. Used for every comparison and for learned references. */
export function normaliseKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * A one-way fingerprint of a line, so the same line in an overlapping statement is
 * skipped. The text itself is never stored. `occurrence` separates two identical
 * lines on the same day.
 */
export async function lineHash(tenantId: number, line: BankLine, occurrence: number): Promise<string> {
  const input = `wyndos-bank-v1|${tenantId}|${line.date}|${line.amount.toFixed(2)}|${normaliseKey(line.text)}|${occurrence}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
