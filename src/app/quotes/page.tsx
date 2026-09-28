import { getQuotes } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { QuotesClient } from "./quotes-client";

export const dynamic = "force-dynamic";

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  await requirePermission("customers");
  const [quotes, params] = await Promise.all([getQuotes(), searchParams]);
  return <QuotesClient quotes={JSON.parse(JSON.stringify(quotes))} openBooking={params.action === "book"} />;
}
