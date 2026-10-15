/**
 * Catalog Phase 2a — the PROD-SNAPSHOT EQUIVALENCE PROOF runner (Astra full-branch r1 P2).
 *
 *   node scripts/snapshot-equivalence.mjs [tmp/shop-versions-snapshot] [--day YYYY-MM-DD] [--out tmp/snapshot-report.json]
 *
 * Reads a directory of `<table>.json` files (one JSON array per table, exported from prod
 * READ-ONLY with the SELECTs below; `tmp/` is git-ignored), checks every table and column is
 * there, then runs tests/shop-versions-snapshot.test.ts:
 *   BEFORE = origin/main's frozen loaders over the ORIGINAL rows;
 *   AFTER  = the REAL 0259 + 0260 executed over the same rows in PGlite (in memory), read back,
 *            then the new scoped resolver.
 * It asserts no shop version / no lane / an untouched flat mirror and IDENTICAL numbers. This script
 * never connects to a database. Exit 0 = proven; anything else = not proven.
 *
 * ── THE EXPORT (catalog tables only; no customer data). Run each, save the array as <table>.json ──
 * Must be taken BEFORE 0259 is applied to that database (it is the "before").
 *
 *   select coalesce(json_agg(t order by t.id), '[]') from (select id, active from public.locations) t;                                  -- locations.json
 *   select coalesce(json_agg(t order by t.id), '[]') from (select id, name, source_kind, active from public.vendors) t;                 -- vendors.json
 *   select coalesce(json_agg(t order by t.id), '[]') from (select id, name, active, location_id, vendor_id, product_id, pending_review,
 *          pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each from public.vendor_items) t;   -- vendor_items.json
 *   select coalesce(json_agg(t order by t.label), '[]') from (select label, dimension, to_base_factor, active from public.measure_units) t; -- measure_units.json
 *   select coalesce(json_agg(t order by t.id), '[]') from (select id, sku_id, label, contains_qty, contains_level_id, contains_measure_unit,
 *          display_ordinal, effective_from, active, created_at, created_by from public.sku_pack_levels) t;                           -- sku_pack_levels.json
 *   select coalesce(json_agg(t order by t.id), '[]') from (select id, vendor_item_id, unit_price, effective_date, recorded_at, recorded_by,
 *          source, source_note from public.vendor_price_history) t;                                                                  -- vendor_price_history.json
 *   select coalesce(json_agg(t order by t.id), '[]') from (select id, name, unit_oz, active from public.products) t;                   -- products.json
 *   select coalesce(json_agg(t order by t.id), '[]') from (select id, product_id, location_id, primary_sku_id, note from public.product_primaries) t; -- product_primaries.json
 *   select coalesce(json_agg(t order by t.sku_id, t.location_id), '[]') from (select sku_id, location_id, active_override,
 *          auto_weekday_par, auto_weekend_par from public.location_sku_settings) t;                                                  -- location_sku_settings.json
 *   select coalesce(json_agg(t order by t.id), '[]') from (select id, location_id, vendor_id, created_at, delivery_date from public.vendor_deliveries) t; -- vendor_deliveries.json
 *   select coalesce(json_agg(t order by t.id), '[]') from (select id, delivery_id, vendor_item_id, created_at, resolved_oz from public.vendor_delivery_items) t; -- vendor_delivery_items.json
 *   select coalesce(json_agg(t order by t.id), '[]') from (select id, batch_yield, active, created_at from public.recipes) t;           -- recipes.json
 *   select coalesce(json_agg(t order by t.id), '[]') from (select id, recipe_id, quantity, unit, component_sku_id, component_item_id,
 *          component_product_id from public.recipe_inputs) t;                                                                         -- recipe_inputs.json
 *   select coalesce(json_agg(t order by t.id), '[]') from (select id, recipe_id, output_item_id, output_menu_item_id, yield from public.recipe_outputs) t; -- recipe_outputs.json
 *   select coalesce(json_agg(t order by t.id), '[]') from (select id, name, oz_per_par_unit, default_par_unit from public.items) t;    -- items.json
 *
 * (location_sku_settings.auto_* exist since 0183. created_by / recorded_by are staff user ids, kept
 * only so the FK shape matches; they may be exported as null.)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const SNAPSHOT_COLUMNS = {
  locations: ["id", "active"],
  vendors: ["id", "name", "source_kind", "active"],
  vendor_items: ["id", "name", "active", "location_id", "vendor_id", "product_id", "pending_review", "pack_format", "each_container_label", "units_per_pack", "each_size", "each_measure", "avg_oz_per_each"],
  measure_units: ["label", "dimension", "to_base_factor", "active"],
  sku_pack_levels: ["id", "sku_id", "label", "contains_qty", "contains_level_id", "contains_measure_unit", "display_ordinal", "effective_from", "active", "created_at", "created_by"],
  vendor_price_history: ["id", "vendor_item_id", "unit_price", "effective_date", "recorded_at", "recorded_by", "source", "source_note"],
  products: ["id", "name", "unit_oz", "active"],
  product_primaries: ["id", "product_id", "location_id", "primary_sku_id", "note"],
  location_sku_settings: ["sku_id", "location_id", "active_override", "auto_weekday_par", "auto_weekend_par"],
  vendor_deliveries: ["id", "location_id", "vendor_id", "created_at", "delivery_date"],
  vendor_delivery_items: ["id", "delivery_id", "vendor_item_id", "created_at", "resolved_oz"],
  recipes: ["id", "batch_yield", "active", "created_at"],
  recipe_inputs: ["id", "recipe_id", "quantity", "unit", "component_sku_id", "component_item_id", "component_product_id"],
  recipe_outputs: ["id", "recipe_id", "output_item_id", "output_menu_item_id", "yield"],
  items: ["id", "name", "oz_per_par_unit", "default_par_unit"],
};

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dir = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]?.startsWith("--"))) ?? "tmp/shop-versions-snapshot";

const problems = [];
if (!existsSync(dir)) problems.push(`snapshot directory not found: ${dir}`);
else {
  for (const [table, cols] of Object.entries(SNAPSHOT_COLUMNS)) {
    const file = join(dir, `${table}.json`);
    if (!existsSync(file)) { problems.push(`missing ${table}.json`); continue; }
    let rows;
    try { rows = JSON.parse(readFileSync(file, "utf8")); } catch (e) { problems.push(`${table}.json is not JSON: ${e.message}`); continue; }
    if (!Array.isArray(rows)) { problems.push(`${table}.json is not an array`); continue; }
    if (rows.length > 0) {
      const missing = cols.filter((c) => !(c in rows[0]));
      if (missing.length > 0) problems.push(`${table}.json lacks column(s): ${missing.join(", ")}`);
    }
    if (table === "sku_pack_levels" && rows.some((r) => "version_id" in r)) problems.push("sku_pack_levels.json has version_id: export BEFORE 0259 is applied");
    console.log(`  ${table.padEnd(24)} ${String(rows.length).padStart(6)} rows`);
  }
}
if (problems.length > 0) {
  console.error(`\nNOT RUN — the snapshot is incomplete:\n  - ${problems.join("\n  - ")}`);
  process.exit(2);
}

const env = { ...process.env, SHOP_VERSIONS_SNAPSHOT_DIR: dir };
if (flag("--day")) env.SHOP_VERSIONS_SNAPSHOT_DAY = flag("--day");
if (flag("--out")) env.SHOP_VERSIONS_SNAPSHOT_OUT = flag("--out");
const run = spawnSync("npx", ["vitest", "run", "tests/shop-versions-snapshot.test.ts"], { env, encoding: "utf8", shell: process.platform === "win32" });
process.stdout.write(run.stdout ?? "");
process.stderr.write(run.stderr ?? "");
// Both tests must PASS (the synthetic self-test and the real snapshot): a skip is not a proof.
const proven = run.status === 0 && /Tests\s+2 passed/.test(run.stdout ?? "");
console.log(proven ? "\nPROVEN: origin/main's numbers equal 2a's after the real 0259 + 0260 on this snapshot." : "\nNOT PROVEN — see the output above.");
process.exit(proven ? 0 : 1);
