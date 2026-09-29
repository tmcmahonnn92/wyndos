import { getAddressReview } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { AddressReviewClient } from "./address-review-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tidy addresses" };

export default async function AddressReviewPage() {
  await requirePermission("customers");
  const rows = await getAddressReview();
  return <AddressReviewClient rows={rows} />;
}
