/**
 * THE PROD AVAILABILITY REFUSALS (2026-11-19), read from the real captured shape.
 *
 * What prod's ledger says (tests/fixtures/sevenshifts/prod-availability-rejection-2026-11-19.json, 57 hourly
 * runs): 0 rows, 6 skipped, `bad_date` 6, and ONE shape, on `week` only: `9999-99-99`.
 *
 * What that proves, with the reader as it was:
 *   · the value is ten characters, digits and two hyphens: exactly `YYYY-MM-DD`. No clock, no zone;
 *   · the reader accepted every `YYYY-MM-DD` that is a real calendar day, so the value is NOT one: its month
 *     is 00 or past 12, or its day is 00 or past the month's end;
 *   · `week_to` was never read on those rows (a row stops at its first refused field), so it is UNOBSERVED.
 *
 * What it does not prove: WHICH non-date it is. A shape hides the digits by design. So nothing here assumes
 * one: the rule is tested over the WHOLE class the shape stands for (`CLASS`, and an exhaustive sweep of
 * month × day). Whatever the six values are, they are in that class, and every member of it now lands with
 * the date NULL and a note saying which kind it was. The SQL zero date `0000-00-00` is the likely member;
 * the first prod run after the deploy names the kind in the ledger's `notes`.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

import { AVAILABILITY_SHAPES, TIME_OFF_SHAPES } from "./fixtures/sevenshifts/time-shapes";
import { summarizeHealth } from "@/lib/sevenshifts/health-shared";
import { MIRROR_WRITE_SPEC } from "@/lib/sevenshifts/mirror-spec-shared";
import {
  cleanDateShapes,
  DATE_CLASS_TOKENS,
  dateNotes,
  normalizeAvailabilities,
  normalizeTimeOff,
  normalizeUsers,
  normalizeWages,
  rejectionReasons,
  valueShape,
  ZERO_DATE as EXPORTED_ZERO_DATE,
} from "@/lib/sevenshifts/normalize-shared";
import { wagesSnapshot } from "@/lib/sevenshifts/paginate-shared";

const CAPTURED = JSON.parse(readFileSync("tests/fixtures/sevenshifts/prod-availability-rejection-2026-11-19.json", "utf8")) as {
  resource: string;
  result: { rows: number; skipped: number; error_code: string; reasons: { bad_date: number; date_shapes: { week: string[] } } };
};
/** Written out here, not imported: a missing export must fail these tests, not make them read `undefined`. */
const ZERO_DATE = "0000-00-00";
const SHAPE = "9999-99-99";
/** Members of the class the captured shape stands for (`YYYY-MM-DD`, no calendar day), with the kind each is. */
const CLASS: Array<[string, string]> = [
  [ZERO_DATE, "<zero-date>"],
  ["2026-00-00", "<zero-month-or-day>"], ["2026-11-00", "<zero-month-or-day>"], ["2026-00-16", "<zero-month-or-day>"],
  ["0000-00-01", "<zero-month-or-day>"], ["0000-01-00", "<zero-month-or-day>"],
  ["2026-02-30", "<no-such-day>"], ["2026-13-01", "<no-such-day>"], ["2026-11-31", "<no-such-day>"],
  ["2025-02-29", "<no-such-day>"], ["2026-99-99", "<no-such-day>"], ["9999-99-99", "<no-such-day>"],
];
const repeating = (over: Record<string, unknown>) => ({ ...AVAILABILITY_SHAPES.repeatingSparse, ...over });
const oneOff = (over: Record<string, unknown>) => ({ ...AVAILABILITY_SHAPES.oneOffWeek, ...over });
const p2 = (n: number) => String(n).padStart(2, "0");

describe("the captured record", () => {
  it("is what this file is written from: availabilities, 0 landed, 6 refused bad_date, one shape on `week`", () => {
    expect(CAPTURED.resource).toBe("availabilities");
    expect(CAPTURED.result).toEqual({ rows: 0, skipped: 6, error_code: "rejected_rows", reasons: { bad_date: 6, date_shapes: { week: [SHAPE] } } });
  });
  it("every member of the class has exactly the captured shape, and so does a real day (the shape hides the digits)", () => {
    expect(EXPORTED_ZERO_DATE).toBe(ZERO_DATE);
    for (const [v] of CLASS) expect(valueShape(v), v).toBe(SHAPE);
    expect(valueShape("2026-11-16")).toBe(SHAPE);
  });
  it("a real calendar day in that shape was never the problem: it is read as itself, with no note", () => {
    const out = normalizeAvailabilities([oneOff({ week: "2026-11-16", week_to: "2026-11-22" }), repeating({ week: "2024-02-29" })]);
    expect(out.rejected).toEqual([]);
    expect(out).not.toHaveProperty("dateNotes");
    expect(out.rows.map((r) => [r.week, r.week_to])).toEqual([["2026-11-16", "2026-11-22"], ["2024-02-29", null]]);
  });
});

