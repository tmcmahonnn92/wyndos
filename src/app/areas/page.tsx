import { getCustomers, getAreaSchedules } from "@/lib/actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { AreasShell } from "./areas-shell";

export const dynamic = "force-dynamic";

export default async function AreasPage() {
  await requirePermission("areas");
  const user = await getActiveUserContext();
  const hidePrices = user.role === "WORKER" && !(user.permissions ?? []).includes("viewprices");
  const [customers, areas] = await Promise.all([
    getCustomers(), // all active customers
    getAreaSchedules(),
  ]);

  return <AreasShell customers={customers} areas={areas} hidePrices={hidePrices} />;
}
