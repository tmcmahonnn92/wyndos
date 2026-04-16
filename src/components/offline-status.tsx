"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";

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
      } finally {
        setIsSyncing(false);
      }
    };

    const handleOnline = async () => {
      setIsOnline(true);
      setSyncRecovered(true);
      await syncWorkDays();
      router.refresh();
      window.setTimeout(() => setSyncRecovered(false), 3500);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSyncRecovered(false);
    };

    void syncWorkDays();
    const interval = window.setInterval(() => { void syncWorkDays(); }, 5 * 60 * 1000);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [router]);

  if (isOnline && !isSyncing && !syncRecovered) return null;

  if (!isOnline) {
    return (
      <div className="fixed top-16 md:top-4 right-4 z-[70] max-w-sm rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg">
        <div className="flex items-start gap-2 text-amber-900">
          <CloudOff size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold">Offline mode</p>
            <p className="text-xs text-amber-800/80 mt-0.5">
              Using cached data on this device.
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
          <p className="text-sm font-semibold">{isSyncing ? "Syncing offline cache" : "Back online"}</p>
          <p className="text-xs text-emerald-800/80 mt-0.5">
            {isSyncing ? "Refreshing the latest schedule for offline use." : "Connection restored and cached data refreshed."}
          </p>
        </div>
      </div>
    </div>
  );
}