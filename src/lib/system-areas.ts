/**
 * Hidden "system" areas. They never show on the scheduler or the areas list.
 *  - One-Off Jobs: customers with no round.
 *  - Overdue – <area>: temporary groups for leftover jobs moved off a finished day.
 *  - Inactive customers: where inactive customers go when their old area is deleted,
 *    so their details, history and balance are kept.
 */
export const INACTIVE_AREA_NAME = "Inactive customers";

export function isInactiveArea(area: { isSystemArea?: boolean | null; name?: string | null } | null | undefined) {
  return Boolean(area?.isSystemArea && area.name === INACTIVE_AREA_NAME);
}

/**
 * An area that has something in it: an active customer, or a job still to do (quote or
 * one-off). Empty areas are left off the scheduler and don't count as overdue.
 */
export const AREA_IN_USE = {
  OR: [
    { customers: { some: { active: true } } },
    { workDays: { some: { status: { not: "COMPLETE" as const }, jobs: { some: { status: "PENDING" as const } } } } },
  ],
};
