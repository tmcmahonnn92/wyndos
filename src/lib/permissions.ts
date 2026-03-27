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
  CUSTOMERS:   "customers",   // view & manage customers
  AREAS:       "areas",       // view & manage round areas
  PAYMENTS:    "payments",    // view & log customer payments
  SETTINGS:    "settings",    // access business settings
  VIEW_PRICES: "viewprices",  // see job/customer prices
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = [
  "dashboard", "schedule", "scheduler", "customers", "areas", "payments", "settings", "viewprices",
];

/** Permissions automatically granted to a new worker invite if none are specified. */
export const DEFAULT_WORKER_PERMISSIONS: Permission[] = ["dashboard", "schedule", "viewprices"];

export const PERMISSION_LABELS: Record<Permission, { label: string; description: string }> = {
  dashboard:  { label: "Dashboard",    description: "Access the main dashboard"            },
  schedule:   { label: "Schedule",     description: "View & manage work days and runs"     },
  scheduler:  { label: "Scheduler",    description: "Use the drag-drop scheduler"          },
  customers:  { label: "Customers",    description: "View & manage the customer list"      },
  areas:      { label: "Areas",        description: "View & manage round areas"            },
  payments:   { label: "Payments",     description: "View & log customer payments"         },
  settings:   { label: "Settings",     description: "Access business settings"             },
  viewprices: { label: "View Prices",  description: "See job and customer prices"          },
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
