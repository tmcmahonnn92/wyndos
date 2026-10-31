import { getQuotes } from "@/lib/actions";
import { getPricing } from "@/lib/pricing-actions";
import { requirePermission } from "@/lib/tenant-context";
import { QuotesClient } from "./quotes-client";

export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  await requirePermission("customers");
  const quotes = await getQuotes();
  const pricing = await getPricing().catch(() => null);
  return <QuotesClient quotes={JSON.parse(JSON.stringify(quotes))} canPrice={Boolean(pricing?.canUse)} canOpenCalculator={Boolean(pricing)} />;
}
