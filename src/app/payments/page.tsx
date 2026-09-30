import { getAreas, getBusinessSettings, getPaymentsPage } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { PaymentsToolbar } from "./payments-client";
import { PaymentsBody } from "./payments-search";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  await requirePermission("payments");
  const [{ payments, customersWithDebt }, areas, settings] = await Promise.all([
    getPaymentsPage(),
    getAreas(),
    getBusinessSettings(),
  ]);
  const owingAreaIds = new Set(customersWithDebt.map((customer) => customer.areaId).filter((id): id is number => typeof id === "number"));
  const owingAreas = areas.filter((area) => owingAreaIds.has(area.id));

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Payments</h1>
        <PaymentsToolbar
          customers={customersWithDebt}
          goCardlessConfigured={settings.goCardlessConfigured}
          goCardlessLastSyncedAt={settings.goCardlessLastSyncedAt ? settings.goCardlessLastSyncedAt.toISOString() : null}
        />
      </div>

      <PaymentsBody
        debtors={customersWithDebt}
        areas={owingAreas}
        businessName={settings.businessName || "Your Business"}
        smsTemplates={[
          settings.tmplPaymentReminder1 || "",
          settings.tmplPaymentReminder2 || "",
          settings.tmplPaymentReminder3 || "",
        ]}
        payments={payments.map((p) => ({
          id: p.id,
          customerId: p.customer.id,
          name: p.customer.name,
          address: p.customer.address,
          method: p.method,
          paidAt: new Date(p.paidAt).toISOString(),
          notes: p.notes,
          amount: p.amount,
        }))}
      />
    </div>
  );
}

