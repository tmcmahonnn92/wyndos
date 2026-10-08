/**
 * Smart expense import: the reading plan and how it's applied. Pure code (browser + server).
 *
 * Like the customer import, the AI only says how to read the file (which column is the date,
 * the amount, money in/out…) and which category each supplier belongs to. Ordinary code applies
 * that to every row, and the owner can change any category in the preview before saving.
 */

import { EXPENSE_CATEGORIES, HMRC_EXPENSE_CATEGORIES, getExpenseCategory } from "@/lib/accounting";
import { readDate } from "@/lib/smart-import/plan";

export const EXPENSE_FIELDS = ["date", "supplier", "description", "amount", "moneyOut", "moneyIn", "vat", "category", "notes"] as const;
export type ExpenseField = (typeof EXPENSE_FIELDS)[number];

/** Categories the import can use (not the "before Wyndos" starting figure). */
export const IMPORT_CATEGORIES = EXPENSE_CATEGORIES.filter((c) => c.value !== "OPENING");
const CATEGORY_VALUES = new Set(IMPORT_CATEGORIES.map((c) => c.value));

export type ExpensePlan = {
  kind: "expenses" | "bank_statement" | "not_expenses";
  headerRow: number;
  firstDataRow: number;
  columns: Record<ExpenseField, number[]>;
  dateOrder: "DMY" | "MDY" | "YMD";
  /** With a single amount column: are money-out rows positive or negative? */
  sign: "out_positive" | "out_negative";
  /** Supplier / description (merchant key) → Wyndos category. */
  categoryMap: Array<{ text: string; category: string }>;
  /** Merchant keys that aren't business expenses (own transfers, tax, personal). */
  skipTexts: string[];
  summary: string;
  warnings: string[];
  feedbackOffTopic: boolean;
};

const clip = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

export function cleanExpensePlan(raw: unknown, columnCount: number, rowCount: number): ExpensePlan {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cols = (r.columns && typeof r.columns === "object" ? r.columns : {}) as Record<string, unknown>;
  const columns = Object.fromEntries(EXPENSE_FIELDS.map((f) => {
    const list = Array.isArray(cols[f]) ? (cols[f] as unknown[]) : cols[f] == null ? [] : [cols[f]];
    return [f, [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < columnCount))].slice(0, 4)];
  })) as Record<ExpenseField, number[]>;
  const int = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  const headerRow = int(r.headerRow, -1, Math.min(rowCount - 1, 50), 0);
  return {
    kind: r.kind === "bank_statement" || r.kind === "not_expenses" ? r.kind : "expenses",
    headerRow,
    firstDataRow: int(r.firstDataRow, 0, Math.min(rowCount, 60), headerRow + 1),
    columns,
    dateOrder: r.dateOrder === "MDY" || r.dateOrder === "YMD" ? r.dateOrder : "DMY",
    sign: r.sign === "out_negative" ? "out_negative" : "out_positive",
    categoryMap: (Array.isArray(r.categoryMap) ? r.categoryMap : []).slice(0, 400).flatMap((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      const text = clip(o.text, 60).toLowerCase();
      const category = String(o.category ?? "");
      return text && CATEGORY_VALUES.has(category) ? [{ text, category }] : [];
    }),
    skipTexts: (Array.isArray(r.skipTexts) ? r.skipTexts : []).slice(0, 200).map((v) => clip(v, 60).toLowerCase()).filter(Boolean),
    summary: clip(r.summary, 600),
    warnings: (Array.isArray(r.warnings) ? r.warnings : []).slice(0, 6).map((w) => clip(w, 200)).filter(Boolean),
    feedbackOffTopic: r.feedbackOffTopic === true,
  };
}

const BANK_WORDS = /\b(card payment to|card payment|payment to|purchase|pos|contactless|visa|debit card|direct debit|dd|standing order|so|faster payment|fpo|fps|bill payment|bp|ref|reference|on|at|gbp|ltd|limited|plc|uk|www|com|co)\b/g;
/** A short, stable name for a supplier from messy bank text: "CARD PAYMENT TO SHELL 1234 ON 12/03" → "shell". */
export function merchantKey(text: string) {
  return text.toLowerCase()
    .replace(/\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?/g, " ")
    .replace(/[^a-z& ]+/g, " ")
    .replace(BANK_WORDS, " ")
    .replace(/\s+/g, " ").trim()
    .split(" ").slice(0, 3).join(" ")
    .slice(0, 40);
}

