/**
 * The raw check of a 7shifts published-shifts answer (digest PR 2, plan §15.1; addendum A2-1 … A2-6 as ruled).
 * Every case is an instance of the closing rule: nothing from 7shifts is used unless it is consistent with the
 * request that was sent AND valid in its written form.
 */
import { describe, expect, it } from "vitest";
import { parseJsonWithIdSource } from "@/lib/sevenshifts/client";
import { windowInstants } from "@/lib/sevenshifts/endpoints-shared";
import { LIST_PAGE_LIMIT } from "@/lib/sevenshifts/endpoints-shared";
import { normalizeShifts } from "@/lib/sevenshifts/normalize-shared";
import {
  CONSUMED_SHIFT_KEYS,
  checkPublishedAnswer,
  checkPublishedRows,
  type AnswerRefusal,
  type PublishedShiftsRequest,
} from "@/lib/report-digests-schedule-shared";
import {
  CASE_REQUEST,
  STAFFING_CASES,
  VALID_SHIFTS,
  shiftRow,
  validAnswerBody,
  type RowBase,
  type StaffingCase,
} from "./fixtures/digest/staffing-cases";

const parse = (body: string) => parseJsonWithIdSource(body);
const check = (body: string, req: PublishedShiftsRequest = CASE_REQUEST) => checkPublishedAnswer(parse(body), req);
const str = (s: string) => JSON.stringify(s);

describe("the case request", () => {
  it("is exactly the window windowInstants writes for 2026-03-01 .. 2026-03-02, at the list limit", () => {
    const w = windowInstants({ modifiedSince: null, from: "2026-03-01", to: "2026-03-02" });
    expect({ startGte: CASE_REQUEST.startGte, startLte: CASE_REQUEST.startLte }).toEqual({ startGte: w.gte, startLte: w.lte });
    expect(CASE_REQUEST.limit).toBe(LIST_PAGE_LIMIT);
  });
});

describe("the case table through the pure check", () => {
  const pure = STAFFING_CASES.filter((c) => c.layer === "row" || c.layer === "page");
  it.each(pure.map((c) => [c.name, c] as const))("%s", (_n, c: StaffingCase) => {
    const out = check(c.shifts.body);
    if (c.expect === "accepted") {
      expect(out).toMatchObject({ ok: true });
    } else {
      expect(c.refusal).toBeDefined();
      expect(out).toEqual({ ok: false, refusal: c.refusal });
    }
  });

  it("a refused row case always carries a valid row of the other shop (it would pass alone)", () => {
    for (const c of pure.filter((x) => x.layer === "row" && x.expect === "refused")) {
      const json = parse(c.shifts.body) as { data: unknown[] };
      // At least one row on the page is, on its own, accepted: the refusal is the bad row's, for the whole answer.
      const anyAlone = json.data.some((r) => checkPublishedRows([r], CASE_REQUEST).ok);
      expect(anyAlone, c.name).toBe(true);
    }
  });
});

describe("A2-6 ii: the census against what the roster consumes", () => {
  const PAGE_GATES = ["page.cursor.next", "page.cursor.prev", "page.object", "page.rows", "page.shape"] as const;
  const refused = STAFFING_CASES.filter((c) => c.expect === "refused");

  it.each([...CONSUMED_SHIFT_KEYS, ...PAGE_GATES])("%s has at least one refused case", (field) => {
    expect(refused.some((c) => c.field === field && (c.layer === "row" || c.layer === "page"))).toBe(true);
  });

  it("both halves of the rule have refused cases", () => {
    expect(refused.some((c) => c.half === "request")).toBe(true);
    expect(refused.some((c) => c.half === "written_form")).toBe(true);
  });

  it("every refusal code but row_normalizer has a case (row_normalizer is unreachable after checks 1-12)", () => {
    const codes: AnswerRefusal[] = [
      "page_shape", "page_not_terminal", "page_prev_cursor", "page_object_tag", "page_too_many_rows",
      "row_not_object", "row_id", "row_location", "row_company", "row_draft", "row_deleted", "row_publish_status",
      "row_assignment", "row_role", "row_time_form", "row_end_before_start", "row_outside_window", "row_duplicate_id",
    ];
    for (const code of codes) expect(STAFFING_CASES.some((c) => c.refusal === code), code).toBe(true);
  });

  it("identity and transport cases exist for the reader test", () => {
    expect(STAFFING_CASES.some((c) => c.layer === "identity" && c.expect === "refused")).toBe(true);
    expect(STAFFING_CASES.some((c) => c.layer === "transport" && c.expect === "refused")).toBe(true);
    expect(STAFFING_CASES.filter((c) => c.layer === "identity" || c.layer === "transport").every((c) => c.refusal === undefined)).toBe(true);
  });

  it("case names are unique", () => {
    expect(new Set(STAFFING_CASES.map((c) => c.name)).size).toBe(STAFFING_CASES.length);
  });
});

