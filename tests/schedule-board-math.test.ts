/**
 * Scheduling Phase 2, Task 9 — the board maths, pure (plan "The board", spec §7; the mockup v17 `coverage`,
 * `closingRoleCoverage`, `renderMetrics`, `floorHours`, `demandSvg` and `renderTabs` as the reference):
 * coverage cells per position × hour, the MoD lane, the Closing Manager row, the money strip (with every $ field
 * absent for an actor who may not see money), labor % per hour, the demand curve and the day tabs.
 */
import { describe, expect, it } from "vitest";
import {
  closingRoleCells, coverageCells, dayTabs, demandCurve, laborPctByHour, modLane, moneyStrip, type BoardDayInput,
} from "@/lib/scheduling/board-shared";
import type { SkillLookup } from "@/lib/scheduling/people-input-shared";
import { DATES, MON, P, SUN, THU, TODAY, TUE, U, WED, context, setNeed, shift, structure } from "./fixtures/schedule/rules-fixture";

const skills: SkillLookup = {
  byUser: {
    [U.maya]: { [P.REG]: { value: 0.9, confidence: 0.7, startingPoint: false }, [P.EXPO]: { value: 0.8, confidence: 0.7, startingPoint: false } },
    [U.ben]: { [P.REG]: { value: 0.6, confidence: 0.7, startingPoint: false }, [P.WALKON]: { value: 0.7, confidence: 0.7, startingPoint: false } },
  },
  closeScoreByUser: {}, bands: { building: 0.5, strong: 0.8 },
};
const WAGES: Record<string, number | null> = { [U.maya]: 2000, [U.ben]: 1800, [U.iris]: 2200, [U.eli]: 1600, [U.kai]: 1700 };

function dayInput(date: string, shifts: ReturnType<typeof shift>[], ctx = context()): BoardDayInput {
  return { date, day: ctx.days[date]!, shifts, people: ctx.people, skills, wageCentsByUser: WAGES };
}

describe("coverageCells: per position × hour, scheduled / needed head-hours, tone, who else could cover", () => {
  it("gap (red) when any quarter is short, over (amber) when any quarter is above the need, good, closed (grey)", () => {
    const ctx = context();
    setNeed(ctx, THU, P.REG, 44, 52); // 11:00–13:00
    setNeed(ctx, THU, P.WALKON, 44, 48);
    const cells = coverageCells(dayInput(THU, [shift(U.maya, THU, 44, 50, P.REG), shift(U.ben, THU, 44, 60, P.WALKON)], ctx));
    const reg = (h: number) => cells.find((c) => c.positionId === P.REG && c.hour === h)!;
    const walk = (h: number) => cells.find((c) => c.positionId === P.WALKON && c.hour === h)!;
    expect(reg(11)).toMatchObject({ scheduled: 1, needed: 1, tone: "good" });
    expect(reg(12)).toMatchObject({ scheduled: 0.5, needed: 1, tone: "gap" });
    expect(walk(11)).toMatchObject({ tone: "good" });
    expect(walk(12)).toMatchObject({ scheduled: 1, needed: 0, tone: "over" }); // a 15-min slot above the need
    expect(cells.find((c) => c.positionId === P.EXPO && c.hour === 12)).toMatchObject({ scheduled: 0, needed: 0, tone: "closed" });
    // Who else could cover the Register gap at 12: Ben is on shift (Walk-ins / Online) and may work Register (0.6).
    expect(reg(12).alternates).toEqual([{ userId: U.ben, skill: 0.6 }]);
  });

  it("a gap is never hidden behind amber: a short quarter and an over quarter in one hour read gap", () => {
    const ctx = context();
    setNeed(ctx, THU, P.REG, 44, 46);
    setNeed(ctx, THU, P.REG, 46, 48, 0);
    const cells = coverageCells(dayInput(THU, [shift(U.maya, THU, 46, 62, P.REG)], ctx));
    expect(cells.find((c) => c.positionId === P.REG && c.hour === 11)!.tone).toBe("gap");
  });

  it("covers the shop hours only (prep start → scheduled out), one row per position in canonical id order", () => {
    const cells = coverageCells(dayInput(THU, []));
    const hours = [...new Set(cells.map((c) => c.hour))];
    expect(hours[0]).toBe(7);
    expect(hours[hours.length - 1]).toBe(20); // scheduled out 20:45 → the 20:00 hour is the last
    expect([...new Set(cells.map((c) => c.positionId))]).toEqual(Object.keys(context().days[THU]!.structure.positions).sort());
  });
});

