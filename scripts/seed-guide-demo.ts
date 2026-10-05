/**
 * Demo business for the Getting started guide screenshots. Everything is made up:
 * a fictional town (Northbrook, "NB" postcodes, which don't exist), Ofcom's drama
 * phone numbers (07700 900xxx) and example.com emails.
 *
 *   DATABASE_URL=… npx tsx scripts/seed-guide-demo.ts
 *
 * Re-running wipes and rebuilds only the "brightside-demo" business.
 * Logins: owner sam@example.com / worker jamie@example.com, password GuideDemo123!
 */
import { hash } from "bcryptjs";
import prisma from "../src/lib/db";
import { TERMS_VERSION } from "../src/lib/legal";

const PASSWORD = "GuideDemo123!";
const SLUG = "brightside-demo";

/** Today's date as the server sees it (UTC), plus offset days. The screenshot scripts use UTC too. */
const day = (offset: number) => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset));
};
/** Monday of this week + offset days, so screenshots always show a tidy week. */
const mon = (offset: number) => {
  const t = day(0);
  return new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000 + offset * 86400000);
};

type AreaSpec = { name: string; color: string; weeks: number; streets: string[]; count: number };
const AREAS: AreaSpec[] = [
  { name: "Oakfield", color: "#3B82F6", weeks: 4, streets: ["Oak Lane", "Acorn Close", "Beech Grove"], count: 14 },
  { name: "Riverside", color: "#10B981", weeks: 4, streets: ["River View", "Mill Lane", "Weir Road"], count: 12 },
  { name: "Hillcrest", color: "#F59E0B", weeks: 8, streets: ["Hill Rise", "Summit Way"], count: 10 },
  { name: "Station Road", color: "#8B5CF6", weeks: 4, streets: ["Station Road", "Platform Close"], count: 11 },
  { name: "Meadow Park", color: "#14B8A6", weeks: 6, streets: ["Meadow Way", "Clover Drive"], count: 9 },
];

const FIRST = ["Sarah", "David", "Emma", "Paul", "Helen", "Mark", "Claire", "Steve", "Laura", "Ian", "Karen", "Tom", "Ruth", "Gary", "Jane", "Neil", "Amy", "Chris", "Lucy", "Rob"];
const LAST = ["Smith", "Jones", "Taylor", "Brown", "Wilson", "Evans", "Thomas", "Johnson", "Roberts", "Walker", "Wright", "Hall", "Green", "Wood", "Clarke", "Hughes", "Lewis", "Hill", "Cooper", "Ward"];
const NOTES = ["Gate code 1471", "Side gate, bolt at the top", "Dog in back garden, knock first", "Conservatory roof every other clean", "Leave a slip through the door", "Use the water-fed pole on the back"];

