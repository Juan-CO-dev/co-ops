/**
 * Digest LABOR MONEY (digests round 3, PR 4): the PURE half of the labor-money reads (lib/business-labor-core.ts is
 * the I/O half). Zero I/O, no env, no clock.
 *
 * WHAT IT DOES. A pre-load piece keeps a LEDGER of the read results it ACCEPTED (a result enters only if its stage had
 * not ended and the piece had not been snapshotted). `certifyHourly` / `certifyRoleLedger` turn a closed ledger into the
 * facts the composers print. They decide, from what is in the ledger and nothing else, which figure may print.
 *
 * THE RULE (plan §3.2, §11.2.2, §13.2.5, §15.2.4; CC addendum). A figure prints only when every closing check it needs
 * finished and passed:
 *   - a payroll week is USABLE only when it is `ready` in bracket 1 (W1 = currentWeekCoverage(before1, after1, fp1)) AND
 *     `ready` in bracket 2 (W2, the same over bracket 2) AND its generation did not move between the brackets
 *     (X = stableWeekCoverage(after1, after2)). A week missing from a coverage read is `unbuilt`, never usable (Opus P3-3);
 *   - a coverage read of a bracket that is not in the ledger certifies NO week in that bracket: "not available";
 *   - a week whose fingerprint failed, answered something that is not a fingerprint, or did not answer in its stage is
 *     `null` = `stale_source`: that week's figures are "updating"; the other week is judged on its own (§13.2.5, L15);
 *   - the latest final day is chosen ONLY from a complete bracket 1 (all seven day costs, the sales, the structures and
 *     both coverage reads): with one day missing a newer day might be the missing one, so nothing is chosen;
 *   - a chosen day whose week is not usable is NOT re-chosen: it reads "updating" (§11.2.2);
 *   - "no final day in the last 7 days" (`none`) is said only when every payroll week holding one of the seven days is
 *     `ready` in bracket 1 and none of the seven is hours-complete; nothing chosen while a week of the window is not
 *     ready in bracket 1 is "updating" (Opus R-1);
 *   - the last full week needs bracket 1's sales AND structures (Opus N2): a structures read that did not finish is never
 *     read as "no structures" (that would print the default 18 % / 28 % targets).
 * Every span is priced ONLY by the business report's own functions (`daySalesFrom`, `laborDayFigures`,
 * `laborRangeFigures`, the report's `targetsForWeek` handed in as `targetsFor`), so a figure here is the figure the report
 * would print for the same range at that moment (the twin tests, tests/business-labor-core.test.ts). Unknown is never 0:
 * an empty ledger certifies every part `unavailable`.
 */
import {
  currentWeekCoverage, daySalesFrom, laborDayFigures, laborHoursComplete, laborRangeFigures, laborWeekState, payrollWeekStart,
  stableWeekCoverage, type LaborFigures, type LaborWeekCoverageRow, type LaborWeekGenerationRow,
} from "@/lib/business-report-shared";
import type { LaborCostRow, LaborTargets } from "@/lib/facts/labor-cost-shared";
import type { HourlyLaborFacts, LaborSpan, SpanPart } from "@/lib/business-labor-shared";
import { shiftReportDate } from "@/lib/report-range";
import type { DailyRaw } from "@/lib/sales-reports-shared";

/** How many finished days before D bracket 1 reads (the frame ends yesterday; seven days always reach the week before). */
export const LABOR_FINAL_DAY_LOOKBACK = 7;

/** D's payroll week, the one before it, and D−1 … D−7 (newest first). */
export function hourlyFrame(day: string): { weekD: string; weekP: string; lastFullWeekEnd: string; days: string[] } {
  const weekD = payrollWeekStart(day);
  const weekP = shiftReportDate(weekD, -7);
  return { weekD, weekP, lastFullWeekEnd: shiftReportDate(weekP, 6),
    days: Array.from({ length: LABOR_FINAL_DAY_LOOKBACK }, (_, i) => shiftReportDate(day, -(i + 1))) };
}

/**
 * What the hourly piece ACCEPTED. `undefined` = not accepted (not asked, failed, cut, or late). A Map holds only the
 * entries that were accepted: a day absent from `dayCosts` was not accepted; a week absent from a fingerprint map
 * answered nothing in time (null).
 */
