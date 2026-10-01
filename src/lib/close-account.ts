"use server";

import prisma from "@/lib/db";
import { requireOwner } from "@/lib/guards";
import { stripe, stripeConfigured } from "@/lib/billing";

const LIVE = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

/**
 * Close the business: stop the subscription and delete every bit of its data
 * (customers, schedule, history, payments, accounts, texts, settings, team access).
 * People who only belonged to this business lose their login too; anyone who also
 * works for another business keeps their login for that one. Can't be undone.
 */
export async function closeBusiness(confirmWord: string) {
  const actor = await requireOwner();
  if (confirmWord.trim().toUpperCase() !== "DELETE") throw new Error("Type DELETE to confirm.");
  const tenantId = actor.tenantId;

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { stripeSubscriptionId: true, subscriptionStatus: true },
  });

  // Never leave someone being charged for a business that no longer exists.
  if (tenant.stripeSubscriptionId && LIVE.has(tenant.subscriptionStatus)) {
    if (!stripeConfigured()) throw new Error("Couldn't cancel the subscription (payments not set up). Please contact support.");
    try {
      await stripe().subscriptions.cancel(tenant.stripeSubscriptionId);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== "resource_missing") {
        console.error("[closeBusiness] cancel", e);
        throw new Error("Couldn't cancel your subscription just now, so nothing was deleted. Please try again or contact support.");
      }
    }
  }

  const members = await prisma.membership.findMany({ where: { tenantId }, select: { userId: true } });
  const userIds = [...new Set(members.map((m) => m.userId))];
  const where = { tenantId };

  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where });
    await tx.payment.deleteMany({ where });
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

    for (const userId of userIds) {
      const other = await tx.membership.findFirst({ where: { userId, tenantId: { not: tenantId } }, select: { tenantId: true } });
      if (other) {
        await tx.membership.deleteMany({ where: { userId, tenantId } });
        await tx.user.update({ where: { id: userId }, data: { tenantId: other.tenantId } });
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

  return { ok: true };
}
