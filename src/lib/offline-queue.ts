"use client";

/**
 * Offline queue for taps on the round.
 *
 * With no signal, "Done", "Skip", notes, prices and "Done & Paid" are saved on the phone and
 * sent when the connection comes back.
 *
 * - Kept in the phone's database (IndexedDB), and the phone is asked to keep it safe from
 *   clean-up. Falls back to plain browser storage where IndexedDB isn't available.
 * - Sent to one fixed address (/api/offline/sync), so an update to Wyndos can't break sending.
 * - Sent by the open page, and on Android also by the service worker in the background
 *   (public/sw.js has the same sending code: keep the two in step).
 * - Anything the server refuses goes to "Needs checking" with the reason; nothing vanishes.
 * - Every kind is safe to send twice (payments carry clientRequestId; the rest are idempotent).
 */

export type QueuedAction = (
  | { kind: "complete" }
  | { kind: "skip" }
  | { kind: "note"; notes: string }
  | { kind: "price"; price: number }
  | {
      kind: "pay";
      customerId: number;
      allocations: Array<{ jobId: number; amount: number }>;
      method: "CASH" | "BACS" | "CARD";
      notes?: string;
      /** Paid on top: kept as credit. */
      extra?: number;
    }
) & {
  id: string;
  jobId: number;
  workDayId: number;
  createdAt: number;
  /** Keeps the order taps were made in. */
  order?: number;
  /** Shown if it needs checking, e.g. "Mrs Smith, 2 High St". */
  label?: string;
};

export type OfflineProblem = { id: string; action: QueuedAction; error: string; at: number };

type NewAction = QueuedAction extends infer A ? (A extends QueuedAction ? Omit<A, "id" | "createdAt" | "order"> : never) : never;

const LEGACY_KEY = "wyndos-offline-queue";
const FALLBACK_PROBLEMS_KEY = "wyndos-offline-problems";
const EVENT = "wyndos-offline-queue-changed";
const DB_NAME = "wyndos-offline";
const SYNC_TAG = "wyndos-offline";
const LOCK = "wyndos-offline-sync";
const BATCH = 50;

const isBrowser = () => typeof window !== "undefined";

// ── Storage ───────────────────────────────────────────────────────────────────

let db: IDBDatabase | null = null;
let useFallback = false;
let queueCache: QueuedAction[] = [];
let problemsCache: OfflineProblem[] = [];
let ready: Promise<void> | null = null;
let counter = 0;
/** Saved taps whose database write hasn't finished yet (kept in view while re-reading). */
const pendingSaves = new Map<string, QueuedAction>();

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (!("indexedDB" in window)) return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("queue")) d.createObjectStore("queue", { keyPath: "id" });
        if (!d.objectStoreNames.contains("problems")) d.createObjectStore("problems", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(store: "queue" | "problems", mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error("No database"));
    const t = db.transaction(store, mode);
    let result: T | undefined;
    const req = run(t.objectStore(store));
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const sortQueue = (list: QueuedAction[]) =>
  [...list].sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt) || a.createdAt - b.createdAt);

function readLocal<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeLocal(key: string, value: unknown[]) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

let channel: BroadcastChannel | null = null;
function emit(fromElsewhere = false) {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event(EVENT));
  if (!fromElsewhere) try { channel?.postMessage("changed"); } catch {}
}

/** Re-read from the phone's database (another tab or the background sender changed it). */
async function reload() {
  if (useFallback || !db) {
    queueCache = sortQueue(readLocal<QueuedAction>(LEGACY_KEY));
    problemsCache = readLocal<OfflineProblem>(FALLBACK_PROBLEMS_KEY);
    return;
  }
  const [q, p] = await Promise.all([
    tx<QueuedAction[]>("queue", "readonly", (s) => s.getAll()),
    tx<OfflineProblem[]>("problems", "readonly", (s) => s.getAll()),
  ]);
  const stored = q ?? [];
  const ids = new Set(stored.map((a) => a.id));
  queueCache = sortQueue([...stored, ...[...pendingSaves.values()].filter((a) => !ids.has(a.id))]);
  problemsCache = (p ?? []).sort((a, b) => a.at - b.at);
}

