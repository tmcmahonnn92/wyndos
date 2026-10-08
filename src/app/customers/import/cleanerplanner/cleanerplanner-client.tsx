"use client";

import { useMemo, useState } from "react";
import { unzipSync, strFromU8 } from "fflate";
import { ArrowLeftRight, CheckCircle2, FileArchive, Loader2, Upload } from "lucide-react";
import { pickFiles, readBackup, type CpBackup, type CpCustomer } from "@/lib/cleanerplanner/parse";
import { NotImportedList } from "@/components/not-imported-list";
import { finishCpImport, importCpCustomers, importCpHistory, type CpHistoryItem, type CpImportRow } from "@/lib/cleanerplanner/actions";
import { cn, fmtCurrency } from "@/lib/utils";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ukDate = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

async function readFiles(list: FileList): Promise<Array<{ name: string; text: string }>> {
  const out: Array<{ name: string; text: string }> = [];
  for (const f of Array.from(list)) {
    if (/\.zip$/i.test(f.name)) {
      const entries = unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: (e) => /\.csv$/i.test(e.name) });
      for (const [name, data] of Object.entries(entries)) out.push({ name, text: strFromU8(data) });
    } else if (/\.csv$/i.test(f.name)) {
      out.push({ name: f.name, text: await f.text() });
    }
  }
  return out;
}

type Options = { inactive: boolean; balances: boolean; history: boolean; bookRuns: boolean; flip: boolean };
type Result = { created: number; skipped: number; oneOffs: number; areas: string[]; owed: number; credit: number; cleans: number; payments: number; runs: number; errors: string[] };

