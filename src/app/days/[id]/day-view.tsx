"use client";

import { useState, useTransition, useEffect, useRef } from "react";
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
  MapPin,
  ArrowLeftRight,
  Search,
  CalendarDays,
  RotateCcw,
  StickyNote,
  Navigation2,
  Loader2,
  Pencil,
  X,
  Phone,
} from "lucide-react";
import {
  getWorkDay,
  getWorkDays,
  getAreas,
  getCustomers,
  completeJob,
  uncompleteJob,
  skipJob,
  logPayment,
  markJobPaid,
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
} from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { fmtDate, fmtShortDate, fmtCurrency, cn } from "@/lib/utils";

type Day = NonNullable<Awaited<ReturnType<typeof getWorkDay>>>;
type FutureDay = Awaited<ReturnType<typeof getWorkDays>>[0];
type Job = Day["jobs"][0];

function getPreviousDebt(job: Job) {
  const previousCompletedTotal = (job.customer.jobs ?? [])
    .filter((entry) => entry.id !== job.id)
    .reduce((sum: number, entry: { price: number }) => sum + entry.price, 0);
  const totalPaid = ((job.customer as { payments?: { amount: number }[] }).payments ?? [])
    .reduce((sum: number, payment: { amount: number }) => sum + payment.amount, 0);
  return Math.max(0, Number((previousCompletedTotal - totalPaid).toFixed(2)));
}

function getOutstandingBalance(job: Job) {
  const previousCompletedTotal = (job.customer.jobs ?? [])
    .filter((entry) => entry.id !== job.id)
    .reduce((sum: number, entry: { price: number }) => sum + entry.price, 0);
  const totalPaid = ((job.customer as { payments?: { amount: number }[] }).payments ?? [])
    .reduce((sum: number, payment: { amount: number }) => sum + payment.amount, 0);
  return Math.max(0, Number((previousCompletedTotal + job.price - totalPaid).toFixed(2)));
}

