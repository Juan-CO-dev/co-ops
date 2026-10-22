/**
 * THE HOURS BUDGET AND ITS SUGGESTION — pure (Scheduling Phase 2, Task 11; spec §5.2; plan "Budget, labor
 * target, horizon": r2 P2-7 date-scoped contributions, r3 per-DATE precedence, r2 P2-8 / r3 / r4 the suggestion).
 *
 * A manager enters a WEEK or a MONTH budget; every entry is APPORTIONED to its dates when it is written
 * (`schedule_budget_days`: hundredths of an hour, largest remainder, summing exactly to the entry; by forecast
 * share, an even split without one; an accepted suggestion keeps its explicit per-date amounts) so a later
 * forecast never re-splits history. The budget for a date = the row of the NEWEST entry covering it, whatever
 * its scope; a date no entry covers has NO budget (null, never 0).
 *
 * The suggestion compares the target week's forecast with an EXPLICIT completed reference week (a complete
 * 7-day hours base): the ratio ρ = forecast ÷ actual sales over the reference's captured weekdays M, applied to
 * the MATCHED dates only (clamped at their minimum crew hours, with a note); unmatched dates keep their reference
 * hours exactly and take only positive deltas (booked catering, a structure change). Refused by name
 * (`suggestion_unavailable`) without a usable reference; quiet inside the deadband; Keep hides one digest.
 */
import type { NarrativeLine } from "@/lib/people-narrative";
import { canonicalJson, digest64, type DayNeed } from "./context-shared";
import type { DemandResult } from "./demand-shared";
import { ScheduleError } from "./errors-shared";
import { buildDayNeed, type NeedCatering } from "./need-shared";
import { scheduleEngine, shiftTypesOf, type CrewType, type ScheduleStructure } from "./structure-shared";
import { addDays, isoDowOf, isYmd, weekDays } from "./time-shared";

export const BUDGET_LINE_KEYS = [
  "schedule.budget.composition", "schedule.budget.unbudgeted",
  // CC chunk G: a week with NO budgeted date is ONE line, never one per date.
  "schedule.budget.none_set",
  "schedule.budget.ratio", "schedule.budget.unmatched_kept", "schedule.budget.clamped_min_crew",
  "schedule.budget.catering_delta", "schedule.budget.structure_delta",
  "schedule.budget.errand.no_reference", "schedule.budget.errand.reference_not_ended", "schedule.budget.errand.incomplete_reference",
  "schedule.budget.errand.demand_not_ok", "schedule.budget.errand.no_matched_days", "schedule.budget.errand.zero_reference_sales",
  // Astra chunk E P2-3: the reference week's structure could not be loaded — the structure delta is UNKNOWN, and said so.
  "schedule.budget.reference_structure_unavailable",
] as const;
export type BudgetLineKey = (typeof BUDGET_LINE_KEYS)[number];

export type BudgetScope = "week" | "month";
export interface BudgetEntry {
  id: string;
  scope: BudgetScope;
  /** A Monday (scope week). */
  weekStart: string | null;
  /** The first of a month, "YYYY-MM-01" (scope month). */
  month: string | null;
  hours: number;
  source: "manager" | "accepted_suggestion";
  suggestionDigest: string | null;
  apportionedBy: "forecast" | "even" | "explicit";
  /** The write instant (ISO) — the newest covering entry wins a date. */
  createdAt: string;
}
export interface BudgetDayRow { entryId: string; date: string; hours: number }

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const toH = (hundredths: number) => hundredths / 100;
const hundredths = (h: number) => Math.round(h * 100);
const round025 = (h: number) => Math.round(h * 4) / 4;
const invalid = (params: Record<string, string | number> = {}) => new ScheduleError("budget_invalid", { params });

/** The 0274 CHECK: 0 ≤ hours ≤ 8000, a quarter hour. */
function assertEntry(e: BudgetEntry): void {
  if (!Number.isFinite(e.hours) || e.hours < 0 || e.hours > 8000 || !Number.isInteger(e.hours * 4)) throw invalid({ hours: e.hours });
  if (e.scope === "week" && (!e.weekStart || !isYmd(e.weekStart) || isoDowOf(e.weekStart) !== 1)) throw invalid({ weekStart: String(e.weekStart) });
  if (e.scope === "month" && (!e.month || !isYmd(e.month) || !e.month.endsWith("-01"))) throw invalid({ month: String(e.month) });
}

