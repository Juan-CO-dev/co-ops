/**
 * DEMAND — the pulse's "normal day", nothing more (Scheduling Phase 2, plan "Where demand comes from", J3).
 *
 * The forecast for business date D, built as of A, is the trailing same-weekday per-hour average of
 * Toast check totals over the 28 days before A: RPC `pulse_sales_baseline` (0242) through the shared
 * pure `baselineHourly` (lib/pulse/baseline-shared). `weeks(D)` = the captured days in the window with
 * D's ISO weekday — the pulse's honest denominator. No trend, holiday, event or weather adjustment;
 * catering is NAMED and never summed (the baseline already holds Toast-rung catering checks); the hour
 * is the check's OPENED hour.
 *
 * Discriminated (r2 P2-6): `unavailable` (timeout / missing RPC / RPC error) never builds and never
 * falls back to a flat curve; `no_history` (a successful RPC with no captured day of the weekday) builds
 * on the day-type override / weekend / Normal crew with a flag.
 */
import { baselineHourly, type HeatCell } from "@/lib/pulse/baseline-shared";
import { addDays, isoDowOf, isoWeekStart } from "./time-shared";
import type { CrewType, ScheduleStructure } from "./structure-shared";

export interface BaselineRaw { hours: HeatCell[]; capturedDays: string[] }
export type DemandUnavailableCause = "timeout" | "rpc_missing" | "rpc_error";
/** What `fetchSalesBaseline` (Task 16) returns: the RPC's raw result, or why it did not load. */
export type SalesBaselineResult = { kind: "ok"; raw: BaselineRaw } | { kind: "unavailable"; cause: DemandUnavailableCause };

export interface CateringEvent { id: string; date: string; name: string; headcount: number; valueCents: number | null; eventQ: number | null }

export type ForecastConfidence = "normal" | "thin" | "further_out";
export type DayForecast =
  | {
    kind: "ok"; date: string; hourlyCents: number[]; dayCents: number; weeks: number; basis: "trailing_same_weekday";
    weeksAhead: number; confidence: ForecastConfidence; unknownCents: number; catering: CateringEvent[];
  }
  | { kind: "no_history"; date: string; weeksAhead: number; catering: CateringEvent[] };

export type DemandResult =
  | { kind: "ok"; days: DayForecast[] }
  | { kind: "unavailable"; cause: DemandUnavailableCause }
  /** Astra chunk A P2-7: the dates and their booked catering survive a shop with no sales history at all. */
  | { kind: "no_history"; days: DayForecast[] };

/** Whole ISO weeks from the build day's week to D's week (0 = this week, 1 = next week …). */
function weeksAheadOf(date: string, asOf: string): number {
  const a = isoWeekStart(asOf);
  const d = isoWeekStart(date);
  let n = 0;
  if (d >= a) { for (let w = a; w < d; w = addDays(w, 7)) n++; return n; }
  for (let w = d; w < a; w = addDays(w, 7)) n--;
  return n;
}

/** One day's forecast from the baseline. Pure. */
export function forecastDay(baseline: SalesBaselineResult, date: string, asOf: string): DayForecast | { kind: "unavailable"; cause: DemandUnavailableCause } {
  if (baseline.kind === "unavailable") return { kind: "unavailable", cause: baseline.cause };
  const dow = isoDowOf(date);
  const weeksAhead = weeksAheadOf(date, asOf);
  const weeks = new Set(baseline.raw.capturedDays.filter((d) => isoDowOf(d) === dow)).size;
  if (weeks === 0) return { kind: "no_history", date, weeksAhead, catering: [] };
  // A captured weekday with no sales is a TRUE zero, never "no history".
  const hourlyCents = baselineHourly(baseline.raw.hours, dow, weeks) ?? new Array<number>(24).fill(0);
  const outOfRange = baseline.raw.hours.filter((c) => c.dow === dow && !(Number.isInteger(c.hour) && c.hour >= 0 && c.hour <= 23));
  const unknownCents = Math.round(outOfRange.reduce((n, c) => n + c.cents, 0) / weeks);
  const confidence: ForecastConfidence = weeks <= 2 ? "thin" : weeksAhead >= 2 ? "further_out" : "normal";
  return {
    kind: "ok", date, hourlyCents, dayCents: hourlyCents.reduce((a, b) => a + b, 0), weeks, basis: "trailing_same_weekday",
    weeksAhead, confidence, unknownCents, catering: [],
  };
}

/** The forecast of several dates: `unavailable` propagates; `no_history` when no needed weekday was captured. */
export function forecastWeek(baseline: SalesBaselineResult, dates: readonly string[], asOf: string): DemandResult {
  if (baseline.kind === "unavailable") return { kind: "unavailable", cause: baseline.cause };
  const days = dates.map((d) => forecastDay(baseline, d, asOf) as DayForecast);
  if (days.every((d) => d.kind === "no_history")) return { kind: "no_history", days };
  return { kind: "ok", days };
}

/** Name the booked catering events on their dates (with or without sales history). Never changes `dayCents` (named, never summed). */
export function withCatering(result: DemandResult, events: readonly CateringEvent[]): DemandResult {
  if (result.kind === "unavailable") return result;
  const days = result.days.map((d) => ({ ...d, catering: events.filter((e) => e.date === d.date).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }));
  return result.kind === "ok" ? { kind: "ok", days } : { kind: "no_history", days };
}

export type DayTypeOverride = "auto" | "slow" | "normal" | "busy";

/**
 * The day type, in the r2 P2-12 order: (1) a non-`auto` manager override for that date; (2) the weekend
 * classification; (3) the forecast thresholds (`no_history` → normal).
 */
export function dayTypeFor(
  date: string,
  input: { override: { id: string; dayType: DayTypeOverride } | null; structure: ScheduleStructure; forecast: DayForecast | { kind: "unavailable"; cause: DemandUnavailableCause } | null },
): { dayType: CrewType; source: "override" | "weekend" | "forecast" | "no_history"; overrideId: string | null } {
  const o = input.override;
  if (o && o.dayType !== "auto") return { dayType: o.dayType, source: "override", overrideId: o.id };
  if (input.structure.dayTypes.weekendIsoDows.includes(isoDowOf(date))) return { dayType: "weekend", source: "weekend", overrideId: null };
  const f = input.forecast;
  if (!f || f.kind !== "ok") return { dayType: "normal", source: "no_history", overrideId: null };
  const { slowBelowCents, busyAboveCents } = input.structure.dayTypes;
  const dayType: CrewType = f.dayCents < slowBelowCents ? "slow" : f.dayCents > busyAboveCents ? "busy" : "normal";
  return { dayType, source: "forecast", overrideId: null };
}
