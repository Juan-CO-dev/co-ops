/**
 * Item 21 PR 5 — MATCHING THE OLDER ORDERS (Juan answer 7). Pure rules.
 *
 * The house reconciler (0348) only ever looks at the last nine days, so an order older than that is never matched by
 * the cron. The backfill is the SAME reconciler run over older stretches, started by a person:
 *   - it never reaches an event before the shop's `auto_link_from_date` (older orders stay suggestions a person links
 *     in the order's panel; the date is the Owner's / CGS's / MoO's to move on the settings card);
 *   - it adds nothing the cron would not add: every rule is the reconciler's own, in SQL (an owner, a tombstone, a
 *     no-ring order, a dual-code check, two orders on one check, the day-before to a-week-after window, an ezCater
 *     dining option, and EVIDENCE PENDING: a check whose capture the note lookup has not examined is never linked);
 *   - so each stretch first lets the one note lookup examine that stretch's captures, then links.
 * One step = one request: either "checking" (some captures were examined, more are left: ask again with the same
 * cursor) or "linked" (the stretch was reconciled: go on from `next`). The cursor is a DATE, never a count: a list
 * that changes between two steps cannot make a step skip an order (review PORTAL5-r1).
 * Zero I/O. Client-safe.
 */
export const BACKFILL_WINDOW_DAYS = 60;
/** The reconciler's refusals (0348), in its order. Pinned against the migration. */
export const BACKFILL_SKIPS = ["blocked", "no_ring_expected", "switch_off", "before_start_date", "owned", "out_of_window", "evidence_pending", "dual_code",
  "two_house_orders", "ezcater_dining_option"] as const;
export type BackfillSkip = (typeof BACKFILL_SKIPS)[number];

export interface BackfillStatus {
  /** off = the shop is off; no_switch = no automatic switch (or no start date); not_installed = 0344 / 0348 missing. */
  state: "ready" | "off" | "no_switch" | "not_installed";
  startDate: string | null;
  /** Booked house orders with no Toast check linked, through today. */
  unmatched: number;
  /** ... of which the backfill may reach (event on or after the start date) / may not (before it). */
  fromStart: number;
  beforeStart: number;
}
export const EMPTY_BACKFILL_STATUS = (state: BackfillStatus["state"], startDate: string | null = null): BackfillStatus =>
  ({ state, startDate, unmatched: 0, fromStart: 0, beforeStart: 0 });

export interface BackfillStep {
  phase: "checking" | "linked" | "done";
  /** The stretch of event dates this step worked on (null when nothing was left). */
  from: string | null; to: string | null;
  /** checking: captures the note lookup examined in this step, and how many are still unexamined (capped at 500). */
  examined: number; pendingOrders: number;
  /** linked / done: what the reconciler added in this stretch, and what it left for a person, by reason. */
  added: number; ringCode: number; toastOrigin: number;
  skipped: Partial<Record<BackfillSkip, number>>;
  /** The cursor for the next step; null = finished. While checking it is this stretch's own start. */
  next: string | null;
}

const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
export const addDays = (d: string, n: number): string => new Date((day(d) + n) * 86_400_000).toISOString().slice(0, 10);
export const realDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * The next stretch: it starts at the first unmatched event on or after the cursor (empty time is skipped) and runs at
 * most BACKFILL_WINDOW_DAYS, never past today. null = no unmatched order is left from the cursor on.
 */
export function backfillWindow(unmatchedDates: readonly string[], cursor: string, today: string): { from: string; to: string } | null {
  const first = [...unmatchedDates].filter((d) => d >= cursor && d <= today).sort()[0];
  if (!first) return null;
  const end = addDays(first, BACKFILL_WINDOW_DAYS);
  return { from: first, to: end < today ? end : today };
}
export const nextCursor = (window: { to: string }, today: string): string | null => (window.to < today ? addDays(window.to, 1) : null);

/** Counts by reason from the reconciler's answer: only its own vocabulary, only whole positive numbers. */
export function backfillSkips(raw: unknown): Partial<Record<BackfillSkip, number>> {
  const out: Partial<Record<BackfillSkip, number>> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const reason of BACKFILL_SKIPS) {
    const n = (raw as Record<string, unknown>)[reason];
    if (typeof n === "number" && Number.isInteger(n) && n > 0) out[reason] = n;
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Strict: exactly `locationId` and `cursor` (a real date, or null to start at the shop's start date). */
export function parseBackfillStep(raw: unknown): { locationId: string; cursor: string | null } | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).length !== 2 || !("cursor" in body) || typeof body.locationId !== "string" || !UUID.test(body.locationId)) return null;
  if (body.cursor !== null && !realDate(body.cursor)) return null;
  return { locationId: body.locationId.toLowerCase(), cursor: body.cursor as string | null };
}
