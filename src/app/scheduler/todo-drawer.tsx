"use client";

import { useState, type ReactNode } from "react";
import { ListTodo, X } from "lucide-react";

/**
 * The Scheduler To-Do sits beside the calendar on wide screens. On smaller screens it
 * folds away behind a button so the calendar gets the room.
 */
export function TodoDrawer({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="hidden 2xl:contents">{children}</div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="2xl:hidden fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-slate-800"
      >
        <ListTodo size={16} /> To-do
        {count > 0 && <span className="rounded-full bg-red-500 px-1.5 text-xs">{count}</span>}
      </button>
      {open && (
        <div className="2xl:hidden fixed inset-0 z-50 flex justify-end" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative flex h-full w-80 max-w-[90vw] flex-col bg-slate-50 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close to-do" className="absolute right-3 top-3 z-10 rounded-full p-1 text-slate-500 hover:bg-slate-200">
              <X size={16} />
            </button>
            <div className="flex-1 overflow-y-auto [&>aside]:block [&>aside]:border-0">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
