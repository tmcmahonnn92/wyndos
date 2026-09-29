import { getBulkRecipients, getMessageLog, getPhoneOutboxCount, getTextSetup } from "@/lib/text-actions";
import { requirePermission } from "@/lib/tenant-context";
import { MessagesClient } from "./messages-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Texts" };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePermission("messaging");
  const [{ tab }, setup, recipients, log, outboxCount] = await Promise.all([searchParams, getTextSetup(), getBulkRecipients(), getMessageLog(), getPhoneOutboxCount()]);
  return (
    <MessagesClient
      initialTab={tab === "log" ? "log" : "send"}
      setup={setup}
      recipients={recipients}
      log={JSON.parse(JSON.stringify(log))}
      outboxCount={outboxCount}
    />
  );
}
