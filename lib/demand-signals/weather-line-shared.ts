/**
 * Demand signals: WHAT A SHORT WEATHER LINE MUST SAY, pure and import-free (review DEMAND4-r1 P2).
 *
 * A DERIVED FIGURE INHERITS ITS INPUTS' QUALIFICATIONS, on EVERY surface that shows it. The signals page and the
 * order walk both show a one-line forecast, and each used to build its own: the walk's line said "rain up to 0%"
 * when one hour of sixteen had given a chance of rain. So the decision is made ONCE, here, and one component
 * (components/admin/demand-signals/WeatherSummary.tsx) renders it for both. A new surface that shows a forecast
 * uses that component; a test fails if another file spells the line's keys.
 *   · rain: "not given" when no hour gave a chance; `partial` (with the counts) when only some hours did;
 *     `whole` only when every held hour did. A GIVEN 0% is a value; a missing one is never 0.
 *   · old: the forecast is only as current as its feed's last run (the run ledger), never the row's own time.
 *   · part of the day (fewer than the service day's hours) is `partial` on the day itself, carried by the caller.
 */
export type RainLine =
  | { kind: "not_given" }
  | { kind: "whole"; pct: number }
  | { kind: "partial"; pct: number; known: number; hours: number };

export function rainLineOf(w: { precipMaxPct: number | null; precipHours: number; hours: number }): RainLine {
  if (w.precipMaxPct === null || w.precipHours <= 0) return { kind: "not_given" };
  return w.precipHours < w.hours ? { kind: "partial", pct: w.precipMaxPct, known: w.precipHours, hours: w.hours } : { kind: "whole", pct: w.precipMaxPct };
}

/** Is any feed behind this day's forecast anything but freshly run? An unknown feed cannot prove freshness. */
export function weatherIsOld(sourceIds: ReadonlyArray<string>, feeds: Readonly<Record<string, string>>): boolean {
  return sourceIds.some((id) => feeds[id] !== "fresh");
}