describe("the fix: on availability `week` / `week_to`, a `YYYY-MM-DD` that names no calendar day is NO DATE, and the row lands", () => {
  for (const [value, kind] of CLASS) {
    it(`the prod case if the six values are ${value}: all six land, \`week\` null, noted ${kind}`, () => {
      const rows = Array.from({ length: CAPTURED.result.skipped }, (_, i) => repeating({ id: 7001 + i, user_id: 501 + i, week: value }));
      const out = normalizeAvailabilities(rows);
      expect(out.rejected).toEqual([]);
      expect(out).not.toHaveProperty("dateShapes");
      expect(rejectionReasons(out)).toEqual({});
      expect(out.rows.map((r) => r.week)).toEqual([null, null, null, null, null, null]);
      expect(out.rows.map((r) => r.id)).toEqual(["7001", "7002", "7003", "7004", "7005", "7006"]);
      expect(dateNotes(out)).toEqual({ no_date: 6, date_shapes: { week: [kind] } });
    });
  }
  it("WHATEVER the digits: every `YYYY-MM-DD` over all months 00-99 and days 00-99 either is a real day (kept) or lands as no date; none is refused", () => {
    let real = 0;
    let none = 0;
    for (const year of ["0001", "2024", "2026", "9999"]) {
      for (let m = 0; m <= 99; m++) {
        const values = Array.from({ length: 100 }, (_, d) => `${year}-${p2(m)}-${p2(d)}`);
        const out = normalizeAvailabilities(values.map((week, i) => repeating({ id: i + 1, week })));
        expect(out.rejected, `${year}-${p2(m)}`).toEqual([]);
        expect(out.rows).toHaveLength(100);
        out.rows.forEach((row, d) => {
          const ms = Date.parse(`${values[d]}T00:00:00Z`);
          const isDay = Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === values[d];
          expect(row.week, values[d]).toBe(isDay ? values[d] : null);
          if (isDay) real++; else none++;
        });
        expect(dateNotes(out)?.no_date ?? 0, `${year}-${p2(m)}`).toBe(out.rows.filter((r) => r.week === null).length);
      }
    }
    // 365 + 366 + 365 + 365 real days in years 0001, 2024, 2026, 9999; the other spellings are the class.
    expect([real, none]).toEqual([1461, 40_000 - 1461]);
  });
  it("everything else on the row is kept as sent: ids, the flag, the status, the days", () => {
    const [row] = normalizeAvailabilities([repeating({ week: ZERO_DATE })]).rows;
    const [same] = normalizeAvailabilities([repeating({ week: null })]).rows;
    expect(row).toEqual(same);
    expect(row).toMatchObject({ id: "6004", user_id: "504", week: null, week_to: null, repeating: true, status: 1 });
    expect(row!.days.tue).toEqual({ code: 2, from: "18:00:00", to: "24:00:00" });
  });
  it("`week_to` (unobserved on prod: the row stopped at `week`) is read by the same rule; a note counts values, per field", () => {
    const out = normalizeAvailabilities([repeating({ week: ZERO_DATE, week_to: ZERO_DATE }), repeating({ id: 6005, week: "2025-06-02", week_to: "2026-02-30" })]);
    expect(out.rejected).toEqual([]);
    expect(out.rows.map((r) => [r.week, r.week_to])).toEqual([[null, null], ["2025-06-02", null]]);
    expect(dateNotes(out)).toEqual({ no_date: 3, date_shapes: { week: ["<zero-date>"], week_to: ["<zero-date>", "<no-such-day>"] } });
  });
  it("surrounding space is trimmed like every date", () => {
    const out = normalizeAvailabilities([repeating({ week: ` ${ZERO_DATE} ` })]);
    expect(out.rows[0]?.week).toBeNull();
    expect(dateNotes(out)).toEqual({ no_date: 1, date_shapes: { week: ["<zero-date>"] } });
  });
  it("a row refused for another field leaves no note: it is a rejection, counted once, as before", () => {
    const out = normalizeAvailabilities([repeating({ week: ZERO_DATE, mon_to: "24:30" }), repeating({ id: 6005, week: ZERO_DATE })]);
    expect(out.rejected).toEqual([{ index: 0, reason: "bad_time" }]);
    expect(dateNotes(out)).toEqual({ no_date: 1, date_shapes: { week: ["<zero-date>"] } });
  });
});