export interface HourlyLedger<S> {
  day: string;
  coverageBefore1?: readonly LaborWeekGenerationRow[];
  /** sales_report_daily over [the previous payroll week's Sunday, D − 1] (Fable F7): every window, or not accepted. */
  sales?: readonly DailyRaw[];
  /** schedule_structures, read to completion (an empty list = no structure saved: the report's default). */
  structures?: readonly S[];
  /** fact_labor_cost(day, day) per day accepted; null = the function returned no row. */
  dayCosts: Map<string, LaborCostRow | null>;
  coverageAfter1?: readonly LaborWeekGenerationRow[];
  fingerprints1: Map<string, string | null>;
  coverageBefore2?: readonly LaborWeekGenerationRow[];
  /** The `to` the week-so-far span was ASKED for (the latest final day bracket 1 chose when bracket 2 started). */
  weekSoFarTo?: string;
  /** undefined = not accepted; null = accepted and the function returned no row. */
  weekSoFarRow?: LaborCostRow | null;
  lastFullWeekRow?: LaborCostRow | null;
  coverageAfter2?: readonly LaborWeekGenerationRow[];
  fingerprints2: Map<string, string | null>;
}

export function emptyHourlyLedger<S>(day: string): HourlyLedger<S> {
  return { day, dayCosts: new Map(), fingerprints1: new Map(), fingerprints2: new Map() };
}

/** The report's own targets of a payroll week from the structures (lib/business-report.ts `targetsForWeek`). */
export type TargetsFor<S> = (structures: readonly S[], weekStart: string) => LaborTargets;

/** One bracket's verified week states, or null when either of its coverage reads is not in the ledger. */
function bracket(before: readonly LaborWeekGenerationRow[] | undefined, after: readonly LaborWeekGenerationRow[] | undefined,
  fingerprints: ReadonlyMap<string, string | null>): Map<string, LaborWeekCoverageRow> | null {
  if (!before || !after) return null;
  return currentWeekCoverage(before, after, fingerprints);
}

export interface WeekVerdicts {
  /** null = bracket 1 certified nothing (a coverage read of it is missing). */
  w1: Map<string, LaborWeekCoverageRow> | null;
  w2: Map<string, LaborWeekCoverageRow> | null;
  /** null = one of the two coverage-AFTER reads is missing. */
  x: Map<string, LaborWeekCoverageRow> | null;
}
export function weekVerdicts(l: HourlyLedger<unknown>): WeekVerdicts {
  return {
    w1: bracket(l.coverageBefore1, l.coverageAfter1, l.fingerprints1),
    w2: bracket(l.coverageBefore2, l.coverageAfter2, l.fingerprints2),
    x: l.coverageAfter1 && l.coverageAfter2 ? stableWeekCoverage(l.coverageAfter1, l.coverageAfter2) : null,
  };
}

/**
 * §11.2.2 (L6): a week is usable only when it is `ready` in BOTH brackets and its generation did not move between them.
 * A week absent from a read is `unbuilt` (laborWeekState(undefined)), and an absent X entry is never "did not move".
 */
export function weekUsable(v: WeekVerdicts, week: string): boolean {
  if (!v.w1 || !v.w2 || !v.x) return false;
  const moved = v.x.get(week);
  return laborWeekState(v.w1.get(week)) === "ready" && laborWeekState(v.w2.get(week)) === "ready"
    && moved !== undefined && moved.ot_scope !== "moved_during_read";
}

export type FinalDayChoice =
  | { kind: "day"; date: string; week: string; row: LaborCostRow; labor: LaborFigures; targets: LaborTargets }
  /** Opus R-1: no day of the seven is hours-complete AND every payroll week holding one of them is `ready` in W1. */
  | { kind: "none" }
  /**
   * Opus R-1 (= Fable F4): no day was chosen and a payroll week holding one of the seven days is NOT `ready` in W1 (a
   * fingerprint that did not answer, a stale or rebuilding week): "No final labor day" would be a claim built on a check
   * that did not pass, so the day part reads "Labor figures are updating".
   */
  | { kind: "updating" }
  /** Bracket 1 is not complete in the ledger: no day can be chosen (a newer day might be the missing one). */
  | { kind: "unavailable" };

/**
 * The latest final day (bracket 1 only): the NEWEST of D−1 … D−7 whose day figure, priced by `laborDayFigures` with its
 * week's bracket-1 state and targets, is hours-complete AND whose week is `ready` in W1. Needs the WHOLE of bracket 1.
 */
