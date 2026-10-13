/**
 * One Direct Debit paying for several customers, end to end against scripts/sim/gc-mock.cjs.
 * Run: node scripts/sim/gc-mock.cjs & then WYNDOS_SANDBOX=1 GOCARDLESS_API_BASE=http://127.0.0.1:4600 … tsx scripts/sim/shared-dd-check.ts
 */
import prisma from "@/lib/db";
import { createBusiness, setToday, settle, unwrapAll } from "./lib";

let fails = 0;
const check = (n: string, ok: boolean, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` (${d})` : ""}`); };
const r2 = (n: number) => Math.round(n * 100) / 100;
const mock = (path: string, body: unknown = {}) => fetch(`http://127.0.0.1:4600${path}`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());

async function main() {
  const act = unwrapAll(await import("@/lib/actions"));
  const gca = await import("@/lib/gocardless/actions");
  const core = await import("@/lib/gocardless/core");
  await mock("/_test/reset");
  setToday("2026-11-02");
  const { tenantId } = await createBusiness("shared-dd");
  await prisma.tenantSettings.update({ where: { tenantId }, data: { goCardlessAccessToken: "sandbox_test_token", goCardlessEnvironment: "sandbox" } });
  await act.bulkImportCustomers(["Payer", "House2", "House3", "Other"].map((n, i) => ({ name: n, address: `${i + 1} Shared Rd, Testford, ZZ99 1AA`, houseNameNumber: String(i + 1), street: "Shared Rd", town: "Testford", postcode: "ZZ99 1AA", price: 20, nextDueDate: "2026-11-02", frequencyWeeks: 4, areaName: "A", areaFrequencyWeeks: 4 })) as never, { createMissingAreas: true, bookRuns: true } as never);
  await settle();
  const [payer, h2, h3, other] = await Promise.all(["Payer", "House2", "House3", "Other"].map((n) => prisma.customer.findFirstOrThrow({ where: { tenantId, name: n } })));
  await mock("/_test/mandate", { id: "MDTEST1", status: "active", links: { customer: "CUTEST1" } });
  await mock("/_test/mandate", { id: "MDTEST9", status: "active", links: { customer: "CUTEST9" } });
  await prisma.customer.update({ where: { id: payer.id }, data: { goCardlessMandateId: "MDTEST1", goCardlessMandateStatus: "active", goCardlessCustomerId: "CUTEST1", goCardlessLinkedAt: new Date("2026-10-01") } });
  await prisma.customer.update({ where: { id: other.id }, data: { goCardlessMandateId: "MDTEST9", goCardlessMandateStatus: "active", goCardlessLinkedAt: new Date("2026-10-01") } });

  // Sharing rules.
  const s1 = await gca.shareDirectDebit(h2.id, payer.id);
  check("House2 uses Payer's Direct Debit", s1.ok && (await prisma.customer.findUniqueOrThrow({ where: { id: h2.id } })).goCardlessMandateId === "MDTEST1");
  check("…and is set to pay by Direct Debit", (await prisma.customer.findUniqueOrThrow({ where: { id: h2.id } })).preferredPaymentMethod === "DD");
  const s2 = await gca.shareDirectDebit(other.id, payer.id);
  check("a customer with their own Direct Debit is refused", !s2.ok && s2.error.includes("own Direct Debit"), s2.ok ? "" : s2.error);
  const s3 = await gca.shareDirectDebit(h3.id, h3.id);
  check("sharing with themselves is refused", !s3.ok);
  const s4 = await gca.shareDirectDebit(h3.id, h2.id); // House2 now has a working (shared) Direct Debit: allowed, same mandate
  check("sharing via another sharer works (same Direct Debit)", s4.ok && (await prisma.customer.findUniqueOrThrow({ where: { id: h3.id } })).goCardlessMandateId === "MDTEST1");
  const view = await gca.getDirectDebitSharing(payer.id);
  check("Payer shows it's shared with House2 and House3", view.sharedWith.map((c) => c.name).sort().join(",") === "House2,House3", view.sharedWith.map((c) => c.name).join(","));

  // Each clean collected separately, with the house on the payment.
  const jobOf = async (cid: number) => prisma.job.findFirstOrThrow({ where: { tenantId, customerId: cid, isQuote: false } });
  for (const c of [payer, h2, h3]) await act.completeJob((await jobOf(c.id)).id);
  const due = await core.cleansToCollect(tenantId);
  check("all three cleans are to collect", due.length === 3, String(due.length));
  const res = await core.collectForJobs(tenantId, due.map((j) => j.id));
  check("three collections made", res.collected.length === 3, JSON.stringify(res.skipped));
  const st = await (await fetch("http://127.0.0.1:4600/_test/state", { method: "POST" })).json() as { payments: Array<{ id: string; description: string; links: { mandate: string }; metadata: Record<string, string> }> };
  check("all on the shared Direct Debit", st.payments.every((p) => p.links.mandate === "MDTEST1"));
  check("each payment names its house", st.payments.some((p) => p.description.includes("2 Shared Rd")) && st.payments.some((p) => p.description.includes("3 Shared Rd")), st.payments.map((p) => p.description).join(" | "));

  // Money arrives: each clean paid on its own customer, no credit anywhere.
  for (const p of st.payments) await mock("/_test/status", { id: p.id, status: "paid_out" });
  await core.syncTenant(tenantId);
  const owed = async (cid: number) => { const js = await prisma.job.findMany({ where: { tenantId, customerId: cid, status: "COMPLETE" }, select: { price: true, allocations: { where: { payment: { voidedAt: null } }, select: { amount: true } } } }); return r2(js.reduce((s, j) => s + j.price - j.allocations.reduce((t, a) => t + a.amount, 0), 0)); };
  const credit = async (cid: number) => { const ps = await prisma.payment.findMany({ where: { tenantId, customerId: cid, voidedAt: null }, select: { amount: true, allocations: { select: { amount: true } } } }); return r2(ps.reduce((s, p) => s + p.amount - p.allocations.reduce((t, a) => t + a.amount, 0), 0)); };
  for (const c of [payer, h2, h3]) check(`${c.name}: paid, no credit`, (await owed(c.id)) === 0 && (await credit(c.id)) === 0, `${await owed(c.id)} / ${await credit(c.id)}`);
  check("each payment recorded on its own customer", (await prisma.payment.count({ where: { tenantId, customerId: h2.id } })) === 1 && (await prisma.payment.count({ where: { tenantId, customerId: h3.id } })) === 1);

  // A charge-back on House2's payment only affects House2.
  const h2pay = st.payments.find((p) => Number(p.metadata.wyndosCustomerId) === h2.id)!;
  await mock("/_test/status", { id: h2pay.id, status: "charged_back" });
  await core.syncTenant(tenantId);
  check("charge-back: House2 owes again", (await owed(h2.id)) === 20, String(await owed(h2.id)));
  check("charge-back: Payer and House3 unaffected", (await owed(payer.id)) === 0 && (await owed(h3.id)) === 0);

  // A payment taken in GoCardless itself (no Wyndos clean): pays the oldest unpaid cleans across the group.
  await mock("/_test/payment", { amount: 2000, status: "paid_out", charge_date: "2026-11-01", links: { mandate: "MDTEST1" } });
  await core.syncTenant(tenantId);
  check("outside payment pays House2's clean (it's shared)", (await owed(h2.id)) === 0, String(await owed(h2.id)));
  check("…without leaving credit on the payer", (await credit(payer.id)) === 0, String(await credit(payer.id)));
  const outside = await prisma.payment.findFirst({ where: { tenantId, notes: "Direct Debit (GoCardless)", allocations: { some: { job: { customerId: h2.id } } }, customerId: payer.id } });
  check("…and it's recorded on the payer (linked first)", Boolean(outside));

  // Mandate replaced (new bank): everyone sharing moves to the new one.
  await mock("/_test/mandate-status", { id: "MDTEST1", status: "cancelled" });
  await mock("/_test/mandate", { id: "MDTEST2", status: "active", links: { customer: "CUTEST1" } });
  await core.syncTenant(tenantId);
  const mands = await prisma.customer.findMany({ where: { id: { in: [payer.id, h2.id, h3.id] } }, select: { goCardlessMandateId: true } });
  check("replaced Direct Debit: all three move to the new one", mands.every((m) => m.goCardlessMandateId === "MDTEST2"), mands.map((m) => m.goCardlessMandateId).join(","));

  // Stop sharing: House3 stops; Payer and House2 carry on.
  const stop = await gca.stopUsingDirectDebit(h3.id);
  check("House3 stops using it", stop.ok && !(await prisma.customer.findUniqueOrThrow({ where: { id: h3.id } })).goCardlessMandateId);
  const view2 = await gca.getDirectDebitSharing(payer.id);
  check("Payer now shared with House2 only", view2.sharedWith.map((c) => c.name).join(",") === "House2");
  await act.completeJob((await prisma.job.create({ data: { tenantId, workDayId: (await jobOf(h3.id)).workDayId, customerId: h3.id, price: 10, name: "Extra", isOneOff: true } })).id);
  check("House3's new clean isn't collected by Direct Debit", !(await core.cleansToCollect(tenantId)).some((j) => j.customer.id === h3.id));

  await prisma.tenant.update({ where: { id: tenantId }, data: { name: "Sim shared-dd (done)" } });
  console.log(fails ? `${fails} failed` : "all passed");
}
main().then(() => process.exit(fails ? 1 : 0), (e) => { console.error(e); process.exit(1); });
