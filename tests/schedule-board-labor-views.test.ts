/**
 * Board two labor views PR 3: THE SCREENS (plan r4 "Heads budget", "Day tab", "Day states", "Access", "PR split" 3).
 * Dark behind SCHEDULE_LABOR_VIEWS; `loadBoard` decides who gets `laborViews` (tests/schedule-labor-views-e2e.test.ts
 * proves that end to end). Here, over the mockup v17 generator week:
 *  1. the heads maths over the labor facts' figure (the allowance, the hours "at this draft's overtime", the verdict in
 *     dollars; each missing figure is the card's errand by the projection's own reason; the board's wages are never read);
 *  2. the view-model: with the views the board prices NO labor (no strip money, no tab %); labor $ / % per hour only for
 *     the sub-day viewer (MoO / Owner / CGS); hours per hour for everyone with views; without views every byte as before;
 *  3. the render (react-dom/server): the three-line week strip, the day card (fully loaded first), the day tabs, the
 *     timeline rows, the named states; unknown is "—" with its reason, never $0; en + es; 44 px.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { canSeeSubDayLaborMoney } from "@/lib/scheduling/access-shared";
import type { PeopleActor } from "@/lib/people/access-shared";
import { LABOR_LINE_KEYS, laborTarget, type LaborTargetInput, type LaborTargetViews } from "@/lib/scheduling/labor-target-shared";
import type { BoardLaborDay, BoardLaborFigure, BoardLaborReason, BoardLaborViews, BoardLaborViewsReady } from "@/lib/scheduling/labor-projection-shared";
import type { DayNeed } from "@/lib/scheduling/context-shared";
import { DATES, boardSource } from "./fixtures/schedule/board-source";
import { AGM_BOARD_PATHS } from "./fixtures/schedule/agm-board-paths";
import { FIXTURES } from "./fixtures/schedule/fixtures";
import { BOARD_LABOR_VIEW_PATHS, GM_VIEWS_BOARD_EXTRA_PATHS, SUB_DAY_VIEWS_BOARD_EXTRA_PATHS } from "./fixtures/schedule/labor-views-paths";
import { P, THU, U, context, shift, structure, zeros } from "./fixtures/schedule/rules-fixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/schedule", useSearchParams: () => new URLSearchParams() }));
const { TranslationProvider } = await import("@/lib/i18n/provider");
const { StepUpProvider } = await import("@/components/admin/StepUpProvider");
const { ScheduleBoard } = await import("@/components/schedule/ScheduleBoard");
const { boardView } = await import("@/lib/scheduling/board-view-shared");

const EN = en as Record<string, string>, ES = es as Record<string, string>;
type PageView = Parameters<typeof ScheduleBoard>[0]["view"];
const renderBoard = (view: PageView, language: "en" | "es" = "en", extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language } as never,
    createElement(StepUpProvider, { unlocked: false, unlockedAt: null } as never, createElement(ScheduleBoard, { view, ...extra }) as ReactNode)));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const fill = (s: string, params: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k]));

// ── figures ─────────────────────────────────────────────────────────────────────────────────────

/** A known day: 40 hourly hours at $20.50 + 8 salaried, $10 of overtime premium, $200 of salaries, 12% burden, $4,300 sales. */
const figure = (over: Partial<BoardLaborFigure> = {}): BoardLaborFigure => ({
  minutes: 2_880, hourlyMinutes: 2_400, otMinutes: 30, straightCents: 82_000, otPremiumCents: 1_000, pureHourlyCents: 83_000,
  salariedCents: 20_000, burdenCents: 12_360, fullyLoadedCents: 115_360, burdenPct: 12,
  sales: { basis: "forecast", cents: 430_000 }, pureHourlyPct: 19.3, pureHourlyTone: "watch", fullyLoadedPct: 26.8, fullyLoadedTone: "good",
  otState: "projected", rateEstimated: false, burdenEstimated: true, salaryProjected: false, salaryGaps: 0, reasons: [], ...over,
});
const unknownMoney = (reasons: BoardLaborReason[], over: Partial<BoardLaborFigure> = {}): BoardLaborFigure => figure({
  straightCents: null, otPremiumCents: null, pureHourlyCents: null, burdenCents: null, fullyLoadedCents: null, otMinutes: null,
  pureHourlyPct: null, pureHourlyTone: "none", fullyLoadedPct: null, fullyLoadedTone: "none", reasons, ...over,
});
const hoursOnly = (kind: "not_settled" | "no_schedule"): BoardLaborFigure => ({
  minutes: kind === "not_settled" ? 1_920 : null, hourlyMinutes: null, otMinutes: null, straightCents: null, otPremiumCents: null, pureHourlyCents: null, salariedCents: null,
  burdenCents: null, fullyLoadedCents: null, burdenPct: null, sales: { basis: "actual", cents: null }, pureHourlyPct: null, pureHourlyTone: "none", fullyLoadedPct: null,
  fullyLoadedTone: "none", otState: null, rateEstimated: false, burdenEstimated: false, salaryProjected: false, salaryGaps: 0, reasons: [kind],
});
const TARGETS = { hourlyPct: 18, loadedPct: 28 };

// ── 1. The heads maths ──────────────────────────────────────────────────────────────────────────