export function chooseLatestFinalDay<S>(l: HourlyLedger<S>, targetsFor: TargetsFor<S>): FinalDayChoice {
  const { days } = hourlyFrame(l.day);
  if (!l.coverageBefore1 || !l.coverageAfter1 || !l.sales || !l.structures) return { kind: "unavailable" };
  if (!days.every((d) => l.dayCosts.has(d))) return { kind: "unavailable" };
  const w1 = currentWeekCoverage(l.coverageBefore1, l.coverageAfter1, l.fingerprints1);
  for (const d of days) {
    const week = payrollWeekStart(d);
    const sales = daySalesFrom(l.sales, d, d)[0];
    const row = l.dayCosts.get(d) ?? null;
    if (!sales || !row || laborWeekState(w1.get(week)) !== "ready") continue;
    const targets = targetsFor(l.structures, week);
    const labor = laborDayFigures(sales, row, w1.get(week), targets.hourly.pct, targets.loaded.pct);
    if (laborHoursComplete(labor.state)) return { kind: "day", date: d, week, row, labor, targets };
  }
  // Opus R-1: `none` only when the whole window was verified (every week of the seven days ready in W1).
  const weeks = new Set(days.map(payrollWeekStart));
  return [...weeks].every((w) => laborWeekState(w1.get(w)) === "ready") ? { kind: "none" } : { kind: "updating" };
}

const UNAVAILABLE = { kind: "unavailable" } as const;
const UPDATING = { kind: "updating" } as const;

/** A span inside ONE payroll week, priced by `laborRangeFigures` exactly as the report prices a week (its own targets). */
function rangeSpan<S>(l: HourlyLedger<S>, targetsFor: TargetsFor<S>, from: string, to: string, row: LaborCostRow | null,
  weeks: ReadonlyMap<string, LaborWeekCoverageRow>): SpanPart {
  // No span crosses a payroll week (the core refuses one).
  if (from > to || payrollWeekStart(from) !== payrollWeekStart(to) || !l.sales || !l.structures) return UNAVAILABLE;
  const week = payrollWeekStart(from);
  const t = targetsFor(l.structures, week);
  const span: LaborSpan = { from, to, target: t.hourly.pct, loadedTarget: t.loaded.pct,
    labor: laborRangeFigures(daySalesFrom(l.sales, from, to), row ? [{ ...row, week_start: week }] : [], weeks, { hourly: t.hourly.pct, loaded: t.loaded.pct }) };
  return { kind: "ok", span };
}

