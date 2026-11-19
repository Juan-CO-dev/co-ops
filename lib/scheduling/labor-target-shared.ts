/**
 * THE LABOR-TARGET CARD — pure (Scheduling Phase 2, Task 10; spec §6.6, plan "Labor-target card").
 *
 *   maxLabor$ = forecast sales × target %  (− the day's share of the salaried weekly cost on the TOTAL basis, R4)
 *   maxHours  = maxLabor$ ÷ blended wage     (the hours-weighted mean wage on the draft, else the shop estimate)
 *   per window: spread = maxHours × the window's share of the demand curve ÷ its length (heads);
 *               optimal = [minimum crew, max(minimum crew, ceil(spread))] — never below the minimum crew; the
 *               draft's heads on against it. AMBER only when the window is over its optimal AND above its minimum
 *               (CC chunk G: under the minimum is a coverage problem, red on the coverage row, named here plainly).
 *   per day:    when the minimum crews ALONE cost more than the target allows, ONE note with its math line — never a
 *               per-window "already over the target" line (CC chunk G). Only the minimum head-hours NOT covered by
 *               salaried / presence people on the floor are priced, hourly, against the hourly allowance (Astra G P2-1).
 *
 * BOARD TWO LABOR VIEWS, PR 3 (plan r4 "Heads budget"; dark behind SCHEDULE_LABOR_VIEWS): with `views` the card stops
 * pricing labor itself. The day's money comes from the labor facts' own projection (the SAME figure the day tab and the
 * day card show), and the allowance is cut from the same denominator:
 *   total basis:  allowance = sales x fully loaded target / (1 + burden %) - the day's salaries   (fully loaded <= target)
 *                 (salaries unknown -> the PURE-HOURLY target instead, and the card says so)
 *   hourly basis: allowance = sales x pure-hourly target
 *   max hours  = (allowance - the projected overtime premium) / the blended STRAIGHT wage, "at this draft's overtime"
 *   the verdict in dollars: the projected pure hourly $ against the allowance.
 * A figure the projection withholds (not settled, no wage, overtime not assessed, no sales) is the card's errand, named
 * by the projection's own reason (never a 0). Only money viewers ever take this path (an AGM's board has no views).
 *
 * Every line is an i18n KEY + numeric params (`LABOR_LINE_KEYS`, closed; the en + es strings are Task 15's, as
 * for the rule and reason keys). Unknown forecast / wage are named states with their errand, never a 0. Without
 * money permission (the AGM, J1) every $-bearing line and field is ABSENT; the windows' heads stay.
 */
import type { NarrativeLine } from "@/lib/people-narrative";
import type { BoardLaborDayKind, BoardLaborFigure, BoardLaborReason } from "./labor-projection-shared";
import type { DayNeed, RulePerson } from "./context-shared";
import { MOD, type Shift } from "./rules-shared";
import type { ScheduleStructure } from "./structure-shared";
import { Q_PER_DAY, Q_PER_HOUR } from "./time-shared";

export const LABOR_LINE_KEYS = [
  "schedule.labor.max_labor", "schedule.labor.minus_salaried", "schedule.labor.max_hours",
  "schedule.labor.window", "schedule.labor.window_exact", "schedule.labor.window_under_floor", "schedule.labor.window_over_target",
  "schedule.labor.minimums_over_target", "schedule.labor.minimums_over_target_math", "schedule.labor.minimums_over_target_hours",
  "schedule.labor.errand.no_forecast", "schedule.labor.errand.set_wage_estimate",
  // PR 3: the heads maths over the labor views.
  "schedule.labor.views_allowance_total", "schedule.labor.views_allowance_hourly", "schedule.labor.views_salary_fallback",
  "schedule.labor.views_max_hours", "schedule.labor.views_verdict_under", "schedule.labor.views_verdict_over",
] as const;
export type LaborLineKey = (typeof LABOR_LINE_KEYS)[number];

export interface LaborWindowInput { key: string; fromQ: number; toQ: number }