const LUNCH = { key: "lunch_rush", fromQ: 44, toQ: 56 } as const;
const curve = (() => { const c = new Array<number>(24).fill(0); for (let h = 7; h <= 20; h++) c[h] = h >= 11 && h <= 13 ? 40_000 : 28_182; return c; })();
function need(): DayNeed {
  const minHeads = zeros();
  for (let q = LUNCH.fromQ; q < LUNCH.toQ; q++) minHeads[q] = 2;
  return { positions: {}, lineTotal: zeros(), minHeads, maxHeads: zeros(), sources: [], shapeNote: "normal" };
}
function target(views: LaborTargetViews, over: Partial<LaborTargetInput> = {}) {
  const ctx = context();
  const people = [U.maya, U.ben, U.eli];
  return laborTarget({
    date: THU, demand: { kind: "ok", hourlyCents: curve, dayCents: 430_000 }, structure: structure((s) => { s.labor.basis = views.basis; }),
    need: need(), windows: [LUNCH], shifts: people.map((u, i) => shift(u, THU, 44, 60, [P.REG, P.WALKON, P.WALK][i]!)), people: ctx.people,
    // The board's own wages are UNKNOWN here on purpose: with the views the card never reads them.
    wageCentsByUser: {}, shopEstimateHourlyCents: null, salariedWeeklyCents: null, weekForecastCents: null, views, ...over,
  }, { canSeeMoney: true });
}
const views = (f: BoardLaborFigure, basis: "hourly" | "total" = "total", kind: LaborTargetViews["kind"] = "projected"): LaborTargetViews => ({ kind, figure: f, basis, targets: TARGETS });
const lineOf = (t: ReturnType<typeof laborTarget>, key: string) => (t.state === "ok" ? t.lines.find((l) => l.key === key) : undefined);

