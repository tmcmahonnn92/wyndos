import Link from "next/link";
import { getPhoneOutbox } from "@/lib/text-actions";
import { requirePermission } from "@/lib/tenant-context";
import { SendQueuePage } from "./send-queue-page";
import { decodeIdRanges } from "@/lib/id-ranges";

export const dynamic = "force-dynamic";
export const metadata = { title: "Send texts" };

/** Opened on a phone (often from the code on a computer) to send waiting texts one tap at a time. */
export default async function SendPage({ searchParams }: { searchParams: Promise<{ ids?: string; r?: string }> }) {
  await requirePermission("messaging");
  const { ids, r } = await searchParams;
  // "r" is the short form the QR code uses; "ids" is the old comma list (older codes still work).
  const idList = r ? decodeIdRanges(r) : ids?.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const items = await getPhoneOutbox(idList && idList.length > 0 ? { ids: idList } : {});

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Send texts</h1>
        <p className="text-sm text-slate-500">
          {items.length === 0 ? "Nothing waiting to send." : `${items.length} text${items.length === 1 ? "" : "s"} ready.`}
        </p>
      </div>
      {items.length === 0 ? (
        <Link href="/messages" className="inline-block text-sm font-semibold text-blue-600 hover:underline">Go to Texts</Link>
      ) : (
        <SendQueuePage items={items.map((i) => ({ id: i.id, name: i.name, to: i.to, body: i.body }))} />
      )}
    </div>
  );
}
