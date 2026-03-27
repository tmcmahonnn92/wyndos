"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, SkipForward } from "lucide-react";
import { completeJob, skipJob } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtDate, fmtCurrency } from "@/lib/utils";

type OutstandingJob = {
  id: number;
  price: number;
  customer: { id: number; name: string; address: string; area: { name: string } | null };
  workDay: { id: number; date: Date | string };
};

export function OutstandingList({ jobs }: { jobs: OutstandingJob[] }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleComplete = (jobId: number) => {
    startTransition(async () => {
      await completeJob(jobId);
      router.refresh();
    });
  };

  const handleSkip = (jobId: number) => {
    startTransition(async () => {
      await skipJob(jobId);
      router.refresh();
    });
  };

  if (jobs.length === 0) {
    return (
      <div className="text-center py-16">
        <CheckCircle2 size={40} className="text-green-400 mx-auto mb-3" />
        <p className="text-lg font-semibold text-slate-700">{"All clear!"}</p>
        <p className="text-sm text-slate-500 mt-1">No outstanding jobs.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => (
        <div key={job.id} className="bg-white border border-red-200 rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <Link href={`/customers/${job.customer.id}`}
                className="text-sm font-semibold text-slate-800 hover:text-blue-600 hover:underline truncate block">
                {job.customer.name}
              </Link>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{job.customer.address}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Original day: <Link href={`/days/${job.workDay.id}`} className="text-blue-600 hover:underline">{fmtDate(job.workDay.date)}</Link>
                {job.customer.area && ` · ${job.customer.area.name}`}
              </p>
            </div>
            <span className="text-sm font-bold text-slate-700 flex-shrink-0">{fmtCurrency(job.price)}</span>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => handleComplete(job.id)}
              disabled={isPending}
              size="sm"
              className="flex-1"
            >
              <CheckCircle2 size={14} />
              Mark Done
            </Button>
            <Button
              onClick={() => handleSkip(job.id)}
              disabled={isPending}
              variant="outline"
              size="sm"
              className="flex-1"
            >
              <SkipForward size={14} />
              Skip
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
