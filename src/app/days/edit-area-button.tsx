"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { updateArea } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface Area {
  id: number;
  name: string;
  color: string;
  scheduleType: string;
  frequencyWeeks: number;
  monthlyDay: number | null;
  nextDueDate: Date | string | null;
}

const ORDINAL = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

export function EditAreaButton({ area }: { area: Area }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(area.name);
  const [color, setColor] = useState(area.color ?? "#3B82F6");
  const [scheduleType, setScheduleType] = useState<"WEEKLY" | "MONTHLY">(
    area.scheduleType === "MONTHLY" ? "MONTHLY" : "WEEKLY"
  );
  const [frequencyWeeks, setFrequencyWeeks] = useState(String(area.frequencyWeeks ?? 4));
  const [monthlyDay, setMonthlyDay] = useState(String(area.monthlyDay ?? 1));
  const [nextDueDate, setNextDueDate] = useState(() => {
    if (!area.nextDueDate) return "";
    return new Date(area.nextDueDate).toISOString().slice(0, 10);
  });
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleOpen = () => {
    setName(area.name);
    setColor(area.color ?? "#3B82F6");
    setScheduleType(area.scheduleType === "MONTHLY" ? "MONTHLY" : "WEEKLY");
    setFrequencyWeeks(String(area.frequencyWeeks ?? 4));
    setMonthlyDay(String(area.monthlyDay ?? 1));
    setNextDueDate(area.nextDueDate ? new Date(area.nextDueDate).toISOString().slice(0, 10) : "");
    setOpen(true);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    startTransition(async () => {
      await updateArea(area.id, {
        name: name.trim(),
        color,
        scheduleType,
        frequencyWeeks: scheduleType === "WEEKLY" ? (Number(frequencyWeeks) || 4) : 4,
        monthlyDay: scheduleType === "MONTHLY" ? (Number(monthlyDay) || 1) : null,
        nextDueDate: nextDueDate ? new Date(nextDueDate) : null,
      });
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0"
        title="Edit area"
      >
        <Pencil size={14} />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={`Edit Area — ${area.name}`}>
        <div className="space-y-4">
          {/* Name + Colour */}
          <div className="flex gap-3 items-start">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-1">Area name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Colour</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-slate-200 p-1 cursor-pointer"
                title="Pick area colour"
              />
            </div>
          </div>

          {/* Schedule type toggle */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Schedule type</label>
            <div className="flex gap-2">
              {(["WEEKLY", "MONTHLY"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setScheduleType(t)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                    scheduleType === t
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 text-slate-600 hover:border-blue-300"
                  }`}
                >
                  {t === "WEEKLY" ? "Weekly interval" : "Monthly (set date)"}
                </button>
              ))}
            </div>
          </div>

          {/* Weekly: interval picker */}
          {scheduleType === "WEEKLY" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Repeat every</label>
              <div className="flex gap-2">
                {["1", "2", "4", "6", "8", "12"].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setFrequencyWeeks(w)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                      frequencyWeeks === w
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 text-slate-600 hover:border-blue-300"
                    }`}
                  >
                    {w}w
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Monthly: day of month picker */}
          {scheduleType === "MONTHLY" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Day of month</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={monthlyDay}
                  onChange={(e) => setMonthlyDay(e.target.value)}
                  className="w-24 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-semibold text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-sm text-slate-500">
                  {ORDINAL(Number(monthlyDay) || 1)} of every month
                </p>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Use 1–28 to avoid end-of-month issues.</p>
            </div>
          )}

          {/* Next due date */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Next due date</label>
            <input
              type="date"
              value={nextDueDate}
              onChange={(e) => setNextDueDate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Changing this will not move any already-scheduled work day.
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={handleSave} disabled={isPending || !name.trim()} className="flex-1">
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
