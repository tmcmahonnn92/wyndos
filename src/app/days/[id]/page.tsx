import { getBusinessSettings } from "@/lib/actions";
import { notFound, redirect } from "next/navigation";
import { getAssignableTeam, getRunSiblings, getWorkDay, getWorkDays } from "@/lib/actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { DayView } from "./day-view";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ only?: string }>;
}

/** One area on one date. The whole date (all areas) is at /days/date/[date]. */
export default async function DayPage({ params, searchParams }: Props) {
  await requirePermission("schedule");
  const user = await getActiveUserContext();
  const hidePrices = user.role === "WORKER" && !(user.permissions ?? []).includes("viewprices");
  const { id } = await params;
  const day = await getWorkDay(Number(id));
  if (!day) notFound();

  const dateISO = new Date(day.date).toISOString().slice(0, 10);
  const canReorderWork = user.role !== "WORKER" || (user.permissions ?? []).some((p) => p === "reorder" || p === "scheduler");
  // Workers who can't change the order always get their whole day, in the order they're given.
  if (!canReorderWork) redirect(`/days/date/${dateISO}`);
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

  // The whole day is the normal view; "?only=1" (the One area switch) shows just this area.
  if (otherAreasOnDate > 0 && (await searchParams).only !== "1") redirect(`/days/date/${dateISO}`);

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
      allowCredit={(await getBusinessSettings().catch(() => null))?.allowCustomerCredit ?? true}
      runSiblings={runSiblings}
      canReorderWork={canReorderWork}
      canEditCustomers={user.role === "OWNER" || user.role === "SUPER_ADMIN" || (user.permissions ?? []).includes("customers")}
      canEditAreas={user.role === "OWNER" || user.role === "SUPER_ADMIN" || (user.permissions ?? []).includes("areas")}
      otherAreasOnDate={otherAreasOnDate}
    />
  );
}
