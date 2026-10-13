import { redirect } from "next/navigation";
import { getActor } from "@/lib/guards";
import { goCardlessOn } from "@/lib/trial-features";
import { DirectDebitGuide } from "./guide-content";

export const dynamic = "force-dynamic";
export const metadata = { title: "Direct Debit (GoCardless) | Wyndos" };

/** In the app: only for businesses with Direct Debit switched on. */
export default async function DirectDebitGuidePage() {
  const actor = await getActor().catch(() => null);
  if (!actor || !(await goCardlessOn(actor.tenantId))) redirect("/guide");
  return <DirectDebitGuide />;
}