describe("the heads maths over the labor facts' figure (plan r4 'Heads budget')", () => {
  it("TOTAL basis: allowance = sales x fully loaded target / (1 + burden) - the day's salaries; the board's wages are never read", () => {
    const t = target(views(figure()));
    expect(t.state).toBe("ok");
    // $4,300 x 28% / 1.12 = $1,075.00; minus $200 of salaries = $875.00.
    expect(lineOf(t, "schedule.labor.views_allowance_total")?.params).toEqual({ salesCents: 430_000, targetPct: 28, burdenPct: 12, salariedDayCents: 20_000, allowanceCents: 87_500 });
    // The blended STRAIGHT wage is the figure's own: $820 over 40 hourly hours = $20.50. ($875 - $10 premium) / $20.50 = 42.2 h.
    expect(lineOf(t, "schedule.labor.views_max_hours")?.params).toEqual({ allowanceCents: 87_500, premiumCents: 1_000, wageExactCents: 2_050, hours: 42.2 });
    // The verdict in dollars, against the SAME projection the day card shows (pure hourly $830).
    expect(lineOf(t, "schedule.labor.views_verdict_under")?.params).toEqual({ projectedCents: 83_000, allowanceCents: 87_500, diffCents: 4_500 });
    expect(t).toMatchObject({ maxLaborCents: 87_500, salariedDayCents: 20_000, blendedWageCents: 2_050, maxHours: 42.2 });
    // None of the card's own money lines (the board prices nothing).
    for (const k of ["schedule.labor.max_labor", "schedule.labor.minus_salaried", "schedule.labor.max_hours"]) expect(lineOf(t, k)).toBeUndefined();
    // Fully loaded at the allowance is exactly the target: (875 + 200) x 1.12 = 1,204 = 28% of 4,300.
    expect(Math.round((87_500 + 20_000) * 1.12)).toBe(Math.round(430_000 * 0.28));
  });
  it("HOURLY basis: allowance = sales x the pure hourly target; over the allowance says by how much", () => {
    const t = target(views(figure(), "hourly"));
    expect(lineOf(t, "schedule.labor.views_allowance_hourly")?.params).toEqual({ salesCents: 430_000, targetPct: 18, allowanceCents: 77_400 });
    expect(lineOf(t, "schedule.labor.views_verdict_over")?.params).toEqual({ projectedCents: 83_000, allowanceCents: 77_400, diffCents: 5_600 });
    expect(lineOf(t, "schedule.labor.views_salary_fallback")).toBeUndefined();
  });
  it("TOTAL basis with the day's salaries unknown: the pure hourly target instead, and the card says so (never a salary of 0)", () => {
    const t = target(views(figure({ salariedCents: null, burdenCents: null, fullyLoadedCents: null, fullyLoadedPct: null, fullyLoadedTone: "none", reasons: ["salary_incomplete"] })));
    expect(lineOf(t, "schedule.labor.views_salary_fallback")?.params).toEqual({ targetPct: 18 });
    expect(lineOf(t, "schedule.labor.views_allowance_hourly")?.params).toMatchObject({ allowanceCents: 77_400 });
    expect(lineOf(t, "schedule.labor.views_allowance_total")).toBeUndefined();
    expect(t).toMatchObject({ salariedDayCents: 0 });
  });
  it("an ACTUAL day is judged over its actual sales and its settled hours (the same figure the day card shows)", () => {
    const t = target(views(figure({ sales: { basis: "actual", cents: 500_000 }, otState: "assessed" }), "hourly", "actual"));
    expect(lineOf(t, "schedule.labor.views_allowance_hourly")?.params).toEqual({ salesCents: 500_000, targetPct: 18, allowanceCents: 90_000 });
  });
  it("the windows' optimal heads are cut from the views' hours (the card's one budget)", () => {
    const t = target(views(figure()));
    if (t.state !== "ok") throw new Error("not ok");
    const w = t.windows[0]!;
    // 42.195 h x the lunch share of the curve / 3 h.
    const share = 120_000 / 430_000;
    expect(w.spreadHeads).toBeCloseTo(((87_500 - 1_000) / 2_050) * share / 3, 6);
    expect(w.optimal).toEqual({ min: 2, max: Math.max(2, Math.ceil(w.spreadHeads!)) });
  });
  it.each<[string, LaborTargetViews, string]>([
    ["a day not settled: hours only", views(hoursOnly("not_settled"), "total", "not_settled"), "not_settled"],
    ["a day with no schedule", views(hoursOnly("no_schedule"), "total", "no_schedule"), "no_schedule"],
    ["someone scheduled has no wage", views(unknownMoney(["wage_unknown"])), "wage_unknown"],
    ["overtime not assessed (part of the payroll week has no schedule)", views(unknownMoney(["schedule_incomplete"])), "schedule_incomplete"],
    ["no forecast, even when another reason comes first", views(figure({ sales: { basis: "forecast", cents: null }, reasons: ["salary_rebuilding", "forecast_missing"] })), "forecast_missing"],
    ["an actual day whose sales are not in", views(figure({ sales: { basis: "actual", cents: null }, reasons: ["salary_unknown", "sales_not_covered"] }), "total", "actual"), "sales_not_covered"],
    ["zero sales (never Infinity)", views(figure({ sales: { basis: "forecast", cents: 0 }, reasons: [] })), "zero_sales"],
    ["money withheld with no reason given: named anyway", views(unknownMoney([])), "hours_unknown"],
  ])("a withheld figure is the card's errand, by the projection's own reason: %s", (_name, v, reason) => {
    const t = target(v);
    expect(t).toEqual({ state: "views_unknown", errand: { key: `schedule.labor_views.reason.${reason}` } });
    expect(EN[`schedule.labor_views.reason.${reason}`]).toBeTruthy();
  });
  it("no hourly hours and no shop estimate: 'set the wage estimate' (never a wage of 0); with an estimate, the estimate", () => {
    const zero = figure({ hourlyMinutes: 0, straightCents: 0, otPremiumCents: 0, pureHourlyCents: 0 });
    expect(target(views(zero))).toMatchObject({ state: "no_wage" });
    expect(target(views(zero), { shopEstimateHourlyCents: 1_840 })).toMatchObject({ state: "ok", blendedWageCents: 1_840 });
  });
  // ── Review BOARD3-r1: every sentence the card writes is arithmetically TRUE ──────────────────────
  /** A floor of `heads` people for `quarters` quarters from 11:00, and nobody scheduled (so nothing covers it). */
  const floorNeed = (heads: number, quarters: number): DayNeed => {
    const minHeads = zeros();
    for (let q = 44; q < 44 + quarters; q++) minHeads[q] = heads;
    return { positions: {}, lineTotal: zeros(), minHeads, maxHeads: zeros(), sources: [], shapeNote: "normal" };
  };
  it("r1 P2-1: salaries alone above the target: the allowance is NEGATIVE and said so, never clamped to $0 ('$0 under' was false)", () => {
    // $1,000 x 28% / 1.12 = $250 for hourly labor + salaries; $400 of salaries leaves -$150. Nobody hourly is scheduled.
    const f = figure({ sales: { basis: "forecast", cents: 100_000 }, salariedCents: 40_000, hourlyMinutes: 0, straightCents: 0, otPremiumCents: 0, pureHourlyCents: 0 });
    const t = target(views(f), { shopEstimateHourlyCents: 2_000, shifts: [] });
    expect(lineOf(t, "schedule.labor.views_allowance_total")?.params).toEqual({ salesCents: 100_000, targetPct: 28, burdenPct: 12, salariedDayCents: 40_000, allowanceCents: -15_000 });
    expect(lineOf(t, "schedule.labor.views_salaries_over_target")?.params).toEqual({ salariedDayCents: 40_000, capCents: 25_000, overCents: 15_000 });
    expect(lineOf(t, "schedule.labor.views_no_hours")?.params).toEqual({ allowanceCents: -15_000, premiumCents: 0, remainingCents: -15_000 });
    expect(lineOf(t, "schedule.labor.views_max_hours")).toBeUndefined();
    expect(lineOf(t, "schedule.labor.views_verdict_over")?.params).toEqual({ projectedCents: 0, allowanceCents: -15_000, diffCents: 15_000 });
    expect(lineOf(t, "schedule.labor.views_verdict_under")).toBeUndefined();
    expect(t).toMatchObject({ maxLaborCents: -15_000, maxHours: 0 });
  });
  it("r1 P2-2: the minimum-crew explanation compares against what is LEFT after this draft's overtime premium (never '$90 more than $100')", () => {
    // Hourly basis: $555.56 x 18% = $100 allowance; $20 premium; $20/h; the minimum crew needs 4.5 h = $90.
    const f = figure({ sales: { basis: "forecast", cents: 55_556 }, hourlyMinutes: 240, straightCents: 8_000, otPremiumCents: 2_000, pureHourlyCents: 10_000 });
    const t = target(views(f, "hourly"), { need: floorNeed(1, 18), shifts: [] });
    expect(lineOf(t, "schedule.labor.views_max_hours")?.params).toEqual({ allowanceCents: 10_000, premiumCents: 2_000, wageExactCents: 2_000, hours: 4 });
    expect(lineOf(t, "schedule.labor.views_minimums_over_math")?.params).toEqual({ minHours: 4.5, wageExactCents: 2_000, minCostCents: 9_000, remainingCents: 8_000, allowanceCents: 10_000, premiumCents: 2_000 });
    expect(lineOf(t, "schedule.labor.minimums_over_target_math")).toBeUndefined();
    // The same day with no overtime: $90 fits in $100, and the card does not warn.
    const calm = target(views(figure({ sales: { basis: "forecast", cents: 55_556 }, hourlyMinutes: 240, straightCents: 8_000, otPremiumCents: 0, pureHourlyCents: 8_000 }), "hourly"), { need: floorNeed(1, 18), shifts: [] });
    expect(lineOf(calm, "schedule.labor.minimums_over_target")).toBeUndefined();
    expect(lineOf(calm, "schedule.labor.views_minimums_over_math")).toBeUndefined();
  });
  it("r1 (the class): over a grid of days, every equation and comparison the card states holds for the numbers it shows", () => {
    let cases = 0, negative = 0, minimums = 0, noHours = 0;
    for (const basis of ["total", "hourly"] as const) for (const sales of [50_000, 100_000, 430_000]) for (const salaried of [0, 20_000, 40_000, null])
      for (const premium of [0, 2_000, 20_000]) for (const [hourlyMinutes, straight] of [[0, 0], [240, 8_000], [2_400, 82_000], [420, 12_915]] as const) for (const heads of [0, 1, 3]) {
        const f = figure({ sales: { basis: "forecast", cents: sales }, salariedCents: salaried, hourlyMinutes, straightCents: straight, otPremiumCents: premium, pureHourlyCents: straight + premium });
        const t = target(views(f, basis), { need: floorNeed(heads, 18), shifts: [], shopEstimateHourlyCents: 1_840 });
        if (t.state !== "ok") throw new Error(`not ok: ${basis} ${sales} ${salaried}`);
        cases++;
        const one = (key: string) => { const ls = t.lines.filter((l) => l.key === key); expect(ls.length, key).toBeLessThanOrEqual(1); return ls[0]?.params as Record<string, number> | undefined; };
        const total = one("schedule.labor.views_allowance_total"), hourly = one("schedule.labor.views_allowance_hourly");
        expect(!!total !== !!hourly).toBe(true);
        expect(!!total).toBe(basis === "total" && salaried !== null);
        const allowance = total ? total.allowanceCents! : hourly!.allowanceCents!;
        if (total) expect(Math.round((total.salesCents! * total.targetPct!) / 100 / (1 + total.burdenPct! / 100)) - total.salariedDayCents!).toBe(allowance);
        else expect(Math.round((hourly!.salesCents! * hourly!.targetPct!) / 100)).toBe(allowance);
        expect(t.maxLaborCents).toBe(allowance);
        // Salaries above the target: said, with the cap they exceed; never hidden behind a 0.
        const over = one("schedule.labor.views_salaries_over_target");
        expect(!!over).toBe(allowance < 0);
        if (over) { negative++; expect(over.capCents! - over.salariedDayCents!).toBe(allowance); expect(over.overCents).toBe(-allowance); }
        // The hours: an equation only when something is left; otherwise the subtraction, and 0 hours.
        const exactWage = hourlyMinutes > 0 ? straight / (hourlyMinutes / 60) : 1_840;
        const hours = one("schedule.labor.views_max_hours"), none = one("schedule.labor.views_no_hours");
        expect(!!hours !== !!none).toBe(true);
        const remaining = allowance - premium;
        if (hours) {
          expect(remaining).toBeGreaterThan(0);
          expect(hours).toEqual({ allowanceCents: allowance, premiumCents: premium, wageExactCents: Math.round(exactWage), hours: Math.round((remaining / exactWage) * 10) / 10 });
          expect(t.maxHours).toBe(hours.hours);
        } else {
          noHours++;
          expect(remaining).toBeLessThanOrEqual(0);
          expect(none).toEqual({ allowanceCents: allowance, premiumCents: premium, remainingCents: remaining });
          expect(t.maxHours).toBe(0);
        }
        // The verdict: the projected pure hourly $ against the SIGNED allowance.
        const under = one("schedule.labor.views_verdict_under"), above = one("schedule.labor.views_verdict_over");
        expect(!!under !== !!above).toBe(true);
        const projected = straight + premium;
        expect(!!above).toBe(projected > allowance);
        expect((above ?? under)!).toEqual({ projectedCents: projected, allowanceCents: allowance, diffCents: Math.abs(projected - allowance) });
        // The minimum crews: warned exactly when their straight-time cost does not fit in what is left, and the line says THAT.
        const minHours = (heads * 18) / 4;
        const math = one("schedule.labor.views_minimums_over_math");
        expect(!!math).toBe(minHours * exactWage > Math.max(0, remaining) + 1e-6);
        expect(!!one("schedule.labor.minimums_over_target")).toBe(!!math);
        expect(one("schedule.labor.minimums_over_target_math")).toBeUndefined();
        if (math) {
          minimums++;
          expect(math).toEqual({ minHours, wageExactCents: Math.round(exactWage), minCostCents: Math.round(minHours * exactWage), remainingCents: remaining, allowanceCents: allowance, premiumCents: premium });
          expect(math.minCostCents!).toBeGreaterThanOrEqual(Math.max(0, math.remainingCents!));
        }
      }
    expect(cases).toBe(2 * 3 * 4 * 3 * 4 * 3);
    for (const n of [negative, minimums, noHours]) expect(n).toBeGreaterThan(10);
  });
  it("r1: the wage in an equation is shown to the cent (a $20.50 wage is never '$21'), so the line's arithmetic reads true", () => {
    const html = renderBoard({ state: "ready", ...boardView(gmSource()) }, "en", { initialDate: DATES[2] });
    const card = text(html.slice(html.indexOf('data-section="labor-target"')));
    expect(card).toContain("($875 − $10) ÷ $20.50/h = 42.2 h");
    expect(card).not.toContain("$21/h");
  });
  it("every new line key is in the closed list with en + es and the same params", () => {
    const keys = LABOR_LINE_KEYS.filter((k) => k.includes(".views_"));
    expect(keys).toHaveLength(9);
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
    for (const k of keys) {
      expect(EN[k], k).toBeTruthy();
      expect(params(ES[k]!), k).toEqual(params(EN[k]!));
    }
    // Every param a line carries is one its string uses (nothing computed is dropped, nothing shown is missing).
    for (const t of [target(views(figure())), target(views(figure(), "hourly")), target(views(figure({ salariedCents: null })))]) {
      if (t.state !== "ok") throw new Error("not ok");
      for (const l of t.lines.filter((x) => x.key.includes(".views_"))) expect(Object.keys(l.params ?? {}).sort(), l.key).toEqual(params(EN[l.key]!));
    }
  });
});

