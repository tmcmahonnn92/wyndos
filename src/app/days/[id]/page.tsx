import { notFound } from "next/navigation";
import { getWorkDay, getWorkDays } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { auth } from "@/auth";
import { DayView } from "./day-view";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DayPage({ params }: Props) {
  await requirePermission("schedule");
  const session = await auth();
  const hidePrices = session?.user?.role === "WORKER" && !(session.user.permissions ?? []).includes("viewprices");
  const { id } = await params;
  const day = await getWorkDay(Number(id));
  if (!day) notFound();

  const allDays = await getWorkDays();
  const futureDays = allDays.filter(
    (d) =>
      d.id !== day.id &&
      new Date(d.date) >= new Date(new Date().setHours(0, 0, 0, 0)) &&
      d.status !== "COMPLETE"
  );

  return <DayView day={day} futureDays={futureDays} hidePrices={hidePrices} />;
}
