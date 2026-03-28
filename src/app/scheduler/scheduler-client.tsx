"use client";

import { useState, useRef, useTransition, useCallback, useEffect, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings2,
  Zap,
  GripVertical,
  AlertCircle,
  Clock,
  CheckCircle2,
  MoveRight,
  StickyNote,
  X,
  List,
  ChevronUp,
  ChevronDown,
  Pencil,
  UserPlus,
  Trash2,
  Navigation2,
  Loader2,
  Umbrella,
  CalendarOff,
  CreditCard,
  Search,
  MapPin,
  Users,
} from "lucide-react";
import {
  createArea,
  scheduleAreaRun,
  rescheduleWorkDay,
  updateWorkDayNotes,
  rescheduleJobToDate,
  reorderDayJobs,
  updateJobNotes,
  updateJobPrice,
  addJobToWorkDay,
  addJobFromOtherArea,
  removeJobFromDay,
  deleteWorkDay,
  clearFutureSchedule,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  getWorkDay,
  markJobPaid,
  logPayment,
  updateCompletedWorkDayDate,
  addOneOffJobToDay,
  createCustomerAndAddToDay,
  createOneOffCustomerAndAddToDay,
} from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { EditAreaButton } from "@/app/days/edit-area-button";
import { OneOffJobModal } from "@/app/days/one-off-job-modal";

// ── Types ─────────────────────────────────────────────────────────────────────

type Area = {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
  scheduleType: string;
  frequencyWeeks: number;
  monthlyDay: number | null;
  nextDueDate: Date | string | null;
  lastCompletedDate: Date | string | null;
  estimatedValue: number;
  outstandingDebt: number;
  _count: { customers: number };
};

type Job = {
  id: number;
  name: string;
  price: number;
  status: string;
  notes: string | null;
  sortOrder: number | null;
  isOneOff: boolean;
  customer: {
    id: number;
    name: string;
    address: string;
    area: { id: number; name: string } | null;
    jobs?: { id: number; price: number }[];
    payments?: { amount: number }[];
  } | null;
};

type WorkDay = {
  id: number;
  date: Date | string;
  status: string;
  notes: string | null;
  areaId: number | null;
  area: {
    id: number;
    name: string;
    color: string;
    scheduleType?: string;
    frequencyWeeks?: number;
    monthlyDay?: number | null;
    lastCompletedDate?: Date | string | null;
    nextDueDate?: Date | string | null;
  } | null;
  jobs: Job[];
};

type PaymentRecord = { id: number; amount: number; method: string; paidAt: Date | string; notes: string | null };
type FullJob = Job & { payments: PaymentRecord[] };
type FullWorkDay = Omit<WorkDay, "jobs"> & { jobs: FullJob[] };

function getPreviousDebt(job: FullJob) {
  const previousCompletedTotal = (job.customer?.jobs ?? [])
    .filter((entry) => entry.id !== job.id)
    .reduce((sum, entry) => sum + entry.price, 0);
  const totalPaid = (job.customer?.payments ?? []).reduce((sum, payment) => sum + payment.amount, 0);
  return Math.max(0, Number((previousCompletedTotal - totalPaid).toFixed(2)));
}

function getOutstandingBalance(job: FullJob) {
  const previousCompletedTotal = (job.customer?.jobs ?? [])
    .filter((entry) => entry.id !== job.id)
    .reduce((sum, entry) => sum + entry.price, 0);
  const totalPaid = (job.customer?.payments ?? []).reduce((sum, payment) => sum + payment.amount, 0);
  return Math.max(0, Number((previousCompletedTotal + job.price - totalPaid).toFixed(2)));
}

function isJobSettled(job: FullJob) {
  return getOutstandingBalance(job) <= 0;
}

function splitCollectedAmount(totalCollected: number, currentJobAmount: number) {
  const current = Math.min(Math.max(0, totalCollected), Math.max(0, currentJobAmount));
  const extra = Math.max(0, totalCollected - current);
  return {
    currentJobAmount: Number(current.toFixed(2)),
    extraDebtAmount: Number(extra.toFixed(2)),
  };
}

function getJobTitle(job: { name?: string | null }) {
  return job.name?.trim() || "Window Cleaning";
}

type PendingJob = {
  id: number;
  name: string;
  price: number;
  status: string;
  isOneOff: boolean;
  customer: { id: number; name: string; address: string; area: { id: number; name: string; color: string } | null };
  workDay: { id: number; date: Date | string; area: { id: number; name: string; color: string } | null };
};

type DragState =
  | { type: "area"; area: Area }
  | { type: "workday"; workDay: WorkDay }
  | { type: "job"; job: PendingJob }
  | null;

type Holiday = {
  id: number;
  startDate: Date | string;
  endDate: Date | string;
  label: string;
};

// ── Date helpers ───────────────────────────────────────────────────────────────

function toUTCMidnight(d: Date | string): Date {
  const dt = new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  const base = toUTCMidnight(d);
  return new Date(base.getTime() + days * 86_400_000);
}

function nextExpectedDateForArea(area: {
  scheduleType?: string;
  frequencyWeeks?: number;
  monthlyDay?: number | null;
  lastCompletedDate?: Date | string | null;
  nextDueDate?: Date | string | null;
}): Date | null {
  if (area.lastCompletedDate) {
    const from = toUTCMidnight(area.lastCompletedDate);
    if (area.scheduleType === "MONTHLY") {
      const day = area.monthlyDay ?? 1;
      const sameMonth = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), day));
      if (sameMonth > from) return sameMonth;
      return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, day));
    }
    return addUtcDays(from, (area.frequencyWeeks ?? 4) * 7);
  }
  return area.nextDueDate ? toUTCMidnight(area.nextDueDate) : null;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMondayOfWeek(d: Date): Date {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function addDays(d: Date, n: number): Date {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

function dayDiff(a: Date | string | null, b: Date): number {
  if (!a) return 0;
  const da = toUTCMidnight(a);
  const db = new Date(b); db.setHours(0,0,0,0);
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

// ── Route optimiser helpers ──────────────────────────────────────────────────
async function geocodeAddress(address: string): Promise<[number, number] | null> {
  try {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
    if (!r.ok) return null;
    const data = await r.json();
    if (!data) return null;
    return [data.lat, data.lon];
  } catch { return null; }
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * sinLon * sinLon;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function nearestNeighbourOrder(coords: ([number, number] | null)[]): number[] {
  const n = coords.length;
  if (n === 0) return [];
  const visited = new Array(n).fill(false);
  const order: number[] = [0];
  visited[0] = true;
  for (let step = 1; step < n; step++) {
    const last = order[order.length - 1];
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const a = coords[last], b = coords[i];
      const dist = a && b ? haversineKm(a, b) : 9999;
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    if (bestIdx >= 0) { order.push(bestIdx); visited[bestIdx] = true; }
  }
  for (let i = 0; i < n; i++) if (!visited[i]) order.push(i);
  return order;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatWeekRange(monday: Date): string {
  const sunday = addDays(monday, 6);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const start = monday.toLocaleDateString("en-GB", opts);
  const end = sunday.toLocaleDateString("en-GB", { ...opts, year: "numeric" });
  return `${start} - ${end}`;
}

function fmtDayNum(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric" });
}

function todayISO(): string {
  const t = new Date(); t.setHours(0,0,0,0);
  return isoDate(t);
}

// ── Drop colour logic ──────────────────────────────────────────────────────────

type DropColour = "early" | "ontime" | "late1" | "late2" | "late3" | "neutral";

/** Area drag: colour based on how target compares to area.nextDueDate */
function getAreaDropColour(area: Area, targetDate: Date): DropColour {
  const expectedDate = nextExpectedDateForArea(area);
  if (!expectedDate) return "neutral";
  const diff = dayDiff(expectedDate, targetDate); // positive = target is AFTER dueDate
  if (diff < 0) return "early";
  if (diff === 0) return "ontime";
  if (diff <= 6) return "late1";
  if (diff <= 13) return "late2";
  return "late3";
}

function getAreaDropLabel(area: Area, targetDate: Date): string {
  const expectedDate = nextExpectedDateForArea(area);
  if (!expectedDate) return "Schedule";
  const diff = dayDiff(expectedDate, targetDate);
  if (diff < 0) return `${Math.abs(diff)}d early`;
  if (diff === 0) return "Due today";
  if (diff === 1) return "1d overdue";
  return `${diff}d overdue`;
}

/** WorkDay drag: colour based on how many days the move shifts the job */
function getWorkDayDropColour(workDay: WorkDay, targetDate: Date): DropColour {
  const expectedDate = workDay.area ? nextExpectedDateForArea(workDay.area) : null;
  const diff = expectedDate ? dayDiff(expectedDate, targetDate) : dayDiff(workDay.date, targetDate);
  if (diff < 0) return "early";
  if (diff === 0) return "ontime";
  if (diff <= 6) return "late1";
  if (diff <= 13) return "late2";
  return "late3";
}

function getWorkDayDropLabel(workDay: WorkDay, targetDate: Date): string {
  const expectedDate = workDay.area ? nextExpectedDateForArea(workDay.area) : null;
  const diff = expectedDate ? dayDiff(expectedDate, targetDate) : dayDiff(workDay.date, targetDate);
  if (!expectedDate) {
    if (diff < 0) return `${Math.abs(diff)}d earlier`;
    if (diff === 0) return "Same day";
    if (diff === 1) return "1d later";
    return `${diff}d later`;
  }
  if (diff < 0) return `${Math.abs(diff)}d early`;
  if (diff === 0) return "On time";
  if (diff === 1) return "1d overdue";
  return `${diff}d overdue`;
}

const DROP_COLOUR_CLASSES: Record<DropColour, string> = {
  early:   "border-2 border-green-400 bg-green-50",
  ontime:  "border-2 border-green-500 bg-green-100",
  late1:   "border-2 border-amber-400 bg-amber-50",
  late2:   "border-2 border-orange-400 bg-orange-50",
  late3:   "border-2 border-red-500 bg-red-50",
  neutral: "border-2 border-blue-400 bg-blue-50",
};

const DROP_LABEL_CLASSES: Record<DropColour, string> = {
  early:   "text-green-600",
  ontime:  "text-green-700",
  late1:   "text-amber-700",
  late2:   "text-orange-600",
  late3:   "text-red-600",
  neutral: "text-blue-600",
};

// ── Area urgency badge ────────────────────────────────────────────────────────

function AreaStatusBadge({
  nextDueDate,
  upcomingRuns,
  weekStart,
}: {
  nextDueDate: Date | string | null;
  upcomingRuns: WorkDay[];
  weekStart: Date;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const viewEnd = addDays(weekStart, 6); viewEnd.setHours(23, 59, 59, 999);

  const sorted = [...upcomingRuns].sort(
    (a, b) => toUTCMidnight(a.date).getTime() - toUTCMidnight(b.date).getTime()
  );
  const nearest = sorted[0] ?? null;

  if (nearest) {
    const nd = toUTCMidnight(nearest.date);
    const isViewWeek = nd >= weekStart && nd <= viewEnd;
    const dateLabel = nd.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    if (isViewWeek) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap bg-green-100 text-green-700 border border-green-300">
          ✓ This week
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap bg-emerald-50 text-emerald-700 border border-emerald-200">
        ✓ {dateLabel}
      </span>
    );
  }

  // Not yet scheduled — derive from nextDueDate
  if (!nextDueDate) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap bg-slate-100 text-slate-500 border border-slate-200">
        Unscheduled
      </span>
    );
  }

  const diff = dayDiff(nextDueDate, today); // positive = overdue, negative = future

  if (diff > 0) {
    const cls = diff > 14
      ? "bg-red-100 text-red-700 border border-red-300"
      : "bg-orange-100 text-orange-700 border border-orange-200";
    return (
      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap", cls)}>
        {diff}d overdue
      </span>
    );
  }

  if (diff === 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap bg-orange-100 text-orange-700 border border-orange-200">
        Due today
      </span>
    );
  }

  // Future
  const dueD = toUTCMidnight(nextDueDate);
  if (dueD >= weekStart && dueD <= viewEnd) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap bg-amber-100 text-amber-700 border border-amber-200">
        Due this week
      </span>
    );
  }

  const daysUntil = Math.abs(diff);
  if (daysUntil <= 14) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap bg-yellow-50 text-yellow-700 border border-yellow-200">
        In {daysUntil}d
      </span>
    );
  }
  const weeks = Math.round(daysUntil / 7);
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap bg-blue-50 text-blue-600 border border-blue-100">
      In {weeks}wk
    </span>
  );
}

