/**
 * 7SHIFTS NORMALIZERS — raw API rows → minimal mirror rows, PII dropped BEFORE any write. Pure.
 *
 * Scheduling Phase 1, Task 4 Step 3 (r2 #1, r2 #2).
 *
 * WHAT IS DROPPED, ALWAYS: email, mobile/home numbers, birth date, address, `punch_id` (a clock-in
 * credential), `hourly_wage` (users, punches), tips, notes, availability `*_comments` / `*_reason` /
 * `status_action_message` / `old_approved_data`, time-off comments and category text. A normalizer
 * builds its output from an explicit allow-list, so a field 7shifts adds later is dropped too.
 *
 * IDS are 7shifts integers kept as digit strings (`/^\d{1,18}$/`, stored as bigint). Instants must
 * carry a zone and are re-emitted as UTC ISO; a zoneless instant is `bad_instant`, never read as
 * the server's local time. Dates are YYYY-MM-DD.
 *
 * DATE-ONLY AND LOCAL-TIME FIELDS (2026-11-11, the first prod sync rejected EVERY time-off and
 * availability row). 7shifts' own OpenAPI marks `birth_date` `format: date`, shift / punch instants
 * `format: date-time` (ISO8601 UTC) and `partial_from` `format: time` — but leaves time-off
 * `from_date` / `to_date` / `created` and availability `week` / `week_to` / `modified` as bare
 * strings (reference/gettimeofflist, reference/listavailabilities). Those are CALENDAR DATES and WALL
 * TIMES in the shop's day, never instants, so they are read as such and NEVER coerced into UTC:
 *   · a time-off / availability date accepts `YYYY-MM-DD`, a zoneless `YYYY-MM-DD[ T]HH:MM:SS` (the wall
 *     date is kept; the clock must be a real one) and a zoned value ONLY at midnight with a real offset
 *     (a date serialized as a timestamp); a zoned non-midnight value is `bad_date` — its wall date would
 *     depend on a zone we do not know. Users' `hire_date` and wages' `effective_date` stay STRICT
 *     `YYYY-MM-DD` (unchanged from the baseline);
 *   · a time accepts `H:MM`, `HH:MM`, `HH:MM:SS(.f)` (re-emitted `HH:MM:SS`) and the time part of a
 *     zoneless datetime; a zoned datetime is `bad_time`;
 *   · a code (status, a day's availability code) accepts an integer or a digit string;
 *   · a flag accepts a boolean or 0 / 1;
 *   · `modified` on availabilities is documented "in UTC" with no format, so a zoneless value there IS
 *     a UTC instant (`optUtcInstant`); shifts, punches and users keep the strict rule above.
 *
 * NEVER THROWS ON A ROW, NEVER DROPS SILENTLY. Each function returns `{ rows, rejected }`;
 * `rejected` names each refused input row by index with a fixed code. For list resources a
 * rejection marks the resource failed for the run (its watermark holds); for the snapshot kinds
 * (assignments, wages) ANY rejection makes that user's snapshot incomplete, so nothing of theirs is
 * retired (Task 7). The fields 7shifts sends are per the plan's API facts (read 2026-10-15); the
 * Task 6 doc re-read confirms or corrects them here.
 *
 * THE REJECTION VOCABULARY IS CLOSED (`REJECT_REASONS`). `rejectionHistogram` folds a run's rejections
 * into `{ reason: count }` so the ledger can say WHICH rule fired, with no index, field, value or
 * payload: it counts only reasons in the vocabulary and nothing else can enter it.
 */
import type { AssignmentsSnapshot, WagesSnapshot } from "@/lib/sevenshifts/paginate-shared";

