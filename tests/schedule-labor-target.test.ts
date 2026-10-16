/**
 * Scheduling Phase 2, Task 10 — the labor-target card, pure (spec §6.6, plan "Labor-target card"): the max labor $
 * at the target %, minus the day's share of the salaried cost on the TOTAL basis (R4), ÷ the blended wage = the
 * max hours; spread over each window by its share of the demand curve with the minimum-crew floor; the draft
 * against it ("Lunch: 5 on, optimal 4–5"), amber when over the target or under the floor; every line i18n key +
 * numeric params; no forecast / no wage are named states with their errands; $ lines hidden without money.
 */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import { LABOR_LINE_KEYS, laborTarget, type LaborTargetInput } from "@/lib/scheduling/labor-target-shared";
import type { DayNeed } from "@/lib/scheduling/context-shared";
import { P, THU, U, context, shift, structure, zeros } from "./fixtures/schedule/rules-fixture";

const LUNCH = { key: "lunch_rush", fromQ: 44, toQ: 56 } as const; // 11:00–14:00
/** $4,300: 11–13 h carry $1,000 together (23.3%), the rest spread over 7–10 and 14–20. */
const curve = (() => {
  const c = new Array<number>(24).fill(0);
  c[11] = 30_000; c[12] = 40_000; c[13] = 30_000;
  const rest = [7, 8, 9, 10, 14, 15, 16, 17, 18, 19, 20];
  rest.forEach((h, i) => { c[h] = i < rest.length - 1 ? 30_000 : 330_000 - 30_000 * (rest.length - 1); });
  return c;
})();

function need(floorInLunch: number): DayNeed {
  const minHeads = zeros();
  for (let q = LUNCH.fromQ; q < LUNCH.toQ; q++) minHeads[q] = floorInLunch;
  return { positions: {}, lineTotal: zeros(), minHeads, maxHeads: zeros(), sources: [], shapeNote: "normal" };
}

function input(over: Partial<LaborTargetInput> = {}, on = 5): LaborTargetInput {
  const ctx = context();
  const people = [U.maya, U.ben, U.eli, U.iris, U.kai, U.dani];
  const shifts = people.slice(0, on).map((u, i) => shift(u, THU, 44, 60, [P.REG, P.WALKON, P.WALK, P.EXPO, P.BOI, P.THIRD][i]!));
  return {
    date: THU, demand: { kind: "ok", hourlyCents: curve, dayCents: 430_000 }, structure: structure((s) => { s.labor.basis = "hourly"; }),
    need: need(4), windows: [LUNCH], shifts, people: ctx.people,
    wageCentsByUser: { [U.maya]: 2000, [U.ben]: 2100, [U.eli]: 2000, [U.iris]: 2100, [U.kai]: 2050, [U.dani]: 2050 },
    shopEstimateHourlyCents: null, salariedWeeklyCents: null, weekForecastCents: null, ...over,
  };
}

