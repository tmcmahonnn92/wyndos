"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Send } from "lucide-react";
import { clearMessageLogs, sendBulkTexts } from "@/lib/text-actions";
import { Button } from "@/components/ui/button";
import { SendMethodToggle } from "@/components/phone-send-queue";
import { PhoneOutboxModal } from "@/components/phone-outbox-modal";
import { greetingName } from "@/lib/text-format";
import { cn } from "@/lib/utils";
import {
  PlaceholderButtons,
  TestModeBanner,
  fillTemplate,
  insertAtCursor,
  smsParts,
  TemplatePicker,
} from "@/components/text-placeholders";

type Recipient = {
  id: number;
  name: string;
  address: string;
  phone: string;
  mobile: string | null;
  isProspect: boolean;
  price: number;
  owed: number;
  nextDue: string;
  area: { id: number; name: string; color: string } | null;
  tags: Array<{ id: number; name: string }>;
  unpaidCleans: number;
  reminderDue: { stage: number; age: number } | null;
  lastText: { kind: string; at: string; status: string } | null;
  nextClean: { date: string; label: string; worker: string } | null;
};

type View = "all" | "unpaid" | "reminder" | "soon";
const VIEWS: Array<{ key: View; label: string }> = [
  { key: "all", label: "Everyone" },
  { key: "unpaid", label: "Unpaid cleans" },
  { key: "reminder", label: "Reminder due" },
  { key: "soon", label: "Cleaning soon" },
];
const TEMPLATES_FOR_VIEW: Partial<Record<View, string>> = {
  unpaid: "Hi {{customerFirstName}}, just a reminder you have {{amountDue}} outstanding for window cleaning. To pay by bank: {{bankDetails}}, reference {{paymentReference}}. Thanks, {{businessName}}",
  reminder: "Hi {{customerFirstName}}, just a friendly reminder you have {{amountDue}} outstanding for window cleaning. To pay by bank: {{bankDetails}}, reference {{paymentReference}}. Thanks, {{businessName}}",
  soon: "Hi {{customerFirstName}}, just to let you know we'll be cleaning your windows on {{jobDate}}. Thanks, {{businessName}}",
};

type LogEntry = {
  id: number;
  kind: string;
  toNumber: string;
  body: string;
  status: string;
  error: string;
  createdAt: string;
  customerName: string;
};

const KIND_LABELS: Record<string, string> = {
  DAY_REMINDER: "Day reminder",
  CLEANED: "Cleaned / how to pay",
  PAYMENT_REMINDER_1: "Payment reminder 1",
  PAYMENT_REMINDER_2: "Payment reminder 2",
  BULK: "Bulk",
};
const STATUS_LABELS: Record<string, string> = { TEST: "TEST – not sent", TO_SEND: "Waiting (phone)", PHONE: "Opened on phone" };

