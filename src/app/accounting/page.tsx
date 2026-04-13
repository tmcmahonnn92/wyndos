import { getAccountingPage } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { AccountingClient } from "./accounting-client";

export const dynamic = "force-dynamic";

export default async function AccountingPage() {
  await requirePermission("payments");
  const accounting = await getAccountingPage();

  return <AccountingClient {...accounting} />;
}