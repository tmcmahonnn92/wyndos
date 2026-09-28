"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { completeJob, recordPayment, skipJob } from "@/lib/actions";
import { flushQueue, getQueue, onQueueChange } from "@/lib/offline-queue";

type OfflineSnapshotMeta = {
  syncedAt: number;
  dayCount: number;
};

const OFFLINE_META_KEY = "wyndos-offline-meta";
const OFFLINE_WORK_DAYS_KEY = "wyndos-offline-work-days";

export function OfflineStatus() {
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
        pay: (entry) => recordPayment({
          customerId: entry.customerId,
          allocations: entry.allocations,
          method: entry.method,
          clientRequestId: entry.id,
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
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [router]);

  if (queueErrors.length > 0) {
    return (
      <div className="fixed top-16 md:top-4 right-4 z-[70] max-w-sm rounded-2xl border border-red-300 bg-red-50 px-4 py-3 shadow-lg">
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

  if (!isOnline) {
    return (
      <div className="fixed top-16 md:top-4 right-4 z-[70] max-w-sm rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg">
        <div className="flex items-start gap-2 text-amber-900">
          <CloudOff size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold">
              No signal{queued > 0 ? ` · ${queued} change${queued === 1 ? "" : "s"} waiting` : ""}
            </p>
            <p className="text-xs text-amber-800/80 mt-0.5">
              Keep working: taps are saved on this phone and sent when you&apos;re back online.
              {snapshotMeta ? ` Last synced ${new Date(snapshotMeta.syncedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} with ${snapshotMeta.dayCount} recent work days cached.` : ""}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed top-16 md:top-4 right-4 z-[70] max-w-sm rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 shadow-lg">
      <div className="flex items-start gap-2 text-emerald-900">
        {isSyncing ? <RefreshCw size={16} className="mt-0.5 flex-shrink-0 animate-spin" /> : <Wifi size={16} className="mt-0.5 flex-shrink-0" />}
        <div>
          <p className="text-sm font-semibold">{queued > 0 ? `Sending ${queued} saved change${queued === 1 ? "" : "s"}…` : "Back online"}</p>
          <p className="text-xs text-emerald-800/80 mt-0.5">
            {queued > 0 ? "Changes made with no signal are being saved." : "Everything is saved."}
          </p>
        </div>
      </div>
    </div>
  );
}