/** Shared by the support form and the /api/support route. */
export const SUPPORT_SECTIONS = [
  "Scheduler",
  "Days & jobs",
  "Customers",
  "Importing customers",
  "Areas",
  "Payments & invoices",
  "Texts & messages",
  "Accounting & reports",
  "Team & workers",
  "Settings",
  "My account / signing in",
  "Something else",
] as const;

export const SUPPORT_KINDS = ["Something's not working", "I have a question", "Idea or request"] as const;

/** Attachments are emailed, and the server takes up to 10 MB per request. */
export const SUPPORT_MAX_BYTES = 9 * 1024 * 1024;
export const SUPPORT_MAX_FILES = 5;
