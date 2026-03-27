"use client";

import { useState, useRef } from "react";
import { ChevronLeft, ChevronRight, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { DayPopout } from "./day-popout";

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

type Holiday = {
  id: number;
  startDate: Date | string;
  endDate: Date | string;
  label: string;
};

type ViewMode = "month" | "week" | "3day";

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

function addDays(d: Date, n: number): Date {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getMondayOfWeek(d: Date): Date {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function getMonthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// ── Range label ───────────────────────────────────────────────────────────────

function getRangeLabel(viewMode: ViewMode, anchor: Date): string {
  if (viewMode === "month") {
    return anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }
  if (viewMode === "week") {
    const monday = getMondayOfWeek(anchor);
    const sunday = addDays(monday, 6);
    const start = monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const end = sunday.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return `${start} – ${end}`;
  }
  // 3day: anchor is the first of 3 days
  const end = addDays(anchor, 2);
  const start = anchor.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const endStr = end.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${start} – ${endStr}`;
}

// ── Navigate anchor ───────────────────────────────────────────────────────────

function navigate(viewMode: ViewMode, anchor: Date, dir: -1 | 1): Date {
  if (viewMode === "month") {
    const d = new Date(anchor);
    d.setMonth(d.getMonth() + dir);
    return d;
  }
  if (viewMode === "week") return addDays(anchor, dir * 7);
  return addDays(anchor, dir * 3);
}

// ── Build date columns ────────────────────────────────────────────────────────

function getDateColumns(viewMode: ViewMode, anchor: Date): Date[] {
  if (viewMode === "month") {
    const monthStart = getMonthStart(anchor);
    const gridStart = getMondayOfWeek(monthStart);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }
  if (viewMode === "week") {
    const monday = getMondayOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }
  // 3day
  return [anchor, addDays(anchor, 1), addDays(anchor, 2)];
}

// ── Day chip ──────────────────────────────────────────────────────────────────

interface DayChipProps {
  day: Day;
  compact?: boolean;
  showCustomers?: boolean;
  onClick: (id: number) => void;
}

function DayChip({ day, compact = false, showCustomers = false, onClick }: DayChipProps) {
  const color =
    day.status === "COMPLETE"
      ? "#22c55e"
      : day.area?.color || "#3b82f6";

  const label = day.area?.name ?? "One-off";
  const count = day.jobs.length;
  const doneCount = day.jobs.filter((j) => j.status === "COMPLETE").length;
  const jobValue = day.jobs.reduce((s, j) => s + j.price, 0);
  const previewCustomers = showCustomers
    ? day.jobs
        .filter((j) => j.customer)
        .slice(0, 3)
        .map((j) => j.customer!.name.split(" ")[0])
    : [];

  return (
    <button
      onClick={() => onClick(day.id)}
      className={cn(
        "w-full text-left rounded-lg px-1.5 py-1 transition-opacity hover:opacity-80 active:scale-95",
        compact ? "min-h-[22px]" : "min-h-[36px]"
      )}
      style={{ backgroundColor: color }}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={cn(
            "font-bold text-white truncate leading-tight",
            compact ? "text-[9px]" : "text-[11px]"
          )}
        >
          {compact && day.status === "COMPLETE" ? `✓ ${label}` : label}
        </span>
        <span
          className={cn(
            "text-white/80 flex-shrink-0 font-medium",
            compact ? "text-[9px]" : "text-[10px]"
          )}
        >
          {day.status === "COMPLETE" ? (
            <CheckCircle2 size={compact ? 9 : 11} />
          ) : day.status === "IN_PROGRESS" ? (
            <Clock size={compact ? 9 : 11} />
          ) : (
            `${count}j`
          )}
        </span>
      </div>
      {!compact && (
        <div className="text-[9px] text-white/70 mt-0.5 leading-tight">
          {doneCount > 0
            ? `${doneCount}/${count} done · £${jobValue.toFixed(0)}`
            : `${count} job${count !== 1 ? "s" : ""} · £${jobValue.toFixed(0)}`}
        </div>
      )}
      {showCustomers && previewCustomers.length > 0 && (
        <div className="text-[9px] text-white/60 mt-0.5 truncate leading-tight">
          {previewCustomers.join(", ")}
          {day.jobs.filter((j) => j.customer).length > 3 ? " …" : ""}
        </div>
      )}
    </button>
  );
}

// ── Header row ────────────────────────────────────────────────────────────────

const DAY_HEADERS_FULL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Calendar View ─────────────────────────────────────────────────────────────

interface CalendarViewProps {
  days: Day[];
  holidays?: Holiday[];
  hidePrices?: boolean;
}

export function CalendarView({ days, holidays = [], hidePrices = false }: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => typeof window !== "undefined" && window.innerWidth < 768 ? "3day" : "month"
  );
  const [anchor, setAnchor] = useState<Date>(() => {
    const t = todayMidnight();
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    // For mobile (3day): anchor to today. For desktop (month): anchor to month start.
    if (isMobile) return t;
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [selectedDayId, setSelectedDayId] = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);

  const today = todayMidnight();
  const todayISO = isoDate(today);

  // Build a map of ISO date → Day[]
  const daysByDate = new Map<string, Day[]>();
  for (const d of days) {
    const key = isoDate(dayMidnight(d.date));
    const arr = daysByDate.get(key) ?? [];
    arr.push(d);
    daysByDate.set(key, arr);
  }

  // Helper: is a given ISO date string covered by any holiday?
  function isHolidayDate(iso: string): boolean {
    return holidays.some((h) => {
      const start = isoDate(dayMidnight(h.startDate));
      const end = isoDate(dayMidnight(h.endDate));
      return iso >= start && iso <= end;
    });
  }

  // Selected Day object for popout
  const selectedDay = selectedDayId != null ? days.find((d) => d.id === selectedDayId) ?? null : null;

  // Navigation
  function handlePrev() {
    setAnchor((a) => navigate(viewMode, a, -1));
  }
  function handleNext() {
    setAnchor((a) => navigate(viewMode, a, 1));
  }
  function handleToday() {
    const t = todayMidnight();
    if (viewMode === "month") setAnchor(new Date(t.getFullYear(), t.getMonth(), 1));
    else if (viewMode === "week") setAnchor(getMondayOfWeek(t));
    else setAnchor(t);
  }

  // Switch view — reset anchor appropriately
  function switchView(mode: ViewMode) {
    const t = todayMidnight();
    if (mode === "month") setAnchor(new Date(t.getFullYear(), t.getMonth(), 1));
    else if (mode === "week") setAnchor(getMondayOfWeek(t));
    else setAnchor(t);
    setViewMode(mode);
  }

  const dateColumns = getDateColumns(viewMode, anchor);

  // Determine if today button should pulse
  const isAtToday =
    viewMode === "month"
      ? anchor.getFullYear() === today.getFullYear() && anchor.getMonth() === today.getMonth()
      : viewMode === "week"
      ? isoDate(getMondayOfWeek(anchor)) === isoDate(getMondayOfWeek(today))
      : dateColumns.some((d) => isoDate(d) === todayISO);

  // ── Month grid ──────────────────────────────────────────────────────────────

  const currentMonth = anchor.getMonth();

  function renderMonthGrid() {
    return (
      <div className="flex-1 overflow-auto">
        {/* Day headers — sticky so they stay visible on mobile scroll */}
        <div className="sticky top-0 z-10 grid grid-cols-7 border-b border-slate-200 bg-white">
          {DAY_HEADERS_FULL.map((h) => (
            <div
              key={h}
              className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-500 py-2"
            >
              {h.slice(0, 1)}<span className="hidden sm:inline">{h.slice(1)}</span>
            </div>
          ))}
        </div>
        {/* 6-week grid */}
        <div className="grid grid-cols-7" style={{ minHeight: 0 }}>
          {dateColumns.map((d, i) => {
            const iso = isoDate(d);
            const isToday = iso === todayISO;
            const inMonth = d.getMonth() === currentMonth;
            const isPast = d < today;
            const cellDays = daysByDate.get(iso) ?? [];
            const hasOverdue =
              isPast && cellDays.some((cd) => cd.status !== "COMPLETE");
            const allComplete = cellDays.length > 0 && cellDays.every((cd) => cd.status === "COMPLETE");
            const onHoliday = isHolidayDate(iso);

            return (
              <div
                key={iso}
                className={cn(
                  "relative border-b border-r border-slate-100 p-1 flex flex-col gap-0.5 min-h-[90px]",
                  !inMonth && "bg-slate-50/60",
                  isToday && !allComplete && "bg-blue-50",
                  allComplete && "bg-green-50"
                )}
              >
                {onHoliday && (
                  <div className="absolute inset-0 bg-slate-300/40 pointer-events-none z-10" />
                )}
                {/* Date number */}
                <div className="flex items-center gap-1 mb-0.5">
                  <span
                    className={cn(
                      "w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold leading-none",
                      isToday
                        ? "bg-blue-600 text-white"
                        : !inMonth
                        ? "text-slate-300"
                        : isPast
                        ? "text-slate-400"
                        : "text-slate-700"
                    )}
                  >
                    {d.getDate()}
                  </span>
                  {hasOverdue && (
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                  )}
                </div>
                {/* Day chips */}
                <div className="flex flex-col gap-0.5">
                  {cellDays.map((cd) => (
                    <DayChip
                      key={cd.id}
                      day={cd}
                      compact
                      onClick={setSelectedDayId}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Week grid ───────────────────────────────────────────────────────────────

  function renderWeekGrid() {
    return (
      <div className="flex-1 overflow-auto">
        <div
          className="sticky top-0 z-10 bg-white grid border-b border-slate-200"
          style={{ gridTemplateColumns: `repeat(${dateColumns.length}, minmax(0, 1fr))` }}
        >
          {dateColumns.map((d) => {
            const iso = isoDate(d);
            const isToday = iso === todayISO;
            return (
              <div
                key={iso}
                className={cn(
                  "text-center py-3 px-1 border-r border-slate-100 last:border-r-0",
                  isToday ? "bg-blue-50" : ""
                )}
              >
                <div
                  className={cn(
                    "text-[10px] font-bold uppercase tracking-wide",
                    isToday ? "text-blue-600" : "text-slate-500"
                  )}
                >
                  {d.toLocaleDateString("en-GB", { weekday: "short" })}
                </div>
                <div
                  className={cn(
                    "mx-auto mt-1 w-7 h-7 flex items-center justify-center rounded-full text-sm font-bold",
                    isToday ? "bg-blue-600 text-white" : "text-slate-700"
                  )}
                >
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>
        <div
          className="grid gap-0"
          style={{
            gridTemplateColumns: `repeat(${dateColumns.length}, minmax(0, 1fr))`,
            minHeight: "300px",
          }}
        >
          {dateColumns.map((d) => {
            const iso = isoDate(d);
            const isToday = iso === todayISO;
            const isPast = d < today;
            const cellDays = daysByDate.get(iso) ?? [];
            const hasOverdue = isPast && cellDays.some((cd) => cd.status !== "COMPLETE");
            const onHoliday = isHolidayDate(iso);

            return (
              <div
                key={iso}
                className={cn(
                  "relative border-r border-slate-100 last:border-r-0 p-2 flex flex-col gap-1.5 min-h-[120px]",
                  isToday && "bg-blue-50/50",
                  hasOverdue && "border-l-2 border-l-red-400"
                )}
              >
                {onHoliday && (
                  <div className="absolute inset-0 bg-slate-300/40 pointer-events-none z-10" />
                )}
                {cellDays.map((cd) => (
                  <DayChip key={cd.id} day={cd} onClick={setSelectedDayId} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── 3-Day grid ──────────────────────────────────────────────────────────────

  function render3DayGrid() {
    return (
      <div className="flex-1 overflow-auto">
        <div className="sticky top-0 z-10 bg-white grid grid-cols-3 border-b border-slate-200">
          {dateColumns.map((d) => {
            const iso = isoDate(d);
            const isToday = iso === todayISO;
            return (
              <div
                key={iso}
                className={cn(
                  "text-center py-3 px-2 border-r border-slate-100 last:border-r-0",
                  isToday && "bg-blue-50"
                )}
              >
                <div
                  className={cn(
                    "text-xs font-bold uppercase tracking-wide",
                    isToday ? "text-blue-600" : "text-slate-500"
                  )}
                >
                  {d.toLocaleDateString("en-GB", { weekday: "long" })}
                </div>
                <div
                  className={cn(
                    "mx-auto mt-1 w-8 h-8 flex items-center justify-center rounded-full text-base font-bold",
                    isToday ? "bg-blue-600 text-white" : "text-slate-700"
                  )}
                >
                  {d.getDate()}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {d.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-0" style={{ minHeight: "300px" }}>
          {dateColumns.map((d) => {
            const iso = isoDate(d);
            const isToday = iso === todayISO;
            const isPast = d < today;
            const cellDays = daysByDate.get(iso) ?? [];
            const hasOverdue = isPast && cellDays.some((cd) => cd.status !== "COMPLETE");
            const onHoliday = isHolidayDate(iso);

            return (
              <div
                key={iso}
                className={cn(
                  "relative border-r border-slate-100 last:border-r-0 p-3 flex flex-col gap-2 min-h-[200px]",
                  isToday && "bg-blue-50/50",
                  hasOverdue && "border-l-2 border-l-red-400"
                )}
              >
                {onHoliday && (
                  <div className="absolute inset-0 bg-slate-300/40 pointer-events-none z-10" />
                )}
                {cellDays.length === 0 && !onHoliday && (
                  <div className="flex items-center justify-center flex-1 text-xs text-slate-300">
                    No jobs
                  </div>
                )}
                {cellDays.map((cd) => (
                  <DayChip
                    key={cd.id}
                    day={cd}
                    showCustomers
                    onClick={setSelectedDayId}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden"
      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - (touchStartX.current ?? 0);
        if (Math.abs(dx) > 50) {
          if (dx < 0) handleNext(); else handlePrev();
        }
        touchStartX.current = null;
      }}
    >
      {/* Toolbar — sticky so nav stays visible when calendar grid scrolls */}
      <div className="sticky top-0 z-20 bg-white flex items-center gap-1.5 px-2 py-2 border-b border-slate-200 flex-wrap">
        {/* Nav arrows */}
        <button
          onClick={handlePrev}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors flex-shrink-0"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={handleNext}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors flex-shrink-0"
        >
          <ChevronRight size={16} />
        </button>

        {/* Range label */}
        <span className="text-sm font-bold text-slate-800 flex-1 min-w-0 truncate">
          {getRangeLabel(viewMode, anchor)}
        </span>

        {/* Today button */}
        {!isAtToday && (
          <button
            onClick={handleToday}
            className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors flex-shrink-0"
          >
            Today
          </button>
        )}

        {/* View switcher */}
        <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden flex-shrink-0">
          {(["month", "week", "3day"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => switchView(mode)}
              className={cn(
                "px-2 sm:px-3 py-1.5 text-xs font-bold transition-colors",
                viewMode === mode
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              {/* Show abbreviated on mobile, full on sm+ */}
              <span className="sm:hidden">
                {mode === "month" ? "Mo" : mode === "week" ? "Wk" : "3D"}
              </span>
              <span className="hidden sm:inline">
                {mode === "3day" ? "3 Day" : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {viewMode === "month" && renderMonthGrid()}
      {viewMode === "week" && renderWeekGrid()}
      {viewMode === "3day" && render3DayGrid()}

      {/* Popout */}
      <DayPopout day={selectedDay} onClose={() => setSelectedDayId(null)} hidePrices={hidePrices} />
    </div>
  );
}
