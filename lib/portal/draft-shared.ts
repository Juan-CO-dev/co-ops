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

/**
 * What /order/review does when a draft call fails (audit W01/B034 — it used to swallow every failure
 * and spin on "Loading your order…" forever). `hasStack`: a price breakdown is already on screen (a
 * later tip / napkins recompute failed), in which case a transient failure keeps the last breakdown.
 *   not_draft (409)    → the order was already submitted: go to its quote page.
 *   cart_changed (409) → a price moved or an item is gone: send the customer back to the cart.
 *   401                → the portal session expired: offer sign-in.
 *   anything else      → an error with Try again / Start over (or keep the shown breakdown).
 */
export type ReviewFailure = "go_to_quote" | "cart_changed" | "session_expired" | "error" | "keep";
export function reviewFailure(status: number | null, code: string | null, hasStack: boolean): ReviewFailure {
  if (status === 409 && code === "not_draft") return "go_to_quote";
  if (status === 409 && code === "cart_changed") return "cart_changed";
  if (status === 401) return "session_expired";
  return hasStack ? "keep" : "error";
}

/**
 * Is a stored package pick still an eligible option of its package (audit W01/B031 r1)? The SAME rule
 * resolveLines applies on save (lib/portal/draft.ts): the slot exists and lists that reference. The
 * build page drops a pick that fails it when it hydrates a saved cart, then re-saves the cart, so a
 * deactivated pick never loops the customer between the cart and a refused review.
 */
export interface PortalPickSlot { packageItemId: string; options: ReadonlyArray<{ kind: "item" | "menu_item"; refId: string }> }
export interface PortalPick { packageItemId: string; itemId?: string | null; menuItemId?: string | null }
export function isEligiblePackagePick(pkg: { slots: readonly PortalPickSlot[] }, pick: PortalPick): boolean {
  const slot = pkg.slots.find((s) => s.packageItemId === pick.packageItemId);
  if (!slot) return false;
  const kind: "item" | "menu_item" = pick.menuItemId ? "menu_item" : "item";
  const refId = pick.menuItemId ?? pick.itemId ?? "";
  return slot.options.some((o) => o.kind === kind && o.refId === refId);
}