/** The dates an entry covers: a week's 7, a month's every day. */
export function entryDates(e: BudgetEntry): string[] {
  assertEntry(e);
  if (e.scope === "week") return weekDays(e.weekStart!);
  const out: string[] = [];
  for (let d = e.month!; d.slice(0, 7) === e.month!.slice(0, 7); d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * The per-date rows of an entry: `explicit` amounts (an accepted suggestion — they must cover exactly the entry's
 * dates and sum to it), else by forecast share (cents per date), else an even split. Hundredths, largest
 * remainder (ties to the earlier date), summing EXACTLY to the entry.
 */
export function apportion(e: BudgetEntry, by: { forecastCentsByDate?: Record<string, number> | null; explicit?: Record<string, number> }): BudgetDayRow[] {
  const dates = entryDates(e);
  const total = hundredths(e.hours);
  if (by.explicit) {
    const keys = Object.keys(by.explicit).filter((k) => by.explicit![k] !== undefined).sort(cmp);
    if (keys.length !== dates.length || keys.some((k, i) => k !== dates[i])) throw invalid({ reason: "explicit_dates" });
    const rows = dates.map((d) => ({ entryId: e.id, date: d, hours: by.explicit![d]! }));
    if (rows.some((r) => !Number.isFinite(r.hours) || r.hours < 0 || hundredths(r.hours) / 100 !== r.hours)) throw invalid({ reason: "explicit_hours" });
    if (rows.reduce((n, r) => n + hundredths(r.hours), 0) !== total) throw invalid({ reason: "explicit_sum" });
    return rows;
  }
  const fc = by.forecastCentsByDate ?? null;
  const raw = dates.map((d) => Math.max(0, fc?.[d] ?? 0));
  const sum = raw.reduce((a, b) => a + b, 0);
  const weights = sum > 0 ? raw : dates.map(() => 1);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (total * w) / wsum);
  const base = exact.map((x) => Math.floor(x));
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) { if (left <= 0) break; base[i]!++; left--; }
  return dates.map((d, i) => ({ entryId: e.id, date: d, hours: toH(base[i]!) }));
}

export interface BudgetForDates {
  byDate: Record<string, number | null>;
  /** Σ of the budgeted dates (hundredths-exact). */
  total: number;
  unbudgetedDates: string[];
  composition: Array<{ date: string; entryId: string; scope: BudgetScope; hours: number }>;
  lines: NarrativeLine[];
}

/** Per-DATE precedence: the newest entry (createdAt, then id) with a row for a date wins that date. */
export function budgetForDates(entries: readonly BudgetEntry[], rows: readonly BudgetDayRow[], dates: readonly string[]): BudgetForDates {
  const newestFirst = [...entries].sort((a, b) => cmp(b.createdAt, a.createdAt) || cmp(b.id, a.id));
  const rowOf = new Map(rows.map((r) => [`${r.entryId}|${r.date}`, r]));
  const byDate: Record<string, number | null> = {};
  const composition: BudgetForDates["composition"] = [];
  const unbudgetedDates: string[] = [];
  let totalH = 0;
  for (const date of [...dates].sort(cmp)) {
    const e = newestFirst.find((x) => rowOf.has(`${x.id}|${date}`));
    if (!e) { byDate[date] = null; unbudgetedDates.push(date); continue; }
    const hours = rowOf.get(`${e.id}|${date}`)!.hours;
    byDate[date] = hours;
    totalH += hundredths(hours);
    composition.push({ date, entryId: e.id, scope: e.scope, hours });
  }
  const lines: NarrativeLine[] = [];
  for (let i = 0; i < composition.length;) {
    let j = i;
    let h = 0;
    while (j < composition.length && composition[j]!.entryId === composition[i]!.entryId && (j === i || addDays(composition[j - 1]!.date, 1) === composition[j]!.date)) { h += hundredths(composition[j]!.hours); j++; }
    lines.push({ key: "schedule.budget.composition", params: { scope: composition[i]!.scope, from: composition[i]!.date, to: composition[j - 1]!.date, days: j - i, hours: toH(h) } });
    i = j;
  }
  // CC chunk G (375 px read): no budget on ANY date is one line ("No budget set for this week. Set one"); the dates are
  // named one by one only when SOME of them have a budget.
  if (dates.length > 0 && composition.length === 0) lines.push({ key: "schedule.budget.none_set" });
  else for (const date of unbudgetedDates) lines.push({ key: "schedule.budget.unbudgeted", params: { date } });
  return { byDate, total: toH(totalH), unbudgetedDates, composition, lines };
}

// ─── Need-grid hours (the structure delta, the minimum crew) ────────────────

/** Σ heads × quarters of a need grid, in hours. */
export function needHours(need: DayNeed): number {
  let q = 0;
  for (const arr of Object.values(need.positions)) for (const v of arr) q += v;
  return q / 4;
}

export interface NeedDayInput { dayType: CrewType; scheduledOutQ: number; hourlyCents: number[] | null; demandKind: "ok" | "no_history"; catering: readonly NeedCatering[] }