/** Open the database once, moving anything saved by the older version (browser storage) across. */
export function offlineReady(): Promise<void> {
  if (!isBrowser()) return Promise.resolve();
  if (ready) return ready;
  // Until the database opens, show what plain storage has (older saves), so nothing flickers.
  queueCache = sortQueue(readLocal<QueuedAction>(LEGACY_KEY));
  ready = (async () => {
    db = await openDb();
    if (!db) {
      useFallback = true;
    } else {
      const legacy = readLocal<QueuedAction>(LEGACY_KEY);
      if (legacy.length) {
        try {
          await tx("queue", "readwrite", (s) => { for (const a of legacy) s.put({ ...a, order: a.order ?? a.createdAt }); });
          localStorage.removeItem(LEGACY_KEY);
        } catch {
          useFallback = true; // couldn't write: keep using plain storage
        }
      }
    }
    try {
      channel = "BroadcastChannel" in window ? new BroadcastChannel("wyndos-offline") : null;
      if (channel) channel.onmessage = () => { void reload().then(() => emit(true)); };
    } catch {}
    try {
      navigator.serviceWorker?.addEventListener("message", (e) => {
        if ((e.data as { type?: string } | null)?.type === "offline-queue-changed") void reload().then(() => emit(true));
      });
    } catch {}
    await reload().catch(() => {});
    emit(true);
  })();
  return ready;
}

async function saveQueued(entry: QueuedAction) {
  await offlineReady();
  if (useFallback || !db) {
    writeLocal(LEGACY_KEY, sortQueue([...readLocal<QueuedAction>(LEGACY_KEY).filter((a) => a.id !== entry.id), entry]));
    return;
  }
  await tx("queue", "readwrite", (s) => s.put(entry));
}

async function removeQueued(id: string) {
  queueCache = queueCache.filter((a) => a.id !== id);
  if (useFallback || !db) return writeLocal(LEGACY_KEY, readLocal<QueuedAction>(LEGACY_KEY).filter((a) => a.id !== id));
  await tx("queue", "readwrite", (s) => s.delete(id));
}

async function saveProblem(problem: OfflineProblem) {
  problemsCache = [...problemsCache.filter((p) => p.id !== problem.id), problem];
  if (useFallback || !db) return writeLocal(FALLBACK_PROBLEMS_KEY, problemsCache);
  await tx("problems", "readwrite", (s) => s.put(problem));
}

// ── Reading ───────────────────────────────────────────────────────────────────

export function getQueue(): QueuedAction[] {
  if (!isBrowser()) return [];
  void offlineReady();
  return queueCache;
}

export function getProblems(): OfflineProblem[] {
  if (!isBrowser()) return [];
  void offlineReady();
  return problemsCache;
}

export function onQueueChange(listener: () => void) {
  void offlineReady();
  const storage = (e: StorageEvent) => { if (e.key === LEGACY_KEY || e.key === FALLBACK_PROBLEMS_KEY) void reload().then(listener); };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}

// ── Saving a tap ──────────────────────────────────────────────────────────────

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

let askedToKeep = false;
/** Ask the phone not to clear Wyndos's saved data when it's short of space. */
function askToKeepData() {
  if (askedToKeep) return;
  askedToKeep = true;
  try {
    void navigator.storage?.persisted?.().then((already) => (already ? true : navigator.storage.persist?.())).catch(() => {});
  } catch {}
}

