import { redirect } from "next/navigation";
import { getPricing } from "@/lib/pricing-actions";
import { CalculatorPage } from "./calculator-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Price calculator" };

export default async function PriceCalculatorRoute() {
  // Needs "Price calculator" (or "Change price list") permission; owners always have both.
  const pricing = await getPricing().catch(() => null);
  if (!pricing) redirect("/quotes");
  return <CalculatorPage config={pricing.config} canEdit={pricing.canEdit} canUse={pricing.canUse} saved={pricing.saved} />;
}
