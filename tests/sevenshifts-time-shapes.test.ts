/**
 * The first prod 7shifts sync (2026-11-11) rejected EVERY time-off (25) and availability (6) row
 * with `rejected_rows`, and the PII-free ledger could not say why. These tests pin the real-world
 * shapes of both resources (synthetic data), the reason histogram that now rides in the ledger, and
 * the PII allow-list that still drops comments, reasons, approvers and status messages.
 */
import { describe, expect, it } from "vitest";

import { AVAILABILITY_SHAPES, PLANTED, STATUS, TIME_OFF_SHAPES } from "./fixtures/sevenshifts/time-shapes";
import {
  addHistograms,
  normalizeAvailabilities,
  normalizeShifts,
  normalizeTimeOff,
  normalizeUsers,
  REJECT_REASONS,
  rejectionHistogram,
  normalizeWages,
  type Rejected,
} from "@/lib/sevenshifts/normalize-shared";
import { wagesSnapshot } from "@/lib/sevenshifts/paginate-shared";

const timeOffRows = Object.values(TIME_OFF_SHAPES);
const availabilityRows = Object.values(AVAILABILITY_SHAPES);

describe("time off — every real-world shape lands", () => {
  it("accepts all five shapes, none rejected", () => {
    const out = normalizeTimeOff(timeOffRows);
    expect(out.rejected).toEqual([]);
    expect(out.rows.map((r) => r.id)).toEqual(["5001", "5002", "5003", "5004", "5005"]);
  });

  it("all-day, legacy `YYYY-MM-DD 00:00:00` dates → calendar dates; `00:00:00` times kept as wall times", () => {
    expect(normalizeTimeOff([TIME_OFF_SHAPES.allDayLegacy]).rows[0]).toEqual({
      id: "5001", user_id: "501", from_date: "2026-11-20", to_date: "2026-11-20", partial: false,
      from_time: "00:00:00", to_time: "00:00:00", status: STATUS.approved, hours: 8, source_modified_at: null,
    });
  });

  it("multi-day, ISO-midnight dates (`…T00:00:00Z`) → the date part, null times stay null, pending", () => {
    expect(normalizeTimeOff([TIME_OFF_SHAPES.multiDayIsoMidnight]).rows[0]).toMatchObject({
      from_date: "2026-12-24", to_date: "2026-12-27", partial: false, from_time: null, to_time: null, status: STATUS.pending, hours: 0,
    });
  });

  it("partial day: bare dates, `HH:MM:SS` wall times, declined, a decimal-string total", () => {
    expect(normalizeTimeOff([TIME_OFF_SHAPES.partialDay]).rows[0]).toMatchObject({
      from_date: "2026-11-22", to_date: "2026-11-22", partial: true, from_time: "09:00:00", to_time: "13:30:00",
      status: STATUS.declined, hours: 4.5,
    });
  });

  it("partial day with `9:00` / `17:00` wall times, 0/1 flags and a digit-string status; a zoneless undocumented `modified` is null, never a guess", () => {
    expect(normalizeTimeOff([TIME_OFF_SHAPES.partialDayShortTimes]).rows[0]).toMatchObject({
      partial: true, from_time: "09:00:00", to_time: "17:00:00", status: STATUS.approved, source_modified_at: null,
    });
  });

  it("zoneless dates with a wall clock keep the wall DATE (never shifted through UTC); a zoned `modified` is kept", () => {
    expect(normalizeTimeOff([TIME_OFF_SHAPES.multiDayWallClock]).rows[0]).toMatchObject({
      from_date: "2026-11-28", to_date: "2026-11-29", partial: false, hours: 16, source_modified_at: "2026-11-06T12:00:00.000Z",
    });
  });

  it("a ZONED non-midnight date is bad_date: its wall date would depend on a zone we do not know", () => {
    expect(normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, from_date: "2026-11-22T04:00:00Z" }]).rejected).toEqual([{ index: 0, reason: "bad_date" }]);
    // A zoned midnight in ANY offset is a date serialized as a timestamp.
    expect(normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, from_date: "2026-11-22T00:00:00-05:00" }]).rows[0]!.from_date).toBe("2026-11-22");
  });

  it("a zoned time, a 25th hour, a 60th minute and Feb 30 are refused with their own reason", () => {
    expect(normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, partial_from: "2026-11-22T09:00:00Z" }]).rejected[0]!.reason).toBe("bad_time");
    expect(normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, partial_from: "25:00" }]).rejected[0]!.reason).toBe("bad_time");
    expect(normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, partial_to: "09:60:00" }]).rejected[0]!.reason).toBe("bad_time");
    expect(normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, to_date: "2026-02-30" }]).rejected[0]!.reason).toBe("bad_date");
    expect(normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, status: "approved" }]).rejected[0]!.reason).toBe("bad_value");
    expect(normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, user_id: null }]).rejected[0]!.reason).toBe("missing_field");
  });
});

