import prisma from "@/lib/db";

/**
 * Whole-business backups the owner downloads and keeps. Restoring puts everything back
 * exactly as it was when the backup was made: customers, areas, the schedule, history,
 * payments, accounts, texts and settings. The team (logins) is left as it is.
 *
 * Rows keep their original ids, so a backup can only be restored into the business it
 * came from. Ids are never reused by the database, so nothing else can be holding them.
 */

export const BACKUP_FORMAT = "wyndos-backup";
export const BACKUP_VERSION = 1;

type Row = Record<string, unknown>;

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  tenantId: number;
  tenantName: string;
  counts: Record<string, number>;
  data: {
    tenant: Row;
    settings: Row | null;
    areas: Row[];
    tags: Row[];
    customers: Row[];
    customerTags: Row[];
    workDays: Row[];
    jobs: Row[];
    payments: Row[];
    paymentAllocations: Row[];
    expenses: Row[];
    otherIncome: Row[];
    holidays: Row[];
    messageLogs: Row[];
    /** Added Oct 2026; older backups don't have it. */
    cashHandovers?: Row[];
    /** Added Oct 2026 (bank statement matching); older backups don't have them. */
    payerReferences?: Row[];
    paymentImports?: Row[];
    importedLines?: Row[];
    /** Added Oct 2026 (Making Tax Digital accounts); older backups don't have them. */
    vehicles?: Row[];
    mileageTrips?: Row[];
    homeUseMonths?: Row[];
    businessAssets?: Row[];
    mtdQuarterLocks?: Row[];
    customerAliases?: Row[];
  };
};

export async function buildBackup(tenantId: number): Promise<BackupFile> {
  const where = { tenantId };
  const [tenant, settings, areas, tags, customers, customerTags, workDays, jobs, payments, paymentAllocations, expenses, otherIncome, holidays, messageLogs, cashHandovers, payerReferences, paymentImports, importedLines, vehicles, mileageTrips, homeUseMonths, businessAssets, mtdQuarterLocks, customerAliases] =
    await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      prisma.tenantSettings.findUnique({ where }),
      prisma.area.findMany({ where, orderBy: { id: "asc" } }),
      prisma.tag.findMany({ where, orderBy: { id: "asc" } }),
      prisma.customer.findMany({ where, orderBy: { id: "asc" } }),
      prisma.customerTag.findMany({ where: { customer: { tenantId } } }),
      prisma.workDay.findMany({ where, orderBy: { id: "asc" } }),
      prisma.job.findMany({ where, orderBy: { id: "asc" } }),
      prisma.payment.findMany({ where, orderBy: { id: "asc" } }),
      prisma.paymentAllocation.findMany({ where, orderBy: { id: "asc" } }),
      prisma.expense.findMany({ where, orderBy: { id: "asc" } }),
      prisma.otherIncome.findMany({ where, orderBy: { id: "asc" } }),
      prisma.holiday.findMany({ where, orderBy: { id: "asc" } }),
      prisma.messageLog.findMany({ where, orderBy: { id: "asc" } }),
      prisma.cashHandover.findMany({ where, orderBy: { id: "asc" } }),
      prisma.payerReference.findMany({ where, orderBy: { id: "asc" } }),
      prisma.paymentImport.findMany({ where, orderBy: { id: "asc" } }),
      prisma.importedLine.findMany({ where, orderBy: { id: "asc" } }),
      prisma.vehicle.findMany({ where, orderBy: { id: "asc" } }),
      prisma.mileageTrip.findMany({ where, orderBy: { id: "asc" } }),
      prisma.homeUseMonth.findMany({ where, orderBy: { id: "asc" } }),
      prisma.businessAsset.findMany({ where, orderBy: { id: "asc" } }),
      prisma.mtdQuarterLock.findMany({ where, orderBy: { id: "asc" } }),
      prisma.customerAlias.findMany({ where, orderBy: { id: "asc" } }),
    ]);
  const data = { tenant, settings, areas, tags, customers, customerTags, workDays, jobs, payments, paymentAllocations, expenses, otherIncome, holidays, messageLogs, cashHandovers, payerReferences, paymentImports, importedLines, vehicles, mileageTrips, homeUseMonths, businessAssets, mtdQuarterLocks, customerAliases };
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    tenantId,
    tenantName: tenant.name,
    counts: {
      customers: customers.length,
      areas: areas.filter((a) => !a.isSystemArea).length,
      workDays: workDays.length,
      jobs: jobs.length,
      payments: payments.length,
      expenses: expenses.length,
      otherIncome: otherIncome.length,
      texts: messageLogs.length,
    },
    // JSON turns Dates into ISO strings; restore turns them back.
    data: JSON.parse(JSON.stringify(data)),
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function revive(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === "string" && ISO.test(v) ? new Date(v) : v;
  return out;
}
const rows = (list: unknown) => (Array.isArray(list) ? (list as Row[]).map(revive) : []);

