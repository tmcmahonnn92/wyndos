"use server";

/**
 * CleanerPlanner import, server side. The browser reads the backup (parse.ts) and sends
 * customers, then (optionally) past cleans and payments, in chunks. Everything is linked by
 * the Wyndos customer ids handed back from the first step, never by name.
 */

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { requireOwner } from "@/lib/guards";
import { composeAddress } from "@/lib/address";
import { bookAreaRunsAfterImport, oneOffAreaIdForImport } from "@/lib/actions";

const AREA_COLOURS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316", "#06B6D4", "#84CC16", "#A855F7", "#6366F1"];
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const METHODS = new Set(["CASH", "BACS", "CARD"]);
const PREFERENCES = new Set(["CASH", "BACS", "CARD", "DD", "INVOICE"]);

export type CpImportRow = {
  key: string;
  name: string;
  address: string;
  houseNameNumber: string;
  street: string;
  town: string;
  postcode: string;
  phone: string;
  email: string;
  latitude: number | null;
  longitude: number | null;
  areaName: string;
  frequencyWeeks: number;
  price: number;
  jobName: string;
  preferredPaymentMethod: string;
  notes: string;
  nextDueDate: string;
  lastCompletedDate: string;
  sortOrder: number;
  active: boolean;
  /** False = no repeat (a one-off, or a service brought in as one-off): goes in with the one-off customers. */
  scheduled: boolean;
  /** Positive = they owe you; negative = in credit. Already the right way round. */
  openingBalance: number;
  openingDate: string;
};

/** Day (complete) to hang an imported clean on, made once per area and date. */
async function historyDay(tenantId: number, areaId: number, iso: string, cache: Map<string, number>) {
  const k = `${areaId}:${iso}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const wd = await prisma.workDay.upsert({
    where: { tenantId_date_areaId: { tenantId, date: day(iso), areaId } },
    create: { tenantId, date: day(iso), areaId, status: "COMPLETE" },
    update: {},
    select: { id: true },
  });
  cache.set(k, wd.id);
  return wd.id;
}

/**
 * Step 1: areas and customers (plus what each one owes or has in credit).
 * Someone already in Wyndos with the same name, address and job is left alone.
 */
export async function importCpCustomers(rows: CpImportRow[]) {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;
  if (!Array.isArray(rows) || rows.length > 500) throw new Error("Send at most 500 customers at a time.");

  const areaIds = new Map<string, number>();
  const areasCreated: string[] = [];
  let colour = await prisma.area.count({ where: { tenantId } });
  const ids: Record<string, number> = {};
  const datedAreas = new Set<number>();
  const dayCache = new Map<string, number>();
  let created = 0, skipped = 0, owedTotal = 0, creditTotal = 0, oneOffs = 0;
  let oneOffAreaId: number | null = null;
  const errors: string[] = [];

  for (const r of rows) {
    try {
      const name = text(r.name, 120);
      const areaName = text(r.areaName, 80) || "Imported";
      if (!name) throw new Error("No name");
      const oneOff = r.scheduled === false;
      if (oneOff && oneOffAreaId === null) oneOffAreaId = await oneOffAreaIdForImport();
      let areaId = oneOff ? oneOffAreaId! : areaIds.get(areaName.toLowerCase());
      if (!areaId) {
        const existing = await prisma.area.findFirst({ where: { tenantId, name: areaName } });
        const area = existing ?? await prisma.area.create({
          data: { tenantId, name: areaName, color: AREA_COLOURS[colour++ % AREA_COLOURS.length], frequencyWeeks: Math.min(52, Math.max(1, Math.round(r.frequencyWeeks) || 4)) },
        });
        if (!existing) areasCreated.push(areaName);
        areaId = area.id;
        areaIds.set(areaName.toLowerCase(), areaId);
      }
      const area = await prisma.area.findUniqueOrThrow({ where: { id: areaId }, select: { frequencyWeeks: true } });

      const parts = { houseNameNumber: text(r.houseNameNumber, 120), street: text(r.street, 160), town: text(r.town, 80), postcode: text(r.postcode, 10).toUpperCase() };
      const address = composeAddress(parts) || text(r.address, 300) || name;
      const jobName = text(r.jobName, 80) || "Window Cleaning";
      const already = await prisma.customer.findFirst({ where: { tenantId, name, address, jobName }, select: { id: true } });
      if (already) { skipped++; continue; }

      const last = isIso(r.lastCompletedDate) ? day(r.lastCompletedDate) : null;
      const next = oneOff ? null : isIso(r.nextDueDate)
        ? day(r.nextDueDate)
        : r.active && r.scheduled !== false && last ? new Date(last.getTime() + area.frequencyWeeks * 7 * 86400000) : null;
      const customer = await prisma.customer.create({
        data: {
          tenantId,
          areaId,
          name,
          address,
          ...parts,
          phone: text(r.phone, 40),
          email: text(r.email, 160),
          latitude: typeof r.latitude === "number" && Number.isFinite(r.latitude) ? r.latitude : null,
          longitude: typeof r.longitude === "number" && Number.isFinite(r.longitude) ? r.longitude : null,
          price: Math.max(0, money(r.price)),
          frequencyWeeks: area.frequencyWeeks,
          jobName,
          preferredPaymentMethod: PREFERENCES.has(r.preferredPaymentMethod) ? r.preferredPaymentMethod : "",
          notes: text(r.notes, 2000) || null,
          sortOrder: Math.max(0, Math.round(r.sortOrder) || 0),
          active: r.active !== false,
          nextDueDate: next,
          lastCompletedDate: last,
        },
        select: { id: true, jobName: true },
      });
      ids[String(r.key)] = customer.id;
      created++;
      if (oneOff) oneOffs++;
      if (!oneOff && r.active !== false && (next || last)) datedAreas.add(areaId);

      // What they owe (or have in credit) when they come across.
      const bal = money(r.openingBalance);
      const when = isIso(r.openingDate) ? r.openingDate : new Date().toISOString().slice(0, 10);
      if (bal > 0.004) {
        const workDayId = await historyDay(tenantId, areaId, when, dayCache);
        await prisma.job.create({
          data: {
            tenantId, workDayId, customerId: customer.id, name: "Balance brought forward", price: bal,
            status: "COMPLETE", completedAt: day(when), isOneOff: true, notes: "Owed when moving from CleanerPlanner",
          },
        });
        owedTotal += bal;
      } else if (bal < -0.004) {
        await prisma.payment.create({
          data: { tenantId, customerId: customer.id, amount: -bal, method: "BACS", paidAt: day(when), notes: "Credit brought forward from CleanerPlanner" },
        });
        creditTotal += -bal;
      }
    } catch (e) {
      errors.push(`${r?.name || r?.key}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
    }
  }

  revalidatePath("/customers");
  revalidatePath("/areas");
  return { created, skipped, oneOffs, ids, areasCreated, datedAreaIds: [...datedAreas], owedTotal: money(owedTotal), creditTotal: money(creditTotal), errors };
}

