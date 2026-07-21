/**
 * FR-b customer fulfillment routing — SERVER-ONLY, service-role. Public (pre-auth) reads of
 * FR-a's fulfillment nodes + delivery routing (nearest in-zone node with capacity, fall through
 * when full). Advisory only: a new inquiry does not reserve a slot (hard hold deferred).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { haversineMeters, isWithinRadius } from "@/lib/geo";

/** Stages that count against a node's daily capacity (a "booked" event). Matches W4a reserve-at-confirmed. */
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

export type DeliveryRouteResult =
  | { status: "routed"; locationId: string; locationName: string; distanceMeters: number }
  | { status: "out_of_zone" }
  | { status: "no_capacity" };

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

interface CapacityPolicy {
  max_covers_per_day: number | null;
  max_events_per_day: number | null;
  min_lead_time_hours: number | null;
}

/** Advisory capacity check for one node + date. Null policy / null fields = no limit (pass). */
async function passesCapacity(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  eventDate: string | null,
  headcount: number | null,
): Promise<boolean> {
  const { data: policyRow, error: pErr } = await sb
    .from("catering_capacity_policy")
    .select("max_covers_per_day, max_events_per_day, min_lead_time_hours")
    .eq("location_id", locationId)
    .eq("active", true)
    .maybeSingle<CapacityPolicy>();
  if (pErr) throw new Error(`passesCapacity policy: ${pErr.message}`);
  if (!policyRow) return true; // no policy => unlimited

  // min_lead_time_hours (needs a date)
  if (policyRow.min_lead_time_hours != null && eventDate) {
    const eventStart = new Date(`${eventDate}T00:00:00`).getTime();
    const earliest = Date.now() + policyRow.min_lead_time_hours * 3_600_000;
    if (eventStart < earliest) return false;
  }

  // max_events / max_covers (need a date to count that day's booked leads)
  const needsCount =
    (policyRow.max_events_per_day != null || policyRow.max_covers_per_day != null) && !!eventDate;
  if (needsCount) {
    const { data: booked, error: bErr } = await sb
      .from("catering_pipeline")
      .select("headcount")
      .eq("location_id", locationId)
      .eq("event_date", eventDate)
      .in("stage", CATERING_BOOKED_STAGES as unknown as string[])
      .returns<Array<{ headcount: number | null }>>();
    if (bErr) throw new Error(`passesCapacity booked: ${bErr.message}`);
    const rows = booked ?? [];
    if (policyRow.max_events_per_day != null && rows.length + 1 > policyRow.max_events_per_day) return false;
    if (policyRow.max_covers_per_day != null) {
      const covers = rows.reduce((s, r) => s + (r.headcount ?? 0), 0);
      if (covers + (headcount ?? 0) > policyRow.max_covers_per_day) return false;
    }
  }
  return true;
}

/**
 * Route a delivery to the nearest in-zone node that has capacity for the date; fall through to the
 * next-nearest on capacity failure. Advisory (does not reserve). Invalid coords => out_of_zone.
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

  const sb = getServiceRoleClient();
  for (const c of candidates) {
    if (await passesCapacity(sb, c.node.locationId, eventDate, headcount)) {
      return {
        status: "routed",
        locationId: c.node.locationId,
        locationName: c.node.locationName,
        distanceMeters: c.distanceMeters,
      };
    }
  }
  return { status: "no_capacity" };
}
