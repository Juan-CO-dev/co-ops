/**
 * PR SCH (plan r5, 12.1 limit rise and 12.3; r1 3.8 / 8.3): the stations engine on a heavy day. 120 guests at 9:00 AM,
 * the shipped catering settings, the v17 position set (Prep and Prep/Dishwasher open at 7:00, Prep/Dishwasher leads the
 * Prep pair, 1 head each):
 *  (a) the normal opening: one EXTRA Prep/Dishwasher person from 7:00 (reason catering_prep) — "more people come in early";
 *  (b) an accepted opening at 5:30: Prep and Prep/Dishwasher from 5:30 and a manager on duty from 5:30.
 * Both are validator-clean the golden way (no new error, every declared gap certified, re-validation reproduces).
 */
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/scheduling/context-shared";
import { buildWeek, type GeneratorOutput } from "@/lib/scheduling/generator/build-shared";
import { buildDayNeed } from "@/lib/scheduling/need-shared";
import { MOD, checkScheduleRules, modCountsOn } from "@/lib/scheduling/rules-shared";
import { scheduledOut } from "@/lib/scheduling/structure-shared";
import { DATES, I, V17_SPECS, day, fixture, structure, type PersonSpec } from "./fixtures/schedule/fixtures";

const WED = DATES[2]!;
const EARLY = new Set(["u-03-sofia", "u-07-omar", "u-08-kai", "u-15-alex", "u-16-jules", "u-05-dani"]);
const specs: PersonSpec[] = V17_SPECS.map((p) => (EARLY.has(p.id) ? { ...p, off: [], window: { fromQ: 20, toQ: 84 } } : p));
const order = (headcount: number) => [{ id: "order-1", headcount, eventQ: 36 }];

function build(headcount: number | null, decision?: { kind: "accepted"; startQ: number }) {
  const s = structure();
  const d = day(WED, { catering: headcount === null ? [] : order(headcount), ...(decision ? { decision } : {}) }, s);
  return buildWeek(fixture({ structure: s, specs, days: [d] }));
}

function clean(out: GeneratorOutput): void {
  const errors = out.problems.filter((p) => p.severity === "error" && !p.inherited);
  expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
  const inherited = new Set(out.days.filter((d) => d.inherited).map((d) => d.date));
  for (const g of out.gaps.filter((x) => !inherited.has(x.date))) {
    expect(out.problems.some((p) => p.day === g.date && p.severity === "gap" && p.code === g.code && p.q === g.fromQ), `${g.date} ${g.code} ${g.fromQ}`).toBe(true);
  }
  const again = checkScheduleRules({ locationId: out.context.locationId, weekStart: out.context.weekStart, shifts: out.shifts, gaps: out.gaps, days: out.days }, out.context);
  expect(canonicalJson(again)).toBe(canonicalJson(out.problems));
}
const on = (out: GeneratorOutput, positionId: string, q: number) =>
  out.shifts.filter((sh) => sh.date === WED).reduce((n, sh) => n + sh.segments.filter((g) => g.positionId === positionId && g.startQ <= q && g.endQ > q).length, 0);

describe("12.1: the stations limit rise (ruling C2)", () => {
  const need = (headcount: number, engine: "stations" | "crew" = "stations") => {
    const s = structure((x) => { if (engine === "crew") { x.engine = "crew"; x.shiftTypes = []; } });
    return buildDayNeed({ structure: s, dayType: "normal", scheduledOutQ: scheduledOut(s, 45), hourlyCents: null, demandKind: "no_history", catering: order(headcount) });
  };
  it("a 120-guest day adds a SECOND Prep/Dishwasher head at 7:00–9:00 and none before 7:00 with the normal opening", () => {
    const n = need(120);
    expect(n.need.positions[I.$DISH]!.slice(28, 36)).toEqual(new Array(8).fill(2));
    expect(n.need.positions[I.$DISH]!.slice(20, 28)).toEqual(new Array(8).fill(0));
    expect(n.need.positions[I.$DISH]![36]).toBe(1);
    expect(n.structure.positions[I.$DISH]).toMatchObject({ headsBefore: 2, headsAfter: 2 });
    expect(n.opening).toBeNull();
  });
  it("the crew engine gets no rise (its extra people are crewShift): the head stays capped at 1", () => {
    const n = need(120, "crew");
    expect(n.need.positions[I.$DISH]!.slice(28, 36)).toEqual(new Array(8).fill(1));
    expect(n.base).toBeNull();
  });
  it("a 25-guest day is not heavy: no rise, the shop's own structure object", () => {
    expect(need(25).base).toBeNull();
  });
});

