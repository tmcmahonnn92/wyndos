import { getQuotes } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { QuotesClient } from "./quotes-client";

export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  await requirePermission("customers");
  const quotes = await getQuotes();
  return <QuotesClient quotes={JSON.parse(JSON.stringify(quotes))} />;
}
