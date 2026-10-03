"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Wand2 } from "lucide-react";
import { applyAreaPlan, planAreas, type PlannedArea } from "@/lib/area-planner";
import { AreaPlanReview, emptyQuestions, PlannerQuestions, toAnswers, type ReviewCustomer } from "@/components/area-plan";
import { cn } from "@/lib/utils";

export function OrganiseClient({ aiAvailable }: { aiAvailable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [scope, setScope] = useState<"unsorted" | "all">("unsorted");
  const [questions, setQuestions] = useState(emptyQuestions);
  const [plan, setPlan] = useState<PlannedArea[] | null>(null);
  const [customers, setCustomers] = useState<ReviewCustomer[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const make = (useAi: boolean) => {
    setError("");
    start(async () => {
      try {
        const result = await planAreas({ scope, answers: toAnswers(questions), useAi });
        setPlan(result.areas);
        setCustomers(result.customers);
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Couldn't make a plan.");
      }
    });
  };

  const save = () => {
    if (!plan) return;
    setError("");
    start(async () => {
      try {
        const r = await applyAreaPlan({ areas: plan.map((a) => ({ name: a.name, customerIds: a.customerIds })), daysEarly: toAnswers(questions).daysEarly });
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
    return (
      <div className="space-y-3 pb-24">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <p className="text-sm text-slate-600">{plan.length} areas. Rename them, or open one to move a customer. Nothing is saved until you press Save.</p>
        <AreaPlanReview plan={plan} customers={byId} onChange={setPlan} />
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

      <PlannerQuestions value={questions} onChange={setQuestions} />

      <PlanButtons aiAvailable={aiAvailable} pending={pending} onPlan={make} />
    </div>
  );
}

/** "Sort with AI" (when set up) and "Quick sort", plus what the AI is sent. */
export function PlanButtons({ aiAvailable, pending, onPlan }: { aiAvailable: boolean; pending: boolean; onPlan: (useAi: boolean) => void }) {
  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row">
        {aiAvailable && (
          <button type="button" onClick={() => onPlan(true)} disabled={pending} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-50">
            <Sparkles size={16} /> {pending ? "Thinking… (up to a minute)" : "Sort with AI"}
          </button>
        )}
        <button type="button" onClick={() => onPlan(false)} disabled={pending} className={cn("flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold disabled:opacity-50", aiAvailable ? "border border-slate-300 text-slate-700" : "bg-blue-600 text-white")}>
          <Wand2 size={16} /> {pending && !aiAvailable ? "Sorting…" : "Quick sort (by postcode and street)"}
        </button>
      </div>
      {aiAvailable && (
        <p className="text-xs text-slate-500">
          AI sort sends only streets, towns, postcodes, prices and due dates to Anthropic (Claude). No names, house numbers, phone numbers or emails.
        </p>
      )}
    </>
  );
}
