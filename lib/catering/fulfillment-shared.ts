/**
 * Fulfillment — CLIENT-SAFE shared surface (constants + types only; no I/O,
 * no server imports). Split from fulfillment-routing.ts on 2026-07-23 when the
 * new `server-only` guard on lib/supabase-server.ts surfaced that
 * start-client.tsx's import of CATERING_DELIVERY_WINDOWS was dragging the
 * service-role module into the client bundle graph (PR #165 CI catch).
 *
 * Server-side routing logic stays in fulfillment-routing.ts, which re-exports
 * this surface so server consumers are unchanged.
 */

export const CATERING_BOOKED_STAGES = ["confirmed", "out", "completed"] as const;

/** Fixed delivery time windows (field-note ②). Language-neutral clock strings; no per-location config. */
export const CATERING_DELIVERY_WINDOWS = [
  "10:00–10:30 AM",
  "10:30–11:00 AM",
  "11:00–11:30 AM",
  "11:30 AM–12:00 PM",
  "12:00–12:30 PM",
  "12:30–1:00 PM",
  "1:00–1:30 PM",
  "1:30–2:00 PM",
] as const;

export interface PublicFulfillmentNode {
  locationId: string;
  locationName: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  offersDelivery: boolean;
  offersPickup: boolean;
}

/**
 * `routed` with `dateUnavailable: true` (audit W22/B123, owner decision W22-2 as modified: never refuse an
 * order outright) = no in-zone shop can take that date (blackout, full or inside the lead time), so the
 * nearest one is named, the customer is WARNED, and the order is flagged for the catering manager to accept
 * or refuse. `no_capacity` is no longer produced by routeDelivery; it stays in the union for old clients.
 */
export type DeliveryRouteResult =
  | { status: "routed"; locationId: string; locationName: string; distanceMeters: number; dateUnavailable?: boolean }
  | { status: "out_of_zone" }
  | { status: "no_capacity" };
