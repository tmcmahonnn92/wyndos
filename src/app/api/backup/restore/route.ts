import { NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/guards";
import { checkBackup, restoreBackup, type BackupFile } from "@/lib/backup";

export const runtime = "nodejs";

/** Restore a backup file over this business's data (owner only, typed confirmation). */
export async function POST(request: Request) {
  let actor;
  try {
    actor = await requireOwner();
  } catch {
    return NextResponse.json({ ok: false, error: "Only the owner can restore a backup." }, { status: 403 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "The file is too big to upload (10 MB max)." }, { status: 413 });
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ ok: false, error: "Choose a backup file." }, { status: 400 });

  let parsed: unknown;
  try {
    const raw = Buffer.from(await (file as File).arrayBuffer());
    const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "That file can't be read. Choose a Wyndos backup (.json.gz)." }, { status: 400 });
  }
  const problem = checkBackup(parsed, actor.tenantId);
  if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });

  // Preview only: say what's in it without changing anything.
  const backup = parsed as BackupFile;
  if (form.get("preview") === "1") {
    return NextResponse.json({ ok: true, preview: { createdAt: backup.createdAt, tenantName: backup.tenantName, counts: backup.counts } });
  }
  if (String(form.get("confirm") ?? "").trim().toUpperCase() !== "RESTORE") {
    return NextResponse.json({ ok: false, error: "Type RESTORE to confirm." }, { status: 400 });
  }

  try {
    await restoreBackup(actor.tenantId, backup);
  } catch (e) {
    console.error("[backup/restore]", e);
    return NextResponse.json({ ok: false, error: "Restore failed, so nothing was changed. Please contact support." }, { status: 500 });
  }
  for (const path of ["/", "/days", "/scheduler", "/customers", "/areas", "/payments", "/accounting", "/messages", "/settings"]) revalidatePath(path);
  return NextResponse.json({ ok: true, restored: { createdAt: backup.createdAt, counts: backup.counts } });
}
