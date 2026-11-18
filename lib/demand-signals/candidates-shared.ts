/**
 * Demand signals (item 4 PR 1): the COMPOSITION BOUNDS and the two ZERO-FEED candidates. Pure. No network,
 * no feed, no table: the trend comes from the shop's own sales and the holidays from the calendar.
 *
 * Both candidates are knowable at the decision, so on history they are E1 (display only) and on the
 * prospective ledger they can become E2. They change NO live number in PR 1: nothing outside the replay
 * harness calls this module (tests/demand-signals-dark.test.ts pins it).
 *
 * ── THE BOUNDS (plan r2 §5; PR 4 wires them live, this is their one home) ───────────────────
 *   each signal            0.85 – 1.15
 *   the signal product     0.80 – 1.20
 *   signals x velocity     0.75 – 1.25   (today's velocity envelope: signals cannot widen it)
 * Order for pars: rate x velocity x signal, then the cushion, then max(…, peak floor), then rounding,
 * then the unchanged guard stack. For labor the multiplier applies to the hourly dollars and the manager's
 * day-type override still wins.
 */
import { addDaysEt } from "@/lib/vendor-rhythm-shared";

export const SIGNAL_BOUNDS = Object.freeze({
  perSignal: Object.freeze([0.85, 1.15]) as readonly [number, number],
  product: Object.freeze([0.8, 1.2]) as readonly [number, number],
  withVelocity: Object.freeze([0.75, 1.25]) as readonly [number, number],
});

const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.max(lo, Math.min(hi, v));
const usable = (v: number): boolean => Number.isFinite(v) && v > 0;

export function clampSignal(multiplier: number): number {
  return usable(multiplier) ? clamp(multiplier, SIGNAL_BOUNDS.perSignal) : 1;
}

/**
 * The ONE multiplier the signals contribute, given the velocity already in the forecast.
 * NO SIGNAL IS EXACTLY 1: with no signal (or only silent ones) this returns the literal 1, so the candidate
 * arm is byte-identical to the baseline and nothing live can move.
 */
export function composeSignals(signals: ReadonlyArray<number>, velocityRatio: number): number {
  const active = signals.filter(usable).map(clampSignal).filter((s) => s !== 1);
  if (active.length === 0) return 1;
  const product = clamp(active.reduce((a, b) => a * b, 1), SIGNAL_BOUNDS.product);
  const velocity = usable(velocityRatio) ? velocityRatio : 1;
  return clamp(velocity * product, SIGNAL_BOUNDS.withVelocity) / velocity;
}

// ── The calendar ────────────────────────────────────────────────────────────────────────────

const ymd = (y: number, m: number, d: number): string => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const dowOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
/** The n-th `dow` (0 = Sunday) of a month. */
function nth(y: number, m: number, dow: number, n: number): string {
  const first = dowOf(ymd(y, m, 1));
  return ymd(y, m, 1 + ((dow - first + 7) % 7) + (n - 1) * 7);
}
function last(y: number, m: number, dow: number): string {
  const end = ymd(y, m + 1, 0);
  return addDaysEt(end, -((dowOf(end) - dow + 7) % 7));
}

export interface Holiday { date: string; key: string; observed: boolean }

/**
 * The US federal holidays whose ACTUAL date is in `year`, plus the observed day when the date falls on a
 * weekend (Saturday -> Friday, Sunday -> Monday). An observed day can fall in the year before (New Year's
 * Day 2028 is observed on 2027-12-31): `holidayOn` looks at both years.
 */
