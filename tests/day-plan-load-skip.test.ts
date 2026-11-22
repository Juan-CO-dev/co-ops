/**
 * Nav PR 6 (plan r3, section 6 and 8.7; ruling 2): a fact the viewer may not see is sent as `{ kind: "failed" }` and never
 * read. Proof that this is invisible: for every viewer at the six worked-example times, planDay with all facts deep-equals
 * planDay with the skipped facts failed, and the viewer gets no "could not load" note (no day.fail.* key) and no listed
 * item in state unknown for them. For the crew viewer the skipped reads are never called.
 */
import { describe, expect, it, vi } from "vitest";
import { loadDayFacts, type DayFactDeps } from "@/lib/day-plan";
import { factsNeeded } from "@/lib/day-plan-load-shared";
import { planDay, type DayPlan } from "@/lib/day-plan-shared";
import { ALL_VIEWERS, forViewer, hm, LUIS, PLAN_DATE, viewer, withFailed } from "./fixtures/day-plan/build";
import { args, NO_CLIENT, okDeps } from "./fixtures/day-plan/loader-deps";
import { P_STATION_BY_USER, pStreet } from "./fixtures/day-plan/p-street";

const TIMES = ["07:00", "11:30", "13:35", "13:45", "15:45", "20:30"];

describe("skipped facts are invisible", () => {
  for (const [name, v] of Object.entries(ALL_VIEWERS)) {
    it(`${name}: all facts ≡ the skipped ones failed, and no could-not-load note or unknown item from a skip`, () => {
      const skipped = factsNeeded(v).skipped;
      for (const t of TIMES) {
        const facts = forViewer(pStreet(hm(t)), P_STATION_BY_USER, v.userId);
        const all = planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts }) as DayPlan;
        const spared = planDay({ planDate: PLAN_DATE, nowMin: hm(t), viewer: v, facts: withFailed(facts, skipped) }) as DayPlan;
        expect(spared, `${name} ${t}`).toEqual(all);
        expect(spared.notes.filter((n) => n.reason.key.startsWith("day.fail.")), `${name} ${t}`).toEqual([]);
        expect(spared.items.filter((i) => i.state === "unknown").map((i) => i.id), `${name} ${t}`).toEqual([]);
      }
    });
  }

  it("the skips are real: crew skip the five ops facts; a viewer without catering skips the flagged lines; key holders skip nothing", () => {
    expect(factsNeeded(LUIS).skipped).toEqual(["cash", "pm", "ordering", "rhythm", "receiving"]);
    expect(factsNeeded(ALL_VIEWERS.ANA).skipped).toEqual([]);
    expect(factsNeeded(viewer("gm", "u-x", new Set(["tasks", "ops"]))).skipped).toEqual(["flaggedLines"]);
  });
});

describe("skipped reads are never made", () => {
  it("crew: no cash, PM, vendors, cutoffs, POs, rhythm or receiving read; the facts are sent failed", async () => {
    const skippedDeps = ["cashReport", "pmReport", "vendors", "cutoffs", "recentPos", "rhythm", "halfLogged", "openOrders", "completedOn"] as const;
    const spies = Object.fromEntries(skippedDeps.map((k) => [k, vi.fn(okDeps()[k])]));
    const input = await loadDayFacts(NO_CLIENT, args(LUIS), { ...okDeps(), ...spies } as DayFactDeps);
    for (const [k, spy] of Object.entries(spies)) expect(spy, k).not.toHaveBeenCalled();
    const f = input.facts.kind === "shop" ? input.facts : null;
    for (const k of ["cash", "pm", "ordering", "rhythm", "receiving"] as const) expect(f![k], k).toEqual({ kind: "failed" });
    expect(f!.closing.kind).toBe("ok");
  });

  it("no catering surface: the Prep demand read is never made", async () => {
    const flagged = vi.fn(okDeps().flaggedLines);
    const input = await loadDayFacts(NO_CLIENT, args(viewer("gm", "u-x", new Set(["tasks", "ops"]))), { ...okDeps(), flaggedLines: flagged });
    expect(flagged).not.toHaveBeenCalled();
    expect(input.facts.kind === "shop" && input.facts.flaggedLines).toEqual({ kind: "failed" });
  });

  it("the tasks-only viewer (no ops): stations and assignments not_shown, my station ok(null), the board never called", async () => {
    const board = vi.fn(async () => { throw new Error("board"); });
    const flags = vi.fn(okDeps().stationFlags);
    const input = await loadDayFacts(NO_CLIENT, args(ALL_VIEWERS.CATERING_NON_MEMBER, { board }), { ...okDeps(), stationFlags: flags });
    const f = input.facts.kind === "shop" ? input.facts : null;
    expect([f!.stations, f!.assignments, f!.myStation, f!.holdsStationOnStationDay]).toEqual([{ kind: "not_shown" }, { kind: "not_shown" }, { kind: "ok", value: null }, false]);
    expect(board).not.toHaveBeenCalled();
    expect(flags).not.toHaveBeenCalled();
    const plan = planDay(input) as DayPlan;
    expect(plan.notes.map((n) => n.reason.key)).toContain("day.note.stations_not_shown");
  });
});
