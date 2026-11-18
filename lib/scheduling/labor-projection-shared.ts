/**
 * BOARD TWO LABOR VIEWS, PR 1: THE PROJECTION, pure (no I/O, no clock, no env). Plan: CHIEF
 * item-02-BOARD-TWO-VIEWS-PLAN-r4.md with CC's rulings on Astra r4 (P1 projected readiness, P2 projected denominator).
 *
 * The board does not price labor. It states a PLAN (which days are a schedule instead of facts, the scheduled
 * minutes with each person's rate fields, the overtime counted by the facts' own counter, this shop's salary row)
 * and hands it to 0343's fact_labor_cost_planned; the answer goes through the facts' own two-view pricer
 * (lib/facts/labor-cost-shared.ts). A projected day and the same day once settled are one SQL body and one pricer.
 *
 * DAY KINDS (a board week is Mon-Sun; a payroll week is Sun-Sat, so a board week touches two):
 *   actual       past, labor day `covered` with no open punch, its payroll week `ready` (currentWeekCoverage).
 *                Its population is the facts. Never masked.
 *   projected    today or later, and the board week has a schedule. Masked: its population is the schedule.
 *   not_settled  past and not actual. Masked when a schedule exists (its scheduled minutes feed the 40 h counter);
 *                shown as hours only: no $, no %, no tone.
 *   no_schedule  today or later with no schedule: nothing to project (unknown, never 0).
 * The Sunday BEFORE the board week is the first day of the board's main payroll week: retained when it is actual,
 * else masked with the PREVIOUS board week's schedule; with neither, that week's overtime is not assessed. It is
 * never displayed or summed into the board.
 * The payroll week of the board's own Sunday is left open on purpose: a payroll week's first day cannot carry
 * overtime (1,440 minutes < the 2,400 threshold), so the following Mon-Sat are never needed.
 *
 * DENOMINATORS, never blended: an actual day divides by the Sales report's net (laborNetSales); a projected day
 * divides by the scheduling forecast (projectedNetSales), the number the heads budget is cut from.
 * MONEY: shop totals only (day and week). Nothing here is per person, and no wage rate leaves this module's caller.
 */
import {
  laborNetSales, payrollWeekStart, projectedNetSales, sumNetSales, type DaySales, type LaborWeekState,
} from "@/lib/business-report-shared";
import { LABOR_OT_SCOPE } from "@/lib/facts/labor-config-shared";
import {
  laborPercents, laborWeekViews, sumLaborViews, type LaborCostRow, type LaborProjectionInputs, type LaborTargets, type LaborWeekView, type ProjectionGap,
} from "@/lib/facts/labor-cost-shared";
import { allocateSalaried } from "@/lib/facts/labor-payroll-shared";
import { createOtCounter, otCounterKey, type LaborWeekSource } from "@/lib/facts/labor-week-shared";
import { pickWage, type PayClass, type RateBasis, type WageVersion } from "@/lib/facts/labor-wages-shared";
import type { LaborTone } from "./board-shared";
import { Q_MINUTES, addDays } from "./time-shared";

export interface ScheduleLaborViewsEnv { SCHEDULE_LABOR_VIEWS?: string; FACT_LAYER?: string; FACT_LAYER_LABOR?: string }
/** Dark unless SCHEDULE_LABOR_VIEWS, FACT_LAYER and FACT_LAYER_LABOR are all exactly "1" (apply 0343 first). */
export function scheduleLaborViewsEnabled(env: ScheduleLaborViewsEnv): boolean {
  return env.SCHEDULE_LABOR_VIEWS === "1" && env.FACT_LAYER === "1" && env.FACT_LAYER_LABOR === "1";
}

export type BoardLaborDayKind = "actual" | "projected" | "not_settled" | "no_schedule";
/** The times of one scheduled shift (the head's, as saved). */
export interface PlanShift { userId: string; date: string; startQ: number; endQ: number }
/** This shop's labor_day_coverage row of one date. */
export interface DayCoverageRow { business_date: string; state: string; open_punches: number }
/** This shop's labor_quarter row, as much as the 40 h counter needs. */
export interface FactQuarter { business_date: string; quarter_start_at: string; person_key: string; minutes: number; ot_minutes: number; pay_class: PayClass }

