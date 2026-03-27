"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, CalendarDays } from "lucide-react";
import { createWorkDay } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface Area {
  id: number;
  name: string;
}

export function AddDayForm({ areas }: { areas: Area[] }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [areaId, setAreaId] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = () => {
    startTransition(async () => {
      await createWorkDay(new Date(date), areaId ? Number(areaId) : undefined);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus size={15} />
        Add Day
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Add Work Day">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Area</label>
            <select
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">– No area –</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={handleSubmit} disabled={isPending} className="flex-1">
              {isPending ? "Adding..." : "Add Day"}
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
