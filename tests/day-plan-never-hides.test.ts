/**
 * Nav PR 5, group 2 (plan r4, 6.1 and 12): "never hides". For every fixture (P Street 11.1, Capitol Hill 11.2, the
 * live-data day 11.3) and every viewer, sweeping 5:00 AM to 11:55 PM every 5 minutes with the facts as they stand at that
 * minute, the SET of item ids equals an independently written expectation per (viewer, surfaces, assignments), and never
 * changes with the clock. Only the order and the states move.
 */
import { describe, expect, it } from "vitest";
import { applyLens, buildDay, planDay, type DayModel, type DayViewer, type ItemId, type ShopFacts } from "@/lib/day-plan-shared";
import { ALL_VIEWERS, forViewer, PLAN_DATE } from "./fixtures/day-plan/build";
import { capitolHill } from "./fixtures/day-plan/capitol-hill";
import { P_STATION_BY_USER, pStreet } from "./fixtures/day-plan/p-street";
import { lateClose } from "./fixtures/day-plan/p-street-late-close";

/** Everything a member of the shop at level 4+ may open, written out (not derived from the engine). */
const FULL: ItemId[] = ["opening", "mid_day_prep", "catering_today", "ordering", "receiving", "am_prep", "cash", "pm_report", "closing", "counts"];

/** Expected ids per viewer and fixture. The station card follows who holds a floor station (P Street: Luis Walk Ins, Rosa
 *  Crunchy Boi; Capitol Hill: nobody). Crew see only their own assigned tasks. */
function expected(name: keyof typeof ALL_VIEWERS, shop: "p" | "c"): ItemId[] {
  switch (name) {
    case "LUIS": return shop === "p" ? ["station", "closing", "mid_day_prep"] : ["closing"];
    case "ROSA": return shop === "p" ? ["station", "closing"] : ["closing"];
    case "CATERING_NON_MEMBER": return ["catering_today", "opening", "mid_day_prep", "am_prep", "closing"];
    default: return FULL;
  }
}

const FIXTURES: readonly { label: string; shop: "p" | "c"; facts: (min: number) => ShopFacts }[] = [
  { label: "P Street", shop: "p", facts: (m) => pStreet(m) },
  { label: "P Street heavy", shop: "p", facts: (m) => pStreet(m, { heavy: true }) },
  { label: "Capitol Hill", shop: "c", facts: (m) => capitolHill(m) },
  { label: "Capitol Hill, no events", shop: "c", facts: (m) => capitolHill(m, { events: false }) },
  { label: "live-data day", shop: "p", facts: (m) => lateClose(m) },
  { label: "live-data day, Closing Manager floor, no mid-day prep", shop: "p", facts: (m) => lateClose(m, { closingManagerFloor: true, midDaySubmitted: false }) },
];

/** planDay for a shop viewer is applyLens(buildDay(...)); the day is built once per minute and the lens applied per viewer. */
const ids = (day: DayModel, v: DayViewer, facts: ShopFacts, shop: "p" | "c") =>
  applyLens(day, v, forViewer(facts, shop === "p" ? P_STATION_BY_USER : {}, v.userId)).items.map((i) => i.id);

describe("never hides: the set of items depends on the viewer, not the clock", () => {
  it("planDay is the lens over the built day (so the sweep below may build the day once per minute)", () => {
    const facts = forViewer(pStreet(13 * 60 + 35), P_STATION_BY_USER, ALL_VIEWERS.ROSA.userId);
    expect(planDay({ planDate: PLAN_DATE, nowMin: 13 * 60 + 35, viewer: ALL_VIEWERS.ROSA, facts }))
      .toEqual(applyLens(buildDay(PLAN_DATE, 13 * 60 + 35, facts), ALL_VIEWERS.ROSA, facts));
  });

  for (const fx of FIXTURES) {
    it(`${fx.label}: every viewer, 5:00 AM to 11:55 PM every 5 minutes`, () => {
      for (let min = 5 * 60; min < 24 * 60; min += 5) {
        const facts = fx.facts(min);
        const day = buildDay(PLAN_DATE, min, facts);
        for (const [name, v] of Object.entries(ALL_VIEWERS) as [keyof typeof ALL_VIEWERS, DayViewer][]) {
          const want = [...expected(name, fx.shop)].sort();
          const got = ids(day, v, facts, fx.shop);
          expect(new Set(got).size, `${name} ${min} duplicates`).toBe(got.length);
          if (got.slice().sort().join() !== want.join()) expect(got.slice().sort(), `${fx.label} ${name} at ${min}`).toEqual(want);
        }
      }
    });
  }
});
