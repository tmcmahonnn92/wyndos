/**
 * Features switched off for now. Flip to true to bring them back; the code is all still there.
 */

/** Texts sent by the server through a provider (VoodooSMS etc.). Off: every text goes from the user's own phone. */
export const AUTO_SMS_ENABLED = false;

/** Emailing invoices to customers. Off: invoices are downloaded as PDFs. */
export const INVOICE_EMAIL_ENABLED = false;

/** GoCardless (Direct Debit) sync and settings. Off until the second stage. */
export const GOCARDLESS_ENABLED = false;

/** Sorting customers into areas (quick sort and AI). Off: the guided import keeps the sheet's areas or puts everyone in "Imported". */
export const AREA_SORT_ENABLED = false;
