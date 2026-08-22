/**
 * Unit spine — the Dynamic Pars VELOCITY layer (plan Task 2.4).
 *
 * Momentum is a bounded, DIMENSIONLESS residual above trend — never a level term, because
 * recent Toast sales are already inside the trailing base window and a level double-counts
 * the very days it is meant to lead (r1-6, aggie). Two gates, both required (r2-10): time
 * (a run of same-signed residuals) AND volume (the SKU actually moves).
 *
 * The volume-floor cases use LIVE numbers from the plan's prod probe: Thyme 0.56 oz/day at a
 * 7.52 oz unit (0.075 u/d — fails) and Oregano 38.4 oz/day at a 96 oz unit (0.40 u/d — passes).
 */
import { describe, it, expect } from "vitest";
import {
  DYNAMIC_PARS,
  computeVelocityRatio,
  type VelocityDay,
  type VelocityInput,
} from "../lib/dynamic-pars-shared";

/** Weekday-only ET dates, oldest first — the run logic reads array order, not the calendar. */
const WEEKDAYS = [
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-17",
  "2026-08-18",
];

/** Build a weekday series from a list of daily oz, oldest first. */
function series(ozByDay: ReadonlyArray<number>, suspectIdx: ReadonlyArray<number> = []): VelocityDay[] {
  return ozByDay.map((oz, i) => ({
    dateEt: WEEKDAYS[i]!,
    dayClass: "weekday" as const,
    oz,
    suspect: suspectIdx.includes(i),
  }));
}

function input(over: Partial<VelocityInput> = {}): VelocityInput {
  return {
    series: series([100, 100, 100, 100, 100, 100, 100]),
    baseByDayClass: { weekday: 100, weekend: null },
    perOrderUnitOz: 100,
    recipeEditedAt: null,
    signalsStartAt: WEEKDAYS[0]!,
    ...over,
  };
}

describe("computeVelocityRatio — the persistence (time) gate", () => {
  it("returns a neutral, unapplied signal on a flat series", () => {
    const res = computeVelocityRatio(input());
    expect(res.ratio).toBe(1);
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("no_persistence");
    expect(res.persistedDays).toBe(0);
  });

  it("applies a +40% step sustained 3 days, CAPPED at 1 + VELOCITY_CAP", () => {
    const res = computeVelocityRatio(input({ series: series([100, 100, 100, 100, 140, 140, 140]) }));
    expect(res.applied).toBe(true);
    expect(res.ratio).toBeGreaterThan(1);
    expect(res.ratio).toBe(1 + DYNAMIC_PARS.VELOCITY_CAP);
    expect(res.ratio).toBe(1.25);
    expect(res.persistedDays).toBe(DYNAMIC_PARS.VELOCITY_MIN_PERSISTENCE_DAYS);
    expect(res.reason).toBeNull();
  });

  it("passes an UNCAPPED residual through untouched (+15% ⇒ 1.15)", () => {
    const res = computeVelocityRatio(input({ series: series([100, 100, 100, 100, 115, 115, 115]) }));
    expect(res.applied).toBe(true);
    expect(res.ratio).toBe(1.15);
  });

  it("bounds a downward run symmetrically (−30% ⇒ 0.75, the low cap)", () => {
    const res = computeVelocityRatio(input({ series: series([100, 100, 100, 100, 70, 70, 70]) }));
    expect(res.applied).toBe(true);
    expect(res.ratio).toBe(1 - DYNAMIC_PARS.VELOCITY_CAP);
    expect(res.ratio).toBe(0.75);
  });

  it("refuses a run that is not same-signed — two up days and one down day", () => {
    const res = computeVelocityRatio(input({ series: series([100, 100, 100, 100, 140, 60, 140]) }));
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("no_persistence");
    expect(res.ratio).toBe(1);
  });

  it("refuses a run inside the DEADBAND — a +5% drift is noise, not momentum", () => {
    const res = computeVelocityRatio(input({ series: series([100, 100, 100, 100, 105, 105, 105]) }));
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("no_persistence");
    expect(DYNAMIC_PARS.VELOCITY_DEADBAND).toBe(0.1);
  });

  it("requires the run to be the MOST RECENT days — an old spike that has decayed is not momentum", () => {
    const res = computeVelocityRatio(input({ series: series([140, 140, 140, 100, 100, 100, 100]) }));
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("no_persistence");
  });

  it("refuses a series shorter than the persistence requirement", () => {
    const res = computeVelocityRatio(input({ series: series([140, 140]) }));
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("no_persistence");
  });
});

