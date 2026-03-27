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
} from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { cookies } from "next/headers";
import { getDashboardData } from "@/lib/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtDate, fmtCurrency } from "@/lib/utils";
import { ACTIVE_TENANT_COOKIE, requirePermission } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  // SUPER_ADMIN must select a tenant first — redirect them to /admin if no cookie set
  if (session.user.role === "SUPER_ADMIN") {
    const cookieStore = await cookies();
    const tenantCookie = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
    if (!tenantCookie) redirect("/admin");
  }

  await requirePermission("dashboard");

  const showPrices =
    session.user.role === "OWNER" ||
    session.user.role === "SUPER_ADMIN" ||
    (session.user.permissions ?? []).includes("viewprices");
  const hidePrices = !showPrices;

  const {
    upcomingDays,
    totalRoundValue,
    totalEarnings,
    customerCount,
    overdueCount,
    totalOwing,
    recentPayments,
    customersWithDebt,
  } = await getDashboardData();

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayDay = upcomingDays.find(
    (d) => new Date(d.date).toISOString().slice(0, 10) === todayIso
  );
  const nextDays = upcomingDays.filter(
    (d) => new Date(d.date).toISOString().slice(0, 10) !== todayIso
  ).slice(0, 4);

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">{fmtDate(new Date())}</p>
      </div>

      {/* Today's work */}
      {todayDay ? (
        <Link href={`/days/${todayDay.id}`}>
          <Card className="border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer">
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-200 flex items-center justify-center">
                  <CalendarDays size={20} className="text-blue-700" />
                </div>
                <div>
                  <p className="font-semibold text-blue-900">{"Today\u2019s Round"}</p>
                  <p className="text-sm text-blue-700">
                    {todayDay.area?.name ?? todayDay.jobs[0]?.customer?.address?.split(",")[0] ?? "One-off"} ·{" "}
                    {todayDay.jobs.length} job{todayDay.jobs.length !== 1 ? "s" : ""}
                    {!hidePrices && ` · ${fmtCurrency(todayDay.jobs.reduce((s, j) => s + j.price, 0))}`}
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
              <Link href="/days" className="text-sm text-blue-600 hover:underline">
                Plan a new day →
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats grid – 5 tiles */}
      <div className="grid grid-cols-2 gap-3">
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
      </div>

      {/* Upcoming days */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Upcoming Days</CardTitle>
          <Link href="/days" className="text-xs text-blue-600 hover:underline">See all</Link>
        </CardHeader>
        <CardContent className="p-0">
          {nextDays.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-500">
              No upcoming days planned.{" "}
              <Link href="/days" className="text-blue-600 hover:underline">Add one →</Link>
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {nextDays.map((day) => {
                const pending = day.jobs.filter((j) => j.status === "PENDING").length;
                const total = day.jobs.length;
                return (
                  <li key={day.id}>
                    <Link href={`/days/${day.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{fmtDate(day.date)}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {day.area?.name ?? day.jobs[0]?.customer?.address?.split(",")[0] ?? "One-off"} · {total} job{total !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={day.status === "COMPLETE" ? "success" : day.status === "IN_PROGRESS" ? "info" : "muted"}>
                          {day.status === "COMPLETE" ? "Done" : day.status === "IN_PROGRESS" ? "Active" : `${pending} pending`}
                        </Badge>
                        <ChevronRight size={15} className="text-slate-300" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

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