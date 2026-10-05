"use client";

import { useEffect, useState } from "react";

/**
 * "Install the app" (add to home screen). Chrome/Android/desktop fire `beforeinstallprompt`,
 * which we keep here so the popup and the menu can both use it. iPhone never fires it:
 * there it's Share → Add to Home Screen, so we show those steps instead.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    try { localStorage.setItem("wyndos-installed", "1"); } catch {}
    notify();
  });
}

export const NEVER_KEY = "wyndos-install-never";

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function useInstallApp() {
  const [state, setState] = useState({ ready: false, installed: true, canPrompt: false, ios: false });

  useEffect(() => {
    const update = () =>
      setState({
        ready: true,
        installed: isStandalone(),
        canPrompt: Boolean(deferred),
        ios: /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
      });
    update();
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);

  /** Shows the browser's install box. Returns false when there isn't one (show the steps instead). */
  const install = async () => {
    if (!deferred) return false;
    const e = deferred;
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === "accepted") deferred = null;
    notify();
    return true;
  };

  return { ...state, install };
}
