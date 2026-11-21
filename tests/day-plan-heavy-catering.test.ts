/**
 * Nav PR 5, group 11 (plan r4, 4 and 12): the heavy catering day is the DAY's total guests through one shared rule, and
 * one order's prep window is the schedule's own. (The engine side lands with buildDay. The "schedule and Dashboard call
 * the same function" twin lands with SCH.)
 */
import { describe, expect, it } from "vitest";
import { cateringDayLoad, cateringPrepWindowQ, isHeavyCateringDay } from "@/lib/scheduling/catering-day-shared";
import { cateringWindows } from "@/lib/scheduling/people-rules-shared";
import { SCHEDULE_STRUCTURE_DEFAULTS } from "@/lib/scheduling/structure-shared";

const S = { minHeadcount: 30 };
const n = (...counts: (number | null)[]) => counts.map((headcount) => ({ headcount }));

describe("the shared heavy-day function", () => {
  it.each([
    ["3 orders of 20 (60 ≥ 30)", n(20, 20, 20), S, { heavy: true, guests: 60, orders: 3, missingCounts: 0 }],
    ["1 order of 25", n(25), S, { heavy: false, guests: 25, orders: 1, missingCounts: 0 }],
    ["1 order of 120", n(120), S, { heavy: true, guests: 120, orders: 1, missingCounts: 0 }],
    ["two orders, one count missing (adds 0)", n(25, null), S, { heavy: false, guests: 25, orders: 2, missingCounts: 1 }],
    ["a missing count with enough guests", n(30, null), S, { heavy: true, guests: 30, orders: 2, missingCounts: 1 }],
    ["setting 0 with one order", n(null), { minHeadcount: 0 }, { heavy: true, guests: 0, orders: 1, missingCounts: 1 }],
    ["setting 0 with no order", n(), { minHeadcount: 0 }, { heavy: false, guests: 0, orders: 0, missingCounts: 0 }],
    ["no orders", n(), S, { heavy: false, guests: 0, orders: 0, missingCounts: 0 }],
  ])("%s", (_label, orders, setting, expected) => {
    expect(cateringDayLoad(orders, setting)).toEqual(expected);
    expect(isHeavyCateringDay(orders, setting)).toBe(expected.heavy);
  });

  it("cateringPrepWindowQ equals the schedule's cateringWindows for timed, untimed and early orders", () => {
    const catering = { ...SCHEDULE_STRUCTURE_DEFAULTS.catering };
    const events = [
      { id: "a", headcount: 25, eventQ: 48 }, { id: "b", headcount: 120, eventQ: 36 }, { id: "c", headcount: 10, eventQ: null },
      { id: "d", headcount: 5, eventQ: 10 }, { id: "e", headcount: 5, eventQ: 0 }, { id: "f", headcount: 5, eventQ: 95 },
    ];
    for (const c of [catering, { ...catering, leadMinutes: 90, defaultStartQ: 30, defaultEndQ: 40 }]) {
      const day = { structure: { catering: c }, inputs: { cateringEvents: events } } as unknown as Parameters<typeof cateringWindows>[0];
      const sorted = [...events].sort((x, y) => (x.id < y.id ? -1 : 1));
      expect(sorted.map((e) => [...cateringPrepWindowQ(e.eventQ, c)])).toEqual(cateringWindows(day));
    }
    expect(cateringPrepWindowQ(36, catering)).toEqual([22, 36]); // 9:00 order → prep from 5:30
    expect(cateringPrepWindowQ(5, catering)).toEqual([0, 5]); // floored at 0
    expect(cateringPrepWindowQ(null, catering)).toEqual([34, 52]); // the default window
  });
});

