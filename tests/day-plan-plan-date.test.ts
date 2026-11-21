/**
 * Nav PR 5, group 15 (plan r4, 8): one plan date. The station day is never recomputed: after midnight during a late close
 * PR 6 sends `stations: another_day`; the new day's phase then comes from the clock, nothing from yesterday is ordered
 * into today, and the late-close alert carries yesterday for KH+ and for anyone still holding a station on the station
 * day. Every day-keyed fact whose forDate is not the expected day is treated as could-not-load.
 */
import { describe, expect, it } from "vitest";
import { planDay, type DayPlan, type ShopFacts } from "@/lib/day-plan-shared";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import { ANA, checklist, forViewer, hm, item, LUIS, ok, PLAN_DATE, report } from "./fixtures/day-plan/build";
import { NO_EVENTS, P_STATION_BY_USER, pStreet, TIMELINE } from "./fixtures/day-plan/p-street";

const D = PLAN_DATE;
const D1 = addDaysEt(D, 1);
const run = (planDate: string, t: string, v: typeof ANA, f: ShopFacts) =>
  planDay({ planDate, nowMin: hm(t), viewer: v, facts: forViewer(f, P_STATION_BY_USER, v.userId) }) as DayPlan;

/** The early hours of D+1 while D's closing is still open (the station day is still D). */
function earlyNextDay(t: string, yesterdayStatus: "open" | "confirmed", stations: ShopFacts["stations"], holds = false): ShopFacts {
  const today = pStreet(hm(t), { planDate: D1, timeline: NO_EVENTS });
  return { ...today, stations, yesterdayClosing: ok(checklist(D, { status: yesterdayStatus })), holdsStationOnStationDay: holds };
}

describe("one plan date", () => {
  it("23:59 on D: still D's day (Night with every station closed by event)", () => {
    const p = run(D, "23:59", ANA, pStreet(hm("23:59"), { timeline: { ...TIMELINE, closingFinished: null } }));
    expect(p.planDate).toBe(D);
    expect(p.phase.id).toBe("night");
  });

  it("00:30 on D+1 with stations another_day(D): a clock phase, no station phase, nothing from D, the late-close alert", () => {
    const f = earlyNextDay("00:30", "open", { kind: "another_day", stationDate: D });
    const p = run(D1, "00:30", ANA, f);
    expect(p.phase).toMatchObject({ id: "before_opening", decidedBy: "clock" });
    expect(p.stations).toEqual([]);
    expect(p.notes).toEqual([]);
    expect(p.alerts).toEqual([{ kind: "late_close", date: D, shopCode: "P" }]);
    expect(JSON.stringify(p.items)).not.toContain(D); // nothing from D is ordered into D+1's list
    expect(item(p, "closing").reasons.map((r) => r.key)).toEqual(["day.reason.midday.waiting_first"]);
  });

  it("a crew closer still holding a station on the station day gets the alert too; other crew do not", () => {
    expect(run(D1, "00:30", LUIS, earlyNextDay("00:30", "open", { kind: "another_day", stationDate: D }, true)).alerts).toHaveLength(1);
    expect(run(D1, "00:30", LUIS, earlyNextDay("00:30", "open", { kind: "another_day", stationDate: D }, false)).alerts).toEqual([]);
  });

  it("00:30 with yesterday finished: stations for D+1, no alert", () => {
    const today = pStreet(hm("00:30"), { planDate: D1 });
    const p = run(D1, "00:30", ANA, { ...today, yesterdayClosing: ok(checklist(D, { status: "confirmed" })) });
    expect(p.alerts).toEqual([]);
    expect(p.stations.length).toBeGreaterThan(0);
  });

  it("01:00: the station day has moved on (stations for D+1 again)", () => {
    const today = pStreet(hm("01:00"), { planDate: D1 });
    const p = run(D1, "01:00", ANA, { ...today, yesterdayClosing: ok(checklist(D, { status: "open" })) });
    expect(p.stations.map((s) => s.close)).toEqual(p.stations.map(() => null));
    expect(p.alerts).toHaveLength(1);
  });

  it("every fact with a wrong forDate is treated as failed", () => {
    const base = pStreet(hm("13:45"));
    const wrong: ShopFacts = {
      ...base,
      opening: ok(checklist(D1)), closing: ok(checklist(D1)), amPrep: ok(checklist(D1)), cash: ok(report(D1)), pm: ok(report(D1)),
      midDay: ok({ forDate: D1, instances: [] }),
      ordering: base.ordering.kind === "ok" ? ok({ ...base.ordering.value, forDate: D1 }) : base.ordering,
      receiving: base.receiving.kind === "ok" ? ok({ ...base.receiving.value, forDate: D1 }) : base.receiving,
      cateringToday: base.cateringToday.kind === "ok" ? ok({ ...base.cateringToday.value, forDate: D1 }) : base.cateringToday,
      cateringTomorrow: base.cateringTomorrow.kind === "ok" ? ok({ ...base.cateringTomorrow.value, forDate: D }) : base.cateringTomorrow,
      assignments: base.assignments.kind === "ok" ? ok({ ...base.assignments.value, forDate: D1 }) : base.assignments,
      yesterdayClosing: ok(checklist(D, { status: "open" })),
    };
    const p = run(D, "13:45", ANA, wrong);
    for (const id of ["opening", "closing", "am_prep", "cash", "pm_report", "mid_day_prep", "ordering", "receiving", "catering_today"] as const) {
      expect(item(p, id).state, id).toBe("unknown");
    }
    expect(item(p, "ordering").holder).toEqual({ kind: "unknown" });
    expect(p.alerts).toEqual([]);
    const crew = run(D, "13:45", LUIS, wrong);
    expect(crew.notes.map((n) => n.reason.key)).toContain("day.fail.assignments");
  });
});
