/**
 * Price calculator engine: one pure function used by the calculator page and quotes, so a price
 * is worked out the same way everywhere. No database, no server: safe in the browser too.
 *
 * A business's price list (PricingConfig) holds:
 *  - presets: quick domestic prices by property type and bedrooms (with a time for each);
 *  - items: anything countable (window types, doors, frames, solar panels, gutters, cladding…),
 *    each with a unit (each, pane, m², metre, panel, hour), a price and minutes per unit;
 *  - storey multipliers for items done from height;
 *  - adjustments: % or £ on top (first/dirty clean, inside as well, hard water, difficult access…);
 *  - frequency multipliers (4-weekly the base; one-off dearer);
 *  - labour rate and margin for pricing commercial work by time;
 *  - minimum charge, call-out, rounding and VAT.
 */

export type Unit = "each" | "pane" | "m2" | "metre" | "panel" | "hour";
export const UNIT_LABEL: Record<Unit, string> = { each: "each", pane: "per pane", m2: "per m²", metre: "per metre", panel: "per panel", hour: "per hour" };
export const CATEGORIES = ["Windows", "Doors & frames", "Conservatory & roof", "Solar", "Gutters & fascias", "Cladding & signs", "Other"] as const;

export type PriceItem = { id: string; name: string; category: string; unit: Unit; price: number; minutes: number; usesStorey?: boolean };
export type Preset = { id: string; name: string; prices: Record<string, number>; minutes: Record<string, number> };
export type Adjustment = { id: string; name: string; kind: "percent" | "fixed"; value: number };
export type FrequencyRate = { weeks: number; label: string; multiplier: number };

export type PricingConfig = {
  version: number;
  presets: Preset[];
  items: PriceItem[];
  storeyMultipliers: Record<string, number>;
  adjustments: Adjustment[];
  frequencies: FrequencyRate[];
  minimumCharge: number;
  callOut: number;
  rounding: number;
  vatRate: number;
  addVat: boolean;
  hourlyRate: number;
  margin: number;
};

export type CalcLine = { itemId: string; qty: number; storey?: number };
export type CalcBuilding = { name: string; lines: CalcLine[] };
export type CalcInput = {
  mode: "quick" | "detailed" | "commercial";
  frequencyWeeks: number;
  presetId?: string;
  bedrooms?: string;
  /** Detailed: extras on top of a quick preset are allowed too. */
  lines?: CalcLine[];
  buildings?: CalcBuilding[];
  adjustmentIds?: string[];
  /** Commercial */
  crew?: number;
  equipmentCost?: number;
  pricing?: "items" | "time";
};

