"use client";

/**
 * Offline queue for taps on the round.
 *
 * With no signal, "Done", "Skip" and "Done & Paid" are saved on the phone and
 * sent when the connection comes back. Each payment carries a clientRequestId so
 * a retry can never record the same payment twice, and completeJob is idempotent.
 */

export type QueuedAction =
  | { id: string; kind: "complete"; jobId: number; workDayId: number; createdAt: number }
  | { id: string; kind: "skip"; jobId: number; workDayId: number; createdAt: number }
  | { id: string; kind: "note"; jobId: number; workDayId: number; createdAt: number; notes: string }
  | { id: string; kind: "price"; jobId: number; workDayId: number; createdAt: number; price: number }
  | {
      id: string;
      kind: "pay";
      jobId: number;
      workDayId: number;
      createdAt: number;
      customerId: number;
      allocations: Array<{ jobId: number; amount: number }>;
      method: "CASH" | "BACS" | "CARD";
    };

type NewAction = QueuedAction extends infer A ? (A extends QueuedAction ? Omit<A, "id" | "createdAt"> : never) : never;

const KEY = "wyndos-offline-queue";
const EVENT = "wyndos-offline-queue-changed";

function read(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(queue: QueuedAction[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // Storage full or blocked: nothing more we can do on the device.
  }
  window.dispatchEvent(new Event(EVENT));
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getQueue() {
  return typeof window === "undefined" ? [] : read();
}

export function enqueue(action: NewAction, id: string = newId()): QueuedAction {
  const entry = { ...action, id, createdAt: Date.now() } as QueuedAction;
  write([...read(), entry]);
  return entry;
}

export function onQueueChange(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/** True when an error means "couldn't reach the server" rather than "the server said no". */
export function isNetworkError(error: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|networkerror|network error|load failed|fetch failed|ERR_INTERNET_DISCONNECTED|connection|unexpected response|timed out|timeout|aborted|offline|network request failed/i.test(message);
}

/** Weak signal ("one bar"): give up waiting after this long and save the tap on the phone. */
const SLOW_SIGNAL_MS = 12_000;

class SlowSignalError extends Error {
  constructor() {
    super("Connection timed out");
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SlowSignalError()), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/**
 * Run a server call now, or queue it if the phone is offline.
 * Returns "done" or "queued". Throws only for real server errors.
 */
export async function runOrQueue(action: NewAction, run: (clientRequestId: string) => Promise<unknown>) {
  const clientRequestId = newId();
  // The queued entry reuses the same id, so if the first attempt actually reached
  // the server before the connection dropped, the retry is recognised as a duplicate.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    enqueue(action, clientRequestId);
    return "queued" as const;
  }
  try {
    // Every queued kind is safe to send twice (complete/skip/notes/price are idempotent,
    // payments carry clientRequestId), so a slow call that later lands does no harm.
    await withTimeout(run(clientRequestId), SLOW_SIGNAL_MS);
    return "done" as const;
  } catch (error) {
    if (isNetworkError(error)) {
      enqueue(action, clientRequestId);
      return "queued" as const;
    }
    throw error;
  }
}

export type FlushHandlers = {
  complete: (jobId: number) => Promise<unknown>;
  skip: (jobId: number) => Promise<unknown>;
  note: (jobId: number, notes: string) => Promise<unknown>;
  price: (jobId: number, price: number) => Promise<unknown>;
  pay: (entry: Extract<QueuedAction, { kind: "pay" }>) => Promise<unknown>;
};

let flushing = false;

/** Send queued actions in order. Stops at the first network failure; drops actions the server rejects. */
export async function flushQueue(handlers: FlushHandlers) {
  if (flushing) return { sent: 0, failed: [] as string[] };
  flushing = true;
  let sent = 0;
  const failed: string[] = [];
  try {
    for (const entry of read()) {
      try {
        // A weak signal can leave a call hanging for minutes: give up after a few seconds
        // and try again shortly (every queued change is safe to send twice).
        const send = entry.kind === "complete" ? handlers.complete(entry.jobId)
          : entry.kind === "skip" ? handlers.skip(entry.jobId)
          : entry.kind === "note" ? handlers.note(entry.jobId, entry.notes)
          : entry.kind === "price" ? handlers.price(entry.jobId, entry.price)
          : handlers.pay(entry);
        await withTimeout(send, SLOW_SIGNAL_MS);
        sent++;
      } catch (error) {
        if (isNetworkError(error)) break;
        failed.push(error instanceof Error ? error.message : "Could not save a queued change.");
      }
      write(read().filter((item) => item.id !== entry.id));
    }
  } finally {
    flushing = false;
  }
  return { sent, failed };
}

/** Signing out: remove saved pages from this phone. */
export function clearOfflinePages() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "clear" });
  } catch {}
}
