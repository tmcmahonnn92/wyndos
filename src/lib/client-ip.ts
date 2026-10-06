/**
 * The visitor's IP address. nginx sets X-Real-IP to the address it actually saw, which
 * the visitor can't fake; X-Forwarded-For can be, so only its last hop is trusted.
 */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? "";
}
