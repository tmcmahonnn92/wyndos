import { getAccountingPage } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { AccountingClient } from "./accounting-client";

export const dynamic = "force-dynamic";

export default async function AccountingPage({
  searchParams,
}: {
  searchParams?: Promise<{ taxYear?: string }>;
}) {
  await requirePermission("payments");
  const params = (await searchParams) ?? {};
  const parsedTaxYear = Number.parseInt(params.taxYear ?? "", 10);
  const accounting = await getAccountingPage({
    taxYearStart: Number.isFinite(parsedTaxYear) ? parsedTaxYear : null,
  });

  return <AccountingClient {...accounting} />;
}