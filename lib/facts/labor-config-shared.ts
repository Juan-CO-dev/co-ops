/** Item 2 PR 2c: the LABOR fact layer's constants and switches, pure (a -shared module never reads env;
 * callers pass values in). Build-time constants (week start, overtime threshold and multiplier, settle
 * hours, history floor) are part of LABOR_BUILDER_VERSION: changing one MUST bump it, which changes every
 * week's fingerprint and rebuilds everything. 0338 carries the same numbers; tests/fact-labor-config.test.ts
 * pins them equal. Read-time settings (Q5 fallback, burden, targets) never enter a build. */
import { DC_MINIMUM_WAGE_CENTS } from "@/lib/scheduling/inputs-shared";

export const LABOR_BUILDER_VERSION = "labor-v1";
/** Juan 2026-11-16 (Q7): history starts 2026-07-23; its payroll week starts Sunday 2026-07-19. */
export const LABOR_HISTORY_FLOOR_DAY = "2026-07-23";
export const LABOR_FLOOR_WEEK = "2026-07-19";
/** Juan Q3: the payroll week is Sunday 00:00 ET; overtime = minutes past 40 h, company-wide, x1.5. */
export const LABOR_OT_THRESHOLD_MINUTES = 2400;
export const LABOR_OT_MULTIPLIER = 1.5;
/** A 7shifts day is covered only by a ledger run that started this long after the day ended. */
export const LABOR_SETTLE_HOURS = 36;
/** Read time: no burden row = this %, always labelled `estimated` (plan open item 1: Juan/Pete give the real one). */
export const LABOR_BURDEN_DEFAULT_PCT = 12;
export const LABOR_TARGET_LOADED_PCT = 28;
export const LABOR_TARGET_HOURLY_PCT = 18;
/** Read time: the shop estimate when a rate is unknown (0274's default, the DC minimum wage). */
export const LABOR_ESTIMATE_DEFAULT_CENTS = DC_MINIMUM_WAGE_CENTS;
/** One labor pass: at most this many weeks are listed (the floor is ~1 week per 7 days of history). */
export const LABOR_PASS_WEEK_LIMIT = 200;
/** One week: its reads and its replace RPC are aborted at this budget (or at the pass end, if sooner). */
export const LABOR_WEEK_TIMEOUT_MS = 60_000;

/** The labor pass runs only when BOTH FACT_LAYER=1 and FACT_LAYER_LABOR=1 (apply 0338 first). */
export function factLaborEnabled(value: string | undefined): boolean {
  return value === "1";
}

/** Q5, read time: carry the person's first known wage back (default), or price at the shop estimate. */
export type WageFallback = "first_known" | "dc_minimum";
export function laborWageFallback(value: string | undefined): WageFallback {
  return value === "dc_minimum" ? "dc_minimum" : "first_known";
}