/** Everyday suppliers a window cleaner uses, as a fallback when the AI didn't say. */
const RULES: Array<[RegExp, string]> = [
  [/\b(parking|ringgo|paybyphone|justpark|ncp|toll|dart charge|congestion|ulez|tfl)\b/, "PARKING"],
  [/\b(shell|bp|esso|texaco|jet|gulf|murco|fuel|petrol|diesel|tesco fuel|asda fuel|sainsburys fuel|morrisons fuel|applegreen|certas|ev charg|pod point|ionity|train|trainline)\b/, "FUEL"],
  [/\b(kwik fit|halfords auto|mot|garage|tyres?|national tyres|ats euromaster|autocentre|car wash)\b/, "VEHICLE_MAINTENANCE"],
  [/\b(dvla|vehicle tax|road tax)\b/, "VEHICLE_COSTS"],
  [/\b(screwfix|toolstation|b&q|wickes|homebase|machine mart|ladder|unger|ettore|pure water|reach & wash|gardiner|window cleaning warehouse|wcw|streamline|clearwater)\b/, "EQUIPMENT"],
  [/\b(resin|squeegee|detergent|washing up|fairy|cleaning supplies|ipa)\b/, "SUPPLIES"],
  [/\b(insurance|insure|simply business|hiscox|axa|aviva|direct line|admiral|zurich|ageas|nfu)\b/, "INSURANCE"],
  [/\b(vodafone|ee|o2|three|giffgaff|bt|virgin media|sky|talktalk|plusnet|stationery|royal mail|post office|staples|ryman)\b/, "OFFICE"],
  [/\b(wyndos|google|microsoft|apple com bill|adobe|xero|quickbooks|freeagent|sage|dropbox|squarespace|wix|godaddy|ionos|zoom|canva|squeegee app|cleaner planner|cleanerplanner|aworka|round organiser)\b/, "SOFTWARE"],
  [/\b(facebook|meta|instagram|vistaprint|leaflet|flyer|advert|yell|checkatrade|mybuilder|rated people|nextdoor)\b/, "MARKETING"],
  [/\b(bank charge|account fee|monthly fee|interest charge|overdraft|stripe fee|sumup|zettle|square fee|gocardless|paypal fee)\b/, "BANK_FEES"],
  [/\b(accountant|accountancy|bookkeep|solicitor|legal)\b/, "PROFESSIONAL_FEES"],
  [/\b(hmrc|self assessment|tax payment|transfer to|savings|isa|own account)\b/, "__SKIP__"],
];
export function ruleCategory(text: string): string | null {
  const t = text.toLowerCase();
  for (const [re, cat] of RULES) if (re.test(t)) return cat;
  return null;
}

/** A category written in the file ("Fuel", "Motor expenses", "carVanTravelExpenses"…) → Wyndos category. */
export function categoryFromText(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const exact = IMPORT_CATEGORIES.find((c) => c.value.toLowerCase() === t || c.label.toLowerCase() === t);
  if (exact) return exact.value;
  const hmrc = HMRC_EXPENSE_CATEGORIES.find((h) => h.key.toLowerCase() === t || h.label.toLowerCase() === t);
  if (hmrc) return IMPORT_CATEGORIES.find((c) => c.hmrcCategory === hmrc.key)?.value ?? null;
  const loose = IMPORT_CATEGORIES.find((c) => c.label.toLowerCase().includes(t) || t.includes(c.label.toLowerCase().split(" ")[0]));
  return loose?.value ?? ruleCategory(t);
}

/** "£1,234.50", "(12.00)", "-12", "12.00 DR" → signed number; null if it isn't money. */
export function readMoney(value: string): number | null {
  let v = value.trim();
  if (!v) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(v)) { sign = -1; v = v.slice(1, -1); }
  if (/\bdr\b/i.test(v)) sign = -1;
  v = v.replace(/\b(cr|dr)\b/gi, "").replace(/[£$€,\s]/g, "");
  if (v.startsWith("-")) { sign *= -1; v = v.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  return sign * Number(v);
}

export type ExpenseRow = {
  sheetRow: number;
  date: string;
  supplier: string;
  description: string;
  /** Merchant key: rows with the same key share a category. */
  key: string;
  amount: number;
  vat: number;
  category: string;
  categorySource: "file" | "ai" | "rule" | "default";
  notes: string;
  /** Why it won't be imported; empty = will be imported. "personal" ones can be put back in. */
  skip: "" | "money_in" | "no_date" | "no_amount" | "personal";
  skipReason: string;
};

