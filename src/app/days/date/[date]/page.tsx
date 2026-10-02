import { getBusinessSettings } from "@/lib/actions";
import { notFound } from "next/navigation";
import { getAssignableTeam, getRunSiblings, getWorkDays, getWorkDaysOnDate } from "@/lib/actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { DayView } from "../../[id]/day-view";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ date: string }>;
}

/**
 * The whole working day: every area booked on this date in one list.
 * Scheduling stays per area; this is just how the cleaner works through the day.
 */
export default async function DatePage({ params }: Props) {
  await requirePermission("schedule");
  const user = await getActiveUserContext();
  const hidePrices = user.role === "WORKER" && !(user.permissions ?? []).includes("viewprices");
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(`${date}T00:00:00Z`).getTime())) notFound();

  const days = await getWorkDaysOnDate(date);
  const allDays = await getWorkDays();
  const futureDays = allDays.filter(
    (d) =>
      new Date(d.date).toISOString().slice(0, 10) !== date &&
      new Date(d.date) >= new Date(new Date().setHours(0, 0, 0, 0)) &&
      d.status !== "COMPLETE"
  );

  const isOwner = user.role === "OWNER" || user.role === "SUPER_ADMIN";
  const team = isOwner ? await getAssignableTeam() : null;
  const canReschedule = isOwner || (user.permissions ?? []).includes("scheduler");
  const canText = isOwner || (user.permissions ?? []).includes("messaging");
  const runSiblings = await getRunSiblings(days.map((d) => d.id)).catch(() => ({}));

  return (
    <DayView
      days={days}
      dateISO={date}
      futureDays={futureDays}
      hidePrices={hidePrices}
      team={team}
      canReschedule={canReschedule}
      canText={canText}
      allowCredit={(await getBusinessSettings().catch(() => null))?.allowCustomerCredit ?? true}
      runSiblings={runSiblings}
    />
  );
}
