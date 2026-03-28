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

export async function GET() {
  const release = await getReleaseMetadata();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      status: "ok",
      database: "ok",
      timestamp: new Date().toISOString(),
      release,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        database: "unavailable",
        timestamp: new Date().toISOString(),
        release,
        error: error instanceof Error ? error.message : "Unknown health-check error",
      },
      { status: 503 }
    );
  }
}