export type BreakdownLine = { label: string; detail: string; amount: number; minutes: number; group?: string };
export type CalcResult = {
  lines: BreakdownLine[];
  itemsTotal: number;
  minutes: number;
  crewMinutes: number;
  timePrice: number | null;
  adjustments: Array<{ label: string; amount: number }>;
  frequencyLabel: string;
  frequencyFactor: number;
  minimumApplied: boolean;
  net: number;
  vat: number;
  perVisit: number;
  visitsPerYear: number;
  perYear: number;
  perMonth: number;
  hoursLabel: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const roundTo = (n: number, step: number) => (step > 0 ? Math.round(n / step) * step : n);
export const BEDROOMS = ["1", "2", "3", "4", "5", "6+"];

export function hoursLabel(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/** Work out a price. Never throws: unknown items are skipped. */
export function calculate(cfg: PricingConfig, input: CalcInput): CalcResult {
  const lines: BreakdownLine[] = [];
  const itemById = new Map(cfg.items.map((i) => [i.id, i]));
  const storeyFactor = (s?: number) => (s && s > 1 ? Number(cfg.storeyMultipliers[String(Math.min(Math.round(s), 6))] ?? 1) || 1 : 1);

  if (input.mode !== "commercial" && input.presetId) {
    const p = cfg.presets.find((x) => x.id === input.presetId);
    const beds = input.bedrooms ?? "3";
    if (p && p.prices[beds] != null) lines.push({ label: p.name, detail: `${beds} bedroom${beds === "1" ? "" : "s"}`, amount: r2(Number(p.prices[beds]) || 0), minutes: Number(p.minutes[beds]) || 0 });
  }
  const addLines = (ls: CalcLine[] | undefined, group?: string) => {
    for (const l of ls ?? []) {
      const it = itemById.get(l.itemId);
      const qty = Math.max(0, Number(l.qty) || 0);
      if (!it || qty <= 0) continue;
      const f = it.usesStorey ? storeyFactor(l.storey) : 1;
      const storey = it.usesStorey && l.storey && l.storey > 1 ? `, storey ${l.storey}` : "";
      lines.push({ label: it.name, detail: `${qty} × £${it.price.toFixed(2)} ${UNIT_LABEL[it.unit]}${storey}`, amount: r2(qty * it.price * f), minutes: qty * it.minutes * f, group });
    }
  };
  if (input.mode === "commercial") for (const b of input.buildings ?? []) addLines(b.lines, b.name || "Building");
  else addLines(input.lines);

  const itemsTotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const minutes = Math.round(lines.reduce((s, l) => s + l.minutes, 0));
  const crew = Math.max(1, Math.round(Number(input.crew) || 1));

  // Commercial: price from the items, or from the time (labour rate × hours + margin).
  const timePrice = input.mode === "commercial" ? r2((minutes / 60) * cfg.hourlyRate * (1 + cfg.margin / 100)) : null;
  let base = input.mode === "commercial" && input.pricing === "time" ? (timePrice ?? 0) : itemsTotal;
  if (input.mode === "commercial" && (Number(input.equipmentCost) || 0) > 0) {
    lines.push({ label: "Access equipment", detail: "hire / extra kit", amount: r2(Number(input.equipmentCost)), minutes: 0 });
    base += Number(input.equipmentCost);
  }

  const adjustments: Array<{ label: string; amount: number }> = [];
  const chosen = new Set(input.adjustmentIds ?? []);
  let adjusted = base;
  for (const a of cfg.adjustments) {
    if (!chosen.has(a.id)) continue;
    const amount = r2(a.kind === "percent" ? base * (a.value / 100) : a.value);
    adjustments.push({ label: `${a.name}${a.kind === "percent" ? ` (${a.value > 0 ? "+" : ""}${a.value}%)` : ""}`, amount });
    adjusted += amount;
  }
  const freq = cfg.frequencies.find((f) => f.weeks === input.frequencyWeeks) ?? { weeks: input.frequencyWeeks, label: input.frequencyWeeks ? `Every ${input.frequencyWeeks} weeks` : "One-off", multiplier: 1 };
  let net = adjusted * (freq.multiplier || 1);
  if (cfg.callOut > 0) { net += cfg.callOut; adjustments.push({ label: "Call-out", amount: r2(cfg.callOut) }); }
  const minimumApplied = net > 0 && net < cfg.minimumCharge;
  if (minimumApplied || (net === 0 && lines.length > 0)) net = Math.max(net, cfg.minimumCharge);
  net = r2(roundTo(net, cfg.rounding));
  const vat = cfg.addVat ? r2(net * (cfg.vatRate / 100)) : 0;
  const perVisit = r2(net + vat);
  const visitsPerYear = freq.weeks > 0 ? Math.round((52 / freq.weeks) * 10) / 10 : 1;
  const perYear = r2(perVisit * visitsPerYear);
  return {
    lines, itemsTotal, minutes, crewMinutes: Math.round(minutes / crew), timePrice, adjustments,
    frequencyLabel: freq.label, frequencyFactor: freq.multiplier || 1, minimumApplied,
    net, vat, perVisit, visitsPerYear, perYear, perMonth: r2(perYear / 12),
    hoursLabel: crew > 1 ? `${hoursLabel(minutes / crew)} with ${crew} people (${hoursLabel(minutes)} work)` : hoursLabel(minutes),
  };
}

/** Starting price list: typical UK prices to change, not recommendations. */
export function defaultPricingConfig(): PricingConfig {
  const preset = (id: string, name: string, prices: number[], minutes: number[]): Preset => ({
    id, name,
    prices: Object.fromEntries(BEDROOMS.map((b, i) => [b, prices[i]])),
    minutes: Object.fromEntries(BEDROOMS.map((b, i) => [b, minutes[i]])),
  });
  const item = (id: string, name: string, category: string, unit: Unit, price: number, minutes: number, usesStorey = false): PriceItem => ({ id, name, category, unit, price, minutes, usesStorey });
  return {
    version: 1,
    presets: [
      preset("flat", "Flat", [10, 12, 14, 16, 18, 20], [8, 10, 12, 14, 16, 18]),
      preset("terrace", "Terraced", [12, 14, 16, 18, 21, 24], [10, 12, 15, 18, 21, 25]),
      preset("semi", "Semi-detached", [13, 15, 18, 21, 24, 28], [12, 15, 18, 22, 26, 30]),
      preset("detached", "Detached", [15, 18, 22, 26, 30, 36], [15, 18, 22, 28, 34, 40]),
      preset("bungalow", "Bungalow", [12, 14, 17, 20, 23, 26], [10, 12, 15, 18, 21, 24]),
    ],
    items: [
      item("win_std", "Standard window", "Windows", "each", 1.5, 1.5, true),
      item("win_large", "Large / patio window", "Windows", "each", 3, 3, true),
      item("win_bay", "Bay window", "Windows", "each", 4, 4, true),
      item("win_sash", "Sash window", "Windows", "each", 2.5, 2.5, true),
      item("win_roof", "Roof window (Velux)", "Windows", "each", 3, 3, true),
      item("pane", "Commercial glass", "Windows", "pane", 1.2, 1, true),
      item("door", "Door (glass)", "Doors & frames", "each", 2, 2),
      item("frames", "Frames and sills (wipe down)", "Doors & frames", "each", 1, 1.5, true),
      item("cons_panels", "Conservatory side panels", "Conservatory & roof", "panel", 1, 1),
      item("cons_roof", "Conservatory roof", "Conservatory & roof", "each", 40, 45),
      item("solar", "Solar panel", "Solar", "panel", 4, 3),
      item("gutter_clear", "Gutter clear", "Gutters & fascias", "metre", 2.5, 2),
      item("fascia", "Fascias and soffits", "Gutters & fascias", "metre", 2, 1.5),
      item("cladding", "Cladding", "Cladding & signs", "m2", 3, 2, true),
      item("signage", "Signs", "Cladding & signs", "each", 5, 5),
      item("labour", "Extra labour", "Other", "hour", 30, 60),
    ],
    storeyMultipliers: { "1": 1, "2": 1, "3": 1.3, "4": 1.6, "5": 2, "6": 2.5 },
    adjustments: [
      { id: "first", name: "First clean / very dirty", kind: "percent", value: 50 },
      { id: "inside", name: "Inside as well", kind: "percent", value: 80 },
      { id: "hardwater", name: "Hard water stains", kind: "percent", value: 25 },
      { id: "access", name: "Difficult access", kind: "percent", value: 20 },
      { id: "outofhours", name: "Out of hours", kind: "percent", value: 25 },
      { id: "loyal", name: "Loyalty discount", kind: "percent", value: -10 },
    ],
    frequencies: [
      { weeks: 4, label: "Every 4 weeks", multiplier: 1 },
      { weeks: 6, label: "Every 6 weeks", multiplier: 1.1 },
      { weeks: 8, label: "Every 8 weeks", multiplier: 1.2 },
      { weeks: 12, label: "Every 12 weeks", multiplier: 1.35 },
      { weeks: 2, label: "Every 2 weeks", multiplier: 0.9 },
      { weeks: 1, label: "Weekly", multiplier: 0.85 },
      { weeks: 0, label: "One-off", multiplier: 1.5 },
    ],
    minimumCharge: 10,
    callOut: 0,
    rounding: 0.5,
    vatRate: 20,
    addVat: false,
    hourlyRate: 30,
    margin: 20,
  };
}

/** A saved price list, made safe: missing parts filled from the defaults, numbers checked. */
export function readPricingConfig(raw: string | null | undefined): PricingConfig {
  const def = defaultPricingConfig();
  if (!raw) return def;
  try {
    const c = JSON.parse(raw) as Partial<PricingConfig>;
    const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
    return {
      version: num(c.version, 1),
      presets: Array.isArray(c.presets) ? c.presets.filter((p) => p && p.id && p.name).map((p) => ({ id: String(p.id), name: String(p.name), prices: Object.fromEntries(BEDROOMS.map((b) => [b, num(p.prices?.[b], 0)])), minutes: Object.fromEntries(BEDROOMS.map((b) => [b, num(p.minutes?.[b], 0)])) })) : def.presets,
      items: Array.isArray(c.items) ? c.items.filter((i) => i && i.id && i.name).map((i) => ({ id: String(i.id), name: String(i.name), category: String(i.category || "Other"), unit: (Object.keys(UNIT_LABEL).includes(String(i.unit)) ? i.unit : "each") as Unit, price: num(i.price, 0), minutes: num(i.minutes, 0), usesStorey: Boolean(i.usesStorey) })) : def.items,
      storeyMultipliers: c.storeyMultipliers && typeof c.storeyMultipliers === "object" ? Object.fromEntries(Object.entries(c.storeyMultipliers).map(([k, v]) => [k, num(v, 1)])) : def.storeyMultipliers,
      adjustments: Array.isArray(c.adjustments) ? c.adjustments.filter((a) => a && a.id && a.name).map((a) => ({ id: String(a.id), name: String(a.name), kind: a.kind === "fixed" ? "fixed" : "percent", value: num(a.value, 0) })) : def.adjustments,
      frequencies: Array.isArray(c.frequencies) && c.frequencies.length ? c.frequencies.map((f) => ({ weeks: Math.max(0, Math.round(num(f.weeks, 4))), label: String(f.label || ""), multiplier: num(f.multiplier, 1) })) : def.frequencies,
      minimumCharge: num(c.minimumCharge, def.minimumCharge),
      callOut: num(c.callOut, def.callOut),
      rounding: num(c.rounding, def.rounding),
      vatRate: num(c.vatRate, def.vatRate),
      addVat: Boolean(c.addVat),
      hourlyRate: num(c.hourlyRate, def.hourlyRate),
      margin: num(c.margin, def.margin),
    };
  } catch {
    return def;
  }
}
