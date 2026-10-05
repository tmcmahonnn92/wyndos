"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { NEVER_KEY, useInstallApp } from "@/lib/install-app";

/** The "Add Wyndos to home screen" popup. X hides it for now; "Don't show again" for good (the menu still has Install app). */
export function PWAInstallPrompt() {
  const { installed, canPrompt, install } = useInstallApp();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      setHidden(Boolean(localStorage.getItem(NEVER_KEY) || sessionStorage.getItem("pwa-prompt-dismissed")));
    } catch {
      setHidden(false);
    }
  }, []);

  if (installed || !canPrompt || hidden) return null;

  const later = () => {
    try { sessionStorage.setItem("pwa-prompt-dismissed", "1"); } catch {}
    setHidden(true);
  };
  const never = () => {
    try { localStorage.setItem(NEVER_KEY, "1"); } catch {}
    setHidden(true);
  };

  return (
    <div className="fixed bottom-20 md:bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-50 bg-slate-900 text-white rounded-2xl shadow-2xl p-4 animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
          <Download size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">Add Wyndos to home screen</p>
          <p className="text-xs text-slate-400 mt-0.5">Works offline, opens like an app</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={async () => { await install(); setHidden(true); }}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold transition-colors"
          >
            Install
          </button>
          <button onClick={later} aria-label="Not now" className="p-1 text-slate-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>
      <button onClick={never} className="mt-2 text-[11px] text-slate-400 underline hover:text-white">
        Don&apos;t show this again (you can still install from the menu)
      </button>
    </div>
  );
}

/** Steps for browsers that can't show an install box (iPhone Safari, Firefox…). */
export function InstallSteps({ ios, onClose }: { ios: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-slate-800 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-base font-bold">Install Wyndos</p>
        {ios ? (
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">
            <li>Open this page in <strong>Safari</strong>.</li>
            <li>Tap the <strong>Share</strong> button (the square with an arrow).</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          </ol>
        ) : (
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">
            <li>Open your browser&apos;s menu (the ⋮ or ☰ button).</li>
            <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
            <li>If you can&apos;t see it, open Wyndos in <strong>Chrome</strong> and try again.</li>
          </ol>
        )}
        <button onClick={onClose} className="mt-4 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white">Got it</button>
      </div>
    </div>
  );
}
