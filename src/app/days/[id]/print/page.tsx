import { notFound } from "next/navigation";
import { getWorkDay } from "@/lib/actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { PrintSheet } from "../../print-sheet";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string; worker?: string }>;
}

export default async function PrintDayPage({ params, searchParams }: Props) {
  await requirePermission("schedule");
  const user = await getActiveUserContext();
  const hidePrices = user.role === "WORKER" && !(user.permissions ?? []).includes("viewprices");
  const { id } = await params;
  const { sort, worker } = await searchParams;
  const sortValue = sort === "street" ? "street" : "area";
  const day = await getWorkDay(Number(id));
  if (!day) notFound();
  return (
    <PrintSheet
      days={[day]}
      dateISO={new Date(day.date).toISOString().slice(0, 10)}
      hidePrices={hidePrices}
      sort={sortValue}
      worker={worker ?? null}
      viewer={{ id: user.id, name: user.name }}
      pdfHref={`/api/run-sheet?day=${day.id}&sort=${sortValue}${worker ? `&worker=${worker}` : ""}`}
      backHref={`/days/${day.id}`}
    />
  );
}
