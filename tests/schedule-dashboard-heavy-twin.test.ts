/**
 * PR SCH (plan r5, 12.7; r1 8.7; rulings A4, D5): THE TWIN — the schedule and the Dashboard read ONE rule. For r1's 8.1
 * table and 200 generated order sets (a seeded LCG), the two views agree on:
 *  (a) the heavy verdict: the Dashboard's heavy day = `isHeavyCateringDay` = the schedule's sites A (the stations per-day
 *      limit rise) and C (the crew catering shift's extra heads);
 *  (b) every order's window: the schedule's `cateringWindows` = `cateringPrepWindowQ` over the Dashboard's own orders;
 *  (c) THE START: for every opening status (none / proposed / declined / accepted / manual / auto) the schedule's built
 *      `DayContext` gives `scheduledDayStartQ(day, saved)`, and fed to `buildDay` as the loader would
 *      (`{ kind: "scheduled", q }`), the Dashboard's day start is exactly the schedule's — never earlier.
 * (d) The unknown start and the loader cases (settings drift, inherited origins, a failed context read) are on the real
 *     loader in tests/day-plan-load.test.ts (22.3, 23.2) and the engine table in tests/day-plan-heavy-catering.test.ts (22.4).
 */
import { describe, expect, it } from "vitest";
import { buildDay, type CateringOrder, type ShopFacts } from "@/lib/day-plan-shared";
import { cateringPrepWindowQ, isHeavyCateringDay } from "@/lib/scheduling/catering-day-shared";
import type { DayContext } from "@/lib/scheduling/context-shared";
import { crewRequired } from "@/lib/scheduling/crew-gap-verifier-shared";
import { buildDayNeed } from "@/lib/scheduling/need-shared";
import { resolveOpening, scheduledDayStartQ, structureForDay, type OpeningDecision, type OpeningStatus } from "@/lib/scheduling/opening-shared";
import { cateringWindows } from "@/lib/scheduling/people-rules-shared";
import { scheduledOut, type ScheduleStructure, type ShiftType } from "@/lib/scheduling/structure-shared";
import { ok, PLAN_DATE } from "./fixtures/day-plan/build";
import { pStreet } from "./fixtures/day-plan/p-street";
import { I, structure } from "./fixtures/schedule/fixtures";

