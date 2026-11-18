/**
 * GIVE EACH SHOP A POINT for the demand-signal NWS collector (item 4): one catering_fulfillment_nodes row per
 * shop that has none, from docs/seed/shop-points-dc-2026-11-18.json (tenant DATA: addresses geocoded with the
 * U.S. Census Bureau geocoder on 2026-11-18; the coordinates and match details are in the file).
 *
 *   npx tsx --env-file=.env.local scripts/seed-shop-points.ts            # dry run: the plan, nothing written
 *   npx tsx --env-file=.env.local scripts/seed-shop-points.ts --apply    # insert (CC: sim first, then prod)
 *
 * WHY A CATERING NODE, AND WHY IT CHANGES NOTHING FOR CUSTOMERS. The collector's one source of a shop's point is
 * its ACTIVE catering fulfilment node (lib/demand-signals/shop-points-shared.ts). The customer order funnel reads
 * the same rows (lib/catering/fulfillment-routing.ts), but only through `offers_delivery` (delivery routing and
 * the "we deliver" option) and `offers_pickup` (the pickup picker). A seeded node offers NEITHER, so /order/start
 * and routeDelivery answer exactly as with no node. `delivery_radius_meters` is NOT NULL (> 0): the file's
 * placeholder is unused while delivery is off; whoever turns delivery on at /admin/catering/fulfillment sets the
 * real radius (that editor keeps the same row, so the point follows any later move of the centre).
 *
 * WHAT IT NEVER DOES: touch a shop that already has a node (active or not; catering owns that row: it is reported
 * as `exists` with its coordinates), match a shop any way but by name against ACTIVE locations (exactly one,
 * case-insensitive; none or several refuses that shop by name), or write anything on a dry run. Each insert gets
 * one `catering.fulfillment.node_upsert` audit row (actor_context `seed_shop_points`).
 *
 * A SCRIPT-LOCAL client from the environment (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY): it never
 * imports lib/supabase-server. Exit 0 = dry run printed, or applied; 1 = a shop was refused; 2 = could not run.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { isDestructive } from "../lib/destructive-actions";

export const SEED_FILE = "docs/seed/shop-points-dc-2026-11-18.json";
const ACTION = "catering.fulfillment.node_upsert" as const;

export interface SeedShop { names: string[]; address: string; lat: number; lon: number; match: { matchedAddress: string; matches: number; method: string } }
export interface Seed { geocodedOn: string; geocoder: string; placeholderRadiusMeters: number; shops: SeedShop[] }
export interface LocationRow { id: string; name: string; active: boolean }
export interface NodeRow { location_id: string; lat: number; lng: number; active: boolean }
export type PlanRow =
  | { action: "insert"; shop: SeedShop; locationId: string; locationName: string }
  | { action: "exists"; shop: SeedShop; locationId: string; locationName: string; node: NodeRow }
  | { action: "refuse"; shop: SeedShop; reason: "location_not_found" | "location_ambiguous" | "bad_coordinates" };

export function readSeed(): Seed { return JSON.parse(readFileSync(SEED_FILE, "utf8")) as Seed; }

export function parseSeedArgs(argv: readonly string[]): { apply: boolean } | { error: string } {
  const out = { apply: false };
  for (const a of argv) {
    if (a === "--apply") out.apply = true;
    else return { error: `unknown argument ${a}` };
  }
  return out;
}

const norm = (s: string) => s.trim().toLowerCase();

/** PURE: one row per seed shop, in file order. */
export function planShopPoints(seed: Seed, locations: readonly LocationRow[], nodes: readonly NodeRow[]): PlanRow[] {
  return seed.shops.map((shop): PlanRow => {
    if (!Number.isFinite(shop.lat) || !Number.isFinite(shop.lon) || Math.abs(shop.lat) > 90 || Math.abs(shop.lon) > 180) return { action: "refuse", shop, reason: "bad_coordinates" };
    const names = new Set(shop.names.map(norm));
    const hits = locations.filter((l) => l.active && names.has(norm(l.name)));
    if (hits.length === 0) return { action: "refuse", shop, reason: "location_not_found" };
    if (hits.length > 1) return { action: "refuse", shop, reason: "location_ambiguous" };
    const loc = hits[0]!;
    const node = nodes.find((n) => n.location_id === loc.id);
    return node ? { action: "exists", shop, locationId: loc.id, locationName: loc.name, node } : { action: "insert", shop, locationId: loc.id, locationName: loc.name };
  });
}

