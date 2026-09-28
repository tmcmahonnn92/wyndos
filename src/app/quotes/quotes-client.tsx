"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Phone, Plus, RotateCcw } from "lucide-react";
import type { getQuotes } from "@/lib/actions";
import { reopenQuote } from "@/lib/actions";
import { QuoteActions, quoteSummary } from "@/app/days/[id]/quote-actions";
import { OneOffJobModal } from "@/app/days/one-off-job-modal";
import { cn } from "@/lib/utils";

type Quote = Awaited<ReturnType<typeof getQuotes>>[number];

const SECTIONS = [
  { key: "TO_VISIT", title: "To visit", hint: "Quote visits booked but not done yet" },
  { key: "QUOTED", title: "Quoted — waiting for an answer", hint: "Chase these up" },
  { key: "WON", title: "Won — now live customers", hint: "" },
  { key: "LOST", title: "Lost", hint: "" },
] as const;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Same text on server and phone (locale formatting differs between them). */
function fmtDay(value: string | Date) {
  const d = new Date(value);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function QuotesClient({ quotes, openBooking = false }: { quotes: Quote[]; openBooking?: boolean }) {
  const router = useRouter();
  const [bookOpen, setBookOpen] = useState(openBooking);
  const [tab, setTab] = useState<(typeof SECTIONS)[number]["key"]>("QUOTED");
  const [isPending, startTransition] = useTransition();

  const counts = Object.fromEntries(SECTIONS.map((section) => [
    section.key,
    quotes.filter((quote) => (quote.quoteStatus ?? "TO_VISIT") === section.key).length,
  ]));
  const shown = quotes.filter((quote) => (quote.quoteStatus ?? "TO_VISIT") === tab);
  const section = SECTIONS.find((entry) => entry.key === tab)!;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800"><ClipboardList size={20} /> Quotes</h1>
          <p className="text-sm text-slate-500">Quote visits and whether they turned into customers.</p>
        </div>
        <button
          type="button"
          onClick={() => setBookOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus size={15} /> Book quote
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
        {SECTIONS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            className={cn(
              "rounded-lg px-1 py-2 text-xs font-semibold",
              tab === entry.key ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"
            )}
          >
            {entry.title.split(" — ")[0]} <span className="text-slate-400">{counts[entry.key]}</span>
          </button>
        ))}
      </div>
      {section.hint && <p className="px-1 text-xs text-slate-500">{section.hint}</p>}

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">Nothing here.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((quote) => {
            const who = quote.assignedUser ?? quote.workDay.assignedUser;
            return (
              <li key={quote.id} className="overflow-hidden rounded-xl border border-purple-200 bg-white shadow-sm">
                <div className="space-y-1 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {quote.quoteStatus === "WON" ? (
                        <Link href={`/customers/${quote.customer.id}`} className="font-semibold text-slate-800 hover:underline">{quote.customer.name}</Link>
                      ) : (
                        <p className="font-semibold text-slate-800">{quote.customer.name}</p>
                      )}
                      <p className="text-xs text-slate-500">{quote.customer.address}</p>
                    </div>
                    <Link href={`/days/${quote.workDay.id}`} className="flex-shrink-0 text-xs font-medium text-blue-600 hover:underline">
                      {fmtDay(quote.workDay.date)}
                    </Link>
                  </div>
                  <p className="text-xs font-semibold text-purple-800">{quoteSummary(quote)}</p>
                  {(quote.notes || quote.customer.notes) && (
                    <p className="text-xs text-slate-600">{[quote.notes, quote.customer.notes].filter(Boolean).join(" · ")}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    {quote.customer.phone && (
                      <a href={`tel:${quote.customer.phone}`} className="flex items-center gap-1 font-medium text-blue-600">
                        <Phone size={12} /> {quote.customer.phone}
                      </a>
                    )}
                    {quote.customer.email && <a href={`mailto:${quote.customer.email}`} className="text-blue-600">{quote.customer.email}</a>}
                    {who && <span>Visit: {who.name ?? who.email}</span>}
                    {quote.completedBy && quote.quoteStatus !== "TO_VISIT" && <span>Quoted by {quote.completedBy.name ?? quote.completedBy.email}</span>}
                  </div>
                </div>
                {quote.quoteStatus === "LOST" ? (
                  <div className="border-t border-slate-100">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => startTransition(async () => { await reopenQuote(quote.id); router.refresh(); })}
                      className="flex w-full items-center justify-center gap-1.5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <RotateCcw size={14} /> They came back — reopen
                    </button>
                  </div>
                ) : (
                  <QuoteActions job={quote} canMarkLive />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <OneOffJobModal open={bookOpen} initialMode="quote" onClose={() => { setBookOpen(false); router.refresh(); }} />
    </div>
  );
}
