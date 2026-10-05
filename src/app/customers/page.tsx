import Link from "next/link";
import { TableProperties, Sparkles, Upload, MapPin } from "lucide-react";
import { getCustomers, getAreas, getTags } from "@/lib/actions";
import { AREA_SORT_ENABLED } from "@/lib/features";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { CustomerFilters } from "./customer-filters";
import { AddCustomerModal } from "./add-customer-modal";
import { CustomerActiveToggle } from "./customer-active-toggle";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ areas?: string; tags?: string; q?: string; inactive?: string; oneoff?: string; action?: string }>;
}

export default async function CustomersPage({ searchParams }: Props) {
  await requirePermission("customers");
  const user = await getActiveUserContext();
  const hidePrices = user.role === "WORKER" && !(user.permissions ?? []).includes("viewprices");
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
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-slate-800">Customers</h1>
          <AddCustomerModal areas={areas} />
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <Link href="/customers/import" className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors">
            <Upload size={14} />
            Import
          </Link>
          <Link href="/customers/bulk-edit" className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors">
            <TableProperties size={14} />
            Bulk Edit
          </Link>
          {AREA_SORT_ENABLED && <Link href="/customers/organise" className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors">
            <Sparkles size={14} />
            Sort into areas
          </Link>}
          <Link href="/customers/addresses" className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors">
            <MapPin size={14} />
            Tidy addresses
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <SummaryCard label="Customers" value={String(customers.length)} detail={`${activeCustomers.length} active`} />
        <SummaryCard label="Overdue" value={String(overdueCustomers)} detail="Past due date" tone={overdueCustomers > 0 ? "danger" : "default"} />
        <SummaryCard label="Inactive" value={String(inactiveCustomers)} detail="Not scheduled" />
        <SummaryCard label="Owed" value={hidePrices ? "Hidden" : fmtCurrency(totalDebt)} detail={hidePrices ? "Prices hidden" : "By these customers"} tone={totalDebt > 0 ? "warning" : "default"} />
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
        "rounded-xl border bg-white px-3 py-2 shadow-sm",
        tone === "warning" && "border-amber-200 bg-amber-50/60",
        tone === "danger" && "border-red-200 bg-red-50/60",
        tone === "default" && "border-slate-200"
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-500">{detail}</p>
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
    <li className={cn("flex items-center gap-3 px-4 py-3", isInactive && "bg-red-50")}>
      <Link
        href={`/customers/${customer.id}`}
        className={cn("min-w-0 flex-1 rounded-lg transition-colors hover:bg-slate-50", isInactive && "hover:bg-red-100/60")}
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className={cn("min-w-0 truncate text-[15px] font-semibold", isInactive ? "text-red-700 line-through opacity-70" : "text-slate-800")}>
            {customer.name}
          </p>
          {!hidePrices && (
            <p className={cn("flex-shrink-0 text-sm font-bold tabular-nums", isInactive ? "text-red-400" : "text-slate-800")}>
              {fmtCurrency(customer.price)}
            </p>
          )}
        </div>
        {customer.address && customer.address !== customer.name && (
          <p className={cn("truncate text-xs", isInactive ? "text-red-400" : "text-slate-500")}>{customer.address}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1 font-medium text-slate-600">
            <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: areaColor }} />
            {areaName}
          </span>
          {isInactive ? (
            <span className="font-semibold text-red-600">Inactive</span>
          ) : (
            <span className={cn(isOverdue ? "font-semibold text-red-600" : "text-slate-500")}>
              Due {fmtDate(customer.nextDueDate)}
            </span>
          )}
          <span className="text-slate-400">every {customer.frequencyWeeks}w</span>
          {!hidePrices && outstandingDebt > 0 && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-600 ring-1 ring-red-200">
              Owes {fmtCurrency(outstandingDebt)}
            </span>
          )}
        </div>
      </Link>
      <div className="flex-shrink-0">
        <CustomerActiveToggle customerId={customer.id} active={customer.active} />
      </div>
    </li>
  );
}