/** The structure delta of one date: need hours under the LIVE structure − under the reference revision's, both over the target forecast. */
export function structureDeltaHours(input: { live: ScheduleStructure; ref: ScheduleStructure; day: NeedDayInput }): number {
  const hours = (s: ScheduleStructure) => scheduleEngine(s) === "crew"
    ? crewTypeHours(s, input.day.dayType)
    : needHours(buildDayNeed({ structure: s, ...input.day }).need);
  return hours(input.live) - hours(input.ref);
}

/** The hours of the structural minimum crew that day: the line floor (an all-zero forecast shapes to it) + BOH + closing crew; no catering. */
export function crewTypeHours(s: ScheduleStructure, dayType: CrewType): number {
  return shiftTypesOf(s).reduce((n, t) => n + t.headcount[dayType] * (t.toQ - t.fromQ) / 4, 0);
}

export function minCrewHours(s: ScheduleStructure, dayType: CrewType, scheduledOutQ: number): number {
  if (scheduleEngine(s) === "crew") return crewTypeHours(s, dayType);
  return needHours(buildDayNeed({ structure: s, dayType, scheduledOutQ, hourlyCents: new Array<number>(24).fill(0), demandKind: "ok", catering: [] }).need);
}

// ─── The suggestion ──────────────────────────────────────────────────────────

export interface SuggestBudgetInput {
  /** Today (ET business date). */
  asOf: string;
  targetWeekStart: string;
  /** The reference: the most recent fully ended ISO week whose head revision covers all 7 days (the caller picks it). */
  reference: {
    weekStart: string;
    complete: boolean;
    /** Hourly hours scheduled per date of the reference week. */
    hoursByDate: Record<string, number>;
    /** Actual sales per CAPTURED date of the reference week (a date absent = not captured). */
    salesCentsByDate: Record<string, number>;
    /** The catering-rule hours per date of the reference (from that revision's reasons). */
    cateringHoursByDate: Record<string, number>;
    /** Shown for context only. */
    budgetTotal: number | null;
  } | null;
  /** The target week's forecast. */
  demand: DemandResult;
  /** The catering-rule hours per target date. */
  cateringHoursByDate: Record<string, number>;
  /** `structureDeltaHours` per target date. */
  structureDeltaByDate: Record<string, number>;
  /** `minCrewHours` per target date. */
  minCrewHoursByDate: Record<string, number>;
  /** The target week's current budget total (`budgetForDates`), null when none. */
  currentBudgetTotal: number | null;
  /** `labor.budgetDeadbandH`. */
  deadbandH: number;
  /**
   * Astra chunk E P2-3: the reference week's ACTUAL structure was not available, so the structure delta is unknown: it is
   * not applied, and the suggestion SAYS so (`schedule.budget.reference_structure_unavailable`) — never a silent zero.
   */
  structureDeltaUnknown?: boolean;
}

/**
 * The structure a reference week was BUILT with (Astra chunk E P2-3): the snapshot stored in its head revision's own
 * context (a day whose structure version is the revision's), else the saved version by id; null when neither holds it.
 * Never the live structure.
 */
export function referenceStructureOf(
  head: { revision: { structureVersionId: string }; context: { days: Record<string, { structureVersionId: string; structure: ScheduleStructure }> } },
  structuresById: Readonly<Record<string, ScheduleStructure>>,
): ScheduleStructure | null {
  const id = head.revision.structureVersionId;
  const days = head.context?.days ?? {};
  for (const d of Object.keys(days).sort()) if (days[d]?.structureVersionId === id) return days[d]!.structure;
  return Object.hasOwn(structuresById, id) ? structuresById[id]! : null;
}

export type SuggestionCause = "no_reference" | "reference_not_ended" | "incomplete_reference" | "demand_not_ok" | "no_matched_days" | "zero_reference_sales";

export type BudgetSuggestion =
  | {
    kind: "suggestion"; weekStart: string; referenceWeek: string; byDate: Record<string, number>; total: number; ratio: number;
    matchedDows: number[]; clamped: string[]; lines: NarrativeLine[]; digest: string;
  }
  | { kind: "quiet"; reason: "deadband"; total: number; digest: string }
  | { kind: "unavailable"; code: "suggestion_unavailable"; cause: SuggestionCause; errand: NarrativeLine };

const unavailable = (cause: SuggestionCause): BudgetSuggestion => ({ kind: "unavailable", code: "suggestion_unavailable", cause, errand: { key: `schedule.budget.errand.${cause}` } });

