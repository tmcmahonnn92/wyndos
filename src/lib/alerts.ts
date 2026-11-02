import "server-only";
import prisma from "@/lib/db";
import { appUrl, platformEmailConfigured, sendPlatformEmail, SUPPORT_COPY } from "@/lib/platform-email";

/**
 * Email Tom when something goes wrong on the server (a GoCardless sync failing, an email not
 * going out, an unhandled error). At most one email per key per hour; repeats in between are
 * counted and mentioned in the next one. Never throws.
 *
 * ALERT_EMAIL (env) changes who gets them; ALERT_EMAIL=off turns them off.
 */
const HOUR = 60 * 60_000;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function recipient() {
  const set = (process.env.ALERT_EMAIL ?? "").trim();
  if (set.toLowerCase() === "off") return "";
  return set || SUPPORT_COPY;
}

/** Claim the right to send for this key. Returns how many were held back since the last one, or null if not ours to send. */
async function claim(key: string, now: Date): Promise<number | null> {
  try {
    await prisma.platformAlert.create({ data: { key, sentAt: now } });
    return 0;
  } catch {
    const row = await prisma.platformAlert.findUnique({ where: { key } });
    if (!row) return null;
    if (row.sentAt.getTime() > now.getTime() - HOUR) {
      await prisma.platformAlert.update({ where: { key }, data: { suppressed: { increment: 1 } } }).catch(() => {});
      return null;
    }
    // Only one process wins the update (sentAt must still be the old value).
    const won = await prisma.platformAlert.updateMany({ where: { key, sentAt: row.sentAt }, data: { sentAt: now, suppressed: 0 } });
    return won.count ? row.suppressed : null;
  }
}

export function errorText(issue: unknown) {
  if (issue instanceof Error) return `${issue.message}${issue.stack ? `\n\n${issue.stack.split("\n").slice(1, 8).join("\n")}` : ""}`;
  return String(issue);
}

export async function alertAdmin(key: string, title: string, detail: string | unknown, context: Record<string, string | number | null | undefined> = {}) {
  try {
    const to = recipient();
    if (!to || !platformEmailConfigured()) return;
    const held = await claim(key.slice(0, 190), new Date());
    if (held === null) return;
    const body = typeof detail === "string" ? detail : errorText(detail);
    const rows = Object.entries(context).filter(([, v]) => v !== undefined && v !== null && v !== "");
    const extra = held ? `\n\n(${held} more like this in the last hour weren't emailed.)` : "";
    await sendPlatformEmail({
      to,
      subject: `Wyndos alert: ${title}`.slice(0, 150),
      text: `${title}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}${rows.length ? "\n\n" : ""}${body}${extra}\n\n${appUrl("/admin")}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">
<p><strong>${esc(title)}</strong></p>
${rows.length ? `<table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#64748b">${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join("")}</table>` : ""}
<pre style="white-space:pre-wrap;background:#f1f5f9;padding:10px;border-radius:6px;font-size:12px">${esc(body.slice(0, 4000))}</pre>
${held ? `<p style="color:#64748b">${held} more like this in the last hour weren't emailed.</p>` : ""}
<p><a href="${esc(appUrl("/admin"))}">Open Admin</a></p></div>`,
    });
  } catch (issue) {
    console.error("[alert] couldn't send", key, issue);
  }
}

/** Business name for an alert, without failing. */
export async function tenantLabel(tenantId: number) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }).catch(() => null);
  return t ? `${t.name} (#${tenantId})` : `#${tenantId}`;
}
