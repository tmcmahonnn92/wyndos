"use client";

import { useActionParam } from "@/lib/use-action-param";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OneOffJobModal } from "./one-off-job-modal";

interface Area {
  id: number;
  name: string;
}

interface Props {
  areas: Area[];
}

export function ScheduleHeader({ areas: _areas }: Props) {
  const { open: oneOffOpen, setOpen: setOneOffOpen, close: closeOneOff } = useActionParam("new-one-off");

  return (
    <div className="flex items-center justify-between">
      <h1 className="text-xl font-bold text-slate-800">Schedule</h1>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOneOffOpen(true)}>
          <Zap size={14} />
          One-off
        </Button>
      </div>

      <OneOffJobModal open={oneOffOpen} onClose={closeOneOff} />
    </div>
  );
}