/** THE certify rule of the hourly piece (see the header). Pure; an empty ledger is every part `unavailable`. */
export function certifyHourly<S>(l: HourlyLedger<S>, targetsFor: TargetsFor<S>): HourlyLaborFacts {
  const { weekD, weekP, lastFullWeekEnd } = hourlyFrame(l.day);
  const v = weekVerdicts(l);
  const choice = chooseLatestFinalDay(l, targetsFor);
  // Bracket 2 (both its coverage reads) and the link X: without them no week is certified in bracket 2.
  const bracket2 = v.w1 !== null && v.w2 !== null && v.x !== null;

  let latestFinalDay: HourlyLaborFacts["latestFinalDay"];
  let roleStep: HourlyLaborFacts["roleStep"] = null;
  if (choice.kind === "unavailable") latestFinalDay = UNAVAILABLE;
  else if (choice.kind === "none") latestFinalDay = { kind: "none" };
  else if (choice.kind === "updating") latestFinalDay = UPDATING; // Opus R-1: not "no final day"
  else if (!bracket2) latestFinalDay = UNAVAILABLE;
  else if (!weekUsable(v, choice.week)) latestFinalDay = UPDATING; // not re-chosen (§11.2.2)
  else {
    latestFinalDay = { kind: "ok", span: { from: choice.date, to: choice.date, labor: choice.labor,
      target: choice.targets.hourly.pct, loadedTarget: choice.targets.loaded.pct } };
    const generation = l.coverageAfter2!.find((r) => String(r.week_start).slice(0, 10) === choice.week);
    // The role step's generation is that week as bracket 2 read it last. (A usable week is always in after2.)
    // GLM part 2 F3: the day's straight cents must be a finite, non-negative integer, or there is NO role step (F5 then
    // reads "Cost by role not available"); a NaN is never passed on.
    const dayStraightCents = Number(choice.row.hourly_straight_cents);
    if (!generation) latestFinalDay = UNAVAILABLE;
    else if (Number.isSafeInteger(dayStraightCents) && dayStraightCents >= 0) {
      roleStep = { date: choice.date, weekStart: choice.week, generation: { ...generation },
        dayStraightCents, wageEstimated: Number(choice.row.estimated_rate_minutes) > 0 };
    }
  }

  let weekSoFar: HourlyLaborFacts["weekSoFar"];
  if (choice.kind === "unavailable" || !bracket2) weekSoFar = UNAVAILABLE;
  else if (!weekUsable(v, weekD)) weekSoFar = UPDATING;
  // D's week usable and no final day in it (none chosen, or chosen / updating in the previous week).
  else if (choice.kind !== "day" || choice.week !== weekD) weekSoFar = { kind: "no_final_day_this_week" };
  else if (l.weekSoFarRow === undefined || l.weekSoFarTo !== choice.date) weekSoFar = UNAVAILABLE;
  else weekSoFar = rangeSpan(l, targetsFor, weekD, choice.date, l.weekSoFarRow, v.w2!);

  let lastFullWeek: SpanPart;
  // Opus N2: the last full week needs bracket 1's sales AND structures in the ledger, and a certified bracket 1.
  if (!l.sales || !l.structures || !bracket2) lastFullWeek = UNAVAILABLE;
  else if (!weekUsable(v, weekP)) lastFullWeek = UPDATING;
  else if (l.lastFullWeekRow === undefined) lastFullWeek = UNAVAILABLE;
  else lastFullWeek = rangeSpan(l, targetsFor, weekP, lastFullWeekEnd, l.lastFullWeekRow, v.w2!);

  return { day: l.day, latestFinalDay, weekSoFar, lastFullWeek, roleStep };
}

// ── The role step (§11.2.3, §13.2.5, Opus P3-5) ─────────────────────────────────────────────────

/** One row of the people read as the role rule needs it: NO label, NO user id (Opus P3-5). */
export interface RolePeopleRowIn { personKey: string; roleKey: string | null; source: string; payClass: string; straightCents: number | null }

export interface RoleLedger {
  coverageBefore?: readonly LaborWeekGenerationRow[];
  people?: readonly RolePeopleRowIn[];
  roleNames?: ReadonlyMap<string, string | null>;
  coverageAfter?: readonly LaborWeekGenerationRow[];
  /** absent = it did not answer in time (null). */
  fingerprint?: string | null;
}

/**
 * F5 may be priced only when that day's week is `ready` in the role step's own bracket (coverage before, coverage after,
 * the current fingerprint) AND its generation did not move since bracket 2 (stableWeekCoverage([bracket 2's row], after)).
 * Anything missing or moved = `unavailable` ("Cost by role not available"). Pure.
 */
export function certifyRoleLedger(l: RoleLedger, step: NonNullable<HourlyLaborFacts["roleStep"]>):
  { kind: "certified"; people: readonly RolePeopleRowIn[]; roleNames: ReadonlyMap<string, string | null> } | { kind: "unavailable" } {
  if (!l.coverageBefore || !l.coverageAfter || !l.people || !l.roleNames) return UNAVAILABLE;
  const w3 = currentWeekCoverage(l.coverageBefore, l.coverageAfter, new Map([[step.weekStart, l.fingerprint ?? null]]));
  if (laborWeekState(w3.get(step.weekStart)) !== "ready") return UNAVAILABLE;
  const since2 = stableWeekCoverage([step.generation], l.coverageAfter).get(step.weekStart);
  if (!since2 || since2.ot_scope === "moved_during_read") return UNAVAILABLE;
  return { kind: "certified", people: l.people, roleNames: l.roleNames };
}

/** A 7shifts role id as one canonical string: 0 / null = no role (null); anything that is not an id = undefined (refuse). */
export function canonicalRoleKey(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  const s = typeof v === "number" ? (Number.isSafeInteger(v) && v >= 0 ? String(v) : "") : typeof v === "bigint" ? String(v) : typeof v === "string" ? v : "";
  if (!/^\d+$/.test(s)) return undefined;
  const t = s.replace(/^0+(?=\d)/, "");
  return t === "0" ? null : t;
}
