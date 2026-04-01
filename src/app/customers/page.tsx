import Link from "next/link";
import { ChevronRight, Plus, Search, TableProperties, Upload } from "lucide-react";
import { getCustomers, getAreas, getTags } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { auth } from "@/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { CustomerFilters } from "./customer-filters";
import { AddCustomerModal } from "./add-customer-modal";
import { CustomerActiveToggle } from "./customer-active-toggle";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ areas?: string; tags?: string; q?: string; inactive?: string; oneoff?: string }>;
}

export default async function CustomersPage({ searchParams }: Props) {
  await requirePermission("customers");
  const session = await auth();
  const hidePrices = session?.user?.role === "WORKER" && !(session.user.permissions ?? []).includes("viewprices");
  const { areas: areasParam, tags: tagsParam, q, inactive, oneoff } = await searchParams;
  const showInactive = inactive === "1";
  const onlyOneOff = oneoff === "1";
  const selectedAreaIds = areasParam
    ? areasParam.split(",").map(Number).filter(Boolean)
    : [];
  const selectedTagIds = tagsParam
    ? tagsParam.split(",").map(Number).filter(Boolean)
    : [];
  const [customers, areas, allTags] = await Promise.all([
    getCustomers(
      onlyOneOff ? undefined : (selectedAreaIds.length > 0 ? selectedAreaIds : undefined),
      q,
      showInactive,
      selectedTagIds.length > 0 ? selectedTagIds : undefined,
      onlyOneOff,
    ),
    getAreas(),
    getTags(),
  ]);
  const activeCustomers = customers.filter((customer) => customer.active);
  const inactiveCustomers = customers.length - activeCustomers.length;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueCustomers = activeCustomers.filter((customer) => customer.nextDueDate && new Date(customer.nextDueDate) < today).length;
  const totalDebt = customers.reduce((sum, customer) => {
    const outstandingTotal = customer.jobs.reduce((jobSum, job) => {
      const paid = job.allocations.reduce((paidSum, allocation) => paidSum + allocation.amount, 0);
      return jobSum + Math.max(0, job.price - paid);
    }, 0);
    return sum + outstandingTotal;
  }, 0);

  return (
    <div className="px-4 py-5 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Customers</h1>
          <p className="text-sm text-slate-500 mt-1">Compact list view for quick scanning across all areas.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/customers/import"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors"
          >
            <Upload size={14} />
            Import
          </Link>
          <Link
            href="/customers/bulk-edit"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors"
          >
            <TableProperties size={14} />
            Bulk Edit
          </Link>
          <AddCustomerModal areas={areas} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Visible customers" value={String(customers.length)} detail={`${activeCustomers.length} active`} />
        <SummaryCard label="Overdue" value={String(overdueCustomers)} detail="Past next-due date" tone={overdueCustomers > 0 ? "danger" : "default"} />
        <SummaryCard label="Inactive" value={String(inactiveCustomers)} detail="Hidden from scheduling" />
        <SummaryCard label="Outstanding debt" value={hidePrices ? "Hidden" : fmtCurrency(totalDebt)} detail={hidePrices ? "Worker prices hidden" : "Across visible customers"} tone={totalDebt > 0 ? "warning" : "default"} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <CustomerFilters areas={areas} currentAreas={selectedAreaIds} currentQ={q} currentInactive={showInactive} tags={allTags} currentTags={selectedTagIds} currentOneOff={onlyOneOff} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-3">
            <span>Customer list</span>
            <Badge variant="muted">{customers.length} total</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-slate-100">
            {customers.map((customer) => (
              <CustomerRow key={customer.id} customer={customer} hidePrices={hidePrices} />
            ))}
          </ul>
        </CardContent>
      </Card>

      {customers.length === 0 && (
        <Card className="border-dashed border-slate-300">
          <CardContent className="py-10 text-center text-slate-500">
            <p>No customers found.</p>
            {q && <p className="text-sm mt-1">Try a different search.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-white px-4 py-3 shadow-sm",
        tone === "warning" && "border-amber-200 bg-amber-50/60",
        tone === "danger" && "border-red-200 bg-red-50/60",
        tone === "default" && "border-slate-200"
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function CustomerRow({
  customer,
  hidePrices = false,
}: {
  customer: Awaited<ReturnType<typeof getCustomers>>[0];
  hidePrices?: boolean;
}) {
  const isOverdue =
    customer.nextDueDate && new Date(customer.nextDueDate) < new Date(new Date().setHours(0, 0, 0, 0));
  const isInactive = !customer.active;
  const outstandingDebt = customer.jobs.reduce((sum, job) => {
    const paid = job.allocations.reduce((paidSum, allocation) => paidSum + allocation.amount, 0);
    return sum + Math.max(0, job.price - paid);
  }, 0);
  const areaName = customer.area?.isSystemArea ? "One-off" : customer.area?.name ?? "Unassigned";
  const areaColor = customer.area?.color || (customer.area?.isSystemArea ? "#A855F7" : "#3B82F6");

  return (
    <li className={cn(isInactive && "bg-red-50")}>
      <div className="flex items-center gap-3 px-4 py-3">
        <Link
          href={`/customers/${customer.id}`}
          className={cn(
            "flex-1 min-w-0 rounded-2xl px-1 py-1 hover:bg-slate-50 transition-colors",
            isInactive && "hover:bg-red-100/60"
          )}
        >
          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_150px_120px] md:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className={cn("text-sm font-semibold truncate", isInactive ? "text-red-700 line-through opacity-70" : "text-slate-800")}>
                  {customer.name}
                </p>
                <span
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                  style={{ borderColor: `${areaColor}55`, color: areaColor, backgroundColor: `${areaColor}12` }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: areaColor }} />
                  {areaName}
                </span>
                {isInactive && (
                  <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
                    Inactive
                  </span>
                )}
              </div>
              <p className={cn("text-xs mt-1 truncate", isInactive ? "text-red-400" : "text-slate-500")}>
                {customer.address}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                {!isInactive && (
                  <span className={cn(
                    "rounded-full px-2 py-0.5 font-medium",
                    isOverdue ? "bg-red-50 text-red-600 border border-red-200" : "bg-slate-100 text-slate-600 border border-slate-200"
                  )}>
                    Due {fmtDate(customer.nextDueDate)}
                  </span>
                )}
                {!isInactive && customer.lastCompletedDate && (
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-500">
                    Last cleaned {fmtDate(customer.lastCompletedDate)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 md:justify-end">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right min-w-[108px]">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Frequency</p>
                <p className={cn("text-sm font-semibold", isInactive ? "text-red-400" : "text-slate-700")}>
                  every {customer.frequencyWeeks}w
                </p>
              </div>
              {!hidePrices && (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-right min-w-[108px]">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Price</p>
                  <p className={cn("text-sm font-bold", isInactive ? "text-red-400" : "text-slate-800")}>
                    {fmtCurrency(customer.price)}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 md:justify-end">
              {!hidePrices && (
                <div className="min-w-[120px] rounded-xl border px-3 py-2 text-right">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Debt</p>
                  <p className={cn("text-sm font-bold", outstandingDebt > 0 ? "text-red-600" : "text-slate-400")}>
                    {outstandingDebt > 0 ? fmtCurrency(outstandingDebt) : "Clear"}
                  </p>
                </div>
              )}
              <div className="flex-shrink-0">
                <CustomerActiveToggle customerId={customer.id} active={customer.active} />
              </div>
            </div>
          </div>
          <ChevronRight size={15} className={cn("ml-2 flex-shrink-0", isInactive ? "text-red-300" : "text-slate-300")} />
        </Link>
      </div>
    </li>
  );
}

