/**
 * Suggest which customer a bank line came from. Pure functions (browser + tests).
 *
 * Nothing here ever records a payment: it only ranks suggestions. Every row is
 * checked and ticked by the user before anything is saved.
 */
import { normaliseKey, type BankLine } from "./parse";

export type MatchCustomer = {
  id: number;
  name: string;
  /** First line of the address: the reference customers are asked to use. */
  reference: string;
  /** Wyndos reference, e.g. WD-C123. */
  wyndosRef: string;
  /** Unpaid completed jobs this customer pays (their own + anyone they pay for), oldest first. */
  unpaid: Array<{ jobId: number; due: number; date: string | null; label: string }>;
};

export type LearnedReference = { key: string; customerId: number | null; ignore: boolean };

export type Candidate = {
  customerId: number;
  score: number;
  reasons: string[];
  amountFits: boolean;
};

export type LineSuggestion = {
  status: "suggested" | "check" | "unmatched" | "ignore";
  candidates: Candidate[];
  warning?: string;
};

/** Words banks add that say nothing about who paid. */
const NOISE = /\b(FASTER PAYMENTS?|FASTER PAYMENT RECEIVED|FPI|FPS|BGC|BANK GIRO CREDIT|BANK CREDIT|TFR|TRANSFER|TRF|FROM|REF|REFERENCE|PAYMENT|PYMT|MOBILE|ONLINE|BANKING|CREDIT|RECEIVED|BP|STO|STANDING ORDER|SO|DIRECT|INWARD|VIA|APP|GBP)\b/g;

/** References too general to learn (many customers would write the same thing). */
const GENERIC = new Set(["WINDOW", "WINDOWS", "WINDOWCLEAN", "WINDOWCLEANING", "WINDOWCLEANER", "CLEANING", "CLEANER", "CLEAN", "INVOICE", "THANKS", "THANKYOU", "CASH"]);

/** The parts of a bank line worth learning or comparing: each separate field plus the whole thing, cleaned. */
export function referenceKeys(text: string): string[] {
  const parts = text.split(" · ").map((p) => p.toUpperCase().replace(NOISE, " "));
  const keys = [...parts, parts.join(" ")].map(normaliseKey).filter((k) => k.length >= 4 && !GENERIC.has(k) && !/^\d+$/.test(k));
  return [...new Set(keys)];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Does the amount match one unpaid job, the oldest few together, or everything owed? */
export function amountFits(amount: number, unpaid: MatchCustomer["unpaid"]): boolean {
  if (unpaid.length === 0) return false;
  let running = 0;
  for (const job of unpaid) {
    if (Math.abs(job.due - amount) < 0.005) return true;
    running = round2(running + job.due);
    if (Math.abs(running - amount) < 0.005) return true;
  }
  return false;
}

/**
 * Split an amount across unpaid jobs, oldest first. Anything left over is credit.
 * Mirrors how the server applies credit.
 */
export function allocateOldestFirst(amount: number, unpaid: MatchCustomer["unpaid"]) {
  let remaining = round2(amount);
  const allocations: Array<{ jobId: number; amount: number }> = [];
  for (const job of unpaid) {
    if (remaining <= 0.005) break;
    const take = round2(Math.min(job.due, remaining));
    if (take > 0.005) allocations.push({ jobId: job.jobId, amount: take });
    remaining = round2(remaining - take);
  }
  return { allocations, extra: Math.max(0, remaining) };
}

function surnameOf(name: string) {
  const words = name.trim().split(/\s+/).filter((w) => !/^(mr|mrs|ms|miss|dr|and|&)$/i.test(w));
  return words.length > 1 ? normaliseKey(words[words.length - 1]) : "";
}

export function suggestFor(line: BankLine, customers: MatchCustomer[], learned: LearnedReference[]): LineSuggestion {
  const lineKeys = referenceKeys(line.text);
  const whole = normaliseKey(line.text);
  const spaced = ` ${line.text.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()} `;
  const learnedByKey = new Map(learned.map((l) => [l.key, l]));

  // A learned "not a customer payment" reference.
  const learnedHits = lineKeys.map((k) => learnedByKey.get(k)).filter((l): l is LearnedReference => Boolean(l));
  if (learnedHits.length > 0 && learnedHits.every((l) => l.ignore)) {
    return { status: "ignore", candidates: [] };
  }

  const scored: Candidate[] = [];
  for (const customer of customers) {
    let score = 0;
    const reasons: string[] = [];
    if (learnedHits.some((l) => l.customerId === customer.id)) {
      score += 100;
      reasons.push("Matched by saved reference");
    }
    const ref = normaliseKey(customer.reference);
    // Banks cut references short ("68 RIDDEL" for "68 Riddel Road"): the house number + first street word counts too.
    const shortRef = normaliseKey(customer.reference.trim().split(/\s+/).slice(0, 2).join(""));
    if ((ref.length >= 4 && whole.includes(ref)) || (shortRef.length >= 5 && /\d/.test(shortRef) && whole.includes(shortRef))) {
      score += 60;
      reasons.push("Reference matches address");
    }
    const wd = normaliseKey(customer.wyndosRef);
    if (wd.length >= 4 && whole.includes(wd)) {
      score += 60;
      reasons.push("Wyndos reference");
    }
    const fullName = normaliseKey(customer.name);
    const surname = surnameOf(customer.name);
    if (fullName.length >= 5 && whole.includes(fullName)) {
      score += 40;
      reasons.push("Name matches");
    } else if (surname.length >= 3 && spaced.includes(` ${surname} `)) {
      score += 20;
      reasons.push("Surname matches");
    }
    const fits = amountFits(line.amount, customer.unpaid);
    if (score > 0 && fits) {
      score += 30;
      reasons.push("Amount matches what's owed");
    }
    if (score > 0) scored.push({ customerId: customer.id, score, reasons, amountFits: fits });
  }

  // Nothing in the text: offer customers whose debt fits the amount, but only as a hint.
  if (scored.length === 0) {
    const byAmount = customers
      .filter((c) => amountFits(line.amount, c.unpaid))
      .map((c) => ({ customerId: c.id, score: 5, reasons: ["Amount matches what's owed"], amountFits: true }));
    return { status: "unmatched", candidates: byAmount.slice(0, 5) };
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const runnerUp = scored[1];
  const clearWinner = !runnerUp || top.score - runnerUp.score >= 30;
  let warning: string | undefined;
  if (top.reasons.includes("Matched by saved reference") && !top.amountFits) {
    const customer = customers.find((c) => c.id === top.customerId);
    warning = customer && customer.unpaid.length === 0
      ? "Saved reference, but this customer owes nothing. Check it."
      : "Saved reference, but the amount doesn't match what's owed. Check it.";
  }
  const strong = top.score >= 90 && top.amountFits && clearWinner;
  return {
    status: strong && !warning ? "suggested" : "check",
    candidates: scored.slice(0, 5),
    warning,
  };
}
