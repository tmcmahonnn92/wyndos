/**
 * Wyndos price.
 *
 * Introductory offer: £9.99 a month, kept for life by every business that signs up while
 * the offer is open. After it closes, new businesses pay £14.99.
 *
 * The offer is open until INTRO_OFFER_ENDS (a date, e.g. 2026-12-31, inclusive).
 * Not set = still open. "Signed up" = the business's createdAt, so someone who starts a
 * trial before the end still gets £9.99 if they subscribe a bit later.
 * People already paying £9.99 in Stripe are never moved: Stripe keeps their price.
 */

export const INTRO_PENCE = 999;
export const STANDARD_PENCE = 1499;
export const INTRO_LABEL = "£9.99";
export const STANDARD_LABEL = "£14.99";

export function introOfferEnds(): Date | null {
  const v = process.env.INTRO_OFFER_ENDS?.trim();
  if (!v) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** New sign-ups still get £9.99 for life. */
export function introOfferOpen(now = new Date()) {
  const end = introOfferEnds();
  return !end || now <= end;
}

/** This business joined during the offer, so it pays £9.99. */
export function tenantOnIntro(createdAt: Date) {
  const end = introOfferEnds();
  return !end || createdAt <= end;
}

export function priceLabelFor(createdAt: Date) {
  return tenantOnIntro(createdAt) ? INTRO_LABEL : STANDARD_LABEL;
}

/** Price new sign-ups see on the website. */
export function publicPriceLabel() {
  return introOfferOpen() ? INTRO_LABEL : STANDARD_LABEL;
}