function FreqBadge({ scheduleType, frequencyWeeks }: { scheduleType: string; frequencyWeeks: number }) {
  if (scheduleType === "MONTHLY") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-wide bg-green-100 text-green-700 border border-green-200 whitespace-nowrap">
        Monthly
      </span>
    );
  }
  const weeks = frequencyWeeks;
  const label = weeks === 1 ? "1w" : `${weeks}w`;
  const cls =
    weeks <= 1  ? "bg-violet-100 text-violet-700 border border-violet-200" :
    weeks <= 2  ? "bg-blue-100 text-blue-700 border border-blue-200" :
    weeks <= 3  ? "bg-sky-100 text-sky-700 border border-sky-200" :
    weeks <= 4  ? "bg-emerald-100 text-emerald-700 border border-emerald-200" :
    weeks <= 6  ? "bg-teal-100 text-teal-700 border border-teal-200" :
    weeks <= 8  ? "bg-amber-100 text-amber-700 border border-amber-200" :
    weeks <= 12 ? "bg-orange-100 text-orange-700 border border-orange-200" :
                  "bg-rose-100 text-rose-700 border border-rose-200";
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-wide whitespace-nowrap", cls)}>
      {label}
    </span>
  );
}

function workDayChipClass(_status: string) {
  return "text-white"; // color always set via inline style from area.color
}

function workDayChipStyle(_status: string, areaColor?: string | null): CSSProperties {
  return { backgroundColor: areaColor || "#3B82F6" };
}

function scheduleLabel(area: Area): string {
  if (area.scheduleType === "MONTHLY") {
    const d = area.monthlyDay ?? 1;
    const s = ["th","st","nd","rd"], v = d % 100;
    return `${d + (s[(v-20)%10] ?? s[v] ?? s[0])} of month`;
  }
  return `every ${area.frequencyWeeks}w`;
}

// ── Add Area Modal ────────────────────────────────────────────────────────────

function AddAreaModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [scheduleType, setScheduleType] = useState<"WEEKLY" | "MONTHLY">("WEEKLY");
  const [frequencyWeeks, setFrequencyWeeks] = useState("4");
  const [monthlyDay, setMonthlyDay] = useState("1");
  const [nextDueDate, setNextDueDate] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const ordinal = (n: number) => {
    const s = ["th","st","nd","rd"], v = n % 100;
    return n + (s[(v-20)%10] ?? s[v] ?? s[0]);
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    startTransition(async () => {
      await createArea({
        name: name.trim(), scheduleType,
        frequencyWeeks: scheduleType === "WEEKLY" ? (Number(frequencyWeeks) || 4) : 4,
        monthlyDay: scheduleType === "MONTHLY" ? (Number(monthlyDay) || 1) : undefined,
        nextDueDate: nextDueDate ? new Date(nextDueDate) : undefined,
      });
      setName(""); setScheduleType("WEEKLY"); setFrequencyWeeks("4");
      setMonthlyDay("1"); setNextDueDate("");
      onClose(); router.refresh();
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Area">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Area name</label>
          <input type="text" placeholder="e.g. Westfield Estate" value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Schedule type</label>
          <div className="flex gap-2">
            {(["WEEKLY", "MONTHLY"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setScheduleType(t)}
                className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-colors ${scheduleType === t ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300"}`}>
                {t === "WEEKLY" ? "Weekly interval" : "Monthly (set date)"}
              </button>
            ))}
          </div>
        </div>
        {scheduleType === "WEEKLY" && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Repeat every</label>
            <div className="flex gap-2">
              {["1","2","4","6","8","12"].map((w) => (
                <button key={w} type="button" onClick={() => setFrequencyWeeks(w)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-colors ${frequencyWeeks === w ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300"}`}>
                  {w}w
                </button>
              ))}
            </div>
          </div>
        )}
        {scheduleType === "MONTHLY" && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Day of month</label>
            <div className="flex items-center gap-3">
              <input type="number" min={1} max={28} value={monthlyDay}
                onChange={(e) => setMonthlyDay(e.target.value)}
                className="w-24 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-semibold text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-sm text-slate-500">{ordinal(Number(monthlyDay) || 1)} of every month</p>
            </div>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            First due date <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex gap-2 pt-1">
          <Button onClick={handleSubmit} disabled={isPending || !name.trim()} className="flex-1">
            {isPending ? "Adding..." : "Add Area"}
          </Button>
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Move WorkDay Modal ────────────────────────────────────────────────────────

// MoveWorkDayModal removed (obsolete)

// ── WorkDay Notes Modal ───────────────────────────────────────────────────────

function WorkDayNotesModal({
  day, text, setText, onClose,
}: {
  day: WorkDay | null;
  text: string;
  setText: (v: string) => void;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSave = () => {
    if (!day) return;
    startTransition(async () => {
      await updateWorkDayNotes(day.id, text);
      router.refresh();
      onClose();
    });
  };

  if (!day) return null;
  const areaName = day.area?.name ?? day.jobs[0]?.customer?.address?.split(",")[0] ?? "One-off";

  return (
    <Modal open={!!day} onClose={onClose} title="">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800 text-base">Day Notes — {areaName}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <textarea
          className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 min-h-[120px]"
          placeholder="Add notes for this scheduled day…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Calendar Cell ─────────────────────────────────────────────────────────────

function CalendarCell({
  date, workDays, isToday, dragState,
  onDragOver, onDragLeave, onDrop, isDragOver,
  isHoliday, holidayLabel, isExpectedForDrag,
  onWorkDayDragStart, onNotesClick, onExpand, onRemove,
}: {
  date: Date;
  workDays: WorkDay[];
  isToday: boolean;
  dragState: DragState;
  onDragOver: (date: Date) => void;
  onDragLeave: () => void;
  onDrop: (date: Date) => void;
  isDragOver: boolean;
  isHoliday: boolean;
  holidayLabel: string | null;
  isExpectedForDrag: boolean;
  onWorkDayDragStart: (wd: WorkDay) => void;
  onNotesClick: (wd: WorkDay) => void;
  onExpand: (wd: WorkDay) => void;
  onRemove: (wd: WorkDay) => void;
}) {
  const dropColour: DropColour =
    !isHoliday && isDragOver && dragState?.type === "area"
      ? getAreaDropColour(dragState.area, date)
      : !isHoliday && isDragOver && dragState?.type === "workday"
      ? getWorkDayDropColour(dragState.workDay, date)
      : "neutral";

  const dropLabel =
    !isHoliday && isDragOver && dragState?.type === "area"
      ? getAreaDropLabel(dragState.area, date)
      : !isHoliday && isDragOver && dragState?.type === "workday"
      ? getWorkDayDropLabel(dragState.workDay, date)
      : !isHoliday && isDragOver && dragState?.type === "job"
      ? "Schedule here"
      : isHoliday && isDragOver && dragState
      ? `${holidayLabel ?? "Holiday"} — cannot schedule`
      : null;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!isHoliday) onDragOver(date); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); if (!isHoliday) onDrop(date); }}
      className={cn(
        "relative min-h-[130px] rounded-xl border transition-all duration-150 flex flex-col gap-1 p-2",
        isHoliday ? "bg-red-50/60 border-red-200" : isToday ? "bg-blue-50 border-blue-200" : "bg-white border-slate-200",
        !isHoliday && isDragOver ? DROP_COLOUR_CLASSES[dropColour] : "",
        !isDragOver && !isHoliday && isExpectedForDrag ? "ring-2 ring-green-400 bg-green-50/60 border-green-300" : "",
        isHoliday && isDragOver && dragState ? "ring-2 ring-red-300" : ""
      )}
    >
      {/* Holiday banner */}
      {isHoliday && (
        <div className="flex items-center gap-1 text-[10px] font-semibold text-red-600 mb-0.5">
          <Umbrella size={10} />
          <span className="truncate">{holidayLabel ?? "Holiday"}</span>
          {dragState && <span className="text-red-400 ml-auto">blocked</span>}
        </div>
      )}
      {isExpectedForDrag && !isDragOver && !isHoliday && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <span className="bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap flex items-center gap-0.5">
            <CheckCircle2 size={8} /> On schedule
          </span>
        </div>
      )}
      {isDragOver && dropLabel && (
        <div className={cn(
          "absolute inset-0 flex items-center justify-center text-xs font-bold rounded-xl pointer-events-none z-10",
          isHoliday ? "bg-red-100/80" : DROP_LABEL_CLASSES[dropColour]
        )}>
          <span className="bg-white/90 px-2 py-0.5 rounded-full shadow-sm border">{dropLabel}</span>
        </div>
      )}
      {workDays.map((wd) => {
        const value = wd.jobs.reduce((s, j) => s + j.price, 0);
        const done  = wd.jobs.filter((j) => j.status === "COMPLETE").length;
        const total = wd.jobs.length;
        const oneOff = wd.jobs.filter((j) => j.isOneOff).length;
        return (
          <div
            key={wd.id}
            draggable={wd.status !== "COMPLETE"}
            onDragStart={(e) => { if (wd.status === "COMPLETE") { e.preventDefault(); return; } e.stopPropagation(); onWorkDayDragStart(wd); }}
            className="relative group"
          >
            {/* Remove button — top-right, visible on hover, hidden for completed days */}
            {wd.status !== "COMPLETE" && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(wd); }}
                className="absolute -top-1 -right-1 z-20 w-4 h-4 rounded-full bg-white border border-slate-300 text-slate-400 hover:bg-red-500 hover:border-red-500 hover:text-white transition-colors hidden group-hover:flex items-center justify-center shadow-sm"
                title="Remove from schedule"
              >
                <X size={9} />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onExpand(wd); }}
              draggable={false}
              className={cn(
                "relative overflow-hidden w-full text-left flex flex-col gap-0.5 px-2 py-1.5 rounded-lg text-[11px] select-none transition-all hover:opacity-90",
                workDayChipClass(wd.status)
              )}
              style={workDayChipStyle(wd.status, wd.area?.color)}
            >
              {/* Completed overlay — semi-opaque green tick centred over the chip */}
              {wd.status === "COMPLETE" && (
                <div className="absolute inset-0 rounded-lg flex items-center justify-center bg-green-500/30 pointer-events-none z-10">
                  <CheckCircle2 size={22} className="text-white drop-shadow" />
                </div>
              )}
              {/* In-progress overlay — pulsing ring so area colour stays visible */}
              {wd.status === "IN_PROGRESS" && (
                <div className="absolute inset-0 rounded-lg ring-2 ring-white/70 ring-inset animate-pulse pointer-events-none z-10" />
              )}
              {/* Row 1: grip + name + status icon */}
              <div className="flex items-center gap-1">
                <GripVertical size={10} className="opacity-50 flex-shrink-0" />
                <span className="font-bold truncate flex-1">{wd.area?.name ?? wd.jobs[0]?.customer?.address?.split(",")[0] ?? "One-off"}</span>
                {wd.status === "IN_PROGRESS" && <Clock size={10} className="flex-shrink-0 opacity-80" />}
              </div>
              {/* Row 2: job count + value */}
              <div className="flex items-center gap-1.5 pl-3.5 opacity-90">
                <span>{total} job{total !== 1 ? "s" : ""}</span>
                <span className="opacity-60">·</span>
                <span>£{value.toFixed(2)}</span>
                {done > 0 && (
                  <><span className="opacity-60">·</span><span>{done}/{total} done</span></>
                )}
                {oneOff > 0 && (
                  <><span className="opacity-60">·</span><span><Zap size={8} className="inline" />{oneOff}</span></>
                )}
              </div>
              {/* Row 3: last completed date (only for planned future days) */}
              {wd.status === "PLANNED" && wd.area?.lastCompletedDate && (
                <div className="flex items-center gap-1 pl-3.5 opacity-70 text-[10px]">
                  <CheckCircle2 size={8} className="flex-shrink-0" />
                  <span>Last: {toUTCMidnight(wd.area.lastCompletedDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
              )}
            </button>
            {/* Notes indicator — outside Link so click doesn't navigate */}
            {wd.notes && (
              <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onNotesClick(wd); }}
                className="flex items-center gap-1 mt-0.5 px-2 py-0.5 w-full rounded-md bg-amber-100/80 border border-amber-300/60 text-[10px] font-semibold text-amber-800 hover:bg-amber-200 transition-colors"
              >
                <StickyNote size={9} />
                <span className="truncate">{wd.notes}</span>
              </button>
            )}
            {!wd.notes && (
              <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onNotesClick(wd); }}
                className="flex items-center gap-1 mt-0.5 px-2 py-0.5 w-full rounded-md text-[10px] text-slate-400 hover:text-amber-700 hover:bg-amber-50 transition-colors"
              >
                <StickyNote size={9} />
                <span>Add note…</span>
              </button>
            )}

          </div>
        );
      })}
    </div>
  );
}