export function applyExpensePlan(grid: string[][], plan: ExpensePlan): ExpenseRow[] {
  const out: ExpenseRow[] = [];
  const cell = (row: string[], i: number) => String(row[i] ?? "").trim();
  const get = (row: string[], f: ExpenseField, sep = " ") => plan.columns[f].map((i) => cell(row, i)).filter(Boolean).join(sep);
  const aiCat = new Map(plan.categoryMap.map((e) => [e.text, e.category]));
  const skipKeys = new Set(plan.skipTexts);

  for (let r = Math.max(plan.firstDataRow, plan.headerRow + 1); r < grid.length; r++) {
    const row = grid[r] ?? [];
    const filled = row.map((c) => String(c ?? "").trim()).filter(Boolean);
    if (filled.length === 0) continue;
    if (/^(total|totals|sub ?total|balance brought forward|opening balance|closing balance)/i.test(filled[0])) continue;

    const supplierText = get(row, "supplier");
    const description = get(row, "description");
    const key = merchantKey(supplierText || description);
    // Bank lines ("CARD PAYMENT TO SHELL 4421 ON 01/09") become a clean supplier name ("Shell"); the full line goes in notes.
    const pretty = key.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    const supplier = (supplierText || pretty || description).slice(0, 80);
    const date = readDate(get(row, "date"), plan.dateOrder);

    // Money: separate in/out columns, or one signed amount column.
    let amount: number | null = null;
    let moneyIn = false;
    if (plan.columns.moneyOut.length || plan.columns.moneyIn.length) {
      const out_ = readMoney(get(row, "moneyOut"));
      const in_ = readMoney(get(row, "moneyIn"));
      if (out_ && Math.abs(out_) > 0) amount = Math.abs(out_);
      else if (in_ && Math.abs(in_) > 0) moneyIn = true;
    } else {
      const n = readMoney(get(row, "amount"));
      if (n !== null && n !== 0) {
        const isOut = plan.sign === "out_negative" ? n < 0 : n > 0;
        if (isOut) amount = Math.abs(n); else moneyIn = true;
      }
    }
    const vatN = readMoney(get(row, "vat"));
    const vat = vatN && amount && Math.abs(vatN) < amount ? Math.abs(vatN) : 0;

    // Category: the file's own, then the AI's, then everyday rules, then Other.
    let category = "OTHER";
    let categorySource: ExpenseRow["categorySource"] = "default";
    const fromFile = categoryFromText(get(row, "category"));
    const rule = ruleCategory(`${supplierText} ${description}`);
    if (fromFile && fromFile !== "__SKIP__") { category = fromFile; categorySource = "file"; }
    else if (aiCat.has(key)) { category = aiCat.get(key)!; categorySource = "ai"; }
    else if (rule && rule !== "__SKIP__") { category = rule; categorySource = "rule"; }

    let skip: ExpenseRow["skip"] = "";
    let skipReason = "";
    if (!date) { skip = "no_date"; skipReason = "No date"; }
    else if (moneyIn) { skip = "money_in"; skipReason = "Money in, not an expense"; }
    else if (!amount) { skip = "no_amount"; skipReason = "No amount"; }
    else if (skipKeys.has(key) || (categorySource !== "file" && rule === "__SKIP__")) { skip = "personal"; skipReason = "Looks like a transfer, tax payment or personal spending"; }

    out.push({
      sheetRow: r + 1, date, supplier, description: description.slice(0, 200), key, amount: amount ?? 0, vat, category, categorySource,
      notes: [description && description !== supplier ? description : "", get(row, "notes", " · ")].filter(Boolean).join(" · ").slice(0, 500),
      skip, skipReason,
    });
  }
  return out;
}

/** The Wyndos expense template (download on the import page): read without the AI. */
export const EXPENSE_TEMPLATE_HEADERS = ["Date", "Supplier", "Description", "Category", "Amount", "VAT", "Notes"];
export function templateExpensePlan(headers: string[]): ExpensePlan | null {
  const h = headers.map((x) => String(x ?? "").trim().toLowerCase());
  const at = (label: string) => h.indexOf(label.toLowerCase());
  if (["Date", "Supplier", "Category", "Amount"].some((n) => at(n) === -1)) return null;
  const one = (label: string) => (at(label) >= 0 ? [at(label)] : []);
  const columns = Object.fromEntries(EXPENSE_FIELDS.map((f) => [f, [] as number[]])) as Record<ExpenseField, number[]>;
  Object.assign(columns, { date: one("Date"), supplier: one("Supplier"), description: one("Description"), category: one("Category"), amount: one("Amount"), vat: one("VAT"), notes: one("Notes") });
  return {
    kind: "expenses", headerRow: 0, firstDataRow: 1, columns, dateOrder: "DMY", sign: "out_positive", categoryMap: [], skipTexts: [],
    summary: "This is the Wyndos expense template, so it's read exactly as laid out.", warnings: [], feedbackOffTopic: false,
  };
}

export { getExpenseCategory };
