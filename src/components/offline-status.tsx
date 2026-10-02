"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { completeJob, recordPayment, skipJob, updateJobNotes, updateJobPrice } from "@/lib/actions";
import { flushQueue, getQueue, onQueueChange } from "@/lib/offline-queue";

type OfflineSnapshotMeta = {
  syncedAt: number;
  dayCount: number;
};

const OFFLINE_META_KEY = "wyndos-offline-meta";
const OFFLINE_WORK_DAYS_KEY = "wyndos-offline-work-days";

/**
 * Save the coming week's work and work sheets on the phone (pages and the app files they
 * need), so they open with no signal even if they haven't been visited yet.
 */
let lastWarm = 0;
function warmPages(workDays: Array<{ id: number; date: string }>) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (Date.now() - lastWarm < 10 * 60 * 1000) return; // at most every 10 minutes
  lastWarm = Date.now();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const from = today.getTime() - 86_400_000;
  const to = today.getTime() + 8 * 86_400_000; // the coming week
  const soon = workDays.filter((d) => {
    const t = new Date(d.date).getTime();
    return t >= from && t < to;
  });
  const dates = [...new Set(soon.map((d) => new Date(d.date).toISOString().slice(0, 10)))];
  // Each day and its work sheet (print view). Workers only get their own days from /api/work-days.
  const urls = [
    "/", "/days",
    ...dates.flatMap((iso) => [`/days/date/${iso}`, `/days/date/${iso}/print`]),
    ...soon.flatMap((d) => [`/days/${d.id}`, `/days/${d.id}/print`]),
  ];
  navigator.serviceWorker.ready
    .then((registration) => registration.active?.postMessage({ type: "warm", urls }))
    .catch(() => {});
}

export function OfflineStatus() {
  // Offline pages: the service worker keeps recent pages on the phone.
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);

  const router = useRouter();
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncRecovered, setSyncRecovered] = useState(false);
  const [snapshotMeta, setSnapshotMeta] = useState<OfflineSnapshotMeta | null>(null);
  const [queued, setQueued] = useState(0);
  const [queueErrors, setQueueErrors] = useState<string[]>([]);

  useEffect(() => {
    const update = () => setQueued(getQueue().length);
    update();
    return onQueueChange(update);
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(OFFLINE_META_KEY);
      if (stored) {
        setSnapshotMeta(JSON.parse(stored) as OfflineSnapshotMeta);
      }
    } catch {
      setSnapshotMeta(null);
    }

    setIsOnline(navigator.onLine);
  }, []);

  useEffect(() => {
    const syncWorkDays = async () => {
      if (!navigator.onLine) return;

      setIsSyncing(true);
      try {
        const response = await fetch("/api/work-days", { cache: "no-store" });
        if (!response.ok) return;

        const workDays = await response.json();
        const nextMeta = {
          syncedAt: Date.now(),
          dayCount: Array.isArray(workDays) ? workDays.length : 0,
        };

        localStorage.setItem(OFFLINE_WORK_DAYS_KEY, JSON.stringify(workDays));
        localStorage.setItem(OFFLINE_META_KEY, JSON.stringify(nextMeta));
        setSnapshotMeta(nextMeta);
        warmPages(Array.isArray(workDays) ? workDays : []);
      } catch {
        // Offline or server unreachable: keep the last snapshot.
      } finally {
        setIsSyncing(false);
      }
    };

    const sendQueued = async () => {
      if (!navigator.onLine || getQueue().length === 0) return;
      const result = await flushQueue({
        complete: (jobId) => completeJob(jobId),
        skip: (jobId) => skipJob(jobId),
        note: (jobId, notes) => updateJobNotes(jobId, notes),
        price: (jobId, price) => updateJobPrice(jobId, price),
        pay: (entry) => recordPayment({
          customerId: entry.customerId,
          allocations: entry.allocations,
          method: entry.method,
          clientRequestId: entry.id,
          extra: entry.extra,
          paidAt: new Date(entry.createdAt),
        }),
      });
      if (result.failed.length > 0) setQueueErrors(result.failed);
      if (result.sent > 0) router.refresh();
    };

    const handleOnline = async () => {
      setIsOnline(true);
      setSyncRecovered(true);
      await sendQueued();
      await syncWorkDays();
      router.refresh();
      window.setTimeout(() => setSyncRecovered(false), 3500);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSyncRecovered(false);
    };

    void sendQueued();
    void syncWorkDays();
    const interval = window.setInterval(() => { void sendQueued(); void syncWorkDays(); }, 60 * 1000);
    // Phones often don't say when signal comes back, so while changes are waiting
    // keep trying every 10 seconds, and straight away when the app is opened again.
    const retry = window.setInterval(() => { if (getQueue().length > 0) void sendQueued(); }, 10 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") void sendQueued(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.clearInterval(interval);
      window.clearInterval(retry);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [router]);

  if (queueErrors.length > 0) {
    return (
      <div className="border-b border-red-200 bg-red-50 px-4 py-2">
        <p className="text-sm font-semibold text-red-900">Some offline changes couldn&apos;t be saved</p>
        <ul className="mt-1 list-disc pl-4 text-xs text-red-800">
          {queueErrors.slice(0, 3).map((message, index) => <li key={index}>{message}</li>)}
        </ul>
        <button type="button" onClick={() => setQueueErrors([])} className="mt-2 text-xs font-semibold text-red-900 underline">Dismiss</button>
      </div>
    );
  }

  // Background refreshes are silent; only show a banner when offline, when changes
  // are waiting to send, or just after reconnecting.
  if (isOnline && queued === 0 && !syncRecovered) return null;

  // A slim bar under the top menu (never covering it), stuck to the top while scrolling.
  if (!isOnline) {
    return (
      <div className="sticky top-14 md:top-0 z-30 flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
        <CloudOff size={14} className="flex-shrink-0" />
        <span className="font-semibold">No signal</span>
        <span className="truncate text-amber-800/90">
          {queued > 0 ? `${queued} change${queued === 1 ? "" : "s"} saved on this phone` : "keep working, taps are saved on this phone"}
        </span>
      </div>
    );
  }

  return (
    <div className="sticky top-14 md:top-0 z-30 flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-1.5 text-xs text-emerald-900">
      {isSyncing || queued > 0 ? <RefreshCw size={14} className="flex-shrink-0 animate-spin" /> : <Wifi size={14} className="flex-shrink-0" />}
      <span className="font-semibold">{queued > 0 ? `Sending ${queued} saved change${queued === 1 ? "" : "s"}…` : "Back online, everything is saved"}</span>
    </div>
  );
}