/** Android: let the phone send saved changes when signal returns, even with Wyndos closed. */
function askForBackgroundSend() {
  try {
    void navigator.serviceWorker?.ready
      .then((reg) => (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register(SYNC_TAG))
      .catch(() => {});
  } catch {}
}

export function enqueue(action: NewAction, id: string = newId()): QueuedAction {
  const now = Date.now();
  const entry = { ...action, id, createdAt: now, order: now * 1000 + (counter++ % 1000) } as QueuedAction;
  queueCache = sortQueue([...queueCache.filter((a) => a.id !== id), entry]);
  emit();
  pendingSaves.set(entry.id, entry);
  void saveQueued(entry).then(() => { pendingSaves.delete(entry.id); emit(); }).catch(() => {
    // Database refused: keep it in plain storage instead.
    useFallback = true;
    writeLocal(LEGACY_KEY, queueCache);
    pendingSaves.delete(entry.id);
  });
  askToKeepData();
  askForBackgroundSend();
  return entry;
}

// ── Errors ────────────────────────────────────────────────────────────────────

/** True when an error means "couldn't reach the server" rather than "the server said no". */
export function isNetworkError(error: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|networkerror|network error|load failed|fetch failed|ERR_INTERNET_DISCONNECTED|connection|unexpected response|timed out|timeout|aborted|offline|network request failed/i.test(message);
}

/**
 * True when the server no longer knows this page's buttons: Wyndos was updated while the page
 * was open (every update renames them). Not the server saying no: keep the change and reload.
 */
export function isOutOfDate(error: unknown) {
  if (error && typeof error === "object" && (error as { name?: string }).name === "UnrecognizedActionError") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Server Action .* was not found|failed-to-find-server-action/i.test(message);
}

/** Load the latest Wyndos (at most once a minute, so a stuck page can't loop). */
export function reloadForUpdate() {
  if (!isBrowser() || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
  try {
    const last = Number(sessionStorage.getItem("wyndos-update-reload") || 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem("wyndos-update-reload", String(Date.now()));
  } catch {}
  window.location.reload();
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
  // Earlier taps still waiting: this one goes behind them, so they arrive in order.
  if (getQueue().length > 0) {
    enqueue(action, clientRequestId);
    void flushQueue();
    return "queued" as const;
  }
  try {
    await withTimeout(run(clientRequestId), SLOW_SIGNAL_MS);
    return "done" as const;
  } catch (error) {
    if (isNetworkError(error) || isOutOfDate(error)) {
      // No signal, or Wyndos was updated while the page was open: save it; it's sent
      // through the fixed address, which updates don't change.
      enqueue(action, clientRequestId);
      void flushQueue();
      return "queued" as const;
    }
    throw error;
  }
}

// ── Sending ───────────────────────────────────────────────────────────────────

export type FlushResult = { sent: number; rejected: number; waiting: boolean; signedOut?: boolean };

type SyncResult = { id: string; status: "ok" | "rejected" | "retry"; error?: string };

async function sendOnce(): Promise<FlushResult> {
  let sent = 0, rejected = 0;
  for (let round = 0; round < 20; round++) {
    await reload().catch(() => {});
    // Only what's safely in the database (a tap still being saved goes next round).
    const batch = queueCache.filter((a) => !pendingSaves.has(a.id)).slice(0, BATCH);
    if (batch.length === 0) return { sent, rejected, waiting: false };
    let res: Response;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), 20_000);
    try {
      res = await fetch("/api/offline/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ v: 1, items: batch }),
        credentials: "same-origin",
        cache: "no-store",
        signal: ctrl?.signal,
      });
    } catch {
      return { sent, rejected, waiting: true };
    } finally {
      clearTimeout(timer);
    }
    const json = res.headers.get("Content-Type")?.includes("application/json") ? await res.json().catch(() => null) : null;
    if (res.status === 401 || res.redirected || !json) return { sent, rejected, waiting: true, signedOut: res.status === 401 || res.redirected };
    if (!res.ok || !Array.isArray(json.results)) return { sent, rejected, waiting: true };
    const byId = new Map<string, SyncResult>((json.results as SyncResult[]).map((r) => [r.id, r]));
    let stop = false;
    for (const item of batch) {
      const r = byId.get(item.id);
      if (!r || r.status === "retry") { stop = true; break; }
      if (r.status === "rejected") {
        await saveProblem({ id: item.id, action: item, error: r.error || "Couldn't be saved.", at: Date.now() });
        rejected++;
      } else sent++;
      await removeQueued(item.id);
    }
    emit();
    if (stop) return { sent, rejected, waiting: queueCache.length > 0 };
  }
  return { sent, rejected, waiting: queueCache.length > 0 };
}

