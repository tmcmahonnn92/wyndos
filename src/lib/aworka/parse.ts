import { fixUkPhone } from "@/lib/text-format";
import { mapPaymentMethod, parseCsv, type CpBackup, type CpCustomer, type CpExpense, type CpRow, type CpTxn } from "@/lib/cleanerplanner/parse";
import { ruleCategory } from "@/lib/smart-import/expense-plan";

/**
 * Reads an Aworka full export (a zip of CSVs) into the same plan as a CleanerPlanner backup,
 * so it goes through the same check-and-import screen. Runs in the browser; nothing is uploaded.
 *
 *  - jobs.csv: one row per job (a service at a property) → one Wyndos customer each.
 *    Round → area (split by frequency), Round Index → order, Frequency ("5 weekly", "2 monthly",
 *    "On Request", "One Off"), Price, Task → job name, Status (Active / Suspended / Deleted / Done /
 *    Estimate), Last Done/Skipped, Next Due, Payment Method, notes, phones, emails, map pins.
 *    Starting Balance and Balance are per customer; negative = they owe you.
 *  - activity-*.csv: cleans (Aworka Type "job"), payments (on the clean, on an invoice, or on
 *    their own), adjustments (bad debts). A "payment" row repeating a payment already shown on a
 *    clean or invoice is skipped. A negative "Tip/Bad Debt" on a paid clean is a tip.
 *  - expenses.csv: expenses, with categories mapped to the HMRC ones.
 */

