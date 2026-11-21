/**
 * Nav PR 5, group 11 (plan r4, 4 and 12): the heavy catering day is the DAY's total guests through one shared rule, and
 * one order's prep window is the schedule's own. The engine side (day start, morning deadline, the night-before line and
 * the urgency boundaries) is asserted on the heavy fixture. The "schedule and Dashboard call the same function" twin
 * lands with SCH.
 */
import { describe, expect, it } from "vitest";
import { buildDay, type DayModel } from "@/lib/day-plan-shared";
import { cateringDayLoad, cateringPrepWindowQ, isHeavyCateringDay } from "@/lib/scheduling/catering-day-shared";
import { cateringWindows } from "@/lib/scheduling/people-rules-shared";
import { SCHEDULE_STRUCTURE_DEFAULTS } from "@/lib/scheduling/structure-shared";
import { hm, PLAN_DATE } from "./fixtures/day-plan/build";
import { pStreet } from "./fixtures/day-plan/p-street";

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

const opening = (d: DayModel) => d.items.find((i) => i.id === "opening")!;

describe("the heavy day in the engine", () => {
  it("moves the day start 7:00 → 5:30 and the morning deadline 10:30 → 9:00", () => {
    const normal = buildDay(PLAN_DATE, hm("06:00"), pStreet(hm("06:00")));
    const heavy = buildDay(PLAN_DATE, hm("06:00"), pStreet(hm("06:00"), { heavy: true }));
    expect(normal.phase.id).toBe("before_opening");
    expect(opening(normal)).toMatchObject({ band: "upcoming", at: hm("07:00") });
    expect(heavy.phase).toMatchObject({ id: "opening_check", heavy: true });
    expect(opening(heavy)).toMatchObject({ band: "now", at: hm("09:00"), heavy: true });
    expect(heavy.heavy.today).toEqual({ heavy: true, guests: 145, orders: 2, missingCounts: 0 });
  });

  it("a heavy day with no timed order uses the default window and leaves the deadline", () => {
    const f = pStreet(hm("08:00"));
    const untimed = { ...f, cateringToday: { kind: "ok" as const, value: { forDate: PLAN_DATE, orders: [
      { id: "x", source: "ezcater" as const, eventQ: null, headcount: 60, state: "not_tracked" as const, outAt: null },
    ] } } };
    const d = buildDay(PLAN_DATE, hm("08:00"), untimed);
    expect(d.phase.heavy).toBe(true);
    expect(opening(d).at).toBe(hm("10:30"));
    expect(opening(d).reasons.map((r) => r.key)).toContain("day.reason.heavy.today_no_time");
  });

  it("the night-before heads-up shows from service start only", () => {
    const before = buildDay("2026-11-17", hm("10:29"), pStreet(hm("10:29"), { nightBefore: true }));
    const after = buildDay("2026-11-17", hm("10:30"), pStreet(hm("10:30"), { nightBefore: true }));
    expect(before.headsUp).toBeNull();
    expect(after.headsUp?.key).toBe("day.reason.heavy.tomorrow_other");
  });

  it.each([
    ["heavy", true, "08:29", "now"], ["heavy", true, "08:30", "urgent"], ["heavy", true, "09:00", "urgent"], ["heavy", true, "09:30", "urgent"],
    ["normal", false, "09:59", "now"], ["normal", false, "10:00", "urgent"],
  ])("%s day: Opening at %s… is %s", (_l, heavy, t, band) => {
    const min = hm(t as string);
    const f = pStreet(min, { heavy: heavy as boolean, timeline: { ...pStreetTimelineNoMorning() } });
    expect(opening(buildDay(PLAN_DATE, min, f)).band).toBe(band);
  });
});

/** The normal timeline with morning prep never submitted, so Opening stays open across the boundaries. */
function pStreetTimelineNoMorning() {
  return { checkIn: "07:35", morningPrep: null, vendorCLogged: "10:15", cateringOut: "11:40", vendorAOrdered: "13:55",
    midDayPrep: "14:50", closingFinished: "21:40", closingStarted: "13:00", stationClose: { crunchy: "13:40", third: "15:55", walk: "19:58", expo: "20:05" } };
}