let flushing: Promise<FlushResult> | null = null;

/** Send saved changes, oldest first. Only one sender at a time (this page, other tabs, the service worker). */
export function flushQueue(): Promise<FlushResult> {
  if (!isBrowser()) return Promise.resolve({ sent: 0, rejected: 0, waiting: false });
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      await offlineReady();
      // Re-read: another tab or the background sender may have changed it.
      await reload().catch(() => {});
      emit(true);
      if (queueCache.length === 0) return { sent: 0, rejected: 0, waiting: false };
      const locks = (navigator as Navigator & { locks?: { request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<FlushResult>) => Promise<FlushResult> } }).locks;
      if (!locks) return await sendOnce();
      // Someone else is sending right now: leave it to them.
      return await locks.request(LOCK, { ifAvailable: true }, async (lock) => (lock ? sendOnce() : { sent: 0, rejected: 0, waiting: true }));
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

// ── Needs checking ────────────────────────────────────────────────────────────

/** Put a refused change back in the queue to send again. */
export async function retryProblem(id: string) {
  await offlineReady();
  const problem = problemsCache.find((p) => p.id === id);
  if (!problem) return;
  problemsCache = problemsCache.filter((p) => p.id !== id);
  if (useFallback || !db) writeLocal(FALLBACK_PROBLEMS_KEY, problemsCache);
  else await tx("problems", "readwrite", (s) => s.delete(id));
  const entry = { ...problem.action, order: problem.action.order ?? problem.action.createdAt };
  queueCache = sortQueue([...queueCache, entry]);
  await saveQueued(entry);
  emit();
  void flushQueue();
}

export async function dismissProblem(id: string) {
  await offlineReady();
  problemsCache = problemsCache.filter((p) => p.id !== id);
  if (useFallback || !db) writeLocal(FALLBACK_PROBLEMS_KEY, problemsCache);
  else await tx("problems", "readwrite", (s) => s.delete(id));
  emit();
}

// ── Signing out ───────────────────────────────────────────────────────────────

/**
 * Before signing out: warn if changes haven't been sent (they'd be lost, or sent as whoever
 * signs in next). Returns false to stay signed in. When going ahead, clears them.
 */
export async function readyToSignOut(): Promise<boolean> {
  await offlineReady().catch(() => {});
  const waiting = queueCache.length;
  if (waiting > 0) {
    const ok = window.confirm(
      `${waiting} change${waiting === 1 ? "" : "s"} on this phone ${waiting === 1 ? "hasn't" : "haven't"} been sent yet ` +
      `(cleans ticked off or payments taken with no signal).\n\nSign out anyway and delete ${waiting === 1 ? "it" : "them"}? ` +
      `Press Cancel to stay signed in until ${waiting === 1 ? "it's" : "they're"} sent.`,
    );
    if (!ok) return false;
  }
  queueCache = [];
  problemsCache = [];
  try {
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(FALLBACK_PROBLEMS_KEY);
    if (db) {
      await tx("queue", "readwrite", (s) => s.clear());
      await tx("problems", "readwrite", (s) => s.clear());
    }
  } catch {}
  emit();
  return true;
}

/** Signing out: remove saved pages from this phone. */
export function clearOfflinePages() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "clear" });
  } catch {}
}
