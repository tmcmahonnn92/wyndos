"use server";

import { requireOwner } from "@/lib/guards";
import { deleteBusinessData } from "@/lib/delete-business";

/**
 * Close the business: stop the subscription and delete every bit of its data
 * (customers, schedule, history, payments, accounts, texts, settings, team access).
 * People who only belonged to this business lose their login too; anyone who also
 * works for another business keeps their login for that one. Can't be undone.
 */
export async function closeBusiness(confirmWord: string) {
  const actor = await requireOwner();
  if (confirmWord.trim().toUpperCase() !== "DELETE") throw new Error("Type DELETE to confirm.");
  await deleteBusinessData(actor.tenantId);
  return { ok: true };
}