/** The closed vocabulary; the ledger histogram counts these and nothing else. */
export const REJECT_REASONS = ["not_object", "missing_field", "bad_id", "bad_instant", "bad_date", "bad_time", "bad_value"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
/** `{ reason: count }`, only reasons that occurred, counts ≥ 1. Never a value, an index or a field. */
export type RejectionHistogram = Partial<Record<RejectReason, number>>;
export interface Rejected {
  index: number;
  reason: RejectReason;
  /** For a singleton snapshot: which list inside it the row came from. */
  part?: string;
}
export interface Normalized<R> {
  rows: R[];
  rejected: Rejected[];
}

// ─── Row types (one per mirror table; the column sets are pinned in mirror-spec-shared) ───

export interface UserRow {
  id: string; company_id: string; first_name: string | null; last_name: string | null;
  preferred_first_name: string | null; employee_id: string | null; user_type: string | null;
  active: boolean; hire_date: string | null; skill_level: number | null; source_modified_at: string | null;
}
export interface LocationRow { id: string; company_id: string; name: string | null; timezone: string | null; active: boolean | null }
export interface DepartmentRow { id: string; location_id: string | null; name: string | null }
export interface RoleRow { id: string; location_id: string | null; department_id: string | null; name: string | null; active: boolean | null }
export interface ShiftRow {
  id: string; user_id: string | null; location_id: string | null; department_id: string | null; role_id: string | null;
  station_id: string | null; start_at: string; end_at: string; draft: boolean | null; open: boolean | null;
  deleted: boolean; source_modified_at: string | null;
}
export interface TimePunchRow {
  id: string; user_id: string; location_id: string | null; department_id: string | null; role_id: string | null;
  shift_id: string | null; clocked_in: string; clocked_out: string | null; break_minutes: number | null;
  approved: boolean | null; auto_clocked_out: boolean | null; deleted: boolean; source_modified_at: string | null;
}
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/**
 * A day's availability as 7shifts codes it (integer code + from/to wall times `HH:MM:SS`), with no
 * comment or reason. `code` is null when 7shifts sent no code for that day (kept as sent, not invented).
 */
export interface AvailabilityDay { code: number | null; from: string | null; to: string | null }
export interface AvailabilityRow {
  id: string; user_id: string; week: string | null; week_to: string | null; repeating: boolean | null;
  status: number | null; days: Record<Weekday, AvailabilityDay>; source_modified_at: string | null;
}
export interface TimeOffRow {
  id: string; user_id: string; from_date: string; to_date: string; partial: boolean | null;
  from_time: string | null; to_time: string | null; status: number | null; hours: number | null;
  source_modified_at: string | null;
}
export interface LaborSettingsRow {
  company_id: string; daily_ot_threshold: number | null; weekly_ot_threshold: number | null;
  premium_ot_threshold: number | null; consecutive_days_threshold: number | null;
  overtime_enabled: boolean | null; overtime_by_location_enabled: boolean | null;
  multipliers: Record<string, number>;
}
export interface AssignmentEdgeRow {
  edge_key: string; user_id: string; location_id: string | null; department_id: string | null;
  role_id: string | null; is_primary: boolean | null;
}
export const WAGE_TYPES = ["hourly", "weekly_salary", "annual_salary"] as const;
export interface WageRow {
  user_id: string; wage_id: string; upcoming: boolean; effective_date: string | null;
  wage_type: (typeof WAGE_TYPES)[number]; wage_cents: number; role_id: string | null;
}

// ─── Field readers: each throws a RejectReason, caught per row ───

class Reject extends Error {
  constructor(readonly reason: RejectReason) { super(reason); }
}
type Obj = Record<string, unknown>;
const ID = /^\d{1,18}$/;
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;
/**
 * A calendar date as 7shifts may spell it: `YYYY-MM-DD`, optionally followed by a clock
 * (`T` or a space, `HH:MM`, optional `:SS(.f)`) and an optional zone. Groups: date, clock, zone.
 */
const DATE_SHAPE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)\s*(Z|[+-]\d{2}:?\d{2})?)?$/;
/** A wall time: `H:MM`, `HH:MM`, `HH:MM:SS`, `HH:MM:SS.f`. Groups: h, m, s. */
const TIME_SHAPE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,9})?$/;
/** A zoneless datetime the docs declare UTC (`YYYY-MM-DD[ T]HH:MM[:SS[.f]]`). */
const ZONELESS_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/;
const DIGITS = /^-?\d{1,9}$/;
const DECIMAL = /^-?\d{1,9}(\.\d{1,6})?$/;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function absent(v: unknown): boolean {
  return v === undefined || v === null;
}
function idOf(v: unknown): string {
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0) throw new Reject("bad_id");
    return String(v);
  }
  if (typeof v === "string" && ID.test(v)) return v;
  throw new Reject("bad_id");
}
function reqId(o: Obj, k: string): string {
  if (absent(o[k])) throw new Reject("missing_field");
  const s = idOf(o[k]);
  if (s === "0") throw new Reject("bad_id");
  return s;
}
/** An optional reference: absent, null or 0 (7shifts' "none") → null. */
function optId(o: Obj, k: string): string | null {
  if (absent(o[k])) return null;
  const s = idOf(o[k]);
  return s === "0" ? null : s;
}
function instantOf(v: unknown): string {
  if (typeof v !== "string" || !ZONED.test(v)) throw new Reject("bad_instant");
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) throw new Reject("bad_instant");
  return new Date(ms).toISOString();
}
function reqInstant(o: Obj, k: string): string {
  if (absent(o[k])) throw new Reject("missing_field");
  return instantOf(o[k]);
}
function optInstant(o: Obj, k: string): string | null {
  return absent(o[k]) || o[k] === "" ? null : instantOf(o[k]);
}
/**
 * A documented-UTC instant that may arrive zoneless (availability `modified`: "in UTC", no format).
 * A zoned value is honoured as such; a zoneless one is read AS UTC because the docs say so — this is
 * the ONE place a zoneless value becomes an instant, and only for fields the docs declare UTC.
 */
