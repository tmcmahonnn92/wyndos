import { fixUkPhone } from "@/lib/text-format";
/**
 * Reads a CleanerPlanner backup (the zip of CSVs from CleanerPlanner → Backup) into a plan
 * Wyndos can import. Runs in the browser: the file is never uploaded or stored.
 *
 * What we use from the backup:
 *  - Jobs.csv: one row per job (a service at a property). Each becomes a Wyndos customer.
 *    RoundId → area, ServiceId → job name, Price/TotalPrice, Due → next due, LastDone,
 *    schedule (Due → NextDue gap, or ScheduleInterval + ScheduleFrequencyId), Index → order,
 *    PaymentMethodId → how they usually pay, StatusId (1 = active), Balance / StartingBalance.
 *  - Customers.csv + Contacts.csv: names, addresses, phones, emails and map pins. A job with
 *    its own contact (a different property) uses that address, otherwise the customer's.
 *  - Notes.csv: notes for the customer or the job, joined into the Wyndos note.
 *  - Rounds.csv, Services.csv, PaymentMethods.csv: names.
 *  - Transactions.csv (optional history): TypeId 0 = a charge (a clean), 1 = a payment.
 *    Draft and missed rows are skipped.
 * Not used: invoices, expenses, sources, worksheets.
 */

export type CpRow = Record<string, string>;

