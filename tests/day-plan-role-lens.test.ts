/**
 * Nav PR 5, group 9 (plan r4, 6.1-6.3): the role lens. Crew never see a task assigned to someone else, nor a `taken` one
 * below level 4, nor any other person's name anywhere in the output. KH+ see every task with its holder (named / nobody).
 * Assign only with `ops`. And (r3, D4) the release-shaped board: after a `release(station_closed)` the viewer's station
 * card turns done, never disappears, because `resolveMyStation` falls back to `closedStationFor`.
 */
import { describe, expect, it } from "vitest";
import type { ShiftBoard, Station, StationEvent } from "@/lib/assignments-shared";
import { applyLens, buildDay, planDay, resolveMyStation, type DayPlan, type ShopFacts } from "@/lib/day-plan-shared";
import { ANA, assignment, forViewer, GM, hm, item, iso, LUIS, ok, PLAN_DATE, reasonText, ROSA, viewer } from "./fixtures/day-plan/build";
import { P_STATION_BY_USER, pStreet, STATION_IDS } from "./fixtures/day-plan/p-street";

const plan = (v: typeof ANA, t: string, facts: ShopFacts = pStreet(hm(t))): DayPlan =>
  planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts: forViewer(facts, P_STATION_BY_USER, v.userId) }) as DayPlan;
const withRows = (f: ShopFacts, rows: ReturnType<typeof assignment>[]): ShopFacts => ({ ...f, assignments: ok({ forDate: PLAN_DATE, scope: "all_tasks", rows }) });

describe("crew", () => {
  it("never see a task assigned to someone else, nor any other person's name anywhere", () => {
    for (const t of ["07:00", "13:35", "13:45", "20:30"]) {
      const p = plan(LUIS, t);
      expect(p.items.map((i) => i.id).sort()).toEqual(["closing", "mid_day_prep", "station"]);
      const text = JSON.stringify(p);
      for (const other of ["Ana", "Rosa"]) expect(text, `${t} ${other}`).not.toContain(other);
      expect(plan(ROSA, t).items.map((i) => i.id).sort()).toEqual(["closing", "station"]);
      expect(JSON.stringify(plan(ROSA, t))).not.toContain("Luis");
    }
  });

  it("a `taken` task is not theirs below level 4; at level 4 it is", () => {
    const rows = [assignment("t1", "am_prep", "u-luis", "Luis", { source: "taken" })];
    expect(plan(LUIS, "20:30", withRows(pStreet(hm("20:30")), rows)).items.map((i) => i.id)).not.toContain("am_prep");
    const kh = viewer("key_holder", "u-luis");
    expect(item(plan(kh, "20:30", withRows(pStreet(hm("20:30")), rows)), "am_prep")).toMatchObject({ mine: true, holder: { kind: "mine" } });
  });

  it("an unavailable assignment confers nothing; a trainee (level 2) never opens a level-3 task", () => {
    const unavailable = [assignment("u1", "mid_day_prep", "u-luis", "Luis", { available: false })];
    expect(plan(LUIS, "13:45", withRows(pStreet(hm("13:45")), unavailable)).items.map((i) => i.id)).not.toContain("mid_day_prep");
    const trainee = viewer("trainee", "u-luis");
    expect(plan(trainee, "13:45").items.map((i) => i.id)).not.toContain("mid_day_prep");
  });

  it("with nothing assigned and no station: day.empty.crew, from loaded facts only", () => {
    const nobody = viewer("employee", "u-new");
    const p = plan(nobody, "13:45", withRows(pStreet(hm("13:45")), []));
    expect(p.items.map((i) => i.id)).toEqual(["closing"]);
    expect(p.empty?.key).toBe("day.empty.crew");
  });
});

