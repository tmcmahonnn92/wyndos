"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy, Paperclip, Send } from "lucide-react";
import { replyToTicket, setTicketStatus } from "@/lib/admin-tickets";

type Ticket = {
  id: number;
  tenantName: string;
  fromName: string;
  fromEmail: string;
  copyTo: string;
  kind: string;
  section: string;
  subject: string;
  message: string;
  page: string;
  files: string;
  status: string;
  createdAt: string;
  replies: Array<{ id: number; body: string; kind: string; createdAt: string }>;
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Support tickets from the in-app form. Replies go by email from the support address. */
export function TicketsPanel({ tickets }: { tickets: Ticket[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"OPEN" | "CLOSED" | "ALL">("OPEN");
  const [selectedId, setSelectedId] = useState<number | null>(tickets.find((t) => t.status === "OPEN")?.id ?? tickets[0]?.id ?? null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [pending, start] = useTransition();

  const shown = useMemo(() => tickets.filter((t) => filter === "ALL" || t.status === filter), [tickets, filter]);
  const ticket = tickets.find((t) => t.id === selectedId) ?? null;

  const send = (opts: { note?: boolean; close?: boolean }) => {
    if (!ticket) return;
    setError("");
    setSent("");
    start(async () => {
      try {
        await replyToTicket({ ticketId: ticket.id, body: reply, ...opts });
        setReply("");
        setSent(opts.note ? "Note saved." : `Reply emailed to ${ticket.fromEmail}.`);
        router.refresh();
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Couldn't send.");
      }
    });
  };

  const toggle = (status: "OPEN" | "CLOSED") =>
    ticket && start(async () => { await setTicketStatus(ticket.id, status); router.refresh(); });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
      <div className="space-y-2">
        <div className="flex gap-1 rounded-lg bg-slate-900 p-1 text-xs font-semibold">
          {(["OPEN", "CLOSED", "ALL"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`flex-1 rounded-md py-1.5 ${filter === f ? "bg-slate-700 text-white" : "text-slate-400"}`}>
              {f === "OPEN" ? "Open" : f === "CLOSED" ? "Closed" : "All"}
            </button>
          ))}
        </div>
        <ul className="max-h-[70vh] divide-y divide-slate-800 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900">
          {shown.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => { setSelectedId(t.id); setError(""); setSent(""); }}
                className={`w-full px-3 py-2.5 text-left ${t.id === selectedId ? "bg-slate-800" : "hover:bg-slate-800/50"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-white">#{t.id} {t.subject}</p>
                  {t.status === "OPEN" && t.replies.every((r) => r.kind !== "ADMIN") && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" title="Not answered" />}
                </div>
                <p className="truncate text-xs text-slate-400">{t.fromName || t.fromEmail} · {t.tenantName || "No business"}</p>
                <p className="text-[11px] text-slate-500">{when(t.createdAt)}{t.replies.length ? ` · ${t.replies.length} repl${t.replies.length === 1 ? "y" : "ies"}` : ""}</p>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No tickets here.</li>}
        </ul>
      </div>

      {ticket ? (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-lg font-semibold text-white">#{ticket.id} {ticket.subject}</p>
              <p className="text-xs text-slate-400">
                {ticket.fromName} &lt;{ticket.fromEmail}&gt;{ticket.copyTo ? `, copy ${ticket.copyTo}` : ""} · {ticket.tenantName || "No business"}
              </p>
              <p className="text-xs text-slate-500">
                {[ticket.kind, ticket.section, ticket.page].filter(Boolean).join(" · ")} · {when(ticket.createdAt)}
              </p>
            </div>
            <button
              onClick={() => toggle(ticket.status === "OPEN" ? "CLOSED" : "OPEN")}
              disabled={pending}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500"
            >
              {ticket.status === "OPEN" ? "Close ticket" : "Reopen"}
            </button>
          </div>

          <div className="rounded-lg bg-slate-950 p-3 text-sm whitespace-pre-wrap text-slate-200">{ticket.message}</div>
          {ticket.files && (
            <p className="flex items-center gap-1 text-xs text-slate-500"><Paperclip className="h-3 w-3" /> {ticket.files} (in the support inbox)</p>
          )}

          {ticket.replies.map((r) => (
            <div key={r.id} className={`rounded-lg p-3 text-sm whitespace-pre-wrap ${r.kind === "NOTE" ? "border border-amber-900/60 bg-amber-950/20 text-amber-100" : "border border-blue-900/60 bg-blue-950/30 text-slate-100"}`}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {r.kind === "NOTE" ? "Internal note" : "Reply sent"} · {when(r.createdAt)}
              </p>
              {r.body}
            </div>
          ))}

          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={6}
            placeholder={`Reply to ${ticket.fromName || ticket.fromEmail}…`}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          {sent && <p className="text-sm text-emerald-400">{sent}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => send({})} disabled={pending || !reply.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
              <Send className="h-4 w-4" /> {pending ? "Sending…" : "Send reply"}
            </button>
            <button onClick={() => send({ close: true })} disabled={pending || !reply.trim()} className="rounded-lg border border-blue-700 px-3 py-2 text-sm font-semibold text-blue-200 hover:bg-blue-950 disabled:opacity-50">
              Send &amp; close
            </button>
            <button onClick={() => send({ note: true })} disabled={pending || !reply.trim()} className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 hover:border-slate-500 disabled:opacity-50">
              Save as note
            </button>
          </div>
          <p className="text-[11px] text-slate-500">Emailed from the support address. Their answer comes back to the support inbox.</p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 p-10 text-slate-500">
          <LifeBuoy className="h-6 w-6" />
          <p className="text-sm">No support tickets yet.</p>
        </div>
      )}
    </div>
  );
}
