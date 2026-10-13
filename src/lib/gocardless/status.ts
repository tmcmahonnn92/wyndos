/** Small Direct Debit helpers that are safe to use in the browser (no API calls). */

/** Mandate statuses a payment can be taken against. */
export const GC_MANDATE_USABLE = new Set(["pending_customer_approval", "pending_submission", "submitted", "active"]);

/** The customer has a Direct Debit mandate Wyndos can collect against. */
export function paysByDirectDebit(c: { goCardlessMandateId?: string | null; goCardlessMandateStatus?: string | null }) {
  return Boolean(c.goCardlessMandateId) && (!c.goCardlessMandateStatus || GC_MANDATE_USABLE.has(c.goCardlessMandateStatus));
}

/** An extra job (gutters, a conservatory…): a one-off that isn't their regular service. */
export function isExtraJob(job: { isOneOff: boolean; name: string }, customer: { jobName?: string | null }) {
  return job.isOneOff && job.name !== (customer.jobName || "Window Cleaning");
}

/** A regular clean their GoCardless plan (subscription) already pays for. */
export function coveredByPlan(job: { isOneOff: boolean; name: string }, customer: { goCardlessPlan?: string | null; jobName?: string | null }) {
  return Boolean(customer.goCardlessPlan) && !isExtraJob(job, customer);
}
