import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

let build: string | null = null;

/** Which build this server is running. Open pages compare it to spot that an update went live. */
export async function GET() {
  if (build === null) {
    // The release the deploy script made (commit + build time); "dev" when run by hand.
    build = await readFile(join(process.cwd(), ".release-meta.json"), "utf8")
      .then((raw) => { const m = JSON.parse(raw); return `${String(m.commit ?? "").slice(0, 12)}-${String(m.builtAt ?? "")}`; })
      .catch(() => "dev");
  }
  return NextResponse.json({ build }, { headers: { "Cache-Control": "no-store" } });
}
