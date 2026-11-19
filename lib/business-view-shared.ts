/**
 * Item 9b fix round 4 (review ITEM9B-r4): THE VIEW of the business report — the only thing the page
 * (components/reports-business) and the export (lib/report-export-shared.ts business*Rows) receive.
 *
 * Four review rounds found the same defect in a new place each time: a number that is estimated, provisional or
 * unknown shown as a plain known number, because a surface could reach the DTO's raw cents / minutes / % and
 * format them itself. Now it cannot. `businessView(dto)` turns EVERY money, percent, hours and count value of the
 * DTO into a `Figure` (lib/business-figure-shared.ts: opaque — value + state + qualifications, readable only through
 * the one formatter, the one cell writer and the one comparison), and this type has no numeric money field at all.
 * What stays plain here is identity and configuration: dates, names, keys, the labor TARGETS, the rush rule's
 * constants, how many days / weeks a list covers. tests/business-report-figure-census.test.ts pins both halves:
 * the surfaces never import the DTO or touch a raw amount, and this type holds no plain figure.
 *
 * Pure: zero I/O, client-safe (the DTO is a type-only import).
 */
import type { BusinessReportDto, BusinessDayDto, BusinessQuarterDto } from "@/lib/business-report";
import {
  breakdownCoverage, laborHoursComplete, salesAmountMissing, sumBusinessDays,
  type BreakdownCoverage, type BusinessRange, type CutTotal, type CutsState, type DenominatorState, type LaborFigures, type LaborState, type LoadedState,
} from "@/lib/business-report-shared";
import type { LaborTone } from "@/lib/scheduling/board-shared";
import {
  breakdownFigure, coverageFigure, emptyClaim, exactFigure, figureComparable, figureHasNote, figureIsPositive, hoursFigure, loadedCentsFigure, loadedPctFigure, minutesFigure, netFigure,
  otHoursFigure, rushCountFigure, personCostFigure, pureCentsFigure, purePctFigure, quarterCentsFigure, quarterHoursFigure, quarterPctFigure, readyFigure, salesFigure,
  type EmptyClaim, type Figure, type FigureKey,
} from "@/lib/business-figure-shared";

type Target = number | "target_varies";
const CHECKS = "reports.business.hours.checks" as const;

