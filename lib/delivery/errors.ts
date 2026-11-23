/**
 * Catering delivery (D1) — the ONE error type and the closed code vocabulary. No I/O, no server import (a client may
 * import the codes for its messages).
 *
 *  - Every refusal 0356's functions raise is NAMED (errcode P0001, the message is the code). `DELIVERY_SQL_REFUSALS`
 *    is that list; tests/delivery-0356-migration.test.ts pins it equal to the names in the migration, both ways.
 *  - `delivery_off`: the switch (`DELIVERY_TRACKING`, 503, decided here before any query) or the shop's `enabled` (SQL, 409).
 *  - `delivery_unavailable` (503): 0356 is not on the database (42P01 / 42883 / PGRST202 / PGRST205). Never a 500,
 *    never a silent zero.
 *  - `delivery_busy` (409, retryable): a read gave up because the lead kept changing shop under it; nothing was
 *    returned. The lib's own code, never raised by SQL. (D2 owns its en + es message.)
 *  - Anything else is `generic` (500): a failure is never reported as a success.
 */
export const DELIVERY_SQL_REFUSALS = [
  "invalid_request", "invalid_settings", "forbidden", "location_not_found", "settings_moved", "no_change", "lead_not_found", "job_not_found",
  "shop_moved", "lead_not_confirmed", "order_rejected", "quote_ambiguous", "delivery_off", "api_booking_unavailable", "ezcater_never_booked",
  "not_ezcater", "not_delivery", "unknown_provider", "delivery_job_open", "job_closed", "status_moved", "illegal_move", "bad_occurred_at",
  "bad_amount", "cost_exists", "not_current_head", "reason_required", "no_mismatch", "already_kept", "split_moved", "bad_gratuity",
] as const;
export type DeliverySqlRefusal = (typeof DELIVERY_SQL_REFUSALS)[number];

export const DELIVERY_ERROR_CODES = [...DELIVERY_SQL_REFUSALS, "delivery_unavailable", "delivery_busy", "generic"] as const;
export type DeliveryErrorCode = (typeof DELIVERY_ERROR_CODES)[number];

/** PostgREST / Postgres codes that mean "0356 is not installed". */
export const DELIVERY_NOT_INSTALLED = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

const BAD_REQUEST: readonly DeliveryErrorCode[] = ["invalid_request", "invalid_settings", "bad_amount", "bad_occurred_at", "reason_required", "bad_gratuity"];
const NOT_FOUND: readonly DeliveryErrorCode[] = ["lead_not_found", "job_not_found", "location_not_found"];
/** The HTTP status of a code. A stale compare-and-set and every state refusal is a 409 (the panel reloads). */
export function deliveryErrorStatus(code: DeliveryErrorCode): number {
  if (code === "forbidden") return 403;
  if (code === "delivery_unavailable") return 503;
  if (code === "generic") return 500;
  if (BAD_REQUEST.includes(code)) return 400;
  if (NOT_FOUND.includes(code)) return 404;
  return 409;
}

export class DeliveryError extends Error {
  constructor(public status: number, public code: DeliveryErrorCode) { super(code); this.name = "DeliveryError"; }
}
/** The switch is off: 503, decided before any query. */
export const deliveryOff = () => new DeliveryError(503, "delivery_off");

export function isDeliverySqlRefusal(v: unknown): v is DeliverySqlRefusal {
  return typeof v === "string" && (DELIVERY_SQL_REFUSALS as readonly string[]).includes(v);
}

/**
 * A database error → the named DeliveryError. `uniqueViolation` = what a 23505 means for THIS call (the loser of a
 * double tap that slipped past the writer's own check: `delivery_job_open` for a new job, `cost_exists` for a first cost).
 */
export function deliveryErrorFrom(error: { code?: string | null; message?: string | null }, uniqueViolation?: DeliverySqlRefusal): DeliveryError {
  if (error.code && DELIVERY_NOT_INSTALLED.has(error.code)) return new DeliveryError(503, "delivery_unavailable");
  if (isDeliverySqlRefusal(error.message)) return new DeliveryError(deliveryErrorStatus(error.message), error.message);
  if (error.code === "23505" && uniqueViolation) return new DeliveryError(409, uniqueViolation);
  return new DeliveryError(500, "generic");
}
