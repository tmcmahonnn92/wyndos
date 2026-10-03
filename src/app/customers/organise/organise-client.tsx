"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Sparkles, Wand2 } from "lucide-react";
import { applyAreaPlan, planAreas, type PlannedArea } from "@/lib/area-planner";
import { cn, fmtCurrency } from "@/lib/utils";

type PlanCustomer = { id: number; label: string; postcode: string; price: number; nextDue: string | null; areaName: string };

const DAYS: Array<[number, string]> = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];
const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const inp = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

export function OrganiseClient({ aiAvailable }: { aiAvailable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [scope, setScope] = useState<"unsorted" | "all">("unsorted");
  const [workDays, setWorkDays] = useState<number[]>([]);
  const [limitBy, setLimitBy] = useState<"customers" | "value">("customers");
  const [limit, setLimit] = useState("");
  const [daysEarly, setDaysEarly] = useState("");
  const [notes, setNotes] = useState("");
  const [plan, setPlan] = useState<PlannedArea[] | null>(null);
  const [customers, setCustomers] = useState<PlanCustomer[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const answers = () => ({
    workDays,
    customersPerDay: limitBy === "customers" && Number(limit) > 0 ? Number(limit) : null,
    valuePerDay: limitBy === "value" && Number(limit) > 0 ? Number(limit) : null,
    daysEarly: daysEarly.trim() === "" ? null : Math.max(0, Number(daysEarly) || 0),
    notes,
  });

  const make = (useAi: boolean) => {
    setError("");
    setDone(null);
    start(async () => {
      try {
        const result = await planAreas({ scope, answers: answers(), useAi });
        setPlan(result.areas);
        setCustomers(result.customers);
        setOpen(null);
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Couldn't make a plan.");
      }
    });
  };

  const rename = (key: string, name: string) => setPlan((p) => p && p.map((a) => (a.key === key ? { ...a, name } : a)));
  const move = (customerId: number, toKey: string) =>
    setPlan((p) => p && p.map((a) => ({
      ...a,
      customerIds: a.key === toKey ? [...a.customerIds.filter((id) => id !== customerId), customerId] : a.customerIds.filter((id) => id !== customerId),
    })).filter((a) => a.customerIds.length > 0));

  const save = () => {
    if (!plan) return;
    setError("");
    start(async () => {
      try {
        const r = await applyAreaPlan({ areas: plan.map((a) => ({ name: a.name, customerIds: a.customerIds })), daysEarly: answers().daysEarly });
        setDone(`${r.moved} customers sorted into ${plan.length} areas${r.created ? ` (${r.created} new)` : ""}.`);
        setPlan(null);
        router.refresh();
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Couldn't save.");
      }
    });
  };

  if (done) {
    return (
      <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50 p-5">
        <p className="font-semibold text-green-900">{done}</p>
        <p className="text-sm text-green-800">Next, put the areas on days in the scheduler.</p>
        <div className="flex gap-2">
          <a href="/scheduler" className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white">Open scheduler</a>
          <a href="/areas" className="rounded-lg border border-green-300 px-4 py-2 text-sm font-semibold text-green-800">See areas</a>
        </div>
      </div>
    );
  }

  if (plan) {
    const totalValue = (a: PlannedArea) => a.customerIds.reduce((s, id) => s + (byId.get(id)?.price ?? 0), 0);
    return (
      <div className="space-y-3 pb-24">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <p className="text-sm text-slate-600">{plan.length} areas. Rename them, or open one to move a customer. Nothing is saved until you press Save.</p>
        {plan.map((a) => {
          const dues = a.customerIds.map((id) => byId.get(id)?.nextDue).filter((d): d is string => Boolean(d)).sort();
          return (
            <div key={a.key} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-3 px-4 py-3">
                <input value={a.name} onChange={(e) => rename(a.key, e.target.value)} className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1 text-[15px] font-semibold text-slate-800 hover:border-slate-200 focus:border-blue-400 focus:outline-none" />
                <button type="button" onClick={() => setOpen(open === a.key ? null : a.key)} className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                  {a.customerIds.length} · {fmtCurrency(totalValue(a))} {open === a.key ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
              <p className="px-4 pb-2 -mt-1 text-xs text-slate-500">
                {[a.day !== null ? `Best on ${DAY_NAME[a.day]}` : "", dues[0] ? `first due ${new Date(dues[0] + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "", a.why].filter(Boolean).join(" · ")}
              </p>
              {open === a.key && (
                <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">
                  {a.customerIds.map((id) => {
                    const c = byId.get(id);
                    return (
                      <li key={id} className="flex items-center gap-2 px-4 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate text-slate-700">{c?.label}<span className="text-slate-400"> {c?.postcode}</span></span>
                        <select value={a.key} onChange={(e) => move(id, e.target.value)} className="max-w-[40%] rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs">
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
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <button type="button" onClick={() => setPlan(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">Back</button>
            <p className="flex-1 text-xs text-slate-500">{plan.reduce((s, a) => s + a.customerIds.length, 0)} customers</p>
            <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {pending ? "Saving…" : "Save areas"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-800">Who should we sort?</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {([["unsorted", "Just the ones not sorted yet", "e.g. everyone imported into one big list"], ["all", "Everyone", "Redo all my areas from scratch"]] as const).map(([v, t, d]) => (
            <button key={v} type="button" onClick={() => setScope(v)} className={cn("rounded-xl border p-3 text-left", scope === v ? "border-blue-500 bg-blue-50" : "border-slate-200")}>
              <span className="block text-sm font-semibold text-slate-800">{t}</span>
              <span className="block text-xs text-slate-500">{d}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-500">Answer what you like. Skip anything you&apos;re not sure about.</p>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-800">Which days do you normally work?</p>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map(([d, label]) => (
              <button key={d} type="button" onClick={() => setWorkDays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]))}
                className={cn("rounded-lg border px-3 py-1.5 text-sm font-semibold", workDays.includes(d) ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600")}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-800">How much do you do in a normal day?</p>
          <div className="flex gap-2">
            <select value={limitBy} onChange={(e) => setLimitBy(e.target.value as "customers" | "value")} className="rounded-lg border border-slate-200 bg-white px-2 text-sm">
              <option value="customers">Customers</option>
              <option value="value">£ of work</option>
            </select>
            <input type="number" inputMode="numeric" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={limitBy === "customers" ? "e.g. 35" : "e.g. 400"} className={inp} />
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-800">How many days early can you clean someone before they&apos;re due?</p>
          <input type="number" inputMode="numeric" min={0} max={90} value={daysEarly} onChange={(e) => setDaysEarly(e.target.value)} placeholder="e.g. 7" className={cn(inp, "max-w-[10rem]")} />
          <p className="mt-1 text-xs text-slate-500">Lets nearby customers due a bit later go on the same day.</p>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-slate-800">Anything else? <span className="font-normal text-slate-400">(optional)</span></p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} placeholder="e.g. Keep Cuckney and Norton together. I never do the town centre on Saturdays." className={cn(inp, "resize-none")} />
        </div>
      </section>

      <div className="flex flex-col gap-2 sm:flex-row">
        {aiAvailable && (
          <button type="button" onClick={() => make(true)} disabled={pending} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-50">
            <Sparkles size={16} /> {pending ? "Thinking… (up to a minute)" : "Sort with AI"}
          </button>
        )}
        <button type="button" onClick={() => make(false)} disabled={pending} className={cn("flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold disabled:opacity-50", aiAvailable ? "border border-slate-300 text-slate-700" : "bg-blue-600 text-white")}>
          <Wand2 size={16} /> {pending && !aiAvailable ? "Sorting…" : "Quick sort (by postcode and street)"}
        </button>
      </div>
      {aiAvailable && (
        <p className="text-xs text-slate-500">
          AI sort sends only streets, towns, postcodes, prices and due dates to Anthropic (Claude) to work out the areas. No names, house numbers, phone numbers or emails.
        </p>
      )}
    </div>
  );
}
