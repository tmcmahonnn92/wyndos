/** Price calculator on quotes: price saved from the server's own price list, answers kept, time carried to the customer. */
import prisma from "@/lib/db";
import { createBusiness, setToday, settle, loginAs } from "./lib";
import { defaultPricingConfig } from "@/lib/pricing-calc";

let failed = 0;
const check = (label: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : " " + extra}`); if (!ok) failed++; };

async function main() {
  const act = await import("@/lib/actions");
  const pa = await import("@/lib/pricing-actions");
  setToday("2026-11-02");
  const { tenantId } = await createBusiness("pricing");
  await act.bulkImportCustomers([{ name: "Seed", address: "1 Seed Rd, Testford, ZZ9 9ZZ", price: 10, nextDueDate: "2026-11-20", frequencyWeeks: 4, areaName: "A", areaFrequencyWeeks: 4 }] as never, { createMissingAreas: true, bookRuns: true } as never);
  await settle();
  const area = await prisma.area.findFirstOrThrow({ where: { tenantId, isSystemArea: false } });

  const p0 = await pa.getPricing();
  check("no price list saved: example UK list", !p0.saved && p0.config.presets.length === 5);
  const cfg = defaultPricingConfig();
  cfg.presets[2].prices["3"] = 20; // their own semi 3-bed price
  const saved = await pa.savePricing(cfg);
  check("price list saved, version goes up", saved.version === 2 && (await pa.getPricing()).config.presets[2].prices["3"] === 20, String(saved.version));

  await act.createQuoteVisit({ name: "Prospect", address: "5 New St, Testford, ZZ9 9ZZ" }, "2026-11-03");
  const quote = await prisma.job.findFirstOrThrow({ where: { tenantId, isQuote: true } });
  const r = await pa.priceQuote(quote.id, { mode: "quick", frequencyWeeks: 4, presetId: "semi", bedrooms: "3", lines: [{ itemId: "solar", qty: 5 }] });
  const q = await prisma.job.findUniqueOrThrow({ where: { id: quote.id } });
  check("quote priced from the saved list: £20 + 5 panels × £4 = £40", r.price === 40 && q.quotedPrice === 40 && q.quoteStatus === "QUOTED" && q.quotedFrequencyWeeks === 4, JSON.stringify([r.price, q.quotedPrice, q.quoteStatus]));
  check("answers saved on the quote", (await pa.quoteCalcInput(quote.id))?.presetId === "semi");
  const open = await pa.openQuotesForPricing();
  check("open quotes listed for pricing", open.some((o) => o.id === quote.id));

  await act.markQuoteWon(quote.id, { areaId: area.id, price: 40, frequencyWeeks: 4 });
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: quote.customerId } });
  check("won: customer's clean time from the calculator (18 + 15 = 33 min)", c.cleanMinutes === 33, String(c.cleanMinutes));

  // Workers: what they can do depends on the two permissions.
  const asWorker = async (perms: string[]) => {
    const u = await prisma.user.create({ data: { email: `w${Date.now()}${Math.random()}@sim.test`, name: "W", role: "WORKER", tenantId, onboardingComplete: true } });
    await prisma.membership.create({ data: { userId: u.id, tenantId, role: "WORKER", permissions: JSON.stringify(perms) } });
    loginAs(u.id, tenantId);
  };
  const ok = (p: Promise<unknown>) => p.then(() => true, () => false);
  await asWorker(["dashboard", "schedule"]);
  check("worker without permission: no calculator, can't change prices", !(await ok(pa.getPricing())) && !(await ok(pa.savePricing(cfg))));
  await asWorker(["dashboard", "schedule", "calculator"]);
  const g = await pa.getPricing();
  check("worker with Price calculator: can use it, can't change the price list", g.canUse && !g.canEdit && !(await ok(pa.savePricing(cfg))));
  await asWorker(["dashboard", "pricelist"]);
  const g2 = await pa.getPricing();
  check("worker with Change price list: can save it", g2.canEdit && (await ok(pa.savePricing(cfg))));
  const owner = await prisma.membership.findFirstOrThrow({ where: { tenantId, role: "OWNER" } });
  loginAs(owner.userId, tenantId);

  await pa.resetPricing();
  check("reset: back to the example list", !(await pa.getPricing()).saved);
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  console.log(failed ? `${failed} FAILED` : "all passed");
  process.exit(failed ? 1 : 0);
}
main();
