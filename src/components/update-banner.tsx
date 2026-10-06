"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

const CHECK_EVERY = 5 * 60 * 1000;

/**
 * After an update goes live, open pages show "Wyndos has been updated. with a Refresh
 * button, instead of breaking on the next tap. Checks when the app comes back into view
 * and every few minutes.
 */
export function UpdateBanner() {
  const first = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (!build || build === "dev") return;
        if (first.current === null) first.current = build;
        else if (build !== first.current) setReady(true);
      } catch {
        // No signal or mid-restart: try again later.
      }
    };
    void check();
    const timer = window.setInterval(check, CHECK_EVERY);
    const onVisible = () => { void check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);

  if (!ready) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-2 print:hidden">
      <div className="flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
        <span>Wyndos has been updated.</span>
        <button type="button" onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold hover:bg-blue-500">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>
    </div>
  );
}
