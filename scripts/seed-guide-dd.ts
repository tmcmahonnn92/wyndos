/**
 * Direct Debit extras for the guide demo business (run after scripts/seed-guide-demo.ts):
 * GoCardless switched on (sandbox token, made up), Paul Jones paying for himself and
 * Helen Roberts on one Direct Debit, Emma Clarke on her own, Mark Hughes not set up yet.
 * Mandate IDs are made up. Needs GOCARDLESS_API_BASE pointing at scripts/sim/gc-mock.cjs
 * if anything asks GoCardless.
 *
 *   DATABASE_URL=… npx tsx scripts/seed-guide-dd.ts
 */
import fs from "node:fs";
import prisma from "../src/lib/db";

const days = (n: number) => new Date(Date.now() - n * 86400000);

async function main() {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: "brightside-demo" } });
  const t = tenant.id;
  await prisma.tenant.update({ where: { id: t }, data: { trialFeatures: "gocardless" } });
  await prisma.tenantSettings.update({ where: { tenantId: t }, data: { goCardlessAccessToken: "sandbox_guide_demo", goCardlessEnvironment: "sandbox" } });
  const byName = async (name: string) => prisma.customer.findFirstOrThrow({ where: { tenantId: t, name } });
  const paul = await byName("Paul Jones");
  const helen = await byName("Helen Roberts");
  const emma = await byName("Emma Clarke");
  const mark = await byName("Mark Hughes");
  const dd = { preferredPaymentMethod: "DD", goCardlessMandateStatus: "active" };
  await prisma.customer.update({ where: { id: paul.id }, data: { ...dd, goCardlessMandateId: "MD000DEMO0001", goCardlessCustomerId: "CU000DEMO0001", goCardlessLinkedAt: days(60) } });
  await prisma.customer.update({ where: { id: helen.id }, data: { ...dd, goCardlessMandateId: "MD000DEMO0001", goCardlessCustomerId: "CU000DEMO0001", goCardlessLinkedAt: days(20) } });
  await prisma.customer.update({ where: { id: emma.id }, data: { ...dd, goCardlessMandateId: "MD000DEMO0002", goCardlessCustomerId: "CU000DEMO0002", goCardlessLinkedAt: days(40) } });
  await prisma.customer.update({ where: { id: mark.id }, data: { preferredPaymentMethod: "DD" } });
  // Their cleans today are waiting to be collected, not paid in cash.
  const jobs = await prisma.job.findMany({ where: { tenantId: t, customerId: { in: [paul.id, helen.id, emma.id] }, status: "COMPLETE" }, select: { id: true } });
  const ids = jobs.map((j) => j.id);
  const pays = await prisma.paymentAllocation.findMany({ where: { jobId: { in: ids } }, select: { paymentId: true } });
  await prisma.paymentAllocation.deleteMany({ where: { jobId: { in: ids } } });
  await prisma.payment.deleteMany({ where: { id: { in: pays.map((p) => p.paymentId) }, allocations: { none: {} } } });
  // Sarah Smith paid ahead: credit, for the "money buttons" screenshot.
  const sarah = await byName("Sarah Smith");
  await prisma.payment.create({ data: { tenantId: t, customerId: sarah.id, amount: 10, method: "CASH", paidAt: days(20), notes: "Paid ahead" } });
  const idsFile = ".tmp-test/guide-ids.json";
  const ids = fs.existsSync(idsFile) ? JSON.parse(fs.readFileSync(idsFile, "utf8")) : {};
  fs.writeFileSync(idsFile, JSON.stringify({ ...ids, helen: helen.id, sarah: sarah.id }));
  console.log("Direct Debit demo ready:", { paul: paul.id, helen: helen.id, emma: emma.id, mark: mark.id });
}

main().finally(() => prisma.$disconnect());
