import { requirePermission } from "@/lib/tenant-context";
import { getPricing } from "@/lib/pricing-actions";
import { CalculatorPage } from "./calculator-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Price calculator" };

export default async function PriceCalculatorRoute() {
  await requirePermission("customers");
  const { config, canEdit, saved } = await getPricing();
  return <CalculatorPage config={config} canEdit={canEdit} saved={saved} />;
}
