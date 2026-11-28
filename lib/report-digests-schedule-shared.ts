/**
 * Digest staffing — the raw check of a 7shifts published-shifts answer, and the per-day roster. PURE: zero I/O,
 * no env, client-safe. The reader (another module) fetches one page with `parseJsonWithIdSource` and hands the
 * parsed answer here; the composer prints what `publishedRoster` returns.
 *
 * THE CLOSING RULE (plan §15.1.1):
 * > Nothing from 7shifts is used unless it is consistent with the request that was sent AND valid in its written form; anything else refuses that company and window and prints "not available".
 *
 * "Refuses that company and window" = `checkPublishedAnswer` returns `{ ok: false }` for the WHOLE answer. There
 * is no per-row or per-shop refusal and never a partial roster: one bad row and every shop of the company reads
 * "Schedule not available" for the window.
 *
 * The two halves:
 *   - CONSISTENT WITH THE REQUEST: the one terminal page asked for, at most `limit` rows, every row of the
 *     verified company (or making no company claim), published / not draft / not deleted, starting inside the
 *     window that was sent.
 *   - VALID IN ITS WRITTEN FORM: ids in their one canonical spelling (A2-3), booleans as booleans, dates that are
 *     real calendar days, clocks that are real clocks, offsets within ±14:00, no sub-millisecond digit V8 would
 *     drop (A2-1). A value a parser would repair is refused, not repaired.
 *
 * Only the keys in `CONSUMED_SHIFT_KEYS` are ever read from a row (A2-6 iii): after the checks each row is rebuilt
 * from those keys alone before the normalizer sees it.
 */
import type { Loaded } from "@/lib/report-digests-v2-shared";
import { pageStep } from "@/lib/sevenshifts/paginate-shared";
import { calendarDay, clockOk, normalizeShifts, offsetOk } from "@/lib/sevenshifts/normalize-shared";
import { etCalendarDate } from "@/lib/operational-day";

/** The request the digest sent, as it was sent. Every row is tested against it. */
export interface PublishedShiftsRequest {
  /** The page limit sent (`limit=`). */
  limit: number;
  /** The company `whoami` verified and the request's path named (canonical digit string). */
  companyId: string;
  /** The very strings sent as `start[gte]` and `start[lte]`. */
  startGte: string;
  startLte: string;
}

/** Every key of a shift row the digest consumes. NOTHING else of a row is ever read (A2-6). */
export const CONSUMED_SHIFT_KEYS = ["id", "location_id", "company_id", "user_id", "open", "role_id", "start", "end", "draft", "deleted", "publish_status"] as const;

/** One published shift that passed the raw check and the normalizer. `userId === null` exactly when `open`. */
export interface PublishedShift { id: string; locationId: string; userId: string | null; open: boolean; roleId: string | null; startAt: string; endAt: string }

/** Which gate refused an answer (fixed codes; never a value from the answer). */
export type AnswerRefusal =
  | "page_shape" | "page_not_terminal" | "page_prev_cursor" | "page_object_tag" | "page_too_many_rows"
  | "row_not_object" | "row_id" | "row_location" | "row_company" | "row_draft" | "row_deleted" | "row_publish_status"
  | "row_assignment" | "row_role" | "row_time_form" | "row_end_before_start" | "row_outside_window" | "row_duplicate_id"
  | "row_normalizer";

export type PublishedAnswer = { ok: true; shifts: PublishedShift[] } | { ok: false; refusal: AnswerRefusal };

// ── written forms ───────────────────────────────────────────────────────────────────────────────

/**
 * A2-3: the ONE canonical spelling of an id, as a STRING (`0`, or a nonzero digit and up to 17 more). A JS number
 * is never an id here: the bounded read turns a canonically written numeric token into this string and everything
 * else into NaN, so a number reaching this check had no source text verified (fail closed).
 */
const CANONICAL_ID = /^(?:0|[1-9]\d{0,17})$/;
function canonicalId(v: unknown): v is string {
  return typeof v === "string" && CANONICAL_ID.test(v);
}
/** Canonical and not `"0"` (7shifts' "none"). */
function realId(v: unknown): v is string {
  return canonicalId(v) && v !== "0";
}

/**
 * The normalizer's `ZONED` shape (`lib/sevenshifts/normalize-shared.ts`, `const ZONED`), the same language
 * re-written with groups: date, clock, fraction digits, zone. Kept in step by a test that runs both on one list.
 */
