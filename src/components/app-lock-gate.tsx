"use client";

import { useEffect, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Lock, Loader2, ShieldCheck, WifiOff } from "lucide-react";

export function AppLockGate({ hasPasskeys }: { hasPasskeys: boolean }) {
  const [hydrated, setHydrated] = useState(false);
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setHydrated(true);
    if (!hasPasskeys) return;

    try {
      setLocked(localStorage.getItem("wyndos-app-lock") === "enabled");
    } catch {
      setLocked(false);
    }
  }, [hasPasskeys]);

  const handleUnlock = async () => {
    if (!navigator.onLine) {
      setError("You need an internet connection to verify biometric unlock.");
      return;
    }

    setUnlocking(true);
    setError("");

    try {
      const optionsRes = await fetch("/api/passkeys/authenticate/options", { method: "POST" });
      const options = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(options.error ?? "Could not start biometric unlock.");

      const response = await startAuthentication(options);
      const verifyRes = await fetch("/api/passkeys/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const verify = await verifyRes.json();
      if (!verifyRes.ok || !verify.verified) {
        throw new Error(verify.error ?? "Biometric unlock failed.");
      }

      setLocked(false);
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : "Biometric unlock failed.");
    } finally {
      setUnlocking(false);
    }
  };

  if (!hydrated || !hasPasskeys || !locked) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
          <Lock size={26} />
        </div>
        <h2 className="text-center text-xl font-bold text-white">Unlock Wyndos</h2>
        <p className="mt-2 text-center text-sm text-slate-400">
          Use fingerprint, face unlock, or your device PIN to continue.
        </p>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
            {!navigator.onLine ? <WifiOff size={15} className="flex-shrink-0" /> : <ShieldCheck size={15} className="flex-shrink-0" />}
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleUnlock}
          disabled={unlocking}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {unlocking ? <><Loader2 size={16} className="animate-spin" />Checking device…</> : <><ShieldCheck size={16} />Unlock with biometrics</>}
        </button>
      </div>
    </div>
  );
}