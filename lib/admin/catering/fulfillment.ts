/**
 * FR-a catering fulfillment nodes — SERVER-ONLY, service-role. Per-store delivery-zone config
 * (center + radius + pickup/delivery flags). Mutable config (upsert in place). Staff-gated (>=7).
 * FR-b adds the customer-facing (public) read of these nodes.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import type { AuthContext } from "@/lib/session";
import { audit } from "@/lib/audit";
import { milesToMeters, metersToMiles } from "@/lib/geo";

export const FULFILLMENT_MIN = 7;

export class FulfillmentError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "FulfillmentError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new FulfillmentError(403, "forbidden", "Insufficient role level");
}

function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

export interface FulfillmentNodeView {
  locationId: string;
  locationName: string;
  configured: boolean; // has a node row
  lat: number | null;
  lng: number | null;
  radiusMiles: number | null;
  offersDelivery: boolean;
  offersPickup: boolean;
  active: boolean;
}

/**
 * Every ACCESSIBLE active location + its node row (if any), so the admin sees configured +
 * unconfigured stores.
 *
 * Scoped to the actor's assignments (≥9 = all), matching loadZoneGroups in the sibling
 * zones editor: the picker this feeds IS the write-target list, so offering a store the
 * upsert will refuse would render a dead option that 403s on Save.
 */
export async function loadFulfillmentNodes(actor: AuthContext): Promise<FulfillmentNodeView[]> {
  requireLevel(actor, FULFILLMENT_MIN);
  const sb = getServiceRoleClient();
  const { data: allLocs, error: lErr } = await sb
    .from("locations")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string }>>();
  if (lErr) throw new Error(`loadFulfillmentNodes locations: ${lErr.message}`);
  const locs = (allLocs ?? []).filter((l) => lockLocationContext(actorLoc(actor), l.id));
  const { data: nodes, error: nErr } = await sb
    .from("catering_fulfillment_nodes")
    .select("location_id, lat, lng, delivery_radius_meters, offers_delivery, offers_pickup, active")
    .returns<Array<{ location_id: string; lat: number; lng: number; delivery_radius_meters: number; offers_delivery: boolean; offers_pickup: boolean; active: boolean }>>();
  if (nErr) throw new Error(`loadFulfillmentNodes nodes: ${nErr.message}`);
  const byLoc = new Map((nodes ?? []).map((n) => [n.location_id, n]));
  return locs.map((l) => {
    const n = byLoc.get(l.id);
    return {
      locationId: l.id,
      locationName: l.name,
      configured: !!n,
      lat: n?.lat ?? null,
      lng: n?.lng ?? null,
      radiusMiles: n ? metersToMiles(n.delivery_radius_meters) : null,
      offersDelivery: n?.offers_delivery ?? true,
      offersPickup: n?.offers_pickup ?? true,
      active: n?.active ?? false,
    };
  });
}

export interface UpsertFulfillmentNodeInput {
  locationId: string;
  lat: number;
  lng: number;
  radiusMiles: number;
  offersDelivery: boolean;
  offersPickup: boolean;
}

/**
 * Create-or-update the node for a location (>=7; Tier-A step-up enforced at the route).
 *
 * THE BIND RUNS FIRST, BEFORE VALIDATION AND BEFORE ANY I/O. FULFILLMENT_MIN is 7 and
 * the all-locations grant starts at 9, so "GM" alone never names a store — at CO each GM
 * holds exactly one. `locationId` rides in on the request body, and this row is not
 * cosmetic: lib/catering/fulfillment-routing.ts reads the centre + radius to decide which
 * shop a customer's delivery is routed to, so an unbound write lets one store silently
 * reshape the other's delivery map.
 */
export async function upsertFulfillmentNode(actor: AuthContext, input: UpsertFulfillmentNodeInput): Promise<{ id: string }> {
  requireLevel(actor, FULFILLMENT_MIN);
  if (!lockLocationContext(actorLoc(actor), input.locationId)) {
    throw new FulfillmentError(403, "forbidden", "Location is outside your assignments");
  }
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng) || Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) {
    throw new FulfillmentError(400, "invalid_coords", "lat/lng out of range");
  }
  if (!Number.isFinite(input.radiusMiles) || input.radiusMiles <= 0) {
    throw new FulfillmentError(400, "invalid_radius", "radius must be > 0");
  }
  const sb = getServiceRoleClient();
  const { data: loc, error: locErr } = await sb
    .from("locations")
    .select("id")
    .eq("id", input.locationId)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (locErr) throw new Error(`upsertFulfillmentNode location check: ${locErr.message}`);
  if (!loc) throw new FulfillmentError(404, "location_not_found", "Location not found or inactive");

  const radiusMeters = Math.round(milesToMeters(input.radiusMiles));
  const { data: existing, error: exErr } = await sb
    .from("catering_fulfillment_nodes")
    .select("id")
    .eq("location_id", input.locationId)
    .maybeSingle<{ id: string }>();
  if (exErr) throw new Error(`upsertFulfillmentNode dup check: ${exErr.message}`);

  const fields = {
    lat: input.lat,
    lng: input.lng,
    delivery_radius_meters: radiusMeters,
    offers_delivery: input.offersDelivery,
    offers_pickup: input.offersPickup,
    active: true,
    updated_by: actor.user.id,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await sb.from("catering_fulfillment_nodes").update(fields).eq("id", existing.id);
    if (error) throw new Error(`upsertFulfillmentNode update: ${error.message}`);
    void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.fulfillment.node_upsert", resourceTable: "catering_fulfillment_nodes", resourceId: existing.id, metadata: { location_id: input.locationId, radius_meters: radiusMeters, offers_delivery: input.offersDelivery, offers_pickup: input.offersPickup, updated: true }, ipAddress: null, userAgent: null });
    return { id: existing.id };
  }

  const { data: inserted, error } = await sb
    .from("catering_fulfillment_nodes")
    .insert({ location_id: input.locationId, created_by: actor.user.id, ...fields })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`upsertFulfillmentNode insert: ${error.message}`);
  if (!inserted) throw new Error("upsertFulfillmentNode insert returned no row");
  void audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "catering.fulfillment.node_upsert", resourceTable: "catering_fulfillment_nodes", resourceId: inserted.id, metadata: { location_id: input.locationId, radius_meters: radiusMeters, offers_delivery: input.offersDelivery, offers_pickup: input.offersPickup, created: true }, ipAddress: null, userAgent: null });
  return { id: inserted.id };
}