/** PURE: the row an insert writes. Neither delivery nor pickup: the customer funnel does not change. */
export function nodeInsert(p: Extract<PlanRow, { action: "insert" }>, radiusMeters: number) {
  return { location_id: p.locationId, lat: p.shop.lat, lng: p.shop.lon, delivery_radius_meters: radiusMeters, offers_delivery: false, offers_pickup: false, active: true };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseSeedArgs(argv);
  if ("error" in args) { console.error(args.error); return 2; }
  const seed = readSeed();
  if (!Number.isInteger(seed.placeholderRadiusMeters) || seed.placeholderRadiusMeters <= 0) { console.error("placeholderRadiusMeters must be a positive integer. Nothing was read."); return 2; }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (e.g. npx tsx --env-file=.env.local ...). Nothing was read.");
    return 2;
  }
  const sb = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const locs = await sb.from("locations").select("id, name, active");
  if (locs.error) { console.error(`locations: ${locs.error.message}`); return 2; }
  const nodes = await sb.from("catering_fulfillment_nodes").select("location_id, lat, lng, active");
  if (nodes.error) { console.error(`catering_fulfillment_nodes: ${nodes.error.message}`); return 2; }
  const plan = planShopPoints(seed, (locs.data ?? []) as LocationRow[], (nodes.data ?? []) as NodeRow[]);
  let refused = 0;
  for (const p of plan) {
    if (p.action === "refuse") { refused += 1; console.error(`REFUSED  ${p.shop.address}: ${p.reason} (names ${p.shop.names.join(" / ")})`); continue; }
    if (p.action === "exists") {
      console.log(`exists   ${p.locationName} (${p.locationId}): node at ${p.node.lat}, ${p.node.lng} active=${p.node.active}; not touched (seed point ${p.shop.lat}, ${p.shop.lon})`);
      continue;
    }
    if (!args.apply) { console.log(`insert   ${p.locationName} (${p.locationId}): ${p.shop.lat}, ${p.shop.lon}  [${p.shop.match.matchedAddress}]`); continue; }
    const ins = await sb.from("catering_fulfillment_nodes").insert(nodeInsert(p, seed.placeholderRadiusMeters)).select("id").single<{ id: string }>();
    if (ins.error) { refused += 1; console.error(`FAILED   ${p.locationName}: ${ins.error.message}`); continue; }
    const audit = await sb.from("audit_log").insert({
      actor_id: null, actor_role: null, action: ACTION, resource_table: "catering_fulfillment_nodes", resource_id: ins.data.id, destructive: isDestructive(ACTION),
      metadata: { actor_context: "seed_shop_points", seed_file: SEED_FILE, location_id: p.locationId, created: true, radius_meters: seed.placeholderRadiusMeters,
        offers_delivery: false, offers_pickup: false, geocoder: "census_public_ar_current", geocoded_on: seed.geocodedOn },
    });
    if (audit.error) console.error(`audit row failed for ${p.locationName} (the node IS written; record an audit.gap_recovery): ${audit.error.message}`);
    console.log(`inserted ${p.locationName} (${p.locationId}): node ${ins.data.id} at ${p.shop.lat}, ${p.shop.lon}`);
  }
  console.log(args.apply ? "Applied." : "Dry run: nothing was written. Add --apply (CC: sim first, then prod).");
  return refused ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
}
