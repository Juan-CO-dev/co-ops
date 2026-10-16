/**
 * THE LABOR-TARGET CARD — pure (Scheduling Phase 2, Task 10; spec §6.6, plan "Labor-target card").
 *
 *   maxLabor$ = forecast sales × target %  (− the day's share of the salaried weekly cost on the TOTAL basis, R4)
 *   maxHours  = maxLabor$ ÷ blended wage     (the hours-weighted mean wage on the draft, else the shop estimate)
 *   per window: spread = maxHours × the window's share of the demand curve ÷ its length (heads);
 *               optimal = [minimum crew, ceil(spread)] — the minimum crew wins when it is higher ("Minimum crew
 *               needs more than the target allows", amber note); the draft's heads on against it, amber when
 *               over the target or under the minimum crew.
 *
 * Every line is an i18n KEY + numeric params (`LABOR_LINE_KEYS`, closed; the en + es strings are Task 15's, as
 * for the rule and reason keys). Unknown forecast / wage are named states with their errand, never a 0. Without
 * money permission (the AGM, J1) every $-bearing line and field is ABSENT; the windows' heads stay.
 */
import type { NarrativeLine } from "@/lib/people-narrative";
import type { DayNeed, RulePerson } from "./context-shared";
import { MOD, type Shift } from "./rules-shared";
import type { ScheduleStructure } from "./structure-shared";
import { Q_PER_HOUR } from "./time-shared";

export const LABOR_LINE_KEYS = [
  "schedule.labor.max_labor", "schedule.labor.minus_salaried", "schedule.labor.max_hours",
  "schedule.labor.window", "schedule.labor.floor_over_target", "schedule.labor.window_under_floor", "schedule.labor.window_over_target",
  "schedule.labor.errand.no_forecast", "schedule.labor.errand.set_wage_estimate",
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
}

export interface LaborWindow {
  key: string;
  fromQ: number;
  toQ: number;
  demandShare: number;
  spreadHeads: number;
  floorHeads: number;
  optimal: { min: number; max: number };
  floorOverTarget: boolean;
  /** The most heads on the floor (non-MoD) at any quarter of the window (display only — never the tone). */
  on: number;
  /** The fewest heads on the floor at any quarter of the window. */
  onMin: number;
  /** Astra chunk C P2: quarters below the minimum crew AT THAT QUARTER, and quarters above max(that floor, ceil(spread)). */
  shortQuarters: number;
  overQuarters: number;
  /** Why the window is amber, in a fixed order; empty when good. */
  amberReasons: Array<"under_floor" | "over_target" | "floor_over_target">;
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
  | { state: "no_wage"; errand: NarrativeLine };

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

export function laborTarget(input: LaborTargetInput, opts: { canSeeMoney: boolean }): LaborTarget {
  const d = input.demand;
  if (d.kind !== "ok" || d.dayCents <= 0) return { state: "no_forecast", errand: { key: "schedule.labor.errand.no_forecast" } };
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

  const windows: LaborWindow[] = input.windows.map((w) => {
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
    const floorOverTarget = ceilSpread < floorHeads;
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
    const amberReasons: LaborWindow["amberReasons"] = [];
    if (shortQuarters > 0) amberReasons.push("under_floor");
    if (overQuarters > 0) amberReasons.push("over_target");
    if (floorOverTarget) amberReasons.push("floor_over_target");
    const tone: LaborWindow["tone"] = amberReasons.length > 0 ? "amber" : "good";
    return {
      key: w.key, fromQ: w.fromQ, toQ: w.toQ, demandShare, spreadHeads, floorHeads, optimal, floorOverTarget,
      on, onMin: Number.isFinite(onMin) ? onMin : 0, shortQuarters, overQuarters, amberReasons, tone,
    };
  });

  const lines: NarrativeLine[] = [];
  if (opts.canSeeMoney) {
    lines.push({ key: "schedule.labor.max_labor", params: { salesCents: d.dayCents, targetPct, maxLaborCents: gross } });
    if (basis === "total") lines.push({ key: "schedule.labor.minus_salaried", params: { salariedDayCents, maxLaborCents } });
    lines.push({ key: "schedule.labor.max_hours", params: { maxLaborCents, wageCents: blendedWageCents, hours: round1(maxHoursExact) } });
  }
  for (const w of windows) {
    lines.push({ key: "schedule.labor.window", params: { window: w.key, on: w.on, min: w.optimal.min, max: w.optimal.max } });
    if (w.shortQuarters > 0) lines.push({ key: "schedule.labor.window_under_floor", params: { window: w.key, hours: w.shortQuarters / Q_PER_HOUR, floor: w.floorHeads } });
    if (w.overQuarters > 0) lines.push({ key: "schedule.labor.window_over_target", params: { window: w.key, hours: w.overQuarters / Q_PER_HOUR, max: w.optimal.max } });
    if (w.floorOverTarget) lines.push({ key: "schedule.labor.floor_over_target", params: { window: w.key, floor: w.floorHeads } });
  }
  if (!opts.canSeeMoney) return { state: "ok", windows, lines };
  return { state: "ok", windows, lines, maxLaborCents, salariedDayCents, blendedWageCents, maxHours: round1(maxHoursExact) };
}
