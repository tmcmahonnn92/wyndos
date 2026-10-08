/**
 * Features switched off for now. Flip to true to bring them back; the code is all still there.
 */

/** Texts sent by the server through a provider (VoodooSMS etc.). Off: every text goes from the user's own phone. */
export const AUTO_SMS_ENABLED = false;

/** Emailing invoices to customers. Off: invoices are downloaded as PDFs. */
export const INVOICE_EMAIL_ENABLED = false;

/**
 * GoCardless (Direct Debit): link mandates, sign-up links, collect per clean, sync.
 * On only where the build has NEXT_PUBLIC_GOCARDLESS_ENABLED=1 (e.g. the dev/staging server).
 */
export const GOCARDLESS_ENABLED = process.env.NEXT_PUBLIC_GOCARDLESS_ENABLED === "1";

/** Sorting customers into areas (quick sort and AI). Off: imports keep the sheet's areas or put everyone in "Imported". */
export const AREA_SORT_ENABLED = false;

/** The AI guided import (/customers/import/guided). Off: not linked or mentioned anywhere, and the page sends people to the normal import. */
export const GUIDED_IMPORT_ENABLED = false;

/** Smart import: the AI reads any customer file and shows a preview (needs ANTHROPIC_API_KEY on the server). */
export const SMART_IMPORT_ENABLED = true;
