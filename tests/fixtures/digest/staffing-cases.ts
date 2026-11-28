/**
 * THE STAFFING CASE TABLE — every way a 7shifts published-shifts answer can break the closing rule, as the server
 * would WRITE it. Synthetic only: shops "501" / "502", company "9001", made-up ids, no names.
 *
 * The closing rule: nothing from 7shifts is used unless it is consistent with the request that was sent AND valid
 * in its written form; anything else refuses that company and window.
 *
 * Bodies are literal JSON TEXT on purpose (A2-3): `42.0000000000000001`, `4.2e1` and `"07"` only exist as bytes;
 * `JSON.parse` erases them. A2-6 (i): each case names its layer and carries the whole response for that layer.
 * `row` and `page` cases run through the pure check (`parseJsonWithIdSource(shifts.body)`) and later through the
 * reader and the renderer; `identity` and `transport` cases are for the reader test only, listed here so the
 * census is complete. Every refused row case carries a valid published row of the OTHER shop on the same page.
 */
import type { AnswerRefusal, CONSUMED_SHIFT_KEYS, PublishedShiftsRequest } from "@/lib/report-digests-schedule-shared";

export const SHOP_A_7S = "501";
export const SHOP_B_7S = "502";
export const COMPANY = "9001";

/**
 * A byte ceiling for the transport case "oversized body", sized for a 64 KiB test ceiling. The reader's real ceilings
 * are set (64 KiB for `whoami`, 2 MiB for the shift page: SCHEDULE_PAGE_MAX_BYTES), so the reader and e2e tests
 * re-pad that case past the real page ceiling.
 */
export const STAFFING_TEST_MAX_BYTES = 64 * 1024;

export interface StaffingResponse { status?: number; headers?: Record<string, string>; body: string /* literal response text */ }
export interface StaffingCase {
  name: string;
  layer: "row" | "page" | "identity" | "transport";
  /** Which half of the closing rule it is an instance of. */
  half: "request" | "written_form";
  /** The consumed field or page gate it exercises (for the census). */
  field: (typeof CONSUMED_SHIFT_KEYS)[number] | "page.cursor.next" | "page.cursor.prev" | "page.object" | "page.rows" | "page.shape" | "whoami" | "bytes";
  /** The shift page as the server would send it (literal text, so written forms survive). */
  shifts: StaffingResponse;
  /** The whoami answer (default: one user of COMPANY). */
  whoami?: StaffingResponse;
  expect: "refused" | "accepted";
  /** For row / page cases: the refusal code the pure check gives when run on `parseJsonWithIdSource(shifts.body)`. */
  refusal?: AnswerRefusal;
  /**
   * Astra F1: `parseJsonWithIdSource(shifts.body)` itself THROWS (a repeated object member), so the pure check is never
   * reached: that throw is the refusal. Such a case carries no `refusal` code.
   */
  parseRefuses?: true;
}

/**
 * The window the valid page sits in: ET days 2026-03-01 .. 2026-03-02, exactly as `windowInstants` writes it
 * (pinned against `windowInstants` in the check test). Limit = `LIST_PAGE_LIMIT` (200).
 */
export const CASE_REQUEST: PublishedShiftsRequest = {
  limit: 200,
  companyId: COMPANY,
  startGte: "2026-03-01T05:00:00Z",
  startLte: "2026-03-03T04:59:59Z",
};

/** The default whoami answer: one user of COMPANY. */
export const VALID_WHOAMI: StaffingResponse = { status: 200, body: `{"object":"whoami","data":{"users":[{"id":77,"company_id":9001}]}}` };

// ── rows as literal text ───────────────────────────────────────────────────────────────────────

/** key → literal JSON text of its value, in the order written. */
type Fields = ReadonlyArray<readonly [string, string]>;

