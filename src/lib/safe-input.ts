/**
 * Server actions can be called with any object, not just what our forms send.
 * pickPlain keeps only the named keys, and only plain values (text, numbers, true/false,
 * null, dates). Nested objects are dropped, so nobody can slip in Prisma relation writes
 * like { tenant: { update: … } } or { customers: { connect: … } }, or set tenantId/id.
 */
export function pickPlain<T extends object, K extends keyof T & string>(input: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  if (!input || typeof input !== "object") return out;
  const src = input as Record<string, unknown>;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const v = src[key];
    if (v === null || typeof v === "string" || typeof v === "boolean" || v instanceof Date || (typeof v === "number" && Number.isFinite(v))) {
      (out as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}
