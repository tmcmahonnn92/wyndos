"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, List, X } from "lucide-react";

type Step = { id: string; title: string };

/**
 * The guide's menu. On a computer: a list fixed down the left, showing where you are.
 * On a phone: a bar that stays at the top ("Step 5 of 14 · Work a day") and opens the
 * full list from the left.
 */
export function GuideMenu({ steps, signedIn }: { steps: Step[]; signedIn: boolean }) {
  const [active, setActive] = useState<string>("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const els = steps.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => Boolean(e));
    const pick = () => {
      // The last section whose top has passed a line a third of the way down the screen.
      const line = window.innerHeight / 3;
      let current = "";
      for (const el of els) if (el.getBoundingClientRect().top <= line) current = el.id;
      setActive(current);
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => { window.removeEventListener("scroll", pick); window.removeEventListener("resize", pick); };
  }, [steps]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = was; };
  }, [open]);

  const index = steps.findIndex((s) => s.id === active);
  const current = index >= 0 ? steps[index] : null;

  const list = (onPick?: () => void) => (
    <nav aria-label="Guide steps">
      <a href="#top" onClick={onPick} className={`mb-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold ${!current ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-100"}`}>
        <BookOpen size={15} /> Start here
      </a>
      <ol className="space-y-0.5">
        {steps.map((s, i) => {
          const on = s.id === active;
          return (
            <li key={s.id}>
              <a href={`#${s.id}`} onClick={onPick} aria-current={on ? "step" : undefined}
                className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm leading-5 ${on ? "bg-blue-600 font-semibold text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                <span className={`mt-px flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${on ? "bg-white text-blue-700" : "bg-slate-200 text-slate-600"}`}>{i + 1}</span>
                <span>{s.title}</span>
              </a>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 border-t border-slate-200 pt-3">
        <Link href="/guide/direct-debit" onClick={onPick} className="flex items-center justify-between rounded-lg px-2.5 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
          Direct Debit guide <ChevronRight size={15} />
        </Link>
        {signedIn && (
          <Link href="/support?from=%2Fguide" onClick={onPick} className="flex items-center justify-between rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Still stuck? Ask us <ChevronRight size={15} />
          </Link>
        )}
      </div>
    </nav>
  );

  return (
    <>
      {/* Computer: fixed down the left. */}
      <aside className="hidden w-64 flex-shrink-0 print:hidden lg:block">
        <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="px-2.5 pb-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Guide</p>
          {list()}
        </div>
      </aside>

      {/* Phone and tablet: a bar that stays at the top and opens the list. */}
      <div className={`sticky z-30 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur print:hidden lg:hidden ${signedIn ? "top-14 md:top-0" : "top-0"}`}>
        <button type="button" onClick={() => setOpen(true)} aria-expanded={open}
          className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm active:bg-slate-50">
          <List size={18} className="flex-shrink-0 text-blue-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {current ? `Step ${index + 1} of ${steps.length}` : "Guide"}
            </span>
            <span className="block truncate text-sm font-semibold text-slate-900">{current ? current.title : "All steps"}</span>
          </span>
          <span className="flex-shrink-0 text-xs font-semibold text-blue-700">Menu</span>
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 print:hidden lg:hidden" role="dialog" aria-modal="true" aria-label="Guide steps">
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-950/50" />
          <div className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-bold text-slate-900">Guide</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{list(() => setOpen(false))}</div>
          </div>
        </div>
      )}
    </>
  );
}
