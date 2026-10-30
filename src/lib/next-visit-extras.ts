import "server-only";
import prisma from "@/lib/db";

/**
 * Extras asked for at the next visit ("do the conservatory next time"), before that visit is booked.
 * Kept on the customer (Customer.nextVisitExtras, JSON) and added as one-off jobs on the same day
 * as their next booked regular clean, as soon as there is one. Then cleared.
 */
export type NextVisitExtra = { name: string; price: number; notes?: string | null };

export function parseExtras(raw: string | null | undefined): NextVisitExtra[] {
  try {
    const list = JSON.parse(raw || "[]");
    if (!Array.isArray(list)) return [];
    return list
      .map((x) => ({ name: String(x?.name ?? "").trim().slice(0, 120), price: Math.max(0, Math.round(Number(x?.price) * 100) / 100 || 0), notes: x?.notes ? String(x.notes).slice(0, 500) : null }))
      .filter((x) => x.name);
  } catch {
    return [];
  }
}

const todayUtc = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };

/**
 * Put waiting extras onto each customer's next booked clean after today (asked on the doorstep
 * today = next time, not today's visit). For today, add a one-off on today's date instead.
 * Safe to call any time, often: a customer's extras are claimed once (cleared first), so two
 * calls at the same moment never add them twice.
 */
export async function attachNextVisitExtras(tenantId: number, customerIds?: number[]) {
  const waiting = await prisma.customer.findMany({
    where: { tenantId, nextVisitExtras: { not: "[]" }, ...(customerIds ? { id: { in: customerIds } } : {}) },
    select: { id: true, nextVisitExtras: true },
  });
  let added = 0;
  for (const c of waiting) {
    const extras = parseExtras(c.nextVisitExtras);
    const next = await prisma.job.findFirst({
      where: { tenantId, customerId: c.id, status: "PENDING", isOneOff: false, isQuote: false, workDay: { status: { not: "COMPLETE" }, date: { gt: todayUtc() } } },
      orderBy: [{ workDay: { date: "asc" } }, { id: "asc" }],
      select: { workDayId: true, sortOrder: true, assignedUserId: true },
    });
    if (!next) continue;
    // Claim them: only the call that clears them adds them.
    const claimed = await prisma.customer.updateMany({ where: { id: c.id, tenantId, nextVisitExtras: c.nextVisitExtras }, data: { nextVisitExtras: "[]" } });
    if (claimed.count === 0 || !extras.length) continue;
    await prisma.job.createMany({
      data: extras.map((x) => ({
        tenantId, workDayId: next.workDayId, customerId: c.id, name: x.name, price: x.price, notes: x.notes ?? null,
        isOneOff: true, sortOrder: next.sortOrder, assignedUserId: next.assignedUserId,
      })),
    });
    added += extras.length;
  }
  return { added };
}
