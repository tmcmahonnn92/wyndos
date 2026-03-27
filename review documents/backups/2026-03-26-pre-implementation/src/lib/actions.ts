"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { calcNextDue } from "@/lib/utils";
import { startOfDay } from "date-fns";
import { getActiveTenantId } from "@/lib/tenant-context";

/** Normalise any Date to UTC midnight so date-input strings and DB values always match. */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  const base = utcDay(d);
  return new Date(base.getTime() + days * 86_400_000);
}

type BalanceJobLike = {
  id: number;
  price: number;
  name?: string;
  isOneOff?: boolean;
  completedAt?: Date | null;
  createdAt?: Date;
  workDay?: { date: Date } | null;
};

function buildJobDebtBreakdown<T extends BalanceJobLike>(jobs: T[], totalPaid: number) {
  const ordered = [...jobs].sort((a, b) => {
    const aTime = a.completedAt?.getTime() ?? a.workDay?.date?.getTime() ?? a.createdAt?.getTime() ?? 0;
    const bTime = b.completedAt?.getTime() ?? b.workDay?.date?.getTime() ?? b.createdAt?.getTime() ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.id - b.id;
  });

  let remainingPaid = Math.max(0, totalPaid);

  return ordered.map((job) => {
    const applied = Math.min(remainingPaid, job.price);
    remainingPaid -= applied;
    const due = Math.max(0, Number((job.price - applied).toFixed(2)));
    return {
      ...job,
      applied: Number(applied.toFixed(2)),
      due,
    };
  });
}

/**
 * Calculate the next run date for an area after a given date.
 *  - WEEKLY:  fromDate + frequencyWeeks
 *  - MONTHLY: next occurrence of monthlyDay in a calendar month after fromDate
 */
function nextRunAfter(
  area: { scheduleType: string; frequencyWeeks: number; monthlyDay: number | null },
  fromDate: Date
): Date {
  if (area.scheduleType === "MONTHLY") {
    const day = area.monthlyDay ?? 1;
    const from = utcDay(fromDate);
    // Try the same calendar month first
    const sameMonth = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), day));
    if (sameMonth > from) return sameMonth;
    // Otherwise use next calendar month
    return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, day));
  }
  return addUtcDays(fromDate, (area.frequencyWeeks ?? 4) * 7);
}

// ─── Areas ─────────────────────────────────────────────────────────────────

export async function createArea(data: {
  name: string;
  sortOrder?: number;
  scheduleType?: string;
  frequencyWeeks?: number;
  monthlyDay?: number;
  nextDueDate?: Date;
}) {
  const tenantId = await getActiveTenantId();
  await prisma.area.create({ data: { tenantId,
      name: data.name,
      sortOrder: data.sortOrder ?? 0,
      scheduleType: data.scheduleType ?? "WEEKLY",
      frequencyWeeks: data.frequencyWeeks ?? 4,
      monthlyDay: data.monthlyDay ?? null,
      nextDueDate: data.nextDueDate ?? null,
    },
  });
  revalidatePath("/days");
  revalidatePath("/areas");
  revalidatePath("/");
}

export async function updateArea(
  id: number,
  data: {
    name?: string;
    color?: string;
    sortOrder?: number;
    scheduleType?: string;
    frequencyWeeks?: number;
    monthlyDay?: number | null;
    nextDueDate?: Date | null;
  }
) {
  const tenantId = await getActiveTenantId();
  await prisma.area.update({ where: { id }, data });
  // Cascade frequency change to all customers in this area (used by legacy calcNextDue paths)
  if (data.frequencyWeeks !== undefined) {
    await prisma.customer.updateMany({
      where: { areaId: id },
      data: { frequencyWeeks: data.frequencyWeeks },
    });
  }
  revalidatePath("/days");
  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/");
}

export async function deleteArea(id: number) {
  const tenantId = await getActiveTenantId();
  const customerCount = await prisma.customer.count({ where: { tenantId, areaId: id } });
  if (customerCount > 0) {
    throw new Error(
      `Cannot delete this area — ${customerCount} customer${customerCount === 1 ? "" : "s"} still assigned. Move them to another area first.`
    );
  }
  await prisma.area.delete({ where: { id } });
  revalidatePath("/areas");
  revalidatePath("/scheduler");
  revalidatePath("/days");
  revalidatePath("/");
}

export async function getAreas() {
  const tenantId = await getActiveTenantId();
  return prisma.area.findMany({ where: { tenantId, isSystemArea: false }, orderBy: { sortOrder: "asc" } });
}

export async function getAreaSchedules() {
  const tenantId = await getActiveTenantId();
  const areas = await prisma.area.findMany({ where: { tenantId, isSystemArea: false },
    include: {
      _count: { select: { customers: true } },
      customers: {
        where: { active: true },
        select: { id: true, name: true, address: true, price: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
    },
    orderBy: { sortOrder: "asc" },
  });
  return areas.map((a) => ({
    ...a,
    estimatedValue: a.customers.reduce((s, c) => s + c.price, 0),
  }));
}

/** Find or create the hidden system area used for one-off (no-schedule) customers. */
async function getOrCreateOneOffSystemArea(tenantId: number) {
  const existing = await prisma.area.findFirst({ where: { tenantId, isSystemArea: true } });
  if (existing) return existing;
  return prisma.area.create({ data: { tenantId,
      name: "__one-off__",
      color: "#A855F7",
      isSystemArea: true,
      sortOrder: 9999,
      frequencyWeeks: 9999,
    },
  });
}

export async function reorderAreaCustomers(areaId: number, orderedIds: number[]) {
  const tenantId = await getActiveTenantId();
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.customer.update({ where: { id }, data: { sortOrder: index } })
    )
  );
  revalidatePath("/areas");
  revalidatePath("/customers");
  revalidatePath("/scheduler");
  revalidatePath("/days");
}