function isJobSettled(job: Job) {
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

interface Props {
  day: Day;
  futureDays: FutureDay[];
  hidePrices?: boolean;
}

type PendingResolution = {
  jobId: number;
  action: "skip" | "move";
  targetDayId?: number;
};

export function DayView({ day, futureDays, hidePrices = false }: Props) {
  const [isPending, startTransition] = useTransition();
  const [completeDayOpen, setCompleteDayOpen] = useState(false);
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [nextRunInfo, setNextRunInfo] = useState<{ nextDue: Date | string; nextWorkDayId: number | null; areaName: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [resolutions, setResolutions] = useState<Record<number, PendingResolution>>({});
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [notesJob, setNotesJob] = useState<Job | null>(null);
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [routeOrder, setRouteOrder] = useState<number[] | null>(null);
  const [dayNotesEditing, setDayNotesEditing] = useState(false);
  const [dayNotesText, setDayNotesText] = useState(day.notes ?? "");
  const router = useRouter();

  // Drag-to-reorder state for pending jobs.
  const dragJobIdRef = useRef<number | null>(null);
  const [dragOverJobId, setDragOverJobId] = useState<number | null>(null);
  // Sort by optimiser route order when available, otherwise keep DB order.

  // Sort: use routeOrder (from optimiser) if set, otherwise use DB order (sorted by sortOrder, then name)
  const sortedJobs = routeOrder
    ? (routeOrder.map((id) => day.jobs.find((j) => j.id === id)).filter(Boolean) as typeof day.jobs)
    : day.jobs;

  const pendingJobs = sortedJobs.filter((j) => j.status === "PENDING");
  const doneJobs = sortedJobs.filter((j) => j.status === "COMPLETE");
  const otherJobs = sortedJobs.filter(
    (j) => j.status !== "PENDING" && j.status !== "COMPLETE"
  );

  const totalValue = day.jobs.reduce((s, j) => s + j.price, 0);
  const doneValue = doneJobs.reduce((s, j) => s + j.price, 0);

  const handleJobDrop = (targetJobId: number) => {
    const dragId = dragJobIdRef.current;
    if (!dragId || dragId === targetJobId) {
      dragJobIdRef.current = null;
      setDragOverJobId(null);
      return;
    }
    const allIds = sortedJobs.map((j) => j.id);
    const from = allIds.indexOf(dragId);
    const to = allIds.indexOf(targetJobId);
    if (from === -1 || to === -1) return;
    const newOrder = [...allIds];
    newOrder.splice(from, 1);
    newOrder.splice(to, 0, dragId);
    setRouteOrder(newOrder);
    dragJobIdRef.current = null;
    setDragOverJobId(null);
    startTransition(async () => {
      await reorderDayJobs(day.id, newOrder);
    });
  };

  const handleJobTap = (job: Job) => {
    setSelectedJob(job);
  };

  const handleSaveDayNotes = () => {
    startTransition(async () => {
      await updateWorkDayNotes(day.id, dayNotesText);
      setDayNotesEditing(false);
      router.refresh();
    });
  };

  const handleStartDay = () => {
    startTransition(async () => {
      await startDay(day.id);
      router.refresh();
    });
  };

  const handleReopenDay = () => {
    startTransition(async () => {
      await reopenDay(day.id);
      router.refresh();
    });
  };

  const handleCompleteDay = () => {
    if (pendingJobs.length > 0) {
      // Initialise all pending jobs with default resolution
      const init: Record<number, PendingResolution> = {};
      pendingJobs.forEach((j) => {
        init[j.id] = { jobId: j.id, action: "skip" };
      });
      setResolutions(init);
      setCompleteDayOpen(true);
    } else {
      startTransition(async () => {
        const result = await completeDay(day.id, []);
        if (result) setNextRunInfo(result);
        router.refresh();
      });
    }
  };

  const handleResolutionChange = (
    jobId: number,
    action: PendingResolution["action"],
    targetDayId?: number
  ) => {
    setResolutions((prev) => ({ ...prev, [jobId]: { jobId, action, targetDayId } }));
  };

  const handleConfirmCompleteDay = () => {
    const res = Object.values(resolutions);
    startTransition(async () => {
      const result = await completeDay(day.id, res);
      if (result) setNextRunInfo(result);
      setCompleteDayOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="max-w-lg mx-auto">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-white border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link href="/days" className="p-1 rounded-lg hover:bg-slate-100 text-slate-500">
            <ChevronLeft size={20} />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-slate-800 truncate">{fmtDate(day.date)}</h1>
            <p className="text-xs text-slate-500">
              {day.area?.name ?? day.jobs[0]?.customer?.address?.split(",")[0] ?? "One-off"}{!hidePrices && ` - ${fmtCurrency(totalValue)}`}
            </p>
          </div>
          <Badge
            variant={
              day.status === "COMPLETE" ? "success" :
              day.status === "IN_PROGRESS" ? "info" : "muted"
            }
          >
            {day.status === "COMPLETE" ? "Done" : day.status === "IN_PROGRESS" ? "Active" : "Planned"}
          </Badge>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-slate-100">
          <div
            className="h-full bg-green-500 transition-all duration-500"
            style={{ width: `${day.jobs.length > 0 ? (doneJobs.length / day.jobs.length) * 100 : 0}%` }}
          />
        </div>

        {/* Day progress summary ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â clear stat blocks */}
        <div className="grid grid-cols-4 divide-x divide-slate-200 bg-slate-50 border-b border-slate-100">
          <div className="flex flex-col items-center py-2 px-1">
            <span className="text-base font-bold text-green-700 leading-tight">{doneJobs.length}</span>
            <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide mt-0.5">Done</span>
          </div>
          <div className="flex flex-col items-center py-2 px-1">
            <span className="text-base font-bold text-slate-700 leading-tight">{pendingJobs.length}</span>
            <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide mt-0.5">Pending</span>
          </div>
          <div className="flex flex-col items-center py-2 px-1">
            <span className="text-base font-bold text-slate-700 leading-tight">{day.jobs.length}</span>
            <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide mt-0.5">Total</span>
          </div>
          <div className="flex flex-col items-center py-2 px-1">
            <span className="text-base font-bold text-blue-700 leading-tight tabular-nums">{hidePrices ? "ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ" : fmtCurrency(doneValue)}</span>
            <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide mt-0.5">Earned</span>
          </div>
        </div>

        {/* Day Notes Banner */}
        {(day.notes || dayNotesEditing) && (
          <div className="flex items-start gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-200">
            <StickyNote size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            {dayNotesEditing ? (
              <div className="flex-1 flex items-end gap-2">
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
                  <button onClick={() => { setDayNotesEditing(false); setDayNotesText(day.notes ?? ""); }}
                    className="px-2 py-1 text-[11px] text-slate-500 hover:text-slate-700">Cancel</button>
                </div>
              </div>
            ) : (
              <p className="flex-1 text-xs text-amber-800 whitespace-pre-wrap">{day.notes}</p>
            )}
            {!dayNotesEditing && (
              <button onClick={() => setDayNotesEditing(true)} className="flex-shrink-0 p-1 hover:bg-amber-100 rounded">
                <Pencil size={12} className="text-amber-600" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Action buttons */}
        {day.status === "COMPLETE" ? (
          <div className="space-y-2">
            {nextRunInfo && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-green-50 border border-green-200">
                <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-green-800">Day complete!</p>
                  <p className="text-xs text-green-700">
                    Next {nextRunInfo.areaName} run:{" "}
                    <strong>{new Date(nextRunInfo.nextDue).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</strong>
                  </p>
                </div>
                {nextRunInfo.nextWorkDayId && (
                  <Link
                    href={`/days/${nextRunInfo.nextWorkDayId}`}
                    className="flex-shrink-0 text-xs font-semibold text-green-700 hover:text-green-900 hover:underline"
                  >
                    View ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢
                  </Link>
                )}
              </div>
            )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleReopenDay}
              disabled={isPending}
              className="flex-1"
              size="lg"
            >
              <RotateCcw size={16} />
              Reopen Day
            </Button>
            <Button
              variant="outline"
              onClick={() => setRouteModalOpen(true)}
              size="lg"
              className="flex-shrink-0"
            >
              <Navigation2 size={16} />
              Route
            </Button>
          </div>
          </div>
        ) : (
          <div className="flex gap-2">
            {day.status === "PLANNED" && (
              <Button onClick={handleStartDay} disabled={isPending} className="flex-1" size="lg">
                <Play size={16} />
                Start Area
              </Button>
            )}
            {day.status === "IN_PROGRESS" && (
              <Button
                onClick={handleCompleteDay}
                disabled={isPending}
                className="flex-1"
                size="lg"
                variant="secondary"
              >
                <CheckSquare size={16} />
                Complete Day
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setRouteModalOpen(true)}
              size="lg"
              className="flex-shrink-0"
            >
              <Navigation2 size={16} />
            </Button>
            <Button
              variant="outline"
              onClick={() => setAddJobOpen(true)}
              size="lg"
              className="flex-shrink-0"
            >
              <Plus size={16} />
              Add Job
            </Button>
          </div>
        )}

        {/* Day notes add prompt (when no notes exist and not editing) */}
        {!day.notes && !dayNotesEditing && (
          <button
            onClick={() => setDayNotesEditing(true)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-600 transition-colors group"
          >
            <StickyNote size={13} className="group-hover:text-amber-500" />
            Add day notes...
          </button>
        )}

        {/* Route active indicator */}
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
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 px-1">
              Pending ({pendingJobs.length})
            </h2>
            <div className="space-y-2">
              {pendingJobs.map((job) => (
                <div
                  key={job.id}
                  draggable
                  onDragStart={() => { dragJobIdRef.current = job.id; }}
                  onDragEnd={() => { dragJobIdRef.current = null; setDragOverJobId(null); }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverJobId(job.id); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverJobId(null); }}
                  onDrop={(e) => { e.preventDefault(); handleJobDrop(job.id); }}
                  className={cn(
                    "rounded-xl transition-all",
                    dragOverJobId === job.id && dragJobIdRef.current !== job.id && "ring-2 ring-blue-400 ring-offset-1"
                  )}
                >
                  <JobCard
                    job={job}
                    onToggle={() => handleJobTap(job)}
                    isPending={isPending}
                    onNotesClick={() => setNotesJob(job)}
                    hidePrices={hidePrices}
                    onQuickComplete={() =>
                      startTransition(async () => {
                        await completeJob(job.id);
                        router.refresh();
                      })
                    }
                    onQuickPay={(includeDebt: boolean) =>
                      startTransition(async () => {
                        const previousDebt = getPreviousDebt(job);
                        await completeJob(job.id);
                        await logPayment({
                          customerId: job.customerId,
                          jobId: job.id,
                          amount: job.price,
                          method: "CASH",
                        });
                        if (includeDebt && previousDebt > 0) {
                          await logPayment({
                            customerId: job.customerId,
                            amount: previousDebt,
                            method: "CASH",
                            notes: "Previous balance collected on day run",
                          });
                        }
                        router.refresh();
                      })
                    }
                  />
                </div>
              ))}
            </div>
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
                <JobCard key={job.id} job={job} onToggle={() => handleJobTap(job)} isPending={isPending}
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
                <JobCard key={job.id} job={job} onToggle={() => handleJobTap(job)} isPending={isPending}
                  onNotesClick={() => setNotesJob(job)} hidePrices={hidePrices} />
              ))}
            </div>
          </section>
        )}

        {day.jobs.length === 0 && (
          <Card className="border-dashed border-slate-300">
            <CardContent className="py-8 text-center text-slate-500">
              <p className="text-sm">No jobs on this day yet.</p>
              <button
                onClick={() => setAddJobOpen(true)}
                className="text-blue-600 text-sm hover:underline mt-1"
              >
                Add your first job ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢
              </button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Customer Notes Modal ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */}
      <CustomerNotesModal job={notesJob} onClose={() => setNotesJob(null)} hidePrices={hidePrices} />

      {/* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Route Optimiser Modal ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */}
      <RouteOptimiserModal
        jobs={sortedJobs}
        open={routeModalOpen}
        onClose={() => setRouteModalOpen(false)}
        onApply={(ids) => { setRouteOrder(ids); setRouteModalOpen(false); }}
      />

      {/* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Complete Day Modal ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */}
      <Modal
        open={completeDayOpen}
        onClose={() => setCompleteDayOpen(false)}
        title="Complete Day ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ Resolve Pending Jobs"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {pendingJobs.length} job{pendingJobs.length !== 1 ? "s" : ""} still pending. Choose what to do with each:
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => {
                const init: Record<number, PendingResolution> = {};
                pendingJobs.forEach((j) => { init[j.id] = { jobId: j.id, action: "skip" }; });
                setResolutions(init);
              }}
              className="flex-1 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:bg-slate-50 transition-colors"
            >
              Skip all
            </button>

          </div>

          <div className="space-y-3">
            {pendingJobs.map((job) => {
              const res = resolutions[job.id] ?? { action: "skip" };
              return (
                <div key={job.id} className="border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{job.customer.name}</p>
                      <p className="text-xs font-medium text-blue-700">{getJobTitle(job)}</p>
                      <p className="text-xs text-slate-500">{job.customer.address}{!hidePrices && ` ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${fmtCurrency(job.price)}`}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => handleResolutionChange(job.id, "skip")}
                      className={cn(
                        "flex flex-col items-center gap-1 p-2 rounded-lg border text-xs font-medium transition-colors",
                        res.action === "skip"
                          ? "border-slate-600 bg-slate-600 text-white"
                          : "border-slate-200 text-slate-600 hover:border-slate-400"
                      )}
                    >
                      <SkipForward size={14} />
                      Skip
                    </button>
                    <button
                      onClick={() => handleResolutionChange(job.id, "move")}
                      className={cn(
                        "flex flex-col items-center gap-1 p-2 rounded-lg border text-xs font-medium transition-colors",
                        res.action === "move"
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-200 text-slate-600 hover:border-blue-300"
                      )}
                    >
                      <ArrowRight size={14} />
                      Move
                    </button>
                  </div>

                  {res.action === "move" && (
                    <select
                      value={res.targetDayId ?? ""}
                      onChange={(e) =>
                        handleResolutionChange(job.id, "move", Number(e.target.value))
                      }
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ Select a day ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ</option>
                      {futureDays.map((d) => (
                        <option key={d.id} value={d.id}>
                          {fmtDate(d.date)} ({d.area?.name ?? d.jobs[0]?.customer?.address?.split(",")[0] ?? "One-off"})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleConfirmCompleteDay}
              disabled={
                isPending ||
                Object.values(resolutions).some(
                  (r) => r.action === "move" && !r.targetDayId
                )
              }
              className="flex-1"
            >
              {isPending ? "Completing..." : "Confirm & Complete Day"}
            </Button>
            <Button variant="outline" onClick={() => setCompleteDayOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Job Action Modal ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */}
      <JobActionModal
        job={selectedJob}
        onClose={() => setSelectedJob(null)}
        onDone={(price, note) => {
          if (!selectedJob) return;
          startTransition(async () => {
            if (note.trim()) await updateJobNotes(selectedJob.id, note.trim());
            if (price !== selectedJob.price) await updateJobPrice(selectedJob.id, price);
            await completeJob(selectedJob.id);
            setSelectedJob(null);
            router.refresh();
          });
        }}
        onUndo={() => {
          if (!selectedJob) return;
          startTransition(async () => {
            await uncompleteJob(selectedJob.id);
            setSelectedJob(null);
            router.refresh();
          });
        }}
        onSkip={(price, note) => {
          if (!selectedJob) return;
          startTransition(async () => {
            if (note.trim()) await updateJobNotes(selectedJob.id, note.trim());
            if (price !== selectedJob.price) await updateJobPrice(selectedJob.id, price);
            await skipJob(selectedJob.id);
            setSelectedJob(null);
            router.refresh();
          });
        }}

        onDoneAndPaid={async (visitPrice, jobAmount, extraDebtAmount, method, notes) => {
          if (!selectedJob) return;
          startTransition(async () => {
            if (notes?.trim()) await updateJobNotes(selectedJob.id, notes.trim());
            if (visitPrice !== selectedJob.price) await updateJobPrice(selectedJob.id, visitPrice);
            await completeJob(selectedJob.id);
            if (jobAmount > 0) {
              await logPayment({
                customerId: selectedJob.customerId,
                jobId: selectedJob.id,
                amount: jobAmount,
                method,
                notes,
              });
            }
            if (extraDebtAmount > 0) {
              await logPayment({
                customerId: selectedJob.customerId,
                amount: extraDebtAmount,
                method,
                notes: notes ? `${notes} ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· previous balance` : "Previous balance collected on day run",
              });
            }
            setSelectedJob(null);
            router.refresh();
          });
        }}
        onMarkPaid={(jobAmount, extraDebtAmount, method, notes) => {
          if (!selectedJob) return;
          startTransition(async () => {
            if (jobAmount > 0) {
              await markJobPaid({
                jobId: selectedJob.id,
                customerId: selectedJob.customerId,
                workDayId: day.id,
                amount: jobAmount,
                method,
                notes,
              });
            }
            if (extraDebtAmount > 0) {
              await logPayment({
                customerId: selectedJob.customerId,
                amount: extraDebtAmount,
                method,
                notes: notes ? `${notes} ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· previous balance` : "Previous balance collected on day run",
              });
            }
            setSelectedJob(null);
            router.refresh();
          });
        }}
        isPending={isPending}
        hidePrices={hidePrices}
      />

      {/* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Add Job Modal ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */}
      <AddJobModal
        open={addJobOpen}
        onClose={() => setAddJobOpen(false)}
        workDayId={day.id}
        currentAreaId={day.areaId ?? undefined}
        existingCustomerIds={day.jobs.map((j) => j.customerId)}
        hidePrices={hidePrices}
      />
    </div>
  );
}

// ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Job Action Modal ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬

function JobActionModal({
  job,
  onClose,
  onDone,
  onDoneAndPaid,
  onMarkPaid,
  onUndo,
  onSkip,
  isPending,
  hidePrices = false,
}: {
  job: Job | null;
  onClose: () => void;
  onDone: (price: number, note: string) => void;
  onDoneAndPaid: (visitPrice: number, jobAmount: number, extraDebtAmount: number, method: "CASH" | "BACS" | "CARD", notes?: string) => void;
  onMarkPaid: (jobAmount: number, extraDebtAmount: number, method: "CASH" | "BACS" | "CARD", notes?: string) => void;
  onUndo: () => void;
  onSkip: (price: number, note: string) => void;
  isPending: boolean;
  hidePrices?: boolean;
}) {
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"CASH" | "BACS" | "CARD">("CASH");
  const [payNotes, setPayNotes] = useState("");
  const [editingCompletedDate, setEditingCompletedDate] = useState(false);
  const [completedDateInput, setCompletedDateInput] = useState("");
  // Worker note + price override ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â visible for all pending jobs before choosing an action
  const [workerNote, setWorkerNote] = useState("");
  const [priceInput, setPriceInput] = useState("");

  // Reset the pay form whenever a different job is selected
  useEffect(() => {
    if (job) {
      setShowPayForm(false);
      setPayAmount(String(job.price));
      setPayNotes("");
      setPayMethod("CASH");
      setEditingCompletedDate(false);
      setCompletedDateInput(job.completedAt ? new Date(job.completedAt).toISOString().split("T")[0] : "");
      setWorkerNote(job.notes ?? "");
      setPriceInput(String(job.price));
    }
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = job !== null;
  const effectiveAmount = payAmount === "" ? 0 : parseFloat(payAmount);
  const currentVisitAmount = job ? (job.status === "PENDING" ? (parseFloat(priceInput) || job.price) : job.price) : 0;
  const previousDebt = job ? getPreviousDebt(job) : 0;
  const currentOutstanding = job ? getOutstandingBalance(job) : 0;
  const isSettled = job ? isJobSettled(job) : false;
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
            /* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Already complete: offer Pay + Undo + Edit Date ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */
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
                    setPayAmount(currentOutstanding.toFixed(2));
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
                  {previousDebt > 0 && (
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs font-semibold text-amber-800">
                      <AlertCircle size={13} className="flex-shrink-0 text-amber-500" />
                      {hidePrices ? "Previous balance outstanding" : `Previous balance: ${fmtCurrency(previousDebt)}`}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPayAmount(currentVisitAmount.toFixed(2))}
                      className="px-3 py-1.5 rounded-lg border border-blue-200 bg-white text-xs font-semibold text-blue-700 hover:border-blue-400"
                    >
                      {hidePrices ? "This clean" : `This clean - ${fmtCurrency(currentVisitAmount)}`}
                    </button>
                    {previousDebt > 0 && (
                      <button
                        type="button"
                        onClick={() => setPayAmount(cleanAndDebtAmount.toFixed(2))}
                        className="px-3 py-1.5 rounded-lg border border-amber-200 bg-white text-xs font-semibold text-amber-700 hover:border-amber-400"
                      >
                        {hidePrices ? "This clean + debt" : `This clean + debt - ${fmtCurrency(cleanAndDebtAmount)}`}
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 font-medium mb-1 block">Amount (GBP)</label>
                    <input
                      type="number" step="0.01" min="0"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">Use the quick buttons above or enter a custom amount.</p>
                  </div>
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
                    <Button disabled={isPending || isNaN(effectiveAmount) || effectiveAmount <= 0}
                      onClick={() => {
                        const split = splitCollectedAmount(effectiveAmount, currentVisitAmount);
                        onMarkPaid(split.currentJobAmount, split.extraDebtAmount, payMethod, payNotes || undefined);
                      }}
                      className="flex-1" size="sm">
                      {isPending ? "Saving..." : `Confirm - ${fmtCurrency(effectiveAmount)}`}
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
            /* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Skipped / Outstanding: offer re-open ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */
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
            /* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Pending: full action list ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */
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
                    setPayAmount((parseFloat(priceInput) || job.price).toFixed(2));
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
                  {previousDebt > 0 && (
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs font-semibold text-amber-800">
                      <AlertCircle size={13} className="flex-shrink-0 text-amber-500" />
                      {hidePrices ? "Previous balance outstanding" : `Previous balance: ${fmtCurrency(previousDebt)}`}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPayAmount(currentVisitAmount.toFixed(2))}
                      className="px-3 py-1.5 rounded-lg border border-blue-200 bg-white text-xs font-semibold text-blue-700 hover:border-blue-400"
                    >
                      {hidePrices ? "This clean" : `This clean - ${fmtCurrency(currentVisitAmount)}`}
                    </button>
                    {previousDebt > 0 && (
                      <button
                        type="button"
                        onClick={() => setPayAmount(cleanAndDebtAmount.toFixed(2))}
                        className="px-3 py-1.5 rounded-lg border border-amber-200 bg-white text-xs font-semibold text-amber-700 hover:border-amber-400"
                      >
                        {hidePrices ? "This clean + debt" : `This clean + debt - ${fmtCurrency(cleanAndDebtAmount)}`}
                      </button>
                    )}
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="text-xs text-slate-600 font-medium mb-1 block">Amount (GBP)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      placeholder={String(job.price)}
                    />
                    <p className="text-[11px] text-slate-400 mt-1">Use "This clean" or "This clean + debt", or type a custom amount.</p>
                  </div>

                  {/* Method */}
                  <div>
                    <label className="text-xs text-slate-600 font-medium mb-1 block">Method</label>
                    <div className="flex gap-2">
                      {(["CASH", "BACS", "CARD"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPayMethod(m)}
                          className={cn(
                            "flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors",
                            payMethod === m
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-slate-200 text-slate-600 hover:border-blue-300"
                          )}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-xs text-slate-600 font-medium mb-1 block">Notes <span className="font-normal text-slate-400">(optional)</span></label>
                    <input
                      type="text"
                      value={payNotes}
                      onChange={(e) => setPayNotes(e.target.value)}
                      placeholder="e.g. fronts only, window 3 broken..."
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      disabled={isPending || isNaN(effectiveAmount) || effectiveAmount <= 0}
                      onClick={() => {
                        const split = splitCollectedAmount(effectiveAmount, currentVisitAmount);
                        onDoneAndPaid(currentVisitAmount, split.currentJobAmount, split.extraDebtAmount, payMethod, payNotes || undefined);
                      }}
                      className="flex-1"
                      size="sm"
                    >
                      {isPending ? "Saving..." : hidePrices ? "Confirm" : `Confirm - ${fmtCurrency(effectiveAmount)}`}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowPayForm(false)}
                    >
                      Back
                    </Button>
                  </div>
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

// ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Route optimiser helpers + modal ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬

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
      const c = await geocodeAddress(jobs[i].customer?.address ?? "");
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
                <option key={j.id} value={j.id}>{j.customer?.name} ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ {j.customer?.address}</option>
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
              {loading ? "OptimisingÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦" : "Optimise Route"}
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
  hidePrices = false,
}: {
  job: Job;
  onToggle: () => void;
  isPending: boolean;
  onNotesClick?: () => void;
  onQuickComplete?: () => void;
  onQuickPay?: (includeDebt: boolean) => void;
  hidePrices?: boolean;
}) {
  const isDone = job.status === "COMPLETE";
  const isClickable = true; // All statuses are actionable via the modal
  const [showQuickPayChoices, setShowQuickPayChoices] = useState(false);
  const previousDebt = getPreviousDebt(job);

  return (
    <div
      className={cn(
        "rounded-xl border transition-all overflow-hidden",
        isDone
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
      {/* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Card body ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â tap to open modal ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */}
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
          <p className={cn("text-sm font-semibold truncate", isDone ? "text-green-800" : "text-slate-800")}>
            {job.customer.name}
          </p>
          <p className={cn("text-xs font-medium truncate mt-0.5", isDone ? "text-blue-700" : "text-blue-600")}>
            {getJobTitle(job)}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className={cn("text-xs truncate", isDone ? "text-green-600" : "text-slate-500")}>
              {job.customer.address}
            </p>
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(job.customer.address)}`}
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
              className="flex items-center gap-1 mt-1 px-2 py-0.5 bg-amber-100 border border-amber-300 rounded-full text-[11px] font-semibold text-amber-800 hover:bg-amber-200 active:scale-95 transition-all"
            >
              <StickyNote size={10} />
              Notes
            </button>
          )}
        </div>

        {/* Price + badges */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={cn("text-sm font-bold", isDone ? "text-green-700" : "text-slate-700")}>
            {hidePrices ? null : fmtCurrency(job.price)}
          </span>
          {(() => {
            const prevBilled = (job.customer.jobs ?? []).filter(j => j.id !== job.id).reduce((s: number, j: { price: number }) => s + j.price, 0);
            const totalPaid = ((job.customer as { payments?: { amount: number }[] }).payments ?? []).reduce((s: number, p: { amount: number }) => s + p.amount, 0);
            const debt = Math.max(0, prevBilled - totalPaid);
            return debt > 0 ? (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">
                owes {fmtCurrency(debt)}
              </span>
            ) : null;
          })()}
          {job.isOneOff && (
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
          {job.status === "COMPLETE" && (() => {
            const totalPaid = (job.payments ?? []).reduce((s: number, p: { amount: number }) => s + p.amount, 0);
            return totalPaid >= job.price - 0.005 ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-300">
                <Check size={10} />
                Paid
              </span>
            ) : null;
          })()}
        </div>
      </div>

      {/* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Action buttons ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â only for actionable statuses ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */}
      {job.status === "PENDING" && (onQuickComplete || onQuickPay) && (
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
                  if (previousDebt > 0) setShowQuickPayChoices((prev) => !prev);
                  else onQuickPay(false);
                }}
                disabled={isPending}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 transition-colors disabled:opacity-50 touch-manipulation"
              >
                  <Banknote size={15} className="text-blue-600" />
                Done &amp; Paid
              </button>
            )}
          </div>
          {onQuickPay && showQuickPayChoices && previousDebt > 0 && (
            <div className="border-t border-blue-100 bg-blue-50/70 p-2.5 space-y-2">
              <p className="text-[11px] font-medium text-blue-800">
                This customer also owes {fmtCurrency(previousDebt)} from previous visits.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowQuickPayChoices(false); onQuickPay(false); }}
                  disabled={isPending}
                  className="px-3 py-2 rounded-lg border border-blue-200 bg-white text-xs font-semibold text-blue-700 hover:border-blue-400 disabled:opacity-50"
                >
                  This clean only
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowQuickPayChoices(false); onQuickPay(true); }}
                  disabled={isPending}
                  className="px-3 py-2 rounded-lg border border-amber-200 bg-white text-xs font-semibold text-amber-700 hover:border-amber-400 disabled:opacity-50"
                >
                  Include debt too
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {job.status === "COMPLETE" && (() => {
        const totalPaid = (job.payments ?? []).reduce((s: number, p: { amount: number }) => s + p.amount, 0);
        return totalPaid < job.price - 0.005 ? (
          <div className="border-t border-amber-100">
            <button
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              disabled={isPending}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-50 active:bg-amber-100 transition-colors disabled:opacity-50 touch-manipulation"
            >
              <Banknote size={15} />
              Mark as Paid
            </button>
          </div>
        ) : null;
      })()}
    </div>
  );
}

// ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Add Job Modal ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬

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

  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ From-area tab ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
  const [areas, setAreas] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [areaCustomers, setAreaCustomers] = useState<Array<{ id: number; name: string; address: string; price: number }>>([]);
  const [loadingAreaCustomers, setLoadingAreaCustomers] = useState(false);

  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ One-off tab ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
  const [oneOffMode, setOneOffMode] = useState<"search" | "new-customer">("search");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: number; name: string; address: string; price: number; area: { name: string } | null }>>([]);
  const [oneOffSelected, setOneOffSelected] = useState<{ id: number; name: string; address: string; price: number } | null>(null);
  const [oneOffJobName, setOneOffJobName] = useState("Window Cleaning");
  const [oneOffCustomPrice, setOneOffCustomPrice] = useState("");
  const [oneOffNotes, setOneOffNotes] = useState("");

  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ New-customer tab ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newJobName, setNewJobName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newAreaId, setNewAreaId] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ One-off new-customer fields ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬
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
            OneÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“Off
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

        {/* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ From Area tab ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */}
        {tab === "from-area" && (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Adds the customer as a <strong>one-off</strong> on this day and leaves a note on their next scheduled job.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Select area</label>
              <select
                value={selectedAreaId}
                onChange={(e) => handleAreaChange(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ Choose an area ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ</option>
                {areas
                  .filter((a) => a.id !== currentAreaId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
              </select>
            </div>

            {loadingAreaCustomers && (
              <p className="text-sm text-slate-500 text-center py-3">LoadingÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦</p>
            )}

            {areaCustomers.length > 0 && (
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                {areaCustomers.map((c) => {
                  const onDay = existingCustomerIds.includes(c.id);
                  return (
                    <li key={c.id} className={cn("flex items-center justify-between px-3 py-2.5", onDay && "opacity-50")}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                        <p className="text-xs text-slate-500 truncate">{c.address}{!hidePrices && ` ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${fmtCurrency(c.price)}`}</p>
                      </div>
                      {onDay ? (
                        <span className="text-xs text-slate-400 ml-2 flex-shrink-0">On day</span>
                      ) : (
                        <button
                          disabled={isPending}
                          onClick={() => handleAddFromArea(c.id)}
                          className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50 ml-2 flex-shrink-0"
                        >
                          Add one-off
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

        {/* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ One-Off tab ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */}
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
                        placeholder="Search by name or addressÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦"
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
                                <p className="text-xs text-slate-500">{c.address}{c.area ? ` ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${c.area.name}` : ""}</p>
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
                        placeholder="e.g. Window Cleaning, ConservatoryÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Price (ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£) <span className="text-slate-400 font-normal">ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â edit if different</span></label>
                      <input type="number" step="0.01" value={oneOffCustomPrice} onChange={(e) => setOneOffCustomPrice(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                      <input type="text" value={oneOffNotes} onChange={(e) => setOneOffNotes(e.target.value)}
                        placeholder="e.g. conservatory only, front onlyÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <Button onClick={handleAddOneOff} disabled={isPending || !oneOffJobName.trim()} className="w-full">
                      {isPending ? "AddingÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦" : "Add One-off Job"}
                    </Button>
                  </>
                )}
              </>
            )}

            {oneOffMode === "new-customer" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">
                  <span className="text-xs text-purple-700 font-medium">Creates a new customer with no recurring schedule ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â job history still viewable on their record. Optionally assign an area and frequency to add them to the regular schedule.</span>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Job Name</label>
                  <input type="text" value={newJobName} onChange={(e) => setNewJobName(e.target.value)}
                    placeholder="e.g. Window Cleaning, Conservatory CleanÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦"
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
                    <label className="block text-xs font-medium text-slate-700 mb-1">Price (ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£) *</label>
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
                    Area <span className="text-slate-400 font-normal">(optional ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â leave blank for one-off only)</span>
                  </label>
                  <select
                    value={newOneOffAreaId}
                    onChange={(e) => setNewOneOffAreaId(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ No area (one-off only) ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ</option>
                    {areas.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                {newOneOffAreaId && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Frequency</label>
                    <div className="flex gap-1.5">
                      {["1","2","4","6","8","12"].map((w) => (
                        <button key={w} type="button" onClick={() => setNewOneOffFrequency(w)}
                          className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                            newOneOffFrequency === w
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-slate-200 text-slate-600 hover:border-blue-300"
                          }`}>
                          {w}w
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                  <input type="text" value={newNotes} onChange={(e) => setNewNotes(e.target.value)}
                    placeholder="Dog in garden, ring bellÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <Button onClick={handleCreateOneOffCustomer} disabled={isPending || !newName.trim() || !newAddress.trim() || !newPrice} className="w-full">
                  {isPending ? "CreatingÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦" : (newOneOffAreaId ? "Create Customer & Add to Day" : "Create One-off & Add to Day")}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ New Customer tab ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ */}
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
                <label className="block text-xs font-medium text-slate-700 mb-1">Price (ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£) *</label>
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
                  <option value="">ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ Area ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ</option>
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
              {isPending ? "CreatingÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦" : "Create & Add to Day"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

