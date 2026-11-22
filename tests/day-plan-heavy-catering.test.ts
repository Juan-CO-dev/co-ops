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
import { checklist, hm, PLAN_DATE } from "./fixtures/day-plan/build";
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
  // PR SCH (rulings A4, F3): the day's start is the SCHEDULE's — a heavy day no longer moves it by itself.
  it("heavy with an accepted 5:30 opening: the day starts at 5:30 (the schedule's start) and the morning deadline is 9:00", () => {
    const heavy = buildDay(PLAN_DATE, hm("06:00"), pStreet(hm("06:00"), { heavy: true, opening: true }));
    expect(heavy.phase).toMatchObject({ id: "opening_check", heavy: true, since: { key: "day.phase.since.day_start", params: { time: { t: "wall", min: hm("05:30") } } } });
    expect(opening(heavy)).toMatchObject({ band: "now", at: hm("09:00"), heavy: true });
    expect(heavy.heavy.today).toEqual({ heavy: true, guests: 145, orders: 2, missingCounts: 0 });
  });

  it("heavy with no opening: the day starts at 7:00 (more people come in inside the normal morning); Opening upcoming at 6:00, urgent from 8:30", () => {
    const normal = buildDay(PLAN_DATE, hm("06:00"), pStreet(hm("06:00")));
    expect(normal.phase.id).toBe("before_opening");
    expect(opening(normal)).toMatchObject({ band: "upcoming", at: hm("07:00") });
    const at = (t: string) => buildDay(PLAN_DATE, hm(t), pStreet(hm(t), { heavy: true }));
    expect(at("06:00").phase.id).toBe("before_opening");
    expect(opening(at("06:00"))).toMatchObject({ band: "upcoming", at: hm("07:00"), heavy: true });
    expect(opening(at("06:00")).reasons.map((r) => r.key)).toContain("day.reason.heavy.today");
    expect(opening(at("06:00")).reasons.find((r) => r.key === "day.reason.heavy.today")!.params.start).toEqual({ t: "wall", min: hm("07:00") });
    expect(opening(at("08:29")).band).toBe("now");
    expect(opening(at("08:30"))).toMatchObject({ band: "urgent", at: hm("09:00") });
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

// ─── PR SCH (rulings D5, E2, E3, F4): the schedule's start is UNKNOWN ───────────────────────────────────────────────────

describe("an unknown start (a schedule holds the date but its start did not load)", () => {
  const UNKNOWN = { [PLAN_DATE]: { kind: "unknown" as const } };
  /** P Street at `t` with the start unknown; the day's Opening instance: none, open, or finished. */
  const day = (t: string, o: { heavy?: boolean; instance: "none" | "open" | "done" }) => {
    const min = hm(t);
    const f = pStreet(min, { heavy: o.heavy ?? false, dayStarts: UNKNOWN, timeline: pStreetTimelineNoMorning() });
    const status = o.instance === "none" ? null : o.instance === "open" ? "open" : "confirmed";
    return buildDay(PLAN_DATE, min, { ...f, opening: { kind: "ok", value: checklist(PLAN_DATE, { status, ...(o.instance === "done" ? { finishedAt: "2026-11-18T13:00:00.000Z" } : {}) }) } });
  };
  const notStart = (d: DayModel) => {
    expect(d.notes.map((n) => n.reason.key)).toContain("day.fail.day_start");
    // No phase or item ever uses the saved start (7:00) as the day start.
    expect(d.phase.since?.key).not.toBe("day.phase.since.day_start");
    expect(opening(d).at).not.toBe(hm("07:00"));
  };

  it("6:00 with no instance: before opening (no clock rise), Opening upcoming with no time, day.fail.day_start; an instance moves it to the opening check by EVENT", () => {
    const none = day("06:00", { instance: "none" });
    expect(none.phase).toMatchObject({ id: "before_opening" });
    expect(opening(none)).toMatchObject({ band: "upcoming", at: null });
    expect(opening(none).reasons[0]!.key).toBe("day.reason.opening.start");
    notStart(none);
    const later = day("07:30", { instance: "none" });
    expect(later.phase.id).toBe("before_opening");
    notStart(later);
    expect(day("07:30", { instance: "open" }).phase).toMatchObject({ id: "opening_check", decidedBy: "event", since: null });
  });

  it.each([
    // heavy day, first order 9:00 (deadline 9:00, the warning from 8:30)
    ["heavy", "08:29", "none", { band: "upcoming", at: null }],
    ["heavy", "08:29", "open", { band: "now", at: hm("09:00") }],
    ["heavy", "08:30", "none", { band: "urgent", at: hm("09:00"), first: "day.reason.opening.urgent_heavy" }],
    ["heavy", "08:30", "open", { band: "urgent", at: hm("09:00"), first: "day.reason.opening.urgent_heavy" }],
    ["heavy", "09:05", "none", { band: "urgent", at: hm("09:00"), first: "day.reason.opening.late_heavy" }],
    ["heavy", "09:05", "open", { band: "urgent", at: hm("09:00"), first: "day.reason.opening.late_heavy" }],
    // normal day (deadline = service start, 10:30)
    ["normal", "09:59", "none", { band: "upcoming", at: null }],
    ["normal", "09:59", "open", { band: "now", at: hm("10:30") }],
    ["normal", "10:00", "none", { band: "urgent", at: hm("10:30"), first: "day.reason.opening.urgent" }],
    ["normal", "10:00", "open", { band: "urgent", at: hm("10:30"), first: "day.reason.opening.urgent" }],
    ["normal", "10:35", "none", { band: "urgent", at: hm("10:30"), first: "day.reason.opening.late" }],
    ["normal", "10:35", "open", { band: "urgent", at: hm("10:30"), first: "day.reason.opening.late" }],
  ] as const)("%s day at %s, instance %s: the known deadline urgency wins; only the clock rise is gone", (kind, t, instance, want) => {
    const d = day(t, { heavy: kind === "heavy", instance });
    const o = opening(d);
    expect({ band: o.band, at: o.at }).toEqual({ band: want.band, at: want.at });
    if ("first" in want) expect(o.reasons[0]!.key).toBe(want.first);
    if (kind === "heavy") expect(o.reasons.map((r) => r.key)).toContain("day.reason.heavy.today_unknown_start");
    notStart(d);
  });

  it("completed: Opening finished is done at every one of those times", () => {
    for (const t of ["08:29", "08:30", "09:05", "09:59", "10:00", "10:35"]) {
      const d = day(t, { heavy: true, instance: "done" });
      expect(opening(d).band, t).toBe("done");
      expect(d.notes.map((n) => n.reason.key)).toContain("day.fail.day_start");
    }
  });

  it("tomorrow unknown: the night-before line has no start (the no-start key)", () => {
    const f = pStreet(hm("20:30"), { nightBefore: true, dayStarts: { "2026-11-18": { kind: "unknown" } } });
    const d = buildDay("2026-11-17", hm("20:30"), f);
    expect(d.headsUp).toEqual({ key: "day.reason.heavy.tomorrow_other_unknown_start", params: { orders: { t: "count", v: 2 }, guests: { t: "count", v: 145 } } });
    expect(d.notes.map((n) => n.reason.key)).not.toContain("day.fail.day_start");
  });
});
