"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { getDateLoad } from "@/lib/date-load-actions";
import { cn } from "@/lib/utils";

type Load = Record<string, { jobs: number; areas: number; holiday?: string }>;

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayISO = () => { const t = new Date(); return isoOf(t.getFullYear(), t.getMonth(), t.getDate()); };
function label(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * A date picker that shows how many jobs are already booked on each day, so a free day
 * is easy to spot. `inline` shows the calendar straight away; otherwise a button opens it.
 */
export function DatePickerLoad({
  value,
  onChange,
  inline = false,
  min,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  inline?: boolean;
  /** Earliest date that can be picked (ISO). */
  min?: string;
  className?: string;
}) {
  const start = value || todayISO();
  const [month, setMonth] = useState(() => ({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 }));
  const [open, setOpen] = useState(inline);
  const [load, setLoad] = useState<Load>({});

  // Monday-first grid covering the month.
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(month.y, month.m, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
    const list: Array<string | null> = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) list.push(isoOf(month.y, month.m, d));
    while (list.length % 7) list.push(null);
    return list;
  }, [month]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const from = isoOf(month.y, month.m, 1);
    const to = isoOf(month.y, month.m, new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate());
    getDateLoad(from, to).then((l) => { if (!cancelled) setLoad((prev) => ({ ...prev, ...l })); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, month]);

  const shift = (by: number) => setMonth(({ y, m }) => { const d = new Date(Date.UTC(y, m + by, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const today = todayISO();
  const chosen = value ? load[value] : undefined;

  return (
    <div className={cn("space-y-2", className)}>
      {!inline && (
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm">
          <CalendarDays size={15} className="flex-shrink-0 text-slate-400" />
          <span className={cn("flex-1", !value && "text-slate-400")}>{value ? label(value) : "Choose a date"}</span>
          {value && chosen && <span className="text-xs text-slate-500">{chosen.jobs} job{chosen.jobs === 1 ? "" : "s"} booked</span>}
        </button>
      )}
      {open && (
        <div className="rounded-xl border border-slate-200 bg-white p-2 select-none">
          <div className="mb-1 flex items-center justify-between px-1">
            <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><ChevronLeft size={16} /></button>
            <span className="text-sm font-semibold text-slate-800">
              {new Date(Date.UTC(month.y, month.m, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
            </span>
            <button type="button" aria-label="Next month" onClick={() => shift(1)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase text-slate-400">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="py-0.5">{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((iso, i) => {
              if (!iso) return <span key={i} />;
              const l = load[iso];
              const disabled = Boolean(min && iso < min);
              const selected = iso === value;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={disabled}
                  title={l?.holiday ? l.holiday : l ? `${l.jobs} job${l.jobs === 1 ? "" : "s"} · ${l.areas} area${l.areas === 1 ? "" : "s"}` : "Nothing booked"}
                  onClick={() => { onChange(iso); if (!inline) setOpen(false); }}
                  className={cn(
                    "flex h-11 flex-col items-center justify-center rounded-lg border text-sm leading-none transition-colors",
                    selected ? "border-blue-600 bg-blue-600 text-white"
                      : l?.holiday ? "border-red-100 bg-red-50 text-red-700"
                      : l ? "border-slate-100 bg-slate-50 text-slate-800 hover:border-blue-300"
                      : "border-transparent text-slate-700 hover:border-blue-300",
                    iso === today && !selected && "ring-1 ring-blue-300",
                    disabled && "opacity-30",
                  )}
                >
                  <span className="font-semibold">{Number(iso.slice(8))}</span>
                  <span className={cn("mt-0.5 text-[10px]", selected ? "text-blue-100" : l?.holiday ? "text-red-500" : l ? "text-slate-500" : "text-emerald-600")}>
                    {l?.holiday ? "off" : l ? `${l.jobs}j` : "free"}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-1 px-1 text-[10px] text-slate-400">Number of jobs already booked each day.</p>
        </div>
      )}
    </div>
  );
}
