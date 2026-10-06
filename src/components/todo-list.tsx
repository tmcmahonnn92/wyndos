"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { dismissTodo, type TodoItem } from "@/lib/todo-actions";

const TONES: Record<TodoItem["tone"], string> = {
  red: "bg-red-500",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  green: "bg-green-500",
};

/** The to-do rows, each with its action and a "Done" tick that hides it until it changes. */
export function TodoList({ items }: { items: TodoItem[] }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [, start] = useTransition();
  const shown = items.filter((i) => !hidden.has(i.key));

  if (shown.length === 0) {
    return <p className="px-4 py-4 text-sm text-slate-500">All done. Nice one.</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {shown.map((item) => (
        <li key={item.key} className="flex items-center gap-2 pr-2">
          <Link href={item.href} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${TONES[item.tone]}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{item.title}</p>
              <p className="truncate text-xs text-slate-500">{item.detail}</p>
            </div>
            <span className="flex-shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
              {item.action}
            </span>
          </Link>
          <button
            type="button"
            title="Mark as done"
            aria-label={`Mark "${item.title}" as done`}
            onClick={() => {
              setHidden((h) => new Set(h).add(item.key));
              start(async () => {
                try { await dismissTodo(item.key, item.detail); router.refresh(); } catch { setHidden((h) => { const n = new Set(h); n.delete(item.key); return n; }); }
              });
            }}
            className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:border-green-300 hover:bg-green-50 hover:text-green-700"
          >
            <Check size={13} /> Done
          </button>
        </li>
      ))}
    </ul>
  );
}
