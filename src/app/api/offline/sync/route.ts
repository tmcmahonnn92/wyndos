import { NextResponse } from "next/server";
import { getActor } from "@/lib/guards";
import { completeJob, recordPayment, skipJob, updateJobNotes, updateJobPrice } from "@/lib/actions";

export const dynamic = "force-dynamic";

/**
 * Changes saved on a phone with no signal (src/lib/offline-queue.ts, and the background
 * sender in public/sw.js). A fixed address, so a Wyndos update never stops them arriving.
 *
 * Each change is done in order and gets a result:
 * - ok: done (or already done: every kind is safe to send twice)
 * - rejected: the server said no (e.g. the clean was deleted); the phone shows it under "Needs checking"
 * - retry: a passing problem (database busy); the phone keeps it and the ones after it
 */

type Item = {
  id?: unknown; kind?: unknown; jobId?: unknown; notes?: unknown; price?: unknown; createdAt?: unknown;
  customerId?: unknown; allocations?: unknown; method?: unknown; extra?: unknown;
};

const MAX_ITEMS = 50;

function isRedirect(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/** Database down, busy or timed out: try again later rather than give up on the change. */
function isPassing(error: unknown) {
  const e = error as { name?: string; code?: string; message?: string } | null;
  if (!e) return false;
  if (e.name === "PrismaClientInitializationError" || e.name === "PrismaClientRustPanicError") return true;
  if (e.code && ["P1001", "P1002", "P1008", "P1017", "P2024", "P2034"].includes(e.code)) return true;
  return /ECONNREFUSED|ECONNRESET|Connection terminated|too many clients|timeout exceeded when trying to connect/i.test(e.message ?? "");
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

async function apply(item: Item) {
  const jobId = num(item.jobId);
  if (!Number.isInteger(jobId) || jobId <= 0) throw new Error("This change was missing its clean.");
  switch (item.kind) {
    case "complete":
      await completeJob(jobId);
      return;
    case "skip":
      await skipJob(jobId);
      return;
    case "note":
      if (typeof item.notes !== "string") throw new Error("This note was empty.");
      await updateJobNotes(jobId, item.notes.slice(0, 5000));
      return;
    case "price": {
      const price = num(item.price);
      if (!Number.isFinite(price)) throw new Error("This price wasn't a number.");
      await updateJobPrice(jobId, price);
      return;
    }
    case "pay": {
      const method = item.method;
      if (method !== "CASH" && method !== "BACS" && method !== "CARD") throw new Error("Unknown payment method.");
      const allocations = Array.isArray(item.allocations)
        ? item.allocations.map((a: { jobId?: unknown; amount?: unknown }) => ({ jobId: num(a?.jobId), amount: num(a?.amount) }))
          .filter((a) => Number.isInteger(a.jobId) && Number.isFinite(a.amount))
        : [];
      const createdAt = num(item.createdAt);
      await recordPayment({
        customerId: num(item.customerId),
        allocations,
        method,
        notes: typeof item.notes === "string" ? item.notes : undefined,
        extra: Number.isFinite(num(item.extra)) ? num(item.extra) : undefined,
        // The same id every time it's sent: a payment is only ever recorded once.
        clientRequestId: String(item.id),
        // When it was taken on the phone, not when signal came back.
        paidAt: Number.isFinite(createdAt) && createdAt > 0 ? new Date(createdAt) : undefined,
      });
      return;
    }
    default:
      throw new Error("Unknown kind of change.");
  }
}

export async function POST(req: Request) {
  try {
    await getActor();
  } catch {
    return NextResponse.json({ error: "Signed out" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { items?: unknown } | null;
  const items = Array.isArray(body?.items) ? (body!.items as Item[]).slice(0, MAX_ITEMS) : null;
  if (!items) return NextResponse.json({ error: "Nothing to send" }, { status: 400 });

  const results: Array<{ id: string; status: "ok" | "rejected" | "retry"; error?: string }> = [];
  let stopped = false;
  for (const item of items) {
    const id = typeof item?.id === "string" ? item.id.slice(0, 100) : "";
    if (!id) continue;
    if (stopped) { results.push({ id, status: "retry" }); continue; }
    try {
      await apply(item);
      results.push({ id, status: "ok" });
    } catch (error) {
      if (isRedirect(error) || isPassing(error)) {
        // Signed out part-way, or the database is struggling: keep this and the rest for later.
        stopped = true;
        results.push({ id, status: "retry" });
        continue;
      }
      const message = error instanceof Error && error.message ? error.message : "Couldn't be saved.";
      console.warn("[offline-sync] refused", item?.kind, item?.jobId, message);
      results.push({ id, status: "rejected", error: message.slice(0, 300) });
    }
  }
  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