export interface PlanRow { person_key: string; business_date: string; minutes: number; pay_class: PayClass; rate_cents: number | null; rate_basis: RateBasis; carry_back_rate_cents: number | null }
export interface PlanOt { person_key: string; business_date: string; ot_minutes: number }
export interface PlanSalaried { week_start: string; salaried_cents: number | null; salaried_people: number; unplaced_people: number; missing_wage_people: number }
/** 0343's p_plan (every key an array). */
export interface LaborPlan { mask: string[]; rows: PlanRow[]; ot: PlanOt[]; salaried: PlanSalaried[] }

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const ymd = (v: unknown) => String(v).slice(0, 10);

// ── 1. Which days are a schedule ────────────────────────────────────────────────────────────────

export interface ClassifyInput {
  today: string;
  /** the board week, Mon..Sun */
  boardDates: readonly string[];
  /** the board week has a schedule (a head) */
  hasHead: boolean;
  /** the PREVIOUS board week has a schedule (its Sunday is the main payroll week's first day) */
  hasPrevHead: boolean;
  dayCoverage: readonly DayCoverageRow[];
  /** per payroll week, from currentWeekCoverage (absent = unbuilt) */
  weekStates: ReadonlyMap<string, LaborWeekState>;
}
export interface Classification {
  kinds: Record<string, BoardLaborDayKind>;
  /** the Sunday before the board week (the main payroll week's first day) */
  priorSunday: string;
  priorSundayActual: boolean;
  /** the dates whose population is the schedule (the prior Sunday included when it is masked) */
  mask: string[];
  /** the payroll weeks holding a masked date (their source must be read to build the plan) */
  planWeeks: string[];
}

export function classifyLaborDays(input: ClassifyInput): Classification {
  const cov = new Map(input.dayCoverage.map((c) => [ymd(c.business_date), c]));
  const isActual = (d: string) => {
    const c = cov.get(d);
    return d < input.today && c?.state === "covered" && Number(c.open_punches) === 0 && input.weekStates.get(payrollWeekStart(d)) === "ready";
  };
  const kinds: Record<string, BoardLaborDayKind> = {};
  const mask: string[] = [];
  for (const d of input.boardDates) {
    const kind: BoardLaborDayKind = isActual(d) ? "actual" : d >= input.today ? (input.hasHead ? "projected" : "no_schedule") : "not_settled";
    kinds[d] = kind;
    if (kind !== "actual" && input.hasHead) mask.push(d);
  }
  const priorSunday = addDays(input.boardDates[0]!, -1);
  const priorSundayActual = isActual(priorSunday);
  // The prior Sunday is planned only when its payroll week has a planned board day to count toward.
  const mainWeek = payrollWeekStart(priorSunday);
  if (!priorSundayActual && input.hasPrevHead && mask.some((d) => payrollWeekStart(d) === mainWeek)) mask.push(priorSunday);
  mask.sort(cmp);
  return { kinds, priorSunday, priorSundayActual, mask, planWeeks: [...new Set(mask.map(payrollWeekStart))].sort(cmp) };
}

// ── 2. The plan ─────────────────────────────────────────────────────────────────────────────────

export interface BuildPlanInput {
  locationId: string;
  boardDates: readonly string[];
  classification: Classification;
  /** the board week's shifts (null = no schedule) and the previous board week's (null = none) */
  shifts: readonly PlanShift[] | null;
  prevShifts: readonly PlanShift[] | null;
  /** this shop's labor_quarter rows of the board's payroll weeks */
  quarters: readonly FactQuarter[];
  /** fact_labor_week_source of every plan week (wages, links, payroll shops) */
  sources: ReadonlyMap<string, LaborWeekSource>;
  /** the payroll weeks that have a stored labor_week_salaried row for this shop */
  storedSalariedWeeks: ReadonlySet<string>;
}
export interface PlanWeekReadiness { weekScheduleComplete: boolean; retainedFactsReady: boolean; otRecountMatches: boolean }
export interface BuiltPlan {
  plan: LaborPlan;
  /** per payroll week the board touches: what its plan is complete enough to say (minus the wages, which are per range) */
  weeks: Record<string, PlanWeekReadiness>;
  /** per masked date: the scheduled HOURLY people with no wage at all */
  wageUnknownByDate: Record<string, string[]>;
  /** per masked date: every scheduled minute (hourly + salaried presence) */
  scheduledMinutesByDate: Record<string, number>;
}

/** The scheduled minutes of the masked dates as 0343 plan rows: one per (person, date), each with ONE rate pick by
 * the facts' own rule (pickWage over the account linked at THIS shop; no account or no wage = `none`). A schedule
 * has no 7shifts role, so the pick is the no-role pick (role "0"), as for a Toast punch. */
