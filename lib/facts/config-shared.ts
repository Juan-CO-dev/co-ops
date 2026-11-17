/** Item 2: the fact layer's switches, pure (a -shared module never reads env; callers pass it in).
 * FACT_LAYER=1 turns the hourly build on. Unset (or anything else) = nothing reads or writes.
 * FACT_CAPTURE_FLOOR (YYYY-MM-DD) is the diff's floor (plan r3 Q7); lowering it IS the backfill. */
import { etYmdMinusDays } from "@/lib/operational-day";

export const FACT_DEFAULT_FLOOR_DAYS = 35;
/** One pass: claim at entry; NOTHING of the pass runs past entry + 240 s (inside maxDuration 300 s and
 * the 330 s lease), so the result and its health row are always written (review r1 #3). */
export const FACT_PASS_BUDGET_MS = 240_000;
/** One day: its reads and its replace RPC are aborted at this budget (or at the pass end, if sooner).
 * A day is STARTED only when a whole day budget is left before the pass end. */
export const FACT_DAY_TIMEOUT_MS = 45_000;
/** At most this many failed days are named in the health row; all are counted. */
export const FACT_FAILURE_SAMPLE = 20;
export const FACT_PASS_DAY_LIMIT = 500;

export function factLayerEnabled(value: string | undefined): boolean {
  return value === "1";
}

/** The floor: an explicit valid date, else today (ET) minus the default window. Never a guess. */
export function factFloor(value: string | undefined, todayEt: string): string {
  if (value !== undefined && value !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
      throw new Error("fact_invalid_floor");
    }
    return value;
  }
  return etYmdMinusDays(todayEt, FACT_DEFAULT_FLOOR_DAYS);
}
