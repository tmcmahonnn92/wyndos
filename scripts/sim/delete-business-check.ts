/**
 * Deleting one business (admin console / owner's "Close business") must only touch that business:
 * people who also work for another business keep their login and that business.
 *   DATABASE_URL=... AUTH_SECRET=x TZ=UTC npx tsx --tsconfig scripts/sim/tsconfig.json scripts/sim/delete-business-check.ts
 */
import prisma from "@/lib/db";
import { createBusiness, setToday, settle, loginAs } from "./lib";
import { deleteBusinessData } from "@/lib/delete-business";

let failed = 0;
const check = (label: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : " " + extra}`); if (!ok) failed++; };

async function fill(tenantId: number, userId: string, tag: string) {
  const act = await import("@/lib/actions");
  loginAs(userId, tenantId);
  await act.bulkImportCustomers([1, 2, 3].map((i) => ({ name: `${tag}${i}`, address: `${i} ${tag} Rd, Testford, ZZ99 1AA`, price: 20, nextDueDate: "2026-10-16", frequencyWeeks: 4, areaName: tag, areaFrequencyWeeks: 4 })) as never, { createMissingAreas: true, bookRuns: true } as never);
  await settle();
  const job = await prisma.job.findFirstOrThrow({ where: { tenantId } });
  await act.completeJob(job.id);
  await act.recordPayment({ customerId: job.customerId, allocations: [{ jobId: job.id, amount: 20 }], method: "CASH" });
  await settle();
}
const counts = async (tenantId: number) => {
  const [c, j, p, a, w] = await Promise.all([
    prisma.customer.count({ where: { tenantId } }), prisma.job.count({ where: { tenantId } }), prisma.payment.count({ where: { tenantId } }),
    prisma.area.count({ where: { tenantId } }), prisma.workDay.count({ where: { tenantId } }),
  ]);
  return `${c}/${j}/${p}/${a}/${w}`;
};

async function main() {
  setToday("2026-10-13");
  const A = await createBusiness("del-a");
  const B = await createBusiness("del-b");
  await fill(A.tenantId, A.userId, "A");
  await fill(B.tenantId, B.userId, "B");
  const stamp = Date.now();
  const mk = (n: string, tenantId: number | null, role: "OWNER" | "WORKER" | "SUPER_ADMIN" = "WORKER") =>
    prisma.user.create({ data: { email: `${n}-${stamp}@sim.test`, name: n, role, tenantId, onboardingComplete: true } });
  const shared = await mk("shared-active-a", A.tenantId);      // works for both, currently in A
  const shared2 = await mk("shared-active-b", B.tenantId);     // works for both, currently in B
  const solo = await mk("solo-a", A.tenantId);                 // only works for A
  const ownerBoth = await mk("owner-a-worker-b", A.tenantId, "OWNER"); // owns A, works for B
  const admin = await mk("admin", null, "SUPER_ADMIN");        // super admin, member of A only
  for (const [u, t, r] of [[shared, A, "WORKER"], [shared, B, "WORKER"], [shared2, A, "WORKER"], [shared2, B, "WORKER"], [solo, A, "WORKER"], [ownerBoth, A, "OWNER"], [ownerBoth, B, "WORKER"], [admin, A, "OWNER"]] as const)
    await prisma.membership.create({ data: { userId: u.id, tenantId: t.tenantId, role: r } });
  // A worker of A assigned on B's work, to be sure B's links to them survive.
  await prisma.job.updateMany({ where: { tenantId: B.tenantId }, data: { assignedUserId: shared.id } });

  const beforeB = await counts(B.tenantId);
  const otherTenants = await prisma.tenant.count();
  await deleteBusinessData(A.tenantId);

  check("business A gone", !(await prisma.tenant.findUnique({ where: { id: A.tenantId } })));
  check("A's data gone", (await counts(A.tenantId)) === "0/0/0/0/0", await counts(A.tenantId));
  check("business B untouched", (await counts(B.tenantId)) === beforeB, `${beforeB} -> ${await counts(B.tenantId)}`);
  check("only one business removed", (await prisma.tenant.count()) === otherTenants - 1);
  const u = (id: string) => prisma.user.findUnique({ where: { id }, include: { memberships: true } });
  const s1 = await u(shared.id);
  check("shared worker (was in A) kept, now in B", !!s1 && s1.tenantId === B.tenantId && s1.memberships.length === 1 && s1.memberships[0].tenantId === B.tenantId, JSON.stringify(s1));
  const s2 = await u(shared2.id);
  check("shared worker (was in B) kept, still in B", !!s2 && s2.tenantId === B.tenantId && s2.memberships.length === 1, JSON.stringify(s2));
  const ob = await u(ownerBoth.id);
  check("owner of A who works for B kept, as a worker in B", !!ob && ob.tenantId === B.tenantId && ob.role === "WORKER", JSON.stringify(ob));
  check("worker only in A removed", !(await u(solo.id)));
  check("owner only in A removed", !(await u(A.userId)));
  const ad = await u(admin.id);
  check("super admin never removed", !!ad && ad.role === "SUPER_ADMIN" && ad.memberships.length === 0);
  check("B's jobs still assigned to the shared worker", (await prisma.job.count({ where: { tenantId: B.tenantId, assignedUserId: shared.id } })) > 0);
  check("B's owner untouched", !!(await u(B.userId)));

  // Tidy up.
  await deleteBusinessData(B.tenantId);
  await prisma.user.deleteMany({ where: { id: { in: [admin.id] } } });
  console.log(failed ? `${failed} FAILED` : "all passed");
  process.exit(failed ? 1 : 0);
}
main();
