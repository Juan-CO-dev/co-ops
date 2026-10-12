/**
 * Sales pace baseline — PURE (client-safe, zero I/O).
 *
 * "Normal day" = the trailing same-weekday AVERAGE of captured Toast check totals, per hour, over the
 * weekdays that actually had a completed capture (the basis is stated on the chart). Hours come
 * from the 0232 `hour_weekday` breakdown (ET opened hour); amounts are the Sales section's
 * `toastChecksCents` meaning (pre-tax, after discounts, before refunds). Unknown is never 0: no
 * covered weekday → null curve, null delta.
 */

export interface HourCents { hour: number; cents: number }
export interface HeatCell { dow: number; hour: number; cents: number }

export function hourCurve(rows: readonly HourCents[]): number[] {
  const out = new Array<number>(24).fill(0);
  for (const r of rows) if (Number.isInteger(r.hour) && r.hour >= 0 && r.hour <= 23) out[r.hour] = (out[r.hour] ?? 0) + r.cents;
  return out;
}

/** Cumulative through each hour up to `currentHour` inclusive; later hours are null (not yet). */
export function cumulativeByHour(curve: readonly number[], currentHour: number): Array<number | null> {
  let acc = 0;
  return curve.map((cents, h) => {
    if (h > currentHour) return null;
    acc += cents;
    return acc;
  });
}

/** Average cumulative curve for one weekday across `weeks` covered weekdays; null when no basis. */
export function baselineCumulative(heat: readonly HeatCell[], dow: number, weeks: number): Array<number | null> | null {
  if (weeks <= 0) return null;
  const cells = heat.filter((c) => c.dow === dow);
  if (cells.length === 0) return null;
  const avg = hourCurve(cells).map((c) => Math.round(c / weeks));
  let acc = 0;
  return avg.map((c) => (acc += c));
}

/** Today so far vs the baseline at the same hour, whole percent; null without a positive basis. */
export function paceDeltaPct(today: ReadonlyArray<number | null>, baseline: ReadonlyArray<number | null> | null, currentHour: number): number | null {
  if (!baseline) return null;
  const t = today[currentHour];
  const b = baseline[currentHour];
  if (t == null || b == null || b <= 0) return null;
  return Math.round(((t - b) / b) * 100);
}

/** 0242 exposes only hourly buckets: approximate the cutoff hour linearly by elapsed minutes. */
export function baselineAtMinute(baseline: ReadonlyArray<number | null> | null, minute: number): number | null {
  if (!baseline || minute < 0 || minute >= 1440) return null;
  const hour = Math.floor(minute / 60);
  const before = hour === 0 ? 0 : baseline[hour - 1];
  const through = baseline[hour];
  if (before == null || through == null) return null;
  return Math.round(before + (through - before) * (minute % 60) / 60);
}

/** Age uses the instant, so the 20-minute limit is independent of timezone/DST. */
export function capturePaceAge(capturedAt: string | null, now: Date): { usable: boolean; staleMinutes: number | null } {
  const age = capturedAt === null ? NaN : now.getTime() - Date.parse(capturedAt);
  if (!Number.isFinite(age) || age < 0) return { usable: false, staleMinutes: null };
  return { usable: age <= 20 * 60_000, staleMinutes: age > 20 * 60_000 ? Math.floor(age / 60_000) : null };
}

/** ISO weekday (1 = Monday … 7 = Sunday) — the 0232 `extract(isodow …)` convention — from a Y-M-D, no timezone. */
export function dowOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return ((new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay() + 6) % 7) + 1;
}

/** How many daily buckets of this weekday were covered (a completed capture) — the chart's basis. */
export function sameWeekdayCoverage(buckets: ReadonlyArray<{ from: string; coveredDays: number }>, dow: number): number {
  return buckets.filter((b) => dowOf(b.from) === dow && b.coveredDays > 0).length;
}
