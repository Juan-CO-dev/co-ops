/**
 * The exact request body keys of the scheduling routes (Scheduling Phase 2, Task 18). A key outside the list, or one
 * missing, is 400 `bad_request` before any lib call. Kept out of the route modules (Next route files export only route
 * fields) and shared with the route tests and, later, the board's client.
 */
export const SCHEDULE_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  generate: ["action", "locationId", "weekStart", "expectedHead", "confirmEdited"],
  preview: ["action", "locationId", "request"],
  apply: ["action", "locationId", "request", "token", "confirmedWeekStarts"],
  edit: ["action", "locationId", "weekStart", "expectedHead", "op"],
  approve: ["action", "locationId", "weekStart", "expectedHead"],
  budget: ["action", "locationId", "scope", "weekStart", "month", "hours"],
  accept_budget: ["action", "locationId", "weekStart", "digest"],
  keep_budget: ["action", "locationId", "weekStart", "digest"],
  day_type: ["action", "locationId", "date", "dayType"],
  pin: ["action", "locationId", "pin"],
  // Astra BC-007: `expectedId` = the id of the latest settings row the full-row write was based on (null = none existed).
  person: ["action", "locationId", "settings", "expectedId"],
  // Juan 2026-10-20 / Astra BC-007: the user screen's pickers send ONLY what changed; the server merges onto the latest row.
  person_positions: ["action", "locationId", "userId", "changes", "expectedId"],
};

export const SCHEDULE_SETTINGS_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  structure: ["action", "locationId", "expectedId", "structure"],
  shop: ["action", "locationId", "enabled", "estimatedHourlyCents", "estimatedSalariedWeeklyCents", "agmAccess"],
};

/** The body's allowed keys for its action, or null (unknown action / not an object). */
export function exactShape(map: Readonly<Record<string, readonly string[]>>, b: Record<string, unknown>): readonly string[] | null {
  const allowed = typeof b.action === "string" && Object.hasOwn(map, b.action) ? map[b.action]! : null;
  if (!allowed || Object.keys(b).some((k) => !allowed.includes(k)) || allowed.some((k) => !Object.hasOwn(b, k))) return null;
  return allowed;
}
