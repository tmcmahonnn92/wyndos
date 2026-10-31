"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { hasPermission, requirePerm } from "@/lib/guards";
import { calculate, readPricingConfig, type CalcInput, type PricingConfig } from "@/lib/pricing-calc";

/** The business's price list (the default UK list until they change it). */
export async function getPricing() {
  const actor = await requirePerm("calculator").catch(() => requirePerm("pricelist"));
  const s = await prisma.tenantSettings.findUnique({ where: { tenantId: actor.tenantId }, select: { pricingConfig: true } });
  return { config: readPricingConfig(s?.pricingConfig), canEdit: hasPermission(actor, "pricelist"), canUse: hasPermission(actor, "calculator"), saved: Boolean(s?.pricingConfig) };
}

/** Save the price list (owners, or anyone allowed to change it). */
export async function savePricing(config: PricingConfig) {
  const actor = await requirePerm("pricelist");
  const clean = readPricingConfig(JSON.stringify(config));
  clean.version = (readPricingConfig((await prisma.tenantSettings.findUnique({ where: { tenantId: actor.tenantId }, select: { pricingConfig: true } }))?.pricingConfig).version || 0) + 1;
  await prisma.tenantSettings.update({ where: { tenantId: actor.tenantId }, data: { pricingConfig: JSON.stringify(clean) } });
  revalidatePath("/quotes/calculator");
  return clean;
}

/** Back to the example UK list. */
export async function resetPricing() {
  const actor = await requirePerm("pricelist");
  await prisma.tenantSettings.update({ where: { tenantId: actor.tenantId }, data: { pricingConfig: "" } });
  revalidatePath("/quotes/calculator");
}

/** Open quotes to put a calculated price on. */
export async function openQuotesForPricing() {
  const actor = await requirePerm("calculator");
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
  const actor = await requirePerm("calculator");
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
  const actor = await requirePerm("calculator");
  const job = await prisma.job.findFirst({ where: { id: Number(jobId), tenantId: actor.tenantId, isQuote: true }, select: { quoteCalc: true } });
  try { return (JSON.parse(job?.quoteCalc ?? "null")?.input ?? null) as CalcInput | null; } catch { return null; }
}
