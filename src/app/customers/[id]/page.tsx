import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getCustomer, getAreas, getBusinessSettings, getCustomerBalance, getCustomerPickList, getTags } from "@/lib/actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { CustomerDetail } from "./customer-detail";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CustomerPage({ params }: Props) {
  await requirePermission("customers");
  const user = await getActiveUserContext();
  const hidePrices = user.role === "WORKER" && !(user.permissions ?? []).includes("viewprices");
  const { id } = await params;
  const customerId = Number(id);

  const customer = await getCustomer(customerId);
  if (!customer) notFound();

  const [areas, balance, allTags, settings, pickList] = await Promise.all([
    getAreas(),
    getCustomerBalance(customerId),
    getTags(),
    getBusinessSettings(),
    getCustomerPickList(),
  ]);
  const payerOptions = pickList.filter((entry) => entry.id !== customerId && !entry.paidByCustomerId);

  return (
    <Suspense>
      <CustomerDetail
        customer={customer}
        areas={areas}
        balance={balance}
        allTags={allTags}
        hidePrices={hidePrices}
        goCardlessReferencePrefix={settings.goCardlessReferencePrefix || "WD"}
        payerOptions={payerOptions.map(({ id, name }) => ({ id, name }))}
      />
    </Suspense>
  );
}
