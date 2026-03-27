import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("q");
  if (!address) return NextResponse.json(null);

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=gb`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "window-cleaning-scheduler/1.0 (contact@example.com)",
        "Accept-Language": "en",
      },
      next: { revalidate: 86400 }, // cache geocode results for 24h
    });
    if (!r.ok) return NextResponse.json(null);
    const data = await r.json();
    if (!data.length) return NextResponse.json(null);
    return NextResponse.json({ lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) });
  } catch {
    return NextResponse.json(null);
  }
}
