/**
 * THE 7SHIFTS ENDPOINT TABLE — one place for every path, parameter set and response shape. Pure.
 *
 * Scheduling Phase 1, Task 4 Step 4 (and r2 #1: shapes). Read from developers.7shifts.com on
 * 2026-10-15 (the plan's "7shifts API facts"; the assignments example and the availability field
 * list re-read 2026-10-15 by the Task 4 builder). Task 6 Step 1 re-reads every reference page at
 * build time and fixes any path or parameter that moved HERE, in this one table.
 *
 * Read-only by construction: Phase 1 has no write path to 7shifts. Every id that enters a path is
 * validated as 1–18 digits, so no value from a payload or a request can steer a path.
 */

export const SEVENSHIFTS_API_VERSION = "2026-01-01";
export const SEVENSHIFTS_API_BASE = "https://api.7shifts.com";
/** Rows per page for paginated lists (the API allows 1–500). */
export const LIST_PAGE_LIMIT = 200;

export const SEVENSHIFTS_RESOURCES = [
  "whoami", "locations", "departments", "roles", "users", "assignments", "wages",
  "availabilities", "time_off", "shifts", "time_punches", "labor_settings",
] as const;
export type SevenShiftsResource = (typeof SEVENSHIFTS_RESOURCES)[number];

/**
 * How a response is read (r2 #1). Only `paginated` follows cursors and demands cursor metadata;
 * a `singleton` is ONE request checked by its own validator; `list-unpaginated` is an array with no
 * cursor (none today: the shape exists so a re-read that finds one declares it, never forces it
 * through the paginator).
 */
export type ResponseShape = "paginated" | "singleton" | "list-unpaginated";

/** The sync window. Dates are ET business dates, YYYY-MM-DD. */
export interface SyncWindow {
  /** `modified_since` (watermark − 48 h, as a date); null on a first run. */
  modifiedSince: string | null;
  /** The backfill range for dated resources (shifts, punches, availability weeks). */
  from: string;
  to: string;
}

export interface EndpointSpec {
  shape: ResponseShape;
  /** Per-user resources need `extra.userId`. Throws `bad_id` on any id that is not 1–18 digits. */
  path(companyId: string, extra?: { userId?: string }): string;
  params(window: SyncWindow): URLSearchParams;
}

const ID = /^\d{1,18}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function id(v: string | undefined): string {
  if (v === undefined || !ID.test(v)) throw new Error("bad_id");
  return v;
}
function date(v: string): string {
  if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new Error("bad_window");
  return v;
}
function checkWindow(w: SyncWindow): SyncWindow {
  if (w.modifiedSince !== null) date(w.modifiedSince);
  date(w.from);
  date(w.to);
  return w;
}

function company(resource: string) {
  return (companyId: string) => `/v2/company/${id(companyId)}/${resource}`;
}
function perUser(resource: string) {
  return (companyId: string, extra?: { userId?: string }) => `/v2/company/${id(companyId)}/users/${id(extra?.userId)}/${resource}`;
}

function listParams(w: SyncWindow, extra: Record<string, string> = {}, modified = true): URLSearchParams {
  checkWindow(w);
  const p = new URLSearchParams({ limit: String(LIST_PAGE_LIMIT), ...extra });
  if (modified && w.modifiedSince !== null) p.set("modified_since", w.modifiedSince);
  return p;
}
function noParams(w: SyncWindow): URLSearchParams {
  checkWindow(w);
  return new URLSearchParams();
}

export const SEVENSHIFTS_ENDPOINTS: Record<SevenShiftsResource, EndpointSpec> = {
  whoami: { shape: "singleton", path: () => "/v2/whoami", params: noParams },
  locations: { shape: "paginated", path: company("locations"), params: (w) => listParams(w, {}, false) },
  departments: { shape: "paginated", path: company("departments"), params: (w) => listParams(w, {}, false) },
  roles: { shape: "paginated", path: company("roles"), params: (w) => listParams(w, {}, false) },
  users: { shape: "paginated", path: company("users"), params: (w) => listParams(w) },
  assignments: { shape: "singleton", path: perUser("assignments"), params: noParams },
  wages: { shape: "singleton", path: perUser("wages"), params: noParams },
  availabilities: { shape: "paginated", path: company("availabilities"), params: (w) => listParams(w, { week_gte: w.from }, false) },
  time_off: { shape: "paginated", path: company("time_off"), params: (w) => listParams(w) },
  shifts: {
    shape: "paginated", path: company("shifts"),
    params: (w) => listParams(w, { "start[gte]": w.from, "start[lte]": w.to, include_deleted: "true", include_draft: "false" }),
  },
  time_punches: {
    shape: "paginated", path: company("time_punches"),
    params: (w) => listParams(w, { "clocked_in[gte]": w.from, "clocked_in[lte]": w.to }),
  },
  labor_settings: { shape: "singleton", path: company("labor_settings"), params: noParams },
};
