"use client";

import Tesseract from "tesseract.js";

export type ReceiptExtraction = {
  supplier: string;
  amount: string;
  date: string;
  vatAmount: string;
  rawText: string;
};

/**
 * Run Tesseract OCR on a receipt image data-URL and attempt to extract
 * supplier name, total amount, date, and VAT amount.
 *
 * All returned values are best-effort suggestions that the user must validate
 * and can override via the manual form fields.
 */
export async function extractReceiptData(
  imageDataUrl: string
): Promise<ReceiptExtraction> {
  const {
    data: { text },
  } = await Tesseract.recognize(imageDataUrl, "eng", {
    logger: () => {},
  });

  return {
    supplier: extractSupplier(text),
    amount: extractTotal(text),
    date: extractDate(text),
    vatAmount: extractVat(text),
    rawText: text,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Match monetary values: £20.00  20.00  £ 20.00  $15.99  1,234.56
const MONEY_RE = /[£$]?\s*(\d{1,6}(?:[.,]\d{2,3}))/g;

function allMoneyValues(line: string): number[] {
  const results: number[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MONEY_RE.source, "g");
  while ((m = re.exec(line)) !== null) {
    const val = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(val) && val > 0 && val < 100_000) results.push(val);
  }
  return results;
}

function firstMoney(line: string): string {
  const re = new RegExp(MONEY_RE.source);
  const m = line.match(re);
  if (!m) return "";
  const inner = m[0].replace(/[£$\s]/g, "").replace(",", ".");
  return inner;
}

function extractTotal(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Priority 1: explicit total/amount-due labels
  const totalPatterns = [
    /\b(?:grand\s*total)\b/i,
    /\b(?:total)\b/i,
    /\b(?:amount\s*due|balance\s*due|to\s*pay)\b/i,
    /\b(?:visa\s*(?:debit|credit)\s*sale)\b/i,
    /\b(?:card\s*payment|amount\s*paid|paid|charge\s*due|amt)\b/i,
    /\b(?:subtotal|sub\s*total)\b/i,
  ];
  for (const pattern of totalPatterns) {
    for (const line of lines) {
      if (pattern.test(line)) {
        const money = firstMoney(line);
        if (money) return money;
      }
    }
  }

  // Priority 2: any line that is just a large standalone monetary value
  // (some receipts show the total as a big isolated number)
  let largest = "";
  let largestVal = 0;
  for (const line of lines) {
    const vals = allMoneyValues(line);
    for (const val of vals) {
      if (val > largestVal) {
        largestVal = val;
        largest = val.toFixed(2);
      }
    }
  }
  return largest;
}

function extractDate(text: string): string {
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (4-digit year)
  const dmy4Match = text.match(
    /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/
  );
  if (dmy4Match) {
    const [, d, m, y] = dmy4Match;
    const day = d.padStart(2, "0");
    const month = m.padStart(2, "0");
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${y}-${month}-${day}`;
    }
  }

  // DD/MM/YY (2-digit year — common on UK receipts)
  const dmy2Match = text.match(
    /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})\b/
  );
  if (dmy2Match) {
    const [, d, m, yy] = dmy2Match;
    const day = d.padStart(2, "0");
    const month = m.padStart(2, "0");
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      const year = Number(yy) > 50 ? `19${yy}` : `20${yy}`;
      return `${year}-${month}-${day}`;
    }
  }

  // YYYY-MM-DD
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // Written dates: "16 Apr 2026", "16 April 2026", "Apr 16, 2026"
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const monthNames = Object.keys(months).join("|");

  // "16 Apr 2026" or "16 April 2026"
  const writtenDMY = text.match(
    new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})\\w*\\s+(\\d{2,4})\\b`, "i")
  );
  if (writtenDMY) {
    const [, d, m, y] = writtenDMY;
    const yr = y.length === 2 ? (Number(y) > 50 ? `19${y}` : `20${y}`) : y;
    return `${yr}-${months[m.slice(0, 3).toLowerCase()]}-${d.padStart(2, "0")}`;
  }

  // "Apr 16 2026" or "April 16, 2026"
  const writtenMDY = text.match(
    new RegExp(`\\b(${monthNames})\\w*\\s+(\\d{1,2}),?\\s+(\\d{2,4})\\b`, "i")
  );
  if (writtenMDY) {
    const [, m, d, y] = writtenMDY;
    const yr = y.length === 2 ? (Number(y) > 50 ? `19${y}` : `20${y}`) : y;
    return `${yr}-${months[m.slice(0, 3).toLowerCase()]}-${d.padStart(2, "0")}`;
  }

  return "";
}

function extractVat(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Look for a line with "VAT" and a monetary value
  // Prefer lines like "VAT £3.33" or "20% VAT 3.33" or "Includes VAT of £3.33"
  for (const line of lines) {
    if (!/\bvat\b/i.test(line)) continue;
    // Skip header/title lines that just say "VAT RECEIPT" or "VAT NUMBER"
    if (/\bvat\s*(receipt|number|no|reg|#)\b/i.test(line)) continue;
    const money = firstMoney(line);
    if (money) return money;
  }

  // Also check for "Tax" lines
  for (const line of lines) {
    if (!/\btax\b/i.test(line)) continue;
    if (/\btax\s*(year|code|point|invoice|number)\b/i.test(line)) continue;
    const money = firstMoney(line);
    if (money) return money;
  }

  return "";
}

function extractSupplier(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  // Known UK retailers/brands — if we spot one, use it directly
  const knownBrands = [
    "TESCO", "ASDA", "SAINSBURY", "MORRISONS", "ALDI", "LIDL", "WAITROSE",
    "CO-OP", "COOP", "SPAR", "COSTCO", "B&Q", "SCREWFIX", "TOOLSTATION",
    "WICKS", "HALFORDS", "CURRYS", "ARGOS", "WILKO", "POUNDLAND",
    "SHELL", "BP", "ESSO", "TEXACO", "JET", "TOTAL", "GULF",
    "AMAZON", "EBAY", "PAYPAL", "MCDONALD", "COSTA", "STARBUCKS",
    "GREGGS", "SUBWAY", "KFC", "NANDO", "DOMINO",
  ];
  const upper = text.toUpperCase();
  for (const brand of knownBrands) {
    if (upper.includes(brand)) {
      // Return the brand with proper casing
      return brand.charAt(0) + brand.slice(1).toLowerCase();
    }
  }

  // Fall back to the first non-trivial line in the first 6 lines
  for (const line of lines.slice(0, 6)) {
    // Skip lines that are purely numeric / date / whitespace
    if (/^\d[\d/\-.\s:]*$/.test(line)) continue;
    // Skip lines that are just a price
    if (/^[£$]?\s*\d+[.,]\d{2}\s*$/.test(line)) continue;
    // Skip lines that look like phone numbers
    if (/^\+?\d[\d\s\-()]{7,}$/.test(line)) continue;
    // Skip very short lines (likely OCR noise)
    if (line.replace(/[^a-zA-Z]/g, "").length < 2) continue;
    // Clean up the line
    const cleaned = line.replace(/[^a-zA-Z0-9\s&'.,-]/g, "").trim();
    if (cleaned.length > 1) return cleaned;
  }
  return "";
}
