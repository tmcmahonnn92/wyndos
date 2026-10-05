"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { PlannedArea, PlannerAnswers } from "@/lib/area-planner";
import { cn, fmtCurrency } from "@/lib/utils";

const DAYS: Array<[number, string]> = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];
const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

export type QuestionState = {
  workDays: number[];
  limitBy: "customers" | "value";
  limit: string;
  daysEarly: string;
  notes: string;
};

export const emptyQuestions: QuestionState = { workDays: [], limitBy: "customers", limit: "", daysEarly: "", notes: "" };

export function toAnswers(q: QuestionState): PlannerAnswers {
  return {
    workDays: q.workDays,
    customersPerDay: q.limitBy === "customers" && Number(q.limit) > 0 ? Number(q.limit) : null,
    valuePerDay: q.limitBy === "value" && Number(q.limit) > 0 ? Number(q.limit) : null,
    daysEarly: q.daysEarly.trim() === "" ? null : Math.max(0, Number(q.daysEarly) || 0),
    notes: q.notes,
  };
}

/** The guided questions. Every one can be skipped. */
export function PlannerQuestions({ value, onChange }: { value: QuestionState; onChange: (next: QuestionState) => void }) {
  const set = (patch: Partial<QuestionState>) => onChange({ ...value, ...patch });
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">Answer what you like. Skip anything you&apos;re not sure about.</p>
      <div>
        <p className="mb-1.5 text-sm font-semibold text-slate-800">Which days do you normally work?</p>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map(([d, label]) => (
            <button key={d} type="button" onClick={() => set({ workDays: value.workDays.includes(d) ? value.workDays.filter((x) => x !== d) : [...value.workDays, d] })}
              className={cn("rounded-lg border px-3 py-1.5 text-sm font-semibold", value.workDays.includes(d) ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600")}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-semibold text-slate-800">How much do you do in a normal day?</p>
        <div className="flex gap-2">
          <select value={value.limitBy} onChange={(e) => set({ limitBy: e.target.value as "customers" | "value" })} className="rounded-lg border border-slate-200 bg-white px-2 text-sm">
            <option value="customers">Customers</option>
            <option value="value">£ of work</option>
          </select>
          <input type="number" inputMode="numeric" min={1} value={value.limit} onChange={(e) => set({ limit: e.target.value })} placeholder={value.limitBy === "customers" ? "e.g. 35" : "e.g. 400"} className={inputClass} />
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-semibold text-slate-800">How many days early can you clean someone before they&apos;re due?</p>
        <input type="number" inputMode="numeric" min={0} max={90} value={value.daysEarly} onChange={(e) => set({ daysEarly: e.target.value })} placeholder="e.g. 7" className={cn(inputClass, "max-w-[10rem]")} />
        <p className="mt-1 text-xs text-slate-500">Lets nearby customers due a bit later go on the same day.</p>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-semibold text-slate-800">Anything else? <span className="font-normal text-slate-400">(optional)</span></p>
        <textarea value={value.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} maxLength={1000} placeholder="e.g. Keep Cuckney and Norton together. I never do the town centre on Saturdays." className={cn(inputClass, "resize-none")} />
      </div>
    </section>
  );
}

export type ReviewCustomer = { id: number; label: string; postcode: string; price: number; nextDue: string | null };

/** Check a plan: rename areas, move customers between them. */
export function AreaPlanReview({ plan, customers, onChange }: {
  plan: PlannedArea[];
  customers: Map<number, ReviewCustomer>;
  onChange: (next: PlannedArea[]) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const rename = (key: string, name: string) => onChange(plan.map((a) => (a.key === key ? { ...a, name } : a)));
  const move = (id: number, toKey: string) =>
    onChange(plan.map((a) => ({
      ...a,
      customerIds: a.key === toKey ? [...a.customerIds.filter((x) => x !== id), id] : a.customerIds.filter((x) => x !== id),
    })).filter((a) => a.customerIds.length > 0));

  return (
    <div className="space-y-3">
      {plan.map((a) => {
        const value = a.customerIds.reduce((s, id) => s + (customers.get(id)?.price ?? 0), 0);
        const dues = a.customerIds.map((id) => customers.get(id)?.nextDue).filter((d): d is string => Boolean(d)).sort();
        return (
          <div key={a.key} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 px-4 py-3">
              <input value={a.name} onChange={(e) => rename(a.key, e.target.value)} aria-label="Area name"
                className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1 text-[15px] font-semibold text-slate-800 hover:border-slate-200 focus:border-blue-400 focus:outline-none" />
              <button type="button" onClick={() => setOpen(open === a.key ? null : a.key)} className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                {a.customerIds.length} · {fmtCurrency(value)} {open === a.key ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
            <p className="px-4 pb-2 -mt-1 text-xs text-slate-500">
              {[a.day !== null ? `Best on ${DAY_NAME[a.day]}` : "", dues[0] ? `first due ${new Date(dues[0] + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "", a.why].filter(Boolean).join(" · ")}
            </p>
            {open === a.key && (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">
                {a.customerIds.map((id) => {
                  const c = customers.get(id);
                  return (
                    <li key={id} className="flex items-center gap-2 px-4 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-700">{c?.label}<span className="text-slate-400"> {c?.postcode}</span></span>
                      <select value={a.key} onChange={(e) => move(id, e.target.value)} aria-label="Move to area" className="max-w-[40%] rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs">
                        {plan.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                      </select>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