/** Parse a YYYY-MM-DD string as UTC midnight — unambiguous, timezone-proof. */
function isoToUTC(dateISO: string): Date {
  const d = new Date(dateISO + "T00:00:00.000Z");
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${dateISO}`);
  return d;
}

/**
 * Create a single WorkDay for the dropped date, populate it with eligible
 * customers for the area, and mark the area's nextDueDate as this date.
 * (Completion auto-schedules the subsequent run.)
 */
export async function scheduleAreaRun(areaId: number, dateISO: string) {
  const tenantId = await getActiveTenantId();
  const d = isoToUTC(dateISO);

  const [area, eligibleCustomers] = await Promise.all([
    prisma.area.findUnique({ where: { id: areaId } }),
    // All active area customers always ride the area schedule — no nextDueDate filter
    prisma.customer.findMany({ where: { tenantId, areaId, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);
  if (!area) throw new Error("Area not found");

  // Create (or find existing) work day for the dropped date
  const workDay = await prisma.workDay.upsert({
    where: { tenantId_date_areaId: { tenantId, date: d, areaId } },
    update: {},
    create: { tenantId, date: d, areaId },
  });

  // Populate with eligible customers (avoid duplicates)
  const existing = await prisma.job.findMany({ where: { tenantId, workDayId: workDay.id },
    select: { customerId: true },
  });
  const existingIds = new Set(existing.map((j) => j.customerId));
  const newJobs = eligibleCustomers.filter((c) => !existingIds.has(c.id));
  if (newJobs.length > 0) {
    await prisma.job.createMany({ data: newJobs.map((c) => ({ tenantId,
        workDayId: workDay.id,
        customerId: c.id,
        price: c.price,
        name: c.jobName || "Window Cleaning",
        // Auto-skip customers who were already serviced via another area's one-off run
        status: c.skipNextAreaRun ? ("SKIPPED" as const) : ("PENDING" as const),
        notes: c.skipNextAreaRun ? "Completed via another area run" : null,
      })),
    });
    // Clear the one-off skip flag now that it has been applied
    const toReset = newJobs.filter((c) => c.skipNextAreaRun).map((c) => c.id);
    if (toReset.length > 0) {
      await prisma.customer.updateMany({ where: { id: { in: toReset } }, data: { skipNextAreaRun: false } });
    }
  }

  // Set nextDueDate to this scheduled date so the area shows as "scheduled"
  await prisma.area.update({ where: { id: areaId }, data: { nextDueDate: d } });

  revalidatePath("/days");
  revalidatePath("/scheduler");
  revalidatePath("/");
  return workDay;
}

/**
 * Create a one-off job for an existing customer on a specific date.
 * Finds or creates a WorkDay for that date (with no area if none exists).
 */
export async function createOneOffJob(data: {
  date: Date;
  customerId: number;
  name: string;
  price?: number;
  notes?: string;
}) {
  const tenantId = await getActiveTenantId();
  const d = utcDay(data.date);
  if (isNaN(d.getTime())) throw new Error("Invalid date — please select a valid date.");

  const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) throw new Error("Customer not found");

  // One-off: find or create a workday on this date with no area
  let workDay = await prisma.workDay.findFirst({ where: { tenantId, date: d, areaId: null } });
  if (!workDay) workDay = await prisma.workDay.create({ data: { tenantId, date: d } });

  // Check not already on this day
  const existing = await prisma.job.findFirst({ where: { tenantId, workDayId: workDay.id, customerId: data.customerId },
  });
  if (existing) {
    revalidatePath(`/days/${workDay.id}`);
    return { workDay, job: existing, alreadyExisted: true };
  }

  const job = await prisma.job.create({ data: { tenantId,
      workDayId: workDay.id,
      customerId: data.customerId,
      name: data.name,
      price: data.price ?? customer.price,
      notes: data.notes ?? null,
      isOneOff: true,
    },
  });

  revalidatePath(`/days/${workDay.id}`);
  revalidatePath("/days");
  return { workDay, job, alreadyExisted: false };
}

// ─── Customers ─────────────────────────────────────────────────────────────

export async function getCustomers(areaIds?: number[], search?: string, includeInactive = false, tagIds?: number[], onlyOneOff = false) {
  const tenantId = await getActiveTenantId();
  return prisma.customer.findMany({ where: { tenantId,
      ...(includeInactive ? {} : { active: true }),
      ...(onlyOneOff
        ? { area: { isSystemArea: true } }
        : areaIds && areaIds.length > 0 ? { areaId: { in: areaIds } } : {}),
      ...(tagIds && tagIds.length > 0 ? { tags: { some: { tagId: { in: tagIds } } } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { address: { contains: search } },
            ],
          }
        : {}),
    },
    include: {
      area: true,
      tags: { include: { tag: true } },
      jobs: { where: { status: "COMPLETE" }, select: { price: true } },
      payments: { select: { amount: true } },
    },
    orderBy: [{ area: { sortOrder: "asc" } }, { name: "asc" }],
  });
}

export async function getCustomer(id: number) {
  const tenantId = await getActiveTenantId();
  return prisma.customer.findFirst({
    where: { id, tenantId },
    include: {
      area: true,
      tags: { include: { tag: true } },
      jobs: {
        include: { workDay: true, payments: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
      payments: { orderBy: { paidAt: "desc" }, take: 50 },
    },
  });
}

export async function bulkImportCustomers(
  records: Array<{
    name: string;
    address: string;
    price: number;
    areaId?: number;           // undefined when areaName is provided for creation
    areaName?: string;         // raw area name — used when createMissingAreas is true
    areaColor?: string;        // colour to apply when creating the new area
    areaFrequencyWeeks?: number; // frequency to set on the new area
    email?: string;
    phone?: string;
    notes?: string;
    jobName?: string;
    advanceNotice?: boolean;
    preferredPaymentMethod?: string;
    nextDueDate?: string;
    frequencyWeeks?: number;
  }>,
  options: {
    createMissingAreas?: boolean;
    updateExisting?: boolean;
    matchField?: "name" | "nameAddress";
  } = {}
): Promise<{ created: number; updated: number; errors: Array<{ row: number; message: string }>; areasCreated: string[] }> {
  const tenantId = await getActiveTenantId();
  const errors: Array<{ row: number; message: string }> = [];
  let created = 0;
  let updated = 0;
  const areasCreated: string[] = [];
  // Cache newly-created area names → ids so we don't duplicate within one import
  const areaNameCache = new Map<string, number>();

  // Colour palette — assigned cyclically to every new area created during this import
  const AREA_COLOURS = [
    "#3B82F6", // blue
    "#10B981", // emerald
    "#F59E0B", // amber
    "#EF4444", // red
    "#8B5CF6", // violet
    "#EC4899", // pink
    "#14B8A6", // teal
    "#F97316", // orange
    "#06B6D4", // cyan
    "#84CC16", // lime
    "#A855F7", // purple
    "#6366F1", // indigo
  ];
  // Start offset from existing area count so re-imports get fresh colours
  const existingAreaCount = await prisma.area.count({ where: { tenantId } });
  let colourIndex = existingAreaCount % AREA_COLOURS.length;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    try {
      // ── Resolve areaId ──────────────────────────────────────────────────────
      let resolvedAreaId = r.areaId;
      if (!resolvedAreaId && r.areaName && options.createMissingAreas) {
        const trimmed = r.areaName.trim();
        const cacheHit = areaNameCache.get(trimmed.toLowerCase());
        if (cacheHit) {
          resolvedAreaId = cacheHit;
        } else {
          // upsert so re-running the import is idempotent
          const colour = r.areaColor ?? AREA_COLOURS[colourIndex % AREA_COLOURS.length];
          const area = await prisma.area.upsert({
            where: { tenantId_name: { tenantId, name: trimmed } },
            create: { tenantId, name: trimmed, color: colour, frequencyWeeks: r.areaFrequencyWeeks ?? 4 },
            update: {},
          });
          if (!areaNameCache.has(trimmed.toLowerCase())) {
            areasCreated.push(trimmed);
            colourIndex++;
          }
          areaNameCache.set(trimmed.toLowerCase(), area.id);
          resolvedAreaId = area.id;
        }
      }
      if (!resolvedAreaId) throw new Error(`Area not resolved for row ${i + 1}`);

      const area = await prisma.area.findUnique({ where: { id: resolvedAreaId } });
      if (!area) throw new Error(`Area ID ${resolvedAreaId} not found`);

      const customerData = {
        address: r.address.trim(),
        email: r.email?.trim() ?? "",
        phone: r.phone?.trim() ?? "",
        areaId: resolvedAreaId,
        price: r.price,
        notes: r.notes?.trim() || null,
        jobName: r.jobName?.trim() || "Window Cleaning",
        advanceNotice: r.advanceNotice ?? false,
        preferredPaymentMethod: r.preferredPaymentMethod?.trim() ?? "",
        frequencyWeeks: r.frequencyWeeks ?? area.frequencyWeeks,
        nextDueDate: r.nextDueDate ? new Date(r.nextDueDate + "T00:00:00.000Z") : null,
      };

      // ── Create or update ────────────────────────────────────────────────────
      if (options.updateExisting) {
        const matchField = options.matchField ?? "name";
        const existing = await prisma.customer.findFirst({
          where: matchField === "nameAddress"
            ? { name: r.name.trim(), address: r.address.trim() }
            : { name: r.name.trim() },
        });
        if (existing) {
          await prisma.customer.update({ where: { id: existing.id }, data: customerData });
          updated++;
        } else {
          await prisma.customer.create({ data: { tenantId, name: r.name.trim(), ...customerData } });
          created++;
        }
      } else {
        await prisma.customer.create({ data: { tenantId, name: r.name.trim(), ...customerData } });
        created++;
      }
    } catch (e) {
      errors.push({ row: i + 1, message: String(e) });
    }
  }

  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/scheduler");
  return { created, updated, errors, areasCreated };
}

export async function deleteAllCustomers(): Promise<{ deleted: number }> {
  const tenantId = await getActiveTenantId();
  const customers = await prisma.customer.findMany({
    select: { id: true },
    where: { area: { isSystemArea: false } },
  });
  const ids = customers.map((c) => c.id);
  if (ids.length > 0) {
    await prisma.payment.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.job.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customerTag.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids } } });
  }

  // Delete all non-system areas (they now have 0 customers) and their WorkDays
  const nonSystemAreas = await prisma.area.findMany({ where: { tenantId, isSystemArea: false },
    select: { id: true },
  });
  const areaIds = nonSystemAreas.map((a) => a.id);
  if (areaIds.length > 0) {
    const workDays = await prisma.workDay.findMany({ where: { tenantId, areaId: { in: areaIds } },
      select: { id: true },
    });
    const workDayIds = workDays.map((w) => w.id);
    if (workDayIds.length > 0) {
      await prisma.job.deleteMany({ where: { workDayId: { in: workDayIds } } });
      await prisma.workDay.deleteMany({ where: { id: { in: workDayIds } } });
    }
    await prisma.area.deleteMany({ where: { id: { in: areaIds } } });
  }

  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/scheduler");
  revalidatePath("/days");
  return { deleted: ids.length };
}

export async function bulkImportJobHistory(
  records: Array<{
    customerName: string;
    address?: string;
    date: string;           // YYYY-MM-DD
    price?: number;
    paid?: number;
    paymentMethod?: string;
    notes?: string;
  }>,
  options: { matchField?: "name" | "nameAddress" } = {}
): Promise<{ created: number; errors: Array<{ row: number; message: string }> }> {
  const tenantId = await getActiveTenantId();
  const errors: Array<{ row: number; message: string }> = [];
  let created = 0;
  // Cache "areaId:dateStr" → workDayId so we don't create duplicate work days
  const workDayCache = new Map<string, number>();

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    try {
      const matchField = options.matchField ?? "name";
      const customer = await prisma.customer.findFirst({
        where: matchField === "nameAddress" && r.address?.trim()
          ? { name: r.customerName.trim(), address: r.address.trim() }
          : { name: r.customerName.trim() },
      });
      if (!customer) throw new Error(`Customer "${r.customerName}" not found`);

      const workDate = new Date(r.date + "T00:00:00.000Z");
      const cacheKey = `${customer.areaId}:${r.date}`;

      let workDayId = workDayCache.get(cacheKey);
      if (!workDayId) {
        const existing = await prisma.workDay.findFirst({ where: { tenantId, areaId: customer.areaId, date: workDate },
        });
        if (existing) {
          workDayId = existing.id;
        } else {
          const wd = await prisma.workDay.create({ data: { tenantId, date: workDate, areaId: customer.areaId, status: "COMPLETE" },
          });
          workDayId = wd.id;
        }
        workDayCache.set(cacheKey, workDayId);
      }

      const jobPrice = r.price ?? customer.price;
      const job = await prisma.job.create({ data: { tenantId,
          workDayId,
          customerId: customer.id,
          name: customer.jobName || "Window Cleaning",
          status: "COMPLETE",
          price: jobPrice,
          completedAt: workDate,
          notes: r.notes?.trim() || null,
        },
      });

      if (r.paid && r.paid > 0) {
        const validMethods = ["CASH", "BACS", "CARD"];
        const method = validMethods.includes((r.paymentMethod ?? "").toUpperCase())
          ? (r.paymentMethod!.toUpperCase() as "CASH" | "BACS" | "CARD")
          : "CASH";
        await prisma.payment.create({ data: { tenantId,
            customerId: customer.id,
            jobId: job.id,
            amount: r.paid,
            method,
            paidAt: workDate,
          },
        });
      }

      created++;
    } catch (e) {
      errors.push({ row: i + 1, message: String(e) });
    }
  }

  revalidatePath("/customers");
  revalidatePath("/days");
  return { created, errors };
}

/**
 * Internal: ensures the customer has a PENDING job on every PLANNED or
 * IN_PROGRESS work day for their area where they are eligible.
 * Safe to call multiple times — never creates duplicates.
 */
async function autoAddToScheduledDays(tenantId: number, customerId: number, areaId: number) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { active: true, price: true, jobName: true, skipNextAreaRun: true },
  });
  if (!customer?.active) return;

  // All active area customers are always included — no nextDueDate eligibility filter
  const futureDays = await prisma.workDay.findMany({ where: { tenantId, areaId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
  });

  const affectedDayIds: number[] = [];
  for (const workDay of futureDays) {
    const existing = await prisma.job.findFirst({ where: { tenantId, workDayId: workDay.id, customerId },
    });
    if (existing) continue;

    await prisma.job.create({ data: { tenantId,
        workDayId: workDay.id,
        customerId,
        price: customer.price,
        name: customer.jobName || "Window Cleaning",
        // Auto-skip if they were already serviced via another area's one-off run
        status: customer.skipNextAreaRun ? "SKIPPED" : "PENDING",
        notes: customer.skipNextAreaRun ? "Completed via another area run" : null,
      },
    });
    affectedDayIds.push(workDay.id);
  }

  // Clear the skip flag now that it has been applied
  if (customer.skipNextAreaRun && affectedDayIds.length > 0) {
    await prisma.customer.update({ where: { id: customerId }, data: { skipNextAreaRun: false } });
  }

  for (const dayId of affectedDayIds) {
    revalidatePath(`/days/${dayId}`);
  }
  if (affectedDayIds.length > 0) revalidatePath("/days");
}

export async function createCustomer(data: {
  name: string;
  address: string;
  email?: string;
  phone?: string;
  areaId: number;
  frequencyWeeks?: number;
  price: number;
  notes?: string;
  jobName?: string;
  advanceNotice?: boolean;
  preferredPaymentMethod?: string;
  nextDueDate?: Date;
}) {
  const tenantId = await getActiveTenantId();
  // Always inherit frequencyWeeks and nextDueDate from the area
  const area = await prisma.area.findUnique({ where: { id: data.areaId } });
  const customer = await prisma.customer.create({ data: { tenantId,
      name: data.name,
      address: data.address,
      email: data.email ?? "",
      phone: data.phone ?? "",
      areaId: data.areaId,
      price: data.price,
      notes: data.notes ?? null,
      jobName: data.jobName ?? "Window Cleaning",
      advanceNotice: data.advanceNotice ?? false,
      preferredPaymentMethod: data.preferredPaymentMethod ?? "",
      frequencyWeeks: area?.frequencyWeeks ?? data.frequencyWeeks ?? 4,
      nextDueDate: data.nextDueDate ?? null,   // null = never cleaned; picked up on first area run
    },
  });
  revalidatePath("/customers");
  revalidatePath("/areas");
  await autoAddToScheduledDays(tenantId, customer.id, customer.areaId!);
  return customer;
}

export async function updateCustomer(
  id: number,
  data: {
    name?: string;
    address?: string;
    email?: string;
    phone?: string;
    areaId?: number;
    frequencyWeeks?: number;
    price?: number;
    notes?: string;
    nextDueDate?: Date | null;
    active?: boolean;
    jobName?: string;
    advanceNotice?: boolean;
    preferredPaymentMethod?: string;
  }
) {
  const tenantId = await getActiveTenantId();
  const current = await prisma.customer.findUnique({
    where: { id },
    select: { areaId: true },
  });
  if (!current) throw new Error("Customer not found");

  const resolvedAreaId = data.areaId ?? current.areaId;
  const area = await prisma.area.findUnique({ where: { id: resolvedAreaId } });

  // Customers always inherit frequency from their area.
  const { frequencyWeeks: _ignoredFrequencyWeeks, ...rest } = data;
  const updateData = {
    ...rest,
    areaId: resolvedAreaId,
    frequencyWeeks: area?.frequencyWeeks ?? 4,
  };

  await prisma.customer.update({ where: { id }, data: updateData });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  revalidatePath("/areas");
  revalidatePath("/scheduler");
  await autoAddToScheduledDays(tenantId, id, resolvedAreaId);
}

export async function bulkUpdateCustomers(
  updates: Array<{
    id: number;
    name?: string;
    address?: string;
    areaId?: number;
    price?: number;
    frequencyWeeks?: number;
    notes?: string;
    active?: boolean;
  }>
) {
  const tenantId = await getActiveTenantId();
  await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      const current = await tx.customer.findUnique({
        where: { id: update.id },
        select: { areaId: true },
      });
      if (!current) continue;

      const resolvedAreaId = update.areaId ?? current.areaId;
      const area = await tx.area.findUnique({
        where: { id: resolvedAreaId },
        select: { frequencyWeeks: true },
      });

      const { id, frequencyWeeks: _ignoredFrequencyWeeks, ...rest } = update;
      await tx.customer.update({
        where: { id },
        data: {
          ...rest,
          areaId: resolvedAreaId,
          frequencyWeeks: area?.frequencyWeeks ?? 4,
        },
      });
    }
  });
  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/scheduler");
  revalidatePath("/");
}

export async function rescheduleCustomer(id: number, newDate: Date) {
  const tenantId = await getActiveTenantId();
  await prisma.customer.update({
    where: { id },
    data: { nextDueDate: newDate },
  });
  revalidatePath(`/customers/${id}`);
  revalidatePath("/");
}

// ─── Work Days ──────────────────────────────────────────────────────────────

export async function getWorkDays() {
  const tenantId = await getActiveTenantId();
  return prisma.workDay.findMany({
    where: { tenantId },
    include: {
      area: true,
      jobs: {
        include: {
          customer: {
            include: {
              area: true,
              jobs: {
                where: { status: "OUTSTANDING" },
                select: { id: true, price: true },
              },
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { customer: { name: "asc" } }],
      },
    },
    orderBy: { date: "desc" },
  });
}

export async function getWorkDay(id: number) {
  const tenantId = await getActiveTenantId();
  return prisma.workDay.findFirst({
    where: { id, tenantId },
    include: {
      area: true,
      jobs: {
        include: {
          customer: {
            include: {
              area: true,
              // COMPLETE jobs only — debt = sum(these prices) - sum(customer.payments)
              // OUTSTANDING means "windows not done this visit" — NOT a debt status
              jobs: {
                where: { status: "COMPLETE" },
                select: { id: true, price: true },
              },
              payments: { select: { amount: true } },
            },
          },
          payments: true,
        },
        orderBy: [{ sortOrder: "asc" }, { customer: { name: "asc" } }],
      },
    },
  });
}

export async function createWorkDay(date: Date, areaId?: number) {
  const tenantId = await getActiveTenantId();
  const d = utcDay(date);
  let day;
  if (areaId) {
    // For area-linked days: enforce one per (date, area) pair
    day = await prisma.workDay.upsert({
      where: { tenantId_date_areaId: { tenantId, date: d, areaId } },
      update: {},
      create: { tenantId, date: d, areaId },
    });
  } else {
    // No area: just create a standalone day (one-off / manual)
    day = await prisma.workDay.create({ data: { tenantId, date: d } });
  }
  revalidatePath("/days");
  return day;
}

export async function addJobToDay(workDayId: number, customerId: number) {
  const tenantId = await getActiveTenantId();
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });
  if (!customer) throw new Error("Customer not found");
  const job = await prisma.job.create({ data: { tenantId, workDayId, customerId, price: customer.price, status: "PENDING" },
  });
  revalidatePath(`/days/${workDayId}`);
  return job;
}

export async function addOneOffJobToDay(
  workDayId: number,
  customerId: number,
  opts: { name?: string; price?: number; notes?: string }
) {
  const tenantId = await getActiveTenantId();
  const [customer, targetWorkDay] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId } }),
    prisma.workDay.findUnique({ where: { id: workDayId }, include: { area: true } }),
  ]);
  if (!customer) throw new Error("Customer not found");
  await prisma.job.create({ data: { tenantId,
      workDayId,
      customerId,
      name: opts.name?.trim() || customer.jobName || "Window Cleaning",
      price: opts.price ?? customer.price,
      notes: opts.notes?.trim() || null,
      isOneOff: true,
    },
  });

  // If this is a cross-area one-off: skip or flag the customer's next home-area run
  if (targetWorkDay && customer.areaId !== targetWorkDay.areaId) {
    const dayName = targetWorkDay.area?.name ?? "another day";
    const dateLabel = targetWorkDay.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const homeAreaPendingJob = await prisma.job.findFirst({ where: { tenantId,
        customerId,
        status: "PENDING",
        workDayId: { not: workDayId },
        workDay: { areaId: customer.areaId },
      },
      orderBy: { workDay: { date: "asc" } },
    });
    if (homeAreaPendingJob) {
      await prisma.job.update({
        where: { id: homeAreaPendingJob.id },
        data: { status: "SKIPPED", notes: `Completed via ${dayName} on ${dateLabel}` },
      });
      revalidatePath(`/days/${homeAreaPendingJob.workDayId}`);
    } else {
      // No home-area run scheduled yet — flag so it auto-skips when created
      await prisma.customer.update({
        where: { id: customerId },
        data: { skipNextAreaRun: true },
      });
    }
  }

  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/scheduler");
}

// Add a customer from another area as a one-off. Also leaves a note on their
// next pending scheduled job so the original day shows they're allocated elsewhere.
export async function addJobFromOtherArea(targetWorkDayId: number, customerId: number) {
  const tenantId = await getActiveTenantId();
  const [customer, targetWorkDay] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId } }),
    prisma.workDay.findUnique({ where: { id: targetWorkDayId }, include: { area: true } }),
  ]);
  if (!customer) throw new Error("Customer not found");
  if (!targetWorkDay) throw new Error("Work day not found");

  // Add as one-off if not already present
  const existing = await prisma.job.findFirst({ where: { tenantId, workDayId: targetWorkDayId, customerId } });
  if (!existing) {
    await prisma.job.create({ data: { tenantId, workDayId: targetWorkDayId, customerId, price: customer.price, isOneOff: true },
    });
  }

  // Skip or flag the customer's next PENDING job in their HOME area
  const dayName = targetWorkDay.area?.name ?? "another day";
  const dateLabel = new Date(targetWorkDay.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const homeAreaPendingJob = await prisma.job.findFirst({ where: { tenantId,
      customerId,
      status: "PENDING",
      workDayId: { not: targetWorkDayId },
      workDay: { areaId: customer.areaId },
    },
    orderBy: { workDay: { date: "asc" } },
  });
  if (homeAreaPendingJob) {
    // Mark the existing home-area job as SKIPPED
    await prisma.job.update({
      where: { id: homeAreaPendingJob.id },
      data: { status: "SKIPPED", notes: `Completed via ${dayName} on ${dateLabel}` },
    });
    revalidatePath(`/days/${homeAreaPendingJob.workDayId}`);
  } else {
    // No home-area run scheduled yet — flag so it auto-skips when created
    await prisma.customer.update({
      where: { id: customer.id },
      data: { skipNextAreaRun: true },
    });
  }

  revalidatePath(`/days/${targetWorkDayId}`);
  revalidatePath("/days");
  revalidatePath("/scheduler");
}

// Create a brand-new customer and immediately add them to a specific work day.
export async function createCustomerAndAddToDay(
  data: {
    name: string;
    address: string;
    price: number;
    areaId: number;
    email?: string;
    phone?: string;
    notes?: string;
    jobName?: string;
  },
  workDayId: number
) {
  const tenantId = await getActiveTenantId();
  const area = await prisma.area.findUnique({ where: { id: data.areaId } });
  const customer = await prisma.customer.create({ data: { tenantId,
      name: data.name,
      address: data.address,
      email: data.email ?? "",
      phone: data.phone ?? "",
      areaId: data.areaId,
      price: data.price,
      notes: data.notes ?? null,
      jobName: data.jobName ?? "Window Cleaning",
      frequencyWeeks: area?.frequencyWeeks ?? 4,
    },
  });
  await prisma.job.create({ data: { tenantId, workDayId, customerId: customer.id, price: customer.price },
  });
  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/days");
  return customer;
}

/**
 * Create a brand-new one-off customer (no recurring schedule) and add them to a day.
 * They are placed in the hidden system area so they are still viewable in customer records.
 */
export async function createOneOffCustomerAndAddToDay(
  data: {
    name: string;
    address: string;
    price: number;
    email?: string;
    phone?: string;
    notes?: string;
    jobName?: string;
    areaId?: number;
    frequencyWeeks?: number;
  },
  workDayId: number
) {
  const tenantId = await getActiveTenantId();
  let areaId: number;
  let freqWeeks: number;
  if (data.areaId) {
    areaId = data.areaId;
    freqWeeks = data.frequencyWeeks ?? 4;
  } else {
    const systemArea = await getOrCreateOneOffSystemArea(tenantId);
    areaId = systemArea.id;
    freqWeeks = 9999; // never scheduled
  }
  const customer = await prisma.customer.create({ data: { tenantId,
      name: data.name,
      address: data.address,
      email: data.email ?? "",
      phone: data.phone ?? "",
      areaId,
      price: data.price,
      notes: data.notes ?? null,
      jobName: data.jobName ?? "Window Cleaning",
      frequencyWeeks: freqWeeks,
    },
  });
  await prisma.job.create({ data: { tenantId, workDayId, customerId: customer.id, price: customer.price, isOneOff: true },
  });
  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/customers");
  revalidatePath("/days");
  return customer;
}

/** Like createOneOffCustomerAndAddToDay but takes a date instead of a workDayId.
 *  Finds or creates an area-less one-off WorkDay for that date. */
export async function createOneOffCustomerAndBookByDate(
  data: {
    name: string;
    address: string;
    price: number;
    email?: string;
    phone?: string;
    notes?: string;
    jobName?: string;
    areaId?: number;
    frequencyWeeks?: number;
  },
  date: Date
) {
  const tenantId = await getActiveTenantId();
  const d = utcDay(date);
  if (isNaN(d.getTime())) throw new Error("Invalid date — please select a valid date.");

  let areaId: number;
  let freqWeeks: number;
  if (data.areaId) {
    areaId = data.areaId;
    freqWeeks = data.frequencyWeeks ?? 4;
  } else {
    const systemArea = await getOrCreateOneOffSystemArea(tenantId);
    areaId = systemArea.id;
    freqWeeks = 9999;
  }

  const customer = await prisma.customer.create({ data: { tenantId,
      name: data.name,
      address: data.address,
      email: data.email ?? "",
      phone: data.phone ?? "",
      areaId,
      price: data.price,
      notes: data.notes ?? null,
      jobName: data.jobName ?? "Window Cleaning",
      frequencyWeeks: freqWeeks,
    },
  });

  let workDay = await prisma.workDay.findFirst({ where: { tenantId, date: d, areaId: null } });
  if (!workDay) workDay = await prisma.workDay.create({ data: { tenantId, date: d } });

  await prisma.job.create({ data: { tenantId, workDayId: workDay.id, customerId: customer.id, price: customer.price, isOneOff: true },
  });

  revalidatePath(`/days/${workDay.id}`);
  revalidatePath("/customers");
  revalidatePath("/days");
  return customer;
}

export async function removeJobFromDay(jobId: number) {
  const tenantId = await getActiveTenantId();
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job not found");
  if (job.status === "COMPLETE") throw new Error("Cannot remove a completed job");
  await prisma.job.delete({ where: { id: jobId } });
  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/scheduler");
}

export async function startDay(workDayId: number) {
  const tenantId = await getActiveTenantId();
  await prisma.workDay.update({
    where: { id: workDayId },
    data: { status: "IN_PROGRESS" },
  });
  revalidatePath(`/days/${workDayId}`);
}

/**
 * Delete all PLANNED work days from today onwards (and their jobs).
 * Used to wipe the future schedule so the user can rebuild via drag-and-drop.
 * Does NOT touch IN_PROGRESS or COMPLETE days (preserves history).
 */
export async function clearFutureSchedule() {
  const tenantId = await getActiveTenantId();
  const today = utcDay(new Date());

  const futureDays = await prisma.workDay.findMany({ where: { tenantId, date: { gte: today }, status: "PLANNED" },
    select: { id: true },
  });

  const ids = futureDays.map((d) => d.id);
  if (ids.length === 0) return 0;

  // Delete jobs first (no cascade defined in schema)
  await prisma.job.deleteMany({ where: { workDayId: { in: ids } } });
  await prisma.workDay.deleteMany({ where: { id: { in: ids } } });

  revalidatePath("/scheduler");
  revalidatePath("/days");
  revalidatePath("/");
  return ids.length;
}

export async function deleteWorkDay(workDayId: number) {
  const tenantId = await getActiveTenantId();
  const wd = await prisma.workDay.findUnique({
    where: { id: workDayId },
    include: { jobs: { select: { id: true, status: true } } },
  });
  if (!wd) throw new Error("Work day not found");

  // Delete only non-completed jobs
  await prisma.job.deleteMany({
    where: { workDayId, status: { notIn: ["COMPLETE"] } },
  });

  // Only delete the day itself if no completed jobs remain (preserve history otherwise)
  const remainingCompleted = wd.jobs.filter((j) => j.status === "COMPLETE").length;
  if (remainingCompleted === 0) {
    await prisma.workDay.delete({ where: { id: workDayId } });
  }

  revalidatePath("/scheduler");
  revalidatePath("/days");
}

/**
 * Copy a customer from another area/day onto this work day (this time only).
 * Uses existing addJobToDay logic.
 */
export async function addCustomerToDay(workDayId: number, customerId: number) {
  const tenantId = await getActiveTenantId();
  return addJobToDay(workDayId, customerId);
}

/**
 * Re-sync a work day with all currently eligible area customers.
 * Useful when a customer was added to an area AFTER the work day was already
 * created/populated by a previous run's completeDay snapshot.
 * Adds any missing customers (active, nextDueDate <= workDay.date or null).
 */
export async function syncWorkDayCustomers(workDayId: number): Promise<{ added: number }> {
  const tenantId = await getActiveTenantId();
  const workDay = await prisma.workDay.findUnique({
    where: { id: workDayId },
    include: { area: true },
  });
  if (!workDay || !workDay.areaId) return { added: 0 };

  const eligibleCustomers = await prisma.customer.findMany({ where: { tenantId,
      areaId: workDay.areaId,
      active: true,
      OR: [{ nextDueDate: null }, { nextDueDate: { lte: workDay.date } }],
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const existingJobs = await prisma.job.findMany({ where: { tenantId, workDayId },
    select: { customerId: true },
  });
  const existingIds = new Set(existingJobs.map((j) => j.customerId));
  const missing = eligibleCustomers.filter((c) => !existingIds.has(c.id));

  if (missing.length > 0) {
    await prisma.job.createMany({
      data: missing.map((c) => ({
        tenantId,
        workDayId,
        customerId: c.id,
        price: c.price,
        status: "PENDING" as const,
        name: c.jobName || "Window Cleaning",
      })),
    });
  }

  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/days");
  return { added: missing.length };
}

/**
 * Permanently move a customer to a new area (going forward) and also add
 * them to the given work day if not already present.
 */
export async function moveCustomerToArea(
  customerId: number,
  newAreaId: number,
  addToWorkDayId?: number
) {
  const tenantId = await getActiveTenantId();
  // Clear skip flag — moving to a new area is a clean slate
  await prisma.customer.update({ where: { id: customerId }, data: { areaId: newAreaId, skipNextAreaRun: false } });
  revalidatePath("/customers");

  if (addToWorkDayId) {
    await addJobToDay(addToWorkDayId, customerId);
  }
  await autoAddToScheduledDays(tenantId, customerId, newAreaId);
  revalidatePath("/days");
}

/**
 * Move multiple customers to a new area in one shot.
 */
export async function bulkMoveCustomersToArea(customerIds: number[], newAreaId: number) {
  const tenantId = await getActiveTenantId();
  const area = await prisma.area.findUnique({ where: { id: newAreaId } });
  if (!area) throw new Error("Area not found");
  await prisma.customer.updateMany({
    where: { id: { in: customerIds } },
    // Clear skip flag — moving to a new area is a clean slate
    data: { areaId: newAreaId, frequencyWeeks: area.frequencyWeeks, skipNextAreaRun: false },
  });
  for (const id of customerIds) {
    await autoAddToScheduledDays(tenantId, id, newAreaId);
  }
  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/days");
}

/**
 * Log a payment against an already-completed job.
 * Convenience wrapper used from the day view "Mark as Paid" flow.
 */
export async function markJobPaid(data: {
  jobId: number;
  customerId: number;
  workDayId: number;
  amount: number;
  method: "CASH" | "BACS" | "CARD";
  notes?: string;
}) {
  const tenantId = await getActiveTenantId();
  await prisma.payment.create({ data: { tenantId,
      customerId: data.customerId,
      jobId: data.jobId,
      amount: data.amount,
      method: data.method,
      notes: data.notes ?? null,
      paidAt: new Date(),
    },
  });
  revalidatePath(`/days/${data.workDayId}`);
  revalidatePath(`/customers/${data.customerId}`);
  revalidatePath("/payments");
}

// ─── Jobs ───────────────────────────────────────────────────────────────────

export async function completeJob(jobId: number) {
  const tenantId = await getActiveTenantId();
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { customer: { include: { area: true } } },
  });
  if (!job) throw new Error("Job not found");

  const now = new Date();
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "COMPLETE", completedAt: now },
  });

  // Auto-start the work day if still PLANNED — removes the need to tap "Start Area" separately
  await prisma.workDay.updateMany({
    where: { id: job.workDayId, status: "PLANNED" },
    data: { status: "IN_PROGRESS" },
  });

  // Advance by this customer's own frequency (may differ from area frequency e.g. 8-weekly)
  const nextDue = calcNextDue(now, job.customer.area?.frequencyWeeks ?? job.customer.frequencyWeeks);
  await prisma.customer.update({
    where: { id: job.customerId },
    data: {
      frequencyWeeks: job.customer.area?.frequencyWeeks ?? job.customer.frequencyWeeks,
      nextDueDate: nextDue,
      lastCompletedDate: now,
    },
  });

  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath(`/customers/${job.customerId}`);
}

export async function uncompleteJob(jobId: number) {
  const tenantId = await getActiveTenantId();
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job not found");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "PENDING", completedAt: null },
  });

  revalidatePath(`/days/${job.workDayId}`);
}

export async function skipJob(jobId: number) {
  const tenantId = await getActiveTenantId();
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { customer: { include: { area: true } }, workDay: true },
  });
  if (!job) throw new Error("Job not found");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "SKIPPED" },
  });

  // Advance by this customer's own frequency (may differ from area frequency)
  const nextDue = calcNextDue(job.workDay.date, job.customer.area?.frequencyWeeks ?? job.customer.frequencyWeeks);
  await prisma.customer.update({
    where: { id: job.customerId },
    data: {
      frequencyWeeks: job.customer.area?.frequencyWeeks ?? job.customer.frequencyWeeks,
      nextDueDate: nextDue,
    },
  });

  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/outstanding");
}

export async function markJobOutstanding(jobId: number) {
  const tenantId = await getActiveTenantId();
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { customer: { include: { area: true } }, workDay: true },
  });
  if (!job) throw new Error("Job not found");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "OUTSTANDING" },
  });

  // Advance by this customer's own frequency (may differ from area frequency)
  const nextDue = calcNextDue(job.workDay.date, job.customer.area?.frequencyWeeks ?? job.customer.frequencyWeeks);
  await prisma.customer.update({
    where: { id: job.customerId },
    data: {
      frequencyWeeks: job.customer.area?.frequencyWeeks ?? job.customer.frequencyWeeks,
      nextDueDate: nextDue,
    },
  });

  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/outstanding");
}

export async function moveJobToDay(jobId: number, newWorkDayId: number) {
  const tenantId = await getActiveTenantId();
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job not found");

  const oldDayId = job.workDayId;

  await prisma.job.update({
    where: { id: jobId },
    data: { workDayId: newWorkDayId, status: "PENDING" },
  });

  revalidatePath(`/days/${oldDayId}`);
  revalidatePath(`/days/${newWorkDayId}`);
}

/**
 * Move a work day to a new date.
 * mode "one-off"   → just moves this work day. Area nextDueDate unchanged.
 * mode "recurring" → shifts this work day AND all future non-completed work days
 *                    for the same area by the same day delta, then recalculates
 *                    area.nextDueDate from the last shifted run.
 * newDateISO: YYYY-MM-DD string (local calendar date from the client).
 */
export async function rescheduleWorkDay(
  workDayId: number,
  newDateISO: string,
  mode: "one-off" | "recurring"
) {
  const tenantId = await getActiveTenantId();
  const d = isoToUTC(newDateISO);

  const workDay = await prisma.workDay.findUnique({
    where: { id: workDayId },
    include: { area: true },
  });
  if (!workDay) throw new Error("Work day not found");

  if (mode === "one-off") {
    // Guard against collision for one-off moves only
    if (workDay.areaId) {
      const collision = await prisma.workDay.findFirst({ where: { tenantId, date: d, areaId: workDay.areaId, id: { not: workDayId } },
      });
      if (collision) throw new Error("There is already a work day for that area on that date.");
    }
    await prisma.workDay.update({ where: { id: workDayId }, data: { date: d } });
  } else {
    // "recurring" mode: shift this work day AND all future PLANNED work days by the same delta
    const oldDate = utcDay(new Date(workDay.date));
    const deltaDays = Math.round((d.getTime() - oldDate.getTime()) / 86_400_000);

    if (deltaDays === 0) return workDayId; // nothing to do

    // Fetch all non-completed work days for this area on or after the dragged day's date.
    // COMPLETE days are historical records and must never be moved.
    const futureShiftable = workDay.areaId
      ? await prisma.workDay.findMany({ where: { tenantId,
            areaId: workDay.areaId,
            date: { gte: oldDate },
            status: { not: "COMPLETE" },
          },
          orderBy: { date: "asc" },
        })
      : [workDay];

    if (futureShiftable.length === 0) return workDayId;

    // Process in reverse order when shifting forward (avoids unique-constraint conflicts)
    const ordered = deltaDays > 0 ? [...futureShiftable].reverse() : futureShiftable;

    for (const wd of ordered) {
      const base = new Date(Date.UTC(
        wd.date.getUTCFullYear(),
        wd.date.getUTCMonth(),
        wd.date.getUTCDate()
      ));
      const shifted = new Date(base.getTime() + deltaDays * 86_400_000);
      await prisma.workDay.update({ where: { id: wd.id }, data: { date: shifted } });
    }

    // Recalculate area.nextDueDate from the last (latest) shifted work day
    if (workDay.area && futureShiftable.length > 0) {
      const lastOldDate = futureShiftable[futureShiftable.length - 1].date;
      const lastBase = new Date(Date.UTC(
        lastOldDate.getUTCFullYear(),
        lastOldDate.getUTCMonth(),
        lastOldDate.getUTCDate()
      ));
      const lastNewDate = new Date(lastBase.getTime() + deltaDays * 86_400_000);
      const nextDue = nextRunAfter(workDay.area, lastNewDate);
      await prisma.area.update({ where: { id: workDay.area.id }, data: { nextDueDate: nextDue } });
    }
  }

  revalidatePath("/days");
  revalidatePath("/scheduler");
  revalidatePath("/");
  return workDayId;
}

/** Fetch work days within a date range (inclusive). */
export async function getWorkDaysInRange(from: Date, to: Date) {
  const tenantId = await getActiveTenantId();
  return prisma.workDay.findMany({ where: { tenantId, date: { gte: utcDay(from), lte: utcDay(to) } },
    include: {
      area: true,
      jobs: { include: { customer: { include: { area: true } } } },
    },
    orderBy: { date: "asc" },
  });
}

// ─── Complete Day ───────────────────────────────────────────────────────────

/**
 * Resolve all outstanding PENDING jobs and mark the day COMPLETE.
 * resolutions: array of { jobId, action: "skip" | "outstanding" | "move", targetDayId? }
 */
export async function completeDay(
  workDayId: number,
  resolutions: Array<{
    jobId: number;
    action: "complete" | "skip" | "outstanding" | "move";
    targetDayId?: number;
  }>
) {
  const tenantId = await getActiveTenantId();
  for (const r of resolutions) {
    if (r.action === "complete") {
      await completeJob(r.jobId);
    } else if (r.action === "skip") {
      await skipJob(r.jobId);
    } else if (r.action === "outstanding") {
      await markJobOutstanding(r.jobId);
    } else if (r.action === "move" && r.targetDayId) {
      await moveJobToDay(r.jobId, r.targetDayId);
    }
  }

  // Move this work day's date to today if there is no collision, so history
  // reflects when the run actually happened rather than when it was scheduled.
  const today = utcDay(new Date());
  const workDayBefore = await prisma.workDay.findUnique({
    where: { id: workDayId },
    include: { area: true },
  });
  if (!workDayBefore) throw new Error("Work day not found");
  const alreadyToday = workDayBefore.date.getTime() === today.getTime();
  const collision = !alreadyToday && workDayBefore.areaId
    ? await prisma.workDay.findFirst({ where: { tenantId, date: today, areaId: workDayBefore.areaId, id: { not: workDayId } },
      })
    : null;
  const finalDate = (!alreadyToday && !collision) ? today : utcDay(new Date(workDayBefore.date));

  const workDay = await prisma.workDay.update({
    where: { id: workDayId },
    data: { status: "COMPLETE", date: finalDate },
    include: { area: true },
  });

  // Auto-schedule next run when a day is completed.
  // nextRunAfter preserves day-of-week for weekly schedules (addWeeks keeps weekday).
  let nextRunResult: { nextDue: Date; nextWorkDayId: number | null; areaName: string } | null = null;

  if (workDay.area) {
    // Base the next run on when the work was SCHEDULED (workDayBefore.date), not today.
    // Using today caused a bug: completing an April 21 day on March 24 would
    // schedule "next run" = April 21 (the same day just completed) instead of May 19.
    const completedDate = utcDay(new Date(workDayBefore.date));
    const nextDue = nextRunAfter(workDay.area, completedDate);

    // Record last completed date and advance nextDueDate
    await prisma.area.update({
      where: { id: workDay.area.id },
      data: { lastCompletedDate: completedDate, nextDueDate: nextDue },
    });

    // All customers in an area follow the area's cycle exactly.
    // When a run is completed, sync every active customer in that area to the
    // area's frequency and next due date so future runs do not randomly drop jobs.
    await prisma.customer.updateMany({
      where: { areaId: workDay.area.id, active: true },
      data: {
        frequencyWeeks: workDay.area.frequencyWeeks,
        nextDueDate: nextDue,
      },
    });

    // Create populated work day for next run
    const nextWorkDay = await prisma.workDay.upsert({
      where: { tenantId_date_areaId: { date: nextDue, areaId: workDay.area.id , tenantId } },
      update: {},
      create: { tenantId, date: nextDue, areaId: workDay.area.id },
    });

    // All active area customers are always included in every run — no nextDueDate filter
    const eligibleCustomers = await prisma.customer.findMany({ where: { tenantId, areaId: workDay.area.id, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const existingJobs = await prisma.job.findMany({ where: { tenantId, workDayId: nextWorkDay.id },
      select: { customerId: true },
    });
    const existingIds = new Set(existingJobs.map((j) => j.customerId));
    const newJobs = eligibleCustomers.filter((c) => !existingIds.has(c.id));
    if (newJobs.length > 0) {
      await prisma.job.createMany({ data: newJobs.map((c) => ({ tenantId,
          workDayId: nextWorkDay.id,
          customerId: c.id,
          price: c.price,
          name: c.jobName || "Window Cleaning",
          // Auto-skip customers who were already serviced via another area's one-off run
          status: c.skipNextAreaRun ? ("SKIPPED" as const) : ("PENDING" as const),
          notes: c.skipNextAreaRun ? "Completed via another area run" : null,
        })),
      });
      // Clear the one-off skip flag now that it has been applied
      const toReset = newJobs.filter((c) => c.skipNextAreaRun).map((c) => c.id);
      if (toReset.length > 0) {
        await prisma.customer.updateMany({ where: { id: { in: toReset } }, data: { skipNextAreaRun: false } });
      }
    }

    nextRunResult = { nextDue, nextWorkDayId: nextWorkDay.id, areaName: workDay.area.name };
  }

  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/days");
  revalidatePath("/scheduler");
  revalidatePath("/");

  return nextRunResult;
}

export async function reopenDay(workDayId: number) {
  const tenantId = await getActiveTenantId();
  await prisma.workDay.update({
    where: { id: workDayId },
    data: { status: "PLANNED" },
  });
  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/days");
  revalidatePath("/");
}

export async function updateWorkDayNotes(workDayId: number, notes: string) {
  const tenantId = await getActiveTenantId();
  await prisma.workDay.update({
    where: { id: workDayId },
    data: { notes: notes.trim() || null },
  });
  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/days");
  revalidatePath("/");
}

// ─── Split / copy area (creates "Name - Day 2" clone without customers) ──────

export async function splitArea(areaId: number) {
  const tenantId = await getActiveTenantId();
  const area = await prisma.area.findUnique({ where: { id: areaId } });
  if (!area) throw new Error("Area not found");
  // Strip any existing " - Day N" suffix and append the next number
  const base = area.name.replace(/ - Day \d+$/, "");
  // Find all areas whose name starts with the same base to pick the next number
  const existing = await prisma.area.findMany({ where: { tenantId, name: { startsWith: base } },
    select: { name: true },
  });
  const usedNumbers = existing
    .map((a) => {
      const m = a.name.match(/ - Day (\d+)$/);
      return m ? parseInt(m[1], 10) : 1;
    })
    .filter(Boolean);
  const nextNum = Math.max(...usedNumbers, 1) + 1;
  const newName = `${base} - Day ${nextNum}`;
  const created = await prisma.area.create({ data: { tenantId,
      name: newName,
      color: area.color,
      sortOrder: area.sortOrder + 1,
      scheduleType: area.scheduleType,
      frequencyWeeks: area.frequencyWeeks,
      monthlyDay: area.monthlyDay ?? null,
      nextDueDate: area.nextDueDate ?? null,
    },
    include: { customers: true, _count: { select: { customers: true } } },
  });
  revalidatePath("/scheduler");
  revalidatePath("/days");
  revalidatePath("/");
  return { ...created, estimatedValue: 0 };
}

// ─── Update completed work day date ─────────────────────────────────────────

export async function updateCompletedWorkDayDate(workDayId: number, isoDate: string) {
  const tenantId = await getActiveTenantId();
  const newDate = isoToUTC(isoDate);
  const workDay = await prisma.workDay.findUnique({
    where: { id: workDayId },
    include: { area: true },
  });
  if (!workDay) throw new Error("Work day not found");

  await prisma.workDay.update({
    where: { id: workDayId },
    data: { date: newDate },
  });

  if (workDay.area) {
    // Recalculate from the latest completed workday for this area (accounting for the update above)
    const latestCompleted = await prisma.workDay.findFirst({ where: { tenantId, areaId: workDay.area.id, status: "COMPLETE" },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    const lastCompleted = latestCompleted?.date ?? newDate;
    const nextDue = nextRunAfter(workDay.area, lastCompleted);

    await prisma.area.update({
      where: { id: workDay.area.id },
      data: { lastCompletedDate: lastCompleted, nextDueDate: nextDue },
    });

    await prisma.customer.updateMany({
      where: { areaId: workDay.area.id, active: true },
      data: { nextDueDate: nextDue },
    });
  }

  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/days");
  revalidatePath("/scheduler");
  revalidatePath("/");
}

// ─── Payments ───────────────────────────────────────────────────────────────

export async function logPayment(data: {
  customerId: number;
  jobId?: number;
  amount: number;
  method: "CASH" | "BACS" | "CARD";
  notes?: string;
  paidAt?: Date;
}) {
  const tenantId = await getActiveTenantId();
  const payment = await prisma.payment.create({ data: { tenantId,
      customerId: data.customerId,
      jobId: data.jobId ?? null,
      amount: data.amount,
      method: data.method,
      notes: data.notes ?? null,
      paidAt: data.paidAt ?? new Date(),
    },
  });
  revalidatePath("/payments");
  revalidatePath(`/customers/${data.customerId}`);
  return payment;
}

export async function logPaymentForSelectedJobs(data: {
  customerId: number;
  jobIds: number[];
  method: "CASH" | "BACS" | "CARD";
  notes?: string;
  paidAt?: Date;
}) {
  const tenantId = await getActiveTenantId();
  const uniqueJobIds = Array.from(new Set(data.jobIds.filter(Boolean)));
  if (uniqueJobIds.length === 0) throw new Error("Select at least one job to mark as paid.");

  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
    include: {
      jobs: {
        where: { status: "COMPLETE" },
        include: { workDay: true },
        orderBy: [{ workDay: { date: "asc" } }, { createdAt: "asc" }],
      },
      payments: { select: { amount: true } },
    },
  });
  if (!customer) throw new Error("Customer not found");

  const totalPaid = customer.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const breakdown = buildJobDebtBreakdown(customer.jobs, totalPaid);
  const selectedJobs = breakdown.filter((job) => uniqueJobIds.includes(job.id) && job.due > 0.005);

  if (selectedJobs.length === 0) {
    throw new Error("Selected jobs are already fully paid.");
  }

  await prisma.$transaction(
    selectedJobs.map((job) =>
      prisma.payment.create({ data: { tenantId,
          customerId: data.customerId,
          jobId: job.id,
          amount: job.due,
          method: data.method,
          notes: data.notes ?? null,
          paidAt: data.paidAt ?? new Date(),
        },
      })
    )
  );

  revalidatePath("/payments");
  revalidatePath(`/customers/${data.customerId}`);

  return {
    count: selectedJobs.length,
    amount: Number(selectedJobs.reduce((sum, job) => sum + job.due, 0).toFixed(2)),
  };
}

export async function deletePayment(id: number, customerId: number) {
  const tenantId = await getActiveTenantId();
  await prisma.payment.delete({ where: { id } });
  revalidatePath("/payments");
  revalidatePath(`/customers/${customerId}`);
}

// ─── Dashboard data ─────────────────────────────────────────────────────────

export async function getDashboardData() {
  const tenantId = await getActiveTenantId();
  const today = startOfDay(new Date());

  const [
    upcomingDays,
    totalRoundValue,
    totalEarnings,
    customerCount,
    overdueCount,
    totalOwingRaw,
    recentPayments,
    customersWithDebt,
  ] = await Promise.all([
    // Next 7 upcoming work days
    prisma.workDay.findMany({ where: { tenantId, date: { gte: today } },
      include: {
        area: true,
        jobs: { include: { customer: true } },
      },
      orderBy: { date: "asc" },
      take: 7,
    }),
    // Total round value — sum of all active customer prices
    prisma.customer.aggregate({ where: { tenantId, active: true }, _sum: { price: true } }),
    // Total earnings — sum of all payments
    prisma.payment.aggregate({ where: { tenantId }, _sum: { amount: true } }),
    // Active customer count
    prisma.customer.count({ where: { tenantId, active: true } }),
    // Overdue count — areas whose nextDueDate is in the past
    prisma.area.count({ where: { tenantId, nextDueDate: { lt: today } } }),
    // Total owing — completed job prices minus all payments (scoped to tenant)
    prisma.$queryRaw<{ total: number }[]>`
      SELECT ROUND(
        COALESCE((SELECT SUM(j.price) FROM Job j JOIN Customer jc ON jc.id = j.customerId WHERE j.status = 'COMPLETE' AND jc.tenantId = ${tenantId}), 0)
        - COALESCE((SELECT SUM(p.amount) FROM Payment p JOIN Customer pc ON pc.id = p.customerId WHERE pc.tenantId = ${tenantId}), 0)
      , 2) as total
    `,
    // Recent payments
    prisma.payment.findMany({
      where: { tenantId },
      include: { customer: true },
      orderBy: { paidAt: "desc" },
      take: 5,
    }),
    // Customers with outstanding debt (scoped to tenant)
    prisma.$queryRaw<
      { id: number; name: string; address: string; debt: number }[]
    >`
      SELECT c.id, c.name, c.address,
        COALESCE(SUM(j.price), 0) - COALESCE((SELECT SUM(p.amount) FROM Payment p WHERE p.customerId = c.id), 0) as debt
      FROM Customer c
      LEFT JOIN Job j ON j.customerId = c.id AND j.status = 'COMPLETE'
      WHERE c.tenantId = ${tenantId}
      GROUP BY c.id
      HAVING debt > 0
      ORDER BY debt DESC
      LIMIT 10
    `,
  ]);

  return {
    upcomingDays,
    totalRoundValue: Number(totalRoundValue._sum.price ?? 0),
    totalEarnings: Number(totalEarnings._sum.amount ?? 0),
    customerCount,
    overdueCount,
    totalOwing: Number(totalOwingRaw[0]?.total ?? 0),
    recentPayments,
    customersWithDebt,
  };
}

export async function getPaymentsPage() {
  const tenantId = await getActiveTenantId();
  const [payments, customers] = await Promise.all([
    prisma.payment.findMany({
      where: { tenantId },
      include: { customer: true, job: { include: { workDay: true } } },
      orderBy: { paidAt: "desc" },
      take: 50,
    }),
    prisma.customer.findMany({
      where: { tenantId },
      include: {
        area: true,
        jobs: {
          where: { status: "COMPLETE" },
          include: { workDay: true },
          orderBy: [{ workDay: { date: "asc" } }, { createdAt: "asc" }],
        },
        payments: { select: { amount: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const debtors = customers
    .map((customer) => {
      const totalPaid = customer.payments.reduce((sum, payment) => sum + payment.amount, 0);
      const jobBreakdown = buildJobDebtBreakdown(customer.jobs, totalPaid);
      const unpaidJobs = jobBreakdown
        .filter((job) => job.due > 0.005)
        .map((job) => ({
          id: job.id,
          name: job.name,
          price: job.price,
          paid: job.applied,
          due: job.due,
          isOneOff: job.isOneOff,
          date: job.workDay?.date,
        }));
      const debt = Number(unpaidJobs.reduce((sum, job) => sum + job.due, 0).toFixed(2));

      return {
        id: customer.id,
        name: customer.name,
        address: customer.address,
        email: customer.email,
        phone: customer.phone,
        areaId: customer.areaId,
        areaName: customer.area?.name ?? "",
        debt,
        jobIds: unpaidJobs.map((job) => job.id),
        unpaidJobs,
      };
    })
    .filter((customer) => customer.debt > 0.005)
    .sort((a, b) => b.debt - a.debt);

  return { payments, customersWithDebt: debtors };
}

export async function getOutstandingJobs() {
  const tenantId = await getActiveTenantId();
  return prisma.job.findMany({ where: { tenantId, status: "OUTSTANDING" },
    include: {
      customer: { include: { area: true } },
      workDay: true,
    },
    orderBy: { workDay: { date: "asc" } },
  });
}

export async function getCustomerBalance(customerId: number) {
  const tenantId = await getActiveTenantId();
  const result = await prisma.$queryRaw<{ balance: number }[]>`
    SELECT ROUND(
      COALESCE((SELECT SUM(j.price) FROM Job j WHERE j.customerId = ${customerId} AND j.status = 'COMPLETE'), 0)
      - COALESCE((SELECT SUM(p.amount) FROM Payment p WHERE p.customerId = ${customerId}), 0)
    , 2) as balance
  `;
  return Number(result[0]?.balance ?? 0);
}

// ── Business Settings ────────────────────────────────────────────────────────

export async function getBusinessSettings() {
  const tenantId = await getActiveTenantId();
  let settings = await prisma.tenantSettings.findFirst({ where: { tenantId } });
  if (!settings) {
    settings = await prisma.tenantSettings.create({ data: { tenantId } });
  }
  return settings;
}

export async function updateBusinessSettings(data: {
  businessName?: string;
  ownerName?: string;
  phone?: string;
  email?: string;
  address?: string;
  bankDetails?: string;
  vatNumber?: string;
  invoicePrefix?: string;
  logoBase64?: string | null;
  smtpProvider?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFromName?: string;
  voodooApiKey?: string;
  voodooSender?: string;
  // Messaging / Twilio
  messagingProvider?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  // Meta WhatsApp Cloud API
  metaPhoneNumberId?: string;
  metaAccessToken?: string;
  metaWabaId?: string;
  // Message templates
  tmplCleaningReminder?: string;
  tmplJobComplete?: string;
  tmplPaymentReminder1?: string;
  tmplPaymentReminder2?: string;
  tmplPaymentReminder3?: string;
  tmplPaymentReceived?: string;
  tmplJobAndPayment?: string;
  tmplInvoiceNote?: string;
}) {
  const tenantId = await getActiveTenantId();
  await prisma.tenantSettings.upsert({ where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
  revalidatePath("/settings");
}

export async function claimNextInvoiceNumber(): Promise<string> {
  const tenantId = await getActiveTenantId();
  const settings = await getBusinessSettings();
  const num = settings.nextInvoiceNum;
  await prisma.tenantSettings.update({ where: { tenantId },
    data: { nextInvoiceNum: num + 1 },
  });
  return `${settings.invoicePrefix}-${String(num).padStart(4, "0")}`;
}

// ── Tags ─────────────────────────────────────────────────────────────────────

export async function getTags() {
  const tenantId = await getActiveTenantId();
  return prisma.tag.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
}

export async function createTag(data: { name: string; color: string }) {
  const tenantId = await getActiveTenantId();
  await prisma.tag.create({ data: { ...data, tenantId } });
  revalidatePath("/settings");
}

export async function deleteTag(id: number) {
  const tenantId = await getActiveTenantId();
  await prisma.tag.delete({ where: { id } });
  revalidatePath("/settings");
}

// ─── Job ordering & notes ──────────────────────────────────────────────────

/**
 * Persist a custom job order within a work day.
 * orderedJobIds: all jobIds for that day in the desired order (index = sortOrder).
 */
export async function reorderDayJobs(workDayId: number, orderedJobIds: number[]) {
  const tenantId = await getActiveTenantId();
  await Promise.all(
    orderedJobIds.map((id, index) =>
      prisma.job.update({ where: { id }, data: { sortOrder: index } })
    )
  );
  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/scheduler");
}

/** Update the notes field on a specific job (day-specific note, separate from customer notes). */
export async function updateJobNotes(jobId: number, notes: string) {
  const tenantId = await getActiveTenantId();
  const job = await prisma.job.update({
    where: { id: jobId },
    data: { notes: notes.trim() || null },
  });
  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/scheduler");
}

export async function updateJobPrice(jobId: number, price: number) {
  const tenantId = await getActiveTenantId();
  const job = await prisma.job.update({
    where: { id: jobId },
    data: { price },
  });
  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath("/scheduler");
  revalidatePath(`/customers/${job.customerId}`);
  revalidatePath("/payments");
}

export async function addJobToWorkDay(workDayId: number, customerId: number, price?: number) {
  const tenantId = await getActiveTenantId();
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new Error("Customer not found");
  const existing = await prisma.job.findFirst({ where: { tenantId, workDayId, customerId } });
  if (existing) throw new Error("Customer already on this day");
  const job = await prisma.job.create({ data: { tenantId,
      workDayId,
      customerId,
      name: "Window Cleaning",
      price: price ?? customer.price,
      status: "PENDING",
    },
  });
  revalidatePath(`/days/${workDayId}`);
  revalidatePath("/scheduler");
  return job;
}

export async function setCustomerTags(customerId: number, tagIds: number[]) {
  const tenantId = await getActiveTenantId();
  await prisma.$transaction([
    prisma.customerTag.deleteMany({ where: { customerId } }),
    ...(tagIds.length > 0
      ? [prisma.customerTag.createMany({
          data: tagIds.map((tagId) => ({ customerId, tagId })),
        })]
      : []),
  ]);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
}

// ─── Unfinished Jobs (for scheduler rescheduling) ──────────────────────────

/**
 * Returns all PENDING or IN_PROGRESS jobs whose work day date is on or before
 * today. These are jobs that were scheduled but not completed or explicitly
 * skipped — they can be dragged onto a new day in the scheduler.
 */
export async function getPendingUnfinishedJobs() {
  const tenantId = await getActiveTenantId();
  const today = utcDay(new Date());
  return prisma.job.findMany({ where: { tenantId,
      status: "PENDING",
      workDay: { date: { lt: today } },  // strictly before today — today's jobs are still in-progress
    },
    include: {
      customer: { include: { area: true } },
      workDay: { include: { area: true } },
    },
    orderBy: { workDay: { date: "asc" } },
  });
}

/**
 * Move a single job to a different date without altering the customer's
 * recurring nextDueDate. Finds or creates a work day on the target date
 * using the same area as the job's current work day.
 */
export async function rescheduleJobToDate(jobId: number, dateISO: string) {
  const tenantId = await getActiveTenantId();
  const d = isoToUTC(dateISO);

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { workDay: true },
  });
  if (!job) throw new Error("Job not found");

  const areaId = job.workDay.areaId;
  let targetWorkDay: { id: number };

  if (areaId) {
    // Reuse an existing work day for this area+date, or create one
    targetWorkDay = await prisma.workDay.upsert({
      where: { tenantId_date_areaId: { tenantId, date: d, areaId } },
      update: {},
      create: { tenantId, date: d, areaId },
    });
  } else {
    // Standalone day — find any existing standalone day on that date or create
    const existing = await prisma.workDay.findFirst({ where: { tenantId, date: d, areaId: null },
    });
    targetWorkDay = existing ?? (await prisma.workDay.create({ data: { tenantId, date: d } }));
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { workDayId: targetWorkDay.id },
  });

  revalidatePath("/scheduler");
  revalidatePath("/days");
  revalidatePath("/");
}

// ─── Update job completedAt date ─────────────────────────────────────────────

export async function updateJobCompletedAt(jobId: number, isoDate: string) {
  const tenantId = await getActiveTenantId();
  const d = isoToUTC(isoDate);

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { customer: true },
  });
  if (!job) throw new Error("Job not found");

  await prisma.job.update({
    where: { id: jobId },
    data: { completedAt: d },
  });

  const latestCompleted = await prisma.job.findFirst({ where: { tenantId, customerId: job.customerId, status: "COMPLETE" },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });

  await prisma.customer.update({
    where: { id: job.customerId },
    data: { lastCompletedDate: latestCompleted?.completedAt ?? d },
  });

  revalidatePath(`/days/${job.workDayId}`);
  revalidatePath(`/customers/${job.customerId}`);
  revalidatePath("/days");
}

// ─── Holidays ───────────────────────────────────────────────────────────────

export async function getHolidays() {
  const tenantId = await getActiveTenantId();
  return prisma.holiday.findMany({
    orderBy: [{ startDate: "asc" }, { endDate: "asc" }],
  });
}

export async function createHoliday(data: { startDate: string; endDate: string; label: string }) {
  const tenantId = await getActiveTenantId();
  const startDate = isoToUTC(data.startDate);
  const endDate = isoToUTC(data.endDate);

  if (endDate < startDate) throw new Error("End date must be on or after start date");

  await prisma.holiday.create({ data: { tenantId,
      startDate,
      endDate,
      label: data.label.trim() || "Holiday",
    },
  });

  revalidatePath("/scheduler");
}

export async function updateHoliday(id: number, data: { startDate: string; endDate: string; label: string }) {
  const tenantId = await getActiveTenantId();
  const startDate = isoToUTC(data.startDate);
  const endDate = isoToUTC(data.endDate);

  if (endDate < startDate) throw new Error("End date must be on or after start date");

  await prisma.holiday.update({
    where: { id },
    data: {
      startDate,
      endDate,
      label: data.label.trim() || "Holiday",
    },
  });

  revalidatePath("/scheduler");
}

export async function deleteHoliday(id: number) {
  const tenantId = await getActiveTenantId();
  await prisma.holiday.delete({ where: { id } });
  revalidatePath("/scheduler");
}