export interface LaborTargetInput {
  date: string;
  demand: { kind: "ok"; hourlyCents: number[]; dayCents: number } | { kind: "no_history" } | { kind: "unavailable" };
  structure: ScheduleStructure;
  /** The day's need grid (the minimum crew per quarter: the line floor + the BOH and closing crews). */
  need: DayNeed;
  windows: LaborWindowInput[];
  /** The draft's shifts that day. */
  shifts: Shift[];
  people: Record<string, RulePerson>;
  wageCentsByUser: Record<string, number | null>;
  shopEstimateHourlyCents: number | null;
  /** The salaried managers' fixed weekly cost; null = not set (money blank on the TOTAL basis, R2). */
  salariedWeeklyCents: number | null;
  /** The week's forecast sales (the day's share of the salaried cost); null → an even 1/7 split. */
  weekForecastCents: number | null;
  /** PR 3: the day's labor-views figure (money viewers with SCHEDULE_LABOR_VIEWS only); its presence replaces the money maths. */
  views?: LaborTargetViews;
}

/** The labor views behind one day's card (PR 3): the day's figure, its kind, the live targets and the target basis. */
export interface LaborTargetViews {
  kind: BoardLaborDayKind;
  figure: BoardLaborFigure;
  basis: "hourly" | "total";
  targets: { hourlyPct: number; loadedPct: number };
}

export interface LaborWindow {
  key: string;
  fromQ: number;
  toQ: number;
  /** Money viewers only: with the exact spread the max hours (and, beside a sales figure, a wage) would be derivable. */
  demandShare?: number;
  spreadHeads?: number;
  floorHeads: number;
  optimal: { min: number; max: number };
  /** The most heads on the floor (non-MoD) at any quarter of the window (display only — never the tone). */
  on: number;
  /** The fewest heads on the floor at any quarter of the window (money viewers only). */
  onMin?: number;
  /** Astra chunk C P2: quarters below the minimum crew AT THAT QUARTER, and quarters above max(that floor, ceil(spread)). Money viewers only. */
  shortQuarters?: number;
  overQuarters?: number;
  /** Why the window is amber; empty when good. Only over the optimal AND above the minimum (CC chunk G). */
  amberReasons: Array<"over_target">;
  tone: "good" | "amber";
}

export type LaborTarget =
  | {
    state: "ok";
    windows: LaborWindow[];
    lines: NarrativeLine[];
    /** Present only with money permission. */
    maxLaborCents?: number;
    salariedDayCents?: number;
    blendedWageCents?: number;
    maxHours?: number;
  }
  | { state: "no_forecast"; errand: NarrativeLine }
  | { state: "no_wage"; errand: NarrativeLine }
  /** PR 3: the labor views withhold a figure the heads maths needs; the errand is the views' own reason line. */
  | { state: "views_unknown"; errand: NarrativeLine };

const round1 = (n: number) => Math.round(n * 10) / 10;
const isHourly = (p: RulePerson | undefined) => !!p && !p.salaried && !p.presenceOnly;

/** The minimum crew at quarter q: the line floor plus the BOH and closing crews of the need grid. */
function floorAt(need: DayNeed, q: number): number {
  let n = need.minHeads[q] ?? 0;
  for (const r of need.sources) if ((r.source === "boh_crew" || r.source === "closing_crew") && r.fromQ <= q && r.toQ > q) n += r.heads;
  return n;
}

function headsOn(shifts: readonly Shift[], q: number): number {
  let n = 0;
  for (const sh of shifts) if (sh.segments.some((g) => g.positionId !== MOD && g.startQ <= q && g.endQ > q)) n++;
  return n;
}

/** Heads on the floor (non-MoD) at q whose hours cost nothing HOURLY: salaried managers and presence people (MoO / Owner). */
function fixedCostHeadsOn(shifts: readonly Shift[], people: Record<string, RulePerson>, q: number): number {
  let n = 0;
  for (const sh of shifts) {
    const p = people[sh.userId];
    if (!p || isHourly(p)) continue;
    if (sh.segments.some((g) => g.positionId !== MOD && g.startQ <= q && g.endQ > q)) n++;
  }
  return n;
}

