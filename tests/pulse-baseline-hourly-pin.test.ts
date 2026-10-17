/**
 * Scheduling Phase 2, Task 4 Step 1 — THE PULSE BASELINE PIN, frozen BEFORE `baselineHourly` was
 * extracted from `baselineCumulative` (lib/pulse/baseline-shared.ts). The pulse's "normal day" must
 * stay byte-identical: null for a weekday with no cells, the captured-weekday denominator, the
 * per-hour rounding, an out-of-range hour ignored. Regenerate ONLY with a written reason in the PR.
 */
import { describe, expect, it } from "vitest";
import { baselineCumulative, baselineHourly, type HeatCell } from "@/lib/pulse/baseline-shared";

/** Two weekdays (Mon = 1, Thu = 4) × sparse / full cells, one weekday with NO cells (Sun = 7), an hour −1 cell. */
const FULL: HeatCell[] = Array.from({ length: 24 }, (_, h) => ({ dow: 1, hour: h, cents: h * 1003 + 7 }));
const SPARSE: HeatCell[] = [
  { dow: 4, hour: 11, cents: 40001 },
  { dow: 4, hour: 12, cents: 90003 },
  { dow: 4, hour: 12, cents: 5 },
  { dow: 4, hour: 18, cents: 12345 },
  { dow: 4, hour: -1, cents: 999 },
  { dow: 4, hour: 24, cents: 777 },
];
const HEAT: HeatCell[] = [...FULL, ...SPARSE];

/** Frozen 2026-10-16 on feat/scheduling-phase2 @ 9e9cfd2f, lib/pulse untouched. */
const FROZEN = "{\"1/0\":null,\"1/1\":[7,1017,3030,6046,10065,15087,21112,28140,36171,45205,55242,66282,78325,91371,105420,120472,136527,153585,171646,190710,210777,231847,253920,276996],\"1/2\":[4,509,1516,3024,5034,7545,10558,14072,18088,22605,27624,33144,39166,45689,52714,60240,68268,76797,85828,95360,105394,115929,126966,138504],\"1/3\":[2,339,1010,2015,3355,5029,7037,9380,12057,15068,18414,22094,26108,30457,35140,40157,45509,51195,57215,63570,70259,77282,84640,92332],\"1/4\":[2,255,758,1512,2517,3773,5279,7036,9044,11303,13812,16572,19583,22845,26357,30120,34134,38399,42914,47680,52697,57965,63483,69252],\"4/0\":null,\"4/1\":[0,0,0,0,0,0,0,0,0,0,0,40001,130009,130009,130009,130009,130009,130009,142354,142354,142354,142354,142354,142354],\"4/2\":[0,0,0,0,0,0,0,0,0,0,0,20001,65005,65005,65005,65005,65005,65005,71178,71178,71178,71178,71178,71178],\"4/3\":[0,0,0,0,0,0,0,0,0,0,0,13334,43337,43337,43337,43337,43337,43337,47452,47452,47452,47452,47452,47452],\"4/4\":[0,0,0,0,0,0,0,0,0,0,0,10000,32502,32502,32502,32502,32502,32502,35588,35588,35588,35588,35588,35588],\"7/0\":null,\"7/1\":null,\"7/2\":null,\"7/3\":null,\"7/4\":null}";

describe("baselineCumulative is byte-identical (the pulse's normal day)", () => {
  it("over 2 weekdays × weeks 0..4 × sparse / full, a weekday with no cells, and out-of-range hours", () => {
    const grid: Record<string, Array<number | null> | null> = {};
    for (const dow of [1, 4, 7]) for (let weeks = 0; weeks <= 4; weeks++) grid[`${dow}/${weeks}`] = baselineCumulative(HEAT, dow, weeks);
    expect(JSON.stringify(grid)).toBe(FROZEN);
  });
});

describe("baselineHourly: the non-cumulative first half, extracted", () => {
  it("is the per-hour average round(cell / weeks); null without cells or weeks; cumulating it IS baselineCumulative", () => {
    expect(baselineHourly(HEAT, 4, 2)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20001, 45004, 0, 0, 0, 0, 0, 6173, 0, 0, 0, 0, 0]);
    expect(baselineHourly(HEAT, 7, 3)).toBeNull();
    expect(baselineHourly(HEAT, 1, 0)).toBeNull();
    for (const dow of [1, 4]) for (let weeks = 1; weeks <= 4; weeks++) {
      let acc = 0;
      expect(baselineHourly(HEAT, dow, weeks)!.map((c) => (acc += c))).toEqual(baselineCumulative(HEAT, dow, weeks));
    }
  });
});