/** Shop A, ASSIGNED, ids written as numbers, `open: false`, a role. Carries keys the digest never reads. */
const A_FIELDS: Fields = [
  ["id", "1001"], ["location_id", "501"], ["company_id", "9001"], ["user_id", "11"], ["open", "false"], ["role_id", "21"],
  ["department_id", "31"], ["station_id", "null"],
  ["start", `"2026-03-01T14:00:00Z"`], ["end", `"2026-03-01T22:00:00Z"`],
  ["draft", "false"], ["deleted", "false"], ["publish_status", `"published"`], ["modified", `"2026-02-20T10:00:00Z"`],
];
/** Shop B, ASSIGNED, ids written as digit strings, `open` absent, `role_id: null`, a zoned (-05:00) time. */
const B_FIELDS: Fields = [
  ["id", `"2001"`], ["location_id", `"502"`], ["company_id", `"9001"`], ["user_id", `"12"`], ["role_id", "null"],
  ["start", `"2026-03-02T15:00:00-05:00"`], ["end", `"2026-03-02T23:30:00-05:00"`],
  ["draft", "false"], ["deleted", "false"], ["publish_status", `"published"`],
];
/** Shop A, OPEN: `user_id: 0`, `open: true`, `role_id: 0`. */
const OPEN_FIELDS: Fields = [
  ["id", "3001"], ["location_id", "501"], ["company_id", "9001"], ["user_id", "0"], ["open", "true"], ["role_id", "0"],
  ["start", `"2026-03-02T16:00:00Z"`], ["end", `"2026-03-02T20:00:00Z"`],
  ["draft", "false"], ["deleted", "false"], ["publish_status", `"published"`],
];
const BASES = { A: A_FIELDS, B: B_FIELDS, OPEN: OPEN_FIELDS } as const;
export type RowBase = keyof typeof BASES;

/**
 * One shift row as literal text. `patch`: a key → its new literal value text (`null` = remove the key); a key not
 * in the base is appended.
 */
