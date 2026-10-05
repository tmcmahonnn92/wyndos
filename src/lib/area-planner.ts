"use server";

/**
 * Area planner: sorts customers into round areas (one area ≈ one day's work).
 *
 * Two ways to plan:
 *  - Quick sort (no AI): groups by postcode sector, then street, and packs streets into
 *    days up to the capacity the owner gave.
 *  - AI sort (only when ANTHROPIC_API_KEY is set): Claude groups them using the owner's answers.
 *
 * Privacy: the AI only ever sees street, town, postcode, price, frequency and due date,
 * with a number in place of each customer. No names, house numbers, phones or emails.
 * Every plan is shown to the owner to check and change before anything is saved.
 */

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { requireOwner } from "@/lib/guards";
import { addressPartsOf, collectKnownTowns } from "@/lib/address";
import { bulkImportCustomers, bulkMoveCustomersToArea } from "@/lib/actions";

export type PlannerAnswers = {
  /** 0 = Sunday … 6 = Saturday. Empty = not said. */
  workDays: number[];
  customersPerDay: number | null;
  valuePerDay: number | null;
  /** How many days before a customer's due date they can be cleaned. */
  daysEarly: number | null;
  notes: string;
};

export type PlannedArea = {
  key: string;
  name: string;
  customerIds: number[];
  /** 0–6, or null. Only a suggestion. */
  day: number | null;
  why: string;
};

type PlannerCustomer = {
  id: number;
  street: string;
  town: string;
  postcode: string;
  price: number;
  frequencyWeeks: number;
  nextDue: string | null;
  areaName: string;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function plannerAvailable() {
  await requireOwner();
  return { ai: Boolean(process.env.ANTHROPIC_API_KEY?.trim()) };
}

async function loadCustomers(tenantId: number, scope: "unsorted" | "all"): Promise<PlannerCustomer[]> {
  const rows = await prisma.customer.findMany({
    where: { tenantId, active: true, isProspect: false, area: { isSystemArea: false } },
    select: {
      id: true, address: true, houseNameNumber: true, street: true, town: true, postcode: true,
      price: true, frequencyWeeks: true, nextDueDate: true, areaId: true, area: { select: { name: true } },
    },
    orderBy: { id: "asc" },
  });
  let list = rows;
  if (scope === "unsorted") {
    // "Unsorted" = customers in an area far too big for a day (e.g. everything imported into one),
    // or in an area with only them. If nothing looks unsorted, use everyone.
    const sizes = new Map<number, number>();
    for (const r of rows) sizes.set(r.areaId, (sizes.get(r.areaId) ?? 0) + 1);
    const big = rows.filter((r) => (sizes.get(r.areaId) ?? 0) > 60 || (sizes.get(r.areaId) ?? 0) === 1);
    if (big.length > 0) list = big;
  }
  const towns = collectKnownTowns(list.map((r) => r.address));
  return list.map((r) => {
    const parts = addressPartsOf(r, towns);
    return {
      id: r.id,
      street: parts.street.trim(),
      town: parts.town.trim(),
      postcode: parts.postcode.trim().toUpperCase(),
      price: r.price,
      frequencyWeeks: r.frequencyWeeks,
      nextDue: r.nextDueDate ? r.nextDueDate.toISOString().slice(0, 10) : null,
      areaName: r.area.name,
    };
  });
}

function title(s: string) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "NG20 9AA" → "NG20 9". Missing postcode → "". */
function sector(postcode: string) {
  const m = postcode.replace(/\s+/g, "").match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d)[A-Z]{2}$/);
  return m ? `${m[1]} ${m[2]}` : postcode.split(" ")[0] ?? "";
}

