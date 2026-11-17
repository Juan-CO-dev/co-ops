/**
 * PII-free SHAPE capture for rejected dates (2026-11-17). Prod evidence: every availability row is
 * refused `bad_date` (rows 0, skipped 6), so `week` / `week_to` arrive in a spelling the reader does
 * not accept, and the ledger could not say which. A shape is the value with every digit replaced by
 * `9` and every letter by `a` (only a `T` between digits and a final `Z` after a digit survive), so
 * it says HOW a date is spelled and never WHICH date it is.
 */
import { describe, expect, it } from "vitest";

import { AVAILABILITY_SHAPES, TIME_OFF_SHAPES } from "./fixtures/sevenshifts/time-shapes";
import {
  addReasons,
  cleanDateShapes,
  DATE_FIELDS,
  DATE_SHAPE_LIMIT,
  DATE_SHAPE_MAX_CHARS,
  normalizeAvailabilities,
  normalizeTimeOff,
  normalizeUsers,
  normalizeWages,
  rejectionReasons,
  valueShape,
} from "@/lib/sevenshifts/normalize-shared";
import { summarizeHealth } from "@/lib/sevenshifts/health-shared";
import { wagesSnapshot } from "@/lib/sevenshifts/paginate-shared";

const avail = (over: Record<string, unknown>) => ({ ...AVAILABILITY_SHAPES.oneOffWeek, ...over });

describe("valueShape — the spelling of a value, never the value", () => {
  it("digits become 9; separators stay; a T between digits and a closing Z stay", () => {
    expect(valueShape("2026-11-16T05:00:00Z")).toBe("9999-99-99T99:99:99Z");
    expect(valueShape("2026-11-16 05:00:00")).toBe("9999-99-99 99:99:99");
    expect(valueShape("16/11/2026")).toBe("99/99/9999");
    expect(valueShape("2026-11-16T00:00:00.000+05:30")).toBe("9999-99-99T99:99:99.999+99:99");
    expect(valueShape("2026-11-16T05:00:00-0500")).toBe("9999-99-99T99:99:99-9999");
  });
  it("every other letter is `a` (a name can never ride out), and a T or Z that is not part of a timestamp too", () => {
    expect(valueShape("Mon, 16 Nov 2026")).toBe("aaa, 99 aaa 9999");
    expect(valueShape("PLANTED-DATE")).toBe("aaaaaaa-aaaa");
    expect(valueShape("Tuesday Zed")).toBe("aaaaaaa aaa");
    expect(valueShape("2026-11-16 EST")).toBe("9999-99-99 aaa");
  });
  it("anything that is not an ASCII letter, a digit or a date separator is `?`", () => {
    expect(valueShape("2026–11–16")).toBe("9999?99?99");
    expect(valueShape("2026-11-16\n<b>")).toBe("9999-99-99??a?");
    expect(valueShape("José 16")).toBe("aaa? 99");
  });
  it("non-strings are a fixed token; the empty string too", () => {
    expect(valueShape(1763269200)).toBe("<number>");
    expect(valueShape(true)).toBe("<boolean>");
    expect(valueShape({ date: "2026-11-16" })).toBe("<object>");
    expect(valueShape(["2026-11-16"])).toBe("<array>");
    expect(valueShape("")).toBe("<empty>");
  });
  it(`is at most ${DATE_SHAPE_MAX_CHARS} characters`, () => {
    expect(DATE_SHAPE_MAX_CHARS).toBe(40);
    expect(valueShape("2026-11-16T05:00:00Z".repeat(10))).toHaveLength(40);
  });
  it("never contains a digit other than 9 or a letter other than a / T / Z", () => {
    for (const v of ["2026-11-16T05:00:00Z", "Juan Pérez 202-555-0134", "0123456789", "abcXYZ", "T1T2Z"]) {
      expect(valueShape(v), v).toMatch(/^[9aTZ?\-:/., +]+$/);
    }
    expect(valueShape("T1T2Z")).toBe("a9T9Z");
  });
});

