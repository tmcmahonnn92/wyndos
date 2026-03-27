"use client";

import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  CalendarDays,
  CalendarX,
  Zap,
} from "lucide-react";
import { fmtCurrency } from "@/lib/utils";
import { CalendarView } from "./calendar-view";

// ── Types ─────────────────────────────────────────────────────────────────────

type Job = {
  id: number;
  price: number;
  status: string;
  isOneOff: boolean;
  customer: { id: number; name: string; address: string } | null;
};

type Area = {
  id: number;
  name: string;
  sortOrder: number;
  scheduleType: string;
  frequencyWeeks: number;
  monthlyDay: number | null;
  nextDueDate: Date | string | null;
  estimatedValue: number;
  _count: { customers: number };
};

type Day = {
  id: number;
  date: Date | string;
  status: string;
  areaId: number | null;
  area: { id: number; name: string; color: string } | null;
  jobs: Job[];
};

type Holiday = {
  id: number;
  startDate: Date | string;
  endDate: Date | string;
  label: string;
};

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function dayMidnight(d: Date | string): Date {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function todayMidnight(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function areaLabel(day: Day): string {
  if (day.area) return day.area.name;
  const addr = day.jobs[0]?.customer?.address;
  return addr ? addr.split(",")[0] : "One-off";
}

function fmtDate(d: Date | string): string {
  return dayMidnight(d).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// ── Day Card ──────────────────────────────────────────────────────────────────

function DayCard({ day, isToday, hidePrices }: { day: Day; isToday: boolean; hidePrices: boolean }) {
  const total = day.jobs.length;
  const done = day.jobs.filter((j) => j.status === "COMPLETE").length;
  const outstanding = day.jobs.filter((j) => j.status === "OUTSTANDING").length;
  const oneOffs = day.jobs.filter((j) => j.isOneOff).length;
  const value = day.jobs.reduce((s, j) => s + j.price, 0);
  const areaColor = day.area?.color || "#3B82F6";
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const isComplete = day.status === "COMPLETE";
  const isActive = day.status === "IN_PROGRESS";

  return (
    <Link
      href={`/days/${day.id}`}
      className={[
        "group relative flex overflow-hidden rounded-2xl border transition-all hover:shadow-md active:scale-[0.995]",
        isComplete
          ? "border-green-200 bg-green-50 hover:bg-green-100/60"
          : isActive
          ? "border-blue-200 bg-blue-50/60 hover:bg-blue-100/40 shadow-sm"
          : "border-slate-200 bg-white hover:bg-slate-50/80",
      ].join(" ")}
    >
      {/* Left colour stripe */}
      <div
        className="w-1 flex-shrink-0"
        style={{ backgroundColor: isComplete ? "#22c55e" : areaColor }}
      />

      <div className="flex-1 px-4 py-3 min-w-0">
        {/* Row 1: area name + status badge */}
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            {isToday && (
              <span className="w-2 h-2 rounded-full bg-blue-500 block animate-pulse flex-shrink-0" />
            )}
            {isActive && !isToday && (
              <Clock size={13} className="text-blue-500 flex-shrink-0 animate-pulse" />
            )}
            <span className="font-bold text-sm text-slate-800 truncate">
              {areaLabel(day)}
            </span>
            {isToday && (
              <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">
                Today
              </span>
            )}
          </div>

          {isComplete ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200 flex-shrink-0 whitespace-nowrap">
              <CheckCircle2 size={11} />
              Done {done}/{total}
            </span>
          ) : isActive ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200 flex-shrink-0 whitespace-nowrap">
              <Clock size={11} />
              Active {done}/{total}
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 flex-shrink-0 whitespace-nowrap">
              {total} job{total !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Row 2: date + meta */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-slate-500">{fmtDate(day.date)}</span>
          <span className="text-xs text-slate-300">·</span>
          <span
            className="text-sm font-bold tabular-nums"
            style={{ color: isComplete ? "#16a34a" : "#1e40af" }}
          >
            {hidePrices ? null : fmtCurrency(value)}
          </span>
          {outstanding > 0 && (
            <>
              <span className="text-xs text-slate-300">·</span>
              <span className="text-xs font-semibold text-red-600">
                {outstanding} outstanding
              </span>
            </>
          )}
          {oneOffs > 0 && (
            <>
              <span className="text-xs text-slate-300">·</span>
              <span className="inline-flex items-center gap-0.5 text-xs text-purple-600 font-medium">
                <Zap size={9} />
                {oneOffs} one-off
              </span>
            </>
          )}
          <span className="ml-auto text-xs font-semibold text-slate-400 group-hover:text-blue-500 transition-colors flex-shrink-0">
            Open →
          </span>
        </div>

        {/* Progress bar — active or complete */}
        {total > 0 && (isActive || isComplete) && (
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                isComplete ? "bg-green-500" : "bg-blue-500"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
    </Link>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
        {label}
      </span>
      {count > 0 && (
        <span className="text-xs font-semibold text-slate-300">{count}</span>
      )}
      <div className="flex-1 h-px bg-slate-100" />
    </div>
  );
}

// ── Main client component ─────────────────────────────────────────────────────

export function SchedulePageClient({
  days,
  holidays,
  hidePrices = false,
}: {
  days: Day[];
  areas: Area[];
  holidays: Holiday[];
  hidePrices?: boolean;
}) {
  const today = todayMidnight();
  const todayISO = isoDate(today);

  const todayDays = days.filter(
    (d) => isoDate(dayMidnight(d.date)) === todayISO
  );

  return (
    <div className="space-y-4">
      {/* Today */}
      <div className="space-y-2">
        <SectionLabel label="Today" count={todayDays.length} />
        {todayDays.length > 0 ? (
          todayDays.map((d) => <DayCard key={d.id} day={d} isToday hidePrices={hidePrices} />)
        ) : (
          <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-dashed border-slate-200 bg-slate-50">
            <CalendarDays size={18} className="text-slate-300 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-500">
                Nothing scheduled today
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Head to Scheduler to plan a run.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Empty state */}
      {days.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <CalendarX size={32} className="text-slate-300" />
          <p className="text-sm text-slate-400">No work days scheduled yet.</p>
          <p className="text-xs text-slate-400">Head to Scheduler to plan runs.</p>
        </div>
      )}

      {/* Calendar */}
      {days.length > 0 && (
        <div className="pt-2">
          <SectionLabel label="Calendar" count={0} />
          <div className="mt-2">
            <CalendarView days={days} holidays={holidays} hidePrices={hidePrices} />
          </div>
        </div>
      )}
    </div>
  );
}
