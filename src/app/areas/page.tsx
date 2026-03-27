import { getCustomers, getAreaSchedules } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { auth } from "@/auth";
import { AreasShell } from "./areas-shell";

export const dynamic = "force-dynamic";

export default async function AreasPage() {
  await requirePermission("areas");
  const session = await auth();
  const hidePrices = session?.user?.role === "WORKER" && !(session.user.permissions ?? []).includes("viewprices");
  const [customers, areas] = await Promise.all([
    getCustomers(), // all active customers
    getAreaSchedules(),
  ]);

  return <AreasShell customers={customers} areas={areas} hidePrices={hidePrices} />;
}
