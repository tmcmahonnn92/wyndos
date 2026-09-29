/**
 * Per-tenant worker permissions.
 *
 * OWNER and SUPER_ADMIN always have every permission.
 * WORKER accounts are granted specific permissions by the OWNER
 * when they are invited (or edited later in Settings → Team).
 */

export const PERMISSIONS = {
  DASHBOARD:   "dashboard",   // access the main dashboard
  SCHEDULE:    "schedule",    // view & manage work days / runs
  SCHEDULER:   "scheduler",   // access the drag-drop scheduler
  ROUTE_OPTIMISER: "routeoptimiser", // optimise daily route order in scheduler
  CUSTOMERS:   "customers",   // view & manage customers
  AREAS:       "areas",       // view & manage round areas
  PAYMENTS:    "payments",    // all customer payments & invoices (doorstep payments on their own jobs need no permission)
  ACCOUNTING:  "accounting",  // expenses, other income, business finances
  SETTINGS:    "settings",    // access business settings
  VIEW_PRICES: "viewprices",  // see job/customer prices
  MESSAGING:   "messaging",   // send texts: day reminders and bulk messages
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = [
  // Their own work
  "dashboard", "schedule", "viewprices",
  // Customers and money
  "customers", "payments", "messaging",
  // Planning
  "scheduler", "areas", "routeoptimiser",
  // Office
  "accounting", "settings",
];

/**
 * Ready-made roles so an owner picks one option instead of ticking nine boxes.
 * "Custom" (ticking boxes) is still available.
 */
export const ROLE_PRESETS: Array<{ key: string; label: string; description: string; permissions: Permission[] }> = [
  {
    key: "worker",
    label: "Worker",
    description: "Sees and works their own days. Takes payment at the door.",
    permissions: ["dashboard", "schedule", "viewprices"],
  },
  {
    key: "senior",
    label: "Senior worker",
    description: "Also sees customers and payments, and can plan days.",
    permissions: ["dashboard", "schedule", "viewprices", "customers", "payments", "scheduler", "routeoptimiser"],
  },
  {
    key: "office",
    label: "Office / admin",
    description: "Everything except business settings.",
    permissions: ["dashboard", "schedule", "scheduler", "routeoptimiser", "customers", "areas", "payments", "viewprices", "messaging", "accounting"],
  },
];

/** Permissions automatically granted to a new worker invite if none are specified. */
export const DEFAULT_WORKER_PERMISSIONS: Permission[] = ["dashboard", "schedule", "viewprices"];

export const PERMISSION_LABELS: Record<Permission, { label: string; description: string }> = {
  dashboard:  { label: "Dashboard",     description: "Home screen with today's work"                          },
  schedule:   { label: "Their days",    description: "See and work their own days, take payment at the door"  },
  viewprices: { label: "See prices",    description: "Prices and amounts owed on their jobs"                  },
  customers:  { label: "Customers",     description: "Customer list: view, add and edit; quotes"              },
  payments:   { label: "All payments",  description: "Every customer payment, log or edit any, invoices"      },
  messaging:  { label: "Texts",         description: "Send day reminders and bulk texts"                      },
  scheduler:  { label: "Plan the diary", description: "Scheduler: book, move and give out days"               },
  areas:      { label: "Areas",         description: "Create and change areas and their frequency"            },
  routeoptimiser: { label: "Route optimiser", description: "Optimise route order (hidden for now)"            },
  accounting: { label: "Accounting",    description: "Expenses, other income and business finances"           },
  settings:   { label: "Settings",      description: "Business settings (not team or data)"                   },
};

/** Parse the stored JSON permissions string back into a Permission array. */
export function parsePermissions(raw: string | null | undefined): Permission[] {
  try {
    const arr = JSON.parse(raw ?? "[]");
    return Array.isArray(arr)
      ? arr.filter((p): p is Permission => ALL_PERMISSIONS.includes(p as Permission))
      : [];
  } catch {
    return [];
  }
}

/** Serialise a Permission array for DB storage. */
export function serializePermissions(perms: Permission[]): string {
  return JSON.stringify(perms);
}
