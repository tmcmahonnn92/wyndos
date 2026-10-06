import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getCustomer, getCustomerBankReferences, getAreas, getBusinessSettings, getCustomerBalance, getCustomerCredit, getCustomerPickList, getTags } from "@/lib/actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { CustomerDetail } from "./customer-detail";
import { BankReferences } from "./bank-references";
import { PlaceAfter } from "./place-after";
import { getCustomerTexts } from "@/lib/text-actions";

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

  const canPay = user.role !== "WORKER" || (user.permissions ?? []).includes("payments");
  const [areas, balance, credit, allTags, settings, pickList, texts, bankRefs] = await Promise.all([
    getAreas(),
    getCustomerBalance(customerId),
    getCustomerCredit(customerId).catch(() => 0),
    getTags(),
    getBusinessSettings(),
    getCustomerPickList(),
    getCustomerTexts(customerId).catch(() => []),
    canPay ? getCustomerBankReferences(customerId).catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <Suspense>
      <CustomerDetail
        customer={customer}
        areas={areas}
        balance={balance}
        credit={credit}
        canPay={canPay}
        allowCredit={settings.allowCustomerCredit ?? true}
        allTags={allTags}
        hidePrices={hidePrices}
        goCardlessReferencePrefix={settings.goCardlessReferencePrefix || "WD"}
        texts={texts.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))}
      />
      <PlaceAfter
        customerId={customer.id}
        afterName={customer.placeAfterCustomerId ? pickList.find((c) => c.id === customer.placeAfterCustomerId)?.name ?? null : null}
      />
      {canPay && <BankReferences refs={bankRefs.map(({ id, label }) => ({ id, label }))} />}
    </Suspense>
  );
}