export interface SalesView {
  coverage: string;
  /** Sales before refunds (Toast check totals + ezCater). */
  total: Figure; checks: Figure; toastChecks: Figure; toastNet: Figure; ezcater: Figure; ezcaterOrders: Figure; refunds: Figure;
  /** Checks / orders of unknown amount behind these sums. */
  amountMissing: Figure;
}
export interface LaborView {
  state: LaborState; loadedState: LoadedState; netState: DenominatorState;
  /** Hours are final (every payroll week behind them built, ready and known). */
  hoursFinal: boolean;
  net: Figure; hours: Figure; otHours: Figure; pureCost: Figure; otPremium: Figure; purePct: Figure; pureTone: LaborTone;
  salaried: Figure; burden: Figure; loadedCost: Figure; loadedPct: Figure; loadedTone: LaborTone;
  /** Provenance flags of the SHOWN figures (null when the figure is not shown); the gap count is named either way. */
  burdenEstimated: boolean | null; salaryEstimated: boolean | null; wageEstimated: boolean | null; hoursUnverified: boolean | null; salaryGaps: number;
}
export interface QuarterView {
  date: string; quarterStartAt: string; wallQuarter: number; basis: string; laborState: LaborState;
  /** The day's breakdown is not ready: its checks and sales are unknown. */
  breakdownReady: boolean;
  /** Something happened in this quarter (a check or a labor minute): the page lists only these. */
  active: boolean;
  checks: Figure; sales: Figure; amountMissing: Figure; hours: Figure;
  /** Labor dollars and % per 15 minutes: present ONLY where the DTO carries them (QUARTER_COST_MIN, MoO+). */
  cost?: Figure; pct?: Figure;
}
export interface RushWindowView { startAt: string; endAt: string; checks: Figure; usual: Figure; sales: Figure }
export interface DayView {
  date: string; cuts: CutsState; sales: SalesView; labor: LaborView; target: Target; loadedTarget: Target;
  /** Why the day's breakdown (15 minutes, rushes, large checks) is not shown: sales not captured, or still
   * rebuilding. Null when it is. */
  cutsReason: FigureKey | null;
  largeChecks: { any: boolean; checks: Figure; amount: Figure };
  /** null = the day's breakdown is not shown. `none` (fix round 7) = "no rushes" is KNOWN: every 15 minutes that
   * could be part of a rush was compared. With one that was not, `count` is incomplete and carries the reason.
   * Fix round 8: and every check the detector could have used had a time (`rushCountFigure`). */
  rush: { state: "ok" | "not_enough_history"; any: boolean; none: boolean; count: Figure; windows: RushWindowView[] } | null;
  rushes: Figure;
  quarters: QuarterView[];
  /** Fix round 7: the 15-minute list of this day is EMPTY on the page. Whether "no checks or labor" may be said
   * (`verified`: breakdown ready, no check, hours final and zero) or not (`unknown`, with why). Null when the
   * list has rows, or the range is too wide for the 15-minute view. */
  activity: EmptyClaim | null;
  /** The file's Hours table has at least one 15-minute row for this day. */
  hasQuarterRows: boolean;
  unassigned: { checks: Figure; sales: Figure; amountMissing: Figure } | null;
}
export interface WeekView { weekStart: string; from: string; to: string; target: Target; loadedTarget: Target; sales: SalesView; labor: LaborView }
export interface CutView { key: string; label: string | null; provider: string | null; checks: Figure; sales: Figure; amountMissing: Figure }
export interface PersonView {
  key: string; label: string | null; source: string; payClass: string; hours: Figure;
  /** null = overtime withheld (weeks still being recounted). */
  overtime: Figure | null; overtimeAny: boolean; weeksWithheld: number;
  /** Present ONLY where the DTO carries cost per person (PERSON_COST_MIN, MoO+). */
  cost?: Figure;
}
export interface BusinessReportView {
  locationId: string;
  range: BusinessRange;
  access: { personCost: boolean; quarterCost: boolean };
  /** Days with complete sales, of the days in the range. */
  salesDays: { covered: number; expected: number };
  /** Which days the channel / server / large-check breakdown covers. */
  breakdown: BreakdownCoverage;
  /** The sentence on top of a breakdown list that leaves days out, or null when it holds every day. Only when
   * every left-out day is merely REBUILDING may it say the Overview totals are final; a day with no sales
   * captured is named as that (fix round 4, own sweep). */
  breakdownNotice: { key: "reports.business.channels.rebuilding_days" | "reports.business.export.breakdown_partial" | "reports.business.export.breakdown_none"; values: Record<string, number> } | null;
  total: { sales: SalesView; labor: LaborView; target: Target; loadedTarget: Target; largeChecks: { any: boolean; checks: Figure; amount: Figure } };
  weeks: WeekView[];
  days: DayView[];
  /** Every 15 minutes (<= 31 days), else null with `quartersReason`. */
  quarters: QuarterView[] | null;
  quartersReason: "range_too_wide" | null;
  unassigned: Array<{ date: string; checks: Figure; sales: Figure; amountMissing: Figure }>;
  channels: { included: CutView[]; excluded: CutView[]; ezcater: { orders: Figure; sales: Figure; amountMissing: Figure } };
  servers: CutView[];
  people: PersonView[];
  /** Fix round 7: for each list that may be empty, whether "none" may be said (null = the list has rows). The
   * breakdown lists need every day's breakdown ready; the people list needs final hours that are zero. */
  empty: { channels: EmptyClaim | null; excluded: EmptyClaim | null; servers: EmptyClaim | null; people: EmptyClaim | null };
  rushRule: BusinessReportDto["rushRule"];
}

type SalesIn = { coverage: string; checks: number; toastChecksCents: number; toastNetCents: number | null; ezcaterCents: number; ezcaterOrders: number;
  refundCents: number; totalCents: number; toastAmountMissing: number; ezcaterMissing: number };