// ── 2. The view-model ───────────────────────────────────────────────────────────────────────────

const TODAY = DATES[2]!; // Wednesday: Mon is actual, Tue is not settled, Wed..Sat projected, Sun has no schedule
const KINDS: BoardLaborDay["kind"][] = ["actual", "not_settled", "projected", "projected", "projected", "projected", "no_schedule"];
const readyViews = (): BoardLaborViewsReady => ({
  state: "ready", targets: TARGETS,
  days: DATES.map((date, i): BoardLaborDay => {
    const kind = KINDS[i]!;
    const f = kind === "actual" ? figure({ sales: { basis: "actual", cents: 500_000 }, otState: "assessed", pureHourlyPct: 16.6, pureHourlyTone: "good", fullyLoadedPct: 23.1, burdenEstimated: false })
      : kind === "projected" ? (i === 3 ? unknownMoney(["wage_unknown"]) : figure()) : hoursOnly(kind);
    return { ...f, date, kind };
  }),
  strip: {
    actual: { ...figure({ sales: { basis: "actual", cents: 500_000 }, otState: "assessed", pureHourlyPct: 16.6, pureHourlyTone: "none", fullyLoadedPct: 23.1, fullyLoadedTone: "none", reasons: ["partial_week"] }), days: 1 },
    projected: { ...figure({ fullyLoadedPct: 31.5, fullyLoadedTone: "watch", salaryGaps: 2, rateEstimated: true, salaryProjected: true }), days: 4 },
    notSettledDays: 1, noScheduleDays: 1,
  },
});
const gmSource = (v: BoardLaborViews = readyViews(), subDayMoney = false, over: Parameters<typeof boardSource>[0] = {}) =>
  boardSource({ today: TODAY, laborViews: { views: v, subDayMoney, basis: "total" }, ...over });

