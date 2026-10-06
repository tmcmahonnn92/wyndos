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
