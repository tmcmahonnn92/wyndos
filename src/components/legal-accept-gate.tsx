"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptLegalTerms } from "@/lib/legal-actions";
import { LegalConsent } from "@/components/legal-consent";

/** Shown to owners until they accept the current terms. Their team isn't blocked. */
export function LegalAcceptGate() {
  const router = useRouter();
  const [state, setState] = useState({ acceptTerms: false, acceptData: false });
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Please check our terms</h1>
        <p className="mt-1 text-sm text-slate-500">
          We&apos;ve updated our Terms, Privacy Policy and Cookie Policy. Please read and accept them to carry on using Wyndos.
        </p>
        <div className="mt-4">
          <LegalConsent dark={false} acceptTerms={state.acceptTerms} acceptData={state.acceptData} onChange={setState} />
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button type="button" disabled={busy || !state.acceptTerms || !state.acceptData}
          onClick={() => start(async () => {
            setError("");
            try {
              await acceptLegalTerms({ acceptTerms: state.acceptTerms, acceptDataPermission: state.acceptData });
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Couldn't save. Please try again.");
            }
          })}
          className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Saving…" : "Accept and continue"}
        </button>
        <p className="mt-3 text-center text-xs text-slate-400">
          Questions? <a href="mailto:support@wyndos.io" className="underline">support@wyndos.io</a>
        </p>
      </div>
    </div>
  );
}
