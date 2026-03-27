"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldAlert, X } from "lucide-react";

export function SupportSessionBanner({
  tenantName,
  reason,
  startedAt,
}: {
  tenantName: string;
  reason: string;
  startedAt: string;
}) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);

  async function endSession() {
    setClosing(true);
    try {
      await fetch("/api/admin/end-support-session", { method: "POST" });
      router.push("/admin");
      router.refresh();
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="sticky top-14 z-30 border-b border-amber-800/60 bg-amber-950/90 px-4 py-3 text-amber-50 backdrop-blur md:top-0 md:px-6">
      <div className="mx-auto flex max-w-6xl items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
          <div>
            <p className="text-sm font-semibold">Support session active for {tenantName}</p>
            <p className="mt-1 text-sm text-amber-100/90">Reason: {reason}</p>
            <p className="mt-1 text-xs text-amber-200/70">
              Started {new Date(startedAt).toLocaleString("en-GB")}. Access is audited and should only be used for legitimate support work.
            </p>
          </div>
        </div>
        <button
          onClick={endSession}
          disabled={closing}
          className="inline-flex items-center gap-2 rounded-lg border border-amber-700/80 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-900/40 disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" />
          {closing ? "Ending…" : "End support"}
        </button>
      </div>
    </div>
  );
}
