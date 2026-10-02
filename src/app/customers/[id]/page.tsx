import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getCustomer, getCustomerBankReferences, getAreas, getBusinessSettings, getCustomerBalance, getCustomerCredit, getCustomerPickList, getTags } from "@/lib/actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { CustomerDetail } from "./customer-detail";
import { BankReferences } from "./bank-references";
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
  const payerOptions = pickList.filter((entry) => entry.id !== customerId && !entry.paidByCustomerId);

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
        payerOptions={payerOptions.map(({ id, name }) => ({ id, name }))}
        texts={texts.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))}
      />
      {canPay && <BankReferences refs={bankRefs.map(({ id, label }) => ({ id, label }))} />}
    </Suspense>
  );
}
