/**
 * ET operational-day derivation — PURE, client-safe, zero I/O (the `*-shared.ts`
 * pattern, AGENTS.md). Consolidates the day-of-week / weekend-par derivation that
 * lib/ordering.ts (etWalkDay) and lib/purchase-orders.ts (etToday) each inlined.
 *
 * WHY A THIRD MODULE (not one importing the other): lib/ordering.ts imports
 * createDraftsFromLines from lib/purchase-orders.ts, so purchase-orders MUST NOT
 * import from ordering (a cycle). This pure leaf is imported by both — no cycle.
 *
 * The ET calendar-date primitive itself already lives twice (byte-identical:
 * counts-shared.etBusinessDate == operational-day.etCalendarDate, both
 * `toLocaleDateString("en-CA", { timeZone: "America/New_York" })`). We do NOT add
 * a third copy of THAT — the caller passes the already-derived ET date string in.
 * This module owns only the shared derivation ON that date: parse at local
 * midnight (preserves the date components regardless of server TZ, so getDay() is
 * that ET date's weekday even on Vercel's UTC) → dow + the weekend-par flag.
 *
 * The weekend-par rule (locked, migration 0172): Fri/Sat/Sun = getDay() ∈ {5,6,0}
 * (JS getDay convention, matches vendors.order_days / vendor_cutoffs.order_day).
 */

/** Fri/Sat/Sun = getDay() ∈ {5,6,0} — the locked weekend-par day set. */
export function isWeekendParDow(dow: number): boolean {
  return dow === 5 || dow === 6 || dow === 0;
}

/**
 * Derive the day-of-week and weekend-par flag for an ET calendar date string
 * (YYYY-MM-DD). Parse at LOCAL midnight so the date components survive (getDay()
 * then reflects the ET date's weekday regardless of the server's timezone — the
 * evening-order-must-not-roll-into-tomorrow guarantee). Pure over its input.
 */
export function etDayFromDate(dateEt: string): { dow: number; weekend: boolean } {
  const etDate = new Date(`${dateEt}T00:00:00`);
  const dow = etDate.getDay(); // 0=Sun..6=Sat (order_days / order_day convention).
  return { dow, weekend: isWeekendParDow(dow) };
}