export function suggestBudget(input: SuggestBudgetInput): BudgetSuggestion {
  const ref = input.reference;
  if (!ref) return unavailable("no_reference");
  // A reference must have FULLY ENDED before today — a future (or the target) week is never its own reference.
  if (addDays(ref.weekStart, 6) >= input.asOf || ref.weekStart >= input.targetWeekStart) return unavailable("reference_not_ended");
  if (!ref.complete) return unavailable("incomplete_reference");
  if (input.demand.kind !== "ok") return unavailable("demand_not_ok");
  const refDates = weekDays(ref.weekStart);
  const matchedDows = refDates.filter((d) => ref.salesCentsByDate[d] !== undefined).map(isoDowOf).sort((a, b) => a - b);
  if (matchedDows.length === 0) return unavailable("no_matched_days");
  const refSales = refDates.filter((d) => matchedDows.includes(isoDowOf(d))).reduce((n, d) => n + (ref.salesCentsByDate[d] ?? 0), 0);
  if (refSales <= 0) return unavailable("zero_reference_sales");
  const targetDates = weekDays(input.targetWeekStart);
  let fcSales = 0;
  for (const d of targetDates) {
    if (!matchedDows.includes(isoDowOf(d))) continue;
    const f = input.demand.days.find((x) => x.date === d);
    if (!f || f.kind !== "ok") return unavailable("demand_not_ok");
    fcSales += f.dayCents;
  }
  const ratio = Math.round((fcSales / refSales) * 1e6) / 1e6;
  const refByDow = (dow: number, by: Record<string, number>) => by[refDates[dow - 1]!] ?? 0;
  const byDate: Record<string, number> = {};
  const clamped: string[] = [];
  const lines: NarrativeLine[] = [{ key: "schedule.budget.ratio", params: { pct: Math.round((ratio - 1) * 100), referenceWeek: ref.weekStart, matched: matchedDows.join(","), matchedDays: matchedDows.length } }];
  if (input.structureDeltaUnknown) lines.push({ key: "schedule.budget.reference_structure_unavailable", params: { referenceWeek: ref.weekStart } });
  const deltaLines: NarrativeLine[] = [];
  let unmatchedDays = 0;
  let unmatchedRefH = 0;
  for (const d of targetDates) {
    const dow = isoDowOf(d);
    const refH = refByDow(dow, ref.hoursByDate);
    const cat = (input.cateringHoursByDate[d] ?? 0) - refByDow(dow, ref.cateringHoursByDate);
    const str = input.structureDeltaUnknown ? 0 : input.structureDeltaByDate[d] ?? 0;
    if (cat !== 0) deltaLines.push({ key: "schedule.budget.catering_delta", params: { date: d, hours: cat } });
    if (str !== 0) deltaLines.push({ key: "schedule.budget.structure_delta", params: { date: d, hours: str } });
    if (matchedDows.includes(dow)) {
      const raw = refH * ratio + cat + str;
      const min = input.minCrewHoursByDate[d] ?? 0;
      if (min > raw) { clamped.push(d); deltaLines.push({ key: "schedule.budget.clamped_min_crew", params: { date: d, hours: round025(min) } }); }
      byDate[d] = round025(Math.max(raw, min));
    } else {
      unmatchedDays++;
      unmatchedRefH += refH;
      byDate[d] = round025(refH + Math.max(0, cat) + Math.max(0, str));
    }
  }
  if (unmatchedDays > 0) lines.push({ key: "schedule.budget.unmatched_kept", params: { days: unmatchedDays, hours: unmatchedRefH } });
  lines.push(...deltaLines);
  const total = targetDates.reduce((n, d) => n + byDate[d]!, 0);
  const digest = digest64(canonicalJson({ v: 1, weekStart: input.targetWeekStart, referenceWeek: ref.weekStart, ratio, matchedDows, byDate }));
  if (input.currentBudgetTotal !== null && Math.abs(total - input.currentBudgetTotal) < input.deadbandH) return { kind: "quiet", reason: "deadband", total, digest };
  return { kind: "suggestion", weekStart: input.targetWeekStart, referenceWeek: ref.weekStart, byDate, total, ratio, matchedDows, clamped, lines, digest };
}

/** Accept: a WEEK entry carrying the suggestion's digest and its explicit per-date amounts (the rows the writer persists). */
export function acceptSuggestion(s: Extract<BudgetSuggestion, { kind: "suggestion" }>, meta: { id: string; createdAt: string }): { entry: BudgetEntry; rows: BudgetDayRow[] } {
  const entry: BudgetEntry = {
    id: meta.id, scope: "week", weekStart: s.weekStart, month: null, hours: s.total, source: "accepted_suggestion",
    suggestionDigest: s.digest, apportionedBy: "explicit", createdAt: meta.createdAt,
  };
  return { entry, rows: apportion(entry, { explicit: s.byDate }) };
}

/** Keep: a suggestion whose digest the manager kept stays quiet (a `schedule.budget_kept` audit row holds the digest). */
export function suggestionHidden(s: { digest: string }, keptDigests: readonly string[]): boolean {
  return keptDigests.includes(s.digest);
}