function optUtcInstant(o: Obj, k: string): string | null {
  const v = o[k];
  if (absent(v) || v === "") return null;
  if (typeof v !== "string") throw new Reject("bad_instant");
  if (ZONED.test(v)) return instantOf(v);
  if (!ZONELESS_DATETIME.test(v)) throw new Reject("bad_instant");
  const ms = Date.parse(`${v.replace(" ", "T")}Z`);
  if (!Number.isFinite(ms)) throw new Reject("bad_instant");
  return new Date(ms).toISOString();
}
/** A real calendar day (Feb 30 is refused: V8 rolls it over, the round trip catches it). */
function calendarDay(d: string): boolean {
  const ms = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d;
}
/**
 * THE STRICT DATE (users `hire_date`, wages `effective_date`): exactly `YYYY-MM-DD`, as it always was.
 * These fields are `format: date` in 7shifts' OAS and synced fine; the tolerant parser below is for the
 * two resources whose dates arrive as bare strings and MUST NOT loosen these (review round, P2).
 */
const STRICT_DATE = /^\d{4}-\d{2}-\d{2}$/;
function strictDateOf(v: unknown): string {
  if (typeof v !== "string" || !STRICT_DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new Reject("bad_date");
  return v;
}
function reqDate(o: Obj, k: string): string {
  if (absent(o[k])) throw new Reject("missing_field");
  return strictDateOf(o[k]);
}
function optDate(o: Obj, k: string): string | null {
  return absent(o[k]) || o[k] === "" ? null : strictDateOf(o[k]);
}
/** A clock of a date field is a real wall clock: 00–23 h, 00–59 min, 00–59 s (fraction free). */
function clockOk(clock: string): boolean {
  const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?$/.exec(clock);
  if (!m) return false;
  return Number(m[1]) <= 23 && Number(m[2]) <= 59 && (m[3] === undefined || Number(m[3]) <= 59);
}
/** `Z`, or an offset within ±14:00 with 00–59 minutes (the real-world UTC offset range). */
function offsetOk(zone: string): boolean {
  if (zone === "Z") return true;
  const m = /^[+-](\d{2}):?(\d{2})$/.exec(zone);
  if (!m) return false;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 14 && mi <= 59 && !(h === 14 && mi > 0);
}
/**
 * THE TOLERANT DATE (time-off `from_date` / `to_date`, availability `week` / `week_to` ONLY), kept as a
 * date. The clock and the offset are VALIDATED before they are set aside (review round, P3): a zoneless
 * clock is the wall clock of that date and is dropped; a zoned clock is accepted only at midnight (a date
 * serialized as a timestamp, any real offset) — otherwise the wall date would depend on a zone this
 * normalizer does not know, so it is `bad_date`. Nothing is converted through UTC.
 */
function wallDateOf(v: unknown): string {
  if (typeof v !== "string") throw new Reject("bad_date");
  const m = DATE_SHAPE.exec(v.trim());
  if (!m) throw new Reject("bad_date");
  const [, d, clock, zone] = m;
  if (!calendarDay(d!)) throw new Reject("bad_date");
  if (clock !== undefined && !clockOk(clock)) throw new Reject("bad_date");
  if (zone !== undefined && !offsetOk(zone)) throw new Reject("bad_date");
  if (zone !== undefined && clock !== undefined && !/^00:00(:00(\.0+)?)?$/.test(clock)) throw new Reject("bad_date");
  return d!;
}
function reqWallDate(o: Obj, k: string): string {
  if (absent(o[k])) throw new Reject("missing_field");
  return wallDateOf(o[k]);
}
function optWallDate(o: Obj, k: string): string | null {
  return absent(o[k]) || o[k] === "" ? null : wallDateOf(o[k]);
}
/** A wall time re-emitted `HH:MM:SS`; the time part of a zoneless datetime counts; a zoned one is `bad_time`. */
function timeOf(v: unknown): string {
  if (typeof v !== "string") throw new Reject("bad_time");
  let s = v.trim();
  const dt = DATE_SHAPE.exec(s);
  if (dt) {
    // The time part of a zoneless datetime; a zoned one (or a bare date) is not a wall time.
    if (dt[2] === undefined || dt[3] !== undefined || !calendarDay(dt[1]!)) throw new Reject("bad_time");
    s = dt[2];
  }
  const m = TIME_SHAPE.exec(s);
  if (!m) throw new Reject("bad_time");
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const sec = m[3] === undefined ? 0 : Number(m[3]);
  if (mi > 59 || sec > 59 || h > 24 || (h === 24 && (mi !== 0 || sec !== 0))) throw new Reject("bad_time");
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(h)}:${two(mi)}:${two(sec)}`;
}
function optTime(o: Obj, k: string): string | null {
  if (absent(o[k]) || o[k] === "") return null;
  return timeOf(o[k]);
}
/** A small integer code (a status, a day's availability code): an integer or a digit string. */
function optCode(o: Obj, k: string): number | null {
  const v = o[k];
  if (absent(v) || v === "") return null;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Reject("bad_value");
    return v;
  }
  if (typeof v === "string" && DIGITS.test(v)) return Number(v);
  throw new Reject("bad_value");
}
/** A flag: a boolean, or 0 / 1 as 7shifts' older models spell it. */
function optFlag(o: Obj, k: string): boolean | null {
  const v = o[k];
  if (absent(v)) return null;
  if (typeof v === "boolean") return v;
  if (v === 0 || v === 1) return v === 1;
  throw new Reject("bad_value");
}
/** A quantity: a finite number or a decimal string. */
function optQuantity(o: Obj, k: string): number | null {
  const v = o[k];
  if (absent(v) || v === "") return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Reject("bad_value");
    return v;
  }
  if (typeof v === "string" && DECIMAL.test(v)) return Number(v);
  throw new Reject("bad_value");
}
function optText(o: Obj, k: string, max: number): string | null {
  if (absent(o[k])) return null;
  if (typeof o[k] !== "string" || (o[k] as string).length > max) throw new Reject("bad_value");
  return o[k] as string;
}
function reqBool(o: Obj, k: string): boolean {
  if (absent(o[k])) throw new Reject("missing_field");
  if (typeof o[k] !== "boolean") throw new Reject("bad_value");
  return o[k] as boolean;
}
function optBool(o: Obj, k: string): boolean | null {
  if (absent(o[k])) return null;
  if (typeof o[k] !== "boolean") throw new Reject("bad_value");
  return o[k] as boolean;
}
function optNum(o: Obj, k: string): number | null {
  if (absent(o[k])) return null;
  if (typeof o[k] !== "number" || !Number.isFinite(o[k])) throw new Reject("bad_value");
  return o[k] as number;
}
function optInt(o: Obj, k: string): number | null {
  const n = optNum(o, k);
  if (n !== null && !Number.isInteger(n)) throw new Reject("bad_value");
  return n;
}
function reqInt(o: Obj, k: string): number {
  if (absent(o[k])) throw new Reject("missing_field");
  const n = optInt(o, k);
  return n as number;
}

function each<R>(input: readonly unknown[], map: (o: Obj) => R, part?: string): Normalized<R> {
  const rows: R[] = [];
  const rejected: Rejected[] = [];
  input.forEach((raw, index) => {
    try {
      if (!isObj(raw)) throw new Reject("not_object");
      rows.push(map(raw));
    } catch (e) {
      if (!(e instanceof Reject)) throw e;
      rejected.push(part === undefined ? { index, reason: e.reason } : { index, reason: e.reason, part });
    }
  });
  return { rows, rejected };
}

/**
 * `{ reason: count }` over a run's rejections — the ONLY thing about a rejected row that reaches the
 * ledger besides its count. Counts reasons in `REJECT_REASONS` and nothing else; an empty result for
 * no rejections.
 */
export function rejectionHistogram(rejected: readonly Rejected[]): RejectionHistogram {
  const out: RejectionHistogram = {};
  for (const r of rejected) {
    if (!(REJECT_REASONS as readonly string[]).includes(r.reason)) continue;
    out[r.reason] = (out[r.reason] ?? 0) + 1;
  }
  return out;
}

/** Two histograms added (the per-user snapshot kinds accumulate one per run). */
export function addHistograms(a: RejectionHistogram, b: RejectionHistogram): RejectionHistogram {
  const out: RejectionHistogram = { ...a };
  for (const reason of REJECT_REASONS) {
    const n = b[reason];
    if (n !== undefined && n > 0) out[reason] = (out[reason] ?? 0) + n;
  }
  return out;
}

// ─── The list normalizers ───

export function normalizeUsers(input: readonly unknown[]): Normalized<UserRow> {
  return each(input, (o) => ({
    id: reqId(o, "id"),
    company_id: reqId(o, "company_id"),
    first_name: optText(o, "first_name", 60),
    last_name: optText(o, "last_name", 60),
    preferred_first_name: optText(o, "preferred_first_name", 60),
    employee_id: optText(o, "employee_id", 64),
    user_type: optText(o, "type", 40),
    active: reqBool(o, "active"),
    hire_date: optDate(o, "hire_date"),
    skill_level: optInt(o, "skill_level"),
    source_modified_at: optInstant(o, "modified"),
  }));
}

export function normalizeLocations(input: readonly unknown[]): Normalized<LocationRow> {
  return each(input, (o) => ({
    id: reqId(o, "id"),
    company_id: reqId(o, "company_id"),
    name: optText(o, "name", 200),
    timezone: optText(o, "timezone", 64),
    active: optBool(o, "active"),
  }));
}

export function normalizeDepartments(input: readonly unknown[]): Normalized<DepartmentRow> {
  return each(input, (o) => ({ id: reqId(o, "id"), location_id: optId(o, "location_id"), name: optText(o, "name", 200) }));
}

export function normalizeRoles(input: readonly unknown[]): Normalized<RoleRow> {
  return each(input, (o) => ({
    id: reqId(o, "id"),
    location_id: optId(o, "location_id"),
    department_id: optId(o, "department_id"),
    name: optText(o, "name", 200),
    active: optBool(o, "active"),
  }));
}

export function normalizeShifts(input: readonly unknown[]): Normalized<ShiftRow> {
  return each(input, (o) => ({
    id: reqId(o, "id"),
    user_id: optId(o, "user_id"),
    location_id: optId(o, "location_id"),
    department_id: optId(o, "department_id"),
    role_id: optId(o, "role_id"),
    station_id: optId(o, "station_id"),
    start_at: reqInstant(o, "start"),
    end_at: reqInstant(o, "end"),
    draft: optBool(o, "draft"),
    open: optBool(o, "open"),
    deleted: optBool(o, "deleted") ?? false,
    source_modified_at: optInstant(o, "modified"),
  }));
}

/** Unpaid and paid breaks alike, summed from each break's in/out; null when no `breaks` list is sent. */
function breakMinutes(o: Obj): number | null {
  if (absent(o.breaks)) return null;
  if (!Array.isArray(o.breaks)) throw new Reject("bad_value");
  let ms = 0;
  for (const b of o.breaks) {
    if (!isObj(b)) throw new Reject("bad_value");
    // A break removed in 7shifts carries `deleted: true` (docs, update-time-punch-data, re-read
    // 2026-10-15) and adds nothing (chunk A review #5).
    if (optBool(b, "deleted") === true) continue;
    const from = optInstant(b, "in");
    const to = optInstant(b, "out");
    if (from !== null && to !== null) ms += Math.max(0, Date.parse(to) - Date.parse(from));
  }
  return Math.round(ms / 60_000);
}

export function normalizeTimePunches(input: readonly unknown[]): Normalized<TimePunchRow> {
  return each(input, (o) => ({
    id: reqId(o, "id"),
    user_id: reqId(o, "user_id"),
    location_id: optId(o, "location_id"),
    department_id: optId(o, "department_id"),
    role_id: optId(o, "role_id"),
    shift_id: optId(o, "shift_id"),
    clocked_in: reqInstant(o, "clocked_in"),
    clocked_out: optInstant(o, "clocked_out"),
    break_minutes: breakMinutes(o),
    approved: optBool(o, "approved"),
    auto_clocked_out: optBool(o, "auto_clocked_out"),
    deleted: optBool(o, "deleted") ?? false,
    source_modified_at: optInstant(o, "modified"),
  }));
}

/**
 * Availability (reference/listavailabilities, re-read 2026-11-11): `week` / `week_to` are week DATES
 * (bare strings in the OAS; a repeating set has `week_to` null), each day is a code + wall times,
 * `modified` is "in UTC". Comments, reasons, the approver and `old_approved_data` are dropped.
 */
export function normalizeAvailabilities(input: readonly unknown[]): Normalized<AvailabilityRow> {
  return each(input, (o) => {
    const days = {} as Record<Weekday, AvailabilityDay>;
    for (const d of WEEKDAYS) days[d] = { code: optCode(o, d), from: optTime(o, `${d}_from`), to: optTime(o, `${d}_to`) };
    return {
      id: reqId(o, "id"),
      user_id: reqId(o, "user_id"),
      week: optWallDate(o, "week"),
      week_to: optWallDate(o, "week_to"),
      repeating: optFlag(o, "repeat"),
      status: optCode(o, "status"),
      days,
      source_modified_at: optUtcInstant(o, "modified"),
    };
  });
}

/**
 * Time off (reference/gettimeofflist, re-read 2026-11-11): `from_date` / `to_date` are calendar DATES
 * (bare strings in the OAS, `/v2/time_off` is the legacy, company-less path), `partial_from` /
 * `partial_to` are `format: time` wall times (null or `00:00:00` on an all-day request), `status` is
 * an integer (0 pending · 1 approved · 2 declined), `amount_of_hours` the total. Comments, the
 * category text, the approver and the status message are dropped.
 */
export function normalizeTimeOff(input: readonly unknown[]): Normalized<TimeOffRow> {
  return each(input, (o) => ({
    id: reqId(o, "id"),
    user_id: reqId(o, "user_id"),
    from_date: reqWallDate(o, "from_date"),
    to_date: reqWallDate(o, "to_date"),
    partial: optFlag(o, "partial"),
    from_time: optTime(o, "partial_from"),
    to_time: optTime(o, "partial_to"),
    status: optCode(o, "status"),
    // Docs (gettimeofflist, re-read 2026-10-15): the total is `amount_of_hours`; `hours` is a
    // per-date ARRAY, not stored.
    hours: optQuantity(o, "amount_of_hours"),
    // The documented item has no `modified` (only `created`). Kept when 7shifts sends a ZONED one;
    // an undocumented zoneless value has no known zone and is not an instant, so it is left null
    // rather than guessed or rejected (the row's dates and times are the facts this mirror needs).
    source_modified_at: softInstant(o, "modified"),
  }));
}

/** An undocumented, informational instant: zoned → UTC ISO; zoneless or malformed → null, never a guess. */
function softInstant(o: Obj, k: string): string | null {
  const v = o[k];
  if (typeof v !== "string" || !ZONED.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The labor settings singleton's `data` → ONE row. Multipliers = every numeric `*_multiplier` field. */
export function normalizeLaborSettings(data: Record<string, unknown>): Normalized<LaborSettingsRow> {
  return each([data], (o) => {
    const multipliers: Record<string, number> = {};
    for (const k of Object.keys(o).sort()) {
      if (k.endsWith("_multiplier") && !absent(o[k])) multipliers[k] = optNum(o, k) as number;
    }
    return {
      company_id: reqId(o, "company_id"),
      // Docs (retrievecompanylaborsettings, re-read 2026-10-15) spell them *_overtime_threshold;
      // the mirror keeps its *_ot_threshold columns (chunk A review #3: Phase 2's overtime guard).
      daily_ot_threshold: optNum(o, "daily_overtime_threshold"),
      weekly_ot_threshold: optNum(o, "weekly_overtime_threshold"),
      premium_ot_threshold: optNum(o, "premium_overtime_threshold"),
      consecutive_days_threshold: optInt(o, "consecutive_days_threshold"),
      overtime_enabled: optBool(o, "overtime_enabled"),
      overtime_by_location_enabled: optBool(o, "overtime_by_location_enabled"),
      multipliers,
    };
  });
}

// ─── The snapshot kinds (reconciled per user) ───

/** `user:location:department:role`, each null spelled `-` (the 0268 `edge_key` CHECK shape). */
export function assignmentEdgeKey(e: { user_id: string; location_id: string | null; department_id: string | null; role_id: string | null }): string {
  return [e.user_id, e.location_id ?? "-", e.department_id ?? "-", e.role_id ?? "-"].join(":");
}

/**
 * The assignments singleton → EDGES (r2 #1). Each role gives (location, department, role,
 * is_primary); each department with no role under it gives (location, department, -); each location
 * with no department or role under it gives (location, -, -). A role whose location or department is
 * not in the snapshot's own lists is still an edge: 7shifts is the authority. Duplicates collapse.
 */
export function normalizeAssignments(userId: string, snap: AssignmentsSnapshot): Normalized<AssignmentEdgeRow> {
  if (!ID.test(userId)) throw new Error("bad_id");
  const roles = each(snap.roles, (o) => ({
    id: reqId(o, "id"), location_id: optId(o, "location_id"), department_id: optId(o, "department_id"), is_primary: optBool(o, "is_primary"),
  }), "roles");
  const departments = each(snap.departments, (o) => ({ id: reqId(o, "id"), location_id: optId(o, "location_id") }), "departments");
  const locations = each(snap.locations, (o) => ({ id: reqId(o, "id") }), "locations");

  const edges = new Map<string, AssignmentEdgeRow>();
  const add = (location_id: string | null, department_id: string | null, role_id: string | null, is_primary: boolean | null) => {
    const row = { user_id: userId, location_id, department_id, role_id, is_primary };
    const edge_key = assignmentEdgeKey(row);
    if (!edges.has(edge_key)) edges.set(edge_key, { edge_key, ...row });
  };
  const deptsCovered = new Set<string>();
  const locsCovered = new Set<string>();
  for (const r of roles.rows) {
    add(r.location_id, r.department_id, r.id, r.is_primary);
    if (r.department_id !== null) deptsCovered.add(r.department_id);
    if (r.location_id !== null) locsCovered.add(r.location_id);
  }
  for (const d of departments.rows) {
    if (d.location_id !== null) locsCovered.add(d.location_id);
    if (!deptsCovered.has(d.id)) add(d.location_id, d.id, null, null);
  }
  for (const l of locations.rows) if (!locsCovered.has(l.id)) add(l.id, null, null, null);

  return { rows: [...edges.values()], rejected: [...roles.rejected, ...departments.rejected, ...locations.rejected] };
}

/** The wages singleton → rows keyed (user, wage, upcoming). An unknown type or a bad amount is rejected. */
export function normalizeWages(userId: string, snap: WagesSnapshot): Normalized<WageRow> {
  if (!ID.test(userId)) throw new Error("bad_id");
  const read = (upcoming: boolean) => (o: Obj): WageRow => {
    const type = o.wage_type;
    if (typeof type !== "string" || !(WAGE_TYPES as readonly string[]).includes(type)) throw new Reject("bad_value");
    const cents = reqInt(o, "wage_cents");
    if (cents < 0) throw new Reject("bad_value");
    return {
      user_id: userId, wage_id: reqId(o, "id"), upcoming, effective_date: optDate(o, "effective_date"),
      wage_type: type as WageRow["wage_type"], wage_cents: cents, role_id: optId(o, "role_id"),
    };
  };
  const current = each(snap.current_wages, read(false), "current_wages");
  const upcoming = each(snap.upcoming_wages, read(true), "upcoming_wages");
  return { rows: [...current.rows, ...upcoming.rows], rejected: [...current.rejected, ...upcoming.rejected] };
}
