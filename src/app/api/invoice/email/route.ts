import { NextResponse } from "next/server";

export const runtime = "nodejs";
export async function POST() {
  return NextResponse.json(
    { error: "Invoice email delivery is disabled during the current production-readiness pass." },
    { status: 503 }
  );
}
