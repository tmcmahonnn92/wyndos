"use client";

import { useState, useTransition, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  ChevronLeft,
  Play,
  CheckSquare,
  Plus,
  AlertCircle,
  SkipForward,
  ArrowRight,
  Undo2,
  Banknote,
  Check,
  Square,
  MapPin,
  ArrowLeftRight,
  Search,
  CalendarDays,
  RotateCcw,
  CloudRain,
  MessageSquare,
  ChevronDown,
  Printer,
  StickyNote,
  Navigation2,
  Loader2,
  Pencil,
  X,
  Phone,
  MoreHorizontal,
  Users,
} from "lucide-react";
import {
  getWorkDay,
  getWorkDays,
  getAreas,
  getCustomers,
  completeJob,
  uncompleteJob,
  skipJob,
  recordPayment,
  moveCustomerToArea,
  addCustomerToDay,
  startDay,
  completeDay,
  reopenDay,
  updateWorkDayNotes,
  addJobToDay,
  addJobFromOtherArea,
  addOneOffJobToDay,
  createCustomerAndAddToDay,
  createOneOffCustomerAndAddToDay,
  reorderDayJobs,
  updateJobNotes,
  updateJobCompletedAt,
  updateJobPrice,
  moveOverdueJobsToDay,
  rescheduleWorkDay,
} from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { DayTeamBar, type TeamMember } from "./day-team-bar";
import { TextRemindersModal } from "./text-reminders-modal";
import { PhoneOutboxModal } from "@/components/phone-outbox-modal";
import { SharePdfButton } from "@/components/share-pdf-button";
import { hasPin, mapsHref, mapsPoint } from "@/lib/maps-link";
import { getDayCleanedTextStatus, getPhoneOutbox, textDayCleaned } from "@/lib/text-actions";
import { QuoteActions, quoteCardClass, quoteSummary } from "./quote-actions";
import { getQueue, isNetworkError, onQueueChange, runOrQueue } from "@/lib/offline-queue";
import { expectsPaymentAtDoor, normalisePreference, preferenceLabel } from "@/lib/payment-preference";
import { fmtDate, fmtShortDate, fmtCurrency, cn } from "@/lib/utils";
import { addressPartsOf, collectKnownTowns, compareByStreet, composeAddress, withTownFallback } from "@/lib/address";
import { MapsRouteModal, type RouteStop } from "@/components/maps-route-modal";

type Day = NonNullable<Awaited<ReturnType<typeof getWorkDay>>>;
type FutureDay = Awaited<ReturnType<typeof getWorkDays>>[0];
type Job = Day["jobs"][0];

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Default method in the pay form: the customer's usual one if it can be taken on the day, else cash. */
function preferredMethod(job: { customer: { preferredPaymentMethod?: string | null } }): "CASH" | "BACS" | "CARD" {
  const value = normalisePreference(job.customer.preferredPaymentMethod);
  return value === "BACS" || value === "CARD" ? value : "CASH";
}

function getJobTitle(job: { name?: string | null }) {
  return job.name?.trim() || "Window Cleaning";
}

function getPaidAfterCompletion(job: Job) {
  if (job.status !== "COMPLETE" || !job.completedAt) return 0;

  // Everything paid on this clean counts, including credit paid in advance.
  return Number(
    (job.allocations ?? [])
      .reduce((sum, allocation) => sum + allocation.amount, 0)
      .toFixed(2)
  );
}

interface Props {
  /** One area day (/days/[id]) or every area day on a date (/days/date/[date]). */
  days: Day[];
  dateISO: string;
  futureDays: FutureDay[];
  hidePrices?: boolean;
  team?: TeamMember[] | null;
  /** Owner / scheduler permission: may move a whole area day (rained off). */
  canReschedule?: boolean;
  /** On a single area day: how many other areas share the date (links to the whole day). */
  otherAreasOnDate?: number;
  /** May send texts (owner, or a worker with the Texts permission). */
  canText?: boolean;
  /** Split runs: other parts of each day's run that aren't done yet. */
  runSiblings?: Record<number, Array<{ id: number; date: string; status: string }>>;
}

type PendingResolution = {
  jobId: number;
  action: "skip" | "move";
  targetDayId?: number;
};

type ViewMode = "area" | "street";
const VIEW_MODE_KEY = "wyndos.dayViewMode";

function areaLabel(day: Day) {
  return day.area?.name ?? day.jobs[0]?.customer?.address?.split(",")[0] ?? "One-off";
}

