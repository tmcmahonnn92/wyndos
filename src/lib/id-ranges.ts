/**
 * Short form of a list of ids for links: sorted, runs collapsed, base 36.
 * [120, 121, 122, 130] -> "3c-3e.3m". Used by the "send from phone" QR code so it stays simple.
 */
export function encodeIdRanges(ids: number[]): string {
  const sorted = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? sorted[i].toString(36) : `${sorted[i].toString(36)}-${sorted[j].toString(36)}`);
    i = j + 1;
  }
  return parts.join(".");
}

export function decodeIdRanges(value: string): number[] {
  const out: number[] = [];
  for (const part of value.split(".")) {
    const [a, b] = part.split("-").map((x) => parseInt(x, 36));
    if (!Number.isInteger(a) || a <= 0) continue;
    const end = Number.isInteger(b) && b >= a ? Math.min(b, a + 5000) : a;
    for (let n = a; n <= end; n++) out.push(n);
    if (out.length > 5000) break;
  }
  return out;
}
