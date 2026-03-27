import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Activity, Database, ShieldCheck, Users, Building2, ClipboardList, Clock3 } from "lucide-react";
import { getAdminDashboardData } from "@/lib/admin-support";
import { TenantSwitcher } from "./tenant-switcher";

export const dynamic = "force-dynamic";

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{label}</p>
        <Icon className="h-4 w-4 text-blue-400" />
      </div>
      <p className="mt-3 text-3xl font-bold text-white">{value}</p>
    </div>
  );
}

export default async function AdminPage() {
  const session = await auth();

  if (session?.user?.role !== "SUPER_ADMIN") redirect("/");

  const data = await getAdminDashboardData();

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-400">Super Admin</p>
          <h1 className="text-3xl font-bold text-white">System Control</h1>
          <p className="max-w-3xl text-sm text-slate-400">
            This console is for platform health, tenant management, and explicitly-audited support access. It shows aggregate system state by default and requires a logged reason before entering any tenant account.
          </p>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Tenants" value={String(data.stats.tenantCount)} icon={Building2} />
          <StatCard label="Users" value={String(data.stats.userCount)} icon={Users} />
          <StatCard label="Customers" value={String(data.stats.customerCount)} icon={ClipboardList} />
          <StatCard label="Work Days" value={String(data.stats.workDayCount)} icon={Clock3} />
          <StatCard label="Open Support" value={String(data.stats.openSupportSessionCount)} icon={ShieldCheck} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Activity className="h-4 w-4 text-emerald-400" />
              Platform Health
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Database</p>
                <p className={`mt-2 text-lg font-semibold ${data.health.databaseOk ? "text-emerald-400" : "text-red-400"}`}>
                  {data.health.databaseOk ? "Healthy" : "Degraded"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Super Admin Email</p>
                <p className={`mt-2 text-lg font-semibold ${data.health.superAdminEmailConfigured ? "text-emerald-400" : "text-amber-400"}`}>
                  {data.health.superAdminEmailConfigured ? "Configured" : "Missing"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 sm:col-span-2">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Canonical URLs</p>
                <p className="mt-2 text-sm text-slate-300">AUTH: {data.health.authUrl || "Not set"}</p>
                <p className="mt-1 text-sm text-slate-300">APP: {data.health.appUrl || "Not set"}</p>
                <p className="mt-3 text-xs text-slate-500">Last checked {new Date(data.health.checkedAt).toLocaleString("en-GB")}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Database className="h-4 w-4 text-blue-400" />
              Active Support Sessions
            </div>
            <div className="mt-4 space-y-3">
              {data.activeSupportSessions.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-500">
                  No support sessions are currently open.
                </div>
              ) : (
                data.activeSupportSessions.map((session) => (
                  <div key={session.id} className="rounded-xl border border-blue-900/60 bg-blue-950/20 p-4">
                    <p className="font-semibold text-white">{session.tenantName}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-blue-300">{session.superAdminLabel}</p>
                    <p className="mt-2 text-sm text-slate-300">{session.reason}</p>
                    <p className="mt-2 text-xs text-slate-500">Started {new Date(session.createdAt).toLocaleString("en-GB")}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Tenant Management</h2>
              <p className="mt-1 text-sm text-slate-400">
                Open audited support access into a tenant account only when you have a legitimate operational or customer-support reason.
              </p>
            </div>
            <TenantSwitcher tenants={data.tenants} />
          </div>

          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Support Audit Log</h2>
              <p className="mt-1 text-sm text-slate-400">
                Recent support sessions with reason and duration. This is the minimum audit trail needed for privacy-safe admin access.
              </p>
            </div>
            <div className="space-y-3">
              {data.recentSupportLogs.length === 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-500">
                  No support logs recorded yet.
                </div>
              ) : (
                data.recentSupportLogs.map((log) => (
                  <div key={log.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-white">{log.tenantName}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{log.superAdminLabel}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${log.endedAt ? "bg-slate-800 text-slate-300" : "bg-emerald-950/70 text-emerald-300"}`}>
                        {log.endedAt ? "Closed" : "Open"}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-slate-300">{log.reason}</p>
                    <p className="mt-3 text-xs text-slate-500">Started {new Date(log.createdAt).toLocaleString("en-GB")}</p>
                    {log.endedAt && (
                      <p className="mt-1 text-xs text-slate-500">Ended {new Date(log.endedAt).toLocaleString("en-GB")}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