export function laborTarget(input: LaborTargetInput, opts: { canSeeMoney: boolean; windowDetail?: boolean }): LaborTarget {
  const d = input.demand;
  if (d.kind !== "ok" || d.dayCents <= 0) return { state: "no_forecast", errand: { key: "schedule.labor.errand.no_forecast" } };
  const money = input.views ? viewsMoney(input, input.views) : boardMoney(input, d);
  if ("state" in money) return money;
  const { maxLaborCents, maxHoursExact, blended, blendedWageCents, salariedDayCents, targetPct } = money;

  const windows: Array<Required<LaborWindow>> = input.windows.map((w) => {
    let cents = 0;
    let floorHeads = 0;
    let on = 0;
    let onMin = Infinity;
    for (let q = w.fromQ; q < w.toQ; q++) {
      cents += (d.hourlyCents[Math.floor(q / Q_PER_HOUR)] ?? 0) / Q_PER_HOUR;
      floorHeads = Math.max(floorHeads, floorAt(input.need, q));
      const h = headsOn(input.shifts, q);
      on = Math.max(on, h);
      onMin = Math.min(onMin, h);
    }
    const demandShare = cents / d.dayCents;
    const lengthH = (w.toQ - w.fromQ) / Q_PER_HOUR;
    const spreadHeads = lengthH > 0 ? (maxHoursExact * demandShare) / lengthH : 0;
    const ceilSpread = Math.ceil(spreadHeads - 1e-9);
    const optimal = { min: floorHeads, max: Math.max(floorHeads, ceilSpread) };
    // Astra chunk C P2: judged per QUARTER against that quarter's own floor (and the target ceiling), never the window max.
    let shortQuarters = 0;
    let overQuarters = 0;
    for (let q = w.fromQ; q < w.toQ; q++) {
      const h = headsOn(input.shifts, q);
      const f = floorAt(input.need, q);
      if (h < f) shortQuarters++;
      else if (h > Math.max(f, ceilSpread)) overQuarters++;
    }
    // An over quarter is above max(that quarter's minimum, ceil(spread)): over the optimal AND above the minimum.
    const amberReasons: LaborWindow["amberReasons"] = overQuarters > 0 ? ["over_target"] : [];
    const tone: LaborWindow["tone"] = amberReasons.length > 0 ? "amber" : "good";
    return {
      key: w.key, fromQ: w.fromQ, toQ: w.toQ, demandShare, spreadHeads, floorHeads, optimal,
      on, onMin: Number.isFinite(onMin) ? onMin : 0, shortQuarters, overQuarters, amberReasons, tone,
    };
  });

  // The day's minimum crews alone, priced as HOURLY labor only where salaried / presence people on the floor do not
  // already cover them (Astra chunk G P2-1): Σ over every quarter of max(0, minimum heads − salaried/presence heads on),
  // in hours, against the HOURLY allowance (the salaried cost is already deducted from it on the TOTAL basis).
  let minQ = 0;
  for (let q = 0; q < Q_PER_DAY; q++) minQ += Math.max(0, floorAt(input.need, q) - fixedCostHeadsOn(input.shifts, input.people, q));
  const minHours = minQ / Q_PER_HOUR;
  const minimumsOver = minHours > maxHoursExact + 1e-9;

  const lines: NarrativeLine[] = opts.canSeeMoney ? [...money.lines] : [];
  if (minimumsOver) {
    lines.push({ key: "schedule.labor.minimums_over_target", params: { targetPct } });
    lines.push(opts.canSeeMoney
      ? { key: "schedule.labor.minimums_over_target_math", params: { minHours: round1(minHours), wageCents: blendedWageCents, minCostCents: Math.round(minHours * blended), maxLaborCents } }
      : { key: "schedule.labor.minimums_over_target_hours", params: { minHours: round1(minHours) } });
  }
  for (const w of windows) {
    // Spec §6.6 wording: "Lunch: 5 on, optimal 4–5" · "Close: 3 on, optimal 3" — one number when the range is one.
    lines.push(w.optimal.min === w.optimal.max
      ? { key: "schedule.labor.window_exact", params: { window: w.key, on: w.on, optimal: w.optimal.min } }
      : { key: "schedule.labor.window", params: { window: w.key, on: w.on, min: w.optimal.min, max: w.optimal.max } });
    if (w.shortQuarters > 0) lines.push({ key: "schedule.labor.window_under_floor", params: { window: w.key, hours: w.shortQuarters / Q_PER_HOUR, floor: w.floorHeads } });
    if (w.overQuarters > 0) lines.push({ key: "schedule.labor.window_over_target", params: { window: w.key, hours: w.overQuarters / Q_PER_HOUR, max: w.optimal.max } });
  }
  // Astra chunk F P2-1 (CC): without money permission a window carries ONLY what the card displays — the heads on, the
  // optimal range, the minimum crew, the tone and its reason. No spread, demand share or quarter counts behind them (the
  // lines above were built from the full windows first).
  const shown = () => windows.map(({ key, fromQ, toQ, floorHeads, optimal, on, amberReasons, tone }) => ({ key, fromQ, toQ, floorHeads, optimal, on, amberReasons, tone }));
  if (!opts.canSeeMoney) return { state: "ok", windows: shown(), lines };
  // PR 3 (`windowDetail: false`): a money viewer without labor money per HOUR (a GM with the labor views) keeps the day's
  // figures and gets the windows as displayed only: beside the day's allowance, a window's demand share and exact spread
  // would be that window's labor $.
  return { state: "ok", windows: opts.windowDetail === false ? shown() : windows, lines, maxLaborCents, salariedDayCents, blendedWageCents, maxHours: round1(maxHoursExact) };
}

