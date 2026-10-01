import { getAccountingPage, getOpeningFigures } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { AccountingClient } from "./accounting-client";
import { OpeningFigures } from "./opening-figures";

export const dynamic = "force-dynamic";

export default async function AccountingPage({
  searchParams,
}: {
  searchParams?: Promise<{ taxYear?: string; start?: string; end?: string; action?: string }>;
}) {
  await requirePermission("accounting");
  const params = (await searchParams) ?? {};
  const parsedTaxYear = Number.parseInt(params.taxYear ?? "", 10);
  const parsedStart = params.start ? new Date(params.start) : null;
  const parsedEnd = params.end ? new Date(params.end) : null;
  const [accounting, opening] = await Promise.all([getAccountingPage({
    taxYearStart: Number.isFinite(parsedTaxYear) ? parsedTaxYear : null,
    dateFrom: parsedStart && !Number.isNaN(parsedStart.getTime()) ? parsedStart : null,
    dateTo: parsedEnd && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd : null,
  }), getOpeningFigures()]);

  return <AccountingClient {...accounting} initialAction={params.action ?? null} openingFigures={<OpeningFigures {...opening} />} />;
}