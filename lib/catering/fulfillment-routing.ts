/**
 * FR-b customer fulfillment routing — SERVER-ONLY, service-role. Public (pre-auth) reads of
 * FR-a's fulfillment nodes + delivery routing (nearest in-zone node with capacity, fall through
 * when full). Advisory only: a new inquiry does not reserve a slot (hard hold deferred).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { haversineMeters, isWithinRadius } from "@/lib/geo";
import { checkCateringCapacity, isBookableSignal } from "./capacity";

/** Stages that count against a node's daily capacity (a "booked" event). Matches W4a reserve-at-confirmed. */
import {
  CATERING_BOOKED_STAGES,
  CATERING_DELIVERY_WINDOWS,
  type PublicFulfillmentNode,
  type DeliveryRouteResult,
} from "./fulfillment-shared";

// Client-safe surface lives in fulfillment-shared.ts (see its header for why);
// re-exported here so existing server consumers keep their import paths.
export {
  CATERING_BOOKED_STAGES,
  CATERING_DELIVERY_WINDOWS,
  type PublicFulfillmentNode,
  type DeliveryRouteResult,
};

interface NodeRow {
  location_id: string;
  lat: number;
  lng: number;
  delivery_radius_meters: number;
  offers_delivery: boolean;
  offers_pickup: boolean;
}

/** All active nodes at active locations. Public read (intake is pre-auth). Service-role bypasses RLS. */
export async function loadPublicFulfillmentNodes(): Promise<PublicFulfillmentNode[]> {
  const sb = getServiceRoleClient();
  const { data: nodes, error: nErr } = await sb
    .from("catering_fulfillment_nodes")
    .select("location_id, lat, lng, delivery_radius_meters, offers_delivery, offers_pickup")
    .eq("active", true)
    .returns<NodeRow[]>();
  if (nErr) throw new Error(`loadPublicFulfillmentNodes nodes: ${nErr.message}`);
  const rows = nodes ?? [];
  if (rows.length === 0) return [];
  const locIds = rows.map((n) => n.location_id);
  const { data: locs, error: lErr } = await sb
    .from("locations")
    .select("id, name")
    .eq("active", true)
    .in("id", locIds)
    .returns<Array<{ id: string; name: string }>>();
  if (lErr) throw new Error(`loadPublicFulfillmentNodes locations: ${lErr.message}`);
  const nameById = new Map((locs ?? []).map((l) => [l.id, l.name]));
  return rows
    .filter((n) => nameById.has(n.location_id)) // active-location gate
    .map((n) => ({
      locationId: n.location_id,
      locationName: nameById.get(n.location_id)!,
      lat: n.lat,
      lng: n.lng,
      radiusMeters: n.delivery_radius_meters,
      offersDelivery: n.offers_delivery,
      offersPickup: n.offers_pickup,
    }));
}

/** The pickup picker's option set. */
export async function loadPickupNodes(): Promise<PublicFulfillmentNode[]> {
  const all = await loadPublicFulfillmentNodes();
  return all.filter((n) => n.offersPickup);
}

/**
 * Can this shop take this date (and headcount)? THE capacity check (lib/catering/capacity.ts) read through the
 * one rule `isBookableSignal` (audit W22/B123): a blackout counts even with no caps seeded, the lead time, the
 * day's covers and events (booked = CATERING_BOOKED_STAGES, unbatched orders too). No date = nothing to judge
 * (true). `excludePipelineId` leaves the order being judged out of its own day's count.
 */
export async function isDateBookable(args: {
  locationId: string;
  eventDate: string | null;
  headcount: number | null;
  excludePipelineId?: string | null;
}): Promise<boolean> {
  if (args.eventDate == null) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.eventDate)) return false;
  return isBookableSignal(await checkCateringCapacity({
    locationId: args.locationId,
    eventDate: args.eventDate,
    requestedCovers: args.headcount ?? 0,
    excludePipelineId: args.excludePipelineId ?? null,
  }));
}

/**
 * Does this customer order need the catering manager's OK on its date? True only for an order not yet booked
 * (lead stage inquiry / quote_sent) whose date the shop cannot take. A confirmed order is never flagged (it
 * always pays). Never throws: a failed check reads as "no warning" (advisory surface).
 */
export async function orderDateNeedsReview(args: {
  pipelineId: string | null;
  locationId: string;
  eventDate: string | null;
  headcount: number | null;
}): Promise<boolean> {
  if (!args.pipelineId || args.eventDate == null) return false;
  try {
    const sb = getServiceRoleClient();
    const { data, error } = await sb.from("catering_pipeline").select("stage").eq("id", args.pipelineId).maybeSingle<{ stage: string }>();
    if (error || !data || (data.stage !== "inquiry" && data.stage !== "quote_sent")) return false;
    return !(await isDateBookable({ locationId: args.locationId, eventDate: args.eventDate, headcount: args.headcount, excludePipelineId: args.pipelineId }));
  } catch {
    return false;
  }
}

/**
 * Route a delivery to the nearest in-zone node that can take the date (isDateBookable); fall through to the
 * next-nearest when it cannot; when none can, the nearest with `dateUnavailable` (a warning, never a refusal).
 * Advisory (does not reserve). Invalid coords => out_of_zone.
 */
export async function routeDelivery(args: {
  lat: number;
  lng: number;
  eventDate: string | null;
  headcount: number | null;
}): Promise<DeliveryRouteResult> {
  const { lat, lng, eventDate, headcount } = args;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { status: "out_of_zone" };
  }
  const point = { lat, lng };
  const candidates = (await loadPublicFulfillmentNodes())
    .filter((n) => n.offersDelivery)
    .filter((n) => isWithinRadius(point, { lat: n.lat, lng: n.lng }, n.radiusMeters))
    .map((n) => ({ node: n, distanceMeters: haversineMeters(point, { lat: n.lat, lng: n.lng }) }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  if (candidates.length === 0) return { status: "out_of_zone" };

  for (const c of candidates) {
    if (await isDateBookable({ locationId: c.node.locationId, eventDate, headcount })) {
      return {
        status: "routed",
        locationId: c.node.locationId,
        locationName: c.node.locationName,
        distanceMeters: c.distanceMeters,
      };
    }
  }
  // No in-zone shop can take the date. Never a refusal (W22-2 as modified): the nearest shop, flagged, and
  // the customer is warned; the catering manager accepts or refuses the order.
  const nearest = candidates[0]!;
  return {
    status: "routed",
    locationId: nearest.node.locationId,
    locationName: nearest.node.locationName,
    distanceMeters: nearest.distanceMeters,
    dateUnavailable: true,
  };
}
