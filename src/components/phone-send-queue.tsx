"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MessageSquare, SkipForward } from "lucide-react";
import { markPhoneTextOpened } from "@/lib/text-actions";

export type PhoneText = { id: number; name: string; to: string; body: string };

function isApple() {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
}
function isPhone() {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** sms: link that opens the phone's own Messages app with the text filled in. */
export function smsHref(to: string, body: string) {
  const number = to.startsWith("+") ? to : `+${to}`;
  // iPhone wants "&body=", Android wants "?body=".
  return `sms:${number}${isApple() ? "&" : "?"}body=${encodeURIComponent(body)}`;
}

/**
 * Walks through texts one at a time. Tap "Open in Messages", press Send in the Messages app,
 * come back to Wyndos and the next customer is ready automatically.
 * Progress is saved as it goes, so closing the screen and coming back carries on where you left off.
 */
export function PhoneSendQueue({ items, onFinished }: { items: PhoneText[]; onFinished: (opened: number) => void }) {
  const [index, setIndex] = useState(0);
  const [bodies, setBodies] = useState<Record<number, string>>({});
  const [openedIds, setOpenedIds] = useState<Set<number>>(new Set());
  const [phone, setPhone] = useState(true);
  const awaitingReturn = useRef(false);
  const leftPage = useRef(false);

  useEffect(() => { setPhone(isPhone()); }, []);

  const current = items[index];
  const body = current ? bodies[current.id] ?? current.body : "";

  const advance = useCallback(() => {
    awaitingReturn.current = false;
    leftPage.current = false;
    setIndex((i) => Math.min(i + 1, items.length));
  }, [items.length]);

  const finishedRef = useRef(false);
  useEffect(() => {
    if (index >= items.length && items.length > 0 && !finishedRef.current) {
      finishedRef.current = true;
      onFinished(openedIds.size);
    }
  }, [index, items.length, openedIds.size, onFinished]);

  // Leaving for the Messages app hides this page; coming back shows it again -> next customer.
  useEffect(() => {
    const away = () => { if (awaitingReturn.current) leftPage.current = true; };
    const back = () => {
      if (awaitingReturn.current && leftPage.current) window.setTimeout(advance, 400);
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? away() : back());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", away);
    window.addEventListener("focus", back);
    window.addEventListener("pagehide", away);
    window.addEventListener("pageshow", back);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", back);
      window.removeEventListener("pagehide", away);
      window.removeEventListener("pageshow", back);
    };
  }, [advance]);

  const onOpen = () => {
    if (!current) return;
    awaitingReturn.current = true;
    leftPage.current = false;
    setOpenedIds((prev) => new Set(prev).add(current.id));
    // Saved as "opened on phone"; if this fails it just stays in the to-send list.
    markPhoneTextOpened(current.id, bodies[current.id]).catch(() => {});
  };

  if (!current) {
    return (
      <div className="space-y-2 py-4 text-center">
        <p className="text-sm font-semibold text-green-700">All done — {openedIds.size} opened to send.</p>
        <p className="text-xs text-slate-500">Anything you skipped stays on the Texts page under “Waiting to send”.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!phone && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This sends from the phone you&apos;re using, so open Wyndos on your phone to send these.
        </p>
      )}
      <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
        <span>{index + 1} of {items.length}</span>
        <span>{openedIds.size} opened</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-green-500 transition-all" style={{ width: `${(index / items.length) * 100}%` }} />
      </div>
      <div>
        <p className="text-base font-bold text-slate-800">{current.name || "Customer"}</p>
        <p className="text-xs text-slate-500">+{current.to}</p>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBodies((prev) => ({ ...prev, [current.id]: e.target.value }))}
        rows={5}
        className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <a
        href={smsHref(current.to, body)}
        onClick={onOpen}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3.5 text-base font-bold text-white active:bg-green-700"
      >
        <MessageSquare size={18} /> Open in Messages
      </a>
      <p className="text-center text-[11px] text-slate-500">
        Press Send in Messages, then come back here — the next customer opens by itself.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" disabled={index === 0} onClick={() => { awaitingReturn.current = false; setIndex((i) => Math.max(0, i - 1)); }}
          className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600 disabled:opacity-40">
          <ChevronLeft size={14} /> Back
        </button>
        <button type="button" onClick={advance}
          className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600">
          <SkipForward size={14} /> Skip
        </button>
        <button type="button" onClick={advance}
          className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600">
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

/** "My phone" vs "VoodooSMS" switch shown wherever texts are sent. */
export function SendMethodToggle({
  value,
  onChange,
  voodooLabel = "Automatic (VoodooSMS)",
}: {
  value: "PHONE" | "VOODOO";
  onChange: (value: "PHONE" | "VOODOO") => void;
  voodooLabel?: string;
}) {
  return (
    <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold" role="radiogroup" aria-label="Send from">
      {([
        ["PHONE", "From my phone (free)"],
        ["VOODOO", voodooLabel],
      ] as const).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          className={`flex-1 rounded-md px-2 py-1.5 ${value === key ? "bg-slate-800 text-white" : "text-slate-600"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
