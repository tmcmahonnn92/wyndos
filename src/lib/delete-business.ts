import "server-only";
import prisma from "@/lib/db";
import { stripe, stripeConfigured } from "@/lib/billing";

const LIVE = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

/**
 * Delete one business and everything in it: stop its subscription, then remove its customers,
 * schedule, history, payments, accounts, texts, settings and team access. Only that business:
 * - people who also belong to another business keep their login and that other business
 *   (only their place in this one goes);
 * - super admins are never deleted;
 * - nothing outside this business is touched.
 * Used by the owner's "Close business" and by the admin console. Can't be undone.
 */
export async function deleteBusinessData(tenantId: number) {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { stripeSubscriptionId: true, subscriptionStatus: true },
  });

  // Never leave someone being charged for a business that no longer exists.
  if (tenant.stripeSubscriptionId && LIVE.has(tenant.subscriptionStatus)) {
    if (!stripeConfigured()) throw new Error("Couldn't cancel the subscription (payments not set up), so nothing was deleted.");
    try {
      await stripe().subscriptions.cancel(tenant.stripeSubscriptionId);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== "resource_missing") {
        console.error("[deleteBusiness] cancel", e);
        throw new Error("Couldn't cancel the subscription just now, so nothing was deleted. Please try again.");
      }
    }
  }

  // Signing up again with the same email won't give another free trial.
  const owners = await prisma.membership.findMany({ where: { tenantId, role: "OWNER", user: { role: { not: "SUPER_ADMIN" } } }, select: { user: { select: { email: true } } } });
  const { rememberDeletedOwners } = await import("@/lib/repeat-trial");
  await rememberDeletedOwners(owners.map((o) => o.user.email));

  const members = await prisma.membership.findMany({ where: { tenantId }, select: { userId: true } });
  const userIds = [...new Set(members.map((m) => m.userId))];
  const where = { tenantId };

  await prisma.$transaction(async (tx) => {
    await tx.importedLine.deleteMany({ where });
    await tx.paymentImport.deleteMany({ where });
    await tx.payerReference.deleteMany({ where });
    await tx.paymentAllocation.deleteMany({ where });
    await tx.payment.deleteMany({ where });
    await tx.cashHandover.deleteMany({ where });
    await tx.messageLog.deleteMany({ where });
    await tx.notificationEvent.deleteMany({ where });
    await tx.job.deleteMany({ where });
    await tx.workDay.deleteMany({ where });
    await tx.customer.updateMany({ where, data: { paidByCustomerId: null } });
    await tx.customerTag.deleteMany({ where: { customer: { tenantId } } });
    await tx.customer.deleteMany({ where });
    await tx.area.deleteMany({ where });
    await tx.tag.deleteMany({ where });
    await tx.holiday.deleteMany({ where });
    await tx.expense.deleteMany({ where });
    await tx.otherIncome.deleteMany({ where });
    await tx.mileageTrip.deleteMany({ where });
    await tx.vehicle.deleteMany({ where });
    await tx.homeUseMonth.deleteMany({ where });
    await tx.businessAsset.deleteMany({ where });
    await tx.mtdQuarterLock.deleteMany({ where });
    await tx.payByBankRequest.deleteMany({ where });

    for (const userId of userIds) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, tenantId: true } });
      if (!user) continue;
      // Only their place in this business goes.
      await tx.membership.deleteMany({ where: { userId, tenantId } });
      const other = await tx.membership.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { tenantId: true, role: true } });
      if (user.role === "SUPER_ADMIN") {
        if (user.tenantId === tenantId) await tx.user.update({ where: { id: userId }, data: { tenantId: null } });
      } else if (other) {
        // Still works for another business: keep the login; point it there only if it pointed here.
        if (user.tenantId === tenantId) await tx.user.update({ where: { id: userId }, data: { tenantId: other.tenantId, role: other.role } });
      } else {
        await tx.passwordResetToken.deleteMany({ where: { userId } });
        await tx.user.delete({ where: { id: userId } });
      }
    }
    // Anyone else still pointing at this business (shouldn't happen) is unlinked.
    await tx.user.updateMany({ where, data: { tenantId: null } });
    // Settings, invites, memberships and support logs go with the business.
    await tx.tenant.delete({ where: { id: tenantId } });
  }, { timeout: 120_000, maxWait: 20_000 });
}
