/** Price calculator engine: sums, storeys, adjustments, frequency, minimum, rounding, VAT, time. */
import { calculate, defaultPricingConfig, readPricingConfig } from "@/lib/pricing-calc";

let failed = 0;
const check = (label: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : " " + extra}`); if (!ok) failed++; };
const cfg = defaultPricingConfig();

const q = calculate(cfg, { mode: "quick", frequencyWeeks: 4, presetId: "semi", bedrooms: "3" });
check("quick: semi 3 bed every 4 weeks = £18, 18 min", q.perVisit === 18 && q.minutes === 18, JSON.stringify([q.perVisit, q.minutes]));
check("…13 visits a year, £234/yr, £19.50/month", q.visitsPerYear === 13 && q.perYear === 234 && q.perMonth === 19.5, JSON.stringify([q.visitsPerYear, q.perYear, q.perMonth]));

const q8 = calculate(cfg, { mode: "quick", frequencyWeeks: 8, presetId: "semi", bedrooms: "3", lines: [{ itemId: "solar", qty: 10 }], adjustmentIds: ["first"] });
// (18 + 40) × 1.5 first clean = 87 × 1.2 (8-weekly) = 104.4 → nearest 50p = 104.5
check("quick + 10 solar panels, first clean, 8-weekly = £104.50", q8.perVisit === 104.5, String(q8.perVisit));

const d = calculate(cfg, { mode: "detailed", frequencyWeeks: 4, lines: [{ itemId: "win_std", qty: 10 }, { itemId: "win_std", qty: 4, storey: 3 }, { itemId: "door", qty: 2 }] });
// 10×1.5 + 4×1.5×1.3 + 2×2 = 15 + 7.8 + 4 = 26.8 → 27
check("detailed with third-floor windows: £27, storey ×1.3", d.perVisit === 27 && d.itemsTotal === 26.8, JSON.stringify([d.perVisit, d.itemsTotal]));

const min = calculate(cfg, { mode: "detailed", frequencyWeeks: 4, lines: [{ itemId: "win_std", qty: 2 }] });
check("minimum charge applies (£3 → £10)", min.perVisit === 10 && min.minimumApplied);

const vatCfg = { ...cfg, addVat: true };
const v = calculate(vatCfg, { mode: "quick", frequencyWeeks: 4, presetId: "detached", bedrooms: "4" });
check("VAT added: £26 + 20% = £31.20", v.net === 26 && v.vat === 5.2 && v.perVisit === 31.2, JSON.stringify([v.net, v.vat, v.perVisit]));

const c = calculate(cfg, { mode: "commercial", frequencyWeeks: 4, crew: 2, equipmentCost: 50, pricing: "time", buildings: [{ name: "Block A", lines: [{ itemId: "pane", qty: 200 }] }, { name: "Block B", lines: [{ itemId: "pane", qty: 100, storey: 3 }] }] });
// minutes 200 + 130 = 330; time price 5.5h × £30 × 1.2 = 198; + 50 equipment = 248
check("commercial by time: 330 min, £198 + £50 kit = £248", c.minutes === 330 && c.timePrice === 198 && c.perVisit === 248, JSON.stringify([c.minutes, c.timePrice, c.perVisit]));
check("…with 2 people: 2h 45m on site", c.crewMinutes === 165 && c.hoursLabel.startsWith("2h 45m"), c.hoursLabel);
const ci = calculate(cfg, { mode: "commercial", frequencyWeeks: 4, buildings: [{ name: "A", lines: [{ itemId: "pane", qty: 200 }] }], pricing: "items" });
check("commercial by items: 200 × £1.20 = £240", ci.perVisit === 240, String(ci.perVisit));

const one = calculate(cfg, { mode: "quick", frequencyWeeks: 0, presetId: "terrace", bedrooms: "2" });
check("one-off ×1.5: £14 → £21, 1 visit a year", one.perVisit === 21 && one.visitsPerYear === 1);

const saved = readPricingConfig(JSON.stringify({ ...cfg, minimumCharge: "12", items: [...cfg.items, { id: "x", name: "Bad", unit: "nope", price: "abc" }] }));
check("saved list read safely: bad unit and price fixed", saved.minimumCharge === 12 && saved.items.find((i) => i.id === "x")?.unit === "each" && saved.items.find((i) => i.id === "x")?.price === 0);
check("rubbish saved: defaults", readPricingConfig("{oops").presets.length === cfg.presets.length);
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
