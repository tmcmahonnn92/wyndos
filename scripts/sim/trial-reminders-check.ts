/**
 * Trial reminder emails: 3 days before and on the day the trial ends, once each, only to
 * businesses still on trial. Needs an SMTP sink on 127.0.0.1:2525 writing a log (path in MAIL_LOG).
 *   PLATFORM_SMTP_HOST=127.0.0.1 PLATFORM_SMTP_PORT=2525 PLATFORM_SMTP_USER=x PLATFORM_SMTP_PASS=y MAIL_LOG=… \
 *   DATABASE_URL=… AUTH_SECRET=x TZ=UTC npx tsx --tsconfig scripts/sim/tsconfig.json scripts/sim/trial-reminders-check.ts
 */
import fs from "node:fs";
import prisma from "@/lib/db";
import { createBusiness, setToday } from "./lib";
import { sendTrialReminders } from "@/lib/trial-reminders";

let failed = 0;
const check = (label: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : " " + extra}`); if (!ok) failed++; };
const mails = () => (fs.existsSync(process.env.MAIL_LOG!) ? fs.readFileSync(process.env.MAIL_LOG!, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { rcpt: string[]; subj: string }) : []);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  setToday("2026-11-10", 10);
  const mk = async (label: string, endsIso: string, extra: Record<string, unknown> = {}) => {
    const b = await createBusiness(label);
    await prisma.tenant.update({ where: { id: b.tenantId }, data: { billingExempt: false, trialEndsAt: new Date(`${endsIso}T12:00:00Z`), ...extra } });
    return { ...b, email: (await prisma.user.findUniqueOrThrow({ where: { id: b.userId } })).email };
  };
  const in3 = await mk("trial-in3", "2026-11-13");
  const today = await mk("trial-today", "2026-11-10");
  const in2 = await mk("trial-in2", "2026-11-12");
  const paid = await mk("trial-paid", "2026-11-13", { subscriptionStatus: "active" });
  const free = await mk("trial-free", "2026-11-10", { billingExempt: true });
  const before = mails().length;

  await Promise.all([sendTrialReminders(), sendTrialReminders(), sendTrialReminders()]);
  await wait(500);
  const got = mails().slice(before);
  const to = (e: string) => got.filter((m) => m.rcpt.some((r) => r.includes(e)));
  check("3 days before: one email", to(in3.email).length === 1 && to(in3.email)[0].subj.includes("3 days"), JSON.stringify(to(in3.email)));
  check("on the day: one email", to(today.email).length === 1 && to(today.email)[0].subj.includes("today"), JSON.stringify(to(today.email)));
  check("2 days before: nothing", to(in2.email).length === 0);
  check("subscribed: nothing", to(paid.email).length === 0);
  check("free forever: nothing", to(free.email).length === 0);

  await sendTrialReminders(); await wait(300);
  check("run again: no repeats", mails().length - before === got.length, String(mails().length - before));

  // Trial extended to a new date: the reminder comes again for that date.
  await prisma.tenant.update({ where: { id: in3.tenantId }, data: { trialEndsAt: new Date("2026-11-20T12:00:00Z") } });
  setToday("2026-11-17", 10);
  await sendTrialReminders(); await wait(300);
  check("extended trial: reminded again for the new date", to(in3.email).length === 1 && mails().slice(before).filter((m) => m.rcpt.some((r) => r.includes(in3.email))).length === 2);

  // Before 9am UK time: waits.
  setToday("2026-11-20", 6);
  const n = mails().length;
  await sendTrialReminders(); await wait(300);
  check("before 9am: not sent yet", mails().length === n);

  for (const b of [in3, today, in2, paid, free]) await prisma.tenant.delete({ where: { id: b.tenantId } }).catch(() => {});
  console.log(failed ? `${failed} FAILED` : "all passed");
  process.exit(failed ? 1 : 0);
}
main();
