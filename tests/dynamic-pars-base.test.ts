/**
 * Unit spine — the Dynamic Pars BASE RATE (plan Task 2.2).
 *
 * Day-class split · observed-day denominators · the `lane_start_at` longitudinal clamp ·
 * full-gap-day exclusion · thin thresholds · prep-mediation detection · product-grain
 * agnosticism. The double-count law is asserted directly: `flattenedOz` is read to DETECT a
 * dark lane and is never summed into a rate.
 *
 * The canonical window below (2026-08-01 → 2026-08-21) is the live probe's own window and
 * carries exactly 12 weekday + 9 weekend points — the figure r2-11 corrected from the
 * spec's stale "≈ 6 weekend points". One test pins it so the correction cannot regress.
 */
import { describe, it, expect } from "vitest";
import {
  DYNAMIC_PARS,
  computeBaseRate,
  dayClassForDate,
  type BaseRateInput,
  type WindowDay,
} from "../lib/dynamic-pars-shared";

/** N consecutive ET calendar days, oldest first. */
function daysFrom(startEt: string, n: number): string[] {
  const [y, m, d] = startEt.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(new Date(Date.UTC(y!, m! - 1, d!) + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** A window day, observed by the sales oracle unless the test says otherwise. */
function day(dateEt: string, opts: Partial<WindowDay> = {}): WindowDay {
  return {
    dateEt,
    dayClass: dayClassForDate(dateEt),
    salesObserved: true,
    productionObserved: false,
    ...opts,
  };
}

/** The live 21-day window: 2026-08-01 (Sat) … 2026-08-21 (Fri). */
const WINDOW_21 = daysFrom("2026-08-01", 21);

function input(over: Partial<BaseRateInput> = {}): BaseRateInput {
  return {
    window: WINDOW_21.map((d) => day(d)),
    directOzByDate: new Map(),
    productionOzByDate: new Map(),
    flattenedOzByDate: new Map(),
    laneStartAt: "2026-08-01",
    ...over,
  };
}

/** Same oz on every date in the list. */
function flat(dates: ReadonlyArray<string>, oz: number): Map<string, number> {
  return new Map(dates.map((d) => [d, oz]));
}

describe("computeBaseRate — the day-class split", () => {
  it("computes weekday and weekend rates SEPARATELY, never a blend", () => {
    const week = daysFrom("2026-08-24", 7); // Mon … Sun
    const weekdays = week.filter((d) => dayClassForDate(d) === "weekday"); // Mon-Thu
    const weekends = week.filter((d) => dayClassForDate(d) === "weekend"); // Fri-Sun
    const res = computeBaseRate(
      input({
        window: week.map((d) => day(d)),
        laneStartAt: "2026-08-24",
        directOzByDate: new Map([
          ...weekdays.map((d) => [d, 10] as const),
          ...weekends.map((d) => [d, 40] as const),
        ]),
      }),
    );
    expect(res.byDayClass.weekday.ozPerDay).toBe(10);
    expect(res.byDayClass.weekend.ozPerDay).toBe(40);
    // The blended answer would be (4×10 + 3×40) / 7 = 22.857… — it must appear nowhere.
    expect(res.byDayClass.weekday.ozPerDay).not.toBeCloseTo(22.857, 2);
    expect(res.byDayClass.weekend.ozPerDay).not.toBeCloseTo(22.857, 2);
  });

  it("yields weekend: null for a SKU with only weekday data — never a blended number", () => {
    const mondayToThursday = daysFrom("2026-08-24", 4);
    const res = computeBaseRate(
      input({
        window: mondayToThursday.map((d) => day(d)),
        laneStartAt: "2026-08-24",
        directOzByDate: flat(mondayToThursday, 10),
      }),
    );
    expect(res.byDayClass.weekday.ozPerDay).toBe(10);
    expect(res.byDayClass.weekend.ozPerDay).toBeNull();
    expect(res.byDayClass.weekend.observedDays).toBe(0);
  });

  it("splits the live 21-day window 12 weekday / 9 weekend (r2-11: nine, not six)", () => {
    const res = computeBaseRate(input({ directOzByDate: flat(WINDOW_21, 5) }));
    expect(res.byDayClass.weekday.observedDays).toBe(12);
    expect(res.byDayClass.weekend.observedDays).toBe(9);
    expect(DYNAMIC_PARS.BASE_WINDOW_DAYS).toBe(21);
  });

  it("uses the SHIPPED boundary — Friday is weekend", () => {
    expect(dayClassForDate("2026-08-27")).toBe("weekday"); // Thu
    expect(dayClassForDate("2026-08-28")).toBe("weekend"); // Fri
    expect(dayClassForDate("2026-08-29")).toBe("weekend"); // Sat
    expect(dayClassForDate("2026-08-30")).toBe("weekend"); // Sun
    expect(dayClassForDate("2026-08-24")).toBe("weekday"); // Mon
  });
});

describe("computeBaseRate — observed-day denominators", () => {
  it("divides by OBSERVED days, not window days (21 with 4 dark days ⇒ 17)", () => {
    const dark = new Set(["2026-08-03", "2026-08-10", "2026-08-08", "2026-08-15"]);
    const res = computeBaseRate(
      input({
        window: WINDOW_21.map((d) =>
          dark.has(d) ? day(d, { salesObserved: false, productionObserved: false }) : day(d),
        ),
        directOzByDate: flat(WINDOW_21, 10),
      }),
    );
    const seen = res.byDayClass.weekday.observedDays + res.byDayClass.weekend.observedDays;
    expect(seen).toBe(17);
    expect(res.byDayClass.weekday.observedDays).toBe(10); // 12 − 2 dark weekdays
    expect(res.byDayClass.weekend.observedDays).toBe(7); //  9 − 2 dark weekend days
    expect(res.byDayClass.weekday.gapDays).toBe(2);
    expect(res.byDayClass.weekend.gapDays).toBe(2);
    // The rate is the mean over OBSERVED days, so a dark day cannot drag it down.
    expect(res.byDayClass.weekday.ozPerDay).toBe(10);
    expect(res.byDayClass.weekend.ozPerDay).toBe(10);
  });

  it("counts a day the register RAN but this SKU did not move as a TRUE ZERO (plan D10)", () => {
    const dates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-10"];
    const res = computeBaseRate(
      input({
        window: [
          day(dates[0]!),
          day(dates[1]!),
          day(dates[2]!),
          day(dates[3]!), // register ran, no depletion row for this SKU ⇒ a measured zero
          day(dates[4]!, { salesObserved: false, productionObserved: false }), // full gap
        ],
        laneStartAt: "2026-08-03",
        directOzByDate: new Map([
          [dates[0]!, 12],
          [dates[1]!, 12],
          [dates[2]!, 12],
        ]),
      }),
    );
    // 36 oz over FOUR observed days (the true zero is in both numerator and denominator).
    expect(res.byDayClass.weekday.observedDays).toBe(4);
    expect(res.byDayClass.weekday.ozPerDay).toBe(9);
    // The full-gap day is EXCLUDED and counted separately — never nulled into the window.
    expect(res.byDayClass.weekday.gapDays).toBe(1);
  });

  it("EXCLUDES a full-gap day (no sales events AND no production) from the denominator", () => {
    const dates = daysFrom("2026-08-24", 4); // Mon-Thu
    const withGap = computeBaseRate(
      input({
        window: [
          day(dates[0]!),
          day(dates[1]!),
          day(dates[2]!, { salesObserved: false, productionObserved: false }),
          day(dates[3]!),
        ],
        laneStartAt: "2026-08-24",
        directOzByDate: new Map([
          [dates[0]!, 30],
          [dates[1]!, 30],
          [dates[3]!, 30],
        ]),
      }),
    );
    // 90 oz / 3 observed = 30. Counting the gap as a zero would give 22.5 — the 8.3% silent
    // down-bias the council measured.
    expect(withGap.byDayClass.weekday.ozPerDay).toBe(30);
    expect(withGap.byDayClass.weekday.observedDays).toBe(3);
    expect(withGap.byDayClass.weekday.gapDays).toBe(1);
  });

  it("treats a production-only day as observed even when the register did not run", () => {
    const dates = daysFrom("2026-08-24", 2);
    const res = computeBaseRate(
      input({
        window: [
          day(dates[0]!, { salesObserved: false, productionObserved: true }),
          day(dates[1]!),
        ],
        laneStartAt: "2026-08-24",
        productionOzByDate: new Map([[dates[0]!, 20]]),
        directOzByDate: new Map([[dates[1]!, 40]]),
      }),
    );
    expect(res.byDayClass.weekday.observedDays).toBe(2);
    expect(res.byDayClass.weekday.gapDays).toBe(0);
    expect(res.byDayClass.weekday.ozPerDay).toBe(30);
  });
});

describe("computeBaseRate — the lane_start_at clamp (r2-5)", () => {
  it("clamps LONGITUDINALLY: a lane 3 days old in a 21-day window has 3 observed days", () => {
    const res = computeBaseRate(
      input({
        laneStartAt: "2026-08-19", // Wed; window ends Fri 2026-08-21
        directOzByDate: flat(WINDOW_21, 10),
      }),
    );
    const seen = res.byDayClass.weekday.observedDays + res.byDayClass.weekend.observedDays;
    expect(seen).toBe(3);
    expect(res.byDayClass.weekday.observedDays).toBe(2); // Wed + Thu
    expect(res.byDayClass.weekend.observedDays).toBe(1); // Fri
    // The 18 pre-lane days are STRUCTURAL ZEROS, not measurements — and not gaps either.
    expect(res.byDayClass.weekday.gapDays).toBe(0);
    expect(res.byDayClass.weekend.gapDays).toBe(0);
    expect(res.byDayClass.weekday.ozPerDay).toBe(10);
  });

  it("a NULL lane_start_at is advisory-null — never a zero rate (r3)", () => {
    const res = computeBaseRate(input({ laneStartAt: null, directOzByDate: flat(WINDOW_21, 10) }));
    expect(res.laneNeverStarted).toBe(true);
    expect(res.byDayClass.weekday.ozPerDay).toBeNull();
    expect(res.byDayClass.weekend.ozPerDay).toBeNull();
    expect(res.byDayClass.weekday.ozPerDay).not.toBe(0);
    expect(res.laneComplete).toBe(false);
    expect(res.series).toEqual([]);
  });

  it("laneNeverStarted is false once a lane exists", () => {
    expect(computeBaseRate(input()).laneNeverStarted).toBe(false);
  });
});

describe("computeBaseRate — thin thresholds", () => {
  it("marks 5 weekday points thin and STILL returns the rate (the caller silences)", () => {
    const dates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-10"];
    const res = computeBaseRate(
      input({
        window: dates.map((d) => day(d)),
        laneStartAt: "2026-08-03",
        directOzByDate: flat(dates, 10),
      }),
    );
    expect(res.byDayClass.weekday.observedDays).toBe(5);
    expect(res.byDayClass.weekday.thin).toBe(true);
    expect(res.byDayClass.weekday.ozPerDay).toBe(10); // returned, not suppressed
    expect(DYNAMIC_PARS.MIN_OBSERVED_DAYS.weekday).toBe(8);
  });

  it("clears thin at the per-day-class threshold (weekday 8, weekend 6)", () => {
    const res = computeBaseRate(input({ directOzByDate: flat(WINDOW_21, 10) }));
    expect(res.byDayClass.weekday.thin).toBe(false); // 12 ≥ 8
    expect(res.byDayClass.weekend.thin).toBe(false); //  9 ≥ 6
    expect(DYNAMIC_PARS.MIN_OBSERVED_DAYS.weekend).toBe(6);
  });

  it("holds the weekend to its OWN threshold — 5 weekend points is thin", () => {
    const weekendDates = ["2026-08-01", "2026-08-02", "2026-08-07", "2026-08-08", "2026-08-09"];
    const res = computeBaseRate(
      input({
        window: weekendDates.map((d) => day(d)),
        directOzByDate: flat(weekendDates, 10),
      }),
    );
    expect(res.byDayClass.weekend.observedDays).toBe(5);
    expect(res.byDayClass.weekend.thin).toBe(true);
  });

  it("an empty day-class is thin with a null rate", () => {
    const res = computeBaseRate(input({ window: [], directOzByDate: new Map() }));
    expect(res.byDayClass.weekday).toEqual({
      ozPerDay: null,
      observedDays: 0,
      gapDays: 0,
      thin: true,
    });
  });
});

describe("computeBaseRate — prep-mediation and the DOUBLE-COUNT LAW", () => {
  it("reports laneComplete: false when flattened oz exists and production is dark", () => {
    const dates = daysFrom("2026-08-24", 4);
    const res = computeBaseRate(
      input({
        window: dates.map((d) => day(d)),
        laneStartAt: "2026-08-24",
        directOzByDate: flat(dates, 10),
        flattenedOzByDate: flat(dates, 50),
      }),
    );
    expect(res.laneComplete).toBe(false);
    // THE LAW: flattened_oz is read to DETECT the dark lane and is never summed.
    // direct-only = 10. A flattened sum would be 60; a both-lanes sum would be 60.
    expect(res.byDayClass.weekday.ozPerDay).toBe(10);
    expect(res.series.every((s) => s.oz === 10)).toBe(true);
  });

  it("reports laneComplete: true once the production lane actually produces oz", () => {
    const dates = daysFrom("2026-08-24", 4);
    const res = computeBaseRate(
      input({
        window: dates.map((d) => day(d, { productionObserved: true })),
        laneStartAt: "2026-08-24",
        directOzByDate: flat(dates, 10),
        productionOzByDate: flat(dates, 6),
        flattenedOzByDate: flat(dates, 50),
      }),
    );
    expect(res.laneComplete).toBe(true);
    expect(res.byDayClass.weekday.ozPerDay).toBe(16); // the TWO lanes: 10 direct + 6 production
  });

  it("reports laneComplete: true for a SKU that is not prep-mediated at all", () => {
    const dates = daysFrom("2026-08-24", 4);
    const res = computeBaseRate(
      input({
        window: dates.map((d) => day(d)),
        laneStartAt: "2026-08-24",
        directOzByDate: flat(dates, 10),
        flattenedOzByDate: new Map(),
      }),
    );
    expect(res.laneComplete).toBe(true);
  });
});

describe("computeBaseRate — product grain and the series", () => {
  it("is AGNOSTIC to grain: a twin's oz, rolled up by the caller, appears exactly once", () => {
    const dates = daysFrom("2026-08-24", 4);
    // r1-3: the caller rolls twins up to PRODUCT grain before calling, so a primary flip
    // cannot read as demand collapse. Boar's Head 6 oz + PFG 4 oz arrive as one 10.
    const rolledUp = flat(dates, 10);
    const res = computeBaseRate(
      input({ window: dates.map((d) => day(d)), laneStartAt: "2026-08-24", directOzByDate: rolledUp }),
    );
    expect(res.byDayClass.weekday.ozPerDay).toBe(10);
    expect(res.series.map((s) => s.oz)).toEqual([10, 10, 10, 10]);
  });

  it("returns the observed series oldest-first, with the day-class on every point", () => {
    const dates = daysFrom("2026-08-27", 3); // Thu, Fri, Sat
    const res = computeBaseRate(
      input({
        window: dates.map((d) => day(d)),
        laneStartAt: "2026-08-27",
        directOzByDate: new Map([
          [dates[0]!, 1],
          [dates[1]!, 2],
          [dates[2]!, 3],
        ]),
      }),
    );
    expect(res.series).toEqual([
      { dateEt: "2026-08-27", dayClass: "weekday", oz: 1 },
      { dateEt: "2026-08-28", dayClass: "weekend", oz: 2 },
      { dateEt: "2026-08-29", dayClass: "weekend", oz: 3 },
    ]);
  });

  it("omits clamped and gap days from the series", () => {
    const dates = daysFrom("2026-08-24", 4);
    const res = computeBaseRate(
      input({
        window: [
          day(dates[0]!),
          day(dates[1]!),
          day(dates[2]!, { salesObserved: false, productionObserved: false }),
          day(dates[3]!),
        ],
        laneStartAt: dates[1]!,
        directOzByDate: flat(dates, 7),
      }),
    );
    expect(res.series.map((s) => s.dateEt)).toEqual([dates[1]!, dates[3]!]);
  });
});
