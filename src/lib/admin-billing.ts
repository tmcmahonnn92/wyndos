"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { requireSuperAdmin } from "@/lib/tenant-context";
import { billingStateOf, trialEndOf } from "@/lib/billing";

/** Every business with its billing state, for the admin console. */
export async function getAdminBilling() {
  await requireSuperAdmin();
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, createdAt: true, trialEndsAt: true, billingExempt: true,
      subscriptionStatus: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, stripeCustomerId: true,
    },
  });
  return tenants.map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt.toISOString(),
    billingExempt: t.billingExempt,
    subscriptionStatus: t.subscriptionStatus,
    stripeCustomerId: t.stripeCustomerId,
    state: billingStateOf(t),
  }));
}

/** Free forever (friends, testers, your own businesses). Never shown to the business. */
export async function setFreeForever(tenantId: number, free: boolean) {
  await requireSuperAdmin();
  await prisma.tenant.update({ where: { id: tenantId }, data: { billingExempt: free } });
  revalidatePath("/admin");
}

/** Add days to the free trial (from today if it has already ended). */
export async function extendTrial(tenantId: number, days: number) {
  await requireSuperAdmin();
  const n = Math.floor(Number(days));
  if (!Number.isFinite(n) || n < 1 || n > 3650) throw new Error("Days must be between 1 and 3650.");
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { createdAt: true, trialEndsAt: true } });
  const from = Math.max(Date.now(), trialEndOf(t).getTime());
  await prisma.tenant.update({ where: { id: tenantId }, data: { trialEndsAt: new Date(from + n * 86_400_000) } });
  revalidatePath("/admin");
}
