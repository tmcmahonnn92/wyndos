"use client";

import { useState } from "react";
import { resendVerificationEmail } from "@/lib/auth-actions";

/** Until the owner confirms their email address. */
export function VerifyEmailBar({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  return (
    <div className="print:hidden flex items-center justify-between gap-3 bg-amber-100 px-4 py-2 text-xs text-amber-900">
      <span>
        {state === "sent"
          ? `Sent. Check ${email} (and junk) for the link.`
          : state === "error"
            ? error
            : `Please confirm your email: we sent a link to ${email}.`}
      </span>
      {state !== "sent" && (
        <button
          type="button"
          disabled={state === "sending"}
          onClick={async () => {
            setState("sending");
            const result = await resendVerificationEmail();
            if (result.ok) setState("sent");
            else { setError(result.error ?? "Couldn't send it."); setState("error"); }
          }}
          className="flex-shrink-0 rounded-lg bg-white/70 px-2.5 py-1 font-semibold hover:bg-white disabled:opacity-60"
        >
          {state === "sending" ? "Sending…" : "Resend"}
        </button>
      )}
    </div>
  );
}
