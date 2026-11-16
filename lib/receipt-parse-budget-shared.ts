/**
 * Every time budget around one receipt parse, in one place (audit W20/B115).
 *
 * The model call's bound is the only number chosen here for parsing. Everything a caller uses to
 * decide "may I start a parse now?" is worked out from it below, so a longer or shorter call can
 * never leave one caller admitting work its function cannot finish. Three kinds of caller parse:
 *   - the mail webhook, right after it fetched the message (lib/inbound-parse.ts),
 *   - the 15-minute sweep and its daily catch-up (lib/parse-receipts-run.ts),
 *   - "Parse now", a person asking for one receipt (the email-receipts route).
 * A route's `maxDuration` must stay a literal in its own file (Next reads it at build time), so
 * each route turns its own literal into a deadline with `routeWorkDeadline`, and
 * tests/audit-w20-b115-parse-budgets.test.ts checks every literal against these numbers.
 */

/** Wall-clock bound on one model call. A long invoice's answer takes well over a minute. */
export const PARSE_CALL_TIMEOUT_MS = 150_000;

/** Around the call: downloading the stored files, the guarded write, and order matching. */
export const PARSE_ROW_OVERHEAD_MS = 20_000;

/** What one parse may need from start to finish. A parse starts only with this much in hand. */
export const PARSE_ROW_RESERVE_MS = PARSE_CALL_TIMEOUT_MS + PARSE_ROW_OVERHEAD_MS;

/** Kept free at the end of a function for what follows the work: heartbeat, watch, response. */
export const ROUTE_TAIL_RESERVE_MS = 20_000;

/** Between the sweep's fetch leg ending and its first parse starting: the queue read. */
export const PARSE_HANDOFF_MS = 10_000;

/** The instant a route's work must be finished by, from the route's own `maxDuration` (seconds). */
export function routeWorkDeadline(startedAt: number, maxDurationSeconds: number): number {
  return startedAt + maxDurationSeconds * 1000 - ROUTE_TAIL_RESERVE_MS;
}

/** May a parse start at `now`? Only if a whole one still fits before `deadline`. */
export function parseFits(now: number, deadline: number): boolean {
  return now + PARSE_ROW_RESERVE_MS <= deadline;
}

/**
 * When a run both fetches mail and parses receipts, fetching stops here: one whole parse (and the
 * handoff to it) is always left over, however slow fetching is. Without this share a run of slow
 * fetches could use up the time every sweep, and no receipt would ever be read.
 */
export function fetchShareDeadline(deadline: number): number {
  return deadline - PARSE_ROW_RESERVE_MS - PARSE_HANDOFF_MS;
}
