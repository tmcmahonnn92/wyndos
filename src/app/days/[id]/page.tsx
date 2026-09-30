import { notFound } from "next/navigation";
import { getAssignableTeam, getRunSiblings, getWorkDay, getWorkDays } from "@/lib/actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { DayView } from "./day-view";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

/** One area on one date. The whole date (all areas) is at /days/date/[date]. */
export default async function DayPage({ params }: Props) {
  await requirePermission("schedule");
  const user = await getActiveUserContext();
  const hidePrices = user.role === "WORKER" && !(user.permissions ?? []).includes("viewprices");
  const { id } = await params;
  const day = await getWorkDay(Number(id));
  if (!day) notFound();

  const dateISO = new Date(day.date).toISOString().slice(0, 10);
  const allDays = await getWorkDays();
  const futureDays = allDays.filter(
    (d) =>
      d.id !== day.id &&
      new Date(d.date) >= new Date(new Date().setHours(0, 0, 0, 0)) &&
      d.status !== "COMPLETE"
  );
  const otherAreasOnDate = allDays.filter(
    (d) => d.id !== day.id && new Date(d.date).toISOString().slice(0, 10) === dateISO
  ).length;

  const isOwner = user.role === "OWNER" || user.role === "SUPER_ADMIN";
  const team = isOwner ? await getAssignableTeam() : null;
  const canReschedule = isOwner || (user.permissions ?? []).includes("scheduler");
  const canText = isOwner || (user.permissions ?? []).includes("messaging");
  const runSiblings = await getRunSiblings([day].map((d) => d.id)).catch(() => ({}));

  return (
    <DayView
      days={[day]}
      dateISO={dateISO}
      futureDays={futureDays}
      hidePrices={hidePrices}
      team={team}
      canReschedule={canReschedule}
      canText={canText}
      runSiblings={runSiblings}
      otherAreasOnDate={otherAreasOnDate}
    />
  );
}