describe("the MoD lane and the Closing Manager row", () => {
  it("modLane: who counts as the MoD per hour (ids, canonical); a gap only where the MoD is required", () => {
    const s = structure((x) => { x.leadership.modRequired = true; });
    const ctx = context({ s });
    const lane = modLane(dayInput(THU, [shift(U.dani, THU, 28, 60, "mod"), shift(U.iris, THU, 64, 83, P.REG)], ctx));
    expect(lane.find((h) => h.hour === 9)).toMatchObject({ userIds: [U.dani], tone: "good" });
    expect(lane.find((h) => h.hour === 15)).toMatchObject({ userIds: [], tone: "gap" }); // Iris is a KH: she does not count (setting OFF)
    const on = context({ s: structure((x) => { x.leadership.modRequired = true; x.leadership.keyHolderModAfterQ = 64; }) });
    expect(modLane(dayInput(THU, [shift(U.iris, THU, 64, 83, P.REG)], on)).find((h) => h.hour === 17)).toMatchObject({ userIds: [U.iris], tone: "good" });
    const off = modLane(dayInput(THU, []));
    expect(off.every((h) => h.tone !== "gap")).toBe(true); // not required → never a gap
  });

  it("closingRoleCells: covered by the flagged Closing Manager in [service close, scheduled out); a gap there otherwise; closed outside", () => {
    const ctx = context();
    setNeed(ctx, THU, P.REG, 80, 83);
    const cells = closingRoleCells(dayInput(THU, [shift(U.iris, THU, 64, 83, P.REG, { closingManager: true })], ctx));
    expect(cells.find((c) => c.hour === 19)).toMatchObject({ state: "closed", userId: null });
    expect(cells.find((c) => c.hour === 20)).toMatchObject({ state: "covered", userId: U.iris });
    expect(closingRoleCells(dayInput(THU, [shift(U.iris, THU, 64, 83, P.REG)], ctx)).find((c) => c.hour === 20)).toMatchObject({ state: "gap" });
  });

  it("Astra chunk C P2: partial Closing Manager coverage is a GAP — the window 8:00–8:45, the flagged manager leaves at 8:15 → hour 20 is not covered (as the validator)", () => {
    const ctx = context();
    setNeed(ctx, THU, P.REG, 80, 83);
    const cells = closingRoleCells(dayInput(THU, [shift(U.iris, THU, 64, 81, P.REG, { closingManager: true })], ctx));
    expect(cells.find((c) => c.hour === 20)).toMatchObject({ state: "gap", userId: null });
  });
});

