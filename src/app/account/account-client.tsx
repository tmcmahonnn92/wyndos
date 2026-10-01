"use client";

import { useState, useTransition } from "react";
import { Bell, Clock } from "lucide-react";
import { saveMyNotifyPrefs } from "@/lib/account-actions";
import type { NotifyPrefs } from "@/lib/notifications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AccountClient({ prefs: initial, email, followsDays, emailReady }: {
  prefs: NotifyPrefs;
  email: string;
  followsDays: boolean;
  emailReady: boolean;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [saved, setSaved] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = (key: keyof NotifyPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaved(null);
    startTransition(async () => {
      await saveMyNotifyPrefs(next);
      setSaved("Saved");
    });
  };

  const options: Array<{ key: keyof NotifyPrefs; title: string; desc: string; show: boolean }> = [
    { key: "workAssigned", title: "Work is given to me", desc: "A day, or some jobs, are assigned to you.", show: true },
    { key: "dayStarted", title: "A day is started", desc: "Someone presses Start day (or ticks off the first job).", show: followsDays },
    { key: "dayCompleted", title: "A day is completed", desc: "With how many were done and what was cleaned.", show: followsDays },
  ];

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-5">
      <h1 className="text-xl font-bold text-slate-800">My account</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bell size={15} className="text-blue-600" /> Email me when…</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!emailReady && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Email isn&apos;t switched on for Wyndos yet, so nothing will be sent until it is.
            </p>
          )}
          {options.filter((o) => o.show).map((o) => (
            <label key={o.key} className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3">
              <span>
                <span className="block text-sm font-semibold text-slate-800">{o.title}</span>
                <span className="block text-xs text-slate-500">{o.desc}</span>
              </span>
              <input type="checkbox" className="mt-1 h-5 w-5 accent-blue-600" checked={prefs[o.key]} disabled={isPending} onChange={() => toggle(o.key)} />
            </label>
          ))}
          <p className="flex items-start gap-1.5 pt-1 text-xs text-slate-500">
            <Clock size={13} className="mt-0.5 flex-shrink-0" />
            Emails wait a minute before sending, so something started and undone straight away doesn&apos;t send anything, and several changes arrive as one email.
          </p>
          <p className="text-xs text-slate-400">Sent to {email || "your sign-in email"}. {saved}</p>
        </CardContent>
      </Card>
    </div>
  );
}
