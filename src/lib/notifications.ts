import prisma from "@/lib/db";
import { parsePermissions } from "@/lib/permissions";
import { appUrl, platformEmailConfigured, sendPlatformEmail } from "@/lib/platform-email";

/**
 * Email notifications: a day started or completed, or work given to someone.
 *
 * Nothing is sent straight away. Each event waits DELAY_MS, then the situation is
 * checked again before anything goes out: a day started and undone, or a job given to
 * someone and taken back, sends nothing. Several things in that minute are rolled into
 * one email (e.g. "5 jobs given to you").
 */

export const NOTIFY_DELAY_MS = 60_000;

export type NotifyKind = "DAY_STARTED" | "DAY_COMPLETED" | "WORK_ASSIGNED";
export type NotifyPrefs = { dayStarted: boolean; dayCompleted: boolean; workAssigned: boolean };

/** Someone's choices, with sensible defaults: owners hear when days finish; everyone hears about work given to them. */
export function notifyPrefsOf(raw: string | null | undefined, role: string): NotifyPrefs {
  let saved: Partial<NotifyPrefs> = {};
  try { saved = JSON.parse(raw || "{}"); } catch { saved = {}; }
  const owner = role === "OWNER";
  return {
    dayStarted: saved.dayStarted ?? false,
    dayCompleted: saved.dayCompleted ?? owner,
    workAssigned: saved.workAssigned ?? true,
  };
}

/** People who hear about days (not just their own work): owner and anyone who plans the diary. */
function followsDays(role: string, permissions: string) {
  return role === "OWNER" || parsePermissions(permissions).includes("scheduler");
}

// ── Queueing ─────────────────────────────────────────────────────────────────

export async function queueNotification(input: {
  tenantId: number;
  kind: NotifyKind;
  workDayId?: number | null;
  userId?: string | null;
  jobIds?: number[];
  actorUserId?: string | null;
}) {
  try {
    const dueAt = new Date(Date.now() + NOTIFY_DELAY_MS);
    // Fold into a waiting event for the same thing, pushing its time back a minute.
    const waiting = await prisma.notificationEvent.findFirst({
      where: {
        tenantId: input.tenantId,
        kind: input.kind,
        workDayId: input.workDayId ?? null,
        userId: input.userId ?? null,
        sentAt: null,
        skipped: null,
      },
    });
    if (waiting) {
      const jobIds = [...new Set([...(JSON.parse(waiting.jobIds || "[]") as number[]), ...(input.jobIds ?? [])])];
      await prisma.notificationEvent.update({ where: { id: waiting.id }, data: { dueAt, jobIds: JSON.stringify(jobIds), actorUserId: input.actorUserId ?? waiting.actorUserId } });
    } else {
      await prisma.notificationEvent.create({
        data: {
          tenantId: input.tenantId,
          kind: input.kind,
          workDayId: input.workDayId ?? null,
          userId: input.userId ?? null,
          jobIds: JSON.stringify(input.jobIds ?? []),
          actorUserId: input.actorUserId ?? null,
          dueAt,
        },
      });
    }
    scheduleNotificationRun(NOTIFY_DELAY_MS + 5_000);
  } catch (issue) {
    // Notifications must never break the action that triggered them.
    console.error("[notify] could not queue", issue);
  }
}

const g = globalThis as unknown as { __wyndosNotifyTimer?: ReturnType<typeof setTimeout> | null };

/** Run the queue after a delay (one timer at a time). The cron route runs it too, as a backstop. */
export function scheduleNotificationRun(ms: number) {
  if (g.__wyndosNotifyTimer) return;
  g.__wyndosNotifyTimer = setTimeout(async () => {
    g.__wyndosNotifyTimer = null;
    try {
      await processDueNotifications();
      // Anything queued while we waited: come back when the next one is due.
      const next = await prisma.notificationEvent.findFirst({
        where: { sentAt: null, skipped: null },
        orderBy: { dueAt: "asc" },
        select: { dueAt: true },
      });
      if (next) scheduleNotificationRun(Math.max(1_000, next.dueAt.getTime() - Date.now() + 1_000));
    } catch (issue) {
      console.error("[notify] run failed", issue);
    }
  }, ms);
}

