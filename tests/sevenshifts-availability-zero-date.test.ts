/**
 * THE PROD AVAILABILITY REFUSALS (2026-11-19), read from the real captured shape.
 *
 * What prod's ledger says (tests/fixtures/sevenshifts/prod-availability-rejection-2026-11-19.json, 57 hourly
 * runs): 0 rows, 6 skipped, `bad_date` 6, and ONE shape, on `week` only: `9999-99-99`.
 *
 * What that proves, with the reader as it was:
 *   · the value is ten characters, digits and two hyphens: exactly `YYYY-MM-DD`. No clock, no zone;
 *   · the reader accepts every `YYYY-MM-DD` that is a real calendar day, so the value is NOT one: its month
 *     is 00 or past 12, or its day is 00 or past the month's end;
 *   · `week_to` was never read on those rows (a row stops at its first refused field), so it is UNOBSERVED.
 *
 * What it does not prove: WHICH non-date it is. A shape hides the digits by design. The one non-date with a
 * meaning is the SQL zero date `0000-00-00` ("no date"), so that, and only that, is read as NO DATE on the
 * two optional week fields. Any other non-date is still refused `bad_date`, and now says which kind it is
 * with a fixed token beside its shape, so one prod run settles the question without a value leaving.
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
const repeating = (over: Record<string, unknown>) => ({ ...AVAILABILITY_SHAPES.repeatingSparse, ...over });
const oneOff = (over: Record<string, unknown>) => ({ ...AVAILABILITY_SHAPES.oneOffWeek, ...over });

describe("the captured record", () => {
  it("is what this file is written from: availabilities, 0 landed, 6 refused bad_date, one shape on `week`", () => {
    expect(CAPTURED.resource).toBe("availabilities");
    expect(CAPTURED.result).toEqual({ rows: 0, skipped: 6, error_code: "rejected_rows", reasons: { bad_date: 6, date_shapes: { week: [SHAPE] } } });
  });
  it("the zero date has exactly the captured shape, and so does every other `YYYY-MM-DD` (the shape hides the digits)", () => {
    expect(EXPORTED_ZERO_DATE).toBe(ZERO_DATE);
    for (const v of [ZERO_DATE, "2026-11-16", "2026-02-30", "2026-00-00", "9999-99-99"]) expect(valueShape(v), v).toBe(SHAPE);
  });
  it("a real calendar day in that shape was never the problem: it is read as itself", () => {
    const out = normalizeAvailabilities([oneOff({ week: "2026-11-16", week_to: "2026-11-22" }), repeating({ week: "2024-02-29" })]);
    expect(out.rejected).toEqual([]);
    expect(out.rows.map((r) => [r.week, r.week_to])).toEqual([["2026-11-16", "2026-11-22"], ["2024-02-29", null]]);
  });
});

describe("the fix: the zero date on availability `week` / `week_to` is NO DATE", () => {
  it("the prod case: six rows whose `week` is the zero date all land, with `week` null and nothing rejected", () => {
    const rows = Array.from({ length: CAPTURED.result.skipped }, (_, i) => repeating({ id: 7001 + i, user_id: 501 + i, week: ZERO_DATE }));
    const out = normalizeAvailabilities(rows);
    expect(out.rejected).toEqual([]);
    expect(out).not.toHaveProperty("dateShapes");
    expect(out.rows).toHaveLength(6);
    expect(out.rows.map((r) => r.week)).toEqual([null, null, null, null, null, null]);
    expect(rejectionReasons(out)).toEqual({});
  });
  it("everything else on the row is kept as sent: ids, the flag, the status, the days", () => {
    const [row] = normalizeAvailabilities([repeating({ week: ZERO_DATE })]).rows;
    const [same] = normalizeAvailabilities([repeating({ week: null })]).rows;
    expect(row).toEqual(same);
    expect(row).toMatchObject({ id: "6004", user_id: "504", week: null, week_to: null, repeating: true, status: 1 });
    expect(row!.days.tue).toEqual({ code: 2, from: "18:00:00", to: "24:00:00" });
  });
  it("`week_to` (unobserved on prod: the row stopped at `week`) reads the zero date the same way", () => {
    const out = normalizeAvailabilities([repeating({ week: ZERO_DATE, week_to: ZERO_DATE }), repeating({ id: 6005, week: "2025-06-02", week_to: ZERO_DATE })]);
    expect(out.rejected).toEqual([]);
    expect(out.rows.map((r) => [r.week, r.week_to])).toEqual([[null, null], ["2025-06-02", null]]);
  });
  it("only the exact spelling: surrounding space is trimmed like every date, a zero date with a clock or a zone is still refused", () => {
    expect(normalizeAvailabilities([repeating({ week: ` ${ZERO_DATE} ` })]).rows[0]?.week).toBeNull();
    for (const bad of ["0000-00-00 00:00:00", "0000-00-00T00:00:00Z", "0000-00-00T00:00:00+00:00", "00000000", "0000/00/00", "0"]) {
      expect(normalizeAvailabilities([repeating({ week: bad })]).rejected, bad).toEqual([{ index: 0, reason: "bad_date" }]);
    }
  });
});

describe("every other non-date is still refused, and now says which kind (never which date)", () => {
  const shapesOf = (week: string) => normalizeAvailabilities([oneOff({ week })]);
  it("a zero month or a zero day that is not the zero date", () => {
    for (const v of ["2026-00-00", "2026-11-00", "2026-00-16", "0000-00-01", "0000-01-00"]) {
      const out = shapesOf(v);
      expect(out.rejected, v).toEqual([{ index: 0, reason: "bad_date" }]);
      expect(out.dateShapes, v).toEqual({ week: [SHAPE, "<zero-month-or-day>"] });
    }
  });
  it("a month past 12 or a day past the month's end", () => {
    for (const v of ["2026-02-30", "2026-13-01", "2026-11-31", "2025-02-29", "2026-99-99"]) {
      const out = shapesOf(v);
      expect(out.rejected, v).toEqual([{ index: 0, reason: "bad_date" }]);
      expect(out.dateShapes, v).toEqual({ week: [SHAPE, "<no-such-day>"] });
    }
  });
  it("a zero date where it is NOT accepted: with a clock, and on every required or strict date field", () => {
    expect(shapesOf("0000-00-00 00:00:00").dateShapes).toEqual({ week: ["9999-99-99 99:99:99", "<zero-date>"] });
    const off = normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, from_date: ZERO_DATE }, { ...TIME_OFF_SHAPES.partialDay, to_date: ZERO_DATE }]);
    expect(off.rejected.map((r) => r.reason)).toEqual(["bad_date", "bad_date"]);
    expect(off.dateShapes).toEqual({ from_date: [SHAPE, "<zero-date>"], to_date: [SHAPE, "<zero-date>"] });
    const user = normalizeUsers([{ id: 1, company_id: 2, active: true, hire_date: ZERO_DATE }]);
    expect(user.rejected).toEqual([{ index: 0, reason: "bad_date" }]);
    expect(user.dateShapes).toEqual({ hire_date: [SHAPE, "<zero-date>"] });
    const snap = wagesSnapshot({ data: { current_wages: [{ id: 61, effective_date: ZERO_DATE, role_id: null, wage_type: "hourly", wage_cents: 1650 }], upcoming_wages: [] } });
    if (!snap.ok) throw new Error("fixture");
    const wage = normalizeWages("501", snap.value);
    expect(wage.rejected).toEqual([{ index: 0, reason: "bad_date", part: "current_wages" }]);
    expect(wage.dateShapes).toEqual({ effective_date: [SHAPE, "<zero-date>"] });
  });
  it("a date refused for another reason (a zoned clock, a spelling the reader does not know) gets NO kind: its day is real or unread", () => {
    expect(shapesOf("2026-11-16T05:00:00Z").dateShapes).toEqual({ week: ["9999-99-99T99:99:99Z"] });
    expect(shapesOf("16/11/2026").dateShapes).toEqual({ week: ["99/99/9999"] });
    expect(shapesOf("20260230").dateShapes).toEqual({ week: ["99999999"] });
    expect(normalizeAvailabilities([oneOff({ week: 20261116 })]).dateShapes).toEqual({ week: ["<number>"] });
  });
  it("the kinds are a closed list of fixed tokens; they pass the gate and the heartbeat, and nothing rides with them", () => {
    expect(DATE_CLASS_TOKENS).toEqual(["<zero-date>", "<zero-month-or-day>", "<no-such-day>"]);
    expect(cleanDateShapes({ week: [SHAPE, "<zero-date>", "<no-such-day>"], week_to: ["<zero-month-or-day>", "<zero>", "<2026-02-30>", "<no-such-day> 2026"] }))
      .toEqual({ week: [SHAPE, "<zero-date>", "<no-such-day>"], week_to: ["<zero-month-or-day>"] });
    const out = shapesOf("2031-02-30");
    const h = summarizeHealth(["availabilities"], { availabilities: { rows: 0, skipped: 1, error_code: "rejected_rows", reasons: rejectionReasons(out) } }, { whoamiError: null, persistenceErrors: [] });
    expect(h.rejectedReasons).toEqual({ availabilities: { bad_date: 1, date_shapes: { week: [SHAPE, "<no-such-day>"] } } });
    expect(JSON.stringify(h)).not.toMatch(/2031|02-30/);
    expect(JSON.stringify([out.dateShapes, h.rejectedReasons.availabilities!.date_shapes])).not.toMatch(/[0-8]/);
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

  it("a zero-date availability is stored with `week` and `week_to` NULL (and the raw zero date itself could never be stored)", async () => {
    const spec = MIRROR_WRITE_SPEC.availabilities;
    const out = normalizeAvailabilities([repeating({ id: 7001, week: ZERO_DATE, week_to: ZERO_DATE })]);
    expect(out.rejected).toEqual([]);
    const row = out.rows[0] as unknown as Record<string, unknown>;
    const cols = Object.keys(row);
    expect([...cols].sort()).toEqual([...spec.columns].sort());
    const value = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
    const updates = cols.filter((c) => !(spec.mode === "upsert" && spec.onConflict.includes(c))).map((c) => `${c} = excluded.${c}`).join(", ");
    const sql = `insert into public.${spec.table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) on conflict (id) do update set ${updates}`;
    for (let pass = 0; pass < 2; pass++) await db.query(sql, cols.map((c) => value(row[c])));
    const stored = (await db.query<Record<string, unknown>>(`select id::text, week, week_to, repeating from public.${spec.table}`)).rows;
    expect(stored).toEqual([{ id: "7001", week: null, week_to: null, repeating: true }]);
    await expect(db.query(`select '${ZERO_DATE}'::date`)).rejects.toThrow();
  });
});