describe("the valid page", () => {
  it("is accepted with exactly the expected shifts (company_id dropped, open shift has no person)", () => {
    expect(check(validAnswerBody())).toEqual({ ok: true, shifts: VALID_SHIFTS });
  });
  it("the valid empty terminal page is accepted with no shifts", () => {
    expect(check(validAnswerBody({ rows: [] }))).toEqual({ ok: true, shifts: [] });
  });
});

describe("A2-6 iii: only consumed keys are ever read", () => {
  it("a Proxy row records reads only of CONSUMED_SHIFT_KEYS", () => {
    const page = parse(validAnswerBody()) as { data: unknown[] };
    const reads = new Set<string>();
    const target = page.data[0] as object;
    const proxy = new Proxy(target, {
      get(t, k, r) { reads.add(String(k)); return Reflect.get(t, k, r); },
      has(t, k) { reads.add(String(k)); return Reflect.has(t, k); },
      getOwnPropertyDescriptor(t, k) { reads.add(String(k)); return Reflect.getOwnPropertyDescriptor(t, k); },
      ownKeys(t) { reads.add("<ownKeys>"); return Reflect.ownKeys(t); },
    });
    page.data[0] = proxy;
    expect(checkPublishedAnswer(page, CASE_REQUEST)).toEqual({ ok: true, shifts: VALID_SHIFTS });
    expect(reads.size).toBeGreaterThan(0);
    const allowed = new Set<string>(CONSUMED_SHIFT_KEYS);
    expect([...reads].filter((k) => !allowed.has(k))).toEqual([]);
  });

  it("a valid row carrying poisoned department_id / station_id / modified is accepted", () => {
    const body = validAnswerBody({ rows: [shiftRow("A", { department_id: str("!!"), station_id: "{}", modified: "12" }), shiftRow("B")] });
    // The normalizer alone would reject this row (it reads department_id): proof the digest never handed it those keys.
    expect(normalizeShifts((parse(body) as { data: unknown[] }).data).rejected.length).toBeGreaterThan(0);
    expect(check(body)).toEqual({ ok: true, shifts: [VALID_SHIFTS[0], VALID_SHIFTS[1]] });
  });
});

describe("A2-3: a JS number is never an id", () => {
  it("id 7 as a JS number (no source text) is refused", () => {
    const page = parse(validAnswerBody()) as { data: Record<string, unknown>[] };
    page.data[0]!.id = 7;
    expect(checkPublishedAnswer(page, CASE_REQUEST)).toEqual({ ok: false, refusal: "row_id" });
  });
  it("plain JSON.parse of numeric ids (no reviver) is refused, fail closed", () => {
    expect(checkPublishedAnswer(JSON.parse(validAnswerBody()), CASE_REQUEST)).toEqual({ ok: false, refusal: "row_id" });
  });
  it("NaN (an unverifiable numeric id) is refused in every id slot", () => {
    for (const [k, code] of [["id", "row_id"], ["location_id", "row_location"], ["company_id", "row_company"], ["user_id", "row_assignment"], ["role_id", "row_role"]] as const) {
      const page = parse(validAnswerBody()) as { data: Record<string, unknown>[] };
      page.data[0]![k] = Number.NaN;
      expect(checkPublishedAnswer(page, CASE_REQUEST), k).toEqual({ ok: false, refusal: code });
    }
  });
});

