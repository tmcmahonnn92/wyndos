/**
 * A customer's usual way of paying. Information only: it tells the worker
 * whether to expect cash at the door. Anyone can still pay on the day by any method.
 */
export const PAYMENT_PREFERENCES = [
  { value: "CASH", label: "Cash", short: "Cash" },
  { value: "BACS", label: "Bank transfer", short: "Bank" },
  { value: "CARD", label: "Card", short: "Card" },
  { value: "DD", label: "Direct Debit", short: "DD" },
  { value: "INVOICE", label: "Invoice / pays later", short: "Invoice" },
] as const;

export type PaymentPreference = (typeof PAYMENT_PREFERENCES)[number]["value"];

/** Normalise stored or legacy values ("bacs", "Bank transfer", "gocardless"...). */
export function normalisePreference(raw: string | null | undefined): PaymentPreference | "" {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v) return "";
  if (v.startsWith("CASH")) return "CASH";
  if (v === "DD" || v.includes("DIRECT DEBIT") || v.includes("GOCARDLESS")) return "DD";
  if (v.startsWith("INVOICE") || v.includes("LATER")) return "INVOICE";
  if (v.startsWith("BACS") || v.startsWith("BANK") || v.includes("TRANSFER")) return "BACS";
  if (v.startsWith("CARD")) return "CARD";
  return "";
}

export function preferenceLabel(raw: string | null | undefined, form: "label" | "short" = "label") {
  const value = normalisePreference(raw);
  const option = PAYMENT_PREFERENCES.find((entry) => entry.value === value);
  return option ? option[form] : "";
}

/** True when the worker should expect to collect money at the door. */
export function expectsPaymentAtDoor(raw: string | null | undefined) {
  const value = normalisePreference(raw);
  return value === "" || value === "CASH" || value === "CARD";
}