describe("computeVelocityRatio — the volume gate (r2-10)", () => {
  it("REFUSES momentum below the volume floor — Thyme's live 0.56 oz/day at a 7.52 oz unit", () => {
    const res = computeVelocityRatio(
      input({
        series: series([0.4, 0.4, 0.4, 0.4, 0.56, 0.56, 0.56]),
        baseByDayClass: { weekday: 0.4, weekend: null },
        perOrderUnitOz: 7.52,
      }),
    );
    // 0.56 / 7.52 = 0.0745 u/d — it passes TIME and fails VOLUME, which is the intended verdict.
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("volume_floor");
    expect(res.ratio).toBe(1);
  });

  it("ALLOWS momentum above the floor — Oregano's live 38.4 oz/day at a 96 oz unit", () => {
    const res = computeVelocityRatio(
      input({
        series: series([24, 24, 24, 24, 38.4, 38.4, 38.4]),
        baseByDayClass: { weekday: 24, weekend: null },
        perOrderUnitOz: 96,
      }),
    );
    // 38.4 / 96 = 0.40 u/d — comfortably over the 0.10 floor.
    expect(res.applied).toBe(true);
    expect(res.ratio).toBe(1.25);
    expect(DYNAMIC_PARS.VELOCITY_MIN_UNITS_PER_DAY).toBe(0.1);
  });

  it("refuses when there is no order-unit denominator at all", () => {
    expect(computeVelocityRatio(input({ perOrderUnitOz: null })).reason).toBe("volume_floor");
    expect(computeVelocityRatio(input({ perOrderUnitOz: 0 })).reason).toBe("volume_floor");
    expect(computeVelocityRatio(input({ perOrderUnitOz: -5 })).reason).toBe("volume_floor");
  });
});

describe("computeVelocityRatio — the recipe-edit reset", () => {
  it("drops days at or before a recipe edit and refuses when too few remain", () => {
    const res = computeVelocityRatio(
      input({
        series: series([100, 100, 100, 100, 140, 140, 140]),
        recipeEditedAt: WEEKDAYS[5]!, // keeps only the last day
      }),
    );
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("recipe_edited");
  });

  it("keeps momentum when the edit is old enough to leave a full run", () => {
    const res = computeVelocityRatio(
      input({
        series: series([100, 100, 100, 100, 140, 140, 140]),
        recipeEditedAt: WEEKDAYS[3]!, // keeps the three 140 days
      }),
    );
    expect(res.applied).toBe(true);
    expect(res.ratio).toBe(1.25);
  });

  it("a recipe edit is EXCLUSIVE of its own day (days strictly after it survive)", () => {
    const res = computeVelocityRatio(
      input({
        series: series([100, 100, 100, 140, 140, 140, 140]),
        recipeEditedAt: WEEKDAYS[3]!, // that 140 day is dropped; three remain
      }),
    );
    expect(res.applied).toBe(true);
  });
});