describe("availability — every real-world shape lands", () => {
  it("accepts all four shapes, none rejected", () => {
    const out = normalizeAvailabilities(availabilityRows);
    expect(out.rejected).toEqual([]);
    expect(out.rows.map((r) => r.id)).toEqual(["6001", "6002", "6003", "6004"]);
  });

  it("repeating weekly: legacy week date, week_to null, approved, a zoneless `modified` read as the UTC the docs declare", () => {
    const row = normalizeAvailabilities([AVAILABILITY_SHAPES.repeatingWeekly]).rows[0]!;
    expect(row).toMatchObject({ id: "6001", user_id: "501", week: "2026-01-05", week_to: null, repeating: true, status: STATUS.approved,
      source_modified_at: "2026-10-30T16:45:12.000Z" });
    expect(row.days.tue).toEqual({ code: 2, from: "09:00:00", to: "15:00:00" });
    expect(row.days.thu).toEqual({ code: 2, from: "16:00:00", to: "23:00:00" });
    expect(Object.keys(row.days)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  });

  it("one-off week: bare dates, repeat false, pending, ISO `modified`", () => {
    const row = normalizeAvailabilities([AVAILABILITY_SHAPES.oneOffWeek]).rows[0]!;
    expect(row).toMatchObject({ week: "2026-11-16", week_to: "2026-11-22", repeating: false, status: STATUS.pending, source_modified_at: "2026-11-10T20:10:33.254Z" });
    expect(row.days.sun).toEqual({ code: 2, from: "11:00:00", to: "16:00:00" });
  });

  it("one-off with ISO-midnight week dates, 0/1 flags, digit-string codes and short wall times; empty times are null", () => {
    const row = normalizeAvailabilities([AVAILABILITY_SHAPES.oneOffShortTimes]).rows[0]!;
    expect(row).toMatchObject({ week: "2026-11-23", week_to: "2026-11-29", repeating: false, status: STATUS.declined, source_modified_at: null });
    expect(row.days.mon).toEqual({ code: 1, from: "00:00:00", to: "00:00:00" });
    expect(row.days.tue).toEqual({ code: 2, from: "09:00:00", to: "15:00:00" });
    expect(row.days.wed).toEqual({ code: 2, from: "09:30:00", to: "17:45:00" });
    expect(row.days.fri).toEqual({ code: 0, from: null, to: null });
    expect(row.days.sat).toEqual({ code: 1, from: null, to: null });
    expect(row.days.sun).toEqual({ code: 2, from: "08:00:00", to: "12:00:00" });
  });

  it("a day 7shifts left unspecified keeps a null code (not invented); `24:00:00` is a valid end", () => {
    const row = normalizeAvailabilities([AVAILABILITY_SHAPES.repeatingSparse]).rows[0]!;
    expect(row.days.mon).toEqual({ code: null, from: null, to: null });
    expect(row.days.tue).toEqual({ code: 2, from: "18:00:00", to: "24:00:00" });
    expect(row.days.fri).toEqual({ code: 2, from: "17:00:00", to: "23:59:59" });
    expect(row.repeating).toBe(true);
  });

  it("a fractional day code, a zoned week and `24:30` are refused", () => {
    expect(normalizeAvailabilities([{ ...AVAILABILITY_SHAPES.oneOffWeek, mon: 1.5 }]).rejected[0]!.reason).toBe("bad_value");
    expect(normalizeAvailabilities([{ ...AVAILABILITY_SHAPES.oneOffWeek, week: "2026-11-16T05:00:00Z" }]).rejected[0]!.reason).toBe("bad_date");
    expect(normalizeAvailabilities([{ ...AVAILABILITY_SHAPES.oneOffWeek, mon_to: "24:30" }]).rejected[0]!.reason).toBe("bad_time");
    expect(normalizeAvailabilities([{ ...AVAILABILITY_SHAPES.oneOffWeek, modified: "yesterday" }]).rejected[0]!.reason).toBe("bad_instant");
  });

  it("review P3: the clock and the offset are validated BEFORE they are set aside — never through UTC", () => {
    const d = (v: string) => normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, from_date: v }]);
    const w = (v: string) => normalizeAvailabilities([{ ...AVAILABILITY_SHAPES.oneOffWeek, week: v }]);
    for (const bad of ["2026-11-20 99:99:99", "2026-11-20 24:00:00", "2026-11-20 23:60:00", "2026-11-20 23:59:60", "2026-11-20T00:00:00+99:99",
      "2026-11-20T00:00:00+15:00", "2026-11-20T00:00:00+14:30", "2026-11-20T00:00:00-14:01", "2026-11-20T00:00:00+0a:00", "2026-11-20T00:00:00+5:00"]) {
      expect(d(bad).rejected, bad).toEqual([{ index: 0, reason: "bad_date" }]);
      expect(w(bad).rejected, bad).toEqual([{ index: 0, reason: "bad_date" }]);
    }
    // A zoneless clock (midnight or not) is the wall clock of that date; a zoned midnight needs a real offset.
    for (const ok of ["2026-11-20 23:59:59", "2026-11-20 00:00", "2026-11-20T00:00", "2026-11-20T00:00:00+14:00", "2026-11-20T00:00:00-12:00", "2026-11-20T00:00:00.000-00:30", "2026-11-20T00:00:00+0530"]) {
      expect(d(ok).rows[0]?.from_date, ok).toBe("2026-11-20");
      expect(w(ok).rows[0]?.week, ok).toBe("2026-11-20");
    }
    expect(normalizeTimeOff([{ ...TIME_OFF_SHAPES.partialDay, partial_from: "2026-02-30 09:00:00" }]).rejected[0]!.reason).toBe("bad_time");
  });

  it("review P2: users' hire_date and wages' effective_date stay STRICT YYYY-MM-DD — a wall clock or a zoned midnight is refused as at baseline", () => {
    const u = (hire_date: string) => normalizeUsers([{ id: 1, company_id: 2, active: true, hire_date }]);
    expect(u("2026-11-20").rows[0]!.hire_date).toBe("2026-11-20");
    for (const bad of ["2026-11-20 19:30:00", "2026-11-20 00:00:00", "2026-11-20T00:00:00Z", "2026-11-20T00:00:00-05:00", "20/11/2026"]) {
      expect(u(bad).rejected, bad).toEqual([{ index: 0, reason: "bad_date" }]);
    }
    const snap = (effective_date: string) => wagesSnapshot({ data: { current_wages: [{ id: 61, effective_date, role_id: null, wage_type: "hourly", wage_cents: 1650 }], upcoming_wages: [] } });
    const wage = (effective_date: string) => { const r = snap(effective_date); if (!r.ok) throw new Error("fixture"); return normalizeWages("501", r.value); };
    expect(wage("2026-09-01").rows[0]!.effective_date).toBe("2026-09-01");
    for (const bad of ["2026-09-01 00:00:00", "2026-09-01T00:00:00Z", "2026-09-01 19:30:00"]) {
      expect(wage(bad).rejected, bad).toEqual([{ index: 0, reason: "bad_date", part: "current_wages" }]);
    }
  });

  it("the strict instant rule still holds where it must: shifts and users never read a zoneless clock", () => {
    expect(normalizeShifts([{ id: 1, start: "2026-11-20 09:00:00", end: "2026-11-20T17:00:00Z" }]).rejected[0]!.reason).toBe("bad_instant");
    expect(normalizeUsers([{ id: 1, company_id: 2, active: true, modified: "2026-11-20 09:00:00" }]).rejected[0]!.reason).toBe("bad_instant");
  });
});