type DayMoney = { maxLaborCents: number; maxHoursExact: number; blended: number; blendedWageCents: number; salariedDayCents: number; targetPct: number; lines: NarrativeLine[] };
type OkDemand = { kind: "ok"; hourlyCents: number[]; dayCents: number };

/** The card's own money maths (the switch OFF, or an AGM): the draft priced by the board's wages. */
function boardMoney(input: LaborTargetInput, d: OkDemand): DayMoney | { state: "no_wage"; errand: NarrativeLine } {
  const noWage = { state: "no_wage" as const, errand: { key: "schedule.labor.errand.set_wage_estimate" } };
  // The blended wage: hours-weighted over the draft's hourly people; an unknown wage on the draft blanks the money.
  let wq = 0;
  let q4 = 0;
  for (const sh of input.shifts) {
    if (!isHourly(input.people[sh.userId])) continue;
    const wage = input.wageCentsByUser[sh.userId];
    if (wage === null || wage === undefined) return noWage;
    wq += wage * (sh.endQ - sh.startQ);
    q4 += sh.endQ - sh.startQ;
  }
  const blended = q4 > 0 ? wq / q4 : input.shopEstimateHourlyCents;
  if (blended === null || blended <= 0) return noWage;
  const { targetPct, basis } = input.structure.labor;
  const gross = Math.round((d.dayCents * targetPct) / 100);
  let salariedDayCents = 0;
  if (basis === "total") {
    if (input.salariedWeeklyCents === null) return noWage;
    salariedDayCents = input.weekForecastCents !== null && input.weekForecastCents > 0
      ? Math.round((input.salariedWeeklyCents * d.dayCents) / input.weekForecastCents)
      : Math.round(input.salariedWeeklyCents / 7);
  }
  const maxLaborCents = Math.max(0, gross - salariedDayCents);
  const maxHoursExact = maxLaborCents / blended;
  const blendedWageCents = Math.round(blended);
  const lines: NarrativeLine[] = [{ key: "schedule.labor.max_labor", params: { salesCents: d.dayCents, targetPct, maxLaborCents: gross } }];
  if (basis === "total") lines.push({ key: "schedule.labor.minus_salaried", params: { salariedDayCents, maxLaborCents } });
  lines.push({ key: "schedule.labor.max_hours", params: { maxLaborCents, wageCents: blendedWageCents, hours: round1(maxHoursExact) } });
  return { maxLaborCents, maxHoursExact, blended, blendedWageCents, salariedDayCents, targetPct, lines };
}