describe("A2-6 iv: the rule itself, generated", () => {
  type Form = "missing" | "null" | "wrong_type" | "out_of_range";
  type Expected = AnswerRefusal | "accepted";
  /** Literal text for each form, per key (missing = the key removed). */
  const FORMS: Record<(typeof CONSUMED_SHIFT_KEYS)[number], Record<Exclude<Form, "missing" | "null">, string>> = {
    id: { wrong_type: "true", out_of_range: "0" },
    location_id: { wrong_type: "true", out_of_range: "0" },
    company_id: { wrong_type: "true", out_of_range: "9002" },
    user_id: { wrong_type: "true", out_of_range: "0" },
    open: { wrong_type: str("false"), out_of_range: "true" },
    role_id: { wrong_type: "true", out_of_range: "-1" },
    start: { wrong_type: "12", out_of_range: str("2026-03-01T04:00:00Z") },
    end: { wrong_type: "12", out_of_range: str("2026-03-01T13:00:00Z") },
    draft: { wrong_type: str("false"), out_of_range: "true" },
    deleted: { wrong_type: str("false"), out_of_range: "true" },
    publish_status: { wrong_type: "true", out_of_range: str("draft") },
  };
  /** Written by hand from the rules, for the ASSIGNED Shop A row. */
  const ASSIGNED: Record<(typeof CONSUMED_SHIFT_KEYS)[number], Record<Form, Expected>> = {
    id: { missing: "row_id", null: "row_id", wrong_type: "row_id", out_of_range: "row_id" },
    location_id: { missing: "row_location", null: "row_location", wrong_type: "row_location", out_of_range: "row_location" },
    company_id: { missing: "accepted", null: "accepted", wrong_type: "row_company", out_of_range: "row_company" },
    user_id: { missing: "row_assignment", null: "row_assignment", wrong_type: "row_assignment", out_of_range: "row_assignment" },
    open: { missing: "accepted", null: "row_assignment", wrong_type: "row_assignment", out_of_range: "row_assignment" },
    role_id: { missing: "accepted", null: "accepted", wrong_type: "row_role", out_of_range: "row_role" },
    start: { missing: "row_time_form", null: "row_time_form", wrong_type: "row_time_form", out_of_range: "row_outside_window" },
    end: { missing: "row_time_form", null: "row_time_form", wrong_type: "row_time_form", out_of_range: "row_end_before_start" },
    draft: { missing: "row_draft", null: "row_draft", wrong_type: "row_draft", out_of_range: "row_draft" },
    deleted: { missing: "row_deleted", null: "row_deleted", wrong_type: "row_deleted", out_of_range: "row_deleted" },
    publish_status: { missing: "row_publish_status", null: "row_publish_status", wrong_type: "row_publish_status", out_of_range: "row_publish_status" },
  };
  /** The OPEN row's own assignment fields (the other keys behave as on the assigned row). */
  const OPEN_FORMS: Record<"user_id" | "open", Record<Exclude<Form, "missing" | "null">, string>> = {
    user_id: { wrong_type: "true", out_of_range: "5" },
    open: { wrong_type: str("true"), out_of_range: "false" },
  };
  const OPEN: Record<"user_id" | "open", Record<Form, Expected>> = {
    user_id: { missing: "accepted", null: "accepted", wrong_type: "row_assignment", out_of_range: "row_assignment" },
    open: { missing: "row_assignment", null: "row_assignment", wrong_type: "row_assignment", out_of_range: "row_assignment" },
  };

  function mutate(base: RowBase, key: string, form: Form, forms: Record<string, Record<string, string>>): string {
    const v = form === "missing" ? null : form === "null" ? "null" : forms[key]![form]!;
    return shiftRow(base, { [key]: v });
  }
  const FORM_LIST: Form[] = ["missing", "null", "wrong_type", "out_of_range"];

  it("every consumed key has a hand-written expectation", () => {
    expect(Object.keys(ASSIGNED).sort()).toEqual([...CONSUMED_SHIFT_KEYS].sort());
    expect(Object.keys(FORMS).sort()).toEqual([...CONSUMED_SHIFT_KEYS].sort());
  });

  for (const key of CONSUMED_SHIFT_KEYS) {
    for (const form of FORM_LIST) {
      const want = ASSIGNED[key][form];
      it(`assigned row: ${key} ${form} → ${want}`, () => {
        const out = check(validAnswerBody({ rows: [mutate("A", key, form, FORMS), shiftRow("B"), shiftRow("OPEN")] }));
        if (want === "accepted") expect(out.ok).toBe(true);
        else expect(out).toEqual({ ok: false, refusal: want });
      });
    }
  }
  for (const key of ["user_id", "open"] as const) {
    for (const form of FORM_LIST) {
      const want = OPEN[key][form];
      it(`open row: ${key} ${form} → ${want}`, () => {
        const out = check(validAnswerBody({ rows: [shiftRow("A"), shiftRow("B"), mutate("OPEN", key, form, OPEN_FORMS)] }));
        if (want === "accepted") {
          expect(out.ok).toBe(true);
          if (out.ok) expect(out.shifts[2]).toEqual(VALID_SHIFTS[2]);
        } else expect(out).toEqual({ ok: false, refusal: want });
      });
    }
  }
});