describe("the PII allow-list still holds on every shape", () => {
  const outputs = [normalizeTimeOff(timeOffRows), normalizeAvailabilities(availabilityRows)];
  it.each(Object.entries(PLANTED))("no output contains the planted %s", (_k, planted) => {
    expect(JSON.stringify(outputs).includes(planted)).toBe(false);
  });
  it("no output key names a dropped field", () => {
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) { keys.push(k); walk(x); }
    };
    walk(outputs.map((o) => o.rows));
    expect(keys.join(" ")).not.toMatch(/comment|reason|status_action|category|created|old_approved|company_id/);
  });
});

describe("the rejection histogram — reasons only, never a value", () => {
  it("counts each reason that fired, in the closed vocabulary; empty when nothing was rejected", () => {
    const out = normalizeTimeOff([
      TIME_OFF_SHAPES.allDayLegacy,
      { ...TIME_OFF_SHAPES.partialDay, from_date: "2026-11-22T04:00:00Z" },
      { ...TIME_OFF_SHAPES.partialDay, to_date: "22/11/2026" },
      { ...TIME_OFF_SHAPES.partialDay, partial_from: "noon" },
      { ...TIME_OFF_SHAPES.partialDay, id: "x" },
      "not a row",
    ]);
    expect(out.rows).toHaveLength(1);
    expect(rejectionHistogram(out.rejected)).toEqual({ bad_date: 2, bad_time: 1, bad_id: 1, not_object: 1 });
    expect(rejectionHistogram([])).toEqual({});
    expect(addHistograms({ bad_date: 2 }, { bad_date: 1, bad_time: 3 })).toEqual({ bad_date: 3, bad_time: 3 });
    expect(addHistograms({}, {})).toEqual({});
  });

  it("is pinned to REJECT_REASONS: an unknown reason cannot enter, and nothing but reason → integer comes out", () => {
    const smuggled = [{ index: 0, reason: "2026-11-22T04:00:00Z" }, { index: 1, reason: "bad_date", part: "PLANTED" }] as unknown as Rejected[];
    const h = rejectionHistogram(smuggled);
    expect(h).toEqual({ bad_date: 1 });
    for (const [k, v] of Object.entries(h)) {
      expect(REJECT_REASONS).toContain(k);
      expect(Number.isInteger(v) && (v as number) > 0).toBe(true);
    }
    expect(JSON.stringify(h)).not.toMatch(/PLANTED|index|part|2026/);
    expect(REJECT_REASONS).toEqual(["not_object", "missing_field", "bad_id", "bad_instant", "bad_date", "bad_time", "bad_value"]);
  });
});
