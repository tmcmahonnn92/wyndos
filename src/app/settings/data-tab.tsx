"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash2 } from "lucide-react";
import { clearAllData, clearScheduleAndHistory } from "@/lib/data-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BackupCard } from "./backup-card";

export type DataCounts = {
  customers: number; areas: number; workDays: number; jobs: number;
  payments: number; expenses: number; otherIncome: number; texts: number;
};

const EXPORTS = [
  { kind: "customers", label: "Customers", hint: "Everyone, with address parts, price, frequency, area and what they owe" },
  { kind: "jobs", label: "Jobs to do", hint: "Every booked visit not done yet" },
  { kind: "history", label: "Job history", hint: "Every visit done, skipped or moved, with who did it and what was paid" },
  { kind: "finances", label: "Finances", hint: "Customer payments, expenses and other income" },
];

function DangerAction({
  title,
  body,
  word,
  button,
  run,
}: {
  title: string;
  body: React.ReactNode;
  word: string;
  button: string;
  run: (typed: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="space-y-2 rounded-xl border border-red-200 bg-red-50/40 p-3">
      <p className="text-sm font-semibold text-red-800">{title}</p>
      <div className="text-xs text-slate-700">{body}</div>
      <label className="block text-xs text-slate-600">
        Type <strong>{word}</strong> to confirm
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-1 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm"
        />
      </label>
      <button
        type="button"
        disabled={isPending || typed.trim().toUpperCase() !== word}
        onClick={() => startTransition(async () => {
          try {
            await run(typed);
            setTyped("");
            setMessage("Done.");
            router.refresh();
          } catch (issue) {
            setMessage(issue instanceof Error ? issue.message : "Something went wrong.");
          }
        })}
        className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
      >
        <Trash2 size={14} /> {isPending ? "Clearing…" : button}
      </button>
      {message && <p className="text-xs font-semibold text-slate-700">{message}</p>}
    </div>
  );
}

export function DataTab({ counts }: { counts: DataCounts | null }) {
  return (
    <div className="space-y-4">
      <BackupCard />
      <Card>
        <CardHeader><CardTitle><Download size={16} className="inline mr-2 text-blue-600" />Export</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-slate-500">CSV files that open in Excel or Google Sheets.</p>
          {EXPORTS.map((e) => (
            <a
              key={e.kind}
              href={`/api/export/${e.kind}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50"
            >
              <span>
                <span className="block text-sm font-semibold text-slate-800">{e.label}</span>
                <span className="block text-xs text-slate-500">{e.hint}</span>
              </span>
              <Download size={16} className="flex-shrink-0 text-blue-600" />
            </a>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle><Trash2 size={16} className="inline mr-2 text-red-600" />Start again</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-600">These can&apos;t be undone, except by restoring a backup. Download one first.</p>
          <DangerAction
            title="Clear the schedule and all history"
            word="CLEAR"
            button="Clear schedule and history"
            run={clearScheduleAndHistory}
            body={
              <>
                Deletes every work day and visit (booked and done), customer payments and texts
                {counts && ` (${counts.workDays} days, ${counts.jobs} visits, ${counts.payments} payments)`}.
                <br />
                <strong>Keeps</strong> your customers and areas (price, frequency, notes, order), so you can schedule from scratch.
                Expenses and other income are kept too.
              </>
            }
          />
          <DangerAction
            title="Clear everything"
            word="DELETE EVERYTHING"
            button="Clear everything"
            run={clearAllData}
            body={
              <>
                Deletes all customers, areas, the schedule, history, payments, expenses, income, tags, holidays and texts
                {counts && ` (${counts.customers} customers, ${counts.areas} areas, ${counts.jobs} visits, ${counts.payments + counts.expenses + counts.otherIncome} money records)`}.
                <br />
                <strong>Keeps</strong> your business details, settings, text templates and team.
              </>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
