import { getAreas, getBusinessSettings, getPaymentsPage } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { PaymentsToolbar } from "./payments-client";
import { PaymentsBody } from "./payments-search";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ late?: string; tab?: string }> }) {
  await requirePermission("payments");
  const [{ payments, customersWithDebt, customersWithCredit, allCustomers }, areas, settings, params] = await Promise.all([
    getPaymentsPage(),
    getAreas(),
    getBusinessSettings(),
    searchParams,
  ]);
  const owingAreaIds = new Set(customersWithDebt.map((customer) => customer.areaId).filter((id): id is number => typeof id === "number"));
  const owingAreas = areas.filter((area) => owingAreaIds.has(area.id));

  // "Late" = something owing for longer than the reminder setting (or 14 days).
  const lateAfter = settings.textPaymentReminderDays && settings.textPaymentReminderDays > 0 ? settings.textPaymentReminderDays : 14;
  const now = Date.now();
  const debtors = customersWithDebt.map((customer) => {
    const oldest = customer.unpaidJobs.reduce<number | null>((min, job) => {
      const t = job.date ? new Date(job.date).getTime() : null;
      return t !== null && (min === null || t < min) ? t : min;
    }, null);
    const daysOwing = oldest === null ? 0 : Math.floor((now - oldest) / DAY);
    return { ...customer, daysOwing, late: daysOwing >= lateAfter };
  });

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const takenThisMonth = payments
    .filter((p) => new Date(p.paidAt) >= monthStart)
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="px-4 py-5 max-w-3xl mx-auto space-y-5">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-slate-800">Payments</h1>
          <PaymentsToolbar
            customers={debtors}
            allCustomers={allCustomers}
            goCardlessConfigured={settings.goCardlessConfigured}
            goCardlessLastSyncedAt={settings.goCardlessLastSyncedAt ? settings.goCardlessLastSyncedAt.toISOString() : null}
          />
        </div>
      </div>

      <PaymentsBody
        debtors={debtors}
        lateAfter={lateAfter}
        startLate={params.late === "1"}
        startTab={params.tab === "history" ? "history" : params.tab === "credit" ? "credit" : "owing"}
        takenThisMonth={takenThisMonth}
        credits={customersWithCredit}
        areas={owingAreas}
        businessName={settings.businessName || "Your Business"}
        smsTemplates={[
          settings.tmplPaymentReminder1 || "",
          settings.tmplPaymentReminder2 || "",
          settings.tmplPaymentReminder3 || "",
        ]}
        payments={payments.map((p) => {
          const allocated = p.allocations.reduce((sum, a) => sum + a.amount, 0);
          return {
            id: p.id,
            customerId: p.customer.id,
            name: p.customer.name,
            address: p.customer.address,
            method: p.method,
            paidAt: new Date(p.paidAt).toISOString(),
            notes: p.notes,
            amount: p.amount,
            credit: Number(Math.max(0, p.amount - allocated).toFixed(2)),
            jobs: p.allocations.map((a) => ({
              id: a.job.id,
              name: a.job.name,
              date: a.job.workDay?.date ? new Date(a.job.workDay.date).toISOString() : null,
              notes: a.job.notes ?? "",
              amount: a.amount,
            })),
          };
        })}
      />
    </div>
  );
}