// ── Area Panel Card ───────────────────────────────────────────────────────────

function AreaPanelCard({ area, onDragStart, overdueWorkDay }: {
  area: Area;
  onDragStart: (area: Area) => void;
  overdueWorkDay?: WorkDay | null;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expectedDate = nextExpectedDateForArea(area);

  // An already-scheduled but uncompleted past workday takes priority for overdue status
  const isOverdue = overdueWorkDay
    ? true
    : expectedDate
    ? expectedDate < today
    : false;

  let lastDoneLabel = "Never cleaned";
  if (area.lastCompletedDate) {
    const d = toUTCMidnight(area.lastCompletedDate);
    const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
    if (diff === 0) lastDoneLabel = "Cleaned today";
    else if (diff === 1) lastDoneLabel = "Cleaned yesterday";
    else if (diff < 14) lastDoneLabel = `${diff}d ago`;
    else lastDoneLabel = `${Math.round(diff / 7)}wk ago`;
  }

  let dueBadge: React.ReactNode = null;
  if (overdueWorkDay) {
    // Area has a scheduled workday in the past that was never completed
    const wd = toUTCMidnight(overdueWorkDay.date);
    const diff = Math.round((today.getTime() - wd.getTime()) / 86_400_000);
    const dateStr = wd.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    dueBadge = (
      <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap",
        diff > 14 ? "bg-red-100 text-red-700 border border-red-300" : "bg-orange-100 text-orange-700 border border-orange-200"
      )}>{diff === 0 ? "Today – not done" : `${dateStr} – not done`}</span>
    );
  } else if (expectedDate) {
    const dueDate = expectedDate;
    const diff = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
    const dateStr = dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    if (diff < 0) {
      dueBadge = (
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap",
          Math.abs(diff) > 14 ? "bg-red-100 text-red-700 border border-red-300" : "bg-orange-100 text-orange-700 border border-orange-200"
        )}>{Math.abs(diff)}d overdue</span>
      );
    } else if (diff === 0) {
      dueBadge = <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap bg-orange-100 text-orange-700 border border-orange-200">Due today</span>;
    } else {
      dueBadge = <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap bg-blue-50 text-blue-600 border border-blue-100">Due {dateStr}</span>;
    }
  }

  return (
    <div
      draggable
      onDragStart={() => onDragStart(area)}
      className={cn(
        "flex items-center gap-2 px-2.5 py-2 rounded-xl border bg-white cursor-grab active:cursor-grabbing select-none transition-all hover:shadow-md hover:-translate-y-0.5",
        isOverdue ? "border-red-300" : "border-slate-200"
      )}
      style={{ borderLeftWidth: "3px", borderLeftColor: area.color || "#3B82F6" }}
    >
      <GripVertical size={11} className="text-slate-300 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <p className="text-xs font-bold text-slate-800 truncate leading-tight" title={area.name}>{area.name}</p>
          <EditAreaButton area={area} />
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-[10px] text-slate-400">{lastDoneLabel}</span>
          {dueBadge}
          <FreqBadge scheduleType={area.scheduleType} frequencyWeeks={area.frequencyWeeks} />
          <span className="inline-flex items-center gap-1 text-[10px] text-slate-400"><Users size={9} />{area._count.customers} · £{area.estimatedValue.toFixed(0)}</span>
          {area.outstandingDebt > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              <AlertCircle size={9} />£{area.outstandingDebt.toFixed(0)} owed
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pending Job Chip ─────────────────────────────────────────────────────────

function PendingJobChip({ job, onDragStart }: { job: PendingJob; onDragStart: (j: PendingJob) => void }) {
  const areaColor = job.workDay.area?.color ?? job.customer.area?.color ?? "#64748b";
  const areaName  = job.workDay.area?.name  ?? job.customer.area?.name  ?? "No area";
  const dateStr   = new Date(job.workDay.date).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
  });
  return (
    <div
      draggable
      onDragStart={() => onDragStart(job)}
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-200 bg-white cursor-grab active:cursor-grabbing select-none hover:shadow-md hover:-translate-y-0.5 transition-all min-w-[170px] max-w-[240px]"
      style={{ borderLeftWidth: "3px", borderLeftColor: areaColor }}
    >
      <GripVertical size={11} className="text-slate-300 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-slate-800 truncate leading-tight">{job.customer.name}</p>
        <p className="text-[11px] font-semibold text-blue-700 truncate leading-tight">{getJobTitle(job)}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white"
            style={{ backgroundColor: areaColor }}
          >{areaName}</span>
          <span className="text-[10px] text-slate-400">{dateStr}</span>
          {job.status === "IN_PROGRESS" && (
            <span className="text-[10px] font-semibold text-blue-600">In progress</span>
          )}
        </div>
      </div>
      <span className="text-[10px] font-semibold text-slate-500 flex-shrink-0">£{job.price.toFixed(2)}</span>
    </div>
  );
}

// ── Route Optimiser Modal (for scheduler DayDetailModal) ────────────────────

