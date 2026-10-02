"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import prisma from "@/lib/db";
import { platformEmailConfigured, sendPlatformEmail, SUPPORT_TO } from "@/lib/platform-email";

/** Support sessions close themselves after this long (matches the cookie). */
const SESSION_HOURS = 2;

async function requireSuperAdminId() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SUPER_ADMIN") throw new Error("Super admins only.");
  return session.user.id;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Close support sessions left open past their time limit (the cookie has already gone). */
export async function closeStaleSupportSessions() {
  const adminId = await requireSuperAdminId();
  const cutoff = new Date(Date.now() - SESSION_HOURS * 60 * 60 * 1000);
  const stale = await prisma.supportAccessLog.findMany({ where: { endedAt: null, createdAt: { lt: cutoff } }, select: { id: true, createdAt: true } });
  for (const log of stale) {
    await prisma.supportAccessLog.update({
      where: { id: log.id },
      data: { endedAt: new Date(log.createdAt.getTime() + SESSION_HOURS * 60 * 60 * 1000), endedByUserId: adminId },
    });
  }
  return stale.length;
}

/** End one support session (or all open ones). The browser that opened it loses access too. */
export async function endSupportSessions(id?: number) {
  const adminId = await requireSuperAdminId();
  await prisma.supportAccessLog.updateMany({
    where: { endedAt: null, ...(id ? { id } : {}) },
    data: { endedAt: new Date(), endedByUserId: adminId },
  });
  revalidatePath("/admin");
}

/** Reply to a ticket by email from the support address, or add an internal note. */
export async function replyToTicket(input: { ticketId: number; body: string; note?: boolean; close?: boolean }) {
  const adminId = await requireSuperAdminId();
  const body = input.body.trim();
  if (!body) throw new Error("Write a reply first.");
  const ticket = await prisma.supportTicket.findUnique({ where: { id: input.ticketId } });
  if (!ticket) throw new Error("Ticket not found.");

  if (!input.note) {
    if (!ticket.fromEmail) throw new Error("This ticket has no email address to reply to.");
    if (!platformEmailConfigured()) throw new Error("Email isn't set up on the server (PLATFORM_SMTP_*).");
    const quoted = ticket.message.split("\n").map((line) => `> ${line}`).join("\n");
    const first = ticket.fromName.split(" ")[0] || "there";
    const mail = {
      to: ticket.fromEmail,
      cc: ticket.copyTo ? [ticket.copyTo] : undefined,
      replyTo: SUPPORT_TO,
      subject: `Re: [Support #${ticket.id}] ${ticket.subject}`,
      text: `${body}\n\nWyndos Support\n${SUPPORT_TO}\n\nOn ${ticket.createdAt.toLocaleDateString("en-GB")} you wrote:\n${quoted}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1e293b;line-height:1.5">
<p style="white-space:pre-wrap">${esc(body)}</p>
<p>Wyndos Support<br><a href="mailto:${esc(SUPPORT_TO)}">${esc(SUPPORT_TO)}</a></p>
<div style="margin-top:20px;padding-left:12px;border-left:3px solid #e2e8f0;color:#64748b;font-size:13px">
<p>On ${esc(ticket.createdAt.toLocaleDateString("en-GB"))} ${esc(first)} wrote:</p><p style="white-space:pre-wrap">${esc(ticket.message)}</p></div></div>`,
    };
    const supportFrom = (process.env.SUPPORT_FROM_EMAIL ?? SUPPORT_TO).trim();
    try {
      // From the support address itself; if the mail server won't allow that sender,
      // fall back to the normal Wyndos sender (replies still go to support).
      await sendPlatformEmail({ ...mail, from: `"Wyndos Support" <${supportFrom}>` });
    } catch (issue) {
      console.error("[support reply] send as support address failed, retrying", issue);
      await sendPlatformEmail(mail);
    }
  }

  await prisma.supportReply.create({ data: { ticketId: ticket.id, authorId: adminId, body, kind: input.note ? "NOTE" : "ADMIN" } });
  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: input.close ? { status: "CLOSED", closedAt: new Date() } : { updatedAt: new Date() },
  });
  revalidatePath("/admin");
}

export async function setTicketStatus(ticketId: number, status: "OPEN" | "CLOSED") {
  await requireSuperAdminId();
  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status, closedAt: status === "CLOSED" ? new Date() : null },
  });
  revalidatePath("/admin");
}
