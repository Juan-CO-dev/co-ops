/** Item 2: the fact layer's switches, pure (a -shared module never reads env; callers pass it in).
 * FACT_LAYER=1 turns the hourly build on. Unset (or anything else) = nothing reads or writes.
 * FACT_CAPTURE_FLOOR (YYYY-MM-DD) is the diff's floor (plan r3 Q7); lowering it IS the backfill. */
import { etYmdMinusDays } from "@/lib/operational-day";

export const FACT_DEFAULT_FLOOR_DAYS = 35;
/** One pass: claim at entry, stop starting days at entry + 240 s, inside the 330 s lease. */
export const FACT_PASS_BUDGET_MS = 240_000;
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
