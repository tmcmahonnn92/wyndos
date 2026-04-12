import { NextRequest, NextResponse } from "next/server";

const UK_POSTCODE_REGEX = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

type NominatimResult = {
  lat: string;
  lon: string;
  display_name?: string;
  type?: string;
  addresstype?: string;
  importance?: number | string;
};

function normaliseAddress(address: string) {
  return address
    .replace(/\r?\n+/g, ", ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchQuery(address: string) {
  const normalised = normaliseAddress(address);
  const postcodeMatch = normalised.match(UK_POSTCODE_REGEX);
  const postcode = postcodeMatch?.[1]?.toUpperCase().replace(/\s+/g, " ") ?? null;
  const withoutPostcode = postcodeMatch
    ? normalised.replace(postcodeMatch[0], "").replace(/\s+,/g, ",").replace(/,+/g, ",").replace(/^,|,$/g, "").trim()
    : normalised;
  const primaryLine = withoutPostcode.split(",").map((part) => part.trim()).filter(Boolean)[0] ?? withoutPostcode;
  const query = [primaryLine, postcode, "United Kingdom"].filter(Boolean).join(", ");
  const warning = !postcode
    ? "No postcode detected. Optimisation may be less accurate for this address."
    : primaryLine.split(" ").length < 2
      ? "Address looks short. Check the house name or number and street are both included."
      : null;

  return { normalised, query, postcode, warning };
}

function scoreResult(result: NominatimResult, postcode: string | null, normalised: string) {
  const display = String(result?.display_name ?? "").toUpperCase();
  const source = normalised.toUpperCase();
  const firstToken = source.split(/[ ,]+/).filter(Boolean)[0] ?? "";
  let score = 0;
  if (postcode && display.includes(postcode)) score += 5;
  if (firstToken && display.includes(firstToken)) score += 2;
  if (result?.type === "house" || result?.addresstype === "house") score += 2;
  if (result?.importance) score += Number(result.importance);
  return score;
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("q");
  if (!address) return NextResponse.json(null);

  const { normalised, query, postcode, warning } = buildSearchQuery(address);

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=5&addressdetails=1&countrycodes=gb`;
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

    const best = [...data].sort((a, b) => scoreResult(b, postcode, normalised) - scoreResult(a, postcode, normalised))[0];
    const score = scoreResult(best, postcode, normalised);
    const confidence = score >= 7 ? "high" : score >= 4 ? "medium" : "low";
    const needsReview = confidence === "low" || !postcode;

    return NextResponse.json({
      lat: parseFloat(best.lat),
      lon: parseFloat(best.lon),
      normalizedQuery: query,
      matchedAddress: best.display_name ?? null,
      warning: needsReview
        ? warning ?? "Matched address is low confidence. Check the house or street details before applying this route."
        : warning,
      needsReview,
      confidence,
    });
  } catch {
    return NextResponse.json(null);
  }
}
