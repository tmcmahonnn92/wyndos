import "server-only";
import prisma from "@/lib/db";
import { trialEndOf } from "@/lib/billing";
import { priceLabelFor } from "@/lib/pricing";
import { appUrl, platformEmailConfigured, sendPlatformEmail, SUPPORT_TO } from "@/lib/platform-email";

/**
 * Trial reminders from Tom: 3 days before a business's free trial ends, and on the day it ends.
 * "I'm here if you need a hand" (WhatsApp, reply, free import), plus how to keep going.
 *
 * Runs every hour (instrumentation.ts) and from /api/cron/notifications. Sent once per business
 * per trial end date (an extended trial gets them again for the new date), after 9am UK time.
 * Several app processes can run it at once: each claims with a marker row and only the first sends.
 */

const WHATSAPP = (process.env.SUPPORT_WHATSAPP ?? "447947939782").replace(/\D/g, "");
const PAID = new Set(["active", "trialing"]);
const ukDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" }); // YYYY-MM-DD
const ukHour = (d: Date) => Number(d.toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

type Kind = "TRIAL_3_DAYS" | "TRIAL_LAST_DAY";

function trialEmail(kind: Kind, d: { first: string; endsOn: string; price: string }) {
  const wa = WHATSAPP ? `https://wa.me/${WHATSAPP}` : "";
  const waShown = WHATSAPP.startsWith("44") ? `0${WHATSAPP.slice(2, 6)} ${WHATSAPP.slice(6)}` : `+${WHATSAPP}`;
  const billing = appUrl("/billing");
  const subject = kind === "TRIAL_3_DAYS" ? "Your Wyndos trial ends in 3 days" : "Your Wyndos trial ends today";
  const opening = kind === "TRIAL_3_DAYS"
    ? `Just a heads-up: your free trial ends on ${d.endsOn}.`
    : `Your free trial ends today.`;
  const help = "If anything's not working how you'd like, or you haven't had time to get your round in, I'm here to help. I can import your customers for you from a spreadsheet, an export from your old app or photos of your round book.";
  const keep = `To keep using Wyndos, subscribe for ${d.price} a month (workers included, cancel any time). Your round and everything you've added stay safe either way.`;
  const btn = (bg: string) => `display:inline-block;background:${bg};color:#ffffff;font-weight:bold;text-decoration:none;padding:10px 18px;border-radius:8px;margin:0 8px 8px 0`;
  return {
    subject,
    text: [
      `Hi ${d.first},`, opening, help,
      wa ? `WhatsApp me on ${waShown} (${wa}), or just reply to this email.` : "Just reply to this email.",
      keep, `Subscribe: ${billing}`, "Tom\nWyndos",
    ].join("\n\n"),
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1e293b;line-height:1.5;max-width:560px">
<p>Hi ${esc(d.first)},</p>
<p>${esc(opening)}</p>
<p>${esc(help)}</p>
<p>${wa ? `<a href="${esc(wa)}" style="${btn("#25D366")}">WhatsApp me: ${esc(waShown)}</a>` : ""}<br>Or just reply to this email.</p>
<p>${esc(keep)}</p>
<p><a href="${esc(billing)}" style="${btn("#2563eb")}">Subscribe</a></p>
<p>Tom<br>Wyndos</p></div>`,
  };
}

export async function sendTrialReminders(now = new Date()) {
  if (!platformEmailConfigured() || ukHour(now) < 9) return { sent: 0 };
  const today = ukDate(now);
  const tenants = await prisma.tenant.findMany({
    where: { billingExempt: false, createdAt: { gte: new Date(now.getTime() - 120 * 86_400_000) } },
    select: { id: true, createdAt: true, trialEndsAt: true, subscriptionStatus: true },
  });
  let sent = 0;
  for (const t of tenants) {
    if (PAID.has(t.subscriptionStatus)) continue;
    const end = trialEndOf(t);
    const endDay = ukDate(end);
    const left = daysBetween(today, endDay);
    const kind: Kind | null = left === 3 ? "TRIAL_3_DAYS" : left === 0 ? "TRIAL_LAST_DAY" : null;
    if (!kind) continue;
    const marker = `${kind}:${endDay}`;
    if (await prisma.notificationEvent.count({ where: { tenantId: t.id, kind: marker } })) continue;
    // Claim it: only the first marker row for this business and date sends.
    const mine = await prisma.notificationEvent.create({ data: { tenantId: t.id, kind: marker, dueAt: now, sentAt: now } });
    const first = await prisma.notificationEvent.findFirst({ where: { tenantId: t.id, kind: marker }, orderBy: { id: "asc" }, select: { id: true } });
    if (first?.id !== mine.id) { await prisma.notificationEvent.delete({ where: { id: mine.id } }).catch(() => {}); continue; }
    const owners = await prisma.membership.findMany({ where: { tenantId: t.id, role: "OWNER", user: { role: { not: "SUPER_ADMIN" } } }, select: { user: { select: { email: true, name: true } } } });
    const to = owners.map((o) => o.user).filter((u) => u.email);
    if (!to.length) continue;
    try {
      for (const u of to) {
        const mail = trialEmail(kind, {
          first: (u.name ?? "").trim().split(/\s+/)[0] || "there",
          endsOn: end.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" }),
          price: priceLabelFor(t.createdAt),
        });
        await sendPlatformEmail({ to: u.email!, replyTo: SUPPORT_TO, ...mail });
      }
      sent++;
    } catch (issue) {
      // Not sent: take the marker away so the next run tries again.
      console.error("[trial reminders]", t.id, issue);
      const { alertAdmin } = await import("@/lib/alerts");
      await alertAdmin("email:trial", "Trial reminder email didn't send", issue, { Business: `#${t.id}` });
      await prisma.notificationEvent.delete({ where: { id: mine.id } }).catch(() => {});
    }
  }
  return { sent };
}