describe("own windows: DST days, leap day, ±14:00", () => {
  function request(from: string, to: string): PublishedShiftsRequest {
    const w = windowInstants({ modifiedSince: null, from, to });
    return { limit: 200, companyId: "9001", startGte: w.gte, startLte: w.lte };
  }
  const row = (start: string, end: string) => shiftRow("A", { start: str(start), end: str(end) });
  const one = (req: PublishedShiftsRequest, start: string, end: string) => check(validAnswerBody({ rows: [row(start, end)] }), req);
  const plus = (iso: string, s: number) => new Date(Date.parse(iso) + s * 1000).toISOString().replace(".000Z", "Z");

  it("2026-03-08 (23 h ET day): both bounds in, one second either side out", () => {
    const req = request("2026-03-08", "2026-03-08");
    expect(Date.parse(req.startLte) + 1000 - Date.parse(req.startGte)).toBe(23 * 3600_000);
    expect(one(req, req.startGte, plus(req.startGte, 3600)).ok).toBe(true);
    expect(one(req, req.startLte, plus(req.startLte, 3600)).ok).toBe(true);
    expect(one(req, plus(req.startGte, -1), plus(req.startGte, 3600))).toEqual({ ok: false, refusal: "row_outside_window" });
    expect(one(req, plus(req.startLte, 1), plus(req.startLte, 3600))).toEqual({ ok: false, refusal: "row_outside_window" });
  });
  it("2026-11-01 (25 h ET day): both bounds in, one second either side out", () => {
    const req = request("2026-11-01", "2026-11-01");
    expect(Date.parse(req.startLte) + 1000 - Date.parse(req.startGte)).toBe(25 * 3600_000);
    expect(one(req, req.startGte, plus(req.startGte, 3600)).ok).toBe(true);
    expect(one(req, req.startLte, plus(req.startLte, 3600)).ok).toBe(true);
    expect(one(req, plus(req.startGte, -1), plus(req.startGte, 3600))).toEqual({ ok: false, refusal: "row_outside_window" });
    expect(one(req, plus(req.startLte, 1), plus(req.startLte, 3600))).toEqual({ ok: false, refusal: "row_outside_window" });
  });
  it("S12: 2028-02-29 passes in its own window", () => {
    expect(one(request("2028-02-29", "2028-02-29"), "2028-02-29T14:00:00Z", "2028-02-29T22:00:00Z").ok).toBe(true);
  });
  it("A2-2: +14:00 and -14:00 pass in their own windows", () => {
    // 2026-03-02T14:00+14:00 = 2026-03-02T00:00Z (ET 2026-03-01 19:00); -14:00 at 2026-02-28T20:00 = 2026-03-01T10:00Z.
    expect(one(request("2026-03-01", "2026-03-01"), "2026-03-02T14:00:00+14:00", "2026-03-02T02:00:00Z").ok).toBe(true);
    expect(one(request("2026-03-01", "2026-03-01"), "2026-02-28T20:00:00-14:00", "2026-03-01T12:00:00Z").ok).toBe(true);
  });
});

