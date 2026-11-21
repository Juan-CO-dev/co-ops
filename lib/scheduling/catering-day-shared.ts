/**
 * THE heavy catering day, and one order's prep window — pure, client-safe, zero I/O (nav spec r5 3.3.11; nav PR 5 plan r4
 * section 4).
 *
 * Juan: a heavy catering day is the DAY's total guests across its booked orders, not one big order. The shop's existing
 * setting `catering.minHeadcount` ("Catering prep from (guests)") is read as that total. A day with no booked order is
 * never heavy, whatever the setting; with the setting at 0, any day with at least one order is heavy.
 *
 * The Dashboard's day engine (lib/day-plan-shared.ts) calls these now. The schedule moves its three per-order call sites
 * (need-shared, settings, crew-gap-verifier) and `cateringWindows` onto them in PR SCH, unchanged: the signatures take
 * `{ headcount: number | null }` and an `eventQ: number | null`, which the schedule's own day events already satisfy.
 * The dependency points one way: the Dashboard reads the schedule's rule; the schedule never imports the Dashboard.
 */
import type { ScheduleStructure } from "./structure-shared";

export interface CateringDayLoad {
  readonly heavy: boolean;
  /** Σ headcount over the day's orders; a missing count adds 0 (as inputs-shared's conversion does). */
  readonly guests: number;
  readonly orders: number;
  /** Orders whose headcount is null ("no guest count", kept as its own fact). */
  readonly missingCounts: number;
}

/**
 * The DAY's booked orders (pipeline confirmed/out/completed + ezCater not cancelled; the caller drops cancelled ones, as
 * toCateringEvents does). Heavy ⇔ at least one order AND Σ guests ≥ minHeadcount.
 */
export function cateringDayLoad(
  orders: ReadonlyArray<{ readonly headcount: number | null }>,
  setting: Pick<ScheduleStructure["catering"], "minHeadcount">,
): CateringDayLoad {
  let guests = 0;
  let missingCounts = 0;
  for (const order of orders) {
    if (order.headcount === null) missingCounts += 1;
    else guests += order.headcount;
  }
  return { heavy: orders.length > 0 && guests >= setting.minHeadcount, guests, orders: orders.length, missingCounts };
}

/** = cateringDayLoad(...).heavy */
export function isHeavyCateringDay(
  orders: ReadonlyArray<{ readonly headcount: number | null }>,
  setting: Pick<ScheduleStructure["catering"], "minHeadcount">,
): boolean {
  return cateringDayLoad(orders, setting).heavy;
}

/**
 * One order's prep window in quarters: [event − leadMinutes/15 (floored at 0), event) for an order with a time, else the
 * shop's default window [defaultStartQ, defaultEndQ). The twin of the schedule's `cateringWindows` per order.
 */
export function cateringPrepWindowQ(
  eventQ: number | null,
  c: Pick<ScheduleStructure["catering"], "leadMinutes" | "defaultStartQ" | "defaultEndQ">,
): readonly [fromQ: number, toQ: number] {
  return eventQ === null ? [c.defaultStartQ, c.defaultEndQ] : [Math.max(0, eventQ - c.leadMinutes / 15), eventQ];
}