describe("nothing else is loosened", () => {
  const week = (v: unknown) => normalizeAvailabilities([oneOff({ week: v })]);
  it("the same non-dates with a clock or a zone, and other spellings, are still refused on `week`; a refusal names its kind when there is one", () => {
    expect(week("0000-00-00 00:00:00").rejected).toEqual([{ index: 0, reason: "bad_date" }]);
    expect(week("0000-00-00 00:00:00").dateShapes).toEqual({ week: ["9999-99-99 99:99:99", "<zero-date>"] });
    expect(week("0000-00-00T00:00:00Z").dateShapes).toEqual({ week: ["9999-99-99T99:99:99Z", "<zero-date>"] });
    expect(week("2026-00-00T00:00:00+00:00").dateShapes).toEqual({ week: ["9999-99-99T99:99:99+99:99", "<zero-month-or-day>"] });
    expect(week("2026-02-30 09:00:00").dateShapes).toEqual({ week: ["9999-99-99 99:99:99", "<no-such-day>"] });
    for (const bad of ["00000000", "0000/00/00", "0", "0000-00-0", "0000-00-000", "00-00-0000"]) {
      const out = week(bad);
      expect(out.rejected, bad).toEqual([{ index: 0, reason: "bad_date" }]);
      expect(out, bad).not.toHaveProperty("dateNotes");
    }
  });
  it("a real day refused for its clock or zone, or a spelling whose day was never read, gets NO kind", () => {
    expect(week("2026-11-16T05:00:00Z").dateShapes).toEqual({ week: ["9999-99-99T99:99:99Z"] });
    expect(week("16/11/2026").dateShapes).toEqual({ week: ["99/99/9999"] });
    expect(week("20260230").dateShapes).toEqual({ week: ["99999999"] });
    expect(week(20261116).dateShapes).toEqual({ week: ["<number>"] });
  });
  it("time off `from_date` / `to_date` (required), users `hire_date` and wages `effective_date` (strict) still refuse the zero date, with its kind", () => {
    const off = normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, from_date: ZERO_DATE }, { ...TIME_OFF_SHAPES.partialDay, to_date: ZERO_DATE }, { ...TIME_OFF_SHAPES.partialDay, to_date: "2026-02-30" }]);
    expect(off.rows).toEqual([]);
    expect(off.rejected.map((r) => r.reason)).toEqual(["bad_date", "bad_date", "bad_date"]);
    expect(off.dateShapes).toEqual({ from_date: [SHAPE, "<zero-date>"], to_date: [SHAPE, "<zero-date>", "<no-such-day>"] });
    expect(off).not.toHaveProperty("dateNotes");
    const user = normalizeUsers([{ id: 1, company_id: 2, active: true, hire_date: ZERO_DATE }]);
    expect(user.rejected).toEqual([{ index: 0, reason: "bad_date" }]);
    expect(user.dateShapes).toEqual({ hire_date: [SHAPE, "<zero-date>"] });
    const snap = wagesSnapshot({ data: { current_wages: [{ id: 61, effective_date: ZERO_DATE, role_id: null, wage_type: "hourly", wage_cents: 1650 }], upcoming_wages: [] } });
    if (!snap.ok) throw new Error("fixture");
    const wage = normalizeWages("501", snap.value);
    expect(wage.rejected).toEqual([{ index: 0, reason: "bad_date", part: "current_wages" }]);
    expect(wage.dateShapes).toEqual({ effective_date: [SHAPE, "<zero-date>"] });
  });
});

