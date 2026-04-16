"use client";

import Tesseract from "tesseract.js";

export type ReceiptExtraction = {
  supplier: string;
  amount: string;
  date: string;
  vatAmount: string;
  category: string;
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

  // Normalise OCR output: fix common misreads, collapse whitespace
  const cleaned = normaliseOcrText(text);

  const supplier = extractSupplier(cleaned);
  return {
    supplier,
    amount: extractTotal(cleaned),
    date: extractDate(cleaned),
    vatAmount: extractVat(cleaned),
    category: guessCategory(supplier, cleaned),
    rawText: text,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Text normalisation ────────────────────────────────────────────────────────

/** Fix common OCR misreads, collapse whitespace, and clean stray characters. */
function normaliseOcrText(raw: string): string {
  return raw
    // Common OCR symbol misreads for £
    .replace(/[Ee]£|£{2,}/g, "£")
    // 'O' mistaken for '0' inside monetary values: £O.99 → £0.99
    .replace(/£\s*O/g, "£0")
    // 'l' or 'I' mistaken for '1' in prices after £
    .replace(/(£\s*\d*)[lI](\d)/g, "$11$2")
    // Collapse multiple spaces but keep newlines
    .replace(/[^\S\n]+/g, " ")
    // Remove null/control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim();
}

// ── Money matching ────────────────────────────────────────────────────────────

// Match monetary values: £20.00  20.00  £ 20.00  $15.99  1,234.56  €42.50
const MONEY_RE = /[£$€]?\s*(\d{1,6}(?:[.,]\d{2,3}))/g;

function allMoneyValues(text: string): number[] {
  const results: number[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MONEY_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    const val = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(val) && val > 0 && val < 100_000) results.push(val);
  }
  return results;
}

function firstMoney(line: string): string {
  const re = new RegExp(MONEY_RE.source);
  const m = line.match(re);
  if (!m) return "";
  return m[0].replace(/[£$€\s]/g, "").replace(",", ".");
}

/** Find the last monetary value on a line (totals often appear at the end). */
function lastMoney(line: string): string {
  const re = new RegExp(MONEY_RE.source, "g");
  let last = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    last = m[0].replace(/[£$€\s]/g, "").replace(",", ".");
  }
  return last;
}

// ── Total extraction ──────────────────────────────────────────────────────────

function extractTotal(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Priority labels from most to least specific
  const totalPatterns: [RegExp, "first" | "last"][] = [
    [/\b(?:grand\s*total)\b/i, "last"],
    [/\b(?:amount\s*due|balance\s*due|to\s*pay|you\s*paid|net\s*total)\b/i, "last"],
    [/\b(?:total\s*gbp|total\s*£|total\s*amount|total\s*payable|total\s*price|total\s*cost)\b/i, "last"],
    [/\b(?:sale\s*total|transaction\s*total|basket\s*total|order\s*total)\b/i, "last"],
    [/\btotal\b/i, "last"],
    [/\b(?:visa\s*(?:debit|credit)\s*(?:sale)?)\b/i, "last"],
    [/\b(?:mastercard|maestro|amex|american\s*express|contactless|chip\s*&?\s*pin)\b/i, "last"],
    [/\b(?:card\s*payment|card\s*amount|amount\s*tendered|tendered|amount\s*paid)\b/i, "last"],
    [/\b(?:paid|charge\s*due|charge|debit)\b/i, "last"],
    [/\b(?:subtotal|sub\s*total)\b/i, "last"],
  ];

  for (const [pattern, pick] of totalPatterns) {
    // We want the LAST line matching each pattern (receipts repeat totals;
    // the final occurrence is usually the definitive one).
    let bestLine = "";
    for (const line of lines) {
      if (pattern.test(line)) bestLine = line;
    }
    if (bestLine) {
      const money = pick === "last" ? lastMoney(bestLine) : firstMoney(bestLine);
      if (money) return money;
    }
  }

  // Fallback: pick the SECOND-largest monetary value in the receipt.
  // Many receipts list item prices; the total is typically the largest,
  // but OCR can sometimes create phantom large numbers. The second-largest
  // gives a reasonable fallback.
  const allVals = allMoneyValues(text);
  if (allVals.length > 0) {
    allVals.sort((a, b) => b - a);
    // Take the largest that appears at least once on its own line
    for (const val of allVals) {
      const formatted = val.toFixed(2);
      // Check if this value appears on a line by itself or with a label
      for (const line of lines) {
        const lineVals = allMoneyValues(line);
        if (lineVals.length === 1 && Math.abs(lineVals[0] - val) < 0.005) {
          return formatted;
        }
      }
    }
    // Ultimate fallback: largest value
    return allVals[0].toFixed(2);
  }

  return "";
}

