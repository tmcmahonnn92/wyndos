import { getCustomers, getAreas } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { BulkEditClient } from "./bulk-edit-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bulk Edit Customers" };

export default async function BulkEditPage() {
  await requirePermission("customers");
  const [customers, areas] = await Promise.all([getCustomers(undefined, undefined, true), getAreas()]);

  // Only pass the fields needed by the client
  const customerData = customers.map((c) => ({
    id: c.id,
    name: c.name,
    address: c.address,
    areaId: c.areaId,
    price: c.price,
    frequencyWeeks: c.frequencyWeeks,
    notes: c.notes,
    active: c.active,
  }));

  const areaData = areas.map((a) => ({ id: a.id, name: a.name, frequencyWeeks: a.frequencyWeeks }));

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <BulkEditClient customers={customerData} areas={areaData} />
    </div>
  );
}
