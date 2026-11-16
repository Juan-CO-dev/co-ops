/**
 * Pure rules of the portal draft (zero I/O; client-safe). lib/portal/draft.ts re-exports them.
 * Audit wave W01.
 */

/** The fields of a catering_delivery_zones row this rule reads (DeliveryZone in lib/catering/quotes.ts). */
export interface PortalZone { id: string; feeCents: number; minOrderCents?: number | null }

/**
 * pickup        → no zone, no fee.
 * no_zones      → a delivery order at a shop with no active delivery zone: it cannot be priced, so it
 *                 is REFUSED at submit (never free).
 * single_zone   → the shop's one active zone.
 * highest_fee   → two or more active zones cover the order: the MOST EXPENSIVE one (Juan 2026-11-15:
 *                 "cheapest may have us lose money").
 */
export type PortalZoneReason = "pickup" | "no_zones" | "single_zone" | "highest_fee";
export interface PortalZoneResolution {
  zoneId: string | null;
  feeCents: number;
  /** The chosen zone's minimum food subtotal (cents), or null when it has none. */
  minOrderCents: number | null;
  reason: PortalZoneReason;
}

/**
 * Which delivery zone (and fee) a SELF-SERVE order carries — decided by the SERVER from the
 * location's active zones, never from a zone id the browser sends (audit W01/B001: the review page
 * posted `deliveryZoneId: null`, so every portal delivery was priced "Free").
 *
 * Zones are fee TIERS with no geography (0117), so every active zone of the shop covers the order.
 * With two or more, the order is charged the MOST EXPENSIVE zone (Juan's ruling 2026-11-15). Ties on
 * the fee go to the higher minimum, then the lower id, so the pick never depends on row order. The
 * SAME rule runs in SQL (0302 portal_draft_submit) and on staff acceptance (lib/catering/quotes.ts).
 */
export function resolvePortalDeliveryZone(zones: readonly PortalZone[], isDelivery: boolean): PortalZoneResolution {
  if (!isDelivery) return { zoneId: null, feeCents: 0, minOrderCents: null, reason: "pickup" };
  if (zones.length === 0) return { zoneId: null, feeCents: 0, minOrderCents: null, reason: "no_zones" };
  const sorted = [...zones].sort((a, b) =>
    b.feeCents - a.feeCents
    || (b.minOrderCents ?? -1) - (a.minOrderCents ?? -1)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pick = sorted[0]!;
  return { zoneId: pick.id, feeCents: pick.feeCents, minOrderCents: pick.minOrderCents ?? null, reason: zones.length === 1 ? "single_zone" : "highest_fee" };
}

/** Why a delivery order cannot be placed as it stands, or null when it can. */
export type PortalDeliveryRefusal = "delivery_unavailable" | "below_delivery_minimum";

/**
 * May this order be submitted with this delivery resolution? `subtotalCents` is the order's food
 * subtotal as charged (the napkins add-on included when chosen), before service charge, delivery,
 * tip and tax. Exactly AT the minimum passes; one cent under refuses. A pickup always passes.
 */
export function portalDeliveryRefusal(z: PortalZoneResolution, subtotalCents: number): PortalDeliveryRefusal | null {
  if (z.reason === "pickup") return null;
  if (z.reason === "no_zones" || z.zoneId == null) return "delivery_unavailable";
  if (z.minOrderCents != null && subtotalCents < z.minOrderCents) return "below_delivery_minimum";
  return null;
}

/** What the review page shows about delivery (the preview's `delivery`), en + es rendered by the page. */
export interface PortalDeliveryInfo {
  isDelivery: boolean;
  zoneId: string | null;
  feeCents: number;
  minOrderCents: number | null;
  /** Cents still needed to reach the minimum (0 when met or no minimum). */
  shortByCents: number;
  refusal: PortalDeliveryRefusal | null;
}
export function portalDeliveryInfo(z: PortalZoneResolution, subtotalCents: number): PortalDeliveryInfo {
  const refusal = portalDeliveryRefusal(z, subtotalCents);
  return {
    isDelivery: z.reason !== "pickup", zoneId: z.zoneId, feeCents: z.feeCents, minOrderCents: z.minOrderCents,
    shortByCents: refusal === "below_delivery_minimum" && z.minOrderCents != null ? z.minOrderCents - subtotalCents : 0,
    refusal,
  };
}

/**
 * Staff acceptance of a SELF-SERVE delivery order re-checks delivery with the same rule against the
 * shop's CURRENT zones: the order must carry the zone and fee the rule picks today, and meet that
 * zone's minimum. Anything else is refused with a code that tells staff to revise the quote
 * (revising re-prices it). Pickup and staff-built quotes are not re-judged here (staff chose their zone).
 */
export type AcceptDeliveryRefusal = PortalDeliveryRefusal | "delivery_fee_changed";
export function acceptDeliveryRefusal(
  quote: { origin: string; isDelivery: boolean; deliveryZoneId: string | null; deliveryFeeCents: number; subtotalCents: number },
  zones: readonly PortalZone[],
): AcceptDeliveryRefusal | null {
  if (quote.origin !== "self_serve" || !quote.isDelivery) return null;
  const z = resolvePortalDeliveryZone(zones, true);
  const refusal = portalDeliveryRefusal(z, quote.subtotalCents);
  if (refusal) return refusal;
  if (quote.deliveryZoneId !== z.zoneId || quote.deliveryFeeCents !== z.feeCents) return "delivery_fee_changed";
  return null;
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
export type ReviewFailure = "go_to_quote" | "cart_changed" | "session_expired" | "delivery_unavailable" | "below_delivery_minimum" | "error" | "keep";
export function reviewFailure(status: number | null, code: string | null, hasStack: boolean): ReviewFailure {
  if (status === 409 && code === "not_draft") return "go_to_quote";
  if (status === 409 && code === "cart_changed") return "cart_changed";
  // Delivery refused at submit (Juan 2026-11-15): the order stays a draft; the page says why.
  if (status === 409 && code === "delivery_unavailable") return "delivery_unavailable";
  if (status === 409 && code === "below_delivery_minimum") return "below_delivery_minimum";
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