describe("kinds and notes carry no value", () => {
  it("the kinds are a closed list of fixed tokens; they pass the shape gate and the heartbeat, and nothing rides with them", () => {
    expect(DATE_CLASS_TOKENS).toEqual(["<zero-date>", "<zero-month-or-day>", "<no-such-day>"]);
    expect(cleanDateShapes({ week: [SHAPE, "<zero-date>", "<no-such-day>"], week_to: ["<zero-month-or-day>", "<zero>", "<2026-02-30>", "<no-such-day> 2026"] }))
      .toEqual({ week: [SHAPE, "<zero-date>", "<no-such-day>"], week_to: ["<zero-month-or-day>"] });
    const out = normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, from_date: "2031-02-30" }]);
    const h = summarizeHealth(["time_off"], { time_off: { rows: 0, skipped: 1, error_code: "rejected_rows", reasons: rejectionReasons(out) } }, { whoamiError: null, persistenceErrors: [] });
    expect(h.rejectedReasons).toEqual({ time_off: { bad_date: 1, date_shapes: { from_date: [SHAPE, "<no-such-day>"] } } });
    expect(JSON.stringify(h)).not.toMatch(/2031|02-30/);
    expect(JSON.stringify([out.dateShapes, h.rejectedReasons.time_off!.date_shapes])).not.toMatch(/[0-8]/);
  });
  it("`dateNotes` is the gate for the ledger's `notes`: a positive count and kind tokens under known date fields, or nothing", () => {
    expect(dateNotes({})).toBeUndefined();
    expect(dateNotes({ dateNotes: { no_date: 2, date_shapes: { week: ["<zero-date>"] } } })).toEqual({ no_date: 2, date_shapes: { week: ["<zero-date>"] } });
    // A shape is not a kind; a raw value, a name and an unknown field cannot pass; a bad count is nothing at all.
    expect(dateNotes({ dateNotes: { no_date: 2, date_shapes: { week: [SHAPE, "0000-00-00", "Juan", "<number>", "<no-such-day>"], first_name: ["<zero-date>"] } as never } }))
      .toEqual({ no_date: 2, date_shapes: { week: ["<no-such-day>"] } });
    expect(dateNotes({ dateNotes: { no_date: 2, date_shapes: { week: ["0000-00-00"] } } })).toBeUndefined();
    for (const n of [0, -1, 1.5, Number.NaN, "6" as never]) expect(dateNotes({ dateNotes: { no_date: n, date_shapes: { week: ["<zero-date>"] } } }), String(n)).toBeUndefined();
    expect(dateNotes({ dateNotes: "PLANTED" as never })).toBeUndefined();
    const real = normalizeAvailabilities([repeating({ week: "2031-02-30", week_to: ZERO_DATE })]);
    expect(JSON.stringify(dateNotes(real))).not.toMatch(/2031|02-30|0000/);
  });
});

describe("the mirror takes the row: the spec's upsert on the real 0268 table", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(readFileSync("tests/fixtures/scheduling-pglite-stub.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/0243_cron_route_leases.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/0268_sevenshifts_sync.sql", "utf8"));
    await db.exec("set role service_role");
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("one row per kind is stored with `week` and `week_to` NULL (Postgres itself could never store such a value)", async () => {
    const spec = MIRROR_WRITE_SPEC.availabilities;
    const out = normalizeAvailabilities([
      repeating({ id: 7001, week: ZERO_DATE, week_to: ZERO_DATE }),
      repeating({ id: 7002, week: "2026-00-00", week_to: null }),
      repeating({ id: 7003, week: "2026-02-30", week_to: "2026-13-01" }),
    ]);
    expect(out.rejected).toEqual([]);
    const value = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
    for (const r of out.rows) {
      const row = r as unknown as Record<string, unknown>;
      const cols = Object.keys(row);
      expect([...cols].sort()).toEqual([...spec.columns].sort());
      const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
      const sql = `insert into public.${spec.table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) on conflict (id) do update set ${updates}`;
      for (let pass = 0; pass < 2; pass++) await db.query(sql, cols.map((c) => value(row[c])));
    }
    const stored = (await db.query<Record<string, unknown>>(`select id::text, week, week_to, repeating from public.${spec.table} order by id`)).rows;
    expect(stored).toEqual(["7001", "7002", "7003"].map((id) => ({ id, week: null, week_to: null, repeating: true })));
    for (const v of [ZERO_DATE, "2026-00-00", "2026-02-30"]) await expect(db.query(`select '${v}'::date`), v).rejects.toThrow();
  });
});
