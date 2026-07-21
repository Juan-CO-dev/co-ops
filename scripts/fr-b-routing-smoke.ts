/**
 * FR-b routing smoke — seeds 2 fulfillment nodes + a capacity policy + booked leads at 2 real
 * active locations, asserts routeDelivery behavior, then removes everything it created.
 * Run: npx tsx --env-file=.env.local scripts/fr-b-routing-smoke.ts
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { routeDelivery } from "@/lib/catering/fulfillment-routing";
import { milesToMeters } from "@/lib/geo";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const sb = getServiceRoleClient();
  const { data: locs } = await sb.from("locations").select("id, name").eq("active", true).limit(2)
    .returns<Array<{ id: string; name: string }>>();
  if (!locs || locs.length < 2) {
    console.log("SKIP: need >=2 active locations to seed two nodes.");
    return;
  }
  const near = locs[0]!; // will be the closest node to the test point
  const far = locs[1]!;

  // Test point + two nodes: NEAR ~0.35mi away (5mi radius), FAR ~1.4mi away (5mi radius) — both in-zone.
  const pt = { lat: 38.9000, lng: -77.0300 };
  const nearCenter = { lat: 38.9050, lng: -77.0300 }; // ~0.35mi north
  const farCenter = { lat: 38.9200, lng: -77.0300 };  // ~1.4mi north
  const radius = Math.round(milesToMeters(5));

  const createdNodeIds: string[] = [];
  const createdLeadIds: string[] = [];
  const createdPolicyIds: string[] = [];

  async function seedNode(locationId: string, c: { lat: number; lng: number }) {
    const { data, error } = await sb.from("catering_fulfillment_nodes")
      .insert({ location_id: locationId, lat: c.lat, lng: c.lng, delivery_radius_meters: radius,
        offers_delivery: true, offers_pickup: true, active: true, created_by: null })
      .select("id").single<{ id: string }>();
    if (error) throw new Error(`seedNode: ${error.message}`);
    createdNodeIds.push(data.id);
  }

  try {
    // Clean any pre-existing nodes at these locations (UNIQUE one-per-location) so seeding is idempotent.
    await sb.from("catering_fulfillment_nodes").delete().in("location_id", [near.id, far.id]);
    await seedNode(near.id, nearCenter);
    await seedNode(far.id, farCenter);

    const future = "2030-01-15";

    // (a) nearest in-zone wins
    let r = await routeDelivery({ lat: pt.lat, lng: pt.lng, eventDate: future, headcount: 20 });
    assert(r.status === "routed" && r.locationId === near.id, "nearest in-zone node wins");

    // (b) out of zone: a point far from both
    r = await routeDelivery({ lat: 40.0, lng: -80.0, eventDate: future, headcount: 20 });
    assert(r.status === "out_of_zone", "point outside all radii => out_of_zone");

    // (c) capacity fallback: cap NEAR at max_events_per_day=1, book 1 confirmed lead there that date
    const { data: pol, error: polErr } = await sb.from("catering_capacity_policy")
      .insert({ location_id: near.id, max_events_per_day: 1, active: true })
      .select("id").single<{ id: string }>();
    if (polErr) throw new Error(`seed policy: ${polErr.message}`);
    createdPolicyIds.push(pol.id);
    const { data: lead, error: leadErr } = await sb.from("catering_pipeline")
      .insert({ contact_name: "smoke-booked", stage: "confirmed", location_id: near.id,
        event_date: future, headcount: 10, lead_source: "smoke", created_by: null })
      .select("id").single<{ id: string }>();
    if (leadErr) throw new Error(`seed lead: ${leadErr.message}`);
    createdLeadIds.push(lead.id);

    r = await routeDelivery({ lat: pt.lat, lng: pt.lng, eventDate: future, headcount: 20 });
    assert(r.status === "routed" && r.locationId === far.id, "NEAR over max_events => falls through to FAR");

    // (d) min_lead_time_hours rejects a too-soon date (FAR has no policy => still routes; so also cap FAR)
    await sb.from("catering_capacity_policy").update({ min_lead_time_hours: 100000 }).eq("id", pol.id);
    const { data: pol2, error: pol2Err } = await sb.from("catering_capacity_policy")
      .insert({ location_id: far.id, min_lead_time_hours: 100000, active: true })
      .select("id").single<{ id: string }>();
    if (pol2Err) throw new Error(`seed policy2: ${pol2Err.message}`);
    createdPolicyIds.push(pol2.id);
    r = await routeDelivery({ lat: pt.lat, lng: pt.lng, eventDate: future, headcount: 20 });
    assert(r.status === "no_capacity", "both nodes lead-time-blocked => no_capacity");

    console.log("\nFR-b routing smoke: ALL PASS");
  } finally {
    if (createdLeadIds.length) await sb.from("catering_pipeline").delete().in("id", createdLeadIds);
    if (createdPolicyIds.length) await sb.from("catering_capacity_policy").delete().in("id", createdPolicyIds);
    if (createdNodeIds.length) await sb.from("catering_fulfillment_nodes").delete().in("id", createdNodeIds);
    console.log("cleanup done");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
