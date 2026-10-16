/**
 * THE 7SHIFTS ENDPOINT TABLE — one place for every path, parameter set and response shape. Pure.
 *
 * Scheduling Phase 1, Task 4 Step 4 (and r2 #1: shapes). Read from developers.7shifts.com on
 * 2026-10-15 (the plan's "7shifts API facts"; the assignments example and the availability field
 * list re-read 2026-10-15 by the Task 4 builder). Task 6 Step 1 re-reads every reference page at
 * build time and fixes any path or parameter that moved HERE, in this one table.
 *
 * DOCS RE-READ 2026-10-15 (Astra's chunk A review + Task 6 Step 1). What moved:
 *   · time off is `GET /v2/time_off?company_id=…`: the company is a REQUIRED query parameter, not a
 *     path segment. It takes `to_date_gte` (YYYY-MM-DD) and has NO `modified_since`
 *     (reference/gettimeofflist).
 *   · time punches default to `deleted=false`, so they are read in TWO passes, `deleted=false` and
 *     `deleted=true`; otherwise a punch deleted in 7shifts would never reach the mirror
 *     (reference/gettimepunches).
 *   · `start[gte|lte]`, `clocked_in[gte|lte]` and `modified_since` on shifts and punches are
 *     DATE-TIMES. The window's ET business dates become explicit UTC instants through the house ET
 *     helper (DST-correct), and the watermark is an instant (reference/listshift, gettimepunches).
 *     Users keep a DATE `modified_since` (YYYY-MM-DD, confirmed on reference/listuserslist by Astra's
 *     chunk B review).
 *
 * CHUNK B REVIEW (Astra, 2026-10-15):
 *   · shifts send `consider_tz_in_ranges=true`: `true` honours the offset of the explicit UTC instants
 *     we send; `false` would read them as shop-local times (reference/listshift).
 *   · availability is TWO disjoint passes into one mirror: weekly records (`repeating=false`) bounded by
 *     `week_gte`, and repeating records (`repeating=true`) with NO week floor, because a repeating set
 *     made months ago can still govern today (reference/listavailabilities).
 *   · users are read in two explicit passes, `status=active` and `status=inactive`, so the endpoint's
 *     status default never decides what we see.
 *
 * Read-only by construction: Phase 1 has no write path to 7shifts. Every id that enters a path or a
 * query is validated as 1–18 digits, so no value from a payload or a request can steer a request.
 */
import { etCalendarDate, etYmdMinusDays, operationalDayUtcRange } from "@/lib/operational-day";

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

/** The sync window. `from` / `to` are ET business dates, YYYY-MM-DD, both inclusive. */
export interface SyncWindow {
  /** `modified_since`: the watermark − 48 h as a ZONED ISO instant; null on a first run. */
  modifiedSince: string | null;
  /** The backfill range for dated resources (shifts, punches, availability weeks, time off). */
  from: string;
  to: string;
}

export interface EndpointSpec {
  shape: ResponseShape;
  /** Per-user resources need `extra.userId`. Throws `bad_id` on any id that is not 1–18 digits. */
  path(companyId: string, extra?: { userId?: string }): string;
  /** The company id is passed for endpoints that take it as a query parameter (time off). */
  params(window: SyncWindow, companyId: string): URLSearchParams;
  /**
   * Extra query sets, one REQUEST PASS each, merged over `params` (time punches: `deleted=false`
   * then `deleted=true`). A null value REMOVES that base parameter for the pass (availability's
   * repeating pass drops `week_gte`). Absent = one pass. A resource is complete only when every pass is.
   */
  passes?: readonly Readonly<Record<string, string | null>>[];
}

const ID = /^\d{1,18}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

function id(v: string | undefined): string {
  if (v === undefined || !ID.test(v)) throw new Error("bad_id");
  return v;
}
function date(v: string): string {
  if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new Error("bad_window");
  return v;
}
function instant(v: string): string {
  if (!ZONED.test(v) || !Number.isFinite(Date.parse(v))) throw new Error("bad_window");
  return v;
}
function checkWindow(w: SyncWindow): SyncWindow {
  if (w.modifiedSince !== null) instant(w.modifiedSince);
  date(w.from);
  date(w.to);
  if (w.from > w.to) throw new Error("bad_window");
  return w;
}

/** Second-precision UTC ISO (`2026-10-15T04:00:00Z`), the date-time shape the docs show. */
function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * The window as INSTANTS: from the first second of ET business day `from` to the last second of
 * ET business day `to`, both inclusive (the filters are gte / lte). DST-correct through
 * `operationalDayUtcRange`, the house ET helper.
 */
