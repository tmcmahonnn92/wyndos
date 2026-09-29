import { notFound } from "next/navigation";
import { getWorkDaysOnDate } from "@/lib/actions";
import { getActiveUserContext, requirePermission } from "@/lib/tenant-context";
import { PrintSheet } from "../../../print-sheet";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ sort?: string }>;
}

export default async function PrintDatePage({ params, searchParams }: Props) {
  await requirePermission("schedule");
  const user = await getActiveUserContext();
  const hidePrices = user.role === "WORKER" && !(user.permissions ?? []).includes("viewprices");
  const { date } = await params;
  const { sort } = await searchParams;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const days = await getWorkDaysOnDate(date);
  return (
    <PrintSheet
      days={days}
      dateISO={date}
      hidePrices={hidePrices}
      sort={sort === "street" ? "street" : "area"}
      backHref={`/days/date/${date}`}
    />
  );
}