/** Quick sort, no AI: postcode sector → street, packed into days up to capacity. */
function quickPlan(customers: PlannerCustomer[], answers: PlannerAnswers): PlannedArea[] {
  const perDay = answers.customersPerDay && answers.customersPerDay > 0 ? answers.customersPerDay : null;
  const valueCap = answers.valuePerDay && answers.valuePerDay > 0 ? answers.valuePerDay : null;
  const cap = perDay || valueCap ? { count: perDay ?? Infinity, value: valueCap ?? Infinity } : { count: 40, value: Infinity };

  // Group by town + sector, then by street.
  const groups = new Map<string, Map<string, PlannerCustomer[]>>();
  for (const c of customers) {
    // Area frequency is shared by everyone in it, so 4-weekly and 8-weekly customers go in separate areas.
    const g = `${c.town || "Unknown town"}|${sector(c.postcode)}|${c.frequencyWeeks}`;
    const streets = groups.get(g) ?? new Map<string, PlannerCustomer[]>();
    const st = c.street || "(no street)";
    streets.set(st, [...(streets.get(st) ?? []), c]);
    groups.set(g, streets);
  }

  const areas: PlannedArea[] = [];
  const usedNames = new Map<string, number>();
  const nameFor = (town: string, street: string, suffix = "") => {
    const base = `${title(town || street || "Area")}${suffix}`;
    const n = (usedNames.get(base) ?? 0) + 1;
    usedNames.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  };

  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [key, streets] of sortedGroups) {
    const [town, , freqText] = key.split("|");
    const freq = Number(freqText);
    const suffix = freq && freq !== 4 ? ` ${freq} weekly` : "";
    let current: PlannerCustomer[] = [];
    let value = 0;
    const flush = () => {
      if (current.length === 0) return;
      const mainStreet = [...current.reduce((m, c) => m.set(c.street, (m.get(c.street) ?? 0) + 1), new Map<string, number>())]
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      areas.push({
        key: `q${areas.length + 1}`,
        name: nameFor(town === "Unknown town" ? mainStreet : town, mainStreet, suffix),
        customerIds: current.map((c) => c.id),
        day: null,
        why: `${current.length} customers close together${sector(current[0].postcode) ? ` (${sector(current[0].postcode)})` : ""}`,
      });
      current = [];
      value = 0;
    };
    for (const [, list] of [...streets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      // Keep a street together unless it alone is bigger than a day.
      const streetValue = list.reduce((s, c) => s + c.price, 0);
      if (current.length > 0 && (current.length + list.length > cap.count || value + streetValue > cap.value)) flush();
      for (const c of list) {
        if (current.length >= cap.count || value + c.price > cap.value) flush();
        current.push(c);
        value += c.price;
      }
    }
    flush();
  }

  // Spread over the working days in order, if given.
  if (answers.workDays.length > 0) {
    const days = [...answers.workDays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Monday first
    areas.forEach((a, i) => { a.day = days[i % days.length]; });
  }
  return areas;
}


/** One call to Claude that must answer by filling in the given tool. Returns the tool's input. */
async function callClaudeTool<T>(prompt: string, tool: { name: string; description: string; input_schema: object }, maxTokens: number): Promise<T | undefined> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("AI isn't set up on this server.");
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";
  const base = (process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150_000);
  let response: Response;
  try {
    response = await fetch(`${base}/v1/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (issue) {
    throw new Error(issue instanceof Error && issue.name === "AbortError" ? "The AI took too long. Please try again." : "Couldn't reach the AI. Please try again.");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("[ai] error", response.status, text.slice(0, 500));
    if (response.status === 401) throw new Error("The AI key isn't valid. Check ANTHROPIC_API_KEY.");
    throw new Error("The AI couldn't help just now. Please try again.");
  }
  const data = await response.json() as { content?: Array<{ type: string; name?: string; input?: T }> };
  return data.content?.find((c) => c.type === "tool_use" && c.name === tool.name)?.input;
}

const PLAN_TOOL = {
  name: "save_area_plan",
  description: "Save the proposed round areas. Every customer number must appear in exactly one area.",
  input_schema: {
    type: "object",
    properties: {
      areas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short area name a window cleaner would use, e.g. 'Cuckney' or 'Norton East'." },
            customers: { type: "array", items: { type: "integer" }, description: "Customer numbers in this area." },
            day: { type: "integer", minimum: 0, maximum: 6, description: "Suggested weekday, 0 = Sunday. Omit if no preference." },
            why: { type: "string", description: "One short plain-English reason, max 12 words." },
          },
          required: ["name", "customers", "why"],
        },
      },
    },
    required: ["areas"],
  },
} as const;

async function aiPlan(customers: PlannerCustomer[], answers: PlannerAnswers): Promise<PlannedArea[]> {
  // Customer numbers are positions in this list, not database ids.
  const lines = customers.map((c, i) =>
    `${i + 1}|${c.street}|${c.town}|${c.postcode}|£${c.price.toFixed(2)}|${c.frequencyWeeks}w|${c.nextDue ?? "-"}`).join("\n");
  const said: string[] = [];
  if (answers.workDays.length) said.push(`Works on: ${answers.workDays.map((d) => DAY_NAMES[d]).join(", ")}.`);
  if (answers.customersPerDay) said.push(`About ${answers.customersPerDay} customers a day.`);
  if (answers.valuePerDay) said.push(`About £${answers.valuePerDay} of work a day at most.`);
  if (answers.daysEarly != null) said.push(`Can clean up to ${answers.daysEarly} days before someone is due.`);
  if (answers.notes.trim()) said.push(`Their notes: ${answers.notes.trim().slice(0, 1000)}`);

  const prompt = `You are helping a UK window cleaner organise their customers into round areas. One area is roughly one day's work, cleaned together on the same day every cycle.

Rules:
- Keep neighbouring streets and the same village together. Never split a street unless it is far bigger than a day.
- Keep each area near the day's capacity below. If no capacity is given, aim for 25 to 45 customers.
- Everyone in an area is cleaned on the same cycle, so never mix frequencies in one area (4w and 8w go in separate areas, e.g. "Cuckney" and "Cuckney 8 weekly").
- Try to balance due dates so areas are not all due at once.
- Name areas the way a local would: the village or estate name, adding North/East/1/2 when one place needs several days.
- If the owner gave working days, suggest one for each area, spreading the work evenly.
- Every customer number must be in exactly one area.

What the owner told us:
${said.length ? said.join("\n") : "Nothing: use sensible defaults."}

Customers (number|street|town|postcode|price|frequency|next due):
${lines}

Call save_area_plan with your areas.`;

  const input = await callClaudeTool<{ areas?: Array<{ name?: unknown; customers?: unknown; day?: unknown; why?: unknown }> }>(prompt, PLAN_TOOL, 32000);
  const raw = input?.areas;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("The AI didn't return a plan. Try again, or use Quick sort.");

  // Check it: map numbers back to real customers, each exactly once; anyone missed goes in "Check these".
  const seen = new Set<number>();
  const areas: PlannedArea[] = [];
  raw.forEach((a, i) => {
    const ids: number[] = [];
    for (const n of Array.isArray(a.customers) ? a.customers : []) {
      const idx = Number(n) - 1;
      const c = customers[idx];
      if (!c || seen.has(idx)) continue;
      seen.add(idx);
      ids.push(c.id);
    }
    if (ids.length === 0) return;
    const day = Number(a.day);
    areas.push({
      key: `a${i + 1}`,
      name: String(a.name ?? `Area ${i + 1}`).trim().slice(0, 40) || `Area ${i + 1}`,
      customerIds: ids,
      day: Number.isInteger(day) && day >= 0 && day <= 6 ? day : null,
      why: String(a.why ?? "").trim().slice(0, 120),
    });
  });
  const missed = customers.filter((_, idx) => !seen.has(idx)).map((c) => c.id);
  if (missed.length) areas.push({ key: "missed", name: "Check these", customerIds: missed, day: null, why: "The AI didn't place these. Move them where they fit." });
  return areas;
}

/** Make a plan. Nothing is saved: the owner checks it first. */
export async function planAreas(input: { scope: "unsorted" | "all"; answers: PlannerAnswers; useAi: boolean }) {
  const actor = await requireOwner();
  const answers: PlannerAnswers = {
    workDays: (input.answers.workDays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    customersPerDay: input.answers.customersPerDay && input.answers.customersPerDay > 0 ? Math.min(500, Math.round(input.answers.customersPerDay)) : null,
    valuePerDay: input.answers.valuePerDay && input.answers.valuePerDay > 0 ? Math.min(100000, input.answers.valuePerDay) : null,
    daysEarly: input.answers.daysEarly != null && input.answers.daysEarly >= 0 ? Math.min(90, Math.round(input.answers.daysEarly)) : null,
    notes: String(input.answers.notes ?? "").slice(0, 1000),
  };
  const customers = await loadCustomers(actor.tenantId, input.scope);
  if (customers.length === 0) throw new Error("No customers to sort yet. Import or add some first.");
  if (input.useAi && customers.length > 3000) throw new Error("That's a lot of customers for one go. Use Quick sort.");
  const areas = input.useAi ? await aiPlan(customers, answers) : quickPlan(customers, answers);
  const info = new Map(customers.map((c) => [c.id, c]));
  return {
    areas,
    customers: customers.map((c) => ({
      id: c.id,
      label: [c.street, c.town].filter(Boolean).join(", ") || "No address",
      postcode: c.postcode,
      price: c.price,
      nextDue: c.nextDue,
      areaName: c.areaName,
    })),
    count: info.size,
  };
}

/** Save the plan the owner checked: make the areas and move the customers into them. */
export async function applyAreaPlan(input: { areas: Array<{ name: string; customerIds: number[] }>; daysEarly: number | null }) {
  const actor = await requireOwner();
  const tenantId = actor.tenantId;
  const plan = (input.areas ?? []).map((a) => ({ name: String(a.name ?? "").trim().slice(0, 40), customerIds: [...new Set((a.customerIds ?? []).map(Number))] }))
    .filter((a) => a.customerIds.length > 0);
  if (plan.length === 0) throw new Error("Nothing to save.");
  if (plan.some((a) => !a.name)) throw new Error("Every area needs a name.");
  const names = plan.map((a) => a.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error("Two areas have the same name. Rename one.");
  const all = plan.flatMap((a) => a.customerIds);
  if (new Set(all).size !== all.length) throw new Error("A customer is in two areas.");
  const owned = await prisma.customer.findMany({
    where: { tenantId, id: { in: all } },
    select: { id: true, frequencyWeeks: true, nextDueDate: true },
  });
  if (owned.length !== all.length) throw new Error("Some customers weren't found. Make the plan again.");
  const byId = new Map(owned.map((c) => [c.id, c]));
  const daysEarly = input.daysEarly != null && input.daysEarly >= 0 ? Math.min(90, Math.round(input.daysEarly)) : null;

  let created = 0;
  for (const a of plan) {
    const members = a.customerIds.map((id) => byId.get(id)!);
    // Area frequency = the most common one among its customers; next due = the earliest due.
    const freqCount = new Map<number, number>();
    for (const m of members) freqCount.set(m.frequencyWeeks, (freqCount.get(m.frequencyWeeks) ?? 0) + 1);
    const frequencyWeeks = [...freqCount.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 4;
    const dues = members.map((m) => m.nextDueDate).filter((d): d is Date => Boolean(d)).sort((x, y) => x.getTime() - y.getTime());
    const existing = await prisma.area.findFirst({ where: { tenantId, name: a.name }, select: { id: true } });
    const area = existing ?? await prisma.area.create({
      data: { tenantId, name: a.name, frequencyWeeks, nextDueDate: dues[0] ?? null, dueWindowDays: daysEarly },
      select: { id: true },
    });
    if (!existing) created++;
    else if (daysEarly != null) await prisma.area.update({ where: { id: area.id }, data: { dueWindowDays: daysEarly } });
    await bulkMoveCustomersToArea(a.customerIds, area.id);
  }

  // Old areas left with nobody in them and nothing booked are removed.
  const empty = await prisma.area.findMany({
    where: { tenantId, isSystemArea: false, customers: { none: {} }, workDays: { none: {} } },
    select: { id: true },
  });
  if (empty.length) await prisma.area.deleteMany({ where: { id: { in: empty.map((e) => e.id) } } });

  revalidatePath("/customers");
  revalidatePath("/areas");
  revalidatePath("/scheduler");
  return { created, moved: all.length, removedEmpty: empty.length };
}

// ─── AI-guided import ────────────────────────────────────────────────────────

/** Wyndos fields a sheet column can fill. */
export type ImportField =
  | "name" | "fullAddress" | "houseNumber" | "street" | "town" | "postcode"
  | "phone" | "email" | "price" | "frequency" | "lastCleaned" | "nextDue"
  | "notes" | "payment" | "area";

export type SheetLayout = {
  /** Field → column index (−1 = not in the sheet). */
  columns: Record<ImportField, number>;
  /** Day/month order of dates in the sheet. */
  dateOrder: "DMY" | "MDY";
  /** Frequency cell text (lower case) → weeks. */
  frequencyMap: Record<string, number>;
  /** Payment cell text (lower case) → CASH | BACS | CARD | DD | INVOICE | "". */
  paymentMap: Record<string, string>;
  /** Things the AI noticed, in plain English (max a few). */
  notes: string[];
};

const FIELDS: ImportField[] = ["name", "fullAddress", "houseNumber", "street", "town", "postcode", "phone", "email", "price", "frequency", "lastCleaned", "nextDue", "notes", "payment", "area"];

const LAYOUT_TOOL = {
  name: "save_sheet_layout",
  description: "Say which column holds each field, and how to read frequency and payment values.",
  input_schema: {
    type: "object",
    properties: {
      columns: {
        type: "object",
        description: "Column number (0-based) for each field, or -1 if the sheet doesn't have it.",
        properties: Object.fromEntries(FIELDS.map((f) => [f, { type: "integer" }])),
        required: FIELDS,
      },
      dateOrder: { type: "string", enum: ["DMY", "MDY"] },
      frequency: {
        type: "array",
        description: "Each distinct frequency value seen, and how many weeks it means (monthly = 4).",
        items: { type: "object", properties: { text: { type: "string" }, weeks: { type: "integer" } }, required: ["text", "weeks"] },
      },
      payment: {
        type: "array",
        description: "Each distinct payment value seen, and what it means.",
        items: { type: "object", properties: { text: { type: "string" }, method: { type: "string", enum: ["CASH", "BACS", "CARD", "DD", "INVOICE", ""] } }, required: ["text", "method"] },
      },
      notes: { type: "array", items: { type: "string" }, description: "Up to 4 short, plain-English things the owner should know about this sheet." },
    },
    required: ["columns", "dateOrder", "frequency", "payment", "notes"],
  },
} as const;

/**
 * Work out a messy sheet's layout. Sends only the headings, the first 5 rows and the distinct
 * values of short columns (like frequency or payment), never the whole customer list.
 */
export async function aiReadSheet(input: { headers: string[]; sample: string[][]; shortValues: Record<number, string[]> }): Promise<SheetLayout> {
  await requireOwner();
  const headers = (input.headers ?? []).slice(0, 60).map((h) => String(h ?? "").slice(0, 60));
  const sample = (input.sample ?? []).slice(0, 5).map((r) => (r ?? []).slice(0, 60).map((c) => String(c ?? "").slice(0, 80)));
  const shorts = Object.entries(input.shortValues ?? {}).slice(0, 60)
    .map(([col, values]) => `Column ${col}: ${(values ?? []).slice(0, 30).map((v) => JSON.stringify(String(v).slice(0, 40))).join(", ")}`);

  const prompt = `A UK window cleaner is importing their customer list from a spreadsheet into Wyndos. Work out what each column holds.

Fields: name (customer name), fullAddress (whole address in one cell), houseNumber, street, town, postcode, phone, email, price (per clean), frequency (how often cleaned), lastCleaned (date), nextDue (date), notes, payment (how they usually pay), area (round/area/day name).
Use -1 for fields the sheet doesn't have. If the address is split across columns use houseNumber/street/town/postcode and set fullAddress to -1, otherwise use fullAddress.
Frequency: give weeks for every distinct value (e.g. "4", "4w", "monthly" → 4; "8 weekly", "2 monthly" → 8; "6wk" → 6).
Payment: CASH, BACS (bank transfer), CARD, DD (direct debit / standing order), INVOICE (pays later), or "" if unclear.
Notes: tell the owner anything odd in plain English, e.g. "Some prices include '£' and text", "Dates look American (month first)".

Column headings (number: heading):
${headers.map((h, i) => `${i}: ${h || "(blank)"}`).join("\n")}

First rows:
${sample.map((r) => r.map((c, i) => `${i}=${JSON.stringify(c)}`).join(" | ")).join("\n")}

Distinct values in short columns:
${shorts.join("\n") || "(none)"}

Call save_sheet_layout.`;

  type Raw = { columns?: Record<string, unknown>; dateOrder?: unknown; frequency?: Array<{ text?: unknown; weeks?: unknown }>; payment?: Array<{ text?: unknown; method?: unknown }>; notes?: unknown[] };
  const raw = await callClaudeTool<Raw>(prompt, LAYOUT_TOOL, 4000);
  if (!raw?.columns) throw new Error("The AI couldn't read that sheet. Try the normal import instead.");
  const columns = Object.fromEntries(FIELDS.map((f) => {
    const n = Number(raw.columns?.[f]);
    return [f, Number.isInteger(n) && n >= 0 && n < headers.length ? n : -1];
  })) as Record<ImportField, number>;
  const frequencyMap: Record<string, number> = {};
  for (const e of raw.frequency ?? []) {
    const w = Number(e.weeks);
    if (typeof e.text === "string" && Number.isInteger(w) && w > 0 && w <= 52) frequencyMap[e.text.trim().toLowerCase()] = w;
  }
  const paymentMap: Record<string, string> = {};
  for (const e of raw.payment ?? []) {
    if (typeof e.text === "string" && ["CASH", "BACS", "CARD", "DD", "INVOICE", ""].includes(String(e.method))) paymentMap[e.text.trim().toLowerCase()] = String(e.method);
  }
  return {
    columns,
    dateOrder: raw.dateOrder === "MDY" ? "MDY" : "DMY",
    frequencyMap,
    paymentMap,
    notes: (raw.notes ?? []).filter((n): n is string => typeof n === "string").slice(0, 4).map((n) => n.slice(0, 200)),
  };
}

export type PlanRow = { street: string; town: string; postcode: string; price: number; frequencyWeeks: number; nextDue: string | null };

/** Plan areas for rows that aren't saved yet (customer ids in the result are row numbers). */
export async function planRows(input: { rows: PlanRow[]; answers: PlannerAnswers; useAi: boolean }) {
  await requireOwner();
  const rows = (input.rows ?? []).slice(0, 3000);
  if (rows.length === 0) throw new Error("No customers to sort.");
  const customers: PlannerCustomer[] = rows.map((r, i) => ({
    id: i,
    street: String(r.street ?? "").slice(0, 80),
    town: String(r.town ?? "").slice(0, 60),
    postcode: String(r.postcode ?? "").toUpperCase().slice(0, 10),
    price: Number(r.price) || 0,
    frequencyWeeks: Number(r.frequencyWeeks) > 0 ? Math.round(Number(r.frequencyWeeks)) : 4,
    nextDue: r.nextDue && /^\d{4}-\d{2}-\d{2}$/.test(r.nextDue) ? r.nextDue : null,
    areaName: "",
  }));
  const answers: PlannerAnswers = {
    workDays: (input.answers.workDays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    customersPerDay: input.answers.customersPerDay && input.answers.customersPerDay > 0 ? Math.min(500, Math.round(input.answers.customersPerDay)) : null,
    valuePerDay: input.answers.valuePerDay && input.answers.valuePerDay > 0 ? Math.min(100000, input.answers.valuePerDay) : null,
    daysEarly: input.answers.daysEarly != null && input.answers.daysEarly >= 0 ? Math.min(90, Math.round(input.answers.daysEarly)) : null,
    notes: String(input.answers.notes ?? "").slice(0, 1000),
  };
  return input.useAi ? aiPlan(customers, answers) : quickPlan(customers, answers);
}

/**
 * Import the checked rows with the areas the owner agreed. Uses the normal importer
 * (so matching existing customers, address splitting and area creation behave the same),
 * then sets each new area's "days early" window.
 */
export async function importWithPlan(input: {
  records: Parameters<typeof bulkImportCustomers>[0];
  daysEarly: number | null;
  bookRuns: boolean;
}) {
  const actor = await requireOwner();
  const records = (input.records ?? []).slice(0, 5000);
  if (records.length === 0) throw new Error("Nothing to import.");
  const result = await bulkImportCustomers(records, { createMissingAreas: true, existingMode: "skip", matchField: "nameAddress", bookRuns: input.bookRuns });
  const daysEarly = input.daysEarly != null && input.daysEarly >= 0 ? Math.min(90, Math.round(input.daysEarly)) : null;
  if (daysEarly != null) {
    const names = [...new Set(records.map((r) => r.areaName).filter((n): n is string => Boolean(n)))];
    await prisma.area.updateMany({ where: { tenantId: actor.tenantId, name: { in: names } }, data: { dueWindowDays: daysEarly } });
  }
  revalidatePath("/customers");
  revalidatePath("/areas");
  return result;
}
