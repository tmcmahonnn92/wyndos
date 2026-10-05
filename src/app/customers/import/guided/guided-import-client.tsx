"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { aiReadSheet, importWithPlan, planRows, type ImportField, type PlannedArea, type SheetLayout } from "@/lib/area-planner";
import { parseSpreadsheetFile, parsePrice, parseUkDate } from "@/lib/import-parsing";
import { collectKnownTowns, composeAddress, splitAddress } from "@/lib/address";
import { AreaPlanReview, emptyQuestions, inputClass, PlannerQuestions, toAnswers, type ReviewCustomer } from "@/components/area-plan";
import { PlanButtons } from "@/app/customers/organise/organise-client";
import { AREA_SORT_ENABLED } from "@/lib/features";
import { cn, fmtCurrency } from "@/lib/utils";

type Step = "upload" | "check" | "areas" | "review" | "done";

const FIELD_LABELS: Array<[ImportField, string]> = [
  ["name", "Name"], ["fullAddress", "Full address"], ["houseNumber", "House number"], ["street", "Street"], ["town", "Town"], ["postcode", "Postcode"],
  ["price", "Price"], ["frequency", "How often"], ["lastCleaned", "Last cleaned"], ["nextDue", "Next due"],
  ["phone", "Phone"], ["email", "Email"], ["payment", "Usually pays by"], ["area", "Area / round"], ["notes", "Notes"],
];

type Clean = {
  name: string;
  address: string;
  houseNameNumber: string;
  street: string;
  town: string;
  postcode: string;
  price: number | null;
  frequencyWeeks: number | null;
  lastCleaned: string;
  nextDue: string;
  phone: string;
  email: string;
  payment: string;
  area: string;
  notes: string;
};