describe("12.3: the stations worked examples, 120 guests at 9:00 AM", () => {
  it("(a) the normal opening: an extra Prep/Dishwasher person from 7:00, reason catering_prep", () => {
    const out = build(120);
    clean(out);
    expect(out.context.days[WED]!.structure.shopDay.prepStartQ).toBe(28);
    expect(out.context.days[WED]!.opening).toBeUndefined();
    for (let q = 28; q < 36; q++) expect(on(out, I.$DISH, q), `q${q}`).toBe(2);
    const extra = out.shifts.filter((sh) => sh.date === WED && sh.segments.some((g, i) => g.positionId === I.$DISH && g.startQ <= 28
      && ((out.reasons[`${WED}|${sh.userId}|${sh.startQ}`]?.segments[i] ?? []) as Array<{ key: string }>).some((r) => r.key === "catering_prep")));
    expect(extra.length).toBeGreaterThanOrEqual(1);
    expect(out.shifts.every((sh) => sh.startQ >= 28)).toBe(true);
  });

  it("(b) an accepted opening at 5:30: Prep and Prep/Dishwasher from 5:30, and a manager on duty from 5:30", () => {
    const out = build(120, { kind: "accepted", startQ: 22 });
    clean(out);
    const ctx = out.context.days[WED]!;
    expect(ctx.opening).toMatchObject({ status: "accepted", startQ: 22, normalStartQ: 28 });
    expect(ctx.structure.shopDay.prepStartQ).toBe(22);
    expect(ctx.base?.prepStartQ).toBe(28);
    expect(on(out, I.$PREP, 22)).toBe(1);
    expect(on(out, I.$DISH, 22)).toBeGreaterThanOrEqual(1);
    // The quarters before 7:00 are the catering morning (source catering).
    expect(ctx.need.sources.filter((r) => r.source === "catering" && r.fromQ === 22).map((r) => r.positionId).sort()).toEqual([I.$DISH, I.$PREP].sort());
    // A manager on duty from 5:30: a shift that counts as MoD covers every quarter from 22, or a CERTIFIED mod gap does.
    for (let q = 22; q < 28; q++) {
      const covered = out.shifts.some((sh) => sh.date === WED && sh.startQ <= q && sh.endQ > q && modCountsOn(out.context.people[sh.userId]!, ctx, q));
      const proven = out.gaps.some((g) => g.date === WED && g.code === "mod_missing" && g.fromQ <= q && q < g.toQ && g.cause !== "unresolved_search");
      expect(covered || proven, `q${q}`).toBe(true);
    }
    expect(out.shifts.some((sh) => sh.date === WED && sh.startQ === 22 && sh.segments.some((g) => g.positionId === MOD))).toBe(true);
  });

  it("controls: 25 guests is not heavy (the no-order day's shifts); three orders of 20 is heavy by total (the extra head comes)", () => {
    const none = build(null);
    const light = build(25);
    expect(canonicalJson(light.shifts)).toBe(canonicalJson(none.shifts));
    const s = structure();
    const three = buildWeek(fixture({ structure: s, specs, days: [day(WED, { catering: [36, 44, 50].map((eventQ, i) => ({ id: `t-${i}`, headcount: 20, eventQ })) }, s)] }));
    clean(three);
    for (let q = 28; q < 36; q++) expect(on(three, I.$DISH, q), `q${q}`).toBe(2);
  });
});