export function windowInstants(w: SyncWindow): { gte: string; lte: string } {
  checkWindow(w);
  return {
    gte: iso(Date.parse(operationalDayUtcRange(w.from).startIso)),
    // The NEXT day's start, not start + 24 h: a fall-back day is 25 hours long.
    lte: iso(Date.parse(operationalDayUtcRange(etYmdMinusDays(w.to, -1)).startIso) - 1000),
  };
}
function modifiedInstant(w: SyncWindow): string | null {
  return w.modifiedSince === null ? null : iso(Date.parse(w.modifiedSince));
}
/** A DATE `modified_since`: the ET date of the watermark instant (never later than it, so it only widens). */
function modifiedDate(w: SyncWindow): string | null {
  return w.modifiedSince === null ? null : etCalendarDate(new Date(Date.parse(w.modifiedSince)).toISOString());
}

function company(resource: string) {
  return (companyId: string) => `/v2/company/${id(companyId)}/${resource}`;
}
function perUser(resource: string) {
  return (companyId: string, extra?: { userId?: string }) => `/v2/company/${id(companyId)}/users/${id(extra?.userId)}/${resource}`;
}

type Modified = "instant" | "date" | "none";
function listParams(w: SyncWindow, extra: Record<string, string> = {}, modified: Modified = "none"): URLSearchParams {
  checkWindow(w);
  const p = new URLSearchParams({ limit: String(LIST_PAGE_LIMIT), ...extra });
  const since = modified === "instant" ? modifiedInstant(w) : modified === "date" ? modifiedDate(w) : null;
  if (since !== null) p.set("modified_since", since);
  return p;
}
function noParams(w: SyncWindow): URLSearchParams {
  checkWindow(w);
  return new URLSearchParams();
}

export const SEVENSHIFTS_ENDPOINTS: Record<SevenShiftsResource, EndpointSpec> = {
  whoami: { shape: "singleton", path: () => "/v2/whoami", params: noParams },
  locations: { shape: "paginated", path: company("locations"), params: (w) => listParams(w) },
  departments: { shape: "paginated", path: company("departments"), params: (w) => listParams(w) },
  roles: { shape: "paginated", path: company("roles"), params: (w) => listParams(w) },
  users: {
    shape: "paginated", path: company("users"), params: (w) => listParams(w, {}, "date"),
    // Explicit statuses: never rely on the endpoint's default (chunk B review).
    passes: [{ status: "active" }, { status: "inactive" }],
  },
  assignments: { shape: "singleton", path: perUser("assignments"), params: noParams },
  wages: { shape: "singleton", path: perUser("wages"), params: noParams },
  availabilities: {
    shape: "paginated", path: company("availabilities"), params: (w) => listParams(w, { week_gte: w.from }),
    // Disjoint: weekly records inside the window, and EVERY repeating record (no week floor) — chunk B review #3.
    passes: [{ repeating: "false" }, { repeating: "true", week_gte: null }],
  },
  time_off: {
    shape: "paginated",
    path: (companyId) => { id(companyId); return "/v2/time_off"; },
    params: (w, companyId) => listParams(w, { company_id: id(companyId), to_date_gte: w.from }),
  },
  shifts: {
    shape: "paginated", path: company("shifts"),
    // Explicit UTC instants; consider_tz_in_ranges=true so 7shifts honours their offset (chunk B review #1).
    params: (w) => {
      const { gte, lte } = windowInstants(w);
      return listParams(w, { "start[gte]": gte, "start[lte]": lte, include_deleted: "true", include_draft: "false", consider_tz_in_ranges: "true" }, "instant");
    },
  },
  time_punches: {
    shape: "paginated", path: company("time_punches"),
    params: (w) => {
      const { gte, lte } = windowInstants(w);
      return listParams(w, { "clocked_in[gte]": gte, "clocked_in[lte]": lte }, "instant");
    },
    // The API defaults to deleted=false: read live AND deleted punches so a deletion reaches the mirror.
    passes: [{ deleted: "false" }, { deleted: "true" }],
  },
  labor_settings: { shape: "singleton", path: company("labor_settings"), params: noParams },
};

/** Every request pass of a resource, in order: `params` with each declared pass merged over it. */
export function requestPasses(resource: SevenShiftsResource, w: SyncWindow, companyId: string): URLSearchParams[] {
  const spec = SEVENSHIFTS_ENDPOINTS[resource];
  const base = spec.params(w, companyId);
  if (!spec.passes || spec.passes.length === 0) return [base];
  return spec.passes.map((extra) => {
    const p = new URLSearchParams(base);
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    return p;
  });
}