// ── Sending ──────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const nameOf = (u: { name: string | null; email: string } | null | undefined) => u?.name?.trim() || u?.email?.split("@")[0] || "Someone";
const dayLabel = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function wrap(title: string, lines: string[], link: string, button: string) {
  const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
<h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>
${lines.map((l) => `<p style="margin:0 0 8px;color:#475569">${esc(l)}</p>`).join("\n")}
<a href="${link}" style="display:inline-block;margin-top:12px;background:#2563EB;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:600;font-size:14px">${esc(button)}</a>
<p style="margin:24px 0 0;color:#94a3b8;font-size:12px">Change which emails you get in Wyndos under My account.</p></div>`;
  const text = `${title}\n\n${lines.join("\n")}\n\n${button}: ${link}\n\nChange which emails you get in Wyndos under My account.`;
  return { html, text };
}

/** Send whatever is due. Safe to call often. */
export async function processDueNotifications() {
  const due = await prisma.notificationEvent.findMany({
    where: { sentAt: null, skipped: null, dueAt: { lte: new Date() } },
    orderBy: { dueAt: "asc" },
    take: 100,
  });
  if (due.length === 0) return { sent: 0, skipped: 0 };
  if (!platformEmailConfigured()) {
    await prisma.notificationEvent.updateMany({ where: { id: { in: due.map((e) => e.id) } }, data: { skipped: "email not set up" } });
    return { sent: 0, skipped: due.length };
  }

  let sent = 0;
  let skipped = 0;
  const done = async (ids: number[], reason: string | null) => {
    await prisma.notificationEvent.updateMany({ where: { id: { in: ids } }, data: reason ? { skipped: reason } : { sentAt: new Date() } });
    if (reason) skipped += ids.length; else sent += 1;
  };

  // Day events: roll up by business + kind + person + date ("Jake started Cuckney and Edwinstowe").
  const dayEvents = due.filter((e) => e.kind !== "WORK_ASSIGNED" && e.workDayId);
  const groups = new Map<string, typeof dayEvents>();
  for (const e of dayEvents) {
    const key = `${e.tenantId}|${e.kind}|${e.actorUserId ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const events of groups.values()) {
    const { tenantId, kind, actorUserId } = events[0];
    const days = await prisma.workDay.findMany({
      where: { tenantId, id: { in: events.map((e) => e.workDayId!) } },
      include: { area: { select: { name: true } }, jobs: { select: { status: true, price: true } }, assignedUser: { select: { name: true, email: true } } },
    });
    // Still true a minute later? (Undone starts / reopened days drop out.)
    const stillTrue = days.filter((d) => (kind === "DAY_COMPLETED" ? d.status === "COMPLETE" : d.status === "IN_PROGRESS" || d.status === "COMPLETE"));
    if (stillTrue.length === 0) { await done(events.map((e) => e.id), "no longer true"); continue; }

    const members = await prisma.membership.findMany({
      where: { tenantId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    const actor = members.find((m) => m.userId === actorUserId)?.user ?? stillTrue[0].assignedUser ?? null;
    const recipients = members.filter((m) => {
      if (m.userId === actorUserId || !m.user.email) return false;
      if (!followsDays(m.role, m.permissions)) return false;
      const prefs = notifyPrefsOf(m.notifyPrefs, m.role);
      return kind === "DAY_COMPLETED" ? prefs.dayCompleted : prefs.dayStarted;
    });
    if (recipients.length === 0) { await done(events.map((e) => e.id), "nobody wants it"); continue; }

    const names = stillTrue.map((d) => d.area?.name ?? "One-off jobs").join(", ");
    const date = dayLabel(stillTrue[0].date);
    const jobs = stillTrue.flatMap((d) => d.jobs);
    const doneJobs = jobs.filter((j) => j.status === "COMPLETE");
    const value = doneJobs.reduce((s, j) => s + j.price, 0);
    const link = appUrl(`/days/date/${stillTrue[0].date.toISOString().slice(0, 10)}`);
    const who = nameOf(actor);
    const mail = kind === "DAY_COMPLETED"
      ? {
          subject: `${who} finished ${names} (${date})`,
          ...wrap(`${who} finished ${names}`, [
            `${date}: ${doneJobs.length} of ${jobs.length} done, £${value.toFixed(2)} cleaned.`,
            jobs.length > doneJobs.length ? `${jobs.length - doneJobs.length} not done (carried over or skipped).` : "Everything was done.",
          ], link, "See the day"),
        }
      : {
          subject: `${who} started ${names} (${date})`,
          ...wrap(`${who} has started ${names}`, [`${date}: ${jobs.length} job${jobs.length === 1 ? "" : "s"} on the list.`], link, "See the day"),
        };
    try {
      for (const r of recipients) await sendPlatformEmail({ to: r.user.email, ...mail });
      await done(events.map((e) => e.id), null);
    } catch (issue) {
      console.error("[notify] send failed", issue);
      await done(events.map((e) => e.id), "send failed");
    }
  }

  // Work given to someone: one email per person, listing what's still theirs.
  const assigned = due.filter((e) => e.kind === "WORK_ASSIGNED" && e.userId);
  const byUser = new Map<string, typeof assigned>();
  for (const e of assigned) {
    const key = `${e.tenantId}|${e.userId}`;
    byUser.set(key, [...(byUser.get(key) ?? []), e]);
  }
  for (const events of byUser.values()) {
    const { tenantId, userId } = events[0];
    const member = await prisma.membership.findFirst({ where: { tenantId, userId: userId! }, include: { user: true } });
    const actorId = events[events.length - 1].actorUserId;
    if (!member?.user.email || !notifyPrefsOf(member.notifyPrefs, member.role).workAssigned || actorId === userId) {
      await done(events.map((e) => e.id), "nobody wants it");
      continue;
    }
    const jobIds = [...new Set(events.flatMap((e) => JSON.parse(e.jobIds || "[]") as number[]))];
    const dayIds = [...new Set(events.map((e) => e.workDayId).filter((id): id is number => !!id))];
    // Still theirs a minute later: given to them directly, or on a day that's theirs.
    const jobs = await prisma.job.findMany({
      where: {
        tenantId,
        status: "PENDING",
        OR: [
          ...(jobIds.length ? [{ id: { in: jobIds } }] : []),
          ...(dayIds.length ? [{ workDayId: { in: dayIds } }] : []),
        ],
      },
      include: { workDay: { include: { area: { select: { name: true } } } } },
    });
    const theirs = jobs.filter((j) => j.assignedUserId === userId || (!j.assignedUserId && j.workDay.assignedUserId === userId));
    if (theirs.length === 0) { await done(events.map((e) => e.id), "no longer theirs"); continue; }

    const byDate = new Map<string, { date: Date; areas: Set<string>; count: number }>();
    for (const j of theirs) {
      const key = j.workDay.date.toISOString().slice(0, 10);
      const entry = byDate.get(key) ?? { date: j.workDay.date, areas: new Set<string>(), count: 0 };
      entry.areas.add(j.workDay.area?.name ?? "One-off");
      entry.count += 1;
      byDate.set(key, entry);
    }
    const lines = [...byDate.values()]
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((d) => `${dayLabel(d.date)}: ${d.count} job${d.count === 1 ? "" : "s"} in ${[...d.areas].join(", ")}`);
    const actorName = actorId
      ? nameOf((await prisma.user.findUnique({ where: { id: actorId }, select: { name: true, email: true } })) ?? null)
      : "Your boss";
    const first = [...byDate.keys()].sort()[0];
    const mail = {
      subject: `${actorName} gave you ${theirs.length} job${theirs.length === 1 ? "" : "s"}`,
      ...wrap(`New work for you`, [`${actorName} has given you:`, ...lines], appUrl(`/days/date/${first}`), "Open your day"),
    };
    try {
      await sendPlatformEmail({ to: member.user.email, ...mail });
      await done(events.map((e) => e.id), null);
    } catch (issue) {
      console.error("[notify] send failed", issue);
      await done(events.map((e) => e.id), "send failed");
    }
  }

  return { sent, skipped };
}
