import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getActor } from "@/lib/guards";
import { platformEmailConfigured, sendPlatformEmail, SUPPORT_COPY, SUPPORT_TO } from "@/lib/platform-email";
import { SUPPORT_KINDS, SUPPORT_MAX_BYTES, SUPPORT_MAX_FILES, SUPPORT_SECTIONS } from "@/lib/support";


// A few messages an hour per person is plenty; stops a stuck button flooding the inbox.
const recent = new Map<string, number[]>();
function tooMany(key: string) {
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  if (list.length >= 8) return true;
  list.push(now);
  recent.set(key, list);
  return false;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clip = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);

export async function POST(request: Request) {
  let actor;
  try {
    actor = await getActor();
  } catch {
    return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
  }
  if (!platformEmailConfigured()) {
    return NextResponse.json({ ok: false, error: `Support email isn't set up yet. Please email ${SUPPORT_TO}.` }, { status: 503 });
  }
  if (tooMany(actor.userId)) {
    return NextResponse.json({ ok: false, error: "That's a lot of messages in an hour. Please try again later." }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "The files are too big. Keep them under 9 MB in total." }, { status: 413 });
  }

  const kind = (SUPPORT_KINDS as readonly string[]).includes(String(form.get("kind"))) ? String(form.get("kind")) : SUPPORT_KINDS[0];
  const section = (SUPPORT_SECTIONS as readonly string[]).includes(String(form.get("section"))) ? String(form.get("section")) : "";
  const subject = clip(form.get("subject"), 150);
  const message = clip(form.get("message"), 10000);
  const page = clip(form.get("page"), 300);
  // Optional extra address to copy replies to (e.g. the office), as well as their login email.
  const copyTo = clip(form.get("copyTo"), 200).toLowerCase();
  if (copyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(copyTo)) {
    return NextResponse.json({ ok: false, error: "That copy-to email address doesn't look right." }, { status: 400 });
  }
  const browser = clip(request.headers.get("user-agent"), 300);
  if (!subject || !message) return NextResponse.json({ ok: false, error: "Add a subject and a message." }, { status: 400 });

  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);
  if (files.length > SUPPORT_MAX_FILES) return NextResponse.json({ ok: false, error: `Up to ${SUPPORT_MAX_FILES} files.` }, { status: 400 });
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > SUPPORT_MAX_BYTES) return NextResponse.json({ ok: false, error: "The files are too big. Keep them under 9 MB in total." }, { status: 413 });
  const attachments = await Promise.all(files.map(async (f) => ({
    filename: f.name.replace(/[\r\n]/g, " ").slice(0, 120) || "file",
    content: Buffer.from(await f.arrayBuffer()),
    contentType: f.type || undefined,
  })));

  const [user, tenant] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } }),
    prisma.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true, id: true } }),
  ]);
  const who = user?.name || user?.email || "Unknown";
  const details: Array<[string, string]> = [
    ["From", `${who} <${user?.email ?? ""}>`],
    ["Business", `${tenant?.name ?? ""} (#${tenant?.id ?? actor.tenantId})`],
    ["Role", actor.role === "OWNER" ? "Owner" : actor.role === "WORKER" ? "Worker" : actor.role],
    ["Type", kind],
    ["Section", section || "Not chosen"],
    ["Page", page || "-"],
    ["Copy replies to", copyTo || "-"],
    ["Files", files.length ? files.map((f) => `${f.name} (${Math.ceil(f.size / 1024)} KB)`).join(", ") : "None"],
    ["Browser", browser || "-"],
  ];

  const text = `${message}\n\n---\n${details.map(([k, v]) => `${k}: ${v}`).join("\n")}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">
<p style="white-space:pre-wrap">${esc(message)}</p>
<table style="margin-top:16px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:13px;color:#475569">
${details.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;font-weight:bold;vertical-align:top">${k}</td><td>${esc(v)}</td></tr>`).join("")}
</table></div>`;

  try {
    await sendPlatformEmail({
      to: SUPPORT_TO,
      // Tom gets a hidden copy; the customer's own extra address is a visible copy.
      bcc: SUPPORT_COPY,
      cc: copyTo ? [copyTo] : undefined,
      replyTo: [user?.email ?? "", copyTo].filter(Boolean),
      subject: `[Support] ${section ? `${section}: ` : ""}${subject} (${tenant?.name ?? "Wyndos"})`,
      text,
      html,
      attachments,
    });
  } catch (err) {
    console.error("[support] send failed", err);
    return NextResponse.json({ ok: false, error: `It didn't send. Please try again, or email ${SUPPORT_TO}.` }, { status: 502 });
  }
  return NextResponse.json({ ok: true, replyTo: [user?.email, copyTo].filter(Boolean).join(" and ") });
}
