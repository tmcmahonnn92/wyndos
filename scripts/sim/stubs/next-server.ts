// after(): run straight away but remember it, so the simulation can wait for it.
const g = globalThis as unknown as { __simAfter?: Promise<unknown>[] };
export function after(fn: () => unknown) { (g.__simAfter ??= []).push(Promise.resolve().then(fn).catch((e) => console.error("[after]", e))); }
export class NextResponse extends Response { static json(body: unknown, init?: ResponseInit) { return new Response(JSON.stringify(body), init); } }
export type NextRequest = Request;