/** CSV with quoted fields, doubled quotes and newlines inside quotes. */
export function parseCsv(text: string): CpRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/** "06/10/2026 04:34:46" (UK) → "2026-10-06". Blank or bad → "". */
export function cpDate(value: string | undefined): string {
  const m = (value ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  const [, d, mo, y] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return Number.isNaN(Date.parse(iso)) ? "" : iso;
}

const num = (v: string | undefined) => {
  const n = Number.parseFloat((v ?? "").replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const yes = (v: string | undefined) => /^(true|1|yes)$/i.test(v ?? "");
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/**
 * CleanerPlanner payment method name → Wyndos "usually pays by" (a fixed list).
 * Their own names ("Under mat", "Neighbour pays") return "" and are kept as a note instead.
 */
export function mapPaymentMethod(name: string): "CASH" | "BACS" | "CARD" | "DD" | "INVOICE" | "" {
  const n = name.toLowerCase().trim();
  if (!n) return "";
  if (n.includes("cash")) return "CASH";
  if (/gocardless|direct debit|^dd$|standing order/.test(n)) return "DD";
  if (/invoice|account|later/.test(n)) return "INVOICE";
  if (/card|stripe|sumup|square|zettle|paypal/.test(n)) return "CARD";
  if (/transfer|bacs|bank|online|cheque|check/.test(n)) return "BACS";
  return "";
}

/** How a payment was taken, for the payment record (cash, bank or card only). */
function txnMethod(name: string): "CASH" | "BACS" | "CARD" {
  const m = mapPaymentMethod(name);
  return m === "CARD" ? "CARD" : m === "CASH" || m === "" ? "CASH" : "BACS";
}

export type CpCustomer = {
  key: string; // CleanerPlanner job id
  name: string;
  address: string;
  houseNameNumber: string;
  street: string;
  town: string;
  postcode: string;
  phone: string;
  email: string;
  latitude: number | null;
  longitude: number | null;
  roundName: string;
  areaName: string; // round name, or "<round> N weekly" when the round mixes frequencies
  frequencyWeeks: number;
  scheduled: boolean; // false = ad hoc / one-off in CleanerPlanner
  price: number;
  jobName: string;
  preferredPaymentMethod: string;
  notes: string;
  nextDueDate: string;
  lastCompletedDate: string;
  sortOrder: number;
  active: boolean;
  /** As exported. Which way round it is gets worked out in readBackup (balanceSign). */
  balance: number;
  startingBalance: number;
  startingBalanceDate: string;
};

export type CpTxn = { jobKey: string; kind: "charge" | "payment"; date: string; amount: number; method: "CASH" | "BACS" | "CARD"; note: string };

export type CpBackup = {
  customers: CpCustomer[];
  txns: CpTxn[];
  areas: Array<{ name: string; frequencyWeeks: number; customers: number }>;
  /** 1 = a positive Balance means they owe you; -1 = negative means they owe; null = couldn't tell. */
  balanceSign: 1 | -1 | null;
  counts: { jobs: number; active: number; inactive: number; unscheduled: number; charges: number; payments: number; skippedTxns: number };
  historyRange: { from: string; to: string } | null;
  warnings: string[];
};

const FILES = ["Jobs.csv", "Customers.csv", "Contacts.csv", "Rounds.csv", "Services.csv", "PaymentMethods.csv", "Notes.csv", "Transactions.csv"] as const;
export type CpFiles = Partial<Record<(typeof FILES)[number], string>>;

/** Pick the CSVs we need out of a list of file names (case-insensitive, ignores folders). */
export function pickFiles(entries: Array<{ name: string; text: string }>): CpFiles {
  const out: CpFiles = {};
  for (const e of entries) {
    const base = e.name.split(/[\\/]/).pop() ?? "";
    const hit = FILES.find((f) => f.toLowerCase() === base.toLowerCase());
    if (hit) out[hit] = e.text;
  }
  return out;
}

function weeksFor(job: CpRow): number {
  const due = cpDate(job.Due);
  const next = cpDate(job.NextDue);
  if (due && next) {
    const gap = daysBetween(due, next);
    if (gap >= 5) return Math.min(52, Math.max(1, Math.round(gap / 7)));
  }
  const interval = Math.max(1, Math.round(num(job.ScheduleInterval)) || 1);
  switch (job.ScheduleFrequencyId) {
    case "1": return Math.min(52, Math.max(1, Math.round(interval / 7)));           // days
    case "2": return Math.min(52, interval);                                        // weeks
    case "3": return Math.min(52, Math.max(1, Math.round((interval * 52) / 12)));   // months
    default: return 4;
  }
}

function splitLine1(line1: string, line2: string) {
  // "12 Oak Lane" → house "12", street "Oak Lane"; "Rose Cottage" + "Mill Lane" → house + street.
  const m = line1.match(/^(\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?|flat\s+\S+)[,\s]+(.+)$/i);
  if (m) return { houseNameNumber: m[1], street: [m[2], line2].filter(Boolean).join(", ") };
  return { houseNameNumber: line1, street: line2 };
}

export function readBackup(files: CpFiles): CpBackup {
  const warnings: string[] = [];
  if (!files["Jobs.csv"]) throw new Error("This doesn't look like a CleanerPlanner backup: Jobs.csv is missing.");
  const jobs = parseCsv(files["Jobs.csv"]);
  const byId = (text?: string) => new Map(parseCsv(text ?? "").map((r) => [r.Id, r]));
  const customers = byId(files["Customers.csv"]);
  const contacts = byId(files["Contacts.csv"]);
  const rounds = byId(files["Rounds.csv"]);
  const services = byId(files["Services.csv"]);
  const methods = byId(files["PaymentMethods.csv"]);
  if (!files["Contacts.csv"]) warnings.push("Contacts.csv is missing, so names and addresses may be blank.");

  const notesFor = new Map<string, string[]>();
  for (const n of parseCsv(files["Notes.csv"] ?? "")) {
    const text = n.Text?.trim();
    if (!text) continue;
    const k = n.JobId ? `j${n.JobId}` : `c${n.CustomerId}`;
    notesFor.set(k, [...(notesFor.get(k) ?? []), text]);
  }

  const contactOf = (id: string | undefined) => (id ? contacts.get(id) : undefined);
  const hasAddress = (c?: CpRow) => Boolean(c && (c.Address1 || c.Postcode));
  const nameOf = (c?: CpRow) =>
    !c ? "" : (c.FullName || [c.Title, c.FirstName, c.LastName].filter(Boolean).join(" ") || c.Company || "").replace(/\s+/g, " ").trim();

  const out: CpCustomer[] = [];
  let unscheduled = 0;
  for (const job of jobs) {
    if (!job.Id) continue;
    const cust = customers.get(job.CustomerId);
    const owner = contactOf(cust?.ContactId);
    const own = contactOf(job.ContactId);
    // The job's own contact is the property when it has an address; otherwise the customer's.
    const place = hasAddress(own) ? own! : owner ?? own;
    const line1 = place?.Address1 ?? "";
    const line2 = place?.Address2 ?? "";
    const { houseNameNumber, street } = splitLine1(line1, line2);
    const town = place?.Town ?? "";
    const postcode = (place?.Postcode ?? "").toUpperCase().replace(/\s+/g, "").replace(/^(.+)(\d[A-Z]{2})$/, "$1 $2");
    const address = [line1, line2, town, postcode].filter(Boolean).join(", ");
    const name = nameOf(own) || nameOf(owner) || line1 || `Customer ${cust?.Reference ?? job.Reference ?? job.Id}`;
    const lat = num(place?.GeocodeLat), lng = num(place?.GeocodeLng);
    const scheduled = yes(job.ScheduleEnabled);
    if (!scheduled) unscheduled++;
    const methodName = methods.get(job.PaymentMethodId)?.Name ?? "";
    const notes = [
      methodName && !mapPaymentMethod(methodName) ? `Usually pays: ${methodName}` : "",
      ...(notesFor.get(`c${job.CustomerId}`) ?? []),
      ...(notesFor.get(`j${job.Id}`) ?? []),
      job.WorksheetNote?.trim() ?? "",
    ].filter(Boolean);
    const price = num(job.TotalPrice) || num(job.Price);
    out.push({
      key: job.Id,
      name,
      address,
      houseNameNumber,
      street,
      town,
      postcode,
      phone: fixUkPhone(own?.Mobile || own?.Phone || owner?.Mobile || owner?.Phone || ""),
      email: own?.Email || owner?.Email || "",
      latitude: lat && lng ? lat : null,
      longitude: lat && lng ? lng : null,
      roundName: rounds.get(job.RoundId)?.Name?.trim() || "Imported",
      areaName: "",
      frequencyWeeks: weeksFor(job),
      scheduled,
      price,
      jobName: services.get(job.ServiceId)?.Name?.trim() || "Window Cleaning",
      preferredPaymentMethod: mapPaymentMethod(methodName),
      notes: [...new Set(notes)].join("\n"),
      nextDueDate: scheduled ? cpDate(job.Due) : "",
      lastCompletedDate: cpDate(job.LastDone),
      sortOrder: Math.round(num(job.Index)),
      // StatusId 1 is an active job in CleanerPlanner; anything else is paused or ended.
      active: (job.StatusId ?? "1") === "1",
      balance: num(job.Balance),
      startingBalance: num(job.StartingBalance),
      startingBalanceDate: cpDate(job.StartingBalanceDate),
    });
  }

  // A Wyndos area has one cycle. A round that mixes cycles is split: the most common
  // cycle keeps the round's name, the others become "<round> 8 weekly" and so on.
  const byRound = new Map<string, CpCustomer[]>();
  for (const c of out) byRound.set(c.roundName, [...(byRound.get(c.roundName) ?? []), c]);
  for (const [round, list] of byRound) {
    const counts = new Map<number, number>();
    for (const c of list) counts.set(c.frequencyWeeks, (counts.get(c.frequencyWeeks) ?? 0) + 1);
    const main = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    for (const c of list) c.areaName = c.frequencyWeeks === main ? round : `${round} ${c.frequencyWeeks} weekly`;
  }
  // Keep each round in its CleanerPlanner order.
  out.sort((a, b) => a.areaName.localeCompare(b.areaName) || a.sortOrder - b.sortOrder);

  const areaMap = new Map<string, { name: string; frequencyWeeks: number; customers: number }>();
  for (const c of out) {
    const a = areaMap.get(c.areaName) ?? { name: c.areaName, frequencyWeeks: c.frequencyWeeks, customers: 0 };
    a.customers++;
    areaMap.set(c.areaName, a);
  }

  // History
  const known = new Set(out.map((c) => c.key));
  const txns: CpTxn[] = [];
  let skippedTxns = 0;
  for (const t of parseCsv(files["Transactions.csv"] ?? "")) {
    const kind = t.TypeId === "0" ? "charge" : t.TypeId === "1" ? "payment" : null;
    const amount = num(t.Total) || num(t.Amount);
    const date = cpDate(t.Date);
    if (!kind || !known.has(t.JobId) || yes(t.IsDraft) || yes(t.Missed) || !date || Math.abs(amount) < 0.005) { skippedTxns++; continue; }
    const methodName = methods.get(t.PaymentMethodId)?.Name ?? "";
    txns.push({
      jobKey: t.JobId,
      kind,
      date,
      amount: Math.abs(amount),
      method: txnMethod(methodName),
      note: [t.Description, methodName && !mapPaymentMethod(methodName) ? methodName : "", t.PaymentReference].filter(Boolean).join(" · ").slice(0, 200),
    });
  }
  txns.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "charge" ? -1 : 1));

  // Which way round are balances? Rebuild them from the history and see which sign matches.
  let votes = 0;
  if (txns.length) {
    const sums = new Map<string, number>();
    for (const t of txns) sums.set(t.jobKey, (sums.get(t.jobKey) ?? 0) + (t.kind === "charge" ? t.amount : -t.amount));
    for (const c of out) {
      if (Math.abs(c.balance) < 0.01) continue;
      const owed = c.startingBalance + (sums.get(c.key) ?? 0);
      if (Math.abs(owed - c.balance) < 0.02) votes++;
      else if (Math.abs(owed + c.balance) < 0.02) votes--;
    }
  }
  const balanceSign: 1 | -1 | null = votes > 0 ? 1 : votes < 0 ? -1 : null;

  const dates = txns.map((t) => t.date);
  const active = out.filter((c) => c.active).length;
  return {
    customers: out,
    txns,
    areas: [...areaMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    balanceSign,
    counts: {
      jobs: out.length,
      active,
      inactive: out.length - active,
      unscheduled,
      charges: txns.filter((t) => t.kind === "charge").length,
      payments: txns.filter((t) => t.kind === "payment").length,
      skippedTxns,
    },
    historyRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    warnings,
  };
}