export function shiftRow(base: RowBase, patch: Record<string, string | null> = {}): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const [k, v] of BASES[base]) {
    seen.add(k);
    const p = Object.hasOwn(patch, k) ? patch[k] : v;
    if (p === null || p === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${p}`);
  }
  for (const [k, v] of Object.entries(patch)) if (!seen.has(k) && v !== null) parts.push(`${JSON.stringify(k)}:${v}`);
  return `{${parts.join(",")}}`;
}

export interface PageOpts {
  /** Literal row texts (default: A, B, OPEN). */
  rows?: readonly string[];
  /** Literal text of `meta.cursor` (default `{"next":null,"prev":null}`). */
  cursor?: string;
  /** Literal text of the top-level `object` (default `"shifts"`); null = the key is absent. */
  object?: string | null;
  /** Literal text of `data` instead of the rows (for a `data` that is not an array). */
  data?: string;
}

/** A valid terminal page: one assigned row of Shop A, one of Shop B, one open shift of Shop A. */
export function validAnswerBody(opts: PageOpts = {}): string {
  const rows = opts.rows ?? [shiftRow("A"), shiftRow("B"), shiftRow("OPEN")];
  const data = opts.data ?? `[${rows.join(",")}]`;
  const object = opts.object === undefined ? `"shifts"` : opts.object;
  const head = object === null ? "" : `"object":${object},`;
  return `{${head}"data":${data},"meta":{"cursor":${opts.cursor ?? `{"next":null,"prev":null}`}}}`;
}

/** The answer the unchanged page must give (pinned in the check test). */
export const VALID_SHIFTS = [
  { id: "1001", locationId: "501", userId: "11", open: false, roleId: "21", startAt: "2026-03-01T14:00:00.000Z", endAt: "2026-03-01T22:00:00.000Z" },
  { id: "2001", locationId: "502", userId: "12", open: false, roleId: null, startAt: "2026-03-02T20:00:00.000Z", endAt: "2026-03-03T04:30:00.000Z" },
  { id: "3001", locationId: "501", userId: null, open: true, roleId: null, startAt: "2026-03-02T16:00:00.000Z", endAt: "2026-03-02T20:00:00.000Z" },
];

// ── case builders ──────────────────────────────────────────────────────────────────────────────

type Field = StaffingCase["field"];
type Half = StaffingCase["half"];

/** A Shop A row mutated, beside a valid Shop B row and the open shift. */
function aRow(name: string, half: Half, field: Field, patch: Record<string, string | null>, refusal?: AnswerRefusal): StaffingCase {
  return rowsCase(name, half, field, [shiftRow("A", patch), shiftRow("B"), shiftRow("OPEN")], refusal);
}
/** A Shop B row mutated, beside a valid Shop A row. */
function bRow(name: string, half: Half, field: Field, patch: Record<string, string | null>, refusal?: AnswerRefusal): StaffingCase {
  return rowsCase(name, half, field, [shiftRow("A"), shiftRow("B", patch)], refusal);
}
/** The open shift mutated, beside a valid Shop B row. */
function openRow(name: string, half: Half, field: Field, patch: Record<string, string | null>, refusal?: AnswerRefusal): StaffingCase {
  return rowsCase(name, half, field, [shiftRow("OPEN", patch), shiftRow("B")], refusal);
}
function rowsCase(name: string, half: Half, field: Field, rows: readonly string[], refusal?: AnswerRefusal): StaffingCase {
  return {
    name, layer: "row", half, field, shifts: { status: 200, body: validAnswerBody({ rows }) },
    expect: refusal === undefined ? "accepted" : "refused", ...(refusal === undefined ? {} : { refusal }),
  };
}
function pageCase(name: string, half: Half, field: Field, body: string, refusal?: AnswerRefusal): StaffingCase {
  return { name, layer: "page", half, field, shifts: { status: 200, body }, expect: refusal === undefined ? "accepted" : "refused", ...(refusal === undefined ? {} : { refusal }) };
}
const str = (s: string) => JSON.stringify(s);

/**
 * Astra F1: a row whose `key` is WRITTEN TWICE, `first` then `second` (literal value texts). JSON.parse would keep only
 * `second`; the bounded read refuses the text.
 */
function dupRow(base: RowBase, key: string, first: string, second: string): string {
  return shiftRow(base, { [key]: `${first},${str(key)}:${second}` });
}
/** Astra F1: a row or page case whose body the source-checked parse itself refuses (no pure-check refusal code). */
function parseRefusedCase(name: string, layer: "row" | "page", field: Field, body: string): StaffingCase {
  return { name, layer, half: "written_form", field, shifts: { status: 200, body }, expect: "refused", parseRefuses: true };
}

function manyRows(n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftRow("A", { id: String(10_000 + i) }));
}

// ── the table ──────────────────────────────────────────────────────────────────────────────────

export const STAFFING_CASES: StaffingCase[] = [
  // window (request): only the START is tested, both bounds included.
  aRow("start on D+2", "request", "start", { start: str("2026-03-03T14:00:00Z"), end: str("2026-03-03T22:00:00Z") }, "row_outside_window"),
  aRow("start one second before start[gte]", "request", "start", { start: str("2026-03-01T04:59:59Z"), end: str("2026-03-01T12:00:00Z") }, "row_outside_window"),
  aRow("start one second after start[lte]", "request", "start", { start: str("2026-03-03T05:00:00Z"), end: str("2026-03-03T12:00:00Z") }, "row_outside_window"),
  aRow("A2-1: start one microsecond after start[lte], written .000001", "written_form", "start", { start: str("2026-03-03T04:59:59.000001Z"), end: str("2026-03-03T12:00:00Z") }, "row_time_form"),
  aRow("start exactly start[gte]", "request", "start", { start: str("2026-03-01T05:00:00Z"), end: str("2026-03-01T12:00:00Z") }),
  aRow("start exactly start[lte]", "request", "start", { start: str("2026-03-03T04:59:59Z"), end: str("2026-03-03T12:00:00Z") }),
  aRow("A2-1: the exact bound written .000000", "written_form", "start", { start: str("2026-03-03T04:59:59.000000Z"), end: str("2026-03-03T12:00:00Z") }),
  aRow("A2-1: a fraction written .123000", "written_form", "start", { start: str("2026-03-01T14:00:00.123000Z") }),
  aRow("overnight: starts inside, ends after start[lte]", "request", "end", { start: str("2026-03-02T22:00:00-05:00"), end: str("2026-03-03T06:00:00-05:00") }),

  // company (request; relaxed by CC: a missing or null company makes no claim)
  aRow("company_id of another company", "request", "company_id", { company_id: "9002" }, "row_company"),
  aRow("company_id \"abc\"", "written_form", "company_id", { company_id: str("abc") }, "row_company"),
  aRow("company_id 12.5 written as a number", "written_form", "company_id", { company_id: "12.5" }, "row_company"),
  aRow("company_id 0", "request", "company_id", { company_id: "0" }, "row_company"),
  aRow("company_id the verified company as a number", "request", "company_id", { company_id: "9001" }),
  aRow("company_id the verified company as a digit string", "request", "company_id", { company_id: str("9001") }),
  aRow("company_id missing (no claim)", "request", "company_id", { company_id: null }),
  aRow("company_id null (no claim)", "request", "company_id", { company_id: "null" }),

  // written date and clock (written form)
  aRow("start on 2026-02-30 in a window that holds 2 March", "written_form", "start", { start: str("2026-02-30T14:00:00Z"), end: str("2026-03-02T22:00:00Z") }, "row_time_form"),
  aRow("a valid start with end on 2026-02-30", "written_form", "end", { end: str("2026-02-30T22:00:00Z") }, "row_time_form"),
  aRow("start on 2026-04-31", "written_form", "start", { start: str("2026-04-31T14:00:00Z") }, "row_time_form"),
  aRow("start on 2027-02-29", "written_form", "start", { start: str("2027-02-29T14:00:00Z") }, "row_time_form"),
  aRow("hour 24", "written_form", "start", { start: str("2026-03-01T24:00:00Z"), end: str("2026-03-02T08:00:00Z") }, "row_time_form"),
  aRow("minute 60", "written_form", "start", { start: str("2026-03-01T14:60:00Z") }, "row_time_form"),
  aRow("second 60", "written_form", "start", { start: str("2026-03-01T14:00:60Z") }, "row_time_form"),
  aRow("offset +15:00", "written_form", "start", { start: str("2026-03-02T20:00:00+15:00") }, "row_time_form"),
  aRow("A2-2: offset +14:01", "written_form", "start", { start: str("2026-03-02T20:00:00+14:01"), end: str("2026-03-02T22:00:00Z") }, "row_time_form"),
  aRow("A2-2: offset -14:01", "written_form", "start", { start: str("2026-03-01T10:00:00-14:01"), end: str("2026-03-02T08:00:00Z") }, "row_time_form"),
  // 2026-03-02T20:00:00+14:59 = 2026-03-02T05:01Z: inside the window if it were parsed.
  aRow("A2-2: offset +14:59 that would convert to inside the window", "written_form", "start", { start: str("2026-03-02T20:00:00+14:59"), end: str("2026-03-02T22:00:00Z") }, "row_time_form"),
  aRow("a zoneless datetime", "written_form", "start", { start: str("2026-03-01T14:00:00") }, "row_time_form"),
  aRow("a number where the start string should be", "written_form", "start", { start: "1772373600000" }, "row_time_form"),
  aRow("A2-1: a fraction written .1234", "written_form", "start", { start: str("2026-03-01T14:00:00.1234Z") }, "row_time_form"),
  // 2026-03-02T12:00:00+14:00 = 2026-03-01T22:00Z; 2026-03-01T10:00:00-14:00 = 2026-03-02T00:00Z.
  aRow("A2-2: offset +14:00", "written_form", "start", { start: str("2026-03-02T12:00:00+14:00"), end: str("2026-03-02T04:00:00Z") }),
  aRow("A2-2: offset -14:00", "written_form", "start", { start: str("2026-03-01T10:00:00-14:00"), end: str("2026-03-02T08:00:00Z") }),

  // ids on literal bytes (written form, A2-3)
  aRow("A2-3: user_id 42.0000000000000001", "written_form", "user_id", { user_id: "42.0000000000000001" }, "row_assignment"),
  rowsCase("A2-3: \"id\":7 beside \"id\":\"07\"", "written_form", "id", [shiftRow("A", { id: "7" }), shiftRow("B", { id: str("07") })], "row_id"),
  aRow("A2-3: id 4.2e1", "written_form", "id", { id: "4.2e1" }, "row_id"),
  aRow("A2-3: location_id -501", "written_form", "location_id", { location_id: "-501" }, "row_location"),
  aRow("A2-3: a 19-digit id (number)", "written_form", "id", { id: "1234567890123456789" }, "row_id"),
  aRow("A2-3: a 19-digit id (string)", "written_form", "id", { id: str("1234567890123456789") }, "row_id"),
  rowsCase("A2-3: id 1001 and \"1001\" are one id", "written_form", "id", [shiftRow("A"), shiftRow("B", { id: str("1001") })], "row_duplicate_id"),

  // location
  aRow("location_id missing", "written_form", "location_id", { location_id: null }, "row_location"),
  aRow("location_id null", "written_form", "location_id", { location_id: "null" }, "row_location"),
  aRow("location_id 0", "written_form", "location_id", { location_id: "0" }, "row_location"),

  // rows that are not objects (the row list's entries)
  rowsCase("a row that is null", "written_form", "page.rows", ["null", shiftRow("B")], "row_not_object"),
  rowsCase("a row that is a string", "written_form", "page.rows", [str("shift"), shiftRow("B")], "row_not_object"),
  rowsCase("a row that is an array", "written_form", "page.rows", ["[]", shiftRow("B")], "row_not_object"),

  // publication (request: the documented default listing is published, not deleted)
  aRow("draft missing", "request", "draft", { draft: null }, "row_draft"),
  aRow("draft null", "request", "draft", { draft: "null" }, "row_draft"),
  aRow("draft true naming shop A", "request", "draft", { draft: "true" }, "row_draft"),
  bRow("draft true naming shop B", "request", "draft", { draft: "true" }, "row_draft"),
  aRow("draft \"false\" (a string)", "written_form", "draft", { draft: str("false") }, "row_draft"),
  aRow("deleted missing", "request", "deleted", { deleted: null }, "row_deleted"),
  aRow("deleted null", "request", "deleted", { deleted: "null" }, "row_deleted"),
  aRow("deleted true", "request", "deleted", { deleted: "true" }, "row_deleted"),
  aRow("publish_status missing", "request", "publish_status", { publish_status: null }, "row_publish_status"),
  aRow("publish_status null", "request", "publish_status", { publish_status: "null" }, "row_publish_status"),
  aRow("publish_status \"draft\"", "request", "publish_status", { publish_status: str("draft") }, "row_publish_status"),

  // assignment
  aRow("no user_id and no open", "written_form", "user_id", { user_id: null, open: null }, "row_assignment"),
  aRow("a person AND open: true", "written_form", "open", { open: "true" }, "row_assignment"),
  aRow("open \"yes\"", "written_form", "open", { open: str("yes") }, "row_assignment"),
  aRow("open null", "written_form", "open", { open: "null" }, "row_assignment"),
  aRow("user_id \"x\"", "written_form", "user_id", { user_id: str("x") }, "row_assignment"),
  openRow("user_id 0 with open: true (one open shift)", "written_form", "user_id", {}),
  aRow("an assigned row with open absent", "written_form", "open", { open: null }),

  // role (A2-5 narrowed: display-only)
  aRow("role_id \"abc\"", "written_form", "role_id", { role_id: str("abc") }, "row_role"),
  aRow("role_id 1.5", "written_form", "role_id", { role_id: "1.5" }, "row_role"),
  aRow("role_id missing (no role)", "written_form", "role_id", { role_id: null }),
  aRow("role_id null (no role)", "written_form", "role_id", { role_id: "null" }),
  aRow("role_id 0 (no role)", "written_form", "role_id", { role_id: "0" }),
  aRow("role_id a real id", "written_form", "role_id", { role_id: "21" }),

  // times
  aRow("end equal to start", "written_form", "end", { end: str("2026-03-01T14:00:00Z") }, "row_end_before_start"),
  aRow("end before start", "written_form", "end", { end: str("2026-03-01T13:00:00Z") }, "row_end_before_start"),

  // duplicate id
  rowsCase("a duplicate id", "request", "id", [shiftRow("A"), shiftRow("B", { id: "1001" })], "row_duplicate_id"),

  // page (A2-4 as narrowed by CC)
  pageCase("201 rows on a limit of 200", "request", "page.rows", validAnswerBody({ rows: manyRows(201) }), "page_too_many_rows"),
  pageCase("200 rows on a limit of 200", "request", "page.rows", validAnswerBody({ rows: manyRows(200) })),
  pageCase("data not an array", "written_form", "page.shape", validAnswerBody({ data: `{"0":${shiftRow("A")}}` }), "page_shape"),
  pageCase("no meta", "written_form", "page.shape", `{"object":"shifts","data":[${shiftRow("A")}]}`, "page_shape"),
  pageCase("a cursor with no next key", "written_form", "page.shape", validAnswerBody({ cursor: `{"prev":null}` }), "page_shape"),
  pageCase("a cursor to a second page", "request", "page.cursor.next", validAnswerBody({ cursor: `{"next":"c2","prev":null}` }), "page_not_terminal"),
  pageCase("cursor.prev \"p\" on an otherwise valid empty terminal page", "request", "page.cursor.prev", validAnswerBody({ rows: [], cursor: `{"next":null,"prev":"p"}` }), "page_prev_cursor"),
  pageCase("object \"users\"", "request", "page.object", validAnswerBody({ object: str("users") }), "page_object_tag"),
  pageCase("the valid empty terminal page", "request", "page.rows", validAnswerBody({ rows: [] })),
  pageCase("object \"shifts\"", "request", "page.object", validAnswerBody({ object: str("shifts") })),
  pageCase("object absent", "request", "page.object", validAnswerBody({ object: null })),
  pageCase("cursor.prev absent", "request", "page.cursor.prev", validAnswerBody({ cursor: `{"next":null}` })),
  // CC's narrowing of A2-4: `cursor.current` is never looked at.
  pageCase("cursor.current set to a non-null string (CC: accepted)", "request", "page.cursor.next", validAnswerBody({ cursor: `{"current":"abc","next":null,"prev":null}` })),

  // Astra F1 (post-build review): a repeated member hides what was written; the parse refuses the whole text.
  parseRefusedCase("F1: \"draft\":true,\"draft\":false", "row", "draft", validAnswerBody({ rows: [dupRow("A", "draft", "true", "false"), shiftRow("B"), shiftRow("OPEN")] })),
  parseRefusedCase("F1: an earlier user_id 42.0000000000000001 then a valid user_id", "row", "user_id", validAnswerBody({ rows: [dupRow("A", "user_id", "42.0000000000000001", "11"), shiftRow("B"), shiftRow("OPEN")] })),
  parseRefusedCase("F1: company_id of another company then the verified one", "row", "company_id", validAnswerBody({ rows: [dupRow("A", "company_id", "9002", "9001"), shiftRow("B"), shiftRow("OPEN")] })),
  parseRefusedCase("F1: a duplicated \"data\" member", "page", "page.shape",
    `{"object":"shifts","data":[${shiftRow("A", { draft: "true" })}],"data":[${shiftRow("A")},${shiftRow("B")}],"meta":{"cursor":{"next":null,"prev":null}}}`),
  parseRefusedCase("F1: a duplicated \"next\" inside meta.cursor", "page", "page.cursor.next", validAnswerBody({ cursor: `{"next":"c2","next":null,"prev":null}` })),

  // identity (the reader test runs these; whoami names the one company)
  { name: "F1: whoami user with a duplicated company_id", layer: "identity", half: "written_form", field: "whoami", shifts: { status: 200, body: validAnswerBody() }, whoami: { status: 200, body: `{"object":"whoami","data":{"users":[{"id":77,"company_id":9002,"company_id":9001}]}}` }, expect: "refused" },
  { name: "F2: whoami answered with HTTP 206", layer: "identity", half: "request", field: "whoami", shifts: { status: 200, body: validAnswerBody() }, whoami: { status: 206, body: VALID_WHOAMI.body }, expect: "refused" },
  { name: "whoami company_id written 9001.5", layer: "identity", half: "written_form", field: "whoami", shifts: { status: 200, body: validAnswerBody() }, whoami: { status: 200, body: `{"object":"whoami","data":{"users":[{"id":77,"company_id":9001.5}]}}` }, expect: "refused" },
  { name: "whoami names two companies", layer: "identity", half: "request", field: "whoami", shifts: { status: 200, body: validAnswerBody() }, whoami: { status: 200, body: `{"object":"whoami","data":{"users":[{"id":77,"company_id":9001},{"id":78,"company_id":9002}]}}` }, expect: "refused" },
  { name: "whoami names another company than the link", layer: "identity", half: "request", field: "whoami", shifts: { status: 200, body: validAnswerBody() }, whoami: { status: 200, body: `{"object":"whoami","data":{"users":[{"id":77,"company_id":9002}]}}` }, expect: "refused" },
  { name: "whoami with no users", layer: "identity", half: "request", field: "whoami", shifts: { status: 200, body: validAnswerBody() }, whoami: { status: 200, body: `{"object":"whoami","data":{"users":[]}}` }, expect: "refused" },
  { name: "whoami fails (500)", layer: "identity", half: "request", field: "whoami", shifts: { status: 200, body: validAnswerBody() }, whoami: { status: 500, body: `{"error":"x"}` }, expect: "refused" },
  { name: "whoami valid (control)", layer: "identity", half: "request", field: "whoami", shifts: { status: 200, body: validAnswerBody() }, whoami: VALID_WHOAMI, expect: "accepted" },

  // transport (the reader test runs these)
  { name: "a shift body over the byte ceiling", layer: "transport", half: "written_form", field: "bytes", shifts: { status: 200, body: validAnswerBody({ rows: [shiftRow("A", { note_pad: str("x".repeat(STAFFING_TEST_MAX_BYTES + 1)) }), shiftRow("B")] }) }, expect: "refused" },
  { name: "a 429 on the shift read", layer: "transport", half: "request", field: "bytes", shifts: { status: 429, headers: { "retry-after": "1" }, body: `{"error":"rate"}` }, expect: "refused" },
  { name: "a 500 on the shift read", layer: "transport", half: "request", field: "bytes", shifts: { status: 500, body: `{"error":"x"}` }, expect: "refused" },
  { name: "a body that is not JSON", layer: "transport", half: "written_form", field: "bytes", shifts: { status: 200, body: `{"data":[` }, expect: "refused" },
  // Astra F2 (post-build review): only an exact 200 is a complete answer.
  { name: "F2: HTTP 206 with a terminal empty page", layer: "transport", half: "request", field: "bytes", shifts: { status: 206, headers: { "content-range": "items 0-0/1" }, body: validAnswerBody({ rows: [] }) }, expect: "refused" },
];
