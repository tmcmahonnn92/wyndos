import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  void req;
  return NextResponse.json(
    { error: "Meta messaging verification is disabled during the VPS readiness pass." },
    { status: 503 }
  );
}