// ── Date extraction ───────────────────────────────────────────────────────────

function extractDate(text: string): string {
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const monthNames = Object.keys(months).join("|");

  // Helper to validate and format d/m/y
  const tryDMY = (d: string, m: string, y: string): string | null => {
    const day = d.padStart(2, "0");
    const month = m.padStart(2, "0");
    const mi = Number(month);
    const di = Number(day);
    if (mi < 1 || mi > 12 || di < 1 || di > 31) return null;
    const yr = y.length === 2 ? (Number(y) > 50 ? `19${y}` : `20${y}`) : y;
    if (yr.length !== 4) return null;
    return `${yr}-${month}-${day}`;
  };

  // 1. Written dates first (most unambiguous): "16 Apr 2026", "April 16, 2026"
  const writtenDMY = text.match(
    new RegExp(`\\b(\\d{1,2})[\\s\\-]+(${monthNames})\\w*[,\\s]+(\\d{2,4})\\b`, "i")
  );
  if (writtenDMY) {
    const result = tryDMY(writtenDMY[1], months[writtenDMY[2].slice(0, 3).toLowerCase()], writtenDMY[3]);
    if (result) return result;
  }

  const writtenMDY = text.match(
    new RegExp(`\\b(${monthNames})\\w*[\\s]+(\\d{1,2})[,\\s]+(\\d{2,4})\\b`, "i")
  );
  if (writtenMDY) {
    const result = tryDMY(writtenMDY[2], months[writtenMDY[1].slice(0, 3).toLowerCase()], writtenMDY[3]);
    if (result) return result;
  }

  // 2. DD/MM/YYYY (4-digit year) — try all matches, pick the first valid one
  const dmy4All = [...text.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/g)];
  for (const m of dmy4All) {
    const result = tryDMY(m[1], m[2], m[3]);
    if (result) return result;
  }

  // 3. YYYY-MM-DD (ISO format)
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const result = tryDMY(isoMatch[3], isoMatch[2], isoMatch[1]);
    if (result) return result;
  }

  // 4. DD/MM/YY (2-digit year) — common on UK till receipts
  const dmy2All = [...text.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})\b/g)];
  for (const m of dmy2All) {
    const result = tryDMY(m[1], m[2], m[3]);
    if (result) return result;
  }

  // 5. "16 APR 26" (no separator, 2-char year, UK thermal receipts)
  const shortWritten = text.match(
    new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})\\w*\\s+(\\d{2})\\b`, "i")
  );
  if (shortWritten) {
    const result = tryDMY(shortWritten[1], months[shortWritten[2].slice(0, 3).toLowerCase()], shortWritten[3]);
    if (result) return result;
  }

  return "";
}

// ── VAT extraction ────────────────────────────────────────────────────────────

function extractVat(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Skip lines about VAT registration / receipt header
  const skipRe = /\bvat\s*(receipt|number|no\.?|reg\.?|registration|#|id)\b/i;

  // Lines with explicit VAT + money
  for (const line of lines) {
    if (!/\bvat\b/i.test(line)) continue;
    if (skipRe.test(line)) continue;
    const money = lastMoney(line);
    if (money) return money;
  }

  // "Tax" lines
  for (const line of lines) {
    if (!/\btax\b/i.test(line)) continue;
    if (/\btax\s*(year|code|point|invoice|number|id)\b/i.test(line)) continue;
    const money = lastMoney(line);
    if (money) return money;
  }

  return "";
}

// ── Supplier extraction ───────────────────────────────────────────────────────

// Comprehensive list of UK retailers, fuel stations, trade suppliers, food
// chains, online retailers, and common service providers that might appear
// on a receipt scanned by a window cleaner running a small business.
const KNOWN_BRANDS = [
  // Supermarkets
  "TESCO", "ASDA", "SAINSBURY", "MORRISONS", "ALDI", "LIDL", "WAITROSE",
  "CO-OP", "COOP", "COOPERATIVE", "SPAR", "COSTCO", "M&S", "MARKS & SPENCER",
  "MARKS AND SPENCER", "ICELAND", "HERON FOODS", "FARMFOODS", "JACK'S",
  "BOOTHS", "BUDGENS", "LONDIS", "NISA", "PREMIER", "BEST-ONE",
  // DIY / Trade
  "B&Q", "SCREWFIX", "TOOLSTATION", "WICKES", "WICKS", "TRAVIS PERKINS",
  "JEWSON", "SELCO", "PLUMB CENTER", "PLUMBCENTER", "CITY PLUMBING",
  "HOWDENS", "MKM", "BUILDBASE", "TILE MOUNTAIN",
  // Auto / Fuel
  "SHELL", "BP", "ESSO", "TEXACO", "JET", "TOTAL ENERGIES", "TOTALENERGIES",
  "GULF", "MURCO", "APPLEGREEN", "MOTO", "WELCOME BREAK", "ROADCHEF",
  "HARVEST ENERGY", "PACE", "CERTAS", "PETROGAS", "SAINSBURY FUEL",
  "TESCO FUEL", "ASDA FUEL", "MORRISONS FUEL",
  "HALFORDS", "EURO CAR PARTS", "GSF", "NATIONAL TYRES", "KWIK FIT",
  "ATS EUROMASTER",
  // Hardware / Electrical
  "CURRYS", "ARGOS", "WILKO", "POUNDLAND", "POUNDSTRETCHER", "HOME BARGAINS",
  "B&M", "THE RANGE", "DUNELM", "ROBERT DYAS", "RYMAN", "STAPLES",
  "MAPLIN", "SCREWFIX DIRECT",
  // Online
  "AMAZON", "EBAY", "PAYPAL", "ETSY",
  // Food / Coffee
  "MCDONALD", "MCDONALDS", "COSTA", "STARBUCKS", "GREGGS", "SUBWAY",
  "KFC", "NANDO", "NANDOS", "DOMINO", "DOMINOS", "PIZZA HUT", "BURGER KING",
  "FIVE GUYS", "PRET", "PRET A MANGER", "LEON", "CAFFE NERO", "NERO",
  "TIM HORTONS", "WETHERSPOON", "WETHERSPOONS",
  // Office / IT
  "MICROSOFT", "APPLE", "GOOGLE", "DROPBOX", "XERO", "QUICKBOOKS",
  // Cleaning supplies
  "WINDOW CLEANING WAREHOUSE", "WCW", "BRODEX", "IONIC SYSTEMS",
  "GARDINER POLE SYSTEMS", "UNGER", "TITAN LABS", "CLEANSMART",
  // Insurance / Finance
  "SIMPLY BUSINESS", "HISCOX", "DIRECT LINE", "AVIVA", "AXA",
  // Utilities / Telecom
  "VODAFONE", "EE", "THREE", "O2", "GIF GAFF", "GIFFGAFF", "BT",
  "SKY", "VIRGIN MEDIA", "PLUSNET", "TALKTALK",
];

function extractSupplier(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  const upper = text.toUpperCase();

  // Prefer the longest matching brand (e.g. "MARKS & SPENCER" over "M&S")
  let bestBrand = "";
  for (const brand of KNOWN_BRANDS) {
    if (upper.includes(brand) && brand.length > bestBrand.length) {
      bestBrand = brand;
    }
  }
  if (bestBrand) {
    // Title-case the brand
    return bestBrand
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ")
      .replace(/\bAnd\b/g, "and")
      .replace(/\b(B&q|M&s)\b/gi, (m) => m.toUpperCase());
  }

  // Fall back to the first non-trivial line in the first 8 lines
  for (const line of lines.slice(0, 8)) {
    if (/^\d[\d/\-.\s:]*$/.test(line)) continue;
    if (/^[£$€]?\s*\d+[.,]\d{2}\s*$/.test(line)) continue;
    if (/^\+?\d[\d\s\-()]{7,}$/.test(line)) continue;
    if (/^\s*(tel|fax|web|www|http|email|vat\s*(no|reg|number|receipt))/i.test(line)) continue;
    if (/^\s*\d{5,}/.test(line)) continue; // reference / barcode numbers
    if (line.replace(/[^a-zA-Z]/g, "").length < 2) continue;
    const cleaned = line.replace(/[^a-zA-Z0-9\s&'.,-]/g, "").trim();
    if (cleaned.length > 1) return cleaned;
  }
  return "";
}

// ── Category suggestion ───────────────────────────────────────────────────────

/** Map keyword patterns in the supplier name or receipt text to a category. */
function guessCategory(supplier: string, text: string): string {
  const combined = `${supplier}\n${text}`.toUpperCase();

  // Fuel stations → FUEL
  if (/\b(SHELL|BP|ESSO|TEXACO|JET|GULF|MURCO|APPLEGREEN|FUEL|PETROL|DIESEL|UNLEADED|PUMP|LITRE|LITRES)\b/.test(combined)) {
    return "FUEL";
  }

  // Vehicle servicing
  if (/\b(HALFORDS|EURO CAR|KWIK FIT|ATS|EUROMASTER|NATIONAL TYRES|MOT|TYRE|BRAKE|OIL CHANGE|SERVIC)\b/.test(combined)) {
    return "VEHICLE_MAINTENANCE";
  }

  // Trade / cleaning supplies
  if (/\b(SCREWFIX|TOOLSTATION|B&Q|WICKES|TRAVIS|JEWSON|SELCO|UNGER|BRODEX|GARDINER|IONIC|TITAN LABS|WCW|WINDOW CLEAN|SQUEEGEE|POLE|T-BAR|WASHER|DETERGENT|CLEANER|CLEANING)\b/.test(combined)) {
    return "SUPPLIES";
  }

  // Software / IT
  if (/\b(MICROSOFT|GOOGLE|DROPBOX|XERO|QUICKBOOKS|SUBSCRIPTION|SOFTWARE|LICENSE|LICENCE|APP STORE|PLAY STORE|DOMAIN|HOSTING)\b/.test(combined)) {
    return "SOFTWARE";
  }

  // Insurance
  if (/\b(INSURANCE|SIMPLY BUSINESS|HISCOX|DIRECT LINE|AVIVA|AXA|PREMIUM|PUBLIC LIABILITY)\b/.test(combined)) {
    return "INSURANCE";
  }

  // Professional fees
  if (/\b(ACCOUNTANT|SOLICITOR|LEGAL|HMRC|TAX RETURN|BOOKKEEP|PAYROLL)\b/.test(combined)) {
    return "PROFESSIONAL_FEES";
  }

  // Bank fees
  if (/\b(BANK CHARGE|BANK FEE|OVERDRAFT|INTEREST CHARGE|MERCHANT FEE|CARD FEE|STRIPE|PAYMENT PROCESSING)\b/.test(combined)) {
    return "BANK_FEES";
  }

  // Marketing
  if (/\b(MARKETING|ADVERTISING|FLYER|LEAFLET|VISTAPRINT|FACEBOOK ADS|GOOGLE ADS|PROMOTE|BUSINESS CARD)\b/.test(combined)) {
    return "MARKETING";
  }

  // Office supplies
  if (/\b(RYMAN|STAPLES|STATIONERY|PRINTER|INK|PAPER|ENVELOPE|OFFICE)\b/.test(combined)) {
    return "OFFICE";
  }

  // Equipment (larger items)
  if (/\b(EQUIPMENT|LADDER|PRESSURE WASHER|GENERATOR|MACHINE|DRILL|SAW)\b/.test(combined)) {
    return "EQUIPMENT";
  }

  return "";
}
