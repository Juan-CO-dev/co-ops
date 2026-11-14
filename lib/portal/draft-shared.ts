/**
 * Pure rules of the portal draft (zero I/O; client-safe). lib/portal/draft.ts re-exports them.
 * Audit wave W01.
 */

/** The fields of a catering_delivery_zones row this rule reads (DeliveryZone in lib/catering/quotes.ts). */
export interface PortalZone { id: string; feeCents: number }

export type PortalZoneReason = "pickup" | "no_zones" | "single_zone" | "ambiguous_zones";
export interface PortalZoneResolution { zoneId: string | null; feeCents: number; reason: PortalZoneReason }

/**
 * Which delivery zone (and fee) a SELF-SERVE draft carries — decided by the SERVER from the
 * location's active zones, never from a zone id the browser sends (audit W01/B001: the review page
 * posted `deliveryZoneId: null`, so every portal delivery was priced "Free").
 *
 *   pickup                → no zone, no fee.
 *   delivery, 0 zones     → no zone, no fee (the shop has configured no delivery fee).
 *   delivery, 1 zone      → that zone and its fee.
 *   delivery, 2+ zones    → no zone, no fee, reason `ambiguous_zones`. Zones are fee TIERS with no
 *                           geography (0117; mapping tiers to rings is a filed future enrichment), so
 *                           the server cannot know which tier an address falls in. Staff set the zone
 *                           when they confirm the order (the review page says prices are re-confirmed).
 */
export function resolvePortalDeliveryZone(zones: readonly PortalZone[], isDelivery: boolean): PortalZoneResolution {
  if (!isDelivery) return { zoneId: null, feeCents: 0, reason: "pickup" };
  if (zones.length === 0) return { zoneId: null, feeCents: 0, reason: "no_zones" };
  if (zones.length === 1) {
    const only = zones[0]!;
    return { zoneId: only.id, feeCents: only.feeCents, reason: "single_zone" };
  }
  return { zoneId: null, feeCents: 0, reason: "ambiguous_zones" };
}
