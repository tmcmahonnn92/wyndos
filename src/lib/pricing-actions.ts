"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { requireOwner, requirePerm } from "@/lib/guards";
import { calculate, readPricingConfig, type CalcInput, type PricingConfig } from "@/lib/pricing-calc";

/** The business's price list (the default UK list until they change it). */
export async function getPricing() {
  // Anyone who does quotes (customers) or quote visits (schedule).
  const actor = await requirePerm("customers").catch(() => requirePerm("schedule"));
  const s = await prisma.tenantSettings.findUnique({ where: { tenantId: actor.tenantId }, select: { pricingConfig: true } });
  return { config: readPricingConfig(s?.pricingConfig), canEdit: actor.role === "OWNER" || actor.role === "SUPER_ADMIN", saved: Boolean(s?.pricingConfig) };
}

/** Owner: save the price list. */
export async function savePricing(config: PricingConfig) {
  const actor = await requireOwner();
  const clean = readPricingConfig(JSON.stringify(config));
  clean.version = (readPricingConfig((await prisma.tenantSettings.findUnique({ where: { tenantId: actor.tenantId }, select: { pricingConfig: true } }))?.pricingConfig).version || 0) + 1;
  await prisma.tenantSettings.update({ where: { tenantId: actor.tenantId }, data: { pricingConfig: JSON.stringify(clean) } });
  revalidatePath("/quotes/calculator");
  return clean;
}

/** Owner: back to the default UK list. */
export async function resetPricing() {
  const actor = await requireOwner();
  await prisma.tenantSettings.update({ where: { tenantId: actor.tenantId }, data: { pricingConfig: "" } });
  revalidatePath("/quotes/calculator");
}

/** Open quotes to put a calculated price on. */
export async function openQuotesForPricing() {
  const actor = await requirePerm("customers");
  const quotes = await prisma.job.findMany({
    where: { tenantId: actor.tenantId, isQuote: true, quoteStatus: { in: ["TO_VISIT", "QUOTED"] } },
    select: { id: true, quotedPrice: true, customer: { select: { name: true, address: true } }, workDay: { select: { date: true } } },
    orderBy: { id: "desc" }, take: 100,
  });
  return quotes.map((q) => ({ id: q.id, name: q.customer.name, address: q.customer.address ?? "", date: q.workDay.date.toISOString().slice(0, 10), quotedPrice: q.quotedPrice }));
}

/**
 * Put a calculated price on a quote: marked quoted at that price and frequency, with the answers
 * saved so it can be re-priced. The price is worked out again here from the saved price list.
 */
export async function priceQuote(jobId: number, input: CalcInput, note?: string) {
  const actor = await requirePerm("schedule");
  const s = await prisma.tenantSettings.findUnique({ where: { tenantId: actor.tenantId }, select: { pricingConfig: true } });
  const config = readPricingConfig(s?.pricingConfig);
  const result = calculate(config, input);
  if (!(result.perVisit > 0)) throw new Error("Nothing to price yet.");
  const { markQuoted } = await import("@/lib/actions");
  await markQuoted(Number(jobId), { price: result.perVisit, frequencyWeeks: input.frequencyWeeks || undefined, notes: note });
  await prisma.job.updateMany({ where: { id: Number(jobId), tenantId: actor.tenantId, isQuote: true }, data: { quoteCalc: JSON.stringify({ input, result: { perVisit: result.perVisit, minutes: result.minutes, crewMinutes: result.crewMinutes }, priceListVersion: config.version, at: new Date().toISOString() }) } });
  revalidatePath("/quotes");
  return { price: result.perVisit, minutes: result.minutes };
}

/** The saved answers behind a quote (to open it in the calculator again). */
export async function quoteCalcInput(jobId: number) {
  const actor = await requirePerm("customers").catch(() => requirePerm("schedule"));
  const job = await prisma.job.findFirst({ where: { id: Number(jobId), tenantId: actor.tenantId, isQuote: true }, select: { quoteCalc: true } });
  try { return (JSON.parse(job?.quoteCalc ?? "null")?.input ?? null) as CalcInput | null; } catch { return null; }
}