describe("computeVelocityRatio — the catering-suspect exclusion (plan D4)", () => {
  it("a +200% single catering day does NOT produce momentum", () => {
    const res = computeVelocityRatio(
      input({ series: series([100, 100, 100, 100, 100, 100, 300], [6]) }),
    );
    expect(res.applied).toBe(false);
    expect(res.ratio).toBe(1);
  });

  it("dropping a suspect day can BREAK persistence, and that is the point", () => {
    // Without the flag these three rising days would be a run; the middle one is catering.
    const unflagged = computeVelocityRatio(
      input({ series: series([100, 100, 100, 100, 140, 140, 140]) }),
    );
    expect(unflagged.applied).toBe(true);

    const flagged = computeVelocityRatio(
      input({ series: series([100, 100, 100, 100, 140, 140, 140], [5]) }),
    );
    // The surviving last three are [100, 140, 140] ⇒ the run's first residual is 0.
    expect(flagged.applied).toBe(false);
    expect(flagged.reason).toBe("no_persistence");
  });

  it("leaves a genuine run intact when the suspect day sits outside it", () => {
    const res = computeVelocityRatio(
      input({ series: series([300, 100, 100, 100, 140, 140, 140], [0]) }),
    );
    expect(res.applied).toBe(true);
  });
});

describe("computeVelocityRatio — the signals clamp (plan D4)", () => {
  it("refuses outright when NO signal marker exists — nothing is vettable yet", () => {
    const res = computeVelocityRatio(input({ signalsStartAt: null }));
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("signals_too_new");
    expect(res.ratio).toBe(1);
  });

  it("EXCLUDES days before signalsStartAt, and still applies on what survives", () => {
    const res = computeVelocityRatio(
      input({
        // The pre-marker days are 400s: if the clamp leaked they would swamp the residuals.
        series: series([400, 400, 400, 400, 140, 140, 140]),
        signalsStartAt: WEEKDAYS[4]!,
      }),
    );
    expect(res.applied).toBe(true);
    expect(res.ratio).toBe(1.25);
  });

  it("starves the series when the marker is too new to leave a run", () => {
    const res = computeVelocityRatio(
      input({
        series: series([100, 100, 100, 100, 140, 140, 140]),
        signalsStartAt: WEEKDAYS[6]!, // one day survives
      }),
    );
    expect(res.applied).toBe(false);
    expect(res.ratio).toBe(1);
    // PHASE-2 FLAG F3: Task 2.4's bullet names `signals_too_new` for this case, but the task's
    // own code block reaches it only when signalsStartAt is NULL; a clamp that starves the
    // series falls through to the persistence verdict. Pinned as the code behaves, flagged
    // for the lead — the two candidate fixes are one line each.
    expect(res.reason).toBe("no_persistence");
  });
});

describe("computeVelocityRatio — dimensionality", () => {
  it("carries NO oz on its output — the signal is a multiplier, by construction", () => {
    const res = computeVelocityRatio(input({ series: series([100, 100, 100, 100, 140, 140, 140]) }));
    expect(Object.keys(res).sort()).toEqual(["applied", "persistedDays", "ratio", "reason"]);
    // A multiplier of 1 is the identity — an absent velocity term adds nothing to any sum.
    expect(computeVelocityRatio(input()).ratio).toBe(1);
  });

  it("refuses when the day-class base it would divide by is unknown", () => {
    const res = computeVelocityRatio(
      input({ series: series([140, 140, 140, 140]), baseByDayClass: { weekday: null, weekend: null } }),
    );
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("no_base");
  });

  it("refuses on a zero base rather than dividing by it", () => {
    const res = computeVelocityRatio(
      input({ series: series([140, 140, 140, 140]), baseByDayClass: { weekday: 0, weekend: null } }),
    );
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("no_base");
  });

  it("measures each day against its OWN day-class trend", () => {
    const mixed: VelocityDay[] = [
      { dateEt: "2026-08-24", dayClass: "weekday", oz: 100, suspect: false },
      { dateEt: "2026-08-25", dayClass: "weekday", oz: 140, suspect: false },
      { dateEt: "2026-08-28", dayClass: "weekend", oz: 280, suspect: false },
      { dateEt: "2026-08-29", dayClass: "weekend", oz: 280, suspect: false },
    ];
    // Weekend base is 200, so 280 is +40% — the same residual as the weekday 140 on base 100.
    const res = computeVelocityRatio(
      input({ series: mixed, baseByDayClass: { weekday: 100, weekend: 200 } }),
    );
    expect(res.applied).toBe(true);
    expect(res.ratio).toBe(1.25);
  });
});
