/**
 * Scheduling Phase 2, Task 1 — the quarter-hour time grid (plan "File Structure", `time-shared.ts`).
 * Schedule time = ET wall-clock quarter-hours on a business date (J5); instants only at the edges.
 */
import { describe, expect, it } from "vitest";
import { addDays, ceil15Q, formatQ, isoDowOf, qToWall, Q_PER_DAY, wallToQ, weekDays } from "@/lib/scheduling/time-shared";
import { ScheduleError } from "@/lib/scheduling/errors-shared";
import { etWallMinutesInstant } from "@/lib/operational-day";

describe("the quarter grid", () => {
  it("96 quarters a day; wallToQ / qToWall round-trip on the grid", () => {
    expect(Q_PER_DAY).toBe(96);
    expect(wallToQ("10:30")).toBe(42);
    expect(wallToQ("00:00")).toBe(0);
    expect(wallToQ("24:00")).toBe(96);
    expect(wallToQ("21:00")).toBe(84);
    expect(qToWall(96)).toBe("24:00");
    expect(qToWall(42)).toBe("10:30");
    expect(qToWall(0)).toBe("00:00");
    for (let q = 0; q <= 96; q++) expect(wallToQ(qToWall(q))).toBe(q);
  });

  it("an off-grid or malformed wall time refuses edit_off_grid (never rounds)", () => {
    for (const bad of ["10:20", "10:31", "25:00", "24:15", "1030", "", "10:3"]) {
      try {
        wallToQ(bad);
        throw new Error(`accepted ${bad}`);
      } catch (e) {
        expect(e).toBeInstanceOf(ScheduleError);
        expect((e as ScheduleError).code).toBe("edit_off_grid");
      }
    }
  });

  it("qToWall refuses a quarter outside 0..96 or a fraction", () => {
    expect(() => qToWall(97)).toThrow(ScheduleError);
    expect(() => qToWall(-1)).toThrow(ScheduleError);
    expect(() => qToWall(4.5)).toThrow(ScheduleError);
  });

  it("ceil15Q rounds minutes UP to whole quarters", () => {
    expect(ceil15Q(0)).toBe(0);
    expect(ceil15Q(45)).toBe(3);
    expect(ceil15Q(46)).toBe(4);
    expect(ceil15Q(50)).toBe(4);
    expect(ceil15Q(60)).toBe(4);
  });

  it("formatQ is language-aware through lib/i18n/format (never a hardcoded locale)", () => {
    expect(formatQ(42, "en")).toBe("10:30 AM");
    expect(formatQ(84, "en")).toBe("9:00 PM");
    expect(formatQ(84, "es")).toMatch(/9:00/);
    expect(formatQ(96, "en")).toBe("12:00 AM");
  });
});

describe("weeks and dates (ISO weekday, no timezone)", () => {
  it("weekDays(Monday) → Mon..Sun", () => {
    expect(weekDays("2026-10-19")).toEqual([
      "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25",
    ]);
    expect(weekDays("2026-10-19").map(isoDowOf)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("a week start that is not a Monday, or not a date, refuses horizon_invalid", () => {
    expect(() => weekDays("2026-10-20")).toThrow(ScheduleError);
    expect(() => weekDays("2026-13-01")).toThrow(ScheduleError);
    expect(() => weekDays("nope")).toThrow(ScheduleError);
  });

  it("addDays crosses months and years on the calendar grid", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });

  it("the DST week (2026-10-26 → 2026-11-01) has 7 days; each day's 7:00 and 21:00 round-trip through etWallMinutesInstant", () => {
    const days = weekDays("2026-10-26");
    expect(days).toHaveLength(7);
    expect(days[6]).toBe("2026-11-01");
    const et = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    for (const d of days) {
      for (const q of [wallToQ("07:00"), wallToQ("21:00")]) {
        const instant = etWallMinutesInstant(d, q * 15);
        const p = Object.fromEntries(et.formatToParts(instant).map(({ type, value }) => [type, value]));
        expect(`${p.year}-${p.month}-${p.day}`).toBe(d);
        expect(`${p.hour}:${p.minute}`).toBe(qToWall(q));
      }
    }
    // The fall-back Sunday: 7:00 EST is 12:00Z, the Saturday before it 7:00 EDT is 11:00Z.
    expect(etWallMinutesInstant("2026-11-01", 7 * 60).toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(etWallMinutesInstant("2026-10-31", 7 * 60).toISOString()).toBe("2026-10-31T11:00:00.000Z");
  });
});
