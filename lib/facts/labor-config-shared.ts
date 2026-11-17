/** Item 2 PR 2c: the LABOR fact layer's constants and switches, pure (a -shared module never reads env;
 * callers pass values in). Build-time constants (week start, overtime threshold and multiplier, settle
 * hours, history floor) are part of LABOR_BUILDER_VERSION: changing one MUST bump it, which changes every
 * week's fingerprint and rebuilds everything. 0338 carries the same numbers; tests/fact-labor-config.test.ts
 * pins them equal. Read-time settings (Q5 fallback, burden, targets) never enter a build. */
import { DC_MINIMUM_WAGE_CENTS } from "@/lib/scheduling/inputs-shared";

/** labor-v1 = 0338 (overtime company-wide); labor-v2 = 0339 (overtime per shop, LABOR_OT_SCOPE). */
export const LABOR_BUILDER_VERSION = "labor-v2";
/** Juan 2026-11-16 (Q7): history starts 2026-07-23; its payroll week starts Sunday 2026-07-19. */
export const LABOR_HISTORY_FLOOR_DAY = "2026-07-23";
export const LABOR_FLOOR_WEEK = "2026-07-19";
/** The payroll week runs Sunday 00:00 -> the next Sunday 00:00, ET CALENDAR midnight (never a business day:
 * a Saturday close past midnight puts its after-midnight minutes in the next week). Overtime = minutes past
 * 40 h in that week, x1.5. */
export const LABOR_OT_THRESHOLD_MINUTES = 2400;
export const LABOR_OT_MULTIPLIER = 1.5;
/** WHO the 40 h is counted for. Juan 2026-11-17: the two shops are SEPARATE employers (separate LLCs), so
 * overtime is counted PER SHOP: a person working at both shops gets overtime only from hours past 40 within
 * one shop. `company` = every shop of the database is one employer (a future multi-shop employer). Build
 * time: changing it bumps LABOR_BUILDER_VERSION, and 0339's fact_labor_ot_scope() must say the same (pinned
 * by tests/fact-labor-config.test.ts); each built week records the scope it was built with. */
export type LaborOtScope = "per_shop" | "company";
export const LABOR_OT_SCOPE: LaborOtScope = "per_shop";
/** A 7shifts day is covered only by a ledger run that started this long after the day ended. */
export const LABOR_SETTLE_HOURS = 36;
/** Fix r2 P1: an OPEN punch (no clock-out) could run this long from its clock-in, so every shop-day the
 * span [clock-in, clock-in + 24 h) touches counts it as an open punch (hours unknown, no definitive %),
 * across the payroll-week boundary too: a Saturday 23:00 open punch is read by the next week's source and
 * marks its Sunday. 24 h is past any real shift (the schedule's hard daily maximum is 10.5 h; a closing
 * auto-releases at 16 h), so a later clock-out landing past it is a forgotten punch; its own clock-in day
 * stays unknown until it is closed either way. The span is fixed from clock-in, so a week's set never moves
 * with the clock. 0338's fact_labor_constants().open_span carries the same number. */
export const LABOR_OPEN_PUNCH_SPAN_HOURS = 24;
/** Fix r2 P2, read time: on the PROMISED clock, a day's sales are covered only when every business date
 * in [day - 14, day + 1] that the source captured (a Toast capture run or an order pointer) has covered
 * order facts. A check promised more than 14 days after its business date is the stated limit (counted
 * only once that date is built). 0338's fact_labor_splh carries the same number. */
export const LABOR_PROMISED_LOOKBACK_DAYS = 14;
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