export function DayView({
  days,
  dateISO,
  futureDays,
  hidePrices = false,
  team = null,
  canReschedule = false,
  otherAreasOnDate = 0,
  canText = false,
  runSiblings = {},
}: Props) {
  const todayDateValue = new Date().toISOString().slice(0, 10);
  const scheduledDateValue = dateISO;
  const multi = days.length > 1;
  const single = days.length === 1 ? days[0] : null;
  const dayIds = days.map((d) => d.id);
  const dayById = useMemo(() => new Map(days.map((d) => [d.id, d])), [days]);

  const [isPending, startTransition] = useTransition();
  const [completeScope, setCompleteScope] = useState<number[] | null>(null);
  const [addJobDayId, setAddJobDayId] = useState<number | null>(null);
  const [addJobPickerOpen, setAddJobPickerOpen] = useState(false);
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  const [textsOpen, setTextsOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  // Phone layout: less-used actions live in a "More" sheet, and the team / print tools fold away.
  const [moreOpen, setMoreOpen] = useState(false);
  const [toolsOpenFor, setToolsOpenFor] = useState<number | null>(null);
  const [nextRuns, setNextRuns] = useState<Array<{ nextDue: Date | string; nextWorkDayId: number | null; areaName: string }>>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [openJobInPayMode, setOpenJobInPayMode] = useState(false);
  const [notesJob, setNotesJob] = useState<Job | null>(null);
  const [routeOrder, setRouteOrder] = useState<number[] | null>(null);
  const [notesEditingDayId, setNotesEditingDayId] = useState<number | null>(null);
  const [dayNotesText, setDayNotesText] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [completionDate, setCompletionDate] = useState(todayDateValue);
  const [dragJobId, setDragJobId] = useState<number | null>(null);
  const [selectedPendingIds, setSelectedPendingIds] = useState<Set<number>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkDest, setBulkDest] = useState<"new" | "existing">("new");
  const [bulkNewDate, setBulkNewDate] = useState(todayDateValue);
  const [bulkExistingDayId, setBulkExistingDayId] = useState<string>("");
  const [rainOff, setRainOff] = useState<{ dayIds: number[]; date: string } | null>(null);
  const [workerFilter, setWorkerFilter] = useState<string>("all");
  const [openAreaId, setOpenAreaId] = useState<number | null>(null);
  const [viewMode, setViewModeState] = useState<ViewMode>("area");
  const router = useRouter();

  // Each device remembers the last view mode.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_MODE_KEY);
      if (saved === "area" || saved === "street") setViewModeState(saved);
    } catch {}
  }, []);
  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    setRouteOrder(null);
    try { window.localStorage.setItem(VIEW_MODE_KEY, mode); } catch {}
  };

  // Drag-to-reorder state for pending jobs (only within one area, only in area view).
  const dragJobIdRef = useRef<number | null>(null);
  const [dragOverJobId, setDragOverJobId] = useState<number | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [manualOrder, setManualOrder] = useState<Record<number, number[]>>({});

  // Taps saved on the phone while offline show immediately, before they reach the server.
  const [localStatus, setLocalStatus] = useState<Record<number, "COMPLETE" | "SKIPPED">>({});
  const dayIdKey = dayIds.join(",");
  // Texts waiting to go from the phone for these days (e.g. "cleaned, here's how to pay").
  const [outboxCount, setOutboxCount] = useState(0);
  const [outboxOpen, setOutboxOpen] = useState(false);
  useEffect(() => {
    if (!canText) return;
    let cancelled = false;
    getPhoneOutbox({ workDayIds: dayIdKey.split(",").map(Number) })
      .then((list) => !cancelled && setOutboxCount(list.length))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [canText, dayIdKey, nextRuns, outboxOpen]);
  // Finished days: "your windows were cleaned" to everyone (how to pay if they haven't).
  const completeDayIds = days.filter((d) => d.status === "COMPLETE").map((d) => d.id);
  const completeKey = completeDayIds.join(",");
  const [cleanedStatus, setCleanedStatus] = useState<{ textable: number; notSent: number } | null>(null);
  const [cleanedBusy, setCleanedBusy] = useState(false);
  const [cleanedError, setCleanedError] = useState<string | null>(null);
  useEffect(() => {
    if (!canText || !completeKey) { setCleanedStatus(null); return; }
    let cancelled = false;
    getDayCleanedTextStatus(completeKey.split(",").map(Number))
      .then((status) => !cancelled && setCleanedStatus(status))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [canText, completeKey, outboxOpen]);
  const textEveryoneCleaned = async () => {
    setCleanedBusy(true);
    setCleanedError(null);
    try {
      await textDayCleaned(completeKey.split(",").map(Number));
      setOutboxOpen(true);
    } catch (issue) {
      setCleanedError(issue instanceof Error ? issue.message : "Couldn't make the texts.");
    } finally {
      setCleanedBusy(false);
    }
  };
  // Opened from the dashboard to-do list.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("remind") === "1" && canText) setTextsOpen(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ids = new Set(dayIdKey.split(",").map(Number));
    const load = () => {
      const next: Record<number, "COMPLETE" | "SKIPPED"> = {};
      for (const entry of getQueue()) {
        if (!ids.has(entry.workDayId)) continue;
        next[entry.jobId] = entry.kind === "skip" ? "SKIPPED" : "COMPLETE";
      }
      setLocalStatus(next);
    };
    load();
    return onQueueChange(load);
  }, [dayIdKey]);

  const withLocal = (job: Job) => (localStatus[job.id] ? { ...job, status: localStatus[job.id] } : job) as Job;
  const allJobs = useMemo(() => days.flatMap((d) => d.jobs), [days]);
  const allJobsView = allJobs.map(withLocal);

  // Who does each job: its own worker, else the area day's worker, else the owner (me).
  const meId = team?.find((m) => m.isMe)?.id ?? null;
  const workerOf = (job: Job) => job.assignedUserId ?? dayById.get(job.workDayId)?.assignedUserId ?? meId;
  const workerOptions = useMemo(() => {
    const ids = new Set(allJobs.map((job) => job.assignedUserId ?? dayById.get(job.workDayId)?.assignedUserId ?? meId));
    return [...ids];
  }, [allJobs, dayById, meId]);
  const memberName = (userId: string) => {
    const member = team?.find((m) => m.id === userId);
    if (member) return member.isMe ? `${member.name} (you)` : member.name;
    const fromJob = allJobs.find((j) => j.assignedUser?.id === userId)?.assignedUser
      ?? days.find((d) => d.assignedUser?.id === userId)?.assignedUser;
    return fromJob?.name ?? fromJob?.email ?? "Worker";
  };
  const passesFilter = (job: Job) => {
    if (workerFilter === "all") return true;
    const worker = workerOf(job);
    return worker === workerFilter;
  };
  const filtering = workerFilter !== "all";
  // Print / share follows the person filter ("me" = the owner's own jobs, including unassigned).
  const printWorkerParam = !filtering ? null : workerFilter === meId ? "me" : workerFilter;

  const knownTowns = useMemo(() => collectKnownTowns(allJobs.map((j) => j.customer.address)), [allJobs]);
  const streetKey = useMemo(() => {
    const map = new Map<number, ReturnType<typeof addressPartsOf>>();
    for (const job of allJobs) {
      const area = dayById.get(job.workDayId)?.area;
      const fallback = area && !area.isSystemArea ? area.name : job.customer.area?.name;
      map.set(job.id, withTownFallback(addressPartsOf(job.customer, knownTowns), fallback));
    }
    return map;
  }, [allJobs, knownTowns, dayById]);

  /** Jobs of one area day in its saved route order (or the order just dragged). */
  const orderedJobsOf = (day: Day) => {
    const jobs = day.jobs.map(withLocal);
    const order = manualOrder[day.id];
    if (!order) return jobs;
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...jobs].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  };

  // Visible list: optimiser order, else by area (route order), else all by street.
  const sortedJobs: Job[] = (() => {
    const visible = allJobsView.filter(passesFilter);
    if (routeOrder) {
      const byId = new Map(visible.map((j) => [j.id, j]));
      return routeOrder.map((id) => byId.get(id)).filter(Boolean) as Job[];
    }
    if (viewMode === "street") {
      return [...visible].sort((a, b) => compareByStreet(streetKey.get(a.id)!, streetKey.get(b.id)!));
    }
    return days.flatMap((d) => orderedJobsOf(d).filter(passesFilter));
  })();

  const pendingJobs = sortedJobs.filter((j) => j.status === "PENDING");
  // Houses still to do, in list order, for the Google Maps route.
  const routeStops: RouteStop[] = pendingJobs.map((job) => {
    const parts = streetKey.get(job.id) ?? addressPartsOf(job.customer);
    return {
      address: hasPin(job.customer) ? mapsPoint(job.customer) : composeAddress(parts) || job.customer.address,
      street: parts.street.trim(),
      town: parts.town.trim(),
      postcode: parts.postcode.trim(),
      label: job.customer.name,
    };
  });
  const doneJobs = sortedJobs.filter((j) => j.status === "COMPLETE");
  const otherJobs = sortedJobs.filter((j) => j.status !== "PENDING" && j.status !== "COMPLETE");

  const totalValue = sortedJobs.reduce((s, j) => s + j.price, 0);
  const doneValue = doneJobs.reduce((s, j) => s + j.price, 0);
  const allComplete = days.length > 0 && days.every((d) => d.status === "COMPLETE");
  const openDays = days.filter((d) => d.status !== "COMPLETE");
  const plannedDays = days.filter((d) => d.status === "PLANNED");
  const shouldPromptForCompletedDate = scheduledDateValue !== todayDateValue;
  const canReorder = viewMode === "area" && !routeOrder && !filtering;
  const areaOf = (job: Job) => {
    const area = dayById.get(job.workDayId)?.area;
    return area ? { name: area.name, color: area.color } : null;
  };
  // Pending cards are already under an area heading in area view; tag them only when mixed.
  const tagFor = (job: Job) => (!multi || (viewMode === "area" && !routeOrder) ? null : areaOf(job));

  /** Run a change without ever crashing the page; queue it if there's no signal. */
  const safely = (fn: () => Promise<void>) => {
    startTransition(async () => {
      try {
        setActionError(null);
        await fn();
      } catch (issue) {
        setActionError(isNetworkError(issue)
          ? "No signal for that one. Ticking jobs off and payments still save on the phone; try this again when you're back online."
          : issue instanceof Error ? issue.message : "Could not save that change.");
      }
    });
  };
  const refreshIfOnline = () => {
    if (typeof navigator === "undefined" || navigator.onLine) router.refresh();
  };
  const doComplete = async (job: Job) => {
    const result = await runOrQueue({ kind: "complete", jobId: job.id, workDayId: job.workDayId }, () => completeJob(job.id));
    if (result === "queued") setLocalStatus((prev) => ({ ...prev, [job.id]: "COMPLETE" }));
  };
  const doSkip = async (job: Job) => {
    const result = await runOrQueue({ kind: "skip", jobId: job.id, workDayId: job.workDayId }, () => skipJob(job.id));
    if (result === "queued") setLocalStatus((prev) => ({ ...prev, [job.id]: "SKIPPED" }));
  };
  /** Note / price changes made at the door: saved on the phone if there's no signal. */
  const doNote = (job: Job, notes: string) =>
    runOrQueue({ kind: "note", jobId: job.id, workDayId: job.workDayId, notes }, () => updateJobNotes(job.id, notes));
  const doPrice = (job: Job, price: number) =>
    runOrQueue({ kind: "price", jobId: job.id, workDayId: job.workDayId, price }, () => updateJobPrice(job.id, price));
  const doPay = async (
    job: Job,
    allocations: Array<{ jobId: number; amount: number }>,
    method: "CASH" | "BACS" | "CARD",
    notes?: string,
  ) => {
    await runOrQueue(
      { kind: "pay", jobId: job.id, workDayId: job.workDayId, customerId: job.customerId, allocations, method },
      (clientRequestId) => recordPayment({ customerId: job.customerId, allocations, method, notes, clientRequestId }),
    );
  };

  /** Save a new order for one area day (reordering never crosses areas). */
  const saveDayOrder = (dayId: number, ids: number[]) => {
    setManualOrder((prev) => ({ ...prev, [dayId]: ids }));
    safely(async () => { await reorderDayJobs(dayId, ids); });
  };
  const moveJob = (jobId: number, direction: -1 | 1) => {
    const job = allJobs.find((j) => j.id === jobId);
    const day = job ? dayById.get(job.workDayId) : undefined;
    if (!day) return;
    const list = orderedJobsOf(day);
    const ids = list.map((j) => j.id);
    const from = ids.indexOf(jobId);
    let to = from + direction;
    while (to >= 0 && to < ids.length && list[to].status !== "PENDING") to += direction;
    if (from === -1 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, jobId);
    saveDayOrder(day.id, next);
  };
  const handleJobDrop = (targetJobId: number) => {
    const dragId = dragJobIdRef.current;
    dragJobIdRef.current = null;
    setDragJobId(null);
    setDragOverJobId(null);
    if (!dragId || dragId === targetJobId) return;
    const dragged = allJobs.find((j) => j.id === dragId);
    const target = allJobs.find((j) => j.id === targetJobId);
    if (!dragged || !target || dragged.workDayId !== target.workDayId) return; // only within one area
    const day = dayById.get(dragged.workDayId)!;
    const ids = orderedJobsOf(day).map((j) => j.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetJobId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    saveDayOrder(day.id, ids);
  };

  const startNotes = (day: Day) => {
    setNotesEditingDayId(day.id);
    setDayNotesText(day.notes ?? "");
  };
  const handleSaveDayNotes = () => {
    if (notesEditingDayId === null) return;
    const id = notesEditingDayId;
    safely(async () => {
      await updateWorkDayNotes(id, dayNotesText);
      setNotesEditingDayId(null);
      router.refresh();
    });
  };

  const handleStart = (targets: Day[]) => {
    safely(async () => {
      for (const day of targets) await startDay(day.id);
      router.refresh();
    });
  };

  const handleReopen = (day: Day) => {
    safely(async () => {
      await reopenDay(day.id);
      setNextRuns([]);
      router.refresh();
    });
  };

  /** Pending jobs of the areas being completed (all workers, not just the filtered view). */
  const scopePending = (scope: number[]) =>
    allJobsView.filter((j) => j.status === "PENDING" && scope.includes(j.workDayId));

  const handleComplete = (targets: Day[]) => {
    const scope = targets.map((d) => d.id);
    const pending = scopePending(scope);
    if (pending.length > 0 || shouldPromptForCompletedDate) {
      // Default: unfinished jobs carry over to tomorrow. Skipping is a deliberate choice.
      setSelectedPendingIds(new Set(pending.map((job) => job.id)));
      setBulkMoveOpen(true);
      setBulkDest("new");
      setBulkNewDate(tomorrowISO());
      setBulkExistingDayId("");
      setCompletionDate(todayDateValue);
      setCompleteScope(scope);
    } else {
      safely(async () => {
        const results = [];
        for (const day of targets) {
          const result = await completeDay(day.id, [], todayDateValue);
          if (result) results.push(result);
        }
        setNextRuns(results);
        router.refresh();
      });
    }
  };

  const togglePendingSelected = (jobId: number) => {
    setSelectedPendingIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const completePending = completeScope ? scopePending(completeScope) : [];

  const handleConfirmCompleteDay = () => {
    if (!completeScope) return;
    const scope = completeScope;
    const pending = scopePending(scope);
    safely(async () => {
      // Ticked jobs carry over (grouped per area, so each gets its own "Overdue – area" day);
      // unticked jobs are skipped this time.
      for (const dayId of scope) {
        const day = dayById.get(dayId)!;
        const carryIds = pending.filter((j) => j.workDayId === dayId && selectedPendingIds.has(j.id)).map((j) => j.id);
        if (carryIds.length === 0) continue;
        if (bulkDest === "existing") {
          if (!bulkExistingDayId) throw new Error("Choose which day to carry the jobs over to.");
          await moveOverdueJobsToDay(carryIds, { kind: "existing", workDayId: Number(bulkExistingDayId) });
        } else {
          if (!bulkNewDate) throw new Error("Choose a date to carry the jobs over to.");
          await moveOverdueJobsToDay(carryIds, { kind: "new", dateISO: bulkNewDate, sourceAreaName: day.area?.name ?? "Overdue jobs" });
        }
      }
      const results = [];
      for (const dayId of scope) {
        const skips: PendingResolution[] = pending
          .filter((j) => j.workDayId === dayId && !selectedPendingIds.has(j.id))
          .map((j) => ({ jobId: j.id, action: "skip" }));
        const result = await completeDay(dayId, skips, completionDate);
        if (result) results.push(result);
      }
      setNextRuns(results);
      setCompleteScope(null);
      setSelectedPendingIds(new Set());
      router.refresh();
    });
  };

  const handleConfirmRainOff = () => {
    if (!rainOff) return;
    const { dayIds: ids, date } = rainOff;
    safely(async () => {
      if (!date) throw new Error("Choose the new date.");
      for (const id of ids) await rescheduleWorkDay(id, date, "one-off");
      setRainOff(null);
      // The areas have left this date: go to where they went.
      if (ids.length === days.length) router.push(`/days/date/${date}`);
      else router.refresh();
    });
  };

  const openAddJob = () => {
    if (openDays.length === 1 || days.length === 1) setAddJobDayId((openDays[0] ?? days[0]).id);
    else setAddJobPickerOpen(true);
  };

  const renderPendingCard = (job: Job) => (
    <div
      key={job.id}
      draggable={canReorder}
      onDragStart={() => { if (!canReorder) return; dragJobIdRef.current = job.id; setDragJobId(job.id); }}
      onDragEnd={() => { dragJobIdRef.current = null; setDragJobId(null); setDragOverJobId(null); }}
      onDragOver={(e) => { if (!canReorder) return; e.preventDefault(); setDragOverJobId(job.id); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverJobId(null); }}
      onDrop={(e) => { e.preventDefault(); handleJobDrop(job.id); }}
      className={cn(
        "rounded-xl transition-all",
        dragOverJobId === job.id && dragJobId !== job.id && "ring-2 ring-blue-400 ring-offset-1"
      )}
    >
      {reorderMode && canReorder && (
        <div className="mb-1 flex gap-1">
          <button type="button" aria-label={`Move ${job.customer.name} up`} onClick={() => moveJob(job.id, -1)}
            className="flex-1 rounded-lg border border-slate-200 bg-white py-1.5 text-sm font-bold text-slate-600">↑</button>
          <button type="button" aria-label={`Move ${job.customer.name} down`} onClick={() => moveJob(job.id, 1)}
            className="flex-1 rounded-lg border border-slate-200 bg-white py-1.5 text-sm font-bold text-slate-600">↓</button>
        </div>
      )}
      <JobCard
        job={job}
        areaTag={tagFor(job)}
        showWorker={team !== null}
        onToggle={() => setSelectedJob(job)}
        isPending={isPending}
        onNotesClick={() => setNotesJob(job)}
        hidePrices={hidePrices}
        quickPayMethod={preferredMethod(job)}
        onQuickComplete={() =>
          safely(async () => {
            await doComplete(job);
            refreshIfOnline();
          })
        }
        onQuickPay={(includeDebt: boolean, method: "CASH" | "BACS" | "CARD") =>
          safely(async () => {
            await doComplete(job);
            const allocations: Array<{ jobId: number; amount: number }> = [{ jobId: job.id, amount: job.price }];
            if (includeDebt) {
              const prevJobs = (job.customer.jobs ?? []).filter((j) => j.id !== job.id);
              for (const pj of prevJobs) {
                const paid = (pj.allocations ?? []).reduce((s: number, a: { amount: number }) => s + a.amount, 0);
                const due = Number(Math.max(0, pj.price - paid).toFixed(2));
                if (due > 0.005) allocations.push({ jobId: pj.id, amount: due });
              }
            }
            await doPay(job, allocations, method);
            refreshIfOnline();
          })
        }
        onOpenInPayMode={() => {
          setOpenJobInPayMode(true);
          setSelectedJob(job);
        }}
      />
    </div>
  );

  const headerTitle = multi
    ? `${days.length} areas`
    : single ? areaLabel(single) : "Nothing booked";
  const statusBadge = allComplete
    ? { variant: "success" as const, label: "Done" }
    : days.some((d) => d.status === "IN_PROGRESS")
    ? { variant: "info" as const, label: "Active" }
    : { variant: "muted" as const, label: days.length ? "Planned" : "Free" };

  return (
    <div className="max-w-lg mx-auto">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-white border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link href="/days" className="p-1 rounded-lg hover:bg-slate-100 text-slate-500">
            <ChevronLeft size={20} />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-slate-800 truncate">{fmtDate(`${dateISO}T12:00:00Z`)}</h1>
            <p className="text-xs text-slate-500 truncate">
              {headerTitle}{!hidePrices && ` - ${fmtCurrency(totalValue)}`}
            </p>
          </div>
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-slate-100">
          <div
            className="h-full bg-green-500 transition-all duration-500"
            style={{ width: `${sortedJobs.length > 0 ? (doneJobs.length / sortedJobs.length) * 100 : 0}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm">
          <span className="text-slate-600">
            <b className="text-green-700 tabular-nums">{doneJobs.length}</b> of <b className="text-slate-800 tabular-nums">{sortedJobs.length}</b> done
            {pendingJobs.length > 0 && <span className="text-slate-400"> · {pendingJobs.length} to go</span>}
          </span>
          {!hidePrices && (
            <span className="text-slate-600 tabular-nums">
              <b className="text-blue-700">{fmtCurrency(doneValue)}</b> earned
            </span>
          )}
        </div>

        {/* View switch: by area (route order) or everything in one list by street */}
        {days.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100">
            <div className="flex flex-1 rounded-lg border border-slate-200 p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setViewMode("area")}
                className={cn("flex-1 rounded-md px-2 py-1.5", viewMode === "area" && !routeOrder ? "bg-slate-800 text-white" : "text-slate-600")}
              >
                {multi ? "By area" : "Route order"}
              </button>
              <button
                type="button"
                onClick={() => setViewMode("street")}
                className={cn("flex-1 rounded-md px-2 py-1.5", viewMode === "street" && !routeOrder ? "bg-slate-800 text-white" : "text-slate-600")}
              >
                {multi ? "All jobs by street" : "By street"}
              </button>
            </div>
            {team && workerOptions.length > 1 && (
              <select
                value={workerFilter}
                onChange={(e) => setWorkerFilter(e.target.value)}
                aria-label="Show jobs for"
                className="max-w-[40%] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700"
              >
                <option value="all">Everyone</option>
                {workerOptions.filter((id): id is string => id !== null).map((id) => (
                  <option key={id} value={id}>{memberName(id)}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      <div className="px-4 py-4 space-y-4">
        {actionError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{actionError}</div>}

        {/* This area / whole day switch (only when the date has more than one area) */}
        {((single && otherAreasOnDate > 0) || multi) && (
          <div role="radiogroup" aria-label="Show" className="flex rounded-xl border border-slate-200 bg-white p-0.5 text-xs font-semibold">
            {single ? (
              <span role="radio" aria-checked="true" className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-center text-white">
                {areaLabel(single)} only
              </span>
            ) : (
              <button
                type="button"
                role="radio"
                aria-checked="false"
                onClick={() => (days.length === 1 ? router.push(`/days/${days[0].id}`) : setAreaPickerOpen(true))}
                className="flex-1 rounded-lg px-3 py-2 text-center text-slate-600 hover:bg-slate-50"
              >
                One area
              </button>
            )}
            {single ? (
              <Link
                href={`/days/date/${dateISO}`}
                role="radio"
                aria-checked="false"
                className="flex-1 rounded-lg px-3 py-2 text-center text-slate-600 hover:bg-slate-50"
              >
                Whole day ({otherAreasOnDate + 1} areas)
              </Link>
            ) : (
              <span role="radio" aria-checked="true" className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-center text-white">
                Whole day ({days.length} areas)
              </span>
            )}
          </div>
        )}

        {nextRuns.length > 0 && (
          <div className="space-y-1.5">
            {nextRuns.map((run) => (
              <div key={run.areaName} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-green-50 border border-green-200">
                <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-green-800">{run.areaName} complete</p>
                  <p className="text-xs text-green-700">
                    Next run:{" "}
                    <strong>{new Date(run.nextDue).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</strong>
                  </p>
                </div>
                {run.nextWorkDayId && (
                  <Link href={`/days/${run.nextWorkDayId}`} className="flex-shrink-0 text-xs font-semibold text-green-700 hover:underline">
                    View →
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Whole-date actions */}
        {days.length > 0 && (
          <div className="flex gap-2">
            {plannedDays.length > 0 && (
              <Button onClick={() => handleStart(plannedDays)} disabled={isPending} className="flex-1" size="lg">
                <Play size={16} />
                {multi ? "Start day" : "Start Area"}
              </Button>
            )}
            {plannedDays.length === 0 && openDays.length > 0 && (
              <Button onClick={() => handleComplete(openDays)} disabled={isPending} className="flex-1" size="lg" variant="secondary">
                <CheckSquare size={16} />
                Complete Day
              </Button>
            )}
            {allComplete && single && (
              <Button variant="outline" onClick={() => handleReopen(single)} disabled={isPending} className="flex-1" size="lg">
                <RotateCcw size={16} />
                Reopen Day
              </Button>
            )}
            {pendingJobs.length > 0 && (
              <button
                type="button"
                onClick={() => setRouteOpen(true)}
                aria-label="Route in Google Maps"
                title="Route in Google Maps"
                className="flex flex-shrink-0 items-center rounded-xl border border-slate-200 bg-white px-3 text-slate-700 hover:bg-slate-50"
              >
                <Navigation2 size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-label="More actions"
              className="flex flex-shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <MoreHorizontal size={16} /> More
            </button>
          </div>
        )}

        {days.filter((d) => (runSiblings[d.id] ?? []).length > 0 && d.status !== "COMPLETE").map((d) => {
          const open = runSiblings[d.id].filter((o) => o.status !== "COMPLETE");
          const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
          return (
            <div key={`split-${d.id}`} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <p className="font-semibold">{areaLabel(d)} is split over more than one day</p>
              {open.length > 0 ? (
                <p className="mt-0.5">
                  Also still to do:{" "}
                  {open.map((other, i) => (
                    <span key={other.id}>
                      {i > 0 && ", "}
                      <Link href={`/days/${other.id}`} className="font-semibold underline">{fmt(other.date)}</Link>
                    </span>
                  ))}
                  . The next visit is booked once every part is done.
                </p>
              ) : (
                <p className="mt-0.5">The other part is done. Completing this one books the area&apos;s next visit.</p>
              )}
            </div>
          );
        })}

        {canText && cleanedStatus && cleanedStatus.textable > 0 && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-blue-900">
                  {cleanedStatus.notSent > 0
                    ? `Tell ${cleanedStatus.notSent} customer${cleanedStatus.notSent === 1 ? "" : "s"} their windows are clean`
                    : "Everyone has been told their windows are clean"}
                </p>
                <p className="text-[11px] text-blue-800">
                  Says the price, and how to pay if they haven&apos;t. Paid or in credit: says nothing to pay.
                </p>
              </div>
              {cleanedStatus.notSent > 0 && (
                <Button size="sm" onClick={textEveryoneCleaned} disabled={cleanedBusy}>
                  {cleanedBusy ? "Making…" : "Text everyone"}
                </Button>
              )}
            </div>
            {cleanedError && <p className="mt-1 text-xs text-red-600">{cleanedError}</p>}
          </div>
        )}

        {canText && outboxCount > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5">
            <span className="text-xs font-semibold text-green-800">
              {outboxCount} text{outboxCount === 1 ? "" : "s"} ready to send from your phone
            </span>
            <Button size="sm" onClick={() => setOutboxOpen(true)}>Send</Button>
          </div>
        )}


        {/* One card per area on this date: its worker, notes, and area-only actions */}
        <div className={multi ? "space-y-1.5" : "space-y-4"}>
        {days.map((day) => {
          const jobs = day.jobs.map(withLocal);
          const done = jobs.filter((j) => j.status === "COMPLETE").length;
          const value = jobs.reduce((s, j) => s + j.price, 0);
          const open = openAreaId === day.id;
          return (
            <div key={day.id} className={cn("space-y-2", multi && "rounded-xl border border-slate-200 bg-white px-3 py-2.5")}>
              {multi && (
                <button
                  type="button"
                  onClick={() => setOpenAreaId(open ? null : day.id)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: day.area?.color ?? "#94a3b8" }} />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{areaLabel(day)}</span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {done}/{jobs.length}{!hidePrices && ` · ${fmtCurrency(value)}`}
                  </span>
                  <Badge variant={day.status === "COMPLETE" ? "success" : day.status === "IN_PROGRESS" ? "info" : "muted"}>
                    {day.status === "COMPLETE" ? "Done" : day.status === "IN_PROGRESS" ? "Active" : "Planned"}
                  </Badge>
                  <ChevronDown size={15} className={cn("flex-shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
                </button>
              )}
              {day.notes && multi && !open && (
                <p className="flex items-start gap-1.5 text-xs text-amber-800"><StickyNote size={12} className="mt-0.5 flex-shrink-0 text-amber-600" />{day.notes}</p>
              )}
              {(!multi || open) && (<>
              {multi && (
                <div className="flex flex-wrap gap-1.5">
                  {day.status === "IN_PROGRESS" && (
                    <button type="button" onClick={() => handleComplete([day])} disabled={isPending}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      Complete area
                    </button>
                  )}
                  {day.status === "COMPLETE" && (
                    <button type="button" onClick={() => handleReopen(day)} disabled={isPending}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      Reopen area
                    </button>
                  )}
                  <Link href={`/days/${day.id}`}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    Open area only
                  </Link>
                </div>
              )}

              {!multi && (
                <button
                  type="button"
                  onClick={() => setToolsOpenFor(toolsOpenFor === day.id ? null : day.id)}
                  aria-expanded={toolsOpenFor === day.id}
                  className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm"
                >
                  <Users size={15} className="flex-shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                    {day.assignedUserId ? memberName(day.assignedUserId) : "You"} · worker, print, move jobs
                  </span>
                  <ChevronDown size={15} className={cn("flex-shrink-0 text-slate-400 transition-transform", toolsOpenFor === day.id && "rotate-180")} />
                </button>
              )}
              {(multi || toolsOpenFor === day.id) && <DayTeamBar
                key={`${day.id}-${printWorkerParam ?? "all"}`}
                dayId={day.id}
                dayStatus={day.status}
                dayAssignedUserId={day.assignedUserId ?? null}
                jobs={day.jobs}
                team={team}
                printHref={multi ? null : `/days/${day.id}/print?sort=${viewMode}`}
                pdfHref={`/api/run-sheet?day=${day.id}&sort=${viewMode}`}
                defaultPrintWorker={printWorkerParam}
              />}

              {notesEditingDayId === day.id ? (
                <div className="flex items-end gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                  <textarea
                    value={dayNotesText}
                    onChange={(e) => setDayNotesText(e.target.value)}
                    autoFocus
                    rows={2}
                    className="flex-1 text-xs border border-amber-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-white"
                  />
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button onClick={handleSaveDayNotes} disabled={isPending}
                      className="px-2 py-1 text-[11px] font-bold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50">Save</button>
                    <button onClick={() => setNotesEditingDayId(null)} className="px-2 py-1 text-[11px] text-slate-500 hover:text-slate-700">Cancel</button>
                  </div>
                </div>
              ) : day.notes ? (
                <button type="button" onClick={() => startNotes(day)}
                  className="flex w-full items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left">
                  <StickyNote size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <span className="flex-1 text-xs text-amber-800 whitespace-pre-wrap">{day.notes}</span>
                  <Pencil size={12} className="text-amber-600" />
                </button>
              ) : (
                <button type="button" onClick={() => startNotes(day)}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-600 transition-colors group">
                  <StickyNote size={13} className="group-hover:text-amber-500" />
                  Add {multi ? "area" : "day"} notes...
                </button>
              )}
              </>)}
            </div>
          );
        })}
        </div>

        {routeOrder && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700">
            <Navigation2 size={12} />
            <span className="font-semibold">Optimised route active</span>
            <button onClick={() => setRouteOrder(null)} className="ml-auto hover:text-blue-900">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Pending jobs */}
        {pendingJobs.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Pending ({pendingJobs.length})
              </h2>
              {pendingJobs.length > 1 && canReorder && (
                <button
                  type="button"
                  onClick={() => setReorderMode((on) => !on)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-xs font-semibold",
                    reorderMode ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600"
                  )}
                >
                  {reorderMode ? "Done reordering" : "Reorder"}
                </button>
              )}
            </div>
            {multi && viewMode === "area" && !routeOrder ? (
              <div className="space-y-4">
                {days.map((day) => {
                  const list = pendingJobs.filter((j) => j.workDayId === day.id);
                  if (list.length === 0) return null;
                  return (
                    <div key={day.id}>
                      <div className="mb-1.5 flex items-center gap-2 px-1">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: day.area?.color ?? "#94a3b8" }} />
                        <span className="text-xs font-bold text-slate-700">{areaLabel(day)}</span>
                        <span className="text-xs text-slate-400">{list.length}</span>
                      </div>
                      <div className="space-y-2">{list.map(renderPendingCard)}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">{pendingJobs.map(renderPendingCard)}</div>
            )}
          </section>
        )}

        {/* Completed jobs */}
        {doneJobs.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-2 px-1">
              Completed ({doneJobs.length})
            </h2>
            <div className="space-y-2">
              {doneJobs.map((job) => (
                <JobCard key={job.id} job={job} areaTag={multi ? areaOf(job) : null}
                  showWorker={team !== null} onToggle={() => setSelectedJob(job)} isPending={isPending}
                  onNotesClick={() => setNotesJob(job)} hidePrices={hidePrices} />
              ))}
            </div>
          </section>
        )}

        {/* Other jobs (skipped/moved/outstanding) */}
        {otherJobs.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 px-1">
              Other ({otherJobs.length})
            </h2>
            <div className="space-y-2">
              {otherJobs.map((job) => (
                <JobCard key={job.id} job={job} areaTag={multi ? areaOf(job) : null} showWorker={team !== null} onToggle={() => setSelectedJob(job)} isPending={isPending}
                  onNotesClick={() => setNotesJob(job)} hidePrices={hidePrices} />
              ))}
            </div>
          </section>
        )}

        {sortedJobs.length === 0 && (
          <Card className="border-dashed border-slate-300">
            <CardContent className="py-8 text-center text-slate-500">
              {days.length === 0 ? (
                <p className="text-sm">Nothing booked on this date.</p>
              ) : filtering ? (
                <p className="text-sm">No jobs for this person on this date.</p>
              ) : (
                <>
                  <p className="text-sm">No jobs on this day yet.</p>
                  <button onClick={openAddJob} className="text-blue-600 text-sm hover:underline mt-1">
                    Add your first job →
                  </button>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <CustomerNotesModal job={notesJob} onClose={() => setNotesJob(null)} hidePrices={hidePrices} />


      {/* ── More: the less-used day actions ───────────── */}
      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="space-y-1.5">
          {!allComplete && (
            <button type="button" onClick={() => { setMoreOpen(false); openAddJob(); }}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Plus size={16} className="text-blue-600" /> Add a job
            </button>
          )}
          {canText && openDays.length > 0 && (
            <button type="button" onClick={() => { setMoreOpen(false); setTextsOpen(true); }}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <MessageSquare size={16} className="text-blue-600" /> Text reminders to {multi ? "this day's" : "this area's"} customers
            </button>
          )}
          {multi && (
            <>
              <Link href={`/days/date/${dateISO}/print?sort=${viewMode}${printWorkerParam ? `&worker=${printWorkerParam}` : ""}`}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <Printer size={16} className="text-blue-600" /> Print the day
              </Link>
              <SharePdfButton
                href={`/api/run-sheet?date=${dateISO}&sort=${viewMode}${printWorkerParam ? `&worker=${printWorkerParam}` : ""}`}
                fileName={`run-sheet-${dateISO}.pdf`}
                title="Run sheet"
                label="Share run sheet (PDF)"
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              />
            </>
          )}
          {!multi && single && (
            <button type="button" onClick={() => { setMoreOpen(false); setToolsOpenFor(single.id); }}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Users size={16} className="text-blue-600" /> Worker, print, share, move jobs, rained off
            </button>
          )}
          {multi && canReschedule && openDays.length > 0 && (
            <button type="button" onClick={() => { setMoreOpen(false); setRainOff({ dayIds: openDays.map((d) => d.id), date: tomorrowISO() }); }}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <CloudRain size={16} className="text-blue-600" /> Rained off? Move the whole day
            </button>
          )}
        </div>
      </Modal>

      {/* ── Rained off: move area day(s) to another date ───────────── */}
      <Modal open={rainOff !== null} onClose={() => setRainOff(null)} title="Move to another date">
        {rainOff && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Moves {rainOff.dayIds.length === 1
                ? <strong>{areaLabel(dayById.get(rainOff.dayIds[0])!)}</strong>
                : <strong>{rainOff.dayIds.length} areas</strong>} and all their jobs. Each customer&apos;s next visit
              is worked out from when the area is actually done, so nothing else needs changing.
            </p>
            <input
              type="date"
              value={rainOff.date}
              onChange={(e) => setRainOff({ ...rainOff, date: e.target.value })}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <div className="flex gap-2">
              <Button onClick={handleConfirmRainOff} disabled={isPending || !rainOff.date} className="flex-1">
                {isPending ? "Moving..." : "Move"}
              </Button>
              <Button variant="outline" onClick={() => setRainOff(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>

      {canText && (
        <PhoneOutboxModal
          open={outboxOpen}
          onClose={() => setOutboxOpen(false)}
          filter={{ workDayIds: dayIds }}
        />
      )}
      <MapsRouteModal open={routeOpen} onClose={() => setRouteOpen(false)} stops={routeStops} />
      {canText && (
        <TextRemindersModal
          open={textsOpen}
          onClose={() => setTextsOpen(false)}
          workDayIds={openDays.map((d) => d.id)}
          canSaveDefault={team !== null}
        />
      )}

      {/* ── One area: which? ─────────────────────────────── */}
      <Modal open={areaPickerOpen} onClose={() => setAreaPickerOpen(false)} title="Show which area?">
        <div className="space-y-2">
          {days.map((day) => (
            <Link
              key={day.id}
              href={`/days/${day.id}`}
              className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: day.area?.color ?? "#94a3b8" }} />
              {areaLabel(day)}
            </Link>
          ))}
        </div>
      </Modal>

      {/* ── Add job: which area? ─────────────────────────────── */}
      <Modal open={addJobPickerOpen} onClose={() => setAddJobPickerOpen(false)} title="Add a job to which area?">
        <div className="space-y-2">
          {(openDays.length ? openDays : days).map((day) => (
            <button
              key={day.id}
              type="button"
              onClick={() => { setAddJobPickerOpen(false); setAddJobDayId(day.id); }}
              className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: day.area?.color ?? "#94a3b8" }} />
              {areaLabel(day)}
            </button>
          ))}
        </div>
      </Modal>

      {/* ── Complete Day Modal ──────────────────────────────── */}
      <Modal
        open={completeScope !== null}
        onClose={() => setCompleteScope(null)}
        title={completeScope && completeScope.length === 1 && multi ? `Complete ${areaLabel(dayById.get(completeScope[0])!)}` : "Complete Day"}
      >
        <div className="space-y-4">
          {shouldPromptForCompletedDate && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 space-y-2">
              <div className="flex items-start gap-2 text-blue-900">
                <CalendarDays size={16} className="mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold">When was this run actually completed?</p>
                  <p className="text-xs text-blue-800/80">
                    It was scheduled for {fmtDate(`${dateISO}T12:00:00Z`)}. The next run will be calculated from the date you choose here.
                  </p>
                </div>
              </div>
              <input
                type="date"
                value={completionDate}
                onChange={(e) => setCompletionDate(e.target.value)}
                className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
          )}

          {completePending.length > 0 && (
            <>
              <p className="text-sm text-slate-600">
                {completePending.length} job{completePending.length !== 1 ? "s" : ""} still unfinished. Ticked jobs carry over to the day below. Untick any you want to skip this time (they wait for their next normal visit).
              </p>

              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-500">{selectedPendingIds.size} selected</p>
                <div className="flex items-center gap-3 text-xs">
                  <button type="button" onClick={() => setSelectedPendingIds(new Set(completePending.map((j) => j.id)))} className="text-blue-600 hover:underline">
                    Select all
                  </button>
                  <button type="button" onClick={() => setSelectedPendingIds(new Set())} className="text-slate-400 hover:underline">
                    Clear
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {completePending.map((job) => {
                  const checked = selectedPendingIds.has(job.id);
                  const area = multi ? dayById.get(job.workDayId)?.area?.name : null;
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => togglePendingSelected(job.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors",
                        checked ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-slate-300 bg-white"
                      )}
                    >
                      {checked ? <CheckSquare size={16} className="text-blue-600 flex-shrink-0" /> : <Square size={16} className="text-slate-400 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{job.customer.name}</p>
                        <p className="text-xs font-medium text-blue-700 truncate">{getJobTitle(job)}{area && ` · ${area}`}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {job.customer.address}{!hidePrices && ` · ${fmtCurrency(job.price)}`}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedPendingIds.size > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                  {!bulkMoveOpen ? (
                    <Button onClick={() => setBulkMoveOpen(true)} variant="outline" className="w-full">
                      <ArrowRight size={14} />
                      Move {selectedPendingIds.size} selected to another day
                    </Button>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-slate-700">
                        Move {selectedPendingIds.size} job{selectedPendingIds.size !== 1 ? "s" : ""} to…
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setBulkDest("new")}
                          className={cn(
                            "flex flex-col items-center gap-1 p-2 rounded-lg border text-xs font-medium transition-colors text-center",
                            bulkDest === "new" ? "border-amber-500 bg-amber-500 text-white" : "border-slate-200 text-slate-600 hover:border-amber-300"
                          )}
                        >
                          <CalendarDays size={14} />
                          New overdue day
                        </button>
                        <button
                          type="button"
                          onClick={() => setBulkDest("existing")}
                          className={cn(
                            "flex flex-col items-center gap-1 p-2 rounded-lg border text-xs font-medium transition-colors text-center",
                            bulkDest === "existing" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300"
                          )}
                        >
                          <ArrowRight size={14} />
                          Alongside an area
                        </button>
                      </div>

                      {bulkDest === "new" ? (
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-600">Date for the overdue batch</label>
                          <input
                            type="date"
                            value={bulkNewDate}
                            onChange={(e) => setBulkNewDate(e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          />
                          <p className="text-[11px] text-slate-500">
                            Creates a temporary “Overdue – area” group on this date for each area.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-600">Add alongside an existing day</label>
                          <select
                            value={bulkExistingDayId}
                            onChange={(e) => setBulkExistingDayId(e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          >
                            <option value="">– Select a day –</option>
                            {futureDays.map((d) => (
                              <option key={d.id} value={d.id}>
                                {fmtDate(d.date)} ({d.area?.name ?? d.jobs[0]?.customer?.address?.split(",")[0] ?? "One-off"})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          <div className="flex gap-2 pt-1">
            <Button onClick={handleConfirmCompleteDay} disabled={isPending || !completionDate} className="flex-1">
              {isPending
                ? "Completing..."
                : (() => {
                    const carry = completePending.filter((j) => selectedPendingIds.has(j.id)).length;
                    const skip = completePending.length - carry;
                    if (completePending.length === 0) return "Complete";
                    return [carry && `Carry over ${carry}`, skip && `skip ${skip}`].filter(Boolean).join(", ") + " & complete";
                  })()}
            </Button>
            <Button variant="outline" onClick={() => setCompleteScope(null)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* ── Job Action Modal ─────────────────────────────── */}
      <JobActionModal
        job={selectedJob}
        openInPayFormMode={openJobInPayMode}
        onClose={() => { setSelectedJob(null); setOpenJobInPayMode(false); }}
        onDone={(price, note) => {
          if (!selectedJob) return;
          const job = selectedJob;
          safely(async () => {
            if (note.trim()) await doNote(job, note.trim());
            if (price !== job.price) await doPrice(job, price);
            await doComplete(job);
            setSelectedJob(null); setOpenJobInPayMode(false);
            refreshIfOnline();
          });
        }}
        onUndo={() => {
          if (!selectedJob) return;
          const job = selectedJob;
          safely(async () => {
            await uncompleteJob(job.id);
            setSelectedJob(null); setOpenJobInPayMode(false);
            router.refresh();
          });
        }}
        onSaveEdit={(price, note) => {
          if (!selectedJob) return;
          const job = selectedJob;
          safely(async () => {
            if (note !== null) await doNote(job, note);
            if (price !== null) await doPrice(job, price);
            setSelectedJob(null); setOpenJobInPayMode(false);
            refreshIfOnline();
          });
        }}
        onSkip={(price, note) => {
          if (!selectedJob) return;
          const job = selectedJob;
          safely(async () => {
            if (note.trim()) await doNote(job, note.trim());
            if (price !== job.price) await doPrice(job, price);
            await doSkip(job);
            setSelectedJob(null); setOpenJobInPayMode(false);
            refreshIfOnline();
          });
        }}
        onDoneAndPaid={async (visitPrice, allocations, method, notes) => {
          if (!selectedJob) return;
          const job = selectedJob;
          safely(async () => {
            if (notes?.trim()) await doNote(job, notes.trim());
            if (visitPrice !== job.price) await doPrice(job, visitPrice);
            await doComplete(job);
            await doPay(job, allocations, method, notes);
            setSelectedJob(null); setOpenJobInPayMode(false);
            refreshIfOnline();
          });
        }}
        onMarkPaidJobs={(allocations, method, notes) => {
          if (!selectedJob) return;
          const job = selectedJob;
          safely(async () => {
            await doPay(job, allocations, method, notes);
            setSelectedJob(null); setOpenJobInPayMode(false);
            refreshIfOnline();
          });
        }}
        onDoneAndPaidJobs={(visitPrice, allocations, method, notes) => {
          if (!selectedJob) return;
          const job = selectedJob;
          safely(async () => {
            if (notes?.trim()) await doNote(job, notes.trim());
            if (visitPrice !== job.price) await doPrice(job, visitPrice);
            await doComplete(job);
            await doPay(job, allocations, method, notes);
            setSelectedJob(null); setOpenJobInPayMode(false);
            refreshIfOnline();
          });
        }}
        onMarkPaid={(allocations, method, notes) => {
          if (!selectedJob) return;
          const job = selectedJob;
          safely(async () => {
            await doPay(job, allocations, method, notes);
            setSelectedJob(null); setOpenJobInPayMode(false);
            refreshIfOnline();
          });
        }}
        isPending={isPending}
        hidePrices={hidePrices}
      />

      {addJobDayId !== null && dayById.get(addJobDayId) && (
        <AddJobModal
          open
          onClose={() => setAddJobDayId(null)}
          workDayId={addJobDayId}
          currentAreaId={dayById.get(addJobDayId)!.areaId ?? undefined}
          existingCustomerIds={dayById.get(addJobDayId)!.jobs.map((j) => j.customerId)}
          hidePrices={hidePrices}
        />
      )}
    </div>
  );
}

// ── Job Action Modal ──────────────────────────────────────────────────────────

function JobActionModal({
  job,
  onClose,
  onDone,
  onDoneAndPaid,
  onDoneAndPaidJobs,
  onMarkPaid,
  onMarkPaidJobs,
  onUndo,
  onSkip,
  onSaveEdit,
  isPending,
  hidePrices = false,
  openInPayFormMode = false,
}: {
  job: Job | null;
  onClose: () => void;
  onDone: (price: number, note: string) => void;
  onDoneAndPaid: (visitPrice: number, allocations: Array<{jobId: number; amount: number}>, method: "CASH" | "BACS" | "CARD", notes?: string) => void;
  onDoneAndPaidJobs: (visitPrice: number, allocations: Array<{jobId: number; amount: number}>, method: "CASH" | "BACS" | "CARD", notes?: string) => void;
  onMarkPaid: (allocations: Array<{jobId: number; amount: number}>, method: "CASH" | "BACS" | "CARD", notes?: string) => void;
  onMarkPaidJobs: (allocations: Array<{jobId: number; amount: number}>, method: "CASH" | "BACS" | "CARD", notes?: string) => void;
  onUndo: () => void;
  onSkip: (price: number, note: string) => void;
  /** Change a finished job: null = leave as it is. */
  onSaveEdit: (price: number | null, note: string | null) => void;
  isPending: boolean;
  hidePrices?: boolean;
  openInPayFormMode?: boolean;
}) {
  const [showPayForm, setShowPayForm] = useState(false);
  const [payMode, setPayMode] = useState<"amount" | "jobs">("amount");
  const [payJobIds, setPayJobIds] = useState<Set<number>>(new Set());
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"CASH" | "BACS" | "CARD">("CASH");
  const [payNotes, setPayNotes] = useState("");
  const [editingCompletedDate, setEditingCompletedDate] = useState(false);
  const [completedDateInput, setCompletedDateInput] = useState("");

  const customerUnpaidJobs = useMemo(() => {
    if (!job) return [];
    // Include jobs of customers this customer pays for ("paid by"), labelled with their name.
    const own = job.customer.jobs.map((j) => ({ ...j, label: j.name ?? undefined }));
    const others = (job.customer.paysFor ?? []).flatMap((other) =>
      other.jobs.map((j) => ({ ...j, label: `${other.name} — ${j.name ?? "Window Cleaning"}` })),
    );
    return [...own, ...others]
      .sort((a, b) => new Date(a.workDay.date).getTime() - new Date(b.workDay.date).getTime() || a.id - b.id)
      .map((j) => {
        const paid = (j.allocations ?? []).reduce((s, a) => s + a.amount, 0);
        const due = Number(Math.max(0, j.price - paid).toFixed(2));
        return { id: j.id, name: j.label, price: j.price, paid: Number(paid.toFixed(2)), due, date: j.workDay?.date ?? null, isOneOff: j.isOneOff ?? false };
      })
      .filter((j) => j.due > 0.005);
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Worker note + price override — visible for all pending jobs before choosing an action
  const [workerNote, setWorkerNote] = useState("");
  const [priceInput, setPriceInput] = useState("");

  // Reset the pay form whenever a different job is selected
  useEffect(() => {
    if (job) {
      setPayMode("jobs");
      setPayAmount(String(job.price));
      setPayNotes("");
      setPayMethod(preferredMethod(job));
      setEditingCompletedDate(false);
      setCompletedDateInput(job.completedAt ? new Date(job.completedAt).toISOString().split("T")[0] : "");
      setWorkerNote(job.notes ?? "");
      setPriceInput(String(job.price));
      if (openInPayFormMode && job.status === "PENDING") {
        // Opened directly from card "Done & Paid" button — jump straight to pay form
        const allJobs = [{ id: job.id }, ...customerUnpaidJobs];
        setPayJobIds(new Set(allJobs.map(j => j.id)));
        setShowPayForm(true);
      } else {
        setShowPayForm(false);
        setPayJobIds(new Set());
      }
    }
  }, [job?.id, openInPayFormMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = job !== null;
  const effectiveAmount = payAmount === "" ? 0 : parseFloat(payAmount);
  const currentVisitAmount = job ? (job.status === "PENDING" ? (parseFloat(priceInput) || job.price) : job.price) : 0;
  const previousDebt = job ? job.customer.jobs.filter(j => j.id !== job.id).reduce((sum, j) => {
    const paid = (j.allocations ?? []).reduce((s, a) => s + a.amount, 0);
    return sum + Math.max(0, j.price - paid);
  }, 0) : 0;
  const currentOutstanding = job ? Math.max(0, job.price - getPaidAfterCompletion(job)) : 0;
  const isSettled = currentOutstanding < 0.005;
  const cleanAndDebtAmount = Number((currentVisitAmount + previousDebt).toFixed(2));

  return (
    <Modal
      open={open}
      onClose={() => {
        setShowPayForm(false);
        onClose();
      }}
      title={job ? (
        <Link href={`/customers/${job.customer.id}?back=1`} className="hover:underline hover:text-blue-700 transition-colors">
          {job.customer.name}
        </Link>
      ) : ""}
    >
      {job && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-sm text-slate-500 truncate">{job.customer.address}</p>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {!hidePrices && <span className="text-sm font-bold text-slate-800">{fmtCurrency(job.price)}</span>}
                {job.isOneOff && <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">one-off</span>}
              </div>
              {job.customer.phone && (
                <a
                  href={`tel:${job.customer.phone}`}
                  className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-50 border border-green-200 text-xs font-semibold text-green-700 hover:bg-green-100 active:bg-green-200 touch-manipulation transition-colors"
                >
                  <Phone size={13} />
                  {job.customer.phone}
                </a>
              )}
            </div>
          </div>

          {job.status === "COMPLETE" ? (
            /* ─── Already complete: offer Pay + Undo + Edit Date ─── */
            <div className="space-y-2">
              <div className="flex items-center justify-between px-3 py-2 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-green-600 flex-shrink-0" />
                  <span className="text-xs text-green-700 font-medium">Job complete</span>
                </div>
                {job.completedAt && !editingCompletedDate && (
                  <button
                    onClick={() => setEditingCompletedDate(true)}
                    className="text-xs text-green-600 hover:text-green-800 underline"
                  >
                    {new Date(job.completedAt).toLocaleDateString("en-GB")}
                  </button>
                )}
              </div>
              {editingCompletedDate && (
                <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
                  <span className="text-xs text-slate-500 whitespace-nowrap">Completed:</span>
                  <input
                    type="date"
                    value={completedDateInput}
                    onChange={(e) => setCompletedDateInput(e.target.value)}
                    className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs bg-white"
                  />
                  <button
                    onClick={async () => {
                      if (completedDateInput && job) {
                        await updateJobCompletedAt(job.id, completedDateInput);
                        setEditingCompletedDate(false);
                        (window as any).location.reload();
                      }
                    }}
                    disabled={!completedDateInput}
                    className="px-2.5 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 disabled:opacity-50"
                  >Save</button>
                  <button
                    onClick={() => {
                      setEditingCompletedDate(false);
                      setCompletedDateInput(job.completedAt ? new Date(job.completedAt).toISOString().split("T")[0] : "");
                    }}
                    className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-100"
                  >Cancel</button>
                </div>
              )}

              {/* Edit a finished job: price and note */}
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <Pencil size={12} /> Edit this job
                </p>
                {!hidePrices && (
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="w-12">Price £</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={priceInput}
                      onChange={(e) => setPriceInput(e.target.value)}
                      className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                    />
                  </label>
                )}
                <textarea
                  value={workerNote}
                  onChange={(e) => setWorkerNote(e.target.value)}
                  rows={2}
                  placeholder="Note for this job (shows on Payments too)"
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
                />
                {(() => {
                  const nextPrice = parseFloat(priceInput);
                  const priceChanged = !hidePrices && Number.isFinite(nextPrice) && Math.abs(nextPrice - job.price) > 0.004;
                  const noteChanged = workerNote.trim() !== (job.notes ?? "").trim();
                  return (
                    <button
                      type="button"
                      disabled={isPending || (!priceChanged && !noteChanged) || (priceChanged && nextPrice < 0)}
                      onClick={() => onSaveEdit(priceChanged ? nextPrice : null, noteChanged ? workerNote : null)}
                      className="w-full rounded-lg bg-slate-800 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
                    >
                      Save changes
                    </button>
                  );
                })()}
              </div>

              {/* Mark as Paid inline form */}
              {isSettled ? (
                <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-800">
                  <CheckCircle2 size={16} className="text-green-600" />
                  This job is already settled.
                </div>
              ) : !showPayForm ? (
                <button
                  disabled={isPending}
                  onClick={() => {
                    setPayJobIds(new Set(customerUnpaidJobs.map(j => j.id)));
                    setPayNotes("");
                    setPayMethod("CASH");
                    setShowPayForm(true);
                  }}
                  className="flex items-center gap-3 w-full p-3.5 rounded-xl border border-blue-200 hover:border-blue-400 bg-blue-50 hover:bg-blue-100 text-sm font-medium text-blue-800 transition-colors disabled:opacity-50"
                >
                  <Banknote size={18} className="text-blue-600" />
                  Mark as Paid
                  <span className="ml-auto text-xs text-blue-600 font-normal">{fmtCurrency(currentOutstanding)}</span>
                </button>
              ) : (
                <div className="border border-blue-300 rounded-xl bg-blue-50 p-3 space-y-3">
                  <p className="text-sm font-semibold text-blue-800 flex items-center gap-2">
                    <Banknote size={16} className="text-blue-600" />
                    Mark as Paid
                  </p>
                  {/* Specific jobs mode — always shown */}
                  {customerUnpaidJobs.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-slate-700">Which jobs are being paid</label>
                        <div className="flex gap-3 text-xs">
                          <button type="button" onClick={() => setPayJobIds(new Set(customerUnpaidJobs.map(j => j.id)))} className="text-blue-600 hover:underline">Select all</button>
                          <button type="button" onClick={() => setPayJobIds(new Set())} className="text-slate-400 hover:underline">Clear</button>
                        </div>
                      </div>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {customerUnpaidJobs.map((j) => {
                          const checked = payJobIds.has(j.id);
                          return (
                            <button key={j.id} type="button" onClick={() => setPayJobIds(prev => { const next = new Set(prev); next.has(j.id) ? next.delete(j.id) : next.add(j.id); return next; })}
                              className={cn("w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors",
                                checked ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-slate-300 bg-white"
                              )}>
                              {checked ? <CheckSquare size={15} className="text-blue-600 flex-shrink-0" /> : <Square size={15} className="text-slate-400 flex-shrink-0" />}
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-slate-700 truncate">{j.name || "Window Cleaning"}</p>
                                <p className="text-[11px] text-slate-400">{fmtDate(j.date ?? null)}{j.isOneOff ? " · one-off" : ""}</p>
                              </div>
                              {!hidePrices && (
                                <div className="text-right flex-shrink-0">
                                  <p className="text-[11px] text-slate-400">{fmtCurrency(j.price)}</p>
                                  <p className="text-xs font-semibold text-red-600">{fmtCurrency(j.due)} due</p>
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between">
                        <p className="text-xs text-slate-600">{payJobIds.size} job{payJobIds.size !== 1 ? "s" : ""} selected</p>
                        {!hidePrices && <p className="text-sm font-bold text-slate-800">{fmtCurrency(customerUnpaidJobs.filter(j => payJobIds.has(j.id)).reduce((s, j) => s + j.due, 0))}</p>}
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <label className="text-xs text-slate-600 font-medium mb-1 block">Method</label>
                    <div className="flex gap-2">
                      {(["CASH", "BACS", "CARD"] as const).map((m) => (
                        <button key={m} type="button" onClick={() => setPayMethod(m)}
                          className={cn("flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors",
                            payMethod === m ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300"
                          )}>{m}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 font-medium mb-1 block">Notes <span className="font-normal text-slate-400">(optional)</span></label>
                    <input type="text" value={payNotes} onChange={(e) => setPayNotes(e.target.value)}
                      placeholder="e.g. fronts only..."
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={isPending || payJobIds.size === 0}
                        onClick={() => {
                          const allocations = customerUnpaidJobs.filter((j) => payJobIds.has(j.id)).map((j) => ({ jobId: j.id, amount: j.due }));
                          onMarkPaidJobs(allocations, payMethod, payNotes || undefined);
                        }}
                      className="flex-1" size="sm">
                      {isPending ? "Saving..." : `Confirm - ${fmtCurrency(customerUnpaidJobs.filter(j => payJobIds.has(j.id)).reduce((s, j) => s + j.due, 0))}`}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowPayForm(false)}>Back</Button>
                  </div>
                </div>
              )}

              <button
                disabled={isPending}
                onClick={onUndo}
                className="flex items-center gap-3 w-full p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 text-sm font-medium text-slate-700 transition-colors disabled:opacity-50"
              >
                <Undo2 size={18} className="text-slate-500" />
                Undo - Mark as Pending
              </button>
            </div>
          ) : job.status === "SKIPPED" || job.status === "OUTSTANDING" ? (
            /* ─── Skipped / Outstanding: offer re-open ─── */
            <div className="space-y-2">
              <p className={cn(
                "text-xs font-medium rounded-lg px-3 py-2",
                job.status === "OUTSTANDING" ? "text-red-700 bg-red-50" : "text-slate-600 bg-slate-50"
              )}>
                This job is marked as {job.status.toLowerCase()}.
              </p>
              <button
                disabled={isPending}
                onClick={onUndo}
                className="flex items-center gap-3 w-full p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 text-sm font-medium text-slate-700 transition-colors disabled:opacity-50"
              >
                <Undo2 size={18} className="text-slate-500" />
                Re-open - Mark as Pending
              </button>
            </div>
          ) : (
            /* ─── Pending: full action list ─── */
            <div className="space-y-2">
              {/* Done */}
              {!showPayForm && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Complete without payment</p>
                  <div className="flex gap-2 items-center">
                    <label className="text-xs text-slate-600 font-medium whitespace-nowrap w-14 flex-shrink-0">Price GBP</label>
                    <input
                      type="number" step="0.01" min="0"
                      value={hidePrices ? "" : priceInput}
                      placeholder={hidePrices ? "unchanged" : undefined}
                      onChange={(e) => {
                        setPriceInput(e.target.value);
                        setPayAmount(e.target.value);
                      }}
                      className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div className="flex gap-2 items-center">
                    <label className="text-xs text-slate-600 font-medium whitespace-nowrap w-14 flex-shrink-0">Note</label>
                    <input
                      type="text"
                      value={workerNote}
                      onChange={(e) => setWorkerNote(e.target.value)}
                      placeholder="e.g. fronts only, gate locked..."
                      className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>
              )}

              <button
                disabled={isPending}
                onClick={() => onDone(parseFloat(priceInput) || job.price, workerNote)}
                className="flex items-center gap-3 w-full p-3.5 rounded-xl border border-green-200 hover:border-green-400 bg-green-50 hover:bg-green-100 text-sm font-medium text-green-800 transition-colors disabled:opacity-50"
              >
                <Check size={18} className="text-green-600" />
                Mark Complete
                <span className="ml-auto text-xs text-green-600 font-normal">Complete, no payment</span>
              </button>

              {/* Done & Paid */}
              {!showPayForm ? (
                <button
                  disabled={isPending}
                  onClick={() => {
                    const allJobsForMode = [{ id: job.id, name: job.name ?? undefined, price: currentVisitAmount, paid: 0, due: currentVisitAmount, date: null as null, isOneOff: job.isOneOff ?? false }, ...customerUnpaidJobs];
                    setPayJobIds(new Set(allJobsForMode.map(j => j.id)));
                    setPayNotes(workerNote);
                    setPayMethod("CASH");
                    setShowPayForm(true);
                  }}
                  className="flex items-center gap-3 w-full p-3.5 rounded-xl border border-blue-200 hover:border-blue-400 bg-blue-50 hover:bg-blue-100 text-sm font-medium text-blue-800 transition-colors disabled:opacity-50"
                >
                  <Banknote size={18} className="text-blue-600" />
                  Done &amp; Paid
                  <span className="ml-auto text-xs text-blue-600 font-normal">{hidePrices ? null : fmtCurrency(job.price)}</span>
                </button>
              ) : (
                <div className="border border-blue-300 rounded-xl bg-blue-50 p-3 space-y-3">
                  <p className="text-sm font-semibold text-blue-800 flex items-center gap-2">
                    <Banknote size={16} className="text-blue-600" />
                    Done &amp; Paid
                  </p>
                  {(() => {
                    const allJobsForMode = [{ id: job.id, name: job.name ?? undefined, price: currentVisitAmount, paid: 0, due: currentVisitAmount, date: null as null, isOneOff: job.isOneOff ?? false }, ...customerUnpaidJobs];
                    return (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-slate-700">Which jobs are being paid</label>
                            <div className="flex gap-3 text-xs">
                              <button type="button" onClick={() => setPayJobIds(new Set(allJobsForMode.map(j => j.id)))} className="text-blue-600 hover:underline">Select all</button>
                              <button type="button" onClick={() => setPayJobIds(new Set())} className="text-slate-400 hover:underline">Clear</button>
                            </div>
                          </div>
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {allJobsForMode.map((j) => {
                              const checked = payJobIds.has(j.id);
                              return (
                                <button key={j.id} type="button" onClick={() => setPayJobIds(prev => { const next = new Set(prev); next.has(j.id) ? next.delete(j.id) : next.add(j.id); return next; })}
                                  className={cn("w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors", checked ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-slate-300 bg-white")}>
                                  {checked ? <CheckSquare size={15} className="text-blue-600 flex-shrink-0" /> : <Square size={15} className="text-slate-400 flex-shrink-0" />}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-slate-700 truncate">{j.name || "Window Cleaning"}{j.id === job.id ? " (today)" : ""}</p>
                                    <p className="text-[11px] text-slate-400">{j.date ? fmtDate(j.date) : "Today"}{j.isOneOff ? " · one-off" : ""}</p>
                                  </div>
                                  {!hidePrices && <div className="text-right flex-shrink-0"><p className="text-[11px] text-slate-400">{fmtCurrency(j.price)}</p><p className="text-xs font-semibold text-red-600">{fmtCurrency(j.due)} due</p></div>}
                                </button>
                              );
                            })}
                          </div>
                          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between">
                            <p className="text-xs text-slate-600">{payJobIds.size} job{payJobIds.size !== 1 ? "s" : ""} selected</p>
                            {!hidePrices && <p className="text-sm font-bold text-slate-800">{fmtCurrency(allJobsForMode.filter(j => payJobIds.has(j.id)).reduce((s, j) => s + j.due, 0))}</p>}
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-slate-600 font-medium mb-1 block">Method</label>
                          <div className="flex gap-2">
                            {(["CASH", "BACS", "CARD"] as const).map((m) => (
                              <button key={m} type="button" onClick={() => setPayMethod(m)}
                                className={cn("flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors", payMethod === m ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300")}>{m}</button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-slate-600 font-medium mb-1 block">Notes <span className="font-normal text-slate-400">(optional)</span></label>
                          <input type="text" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="e.g. fronts only, window 3 broken..."
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                        </div>
                        <div className="flex gap-2">
                          <Button disabled={isPending || payJobIds.size === 0}
                            onClick={() => {
                              const allocations = allJobsForMode.filter(j => payJobIds.has(j.id)).map(j => ({ jobId: j.id, amount: j.due }));
                              onDoneAndPaidJobs(currentVisitAmount, allocations, payMethod, payNotes || undefined);
                            }} className="flex-1" size="sm">
                            {isPending ? "Saving..." : `Confirm - ${fmtCurrency(allJobsForMode.filter(j => payJobIds.has(j.id)).reduce((s, j) => s + j.due, 0))}`}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setShowPayForm(false)}>Back</Button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* Skip */}
              <button
                disabled={isPending}
                onClick={() => onSkip(parseFloat(priceInput) || job.price, workerNote)}
                className="flex items-center gap-3 w-full p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 text-sm font-medium text-slate-600 transition-colors disabled:opacity-50"
              >
                <SkipForward size={18} className="text-slate-400" />
                Skip
                <span className="ml-auto text-xs text-slate-400 font-normal">Reschedule next due</span>
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function CustomerNotesModal({ job, onClose, hidePrices = false }: { job: Job | null; onClose: () => void; hidePrices?: boolean }) {
  const [noteText, setNoteText] = useState("");
  const [isSaving, startSaveTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (job) setNoteText(job.notes ?? "");
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!job) return null;

  const handleSave = () => {
    startSaveTransition(async () => {
      await updateJobNotes(job.id, noteText);
      router.refresh();
      onClose();
    });
  };

  return (
    <Modal open={true} onClose={onClose} title={
      <Link href={`/customers/${job.customer.id}?back=1`} className="hover:underline hover:text-blue-700 transition-colors">
        {job.customer.name}
      </Link>
    }>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">{job.customer.address}{!hidePrices && ` - ${fmtCurrency(job.price)}`}</p>
        {job.customer.notes && (
          <div className="border-l-4 border-amber-400 bg-amber-50 px-4 py-3 rounded-r-xl">
            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide mb-1.5">Customer Notes</p>
            <p className="text-sm text-amber-900 whitespace-pre-wrap leading-relaxed">{job.customer.notes}</p>
          </div>
        )}
        <div>
          <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wide mb-1">Job Notes (this visit)</p>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="e.g. couldn't reach side gate, conservatory extra, customer called..."
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 bg-slate-50 min-h-[90px]"
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={isSaving} size="sm" className="flex-1">
            {isSaving ? "Saving..." : "Save Notes"}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Route optimiser helpers + modal ────────────────────────────────────────────────────────────

async function geocodeAddress(address: string): Promise<[number, number] | null> {
  try {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
    if (!r.ok) return null;
    const data = await r.json();
    if (!data) return null;
    return [data.lat, data.lon];
  } catch { return null; }
}

function haversineKm([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestNeighbourTSP(coords: Array<[number, number] | null>, startIdx: number): number[] {
  const n = coords.length;
  const visited = new Set<number>();
  const order: number[] = [startIdx];
  visited.add(startIdx);
  while (order.length < n) {
    const cur = order[order.length - 1];
    const cc = coords[cur];
    if (!cc) {
      for (let i = 0; i < n; i++) { if (!visited.has(i)) { order.push(i); visited.add(i); break; } }
      continue;
    }
    let bestDist = Infinity, bestIdx = -1;
    for (let i = 0; i < n; i++) {
      if (visited.has(i)) continue;
      const nc = coords[i];
      if (!nc) continue;
      const d = haversineKm(cc, nc);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx === -1) { for (let i = 0; i < n; i++) if (!visited.has(i)) { order.push(i); visited.add(i); } break; }
    order.push(bestIdx);
    visited.add(bestIdx);
  }
  return order;
}

function RouteOptimiserModal({
  jobs, open, onClose, onApply,
}: {
  jobs: Job[];
  open: boolean;
  onClose: () => void;
  onApply: (orderedIds: number[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [startJobId, setStartJobId] = useState<number | "">(jobs[0]?.id ?? "");
  const [orderedJobs, setOrderedJobs] = useState<Job[] | null>(null);

  // Reset when modal opens
  useEffect(() => {
    if (open) { setOrderedJobs(null); setError(""); setProgress(""); }
  }, [open]);

  const handleOptimise = async () => {
    setLoading(true);
    setError("");
    setOrderedJobs(null);
    const coords: Array<[number, number] | null> = [];
    for (let i = 0; i < jobs.length; i++) {
      setProgress(`Locating ${i + 1}/${jobs.length}: ${jobs[i].customer?.name ?? ""}`);
      const customer = jobs[i].customer;
      // A pinned house needs no lookup.
      if (customer && hasPin(customer)) { coords.push([customer.latitude!, customer.longitude!]); continue; }
      const c = await geocodeAddress(customer?.address ?? "");
      coords.push(c);
      if (i < jobs.length - 1) await new Promise((r) => setTimeout(r, 1100));
    }
    const startIdx = startJobId !== "" ? jobs.findIndex((j) => j.id === startJobId) : 0;
    const order = nearestNeighbourTSP(coords, Math.max(0, startIdx));
    setOrderedJobs(order.map((i) => jobs[i]));
    setLoading(false);
    setProgress("");
  };

  return (
    <Modal open={open} onClose={onClose} title="Route Optimiser">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Geocodes each address and finds the shortest route using nearest-neighbour.
          Requires an internet connection.
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

        {/* Optimised route */}
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
            <p className="text-[10px] text-slate-400">Route applies to this page session only.</p>
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
              onClick={() => onApply(orderedJobs.map((j) => j.id))}
              className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-bold transition-colors"
            >
              Apply This Order
            </button>
          )}
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
            {orderedJobs ? "Discard" : "Cancel"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function JobCard({
  job,
  onToggle,
  isPending,
  onNotesClick,
  onQuickComplete,
  onQuickPay,
  onOpenInPayMode,
  hidePrices = false,
  showWorker = false,
  quickPayMethod = "CASH",
  areaTag = null,
}: {
  job: Job;
  showWorker?: boolean;
  /** Shown when jobs from several areas are mixed in one list. */
  areaTag?: { name: string; color: string } | null;
  quickPayMethod?: "CASH" | "BACS" | "CARD";
  onToggle: () => void;
  isPending: boolean;
  onNotesClick?: () => void;
  onQuickComplete?: () => void;
  onQuickPay?: (includeDebt: boolean, method: "CASH" | "BACS" | "CARD") => void;
  onOpenInPayMode?: () => void;
  hidePrices?: boolean;
}) {
  const isDone = job.status === "COMPLETE";
  const isQuote = Boolean(job.isQuote);
  const isClickable = !isQuote; // Quote visits use their own buttons, not the job modal
  const [showQuickPayChoices, setShowQuickPayChoices] = useState(false);
  const [includeDebt, setIncludeDebt] = useState(false);
  const previousDebt = job.customer.jobs.filter(j => j.id !== job.id).reduce((sum, j) => {
    const paid = (j.allocations ?? []).reduce((s, a) => s + a.amount, 0);
    return sum + Math.max(0, j.price - paid);
  }, 0);

  return (
    <div
      className={cn(
        "rounded-xl border transition-all overflow-hidden",
        isQuote
          ? quoteCardClass(job.quoteStatus)
          : isDone
          ? "bg-green-50 border-green-200"
          : job.status === "OUTSTANDING"
          ? "bg-red-50 border-red-200"
          : job.status === "SKIPPED"
          ? "bg-gray-50 border-gray-200 opacity-70"
          : job.isOneOff
          ? "bg-amber-50 border-amber-300 shadow-sm"
          : "bg-white border-slate-200 shadow-sm"
      )}
    >
      {/* ── Card body — tap to open modal ───────────────────── */}
      <div
        className={cn("flex items-center gap-3 p-3.5", isClickable && !isPending ? "cursor-pointer active:scale-[0.99]" : "")}
        onClick={isClickable && !isPending ? onToggle : undefined}
      >
        {/* Status icon */}
        <div className="flex-shrink-0">
          {isDone ? (
            <CheckCircle2 size={22} className="text-green-600" />
          ) : (
            <Circle
              size={22}
              className={cn(
                job.status === "OUTSTANDING" ? "text-red-400" :
                job.status === "SKIPPED" ? "text-gray-400" : "text-slate-300"
              )}
            />
          )}
        </div>

        {/* Customer info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className={cn("text-sm font-semibold truncate", isDone ? "text-green-800" : "text-slate-800")}>
              {job.customer.name}
            </p>
            {areaTag && (
              <span
                className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
                style={{ backgroundColor: areaTag.color }}
              >
                {areaTag.name}
              </span>
            )}
          </div>
          {isQuote ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-purple-800">
              <span className="rounded bg-purple-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Quote</span>
              {quoteSummary(job)}
            </p>
          ) : (
            <p className={cn("text-xs font-medium truncate mt-0.5", isDone ? "text-blue-700" : "text-blue-600")}>
              {getJobTitle(job)}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className={cn("text-xs truncate", isDone ? "text-green-600" : "text-slate-500")}>
              {job.customer.address}
            </p>
            <a
              href={mapsHref(job.customer)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "flex-shrink-0 p-2 -m-2 rounded-full transition-colors touch-manipulation",
                isDone ? "text-green-500 hover:text-green-700 active:bg-green-100" : "text-slate-400 hover:text-blue-500 active:bg-blue-50"
              )}
              title="Open in Google Maps"
            >
              <MapPin size={18} />
            </a>
          </div>
          {(job.customer.notes || job.notes) && (
            <button
              onClick={(e) => { e.stopPropagation(); onNotesClick?.(); }}
              className="mt-1 flex w-full items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-left text-[11px] leading-snug text-amber-900 hover:bg-amber-100 active:scale-[0.99] transition-all"
            >
              <StickyNote size={11} className="mt-0.5 flex-shrink-0" />
              <span className="line-clamp-2">{[job.notes, job.customer.notes].filter(Boolean).join(" · ")}</span>
            </button>
          )}
          {(job.customer.slip === false || job.customer.preferredPaymentMethod || job.assignedUser || (job.status === "COMPLETE" && job.completedBy && showWorker)) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {preferenceLabel(job.customer.preferredPaymentMethod) && (
                <span className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  expectsPaymentAtDoor(job.customer.preferredPaymentMethod)
                    ? "bg-amber-100 text-amber-800"
                    : "bg-sky-100 text-sky-800"
                )}>
                  Usually: {preferenceLabel(job.customer.preferredPaymentMethod)}
                </span>
              )}
              {job.customer.slip === false && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">No slip</span>
              )}
              {job.assignedUser && showWorker && (
                <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                  {job.assignedUser.name ?? job.assignedUser.email}
                </span>
              )}
              {job.status === "COMPLETE" && job.completedBy && showWorker && (
                <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                  by {job.completedBy.name ?? job.completedBy.email}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Price + badges */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={cn("text-sm font-bold", isDone ? "text-green-700" : "text-slate-700")}>
            {hidePrices || isQuote ? null : fmtCurrency(job.price)}
          </span>
          {isClickable && (
            <span className="flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              <Pencil size={9} /> Edit
            </span>
          )}
          {(() => {
            const debt = (job.customer.jobs ?? []).reduce((sum, j) => {
              const paid = (j.allocations ?? []).reduce((s, a) => s + a.amount, 0);
              return sum + Math.max(0, j.price - paid);
            }, 0);
            return debt > 0.005 ? (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">
                owes {fmtCurrency(debt)}
              </span>
            ) : null;
          })()}
          {job.isOneOff && !isQuote && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
              one-off
            </span>
          )}
          {job.status !== "PENDING" && job.status !== "COMPLETE" && (
            <span className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
              job.status === "OUTSTANDING" ? "bg-red-100 text-red-700" :
              job.status === "SKIPPED" ? "bg-gray-100 text-gray-600" :
              "bg-yellow-100 text-yellow-700"
            )}>
              {job.status.toLowerCase()}
            </span>
          )}
          {job.status === "COMPLETE" && !isQuote && (() => {
            const totalPaid = getPaidAfterCompletion(job);
            return totalPaid >= job.price - 0.005 ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-300">
                <Check size={10} />
                Paid
              </span>
            ) : null;
          })()}
        </div>
      </div>

      {isQuote && <QuoteActions job={job} canMarkLive={showWorker} />}

      {/* ── Action buttons — only for actionable statuses ───── */}
      {!isQuote && job.status === "PENDING" && (onQuickComplete || onQuickPay) && (
        <>
          <div className="flex border-t border-slate-100">
            {onQuickComplete && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowQuickPayChoices(false); onQuickComplete(); }}
                disabled={isPending}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-green-700 bg-green-50 hover:bg-green-100 active:bg-green-200 transition-colors disabled:opacity-50 touch-manipulation"
              >
                <Check size={15} />
                Done
              </button>
            )}
            {onQuickPay && onQuickComplete && (
              <div className="w-px bg-slate-100" />
            )}
            {onQuickPay && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIncludeDebt(previousDebt > 0.005);
                  setShowQuickPayChoices((prev) => !prev);
                }}
                disabled={isPending}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 transition-colors disabled:opacity-50 touch-manipulation"
              >
                <Banknote size={15} className="text-blue-600" />
                Done &amp; Paid
              </button>
            )}
          </div>
          {onQuickPay && showQuickPayChoices && (
            <div className="border-t border-blue-100 bg-blue-50/70 p-2.5 space-y-2" onClick={(e) => e.stopPropagation()}>
              <p className="text-[11px] font-medium text-blue-800">Paid today by:</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ["CASH", "Cash"],
                  ["CARD", "Card"],
                  ["BACS", "Bank"],
                ] as const).map(([method, label]) => (
                  <button
                    key={method}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowQuickPayChoices(false); onQuickPay(includeDebt, method); }}
                    disabled={isPending}
                    className={cn(
                      "px-3 py-2.5 rounded-lg border bg-white text-sm font-semibold disabled:opacity-50",
                      quickPayMethod === method ? "border-blue-500 text-blue-800 ring-1 ring-blue-400" : "border-blue-200 text-blue-700"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {previousDebt > 0.005 && (
                <label className="flex items-center gap-2 text-[11px] font-medium text-amber-800">
                  <input type="checkbox" checked={includeDebt} onChange={(e) => setIncludeDebt(e.target.checked)} />
                  Also pay the {fmtCurrency(previousDebt)} owed from previous visits
                </label>
              )}
            </div>
          )}
        </>
      )}
      {!isQuote && job.status === "COMPLETE" && (() => {
        const unpaid = getPaidAfterCompletion(job) < job.price - 0.005;
        return (
          <div className="flex border-t border-green-100">
            <button
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              disabled={isPending}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-colors disabled:opacity-50 touch-manipulation"
            >
              <Pencil size={14} />
              {hidePrices ? "Edit note" : "Edit price or note"}
            </button>
            {unpaid && (
              <>
                <div className="w-px bg-green-100" />
                <button
                  onClick={(e) => { e.stopPropagation(); onToggle(); }}
                  disabled={isPending}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-50 active:bg-amber-100 transition-colors disabled:opacity-50 touch-manipulation"
                >
                  <Banknote size={15} />
                  Mark as Paid
                </button>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── Add Job Modal ─────────────────────────────────────────────────────────────

interface AddJobModalProps {
  open: boolean;
  onClose: () => void;
  workDayId: number;
  currentAreaId?: number;
  existingCustomerIds: number[];
  hidePrices?: boolean;
}

type AddJobTab = "from-area" | "one-off" | "new-customer";

function AddJobModal({ open, onClose, workDayId, currentAreaId, existingCustomerIds, hidePrices = false }: AddJobModalProps) {
  const [tab, setTab] = useState<AddJobTab>("from-area");

  // ── From-area tab ──
  const [areas, setAreas] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [areaCustomers, setAreaCustomers] = useState<Array<{ id: number; name: string; address: string; price: number }>>([]);
  const [loadingAreaCustomers, setLoadingAreaCustomers] = useState(false);

  // ── One-off tab ──
  const [oneOffMode, setOneOffMode] = useState<"search" | "new-customer">("search");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: number; name: string; address: string; price: number; area: { name: string } | null }>>([]);
  const [oneOffSelected, setOneOffSelected] = useState<{ id: number; name: string; address: string; price: number } | null>(null);
  const [oneOffJobName, setOneOffJobName] = useState("Window Cleaning");
  const [oneOffCustomPrice, setOneOffCustomPrice] = useState("");
  const [oneOffNotes, setOneOffNotes] = useState("");

  // ── New-customer tab ──
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newJobName, setNewJobName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newAreaId, setNewAreaId] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // ── One-off new-customer fields ──
  const [newOneOffAreaId, setNewOneOffAreaId] = useState("");
  const [newOneOffFrequency, setNewOneOffFrequency] = useState("4");

  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Load areas list once (used by both from-area and new-customer tabs)
  const ensureAreas = async () => {
    if (areas.length > 0) return;
    try {
      const res = await fetch("/api/areas");
      if (res.ok) setAreas(await res.json());
    } catch { /* ignore */ }
  };

  // Load areas as soon as the modal opens (default tab is from-area)
  useEffect(() => {
    if (open) ensureAreas();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabChange = async (t: AddJobTab) => {
    setTab(t);
    if (t === "from-area" || t === "new-customer") await ensureAreas();
    if (t === "new-customer" && currentAreaId) setNewAreaId(prev => prev || String(currentAreaId));
  };

  const handleAreaChange = async (areaId: string) => {
    setSelectedAreaId(areaId);
    setAreaCustomers([]);
    if (!areaId) return;
    setLoadingAreaCustomers(true);
    try {
      const res = await fetch(`/api/customers/search?areaId=${areaId}`);
      if (res.ok) setAreaCustomers(await res.json());
    } catch { /* ignore */ }
    setLoadingAreaCustomers(false);
  };

  const handleSearch = async () => {
    if (query.trim().length < 2) return;
    const res = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}`);
    if (res.ok) setSearchResults(await res.json());
  };

  const handleAddFromArea = (customerId: number) => {
    startTransition(async () => {
      await addJobFromOtherArea(workDayId, customerId);
      onClose();
      router.refresh();
    });
  };

  const handleAddOneOff = () => {
    if (!oneOffSelected) return;
    startTransition(async () => {
      await addOneOffJobToDay(workDayId, oneOffSelected.id, {
        name: oneOffJobName,
        price: oneOffCustomPrice ? parseFloat(oneOffCustomPrice) : oneOffSelected.price,
        notes: oneOffNotes,
      });
      onClose();
      router.refresh();
    });
  };

  const handleCreateOneOffCustomer = () => {
    if (!newName.trim() || !newAddress.trim() || !newPrice) return;
    startTransition(async () => {
      await createOneOffCustomerAndAddToDay(
        {
          name: newName.trim(),
          address: newAddress.trim(),
          price: parseFloat(newPrice),
          jobName: newJobName.trim() || undefined,
          phone: newPhone.trim() || undefined,
          notes: newNotes.trim() || undefined,
          areaId: newOneOffAreaId ? parseInt(newOneOffAreaId) : undefined,
          frequencyWeeks: newOneOffAreaId ? (parseInt(newOneOffFrequency) || 4) : undefined,
        },
        workDayId
      );
      onClose();
      router.refresh();
    });
  };

  const handleCreateCustomer = () => {
    if (!newName.trim() || !newAddress.trim() || !newPrice || !newAreaId) return;
    startTransition(async () => {
      await createCustomerAndAddToDay(
        {
          name: newName.trim(),
          address: newAddress.trim(),
          price: parseFloat(newPrice),
          areaId: parseInt(newAreaId),
          jobName: newJobName.trim() || undefined,
          email: newEmail.trim() || undefined,
          phone: newPhone.trim() || undefined,
          notes: newNotes.trim() || undefined,
        },
        workDayId
      );
      onClose();
      router.refresh();
    });
  };

  const handleClose = () => {
    setQuery(""); setSearchResults([]);
    setOneOffMode("search"); setOneOffSelected(null); setOneOffJobName("Window Cleaning"); setOneOffCustomPrice(""); setOneOffNotes("");
    setSelectedAreaId(""); setAreaCustomers([]);
    setNewName(""); setNewAddress(""); setNewJobName(""); setNewPrice(""); setNewAreaId("");
    setNewEmail(""); setNewPhone(""); setNewNotes("");
    setNewOneOffAreaId(""); setNewOneOffFrequency("4");
    setTab("from-area");
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Add Job to Day">
      <div className="space-y-3">
        {/* Tab bar */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            onClick={() => handleTabChange("from-area")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors",
              tab === "from-area" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <MapPin size={12} />
            From Area
          </button>
          <button
            onClick={() => handleTabChange("one-off")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors",
              tab === "one-off" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Search size={12} />
            One‑Off
          </button>
          <button
            onClick={() => handleTabChange("new-customer")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors",
              tab === "new-customer" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Plus size={12} />
            New
          </button>
        </div>

        {/* ── From Area tab ─────────────────────────────────── */}
        {tab === "from-area" && (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Moves the customer's next booked visit to this day (or adds one if none is booked). Nothing is marked done until it's done.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Select area</label>
              <select
                value={selectedAreaId}
                onChange={(e) => handleAreaChange(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">– Choose an area –</option>
                {areas
                  .filter((a) => a.id !== currentAreaId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
              </select>
            </div>

            {loadingAreaCustomers && (
              <p className="text-sm text-slate-500 text-center py-3">Loading…</p>
            )}

            {areaCustomers.length > 0 && (
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                {areaCustomers.map((c) => {
                  const onDay = existingCustomerIds.includes(c.id);
                  return (
                    <li key={c.id} className={cn("flex items-center justify-between px-3 py-2.5", onDay && "opacity-50")}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                        <p className="text-xs text-slate-500 truncate">{c.address}{!hidePrices && ` · ${fmtCurrency(c.price)}`}</p>
                      </div>
                      {onDay ? (
                        <span className="text-xs text-slate-400 ml-2 flex-shrink-0">On day</span>
                      ) : (
                        <button
                          disabled={isPending}
                          onClick={() => handleAddFromArea(c.id)}
                          className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50 ml-2 flex-shrink-0"
                        >
                          Move here
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {selectedAreaId && !loadingAreaCustomers && areaCustomers.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-3">No active customers in this area.</p>
            )}
          </div>
        )}

        {/* ── One-Off tab ───────────────────────────────────── */}
        {tab === "one-off" && (
          <div className="space-y-3">
            {/* Sub-mode switch */}
            <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                onClick={() => { setOneOffMode("search"); setOneOffSelected(null); setQuery(""); setSearchResults([]); }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                  oneOffMode === "search" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                <Search size={11} />
                Existing
              </button>
              <button
                onClick={() => { setOneOffMode("new-customer"); ensureAreas(); }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                  oneOffMode === "new-customer" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                <Plus size={11} />
                New Customer
              </button>
            </div>

            {oneOffMode === "search" && (
              <>
                {!oneOffSelected ? (
                  <>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Search by name or address…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <Button onClick={handleSearch} size="sm" variant="outline"><Search size={14} /></Button>
                    </div>
                    {searchResults.length > 0 && (
                      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto">
                        {searchResults.map((c) => {
                          const onDay = existingCustomerIds.includes(c.id);
                          return (
                            <li
                              key={c.id}
                              className={cn(
                                "flex items-center justify-between px-3 py-2.5",
                                onDay ? "opacity-50" : "hover:bg-slate-50 cursor-pointer"
                              )}
                              onClick={!onDay ? () => { setOneOffSelected(c); setOneOffCustomPrice(String(c.price)); setSearchResults([]); setQuery(c.name); } : undefined}
                            >
                              <div>
                                <p className="text-sm font-medium text-slate-800">{c.name}</p>
                                <p className="text-xs text-slate-500">{c.address}{c.area ? ` · ${c.area.name}` : ""}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold">{hidePrices ? null : fmtCurrency(c.price)}</span>
                                {onDay ? <span className="text-xs text-slate-400">Added</span> : <Plus size={14} className="text-blue-500" />}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {searchResults.length === 0 && query.length >= 2 && (
                      <p className="text-sm text-slate-500 text-center py-2">No customers found.</p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between p-3 bg-blue-50 rounded-xl border border-blue-200">
                      <div>
                        <p className="text-sm font-semibold text-blue-900">{oneOffSelected.name}</p>
                        <p className="text-xs text-blue-600">{oneOffSelected.address}</p>
                      </div>
                      <button onClick={() => { setOneOffSelected(null); setQuery(""); }} className="text-xs text-blue-500 hover:underline">Change</button>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Job Name *</label>
                      <input type="text" value={oneOffJobName} onChange={(e) => setOneOffJobName(e.target.value)}
                        placeholder="e.g. Window Cleaning, Conservatory…"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Price (£) <span className="text-slate-400 font-normal">— edit if different</span></label>
                      <input type="number" step="0.01" value={oneOffCustomPrice} onChange={(e) => setOneOffCustomPrice(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                      <input type="text" value={oneOffNotes} onChange={(e) => setOneOffNotes(e.target.value)}
                        placeholder="e.g. conservatory only, front only…"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <Button onClick={handleAddOneOff} disabled={isPending || !oneOffJobName.trim()} className="w-full">
                      {isPending ? "Adding…" : "Add One-off Job"}
                    </Button>
                  </>
                )}
              </>
            )}

            {oneOffMode === "new-customer" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">
                  <span className="text-xs text-purple-700 font-medium">Creates a new customer with no recurring schedule — job history still viewable on their record. Optionally assign an area and frequency to add them to the regular schedule.</span>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Job Name</label>
                  <input type="text" value={newJobName} onChange={(e) => setNewJobName(e.target.value)}
                    placeholder="e.g. Window Cleaning, Conservatory Clean…"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Name *</label>
                  <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                    placeholder="Jane Smith"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Address *</label>
                  <input type="text" value={newAddress} onChange={(e) => setNewAddress(e.target.value)}
                    placeholder="12 High Street"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Price (£) *</label>
                    <input type="number" step="0.50" min="0" value={newPrice} onChange={(e) => setNewPrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
                    <input type="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
                      placeholder="07700 900000"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Area <span className="text-slate-400 font-normal">(optional — leave blank for one-off only)</span>
                  </label>
                  <select
                    value={newOneOffAreaId}
                    onChange={(e) => setNewOneOffAreaId(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">– No area (one-off only) –</option>
                    {areas.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                {/* Frequency comes from the area. */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                  <input type="text" value={newNotes} onChange={(e) => setNewNotes(e.target.value)}
                    placeholder="Dog in garden, ring bell…"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <Button onClick={handleCreateOneOffCustomer} disabled={isPending || !newName.trim() || !newAddress.trim() || !newPrice} className="w-full">
                  {isPending ? "Creating…" : (newOneOffAreaId ? "Create Customer & Add to Day" : "Create One-off & Add to Day")}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── New Customer tab ─────────────────────────────── */}
        {tab === "new-customer" && (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              Creates a new customer and immediately adds them to today&apos;s day.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Jane Smith"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Address *</label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="e.g. 12 High Street"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Job Name</label>
                <input
                  type="text"
                  value={newJobName}
                  onChange={(e) => setNewJobName(e.target.value)}
                  placeholder="e.g. Window Cleaning, Conservatory"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Price (£) *</label>
                <input
                  type="number"
                  step="0.50"
                  min="0"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Area *</label>
                <select
                  value={newAreaId}
                  onChange={(e) => setNewAreaId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">– Area –</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="07700 900000"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Access notes, key codes, etc."
                  rows={2}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>

            <Button
              onClick={handleCreateCustomer}
              disabled={isPending || !newName.trim() || !newAddress.trim() || !newPrice || !newAreaId}
              className="w-full"
            >
              {isPending ? "Creating…" : "Create & Add to Day"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