function SchedulerRouteOptimiserModal({
  jobs, open, onClose, onApply,
}: {
  jobs: Job[];
  open: boolean;
  onClose: () => void;
  onApply: (ordered: Job[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [startJobId, setStartJobId] = useState<number | "">(jobs[0]?.id ?? "");
  const [orderedJobs, setOrderedJobs] = useState<Job[] | null>(null);

  useEffect(() => {
    if (open) {
      setOrderedJobs(null);
      setError("");
      setProgress("");
      setStartJobId(jobs[0]?.id ?? "");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOptimise = async () => {
    setLoading(true);
    setError("");
    setOrderedJobs(null);
    const coords: Array<[number, number] | null> = [];
    for (let i = 0; i < jobs.length; i++) {
      setProgress(`Locating ${i + 1}/${jobs.length}: ${jobs[i].customer?.name ?? ""}`);
      const addr = jobs[i].customer?.address ?? null;
      const c = addr ? await geocodeAddress(addr) : null;
      coords.push(c);
      if (i < jobs.length - 1) await new Promise((r) => setTimeout(r, 1100));
    }
    const resolved = coords.filter(Boolean).length;
    if (resolved < 2) {
      setError(`Could only geocode ${resolved} of ${jobs.length} addresses. Check postcodes are included.`);
      setLoading(false);
      return;
    }
    const startIdx = startJobId !== "" ? jobs.findIndex((j) => j.id === startJobId) : 0;
    const order = nearestNeighbourOrder(coords);
    // Rotate so the chosen start job is first
    const pivot = order.indexOf(Math.max(0, startIdx));
    const rotated = pivot > 0 ? [...order.slice(pivot), ...order.slice(0, pivot)] : order;
    setOrderedJobs(rotated.map((i) => jobs[i]));
    setLoading(false);
    setProgress("");
  };

  return (
    <Modal open={open} onClose={onClose} title="Route Optimiser">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Geocodes each address and finds the shortest route. Choose a starting point, then preview before applying.
        </p>

        {/* Start point */}
        {!orderedJobs && (
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Start from</label>
            <select
              value={startJobId}
              onChange={(e) => setStartJobId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>{j.customer?.name} – {j.customer?.address}</option>
              ))}
            </select>
          </div>
        )}

        {/* Progress */}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 rounded-xl px-4 py-3">
            <Loader2 size={16} className="animate-spin text-blue-500" />
            <span>{progress}</span>
          </div>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {/* Optimised preview */}
        {orderedJobs && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Optimised order</p>
            <ol className="space-y-1.5">
              {orderedJobs.map((job, idx) => (
                <li key={job.id} className="flex items-center gap-2.5 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{job.customer?.name}</p>
                    <p className="text-xs text-slate-500 truncate">{job.customer?.address}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {!orderedJobs ? (
            <button
              onClick={handleOptimise}
              disabled={loading || jobs.length < 2}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Navigation2 size={15} />}
              {loading ? "Optimising…" : "Optimise Route"}
            </button>
          ) : (
            <button
              onClick={() => onApply(orderedJobs)}
              className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-bold transition-colors"
            >
              Apply This Order
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            {orderedJobs ? "Discard" : "Cancel"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Day Detail Modal ─────────────────────────────────────────────────────────

type CustomerSearchResult = { id: number; name: string; address: string; price: number; area?: { name: string } | null };

// ── Completed WorkDay Modal ───────────────────────────────────────────────────

function CompletedWorkDayModal({ workDay, onClose }: { workDay: WorkDay | null; onClose: () => void }) {
  const router = useRouter();
  const [, startSaving] = useTransition();
  const [fullDay, setFullDay] = useState<FullWorkDay | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  // date editing
  const [editingDate, setEditingDate] = useState(false);
  const [dateVal, setDateVal] = useState("");
  // payment per job
  const [payingJobId, setPayingJobId] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"CASH" | "BACS" | "CARD">("CASH");

  const reload = useCallback((id: number) => {
    getWorkDay(id).then((d) => {
      setFullDay((d as FullWorkDay | null) ?? null);
      setLoadingFull(false);
    }).catch(() => setLoadingFull(false));
  }, []);

  useEffect(() => {
    if (!workDay) { setFullDay(null); return; }
    setLoadingFull(true);
    setFullDay(null);
    setEditingDate(false);
    setPayingJobId(null);
    reload(workDay.id);
  }, [workDay?.id, reload]);

  const handleSaveDate = () => {
    if (!workDay || !dateVal) return;
    startSaving(async () => {
      await updateCompletedWorkDayDate(workDay.id, dateVal);
      setEditingDate(false);
      router.refresh();
      reload(workDay.id);
    });
  };

  const handleMarkPaid = (job: FullJob) => {
    if (!workDay || !job.customer) return;
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) return;
    const split = splitCollectedAmount(amount, job.price);
    startSaving(async () => {
      if (split.currentJobAmount > 0) {
        await markJobPaid({ jobId: job.id, customerId: job.customer!.id, workDayId: workDay.id, amount: split.currentJobAmount, method: payMethod });
      }
      if (split.extraDebtAmount > 0) {
        await logPayment({
          customerId: job.customer!.id,
          amount: split.extraDebtAmount,
          method: payMethod,
          notes: "Previous balance collected on completed day",
        });
      }
      setPayingJobId(null);
      router.refresh();
      reload(workDay.id);
    });
  };

  if (!workDay) return null;

  const displayDate = toUTCMidnight(fullDay?.date ?? workDay.date);
  const dateDisplay = displayDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const dateISO = displayDate.toISOString().split("T")[0];
  const jobs = (fullDay?.jobs ?? workDay.jobs) as FullJob[];
  const totalValue = jobs.reduce((s, j) => s + j.price, 0);
  const paidCount = fullDay ? jobs.filter((job) => isJobSettled(job)).length : 0;

  return (
    <Modal open={true} onClose={onClose} title={`✓ ${workDay.area?.name ?? "Completed Day"}`}>
      <div className="space-y-4">
        {/* Completion date */}
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-green-50 border border-green-200">
          <CheckCircle2 size={15} className="text-green-600 flex-shrink-0" />
          {!editingDate ? (
            <div className="flex-1 flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wide">Completed on</p>
                <p className="text-sm font-bold text-green-900">{dateDisplay}</p>
              </div>
              <button
                onClick={() => { setEditingDate(true); setDateVal(dateISO); }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
              >
                <Pencil size={11} /> Change date
              </button>
            </div>
          ) : (
            <div className="flex-1 flex items-center gap-2 flex-wrap">
              <input
                type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)}
                className="border border-green-300 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400"
                autoFocus
              />
              <button onClick={handleSaveDate} disabled={!dateVal}
                className="px-3 py-1 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold disabled:opacity-50">
                Save
              </button>
              <button onClick={() => setEditingDate(false)}
                className="px-3 py-1 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Summary bar */}
        {fullDay && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-600 flex-wrap">
            <span>{jobs.length} job{jobs.length !== 1 ? "s" : ""}</span>
            <span className="text-slate-300">·</span>
            <span className="font-bold text-slate-800">£{totalValue.toFixed(2)}</span>
            <span className="text-slate-300">·</span>
            <span className={paidCount === jobs.length ? "text-green-700 font-semibold" : "text-amber-700 font-semibold"}>
              {paidCount}/{jobs.length} paid
            </span>
          </div>
        )}

        {/* Jobs list */}
        {loadingFull && <p className="text-sm text-slate-400 text-center py-4">Loading jobs…</p>}
        {!loadingFull && (
          <div className="space-y-2">
            {jobs.map((job) => {
              const isSkipped = job.status === "SKIPPED";
              const isPaid = isJobSettled(job);
              const payInfo = job.payments?.[0] ?? null;
              const isPayingThis = payingJobId === job.id;
              const previousDebt = getPreviousDebt(job);
              const currentBalance = getOutstandingBalance(job);
              const canLogPayment = job.status === "COMPLETE" && !isPaid;
              return (
                <div key={job.id} className={cn(
                  "rounded-xl border p-2.5 space-y-1.5 transition-colors",
                  isSkipped ? "bg-slate-50 border-slate-200" : isPaid ? "bg-green-50/60 border-green-200" : "bg-white border-slate-200"
                )}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{job.customer?.name ?? "Unknown"}</p>
                      <p className="text-xs font-medium text-blue-700 truncate">{getJobTitle(job)}</p>
                      <p className="text-xs text-slate-400 truncate">{job.customer?.address ?? ""}</p>
                    </div>
                    <span className="text-xs font-bold text-slate-700 flex-shrink-0">£{job.price.toFixed(2)}</span>
                    {isSkipped ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-600 flex-shrink-0 whitespace-nowrap">
                        <CalendarOff size={10} /> Skipped
                      </span>
                    ) : isPaid ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 border border-green-200 text-[10px] font-bold text-green-700 flex-shrink-0 whitespace-nowrap">
                        <CheckCircle2 size={10} /> Paid
                      </span>
                    ) : canLogPayment ? (
                      <button
                        onClick={() => { setPayingJobId(isPayingThis ? null : job.id); setPayAmount(job.price.toFixed(2)); setPayMethod("CASH"); }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] font-bold text-amber-700 hover:bg-amber-100 transition-colors flex-shrink-0 whitespace-nowrap"
                      >
                        <CreditCard size={10} /> Log payment
                      </button>
                    ) : null}
                  </div>
                  {!isSkipped && isPaid && payInfo && (
                    <p className="text-[11px] text-green-700">Latest payment: £{payInfo.amount.toFixed(2)} via {payInfo.method}</p>
                  )}
                  {/* Inline payment form */}
                  {isPayingThis && canLogPayment && (
                    <div className="flex items-center gap-2 pt-1.5 border-t border-slate-100 flex-wrap">
                      {previousDebt > 0 && (
                        <>
                          <button
                            onClick={() => setPayAmount(job.price.toFixed(2))}
                            className="px-2 py-1 rounded-lg border border-blue-200 bg-white text-[11px] font-semibold text-blue-700 hover:border-blue-400"
                          >
                            This clean
                          </button>
                          <button
                            onClick={() => setPayAmount(currentBalance.toFixed(2))}
                            className="px-2 py-1 rounded-lg border border-amber-200 bg-white text-[11px] font-semibold text-amber-700 hover:border-amber-400"
                          >
                            Including debt
                          </button>
                          <span className="text-[11px] text-amber-700 font-medium">Owes £{previousDebt.toFixed(2)} older balance</span>
                        </>
                      )}
                      <span className="text-xs text-slate-500">£</span>
                      <input
                        type="number" step="0.01" min="0" value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                        autoFocus
                      />
                      <select
                        value={payMethod} onChange={(e) => setPayMethod(e.target.value as "CASH" | "BACS" | "CARD")}
                        className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                      >
                        <option value="CASH">Cash</option>
                        <option value="BACS">BACS</option>
                        <option value="CARD">Card</option>
                      </select>
                      <button onClick={() => handleMarkPaid(job)}
                        className="px-3 py-1 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold">
                        Confirm
                      </button>
                      <button onClick={() => setPayingJobId(null)}
                        className="px-3 py-1 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <Link href={`/days/${workDay.id}`} onClick={onClose}
            className="text-xs text-blue-600 hover:underline font-medium">
            Open full day view →
          </Link>
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Day Detail Modal ─────────────────────────────────────────────────────────

function DayDetailModal({ workDay, onClose }: { workDay: WorkDay | null; onClose: () => void }) {
  const router = useRouter();
  const [localJobs, setLocalJobs] = useState<FullJob[]>([]);
  const [hasOrderChanges, setHasOrderChanges] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [editingPriceId, setEditingPriceId] = useState<number | null>(null);
  const [priceText, setPriceText] = useState("");
  const [showAddJob, setShowAddJob] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [payingJobId, setPayingJobId] = useState<number | null>(null);
  const [ddPayAmount, setDdPayAmount] = useState("");
  const [ddPayMethod, setDdPayMethod] = useState<"CASH" | "BACS" | "CARD">("CASH");
  const [isSaving, startSaving] = useTransition();
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [dragSrcIdx, setDragSrcIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // ── 3-tab add-job state ──────────────────────────────────────────────────
  const [addTab, setAddTab] = useState<"from-area" | "one-off" | "new-customer">("from-area");
  const [addAreas, setAddAreas] = useState<Array<{ id: number; name: string }>>([]);
  // From-area tab
  const [addAreaId, setAddAreaId] = useState("");
  const [addAreaCustomers, setAddAreaCustomers] = useState<Array<{ id: number; name: string; address: string; price: number }>>([]);
  const [loadingAddAreaCustomers, setLoadingAddAreaCustomers] = useState(false);
  // One-off tab
  const [addOneOffMode, setAddOneOffMode] = useState<"search" | "new-customer">("search");
  const [addOneOffQuery, setAddOneOffQuery] = useState("");
  const [addOneOffResults, setAddOneOffResults] = useState<CustomerSearchResult[]>([]);
  const [addOneOffSelected, setAddOneOffSelected] = useState<CustomerSearchResult | null>(null);
  const [addOneOffJobName, setAddOneOffJobName] = useState("Window Cleaning");
  const [addOneOffCustomPrice, setAddOneOffCustomPrice] = useState("");
  const [addOneOffNotes, setAddOneOffNotes] = useState("");
  // New customer (shared by one-off sub-mode + New Customer tab)
  const [addNewName, setAddNewName] = useState("");
  const [addNewAddress, setAddNewAddress] = useState("");
  const [addNewJobName, setAddNewJobName] = useState("Window Cleaning");
  const [addNewPrice, setAddNewPrice] = useState("");
  const [addNewAreaIdStr, setAddNewAreaIdStr] = useState("");
  const [addNewNotes, setAddNewNotes] = useState("");
  // One-off new-customer: optional area + frequency (no area = pure one-off)
  const [addOneOffNewAreaIdStr, setAddOneOffNewAreaIdStr] = useState("");
  const [addOneOffNewFrequency, setAddOneOffNewFrequency] = useState("4");

  const resetAddJob = () => {
    setAddTab("from-area");
    setAddAreaId(""); setAddAreaCustomers([]); setLoadingAddAreaCustomers(false);
    setAddOneOffMode("search"); setAddOneOffQuery(""); setAddOneOffResults([]); setAddOneOffSelected(null);
    setAddOneOffJobName("Window Cleaning"); setAddOneOffCustomPrice(""); setAddOneOffNotes("");
    setAddNewName(""); setAddNewAddress(""); setAddNewJobName("Window Cleaning");
    setAddNewPrice(""); setAddNewAreaIdStr(""); setAddNewNotes("");
    setAddOneOffNewAreaIdStr(""); setAddOneOffNewFrequency("4");
  };

  // Fetch fresh full day data (includes payment info) and update localJobs
  const refreshFromServer = useCallback(async (dayId: number) => {
    const fresh = await getWorkDay(dayId);
    if (fresh) setLocalJobs([...fresh.jobs].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
  }, []);

  // Sync when modal opens for a different day
  const [syncedId, setSyncedId] = useState<number | null>(null);
  if (workDay && workDay.id !== syncedId) {
    setSyncedId(workDay.id);
    setLocalJobs([...workDay.jobs].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) as FullJob[]);
    setHasOrderChanges(false);
    setEditingNoteId(null);
    setEditingPriceId(null);
    setShowAddJob(false);
    setRouteModalOpen(false);
    setDragSrcIdx(null);
    setDragOverIdx(null);
  }

  // Enrich localJobs with full payment data as soon as workDay changes
  useEffect(() => {
    if (!workDay) return;
    refreshFromServer(workDay.id);
  }, [workDay?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveJob = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= localJobs.length) return;
    const next = [...localJobs];
    [next[idx], next[target]] = [next[target], next[idx]];
    setLocalJobs(next);
    setHasOrderChanges(true);
  };

  const handleSaveOrder = () => {
    if (!workDay) return;
    startSaving(async () => {
      await reorderDayJobs(workDay.id, localJobs.map((j) => j.id));
      setHasOrderChanges(false);
      router.refresh();
    });
  };

  const handleSaveNote = (jobId: number) => {
    startSaving(async () => {
      await updateJobNotes(jobId, noteText);
      setLocalJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, notes: noteText.trim() || null } : j));
      setEditingNoteId(null);
      router.refresh();
    });
  };

  const handleSavePrice = (jobId: number) => {
    const price = parseFloat(priceText);
    if (isNaN(price) || price < 0) return;
    startSaving(async () => {
      await updateJobPrice(jobId, price);
      setLocalJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, price } : j));
      setEditingPriceId(null);
      router.refresh();
    });
  };

  const ensureAddAreas = useCallback(async () => {
    if (addAreas.length > 0) return;
    try {
      const r = await fetch("/api/areas");
      if (r.ok) setAddAreas(await r.json());
    } catch { /* ignore */ }
  }, [addAreas.length]);

  const handleAddAreaChange = useCallback(async (areaId: string) => {
    setAddAreaId(areaId);
    setAddAreaCustomers([]);
    if (!areaId) return;
    setLoadingAddAreaCustomers(true);
    try {
      const r = await fetch(`/api/customers/search?areaId=${areaId}`);
      if (r.ok) setAddAreaCustomers(await r.json());
    } catch { /* ignore */ }
    setLoadingAddAreaCustomers(false);
  }, []);

  const handleOneOffSearch = useCallback(async () => {
    if (addOneOffQuery.trim().length < 2) return;
    try {
      const r = await fetch(`/api/customers/search?q=${encodeURIComponent(addOneOffQuery)}`);
      if (r.ok) setAddOneOffResults(await r.json());
    } catch { /* ignore */ }
  }, [addOneOffQuery]);

  const handleAddOneOffToDay = () => {
    if (!workDay || !addOneOffSelected) return;
    startSaving(async () => {
      await addOneOffJobToDay(workDay.id, addOneOffSelected.id, {
        name: addOneOffJobName,
        price: addOneOffCustomPrice ? parseFloat(addOneOffCustomPrice) : undefined,
        notes: addOneOffNotes || undefined,
      });
      setShowAddJob(false);
      resetAddJob();
      await refreshFromServer(workDay.id);
      router.refresh();
    });
  };

  const handleCreateNewCustomer = () => {
    if (!workDay || !addNewName.trim() || !addNewAddress.trim() || !addNewPrice || !addNewAreaIdStr) return;
    startSaving(async () => {
      await createCustomerAndAddToDay({
        name: addNewName.trim(),
        address: addNewAddress.trim(),
        price: parseFloat(addNewPrice),
        areaId: parseInt(addNewAreaIdStr),
        jobName: addNewJobName.trim() || undefined,
        notes: addNewNotes.trim() || undefined,
      }, workDay.id);
      setShowAddJob(false);
      resetAddJob();
      await refreshFromServer(workDay.id);
      router.refresh();
    });
  };

  const handleCreateOneOffNewCustomer = () => {
    if (!workDay || !addNewName.trim() || !addNewAddress.trim() || !addNewPrice) return;
    startSaving(async () => {
      await createOneOffCustomerAndAddToDay({
        name: addNewName.trim(),
        address: addNewAddress.trim(),
        price: parseFloat(addNewPrice),
        jobName: addNewJobName.trim() || undefined,
        notes: addNewNotes.trim() || undefined,
        areaId: addOneOffNewAreaIdStr ? parseInt(addOneOffNewAreaIdStr) : undefined,
        frequencyWeeks: addOneOffNewAreaIdStr ? (parseInt(addOneOffNewFrequency) || 4) : undefined,
      }, workDay.id);
      setShowAddJob(false);
      resetAddJob();
      await refreshFromServer(workDay.id);
      router.refresh();
    });
  };

  const handleRemoveJob = (jobId: number) => {
    setRemovingId(jobId);
    startSaving(async () => {
      await removeJobFromDay(jobId);
      setLocalJobs((prev) => prev.filter((j) => j.id !== jobId));
      setRemovingId(null);
      router.refresh();
    });
  };

  const handleDayDetailMarkPaid = (job: FullJob) => {
    if (!workDay || !job.customer) return;
    const amount = parseFloat(ddPayAmount);
    if (isNaN(amount) || amount <= 0) return;
    const split = splitCollectedAmount(amount, job.price);
    startSaving(async () => {
      if (split.currentJobAmount > 0) {
        await markJobPaid({ jobId: job.id, customerId: job.customer!.id, workDayId: workDay.id, amount: split.currentJobAmount, method: ddPayMethod });
      }
      if (split.extraDebtAmount > 0) {
        await logPayment({
          customerId: job.customer!.id,
          amount: split.extraDebtAmount,
          method: ddPayMethod,
          notes: "Previous balance collected on scheduler day view",
        });
      }
      setPayingJobId(null);
      await refreshFromServer(workDay.id);
      router.refresh();
    });
  };



  if (!workDay) return null;
  const title = workDay.area?.name ?? "Work Day";
  const dateStr = new Date(workDay.date).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
  });

  return (
    <>
      <Modal open={true} onClose={onClose} title={`${title} — ${dateStr}`}>
      <div className="space-y-3">
        {/* One-off banner */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200">
          <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-snug">
            <strong>One-off changes for this day only.</strong> Price and note edits won't affect the customer's regular price or schedule.
          </p>
        </div>

        <div className="flex gap-2">
          {hasOrderChanges && (
            <button onClick={handleSaveOrder} disabled={isSaving}
              className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60">
              {isSaving ? "Saving…" : "Save Order"}
            </button>
          )}
          {localJobs.length > 1 && (
            <button onClick={() => setRouteModalOpen(true)} disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50 hover:border-emerald-400 text-slate-600 hover:text-emerald-700 text-sm font-semibold disabled:opacity-60 transition-colors flex-shrink-0">
              <Navigation2 size={13} />
              Optimise Route
            </button>
          )}
        </div>

        {/* Customer list header with full-day link */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Customers</span>
          <Link href={`/days/${workDay.id}`} onClick={onClose}
            className="text-xs text-blue-600 hover:underline font-medium flex-shrink-0">
            View full day →
          </Link>
        </div>

        {localJobs.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">No jobs on this day yet.</p>
        )}

        <div className="space-y-1.5">
          {localJobs.map((job, idx) => {
            const isDone = job.status === "COMPLETE";
            return (
              <div
                key={job.id}
                draggable={!isDone}
                onDragStart={(e) => {
                  if (isDone) { e.preventDefault(); return; }
                  setDragSrcIdx(idx);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragSrcIdx !== null && dragSrcIdx !== idx) setDragOverIdx(idx);
                }}
                onDragEnd={() => { setDragSrcIdx(null); setDragOverIdx(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragSrcIdx !== null && dragSrcIdx !== idx) {
                    const next = [...localJobs];
                    const [moved] = next.splice(dragSrcIdx, 1);
                    next.splice(idx, 0, moved);
                    setLocalJobs(next);
                    setHasOrderChanges(true);
                  }
                  setDragSrcIdx(null);
                  setDragOverIdx(null);
                }}
                className={cn(
                  "flex flex-col gap-1 p-2.5 rounded-xl border transition-all select-none relative",
                  job.status === "OUTSTANDING" ? "bg-red-50 border-red-200" :
                  job.status === "SKIPPED" ? "bg-slate-50 border-slate-200 opacity-60" :
                  "bg-white border-slate-200",
                  isDone && "ring-2 ring-green-400 border-green-300 bg-green-50/60",
                  !isDone && "cursor-grab active:cursor-grabbing",
                  dragSrcIdx === idx && "opacity-30 scale-[0.98]",
                  dragOverIdx === idx && dragSrcIdx !== idx && "ring-2 ring-blue-400 ring-offset-1"
                )}
              >
                {isDone && (
                  <span className="absolute top-2 right-2 text-green-600" title="Completed">
                    <CheckCircle2 size={18} />
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    <button onClick={() => moveJob(idx, -1)} disabled={idx === 0}
                      className="p-0.5 rounded text-slate-400 hover:text-slate-700 disabled:opacity-20">
                      <ChevronUp size={12} />
                    </button>
                    <button onClick={() => moveJob(idx, 1)} disabled={idx === localJobs.length - 1}
                      className="p-0.5 rounded text-slate-400 hover:text-slate-700 disabled:opacity-20">
                      <ChevronDown size={12} />
                    </button>
                  </div>
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-400 flex items-center justify-center text-[10px] font-bold text-white">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className={cn("text-sm font-semibold truncate",
                        job.status === "COMPLETE" ? "text-green-800" : job.status === "SKIPPED" ? "text-slate-500" : "text-slate-800"
                      )}>{job.customer?.name ?? "Unknown"}</p>
                      {job.isOneOff && (
                        <span className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-300 whitespace-nowrap">
                          <Zap size={9} className="flex-shrink-0" />
                          {job.customer?.area?.name ? job.customer.area.name : "one-off"}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium text-blue-700 truncate mt-0.5">{getJobTitle(job)}</p>
                    <p className="text-xs text-slate-400 truncate">{job.customer?.address ?? ""}</p>
                    {/* Status badges */}
                    {job.status !== "PENDING" && (() => {
                      return (
                        <div className="flex gap-1 flex-wrap mt-0.5">
                          {job.status === "COMPLETE" && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">✔ Done</span>
                          )}
                          {job.status === "COMPLETE" && (() => {
                            const totalPaid = job.payments?.reduce((s, p) => s + p.amount, 0) ?? 0;
                            if (totalPaid > 0 && totalPaid < job.price) return (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">£{totalPaid.toFixed(2)} paid</span>
                            );
                            return null;
                          })()}
                          {job.status === "OUTSTANDING" && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">Outstanding</span>
                          )}
                          {job.status === "SKIPPED" && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">Skipped</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isDone && (() => {
                      const totalPaid = job.payments?.reduce((s, p) => s + p.amount, 0) ?? 0;
                      const isPaid = totalPaid > 0 && totalPaid >= job.price;
                      const isPayingThis = payingJobId === job.id;
                      return isPaid ? (
                        <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-green-100 border border-green-200 text-[10px] font-bold text-green-700 whitespace-nowrap flex-shrink-0">
                          <CheckCircle2 size={10} /> Paid
                        </span>
                      ) : (
                        <button
                          onClick={() => { setPayingJobId(isPayingThis ? null : job.id); setDdPayAmount(job.price.toFixed(2)); setDdPayMethod("CASH"); }}
                          className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-[10px] font-bold text-amber-700 hover:bg-amber-100 active:bg-amber-200 transition-colors whitespace-nowrap flex-shrink-0"
                          title="Mark as paid"
                        >
                          <CreditCard size={10} /> Mark Paid
                        </button>
                      );
                    })()}
                    <button
                      onClick={() => {
                        if (editingPriceId === job.id) { setEditingPriceId(null); }
                        else { setEditingPriceId(job.id); setPriceText(job.price.toFixed(2)); setEditingNoteId(null); }
                      }}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                      title="Edit price for this day only"
                    >
                      <span>£{job.price.toFixed(2)}</span>
                      <Pencil size={9} className="text-slate-400" />
                    </button>
                    <button
                      onClick={() => {
                        if (editingNoteId === job.id) { setEditingNoteId(null); }
                        else { setEditingNoteId(job.id); setNoteText(job.notes ?? ""); setEditingPriceId(null); }
                      }}
                      className={cn(
                        "p-1 rounded-full transition-colors",
                        job.notes ? "text-amber-500 bg-amber-50 hover:bg-amber-100" : "text-slate-300 hover:text-amber-500"
                      )}
                      title="Note for this visit"
                    >
                      <StickyNote size={13} />
                    </button>
                    {!isDone && (
                      <button
                        onClick={() => handleRemoveJob(job.id)}
                        disabled={isSaving && removingId === job.id}
                        className="p-1 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                        title="Remove from this day"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {editingPriceId === job.id && (
                  <div className="flex items-center gap-2 pt-1 pl-9">
                    <span className="text-xs text-slate-500">Price for this day:</span>
                    <span className="text-xs text-slate-500">£</span>
                    <input type="number" step="0.01" min="0" value={priceText}
                      onChange={(e) => setPriceText(e.target.value)}
                      className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                      autoFocus
                    />
                    <button onClick={() => handleSavePrice(job.id)} disabled={isSaving}
                      className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-60">Save</button>
                    <button onClick={() => setEditingPriceId(null)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
                  </div>
                )}

                {editingNoteId === job.id && (
                  <div className="flex gap-2 pt-1">
                    <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Note for this visit only…"
                      className="flex-1 border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white min-h-[60px]"
                      autoFocus
                    />
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <button onClick={() => handleSaveNote(job.id)} disabled={isSaving}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-60">Save</button>
                      <button onClick={() => setEditingNoteId(null)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
                    </div>
                  </div>
                )}

                {/* Inline pay form for complete-but-unpaid jobs */}
                {isDone && payingJobId === job.id && (() => {
                  const totalPaid = job.payments?.reduce((s, p) => s + p.amount, 0) ?? 0;
                  const previousDebt = getPreviousDebt(job);
                  if (totalPaid >= job.price && totalPaid > 0) return null;
                  return (
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100 flex-wrap">
                      {previousDebt > 0 && (
                        <>
                          <button
                            onClick={() => setDdPayAmount(job.price.toFixed(2))}
                            className="px-2 py-1 rounded-lg border border-blue-200 bg-white text-[11px] font-semibold text-blue-700 hover:border-blue-400"
                          >
                            This clean
                          </button>
                          <button
                            onClick={() => setDdPayAmount((job.price + previousDebt).toFixed(2))}
                            className="px-2 py-1 rounded-lg border border-amber-200 bg-white text-[11px] font-semibold text-amber-700 hover:border-amber-400"
                          >
                            Including debt
                          </button>
                          <span className="text-[11px] text-amber-700 font-medium">Owes £{previousDebt.toFixed(2)} older balance</span>
                        </>
                      )}
                      <span className="text-xs font-semibold text-slate-500">Amount £</span>
                      <input
                        type="number" step="0.01" min="0" value={ddPayAmount}
                        onChange={(e) => setDdPayAmount(e.target.value)}
                        className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                        autoFocus
                      />
                      <select
                        value={ddPayMethod} onChange={(e) => setDdPayMethod(e.target.value as "CASH" | "BACS" | "CARD")}
                        className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                      >
                        <option value="CASH">Cash</option>
                        <option value="BACS">BACS</option>
                        <option value="CARD">Card</option>
                      </select>
                      <button onClick={() => handleDayDetailMarkPaid(job)} disabled={isSaving}
                        className="px-3 py-1 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold disabled:opacity-60">Confirm</button>
                      <button onClick={() => setPayingJobId(null)}
                        className="px-3 py-1 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {/* Add customer to this day */}
        {!showAddJob ? (
          <button
            onClick={() => {
              setShowAddJob(true);
              ensureAddAreas();
              if (workDay?.areaId) {
                setAddAreaId(String(workDay.areaId));
                setAddNewAreaIdStr(String(workDay.areaId));
              }
            }}
            className="w-full py-2 rounded-lg border border-dashed border-slate-300 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
          >
            <UserPlus size={14} />
            Add customer to this day
          </button>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
            {/* Tab bar */}
            <div className="flex gap-1 p-1.5 bg-slate-100 border-b border-slate-200">
              {([
                { key: "from-area", label: "From Area", icon: <MapPin size={11} /> },
                { key: "one-off", label: "One-Off", icon: <Search size={11} /> },
                { key: "new-customer", label: "New Customer", icon: <UserPlus size={11} /> },
              ] as const).map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => {
                    setAddTab(key);
                    if (key === "from-area" || key === "new-customer") ensureAddAreas();
                  }}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors",
                    addTab === key ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  {icon}{label}
                </button>
              ))}
            </div>

            <div className="p-3 space-y-2.5">
              {/* ── From Area tab ── */}
              {addTab === "from-area" && (
                <div className="space-y-2">
                  <select
                    value={addAreaId}
                    onChange={(e) => handleAddAreaChange(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  >
                    <option value="">– Select area –</option>
                    {addAreas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  {loadingAddAreaCustomers && <p className="text-xs text-slate-400 text-center py-2">Loading…</p>}
                  {addAreaId && !loadingAddAreaCustomers && addAreaCustomers.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-2">No active customers in this area.</p>
                  )}
                  {addAreaCustomers.length > 0 && (
                    <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                      {addAreaCustomers.map((c) => {
                        const already = localJobs.some((j) => j.customer?.id === c.id);
                        return (
                          <li key={c.id} className={cn("flex items-center justify-between px-3 py-2.5", already && "opacity-50")}>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                              <p className="text-xs text-slate-500 truncate">{c.address} · £{c.price.toFixed(2)}</p>
                            </div>
                            {already ? (
                              <span className="text-xs text-slate-400 ml-2 flex-shrink-0">On day</span>
                            ) : (
                              <button
                                disabled={isSaving}
                                onClick={() => {
                                  if (!workDay) return;
                                  startSaving(async () => {
                                    await addJobFromOtherArea(workDay.id, c.id);
                                    setShowAddJob(false);
                                    await refreshFromServer(workDay.id);
                                    router.refresh();
                                  });
                                }}
                                className="ml-2 flex-shrink-0 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                              >
                                Add
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {/* ── One-Off tab ── */}
              {addTab === "one-off" && (
                <div className="space-y-2">
                  {/* Sub-mode switch */}
                  <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
                    <button
                      onClick={() => { setAddOneOffMode("search"); setAddOneOffSelected(null); setAddOneOffQuery(""); setAddOneOffResults([]); }}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors",
                        addOneOffMode === "search" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      <Search size={10} /> Existing
                    </button>
                    <button
                      onClick={() => { setAddOneOffMode("new-customer"); ensureAddAreas(); }}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors",
                        addOneOffMode === "new-customer" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      <Plus size={10} /> New Customer
                    </button>
                  </div>

                  {addOneOffMode === "search" && (
                    <>
                      {!addOneOffSelected ? (
                        <>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Search by name or address…"
                              value={addOneOffQuery}
                              onChange={(e) => setAddOneOffQuery(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleOneOffSearch()}
                              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                            />
                            <button onClick={handleOneOffSearch} className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
                              <Search size={14} className="text-slate-500" />
                            </button>
                          </div>
                          {addOneOffResults.length > 0 && (
                            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden max-h-44 overflow-y-auto">
                              {addOneOffResults.map((c) => {
                                const already = localJobs.some((j) => j.customer?.id === c.id);
                                return (
                                  <li
                                    key={c.id}
                                    onClick={!already ? () => { setAddOneOffSelected(c); setAddOneOffCustomPrice(String(c.price)); } : undefined}
                                    className={cn("flex items-center justify-between px-3 py-2.5", already ? "opacity-50 cursor-default" : "hover:bg-slate-50 cursor-pointer")}
                                  >
                                    <div>
                                      <p className="text-sm font-medium text-slate-800">{c.name}</p>
                                      <p className="text-xs text-slate-500">{c.address}{c.area ? ` · ${c.area.name}` : ""}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-semibold">£{c.price.toFixed(2)}</span>
                                      {already ? <span className="text-xs text-slate-400">Added</span> : <Plus size={13} className="text-blue-500" />}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-between p-2.5 bg-blue-50 rounded-xl border border-blue-200">
                            <div>
                              <p className="text-sm font-semibold text-blue-900">{addOneOffSelected.name}</p>
                              <p className="text-xs text-blue-600">{addOneOffSelected.address}</p>
                            </div>
                            <button onClick={() => { setAddOneOffSelected(null); setAddOneOffQuery(""); }} className="text-xs text-blue-500 hover:underline flex-shrink-0 ml-2">Change</button>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Job Name *</label>
                            <input type="text" value={addOneOffJobName} onChange={(e) => setAddOneOffJobName(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Price (£) <span className="text-slate-400 font-normal">— edit if different</span></label>
                            <input type="number" step="0.01" value={addOneOffCustomPrice} onChange={(e) => setAddOneOffCustomPrice(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                            <input type="text" value={addOneOffNotes} onChange={(e) => setAddOneOffNotes(e.target.value)}
                              placeholder="e.g. conservatory only…"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                          </div>
                          <button
                            disabled={isSaving || !addOneOffJobName.trim()}
                            onClick={handleAddOneOffToDay}
                            className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                          >
                            {isSaving ? "Adding…" : "Add One-off Job"}
                          </button>
                        </>
                      )}
                    </>
                  )}

                  {addOneOffMode === "new-customer" && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">
                        <span className="text-xs text-purple-700 font-medium">Creates a new customer with no recurring schedule — job history still viewable on their record. Optionally assign an area and frequency to add them to the regular schedule.</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-slate-700 mb-1">Job Name</label>
                          <input type="text" value={addNewJobName} onChange={(e) => setAddNewJobName(e.target.value)}
                            placeholder="Window Cleaning"
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-slate-700 mb-1">Name *</label>
                          <input type="text" value={addNewName} onChange={(e) => setAddNewName(e.target.value)}
                            placeholder="Jane Smith"
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-slate-700 mb-1">Address *</label>
                          <input type="text" value={addNewAddress} onChange={(e) => setAddNewAddress(e.target.value)}
                            placeholder="12 High Street"
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Price (£) *</label>
                          <input type="number" step="0.50" min="0" value={addNewPrice} onChange={(e) => setAddNewPrice(e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Area <span className="text-slate-400 font-normal">(optional)</span>
                          </label>
                          <select value={addOneOffNewAreaIdStr} onChange={(e) => setAddOneOffNewAreaIdStr(e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                            <option value="">– No area –</option>
                            {addAreas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </div>
                        {addOneOffNewAreaIdStr && (
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-slate-700 mb-1">Frequency</label>
                            <div className="flex gap-1.5">
                              {["1","2","4","6","8","12"].map((w) => (
                                <button key={w} type="button" onClick={() => setAddOneOffNewFrequency(w)}
                                  className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                                    addOneOffNewFrequency === w
                                      ? "border-blue-600 bg-blue-600 text-white"
                                      : "border-slate-200 text-slate-600 hover:border-blue-300"
                                  }`}>
                                  {w}w
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-slate-700 mb-1">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                          <input type="text" value={addNewNotes} onChange={(e) => setAddNewNotes(e.target.value)}
                            placeholder="Dog in garden, ring bell…"
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                        </div>
                      </div>
                      <button
                        disabled={isSaving || !addNewName.trim() || !addNewAddress.trim() || !addNewPrice}
                        onClick={handleCreateOneOffNewCustomer}
                        className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                      >
                        {isSaving ? "Creating…" : (addOneOffNewAreaIdStr ? "Create Customer & Add to Day" : "Create One-off & Add to Day")}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── New Customer tab ── */}
              {addTab === "new-customer" && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Job Name</label>
                      <input type="text" value={addNewJobName} onChange={(e) => setAddNewJobName(e.target.value)}
                        placeholder="Window Cleaning"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Name *</label>
                      <input type="text" value={addNewName} onChange={(e) => setAddNewName(e.target.value)}
                        placeholder="Jane Smith"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Address *</label>
                      <input type="text" value={addNewAddress} onChange={(e) => setAddNewAddress(e.target.value)}
                        placeholder="12 High Street"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Price (£) *</label>
                      <input type="number" step="0.50" min="0" value={addNewPrice} onChange={(e) => setAddNewPrice(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Area *</label>
                      <select value={addNewAreaIdStr} onChange={(e) => setAddNewAreaIdStr(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                        <option value="">– Area –</option>
                        {addAreas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                      <input type="text" value={addNewNotes} onChange={(e) => setAddNewNotes(e.target.value)}
                        placeholder="Dog in garden, ring bell…"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                    </div>
                  </div>
                  <button
                    disabled={isSaving || !addNewName.trim() || !addNewAddress.trim() || !addNewPrice || !addNewAreaIdStr}
                    onClick={handleCreateNewCustomer}
                    className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {isSaving ? "Creating…" : "Create & Add to Day"}
                  </button>
                </div>
              )}

              <button
                onClick={() => { setShowAddJob(false); resetAddJob(); }}
                className="text-xs text-slate-400 hover:text-slate-600 block text-center w-full pt-1"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-slate-100">
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Done
          </button>
        </div>
      </div>
    </Modal>
    <SchedulerRouteOptimiserModal
      jobs={localJobs}
      open={routeModalOpen}
      onClose={() => setRouteModalOpen(false)}
      onApply={(ordered) => {
        setLocalJobs(ordered as FullJob[]);
        setHasOrderChanges(true);
        setRouteModalOpen(false);
      }}
    />
  </>
  );
}

// ── Main Scheduler Client ─────────────────────────────────────────────────────

export function SchedulerClient({ areas, workDays, holidays: initialHolidays }: {
  areas: Area[];
  workDays: WorkDay[];
  holidays: Holiday[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOfWeek(new Date()));
  const goToPrevWeek = () => setWeekStart((w) => addDays(w, -7));
  const goToNextWeek = () => setWeekStart((w) => addDays(w, 7));
  const goToThisWeek = () => setWeekStart(getMondayOfWeek(new Date()));
  const isCurrentWeek = isoDate(weekStart) === isoDate(getMondayOfWeek(new Date()));
  const [dragState, setDragState] = useState<DragState>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [addAreaOpen, setAddAreaOpen] = useState(false);
  const [oneOffOpen, setOneOffOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  // Removed moveModal state and logic (obsolete)
  const [areasCollapsed, setAreasCollapsed] = useState(false);

  const areasScrollRef = useRef<HTMLDivElement>(null);
  const [areasCanScrollLeft, setAreasCanScrollLeft] = useState(false);
  const [areasCanScrollRight, setAreasCanScrollRight] = useState(false);

  // Edge-nav for drag week change
  const edgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearEdgeTimer = useCallback(() => {
    if (edgeTimerRef.current) { clearTimeout(edgeTimerRef.current); edgeTimerRef.current = null; }
  }, []);

  // Holidays
  const [holidays, setHolidays] = useState<Holiday[]>(initialHolidays);
  const [holidayModalOpen, setHolidayModalOpen] = useState(false);

  // Extract the YYYY-MM-DD string from a holiday date (stored as UTC midnight,
  // so slicing the ISO string always gives the canonical calendar date regardless
  // of the browser's local timezone).
  function holidayIso(d: Date | string): string {
    const s = typeof d === "string" ? d : d.toISOString();
    return s.slice(0, 10);
  }

  const isDateHoliday = useCallback((date: Date): boolean => {
    const iso = isoDate(date); // local calendar date of the cell
    return holidays.some((h) => {
      return iso >= holidayIso(h.startDate) && iso <= holidayIso(h.endDate);
    });
  }, [holidays]);

  const getDateHolidayLabel = useCallback((date: Date): string | null => {
    const iso = isoDate(date);
    const h = holidays.find((hol) => {
      return iso >= holidayIso(hol.startDate) && iso <= holidayIso(hol.endDate);
    });
    return h?.label ?? null;
  }, [holidays]);

  const handleAreasScroll = useCallback(() => {
    const el = areasScrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    setAreasCanScrollLeft(el.scrollTop > 2);
    setAreasCanScrollRight(el.scrollTop < maxScroll - 2);
  }, []);

  useEffect(() => {
    if (!areasCollapsed) requestAnimationFrame(handleAreasScroll);
  }, [areasCollapsed, areas.length, handleAreasScroll]);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [notesDay, setNotesDay] = useState<WorkDay | null>(null);
  const [notesDayText, setNotesDayText] = useState("");
  const [expandedDay, setExpandedDay] = useState<WorkDay | null>(null);
  const [completedExpandedDay, setCompletedExpandedDay] = useState<WorkDay | null>(null);

  const handleNotesClick = useCallback((wd: WorkDay) => {
    setNotesDayText(wd.notes ?? "");
    setNotesDay(wd);
  }, []);

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const workDaysByDate = new Map<string, WorkDay[]>();
  for (const wd of workDays) {
    // DB dates are UTC midnight — use UTC components for the map key
    const key = isoDate(toUTCMidnight(wd.date));
    const arr = workDaysByDate.get(key) ?? [];
    arr.push(wd);
    workDaysByDate.set(key, arr);
  }

  const today0 = toUTCMidnight(new Date());

  // Only show areas with no upcoming planned/in-progress work day in the areas panel
  const scheduledAreaIds = new Set(
    workDays
      .filter((wd) => wd.status !== "COMPLETE" && toUTCMidnight(wd.date) >= today0)
      .map((wd) => wd.areaId)
      .filter(Boolean) as number[]
  );

  const sortedAreas = [...areas]
    .filter((a) => !scheduledAreaIds.has(a.id))
    .sort((a, b) => {
      const da = nextExpectedDateForArea(a)?.getTime() ?? Infinity;
      const db = nextExpectedDateForArea(b)?.getTime() ?? Infinity;
      return da - db;
    });

  const overdueAreas = sortedAreas.filter((a) => {
    const expected = nextExpectedDateForArea(a);
    if (!expected) return false;
    return expected < today0;
  });

  const scheduledOverdueAreas = areas
    .filter((a) => {
      if (!scheduledAreaIds.has(a.id)) return false;
      const expected = nextExpectedDateForArea(a);
      if (!expected) return false;
      return expected < today0;
    })
    .sort((a, b) => {
      const da = nextExpectedDateForArea(a)?.getTime() ?? Infinity;
      const db = nextExpectedDateForArea(b)?.getTime() ?? Infinity;
      return da - db;
    });

  const handleAreaDragStart = useCallback((area: Area) => setDragState({ type: "area", area }), []);
  const handleWorkDayDragStart = useCallback((wd: WorkDay) => setDragState({ type: "workday", workDay: wd }), []);
  const handleJobDragStart = useCallback((job: PendingJob) => setDragState({ type: "job", job }), []);
  const handleDragOver = useCallback((date: Date) => setDragOverDate(isoDate(date)), []);
  const handleDragLeave = useCallback(() => setDragOverDate(null), []);

  const handleDrop = useCallback((targetDate: Date) => {
    setDragOverDate(null);
    if (!dragState) return;
    // Block drops on holidays
    if (isDateHoliday(targetDate)) {
      setDuplicateWarning(`That date is a holiday (\'${getDateHolidayLabel(targetDate)}\') — pick another day.`);
      setTimeout(() => setDuplicateWarning(null), 4000);
      setDragState(null);
      return;
    }
    if (dragState.type === "area") {
      const { area } = dragState;
      // Prevent scheduling the same area twice in the same Mon–Sun week
      const targetMonday = getMondayOfWeek(targetDate);
      const targetSunday = addDays(targetMonday, 6);
      targetMonday.setHours(0, 0, 0, 0);
      targetSunday.setHours(23, 59, 59, 999);
      const alreadyThisWeek = workDays.some((wd) => {
        if (wd.areaId !== area.id) return false;
        const wdDate = toUTCMidnight(wd.date);
        return wdDate >= targetMonday && wdDate <= targetSunday;
      });
      if (alreadyThisWeek) {
        setDuplicateWarning(`${area.name} is already scheduled this week. Move the existing day instead.`);
        setTimeout(() => setDuplicateWarning(null), 4000);
        setDragState(null);
        return;
      }
      startTransition(async () => {
        await scheduleAreaRun(area.id, isoDate(targetDate));
        router.refresh();
      });
    } else if (dragState.type === "workday") {
      const { workDay } = dragState;
      const targetISO = isoDate(targetDate);
      const sourceISO = isoDate(toUTCMidnight(workDay.date));
      if (targetISO === sourceISO) return;
      startTransition(async () => {
        await rescheduleWorkDay(workDay.id, targetISO, "one-off");
        router.refresh();
      });
    } else if (dragState.type === "job") {
      const { job } = dragState;
      const targetISO = isoDate(targetDate);
      const sourceISO = isoDate(toUTCMidnight(job.workDay.date));
      if (targetISO === sourceISO) return;
      startTransition(async () => {
        await rescheduleJobToDate(job.id, isoDate(targetDate));
        router.refresh();
      });
    }
    setDragState(null);
  }, [dragState, router, startTransition]);

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      <Modal open={clearConfirmOpen} onClose={() => setClearConfirmOpen(false)} title="Clear Future Schedule">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            This will delete <span className="font-semibold text-slate-800">all planned work days from today onwards</span>.
            Completed and in-progress days are kept. This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                startTransition(async () => {
                  await clearFutureSchedule();
                  setClearConfirmOpen(false);
                  router.refresh();
                });
              }}
              className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              Yes, clear schedule
            </button>
            <button
              onClick={() => setClearConfirmOpen(false)}
              className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Areas strip ────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 bg-slate-50 flex-shrink-0">
        {/* Strip header */}
        <div className="flex items-center justify-between px-3 py-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAreasCollapsed((c) => !c)}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-600 uppercase tracking-wide hover:text-slate-900 transition-colors"
            >
              <ChevronRight size={13} className={cn("transition-transform", areasCollapsed ? "" : "rotate-90")} />
              Areas
              {overdueAreas.length > 0 && (
                <span className="ml-0.5 bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">
                  {overdueAreas.length} overdue
                </span>
              )}
            </button>
            <span className="text-[11px] text-slate-400">— drag onto a day below</span>
          </div>
          {/* Toolbar buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setAddAreaOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
            >
              <Plus size={12} /> Area
            </button>
            <button
              onClick={() => setOneOffOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
            >
              <Zap size={12} /> One-off
            </button>
            <button
              onClick={() => setHolidayModalOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
            >
              <Umbrella size={12} /> Holidays
            </button>
            <button
              onClick={() => setClearConfirmOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-red-200 bg-white text-xs font-semibold text-red-500 hover:bg-red-50 hover:border-red-300 transition-colors"
              title="Clear all future scheduled days"
            >
              <Trash2 size={12} /> Clear
            </button>
          </div>
        </div>

        {scheduledOverdueAreas.length > 0 && (
          <div className="mx-3 mb-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold">
                {scheduledOverdueAreas.length} overdue area{scheduledOverdueAreas.length === 1 ? " is" : "s are"} already booked later in the schedule.
              </p>
              <p className="text-amber-800/80">
                {scheduledOverdueAreas.slice(0, 4).map((area) => area.name).join(", ")}
                {scheduledOverdueAreas.length > 4 ? ` +${scheduledOverdueAreas.length - 4} more` : ""}
              </p>
            </div>
          </div>
        )}

        {/* Wrapping 2-row area cards grid */}
        {!areasCollapsed && (
          <div className="relative">
            {/* Up arrow — shown when scrolled down */}
            {areasCanScrollLeft && (
              <div className="pointer-events-none absolute left-0 right-0 top-0 h-8 bg-gradient-to-b from-slate-50 to-transparent z-10 flex items-start justify-center pt-0.5">
                <button
                  className="pointer-events-auto bg-white border border-slate-300 rounded-lg px-4 py-1 shadow text-slate-600 hover:text-slate-900 hover:shadow-md transition-all flex items-center gap-1 text-xs font-semibold"
                  onClick={() => areasScrollRef.current?.scrollBy({ top: -160, behavior: "smooth" })}
                >
                  <ChevronUp size={14} /> Scroll up
                </button>
              </div>
            )}
            {/* Down arrow — shown when more content below */}
            {areasCanScrollRight && (
              <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-8 bg-gradient-to-t from-slate-50 to-transparent z-10 flex items-end justify-center pb-0.5">
                <button
                  className="pointer-events-auto bg-white border border-slate-300 rounded-lg px-4 py-1 shadow text-slate-600 hover:text-slate-900 hover:shadow-md transition-all flex items-center gap-1 text-xs font-semibold"
                  onClick={() => areasScrollRef.current?.scrollBy({ top: 160, behavior: "smooth" })}
                >
                  <ChevronDown size={14} /> Scroll down
                </button>
              </div>
            )}
            {/* Wrapping grid — max 2 rows visible before scroll */}
            <div
              ref={areasScrollRef}
              onScroll={handleAreasScroll}
              className="areas-scroll flex flex-wrap gap-2 px-3 pt-1 pb-2.5 overflow-y-auto"
              style={{ maxHeight: "152px" }}
            >
              {sortedAreas.length === 0 ? (
                <div className="text-xs text-slate-400 py-1">
                  All areas scheduled — complete a day to auto-schedule the next.{" "}
                  <button onClick={() => setAddAreaOpen(true)} className="text-blue-600 font-semibold hover:underline">Add area</button>
                </div>
              ) : (
                sortedAreas.map((area) => {
                  // Find any scheduled-but-uncompleted workday in the past for this area
                  const todayMs = new Date().setHours(0, 0, 0, 0);
                  const overdueWd = workDays.find(
                    (wd) =>
                      wd.areaId === area.id &&
                      wd.status !== "COMPLETE" &&
                      new Date(wd.date).getTime() < todayMs
                  ) ?? null;
                  return (
                  <AreaPanelCard key={area.id} area={area} onDragStart={handleAreaDragStart} overdueWorkDay={overdueWd} />
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Calendar ───────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Duplicate warning */}
        {duplicateWarning && (
          <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-300 text-xs font-semibold text-amber-800 flex-shrink-0">
            <AlertCircle size={13} className="text-amber-500 flex-shrink-0" />
            {duplicateWarning}
          </div>
        )}

        {/* Week nav */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-white flex-shrink-0">
          <button
            onClick={goToPrevWeek}
            className={cn(
              "p-1.5 rounded-lg transition-colors text-slate-600",
              "hover:bg-slate-100"
            )}
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex flex-col items-center gap-0.5">
            <p className="text-sm font-bold text-slate-800">{formatWeekRange(weekStart)}</p>
            {dragState ? (
              <p className="text-[10px] text-blue-500 font-semibold animate-pulse">drag to edges to change week</p>
            ) : !isCurrentWeek ? (
              <button onClick={goToThisWeek}
                className="text-[11px] text-blue-600 font-semibold px-2 py-0.5 rounded-full bg-blue-50 hover:bg-blue-100">
                Today
              </button>
            ) : null}
          </div>
          <button
            onClick={goToNextWeek}
            className={cn(
              "p-1.5 rounded-lg transition-colors text-slate-600",
              "hover:bg-slate-100"
            )}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Day column headers */}
        <div className="grid grid-cols-7 border-b border-slate-200 bg-white flex-shrink-0">
          {weekDates.map((d, i) => {
            const iso = isoDate(d);
            const isToday = iso === todayISO();
            const cellWDs = workDaysByDate.get(iso) ?? [];
            const colJobs = cellWDs.reduce((s, wd) => s + wd.jobs.length, 0);
            const colValue = cellWDs.reduce((s, wd) => wd.jobs.reduce((s2, j) => s2 + j.price, s), 0);
            return (
              <div key={i} className={cn(
                "px-1 py-2 text-center border-r border-slate-100 last:border-r-0",
                isToday ? "bg-blue-50" : ""
              )}>
                <p className={cn("text-[10px] font-semibold uppercase tracking-wide",
                  isToday ? "text-blue-600" : "text-slate-500")}>{DAY_LABELS[i]}</p>
                <p className={cn("text-sm font-bold",
                  isToday ? "text-blue-600" : "text-slate-700")}>{fmtDayNum(d)}</p>
                {colJobs > 0 && (
                  <p className="text-[9px] text-slate-400 mt-0.5 tabular-nums leading-tight">
                    {colJobs}j · £{colValue.toFixed(0)}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Calendar grid — edge zones change week when dragging */}
        <div className="flex-1 overflow-y-auto relative"
          onDragOver={(e) => {
            if (!dragState) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            if (pct < 0.09) {
              if (!edgeTimerRef.current)
                edgeTimerRef.current = setTimeout(() => { goToPrevWeek(); edgeTimerRef.current = null; }, 750);
            } else if (pct > 0.91) {
              if (!edgeTimerRef.current)
                edgeTimerRef.current = setTimeout(() => { goToNextWeek(); edgeTimerRef.current = null; }, 750);
            } else {
              clearEdgeTimer();
            }
          }}
          onDragLeave={clearEdgeTimer}
          onDragEnd={clearEdgeTimer}
        >
          {/* Left edge indicator */}
          {dragState && (
            <>
              <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-20 bg-gradient-to-r from-blue-100/70 to-transparent flex items-center justify-start pl-1">
                <ChevronLeft size={16} className="text-blue-400" />
              </div>
              <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-20 bg-gradient-to-l from-blue-100/70 to-transparent flex items-center justify-end pr-1">
                <ChevronRight size={16} className="text-blue-400" />
              </div>
            </>
          )}
          <div className="grid grid-cols-7 gap-1.5 p-2 min-h-full">
            {weekDates.map((d) => {
              const iso = isoDate(d);
              const cellWorkDays = workDaysByDate.get(iso) ?? [];
              const isToday = iso === todayISO();
              const isDragOver = dragOverDate === iso;
              const isExpectedForDrag = (() => {
                if (!dragState) return false;
                if (dragState.type === "workday") {
                  const expected = dragState.workDay.area ? nextExpectedDateForArea(dragState.workDay.area) : null;
                  return !!expected && isoDate(expected) === iso;
                }
                return false;
              })();
              return (
                <CalendarCell
                  key={iso}
                  date={d}
                  workDays={cellWorkDays}
                  isToday={isToday}
                  dragState={dragState}
                  isHoliday={isDateHoliday(d)}
                  holidayLabel={getDateHolidayLabel(d)}
                  isExpectedForDrag={isExpectedForDrag}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  isDragOver={isDragOver}
                  onWorkDayDragStart={handleWorkDayDragStart}
                  onNotesClick={handleNotesClick}
                  onExpand={(wd) => {
                    if (wd.status === "COMPLETE") setCompletedExpandedDay(wd);
                    else setExpandedDay(wd);
                  }}
                  onRemove={(wd) => {
                    startTransition(async () => {
                      await deleteWorkDay(wd.id);
                      router.refresh();
                    });
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 px-3 py-1.5 bg-white border-t border-slate-200 flex-shrink-0 flex-wrap">
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Drop colour:</p>
          {([
            { colour: "bg-green-500", label: "Early / On time" },
            { colour: "bg-amber-400", label: "1–6d overdue" },
            { colour: "bg-orange-400", label: "7–13d overdue" },
            { colour: "bg-red-500",   label: "14d+ overdue" },
          ] as const).map(({ colour, label }) => (
            <div key={label} className="flex items-center gap-1">
              <div className={cn("w-2 h-2 rounded-full", colour)} />
              <span className="text-[10px] text-slate-500">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      <AddAreaModal open={addAreaOpen} onClose={() => setAddAreaOpen(false)} />
      <OneOffJobModal open={oneOffOpen} onClose={() => setOneOffOpen(false)} />
      <HolidayModal
        open={holidayModalOpen}
        holidays={holidays}
        workDays={workDays}
        onClose={() => setHolidayModalOpen(false)}
        onAdd={async (data) => { await createHoliday(data); setHolidays((prev) => [...prev, { id: Date.now(), ...data, startDate: data.startDate, endDate: data.endDate, createdAt: new Date().toISOString() } as unknown as Holiday]); router.refresh(); }}
        onUpdate={async (id, data) => { await updateHoliday(id, data); setHolidays((prev) => prev.map((h) => h.id === id ? { ...h, label: data.label, startDate: data.startDate, endDate: data.endDate } : h)); router.refresh(); }}
        onDelete={async (id) => { await deleteHoliday(id); setHolidays((prev) => prev.filter((h) => h.id !== id)); router.refresh(); }}
        onReschedule={async (workDayId, newDateISO) => { await rescheduleWorkDay(workDayId, newDateISO, "one-off"); router.refresh(); }}
      />
      {/* MoveWorkDayModal removed (obsolete) */}
      <WorkDayNotesModal
        day={notesDay}
        text={notesDayText}
        setText={setNotesDayText}
        onClose={() => setNotesDay(null)}
      />
      <DayDetailModal
        workDay={expandedDay}
        onClose={() => setExpandedDay(null)}
      />
      <CompletedWorkDayModal
        workDay={completedExpandedDay}
        onClose={() => setCompletedExpandedDay(null)}
      />
    </div>
  );
}

// ── Holiday Modal ─────────────────────────────────────────────────────────────

type ConflictEntry = { id: number; date: Date | string; areaName: string; dow: number; resolved: boolean };

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getHolidayConflicts(
  startDate: string,
  endDate: string,
  workDays: Array<{ id: number; date: Date | string; status: string; area: { name: string } | null }>,
): ConflictEntry[] {
  return workDays
    .filter((wd) => {
      if (wd.status !== "PLANNED" && wd.status !== "IN_PROGRESS") return false;
      const iso = isoDate(toUTCMidnight(wd.date));
      return iso >= startDate && iso <= endDate;
    })
    .map((wd) => {
      const d = toUTCMidnight(wd.date);
      return { id: wd.id, date: wd.date, areaName: wd.area?.name ?? "Work Day", dow: d.getDay(), resolved: false };
    });
}

function nextWeekdayAfterDate(endDateStr: string, dayOfWeek: number): string {
  const d = toUTCMidnight(endDateStr);
  d.setDate(d.getDate() + 1); // day after holiday ends
  while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
  return isoDate(d);
}

function HolidayModal({
  open,
  holidays,
  workDays,
  onClose,
  onAdd,
  onUpdate,
  onDelete,
  onReschedule,
}: {
  open: boolean;
  holidays: Holiday[];
  workDays: Array<{ id: number; date: Date | string; status: string; area: { name: string } | null }>;
  onClose: () => void;
  onAdd: (data: { startDate: string; endDate: string; label: string }) => void;
  onUpdate: (id: number, data: { startDate: string; endDate: string; label: string }) => void;
  onDelete: (id: number) => void;
  onReschedule: (workDayId: number, newDateISO: string) => Promise<void>;
}) {
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ startDate: "", endDate: "", label: "" });
  const [isAdding, setIsAdding] = useState(false);
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [conflictEndDate, setConflictEndDate] = useState("");

  const sorted = [...holidays].sort((a, b) => 
    toUTCMidnight(a.startDate).getTime() - toUTCMidnight(b.startDate).getTime()
  );

  const handleAdd = () => {
    if (!form.startDate || !form.endDate || !form.label.trim()) return;
    onAdd(form);
    const detected = getHolidayConflicts(form.startDate, form.endDate, workDays).map((c) => ({ ...c, resolved: false }));
    if (detected.length > 0) {
      setConflicts(detected);
      setConflictEndDate(form.endDate);
    }
    setForm({ startDate: "", endDate: "", label: "" });
    setIsAdding(false);
  };

  const handleUpdate = () => {
    if (!editId || !form.startDate || !form.endDate || !form.label.trim()) return;
    onUpdate(editId, form);
    const detected = getHolidayConflicts(form.startDate, form.endDate, workDays).map((c) => ({ ...c, resolved: false }));
    if (detected.length > 0) {
      setConflicts(detected);
      setConflictEndDate(form.endDate);
    }
    setEditId(null);
    setForm({ startDate: "", endDate: "", label: "" });
  };

  return (
    <Modal open={open} onClose={onClose} title="Manage Holidays">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Block dates to prevent scheduling on holidays or breaks.</p>

        {/* List */}
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {sorted.map((h) => {
            const isEdit = editId === h.id;
            const start = toUTCMidnight(h.startDate);
            const end = toUTCMidnight(h.endDate);
            const fmtStart = start.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            const fmtEnd = end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
            return (
              <div key={h.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
                {isEdit ? (
                  <>
                    <input
                      type="text"
                      placeholder="Label (e.g. Christmas)"
                      value={form.label}
                      onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-500 mb-1 block">Start</label>
                        <input type="date" value={form.startDate}
                          onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 mb-1 block">End</label>
                        <input type="date" value={form.endDate}
                          onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleUpdate}>Save</Button>
                      <Button size="sm" variant="outline" onClick={() => { setEditId(null); setForm({ startDate: "", endDate: "", label: "" }); }}>Cancel</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Umbrella size={14} className="text-red-500 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{h.label}</p>
                          <p className="text-xs text-slate-500">{fmtStart} – {fmtEnd}</p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            setEditId(h.id);
                            setForm({
                              label: h.label,
                              startDate: toUTCMidnight(h.startDate).toISOString().split("T")[0],
                              endDate: toUTCMidnight(h.endDate).toISOString().split("T")[0],
                            });
                            setIsAdding(false);
                          }}
                          className="p-1 rounded hover:bg-slate-100"
                        >
                          <Pencil size={12} className="text-slate-400" />
                        </button>
                        <button onClick={() => onDelete(h.id)} className="p-1 rounded hover:bg-red-100">
                          <X size={12} className="text-red-500" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Add new */}
        {conflicts.filter((c) => !c.resolved).length > 0 && (
          <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="text-amber-600 flex-shrink-0" />
              <p className="text-sm font-semibold text-amber-800">
                {conflicts.filter((c) => !c.resolved).length} scheduled day{conflicts.filter((c) => !c.resolved).length !== 1 ? "s" : ""} fall within this holiday
              </p>
            </div>
            <div className="space-y-2">
              {conflicts.filter((c) => !c.resolved).map((c) => {
                const dateLabel = toUTCMidnight(c.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
                const dowName = DOW_NAMES[c.dow];
                return (
                  <div key={c.id} className="flex items-center justify-between gap-2 bg-white rounded-lg border border-amber-200 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{c.areaName}</p>
                      <p className="text-xs text-slate-500">{dateLabel}</p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        onClick={async () => {
                          const newDate = nextWeekdayAfterDate(conflictEndDate, c.dow);
                          await onReschedule(c.id, newDate);
                          setConflicts((prev) => prev.map((x) => x.id === c.id ? { ...x, resolved: true } : x));
                        }}
                        className="px-2.5 py-1 rounded-lg bg-green-600 hover:bg-green-700 text-white text-[11px] font-semibold whitespace-nowrap"
                      >
                        → Next {dowName}
                      </button>
                      <button
                        onClick={() => setConflicts((prev) => prev.map((x) => x.id === c.id ? { ...x, resolved: true } : x))}
                        className="px-2.5 py-1 rounded-lg border border-slate-300 text-[11px] font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap"
                      >
                        Ignore
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Add new */}
        {!isAdding && !editId && (
          <button
            onClick={() => setIsAdding(true)}
            className="w-full border-2 border-dashed border-slate-300 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
          >
            <Plus size={14} /> Add Holiday
          </button>
        )}

        {isAdding && (
          <div className="border border-blue-300 bg-blue-50 rounded-lg p-3 space-y-2">
            <p className="text-sm font-semibold text-blue-800">New Holiday</p>
            <input
              type="text"
              placeholder="Label (e.g. Christmas)"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-600 mb-1 block">Start Date</label>
                <input type="date" value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-600 mb-1 block">End Date</label>
                <input type="date" value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={!form.label.trim() || !form.startDate || !form.endDate}>
                Add
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setIsAdding(false); setForm({ startDate: "", endDate: "", label: "" }); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
