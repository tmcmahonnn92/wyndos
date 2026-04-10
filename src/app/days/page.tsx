import { getWorkDays, getAreaSchedules, getHolidays } from "@/lib/actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { ScheduleHeader } from "./schedule-header";
import { SchedulePageClient } from "./schedule-page-client";

export const dynamic = "force-dynamic";

export default async function DaysPage() {
  await requirePermission("schedule");
  const user = await getActiveUserContext();
  const hidePrices = user.role === "WORKER" && !(user.permissions ?? []).includes("viewprices");
  const [days, areas, holidays] = await Promise.all([
    getWorkDays(),
    getAreaSchedules(),
    getHolidays(),
  ]);

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-5">
      <ScheduleHeader areas={areas} />
      <SchedulePageClient days={days} areas={areas} holidays={holidays} hidePrices={hidePrices} />
    </div>
  );
}

