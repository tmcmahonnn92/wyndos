"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SharePdfButton } from "@/components/share-pdf-button";
import { CloudRain, Printer, UserRound, Undo2, Users, X } from "lucide-react";
import { assignJobs, assignWorkDayWorker, moveJobsToDate, rescheduleWorkDay, takeBackWork } from "@/lib/actions";

export type TeamMember = { id: string; name: string; role: string; isMe: boolean };

type BarJob = {
  id: number;
  status: string;
  assignedUserId: string | null;
  customer: { name: string };
};

interface Props {
  dayId: number;
  dayStatus: string;
  dayAssignedUserId: string | null;
  jobs: BarJob[];
  team: TeamMember[] | null; // null = viewer is a worker (no assigning)
  /** Where Print goes; null hides it (the whole-day view has its own Print). */
  printHref?: string | null;
  /** PDF for the Share button (same sheet as Print). */
  pdfHref?: string | null;
  /** Start the Print/Share sheet on one person's jobs ("me" or a user id). */
  defaultPrintWorker?: string | null;
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Owner tools for a day, usable on a phone: who the day belongs to, per-job
 * assignment ("keep this one" / "send this one to Jake"), take back, rained off,
 * and print. Workers only see the Print button.
 */
export function DayTeamBar({
  dayId,
  dayStatus,
  dayAssignedUserId,
  jobs,
  team,
  printHref = `/days/${dayId}/print?sort=area`,
  pdfHref = `/api/run-sheet?day=${dayId}&sort=area`,
  defaultPrintWorker = null,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "assign" | "rain">("none");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [assignTo, setAssignTo] = useState<string>("");
  const [assignDate, setAssignDate] = useState<string>("");
  const [rainDate, setRainDate] = useState<string>(tomorrowISO());

  const me = team?.find((member) => member.isMe) ?? null;
  const nameOf = (userId: string | null) => {
    if (!userId) return me?.name ?? "You";
    const member = team?.find((entry) => entry.id === userId);
    if (!member) return "Someone else";
    return member.isMe ? "You" : member.name;
  };

  // "Jake 9 · You 2": who is doing the unfinished jobs on this day.
  const counts = new Map<string, number>();
  for (const job of jobs) {
    if (job.status !== "PENDING") continue;
    const who = job.assignedUserId ?? dayAssignedUserId ?? me?.id ?? "owner";
    counts.set(who, (counts.get(who) ?? 0) + 1);
  }
  const split = [...counts.entries()].map(([id, count]) => ({ id, count }));

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        setPanel("none");
        setSelected(new Set());
        router.refresh();
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Something went wrong.");
      }
    });
  };

  const pendingJobs = jobs.filter((job) => job.status === "PENDING");
  // Print / share one person's jobs when the day is split between people.
  const [printWorker, setPrintWorker] = useState<string>(defaultPrintWorker ?? "");
  const withWorker = (href: string) => (printWorker ? `${href}${href.includes("?") ? "&" : "?"}worker=${printWorker}` : href);
  const printFor = split.length > 1 && team;
  const isOwner = team !== null;
  const workers = (team ?? []).filter((member) => !member.isMe);

  return (
    <div className="space-y-2">
        {isOwner && (
          <label className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <UserRound size={15} className="flex-shrink-0 text-slate-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Day</span>
            <select
              aria-label="Who is doing this day"
              value={dayAssignedUserId ?? ""}
              disabled={isPending || dayStatus === "COMPLETE"}
              onChange={(event) => run(() => assignWorkDayWorker(dayId, event.target.value || null))}
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-800 focus:outline-none"
            >
              <option value="">{me?.name ?? "Me"} (you)</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>{worker.name}</option>
              ))}
            </select>
          </label>
        )}
      {printHref && printFor && (
        <label className="flex items-center gap-2 px-1 text-xs text-slate-600">
          Print / share for
          <select value={printWorker} onChange={(e) => setPrintWorker(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold">
            <option value="">Everyone</option>
            {split.map((entry) => (
              <option key={entry.id ?? "me"} value={!entry.id || entry.id === me?.id ? "me" : entry.id}>
                {nameOf(entry.id === me?.id ? null : entry.id)} ({entry.count})
              </option>
            ))}
          </select>
        </label>
      )}

      {isOwner && split.length > 1 && (
        <p className="px-1 text-xs text-slate-500">
          {split.map((entry) => `${nameOf(entry.id === me?.id ? null : entry.id)} ${entry.count}`).join(" · ")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {printHref && <Link
          href={withWorker(printHref)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Printer size={13} /> Print
        </Link>}
        {printHref && pdfHref && (
          <SharePdfButton
            href={withWorker(pdfHref)}
            fileName={`run-sheet-${dayId}${printWorker ? `-${nameOf(printWorker === "me" ? null : printWorker).replace(/\s+/g, "-")}` : ""}.pdf`}
            title="Run sheet"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          />
        )}
      {isOwner && dayStatus !== "COMPLETE" && (
        <>
          <button
            type="button"
            onClick={() => setPanel(panel === "assign" ? "none" : "assign")}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
          >
            <Users size={13} /> Assign / move jobs
          </button>
          {dayAssignedUserId && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => takeBackWork(dayId))}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              <Undo2 size={13} /> Take back day
            </button>
          )}
          <button
            type="button"
            onClick={() => setPanel(panel === "rain" ? "none" : "rain")}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
          >
            <CloudRain size={13} /> Rained off
          </button>
        </>
      )}
      </div>

      {panel === "rain" && (
        <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
          <p className="text-xs text-sky-900">Move this whole day to another date. Nothing is marked done or skipped.</p>
          <div className="flex gap-2">
            <input
              type="date"
              value={rainDate}
              onChange={(event) => setRainDate(event.target.value)}
              className="flex-1 rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={isPending || !rainDate}
              onClick={() => run(() => rescheduleWorkDay(dayId, rainDate, "one-off"))}
              className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Move day
            </button>
          </div>
        </div>
      )}

      {panel === "assign" && (
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-blue-900">Tick jobs, then give them to someone or move them to another day</p>
            <button type="button" onClick={() => setPanel("none")} aria-label="Close" className="text-blue-700">
              <X size={14} />
            </button>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {pendingJobs.map((job) => (
              <label key={job.id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(job.id)}
                  onChange={() => setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(job.id)) next.delete(job.id); else next.add(job.id);
                    return next;
                  })}
                />
                <span className="min-w-0 flex-1 truncate">{job.customer.name}</span>
                <span className="flex-shrink-0 text-[11px] text-slate-500">
                  {nameOf(job.assignedUserId ?? dayAssignedUserId)}
                </span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <select
              aria-label="Give selected jobs to"
              value={assignTo}
              onChange={(event) => setAssignTo(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-2 py-2 text-sm"
            >
              <option value="">Choose person…</option>
              {me && <option value={me.id}>{me.name} (you)</option>}
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>{worker.name}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={isPending || selected.size === 0 || !assignTo}
              onClick={() => run(() => assignJobs([...selected], assignTo))}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Assign {selected.size || ""}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="date"
              aria-label="Move selected jobs to date"
              value={assignDate}
              onChange={(event) => setAssignDate(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-2 py-2 text-sm"
            />
            <button
              type="button"
              disabled={isPending || selected.size === 0 || !assignDate}
              onClick={() => run(() => moveJobsToDate([...selected], assignDate))}
              className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-semibold text-blue-800 disabled:opacity-50"
            >
              Move {selected.size || ""} to this day
            </button>
          </div>
          <p className="text-[11px] text-blue-800">
            Moved jobs stay in this area as a split: the area&apos;s next visit is booked once both parts are done, and everyone stays together.
          </p>
          {dayAssignedUserId && (
            <button
              type="button"
              disabled={isPending || selected.size === 0}
              onClick={() => run(() => takeBackWork(dayId, [...selected]))}
              className="w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-semibold text-blue-800 disabled:opacity-50"
            >
              Take back selected
            </button>
          )}
        </div>
      )}

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
