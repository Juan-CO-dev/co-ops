// Item 4 PR 1: the zero-feed candidates (trend, calendar holidays) and the composition bounds.
import { describe, expect, it } from "vitest";
import {
  HOLIDAY_MODEL, SIGNAL_BOUNDS, TREND_MODEL, clampSignal, composeSignals, federalHolidays, holidayOn, holidaySignal, trendSignal,
} from "@/lib/demand-signals/candidates-shared";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";

describe("composition bounds", () => {
  it("are the plan's numbers, frozen", () => {
    expect(SIGNAL_BOUNDS).toEqual({ perSignal: [0.85, 1.15], product: [0.8, 1.2], withVelocity: [0.75, 1.25] });
    expect(Object.isFrozen(SIGNAL_BOUNDS)).toBe(true);
  });
  it("no signal is EXACTLY 1, whatever the velocity (so no live number can move)", () => {
    for (const v of [0.75, 0.9, 1, 1.1337, 1.25]) expect(composeSignals([], v)).toBe(1);
    expect(composeSignals([1], 1.1)).toBe(1);
  });
  it("clamps each signal, then the product, then signals x velocity", () => {
    expect(clampSignal(2)).toBe(1.15);
    expect(clampSignal(0.1)).toBe(0.85);
    expect(composeSignals([1.15, 1.15], 1)).toBeCloseTo(1.2, 12);
    expect(composeSignals([0.85, 0.85], 1)).toBeCloseTo(0.8, 12);
    // signals cannot widen today's velocity envelope: 1.25 x anything above 1 stays 1.25 in total.
    expect(composeSignals([1.15], 1.25) * 1.25).toBeCloseTo(1.25, 12);
    expect(composeSignals([0.85], 0.75) * 0.75).toBeCloseTo(0.75, 12);
    expect(composeSignals([1.1], 1.05) * 1.05).toBeCloseTo(1.155, 12);
  });
  it("a value that is not a positive finite number is no signal", () => {
    expect(composeSignals([Number.NaN, 0, -1], 1)).toBe(1);
  });
});

describe("the federal holiday calendar (computed, no feed)", () => {
  const dates = (y: number) => Object.fromEntries(federalHolidays(y).map((h) => [h.key + (h.observed ? "_observed" : ""), h.date]));
  it("2026", () => {
    expect(dates(2026)).toEqual({
      new_years_day: "2026-01-01", mlk_day: "2026-01-19", presidents_day: "2026-02-16", memorial_day: "2026-05-25", juneteenth: "2026-06-19",
      independence_day: "2026-07-04", independence_day_observed: "2026-07-03", labor_day: "2026-09-07", columbus_day: "2026-10-12",
      veterans_day: "2026-11-11", thanksgiving: "2026-11-26", christmas_day: "2026-12-25",
    });
  });
  it("an observed day can fall in the year before", () => {
    expect(holidayOn("2027-12-31")).toEqual({ key: "new_years_day", observed: true });
    expect(holidayOn("2028-01-01")).toEqual({ key: "new_years_day", observed: false });
    expect(holidayOn("2027-12-24")).toEqual({ key: "christmas_day", observed: true });
    expect(holidayOn("2026-10-13")).toBeNull();
  });
});

describe("the holiday candidate", () => {
  it("is silent off a holiday and silent on one with no earlier holiday to learn from", () => {
    expect(holidaySignal("2026-10-13", [0.6, 0.7])).toEqual({ multiplier: 1, active: false, eventKey: null });
    expect(holidaySignal("2026-11-26", [])).toEqual({ multiplier: 1, active: false, eventKey: "thanksgiving" });
  });
  it("shrinks the earlier holidays' ratio toward 1 and clamps it", () => {
    const k = HOLIDAY_MODEL.shrinkK;
    expect(holidaySignal("2026-11-26", [0.9, 0.9]).multiplier).toBeCloseTo((1.8 + k) / (2 + k), 12);
    expect(holidaySignal("2026-11-26", [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2])).toEqual({ multiplier: 0.85, active: true, eventKey: "thanksgiving" });
  });
});

describe("the trend candidate", () => {
  const series = (recent: number, prior: number, skip?: number) => Array.from({ length: 14 }, (_, i) => ({ date: addDaysEt("2026-10-15", -(i + 1)), value: i < 7 ? recent : prior }))
    .filter((_, i) => i !== skip);
  it("is the last 7 days over the 7 before, shrunk by half, clamped", () => {
    expect(trendSignal(series(110, 100), "2026-10-15")).toEqual({ multiplier: 1.05, active: true, eventKey: "trend_up" });
    expect(trendSignal(series(90, 100), "2026-10-15")).toEqual({ multiplier: 0.95, active: true, eventKey: "trend_down" });
    expect(trendSignal(series(200, 100), "2026-10-15").multiplier).toBe(1.15);
    expect(TREND_MODEL).toMatchObject({ recentDays: 7, priorDays: 7, shrink: 0.5 });
  });
  it("is silent inside the deadband, with a missing day, or with nothing to compare against", () => {
    const silent = { multiplier: 1, active: false, eventKey: null };
    expect(trendSignal(series(102, 100), "2026-10-15")).toEqual(silent);
    expect(trendSignal(series(120, 100, 3), "2026-10-15")).toEqual(silent);
    expect(trendSignal(series(120, 0), "2026-10-15")).toEqual(silent);
  });
  it("never reads the decision day or anything after it", () => {
    const withFuture = [...series(110, 100), { date: "2026-10-15", value: 9999 }, { date: "2026-10-16", value: 9999 }];
    expect(trendSignal(withFuture, "2026-10-15")).toEqual(trendSignal(series(110, 100), "2026-10-15"));
  });
});
