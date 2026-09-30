"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Send } from "lucide-react";
import { getDayReminderRecipients, getTextSetup, sendDayReminders } from "@/lib/text-actions";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { PlaceholderButtons, TemplatePicker, TestModeBanner, fillTemplate, insertAtCursor, smsParts } from "@/components/text-placeholders";
import { PhoneSendQueue, SendMethodToggle, type PhoneText } from "@/components/phone-send-queue";
import { getPhoneOutbox } from "@/lib/text-actions";

type Recipient = Awaited<ReturnType<typeof getDayReminderRecipients>>[number];

/**
 * "We're cleaning your windows tomorrow" texts for everyone still to do on the day.
 * Starts from the saved wording; edit it each time if you like.
 */
export function TextRemindersModal({
  open,
  onClose,
  workDayIds,
  canSaveDefault,
}: {
  open: boolean;
  onClose: () => void;
  workDayIds: number[];
  canSaveDefault: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [method, setMethod] = useState<"PHONE" | "VOODOO">("PHONE");
  const [phoneItems, setPhoneItems] = useState<PhoneText[] | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [template, setTemplate] = useState("");
  const [templates, setTemplates] = useState<Array<{ key: string; label: string; body: string }>>([]);
  const [saveDefault, setSaveDefault] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const idsKey = workDayIds.join(",");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setResult(null);
    setError(null);
    setPhoneItems(null);
    Promise.all([getTextSetup(), getDayReminderRecipients(idsKey.split(",").map(Number))])
      .then(([setup, list]) => {
        if (cancelled) return;
        setLive(setup.live);
        setMethod(setup.sendMethod);
        setTemplate(setup.dayReminderTemplate);
        setTemplates(setup.templates);
        setRecipients(list);
        // Anyone already reminded for this day starts unticked, so nobody gets it twice.
        setPicked(new Set(list.filter((r) => r.to && !r.reminded).map((r) => r.customerId)));
      })
      .catch((issue) => !cancelled && setError(issue instanceof Error ? issue.message : "Could not load customers."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [open, idsKey]);

  const chosen = recipients.filter((r) => r.to && picked.has(r.customerId));
  const noMobile = recipients.filter((r) => !r.to).length;
  const alreadyTexted = recipients.filter((r) => r.reminded).length;
  const remindedLabel = (r: Recipient) => {
    if (!r.reminded) return null;
    if (r.reminded.waiting) return "Waiting on phone";
    return `Texted ${new Date(r.reminded.at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
  };
  const sample = chosen[0];
  const preview = sample ? fillTemplate(template, sample.vars as Record<string, string>) : "";

  const send = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await sendDayReminders({
          workDayIds: idsKey.split(",").map(Number),
          customerIds: [...picked],
          template,
          saveAsDefault: saveDefault,
          method,
        });
        if (r.phone) {
          setPhoneItems(await getPhoneOutbox({ ids: r.ids }));
          return;
        }
        setResult(`${r.logged} reminder${r.logged === 1 ? "" : "s"} ${r.test ? "written to the text log (test mode, nothing sent)" : "sent"}${r.failed ? `, ${r.failed} failed` : ""}.`);
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Could not send.");
      }
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Text reminders">
      <div className="space-y-3">
        {phoneItems ? null : method === "VOODOO" ? <TestModeBanner live={live} /> : (
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
            Sends from your own phone, one tap each. Free on your phone plan; replies come to you.
          </p>
        )}
        {phoneItems ? (
          <PhoneSendQueue items={phoneItems} onFinished={(n) => setResult(`${n} reminder${n === 1 ? "" : "s"} opened to send from your phone.`)} />
        ) : loading ? (
          <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
        ) : result ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{result}</p>
            <div className="flex gap-2">
              <a href="/messages?tab=log" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-center text-sm font-semibold text-slate-700">See the log</a>
              <Button className="flex-1" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <SendMethodToggle value={method} onChange={setMethod} />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Message</label>
              <div className="mb-1.5"><TemplatePicker templates={templates} onPick={setTemplate} /></div>
              <textarea
                ref={textRef}
                rows={4}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <PlaceholderButtons
                onInsert={(v) => insertAtCursor(textRef.current, template, v, setTemplate)}
                only={["{{customerFirstName}}", "{{jobDate}}", "{{workerName}}", "{{jobPrice}}", "{{amountDue}}", "{{customerAddress}}", "{{bankDetails}}", "{{paymentReference}}", "{{businessName}}", "{{businessPhone}}"]}
              />
              {canSaveDefault && (
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} />
                  Use this wording next time too
                </label>
              )}
            </div>

            {preview && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  {sample?.name} · {smsParts(preview)} credit{smsParts(preview) === 1 ? "" : "s"}
                </p>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{preview}</p>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">
                  {chosen.length} of {recipients.length} chosen{noMobile > 0 && ` · ${noMobile} no mobile`}{alreadyTexted > 0 && ` · ${alreadyTexted} already texted`}
                </span>
                <span className="flex gap-3">
                  {alreadyTexted > 0 && (
                    <button type="button" className="font-semibold text-blue-600" onClick={() => setPicked(new Set(recipients.filter((r) => r.to && !r.reminded).map((r) => r.customerId)))}>Not texted yet</button>
                  )}
                  <button type="button" className="font-semibold text-blue-600" onClick={() => setPicked(new Set(recipients.filter((r) => r.to).map((r) => r.customerId)))}>All</button>
                  <button type="button" className="text-slate-500" onClick={() => setPicked(new Set())}>None</button>
                </span>
              </div>
              <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-slate-100 p-1">
                {recipients.map((r) => (
                  <label key={r.customerId} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${r.to ? "cursor-pointer hover:bg-slate-50" : "opacity-50"}`}>
                    <input
                      type="checkbox"
                      disabled={!r.to}
                      checked={Boolean(r.to) && picked.has(r.customerId)}
                      onChange={(e) => setPicked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(r.customerId);
                        else next.delete(r.customerId);
                        return next;
                      })}
                    />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    {remindedLabel(r) && (
                      <span className="flex-shrink-0 rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 ring-1 ring-green-200">{remindedLabel(r)}</span>
                    )}
                    <span className="text-[11px] text-slate-400">{r.to ? r.phone : "no mobile"}</span>
                  </label>
                ))}
                {recipients.length === 0 && <p className="py-4 text-center text-sm text-slate-400">No one left to do on this day.</p>}
              </div>
            </div>

            {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex gap-2">
              <Button className="flex-1" onClick={send} disabled={isPending || chosen.length === 0 || !template.trim()}>
                <Send size={14} />
                {isPending ? "Preparing…" : method === "PHONE" ? `Start sending ${chosen.length} from my phone` : `${live ? "Send" : "Test send"} ${chosen.length}`}
              </Button>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
