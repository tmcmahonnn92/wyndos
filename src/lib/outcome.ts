/** Unwrap a { ok, value | error } result from a server action, throwing the readable message. */
export async function unwrap<T>(result: Promise<{ ok: true; value: T } | { ok: false; error: string }>): Promise<T> {
  const r = await result;
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