describe("the normalizers report the shape of each rejected date, per field", () => {
  it("availability week / week_to: the prod case (every row bad_date)", () => {
    const out = normalizeAvailabilities([
      avail({ id: 1, week: "2026-11-16T05:00:00Z", week_to: "2026-11-23T05:00:00Z" }),
      avail({ id: 2, week: "2026-11-23T05:00:00Z" }),
      avail({ id: 3, week_to: "23/11/2026" }),
    ]);
    expect(out.rejected.map((r) => r.reason)).toEqual(["bad_date", "bad_date", "bad_date"]);
    // One shape per field per row: the row stops at its first refused field.
    expect(out.dateShapes).toEqual({ week: ["9999-99-99T99:99:99Z"], week_to: ["99/99/9999"] });
  });
  it("time off from_date / to_date, users hire_date and wages effective_date are captured too", () => {
    expect(normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, from_date: "2026-11-22T04:00:00Z" }, { ...TIME_OFF_SHAPES.partialDay, to_date: 20261122 }]).dateShapes)
      .toEqual({ from_date: ["9999-99-99T99:99:99Z"], to_date: ["<number>"] });
    expect(normalizeUsers([{ id: 1, company_id: 2, active: true, hire_date: "2026-11-20 00:00:00" }]).dateShapes).toEqual({ hire_date: ["9999-99-99 99:99:99"] });
    const snap = wagesSnapshot({ data: { current_wages: [{ id: 61, effective_date: "2026-09-01T00:00:00Z", role_id: null, wage_type: "hourly", wage_cents: 1650 }], upcoming_wages: [{ id: 62, effective_date: "09/01/2026", role_id: null, wage_type: "hourly", wage_cents: 1700 }] } });
    if (!snap.ok) throw new Error("fixture");
    expect(normalizeWages("501", snap.value).dateShapes).toEqual({ effective_date: ["9999-99-99T99:99:99Z", "99/99/9999"] });
  });
  it("no rejected date → no `dateShapes` key at all; another rule firing adds none", () => {
    expect(normalizeAvailabilities([AVAILABILITY_SHAPES.oneOffWeek])).not.toHaveProperty("dateShapes");
    expect(normalizeAvailabilities([avail({ modified: "yesterday" }), avail({ mon_to: "24:30" }), avail({ id: "x" })])).not.toHaveProperty("dateShapes");
    // A missing required date is `missing_field`: there is no value to describe.
    const { from_date: _drop, ...noFrom } = TIME_OFF_SHAPES.partialDay as Record<string, unknown>;
    expect(normalizeTimeOff([noFrom])).not.toHaveProperty("dateShapes");
  });
  it(`at most ${DATE_SHAPE_LIMIT} DISTINCT shapes per field, first seen first; a repeat is not a new shape`, () => {
    expect(DATE_SHAPE_LIMIT).toBe(3);
    const weeks = ["2026-11-16T05:00:00Z", "2026-11-23T05:00:00Z", "16/11/2026", "Nov 16", "20261116", "2026.11.16"];
    const out = normalizeAvailabilities(weeks.map((week, i) => avail({ id: i + 1, week })));
    expect(out.rejected).toHaveLength(6);
    expect(out.dateShapes).toEqual({ week: ["9999-99-99T99:99:99Z", "99/99/9999", "aaa 99"] });
  });
  it("the raw value never rides out", () => {
    const out = normalizeAvailabilities([avail({ week: "2031-07-04T04:00:00Z" }), avail({ week_to: "PLANTED 1987" })]);
    expect(JSON.stringify(out.dateShapes)).not.toMatch(/2031|07-04|PLANTED|1987/);
  });
});

describe("the ledger's `reasons`: the histogram plus `date_shapes`", () => {
  it("rejectionReasons = counts over the closed vocabulary + the shapes, only when a date was refused", () => {
    const dated = normalizeAvailabilities([avail({ week: "2026-11-16T05:00:00Z" }), avail({ week: "2026-11-23T05:00:00Z" }), avail({ mon_to: "24:30" })]);
    expect(rejectionReasons(dated)).toEqual({ bad_date: 2, bad_time: 1, date_shapes: { week: ["9999-99-99T99:99:99Z"] } });
    expect(rejectionReasons(normalizeAvailabilities([avail({ mon_to: "24:30" })]))).toEqual({ bad_time: 1 });
    expect(rejectionReasons(normalizeAvailabilities([AVAILABILITY_SHAPES.oneOffWeek]))).toEqual({});
  });
  it("addReasons (the per-user snapshot kinds): counts add, shapes merge under the same cap", () => {
    const a = { bad_date: 2, date_shapes: { effective_date: ["9999-99-99T99:99:99Z", "99/99/9999"] } };
    const b = { bad_date: 3, bad_value: 1, date_shapes: { effective_date: ["99/99/9999", "aaa 99", "9999.99.99"], hire_date: ["<number>"] } };
    expect(addReasons(a, b)).toEqual({ bad_date: 5, bad_value: 1, date_shapes: { effective_date: ["9999-99-99T99:99:99Z", "99/99/9999", "aaa 99"], hire_date: ["<number>"] } });
    expect(addReasons({}, { bad_id: 1 })).toEqual({ bad_id: 1 });
    expect(addReasons({}, {})).toEqual({});
  });
  it("cleanDateShapes keeps only known date fields and well-formed shapes — nothing else can pass through it", () => {
    expect(DATE_FIELDS).toEqual(["week", "week_to", "from_date", "to_date", "hire_date", "effective_date"]);
    expect(cleanDateShapes({
      week: ["9999-99-99T99:99:99Z", "2026-11-16", "Juan", 7, "9".repeat(41), "<number>", "99/99/9999", "aaa 99"],
      first_name: ["aaaa"], week_to: "9999-99-99", from_date: [],
    })).toEqual({ week: ["9999-99-99T99:99:99Z", "<number>", "99/99/9999"] });
    expect(cleanDateShapes(null)).toEqual({});
    expect(cleanDateShapes("9999")).toEqual({});
  });
});

describe("the heartbeat carries the shapes beside the counts", () => {
  it("rejected_reasons keeps a well-formed `date_shapes` and drops anything smuggled into it", () => {
    const h = summarizeHealth(["availabilities"], {
      availabilities: {
        rows: 0, skipped: 6, error_code: "rejected_rows",
        reasons: { bad_date: 6, date_shapes: { week: ["9999-99-99T99:99:99Z", "2026-11-16T05:00:00Z"], PLANTED: ["9999"], week_to: ["PLANTED"] } } as never,
      },
    }, { whoamiError: null, persistenceErrors: [] });
    expect(h.rejectedReasons).toEqual({ availabilities: { bad_date: 6, date_shapes: { week: ["9999-99-99T99:99:99Z"] } } });
    expect(JSON.stringify(h)).not.toMatch(/PLANTED|2026/);
  });
  it("no shapes → no `date_shapes` key", () => {
    const h = summarizeHealth(["availabilities"], { availabilities: { rows: 4, skipped: 1, error_code: "rejected_rows", reasons: { bad_time: 1 } } }, { whoamiError: null, persistenceErrors: [] });
    expect(h.rejectedReasons).toEqual({ availabilities: { bad_time: 1 } });
  });
});