function salesView(s: SalesIn): SalesView {
  const missing = salesAmountMissing(s);
  return {
    coverage: s.coverage,
    total: salesFigure(s, missing),
    checks: coverageFigure("count", s.checks, s.coverage, { missingReason: "reports.business.labor.state.sales_not_covered" }),
    toastChecks: coverageFigure("cents", s.toastChecksCents, s.coverage, { missing: s.toastAmountMissing }),
    // The exact Toast net is absent whenever any day's is: say that, whatever the coverage.
    toastNet: coverageFigure("cents", s.toastNetCents, s.toastNetCents === null ? "partial" : s.coverage,
      { missingReason: "reports.business.labor.state.net_unknown", unknownReason: "reports.business.labor.state.net_unknown" }),
    ezcater: coverageFigure("cents", s.ezcaterCents, s.coverage, { missing: s.ezcaterMissing }),
    ezcaterOrders: coverageFigure("count", s.ezcaterOrders, s.coverage, { label: CHECKS }),
    refunds: coverageFigure("cents", s.refundCents, s.coverage),
    amountMissing: coverageFigure("count", missing, s.coverage),
  };
}
function laborView(l: LaborFigures): LaborView {
  const purePct = purePctFigure(l), loadedPct = loadedPctFigure(l), loadedCost = loadedCentsFigure(l, "fullyLoadedCents");
  const pureCost = pureCentsFigure(l, "pureHourlyCents"), hours = hoursFigure(l);
  return {
    state: l.state, loadedState: l.loadedState, netState: l.denominator.state, hoursFinal: laborHoursComplete(l.state),
    net: netFigure(l), hours, otHours: otHoursFigure(l), pureCost, otPremium: pureCentsFigure(l, "otPremiumCents"),
    purePct, pureTone: l.pct === null ? "none" : l.tone,
    salaried: loadedCentsFigure(l, "salariedCents"), burden: loadedCentsFigure(l, "burdenCents"), loadedCost, loadedPct,
    loadedTone: l.loadedPct === null ? "none" : l.loadedTone,
    burdenEstimated: figureHasNote(loadedCost, "burden_estimated"), salaryEstimated: figureHasNote(loadedCost, "salary_estimated"),
    wageEstimated: figureHasNote(pureCost, "wage_estimated"), hoursUnverified: figureHasNote(hours, "hours_unverified"), salaryGaps: l.salaryGaps,
  };
}
function quarterView(q: BusinessQuarterDto, day: BusinessDayDto): QuarterView {
  const REBUILDING = "reports.business.cuts.rebuilding" as const;
  const out: QuarterView = {
    date: q.date, quarterStartAt: q.quarterStartAt, wallQuarter: q.wallQuarter, basis: q.basis, laborState: day.labor.state,
    breakdownReady: q.toastCents !== null, active: (q.checks ?? 0) > 0 || (q.laborMinutes ?? 0) > 0,
    checks: exactFigure("count", q.checks, REBUILDING, { label: CHECKS }),
    sales: exactFigure("cents", q.toastCents, REBUILDING, { missing: q.amountMissing ?? 0 }),
    amountMissing: exactFigure("count", q.amountMissing, REBUILDING),
    hours: quarterHoursFigure(q.laborMinutes, day.labor.state, day.labor.hoursUnverified),
  };
  // A GM's quarter has neither key (lib/business-report.ts): the view has neither figure.
  if ("straightCents" in q) out.cost = quarterCentsFigure(q.straightCents, q.laborMinutes, day.labor);
  if ("pct" in q) out.pct = quarterPctFigure(q.pct, day.labor);
  return out;
}
const cutView = (c: CutTotal, days: BreakdownCoverage): CutView => ({
  key: c.key, label: c.label ?? null, provider: c.provider ?? null,
  checks: breakdownFigure("count", c.checks, days, { label: CHECKS }),
  sales: breakdownFigure("cents", c.cents, days, { missing: c.amountMissing ?? 0 }),
  amountMissing: breakdownFigure("count", c.amountMissing ?? 0, days),
});

