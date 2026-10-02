import Link from "next/link";
import { auth } from "@/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Building2, ClipboardList, Clock3, LifeBuoy, ShieldCheck, Users, Activity } from "lucide-react";
import { getAdminDashboardData } from "@/lib/admin-support";
import { closeStaleSupportSessions } from "@/lib/admin-tickets";
import { getAdminBilling } from "@/lib/admin-billing";
import { SUPPORT_ACCESS_COOKIE } from "@/lib/auth-cookies";
import { BillingControls } from "./billing-controls";
import { BusinessesPanel } from "./businesses-panel";
import { SessionsPanel } from "./sessions-panel";
import { TicketsPanel } from "./tickets-panel";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "support", label: "Support" },
  { key: "businesses", label: "Businesses" },
  { key: "sessions", label: "Access log" },
  { key: "billing", label: "Billing" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function Stat({ label, value, icon: Icon, href }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; href?: string }) {
  const body = (
    <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 transition hover:border-slate-700">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <Icon className="h-4 w-4 text-blue-400" />
      </div>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "SUPER_ADMIN") redirect("/");
  const { tab: rawTab } = await searchParams;
  const tab: Tab = (TABS.some((t) => t.key === rawTab) ? rawTab : "overview") as Tab;

  await closeStaleSupportSessions();
  const [data, billing] = await Promise.all([getAdminDashboardData(), tab === "billing" ? getAdminBilling() : Promise.resolve([])]);
  const currentSupportId = Number((await cookies()).get(SUPPORT_ACCESS_COOKIE)?.value) || null;
  const mine = data.tenants.filter((t) => t.mine);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-blue-400">Super admin</p>
            <h1 className="text-2xl font-bold text-white">Wyndos admin</h1>
          </div>
          {data.activeSupportSessions.length > 0 && (
            <Link href="/admin?tab=sessions" className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300">
              {data.activeSupportSessions.length} support session{data.activeSupportSessions.length === 1 ? "" : "s"} open
            </Link>
          )}
        </div>

        <nav className="flex gap-1 overflow-x-auto rounded-xl bg-slate-900 p-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/admin?tab=${t.key}`}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t.key ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
            >
              {t.label}
              {t.key === "support" && data.stats.openTicketCount > 0 && (
                <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-[11px] text-white">{data.stats.openTicketCount}</span>
              )}
            </Link>
          ))}
        </nav>

        {tab === "overview" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Businesses" value={String(data.stats.tenantCount)} icon={Building2} href="/admin?tab=businesses" />
              <Stat label="Users" value={String(data.stats.userCount)} icon={Users} />
              <Stat label="Customers" value={String(data.stats.customerCount)} icon={ClipboardList} />
              <Stat label="Work days" value={String(data.stats.workDayCount)} icon={Clock3} />
              <Stat label="Open tickets" value={String(data.stats.openTicketCount)} icon={LifeBuoy} href="/admin?tab=support" />
              <Stat label="Open sessions" value={String(data.stats.openSupportSessionCount)} icon={ShieldCheck} href="/admin?tab=sessions" />
            </div>

            {mine.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-white">Your businesses</h2>
                <BusinessesPanel tenants={mine} mode="mine" />
              </section>
            )}

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-white"><Activity className="h-4 w-4 text-emerald-400" /> Health</p>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span className={data.health.databaseOk ? "text-emerald-400" : "text-red-400"}>Database {data.health.databaseOk ? "OK" : "down"}</span>
                <span className={data.health.superAdminEmailConfigured ? "text-emerald-400" : "text-amber-400"}>Admin email {data.health.superAdminEmailConfigured ? "set" : "missing"}</span>
                <span className="text-slate-400">App URL: {data.health.appUrl || "not set"}</span>
              </div>
            </section>
          </div>
        )}

        {tab === "support" && <TicketsPanel tickets={JSON.parse(JSON.stringify(data.tickets))} />}

        {tab === "businesses" && <BusinessesPanel tenants={JSON.parse(JSON.stringify(data.tenants))} mode="all" />}

        {tab === "sessions" && (
          <SessionsPanel
            open={JSON.parse(JSON.stringify(data.activeSupportSessions))}
            recent={JSON.parse(JSON.stringify(data.recentSupportLogs))}
            currentId={currentSupportId}
          />
        )}

        {tab === "billing" && (
          <section className="space-y-2">
            <p className="text-sm text-slate-400">Free forever (friends, testers) and trial extensions. Businesses never see these.</p>
            <BillingControls rows={billing} />
          </section>
        )}
      </div>
    </div>
  );
}
