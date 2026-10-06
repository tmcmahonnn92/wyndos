/**
 * Simple in-memory limiter for logins, sign-ups and reset emails. One app process runs on
 * the VPS, so memory is enough; a restart just clears the counts.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

/** True when this key has had fewer than `max` hits in the last `windowMs`. Counts the hit. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= max;
}

/** Forget the count (e.g. after a successful login). */
export function clearLimit(key: string) {
  buckets.delete(key);
}

/** IP address of the person calling a server action. */
export async function actionIp(): Promise<string> {
  const { headers } = await import("next/headers");
  const { clientIp } = await import("@/lib/client-ip");
  try {
    return clientIp(await headers()) || "unknown";
  } catch {
    return "unknown";
  }
}

export const MINUTE = 60_000;
export const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";