export function federalHolidays(year: number): Holiday[] {
  const fixed: Array<[string, string]> = [
    ["new_years_day", ymd(year, 1, 1)], ["juneteenth", ymd(year, 6, 19)], ["independence_day", ymd(year, 7, 4)],
    ["veterans_day", ymd(year, 11, 11)], ["christmas_day", ymd(year, 12, 25)],
  ];
  const floating: Array<[string, string]> = [
    ["mlk_day", nth(year, 1, 1, 3)], ["presidents_day", nth(year, 2, 1, 3)], ["memorial_day", last(year, 5, 1)],
    ["labor_day", nth(year, 9, 1, 1)], ["columbus_day", nth(year, 10, 1, 2)], ["thanksgiving", nth(year, 11, 4, 4)],
  ];
  const out: Holiday[] = floating.map(([key, date]) => ({ key, date, observed: false }));
  for (const [key, date] of fixed) {
    out.push({ key, date, observed: false });
    const dow = dowOf(date);
    if (dow === 6) out.push({ key, date: addDaysEt(date, -1), observed: true });
    if (dow === 0) out.push({ key, date: addDaysEt(date, 1), observed: true });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The holiday on a date, if any (the actual day wins over an observed one on the same date). */
export function holidayOn(date: string): { key: string; observed: boolean } | null {
  const year = Number(date.slice(0, 4));
  const hits = [...federalHolidays(year), ...federalHolidays(year + 1)].filter((h) => h.date === date);
  const hit = hits.find((h) => !h.observed) ?? hits[0];
  return hit ? { key: hit.key, observed: hit.observed } : null;
}

// ── The two models. Their canonical JSON is what a model hash names (lib/demand-signals/hash.ts). ──

export const HOLIDAY_MODEL = Object.freeze({ kind: "calendar_holiday", v: 1, calendar: "us_federal_with_observed", bucket: "any_holiday", shrinkK: 3 });
export const TREND_MODEL = Object.freeze({ kind: "trend", v: 1, recentDays: 7, priorDays: 7, shrink: 0.5, deadband: 0.03 });

export interface SignalValue { multiplier: number; active: boolean; eventKey: string | null }
const SILENT: SignalValue = { multiplier: 1, active: false, eventKey: null };

/**
 * The holiday candidate for a valid date. `priorRatios` = actual / baseline forecast on EARLIER holidays whose
 * targets were already frozen at the decision (walk-forward: the caller never passes a later one). One bucket
 * for every holiday, shrunk toward 1 by `shrinkK` pseudo-observations, then clamped. With nothing to learn
 * from it is silent: an unfitted multiplier is not a signal.
 */
export function holidaySignal(validDate: string, priorRatios: ReadonlyArray<number>, model: typeof HOLIDAY_MODEL = HOLIDAY_MODEL): SignalValue {
  const holiday = holidayOn(validDate);
  if (holiday === null) return SILENT;
  const ratios = priorRatios.filter(usable);
  if (ratios.length === 0) return { multiplier: 1, active: false, eventKey: holiday.key };
  const shrunk = (ratios.reduce((a, b) => a + b, 0) + model.shrinkK) / (ratios.length + model.shrinkK);
  const multiplier = clampSignal(shrunk);
  return { multiplier, active: multiplier !== 1, eventKey: holiday.key };
}

/**
 * The trend candidate at a decision: the total of the last `recentDays` days over the total of the
 * `priorDays` before them (two whole weeks, so the weekday mix is the same on both sides), moved half way
 * back to 1, silent inside the deadband, clamped. It reads ONLY days strictly before the decision date, and
 * it needs every one of them: a missing day is missing data, not a quiet day, so the candidate stays silent.
 */
export function trendSignal(series: ReadonlyArray<{ date: string; value: number }>, decisionDate: string, model: typeof TREND_MODEL = TREND_MODEL): SignalValue {
  const byDate = new Map<string, number>();
  for (const s of series) if (s.date < decisionDate && Number.isFinite(s.value)) byDate.set(s.date, s.value);
  let recent = 0, prior = 0;
  for (let i = 1; i <= model.recentDays + model.priorDays; i += 1) {
    const v = byDate.get(addDaysEt(decisionDate, -i));
    if (v === undefined) return SILENT;
    if (i <= model.recentDays) recent += v; else prior += v;
  }
  if (!(prior > 0)) return SILENT;
  const raw = Math.round((1 + model.shrink * (recent / prior - 1)) * 1e6) / 1e6;
  if (Math.abs(raw - 1) < model.deadband) return SILENT;
  const multiplier = clampSignal(raw);
  return { multiplier, active: true, eventKey: multiplier > 1 ? "trend_up" : "trend_down" };
}