describe("who sees labor money per hour (Juan: sub-day $ and % need person_money)", () => {
  const actor = (role: PeopleActor["role"], level: number, locations: string[]): PeopleActor => ({ userId: "u", role, level, locations });
  it("MoO / Owner / CGS by trusted ROLE, at a shop they may see money for; a GM (even of that shop) and an AGM never", () => {
    expect(canSeeSubDayLaborMoney(actor("moo", 8, []), "shop-a")).toBe(true);
    expect(canSeeSubDayLaborMoney(actor("owner", 10, []), "shop-a")).toBe(true);
    expect(canSeeSubDayLaborMoney(actor("cgs", 9, []), "shop-a")).toBe(true);
    expect(canSeeSubDayLaborMoney(actor("gm", 7, ["shop-a"]), "shop-a")).toBe(false);
    expect(canSeeSubDayLaborMoney(actor("agm", 6, ["shop-a"]), "shop-a")).toBe(false);
    // A level alone never admits: a level-8 actor whose ROLE is not MoO is refused.
    expect(canSeeSubDayLaborMoney(actor("gm", 8, ["shop-a"]), "shop-a")).toBe(false);
    expect(canSeeSubDayLaborMoney(actor("social_media_mgr", 6, ["shop-a"]), "shop-a")).toBe(false);
  });
});

describe("the view-model with the labor views: the board prices no labor", () => {
  it("a GM: no strip money, no tab %, no labor $ / % per hour, no forecast $ per hour; hours per hour; the views as loaded", () => {
    const src = gmSource();
    const v = boardView(src);
    expect(v.laborViews).toEqual(src.laborViews!.views);
    expect(v.strip!.money).toBeUndefined();
    expect(v.tabs.every((t) => !("hourlyPct" in t))).toBe(true);
    for (const d of v.days.filter((x) => x.hours.length > 0)) {
      expect(d.laborByHour).toBeNull();
      expect("centsByHour" in d).toBe(false);
      expect(d.hoursByHour!.map((h) => h.hour)).toEqual(d.hours);
    }
    const json = JSON.stringify(v);
    // Outside `laborViews` and the day's labor card, no money key at all.
    const rest = JSON.parse(json) as Record<string, unknown>;
    delete rest.laborViews;
    for (const d of rest.days as Array<Record<string, unknown>>) delete d.labor;
    const noCard = JSON.stringify(rest);
    expect(noCard).not.toMatch(/"(money|hourlyCostCents|hourlyPct|salariedFixedCents|totalPct|centsByHour|wageCentsByUser|[A-Za-z]*Cents|pct)"/);
  });
  it("hours per hour = the scheduled hours on the clock in that hour (every person, never a wage)", () => {
    const src = gmSource();
    const v = boardView(src);
    const d = v.days.find((x) => x.date === DATES[3])!;
    const shifts = src.week!.shifts.filter((s) => s.date === DATES[3]);
    for (const { hour, hours } of d.hoursByHour!) {
      const q = shifts.reduce((n, s) => n + Math.max(0, Math.min(s.endQ, (hour + 1) * 4) - Math.max(s.startQ, hour * 4)), 0);
      expect(hours).toBe(q / 4);
    }
    expect(d.hoursByHour!.some((h) => h.hours > 0)).toBe(true);
    // The same hours with the board's wages wiped: nothing about them is priced.
    expect(boardView({ ...src, wageCentsByUser: {} }).days.find((x) => x.date === DATES[3])!.hoursByHour).toEqual(d.hoursByHour);
  });
  it("a MoO (sub-day money): straight-time % per hour and the forecast $ per hour stay; still no strip money and no tab %", () => {
    const v = boardView(gmSource(readyViews(), true));
    const d = v.days.find((x) => x.date === DATES[3])!;
    expect(d.laborByHour!.length).toBe(d.hours.length);
    expect(d.centsByHour!.length).toBe(d.hours.length);
    expect(d.hoursByHour!.length).toBe(d.hours.length);
    expect(v.strip!.money).toBeUndefined();
    expect(v.tabs.every((t) => !("hourlyPct" in t))).toBe(true);
  });
  it("the labor card: the views' lines on a known day; the projection's reason on a withheld one; the state when the views are not ready", () => {
    const v = boardView(gmSource());
    const card = (date: string) => v.days.find((x) => x.date === date)!.labor!;
    const known = card(DATES[2]!);
    expect(known.state).toBe("ok");
    if (known.state === "ok") {
      expect(known.lines.map((l) => l.key)).toEqual(expect.arrayContaining(["schedule.labor.views_allowance_total", "schedule.labor.views_max_hours", "schedule.labor.views_verdict_under"]));
      expect(known.lines.some((l) => /schedule\.labor\.(max_labor|minus_salaried|max_hours)$/.test(l.key))).toBe(false);
    }
    expect(card(DATES[1]!)).toEqual({ state: "views_unknown", errand: { key: "schedule.labor_views.reason.not_settled" } });
    expect(card(DATES[3]!)).toEqual({ state: "views_unknown", errand: { key: "schedule.labor_views.reason.wage_unknown" } });
    expect(card(DATES[6]!)).toEqual({ state: "views_unknown", errand: { key: "schedule.labor_views.reason.no_schedule" } });
    for (const state of ["rebuilding", "unavailable", "not_installed"] as const) {
      const r = boardView(gmSource({ state }));
      expect(r.laborViews).toEqual({ state });
      for (const d of r.days.filter((x) => x.labor)) expect(d.labor).toEqual({ state: "views_unknown", errand: { key: `schedule.labor_views.state.${state}` } });
      expect(r.strip!.money).toBeUndefined();
    }
  });
  it("the card's verdict does not move with the board's own wages or salary estimate (they are not read)", () => {
    const a = boardView(gmSource());
    const b = boardView(gmSource(readyViews(), false, { wageCentsByUser: {}, shopEstimateHourlyCents: null, salariedWeeklyCents: null }));
    expect(b.days.map((d) => d.labor)).toEqual(a.days.map((d) => d.labor));
  });
  it("no week yet: the views still ride (settled days can exist without a schedule)", () => {
    const v = boardView(gmSource(readyViews(), false, { week: null }));
    expect(v.laborViews?.state).toBe("ready");
    expect(v.strip).toBeNull();
  });
  it("without the views every byte is what it was; and a viewer without money never gets them, even if handed over", () => {
    const base = boardSource({ today: TODAY });
    expect(JSON.stringify(boardView({ ...base, laborViews: undefined }))).toBe(JSON.stringify(boardView(base)));
    const plain = boardView(base);
    expect("laborViews" in plain).toBe(false);
    expect(plain.strip!.money).toBeDefined();
    expect(plain.days.every((d) => !("hoursByHour" in d))).toBe(true);
    const agmPerms = { canSeeMoney: false, canApprove: false, canEditStructure: false };
    expect(JSON.stringify(boardView(gmSource(readyViews(), true, { perms: agmPerms })))).toBe(JSON.stringify(boardView(boardSource({ today: TODAY, perms: agmPerms }))));
  });
});

