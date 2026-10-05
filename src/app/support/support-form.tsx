"use client";

import { useRef, useState } from "react";
import { CheckCircle2, LifeBuoy, Paperclip, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SUPPORT_KINDS, SUPPORT_MAX_BYTES, SUPPORT_MAX_FILES, SUPPORT_SECTIONS } from "@/lib/support";

// Guess the section from the page they came from; they can change it.
const SECTION_BY_PATH: Array<[string, string]> = [
  ["/scheduler", "Scheduler"],
  ["/days", "Days & jobs"],
  ["/customers/import", "Importing customers"],
  ["/customers", "Customers"],
  ["/areas", "Areas"],
  ["/payments", "Payments & invoices"],
  ["/invoice", "Payments & invoices"],
  ["/messages", "Texts & messages"],
  ["/accounting", "Accounting & reports"],
  ["/reports", "Accounting & reports"],
  ["/settings", "Settings"],
  ["/account", "My account / signing in"],
];

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function SupportForm({ from }: { from: string }) {
  const [kind, setKind] = useState<string>(SUPPORT_KINDS[0]);
  const [section, setSection] = useState(() => SECTION_BY_PATH.find(([p]) => from.startsWith(p))?.[1] ?? "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [copyTo, setCopyTo] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const total = files.reduce((s, f) => s + f.size, 0);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setError("");
    const next = [...files, ...Array.from(list)].slice(0, SUPPORT_MAX_FILES);
    if (files.length + list.length > SUPPORT_MAX_FILES) setError(`Up to ${SUPPORT_MAX_FILES} files.`);
    setFiles(next);
    if (fileInput.current) fileInput.current.value = "";
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (total > SUPPORT_MAX_BYTES) { setError(`Files come to ${mb(total)}. Keep them under ${mb(SUPPORT_MAX_BYTES)}.`); return; }
    setSending(true);
    try {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("section", section);
      fd.set("subject", subject);
      fd.set("message", message);
      fd.set("page", from);
      fd.set("copyTo", copyTo.trim());
      files.forEach((f) => fd.append("files", f));
      const res = await fetch("/api/support", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({ ok: false, error: res.status === 413 ? "The files are too big." : "Something went wrong. Please try again." }));
      if (!data.ok) { setError(data.error); return; }
      setSentTo(data.replyTo || "your email");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  const reset = () => { setSentTo(null); setSubject(""); setMessage(""); setCopyTo(""); setFiles([]); setKind(SUPPORT_KINDS[0]); };

  const field = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-[#1E2840] dark:bg-[#0F1626] dark:text-slate-100";
  const label = "mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300";

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><LifeBuoy size={20} className="text-blue-600" /> Help &amp; support</h1>
        <p className="mt-1 text-sm text-slate-500">Tell us what&apos;s up and we&apos;ll reply by email.</p>
        <a href="/guide" className="mt-3 flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 hover:bg-blue-100">
          <span><b>New to Wyndos?</b> The getting started guide walks through setup step by step.</span>
          <span className="font-semibold">Open →</span>
        </a>
      </div>

      {sentTo ? (
        <Card>
          <CardContent className="space-y-3 py-6 text-center">
            <CheckCircle2 size={36} className="mx-auto text-green-600" />
            <p className="font-semibold text-slate-800 dark:text-slate-100">Message sent</p>
            <p className="text-sm text-slate-500">We&apos;ll reply to {sentTo}, usually within a working day.</p>
            <Button variant="outline" onClick={reset}>Send another</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-5">
            <form onSubmit={send} className="space-y-4">
              <div role="radiogroup" aria-label="What is it about" className="grid gap-1.5 sm:grid-cols-3">
                {SUPPORT_KINDS.map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                    className={`rounded-lg border px-2.5 py-2 text-sm font-medium ${kind === k ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" : "border-slate-200 text-slate-600 hover:border-slate-300 dark:border-[#1E2840] dark:text-slate-300"}`}>
                    {k}
                  </button>
                ))}
              </div>

              <div>
                <label className={label} htmlFor="support-section">Part of Wyndos <span className="font-normal text-slate-400">(optional)</span></label>
                <select id="support-section" value={section} onChange={(e) => setSection(e.target.value)} className={field}>
                  <option value="">Not sure / general</option>
                  {SUPPORT_SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label className={label} htmlFor="support-subject">Subject</label>
                <input id="support-subject" required maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)}
                  placeholder={kind === SUPPORT_KINDS[0] ? "e.g. Can't move a job to Friday" : "A few words"} className={field} />
              </div>

              <div>
                <label className={label} htmlFor="support-message">Message</label>
                <textarea id="support-message" required rows={6} maxLength={10000} value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder={kind === SUPPORT_KINDS[0] ? "What did you do, what did you expect, and what happened instead?" : "Tell us more"} className={field} />
              </div>

              <div>
                <label className={label} htmlFor="support-copy">Also send replies to <span className="font-normal text-slate-400">(optional)</span></label>
                <input id="support-copy" type="email" inputMode="email" autoComplete="email" value={copyTo} onChange={(e) => setCopyTo(e.target.value)}
                  placeholder="e.g. office@yourbusiness.co.uk" className={field} />
                <p className="mt-1 text-[11px] text-slate-400">We always reply to your login email; add another address to copy it in.</p>
              </div>

              <div>
                <p className={label}>Screenshots or files <span className="font-normal text-slate-400">(optional, up to {SUPPORT_MAX_FILES} files, {mb(SUPPORT_MAX_BYTES).replace(".0", "")} total)</span></p>
                <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
                <button type="button" onClick={() => fileInput.current?.click()} disabled={files.length >= SUPPORT_MAX_FILES}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm font-medium text-slate-600 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50 dark:border-[#2a3756] dark:text-slate-300 dark:hover:bg-[#131929]">
                  <Paperclip size={15} /> Attach files
                </button>
                {files.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {files.map((f, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs dark:bg-[#131929]">
                        <span className="truncate text-slate-700 dark:text-slate-200">{f.name}</span>
                        <span className="flex flex-shrink-0 items-center gap-2 text-slate-400">
                          {mb(f.size)}
                          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="rounded p-0.5 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-[#1E2840]"><X size={13} /></button>
                        </span>
                      </li>
                    ))}
                    <li className={`text-right text-[11px] ${total > SUPPORT_MAX_BYTES ? "font-semibold text-red-600" : "text-slate-400"}`}>{mb(total)} of {mb(SUPPORT_MAX_BYTES).replace(".0", "")}</li>
                  </ul>
                )}
              </div>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

              <Button type="submit" disabled={sending} className="w-full">{sending ? "Sending…" : "Send to support"}</Button>
              <p className="text-center text-[11px] text-slate-400">Your name, business and the page you came from are included so we can help faster.</p>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
