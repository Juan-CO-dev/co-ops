/**
 * Demand signals (item 4 PR 1): what the forecast ledger and the target freeze are GIVEN (0341's writer
 * arguments), built from the replay harness's own forecasts. No I/O; a caller passes env values in.
 *
 * DEMAND_LEDGER=1 turns the nightly pass on. Unset (or anything else) = nothing is read and nothing is written.
 * Apply 0341 first: before it the pass finds no writer and stays silent.
 */
import { CUSHION_BY_CLASS, CUSHION_DEFAULT, DYNAMIC_PARS } from "@/lib/dynamic-pars-shared";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import { HOLIDAY_MODEL, SIGNAL_BOUNDS, TREND_MODEL } from "./candidates-shared";
import { addressOf } from "./hash";
import {
  PAR_LEADS, REPLAY_ENGINES, blobOf, parDailyForecast,
  type Blob, type LaborForecast, type ParForecast, type PrepForecast, type ReplaySurface,
} from "./replay";
import { PASS_RULE } from "./scoring-shared";

export function demandLedgerEnabled(value: string | undefined): boolean {
  return value === "1";
}

/** Targets freeze at D+4, after the T-3 recapture has closed. 0341 refuses anything earlier. */
export const TARGET_FREEZE_LAG_DAYS = 4;
export function targetFreezable(validDate: string, todayEt: string): boolean {
  return todayEt >= addDaysEt(validDate, TARGET_FREEZE_LAG_DAYS);
}
/** The valid date whose target comes due on a given ET day. */
export function freezeDateFor(todayEt: string): string {
  return addDaysEt(todayEt, -TARGET_FREEZE_LAG_DAYS);
}

export type FeatureClass = "baseline" | "known_in_advance" | "hindsight";
export interface ModelRegistration { blob: Blob; surface: ReplaySurface; modelKey: string; featureClass: FeatureClass }

/**
 * A baseline engine as a registered model: its name plus every constant its answer depends on. Change a
 * constant and the hash changes, so the ledger says which engine made which forecast.
 */
export function baselineModel(surface: ReplaySurface): ModelRegistration {
  const spec = surface === "pars"
    ? { kind: "baseline", surface, engine: REPLAY_ENGINES.pars, constants: DYNAMIC_PARS, cushionByClass: CUSHION_BY_CLASS, cushionDefault: CUSHION_DEFAULT }
    : { kind: "baseline", surface, engine: REPLAY_ENGINES[surface] };
  return { blob: blobOf("model", spec), surface, modelKey: "baseline", featureClass: "baseline" };
}

/** A zero-feed candidate as a registered model: its frozen parameters, the bounds and the pass rule it will be judged by. */
export function candidateModel(surface: ReplaySurface, key: "trend" | "calendar_holiday"): ModelRegistration {
  const params = key === "trend" ? TREND_MODEL : HOLIDAY_MODEL;
  const spec = { kind: "candidate", surface, engine: REPLAY_ENGINES[surface], signal: params, bounds: SIGNAL_BOUNDS, passRule: PASS_RULE };
  return { blob: blobOf("model", spec), surface, modelKey: key, featureClass: "known_in_advance" };
}

export interface ForecastEntry { valid_date: string; forecast_hash: string; summary: Record<string, string | number | null> }
export interface ForecastRecord { surface: ReplaySurface; engine: string; decisionDate: string; forecast: Blob; entries: ForecastEntry[] }

/** One ledger entry per valid date. Every entry of a night names the SAME forecast blob; the summary is for a human reading the table. */
export function parForecastRecord(f: ParForecast): ForecastRecord {
  const forecast = blobOf("forecast", f);
  const entries = PAR_LEADS.map((lead) => {
    const valid = addDaysEt(f.decisionDate, lead);
    const oz = Object.values(parDailyForecast(f, valid, []));
    return { valid_date: valid, forecast_hash: forecast.hash, summary: { products: oz.length, total_oz: Math.round(oz.reduce((a, b) => a + b, 0) * 100) / 100 } };
  });
  return { surface: "pars", engine: f.engine, decisionDate: f.decisionDate, forecast, entries };
}
export function laborForecastRecord(f: LaborForecast): ForecastRecord {
  const forecast = blobOf("forecast", f);
  return { surface: "labor", engine: f.engine, decisionDate: f.decisionDate, forecast,
    entries: f.days.map((d) => ({ valid_date: d.date, forecast_hash: forecast.hash, summary: { kind: d.kind, day_cents: d.dayCents, day_type: d.dayType, day_type_source: d.dayTypeSource } })) };
}
export function prepForecastRecord(f: PrepForecast): ForecastRecord {
  const forecast = blobOf("forecast", f);
  return { surface: "prep", engine: f.engine, decisionDate: f.decisionDate, forecast,
    entries: f.days.map((d) => ({ valid_date: d.date, forecast_hash: forecast.hash, summary: { items: Object.keys(d.par).length } })) };
}

export interface TargetFreezeArgs { target: string; validDate: string; coverage: "covered" | "not_covered"; blob: Blob | null; fingerprint: string }
/** The fingerprint of "this day was not captured": one fixed name, so a day that is still uncaptured later is 'kept', not 'revised'. */
export const NOT_COVERED_FINGERPRINT = addressOf({ coverage: "not_covered" }).hash;

export function targetFreezeArgs(target: string, validDate: string, read: { coverage: "covered" | "not_covered"; payload: unknown }): TargetFreezeArgs {
  if (read.coverage === "not_covered" || read.payload === null) return { target, validDate, coverage: "not_covered", blob: null, fingerprint: NOT_COVERED_FINGERPRINT };
  const blob = blobOf("target", read.payload);
  return { target, validDate, coverage: "covered", blob, fingerprint: blob.hash };
}