export type CpHistoryItem = { customerId: number; kind: "charge" | "payment"; date: string; amount: number; method: string; note: string };

/**
 * Step 2 (optional): past cleans, then payments. Send every charge before any payment:
 * payments pay off the oldest unpaid cleans first and anything left over becomes credit.
 */
export async function importCpHistory(items: CpHistoryItem[]) {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;
  if (!Array.isArray(items) || items.length > 2000) throw new Error("Send at most 2000 history rows at a time.");

  const customerIds = [...new Set(items.map((i) => i.customerId).filter((n) => Number.isInteger(n)))];
  const customers = new Map(
    (await prisma.customer.findMany({ where: { tenantId, id: { in: customerIds } }, select: { id: true, areaId: true, jobName: true } })).map((c) => [c.id, c]),
  );
  const dayCache = new Map<string, number>();
  let cleans = 0, payments = 0, skipped = 0;

  // Unpaid cleans per customer, oldest first (loaded once for the customers paying in this batch).
  const owing = new Map<number, Array<{ id: number; left: number }>>();
  const payers = [...new Set(items.filter((i) => i.kind === "payment").map((i) => i.customerId))].filter((id) => customers.has(id));
  if (payers.length) {
    const jobs = await prisma.job.findMany({
      where: { tenantId, customerId: { in: payers }, status: "COMPLETE" },
      select: { id: true, customerId: true, price: true, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } },
      orderBy: [{ completedAt: "asc" }, { id: "asc" }],
    });
    for (const j of jobs) {
      const left = money(j.price - j.allocations.reduce((s, a) => s + a.amount, 0));
      if (left > 0.004) owing.set(j.customerId, [...(owing.get(j.customerId) ?? []), { id: j.id, left }]);
    }
  }

  for (const it of items) {
    const c = customers.get(it.customerId);
    const amount = money(it.amount);
    if (!c || !isIso(it.date) || amount <= 0) { skipped++; continue; }
    if (it.kind === "charge") {
      const workDayId = await historyDay(tenantId, c.areaId, it.date, dayCache);
      await prisma.job.create({
        data: {
          tenantId, workDayId, customerId: c.id, name: c.jobName, price: amount, status: "COMPLETE",
          completedAt: new Date(day(it.date).getTime() + 12 * 3600000), notes: text(it.note, 200) || null,
        },
      });
      cleans++;
    } else {
      let rest = amount;
      const allocations: Array<{ tenantId: number; jobId: number; amount: number }> = [];
      for (const j of owing.get(c.id) ?? []) {
        if (rest <= 0.004) break;
        if (j.left <= 0.004) continue;
        const take = money(Math.min(j.left, rest));
        allocations.push({ tenantId, jobId: j.id, amount: take });
        j.left = money(j.left - take);
        rest = money(rest - take);
      }
      await prisma.payment.create({
        data: {
          tenantId, customerId: c.id, amount, method: METHODS.has(it.method) ? (it.method as "CASH" | "BACS" | "CARD") : "CASH",
          paidAt: new Date(day(it.date).getTime() + 12 * 3600000), notes: text(it.note, 200) || "From CleanerPlanner",
          allocations: { create: allocations },
        },
      });
      payments++;
    }
  }
  return { cleans, payments, skipped };
}

/** Step 3: book each imported area's next run from its customers' due dates. */
export async function finishCpImport(areaIds: number[], bookRuns: boolean) {
  await requireOwner();
  const runs = bookRuns ? await bookAreaRunsAfterImport(areaIds) : [];
  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/scheduler");
  revalidatePath("/payments");
  return { runs };
}
