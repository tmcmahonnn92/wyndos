"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { requireOwner } from "@/lib/guards";
import { TERMS_VERSION } from "@/lib/legal";

/** The owner accepts the current Terms + Privacy and confirms they may hold their customers' details. */
export async function acceptLegalTerms(input: { acceptTerms: boolean; acceptDataPermission: boolean }) {
  const actor = await requireOwner();
  if (input?.acceptTerms !== true || input?.acceptDataPermission !== true) {
    throw new Error("Please tick both boxes to carry on.");
  }
  const now = new Date();
  await prisma.tenant.update({
    where: { id: actor.tenantId },
    data: { termsVersion: TERMS_VERSION, termsAcceptedAt: now, termsAcceptedByUserId: actor.userId, dataPermissionAcceptedAt: now },
  });
  revalidatePath("/", "layout");
}
