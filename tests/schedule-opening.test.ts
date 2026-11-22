/**
 * PR SCH (plan r5, 12.2; rulings C4–C6, D4, D8): the earlier opening, resolved per date — the triggers, the mode × decision
 * matrix, the per-day structure (never mutating, the same object on an ordinary day, round-tripping to the shop's own),
 * the two kinds of head limit, and the request shapes.
 */
import { describe, expect, it } from "vitest";
import {
  EARLY_OPEN_FIT_MIN, EARLY_OPEN_HUGE_FACTOR, RUNTIME_HEADS_MAX, assertRuntimeLimits, baseStructureOf, earlyOpenModeOf, isOpeningDecisionInput,
  openingApplies, openingTriggers, resolveOpening, scheduledDayStartQ, structureForDay, toDecision, type EarlyOpenMode, type OpeningDecision,
} from "@/lib/scheduling/opening-shared";
import { validScheduleStructure, type ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { I, structure } from "./fixtures/schedule/fixtures";

const ev = (headcount: number | null, eventQ: number | null, id = `e-${headcount}-${eventQ}`) => ({ id, headcount, eventQ });
const S = () => structure();
const crew = () => structure((s) => { s.engine = "crew"; s.shiftTypes = []; });

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

describe("the constants (rulings C5)", () => {
  it("are named and pinned: 60 minutes, 2×, 16 heads", () => {
    expect([EARLY_OPEN_FIT_MIN, EARLY_OPEN_HUGE_FACTOR, RUNTIME_HEADS_MAX]).toEqual([60, 2, 16]);
  });
  it("absent, the mode is manual (SCH-2: schedule-sch2-modes.test.ts reads each stored mode)", () => {
    expect(earlyOpenModeOf(S())).toBe("manual");
    expect(resolveOpening(S(), [ev(120, 36)], null)).toBeNull();
  });
});

describe("the triggers (heavy days only, ruling C4)", () => {
  it("T1: an order at 9:15 fires (window 5:45, more than 60 min before 7:00); 9:30 does not (exactly 60 min)", () => {
    expect(openingTriggers(S(), [ev(40, 37)])).toEqual({ triggers: ["prep_fit"], candidateQ: 23 });
    expect(openingTriggers(S(), [ev(40, 38)])).toEqual({ triggers: [], candidateQ: 24 });
  });
  it("T2: 2× the threshold with an order at 10:15 fires; at 10:30, or one guest short, it does not", () => {
    expect(openingTriggers(S(), [ev(60, 41)]).triggers).toEqual(["huge_day"]);
    expect(openingTriggers(S(), [ev(60, 42)]).triggers).toEqual([]);
    expect(openingTriggers(S(), [ev(59, 41)]).triggers).toEqual([]);
    expect(openingTriggers(S(), [ev(30, 41), ev(30, 60)]).triggers).toEqual(["huge_day"]);
  });
  it("with minHeadcount 0, one order at 8:00 fires (both: its window starts 4:30, and 0 ≥ 2 × 0)", () => {
    const s = structure((x) => { x.catering.minHeadcount = 0; });
    expect(openingTriggers(s, [ev(5, 32)]).triggers).toEqual(["prep_fit", "huge_day"]);
  });
  it("neither fires on a day that is not heavy, however early its order", () => {
    expect(openingTriggers(S(), [ev(25, 32)])).toEqual({ triggers: [], candidateQ: 18 });
    expect(openingTriggers(S(), [])).toEqual({ triggers: [], candidateQ: 28 });
  });
  it("an untimed order uses the default window; a missing count adds 0 but its window still counts", () => {
    expect(openingTriggers(S(), [ev(40, null)])).toEqual({ triggers: [], candidateQ: 28 }); // default window 8:30, after the 7:00 start
    expect(openingTriggers(S(), [ev(null, 32), ev(30, 48)])).toEqual({ triggers: ["prep_fit"], candidateQ: 18 });
  });
});

describe("resolveOpening: the mode × decision matrix", () => {
  const heavyEarly = [ev(120, 36)]; // window 5:30, T1 fires
  const at = (mode: EarlyOpenMode, d: OpeningDecision | null, orders = heavyEarly) => resolveOpening(S(), orders, d, mode);
  it("manual never proposes; semi proposes and leaves the structure alone; auto applies", () => {
    expect(at("manual", null)).toBeNull();
    const semi = at("semi", null)!;
    expect(semi).toEqual({ status: "proposed", startQ: 22, normalStartQ: 28, triggers: ["prep_fit", "huge_day"], guests: 120, orders: 1 });
    expect(structureForDay(S(), heavyEarly, semi).structure.shopDay.prepStartQ).toBe(28);
    expect(at("auto", null)).toMatchObject({ status: "auto", startQ: 22 });
  });
  it("declined silences semi and auto", () => {
    for (const mode of ["semi", "auto"] as const) expect(at(mode, { kind: "declined" })).toMatchObject({ status: "declined", startQ: 28 });
  });
  it("accepted keeps its STORED start after the orders change (C6)", () => {
    expect(at("manual", { kind: "accepted", startQ: 22 }, [ev(120, 40)])).toMatchObject({ status: "accepted", startQ: 22 });
    expect(at("manual", { kind: "accepted", startQ: 22 }, [])).toMatchObject({ status: "accepted", startQ: 22, triggers: [] });
  });
  it("manual applies on a day that is not heavy (C9), and names no trigger", () => {
    expect(at("manual", { kind: "manual", startQ: 24 }, [ev(10, 48)])).toEqual({ status: "manual", startQ: 24, normalStartQ: 28, triggers: [], guests: 10, orders: 1 });
  });
  it("a trigger whose candidate is not before the normal start proposes nothing", () => {
    const late = structure((x) => { x.shopDay.prepStartQ = 18; x.shopDay.prepDishArrivalQ = 34; });
    expect(resolveOpening(late, [ev(200, 36)], null, "auto")).toBeNull();
  });
  it("openingApplies / toDecision: accepted, manual, auto apply; proposed and auto are never persistent decisions", () => {
    const o = (status: "proposed" | "accepted" | "manual" | "auto" | "declined") => ({ status, startQ: 22, normalStartQ: 28, triggers: [], guests: 0, orders: 0 });
    expect((["proposed", "accepted", "manual", "auto", "declined"] as const).map((x) => openingApplies(o(x)))).toEqual([false, true, true, true, false]);
    expect(toDecision(o("accepted"))).toEqual({ kind: "accepted", startQ: 22 });
    expect(toDecision(o("manual"))).toEqual({ kind: "manual", startQ: 22 });
    expect(toDecision(o("declined"))).toEqual({ kind: "declined" });
    expect([toDecision(o("proposed")), toDecision(o("auto")), toDecision(undefined)]).toEqual([null, null, null]);
  });
});

describe("structureForDay and baseStructureOf", () => {
  it("an ordinary day (not heavy, no opening) gets THE SAME OBJECT and no base", () => {
    const s = S();
    const r = structureForDay(s, [ev(25, 48)], null);
    expect(r.structure).toBe(s);
    expect(r.base).toBeNull();
  });
  it("a heavy stations day raises Prep/Dishwasher's heads before and after by the extra; nothing else moves", () => {
    const s = deepFreeze(S());
    const { structure: d, base } = structureForDay(s, [ev(120, 36)], null);
    expect(d).not.toBe(s);
    expect(d.positions[I.$DISH]).toMatchObject({ headsBefore: 2, headsAfter: 2, openQ: 28 });
    expect(d.positions[I.$PREP]).toEqual(s.positions[I.$PREP]);
    expect(d.shopDay).toEqual(s.shopDay);
    expect(base).toEqual({ prepStartQ: 28, positions: { [I.$DISH]: { openQ: 28, headsBefore: 1, headsAfter: 1 } } });
  });
  it("the crew engine gets no rise (its extra people are crewShift)", () => {
    const s = crew();
    expect(structureForDay(s, [ev(120, 36)], null).structure).toBe(s);
  });
  it("extraPrepDishHeads 0 gives no rise", () => {
    const s = structure((x) => { x.catering.extraPrepDishHeads = 0; });
    expect(structureForDay(s, [ev(120, 36)], null).structure).toBe(s);
  });
  it("an applied opening moves the prep start and every Prep / Prep-Dishwasher open; proposed and declined do not", () => {
    const s = deepFreeze(S());
    const o = resolveOpening(s, [ev(120, 36)], { kind: "accepted", startQ: 22 })!;
    const { structure: d, base } = structureForDay(s, [ev(120, 36)], o);
    expect(d.shopDay.prepStartQ).toBe(22);
    expect([d.positions[I.$PREP]!.openQ, d.positions[I.$DISH]!.openQ]).toEqual([22, 22]);
    expect(d.positions[I.$REG]).toBe(s.positions[I.$REG]);
    expect(base!.positions[I.$PREP]).toEqual({ openQ: 28, headsBefore: 1, headsAfter: 1 });
    for (const status of ["proposed", "declined"] as const) {
      expect(structureForDay(s, [ev(10, 48)], { ...o, status }).structure).toBe(s);
    }
  });
  it("a BOH position that already opens before the opening keeps its open", () => {
    const s = structure((x) => { x.positions[I.$PREP]!.openQ = 20; x.positions[I.$PREP]!.trimQ = 60; });
    const d = structureForDay(s, [], { status: "manual", startQ: 24, normalStartQ: 28, triggers: [], guests: 0, orders: 0 }).structure;
    expect(d.positions[I.$PREP]!.openQ).toBe(20);
    expect(d.positions[I.$DISH]!.openQ).toBe(24);
  });
  it("is never mutating, and round-trips through baseStructureOf to a saved-valid structure", () => {
    const s = deepFreeze(S());
    const o = resolveOpening(s, [ev(120, 36)], { kind: "manual", startQ: 20 })!;
    const { structure: d, base } = structureForDay(s, [ev(120, 36)], o);
    const day = { structure: d, base: base! };
    expect(JSON.stringify(baseStructureOf(day))).toBe(JSON.stringify(s));
    expect(validScheduleStructure(baseStructureOf(day))).toEqual({ ok: true });
    expect(baseStructureOf({ structure: s })).toBe(s);
  });
  it("scheduledDayStartQ: the date's own start, else the saved one", () => {
    const s = S();
    const d = structureForDay(s, [], { status: "manual", startQ: 22, normalStartQ: 28, triggers: [], guests: 0, orders: 0 }).structure;
    expect(scheduledDayStartQ({ structure: d }, s)).toBe(22);
    expect(scheduledDayStartQ(null, s)).toBe(28);
  });
});

describe("D8: two kinds of limit", () => {
  const withHeads = (before: number, extra: number): ScheduleStructure => structure((x) => {
    x.positions[I.$DISH]!.headsBefore = before; x.positions[I.$DISH]!.headsAfter = before; x.catering.extraPrepDishHeads = extra;
  });
  it("0 + 0, 8 + 0, 0 + 8 and 8 + 8 = 16 pass the runtime bound; the saved setting stays ≤ 8", () => {
    for (const [b, e] of [[0, 0], [8, 0], [0, 8], [8, 8]] as const) {
      const s = withHeads(b, e);
      expect(validScheduleStructure(s), `${b}+${e} saved`).toEqual({ ok: true });
      const day = structureForDay(s, [ev(120, 36)], null);
      expect(() => assertRuntimeLimits(day.structure), `${b}+${e}`).not.toThrow();
      expect(day.structure.positions[I.$DISH]!.headsBefore).toBe(b + (e > 0 ? e : 0));
      expect(validScheduleStructure(baseStructureOf({ structure: day.structure, ...(day.base ? { base: day.base } : {}) }))).toEqual({ ok: true });
    }
  });
  it("8 + 1 fails the SAVED validator (so a derived limit is never checked by it); a synthetic 17 fails the runtime check", () => {
    expect(validScheduleStructure(withHeads(9, 0))).toEqual({ ok: false, key: `positions.${I.$DISH}.headsBefore` });
    const s17 = structure((x) => { x.positions[I.$DISH]!.headsBefore = 17; });
    expect(() => assertRuntimeLimits(s17)).toThrow(expect.objectContaining({ code: "generator_invalid_output" }));
  });
});

describe("D4: the request shapes", () => {
  it("exactly one of four shapes; an accept never carries a start; any extra key is refused", () => {
    expect([{ kind: "accept" }, { kind: "decline" }, { kind: "clear" }, { kind: "manual", startQ: 22 }].every(isOpeningDecisionInput)).toBe(true);
    for (const bad of [{ kind: "accept", startQ: 22 }, { kind: "decline", x: 1 }, { kind: "manual" }, { kind: "manual", startQ: "22" }, { kind: "auto" },
      { kind: "accepted", startQ: 22 }, null, [], "accept", { kind: "clear", startQ: null }]) {
      expect(isOpeningDecisionInput(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
