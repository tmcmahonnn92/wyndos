/**
 * One GoCardless sync at a time across processes (DB lease), throttled admin alerts, no repeat
 * free trials, and "Collecting" for cleans whose Direct Debit is on its way.
 * Needs the SMTP sink on 127.0.0.1:2525 (MAIL_LOG) like trial-reminders-check.
 */
import fs from "node:fs";
import prisma from "@/lib/db";
import { createBusiness } from "./lib";
import { withSyncLease } from "@/lib/gocardless/core";
import { alertAdmin } from "@/lib/alerts";
import { emailHash, hadTrialBefore, normaliseEmail } from "@/lib/repeat-trial";
import { deleteBusinessData } from "@/lib/delete-business";
import { ddCollecting } from "@/lib/dd-status";

let failed = 0;
const check = (label: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : " " + extra}`); if (!ok) failed++; };
const mails = () => (fs.existsSync(process.env.MAIL_LOG!) ? fs.readFileSync(process.env.MAIL_LOG!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { rcpt: string[]; subj: string; body?: string }) : []);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  process.env.GC_SYNC_LEASE_POLL_MS = "50";
  const b = await createBusiness("lease");

  // --- Sync lease
  const log: string[] = [];
  const job = (name: string, ms: number) => withSyncLease(b.tenantId, async () => { log.push(`${name}+`); await wait(ms); log.push(`${name}-`); return name; });
  await Promise.all([job("A", 400), wait(30).then(() => job("B", 50))]);
  check("second sync waits for the first", log.join(",") === "A+,A-,B+,B-", log.join(","));
  const after = await prisma.tenantSettings.findUniqueOrThrow({ where: { tenantId: b.tenantId } });
  check("lease given back", after.goCardlessSyncLockUntil === null);
  await prisma.tenantSettings.update({ where: { tenantId: b.tenantId }, data: { goCardlessSyncLockUntil: new Date(Date.now() - 1000) } });
  const t0 = Date.now();
  await job("C", 10);
  check("a run-out lease (crashed process) is taken straight away", Date.now() - t0 < 300);
  await prisma.tenantSettings.update({ where: { tenantId: b.tenantId }, data: { goCardlessSyncLockUntil: new Date(Date.now() + 60_000) } });
  let threw = false;
  const t1 = Date.now();
  const p = job("D", 10).catch(() => { threw = true; });
  await wait(300);
  check("held lease: still waiting", log.at(-1) === "C-" && !threw);
  await prisma.tenantSettings.update({ where: { tenantId: b.tenantId }, data: { goCardlessSyncLockUntil: null } });
  await p;
  check("runs once the other finishes", log.at(-1) === "D-" && Date.now() - t1 >= 300);
  let failedWork = false;
  await withSyncLease(b.tenantId, async () => { throw new Error("boom"); }).catch(() => { failedWork = true; });
  check("lease given back after a failed sync", failedWork && (await prisma.tenantSettings.findUniqueOrThrow({ where: { tenantId: b.tenantId } })).goCardlessSyncLockUntil === null);

  // --- Alerts
  const key = `test-alert-${Date.now()}`;
  const before = mails().length;
  await Promise.all([alertAdmin(key, "Test failure", new Error("first")), alertAdmin(key, "Test failure", new Error("second"))]);
  await alertAdmin(key, "Test failure", new Error("third"));
  await wait(400);
  let got = mails().slice(before);
  check("same alert three times in an hour: one email", got.length === 1 && got[0].subj.includes("Wyndos alert: Test failure"), JSON.stringify(got.map((m) => m.subj)));
  check("sent to Tom", got[0]?.rcpt.some((r) => r.includes("tmcmahon.tom@gmail.com")) ?? false, JSON.stringify(got[0]?.rcpt));
  await alertAdmin(`${key}-other`, "Other failure", "detail");
  await wait(300);
  check("a different alert still goes", mails().slice(before).length === 2);
  await prisma.platformAlert.update({ where: { key }, data: { sentAt: new Date(Date.now() - 2 * 3600_000) } });
  await alertAdmin(key, "Test failure", new Error("fourth"));
  await wait(400);
  got = mails().slice(before);
  check("an hour later it sends again", got.length === 3);
  const row = await prisma.platformAlert.findUniqueOrThrow({ where: { key } });
  check("held-back count reset", row.suppressed === 0);
  await prisma.platformAlert.deleteMany({ where: { key: { startsWith: key } } });

  // --- Repeat free trials
  check("emails compared loosely", normaliseEmail(" J.Smith+wyndos@GoogleMail.com ") === "jsmith@gmail.com" && normaliseEmail("a.b+x@outlook.com") === "a.b@outlook.com");
  check("hash, not the address", !emailHash("someone@example.com").includes("someone") && emailHash("Someone@Example.com") === emailHash("someone@example.com"));
  const gone = await createBusiness("repeat-trial");
  const ownerEmail = (await prisma.user.findUniqueOrThrow({ where: { id: gone.userId } })).email;
  check("before deleting: no record", !(await hadTrialBefore(ownerEmail)));
  await deleteBusinessData(gone.tenantId);
  check("after deleting: signing up again gets no new trial", await hadTrialBefore(ownerEmail.toUpperCase()));
  check("nothing stored in plain text", !(await prisma.deletedAccount.findMany()).some((r) => r.emailHash.includes("@")));
  await prisma.deletedAccount.delete({ where: { emailHash: emailHash(ownerEmail) } });

  // --- Collecting
  check("DD on its way = collecting", ddCollecting({ goCardlessPaymentId: "PM1", goCardlessStatus: "submitted" }) && ddCollecting({ goCardlessPaymentId: "PM1", goCardlessStatus: "retrying" }));
  check("failed or none = owes", !ddCollecting({ goCardlessPaymentId: "PM1", goCardlessStatus: "failed" }) && !ddCollecting({ goCardlessPaymentId: null, goCardlessStatus: null }));

  const bEmail = (await prisma.user.findUniqueOrThrow({ where: { id: b.userId } })).email;
  await deleteBusinessData(b.tenantId).catch(() => undefined);
  await prisma.deletedAccount.deleteMany({ where: { emailHash: emailHash(bEmail) } });
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