const pad = (n: number) => String(n).padStart(2, "0");
/** "today", "yesterday", "3 days ago" */
function ago(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

function when(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MessagesClient({
  initialTab,
  setup,
  recipients,
  log,
  outboxCount,
}: {
  initialTab: "send" | "log";
  setup: { live: boolean; businessName: string; ownerFirstName: string; sendMethod: "PHONE" | "VOODOO"; templates: Array<{ key: string; label: string; body: string }> };
  recipients: Recipient[];
  log: LogEntry[];
  outboxCount: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"send" | "log">(initialTab);
  const [areaIds, setAreaIds] = useState<Set<number>>(new Set());
  const [tagId, setTagId] = useState<string>("");
  const [view, setView] = useState<View>("all");
  const [soonDays, setSoonDays] = useState(7);
  const [method, setMethod] = useState<"PHONE" | "VOODOO">(setup.sendMethod);
  const [queue, setQueue] = useState<{ ids?: number[] } | null>(null);
  const [includeQuotes, setIncludeQuotes] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [logKind, setLogKind] = useState("");
  const [logStatus, setLogStatus] = useState("");
  const [logPicked, setLogPicked] = useState<Set<number>>(new Set());
  const [logNote, setLogNote] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const areas = useMemo(() => {
    const map = new Map<number, { id: number; name: string; color: string; count: number }>();
    for (const r of recipients) {
      if (!r.area) continue;
      const entry = map.get(r.area.id) ?? { ...r.area, count: 0 };
      entry.count++;
      map.set(r.area.id, entry);
    }
    return [...map.values()];
  }, [recipients]);
  const tags = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of recipients) for (const t of r.tags) map.set(t.id, t.name);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [recipients]);

  const filtered = recipients.filter((r) => {
    if (!includeQuotes && r.isProspect) return false;
    if (areaIds.size > 0 && !(r.area && areaIds.has(r.area.id))) return false;
    if (tagId && !r.tags.some((t) => String(t.id) === tagId)) return false;
    if (view === "unpaid" && r.owed <= 0.005) return false;
    if (view === "reminder" && !r.reminderDue) return false;
    if (view === "soon") {
      if (!r.nextClean) return false;
      const days = (new Date(r.nextClean.date + "T00:00:00Z").getTime() - Date.now()) / 86_400_000;
      if (days > soonDays) return false;
    }
    const q = search.trim().toLowerCase();
    if (q && !`${r.name} ${r.address}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const pickedList = recipients.filter((r) => picked.has(r.id));
  const withMobile = pickedList.filter((r) => r.mobile);
  const sample = withMobile[0];
  const preview = sample
    ? fillTemplate(message, {
        customerName: sample.name,
        customerFirstName: greetingName(sample.name, sample.address),
        customerAddress: sample.address,
        areaName: sample.area?.name ?? "",
        jobPrice: `£${sample.price.toFixed(2)}`,
        amountDue: `£${sample.owed.toFixed(2)}`,
        jobDate: sample.nextClean?.label ?? "",
        workerName: sample.nextClean?.worker ?? setup.ownerFirstName,
        bankDetails: "(your bank details)",
        nextDueDate: sample.nextDue,
        businessName: setup.businessName,
        paymentReference: sample.address.split(",")[0],
      })
    : "";

  const toggleArea = (id: number) =>
    setAreaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const send = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await sendBulkTexts({ customerIds: [...picked], template: message, method });
        if (r.phone) {
          setQueue({ ids: r.ids });
          return;
        }
        setResult(
          `${r.logged} text${r.logged === 1 ? "" : "s"} ${r.test ? "written to the log (test mode, nothing sent)" : "sent"}` +
            (r.failed ? `, ${r.failed} failed` : "") +
            (r.noMobile ? `. ${r.noMobile} skipped (no mobile number).` : "."),
        );
        router.refresh();
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Could not send.");
      }
    });
  };

  const shownLog = log.filter((l) => (!logKind || l.kind === logKind) && (!logStatus || l.status === logStatus));
  const clearLogs = (input: Parameters<typeof clearMessageLogs>[0], question: string) => {
    if (!window.confirm(question)) return;
    startTransition(async () => {
      try {
        const r = await clearMessageLogs(input);
        setLogPicked(new Set());
        setLogNote(`${r.cleared} text${r.cleared === 1 ? "" : "s"} cleared from the log.`);
        router.refresh();
      } catch (issue) {
        setLogNote(issue instanceof Error ? issue.message : "Could not clear the log.");
      }
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800">
          <MessageSquare size={20} /> Texts
        </h1>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm font-semibold">
          {(["send", "log"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={cn("rounded-md px-3 py-1.5", tab === t ? "bg-slate-800 text-white" : "text-slate-600")}>
              {t === "send" ? "Send" : `Log (${log.length})`}
            </button>
          ))}
        </div>
      </div>

      {outboxCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5">
          <span className="text-sm font-semibold text-green-800">{outboxCount} text{outboxCount === 1 ? "" : "s"} waiting to send from your phone</span>
          <Button size="sm" onClick={() => setQueue({})}>Send now</Button>
        </div>
      )}
      {method === "VOODOO" && <TestModeBanner live={setup.live} />}
      <PhoneOutboxModal open={queue !== null} onClose={() => setQueue(null)} filter={queue ?? undefined} />

      {tab === "send" ? (
        <div className="space-y-4">
          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-semibold text-slate-800">1. Who to</p>
            <div className="flex flex-wrap gap-1.5">
              {VIEWS.map((v) => (
                <button key={v.key} type="button"
                  onClick={() => {
                    setView(v.key);
                    setPicked(new Set());
                    if (TEMPLATES_FOR_VIEW[v.key] && !message.trim()) setMessage(TEMPLATES_FOR_VIEW[v.key]!);
                  }}
                  className={cn("rounded-lg border px-3 py-1.5 text-xs font-semibold",
                    view === v.key ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700")}>
                  {v.label}
                  {v.key === "unpaid" && ` (${recipients.filter((r) => r.owed > 0.005).length})`}
                  {v.key === "reminder" && ` (${recipients.filter((r) => r.reminderDue).length})`}
                </button>
              ))}
              {view === "soon" && (
                <select value={soonDays} onChange={(e) => setSoonDays(Number(e.target.value))}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs">
                  <option value={1}>tomorrow</option>
                  <option value={3}>next 3 days</option>
                  <option value={7}>next 7 days</option>
                  <option value={14}>next 2 weeks</option>
                </select>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {areas.map((a) => (
                <button key={a.id} type="button" onClick={() => toggleArea(a.id)}
                  className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                    areaIds.has(a.id) ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-700")}>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.color }} />
                  {a.name} <span className="opacity-60">{a.count}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">

              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={includeQuotes} onChange={(e) => setIncludeQuotes(e.target.checked)} /> Include quotes (not live yet)
              </label>
              {tags.length > 0 && (
                <select value={tagId} onChange={(e) => setTagId(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1">
                  <option value="">Any tag</option>
                  {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or address"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1" />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">{filtered.length} match · {picked.size} chosen</span>
              <span className="flex gap-3">
                <button type="button" className="font-semibold text-blue-600" onClick={() => setPicked((p) => new Set([...p, ...filtered.map((r) => r.id)]))}>
                  Choose all {filtered.length}
                </button>
                <button type="button" className="text-slate-500" onClick={() => setPicked(new Set())}>Clear</button>
              </span>
            </div>
            <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-slate-100 p-1">
              {filtered.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
                  <input type="checkbox" checked={picked.has(r.id)}
                    onChange={(e) => setPicked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(r.id);
                      else next.delete(r.id);
                      return next;
                    })} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-800">{r.name}</span>
                    {r.lastText && (
                      <span className={cn("block truncate text-[11px]",
                        Date.now() - new Date(r.lastText.at).getTime() < 7 * 86_400_000 ? "font-semibold text-green-700" : "text-slate-400")}>
                        Last text: {KIND_LABELS[r.lastText.kind] ?? r.lastText.kind} · {r.lastText.status === "TO_SEND" ? "waiting on phone" : ago(r.lastText.at)}
                      </span>
                    )}
                  </span>
                  {r.owed > 0.005 && <span className="text-[11px] font-semibold text-red-600">owes £{r.owed.toFixed(2)}</span>}
                  {r.reminderDue && <span className="rounded bg-red-100 px-1 text-[10px] font-bold text-red-700">reminder {r.reminderDue.stage} due · {r.reminderDue.age}d</span>}
                  {view === "soon" && r.nextClean && <span className="text-[11px] font-semibold text-blue-700">{r.nextClean.label}</span>}
                  <span className="text-[11px] text-slate-400">{r.area?.name ?? ""}</span>
                  {!r.mobile && <span className="text-[10px] font-semibold text-amber-600">no mobile</span>}
                </label>
              ))}
              {filtered.length === 0 && <p className="py-4 text-center text-sm text-slate-400">No customers match.</p>}
            </div>
          </section>

          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-semibold text-slate-800">2. Message</p>
            <TemplatePicker templates={setup.templates} onPick={setMessage} />
            <SendMethodToggle value={method} onChange={setMethod} />
            <textarea ref={textRef} rows={5} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Hi {{customerFirstName}}, we're in {{areaName}} next week…"
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <PlaceholderButtons onInsert={(v) => insertAtCursor(textRef.current, message, v, setMessage)} />
            {preview && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Preview for {sample?.name} · {smsParts(preview)} SMS credit{smsParts(preview) === 1 ? "" : "s"} each
                </p>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{preview}</p>
              </div>
            )}
          </section>

          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {result && <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{result}</p>}
          <Button onClick={send} disabled={isPending || withMobile.length === 0 || !message.trim()} className="w-full">
            <Send size={14} />
            {isPending ? "Preparing…" : method === "PHONE"
              ? `Start sending ${withMobile.length} from my phone`
              : `${setup.live ? "Send" : "Test send"} to ${withMobile.length} customer${withMobile.length === 1 ? "" : "s"}`}
            {pickedList.length > withMobile.length && ` (${pickedList.length - withMobile.length} have no mobile)`}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={logKind} onChange={(e) => { setLogKind(e.target.value); setLogPicked(new Set()); }} aria-label="Kind of text" className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
              <option value="">All texts</option>
              {Object.entries(KIND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <select value={logStatus} onChange={(e) => { setLogStatus(e.target.value); setLogPicked(new Set()); }} aria-label="Status" className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
              <option value="">Any status</option>
              <option value="TEST">Test (not sent)</option>
              <option value="SENT">Sent</option>
              <option value="FAILED">Failed</option>
              <option value="TO_SEND">Waiting (phone)</option>
              <option value="PHONE">Opened on phone</option>
            </select>
          </div>
          {shownLog.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" className="font-semibold text-blue-600"
                onClick={() => setLogPicked(logPicked.size === shownLog.length ? new Set() : new Set(shownLog.map((l) => l.id)))}>
                {logPicked.size === shownLog.length ? "Untick all" : "Tick all"}
              </button>
              <span className="text-slate-400">{logPicked.size} ticked</span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" disabled={isPending || logPicked.size === 0}
                  onClick={() => clearLogs({ ids: [...logPicked] }, `Clear ${logPicked.size} text${logPicked.size === 1 ? "" : "s"} from the log?`)}>
                  Clear ticked
                </Button>
                <Button size="sm" variant="outline" disabled={isPending}
                  onClick={() => clearLogs(
                    logKind || logStatus ? { all: true, kind: logKind || undefined, status: logStatus || undefined } : { all: true },
                    logKind || logStatus ? "Clear every text matching these filters from the log?" : "Clear the whole text log?",
                  )}>
                  {logKind || logStatus ? "Clear all matching" : "Clear all"}
                </Button>
              </span>
            </div>
          )}
          {logNote && <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">{logNote}</p>}
          {shownLog.length > 0 && (
            <p className="text-[11px] text-slate-400">Clearing only tidies the log: it never un-sends a text, and texts already sent won&apos;t be sent again. Clearing a text still waiting on your phone takes it out of the queue.</p>
          )}
          {shownLog.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">No texts yet.</p>
          ) : (
            <ul className="space-y-2">
              {shownLog.map((l) => (
                <li key={l.id} className={cn("rounded-xl border bg-white p-3", logPicked.has(l.id) ? "border-blue-300 ring-1 ring-blue-200" : "border-slate-200")}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input type="checkbox" aria-label="Tick this text" checked={logPicked.has(l.id)}
                      onChange={() => setLogPicked((prev) => { const next = new Set(prev); if (next.has(l.id)) next.delete(l.id); else next.add(l.id); return next; })} />
                    <span className={cn("rounded-full px-2 py-0.5 font-bold",
                      l.status === "SENT" ? "bg-green-100 text-green-800" : l.status === "FAILED" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800")}>
                      {STATUS_LABELS[l.status] ?? l.status}
                    </span>
                    <span className="font-semibold text-slate-700">{KIND_LABELS[l.kind] ?? l.kind}</span>
                    <span className="text-slate-500">{l.customerName}</span>
                    <span className="text-slate-400">+{l.toNumber}</span>
                    <span className="ml-auto text-slate-400">{when(l.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">{l.body}</p>
                  {l.error && <p className="mt-1 text-xs text-red-600">{l.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
