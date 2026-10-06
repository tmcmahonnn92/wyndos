"use client";

import { fillPlaceholders } from "@/lib/text-format";

/** Placeholders that can go in any text. Filled in per customer when it's sent. */
export const TEXT_PLACEHOLDERS = [
  { label: "First name", value: "{{customerFirstName}}" },
  { label: "Full name", value: "{{customerName}}" },
  { label: "Address", value: "{{customerAddress}}" },
  { label: "Area", value: "{{areaName}}" },
  { label: "Date", value: "{{jobDate}}" },
  { label: "Cleaner", value: "{{workerName}}" },
  { label: "Price", value: "{{jobPrice}}" },
  { label: "Owes", value: "{{amountDue}}" },
  { label: "Next due", value: "{{nextDueDate}}" },
  { label: "Bank details", value: "{{bankDetails}}" },
  { label: "Pay reference", value: "{{paymentReference}}" },
  { label: "Business", value: "{{businessName}}" },
  { label: "Business phone", value: "{{businessPhone}}" },
];

export function fillTemplate(template: string, vars: Record<string, string | undefined>) {
  // Every known placeholder is filled (blank if there's no value for this customer).
  const all: Record<string, string | undefined> = Object.fromEntries(TEXT_PLACEHOLDERS.map((p) => [p.value.slice(2, -2), ""]));
  return fillPlaceholders(template, { ...all, ...vars });
}

/** Insert a placeholder at the cursor of a textarea. */
export function insertAtCursor(el: HTMLTextAreaElement | null, value: string, text: string, set: (v: string) => void) {
  if (!el) return set(value + text);
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  set(value.slice(0, start) + text + value.slice(end));
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
  });
}

export function PlaceholderButtons({ onInsert, only }: { onInsert: (value: string) => void; only?: string[] }) {
  const list = only ? TEXT_PLACEHOLDERS.filter((p) => only.includes(p.value)) : TEXT_PLACEHOLDERS;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onInsert(p.value)}
          className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
        >
          + {p.label}
        </button>
      ))}
    </div>
  );
}

/** SMS are billed per 160 characters (fewer if the text has emoji). */
export function smsParts(text: string) {
  // eslint-disable-next-line no-control-regex
  const unicode = /[^\x00-\x7F£€]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  if (text.length <= single) return 1;
  return Math.ceil(text.length / multi);
}

export function TestModeBanner({ live }: { live: boolean }) {
  return live ? (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
      Live: customers will receive these texts.
    </p>
  ) : (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <strong>Test mode:</strong> nothing is sent to customers. Each text goes in the log so you can check it.
    </p>
  );
}

/** "Start from a saved template" picker for any text box. */
export function TemplatePicker({
  templates,
  onPick,
}: {
  templates: Array<{ key: string; label: string; body: string }>;
  onPick: (body: string) => void;
}) {
  if (templates.length === 0) return null;
  return (
    <select
      value=""
      onChange={(e) => {
        const t = templates.find((x) => x.key === e.target.value);
        if (t) onPick(t.body);
      }}
      aria-label="Start from a template"
      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700"
    >
      <option value="">Start from a template…</option>
      {templates.map((t) => (
        <option key={t.key} value={t.key}>{t.label}</option>
      ))}
    </select>
  );
}