/** Checks a parsed file is a backup of this business. Returns a reason when it isn't. */
export function checkBackup(file: unknown, tenantId: number): string | null {
  const f = file as Partial<BackupFile> | null;
  if (!f || f.format !== BACKUP_FORMAT || !f.data) return "That isn't a Wyndos backup file.";
  if (typeof f.version !== "number" || f.version > BACKUP_VERSION) return "That backup was made by a newer version of Wyndos.";
  if (f.tenantId !== tenantId) return `That backup is of another business${f.tenantName ? ` (${f.tenantName})` : ""}. Switch to it first.`;
  return null;
}

/** Replace this business's data with the backup's. Runs in one transaction: all or nothing. */
export async function restoreBackup(tenantId: number, file: BackupFile) {
  const d = file.data;
  const areas = rows(d.areas);
  const tags = rows(d.tags);
  const customers = rows(d.customers);
  const customerTags = rows(d.customerTags);
  const workDays = rows(d.workDays);
  const jobs = rows(d.jobs);
  const payments = rows(d.payments);
  const allocations = rows(d.paymentAllocations);
  const expenses = rows(d.expenses);
  const otherIncome = rows(d.otherIncome);
  const holidays = rows(d.holidays);
  const messageLogs = rows(d.messageLogs);
  const cashHandovers = rows(d.cashHandovers ?? []);
  const payerReferences = rows(d.payerReferences ?? []);
  const paymentImports = rows(d.paymentImports ?? []);
  const importedLines = rows(d.importedLines ?? []);
  const vehicles = rows(d.vehicles ?? []);
  const mileageTrips = rows(d.mileageTrips ?? []);
  const homeUseMonths = rows(d.homeUseMonths ?? []);
  const businessAssets = rows(d.businessAssets ?? []);
  const mtdQuarterLocks = rows(d.mtdQuarterLocks ?? []);
  const customerAliases = rows(d.customerAliases ?? []);

  // Every row must belong to this business (defends against an edited file).
  for (const list of [areas, tags, customers, workDays, jobs, payments, allocations, expenses, otherIncome, holidays, messageLogs, cashHandovers, payerReferences, paymentImports, importedLines, vehicles, mileageTrips, homeUseMonths, businessAssets, mtdQuarterLocks, customerAliases]) {
    if (list.some((r) => r.tenantId !== tenantId)) throw new Error("The backup file has been changed and can't be used.");
  }

  // Every link must point at something in this same backup, so an edited file can't hook
  // rows up to another business's customers, days or payments.
  const bad = () => new Error("The backup file has been changed and can't be used.");
  const idsOf = (list: Row[]) => {
    const set = new Set<number>();
    for (const r of list) {
      if (!Number.isSafeInteger(r.id) || (r.id as number) < 1) throw bad();
      set.add(r.id as number);
    }
    return set;
  };
  const areaIds = idsOf(areas), tagIds = idsOf(tags), customerIds = idsOf(customers), workDayIds = idsOf(workDays);
  const jobIds = idsOf(jobs), paymentIds = idsOf(payments), handoverIds = idsOf(cashHandovers), importIds = idsOf(paymentImports);
  idsOf(allocations); idsOf(expenses); idsOf(otherIncome); idsOf(holidays); idsOf(messageLogs); idsOf(payerReferences); idsOf(importedLines);
  const vehicleIds = idsOf(vehicles);
  idsOf(mileageTrips); idsOf(homeUseMonths); idsOf(businessAssets); idsOf(mtdQuarterLocks); idsOf(customerAliases);
  const must = (v: unknown, set: Set<number>) => { if (typeof v !== "number" || !set.has(v)) throw bad(); };
  const mayBe = (v: unknown, set: Set<number>) => { if (v != null) must(v, set); };
  const orNull = (v: unknown, set: Set<number>) => (typeof v === "number" && set.has(v) ? v : null);
  for (const c of customers) { must(c.areaId, areaIds); c.paidByCustomerId = null; c.placeAfterCustomerId = orNull(c.placeAfterCustomerId, customerIds); }
  for (const ct of customerTags) { must(ct.customerId, customerIds); must(ct.tagId, tagIds); }
  for (const w of workDays) { mayBe(w.areaId, areaIds); w.partOfId = orNull(w.partOfId, workDayIds); }
  for (const j of jobs) {
    must(j.workDayId, workDayIds); must(j.customerId, customerIds);
    if (j.afterJobId !== 0 && j.afterJobId !== -1) j.afterJobId = orNull(j.afterJobId, jobIds);
  }
  for (const p of payments) { must(p.customerId, customerIds); mayBe(p.handoverId, handoverIds); }
  for (const a of allocations) { must(a.paymentId, paymentIds); must(a.jobId, jobIds); }
  for (const r of payerReferences) mayBe(r.customerId, customerIds);
  for (const l of importedLines) { must(l.importId, importIds); l.paymentId = orNull(l.paymentId, paymentIds); }
  for (const m of messageLogs) {
    m.customerId = orNull(m.customerId, customerIds);
    m.jobId = orNull(m.jobId, jobIds);
    m.workDayId = orNull(m.workDayId, workDayIds);
  }
  const expenseIds = new Set(expenses.map((e) => e.id as number));
  const incomeIds = new Set(otherIncome.map((e) => e.id as number));
  for (const e of expenses) { e.recurrenceTemplateId = orNull(e.recurrenceTemplateId, expenseIds); e.vehicleId = orNull(e.vehicleId, vehicleIds); }
  for (const t of mileageTrips) must(t.vehicleId, vehicleIds);
  for (const a of customerAliases) must(a.customerId, customerIds);
  for (const e of otherIncome) e.recurrenceTemplateId = orNull(e.recurrenceTemplateId, incomeIds);

  // Ids can only be ones this database has already handed out, so a file can't claim
  // ids that another business would be given later.
  const maxIds = await Promise.all([
    prisma.area.aggregate({ _max: { id: true } }), prisma.tag.aggregate({ _max: { id: true } }),
    prisma.customer.aggregate({ _max: { id: true } }), prisma.workDay.aggregate({ _max: { id: true } }),
    prisma.job.aggregate({ _max: { id: true } }), prisma.payment.aggregate({ _max: { id: true } }),
    prisma.paymentAllocation.aggregate({ _max: { id: true } }), prisma.expense.aggregate({ _max: { id: true } }),
    prisma.otherIncome.aggregate({ _max: { id: true } }), prisma.holiday.aggregate({ _max: { id: true } }),
    prisma.messageLog.aggregate({ _max: { id: true } }), prisma.cashHandover.aggregate({ _max: { id: true } }),
    prisma.payerReference.aggregate({ _max: { id: true } }), prisma.paymentImport.aggregate({ _max: { id: true } }),
    prisma.importedLine.aggregate({ _max: { id: true } }),
    prisma.vehicle.aggregate({ _max: { id: true } }), prisma.mileageTrip.aggregate({ _max: { id: true } }),
    prisma.homeUseMonth.aggregate({ _max: { id: true } }), prisma.businessAsset.aggregate({ _max: { id: true } }),
    prisma.mtdQuarterLock.aggregate({ _max: { id: true } }), prisma.customerAlias.aggregate({ _max: { id: true } }),
  ]);
  const lists = [areas, tags, customers, workDays, jobs, payments, allocations, expenses, otherIncome, holidays, messageLogs, cashHandovers, payerReferences, paymentImports, importedLines, vehicles, mileageTrips, homeUseMonths, businessAssets, mtdQuarterLocks, customerAliases];
  lists.forEach((list, i) => {
    const max = maxIds[i]._max.id ?? 0;
    if (list.some((r) => (r.id as number) > max)) throw bad();
  });

  // Logins: only people on this team (now, or named in its current records). Anyone else,
  // or someone who has since left, keeps their history but loses the link to the login.
  const [members, current] = await Promise.all([
    prisma.membership.findMany({ where: { tenantId }, select: { userId: true } }),
    Promise.all([
      prisma.workDay.findMany({ where: { tenantId, assignedUserId: { not: null } }, select: { assignedUserId: true }, distinct: ["assignedUserId"] }),
      prisma.job.findMany({ where: { tenantId, completedByUserId: { not: null } }, select: { completedByUserId: true }, distinct: ["completedByUserId"] }),
      prisma.cashHandover.findMany({ where: { tenantId }, select: { workerUserId: true, receivedByUserId: true } }),
    ]),
  ]);
  const userIds = new Set<string>(members.map((m) => m.userId));
  for (const w of current[0]) if (w.assignedUserId) userIds.add(w.assignedUserId);
  for (const j of current[1]) if (j.completedByUserId) userIds.add(j.completedByUserId);
  for (const h of current[2]) { userIds.add(h.workerUserId); userIds.add(h.receivedByUserId); }
  const stillExist = new Set((await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true } })).map((u) => u.id));
  const userOrNull = (v: unknown) => (typeof v === "string" && stillExist.has(v) ? v : null);
  for (const w of workDays) w.assignedUserId = userOrNull(w.assignedUserId);
  for (const j of jobs) {
    j.assignedUserId = userOrNull(j.assignedUserId);
    j.completedByUserId = userOrNull(j.completedByUserId);
  }
  for (const p of payments) p.collectedByUserId = userOrNull(p.collectedByUserId);
  for (const m of messageLogs) m.sentByUserId = userOrNull(m.sentByUserId);
  for (const i of paymentImports) i.createdByUserId = userOrNull(i.createdByUserId);
  for (const h of cashHandovers) {
    if (!stillExist.has(h.workerUserId as string) || !stillExist.has(h.receivedByUserId as string)) throw bad();
  }

  const where = { tenantId };
  await prisma.$transaction(async (tx) => {
    // Clear what's there now.
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
    await tx.customerAlias.deleteMany({ where });

    // Put the backup back, parents first, with the original ids.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    if (areas.length) await tx.area.createMany({ data: areas as any });
    if (tags.length) await tx.tag.createMany({ data: tags as any });
    if (customers.length) await tx.customer.createMany({ data: customers as any });
    if (customerTags.length) await tx.customerTag.createMany({ data: customerTags as any });
    if (customerAliases.length) await tx.customerAlias.createMany({ data: customerAliases as any });
    if (workDays.length) await tx.workDay.createMany({ data: workDays as any });
    if (jobs.length) await tx.job.createMany({ data: jobs as any });
    if (cashHandovers.length) await tx.cashHandover.createMany({ data: cashHandovers as any });
    if (payments.length) await tx.payment.createMany({ data: payments as any });
    if (allocations.length) await tx.paymentAllocation.createMany({ data: allocations as any });
    if (paymentImports.length) await tx.paymentImport.createMany({ data: paymentImports as any });
    if (importedLines.length) await tx.importedLine.createMany({ data: importedLines as any });
    if (payerReferences.length) await tx.payerReference.createMany({ data: payerReferences as any });
    if (vehicles.length) await tx.vehicle.createMany({ data: vehicles as any });
    if (mileageTrips.length) await tx.mileageTrip.createMany({ data: mileageTrips as any });
    if (homeUseMonths.length) await tx.homeUseMonth.createMany({ data: homeUseMonths as any });
    if (businessAssets.length) await tx.businessAsset.createMany({ data: businessAssets as any });
    if (mtdQuarterLocks.length) await tx.mtdQuarterLock.createMany({ data: mtdQuarterLocks as any });
    if (expenses.length) await tx.expense.createMany({ data: expenses as any });
    if (otherIncome.length) await tx.otherIncome.createMany({ data: otherIncome as any });
    if (holidays.length) await tx.holiday.createMany({ data: holidays as any });
    if (messageLogs.length) await tx.messageLog.createMany({ data: messageLogs as any });

    // Business details and settings as they were.
    const t = revive(d.tenant ?? {});
    await tx.tenant.update({
      where: { id: tenantId },
      data: { name: t.name as string, phone: t.phone as string, address: t.address as string, website: t.website as string, logoUrl: t.logoUrl as string },
    });
    if (d.settings) {
      const { id: _id, tenantId: _t, ...settings } = revive(d.settings);
      void _id; void _t;
      await tx.tenantSettings.upsert({ where, update: settings as any, create: { ...(settings as any), tenantId } });
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }, { timeout: 120_000, maxWait: 20_000 });
  // Ids came from this same database, so its id counters are already past them.
}