const num = (v: string | undefined) => {
  const n = Number.parseFloat((v ?? "").replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const iso = (v: string | undefined) => (/^\d{4}-\d{2}-\d{2}/.test(v ?? "") ? (v as string).slice(0, 10) : "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const r2 = (n: number) => Math.round(n * 100) / 100;

/** "5 weekly" → 5; "2 monthly" → 9 (rounded weeks); "On Request" / "One Off" → null (no repeat). */
export function aworkaWeeks(freq: string): number | null {
  const f = freq.trim().toLowerCase();
  if (!f || /request|one ?off|once|ad ?hoc/.test(f)) return null;
  let m = f.match(/^(\d+)\s*weekly/);
  if (m) return Math.min(52, Math.max(1, Number(m[1])));
  if (/^weekly/.test(f)) return 1;
  if (/fortnight/.test(f)) return 2;
  m = f.match(/^(\d+)\s*monthly/);
  if (m) return Math.min(52, Math.max(1, Math.round((Number(m[1]) * 52) / 12)));
  if (/^monthly/.test(f)) return 4;
  m = f.match(/^(\d+)\s*(yearly|annually)/);
  if (m) return 52;
  if (/year|annual/.test(f)) return 52;
  return null;
}

/** Aworka expense category (+ description) → Wyndos category. */
function expenseCategory(cat: string, description: string): string {
  const c = cat.toLowerCase();
  const fromText = ruleCategory(`${description}`);
  // Van insurance, van tax… are motor costs for HMRC, not business insurance.
  if (fromText === "INSURANCE" && /van|vehicle|motor/.test(c)) return "VEHICLE_COSTS";
  if (fromText) return fromText;
  if (/van|vehicle|fuel|motor/.test(c)) return "VEHICLE_COSTS";
  if (/equipment|tool/.test(c)) return "EQUIPMENT";
  if (/account/.test(c)) return "PROFESSIONAL_FEES";
  if (/fee|charge|gocardless|card/.test(c)) return "BANK_FEES";
  if (/subcontract/.test(c)) return "SUBCONTRACTORS";
  if (/wage|staff/.test(c)) return "WAGES";
  if (/insur/.test(c)) return "INSURANCE";
  if (/advert|market|leaflet/.test(c)) return "MARKETING";
  if (/phone|office|software/.test(c)) return "OFFICE";
  return "OTHER";
}

export function isAworkaExport(names: string[]) {
  const base = names.map((n) => (n.split(/[\\/]/).pop() ?? "").toLowerCase());
  return base.includes("jobs.csv") && base.some((b) => /^activity-.*\.csv$/.test(b) || b === "expenses.csv");
}

export function readAworka(entries: Array<{ name: string; text: string }>): CpBackup {
  const file = (re: RegExp) => entries.filter((e) => re.test((e.name.split(/[\\/]/).pop() ?? "").toLowerCase()));
  const jobsFile = file(/^jobs\.csv$/)[0];
  if (!jobsFile) throw new Error("This doesn't look like an Aworka export: jobs.csv is missing.");
  const jobs = parseCsv(jobsFile.text);
  if (!jobs[0] || !("Aworka Job ID" in jobs[0])) throw new Error("This jobs.csv isn't from Aworka (no 'Aworka Job ID' column).");
  const warnings: string[] = [];
  const notImported: Array<{ name: string; reason: string }> = [];

  const out: CpCustomer[] = [];
  const jobsOf = new Map<string, Array<{ c: CpCustomer; row: CpRow }>>();
  let unscheduled = 0;
  for (const j of jobs) {
    const key = j["Aworka Job ID"];
    if (!key) continue;
    const status = (j.Status ?? "").toLowerCase();
    const ownAddress = Boolean(j["Job Address"]);
    const rawAddress = ownAddress ? j["Job Address"] : j["Customer Address"] ?? "";
    const postcode = ((ownAddress ? j["Job Postcode"] : j["Customer Postcode"]) ?? "").toUpperCase().replace(/\s+/g, "").replace(/^(.+)(\d[A-Z]{2})$/, "$1 $2");
    const bits = rawAddress.split(",").map((b) => b.trim()).filter(Boolean);
    const line1 = bits[0] ?? "";
    const m = line1.match(/^(\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?|flat\s+\S+)\s+(.+)$/i);
    const houseNameNumber = m ? m[1] : line1;
    const street = m ? m[2] : bits.length > 2 ? bits[1] : "";
    const town = bits.slice(m ? 1 : bits.length > 2 ? 2 : 1).join(", ");
    const address = [...bits, postcode].filter(Boolean).join(", ");
    const name = (j["Job Contact Name"] || j["Customer Name"] || j["Job Company"] || j["Customer Company"] || line1 || `Customer ${j["Customer Ref"] || key}`).replace(/\s+/g, " ").trim();
    if (status === "estimate") { notImported.push({ name: `${name} (${address})`, reason: "An estimate in Aworka, not a customer yet. Add it under Quotes." }); continue; }
    const weeks = aworkaWeeks(j.Frequency ?? "");
    const scheduled = weeks !== null && status !== "done";
    if (!scheduled) unscheduled++;
    const method = j["Payment Method"] ?? "";
    const allowed = j["Allowed Days"] ?? "";
    const notes = [
      j["Customer Notes"], j.Notes,
      j.Description && j.Description !== j.Task ? j.Description : "",
      allowed && !/^(weekdays|any day)$/i.test(allowed) ? `Only on: ${allowed}` : "",
      /^confirm/i.test((j.Appointments ?? "").trim()) ? j.Appointments : "",
      method && !mapPaymentMethod(method) && !/^on day$/i.test(method) ? `Usually pays: ${method}` : "",
      !scheduled && weeks === null && j.Frequency ? `Aworka frequency: ${j.Frequency}` : "",
      status === "deleted" ? "Deleted in Aworka" : status === "transferred" ? "Transferred in Aworka" : "",
    ].map((x) => (x ?? "").trim()).filter(Boolean);
    const lat = num(ownAddress ? j["Job Latitude"] : j["Customer Latitude"]);
    const lng = num(ownAddress ? j["Job Longitude"] : j["Customer Longitude"]);
    const c: CpCustomer = {
      key,
      name,
      address,
      houseNameNumber,
      street,
      town,
      postcode,
      phone: fixUkPhone(j["Job Phone 1"] || j["Job Phone 2"] || j["Customer Phone 1"] || j["Customer Phone 2"] || j["Customer Phone 3"] || ""),
      email: j["Job Email"] || j["Customer Email"] || "",
      latitude: lat && lng ? lat : null,
      longitude: lat && lng ? lng : null,
      roundName: (j.Round ?? "").trim().replace(/^\(unknown\)$/i, "") || "No round",
      areaName: "",
      frequencyWeeks: weeks ?? 4,
      scheduled,
      price: num(j.Price),
      jobName: (j.Task ?? "").trim() || "Window Cleaning",
      preferredPaymentMethod: /gocardless|direct debit/i.test(method) ? "DD" : mapPaymentMethod(method),
      notes: [...new Set(notes)].join("\n"),
      nextDueDate: scheduled ? iso(j["Next Due"]) : "",
      lastCompletedDate: iso(j["Last Done/Skipped"]),
      sortOrder: Math.round(num(j["Round Index"])),
      active: status === "active",
      balance: 0,
      startingBalance: 0,
      startingBalanceDate: "",
    };
    out.push(c);
    const cid = j["Aworka Customer ID"] || `job${key}`;
    jobsOf.set(cid, [...(jobsOf.get(cid) ?? []), { c, row: j }]);
  }

  // The same job listed more than once (e.g. a live one and an old suspended or deleted copy):
  // keep the live one, add the others' notes to it, and leave the copies out.
  const same = new Map<string, Array<{ c: CpCustomer; cid: string }>>();
  for (const [cid, list] of jobsOf) for (const { c } of list) {
    const k = `${c.name}|${c.address}|${c.jobName}`.toLowerCase();
    same.set(k, [...(same.get(k) ?? []), { c, cid }]);
  }
  const dropped = new Set<CpCustomer>();
  for (const group of same.values()) {
    if (group.length < 2) continue;
    const keep = [...group].sort((x, y) => Number(y.c.active) - Number(x.c.active) || Number(y.c.scheduled) - Number(x.c.scheduled) || (y.c.lastCompletedDate || "").localeCompare(x.c.lastCompletedDate || ""))[0];
    for (const g of group) {
      if (g === keep) continue;
      dropped.add(g.c);
      const extra = g.c.notes.split("\n").filter((n) => n && !keep.c.notes.includes(n) && !/^(Deleted|Transferred) in Aworka$/.test(n));
      if (extra.length) keep.c.notes = [keep.c.notes, ...extra].filter(Boolean).join("\n");
      notImported.push({ name: `${g.c.name} (${g.c.address})`, reason: `Listed twice in Aworka (same name, address and job). Kept the ${keep.c.active ? "active" : "most recent"} one; its history comes across.` });
    }
  }
  if (dropped.size) {
    for (let i = out.length - 1; i >= 0; i--) if (dropped.has(out[i])) out.splice(i, 1);
    for (const [cid, list] of jobsOf) {
      const left = list.filter(({ c }) => !dropped.has(c));
      if (left.length) jobsOf.set(cid, left); else jobsOf.delete(cid);
    }
  }

  // Balances belong to the customer: put them on one job (an active repeat window clean if there is one).
  const mainOf = new Map<string, CpCustomer>();
  for (const [cid, list] of jobsOf) {
    const main = list.find((x) => x.c.active && x.c.scheduled && /window/i.test(x.c.jobName))
      ?? list.find((x) => x.c.active) ?? list[0];
    mainOf.set(cid, main.c);
    const row = main.row;
    main.c.balance = r2(-num(row.Balance)) + 0; // Aworka: negative = owes you. Here: positive = owes.
    main.c.startingBalance = r2(-num(row["Starting Balance"])) + 0;
    main.c.startingBalanceDate = iso(row["Starting Balance Date"]);
  }

  // A Wyndos area has one cycle: split rounds that mix cycles.
  const byRound = new Map<string, CpCustomer[]>();
  for (const c of out) if (c.scheduled) byRound.set(c.roundName, [...(byRound.get(c.roundName) ?? []), c]);
  for (const [round, list] of byRound) {
    const counts = new Map<number, number>();
    for (const c of list) counts.set(c.frequencyWeeks, (counts.get(c.frequencyWeeks) ?? 0) + 1);
    const main = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    for (const c of list) c.areaName = c.frequencyWeeks === main ? round : `${round} ${c.frequencyWeeks} weekly`;
  }
  for (const c of out) if (!c.areaName) c.areaName = c.roundName;
  out.sort((a, b) => a.areaName.localeCompare(b.areaName) || a.sortOrder - b.sortOrder);

  // ── History: find the customer by address (Aworka's activity has no customer id).
  const keys = new Map<string, Set<string>>();
  for (const [cid, list] of jobsOf) {
    for (const { row } of list) {
      for (const k of [
        row["Customer Address"] + row["Customer Postcode"],
        row["Customer Company"] + row["Customer Address"] + row["Customer Postcode"],
        row["Customer Name"] + row["Customer Address"] + row["Customer Postcode"],
        row["Job Address"] ? row["Job Address"] + row["Job Postcode"] : "",
      ]) {
        const n = norm(k ?? "");
        if (n) keys.set(n, new Set([...(keys.get(n) ?? []), cid]));
      }
    }
  }
  const customerFor = (a: CpRow) => {
    let ids = keys.get(norm(a.Address ?? ""));
    if (!ids) {
      const parts = (a.Address ?? "").split(", ");
      if (parts.length > 2) ids = keys.get(norm(parts.slice(1).join(", ")));
    }
    if (!ids) return null;
    if (ids.size > 1) {
      const byName = [...ids].find((id) => jobsOf.get(id)?.some(({ row }) => row["Customer Name"] && row["Customer Name"] === a.Customer));
      if (byName) return byName;
    }
    return [...ids].sort()[0];
  };
  // Which job a clean was for: same first address line and task, else same task, else the main job.
  const jobFor = (cid: string, a: CpRow) => {
    const list = jobsOf.get(cid) ?? [];
    const line = norm(a.Description ?? "");
    const task = (a.Details ?? "").toLowerCase();
    const hit = list.find(({ c }) => norm(c.address.split(",")[0]) === line && c.jobName.toLowerCase() === task)
      ?? list.find(({ c }) => c.jobName.toLowerCase() === task && c.active)
      ?? list.find(({ c }) => c.jobName.toLowerCase() === task);
    return (hit?.c ?? mainOf.get(cid))?.key ?? null;
  };
  const txnMethod = (paidBy: string): "CASH" | "BACS" | "CARD" => {
    const m = /gocardless|direct debit/i.test(paidBy) ? "DD" : mapPaymentMethod(paidBy);
    return m === "CARD" ? "CARD" : m === "CASH" || m === "" ? "CASH" : "BACS";
  };

  const activity = file(/^activity-.*\.csv$/).flatMap((f) => parseCsv(f.text));
  const txns: CpTxn[] = [];
  let skippedTxns = 0, tips = 0, writeoffs = 0;
  const unmatched = new Set<string>();
  // Payments already shown on a clean or invoice: a separate "payment" row for the same money is the same payment.
  const shown = new Map<string, number>();
  const payKey = (cid: string, a: CpRow) => `${cid}|${iso(a["Paid On"]) || iso(a.Date)}|${r2(num(a.Paid)).toFixed(2)}`;
  for (const a of activity) {
    const t = a["Aworka Type"];
    if ((t === "job" || t === "invoice") && num(a.Paid) > 0) {
      const cid = customerFor(a);
      if (cid) shown.set(payKey(cid, a), (shown.get(payKey(cid, a)) ?? 0) + 1);
    }
  }
  for (const a of activity) {
    const t = a["Aworka Type"];
    const date = iso(a.Date);
    const cid = customerFor(a);
    if (!cid) {
      if (["job", "payment", "invoice", "adjustment"].includes(t) && (num(a["Gross Price"]) || num(a.Paid))) { skippedTxns++; unmatched.add(`${a.Customer} (${a.Address})`); }
      continue;
    }
    const main = mainOf.get(cid)?.key;
    const paidOn = iso(a["Paid On"]) || date;
    const paid = r2(num(a.Paid));
    const tb = num(a["Tip/Bad Debt"]);
    const method = txnMethod(a["Paid By"] ?? "");
    const ref = [a["Paid By"], a["Pay Ref"]].filter(Boolean).join(" · ");
    if (t === "job") {
      if (a.Type !== "Done") { skippedTxns++; continue; }
      const jobKey = jobFor(cid, a);
      if (!jobKey) { skippedTxns++; continue; }
      const price = r2(num(a["Gross Price"]));
      if (price > 0) txns.push({ jobKey, kind: "charge", date, amount: price, method, note: a.Details && !/^window cleaning$/i.test(a.Details) ? a.Details : "" });
      const tip = tb < 0 && paid > 0 ? r2(-tb) : 0;
      if (paid - tip > 0.004) txns.push({ jobKey, kind: "payment", date: paidOn, amount: r2(paid - tip), method, note: ref });
      if (tip > 0) { txns.push({ jobKey, kind: "tip", date: paidOn, amount: tip, method, note: "Tip" }); tips++; }
      if (tb > 0) { txns.push({ jobKey, kind: "writeoff", date, amount: r2(tb), method, note: "Bad debt written off in Aworka" }); writeoffs++; }
    } else if ((t === "payment" || t === "invoice") && paid > 0 && main) {
      if (t === "payment") {
        const k = payKey(cid, a);
        const left = shown.get(k) ?? 0;
        if (left > 0) { shown.set(k, left - 1); continue; } // already counted on the clean or invoice
      }
      txns.push({ jobKey: main, kind: "payment", date: paidOn, amount: paid, method, note: [t === "invoice" ? a.Description : "", ref].filter(Boolean).join(" · ") });
    } else if (t === "adjustment" && main) {
      const amount = r2(-num(a["Gross Price"]));
      if (amount > 0) { txns.push({ jobKey: main, kind: "writeoff", date, amount, method, note: a.Description || "Adjustment in Aworka" }); writeoffs++; }
      else if (amount < 0) txns.push({ jobKey: main, kind: "charge", date, amount: -amount, method, note: a.Description || "Adjustment in Aworka" });
    }
  }
  if (unmatched.size) warnings.push(`${unmatched.size} customer${unmatched.size === 1 ? "" : "s"} in the history aren't in jobs.csv, so their ${skippedTxns} past entr${skippedTxns === 1 ? "y" : "ies"} can't be linked.`);
  const order = { charge: 0, writeoff: 1, payment: 2, tip: 3 } as const;
  txns.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);

  // Check: do starting balance + history give Aworka's balance? (It should, for nearly everyone.)
  const sums = new Map<string, number>();
  for (const t of txns) sums.set(t.jobKey, (sums.get(t.jobKey) ?? 0) + (t.kind === "charge" ? t.amount : t.kind === "tip" ? 0 : -t.amount));
  let checked = 0, matched = 0;
  for (const [cid, list] of jobsOf) {
    const main = mainOf.get(cid)!;
    const total = list.reduce((s, { c }) => s + (sums.get(c.key) ?? 0), 0);
    checked++;
    if (Math.abs(main.startingBalance + total - main.balance) < 0.02) matched++;
  }

  // ── Expenses
  const expenses: CpExpense[] = parseCsv(file(/^expenses\.csv$/)[0]?.text ?? "").map((e, i) => {
    const description = (e.Description ?? "").trim();
    const supplier = (e.Supplier ?? "").trim() || description || e.Category || "Expense";
    const amount = r2(num(e.Amount));
    const vat = r2(num(e.VAT));
    const loan = /\bloan\b/i.test(`${description} ${supplier}`) && !/interest/i.test(description);
    return {
      row: i + 2, date: iso(e.Date), supplier, description: description !== supplier ? description : "", sourceCategory: (e.Category ?? "").trim() || "Other",
      amount, vat, category: expenseCategory(e.Category ?? "", `${supplier} ${description}`),
      skip: loan, skipReason: loan ? "Loan repayment: not a business expense (only the interest is)" : "",
    };
  });

  const dates = txns.map((t) => t.date).filter(Boolean).sort();
  const areaMap = new Map<string, { name: string; frequencyWeeks: number; customers: number }>();
  for (const c of out) {
    if (!c.scheduled) continue;
    const a = areaMap.get(c.areaName) ?? { name: c.areaName, frequencyWeeks: c.frequencyWeeks, customers: 0 };
    a.customers++;
    areaMap.set(c.areaName, a);
  }
  const active = out.filter((c) => c.active).length;
  const charges = txns.filter((t) => t.kind === "charge").length;
  return {
    source: "Aworka",
    customers: out,
    txns,
    areas: [...areaMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    balanceSign: 1,
    counts: { jobs: out.length, active, inactive: out.length - active, unscheduled, charges, payments: txns.filter((t) => t.kind === "payment").length, skippedTxns },
    counts2: { tips, writeoffs, balancesChecked: checked, balancesMatched: matched },
    historyRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    warnings,
    notImported,
    expenses,
  };
}