describe("the money strip", () => {
  const base = () => {
    const ctx = context();
    const shifts = [
      shift(U.maya, THU, 44, 76, P.REG), shift(U.ben, THU, 44, 60, P.WALKON), shift(U.alex, THU, 28, 60, "mod"),
      { ...shift(U.alex, FRIDAY, 28, 60, "mod"), segments: [{ positionId: "mod", startQ: 28, endQ: 44 }, { positionId: P.REG, startQ: 44, endQ: 60 }] },
      shift(U.maya, SUN, 28, 76, P.REG), shift(U.maya, TUE, 28, 76, P.REG), shift(U.maya, WED, 28, 76, P.REG), shift(U.maya, MON, 28, 60, P.REG),
    ];
    return { ctx, shifts };
  };
  const FRIDAY = DATES[4]!;

  it("hourly hours vs the budget; OT risk; flex 0 (until Phase 3, flagged); manager floor hours and the hourly hours salaried cover saves", () => {
    const { ctx, shifts } = base();
    ctx.budgetByDate = Object.fromEntries(DATES.map((d) => [d, d === SUN ? null : 6]));
    const strip = moneyStrip({ dates: DATES, shifts, ctx, wageCentsByUser: WAGES, forecastWeekCents: 2_000_000, salariedWeeklyCents: 125_000 }, { canSeeMoney: true });
    expect(strip.hours).toMatchObject({
      hourlyHours: 8 + 4 + 12 + 12 + 12 + 8, budgetHours: 36, unbudgetedDates: [SUN], otRiskCount: 1, flexUsed: 0, flexAvailable: false, managerFloorHours: 4,
    });
    expect(strip.hours.hourlyHoursOnBudgetedDates).toBe(8 + 4 + 12 + 12 + 8);
    expect(strip.hours.remainingHours).toBe(36 - 44);
    // Alex on Register 11:00–15:00 Friday where no hourly person is on Register: 4 hourly hours saved.
    expect(strip.hours.hourlySavedBySalaried).toBe(4);
  });

  it("$: hourly cost and % of forecast, salaried fixed, TOTAL %; blank (null, never 0) with an unknown wage or forecast", () => {
    const { ctx, shifts } = base();
    const strip = moneyStrip({ dates: DATES, shifts, ctx, wageCentsByUser: WAGES, forecastWeekCents: 2_000_000, salariedWeeklyCents: 125_000 }, { canSeeMoney: true });
    const hourlyCost = 2000 * (8 + 12 + 12 + 12 + 8) + 1800 * 4;
    expect(strip.money).toEqual({ hourlyCostCents: hourlyCost, hourlyPct: Math.round(1000 * hourlyCost / 2_000_000) / 10, salariedFixedCents: 125_000, totalPct: Math.round(1000 * (hourlyCost + 125_000) / 2_000_000) / 10 });
    const noWage = moneyStrip({ dates: DATES, shifts, ctx, wageCentsByUser: { ...WAGES, [U.ben]: null }, forecastWeekCents: 2_000_000, salariedWeeklyCents: null }, { canSeeMoney: true });
    expect(noWage.money).toEqual({ hourlyCostCents: null, hourlyPct: null, salariedFixedCents: null, totalPct: null });
    const noForecast = moneyStrip({ dates: DATES, shifts, ctx, wageCentsByUser: WAGES, forecastWeekCents: null, salariedWeeklyCents: 125_000 }, { canSeeMoney: true });
    expect(noForecast.money).toMatchObject({ hourlyCostCents: hourlyCost, hourlyPct: null, totalPct: null });
  });

  it("CC chunk C ruling 3: essential closer hours are COUNTED (hours, $, %) and named — 'essential hours past budget: X h' — never refused for budget", () => {
    const ctx = context();
    ctx.budgetByDate = Object.fromEntries(DATES.map((d) => [d, d === THU ? 6 : null]));
    // Thursday: Maya 11:00–7:00 PM (8 h, not the closing window) + Iris 4:00–8:45 PM (4.75 h, works the closing window 8:00–8:45).
    const shifts = [shift(U.maya, THU, 44, 76, P.REG), shift(U.iris, THU, 64, 83, P.REG, { closingManager: true })];
    const strip = moneyStrip({ dates: DATES, shifts, ctx, wageCentsByUser: WAGES, forecastWeekCents: 2_000_000, salariedWeeklyCents: 125_000 }, { canSeeMoney: true });
    expect(strip.hours).toMatchObject({ hourlyHours: 12.75, hourlyHoursOnBudgetedDates: 12.75, essentialHoursOnBudgetedDates: 4.75, budgetHours: 6, remainingHours: 6 - 12.75, essentialPastBudgetHours: 4.75 });
    expect(strip.notes).toEqual([{ key: "schedule.note.essential_past_budget", params: { hours: 4.75, budgetHours: 6 } }]);
    // The $ counts every hour, essential included (the true wage cost).
    expect(strip.money!.hourlyCostCents).toBe(2000 * 8 + 2200 * 4.75);
    // Within budget: no note; no budget at all: null, no note. The note carries no $ (it shows to the AGM too).
    ctx.budgetByDate[THU] = 20;
    expect(moneyStrip({ dates: DATES, shifts, ctx, wageCentsByUser: WAGES, forecastWeekCents: null, salariedWeeklyCents: null }, { canSeeMoney: false })).toMatchObject({ hours: { essentialPastBudgetHours: 0 }, notes: [] });
    ctx.budgetByDate[THU] = null;
    expect(moneyStrip({ dates: DATES, shifts, ctx, wageCentsByUser: WAGES, forecastWeekCents: null, salariedWeeklyCents: null }, { canSeeMoney: false })).toMatchObject({ hours: { essentialPastBudgetHours: null }, notes: [] });
    // Only the part past the budget is named, and only up to the essential hours: 12.75 h against 10 h → 2.75 h.
    ctx.budgetByDate[THU] = 10;
    expect(moneyStrip({ dates: DATES, shifts, ctx, wageCentsByUser: WAGES, forecastWeekCents: null, salariedWeeklyCents: null }, { canSeeMoney: false }).hours.essentialPastBudgetHours).toBe(2.75);
  });

  it("without canSeeScheduleMoney (the AGM) the money block is ABSENT from the view-model — no key, no $ anywhere", () => {
    const { ctx, shifts } = base();
    const strip = moneyStrip({ dates: DATES, shifts, ctx, wageCentsByUser: WAGES, forecastWeekCents: 2_000_000, salariedWeeklyCents: 125_000 }, { canSeeMoney: false });
    expect("money" in strip).toBe(false);
    expect(JSON.stringify(strip)).not.toMatch(/Cents|Pct/);
  });
});

