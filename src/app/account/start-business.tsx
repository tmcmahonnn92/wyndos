"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Briefcase } from "lucide-react";
import { startOwnBusiness } from "@/lib/auth-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** For someone who only works for others: set up their own business on the same login. */
export function StartBusiness() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [terms, setTerms] = useState(false);
  const [data, setData] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Briefcase size={15} className="text-blue-600" /> Start my own business</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-600">
          Run your own round on Wyndos with this same login. Your business is completely separate: nothing from the business
          you work for comes across, and you switch between them from the menu.
        </p>
        {!open ? (
          <button type="button" onClick={() => setOpen(true)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">Start my own business</button>
        ) : (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-700">
              Business name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sparkle Window Cleaning"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
              <span>I agree to the <Link href="/terms" className="text-blue-600 underline" target="_blank">terms</Link> and <Link href="/privacy" className="text-blue-600 underline" target="_blank">privacy policy</Link>.</span>
            </label>
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={data} onChange={(e) => setData(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
              <span>I have permission to keep my customers&apos; details on Wyndos.</span>
            </label>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex gap-2">
              <button type="button" disabled={pending || !name.trim() || !terms || !data}
                onClick={() => start(async () => {
                  setError("");
                  const res = await startOwnBusiness({ companyName: name, acceptTerms: terms, acceptDataPermission: data });
                  if (!res.ok) { setError(res.error); return; }
                  window.location.href = "/settings";
                })}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
                {pending ? "Setting up…" : "Create my business"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">Cancel</button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