function breakdownNotice(dto: BusinessReportDto, b: BreakdownCoverage): BusinessReportView["breakdownNotice"] {
  if (dto.range.empty || b.state === "complete") return null;
  if (dto.days.every((d) => d.cuts === "ok" || d.cuts === "rebuilding")) return { key: "reports.business.channels.rebuilding_days", values: { n: b.excluded } };
  return { key: b.state === "none" ? "reports.business.export.breakdown_none" : "reports.business.export.breakdown_partial",
    values: { covered: b.included, expected: b.expected, excluded: b.excluded } };
}

/** The DTO of lib/business-report.ts as the page and the export may see it: every figure sealed with its state. */
export function businessView(dto: BusinessReportDto): BusinessReportView {
  const breakdown = breakdownCoverage(dto.days);
  const inWeek = (date: string) => dto.weeks.find((w) => date >= w.from && date <= w.to);
  const quartersByDate = new Map<string, QuarterView[]>();
  const dayByDate = new Map(dto.days.map((d) => [d.date, d]));
  const quarters = dto.quarters === null ? null : dto.quarters.flatMap((q) => {
    const day = dayByDate.get(q.date);
    if (!day) return [];
    const v = quarterView(q, day);
    (quartersByDate.get(q.date) ?? quartersByDate.set(q.date, []).get(q.date)!).push(v);
    return [v];
  });
  const unassigned = (dto.quartersUnassigned ?? []).map((u) => ({
    date: u.date, checks: exactFigure("count", u.checks, "reports.business.cuts.rebuilding", { label: CHECKS }),
    sales: exactFigure("cents", u.toastCents, "reports.business.cuts.rebuilding", { missing: u.amountMissing }),
    amountMissing: exactFigure("count", u.amountMissing, "reports.business.cuts.rebuilding"),
  }));
  const days: DayView[] = dto.days.map((d) => {
    const wk = inWeek(d.date);
    const cutsReason = d.cuts === "sales_not_covered" ? "reports.business.labor.state.sales_not_covered" as const : "reports.business.cuts.rebuilding" as const;
    const ok = d.cuts === "ok";
    const large = { checks: exactFigure("count", ok ? d.largeChecks.checks : null, cutsReason), amount: exactFigure("cents", ok ? d.largeChecks.cents : null, cutsReason) };
    // Fix round 7: a 15 minutes that could not be compared leaves the count a floor. Fix round 8: so do checks with no
    // time (none found = unknown), and baseline days left out are said beside it. One builder decides.
    const rushCount = rushCountFigure(d.rush, cutsReason);
    const un = unassigned.find((u) => u.date === d.date);
    const sales = salesView(d.sales), labor = laborView(d.labor);
    const listed = (quartersByDate.get(d.date) ?? []).filter((q) => q.active);
    // The breakdown's own reason (a day with no sales captured is not "rebuilding").
    const notShown: FigureKey | null = ok ? null : d.cuts === "sales_not_covered" ? "reports.business.sales.not_captured" : "reports.business.cuts.rebuilding";
    // An empty 15-minute list says "no checks, no labor": the breakdown must be ready, the day's checks zero (or
    // all of them without an opened time, listed beside it), and the hours final and zero.
    const activity = quarters === null || listed.length > 0 ? null
      : emptyClaim(...(ok ? (un ? [] : [sales.checks]) : [readyFigure(notShown)]), labor.hours);
    return {
      date: d.date, cuts: d.cuts, sales, labor, cutsReason: notShown,
      target: wk?.target ?? dto.total.target, loadedTarget: wk?.loadedTarget ?? dto.total.loadedTarget,
      largeChecks: { any: figureIsPositive(large.checks), ...large },
      rush: d.rush === null ? null : {
        state: d.rush.state, any: figureIsPositive(rushCount), none: figureComparable(rushCount) && !figureIsPositive(rushCount), count: rushCount,
        windows: d.rush.windows.map((w) => ({ startAt: w.startAt, endAt: w.endAt, checks: exactFigure("count", w.checks, cutsReason),
          usual: exactFigure("count", w.baselineChecks, cutsReason), sales: exactFigure("cents", w.cents, cutsReason) })),
      },
      rushes: rushCount,
      quarters: listed, activity, hasQuarterRows: (quartersByDate.get(d.date) ?? []).length > 0,
      unassigned: un ? { checks: un.checks, sales: un.sales, amountMissing: un.amountMissing } : null,
    };
  });
  const sumOf = (k: "checks" | "ezcaterOrders" | "toastAmountMissing" | "ezcaterMissing") => dto.days.reduce((s, d) => s + d.sales[k], 0);
  const totalSales = salesView({
    coverage: dto.total.sales.coverage, checks: sumOf("checks"), toastChecksCents: dto.total.sales.toastChecksCents, toastNetCents: dto.total.sales.toastNetCents,
    ezcaterCents: dto.total.sales.ezcaterCents, ezcaterOrders: sumOf("ezcaterOrders"), refundCents: dto.total.sales.refundCents, totalCents: dto.total.sales.totalCents,
    toastAmountMissing: sumOf("toastAmountMissing"), ezcaterMissing: sumOf("ezcaterMissing"),
  });
  const largeTotal = { checks: breakdownFigure("count", dto.largeChecks.checks, breakdown), amount: breakdownFigure("cents", dto.largeChecks.cents, breakdown) };
  const totalLabor = dto.total.labor;
  const totalLaborView = laborView(totalLabor);
  // Fix round 7: an empty list is a claim. The breakdown lists are drawn from the days whose breakdown is ready;
  // the people list from the range's hours.
  const breakdownEmpty = (rows: readonly unknown[]) => (rows.length > 0 ? null : emptyClaim(breakdownFigure("count", 0, breakdown)));
  return {
    locationId: dto.locationId, range: dto.range, access: dto.access,
    salesDays: { covered: dto.days.filter((d) => d.sales.coverage === "complete").length, expected: dto.days.length },
    breakdown, breakdownNotice: breakdownNotice(dto, breakdown),
    total: { sales: totalSales, labor: totalLaborView, target: dto.total.target, loadedTarget: dto.total.loadedTarget,
      largeChecks: { any: figureIsPositive(largeTotal.checks), ...largeTotal } },
    weeks: dto.weeks.map((w) => ({
      weekStart: w.weekStart, from: w.from, to: w.to, target: w.target, loadedTarget: w.loadedTarget,
      sales: salesView(sumBusinessDays(dto.days.filter((d) => d.date >= w.from && d.date <= w.to).map((d) => d.sales))), labor: laborView(w.labor),
    })),
    days, quarters, quartersReason: dto.quarters === null ? dto.quartersReason ?? "range_too_wide" : null, unassigned,
    channels: {
      included: dto.channels.included.map((c) => cutView(c, breakdown)), excluded: dto.channels.excluded.map((c) => cutView(c, breakdown)),
      ezcater: { orders: totalSales.ezcaterOrders, sales: totalSales.ezcater, amountMissing: coverageFigure("count", sumOf("ezcaterMissing"), dto.total.sales.coverage) },
    },
    servers: dto.servers.map((c) => cutView(c, breakdown)),
    people: dto.people.map((p): PersonView => {
      const overtime = p.otMinutes === null ? null : minutesFigure(p.otMinutes, totalLabor.state, totalLabor.hoursUnverified);
      const out: PersonView = { key: `${p.personKey}|${p.source}|${p.payClass}`, label: p.label, source: p.source, payClass: p.payClass,
        hours: minutesFigure(p.minutes, totalLabor.state, totalLabor.hoursUnverified), overtime, overtimeAny: overtime !== null && figureIsPositive(overtime), weeksWithheld: p.weeksSuppressed };
      if ("straightCostCents" in p) out.cost = personCostFigure(p.straightCostCents, p.payClass, totalLabor);
      return out;
    }),
    empty: { channels: breakdownEmpty(dto.channels.included), excluded: breakdownEmpty(dto.channels.excluded), servers: breakdownEmpty(dto.servers),
      people: dto.people.length > 0 ? null : emptyClaim(totalLaborView.hours) },
    rushRule: dto.rushRule,
  };
}
