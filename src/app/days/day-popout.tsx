"use client";

import Link from "next/link";
import {
  X,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Circle,
  SkipForward,
  ExternalLink,
  Zap,
} from "lucide-react";
import { fmtCurrency, cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Job = {
  id: number;
  price: number;
  status: string;
  isOneOff: boolean;
  customer: { id: number; name: string; address: string } | null;
};

type Day = {
  id: number;
  date: Date | string;
  status: string;
  areaId: number | null;
  area: { id: number; name: string; color: string } | null;
  jobs: Job[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayMidnight(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function dayMidnight(d: Date | string): Date {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function areaLabel(day: Day): string {
  if (day.area) return day.area.name;
  const addr = day.jobs[0]?.customer?.address;
  return addr ? addr.split(",")[0] : "One-off";
}

function formatFullDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ── Job status icon ───────────────────────────────────────────────────────────

function JobStatusIcon({ status }: { status: string }) {
  if (status === "COMPLETE")
    return <CheckCircle2 size={15} className="text-green-500 flex-shrink-0" />;
  if (status === "OUTSTANDING")
    return <AlertTriangle size={15} className="text-orange-500 flex-shrink-0" />;
  if (status === "SKIPPED" || status === "MOVED")
    return <SkipForward size={15} className="text-slate-400 flex-shrink-0" />;
  return <Circle size={15} className="text-slate-300 flex-shrink-0" />;
}

// ── Day Popout Panel ──────────────────────────────────────────────────────────

interface DayPopoutProps {
  day: Day | null;
  onClose: () => void;
  hidePrices?: boolean;
}

export function DayPopout({ day, onClose, hidePrices = false }: DayPopoutProps) {
  const isOpen = day !== null;
  const today = todayMidnight();
  const isOverdue =
    day && dayMidnight(day.date) < today && day.status !== "COMPLETE";

  const totalValue = day ? day.jobs.reduce((s, j) => s + j.price, 0) : 0;
  const doneCount = day ? day.jobs.filter((j) => j.status === "COMPLETE").length : 0;
  const oneOffCount = day ? day.jobs.filter((j) => j.isOneOff).length : 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 bg-black/30 z-40 transition-opacity duration-300",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      />

      {/* Slide-in panel */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full w-[380px] max-w-[95vw] bg-white shadow-2xl z-50",
          "flex flex-col transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {day && (
          <>
            {/* Header */}
            <div
              className="flex items-start justify-between px-5 py-4 border-b border-slate-100"
              style={{
                borderTopColor: day.area?.color || "#3B82F6",
                borderTopWidth: 4,
              }}
            >
              <div className="flex-1 min-w-0 pr-3">
                <p className="text-xs text-slate-500 font-medium">
                  {formatFullDate(day.date)}
                </p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {/* Area badge */}
                  <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-800">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: day.area?.color || "#94a3b8" }}
                    />
                    {areaLabel(day)}
                  </span>
                  {/* Status badge */}
                  {day.status === "COMPLETE" ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-700 border border-green-200">
                      <CheckCircle2 size={10} /> Complete
                    </span>
                  ) : day.status === "IN_PROGRESS" ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
                      <Clock size={10} /> In Progress
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500">
                      Planned
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            {/* Summary row */}
            <div className="flex items-center gap-4 px-5 py-3 bg-slate-50 border-b border-slate-100 text-sm">
              <span className="font-bold text-slate-800">{hidePrices ? null : fmtCurrency(totalValue)}</span>
              <span className="text-slate-400 text-xs">·</span>
              <span className="text-slate-600">{day.jobs.length} job{day.jobs.length !== 1 ? "s" : ""}</span>
              {doneCount > 0 && (
                <>
                  <span className="text-slate-400 text-xs">·</span>
                  <span className="text-green-700 font-medium">{doneCount} done</span>
                </>
              )}
              {oneOffCount > 0 && (
                <>
                  <span className="text-slate-400 text-xs">·</span>
                  <span className="inline-flex items-center gap-0.5 text-purple-600 font-medium">
                    <Zap size={11} />{oneOffCount} one-off
                  </span>
                </>
              )}
            </div>

            {/* Overdue warning */}
            {isOverdue && (
              <div className="flex items-center gap-2 px-5 py-2.5 bg-red-50 border-b border-red-100 text-red-700 text-xs font-semibold">
                <AlertTriangle size={13} />
                This day is overdue and not yet complete
              </div>
            )}

            {/* Job list */}
            <div className="flex-1 overflow-y-auto">
              {day.jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-slate-400 text-sm">
                  No jobs on this day
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {day.jobs.map((job) => (
                    <li
                      key={job.id}
                      className={cn(
                        "flex items-center gap-3 px-5 py-3",
                        job.status === "COMPLETE" && "opacity-60"
                      )}
                    >
                      <JobStatusIcon status={job.status} />
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-sm font-semibold text-slate-800 truncate",
                            job.status === "COMPLETE" && "line-through text-slate-400"
                          )}
                        >
                          {job.customer?.name ?? "Unknown"}
                          {job.isOneOff && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full">
                              <Zap size={8} /> one-off
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {job.customer?.address ?? "—"}
                        </p>
                      </div>
                      <span className="text-sm font-bold text-slate-700 flex-shrink-0 tabular-nums">
                        {hidePrices ? null : fmtCurrency(job.price)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-100 bg-white">
              <Link
                href={`/days/${day.id}`}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-colors"
              >
                Open Full Day
                <ExternalLink size={14} />
              </Link>
            </div>
          </>
        )}
      </div>
    </>
  );
}
