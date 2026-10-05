import { getAreaSchedules, getAssignableTeam, getWorkDays, getHolidays, getSchedulerTodoSummary } from "@/lib/actions";
import { listTeamMembers } from "@/lib/auth-actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { SchedulerClient } from "./scheduler-client";
import { SchedulerTodoPanel } from "./scheduler-todo-panel";
import { TodoDrawer } from "./todo-drawer";
import { MobileScheduler } from "./mobile-scheduler";
import { getMobileSchedule } from "@/lib/mobile-schedule";

export const dynamic = "force-dynamic";

export default async function SchedulerPage() {
  await requirePermission("scheduler");
  const viewer = await getActiveUserContext();
  const [areas, workDays, holidays, team, todoSummary, mobile] = await Promise.all([
    getAreaSchedules(),
    getWorkDays(),
    getHolidays(),
    listTeamMembers().catch(() => []),
    getSchedulerTodoSummary(),
    getMobileSchedule(),
  ]);
  const isOwner = viewer.role === "OWNER" || viewer.role === "SUPER_ADMIN";
  const assignableTeam = isOwner ? await getAssignableTeam().catch(() => null) : null;
  const workers = team
    .filter((member) => member.role === "WORKER")
    .map((member) => ({ id: member.id, name: member.name, email: member.email }));
  const schedulerWorkDays = workDays.map((workDay) => ({
    ...workDay,
    routeOrderingMode: (workDay.routeOrderingMode === "OPTIMISED" ? "OPTIMISED" : "MANUAL") as "MANUAL" | "OPTIMISED",
  }));

  return (
    <>
      <div className="md:hidden">
        <MobileScheduler initial={mobile} team={assignableTeam} />
      </div>
      <div className="hidden md:grid h-full md:grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 h-full">
          <SchedulerClient
            areas={areas}
            workDays={schedulerWorkDays}
            holidays={holidays}
            workers={workers}
            team={assignableTeam}
            viewerRole={viewer.role}
            viewerPermissions={viewer.permissions}
          />
        </div>
        <TodoDrawer count={todoSummary.overdueAreas.count + todoSummary.holidayConflicts.count + todoSummary.unfinishedRuns.count}>
          <SchedulerTodoPanel summary={todoSummary} />
        </TodoDrawer>
      </div>
    </>
  );
}
