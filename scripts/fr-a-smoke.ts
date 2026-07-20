/**
 * FR-a seeded smoke — catering FULFILLMENT NODES (per-store delivery-zone config:
 * center + radius + pickup/delivery flags).
 *
 * Drives the REAL lib (`upsertFulfillmentNode` / `loadFulfillmentNodes` in
 * lib/admin/catering/fulfillment.ts) against the service-role DB: create → read-back →
 * update (upsert-in-place, UNIQUE location_id) → geo sanity via lib/geo.ts — then
 * hard-deletes the node row in a finally block, leaving ZERO residue:
 *   npx tsx --env-file=.env.local scripts/fr-a-smoke.ts
 *
 * Mirrors scripts/w4a-smoke.ts structure: env via --env-file, service-role client via
 * getServiceRoleClient, capture-ids-then-rollback discipline. audit_log rows stay
 * (the "audit_log is permanent" convention — the record of the smoke is valid evidence).
 *
 * SAFETY: this smoke targets a REAL active location. Before touching anything it asserts
 * the chosen location has NO existing catering_fulfillment_nodes row (the table is brand
 * new — migration 0138) so it can never clobber real config; it fails loudly otherwise.
 *
 * Radius round-trip note: the lib stores delivery_radius_meters as
 * Math.round(milesToMeters(radiusMiles)) — INTEGER meters — so the read-back radiusMiles
 * is not bit-exact vs the input (max error 0.5 m ≈ 3.11e-4 mi; e.g. 5 → 8047 m →
 * 5.000174 mi). Assertions use exact equality against the expected round-trip value
 * metersToMiles(Math.round(milesToMeters(x))) plus a coarse |Δ| < 1e-3 sanity bound.
 */

import assert from "node:assert/strict";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { upsertFulfillmentNode, loadFulfillmentNodes } from "@/lib/admin/catering/fulfillment";
import { isWithinRadius, milesToMeters, metersToMiles } from "@/lib/geo";
import type { AuthContext } from "@/lib/session";

type Sb = ReturnType<typeof getServiceRoleClient>;

// DC-area center (double-precision lat/lng round-trip check rides on these exact values).
const CENTER_LAT = 38.9072;
const CENTER_LNG = -77.0369;
const CREATE_RADIUS_MILES = 5;
const UPDATE_RADIUS_MILES = 3;

/** Expected read-back radius: the lib rounds to integer meters, then converts back. */
function expectedRoundTripMiles(mi: number): number {
  return metersToMiles(Math.round(milesToMeters(mi)));
}

/** A catering_fulfillment_nodes row as this smoke reads it back directly. */
interface NodeRow {
  id: string;
  location_id: string;
  lat: number;
  lng: number;
  delivery_radius_meters: number;
  offers_delivery: boolean;
  offers_pickup: boolean;
  active: boolean;
}

async function loadNodeRows(sb: Sb, locationId: string): Promise<NodeRow[]> {
  const { data, error } = await sb
    .from("catering_fulfillment_nodes")
    .select("id, location_id, lat, lng, delivery_radius_meters, offers_delivery, offers_pickup, active")
    .eq("location_id", locationId)
    .returns<NodeRow[]>();
  if (error) throw new Error(`load node rows: ${error.message}`);
  return data ?? [];
}