const ZONED_PARTS = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2}(?:\.(\d{1,9}))?)?)(Z|[+-]\d{2}:?\d{2})$/;

/**
 * A `start` / `end` valid in its WRITTEN form, as an epoch ms; null = refused. Every test runs on the text BEFORE
 * `Date.parse` (V8 rolls 30 February into March and `24:00` into the next day):
 *   - the normalizer's zoned shape;
 *   - the written date is a real calendar day (the normalizer's `calendarDay`, S12);
 *   - the written clock and zone pass the normalizer's own `clockOk` / `offsetOk` (A2-2: no hand-written ranges);
 *   - A2-1: no nonzero digit after the third fractional place (V8 keeps three, so `.000001` past a bound would
 *     otherwise parse AS the bound). Trailing zeros are fine.
 */
function writtenInstant(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = ZONED_PARTS.exec(v);
  if (!m) return null;
  const [, date, clock, fraction, zone] = m;
  if (!calendarDay(date!) || !clockOk(clock!) || !offsetOk(zone!)) return null;
  // A2-1: digits past the millisecond must all be zero.
  if (fraction !== undefined && /[1-9]/.test(fraction.slice(3))) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

type Obj = Record<string, unknown>;
/** A plain object (what `JSON.parse` makes of `{…}`): not null, not an array, no exotic prototype. */
function isPlainObject(v: unknown): v is Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
/** "Present" means an own key; a missing key is never read as null. */
function has(o: Obj, k: (typeof CONSUMED_SHIFT_KEYS)[number]): boolean {
  return Object.hasOwn(o, k);
}

/** The request itself is ours; if it is not well formed nothing can be shown consistent with it (fail closed). */
function requestOk(r: PublishedShiftsRequest): { gte: number; lte: number } | null {
  if (!Number.isSafeInteger(r.limit) || r.limit <= 0 || !realId(r.companyId)) return null;
  const gte = writtenInstant(r.startGte);
  const lte = writtenInstant(r.startLte);
  if (gte === null || lte === null || gte > lte) return null;
  return { gte, lte };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────────────

/** The whole gate: page gates, then every row, then the normalizer. Pure. */
export function checkPublishedAnswer(json: unknown, request: PublishedShiftsRequest): PublishedAnswer {
  // P1 / P2 (A2-4): one well-formed page whose cursor says it is the last.
  const step = pageStep(json);
  if (step.kind === "malformed") return refuse("page_shape");
  if (step.kind === "next") return refuse("page_not_terminal");
  const page = json as Obj & { data: unknown[]; meta: { cursor: Obj } };
  // P3 (A2-4 as narrowed by CC): a `prev` cursor says an earlier page exists, so this is not the one page asked for.
  // Do NOT look at `cursor.current`: CC ruled it unverified against the live API; it could blank every digest.
  const cursor = page.meta.cursor;
  if (Object.hasOwn(cursor, "prev") && cursor.prev !== null) return refuse("page_prev_cursor");
  // P4: the answer names itself as shifts, or does not name itself.
  if (Object.hasOwn(page, "object") && page.object !== "shifts") return refuse("page_object_tag");
  // P5: the row count, before any row is looked at.
  if (page.data.length > request.limit) return refuse("page_too_many_rows");
  return checkPublishedRows(page.data, request);
}

/** The row checks alone, on raw rows (the page gates already passed). Exported for the pure case table. */
export function checkPublishedRows(rows: unknown, request: PublishedShiftsRequest): PublishedAnswer {
  // Defensive repeats of the page gates this function relies on (a caller may hand rows in directly).
  if (!Array.isArray(rows)) return refuse("page_shape");
  const window = requestOk(request);
  if (window === null) return refuse("page_shape");
  if (rows.length > request.limit) return refuse("page_too_many_rows");

  const seen = new Set<string>();
  const built: Obj[] = [];
  const openOf: boolean[] = [];
  for (const raw of rows) {
    const r = checkRow(raw, request, window, seen);
    if (typeof r === "string") return refuse(r);
    built.push(r.row);
    openOf.push(r.open);
  }

  // A2-6 iii: the normalizer sees only the rebuilt rows; it must reject none.
  const out = normalizeShifts(built);
  if (out.rejected.length > 0 || out.rows.length !== built.length) return refuse("row_normalizer");
  const shifts: PublishedShift[] = [];
  for (let i = 0; i < out.rows.length; i++) {
    const s = out.rows[i]!;
    const open = openOf[i]!;
    // Cannot happen after checks 2 and 7; refused rather than assumed.
    if (s.location_id === null || (!open && s.user_id === null)) return refuse("row_normalizer");
    // `company_id` is dropped here: it was needed only for the check.
    shifts.push({ id: s.id, locationId: s.location_id, userId: open ? null : s.user_id, open, roleId: s.role_id, startAt: s.start_at, endAt: s.end_at });
  }
  return { ok: true, shifts };
}

function refuse(refusal: AnswerRefusal): PublishedAnswer {
  return { ok: false, refusal };
}

/** One row through checks 1–12, in order; the first failure is its code. On success: the row rebuilt from consumed keys. */
function checkRow(raw: unknown, request: PublishedShiftsRequest, window: { gte: number; lte: number }, seen: Set<string>): AnswerRefusal | { row: Obj; open: boolean } {
  // 1
  if (!isPlainObject(raw)) return "row_not_object";
  const o = raw;
  // 2
  if (!realId(o.id)) return "row_id";
  if (!realId(o.location_id)) return "row_location";
  // 3 (relaxed by CC, O12): a missing or null company makes no claim; any other value must be the verified company.
  if (has(o, "company_id") && o.company_id !== null) {
    if (!realId(o.company_id) || o.company_id !== request.companyId) return "row_company";
  }
  // 4–6: the documented default listing (published, not deleted); each key present and exact.
  if (!has(o, "draft") || o.draft !== false) return "row_draft";
  if (!has(o, "deleted") || o.deleted !== false) return "row_deleted";
  if (!has(o, "publish_status") || o.publish_status !== "published") return "row_publish_status";
  // 7: exactly one of ASSIGNED / OPEN.
  const open = assignment(o);
  if (open === null) return "row_assignment";
  // 8 (A2-5 as narrowed by CC): display-only. Missing = no role; present = a real id or an explicit no-role.
  if (has(o, "role_id")) {
    const v = o.role_id;
    if (!(v === null || v === "0" || realId(v))) return "row_role";
  }
  // 9: written form, before any parse.
  const start = writtenInstant(o.start);
  const end = writtenInstant(o.end);
  if (start === null || end === null) return "row_time_form";
  // 10
  if (!(end > start)) return "row_end_before_start";
  // 11: only the START was asked for (`start[gte]`, `start[lte]`), both ends included.
  if (start < window.gte || start > window.lte) return "row_outside_window";
  // 12: the canonical string is the id, so `7` and `"07"` cannot pass as two ids (A2-3).
  if (seen.has(o.id)) return "row_duplicate_id";
  seen.add(o.id);

  const row: Obj = {};
  for (const k of CONSUMED_SHIFT_KEYS) if (has(o, k)) row[k] = o[k];
  return { row, open };
}

/**
 * Check 7. ASSIGNED (false) = `user_id` is a real id AND `open` is false or absent. OPEN (true) = `open` is exactly
 * true AND `user_id` is absent, null or "0". Anything else (neither, both, a non-canonical `user_id`, a non-boolean
 * `open`) is null = refused.
 */
function assignment(o: Obj): boolean | null {
  const hasOpen = has(o, "open");
  const openV = hasOpen ? o.open : undefined;
  if (hasOpen && typeof openV !== "boolean") return null;
  const hasUser = has(o, "user_id");
  const userV = hasUser ? o.user_id : undefined;
  if (hasUser && userV !== null && !canonicalId(userV)) return null;
  if (realId(userV) && (!hasOpen || openV === false)) return false;
  if (openV === true && (!hasUser || userV === null || userV === "0")) return true;
  return null;
}

// ── the roster ──────────────────────────────────────────────────────────────────────────────────

export interface RosterPerson {
  /** The 7shifts user id (never printed). */
  userId: string;
  /** The structured first name (preferred, else first), trimmed; null = none on file (the composer prints "unnamed"). */
  firstName: string | null;
  /** The role of their FIRST shift of the day, trimmed and cut at 40 characters; null = no role. */
  roleName: string | null;
  /** Their FIRST shift of the day. */
  startAt: string; endAt: string;
  /** Further shifts the same day (said as "+1 shift"). */
  extraShifts: number;
}
export interface DayRoster {
  /** ET calendar day (YYYY-MM-DD). A shift belongs to the ET day of its START; an overnight shift is on its start day only. */
  day: string;
  /** Distinct assigned people, ordered by first start, then first name, then user id. */
  people: RosterPerson[];
  /** Assigned shifts that day (≥ people.length). */
  assignedShifts: number;
  /** Open shifts that day: counted, never named. */
  openShifts: number;
  /** Earliest start / latest end over the ASSIGNED shifts; null when there is none. */
  firstStart: string | null; lastEnd: string | null;
  /** Assigned shifts only: end − start, before breaks. */
  scheduledMinutes: number;
}
/** One shop's published schedule for a window of ET days: one `DayRoster` per day, in order, also for a day with no shift. */
export interface ShopSchedule { days: DayRoster[] }

export interface ScheduleNames {
  /** 7shifts user id → the structured first name (already preferred-else-first). A missing id = no name on file. */
  firstNames: ReadonlyMap<string, string | null>;
  /** 7shifts role id → role name. A missing id = no role shown. */
  roleNames: ReadonlyMap<string, string | null>;
}
/** The reader's contract (implemented in another packet). Never throws. */
export interface ScheduleReader { shopWindow(locationId: string, from: string, to: string): Promise<Loaded<ShopSchedule>> }
/** The role-name cut. */
export const ROLE_NAME_MAX = 40;

function trimmedOrNull(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** `preferred_first_name`, else `first_name`, trimmed; an empty result is null. NEVER a last name, never a display name. */
export function structuredFirstName(row: { first_name: string | null; preferred_first_name: string | null }): string | null {
  return trimmedOrNull(row.preferred_first_name) ?? trimmedOrNull(row.first_name);
}

/** Trimmed, cut at `ROLE_NAME_MAX` characters (code points, so a cut never splits a surrogate pair); empty → null. */
function roleNameOf(roleId: string | null, names: ScheduleNames): string | null {
  if (roleId === null) return null;
  const t = trimmedOrNull(names.roleNames.get(roleId));
  if (t === null) return null;
  return Array.from(t).slice(0, ROLE_NAME_MAX).join("").trimEnd();
}

/** Canonical digit strings: shorter is smaller, then lexical (= numeric order, locale-free). */
function idCompare(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}
/** Locale-free; a null name sorts last. */
function nameCompare(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** The roster of ONE 7shifts location for the ET days `days` (in order). Shifts of other locations and other days are ignored. */
export function publishedRoster(shifts: readonly PublishedShift[], sevenShiftsLocationId: string, days: readonly string[], names: ScheduleNames): ShopSchedule {
  const byDay = new Map<string, PublishedShift[]>();
  for (const s of shifts) {
    if (s.locationId !== sevenShiftsLocationId) continue;
    const day = etCalendarDate(s.startAt);
    const list = byDay.get(day);
    if (list) list.push(s);
    else byDay.set(day, [s]);
  }
  return { days: days.map((day) => dayRoster(day, byDay.get(day) ?? [], names)) };
}

function dayRoster(day: string, shifts: readonly PublishedShift[], names: ScheduleNames): DayRoster {
  let openShifts = 0;
  let scheduledMs = 0;
  let firstStart: string | null = null;
  let lastEnd: string | null = null;
  const assigned: PublishedShift[] = [];
  for (const s of shifts) {
    if (s.open || s.userId === null) { openShifts++; continue; }
    assigned.push(s);
    const a = Date.parse(s.startAt);
    const b = Date.parse(s.endAt);
    scheduledMs += b - a;
    if (firstStart === null || a < Date.parse(firstStart)) firstStart = s.startAt;
    if (lastEnd === null || b > Date.parse(lastEnd)) lastEnd = s.endAt;
  }
  // Each person's first shift: earliest start, then shift id.
  assigned.sort((x, y) => Date.parse(x.startAt) - Date.parse(y.startAt) || idCompare(x.id, y.id));
  const people = new Map<string, RosterPerson>();
  for (const s of assigned) {
    const userId = s.userId!;
    const p = people.get(userId);
    if (p) { p.extraShifts++; continue; }
    people.set(userId, {
      userId,
      firstName: trimmedOrNull(names.firstNames.get(userId)),
      roleName: roleNameOf(s.roleId, names),
      startAt: s.startAt,
      endAt: s.endAt,
      extraShifts: 0,
    });
  }
  const ordered = [...people.values()].sort(
    (x, y) => Date.parse(x.startAt) - Date.parse(y.startAt) || nameCompare(x.firstName, y.firstName) || idCompare(x.userId, y.userId),
  );
  return { day, people: ordered, assignedShifts: assigned.length, openShifts, firstStart, lastEnd, scheduledMinutes: scheduledMs / 60_000 };
}