async function main() {
  const old = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (old) {
    const t = old.id;
    await prisma.messageLog.deleteMany({ where: { tenantId: t } });
    await prisma.paymentAllocation.deleteMany({ where: { tenantId: t } });
    await prisma.payment.deleteMany({ where: { tenantId: t } });
    await prisma.cashHandover.deleteMany({ where: { tenantId: t } }).catch(() => {});
    await prisma.job.deleteMany({ where: { tenantId: t } });
    await prisma.workDay.deleteMany({ where: { tenantId: t } });
    await prisma.customer.deleteMany({ where: { tenantId: t } });
    await prisma.area.deleteMany({ where: { tenantId: t } });
    await prisma.holiday.deleteMany({ where: { tenantId: t } });
    await prisma.membership.deleteMany({ where: { tenantId: t } });
    await prisma.user.updateMany({ where: { tenantId: t }, data: { tenantId: null } });
    await prisma.tenantSettings.deleteMany({ where: { tenantId: t } });
    await prisma.tenant.delete({ where: { id: t } });
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: "Brightside Window Cleaning",
      slug: SLUG,
      billingExempt: true,
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: new Date(),
      dataPermissionAcceptedAt: new Date(),
      settings: {
        create: {
          businessName: "Brightside Window Cleaning",
          ownerName: "Sam Taylor",
          phone: "07700 900123",
          email: "hello@example.com",
          address: "1 High Street, Northbrook, NB1 1AA",
          bankDetails: "Brightside Window Cleaning, sort code 00-00-00, account 12345678",
        },
      },
    },
  });
  const tenantId = tenant.id;

  const passwordHash = await hash(PASSWORD, 10);
  const upsertUser = async (email: string, name: string, role: "OWNER" | "WORKER") => {
    const u = await prisma.user.upsert({
      where: { email },
      update: { name, passwordHash, role, tenantId, onboardingComplete: true, emailVerified: new Date() },
      create: { email, name, passwordHash, role, tenantId, onboardingComplete: true, emailVerified: new Date() },
    });
    await prisma.membership.create({
      data: { userId: u.id, tenantId, role, permissions: role === "WORKER" ? JSON.stringify(["dashboard", "schedule", "viewprices", "payments"]) : "[]" },
    });
    return u;
  };
  const owner = await upsertUser("sam@example.com", "Sam Taylor", "OWNER");
  const worker = await upsertUser("jamie@example.com", "Jamie Brooks", "WORKER");

  // Areas and customers
  let n = 0;
  const areaIds: Record<string, number> = {};
  const customersByArea: Record<string, Array<{ id: number; price: number }>> = {};
  for (const [i, a] of AREAS.entries()) {
    const area = await prisma.area.create({ data: { tenantId, name: a.name, color: a.color, frequencyWeeks: a.weeks, sortOrder: i + 1 } });
    areaIds[a.name] = area.id;
    customersByArea[a.name] = [];
    for (let k = 0; k < a.count; k++) {
      const street = a.streets[k % a.streets.length];
      const house = String(2 + k * 2 + (k % 3));
      const first = FIRST[n % FIRST.length];
      const last = LAST[(n * 7 + Math.floor(n / LAST.length) * 3) % LAST.length];
      const postcode = `NB${(i % 3) + 1} ${(k % 9) + 1}${"ABDEFGHJ"[i % 8]}${"LNPQRSTU"[k % 8]}`;
      const price = [12, 14, 15, 16, 18, 20, 22, 25][(n * 3) % 8];
      const c = await prisma.customer.create({
        data: {
          tenantId,
          areaId: area.id,
          name: `${first} ${last}`,
          houseNameNumber: house,
          street,
          town: "Northbrook",
          postcode,
          address: `${house} ${street}, Northbrook, ${postcode}`,
          phone: `07700 900${String(100 + n).padStart(3, "0")}`,
          price,
          frequencyWeeks: a.weeks,
          sortOrder: k,
          notes: k % 5 === 1 ? NOTES[(n + i) % NOTES.length] : null,
          preferredPaymentMethod: ["CASH", "BACS", "CASH", "CARD"][n % 4],
        },
      });
      customersByArea[a.name].push({ id: c.id, price });
      n++;
    }
  }

  // Runs: last month's Station Road (done, some unpaid), this week's Oakfield (today, in progress),
  // Riverside tomorrow with Jamie, Hillcrest Thursday, Station Road next week. Meadow Park left to book.
  const makeRun = async (areaName: string, date: Date, opts: { status?: "PLANNED" | "IN_PROGRESS" | "COMPLETE"; worker?: string; done?: number; paid?: number } = {}) => {
    const wd = await prisma.workDay.create({
      data: { tenantId, areaId: areaIds[areaName], date, status: opts.status ?? "PLANNED", assignedUserId: opts.worker ?? null },
    });
    const list = customersByArea[areaName];
    for (const [k, c] of list.entries()) {
      const isDone = k < (opts.done ?? 0);
      const job = await prisma.job.create({
        data: {
          tenantId, workDayId: wd.id, customerId: c.id, price: c.price, sortOrder: k,
          status: isDone ? "COMPLETE" : opts.status === "COMPLETE" ? "SKIPPED" : "PENDING",
          completedAt: isDone ? new Date(date.getTime() + (9 + k * 0.3) * 3600000) : null,
          completedByUserId: isDone ? (opts.worker ?? owner.id) : null,
        },
      });
      if (isDone && k < (opts.paid ?? 0)) {
        await prisma.payment.create({
          data: {
            tenantId, customerId: c.id, amount: c.price, method: k % 3 === 0 ? "BACS" : "CASH",
            paidAt: job.completedAt ?? date, collectedByUserId: opts.worker ?? owner.id,
            allocations: { create: { tenantId, jobId: job.id, amount: c.price } },
          },
        });
      }
    }
    await prisma.customer.updateMany({
      where: { tenantId, id: { in: list.map((c) => c.id) } },
      data: opts.status === "COMPLETE"
        ? { lastCompletedDate: date, nextDueDate: new Date(date.getTime() + AREAS.find((a) => a.name === areaName)!.weeks * 7 * 86400000) }
        : { nextDueDate: date },
    });
    return wd;
  };

  const lastMonth = mon(-21);
  await makeRun("Station Road", lastMonth, { status: "COMPLETE", done: 11, paid: 7 });
  await prisma.area.update({ where: { id: areaIds["Station Road"] }, data: { lastCompletedDate: lastMonth, nextDueDate: mon(7) } });

  const oak = await makeRun("Oakfield", day(0), { status: "IN_PROGRESS", done: 5, paid: 3 });
  await prisma.area.update({ where: { id: areaIds["Oakfield"] }, data: { nextDueDate: day(0), lastCompletedDate: day(-28) } });
  const river = await makeRun("Riverside", day(1), { worker: worker.id });
  await prisma.area.update({ where: { id: areaIds["Riverside"] }, data: { nextDueDate: day(1), lastCompletedDate: day(-27) } });
  await makeRun("Hillcrest", day(3));
  await prisma.area.update({ where: { id: areaIds["Hillcrest"] }, data: { nextDueDate: day(3), lastCompletedDate: day(-53) } });
  await makeRun("Station Road", mon(7));
  await prisma.area.update({ where: { id: areaIds["Meadow Park"] }, data: { nextDueDate: day(5), lastCompletedDate: day(-37) } });
  await prisma.customer.updateMany({ where: { tenantId, areaId: areaIds["Meadow Park"] }, data: { nextDueDate: day(5), lastCompletedDate: day(-37) } });

  const fs = await import("node:fs");
  fs.mkdirSync(".tmp-test", { recursive: true });
  // A customer who still owes from last month's run, for the "customer at a glance" screenshot.
  const owing = await prisma.customer.findFirst({ where: { tenantId, areaId: areaIds["Station Road"], payments: { none: {} } }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  fs.writeFileSync(".tmp-test/guide-ids.json", JSON.stringify({ oakfield: oak.id, riverside: river.id, owingCustomer: owing?.id }));
  console.log(`Demo business ${tenantId} ready. Owner sam@example.com, worker jamie@example.com, password ${PASSWORD}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
