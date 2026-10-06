import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

type ReleaseMetadata = {
  commit: string | null;
  builtAt: string | null;
};

async function getReleaseMetadata(): Promise<ReleaseMetadata> {
  try {
    const filePath = join(process.cwd(), ".release-meta.json");
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ReleaseMetadata>;

    return {
      commit: typeof parsed.commit === "string" ? parsed.commit : null,
      builtAt: typeof parsed.builtAt === "string" ? parsed.builtAt : null,
    };
  } catch {
    return {
      commit: null,
      builtAt: null,
    };
  }
}

export async function GET(request: Request) {
  // Build details only for checks run on the server itself (the deploy script), not the public.
  const host = (request.headers.get("host") ?? "").split(":")[0];
  const local = host === "127.0.0.1" || host === "localhost";
  const release = local ? await getReleaseMetadata() : undefined;

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      status: "ok",
      database: "ok",
      timestamp: new Date().toISOString(),
      release,
    });
  } catch (error) {
    console.error("[health]", error);
    return NextResponse.json(
      {
        status: "error",
        database: "unavailable",
        timestamp: new Date().toISOString(),
        release,
      },
      { status: 503 }
    );
  }
}