describe("labor % per hour, the demand curve, the day tabs", () => {
  const curve: number[] = new Array<number>(24).fill(0).map((_, h): number => (h >= 11 && h <= 13 ? 40_000 : h >= 7 && h <= 20 ? 10_000 : 0));
  const withDemand = () => {
    const ctx = context();
    ctx.days[THU]!.inputs = { demandKind: "ok", hourlyCents: curve, dayCents: curve.reduce((a, b) => a + b, 0), dayTypeSource: "forecast", overrideId: null, cateringEvents: [] };
    return ctx;
  };

  it("labor % per hour = the hour's hourly labor $ ÷ its forecast $; good ≤ target, watch ≤ target + 10, high above; null when unknown", () => {
    const ctx = withDemand();
    const rows = laborPctByHour(dayInput(THU, [shift(U.maya, THU, 44, 60, P.REG), shift(U.ben, THU, 44, 60, P.WALKON)], ctx), { canSeeMoney: true })!;
    expect(rows.find((r) => r.hour === 11)).toMatchObject({ pct: 9.5, tone: "good" }); // (2000 + 1800) / 40000
    expect(rows.find((r) => r.hour === 14)).toMatchObject({ pct: 38, tone: "watch" }); // 3800 / 10000, target 28 → watch ≤ 38
    expect(rows.find((r) => r.hour === 9)).toMatchObject({ pct: 0, tone: "good" });
    const busy = laborPctByHour(dayInput(THU, [shift(U.maya, THU, 56, 60, P.REG), shift(U.ben, THU, 56, 60, P.WALKON), shift(U.iris, THU, 56, 60, P.WALKON)], ctx), { canSeeMoney: true })!;
    expect(busy.find((r) => r.hour === 14)).toMatchObject({ pct: 60, tone: "high" });
    expect(laborPctByHour(dayInput(THU, [], context()), { canSeeMoney: true })!.every((r) => r.pct === null && r.tone === "none")).toBe(true);
    expect(laborPctByHour(dayInput(THU, [], ctx), { canSeeMoney: false })).toBeNull();
  });

  it("demandCurve: the 24-hour forecast cut to the shop's hours, in cents; null without a forecast", () => {
    const d = demandCurve(dayInput(THU, [], withDemand()))!;
    expect(d[0]).toEqual({ hour: 7, cents: 10_000 });
    expect(d.find((x) => x.hour === 12)).toEqual({ hour: 12, cents: 40_000 });
    expect(d[d.length - 1]!.hour).toBe(20);
    expect(demandCurve(dayInput(THU, []))).toBeNull();
  });

  it("dayTabs: days before today are LOCKED; hourly % per day only for money viewers", () => {
    const ctx = withDemand();
    const tabs = dayTabs({ dates: DATES, today: TODAY, ctx, shifts: [shift(U.maya, THU, 44, 60, P.REG)], wageCentsByUser: WAGES }, { canSeeMoney: true });
    expect(tabs.map((t) => t.locked)).toEqual([true, true, false, false, false, false, false]);
    expect(tabs.find((t) => t.date === THU)).toMatchObject({ dayType: "normal", hourlyPct: Math.round(1000 * 8000 / ctx.days[THU]!.inputs.dayCents!) / 10 });
    expect(tabs.find((t) => t.date === MON)).toMatchObject({ dayType: null, hourlyPct: null });
    const agm = dayTabs({ dates: DATES, today: TODAY, ctx, shifts: [], wageCentsByUser: WAGES }, { canSeeMoney: false });
    expect(agm.every((t) => !("hourlyPct" in t))).toBe(true);
  });
});