async function main() {
  const sb: Sb = getServiceRoleClient();
  console.log("FR-a smoke (catering fulfillment nodes)\n");

  // ── 1. A real active location + a real level-≥7 actor (cgs = level 10) ────────
  const { data: loc, error: locErr } = await sb
    .from("locations")
    .select("id, name")
    .eq("active", true)
    .limit(1)
    .maybeSingle<{ id: string; name: string }>();
  if (locErr) throw new Error(`load location: ${locErr.message}`);
  if (!loc) throw new Error("no active location to seed against");
  const locationId = loc.id;
  console.log(`seeding at location: ${loc.name} (${locationId})`);

  const { data: cgsUser, error: userErr } = await sb
    .from("users")
    .select("id, role")
    .eq("role", "cgs")
    .eq("active", true)
    .limit(1)
    .maybeSingle<{ id: string; role: string }>();
  if (userErr) throw new Error(`load cgs actor: ${userErr.message}`);
  if (!cgsUser) throw new Error("no active cgs user to act as");
  // Minimal actor: the fulfillment lib reads only actor.user.id (created_by/updated_by)
  // and actor.user.role (getRoleLevel). cgs is level 10 ≥ FULFILLMENT_MIN (7).
  const actor = { user: { id: cgsUser.id, role: cgsUser.role }, locations: [] } as unknown as AuthContext;
  console.log(`acting as: cgs ${cgsUser.id}`);

  // ── 2. SAFETY pre-check: the location must have NO existing node row ──────────
  // (Never clobber real config — the create below would UPDATE an existing row.)
  const preRows = await loadNodeRows(sb, locationId);
  assert.equal(
    preRows.length,
    0,
    `location ${locationId} already has ${preRows.length} fulfillment node row(s) — refusing to run (the upsert would clobber real config)`,
  );
  console.log("  ✓ pre-check: no existing node row at this location — safe to seed");

  try {
    // ── 3. CREATE via the real lib ───────────────────────────────────────────────
    const { id: nodeId } = await upsertFulfillmentNode(actor, {
      locationId,
      lat: CENTER_LAT,
      lng: CENTER_LNG,
      radiusMiles: CREATE_RADIUS_MILES,
      offersDelivery: true,
      offersPickup: true,
    });
    assert.ok(nodeId, "upsertFulfillmentNode (create) returns a node id");
    console.log(`  ✓ create: node ${nodeId} (lat ${CENTER_LAT}, lng ${CENTER_LNG}, ${CREATE_RADIUS_MILES} mi, delivery+pickup)`);

    // ── 4. READ BACK via loadFulfillmentNodes ────────────────────────────────────
    const views = await loadFulfillmentNodes(actor);
    const view = views.find((v) => v.locationId === locationId);
    assert.ok(view, `loadFulfillmentNodes includes a view row for location ${locationId}`);
    assert.equal(view.configured, true, "read-back: configured=true (node row exists)");
    assert.equal(view.lat, CENTER_LAT, `read-back: lat round-trips exactly (${CENTER_LAT} — double precision)`);
    assert.equal(view.lng, CENTER_LNG, `read-back: lng round-trips exactly (${CENTER_LNG} — double precision)`);
    assert.ok(view.radiusMiles !== null, "read-back: radiusMiles is non-null");
    assert.equal(
      view.radiusMiles,
      expectedRoundTripMiles(CREATE_RADIUS_MILES),
      `read-back: radiusMiles = metersToMiles(round(milesToMeters(${CREATE_RADIUS_MILES}))) exactly`,
    );
    assert.ok(
      Math.abs(view.radiusMiles - CREATE_RADIUS_MILES) < 1e-3,
      `read-back: radiusMiles ≈ ${CREATE_RADIUS_MILES} within 1e-3 (got ${view.radiusMiles}; integer-meter storage bounds error at ~3.11e-4 mi)`,
    );
    assert.equal(view.offersDelivery, true, "read-back: offersDelivery=true");
    assert.equal(view.offersPickup, true, "read-back: offersPickup=true");
    assert.equal(view.active, true, "read-back: active=true (lib always sets active on upsert)");
    console.log(`  ✓ read-back: configured, lat/lng exact, radius ${view.radiusMiles} mi (≈${CREATE_RADIUS_MILES}), delivery+pickup, active`);

    // ── 5. UPDATE (upsert same location — must update in place, not duplicate) ───
    const { id: updatedId } = await upsertFulfillmentNode(actor, {
      locationId,
      lat: CENTER_LAT,
      lng: CENTER_LNG,
      radiusMiles: UPDATE_RADIUS_MILES,
      offersDelivery: false,
      offersPickup: true,
    });
    assert.equal(updatedId, nodeId, "upsert on the same location returns the SAME node id (update path)");

    const rowsAfterUpdate = await loadNodeRows(sb, locationId);
    assert.equal(
      rowsAfterUpdate.length,
      1,
      `exactly ONE node row for the location after re-upsert (got ${rowsAfterUpdate.length} — UNIQUE location_id, update not duplicate)`,
    );
    const row = rowsAfterUpdate[0];
    assert.ok(row, "the single node row is present");
    assert.equal(row.id, nodeId, "the surviving row keeps the original node id");
    assert.equal(row.delivery_radius_meters, Math.round(milesToMeters(UPDATE_RADIUS_MILES)), `raw delivery_radius_meters = round(milesToMeters(${UPDATE_RADIUS_MILES})) = ${Math.round(milesToMeters(UPDATE_RADIUS_MILES))}`);

    const viewsAfterUpdate = await loadFulfillmentNodes(actor);
    const view2 = viewsAfterUpdate.find((v) => v.locationId === locationId);
    assert.ok(view2, `loadFulfillmentNodes still includes location ${locationId} after update`);
    assert.ok(view2.radiusMiles !== null, "after update: radiusMiles is non-null");
    assert.equal(
      view2.radiusMiles,
      expectedRoundTripMiles(UPDATE_RADIUS_MILES),
      `after update: radiusMiles = metersToMiles(round(milesToMeters(${UPDATE_RADIUS_MILES}))) exactly`,
    );
    assert.ok(
      Math.abs(view2.radiusMiles - UPDATE_RADIUS_MILES) < 1e-3,
      `after update: radiusMiles ≈ ${UPDATE_RADIUS_MILES} within 1e-3 (got ${view2.radiusMiles})`,
    );
    assert.equal(view2.offersDelivery, false, "after update: offersDelivery flipped to false");
    assert.equal(view2.offersPickup, true, "after update: offersPickup stays true");
    assert.equal(view2.lat, CENTER_LAT, "after update: lat unchanged and exact");
    assert.equal(view2.lng, CENTER_LNG, "after update: lng unchanged and exact");
    console.log(`  ✓ update: same id, ONE row (upsert not duplicate), radius ${view2.radiusMiles} mi (≈${UPDATE_RADIUS_MILES}), delivery=false pickup=true`);

    // ── 6. GEO sanity: a point ~1 mi north of center vs the radius check ─────────
    const center = { lat: CENTER_LAT, lng: CENTER_LNG };
    const oneMileNorth = { lat: CENTER_LAT + 1 / 69, lng: CENTER_LNG };
    assert.equal(
      isWithinRadius(oneMileNorth, center, milesToMeters(UPDATE_RADIUS_MILES)),
      true,
      `geo: a point ~1 mi north IS within the ${UPDATE_RADIUS_MILES}-mi radius`,
    );
    assert.equal(
      isWithinRadius(oneMileNorth, center, milesToMeters(0.5)),
      false,
      "geo: a point ~1 mi north is NOT within a 0.5-mi radius",
    );
    console.log("  ✓ geo: ~1 mi north → inside 3-mi radius, outside 0.5-mi radius");

    console.log("\n  all assertions passed");
  } finally {
    // ── Rollback: hard-delete the node row (leave ZERO residue; audit_log stays) ──
    console.log("\ncleanup");
    const { error: delErr } = await sb.from("catering_fulfillment_nodes").delete().eq("location_id", locationId);
    if (delErr) throw new Error(`cleanup delete: ${delErr.message}`);

    // Verify zero residue (re-select by location_id → 0 rows).
    const leftover = await loadNodeRows(sb, locationId);
    console.log(`  residue: ${JSON.stringify({ nodes: leftover.length })}`);
    if (leftover.length > 0) {
      throw new Error(`cleanup left residue: ${leftover.length} node row(s) at location ${locationId}`);
    }
    console.log("  ✓ zero residue");
  }

  console.log("\nfr-a-smoke: PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
