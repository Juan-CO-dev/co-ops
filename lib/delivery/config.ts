/**
 * Catering delivery (D1) — THE switch. Server-only.
 *
 * `DELIVERY_TRACKING=1` turns delivery tracking on. Unset (or anything else): every delivery write answers 503
 * `delivery_off`, every loader answers "off" WITHOUT a query, and no surface renders. Builders never set it.
 * A shop is additionally off until its `delivery_settings.enabled` is true (no row = off), checked in SQL.
 */
import "server-only";

export function deliveryTrackingOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.DELIVERY_TRACKING === "1";
}
