/**
 * A clean whose Direct Debit (GoCardless) is on its way: taken, not failed, not yet recorded as
 * paid. Shown as "Collecting" rather than "owes", and cash logged against it gets a warning.
 * Safe to use in the browser.
 */
const FAILED = new Set(["failed", "cancelled", "customer_approval_denied", "charged_back"]);

export function ddCollecting(j: { goCardlessPaymentId?: string | null; goCardlessStatus?: string | null }) {
  return Boolean(j.goCardlessPaymentId) && !FAILED.has(j.goCardlessStatus ?? "");
}
