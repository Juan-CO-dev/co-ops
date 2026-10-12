/**
 * Sales pace — the "normal day" baseline is the trailing same-weekday AVERAGE from captured Toast
 * data, and the chart states its basis (how many weekdays had data). Unknown is never zero.
 */
import { describe, expect, it } from "vitest";
import {
  baselineCumulative,
  baselineAtMinute,
  capturePaceAge,
  cumulativeByHour,
  dowOf,
  hourCurve,
  paceDeltaPct,
  sameWeekdayCoverage,
} from "@/lib/pulse/baseline-shared";

describe("capture cutoff", () => {
  it("prorates the cutoff hour only, excluding later sales and using zero minutes on the hour", () => {
    const baseline = baselineCumulative([{ dow: 5, hour: 10, cents: 2000 }, { dow: 5, hour: 11, cents: 12000 }, { dow: 5, hour: 12, cents: 99999 }], 5, 2);
    expect(baselineAtMinute(baseline, 11 * 60 + 37)).toBe(4700);
    expect(baselineAtMinute(baseline, 11 * 60)).toBe(1000);
    expect(baselineAtMinute(baseline, 12 * 60)).toBe(7000);
    expect(baselineAtMinute(null, 697)).toBeNull();
  });
  it("allows exactly 20 minutes but refuses stale, missing, invalid, and future captures", () => {
    const now = new Date("2026-10-11T16:05:00Z");
    expect(capturePaceAge("2026-10-11T15:45:00Z", now)).toEqual({ usable: true, staleMinutes: null });
    expect(capturePaceAge("2026-10-11T15:44:59Z", now)).toEqual({ usable: false, staleMinutes: 20 });
    expect(capturePaceAge("2026-10-11T15:37:00Z", now)).toEqual({ usable: false, staleMinutes: 28 });
    for (const at of [null, "bad", "2026-10-11T17:00:00Z"]) expect(capturePaceAge(at, now).usable).toBe(false);
  });
});

describe("hourCurve / cumulativeByHour", () => {
  it("buckets cents per hour 0..23 and accumulates up to the current hour, null after", () => {
    const curve = hourCurve([{ hour: 11, cents: 100 }, { hour: 12, cents: 250 }, { hour: 11, cents: 50 }]);
    expect(curve).toHaveLength(24);
    expect(curve[11]).toBe(150);
    expect(curve[12]).toBe(250);
    expect(curve[0]).toBe(0);
    const cum = cumulativeByHour(curve, 13);
    expect(cum[10]).toBe(0);
    expect(cum[11]).toBe(150);
    expect(cum[12]).toBe(400);
    expect(cum[13]).toBe(400);
    expect(cum[14]).toBeNull();
  });
  it("ignores rows with an out-of-range hour", () => {
    expect(hourCurve([{ hour: 24, cents: 5 }, { hour: -1, cents: 5 }])).toEqual(new Array(24).fill(0));
  });
});

describe("baselineCumulative", () => {
  it("averages the same weekday over the weeks that had data; no data → null curve", () => {
    const heat = [
      { dow: 2, hour: 11, cents: 200 }, { dow: 2, hour: 12, cents: 400 },
      { dow: 3, hour: 11, cents: 999 },
    ];
    expect(baselineCumulative(heat, 2, 2)).toEqual([...new Array(11).fill(0), 100, 300, ...new Array(11).fill(300)]);
    expect(baselineCumulative(heat, 2, 0)).toBeNull();
    expect(baselineCumulative([], 5, 3)).toBeNull();
  });
});

describe("paceDeltaPct", () => {
  it("today so far vs the baseline at the same hour, whole %; null when there is no basis", () => {
    const today = [...new Array(11).fill(0), 150, 400, 400, ...new Array(10).fill(null)];
    const base = [...new Array(11).fill(0), 100, 300, 500, ...new Array(10).fill(600)];
    expect(paceDeltaPct(today, base, 13)).toBe(-20);
    expect(paceDeltaPct(today, base, 12)).toBe(33);
    expect(paceDeltaPct(today, null, 13)).toBeNull();
    expect(paceDeltaPct(today, [...new Array(24).fill(0)], 13)).toBeNull();
  });
});

describe("dowOf / sameWeekdayCoverage", () => {
  it("ISO weekday from a Y-M-D (1 = Monday … 7 = Sunday, matching 0232's isodow), no timezone", () => {
    expect(dowOf("2026-10-09")).toBe(5); // Friday
    expect(dowOf("2026-10-11")).toBe(7); // Sunday
    expect(dowOf("2026-10-12")).toBe(1); // Monday
  });
  it("counts covered same-weekday buckets inside the trailing window", () => {
    const buckets = [
      { from: "2026-10-02", coveredDays: 1 }, { from: "2026-09-25", coveredDays: 1 }, { from: "2026-09-18", coveredDays: 0 },
      { from: "2026-10-01", coveredDays: 1 },
    ];
    expect(sameWeekdayCoverage(buckets, 5)).toBe(2);
  });
});
