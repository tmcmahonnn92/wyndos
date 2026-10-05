"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Monitor } from "lucide-react";
import { assignWorkDayWorker, moveJobsToDate, rescheduleWorkDay, scheduleAreaRun } from "@/lib/actions";
import { getMobileMonth, getMobileSchedule, type MobileArea, type MobileDay } from "@/lib/mobile-schedule";
import { cn, fmtCurrency } from "@/lib/utils";

type Data = Awaited<ReturnType<typeof getMobileSchedule>>;
type MonthData = Awaited<ReturnType<typeof getMobileMonth>>;
type TeamMember = { id: string; name: string; isMe?: boolean };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Sat 3 Oct". Built by hand so server and phone show exactly the same text. */
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Monday of the week the date is in. */
const weekStart = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
};

function groupLabel(day: MobileDay, today: string) {
  if (day.date < today) return "Not finished";
  const w = weekStart(day.date);
  const thisWeek = weekStart(today);
  if (w === thisWeek) return "This week";
  if (w === addDays(thisWeek, 7)) return "Next week";
  return `Week of ${dayLabel(w)}`;
}

const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export function MobileScheduler({ initial, initialMonth, team }: { initial: Data; initialMonth: MonthData; team: TeamMember[] | null }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [month, setMonth] = useState(initial.today.slice(0, 7));
  const [monthData, setMonthData] = useState(initialMonth);
  const [picked, setPicked] = useState(initial.today);
  const [tab, setTab] = useState<"calendar" | "runs" | "book">("calendar");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const groups = useMemo(() => {
    const out: Array<{ label: string; days: MobileDay[] }> = [];
    for (const d of data.days) {
      const label = groupLabel(d, data.today);
      const last = out[out.length - 1];
      if (last && last.label === label) last.days.push(d);
      else out.push({ label, days: [d] });
    }
    return out;
  }, [data]);

  const run = (fn: () => Promise<unknown>) => {
    setError("");
    start(async () => {
      try {
        await fn();
        const [fresh, freshMonth] = await Promise.all([getMobileSchedule(), getMobileMonth(month)]);
        setData(fresh);
        setMonthData(freshMonth);
        setOpen(null);
        router.refresh();
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "That didn't work. Try again.");
      }
    });
  };

  return (
    <div className="space-y-4 px-4 py-5 pb-28">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Scheduler</h1>
        <div className="mt-2 flex gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-900">
          <Monitor size={18} className="mt-0.5 flex-shrink-0" />
          <p>
            This is the quick version for changes on the go. For the full drag and drop planner, open Wyndos on a laptop, tablet or bigger screen.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
        <button type="button" onClick={() => setTab("calendar")} className={cn("rounded-lg py-2", tab === "calendar" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500")}>
          Calendar
        </button>
        <button type="button" onClick={() => setTab("runs")} className={cn("rounded-lg py-2", tab === "runs" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500")}>
          List
        </button>
        <button type="button" onClick={() => setTab("book")} className={cn("rounded-lg py-2", tab === "book" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500")}>
          To book{data.unbooked.length ? ` (${data.unbooked.length})` : ""}
        </button>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {tab === "calendar" && (
        <MonthCalendar
          month={month}
          today={data.today}
          picked={picked}
          data={monthData}
          pending={pending}
          onMonth={(n) => {
            const next = shiftMonth(month, n);
            setMonth(next);
            setError("");
            start(async () => {
              try { setMonthData(await getMobileMonth(next)); } catch { setError("Couldn't load that month."); }
            });
          }}
          onPick={(d) => { setPicked(d); setOpen(null); }}
        >
          {monthData.days.filter((d) => d.date === picked).map((d) => (
            <DayCard
              key={d.id}
              day={d}
              today={data.today}
              open={open === `c${d.id}`}
              onToggle={() => setOpen(open === `c${d.id}` ? null : `c${d.id}`)}
              team={data.canAssign ? team : null}
              pending={pending}
              onMove={(date) => run(() => (d.done > 0 ? moveJobsToDate(d.leftIds, date) : rescheduleWorkDay(d.id, date, "one-off")))}
              onAssign={(worker) => run(() => assignWorkDayWorker(d.id, worker))}
            />
          ))}
          {picked >= data.today && data.unbooked.length > 0 && (
            <BookOnDay areas={data.unbooked} date={picked} pending={pending} onBook={(areaId) => run(() => scheduleAreaRun(areaId, picked))} />
          )}
        </MonthCalendar>
      )}

      {tab === "runs" && (
        groups.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Nothing booked in the next 8 weeks.</p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="space-y-2">
              <h2 className={cn("text-xs font-bold uppercase tracking-wide", g.label === "Not finished" ? "text-red-600" : "text-slate-500")}>{g.label}</h2>
              {g.days.map((d) => (
                <DayCard
                  key={d.id}
                  day={d}
                  today={data.today}
                  open={open === `d${d.id}`}
                  onToggle={() => setOpen(open === `d${d.id}` ? null : `d${d.id}`)}
                  team={data.canAssign ? team : null}
                  pending={pending}
                  onMove={(date) => run(() => (d.done > 0 ? moveJobsToDate(d.leftIds, date) : rescheduleWorkDay(d.id, date, "one-off")))}
                  onAssign={(worker) => run(() => assignWorkDayWorker(d.id, worker))}
                />
              ))}
            </section>
          ))
        )
      )}

      {tab === "book" && (
        data.unbooked.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Every area has a run booked.</p>
        ) : (
          <div className="space-y-2">
            {data.unbooked.map((a) => (
              <AreaCard
                key={a.id}
                area={a}
                today={data.today}
                open={open === `a${a.id}`}
                onToggle={() => setOpen(open === `a${a.id}` ? null : `a${a.id}`)}
                team={data.canAssign ? team : null}
                pending={pending}
                onBook={(date, worker) => run(() => scheduleAreaRun(a.id, date, worker))}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}

const inputClass = "min-w-0 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm";

function DayCard({ day, today, open, onToggle, team, pending, onMove, onAssign }: {
  day: MobileDay;
  today: string;
  open: boolean;
  onToggle: () => void;
  team: TeamMember[] | null;
  pending: boolean;
  onMove: (date: string) => void;
  onAssign: (worker: string | null) => void;
}) {
  const [date, setDate] = useState(day.date < today ? today : day.date);
  const late = day.date < today;
  const started = day.status !== "PLANNED";
  const partDone = day.done > 0;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-3 text-left">
        <span className="h-10 w-1.5 flex-shrink-0 rounded-full" style={{ background: day.color }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-slate-800">{day.areaName}</span>
          <span className={cn("block text-xs", late ? "text-red-600" : "text-slate-500")}>
            {day.date === today ? "Today" : dayLabel(day.date)}
            {` · ${day.jobs} job${day.jobs === 1 ? "" : "s"} · ${fmtCurrency(day.value)}`}
            {late && day.pending ? ` · ${day.pending} left` : ""}
          </span>
          {day.workerName && <span className="block truncate text-xs text-slate-400">{day.workerName}</span>}
        </span>
        {started && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{day.status === "COMPLETE" ? "Done" : "Started"}</span>}
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50 px-3 py-3">
          {day.status !== "COMPLETE" && (!partDone || day.leftIds.length > 0) && (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">
                {partDone ? `Move the ${day.leftIds.length} not done yet to` : "Move to another date"}
              </p>
              <div className="flex gap-2">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
                <button type="button" disabled={pending || !date || date === day.date} onClick={() => onMove(date)}
                  className="flex-shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {pending ? "…" : "Move"}
                </button>
              </div>
            </div>
          )}
          {team && team.length > 1 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Who&apos;s doing it</p>
              <select value={day.workerId ?? ""} disabled={pending} onChange={(e) => onAssign(e.target.value || null)} className={inputClass}>
                <option value="">Not set</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name}{m.isMe ? " (me)" : ""}</option>)}
              </select>
            </div>
          )}
          <Link href={`/days/${day.id}`} className="block rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-semibold text-slate-700">
            Open the day
          </Link>
        </div>
      )}
    </div>
  );
}

function AreaCard({ area, today, open, onToggle, team, pending, onBook }: {
  area: MobileArea;
  today: string;
  open: boolean;
  onToggle: () => void;
  team: TeamMember[] | null;
  pending: boolean;
  onBook: (date: string, worker: string | null) => void;
}) {
  const [date, setDate] = useState(area.nextDue && area.nextDue > today ? area.nextDue : today);
  const [worker, setWorker] = useState("");
  const overdue = area.nextDue !== null && area.nextDue < today;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-3 text-left">
        <span className="h-10 w-1.5 flex-shrink-0 rounded-full" style={{ background: area.color }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-slate-800">{area.name}</span>
          <span className={cn("block text-xs", overdue ? "text-red-600" : "text-slate-500")}>
            {area.nextDue ? `${overdue ? "Overdue since" : "Due"} ${dayLabel(area.nextDue)}` : "No due date yet"}
            {` · ${area.customers} customers · ${fmtCurrency(area.value)}`}
          </span>
        </span>
        <CalendarPlus size={18} className="text-blue-600" />
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50 px-3 py-3">
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Book the run for</p>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </div>
          {team && team.length > 1 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Who&apos;s doing it</p>
              <select value={worker} onChange={(e) => setWorker(e.target.value)} className={inputClass}>
                <option value="">Not set</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name}{m.isMe ? " (me)" : ""}</option>)}
              </select>
            </div>
          )}
          <button type="button" disabled={pending || !date} onClick={() => onBook(date, worker || null)}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? "Booking…" : `Book ${area.name}`}
          </button>
        </div>
      )}
    </div>
  );
}