/** PR 3: the allowance and the hours over the day's labor-views figure (see the header). */
function viewsMoney(input: LaborTargetInput, v: LaborTargetViews): DayMoney | { state: "views_unknown" | "no_wage"; errand: NarrativeLine } {
  const f = v.figure;
  // The errand is the projection's OWN reason for the figure that is missing (the first of `among` it gave), else the fallback.
  const unknown = (among: readonly BoardLaborReason[], fallback: BoardLaborReason) =>
    ({ state: "views_unknown" as const, errand: { key: `schedule.labor_views.reason.${among.find((r) => f.reasons.includes(r)) ?? fallback}` } });
  if (v.kind !== "actual" && v.kind !== "projected") return unknown([v.kind], v.kind);
  const sales = f.sales.cents;
  if (sales === null) return f.sales.basis === "forecast" ? unknown(["forecast_missing", "zero_sales"], "forecast_missing")
    : unknown(["sales_not_covered", "net_unknown", "ezcater_missing", "zero_sales"], "sales_not_covered");
  if (sales <= 0) return unknown(["zero_sales"], "zero_sales");
  if (f.straightCents === null || f.hourlyMinutes === null || f.otPremiumCents === null || f.pureHourlyCents === null) {
    return unknown(["wage_unknown", "schedule_incomplete", "actuals_rebuilding", "ot_not_assessed", "hours_unknown"], "hours_unknown");
  }
  const hourlyH = f.hourlyMinutes / 60;
  const blended = hourlyH > 0 ? f.straightCents / hourlyH : input.shopEstimateHourlyCents;
  if (blended === null || blended <= 0) return { state: "no_wage", errand: { key: "schedule.labor.errand.set_wage_estimate" } };
  const lines: NarrativeLine[] = [];
  let allowance: number;
  let salariedDayCents = 0;
  let targetPct: number;
  if (v.basis === "total" && f.salariedCents !== null && f.burdenPct !== null) {
    // Fully loaded = (pure hourly + salaries) x (1 + burden) <= sales x target  <=>  pure hourly <= this allowance.
    targetPct = v.targets.loadedPct;
    salariedDayCents = f.salariedCents;
    allowance = Math.max(0, Math.round((sales * targetPct) / 100 / (1 + f.burdenPct / 100)) - salariedDayCents);
    lines.push({ key: "schedule.labor.views_allowance_total", params: { salesCents: sales, targetPct, burdenPct: f.burdenPct, salariedDayCents, allowanceCents: allowance } });
  } else {
    // The hourly basis, or the total basis with the day's salaries unknown: the pure-hourly target, said so.
    targetPct = v.targets.hourlyPct;
    allowance = Math.max(0, Math.round((sales * targetPct) / 100));
    if (v.basis === "total") lines.push({ key: "schedule.labor.views_salary_fallback", params: { targetPct } });
    lines.push({ key: "schedule.labor.views_allowance_hourly", params: { salesCents: sales, targetPct, allowanceCents: allowance } });
  }
  const maxHoursExact = Math.max(0, allowance - f.otPremiumCents) / blended;
  const blendedWageCents = Math.round(blended);
  lines.push({ key: "schedule.labor.views_max_hours", params: { allowanceCents: allowance, premiumCents: f.otPremiumCents, wageCents: blendedWageCents, hours: round1(maxHoursExact) } });
  const diff = f.pureHourlyCents - allowance;
  lines.push(diff > 0
    ? { key: "schedule.labor.views_verdict_over", params: { projectedCents: f.pureHourlyCents, allowanceCents: allowance, diffCents: diff } }
    : { key: "schedule.labor.views_verdict_under", params: { projectedCents: f.pureHourlyCents, allowanceCents: allowance, diffCents: -diff } });
  return { maxLaborCents: allowance, maxHoursExact, blended, blendedWageCents, salariedDayCents, targetPct, lines };
}
