"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, Link2, Loader2, Mail, MessageSquare, RefreshCw, Unlink } from "lucide-react";
import {
  collectDirectDebits, getGoCardlessLinks, saveGoCardlessLinks, sendDirectDebitLink, setGoCardlessAutoCollect,
  syncGoCardlessNow, unlinkGoCardless, type getDirectDebitBoard, type getGoCardlessOverview,
} from "@/lib/gocardless/actions";
import { cn, fmtCurrency } from "@/lib/utils";

type Overview = Awaited<ReturnType<typeof getGoCardlessOverview>>;
type Board = Awaited<ReturnType<typeof getDirectDebitBoard>>;
type LinkRows = Extract<Awaited<ReturnType<typeof getGoCardlessLinks>>, { ok: true }>;
type Tab = "collect" | "progress" | "failed" | "customers" | "link";

const STATUS: Record<string, string> = {
  pending_customer_approval: "Waiting for customer", pending_submission: "Being set up", submitted: "Submitted to bank",
  confirmed: "Collected", paid_out: "Paid out", active: "Active", failed: "Failed", cancelled: "Cancelled",
  customer_approval_denied: "Customer said no", charged_back: "Charged back", expired: "Expired", consumed: "Used up",
  blocked: "Blocked", suspended_by_payer: "Suspended by customer", link_sent: "Sign-up link sent", not_set_up: "Not set up", linked: "Linked",
};
const label = (s: string | null | undefined) => (s ? STATUS[s] ?? s.replace(/_/g, " ") : "—");
const fmtDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
const good = (s: string) => ["active", "pending_submission", "submitted", "pending_customer_approval", "linked"].includes(s);

