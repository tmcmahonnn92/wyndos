"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Bell, CreditCard, Download, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { closeBusiness } from "@/lib/close-account";

/** Settings → Account: your own account, billing, and closing the business. */
export function AccountTab({ isOwner, businessName }: { isOwner: boolean; businessName: string }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const row = "flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Your account</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Link href="/account" className={row}><span className="flex items-center gap-2"><Bell size={15} className="text-blue-600" /> Email notifications</span><span className="text-blue-600">→</span></Link>
          {isOwner && (
            <Link href="/billing" className={row}><span className="flex items-center gap-2"><CreditCard size={15} className="text-blue-600" /> Billing and subscription</span><span className="text-blue-600">→</span></Link>
          )}
          <p className="px-1 text-xs text-slate-500">Change your password under Security.</p>
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader><CardTitle><Trash2 size={16} className="mr-2 inline text-red-600" />Close account</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-700">
              Cancels your subscription straight away and permanently deletes <strong>{businessName}</strong>: every customer,
              area, day, job, payment, invoice record, text and setting. Your team lose access too. This can&apos;t be undone.
            </p>
            <a href="/api/backup" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Download size={14} /> Download a backup first
            </a>
            <label className="block text-xs text-slate-600">
              Type <strong>DELETE</strong> to confirm
              <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm" />
            </label>
            <button
              type="button"
              disabled={pending || typed.trim().toUpperCase() !== "DELETE"}
              onClick={() => start(async () => {
                setError("");
                try {
                  await closeBusiness(typed);
                  await signOut({ callbackUrl: "/auth/signin" });
                } catch (e) {
                  setError(e instanceof Error && e.message ? e.message : "Something went wrong. Nothing was deleted.");
                }
              })}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
            >
              <Trash2 size={14} /> {pending ? "Closing…" : "Close account and delete everything"}
            </button>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