describe("the WHOLE serialized board with the views is an allowlist (every generator fixture)", () => {
  function keyPaths(v: unknown, p: string, out: Set<string>): Set<string> {
    if (Array.isArray(v)) { for (const x of v) keyPaths(x, `${p}[]`, out); return out; }
    if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) keyPaths(x, `${p}.${p === ".names" || p === ".positions" || p.endsWith(".byDate") ? "*" : k}`, out); return out; }
    out.add(p);
    return out;
  }
  // Every other day's salaries alone are above the target, so every line the card can write is emitted somewhere.
  const allProjected = (): BoardLaborViewsReady => ({ state: "ready", targets: TARGETS, days: DATES.map((date, i) => ({ ...figure(i % 2 ? { salariedCents: 200_000 } : {}), date, kind: "projected" as const })),
    strip: { actual: null, projected: { ...figure(), days: 7 }, notSettledDays: 0, noScheduleDays: 0 } });
  const extrasOf = (subDayMoney: boolean) => {
    const base = new Set<string>([...AGM_BOARD_PATHS, ...BOARD_LABOR_VIEW_PATHS.map((p) => `.laborViews${p}`)]);
    const extra = new Set<string>();
    for (const f of Object.keys(FIXTURES)) {
      const view = JSON.parse(JSON.stringify(boardView(boardSource({ today: TODAY, laborViews: { views: allProjected(), subDayMoney, basis: "total" } }, f))));
      for (const p of keyPaths(view, "", new Set())) if (!base.has(p)) extra.add(p);
    }
    return [...extra].sort();
  };
  it("a GM: the AGM's paths + laborViews + hours per hour + the labor card's DAY figures; nothing per hour or per window in $ or %", () => {
    expect(extrasOf(false)).toEqual([...GM_VIEWS_BOARD_EXTRA_PATHS].sort());
    expect(GM_VIEWS_BOARD_EXTRA_PATHS.filter((p) => /laborByHour|centsByHour|windows\[\]|strip|tabs/.test(p))).toEqual([]);
  }, 120000);
  it("MoO / Owner / CGS: the GM's paths + straight-time % per hour, the forecast $ per hour and the card's per-window intermediates", () => {
    expect(extrasOf(true)).toEqual([...GM_VIEWS_BOARD_EXTRA_PATHS, ...SUB_DAY_VIEWS_BOARD_EXTRA_PATHS].sort());
  }, 120000);
});

// ── 3. The render ───────────────────────────────────────────────────────────────────────────────

const page = (src = gmSource()): PageView => ({ state: "ready", ...boardView(src) });

