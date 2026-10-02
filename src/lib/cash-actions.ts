"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { requireMember, requireOwner } from "@/lib/guards";

/**
 * Cash a team member took at the door stays "with them" until the owner marks it handed over.
 * The owner's own cash isn't tracked here: it's already with the owner.
 */
async function heldPayments(tenantId: number, userIds?: string[]) {
  const workers = await prisma.membership.findMany({
    where: { tenantId, role: "WORKER", ...(userIds ? { userId: { in: userIds } } : {}) },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });
  const payments = await prisma.payment.findMany({
    where: {
      tenantId,
      method: "CASH",
      voidedAt: null,
      handoverId: null,
      collectedByUserId: { in: workers.map((w) => w.userId) },
    },
    select: { id: true, amount: true, paidAt: true, collectedByUserId: true, notes: true, customer: { select: { name: true } } },
    orderBy: { paidAt: "asc" },
  });
  return workers.map((w) => {
    const mine = payments.filter((p) => p.collectedByUserId === w.userId);
    return {
      userId: w.userId,
      name: w.user.name || w.user.email,
      amount: Number(mine.reduce((s, p) => s + p.amount, 0).toFixed(2)),
      payments: mine.map((p) => ({ id: p.id, amount: p.amount, paidAt: p.paidAt.toISOString(), customer: p.customer.name, notes: p.notes ?? "" })),
    };
  });
}

/** Owner: cash each team member is holding, and recent handovers. */
export async function getCashWithTeam() {
  const actor = await requireOwner();
  const [held, handovers] = await Promise.all([
    heldPayments(actor.tenantId),
    prisma.cashHandover.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, workerUserId: true, amount: true, notes: true, createdAt: true, _count: { select: { payments: true } } },
    }),
  ]);
  const names = new Map(held.map((h) => [h.userId, h.name]));
  const missing = handovers.map((h) => h.workerUserId).filter((id) => !names.has(id));
  if (missing.length) {
    for (const u of await prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true, email: true } })) {
      names.set(u.id, u.name || u.email);
    }
  }
  return {
    held: held.filter((h) => h.amount > 0.005),
    handovers: handovers.map((h) => ({
      id: h.id,
      name: names.get(h.workerUserId) ?? "Former team member",
      amount: h.amount,
      notes: h.notes,
      createdAt: h.createdAt.toISOString(),
      payments: h._count.payments,
    })),
  };
}

/** A team member: the cash they're holding to hand over. */
export async function getMyCash() {
  const actor = await requireMember();
  if (!actor.isWorker) return { amount: 0, payments: [] as Array<{ id: number; amount: number; paidAt: string; customer: string; notes: string }> };
  const [mine] = await heldPayments(actor.tenantId, [actor.userId]);
  return { amount: mine?.amount ?? 0, payments: mine?.payments ?? [] };
}

/** Owner: record cash received from a team member (all they hold, or the chosen payments). */
export async function recordCashHandover(input: { workerUserId: string; paymentIds?: number[]; notes?: string }) {
  const actor = await requireOwner();
  const [held] = await heldPayments(actor.tenantId, [input.workerUserId]);
  if (!held) throw new Error("That person isn't on your team.");
  const wanted = input.paymentIds ? new Set(input.paymentIds) : null;
  const payments = held.payments.filter((p) => !wanted || wanted.has(p.id));
  if (payments.length === 0) throw new Error("Nothing to hand over.");
  const amount = Number(payments.reduce((s, p) => s + p.amount, 0).toFixed(2));
  await prisma.$transaction(async (tx) => {
    const handover = await tx.cashHandover.create({
      data: { tenantId: actor.tenantId, workerUserId: input.workerUserId, receivedByUserId: actor.userId, amount, notes: input.notes?.trim() ?? "" },
    });
    await tx.payment.updateMany({
      where: { tenantId: actor.tenantId, id: { in: payments.map((p) => p.id) }, handoverId: null },
      data: { handoverId: handover.id },
    });
  });
  revalidatePath("/payments/cash");
  revalidatePath("/");
  return { amount };
}

/** Owner: undo a handover recorded by mistake (the cash goes back to "with them"). */
export async function undoCashHandover(id: number) {
  const actor = await requireOwner();
  const handover = await prisma.cashHandover.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true } });
  if (!handover) throw new Error("Not found.");
  await prisma.$transaction([
    prisma.payment.updateMany({ where: { tenantId: actor.tenantId, handoverId: id }, data: { handoverId: null } }),
    prisma.cashHandover.delete({ where: { id } }),
  ]);
  revalidatePath("/payments/cash");
}