function planRows(input: BuildPlanInput, masked: ReadonlySet<string>): { rows: PlanRow[]; unknown: Record<string, string[]>; minutes: Record<string, number> } {
  const by = new Map<string, PlanRow>();
  const unknown: Record<string, string[]> = {};
  const minutes: Record<string, number> = {};
  for (const d of masked) minutes[d] = 0;
  const board = new Set(input.boardDates);
  const all = [...(input.shifts ?? []).filter((s) => board.has(s.date)), ...(input.prevShifts ?? []).filter((s) => s.date === input.classification.priorSunday)];
  for (const sh of all) {
    if (!masked.has(sh.date)) continue;
    const m = Math.max(0, sh.endQ - sh.startQ) * Q_MINUTES;
    if (m === 0) continue;
    const src = input.sources.get(payrollWeekStart(sh.date));
    if (!src) throw new Error("labor_projection_source_missing");
    const user = sh.userId.toLowerCase();
    const account = src.userLinks.find((l) => l.user_id.toLowerCase() === user && l.linked_at_location_id === input.locationId)?.sevenshifts_user_id ?? null;
    const versions: WageVersion[] = account === null ? [] : src.wages.filter((w) => String(w.user_id) === String(account));
    const pick = pickWage(versions, "0", sh.date);
    const key = `${sh.date}|${user}`;
    const row = by.get(key) ?? by.set(key, {
      person_key: `u:${user}`, business_date: sh.date, minutes: 0, pay_class: pick.payClass,
      rate_cents: pick.payClass === "hourly" && pick.rate ? pick.rate.wage_cents : null, rate_basis: pick.basis,
      carry_back_rate_cents: pick.payClass === "hourly" && pick.carryBack ? pick.carryBack.wage_cents : null,
    }).get(key)!;
    row.minutes += m;
    minutes[sh.date] = (minutes[sh.date] ?? 0) + m;
    if (pick.payClass === "hourly" && pick.basis === "none") {
      const list = unknown[sh.date] ?? (unknown[sh.date] = []);
      if (!list.includes(user)) list.push(user);
    }
  }
  return { rows: [...by.values()].sort((a, b) => cmp(a.business_date, b.business_date) || cmp(a.person_key, b.person_key)), unknown, minutes };
}

interface CountEvent { date: string; order: number; person: string; minutes: number }
/** THE 40 h counter (the builder's own, createOtCounter) over one population, in instant order: overtime
 * minutes per `person|date`. Only hourly minutes are fed. */
function countOvertime(events: readonly CountEvent[], locationId: string): Map<string, number> {
  const add = createOtCounter();
  const out = new Map<string, number>();
  for (const e of [...events].sort((a, b) => cmp(a.date, b.date) || a.order - b.order || cmp(a.person, b.person))) {
    const ot = add(otCounterKey(LABOR_OT_SCOPE, e.person, locationId), e.minutes);
    if (ot > 0) out.set(`${e.person}|${e.date}`, (out.get(`${e.person}|${e.date}`) ?? 0) + ot);
  }
  return out;
}
const factEvents = (qs: readonly FactQuarter[]): CountEvent[] => qs.filter((q) => q.pay_class === "hourly")
  .map((q) => ({ date: ymd(q.business_date), order: Date.parse(q.quarter_start_at), person: q.person_key, minutes: Number(q.minutes) }));

