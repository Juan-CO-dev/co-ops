/**
 * THE CLOSING CHECKLIST DURATION — measured, pure (Scheduling Phase 2, r2 P2-9, J8).
 *
 * The manager's override (`structure.limits.closingMinutesOverride`) WINS when set; the screen still
 * shows the measurement beside it. Otherwise the p75 (nearest rank) of (finalize instant − service
 * close) over the last 28 FINALIZED closes, with at least 8 samples, rounded UP to 15 minutes;
 * otherwise 45. Only finalized closes count — the 0233 durable-finalize rule: `confirmed` /
 * `incomplete_confirmed` with an `is_final_confirmation` submission (instant = `confirmed_at`), or
 * `auto_finalized` (instant = the last live completion). The day's canonical instance is its LATEST
 * (`stationClosures`' order: shift start, then trigger time, then id, all descending); an unfinished
 * canonical instance excludes the day. Instants are compared to the service close's ET wall time on
 * that business date (`etWallMinutesInstant`, DST-correct). The facts arrive through `loadPeopleFacts`
 * (Task 16's `closingFinalization` family).
 */
import { etWallMinutesInstant } from "@/lib/operational-day";
import { ceil15Q, Q_MINUTES } from "./time-shared";

export interface ClosingFinalizationFact {
  instanceId: string;
  date: string;
  shiftStartAt: string | null;
  triggeredAt: string | null;
  status: string;
  confirmedAt: string | null;
  hasFinalConfirmation: boolean;
  lastLiveCompletionAt: string | null;
}

export interface ClosingDurationResult { minutes: number | null; samples: number; basis: "measured" | "insufficient" }

const desc = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : Date.parse(b) - Date.parse(a));

/** The finalize instant of a canonical instance, or null when it is not finalized. */
function finalizedAt(f: ClosingFinalizationFact): string | null {
  if ((f.status === "confirmed" || f.status === "incomplete_confirmed") && f.hasFinalConfirmation && f.confirmedAt) return f.confirmedAt;
  if (f.status === "auto_finalized" && f.lastLiveCompletionAt) return f.lastLiveCompletionAt;
  return null;
}

export function closingDuration(
  facts: readonly ClosingFinalizationFact[],
  serviceCloseQ: number | Readonly<Record<string, number>>,
  opts: { window?: number; minSamples?: number; quantile?: number } = {},
): ClosingDurationResult {
  const { window = 28, minSamples = 8, quantile = 0.75 } = opts;
  const latest = new Map<string, ClosingFinalizationFact>();
  for (const f of facts) {
    const cur = latest.get(f.date);
    if (!cur) { latest.set(f.date, f); continue; }
    const order = desc(f.shiftStartAt, cur.shiftStartAt) || desc(f.triggeredAt, cur.triggeredAt) || (cur.instanceId < f.instanceId ? -1 : 1);
    if (order < 0) latest.set(f.date, f);
  }
  const finalized: Array<{ date: string; minutes: number }> = [];
  for (const [date, f] of latest) {
    const at = finalizedAt(f);
    const closeQ = typeof serviceCloseQ === "number" ? serviceCloseQ : serviceCloseQ[date];
    if (!at || closeQ === undefined) continue;
    const close = etWallMinutesInstant(date, closeQ * Q_MINUTES).getTime();
    finalized.push({ date, minutes: Math.max(0, Math.floor((Date.parse(at) - close) / 60000)) });
  }
  const recent = finalized.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, window);
  if (recent.length < minSamples) return { minutes: null, samples: recent.length, basis: "insufficient" };
  const sorted = recent.map((r) => r.minutes).sort((a, b) => a - b);
  const p = sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)]!;
  return { minutes: ceil15Q(p) * Q_MINUTES, samples: recent.length, basis: "measured" };
}

/** Which closing minutes apply: the override WINS, else the measurement (≥ the minimum samples), else the fallback. */
export function resolveClosingMinutes(input: { override: number | null; measured: ClosingDurationResult; fallback?: number }): {
  minutes: number; basis: "override" | "measured" | "default"; measuredMinutes: number | null;
} {
  const measuredMinutes = input.measured.basis === "measured" ? input.measured.minutes : null;
  if (input.override !== null) return { minutes: input.override, basis: "override", measuredMinutes };
  if (measuredMinutes !== null) return { minutes: measuredMinutes, basis: "measured", measuredMinutes };
  return { minutes: input.fallback ?? 45, basis: "default", measuredMinutes };
}