describe("KH+", () => {
  it("see every task with named / nobody; Do it only on their own; Assign only with ops", () => {
    const p = plan(GM, "13:45");
    expect(item(p, "opening").holder).toEqual({ kind: "named", firstName: "Ana" });
    expect(item(p, "opening").actions).toEqual([]);
    expect(item(p, "ordering")).toMatchObject({ holder: { kind: "nobody" }, actions: ["do", "assign"] });
    expect(item(plan(ANA, "13:45"), "cash")).toMatchObject({ mine: true, holder: { kind: "mine" }, actions: ["do"] });
    const noOps = viewer("gm", "u-gm", new Set(["tasks", "catering"] as const));
    const q = plan(noOps, "07:00");
    expect(q.items.map((i) => i.id).sort()).toEqual(["catering_today", "closing", "mid_day_prep", "opening", "am_prep"].sort());
    for (const i of q.items) expect(i.actions, i.id).not.toContain("assign");
  });

  it("the past-due line on the closing pin is KH+ only", () => {
    expect(item(plan(ANA, "13:35"), "closing").reasons.map(reasonText)).toContain("closing.past_due_one{names=Crunchy Boi Station}");
    expect(item(plan(LUIS, "13:35"), "closing").reasons.map((r) => r.key)).toEqual(["day.reason.closing.next"]);
  });
});

describe("the release-shaped board (r3, D4)", () => {
  const position = { id: "pos-crunchy", stationId: STATION_IDS.crunchy, name: "Crunchy Boi", nameEs: null, duty: null, dutyEs: null, sort: 1, active: true };
  const crunchy = (closedAt: string | null): Station => ({ id: STATION_IDS.crunchy, name: "Crunchy Boi Station", nameEs: null, sort: 1, active: true, staffed: true, positions: [position], closedAt });
  const ev = (sequence: string, p: Partial<StationEvent>): StationEvent => ({
    id: `e${sequence}`, sequence, locationId: "shop-p", businessDate: PLAN_DATE, userId: "u-rosa", stationId: STATION_IDS.crunchy,
    positionId: position.id, kind: "claim", actorId: "u-rosa", actorName: "Rosa", at: iso(PLAN_DATE, "09:00"), source: "claimed", ...p,
  });
  const claim = ev("1", {});
  const release = ev("2", { kind: "release", stationId: null, positionId: null, source: null, releaseReason: "station_closed", priorPositionId: position.id, at: iso(PLAN_DATE, "13:40") });
  const board = (events: StationEvent[], closedAt: string | null, shiftEndedAt: string | null = null): Pick<ShiftBoard, "events" | "stations" | "people"> => ({
    events, stations: [crunchy(closedAt)], people: [{ id: "u-rosa", name: "Rosa", level: 3, hasWork: true, shiftEndedAt }],
  });
  const rosaAt = (t: string, b: Pick<ShiftBoard, "events" | "stations" | "people">) => {
    const facts = { ...pStreet(hm(t)), myStation: ok(resolveMyStation(b, "u-rosa")) };
    return applyLens(buildDay(PLAN_DATE, hm(t), facts), ROSA, facts);
  };

  it("before the close: her station, the card now", () => {
    const b = board([claim], null);
    expect(resolveMyStation(b, "u-rosa")).toEqual({ stationId: STATION_IDS.crunchy });
    expect(item(rosaAt("13:35", b), "station").band).toBe("now");
  });

  it("after release(station_closed): the same station through closedStationFor, and the card is done, never absent", () => {
    const b = board([claim, release], iso(PLAN_DATE, "13:40"));
    expect(resolveMyStation(b, "u-rosa")).toEqual({ stationId: STATION_IDS.crunchy });
    const card = item(rosaAt("13:45", b), "station");
    expect(card.band).toBe("done");
    expect(card.reasons.map(reasonText)).toEqual(["station.closed{station=Crunchy Boi Station,time=13:40}"]);
  });

  it("control: after End my shift (newer than the release) closedStationFor returns null and the card goes, as today's board does", () => {
    const b = board([claim, release], iso(PLAN_DATE, "13:40"), iso(PLAN_DATE, "14:00"));
    expect(resolveMyStation(b, "u-rosa")).toBeNull();
    expect(rosaAt("14:05", b).items.map((i) => i.id)).toEqual(["closing"]);
  });
});
