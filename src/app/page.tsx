import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  PoundSterling,
  TrendingUp,
  ChevronRight,
  Clock,
  Users,
  AlertTriangle,
  RotateCcw,
  ListTodo,
  Building2,
} from "lucide-react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDashboardData } from "@/lib/actions";
import { getAdminTodo, type TodoItem } from "@/lib/todo-actions";
import { TodoList } from "@/components/todo-list";
import { getDashboardInsights } from "@/lib/insights";
import { DashboardInsights } from "./dashboard-insights";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtDate, fmtCurrency } from "@/lib/utils";
import { ACTIVE_TENANT_COOKIE, getActiveUserContext, requirePermission } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getActiveUserContext();

  // SUPER_ADMIN must select a tenant first — redirect them to /admin if no cookie set
  if (user.role === "SUPER_ADMIN") {
    const cookieStore = await cookies();
    const tenantCookie = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
    if (!tenantCookie) redirect("/admin");
  }

  await requirePermission("dashboard");

  const showPrices =
    user.role === "OWNER" ||
    user.role === "SUPER_ADMIN" ||
    (user.permissions ?? []).includes("viewprices");
  const hidePrices = !showPrices;

  const {
    isWorker,
    jobsDoneThisWeek,
    valueDoneThisWeek,
    cashCollectedThisWeek,
    upcomingDays,
    totalRoundValue,
    totalEarnings,
    customerCount,
    overdueCount,
    totalOwing,
    recentPayments,
    customersWithDebt,
    worker,
  } = await getDashboardData();
  const todo = isWorker && !(user.permissions ?? []).includes("scheduler") ? [] : await getAdminTodo().catch(() => [] as TodoItem[]);
  // Business numbers: owner, or anyone with the Accounting permission.
  const insights = hidePrices ? null : await getDashboardInsights().catch(() => null);

  const todayIso = new Date().toISOString().slice(0, 10);
  const isoOf = (d: { date: Date | string }) => new Date(d.date).toISOString().slice(0, 10);
  const areaNameOf = (d: (typeof upcomingDays)[number]) =>
    d.area?.name ?? d.jobs[0]?.customer?.address?.split(",")[0] ?? "One-off";
  // A date can hold several areas; the cleaner works them as one day.
  const byDate = new Map<string, typeof upcomingDays>();
  for (const day of upcomingDays) byDate.set(isoOf(day), [...(byDate.get(isoOf(day)) ?? []), day]);
  const dateGroups = [...byDate.entries()].map(([iso, days]) => {
    const jobs = days.flatMap((d) => d.jobs);
    return {
      iso,
      days,
      areas: days.map(areaNameOf).join(", "),
      jobCount: jobs.length,
      pending: jobs.filter((j) => j.status === "PENDING").length,
      value: jobs.reduce((s, j) => s + j.price, 0),
      status: days.every((d) => d.status === "COMPLETE") ? "COMPLETE" : days.some((d) => d.status === "IN_PROGRESS") ? "IN_PROGRESS" : "PLANNED",
    };
  });
  const today = dateGroups.find((g) => g.iso === todayIso);
  const nextDates = dateGroups.filter((g) => g.iso !== todayIso).slice(0, 4);

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">{fmtDate(new Date())}</p>
      </div>

      {/* Today's work */}
      {today ? (
        <Link href={`/days/date/${today.iso}`}>
          <Card className="border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer">
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-200 flex items-center justify-center">
                  <CalendarDays size={20} className="text-blue-700" />
                </div>
                <div>
                  <p className="font-semibold text-blue-900">{"Today\u2019s Round"}</p>
                  <p className="text-sm text-blue-700">
                    {today.areas} ·{" "}
                    {today.jobCount} job{today.jobCount !== 1 ? "s" : ""}
                    {!hidePrices && ` · ${fmtCurrency(today.value)}`}
                  </p>
                </div>
              </div>
              <ChevronRight size={18} className="text-blue-400" />
            </CardContent>
          </Card>
        </Link>
      ) : (
        <Card className="border-dashed border-slate-300">
          <CardContent className="flex items-center gap-3 py-4 text-slate-500">
            <Clock size={20} />
            <div>
              <p className="font-medium text-slate-600">No work day today</p>
              {!isWorker && (
                <Link href="/days" className="text-sm text-blue-600 hover:underline">
                  Plan a new day →
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {todo.length > 0 && <TodoCard items={todo} />}

      {isWorker && worker && <WorkerSummary worker={worker} hidePrices={hidePrices} />}

      {isWorker && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 size={15} className="text-green-500" />
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Done this week</span>
              </div>
              <p className="text-2xl font-bold text-slate-800">{jobsDoneThisWeek}</p>
              {!hidePrices && <p className="text-xs text-slate-400 mt-0.5">{fmtCurrency(valueDoneThisWeek)} of work</p>}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 mb-1">
                <PoundSterling size={15} className="text-amber-500" />
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Cash to hand over</span>
              </div>
              <p className="text-2xl font-bold text-slate-800">{fmtCurrency(cashCollectedThisWeek)}</p>
              <p className="text-xs text-slate-400 mt-0.5">{cashCollectedThisWeek > 0.005 ? "give this to the owner" : "all handed over"}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Stats grid – 5 tiles */}
      {!isWorker && <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-1">
              <RotateCcw size={15} className="text-blue-500" />
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Round Value
              </span>
            </div>
            <p className="text-2xl font-bold text-slate-800">{hidePrices ? "–" : fmtCurrency(totalRoundValue)}</p>
            <p className="text-xs text-slate-400 mt-0.5">per full cycle</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={15} className="text-green-500" />
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Total Earned
              </span>
            </div>
            <p className="text-2xl font-bold text-slate-800">{hidePrices ? "–" : fmtCurrency(totalEarnings)}</p>
            <Link href="/payments" className="text-xs text-blue-600 hover:underline mt-0.5 inline-block">
              View payments →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-1">
              <Users size={15} className="text-indigo-500" />
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Customers
              </span>
            </div>
            <p className="text-2xl font-bold text-slate-800">{customerCount}</p>
            <Link href="/customers" className="text-xs text-blue-600 hover:underline mt-0.5 inline-block">
              Manage →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-1">
              <PoundSterling size={15} className="text-amber-500" />
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Total Owing
              </span>
            </div>
            <p className="text-2xl font-bold text-slate-800">{hidePrices ? "–" : fmtCurrency(totalOwing)}</p>
            <Link href="/payments" className="text-xs text-blue-600 hover:underline mt-0.5 inline-block">
              Log payment →
            </Link>
          </CardContent>
        </Card>

        <Card className="col-span-2">
          <CardContent className="py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-500" />
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Overdue Areas
              </span>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold text-slate-800">{overdueCount}</p>
              <Link href="/scheduler" className="text-xs text-blue-600 hover:underline">
                Schedule →
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>}

      {/* Upcoming days */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Upcoming Days</CardTitle>
          <Link href="/days" className="text-xs text-blue-600 hover:underline">See all</Link>
        </CardHeader>
        <CardContent className="p-0">
          {nextDates.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-500">
              No upcoming days planned.{" "}
              {!isWorker && <Link href="/days" className="text-blue-600 hover:underline">Add one →</Link>}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {nextDates.map((group) => (
                <li key={group.iso}>
                  <Link href={`/days/date/${group.iso}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700">{fmtDate(group.iso)}</p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {group.areas} · {group.jobCount} job{group.jobCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={group.status === "COMPLETE" ? "success" : group.status === "IN_PROGRESS" ? "info" : "muted"}>
                        {group.status === "COMPLETE" ? "Done" : group.status === "IN_PROGRESS" ? "Active" : `${group.pending} pending`}
                      </Badge>
                      <ChevronRight size={15} className="text-slate-300" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {insights && <DashboardInsights data={insights} />}

      {/* Customers with debt */}
      {!hidePrices && customersWithDebt.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-1.5">
              <TrendingUp size={14} className="text-amber-500" />
              Customers Owing
            </CardTitle>
            <Link href="/payments" className="text-xs text-blue-600 hover:underline">Log payment</Link>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {(customersWithDebt as Array<{ id: number; name: string; address: string; debt: number }>).slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link href={`/customers/${c.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-slate-700">{c.name}</p>
                      <p className="text-xs text-slate-500">{c.address}</p>
                    </div>
                    <span className="text-sm font-semibold text-red-600">{fmtCurrency(Number(c.debt))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Recent payments */}
      {!hidePrices && recentPayments.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-green-500" />
              Recent Payments
            </CardTitle>
            <Link href="/payments" className="text-xs text-blue-600 hover:underline">See all</Link>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {recentPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{p.customer.name}</p>
                    <p className="text-xs text-slate-500">{p.method} · {fmtDate(p.paidAt)}</p>
                  </div>
                  <span className="text-sm font-semibold text-green-700">+{fmtCurrency(p.amount)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** What needs doing today: reminders, chasing, "cleaned" texts, overdue areas. */
function TodoCard({ items }: { items: TodoItem[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-1.5">
          <ListTodo size={14} className="text-blue-500" />
          To do
        </CardTitle>
        <span className="text-xs text-slate-400">{items.length} thing{items.length === 1 ? "" : "s"}</span>
      </CardHeader>
      <CardContent className="p-0">
        <TodoList items={items} />
      </CardContent>
    </Card>
  );
}

type WorkerData = NonNullable<Awaited<ReturnType<typeof getDashboardData>>["worker"]>;

/** A team member's own numbers: who they work for, what they've done and what's coming up. */
function WorkerSummary({ worker, hidePrices }: { worker: WorkerData; hidePrices: boolean }) {
  const tile = (label: string, value: string, detail: string) => (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-500">{detail}</p>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {tile("This month", String(worker.monthJobs), hidePrices ? "jobs done" : `${fmtCurrency(worker.monthValue)} of work`)}
        {tile("Coming up", String(worker.upcomingJobs), hidePrices ? "jobs booked for you" : `${fmtCurrency(worker.upcomingValue)} booked`)}
        {tile("All time", String(worker.allJobs), hidePrices ? "jobs done" : `${fmtCurrency(worker.allValue)} of work`)}
        {tile("Working for", String(worker.businesses.length), worker.businesses.map((b) => b.name).join(", "))}
      </div>

      {worker.businesses.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Building2 size={14} className="text-indigo-500" />
              Businesses you work for
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {worker.businesses.map((b) => (
                <li key={b.tenantId} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm font-medium text-slate-700">{b.name}</span>
                  {b.current ? (
                    <Badge variant="info">Viewing</Badge>
                  ) : (
                    <Link href="/auth/company-select" className="text-xs text-blue-600 hover:underline">Switch</Link>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {worker.recentJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-green-500" />
              Recently done by you
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {worker.recentJobs.map((job) => (
                <li key={job.id}>
                  <Link href={`/days/${job.workDayId}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-700">{job.customer.name}</p>
                      <p className="truncate text-xs text-slate-500">{job.name} · {fmtDate(job.completedAt)}</p>
                    </div>
                    {!hidePrices && <span className="flex-shrink-0 text-sm font-semibold text-slate-700">{fmtCurrency(job.price)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
