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
  };
};

export async function buildBackup(tenantId: number): Promise<BackupFile> {
  const where = { tenantId };
  const [tenant, settings, areas, tags, customers, customerTags, workDays, jobs, payments, paymentAllocations, expenses, otherIncome, holidays, messageLogs, cashHandovers, payerReferences, paymentImports, importedLines] =
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
    ]);
  const data = { tenant, settings, areas, tags, customers, customerTags, workDays, jobs, payments, paymentAllocations, expenses, otherIncome, holidays, messageLogs, cashHandovers, payerReferences, paymentImports, importedLines };
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

  // Every row must belong to this business (defends against an edited file).
  for (const list of [areas, tags, customers, workDays, jobs, payments, allocations, expenses, otherIncome, holidays, messageLogs, cashHandovers, payerReferences, paymentImports, importedLines]) {
    if (list.some((r) => r.tenantId !== tenantId)) throw new Error("The backup file has been changed and can't be used.");
  }

  // People who have since left the team: keep the history, drop the link to their login.
  const userIds = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));
  const userOrNull = (v: unknown) => (typeof v === "string" && userIds.has(v) ? v : null);
  for (const w of workDays) w.assignedUserId = userOrNull(w.assignedUserId);
  for (const j of jobs) {
    j.assignedUserId = userOrNull(j.assignedUserId);
    j.completedByUserId = userOrNull(j.completedByUserId);
  }
  const paidBy = customers.filter((c) => c.paidByCustomerId != null).map((c) => ({ id: c.id as number, paidByCustomerId: c.paidByCustomerId as number }));
  for (const c of customers) c.paidByCustomerId = null;

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

    // Put the backup back, parents first, with the original ids.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    if (areas.length) await tx.area.createMany({ data: areas as any });
    if (tags.length) await tx.tag.createMany({ data: tags as any });
    if (customers.length) await tx.customer.createMany({ data: customers as any });
    for (const p of paidBy) await tx.customer.update({ where: { id: p.id }, data: { paidByCustomerId: p.paidByCustomerId } });
    if (customerTags.length) await tx.customerTag.createMany({ data: customerTags as any });
    if (workDays.length) await tx.workDay.createMany({ data: workDays as any });
    if (jobs.length) await tx.job.createMany({ data: jobs as any });
    if (cashHandovers.length) await tx.cashHandover.createMany({ data: cashHandovers as any });
    if (payments.length) await tx.payment.createMany({ data: payments as any });
    if (allocations.length) await tx.paymentAllocation.createMany({ data: allocations as any });
    if (paymentImports.length) await tx.paymentImport.createMany({ data: paymentImports as any });
    if (importedLines.length) await tx.importedLine.createMany({ data: importedLines as any });
    if (payerReferences.length) await tx.payerReference.createMany({ data: payerReferences as any });
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

