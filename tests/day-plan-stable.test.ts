/**
 * Nav PR 5, group 10 (plan r4, 3, 13.4 and 12): the same input twice gives deep-equal output; the output is identical
 * under two different system times (no hidden clock read); sweeping the clock with NO new events, no item's band moves
 * backward along urgent > now > upcoming and the phase never moves backward (the clock fallback only moves forward). A
 * new real event may move Mid-day prep from urgent back to now (18.C item 1): the one allowed case. The tunables.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BAND_ORDER, buildDay, DAY_ORDER, EARLY_CUTOFF_GRACE_MIN, MIDDAY_WINDOW_MIN, PHASE_ORDER, planDay, SOON_MIN, URGENT_MIN,
  type Band, type ShopFacts,
} from "@/lib/day-plan-shared";
import { ALL_VIEWERS, forViewer, hm, ok, PLAN_DATE } from "./fixtures/day-plan/build";
import { capitolHill } from "./fixtures/day-plan/capitol-hill";
import { NO_EVENTS, P_STATION_BY_USER, pStreet } from "./fixtures/day-plan/p-street";
import { lateClose } from "./fixtures/day-plan/p-street-late-close";

afterEach(() => vi.useRealTimers());

describe("pure and stable", () => {
  it("the same input twice gives deep-equal output, for every viewer", () => {
    for (const t of ["07:00", "13:35", "20:30"]) {
      for (const v of Object.values(ALL_VIEWERS)) {
        const facts = forViewer(pStreet(hm(t)), P_STATION_BY_USER, v.userId);
        expect(planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts })).toEqual(planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts }));
      }
    }
  });

  it("the output is identical under two different system times (no hidden clock)", () => {
    const facts = forViewer(pStreet(hm("13:35")), P_STATION_BY_USER, ALL_VIEWERS.ROSA.userId);
    const run = () => JSON.stringify(planDay({ planDate: PLAN_DATE, nowMin: hm("13:35"), viewer: ALL_VIEWERS.GM, facts }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T08:00:00Z"));
    const a = run();
    vi.setSystemTime(new Date("2031-03-09T23:59:00Z"));
    const b = run();
    expect(a).toBe(b);
  });
});

describe("with no new events the clock only moves things forward", () => {
  const RANK: Record<Band, number> = { urgent: 0, now: 1, upcoming: 2, done: -1, tool: -1 };
  const NO_EVENT_FIXTURES: [string, (m: number) => ShopFacts][] = [
    ["P Street, no events", (m) => pStreet(m, { timeline: NO_EVENTS })],
    ["P Street heavy, no events", (m) => pStreet(m, { timeline: NO_EVENTS, heavy: true })],
    ["Capitol Hill, no events", (m) => capitolHill(m, { events: false })],
  ];
  it.each(NO_EVENT_FIXTURES)("%s: no band moves back along urgent > now > upcoming; the phase never moves back", (_l, facts) => {
    // Facts frozen at the first minute: the sweep moves the clock only.
    const frozen = facts(0);
    let lastPhase = -1;
    const last = new Map<string, number>();
    for (let m = 0; m < 1440; m++) {
      const d = buildDay(PLAN_DATE, m, frozen);
      const phase = PHASE_ORDER.indexOf(d.phase.id);
      expect(phase, `phase at ${m}`).toBeGreaterThanOrEqual(lastPhase);
      lastPhase = phase;
      for (const i of [...d.items, d.closing]) {
        const r = RANK[i.band];
        if (r < 0) continue;
        const prev = last.get(i.id);
        if (prev !== undefined) expect(r, `${i.id} at ${m}`).toBeLessThanOrEqual(prev);
        last.set(i.id, r);
      }
    }
  });

  it("the one allowed backward move: a late real event moves Mid-day prep from urgent back to now", () => {
    const mid = (m: number) => buildDay(PLAN_DATE, m, lateClose(m, { midDaySubmitted: false })).items.find((i) => i.id === "mid_day_prep")!;
    expect(mid(hm("16:00")).band).toBe("urgent"); // clock-closed at 14:00, late at 16:00
    expect(mid(hm("20:15")).band).toBe("now"); // the real close at 20:15 resets the window
    expect(mid(hm("20:15")).at).toBe(hm("22:15"));
    const event = { ...pStreet(hm("15:35"), { close: { crunchy: "15:35" } }), midDay: ok({ forDate: PLAN_DATE, instances: [] }) };
    const before = { ...pStreet(hm("15:34"), { close: { crunchy: "15:35" } }), midDay: ok({ forDate: PLAN_DATE, instances: [] }) };
    expect(buildDay(PLAN_DATE, hm("15:34"), before).items.find((i) => i.id === "mid_day_prep")!.band).toBe("urgent");
    expect(buildDay(PLAN_DATE, hm("15:35"), event).items.find((i) => i.id === "mid_day_prep")).toMatchObject({ band: "now", at: hm("17:35") });
  });
});

describe("the tunables and fixed orders (3)", () => {
  it("equal 120, 30, 120, 60", () => {
    expect([SOON_MIN, URGENT_MIN, MIDDAY_WINDOW_MIN, EARLY_CUTOFF_GRACE_MIN]).toEqual([120, 30, 120, 60]);
  });
  it("the band, phase and day orders", () => {
    expect(BAND_ORDER).toEqual(["urgent", "now", "upcoming", "done", "tool"]);
    expect(PHASE_ORDER).toEqual(["before_opening", "opening_check", "morning_prep", "service", "midday", "night", "closed"]);
    expect(DAY_ORDER).toEqual(["station", "opening", "mid_day_prep", "catering_today", "ordering", "receiving", "am_prep", "cash", "pm_report", "counts"]);
  });
});