/** Month grid: coloured bars for each run, tap a day to see and change it. */
function MonthCalendar({ month, today, picked, data, pending, onMonth, onPick, children }: {
  month: string;
  today: string;
  picked: string;
  data: MonthData;
  pending: boolean;
  onMonth: (n: number) => void;
  onPick: (iso: string) => void;
  children: React.ReactNode;
}) {
  const first = `${month}-01`;
  const start = weekStart(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  // Drop a last row that's all next month.
  const shown = cells[35].slice(0, 7) !== month ? cells.slice(0, 35) : cells;
  const byDate = new Map<string, MobileDay[]>();
  for (const d of data.days) byDate.set(d.date, [...(byDate.get(d.date) ?? []), d]);
  const holidayOn = (iso: string) => data.holidays.find((h) => h.start <= iso && iso <= h.end);
  const [y, m] = month.split("-").map(Number);
  const pickedDays = byDate.get(picked) ?? [];
  const pickedHoliday = holidayOn(picked);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="mb-2 flex items-center justify-between px-1">
          <button type="button" onClick={() => onMonth(-1)} aria-label="Previous month" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ChevronLeft size={18} /></button>
          <p className="text-sm font-bold text-slate-800">{MONTH_NAMES[m - 1]} {y}{pending ? " …" : ""}</p>
          <button type="button" onClick={() => onMonth(1)} aria-label="Next month" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ChevronRight size={18} /></button>
        </div>
        <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase text-slate-400">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="py-1">{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {shown.map((iso) => {
            const runs = byDate.get(iso) ?? [];
            const inMonth = iso.slice(0, 7) === month;
            const hol = holidayOn(iso);
            const late = iso < today && runs.some((r) => r.status !== "COMPLETE");
            return (
              <button
                key={iso}
                type="button"
                onClick={() => onPick(iso)}
                className={cn(
                  "flex min-h-[3.25rem] min-w-0 flex-col items-stretch rounded-lg p-1 text-left",
                  hol ? "bg-amber-50" : "",
                  iso === picked ? "ring-2 ring-blue-500" : "",
                  !inMonth && "opacity-40",
                )}
              >
                <span className={cn(
                  "mx-auto flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                  iso === today ? "bg-blue-600 text-white" : late ? "text-red-600" : iso < today ? "text-slate-400" : "text-slate-700",
                )}>
                  {Number(iso.slice(8))}
                </span>
                <span className="mt-0.5 space-y-0.5">
                  {runs.slice(0, 3).map((r) => (
                    <span key={r.id} className={cn("block h-1.5 rounded-full", r.status === "COMPLETE" && "opacity-40")} style={{ background: r.color }} />
                  ))}
                  {runs.length > 3 && <span className="block text-center text-[9px] leading-none text-slate-500">+{runs.length - 3}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
          {picked === today ? "Today" : dayLabel(picked)}
          {pickedHoliday ? ` · ${pickedHoliday.label || "Holiday"}` : ""}
        </h2>
        {pickedDays.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-3 text-sm text-slate-400">Nothing booked.</p>}
        {children}
      </div>
    </div>
  );
}

/** Put an area that has nothing booked onto the picked day. */
function BookOnDay({ areas, date, pending, onBook }: { areas: MobileArea[]; date: string; pending: boolean; onBook: (areaId: number) => void }) {
  const [areaId, setAreaId] = useState("");
  return (
    <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-2">
      <select value={areaId} onChange={(e) => setAreaId(e.target.value)} className={inputClass} aria-label={`Book an area on ${dayLabel(date)}`}>
        <option value="">Book an area on this day…</option>
        {areas.map((a) => <option key={a.id} value={a.id}>{a.name}{a.nextDue ? ` (due ${dayLabel(a.nextDue)})` : ""}</option>)}
      </select>
      <button type="button" disabled={pending || !areaId} onClick={() => { onBook(Number(areaId)); setAreaId(""); }}
        className="flex-shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        Book
      </button>
    </div>
  );
}
