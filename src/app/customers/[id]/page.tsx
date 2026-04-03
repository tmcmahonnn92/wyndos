import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getCustomer, getAreas, getBusinessSettings, getCustomerBalance, getTags } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { auth } from "@/auth";
import { CustomerDetail } from "./customer-detail";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CustomerPage({ params }: Props) {
  await requirePermission("customers");
  const session = await auth();
  const hidePrices = session?.user?.role === "WORKER" && !(session.user.permissions ?? []).includes("viewprices");
  const { id } = await params;
  const customerId = Number(id);

  const customer = await getCustomer(customerId);
  if (!customer) notFound();

  const [areas, balance, allTags, settings] = await Promise.all([
    getAreas(),
    getCustomerBalance(customerId),
    getTags(),
    getBusinessSettings(),
  ]);

  return (
    <Suspense>
      <CustomerDetail
        customer={customer}
        areas={areas}
        balance={balance}
        allTags={allTags}
        hidePrices={hidePrices}
        goCardlessReferencePrefix={settings.goCardlessReferencePrefix || "WD"}
      />
    </Suspense>
  );
}
