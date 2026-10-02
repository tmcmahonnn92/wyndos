"use client";

import { DATA_PERMISSION_TEXT } from "@/lib/legal";

/** The two boxes every owner ticks: terms + privacy, and permission to hold their customers' details. */
export function LegalConsent({
  acceptTerms,
  acceptData,
  onChange,
  dark = true,
}: {
  acceptTerms: boolean;
  acceptData: boolean;
  onChange: (next: { acceptTerms: boolean; acceptData: boolean }) => void;
  dark?: boolean;
}) {
  const text = dark ? "text-slate-300" : "text-slate-700 dark:text-slate-300";
  const box = dark ? "border-slate-700 bg-slate-800/40" : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40";
  return (
    <div className={`space-y-3 rounded-xl border p-4 ${box}`}>
      <label className={`flex items-start gap-3 text-sm ${text}`}>
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={acceptTerms}
          onChange={(e) => onChange({ acceptTerms: e.target.checked, acceptData })} />
        <span>
          I agree to the <a href="/terms" target="_blank" rel="noopener" className="text-blue-400 underline">Terms of Service</a> and{" "}
          <a href="/privacy" target="_blank" rel="noopener" className="text-blue-400 underline">Privacy Policy</a>, including the data processing terms.
        </span>
      </label>
      <label className={`flex items-start gap-3 text-sm ${text}`}>
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={acceptData}
          onChange={(e) => onChange({ acceptTerms, acceptData: e.target.checked })} />
        <span>{DATA_PERMISSION_TEXT}</span>
      </label>
    </div>
  );
}
