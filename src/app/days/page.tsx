import { getWorkDays, getAreaSchedules, getHolidays } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { auth } from "@/auth";
import { ScheduleHeader } from "./schedule-header";
import { SchedulePageClient } from "./schedule-page-client";

export const dynamic = "force-dynamic";

export default async function DaysPage() {
  await requirePermission("schedule");
  const session = await auth();
  const hidePrices = session?.user?.role === "WORKER" && !(session.user.permissions ?? []).includes("viewprices");
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

