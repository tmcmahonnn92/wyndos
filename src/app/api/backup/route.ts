import { NextResponse } from "next/server";
import { gzipSync } from "node:zlib";
import { requireOwner } from "@/lib/guards";
import { buildBackup } from "@/lib/backup";

export const runtime = "nodejs";

/** Download a full backup of this business (owner only). */
export async function GET() {
  let actor;
  try {
    actor = await requireOwner();
  } catch {
    return NextResponse.json({ error: "Only the owner can download backups." }, { status: 403 });
  }
  const backup = await buildBackup(actor.tenantId);
  const body = gzipSync(Buffer.from(JSON.stringify(backup)));
  const slug = backup.tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "business";
  const stamp = backup.createdAt.slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="wyndos-backup-${slug}-${stamp}.json.gz"`,
      "Cache-Control": "no-store",
    },
  });
}
