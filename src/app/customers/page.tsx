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

  // Group by area
  const grouped = areas.map((a) => ({
    area: a,
    customers: customers.filter((c) => c.areaId === a.id),
  })).filter((g) => g.customers.length > 0);

  const ungrouped = customers.filter((c) => !areas.some((a) => a.id === c.areaId));
  const oneOffCustomers = ungrouped.filter((c) => c.area?.isSystemArea);
  const otherCustomers = ungrouped.filter((c) => !c.area?.isSystemArea);

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Customers</h1>
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

      {/* Filters */}
      <CustomerFilters areas={areas} currentAreas={selectedAreaIds} currentQ={q} currentInactive={showInactive} tags={allTags} currentTags={selectedTagIds} currentOneOff={onlyOneOff} />

      <p className="text-sm text-slate-500">{customers.length} customer{customers.length !== 1 ? "s" : ""}</p>

      {/* Grouped list */}
      {grouped.map(({ area: a, customers: cs }) => (
        <Card key={a.id}>
          <CardHeader>
            <CardTitle>
              <span
                className="inline-block w-3 h-3 rounded-full mr-2 flex-shrink-0"
                style={{ backgroundColor: a.color || "#3B82F6" }}
              />
              {a.name} ({cs.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {cs.map((c) => (
                <CustomerRow key={c.id} customer={c} hidePrices={hidePrices} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      {ungrouped.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {oneOffCustomers.length === ungrouped.length ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-full bg-purple-400 flex-shrink-0" />
                  One-off Customers ({oneOffCustomers.length})
                </span>
              ) : (
                <>Other ({ungrouped.length})</>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {ungrouped.map((c) => (
                <CustomerRow key={c.id} customer={c} hidePrices={hidePrices} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

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
  const billedTotal = customer.jobs.reduce((sum, job) => sum + job.price, 0);
  const paidTotal = customer.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const outstandingDebt = Math.max(0, billedTotal - paidTotal);

  return (
    <li className={cn(isInactive && "bg-red-50")}>
      <div className="flex items-center">
        <Link
          href={`/customers/${customer.id}`}
          className={cn(
            "flex items-center justify-between flex-1 min-w-0 px-4 py-3 hover:bg-slate-50 transition-colors",
            isInactive && "hover:bg-red-100/60"
          )}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className={cn("text-sm font-medium truncate", isInactive ? "text-red-700 line-through opacity-70" : "text-slate-800")}>
                {customer.name}
              </p>
              {isInactive && (
                <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
                  Inactive
                </span>
              )}
            </div>
            <p className={cn("text-xs mt-0.5 truncate", isInactive ? "text-red-400" : "text-slate-500")}>
              {customer.address}
            </p>
            {!isInactive && (
              <p className={`text-xs mt-0.5 ${isOverdue ? "text-red-500 font-medium" : "text-slate-400"}`}>
                Due: {fmtDate(customer.nextDueDate)}
              </p>
            )}
            {!isInactive && customer.lastCompletedDate && (
              <p className="text-xs mt-0.5 text-slate-400">
                Last cleaned: {fmtDate(customer.lastCompletedDate)}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 ml-3 flex-shrink-0">
            <span className={cn("text-sm font-bold", isInactive ? "text-red-400" : "text-slate-700")}>
              {hidePrices ? null : fmtCurrency(customer.price)}
            </span>
            <span className={cn("text-xs", isInactive ? "text-red-300" : "text-slate-400")}>
              every {customer.frequencyWeeks}w
            </span>
            {!isInactive && outstandingDebt > 0 && !hidePrices && (
              <span className="text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
                Owes {fmtCurrency(outstandingDebt)}
              </span>
            )}
          </div>
          <ChevronRight size={15} className={cn("ml-2 flex-shrink-0", isInactive ? "text-red-300" : "text-slate-300")} />
        </Link>
        {/* Active toggle — sits outside Link so it doesn't navigate */}
        <div className="pr-3 flex-shrink-0">
          <CustomerActiveToggle customerId={customer.id} active={customer.active} />
        </div>
      </div>
    </li>
  );
}