export function buildLaborPlan(input: BuildPlanInput): BuiltPlan {
  const c = input.classification;
  const masked = new Set(c.mask);
  const { rows, unknown, minutes } = planRows(input, masked);
  const weeks: Record<string, PlanWeekReadiness> = {};
  const ot: PlanOt[] = [];
  const salaried: PlanSalaried[] = [];
  // The population each payroll week needs: the main week is the prior Sunday + the board's Mon..Sat; the board
  // Sunday's week is that Sunday alone (a week's first day cannot carry overtime).
  const population = new Map<string, string[]>();
  for (const d of [c.priorSunday, ...input.boardDates]) (population.get(payrollWeekStart(d)) ?? population.set(payrollWeekStart(d), []).get(payrollWeekStart(d))!).push(d);
  const isActual = (d: string) => (d === c.priorSunday ? c.priorSundayActual : c.kinds[d] === "actual");

  for (const [week, dates] of population) {
    const stored = input.quarters.filter((q) => payrollWeekStart(ymd(q.business_date)) === week);
    const weekMask = dates.filter((d) => masked.has(d));
    // The shared counter must reproduce the STORED overtime of the stored rows (overlapping punches would not).
    const recount = countOvertime(factEvents(stored), input.locationId);
    const storedOt = new Map<string, number>();
    for (const q of stored) if (Number(q.ot_minutes) > 0) storedOt.set(`${q.person_key}|${ymd(q.business_date)}`, (storedOt.get(`${q.person_key}|${ymd(q.business_date)}`) ?? 0) + Number(q.ot_minutes));
    const otRecountMatches = recount.size === storedOt.size && [...recount].every(([k, v]) => storedOt.get(k) === v);
    weeks[week] = {
      weekScheduleComplete: dates.every((d) => isActual(d) || masked.has(d)),
      retainedFactsReady: dates.filter((d) => !masked.has(d)).every(isActual),
      otRecountMatches,
    };
    if (weekMask.length === 0) continue;
    // The selected population: the retained fact rows + the planned quarters, counted once in instant order.
    const first = weekMask[0]!;
    const events = factEvents(stored.filter((q) => !masked.has(ymd(q.business_date))));
    const hourly = new Set(rows.filter((r) => r.pay_class === "hourly").map((r) => `${r.business_date}|${r.person_key}`));
    const board = new Set(input.boardDates);
    for (const sh of [...(input.shifts ?? []).filter((s) => board.has(s.date)), ...(input.prevShifts ?? []).filter((s) => s.date === c.priorSunday)]) {
      const person = `u:${sh.userId.toLowerCase()}`;
      if (!weekMask.includes(sh.date) || !hourly.has(`${sh.date}|${person}`)) continue;
      for (let q = sh.startQ; q < sh.endQ; q++) events.push({ date: sh.date, order: q, person, minutes: Q_MINUTES });
    }
    for (const [k, v] of countOvertime(events, input.locationId)) {
      const at = k.lastIndexOf("|");
      const date = k.slice(at + 1);
      // The days before the week's first planned date keep their stored overtime (0343): never listed.
      if (date >= first) ot.push({ person_key: k.slice(0, at), business_date: date, ot_minutes: v });
    }
    // Salary (Astra r3 P2-3): only for a week with no stored row; the one allocation rule over the week's global
    // universe; only THIS shop's row leaves (no other shop's wage, account or cents).
    if (!input.storedSalariedWeeks.has(week)) {
      const src = input.sources.get(week);
      if (!src) throw new Error("labor_projection_source_missing");
      const mine = allocateSalaried({ weekStart: week, storedShops: src.locationLinks.map((l) => l.location_id), payrollShops: src.payrollShops, wages: src.wages })
        .rows.find((r) => r.location_id === input.locationId);
      if (mine) salaried.push({ week_start: week, salaried_cents: mine.salaried_cents, salaried_people: mine.salaried_people,
        unplaced_people: mine.unplaced_people, missing_wage_people: mine.missing_wage_people });
    }
  }
  ot.sort((a, b) => cmp(a.business_date, b.business_date) || cmp(a.person_key, b.person_key));
  salaried.sort((a, b) => cmp(a.week_start, b.week_start));
  return { plan: { mask: [...c.mask], rows, ot, salaried }, weeks, wageUnknownByDate: unknown, scheduledMinutesByDate: minutes };
}

/** The plan as ONE request may send it: 0343 refuses a mask date outside the request's payroll weeks, so a day
 * call carries only its own week's part. `only` = the dates of the range to price. Null = no plan at all. */
export function planForRange(plan: LaborPlan, from: string, to: string, only?: readonly string[]): Record<string, unknown> | null {
  const w0 = payrollWeekStart(from), w1 = addDays(payrollWeekStart(to), 6);
  const within = (d: string) => d >= w0 && d <= w1;
  const mask = plan.mask.filter(within);
  const out: Record<string, unknown> = {};
  if (mask.length) out.mask = mask;
  const rows = plan.rows.filter((r) => within(r.business_date));
  if (rows.length) out.rows = rows;
  const ot = plan.ot.filter((o) => within(o.business_date));
  if (ot.length) out.ot = ot;
  const salaried = plan.salaried.filter((s) => within(s.week_start));
  if (salaried.length) out.salaried = salaried;
  if (only) out.only = [...only];
  return Object.keys(out).length ? out : null;
}