describe("the week strip: three lines, never blended", () => {
  it("'Actual, 1 of 7 days' (no tone: part of the week), 'Projected, 4 days', the days not settled as a COUNT, the days with no schedule", () => {
    const html = renderBoard(page());
    const t = text(html);
    expect(t).toContain(EN["schedule.labor_views.title.week"]);
    expect(t).toContain(fill(EN["schedule.labor_views.strip.actual"]!, { n: 1 }));
    expect(t).toContain(fill(EN["schedule.labor_views.strip.projected"]!, { n: 4 }));
    expect(t).toContain(fill(EN["schedule.labor_views.strip.not_settled"]!, { n: 1 }));
    expect(t).toContain(fill(EN["schedule.labor_views.strip.no_schedule"]!, { n: 1 }));
    expect(t).toContain(fill(EN["schedule.labor_views.strip.ot_estimated"]!, { n: 1 }));
    // The actual line: its numbers, its 'part of the week' reason, and NO tone word (toned only at 7 of 7).
    const actual = html.slice(html.indexOf('data-labor-strip="actual"'), html.indexOf('data-labor-strip="projected"'));
    expect(text(actual)).toContain("23.1%");
    expect(text(actual)).toContain("16.6%");
    expect(text(actual)).toContain(EN["schedule.labor_views.reason.partial_week"]);
    expect(actual).toContain('data-tone="none"');
    expect(text(actual)).not.toContain(EN["schedule.board.labor.good"]);
    // The projected line: toned with its WORD, its flags always visible.
    const projected = html.slice(html.indexOf('data-labor-strip="projected"'), html.indexOf('data-labor-strip="not_settled"'));
    expect(text(projected)).toContain("31.5%");
    expect(text(projected)).toContain(EN["schedule.board.labor.watch"]);
    expect(text(projected)).toContain(fill(EN["schedule.labor_views.flag.salary_gaps"]!, { n: 2 }));
    expect(text(projected)).toContain(EN["schedule.labor_views.flag.rate_estimated"]);
    expect(text(projected)).toContain(EN["schedule.labor_views.salary_projected"]);
    expect(text(projected)).toContain(fill(EN["schedule.labor_views.target"]!, { pct: 28 }));
    expect(text(projected)).toContain(fill(EN["schedule.labor_views.target"]!, { pct: 18 }));
  });
  it("with the views the strip never says 'only GMs and above see labor cost', and shows none of the board's own money metrics", () => {
    const t = text(renderBoard(page()));
    expect(t).not.toContain(EN["schedule.board.money.hidden"]);
    const html = renderBoard(page());
    for (const k of ["schedule.board.money.hourly_cost", "schedule.board.money.total_pct", "schedule.board.money.salaried", "schedule.board.money.overtime_premium"]) expect(html).not.toContain(`data-metric="${EN[k]}"`);
    // The same metrics ARE there without the views (the check above is not vacuous).
    expect(renderBoard({ state: "ready", ...boardView(boardSource({ today: TODAY })) })).toContain(`data-metric="${EN["schedule.board.money.hourly_cost"]}"`);
    expect(t).toContain(EN["schedule.board.money.hours_vs_budget"]);
  });
  it.each(["rebuilding", "unavailable", "not_installed"] as const)("views '%s': ONE named status line, no figure, no $; the board still renders", (state) => {
    const html = renderBoard(page(gmSource({ state })));
    expect(html).toContain(`data-labor-state="${state}"`);
    expect(text(html)).toContain(EN[`schedule.labor_views.state.${state}`]);
    expect(html).not.toContain("data-labor-figure");
    expect(html).not.toContain('data-section="labor-day"');
    expect(html).toContain('data-section="timeline"');
    expect(text(html)).toContain(EN[`schedule.labor_views.state.${state}`]);
  });
});

describe("the day card and the day tabs", () => {
  const dayCard = (html: string) => html.slice(html.indexOf('data-section="labor-day"'), html.indexOf('data-section="labor-target"'));
  it("the selected day: its kind, FULLY LOADED first then pure hourly, each with its target; hours; the breakdown collapsed behind a 44 px row", () => {
    const html = renderBoard(page(), "en", { initialDate: DATES[2] });
    const card = dayCard(html);
    expect(card).toContain('data-labor-kind="projected"');
    expect(text(card)).toContain(EN["schedule.labor_views.kind.projected"]);
    expect(card.indexOf('data-labor-view="fully_loaded"')).toBeLessThan(card.indexOf('data-labor-view="pure_hourly"'));
    expect(text(card)).toContain("26.8%");
    expect(text(card)).toContain("19.3%");
    expect(text(card)).toContain("$1,154");
    expect(text(card)).toContain("48 h");
    expect(text(card)).toContain(EN["schedule.labor_views.ot.projected"]);
    expect(text(card)).toContain(EN["schedule.labor_views.flag.burden_estimated"]);
    const toggle = /<button[^>]*data-act="labor-detail"[^>]*>/.exec(card)![0];
    expect(toggle).toContain('aria-expanded="false"');
    expect(toggle).toContain("min-h-[44px]");
    expect(toggle).toContain("w-full");
    expect(card).not.toContain("data-labor-detail=");
  });
  it("a withheld day is '—' with its reason, never $0 and never a tone; an hours-only day shows its hours and says so", () => {
    const noWage = dayCard(renderBoard(page(), "en", { initialDate: DATES[3] }));
    expect(text(noWage)).toContain(EN["schedule.labor_views.reason.wage_unknown"]);
    expect(noWage).not.toContain("$0");
    expect(noWage.match(/data-tone="none"/g)).toHaveLength(2);
    expect(noWage).toContain('data-act="labor-detail"');
    expect(text(noWage)).not.toContain(EN["schedule.board.labor.good"]);
    const notSettled = dayCard(renderBoard(page(), "en", { initialDate: DATES[1] }));
    expect(notSettled).toContain('data-labor-kind="not_settled"');
    expect(text(notSettled)).toContain(EN["schedule.labor_views.kind.not_settled"]);
    expect(text(notSettled)).toContain(EN["schedule.labor_views.reason.not_settled"]);
    expect(text(notSettled)).toContain("32 h");
    expect(notSettled).not.toContain("$");
    expect(text(notSettled)).not.toContain("%");
    expect(notSettled).not.toContain("data-labor-view=");
    expect(notSettled).not.toContain('data-act="labor-detail"');
    const none = dayCard(renderBoard(page(), "en", { initialDate: DATES[6] }));
    expect(text(none)).toContain(EN["schedule.labor_views.reason.no_schedule"]);
    expect(none).not.toContain("$");
  });
  it("an actual day says 'Actual' and names its sales as net sales", () => {
    const card = dayCard(renderBoard(page(), "en", { initialDate: DATES[0] }));
    expect(card).toContain('data-labor-kind="actual"');
    expect(text(card)).toContain("23.1%");
    expect(text(card)).toContain(EN["schedule.board.labor.good"]);
  });
  it("the tabs: kind, fully loaded as the headline and pure hourly beneath; unknown is '—'; hours-only days say so; no '% hourly' of the board's own", () => {
    const html = renderBoard(page());
    const tab = (date: string) => { const i = html.indexOf(`data-date="${date}"`); return html.slice(i, html.indexOf("</button>", i)); };
    expect(tab(DATES[0]!)).toContain('data-tab-labor="actual"');
    expect(text(tab(DATES[0]!))).toContain(fill(EN["schedule.labor_views.tab.loaded"]!, { pct: 23.1 }));
    expect(text(tab(DATES[0]!))).toContain(fill(EN["schedule.labor_views.tab.hourly"]!, { pct: 16.6 }));
    expect(text(tab(DATES[2]!))).toContain(EN["schedule.labor_views.tab.projected"]);
    expect(tab(DATES[2]!).indexOf("26.8")).toBeLessThan(tab(DATES[2]!).indexOf("19.3"));
    expect(text(tab(DATES[3]!))).toContain(EN["schedule.labor_views.tab.loaded_unknown"]);
    expect(text(tab(DATES[3]!))).toContain(EN["schedule.labor_views.tab.hourly_unknown"]);
    expect(tab(DATES[3]!)).not.toContain("%");
    expect(text(tab(DATES[1]!))).toContain(EN["schedule.labor_views.kind.not_settled"]);
    expect(text(tab(DATES[6]!))).toContain(EN["schedule.labor_views.kind.no_schedule"]);
    expect(tab(DATES[1]!)).not.toContain("%");
  });
});

