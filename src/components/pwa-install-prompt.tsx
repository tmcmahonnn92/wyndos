"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PWAInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't show if already running as installed PWA
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // Don't show if user already dismissed this session
    if (sessionStorage.getItem("pwa-prompt-dismissed")) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!promptEvent || dismissed) return null;

  const handleInstall = async () => {
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === "accepted" || outcome === "dismissed") {
      setDismissed(true);
    }
  };

  const handleDismiss = () => {
    sessionStorage.setItem("pwa-prompt-dismissed", "1");
    setDismissed(true);
  };

  return (
    <div className="fixed bottom-20 md:bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-50 bg-slate-900 text-white rounded-2xl shadow-2xl p-4 flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
        <Download size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight">Add Wyndos to home screen</p>
        <p className="text-xs text-slate-400 mt-0.5">Works offline, opens like an app</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={handleInstall}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold transition-colors"
        >
          Install
        </button>
        <button onClick={handleDismiss} className="p-1 text-slate-400 hover:text-white transition-colors">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