/** What the shared pricer is told about a row that leans on the plan: its payroll week's readiness and the
 * no-wage people of the row's own dates. An unknown week = nothing stated (the pricer fails closed). */
export function projectionInputsFor(built: BuiltPlan, row: LaborCostRow, dates: readonly string[]): LaborProjectionInputs | undefined {
  const week = built.weeks[row.week_start];
  if (!week) return undefined;
  const people = new Set(dates.filter((d) => payrollWeekStart(d) === row.week_start).flatMap((d) => built.wageUnknownByDate[d] ?? []));
  return { ...week, wageUnknownPeople: people.size };
}

// ── 3. The figures the board serializes ─────────────────────────────────────────────────────────

export type BoardLaborReason = ProjectionGap | "hours_unknown" | "salary_incomplete" | "salary_unknown" | "not_settled" | "no_schedule"
  | "sales_not_covered" | "net_unknown" | "ezcater_missing" | "zero_sales" | "forecast_missing" | "partial_week";
export interface BoardLaborFigure {
  /** worked / scheduled minutes (hourly + salaried presence); null = unknown, never 0 */
  minutes: number | null;
  otMinutes: number | null;
  straightCents: number | null; otPremiumCents: number | null; pureHourlyCents: number | null;
  salariedCents: number | null; burdenCents: number | null; fullyLoadedCents: number | null;
  /** `actual` = the Sales report's net sales; `forecast` = PROJECTED net sales (the scheduling forecast). Never mixed. */
  sales: { basis: "actual" | "forecast"; cents: number | null };
  pureHourlyPct: number | null; pureHourlyTone: LaborTone;
  fullyLoadedPct: number | null; fullyLoadedTone: LaborTone;
  otState: LaborWeekView["otState"] | null;
  rateEstimated: boolean; burdenEstimated: boolean; salaryProjected: boolean; salaryGaps: number;
  /** why a figure is "—" (codes; en + es under schedule.labor_views.reason.*) */
  reasons: BoardLaborReason[];
}
export interface BoardLaborDay extends BoardLaborFigure { date: string; kind: BoardLaborDayKind }
export interface BoardLaborStripPart extends BoardLaborFigure { days: number }
export interface BoardLaborViewsReady {
  state: "ready";
  targets: { hourlyPct: number; loadedPct: number };
  days: BoardLaborDay[];
  /** Three lines, never blended: actual so far, the projected rest, and a count of days not settled. */
  strip: { actual: BoardLaborStripPart | null; projected: BoardLaborStripPart | null; notSettledDays: number; noScheduleDays: number };
}
/** `not_installed` = 0343 is not applied; `rebuilding` = a labor week moved while it was read; `unavailable` = a read failed. */
export type BoardLaborViews = BoardLaborViewsReady | { state: "not_installed" | "rebuilding" | "unavailable" };

const EMPTY: BoardLaborFigure = {
  minutes: null, otMinutes: null, straightCents: null, otPremiumCents: null, pureHourlyCents: null, salariedCents: null, burdenCents: null,
  fullyLoadedCents: null, sales: { basis: "actual", cents: null }, pureHourlyPct: null, pureHourlyTone: "none", fullyLoadedPct: null, fullyLoadedTone: "none",
  otState: null, rateEstimated: false, burdenEstimated: false, salaryProjected: false, salaryGaps: 0, reasons: [],
};

export interface FigureInput {
  rows: readonly LaborCostRow[];
  /** the dates the rows price */
  dates: readonly string[];
  basis: "actual" | "forecast";
  /** the actual days' Sales rows (basis `actual`) */
  sales?: readonly DaySales[];
  /** the projected days' forecast cents, one per date, null = no forecast (basis `forecast`) */
  forecast?: readonly (number | null)[];
  targets: LaborTargets;
  built: BuiltPlan;
}