describe("the written-shape twin: the check accepts exactly the normalizer's ZONED shapes", () => {
  // Real dates and clocks, no sub-millisecond digit: the only difference left is the shape, which must agree.
  const SHAPES = [
    "2026-03-01T14:00Z", "2026-03-01T14:00:00Z", "2026-03-01T14:00:00.5Z", "2026-03-01T14:00:00.120Z",
    "2026-03-01T14:00:00.123000000Z", "2026-03-01T14:00:00+0500", "2026-03-01T14:00:00-05:00", "2026-03-01T14:00+05:00",
    "2026-03-01 14:00:00Z", "2026-03-01T14:00:00z", "2026-03-01T14:00:00.Z", "2026-03-01T14:00:00.1234567890Z",
    "2026-03-01T14Z", "2026-3-01T14:00:00Z", "2026-03-01T14:00:00+5", "2026-03-01T14:00:00 Z", " 2026-03-01T14:00:00Z",
    "2026-03-01T14:00:00+05:00:00", "2026-03-01T14:00:00UTC",
  ];
  it.each(SHAPES)("%s", (start) => {
    const body = validAnswerBody({ rows: [shiftRow("A", { start: str(start), end: str("2026-03-02T23:00:00Z") })] });
    const norm = normalizeShifts([{ id: "1", start, end: "2026-03-02T23:00:00Z" }]);
    expect(check(body).ok).toBe(norm.rejected.length === 0);
  });
});

describe("checkPublishedRows on its own, and the request", () => {
  it("refuses rows that are not an array, and more than limit rows", () => {
    expect(checkPublishedRows({}, CASE_REQUEST)).toEqual({ ok: false, refusal: "page_shape" });
    expect(checkPublishedRows([], { ...CASE_REQUEST, limit: 0 })).toEqual({ ok: false, refusal: "page_shape" });
    const rows = (parse(validAnswerBody()) as { data: unknown[] }).data;
    expect(checkPublishedRows(rows, { ...CASE_REQUEST, limit: 2 })).toEqual({ ok: false, refusal: "page_too_many_rows" });
  });
  it("the page limit is checked before any row is looked at", () => {
    const body = validAnswerBody({ rows: ["null", "null", "null"] });
    expect(check(body, { ...CASE_REQUEST, limit: 2 })).toEqual({ ok: false, refusal: "page_too_many_rows" });
  });
  it("a malformed request refuses even an empty page (fail closed; nothing can be shown consistent with it)", () => {
    const empty = validAnswerBody({ rows: [] });
    for (const bad of [
      { ...CASE_REQUEST, companyId: "0" }, { ...CASE_REQUEST, companyId: "09001" }, { ...CASE_REQUEST, startGte: "x" },
      { ...CASE_REQUEST, startLte: "2026-02-30T00:00:00Z" }, { ...CASE_REQUEST, startGte: CASE_REQUEST.startLte, startLte: CASE_REQUEST.startGte },
      { ...CASE_REQUEST, limit: 1.5 },
    ]) expect(check(empty, bad)).toEqual({ ok: false, refusal: "page_shape" });
  });
  it("one failing row refuses the whole answer, whichever position it holds", () => {
    const bad = shiftRow("B", { draft: "true" });
    expect(check(validAnswerBody({ rows: [bad, shiftRow("A")] }))).toEqual({ ok: false, refusal: "row_draft" });
    expect(check(validAnswerBody({ rows: [shiftRow("A"), shiftRow("OPEN"), bad] }))).toEqual({ ok: false, refusal: "row_draft" });
  });
  it("a row with an exotic prototype is not a plain object", () => {
    const rows = (parse(validAnswerBody()) as { data: object[] }).data;
    const odd = Object.assign(Object.create({ inherited: 1 }) as object, rows[0]);
    expect(checkPublishedRows([odd], CASE_REQUEST)).toEqual({ ok: false, refusal: "row_not_object" });
  });
  it("inherited keys never count as present (a missing key is never read as a value)", () => {
    const rows = (parse(validAnswerBody()) as { data: Record<string, unknown>[] }).data;
    const r = { ...rows[0]! };
    delete r.draft;
    const proto = Object.prototype as Record<string, unknown>;
    proto.draft = false;
    try {
      expect(checkPublishedRows([r], CASE_REQUEST)).toEqual({ ok: false, refusal: "row_draft" });
    } finally {
      delete proto.draft;
    }
  });
});
