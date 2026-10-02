/** A customer's place for maps: their own pin when set, otherwise their address. */
export type MapPlace = { address: string; latitude?: number | null; longitude?: number | null };

export function hasPin(place: MapPlace) {
  return typeof place.latitude === "number" && typeof place.longitude === "number";
}

/** What to hand Google Maps: "lat,lng" for a pin, else the address. */
export function mapsPoint(place: MapPlace) {
  return hasPin(place) ? `${place.latitude},${place.longitude}` : place.address;
}

/** Link that opens the place in Google Maps. */
export function mapsHref(place: MapPlace) {
  return `https://maps.google.com/?q=${encodeURIComponent(mapsPoint(place))}`;
}

/**
 * Read a pin from what people paste: "53.2, -1.1", a Google Maps link (…/@53.2,-1.1,17z
 * or …?q=53.2,-1.1) or a what3words-free plain pair. Null if it isn't a UK-ish lat/lng.
 */
export function parsePin(text: string): { latitude: number; longitude: number } | null {
  const t = text.trim();
  const patterns = [/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i, /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/, /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/];
  for (const pattern of patterns) {
    const m = t.match(pattern);
    if (!m) continue;
    const latitude = Number(m[1]);
    const longitude = Number(m[2]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      return { latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) };
    }
  }
  return null;
}
