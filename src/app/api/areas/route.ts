import { NextResponse } from "next/server";
import { getAreas } from "@/lib/actions";

export async function GET() {
  try {
    const areas = await getAreas();
    return NextResponse.json(areas);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 }
    );
  }
}
