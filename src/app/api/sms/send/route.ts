import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "SMS delivery is disabled during the current production-readiness pass." },
    { status: 503 }
  );
}