export function DirectDebitClient({ overview, board, customers }: { overview: Overview; board: Board; customers: Array<{ id: number; name: string; address: string }> }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(board.due.length ? "collect" : board.people.length ? "customers" : "link");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string; list?: string[] } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(board.due.filter((d) => !d.mandateStatus || good(d.mandateStatus)).map((d) => d.jobId)));
  const [signup, setSignup] = useState<{ customerId: number; url: string } | null>(null);
  const [setupFor, setSetupFor] = useState("");
  const [links, setLinks] = useState<LinkRows | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  // New cleans to collect (after linking, syncing or collecting): tick the ones that can be collected.
  const dueKey = board.due.map((d) => d.jobId).join(",");
  useEffect(() => {
    setPicked(new Set(board.due.filter((d) => !d.mandateStatus || good(d.mandateStatus)).map((d) => d.jobId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueKey]);

  const pickedTotal = board.due.filter((d) => picked.has(d.jobId)).reduce((s, d) => s + d.amount, 0);
  const nameOf = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setNote(null);
    try { await fn(); } catch (issue) { setNote({ ok: false, text: issue instanceof Error ? issue.message : "Something went wrong." }); }
    setBusy(null);
  };

  const sync = () => run("sync", async () => {
    const res = await syncGoCardlessNow();
    if (!res.ok) { setNote({ ok: false, text: res.error }); return; }
    const bits = [
      res.received + res.imported ? `${res.received + res.imported} payment${res.received + res.imported === 1 ? "" : "s"} received` : "",
      res.failed ? `${res.failed} failed` : "",
      res.mandatesLinked ? `${res.mandatesLinked} new Direct Debit${res.mandatesLinked === 1 ? "" : "s"} linked` : "",
      res.mandatesUpdated ? `${res.mandatesUpdated} status change${res.mandatesUpdated === 1 ? "" : "s"}` : "",
      res.autoCollected ? `${res.autoCollected} collected automatically` : "",
    ].filter(Boolean);
    setNote({ ok: true, text: bits.length ? `Synced: ${bits.join(", ")}.` : "Synced. Nothing new.", list: res.problems });
    router.refresh();
  });

  const collect = (ids: number[]) => run("collect", async () => {
    const res = await collectDirectDebits(ids);
    if (!res.ok) { setNote({ ok: false, text: res.error }); return; }
    setNote({
      ok: res.collected > 0,
      text: res.collected ? `Asked GoCardless to collect ${fmtCurrency(res.total)} from ${res.collected} clean${res.collected === 1 ? "" : "s"}. It usually arrives in 3–5 working days.` : "Nothing was collected.",
      list: res.skipped.map((s) => `${board.due.find((d) => d.jobId === s.jobId)?.customer ?? board.failed.find((d) => d.jobId === s.jobId)?.customer ?? `Clean ${s.jobId}`}: ${s.reason}`),
    });
    setPicked(new Set());
    router.refresh();
  });

  const getLink = (customerId: number) => run(`link-${customerId}`, async () => {
    const res = await sendDirectDebitLink(customerId);
    if (!res.ok) { setNote({ ok: false, text: res.error }); return; }
    setSignup({ customerId, url: res.url });
    router.refresh();
  });

  const loadLinks = () => run("load", async () => {
    const res = await getGoCardlessLinks();
    if (!res.ok) { setNote({ ok: false, text: res.error }); return; }
    setLinks(res);
    setChoice(Object.fromEntries(res.rows.map((r) => [r.gcCustomerId, String(r.linkedWyndosId ?? r.suggestedWyndosId ?? "")])));
  });

  const saveLinks = () => run("save", async () => {
    if (!links) return;
    const chosen = links.rows.filter((r) => choice[r.gcCustomerId] && Number(choice[r.gcCustomerId]) !== r.linkedWyndosId)
      .map((r) => ({ wyndosId: Number(choice[r.gcCustomerId]), gcCustomerId: r.gcCustomerId }));
    const res = await saveGoCardlessLinks(chosen);
    if (!res.ok) { setNote({ ok: false, text: res.error }); return; }
    setNote({ ok: true, text: `${res.saved} customer${res.saved === 1 ? "" : "s"} linked to GoCardless.` });
    setLinks(null);
    router.refresh();
  });

  if (!overview.connected) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        GoCardless isn&apos;t connected yet. Add your access token in <Link href="/settings" className="font-semibold underline">Settings → Business</Link>, then come back here.
      </div>
    );
  }

  const tabs: Array<[Tab, string, number | null]> = [
    ["collect", "To collect", board.due.length], ["progress", "In progress", board.inProgress.length],
    ["failed", "Failed", board.failed.length], ["customers", "Customers", board.people.length], ["link", "Link GoCardless customers", null],
  ];

  return (
    <div className="space-y-4">
      {/* Connection */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-sm">
          <p className="font-semibold text-slate-800">
            {overview.creditorName || "GoCardless"} {overview.environment === "sandbox" && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">Sandbox</span>}
          </p>
          <p className="text-xs text-slate-500">
            {overview.linked} customer{overview.linked === 1 ? "" : "s"} on Direct Debit{overview.waiting ? ` · ${overview.waiting} sign-up link${overview.waiting === 1 ? "" : "s"} waiting` : ""} ·
            Last sync {overview.lastSyncedAt ? new Date(overview.lastSyncedAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "never"}
          </p>
          {overview.lastError && <p className="mt-1 flex items-center gap-1 text-xs text-red-700"><AlertTriangle size={12} />{overview.lastError}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-600" title="Each clean is collected by Direct Debit at the next sync after it's marked complete. Only cleans completed after you turn this on.">
            <input type="checkbox" checked={overview.autoCollect} disabled={busy === "auto"}
              onChange={(e) => run("auto", async () => { await setGoCardlessAutoCollect(e.target.checked); router.refresh(); })} className="accent-blue-600" />
            Collect automatically when a clean is done
          </label>
          <button type="button" onClick={sync} disabled={busy === "sync"} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw size={14} className={cn(busy === "sync" && "animate-spin")} /> {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {note && (
        <div className={cn("rounded-xl px-3 py-2 text-sm", note.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700")}>
          <p>{note.text}</p>
          {note.list && note.list.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{note.list.slice(0, 10).map((l, i) => <li key={i}>{l}</li>)}</ul>}
        </div>
      )}

      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {tabs.map(([key, text, count]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", tab === key ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
            {text}{count !== null && <span className="ml-1 text-slate-400">{count}</span>}
          </button>
        ))}
      </div>

      {tab === "collect" && (
        <div className="rounded-2xl border border-slate-200 bg-white">
          {board.due.length === 0 ? <p className="p-4 text-sm text-slate-500">Nothing to collect. Completed cleans for customers on Direct Debit show here until they&apos;re paid.</p> : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" className="accent-blue-600" checked={picked.size === board.due.length}
                    onChange={(e) => setPicked(e.target.checked ? new Set(board.due.map((d) => d.jobId)) : new Set())} /> All
                </label>
                <button type="button" disabled={picked.size === 0 || busy === "collect"} onClick={() => collect([...picked])}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {busy === "collect" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Collect {fmtCurrency(pickedTotal)} ({picked.size})
                </button>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {board.due.map((d) => (
                    <tr key={d.jobId}>
                      <td className="w-8 px-3 py-2"><input type="checkbox" className="accent-blue-600" checked={picked.has(d.jobId)}
                        onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(d.jobId); else n.delete(d.jobId); return n; })} /></td>
                      <td className="px-2 py-2"><Link href={`/customers/${d.customerId}`} className="font-medium text-slate-800 hover:underline">{d.customer}</Link></td>
                      <td className="px-2 py-2 text-slate-500">{fmtDate(d.date)}</td>
                      <td className="px-2 py-2 text-xs">{d.mandateStatus && !good(d.mandateStatus) ? <span className="text-amber-700">Direct Debit {label(d.mandateStatus).toLowerCase()}</span> : ""}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtCurrency(d.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {(tab === "progress" || tab === "failed") && (
        <div className="rounded-2xl border border-slate-200 bg-white">
          {(tab === "progress" ? board.inProgress : board.failed).length === 0 ? (
            <p className="p-4 text-sm text-slate-500">{tab === "progress" ? "No collections in progress." : "No failed collections."}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {(tab === "progress" ? board.inProgress : board.failed).map((d) => (
                  <tr key={d.jobId}>
                    <td className="px-3 py-2"><Link href={`/customers/${d.customerId}`} className="font-medium text-slate-800 hover:underline">{d.customer}</Link></td>
                    <td className="px-2 py-2 text-slate-500">{fmtDate(d.date)}</td>
                    <td className={cn("px-2 py-2 text-xs", tab === "failed" ? "text-red-700" : "text-slate-600")}>{label(d.status)}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmtCurrency(d.amount)}</td>
                    {tab === "failed" && (
                      <td className="w-24 px-3 py-2 text-right">
                        <button type="button" disabled={busy === "collect"} onClick={() => collect([d.jobId])} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Try again</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "failed" && board.failed.length > 0 && <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Failed cleans still show as owing on the customer. Check with the customer before trying again.</p>}
        </div>
      )}

      {tab === "customers" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3">
            <span className="text-sm text-slate-700">Set up Direct Debit for</span>
            <select value={setupFor} onChange={(e) => setSetupFor(e.target.value)} className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
              <option value="">Choose a customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.address}</option>)}
            </select>
            <button type="button" disabled={!setupFor || busy?.startsWith("link-")} onClick={() => getLink(Number(setupFor))}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              <Link2 size={14} /> Get sign-up link
            </button>
          </div>

          {signup && (
            <div className="space-y-2 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm">
              <p className="font-semibold text-blue-900">Sign-up link for {nameOf.get(signup.customerId) ?? "customer"}</p>
              <p className="break-all rounded-lg bg-white px-2 py-1.5 font-mono text-xs text-slate-700">{signup.url}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => navigator.clipboard.writeText(signup.url)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800"><Copy size={12} /> Copy</button>
                <a href={`sms:?&body=${encodeURIComponent(`Please set up your Direct Debit for window cleaning here: ${signup.url}`)}`} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800"><MessageSquare size={12} /> Text</a>
                <a href={`mailto:?subject=${encodeURIComponent("Direct Debit for your window cleaning")}&body=${encodeURIComponent(`Please set up your Direct Debit here: ${signup.url}`)}`} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800"><Mail size={12} /> Email</a>
              </div>
              <p className="text-xs text-blue-800">When they&apos;ve filled it in, the next sync links their Direct Debit automatically.</p>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white">
            {board.people.length === 0 ? <p className="p-4 text-sm text-slate-500">No customers on Direct Debit yet. Link existing GoCardless customers, or send someone a sign-up link.</p> : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {board.people.map((p) => (
                    <tr key={p.id} className={cn(!p.active && "text-slate-400")}>
                      <td className="px-3 py-2"><Link href={`/customers/${p.id}`} className="font-medium hover:underline">{p.name}</Link><p className="text-xs text-slate-400">{p.address}</p></td>
                      <td className={cn("px-2 py-2 text-xs", good(p.state) ? "text-green-700" : p.state === "link_sent" ? "text-blue-700" : "text-amber-700")}>{label(p.state)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1.5">
                          {!good(p.state) && (
                            <button type="button" disabled={busy === `link-${p.id}`} onClick={() => getLink(p.id)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                              {p.state === "link_sent" ? "New link" : "Sign-up link"}
                            </button>
                          )}
                          {p.state !== "not_set_up" && (
                            <button type="button" title="Unlink from GoCardless (doesn't cancel the Direct Debit)" disabled={busy === `unlink-${p.id}`}
                              onClick={() => run(`unlink-${p.id}`, async () => { await unlinkGoCardless(p.id); router.refresh(); })}
                              className="rounded-lg border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50"><Unlink size={12} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "link" && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">Already have customers on Direct Debit in GoCardless? Load them and match each one to a Wyndos customer. Suggested matches use email, then name and postcode.</p>
          {!links ? (
            <button type="button" onClick={loadLinks} disabled={busy === "load"} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy === "load" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Load from GoCardless
            </button>
          ) : links.rows.length === 0 ? <p className="text-sm text-slate-500">No customers in GoCardless yet.</p> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-2 py-1.5 font-semibold">In GoCardless</th><th className="px-2 py-1.5 font-semibold">Direct Debit</th><th className="px-2 py-1.5 font-semibold">Wyndos customer</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {links.rows.map((r) => (
                      <tr key={r.gcCustomerId} className={cn(!choice[r.gcCustomerId] && "bg-amber-50/50")}>
                        <td className="px-2 py-2"><p className="font-medium text-slate-800">{r.name}</p><p className="text-xs text-slate-400">{[r.email, r.address, r.postcode].filter(Boolean).join(" · ")}</p></td>
                        <td className="px-2 py-2 text-xs">{label(r.mandateStatus)}</td>
                        <td className="px-2 py-2">
                          <select value={choice[r.gcCustomerId] ?? ""} onChange={(e) => setChoice((c) => ({ ...c, [r.gcCustomerId]: e.target.value }))} className="w-full min-w-[180px] rounded-lg border border-slate-200 px-2 py-1 text-sm">
                            <option value="">Don&apos;t link</option>
                            {links.customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.address}</option>)}
                          </select>
                          {r.linkedWyndosId && String(r.linkedWyndosId) === choice[r.gcCustomerId] && <p className="mt-0.5 text-[11px] text-green-700">Already linked</p>}
                          {!r.linkedWyndosId && r.suggestedWyndosId && String(r.suggestedWyndosId) === choice[r.gcCustomerId] && <p className="mt-0.5 text-[11px] text-blue-700">Suggested</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={saveLinks} disabled={busy === "save"} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save links
                </button>
                <button type="button" onClick={() => setLinks(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