export function CleanerPlannerImport() {
  const [backup, setBackup] = useState<CpBackup | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [opts, setOpts] = useState<Options>({ inactive: true, balances: true, history: true, bookRuns: true, flip: false });
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  const load = async (list: FileList | null) => {
    if (!list?.length) return;
    // Read the name now: the file box is cleared straight after this starts.
    const label = list.length === 1 ? list[0].name : `${list.length} files`;
    setError(""); setBackup(null); setResult(null);
    try {
      const files = pickFiles(await readFiles(list));
      const b = readBackup(files);
      if (b.customers.length === 0) throw new Error("No jobs found in this backup.");
      setBackup(b);
      setFileName(label);
      setOpts((o) => ({ ...o, history: b.txns.length > 0, flip: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    }
  };

  // Positive Balance = owes, unless the history says otherwise or they swap it.
  const sign = ((backup?.balanceSign ?? 1) * (opts.flip ? -1 : 1)) as 1 | -1;
  const chosen = useMemo(() => (backup ? backup.customers.filter((c) => opts.inactive || c.active) : []), [backup, opts.inactive]);
  // Extra services (gutters, conservatory roofs…) on a repeat can come in as one-offs instead.
  const [oneOffServices, setOneOffServices] = useState<Set<string>>(new Set());
  const extras = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of chosen) counts.set(c.jobName, (counts.get(c.jobName) ?? 0) + 1);
    const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return [...counts.entries()].filter(([name]) => name !== main).map(([name]) => ({
      name, repeat: chosen.filter((c) => c.jobName === name && c.scheduled).length,
    })).filter((e) => e.repeat > 0);
  }, [chosen]);
  const repeats = (c: CpCustomer) => c.scheduled && !oneOffServices.has(c.jobName);
  const oneOffCount = chosen.filter((c) => !repeats(c)).length;
  const areaList = useMemo(() => {
    const m = new Map<string, { name: string; frequencyWeeks: number; customers: number }>();
    for (const c of chosen) {
      if (!repeats(c)) continue;
      const a = m.get(c.areaName) ?? { name: c.areaName, frequencyWeeks: c.frequencyWeeks, customers: 0 };
      a.customers++;
      m.set(c.areaName, a);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, oneOffServices]);
  const owedNow = (c: CpCustomer) => Math.round(sign * c.balance * 100) / 100;
  const totals = useMemo(() => {
    let owed = 0, credit = 0, owing = 0, inCredit = 0;
    for (const c of chosen) {
      const b = owedNow(c);
      if (b > 0.004) { owed += b; owing++; } else if (b < -0.004) { credit -= b; inCredit++; }
    }
    return { owed, credit, owing, inCredit };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, sign]);
  const biggest = useMemo(() => [...chosen].filter((c) => Math.abs(c.balance) > 0.004).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))[0], [chosen]);

  const run = async () => {
    if (!backup) return;
    setError(""); setProgress(0);
    const useHistory = opts.history && backup.txns.length > 0;
    try {
      // 1. Customers. With history, the balance comes from the history plus CleanerPlanner's
      //    starting balance; without it, from today's balance.
      const firstTxn = new Map<string, string>();
      for (const t of backup.txns) if (!firstTxn.has(t.jobKey)) firstTxn.set(t.jobKey, t.date);
      const rows: CpImportRow[] = chosen.map((c) => {
        const opening = !opts.balances ? 0 : useHistory ? sign * c.startingBalance : sign * c.balance;
        const openingDate = useHistory
          ? c.startingBalanceDate || firstTxn.get(c.key) || c.lastCompletedDate
          : c.lastCompletedDate;
        return {
          key: c.key, name: c.name, address: c.address, houseNameNumber: c.houseNameNumber, street: c.street, town: c.town,
          postcode: c.postcode, phone: c.phone, email: c.email, latitude: c.latitude, longitude: c.longitude,
          areaName: c.areaName, frequencyWeeks: c.frequencyWeeks, price: c.price, jobName: c.jobName,
          preferredPaymentMethod: c.preferredPaymentMethod, notes: c.notes, nextDueDate: c.nextDueDate,
          lastCompletedDate: c.lastCompletedDate, sortOrder: c.sortOrder, active: c.active, scheduled: repeats(c),
          openingBalance: Math.round(opening * 100) / 100, openingDate: openingDate || "",
        };
      });
      const ids: Record<string, number> = {};
      const areaIds = new Set<number>();
      const res: Result = { created: 0, skipped: 0, oneOffs: 0, areas: [], owed: 0, credit: 0, cleans: 0, payments: 0, runs: 0, errors: [] };
      const chosenKeys = new Set(chosen.map((c) => c.key));
      const historyItems: CpHistoryItem[] = useHistory ? backup.txns.filter((t) => chosenKeys.has(t.jobKey)).map((t) => ({
        customerId: 0, kind: t.kind, date: t.date, amount: t.amount, method: t.method, note: t.note, key: t.jobKey,
      })) as Array<CpHistoryItem & { key: string }> : [];
      const steps = Math.ceil(rows.length / 250) + Math.ceil(historyItems.length / 1500) + 1;
      let done = 0;
      const tick = () => setProgress(Math.round((++done / steps) * 100));

      setBusy("Adding customers…");
      for (let i = 0; i < rows.length; i += 250) {
        const r = await importCpCustomers(rows.slice(i, i + 250));
        Object.assign(ids, r.ids);
        r.datedAreaIds.forEach((id) => areaIds.add(id));
        res.created += r.created; res.skipped += r.skipped; res.oneOffs += r.oneOffs; res.areas.push(...r.areasCreated);
        res.owed += r.owedTotal; res.credit += r.creditTotal; res.errors.push(...r.errors);
        tick();
      }

      // 2. History: every clean first, then every payment (payments clear the oldest cleans).
      if (historyItems.length) {
        setBusy("Bringing in past cleans and payments…");
        const linked = (historyItems as Array<CpHistoryItem & { key: string }>)
          .filter((h) => ids[h.key])
          .map(({ key, ...h }) => ({ ...h, customerId: ids[key] }));
        const ordered = [...linked.filter((h) => h.kind === "charge"), ...linked.filter((h) => h.kind === "payment")];
        for (let i = 0; i < ordered.length; i += 1500) {
          const r = await importCpHistory(ordered.slice(i, i + 1500));
          res.cleans += r.cleans; res.payments += r.payments; res.errors.push(...r.skippedItems);
          tick();
        }
      }

      setBusy("Finishing…");
      const fin = await finishCpImport([...areaIds], opts.bookRuns);
      res.runs = fin.runs.length;
      setProgress(100);
      setResult(res);
      setBackup(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import stopped. Anything already added is still there; running it again skips them.");
    } finally {
      setBusy("");
    }
  };

  if (result) {
    return (
      <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50 p-5 text-sm text-green-900">
        <p className="flex items-center gap-2 text-base font-semibold"><CheckCircle2 size={18} /> Moved across</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>{result.created} customers added{result.areas.length ? ` into ${result.areas.length} new areas` : ""}.</li>
          {result.oneOffs > 0 && <li>{result.oneOffs} of them are one-offs (no repeat): <a href="/customers?oneoff=1" className="font-semibold underline">see one-off customers</a>.</li>}
          {result.skipped > 0 && <li>{result.skipped} were already in Wyndos and left as they were.</li>}
          {(result.owed > 0 || result.credit > 0) && <li>{fmtCurrency(result.owed)} owed and {fmtCurrency(result.credit)} in credit brought forward.</li>}
          {(result.cleans > 0 || result.payments > 0) && <li>{result.cleans} past cleans and {result.payments} payments.</li>}
          {result.runs > 0 && <li>{result.runs} areas put on the schedule from their due dates.</li>}
        </ul>
        <NotImportedList
          rows={result.errors.map((e) => { const at = e.indexOf(": "); return at > 0 ? { name: e.slice(0, at), reason: e.slice(at + 2) } : { reason: e }; })}
          fileName="cleanerplanner-not-imported.csv"
        />
        <div className="flex flex-wrap gap-2 pt-1">
          <a href="/scheduler" className="rounded-lg bg-green-600 px-4 py-2 font-semibold text-white">Open scheduler</a>
          <a href="/customers" className="rounded-lg border border-green-300 px-4 py-2 font-semibold">See customers</a>
          <a href="/payments" className="rounded-lg border border-green-300 px-4 py-2 font-semibold">Check balances</a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!backup && (
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-800">1. Get your backup from CleanerPlanner</p>
          <p className="text-sm text-slate-600">
            In CleanerPlanner, make a <strong>backup</strong> (it downloads as a .zip of spreadsheets). Upload that zip here as it is,
            or pick the CSV files from inside it.
          </p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:border-blue-400 hover:bg-blue-50/40">
            <FileArchive size={28} className="text-blue-600" />
            <span className="text-sm font-semibold text-slate-800">Choose your CleanerPlanner backup</span>
            <span className="text-xs text-slate-500">.zip, or the CSV files from it</span>
            <input type="file" accept=".zip,.csv" multiple className="hidden" onChange={(e) => { void load(e.target.files); e.target.value = ""; }} />
          </label>
          <p className="text-xs text-slate-500">The file is read on this device. It isn&apos;t uploaded or kept: only the customers you import are saved.</p>
        </section>
      )}

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {backup && (
        <>
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-800">2. Check what we found</p>
              <button type="button" onClick={() => setBackup(null)} className="text-xs text-slate-500 underline">Choose a different file</button>
            </div>
            <p className="text-xs text-slate-500">From {fileName}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Customers" value={String(backup.counts.jobs)} sub={`${backup.counts.active} active`} />
              <Stat label="Areas" value={String(areaList.length)} sub={oneOffCount ? `+ ${plural(oneOffCount, "one-off")}` : "from your rounds"} />
              <Stat label="Owed to you" value={fmtCurrency(totals.owed)} sub={plural(totals.owing, "customer")} />
              <Stat label="In credit" value={fmtCurrency(totals.credit)} sub={plural(totals.inCredit, "customer")} />
            </div>
            {backup.warnings.map((w) => <p key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{w}</p>)}

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Areas</p>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {areaList.map((a) => (
                  <div key={a.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate font-medium text-slate-800">{a.name}</span>
                    <span className="flex-shrink-0 text-xs text-slate-500">{plural(a.customers, "customer")} · every {a.frequencyWeeks} week{a.frequencyWeeks === 1 ? "" : "s"}</span>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">Each CleanerPlanner round becomes an area. A round with customers on different cycles is split, e.g. &quot;Town 8 weekly&quot;.</p>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">First few customers</p>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[560px] text-xs">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr><th className="px-2 py-1.5">Name</th><th className="px-2 py-1.5">Address</th><th className="px-2 py-1.5">Area</th><th className="px-2 py-1.5">Price</th><th className="px-2 py-1.5">Next due</th><th className="px-2 py-1.5">Owes</th></tr>
                  </thead>
                  <tbody>
                    {chosen.slice(0, 8).map((c) => (
                      <tr key={c.key} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-medium text-slate-800">{c.name}{!c.active && <span className="ml-1 text-slate-400">(inactive)</span>}</td>
                        <td className="px-2 py-1.5 text-slate-600">{c.address || "—"}</td>
                        <td className="px-2 py-1.5">{c.areaName}</td>
                        <td className="px-2 py-1.5">{fmtCurrency(c.price)}</td>
                        <td className="px-2 py-1.5">{ukDate(c.nextDueDate)}</td>
                        <td className={cn("px-2 py-1.5", owedNow(c) > 0 ? "text-red-600" : owedNow(c) < 0 ? "text-green-700" : "text-slate-400")}>
                          {owedNow(c) === 0 ? "—" : owedNow(c) > 0 ? fmtCurrency(owedNow(c)) : `${fmtCurrency(-owedNow(c))} credit`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {biggest && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {backup.balanceSign !== null && !opts.flip ? (
                  <p>We checked the balances against your payment history, so owed and credit are the right way round.</p>
                ) : (
                  <p>
                    Quick check: <strong>{biggest.name}</strong> will show as{" "}
                    <strong>{owedNow(biggest) > 0 ? `owing ${fmtCurrency(owedNow(biggest))}` : `${fmtCurrency(-owedNow(biggest))} in credit`}</strong>. Is that right?
                  </p>
                )}
                <button type="button" onClick={() => setOpts((o) => ({ ...o, flip: !o.flip }))} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 underline">
                  <ArrowLeftRight size={12} /> {opts.flip ? "Put owed and credit back" : "No, swap owed and credit"}
                </button>
              </div>
            )}
          </section>

          <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-800">3. Choose what to bring across</p>
            <Check checked={opts.balances} onChange={(v) => setOpts((o) => ({ ...o, balances: v }))}
              title="What each customer owes or has in credit" sub="Shows under Payments, ready to chase or use up." />
            {backup.txns.length > 0 && (
              <Check checked={opts.history} onChange={(v) => setOpts((o) => ({ ...o, history: v }))}
                title={`Past cleans and payments (${backup.counts.charges} cleans, ${backup.counts.payments} payments)`}
                sub={backup.historyRange ? `${ukDate(backup.historyRange.from)} to ${ukDate(backup.historyRange.to)}. Gives each customer their history and keeps your accounts complete.` : undefined} />
            )}
            {backup.counts.inactive > 0 && (
              <Check checked={opts.inactive} onChange={(v) => setOpts((o) => ({ ...o, inactive: v }))}
                title={`Customers who aren't active (${backup.counts.inactive})`} sub="Brought in switched off, so their history and balance stay with them." />
            )}
            <Check checked={opts.bookRuns} onChange={(v) => setOpts((o) => ({ ...o, bookRuns: v }))}
              title="Put areas on the schedule from the due dates" sub="Each area's next run goes on the earliest date someone in it is due (today if that's passed)." />
            {extras.map((e) => (
              <Check key={e.name} checked={oneOffServices.has(e.name)}
                onChange={(v) => setOneOffServices((s) => { const n = new Set(s); if (v) n.add(e.name); else n.delete(e.name); return n; })}
                title={`Bring in "${e.name}" as one-off jobs (${e.repeat})`}
                sub="Leave unticked to keep them on their own repeat, in areas like the ones above." />
            ))}
            {oneOffCount > 0 && (
              <p className="pt-1 text-xs text-slate-500">
                {plural(oneOffCount, "job")} {oneOffCount === 1 ? "has" : "have"} no repeat, so {oneOffCount === 1 ? "it comes" : "they come"} in as one-off customers.
                Find them under Customers → One-off. Book them when you need to.
              </p>
            )}
          </section>

          <button type="button" onClick={run} disabled={Boolean(busy) || chosen.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? <><Loader2 size={16} className="animate-spin" /> {busy} {progress}%</> : <><Upload size={16} /> Import {chosen.length} customers</>}
          </button>
          <p className="text-center text-xs text-slate-500">Anyone already in Wyndos with the same name, address and job is skipped, so it&apos;s safe to run again.</p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-800">{value}</p>
      <p className="text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

function Check({ checked, onChange, title, sub }: { checked: boolean; onChange: (v: boolean) => void; title: string; sub?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-slate-50">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4" />
      <span>
        <span className="block text-sm font-medium text-slate-800">{title}</span>
        {sub && <span className="block text-xs text-slate-500">{sub}</span>}
      </span>
    </label>
  );
}