describe("laborTarget: the math, line by line", () => {
  it("$4,300 × 28% = $1,204 → ÷ $20.50 = 58.7 h (hourly basis)", () => {
    const out = laborTarget(input({}, 2), { canSeeMoney: true });
    expect(out.state).toBe("ok");
    if (out.state !== "ok") return;
    expect(out.maxLaborCents).toBe(120_400);
    expect(out.blendedWageCents).toBe(2050);
    expect(out.maxHours).toBe(58.7);
    expect(out.lines.slice(0, 2)).toEqual([
      { key: "schedule.labor.max_labor", params: { salesCents: 430_000, targetPct: 28, maxLaborCents: 120_400 } },
      { key: "schedule.labor.max_hours", params: { maxLaborCents: 120_400, wageCents: 2050, hours: 58.7 } },
    ]);
  });

  it("basis TOTAL subtracts the day's share of the salaried weekly cost (by forecast share; even split without a week forecast)", () => {
    const out = laborTarget(input({ structure: structure(), salariedWeeklyCents: 125_000, weekForecastCents: 2_150_000 }, 2), { canSeeMoney: true });
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.salariedDayCents).toBe(25_000); // 125,000 × 430,000 / 2,150,000
    expect(out.maxLaborCents).toBe(95_400);
    expect(out.lines[1]).toEqual({ key: "schedule.labor.minus_salaried", params: { salariedDayCents: 25_000, maxLaborCents: 95_400 } });
    const even = laborTarget(input({ structure: structure(), salariedWeeklyCents: 70_000, weekForecastCents: null }, 2), { canSeeMoney: true });
    if (even.state !== "ok") throw new Error(even.state);
    expect(even.salariedDayCents).toBe(10_000);
  });

  it("the window: max hours × the window's demand share ÷ its length = the spread; optimal = [minimum crew, ceil(spread)] — \"Lunch: 5 on, optimal 4–5\"", () => {
    const out = laborTarget(input(), { canSeeMoney: true });
    if (out.state !== "ok") throw new Error(out.state);
    const w = out.windows[0]!;
    expect(w.demandShare).toBeCloseTo(100_000 / 430_000, 10);
    expect(w.spreadHeads).toBeCloseTo((58.73170731707317 * (100_000 / 430_000)) / 3, 6);
    expect(w).toMatchObject({ key: "lunch_rush", floorHeads: 4, optimal: { min: 4, max: 5 }, on: 5, tone: "good", floorOverTarget: false });
    expect(out.lines).toContainEqual({ key: "schedule.labor.window", params: { window: "lunch_rush", on: 5, min: 4, max: 5 } });
  });

  it("chunk F, the spec's exact wording (§6.6): \"Lunch: 5 on, optimal 4–5\" · \"Close: 3 on, optimal 3\" (one number when the range is one), and the math lines", () => {
    const exact = laborTarget(input({ need: need(6) }, 6), { canSeeMoney: true });
    if (exact.state !== "ok") throw new Error(exact.state);
    expect(exact.lines).toContainEqual({ key: "schedule.labor.window_exact", params: { window: "lunch_rush", on: 6, optimal: 6 } });
    expect(exact.lines.some((l) => l.key === "schedule.labor.window")).toBe(false);
    expect(LABOR_LINE_KEYS).toContain("schedule.labor.window_exact");
    const fill = (k: string, p: Record<string, string | number>) => (en as Record<string, string>)[k]!.replace(/\{(\w+)\}/g, (_m, n: string) => String(p[n]));
    expect(fill("schedule.labor.window", { window: "Lunch", on: 5, min: 4, max: 5 })).toBe("Lunch: 5 on, optimal 4–5");
    expect(fill("schedule.labor.window_exact", { window: "Close", on: 3, optimal: 3 })).toBe("Close: 3 on, optimal 3");
    expect((en as Record<string, string>)["schedule.labor.max_labor"]).toMatch(/^Max hourly labor \$ = forecast sales × target %/);
    expect((en as Record<string, string>)["schedule.labor.max_hours"]).toMatch(/^Max hours = max labor \$ ÷ blended average wage/);
    expect((en as Record<string, string>)["schedule.labor.minus_salaried"]).toMatch(/minus salaried cost/i);
  });

  it("amber when over the target or under the minimum crew; a floor above the target says so", () => {
    const over = laborTarget(input({}, 6), { canSeeMoney: true });
    if (over.state !== "ok") throw new Error(over.state);
    expect(over.windows[0]).toMatchObject({ on: 6, tone: "amber" });
    const under = laborTarget(input({}, 3), { canSeeMoney: true });
    if (under.state !== "ok") throw new Error(under.state);
    expect(under.windows[0]).toMatchObject({ on: 3, tone: "amber" });
    const floor = laborTarget(input({ need: need(6) }, 6), { canSeeMoney: true });
    if (floor.state !== "ok") throw new Error(floor.state);
    // Astra chunk C P2: a minimum crew already over the target is a target CONFLICT — amber, with its reason.
    expect(floor.windows[0]).toMatchObject({ floorHeads: 6, optimal: { min: 6, max: 6 }, floorOverTarget: true, tone: "amber", amberReasons: ["floor_over_target"] });
    expect(floor.lines).toContainEqual({ key: "schedule.labor.floor_over_target", params: { window: "lunch_rush", floor: 6 } });
  });

  it("Astra chunk C P2: the tone comes from QUARTER-level shortages, never the window max — 5 on at 11:00, 2 leave at noon, minimum 4 to 2:00 → amber", () => {
    const base = input({}, 5);
    base.shifts = base.shifts.map((sh, i) => (i < 2 ? { ...sh, endQ: 48, segments: [{ ...sh.segments[0]!, endQ: 48 }] } : sh));
    const out = laborTarget(base, { canSeeMoney: true });
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.windows[0]).toMatchObject({ on: 5, onMin: 3, shortQuarters: 8, overQuarters: 0, tone: "amber", amberReasons: ["under_floor"] });
    expect(out.lines).toContainEqual({ key: "schedule.labor.window_under_floor", params: { window: "lunch_rush", hours: 2, floor: 4 } });
    // Fully staffed at every quarter stays good, with no reason.
    const full = laborTarget(input({}, 5), { canSeeMoney: true });
    if (full.state !== "ok") throw new Error(full.state);
    expect(full.windows[0]).toMatchObject({ on: 5, onMin: 5, shortQuarters: 0, overQuarters: 0, tone: "good", amberReasons: [] });
    // Over the target at some quarters only (a 6th person 11:00–12:00) is amber too, counted in quarters.
    const peak = input({}, 5);
    peak.shifts.push(shift(U.dani, THU, 44, 48, P.THIRD));
    const over = laborTarget(peak, { canSeeMoney: true });
    if (over.state !== "ok") throw new Error(over.state);
    expect(over.windows[0]).toMatchObject({ on: 6, onMin: 5, overQuarters: 4, tone: "amber", amberReasons: ["over_target"] });
  });

  it("forecast unknown → {state: no_forecast} with its errand; no wage → {state: no_wage}", () => {
    expect(laborTarget(input({ demand: { kind: "no_history" } }), { canSeeMoney: true })).toEqual({ state: "no_forecast", errand: { key: "schedule.labor.errand.no_forecast" } });
    expect(laborTarget(input({ demand: { kind: "unavailable" } }), { canSeeMoney: true }).state).toBe("no_forecast");
    expect(laborTarget(input({ wageCentsByUser: { [U.maya]: null, [U.ben]: 2100 } }, 2), { canSeeMoney: true })).toEqual({ state: "no_wage", errand: { key: "schedule.labor.errand.set_wage_estimate" } });
    // An empty draft uses the shop estimate; with none, no wage.
    const empty = laborTarget(input({ shopEstimateHourlyCents: 2000 }, 0), { canSeeMoney: true });
    if (empty.state !== "ok") throw new Error(empty.state);
    expect(empty.blendedWageCents).toBe(2000);
    expect(laborTarget(input({}, 0), { canSeeMoney: true }).state).toBe("no_wage");
    // TOTAL basis without the salaried estimate: money is blank (R2).
    expect(laborTarget(input({ structure: structure(), salariedWeeklyCents: null }, 2), { canSeeMoney: true }).state).toBe("no_wage");
  });

  it("without money permission the $ lines are gone (heads and windows stay); every key is in the closed list", () => {
    const out = laborTarget(input(), { canSeeMoney: false });
    if (out.state !== "ok") throw new Error(out.state);
    expect(JSON.stringify(out)).not.toMatch(/Cents|\$/);
    expect(out.lines.map((l) => l.key)).toEqual(["schedule.labor.window"]);
    const all = laborTarget(input({ need: need(6) }, 6), { canSeeMoney: true });
    if (all.state !== "ok") throw new Error(all.state);
    for (const l of all.lines) expect(LABOR_LINE_KEYS).toContain(l.key);
  });
});