/** One range's figure: the pricer's own answer for that range (never days summed into a week). */
export function laborFigure(input: FigureInput): BoardLaborFigure {
  const view = sumLaborViews(laborWeekViews(input.rows, (r) => projectionInputsFor(input.built, r, input.dates)));
  if (!view) return { ...EMPTY, sales: { basis: input.basis, cents: null }, reasons: ["hours_unknown"] };
  const reasons: BoardLaborReason[] = [...(view.projection?.gaps ?? [])];
  if (!view.hoursKnown) reasons.push("hours_unknown");
  // Actual days: the Sales report's net, every day present and covered (9a's rule). Projected days: the forecast.
  const sales = input.sales ?? [];
  const denominator: { cents: number | null; state: BoardLaborReason | "ok" } = input.basis === "forecast" ? projectedNetSales(input.forecast ?? [])
    : sales.length !== input.dates.length || sales.length === 0 ? { cents: null, state: "sales_not_covered" }
    : sales.length === 1 ? laborNetSales(sales[0]!) : sumNetSales(sales);
  if (denominator.state !== "ok") reasons.push(denominator.state);
  const moneyKnown = view.projection === null || view.projection.moneyKnown;
  const overtimeKnown = view.projection === null || view.projection.overtimeKnown;
  const pure = moneyKnown && overtimeKnown ? view.pureHourlyCents : null;
  if (view.salaryUnknown) reasons.push(view.salaryIncomplete ? "salary_incomplete" : "salary_unknown");
  const pct = laborPercents(view, denominator.cents, input.targets);
  return {
    minutes: input.rows.reduce((s, r) => s + Number(r.hourly_minutes) + Number(r.salaried_minutes), 0),
    otMinutes: overtimeKnown ? input.rows.reduce((s, r) => s + Number(r.ot_minutes), 0) : null,
    straightCents: moneyKnown ? view.hourlyStraightCents : null, otPremiumCents: pure === null ? null : view.otPremiumCents, pureHourlyCents: pure,
    salariedCents: view.salariedCents, burdenCents: pure === null ? null : view.burdenCents, fullyLoadedCents: pure === null ? null : view.fullyLoadedCents,
    sales: { basis: input.basis, cents: denominator.cents },
    pureHourlyPct: pct.pureHourlyPct, pureHourlyTone: pct.pureHourlyTone, fullyLoadedPct: pct.fullyLoadedPct, fullyLoadedTone: pct.fullyLoadedTone,
    otState: view.otState, rateEstimated: view.rateEstimated, burdenEstimated: view.burdenEstimated, salaryProjected: view.salaryProjected,
    salaryGaps: view.salaryGaps, reasons: [...new Set(reasons)],
  };
}

/** A day that shows hours only (not settled) or nothing (no schedule): never a $, a % or a tone. */
export function hoursOnlyFigure(kind: "not_settled" | "no_schedule", minutes: number | null): BoardLaborFigure {
  return { ...EMPTY, minutes: kind === "no_schedule" ? null : minutes, reasons: [kind] };
}

/** The "actual so far" strip line is toned only when it is the whole week. */
export function untonedPartialWeek(f: BoardLaborFigure, days: number): BoardLaborStripPart {
  if (days >= 7) return { ...f, days };
  return { ...f, days, pureHourlyTone: "none", fullyLoadedTone: "none", reasons: [...f.reasons, "partial_week"] };
}

/** Every label a board labor-views reader shows (en + es, pinned by tests/schedule-labor-views-i18n.test.ts).
 * No UI ships in PR 1; these exist so PR 3's board is born translated. */
export const SCHEDULE_LABOR_VIEW_I18N_KEYS = [
  "schedule.labor_views.kind.actual", "schedule.labor_views.kind.projected", "schedule.labor_views.kind.not_settled", "schedule.labor_views.kind.no_schedule",
  "schedule.labor_views.sales.actual", "schedule.labor_views.sales.forecast",
  "schedule.labor_views.strip.actual", "schedule.labor_views.strip.projected", "schedule.labor_views.strip.not_settled", "schedule.labor_views.strip.no_schedule",
  "schedule.labor_views.state.not_installed", "schedule.labor_views.state.rebuilding", "schedule.labor_views.state.unavailable",
  "schedule.labor_views.ot.projected", "schedule.labor_views.ot.not_assessed", "schedule.labor_views.salary_projected",
  "schedule.labor_views.reason.schedule_incomplete", "schedule.labor_views.reason.actuals_rebuilding", "schedule.labor_views.reason.ot_not_assessed",
  "schedule.labor_views.reason.wage_unknown", "schedule.labor_views.reason.hours_unknown", "schedule.labor_views.reason.salary_incomplete",
  "schedule.labor_views.reason.salary_unknown", "schedule.labor_views.reason.not_settled", "schedule.labor_views.reason.no_schedule",
  "schedule.labor_views.reason.sales_not_covered", "schedule.labor_views.reason.net_unknown", "schedule.labor_views.reason.ezcater_missing",
  "schedule.labor_views.reason.zero_sales", "schedule.labor_views.reason.forecast_missing", "schedule.labor_views.reason.partial_week",
] as const;
