import { getAreaSchedules, getWorkDays, getHolidays, getSchedulerTodoSummary } from "@/lib/actions";
import { listTeamMembers } from "@/lib/auth-actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { SchedulerClient } from "./scheduler-client";
import { SchedulerTodoPanel } from "./scheduler-todo-panel";

export const dynamic = "force-dynamic";

export default async function SchedulerPage() {
  await requirePermission("scheduler");
  const viewer = await getActiveUserContext();
  const [areas, workDays, holidays, team, todoSummary] = await Promise.all([
    getAreaSchedules(),
    getWorkDays(),
    getHolidays(),
    listTeamMembers().catch(() => []),
    getSchedulerTodoSummary(),
  ]);
  const workers = team
    .filter((member) => member.role === "WORKER")
    .map((member) => ({ id: member.id, name: member.name, email: member.email }));
  const schedulerWorkDays = workDays.map((workDay) => ({
    ...workDay,
    routeOrderingMode: (workDay.routeOrderingMode === "OPTIMISED" ? "OPTIMISED" : "MANUAL") as "MANUAL" | "OPTIMISED",
  }));

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
      <div className="hidden md:grid h-full md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 h-full">
          <SchedulerClient
            areas={areas}
            workDays={schedulerWorkDays}
            holidays={holidays}
            workers={workers}
            viewerRole={viewer.role}
            viewerPermissions={viewer.permissions}
          />
        </div>
        <SchedulerTodoPanel summary={todoSummary} />
      </div>
    </>
  );
}
