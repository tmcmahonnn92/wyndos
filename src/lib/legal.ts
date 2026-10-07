import { AREA_SORT_ENABLED, GUIDED_IMPORT_ENABLED, SMART_IMPORT_ENABLED } from "@/lib/features";
/**
 * Legal details shown in the Terms, Privacy and Cookie pages.
 *
 * Change TERMS_VERSION whenever the Terms or Privacy Policy change in a way owners
 * should agree to again: every owner is asked to accept the new version on their
 * next visit.
 *
 * Fill in OPERATOR before going live (see HANDOFF.md).
 */
export const TERMS_VERSION = "2026-10-05";
export const TERMS_UPDATED = "5 October 2026";

export const OPERATOR = {
  /** Your legal name, as a sole trader: e.g. "Thomas McMahon trading as Wyndos". */
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME || "the operator of Wyndos",
  /** A UK postal address for legal notices (a virtual office or registered address is fine). */
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS || "",
  /** ICO registration number, once registered. */
  icoNumber: process.env.NEXT_PUBLIC_ICO_NUMBER || "",
  /** Where the Hostinger server is, e.g. "United Kingdom" or "Lithuania (EU)". */
  hostingLocation: process.env.NEXT_PUBLIC_HOSTING_LOCATION || "the UK or the EU",
  email: "support@wyndos.io",
  site: "wyndos.io",
};

/** What the owner confirms about their own customers' details. Shown at sign-up and in the Terms. */
export const DATA_PERMISSION_TEXT =
  "I confirm I have the right to store and use my customers' details in Wyndos to provide my service, and I will tell my customers how I use their details.";

export const TERMS_ACCEPT_TEXT = "I agree to the Terms of Service and Privacy Policy, including the data processing terms.";

const OPERATOR_HOSTING = process.env.NEXT_PUBLIC_HOSTING_LOCATION || "UK / EU";

/** The companies Wyndos uses to run the service (sub-processors). Keep in step with reality. */
export const SUB_PROCESSORS: Array<{ name: string; purpose: string; location: string }> = [
  { name: "Hostinger", purpose: "Server hosting and database", location: OPERATOR_HOSTING },
  { name: "Brevo (Sendinblue)", purpose: "Sending account and notification emails", location: "EU (France)" },
  { name: "Stripe", purpose: "Wyndos subscription billing (business owners only, not your customers)", location: "EU / US" },
  { name: "Google", purpose: "Optional 'Sign in with Google'", location: "EU / US" },
  { name: "OpenStreetMap (Nominatim)", purpose: "Turning addresses into map positions", location: "EU / UK" },
  // Only while an AI feature is switched on.
  ...(AREA_SORT_ENABLED || GUIDED_IMPORT_ENABLED || SMART_IMPORT_ENABLED
    ? [{ name: "Anthropic (Claude)", purpose: "Optional AI help importing a customer file: the column headings and a few sample rows (emails and phone numbers partly hidden), only when the owner uses Smart import. Not used to train AI.", location: "US" }]
    : []),
];
