import { getAreas, getBusinessSettings, getPaymentsPage } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { fmtDate, fmtCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { PoundSterling, TrendingUp } from "lucide-react";
import { DebtorsPanel, PaymentsToolbar } from "./payments-client";

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
  const goCardlessSettings = settings as typeof settings & {
    goCardlessAccessToken?: string;
    goCardlessLastSyncedAt?: Date | null;
  };

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Payments</h1>
        <PaymentsToolbar
          customers={customersWithDebt}
          goCardlessConfigured={Boolean(goCardlessSettings.goCardlessAccessToken)}
          goCardlessLastSyncedAt={goCardlessSettings.goCardlessLastSyncedAt ? goCardlessSettings.goCardlessLastSyncedAt.toISOString() : null}
        />
      </div>

      {/* Debt summary with invoice + SMS actions */}
      {customersWithDebt.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5">
              <TrendingUp size={14} className="text-amber-500" />
              Customers Owing ({customersWithDebt.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <DebtorsPanel
              debtors={customersWithDebt}
              areas={owingAreas}
              businessName={settings.businessName || "Your Business"}
              smsTemplates={[
                settings.tmplPaymentReminder1 || "",
                settings.tmplPaymentReminder2 || "",
                settings.tmplPaymentReminder3 || "",
              ]}
            />
          </CardContent>
        </Card>
      )}

      {/* Recent payments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <PoundSterling size={14} className="text-green-500" />
            Payment History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {payments.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-500">No payments logged yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <Link href={`/customers/${p.customer.id}`} className="text-sm font-medium text-slate-800 hover:text-blue-600 hover:underline">
                      {p.customer.name}
                    </Link>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {p.method} · {fmtDate(p.paidAt)}
                      {p.notes ? ` · ${p.notes}` : ""}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-green-700">+{fmtCurrency(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