type Raw = { headcount: number | null; eventQ: number | null };
const TABLE: Array<{ name: string; orders: Raw[]; min: number }> = [
  { name: "3 × 20", orders: [{ headcount: 20, eventQ: 36 }, { headcount: 20, eventQ: 44 }, { headcount: 20, eventQ: 50 }], min: 30 },
  { name: "1 × 25", orders: [{ headcount: 25, eventQ: 48 }], min: 30 },
  { name: "1 × 120", orders: [{ headcount: 120, eventQ: 36 }], min: 30 },
  { name: "20 + no count + 15", orders: [{ headcount: 20, eventQ: 40 }, { headcount: null, eventQ: 38 }, { headcount: 15, eventQ: null }], min: 30 },
  { name: "setting 0, one order", orders: [{ headcount: 5, eventQ: 52 }], min: 0 },
  { name: "setting 0, no order", orders: [], min: 0 },
];
function generated(n: number): Array<{ name: string; orders: Raw[]; min: number }> {
  let seed = 20261121;
  const rnd = (k: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  return Array.from({ length: n }, (_, i) => ({
    name: `generated #${i}`, min: [0, 30, 60][rnd(3)]!,
    orders: Array.from({ length: rnd(5) }, () => ({ headcount: rnd(6) === 0 ? null : rnd(90), eventQ: rnd(5) === 0 ? null : 24 + rnd(57) })),
  }));
}
const CASES = [...TABLE, ...generated(200)];

const TYPE: ShiftType = { id: "opener", name: "Opener", fromQ: 28, toQ: 60, startFlexQ: 0, minLengthQ: 16, headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: [I.$PREP], countsTowardMod: true };
const shop = (min: number, engine: "stations" | "crew" = "stations"): ScheduleStructure => structure((s) => {
  s.catering.minHeadcount = min;
  if (engine === "crew") { s.engine = "crew"; s.shiftTypes = [TYPE]; s.catering.crewShift = { enabled: true, typeId: "opener", extraHeads: 1 }; }
});
/** The schedule's events (a missing count becomes 0, as the loader's conversion does). */
const events = (orders: Raw[]) => orders.map((o, i) => ({ id: `o-${i}`, headcount: o.headcount ?? 0, eventQ: o.eventQ }));
/** The Dashboard's facts for the same orders (a missing count stays null), with the loader's per-date start. */
function dashboard(orders: Raw[], s: ScheduleStructure, start?: number): ShopFacts {
  const base = pStreet(0);
  if (base.hours.kind !== "ok") throw new Error("hours");
  const dash: CateringOrder[] = orders.map((o, i) => ({ id: `o-${i}`, source: "pipeline", eventQ: o.eventQ, headcount: o.headcount, state: "to_go_out", outAt: null }));
  return { ...base, cateringToday: ok({ forDate: PLAN_DATE, orders: dash }),
    hours: ok({ ...base.hours.value, shopDay: { prepStartQ: s.shopDay.prepStartQ, serviceStartQ: s.shopDay.serviceStartQ }, catering: { ...base.hours.value.catering, minHeadcount: s.catering.minHeadcount },
      dayPrepStartQ: start === undefined ? {} : { [PLAN_DATE]: { kind: "scheduled", q: start } } }) };
}
/** The schedule's built DayContext for a date, at a given opening status. */
function scheduleDay(s: ScheduleStructure, orders: Raw[], status: OpeningStatus | "none"): DayContext {
  const ev = events(orders);
  const persistent: Record<string, OpeningDecision> = { accepted: { kind: "accepted", startQ: 22 }, manual: { kind: "manual", startQ: 23 }, declined: { kind: "declined" } };
  const n = buildDayNeed({ structure: s, dayType: "normal", scheduledOutQ: scheduledOut(s, 45), hourlyCents: null, demandKind: "no_history", catering: ev,
    ...(persistent[status] ? { decision: persistent[status] } : {}) });
  let { structure: ds, opening } = n;
  if (status === "proposed" || status === "auto") {
    // SCH-1 pins the mode to manual; the semi / auto openings are resolved with the mode given explicitly (SCH-2's path).
    opening = resolveOpening(s, ev, null, status === "auto" ? "auto" : "semi");
    ds = structureForDay(s, ev, opening).structure;
  }
  return { structureVersionId: "sv", structure: ds, dayType: "normal", closingMinutes: 45, scheduledOutQ: scheduledOut(s, 45), need: n.need,
    inputs: { demandKind: "no_history", hourlyCents: null, dayCents: null, dayTypeSource: "no_history", overrideId: null, cateringEvents: ev },
    ...(opening ? { opening } : {}) };
}
const dashboardStart = (f: ShopFacts) => buildDay(PLAN_DATE, 0, f).items.find((i) => i.id === "opening")!.at;

describe("the twin: one rule, two views", () => {
  it(`(a) the same heavy verdict on ${CASES.length} order sets: the Dashboard = isHeavyCateringDay = site A (stations limit rise) = site C (crew extra heads)`, () => {
    for (const c of CASES) {
      const s = shop(c.min);
      const heavy = isHeavyCateringDay(c.orders, s.catering);
      expect(buildDay(PLAN_DATE, 0, dashboard(c.orders, s)).heavy.today?.heavy ?? false, c.name).toBe(heavy);
      expect(isHeavyCateringDay(events(c.orders), s.catering), c.name).toBe(heavy);
      expect(structureForDay(s, events(c.orders), null).base !== null, `${c.name} site A`).toBe(heavy);
      const crew = scheduleDay(shop(c.min, "crew"), c.orders, "none");
      expect(crewRequired(TYPE, crew) - 1, `${c.name} site C`).toBe(heavy ? 1 : 0);
    }
  });

  it("(b) the same per-order windows: the schedule's cateringWindows = cateringPrepWindowQ over the Dashboard's orders", () => {
    for (const c of CASES) {
      const s = shop(c.min);
      const sorted = c.orders.map((o, i) => ({ ...o, id: `o-${i}` })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      expect(cateringWindows(scheduleDay(s, c.orders, "none")), c.name).toEqual(sorted.map((o) => [...cateringPrepWindowQ(o.eventQ, s.catering)]));
    }
  });

  it("(c) the start agrees for every opening status: the Dashboard's day start IS the schedule's (never earlier)", () => {
    const statuses = ["none", "proposed", "declined", "accepted", "manual", "auto"] as const;
    for (const c of [...TABLE, ...generated(60)]) {
      for (const engine of ["stations", "crew"] as const) {
        const s = shop(c.min, engine);
        for (const status of statuses) {
          const day = scheduleDay(s, c.orders, status);
          const q = scheduledDayStartQ(day, s);
          const label = `${c.name} ${engine} ${status}`;
          expect(dashboardStart(dashboard(c.orders, s, q)), label).toBe(q * 15);
          // An applied opening is the only thing that moves it, and never later than the usual start.
          if (status === "accepted" || status === "manual") expect(q, label).toBeLessThan(s.shopDay.prepStartQ);
          if (status === "none" || status === "proposed" || status === "declined") expect(q, label).toBe(s.shopDay.prepStartQ);
          if (status === "auto") expect(q, label).toBe(day.opening ? day.opening.startQ : s.shopDay.prepStartQ);
        }
      }
    }
  });

  it("the Dashboard no longer moves the start on a heavy day by itself: with no schedule it is the saved start, 120 guests at 9:00 or not", () => {
    const s = shop(30);
    expect(dashboardStart(dashboard([{ headcount: 120, eventQ: 36 }], s))).toBe(28 * 15);
    expect(dashboardStart(dashboard([], s))).toBe(28 * 15);
  });
});
