import "server-only";
import prisma from "@/lib/db";

/**
 * Refunds. A refund is a payment with a negative amount (dated the day the money went back),
 * linked to the payment it refunds (refundOfId). So money in, accounts and MTD all go down on
 * that day, and the original payment stays as it was.
 *  - Money that was on cleans comes off them (negative allocations, newest cleans first):
 *    "write off" also takes it off the clean's price (not owed: poor job, goodwill);
 *    "leave owing" puts the clean back to unpaid (a mistake, charged twice…).
 *  - Money that was spare (credit) just comes off their credit.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;
export type RefundOutcome = "WRITE_OFF" | "OWING";

/** How much of a payment can still be refunded, and where its money sits now (per clean, and spare). */
export async function refundable(tenantId: number, paymentId: number) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, tenantId, voidedAt: null, amount: { gt: 0 } },
    select: { id: true, customerId: true, amount: true, paidAt: true, method: true, broughtForward: true, goCardlessPaymentId: true, goCardlessStatus: true, allocations: { select: { jobId: true, amount: true } } },
  });
  if (!payment) throw new Error("Payment not found.");
  // Credit added by hand (or carried over from another program) was never money in: nothing to refund.
  if (payment.broughtForward) throw new Error("This credit wasn't money you received, so there's nothing to refund. Use Remove credit instead.");
  const refunds = await prisma.payment.findMany({
    where: { tenantId, refundOfId: payment.id, voidedAt: null },
    select: { amount: true, goCardlessRefundId: true, allocations: { select: { jobId: true, amount: true } } },
  });
  const onJob = new Map<number, number>();
  for (const a of payment.allocations) onJob.set(a.jobId, r2((onJob.get(a.jobId) ?? 0) + a.amount));
  for (const r of refunds) for (const a of r.allocations) onJob.set(a.jobId, r2((onJob.get(a.jobId) ?? 0) + a.amount));
  const refunded = r2(refunds.reduce((s, r) => s - r.amount, 0));
  const refundedByGc = r2(refunds.filter((r) => r.goCardlessRefundId).reduce((s, r) => s - r.amount, 0));
  return { payment, left: r2(payment.amount - refunded), refundedByGc, onJob };
}

/** Write the refund into Wyndos (the money has already gone back, or GoCardless has accepted it). */
export async function recordRefund(tenantId: number, input: {
  paymentId: number; amount: number; outcome: RefundOutcome; method: "CASH" | "BACS" | "CARD"; reason?: string; at?: Date;
  goCardlessRefundId?: string | null; goCardlessStatus?: string | null; userId?: string | null;
}) {
  const { payment, left, onJob } = await refundable(tenantId, input.paymentId);
  const amount = r2(input.amount);
  if (!(amount > 0)) throw new Error("Enter an amount above zero.");
  if (amount > left + 0.004) throw new Error(`Only £${left.toFixed(2)} of this payment can be refunded.`);
  // Newest cleans first; anything over what's on cleans comes off their credit.
  const jobs = await prisma.job.findMany({
    where: { tenantId, id: { in: [...onJob.keys()] } },
    select: { id: true, price: true, notes: true, workDay: { select: { date: true } } },
    orderBy: [{ workDay: { date: "desc" } }, { id: "desc" }],
  });
  let rest = amount;
  const takes: Array<{ jobId: number; take: number; price: number; notes: string | null }> = [];
  for (const j of jobs) {
    if (rest <= 0.004) break;
    const on = onJob.get(j.id) ?? 0;
    if (on <= 0.004) continue;
    const take = r2(Math.min(on, rest));
    takes.push({ jobId: j.id, take, price: j.price, notes: j.notes });
    rest = r2(rest - take);
  }
  const reason = (input.reason ?? "").trim().slice(0, 200);
  return prisma.$transaction(async (tx) => {
    const refund = await tx.payment.create({
      data: {
        tenantId, customerId: payment.customerId, amount: -amount, method: input.method,
        paidAt: input.at ?? new Date(),
        notes: `Refund${reason ? `: ${reason}` : ""}`,
        refundOfId: payment.id,
        refundWriteOff: input.outcome === "WRITE_OFF" && takes.length > 0,
        goCardlessRefundId: input.goCardlessRefundId ?? null,
        goCardlessStatus: input.goCardlessStatus ?? null,
        collectedByUserId: input.userId ?? null,
        allocations: { create: takes.map((t) => ({ tenantId, jobId: t.jobId, amount: -t.take })) },
      },
    });
    if (input.outcome === "WRITE_OFF") {
      for (const t of takes) {
        await tx.job.update({ where: { id: t.jobId }, data: {
          price: r2(Math.max(0, t.price - t.take)),
          notes: [t.notes, `£${t.take.toFixed(2)} refunded and written off`].filter(Boolean).join(" · ").slice(0, 500),
        } });
      }
    }
    return refund;
  });
}

/** A refund that didn't happen after all (undone, or GoCardless cancelled/bounced it): put the cleans back. */
export async function undoRefund(tenantId: number, refundId: number, why: string) {
  const refund = await prisma.payment.findFirst({ where: { id: refundId, tenantId, amount: { lt: 0 }, voidedAt: null }, select: { id: true, refundWriteOff: true, allocations: { select: { jobId: true, amount: true } } } });
  if (!refund) return;
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: refund.id }, data: { voidedAt: new Date(), voidReason: why } });
    if (refund.refundWriteOff) {
      for (const a of refund.allocations) {
        const job = await tx.job.findUnique({ where: { id: a.jobId }, select: { price: true } });
        if (job) await tx.job.update({ where: { id: a.jobId }, data: { price: r2(job.price - a.amount) } });
      }
    }
  });
}

/** Give back spare credit (paid in advance / paid too much): taken from their newest spare money. */
export async function refundCredit(tenantId: number, customerId: number, amount: number, method: "CASH" | "BACS" | "CARD", reason: string, userId?: string | null) {
  const payments = await prisma.payment.findMany({
    where: { tenantId, customerId, voidedAt: null },
    select: { id: true, amount: true, refundOfId: true, allocations: { select: { amount: true } } },
    orderBy: [{ paidAt: "desc" }, { id: "desc" }],
  });
  const spareOf = (p: (typeof payments)[number]) => r2(p.amount - p.allocations.reduce((s, a) => s + a.amount, 0));
  const credit = r2(payments.reduce((s, p) => s + spareOf(p), 0));
  amount = r2(amount);
  if (!(amount > 0)) throw new Error("Enter an amount above zero.");
  if (amount > credit + 0.004) throw new Error(`They only have £${Math.max(0, credit).toFixed(2)} credit.`);
  // Spare money per payment, less refunds of credit already taken from it.
  const spare = new Map<number, number>();
  for (const p of payments) if (p.amount > 0) spare.set(p.id, spareOf(p));
  for (const p of payments) if (p.amount < 0 && p.refundOfId && spare.has(p.refundOfId)) spare.set(p.refundOfId, r2(spare.get(p.refundOfId)! + spareOf(p)));
  let rest = amount;
  for (const [paymentId, s] of spare) {
    if (rest <= 0.004) break;
    if (s <= 0.004) continue;
    const take = r2(Math.min(s, rest));
    await prisma.payment.create({ data: {
      tenantId, customerId, amount: -take, method, paidAt: new Date(), refundOfId: paymentId, collectedByUserId: userId ?? null,
      notes: `Credit refunded${reason.trim() ? `: ${reason.trim().slice(0, 200)}` : ""}`,
    } });
    rest = r2(rest - take);
  }
}
