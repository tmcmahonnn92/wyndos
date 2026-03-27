import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Broadcast messaging is disabled during the current production-readiness pass." },
    { status: 503 }
  );
}