describe("the timeline: hours per hour for a GM; straight-time % per hour, labelled so, for MoO and up", () => {
  it("a GM: the hours row, the note saying who sees $ and % by hour, and NO labor % row", () => {
    const html = renderBoard(page(), "en", { initialDate: DATES[3] });
    expect(text(html)).toContain(EN["schedule.labor_views.timeline.hours"]);
    expect(html).toContain("data-hours-hour=");
    expect(text(html)).toContain(EN["schedule.labor_views.hour_money_note"]);
    expect(html).not.toContain("data-labor-tone=");
    expect(text(html)).not.toContain(EN["schedule.board.timeline.labor_label"]);
    expect(text(html)).not.toContain(EN["schedule.labor_views.timeline.straight_pct"]);
  });
  it("a MoO: the same hours row plus the % row relabelled 'Straight time % by hour (before overtime)'; no note", () => {
    const html = renderBoard(page(gmSource(readyViews(), true)), "en", { initialDate: DATES[3] });
    expect(html).toContain("data-hours-hour=");
    expect(html).toContain("data-labor-tone=");
    expect(text(html)).toContain(EN["schedule.labor_views.timeline.straight_pct"]);
    expect(text(html)).not.toContain(EN["schedule.board.timeline.labor_label"]);
    expect(text(html)).not.toContain(EN["schedule.labor_views.hour_money_note"]);
  });
  it("without the views the timeline is what it was ('Labor % by hour', no hours row)", () => {
    const html = renderBoard({ state: "ready", ...boardView(boardSource({ today: TODAY })) }, "en", { initialDate: DATES[3] });
    expect(text(html)).toContain(EN["schedule.board.timeline.labor_label"]);
    expect(html).not.toContain("data-hours-hour=");
    expect(html).not.toContain('data-section="labor-views"');
    expect(html).not.toContain('data-section="labor-day"');
    expect(html).not.toContain("data-tab-labor");
  });
});

describe("the labor card with the views; en + es", () => {
  it("the allowance, the hours at this draft's overtime and the verdict render in dollars; a withheld day shows the projection's reason", () => {
    const html = renderBoard(page(), "en", { initialDate: DATES[2] });
    const card = text(html.slice(html.indexOf('data-section="labor-target"')));
    expect(card).toContain("$4,300 × 28% ÷ (1 + 12%) − $200 = $875");
    expect(card).toContain("($875 − $10) ÷ $20.50/h = 42.2 h");
    expect(card).toContain("$830: $45 under the $875 allowance");
    const withheld = renderBoard(page(), "en", { initialDate: DATES[3] });
    expect(text(withheld.slice(withheld.indexOf('data-section="labor-target"')))).toContain(EN["schedule.labor_views.reason.wage_unknown"]);
  });
  it("es: the same structure, every label translated (tú), nothing left in English", () => {
    const enHtml = renderBoard(page(), "en", { initialDate: DATES[2] });
    const esHtml = renderBoard(page(), "es", { initialDate: DATES[2] });
    expect((esHtml.match(/<button/g) ?? []).length).toBe((enHtml.match(/<button/g) ?? []).length);
    const t = text(esHtml);
    for (const k of ["schedule.labor_views.title.week", "schedule.labor_views.title.day", "schedule.labor_views.view.fully_loaded", "schedule.labor_views.view.pure_hourly",
      "schedule.labor_views.kind.projected", "schedule.labor_views.detail", "schedule.labor_views.timeline.hours", "schedule.labor_views.hour_money_note",
      "schedule.labor_views.flag.burden_estimated", "schedule.labor_views.ot.projected"]) {
      expect(t, k).toContain(ES[k]);
      expect(ES[k], k).not.toBe(EN[k]);
    }
    expect(t).toContain(fill(ES["schedule.labor_views.strip.actual"]!, { n: 1 }));
    expect(t).toContain(fill(ES["schedule.labor_views.tab.loaded"]!, { pct: 26.8 }));
    for (const k of ["schedule.labor_views.title.week", "schedule.labor_views.detail", "schedule.labor_views.hour_money_note"]) expect(t).not.toContain(EN[k]);
    for (const k of Object.keys(ES).filter((x) => x.startsWith("schedule.labor_views.") || x.startsWith("schedule.labor.views_"))) expect(ES[k], k).not.toMatch(/\busted(es)?\b/i);
  });
});
