import { getActor } from "@/lib/guards";
import { goCardlessOn } from "@/lib/trial-features";
import { DirectDebitGuide } from "./guide-content";

export const dynamic = "force-dynamic";
export const metadata = { title: "Direct Debit with GoCardless | Wyndos" };

/** Part of the public guide. Businesses with Direct Debit switched on also get links into the app. */
export default async function DirectDebitGuidePage() {
  const actor = await getActor().catch(() => null);
  const inApp = Boolean(actor && (await goCardlessOn(actor.tenantId)));
  return <DirectDebitGuide publicView={!inApp} />;
}