function addWeeks(iso: string, weeks: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/** Read one cell as a date, using the order the AI spotted (UK by default). */
function readDate(value: string, order: "DMY" | "MDY") {
  const v = value.trim();
  if (order === "MDY") {
    const m = v.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
    if (m) return parseUkDate(`${m[2]}/${m[1]}/${m[3]}`);
  }
  return parseUkDate(v);
}

function readFrequency(value: string, map: Record<string, number>) {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (map[v]) return map[v];
  if (/month/.test(v)) return 4 * (Number(v.match(/\d+/)?.[0]) || 1);
  const n = Number(v.match(/\d+/)?.[0]);
  return n > 0 && n <= 52 ? n : null;
}

/** Turn the sheet into tidy customers with the layout the owner agreed. */
function cleanRows(rows: string[][], layout: SheetLayout): Clean[] {
  const col = (row: string[], f: ImportField) => (layout.columns[f] >= 0 ? String(row[layout.columns[f]] ?? "").trim() : "");
  const towns = collectKnownTowns(rows.map((r) => col(r, "fullAddress")).filter(Boolean));
  const out: Clean[] = [];
  for (const row of rows) {
    const full = col(row, "fullAddress");
    const split = full && !col(row, "street") ? splitAddress(full, towns) : null;
    const houseNameNumber = split?.houseNameNumber ?? col(row, "houseNumber");
    const street = split?.street ?? col(row, "street");
    const town = split?.town ?? col(row, "town");
    const postcode = (split?.postcode || col(row, "postcode")).toUpperCase();
    const address = full || composeAddress({ houseNameNumber, street, town, postcode });
    const name = col(row, "name") || address;
    if (!name && !address) continue; // blank row
    const priceText = parsePrice(col(row, "price").replace(/[^0-9.,£]/g, ""));
    const frequencyWeeks = readFrequency(col(row, "frequency"), layout.frequencyMap);
    const lastCleaned = readDate(col(row, "lastCleaned"), layout.dateOrder);
    let nextDue = readDate(col(row, "nextDue"), layout.dateOrder);
    if (!nextDue && lastCleaned && frequencyWeeks) nextDue = addWeeks(lastCleaned, frequencyWeeks);
    const payText = col(row, "payment").toLowerCase();
    out.push({
      name, address, houseNameNumber, street, town, postcode,
      price: priceText === "" ? null : Number(priceText),
      frequencyWeeks, lastCleaned, nextDue,
      phone: col(row, "phone"), email: col(row, "email"),
      payment: payText ? layout.paymentMap[payText] ?? "" : "",
      area: col(row, "area"), notes: col(row, "notes"),
    });
  }
  return out;
}

export function GuidedImportClient() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [layout, setLayout] = useState<SheetLayout | null>(null);
  const [defaultPrice, setDefaultPrice] = useState("");
  const [defaultFreq, setDefaultFreq] = useState("4");
  const [useSheetAreas, setUseSheetAreas] = useState(false);
  const [questions, setQuestions] = useState(emptyQuestions);
  const [plan, setPlan] = useState<PlannedArea[] | null>(null);
  const [bookRuns, setBookRuns] = useState(true);
  const [result, setResult] = useState<{ created: number; skipped: number; areasCreated: number } | null>(null);

  const cleaned = useMemo(() => (layout ? cleanRows(rows, layout) : []), [rows, layout]);
  const ready = useMemo(() => cleaned.map((c) => ({
    ...c,
    price: c.price ?? (Number(defaultPrice) >= 0 && defaultPrice !== "" ? Number(defaultPrice) : null),
    frequencyWeeks: c.frequencyWeeks ?? (Number(defaultFreq) > 0 ? Number(defaultFreq) : 4),
  })), [cleaned, defaultPrice, defaultFreq]);
  const issues = useMemo(() => ({
    noPrice: cleaned.filter((c) => c.price === null).length,
    noFreq: cleaned.filter((c) => c.frequencyWeeks === null).length,
    noAddress: cleaned.filter((c) => !c.address).length,
    noDue: cleaned.filter((c) => !c.nextDue).length,
  }), [cleaned]);
  const stillMissingPrice = ready.filter((c) => c.price === null).length;

  const reviewCustomers = useMemo(() => new Map<number, ReviewCustomer>(ready.map((c, i) => [i, {
    id: i,
    label: [c.name, [c.street, c.town].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "No name",
    postcode: c.postcode,
    price: c.price ?? 0,
    nextDue: c.nextDue || null,
  }])), [ready]);

  const readFile = (file: File) => {
    setError("");
    start(async () => {
      try {
        const sheet = await parseSpreadsheetFile(file);
        if (sheet.rows.length === 0) throw new Error("That sheet looks empty.");
        // Distinct values of short columns (e.g. frequency, payment): helps the AI read them, nothing personal.
        const shortValues: Record<number, string[]> = {};
        sheet.headers.forEach((_, i) => {
          const values = [...new Set(sheet.rows.map((r) => String(r[i] ?? "").trim()).filter(Boolean))];
          const avg = values.reduce((s, v) => s + v.length, 0) / Math.max(1, values.length);
          if (values.length > 0 && values.length <= 30 && avg <= 20 && values.length < sheet.rows.length / 2) shortValues[i] = values;
        });
        const read = await aiReadSheet({ headers: sheet.headers, sample: sheet.rows.slice(0, 5), shortValues });
        setHeaders(sheet.headers);
        setRows(sheet.rows);
        setLayout(read);
        setUseSheetAreas(read.columns.area >= 0);
        setStep("check");
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Couldn't read that file.");
      }
    });
  };

  const makePlan = (useAi: boolean) => {
    setError("");
    start(async () => {
      try {
        const areas = await planRows({
          rows: ready.map((c) => ({ street: c.street, town: c.town, postcode: c.postcode, price: c.price ?? 0, frequencyWeeks: c.frequencyWeeks ?? 4, nextDue: c.nextDue || null })),
          answers: toAnswers(questions),
          useAi,
        });
        setPlan(areas);
        setStep("review");
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Couldn't make a plan.");
      }
    });
  };

  const doImport = () => {
    setError("");
    const areaOf = new Map<number, string>();
    const freqOfArea = new Map<string, number>();
    const sheetAreas = useSheetAreas || !AREA_SORT_ENABLED;
    if (!sheetAreas && plan) {
      for (const a of plan) {
        for (const id of a.customerIds) areaOf.set(id, a.name.trim());
        const counts = new Map<number, number>();
        for (const id of a.customerIds) { const f = ready[id]?.frequencyWeeks ?? 4; counts.set(f, (counts.get(f) ?? 0) + 1); }
        freqOfArea.set(a.name.trim(), [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 4);
      }
    }
    const records = ready.map((c, i) => {
      let areaName = sheetAreas ? c.area || "Imported" : areaOf.get(i) || "Imported";
      // Everyone in an area shares its cycle: someone on a different frequency gets "<area> N weekly".
      const areaFreq = freqOfArea.get(areaName);
      if (!sheetAreas && areaFreq && c.frequencyWeeks && c.frequencyWeeks !== areaFreq) {
        areaName = `${areaName} ${c.frequencyWeeks} weekly`;
        freqOfArea.set(areaName, c.frequencyWeeks);
      }
      return {
        name: c.name,
        address: c.street ? "" : c.address,
        houseNameNumber: c.houseNameNumber,
        street: c.street,
        town: c.town,
        postcode: c.postcode,
        price: c.price ?? 0,
        areaName,
        areaFrequencyWeeks: freqOfArea.get(areaName) ?? c.frequencyWeeks ?? 4,
        frequencyWeeks: c.frequencyWeeks ?? 4,
        email: c.email,
        phone: c.phone,
        notes: c.notes,
        preferredPaymentMethod: c.payment,
        nextDueDate: c.nextDue || undefined,
        lastCompletedDate: c.lastCleaned || undefined,
      };
    });
    start(async () => {
      try {
        const r = await importWithPlan({ records, daysEarly: toAnswers(questions).daysEarly, bookRuns });
        setResult({ created: r.created, skipped: r.skipped, areasCreated: r.areasCreated.length });
        setRows([]);
        setStep("done");
        router.refresh();
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Couldn't import.");
      }
    });
  };

  const errorBox = error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;

  if (step === "upload") {
    return (
      <div className="space-y-3">
        {errorBox}
        <label className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center hover:border-blue-300", pending && "opacity-60")}>
          <Upload size={32} className="text-slate-300" />
          <span className="text-sm font-semibold text-slate-700">{pending ? "Reading your sheet… (up to a minute)" : "Choose your customer spreadsheet"}</span>
          <span className="text-xs text-slate-400">.xlsx, .xls or .csv, any layout</span>
          <input type="file" className="hidden" disabled={pending} accept=".csv,.txt,.xlsx,.xls,.ods"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) readFile(f); }} />
        </label>
        <p className="text-xs text-slate-500">
          To work out your columns, your column headings and the first 5 rows are sent to Anthropic (Claude), plus the different values in short columns like &ldquo;how often&rdquo;. The rest of your list is read on this device.
        </p>
      </div>
    );
  }

  if (step === "check" && layout) {
    return (
      <div className="space-y-4">
        {errorBox}
        {layout.notes.length > 0 && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            <p className="font-semibold">What we noticed</p>
            <ul className="mt-1 list-disc pl-5 text-xs">{layout.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm font-semibold text-slate-800">Your columns</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {FIELD_LABELS.map(([field, label]) => (
              <label key={field} className="flex items-center gap-2 text-sm">
                <span className="w-28 flex-shrink-0 text-slate-600">{label}</span>
                <select value={layout.columns[field]} onChange={(e) => setLayout({ ...layout, columns: { ...layout.columns, [field]: Number(e.target.value) } })}
                  className={cn("min-w-0 flex-1 rounded-lg border bg-white px-2 py-1.5 text-sm", layout.columns[field] >= 0 ? "border-green-300" : "border-slate-200 text-slate-400")}>
                  <option value={-1}>Not in my sheet</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
          <p className="text-sm font-semibold text-slate-800">{cleaned.length} customers found</p>
          <ul className="space-y-1 text-sm">
            {[
              [issues.noAddress, "with no address"],
              [issues.noPrice, "with no price"],
              [issues.noFreq, "with no frequency"],
              [issues.noDue, "with no due date (they'll show as due now)"],
            ].map(([n, text]) => (Number(n) > 0 ? (
              <li key={String(text)} className="flex items-center gap-2 text-amber-800"><AlertTriangle size={14} /> {n} {text}</li>
            ) : null))}
            {issues.noAddress + issues.noPrice + issues.noFreq + issues.noDue === 0 && <li className="flex items-center gap-2 text-green-700"><CheckCircle2 size={14} /> Everything looks complete</li>}
          </ul>
          {issues.noPrice > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-700">Price for those without one (£)
              <input type="number" min={0} step="0.01" value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} className={cn(inputClass, "w-28")} placeholder="e.g. 12" />
            </label>
          )}
          {issues.noFreq > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-700">Weeks between cleans, for those without
              <input type="number" min={1} max={52} value={defaultFreq} onChange={(e) => setDefaultFreq(e.target.value)} className={cn(inputClass, "w-20")} />
            </label>
          )}
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1">Name</th><th className="px-2 py-1">Address</th><th className="px-2 py-1">Price</th><th className="px-2 py-1">Every</th><th className="px-2 py-1">Next due</th></tr></thead>
              <tbody>
                {ready.slice(0, 6).map((c, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2 py-1">{c.name}</td>
                    <td className="px-2 py-1">{[c.houseNameNumber, c.street, c.town, c.postcode].filter(Boolean).join(", ") || c.address}</td>
                    <td className="px-2 py-1">{c.price === null ? "—" : fmtCurrency(c.price)}</td>
                    <td className="px-2 py-1">{c.frequencyWeeks}w</td>
                    <td className="px-2 py-1">{c.nextDue || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex gap-2">
          <button type="button" onClick={() => { setStep("upload"); setRows([]); setLayout(null); }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Start again</button>
          <button type="button" disabled={stillMissingPrice > 0 || cleaned.length === 0} onClick={() => setStep("areas")}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {stillMissingPrice > 0 ? "Add a price for those without one" : "Looks right, next"}
          </button>
        </div>
      </div>
    );
  }

  if (step === "areas") {
    return (
      <div className="space-y-4">
        {errorBox}
        {!AREA_SORT_ENABLED && (
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            {layout && layout.columns.area >= 0 ? "We'll use the areas in your sheet." : "Everyone goes into one area called \"Imported\". You can move them into your own areas after."}
          </p>
        )}
        {AREA_SORT_ENABLED && layout && layout.columns.area >= 0 && (
          <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-800">Your sheet already has areas. What would you like?</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {([[true, "Keep my areas", "Use the area names in the sheet"], [false, "Suggest new areas", "Sort everyone into a day's work each"]] as const).map(([v, t, d]) => (
                <button key={String(v)} type="button" onClick={() => setUseSheetAreas(v)} className={cn("rounded-xl border p-3 text-left", useSheetAreas === v ? "border-blue-500 bg-blue-50" : "border-slate-200")}>
                  <span className="block text-sm font-semibold text-slate-800">{t}</span>
                  <span className="block text-xs text-slate-500">{d}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {useSheetAreas || !AREA_SORT_ENABLED ? (
          <ImportBar pending={pending} count={ready.length} bookRuns={bookRuns} setBookRuns={setBookRuns} onBack={() => setStep("check")} onImport={doImport} />
        ) : (
          <>
            <PlannerQuestions value={questions} onChange={setQuestions} />
            <PlanButtons aiAvailable pending={pending} onPlan={makePlan} />
            <button type="button" onClick={() => setStep("check")} className="text-sm text-slate-500 underline">Back</button>
          </>
        )}
      </div>
    );
  }

  if (step === "review" && plan) {
    return (
      <div className="space-y-3 pb-28">
        {errorBox}
        <p className="text-sm text-slate-600">{plan.length} areas. Rename them, or open one to move a customer. Nothing is saved until you import.</p>
        <AreaPlanReview plan={plan} customers={reviewCustomers} onChange={setPlan} />
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-3xl">
            <ImportBar pending={pending} count={ready.length} bookRuns={bookRuns} setBookRuns={setBookRuns} onBack={() => setStep("areas")} onImport={doImport} />
          </div>
        </div>
      </div>
    );
  }

  if (step === "done" && result) {
    return (
      <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50 p-5">
        <p className="font-semibold text-green-900">
          {result.created} customers imported{result.areasCreated ? ` into ${result.areasCreated} new areas` : ""}.
          {result.skipped ? ` ${result.skipped} were already in Wyndos and left as they were.` : ""}
        </p>
        <div className="flex gap-2">
          <a href="/scheduler" className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white">Open scheduler</a>
          <a href="/customers" className="rounded-lg border border-green-300 px-4 py-2 text-sm font-semibold text-green-800">See customers</a>
        </div>
      </div>
    );
  }

  return null;
}

function ImportBar({ pending, count, bookRuns, setBookRuns, onBack, onImport }: {
  pending: boolean; count: number; bookRuns: boolean; setBookRuns: (v: boolean) => void; onBack: () => void; onImport: () => void;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={bookRuns} onChange={(e) => setBookRuns(e.target.checked)} />
        Put each area&apos;s next run on the schedule from the due dates
      </label>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">Back</button>
        <p className="flex-1 text-xs text-slate-500">{count} customers</p>
        <button type="button" onClick={onImport} disabled={pending} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "Importing…" : "Import"}
        </button>
      </div>
    </div>
  );
}
