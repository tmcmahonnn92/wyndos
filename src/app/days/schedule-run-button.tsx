"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, ChevronDown, X } from "lucide-react";
import { scheduleAreaRun } from "@/lib/actions";
import { Button } from "@/components/ui/button";

interface Area {
  id: number;
  name: string;
  frequencyWeeks: number;
  nextDueDate: Date | string | null;
}

export function ScheduleRunButton({ area }: { area: Area }) {
  const [expanded, setExpanded] = useState(false);
  const [date, setDate] = useState(() => {
    if (area.nextDueDate) {
      const d = new Date(area.nextDueDate);
      return d.toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  });
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSchedule = () => {
    startTransition(async () => {
      const workDay = await scheduleAreaRun(area.id, date);
      setExpanded(false);
      if (workDay) router.push(`/days/${workDay.id}`);
    });
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-300 transition-colors flex-shrink-0"
      >
        <CalendarCheck size={13} />
        Schedule Run
        <ChevronDown size={11} />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-32"
        autoFocus
      />
      <Button
        size="sm"
        onClick={handleSchedule}
        disabled={isPending || !date}
        className="text-xs px-3 py-1.5 h-auto"
      >
        {isPending ? "…" : "Go"}
      </Button>
      <button
        onClick={() => setExpanded(false)}
        className="p-1 text-slate-400 hover:text-slate-600"
      >
        <X size={14} />
      </button>
    </div>
  );
}
