import { getMyNotifyPrefs } from "@/lib/account-actions";
import { AccountClient } from "./account-client";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const data = await getMyNotifyPrefs();
  return <AccountClient {...data} />;
}
