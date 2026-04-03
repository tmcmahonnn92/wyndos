import { getAreaSchedules, getWorkDays, getHolidays } from "@/lib/actions";
import { listTeamMembers } from "@/lib/auth-actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { SchedulerClient } from "./scheduler-client";

export const dynamic = "force-dynamic";

export default async function SchedulerPage() {
  await requirePermission("scheduler");
  const viewer = await getActiveUserContext();
  const [areas, workDays, holidays, team] = await Promise.all([
    getAreaSchedules(),
    getWorkDays(),
    getHolidays(),
    listTeamMembers().catch(() => []),
  ]);
  const workers = team
    .filter((member) => member.role === "WORKER")
    .map((member) => ({ id: member.id, name: member.name, email: member.email }));

  return (
    <>
      <div className="md:hidden px-4 py-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-800">Scheduler</h1>
          <p className="mt-2 text-sm text-slate-500">
            Scheduler is desktop-only. Use the Schedule page on mobile.
          </p>
        </div>
      </div>
      <div className="hidden md:block h-full">
        <SchedulerClient areas={areas} workDays={workDays} holidays={holidays} workers={workers} viewerRole={viewer.role} />
      </div>
    </>
  );
}
