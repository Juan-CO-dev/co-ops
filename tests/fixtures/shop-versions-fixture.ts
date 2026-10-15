/**
 * Catalog Phase 2a — THE FIXTURE MATRIX the equivalence pin runs over.
 *
 * Built on the B9 counts fixture (tests/fixtures/counts-onhand-fixture.ts) so products, per-shop
 * primaries, a store copy, receipts and chains are already awkward in the right ways, then
 * extended with everything the costing / depletion / ordering / production numbers need:
 *
 *   chained, weight leaf, two levels ........ s-turkey  (case → 4 bag → 80 oz = 320 oz)
 *   chained, count leaf via avg .............. s-tomato  (case → 20 each, avg 4.5 oz = 90 oz)
 *   chained, count leaf, packaging ........... s-bags    (case → 10 sleeve → 50 each)
 *   inactive historical level set ............ s-cups    (box, active=false)
 *   unchained, legacy flat path .............. s-lettuce (case of 24 × 1 lb), s-mayo (tub 30 lb), s-pickle (jar 32 oz)
 *   no pack basis at all ..................... s-cheese
 *   product pins, per-shop primaries ......... p-ham (global primary), p-bread (LOC → twin-y, OTHER → twin-x off-here)
 *   recipe line in a CHAIN label ............. 0.0125 case of turkey (= 4 oz)
 *   recipe line in a LEGACY pack label ....... 1 jar of pickle
 *   item-ref line by weight .................. 2 oz of Slaw (quart = 32 oz)
 *   retired recipe ........................... r-old
 *   price ties ............................... s-cheese: same effective_date, later recorded_at wins
 *   price on an inactive SKU ................. s-old
 *
 * THE POST-0259 SHAPE. Every level carries version_id + location_id (null); the backfilled global
 * sku_pack_versions rows exist with their real dates (valid_from / valid_to); every price row
 * carries location_id + price_lane_id (null); sku_price_lanes exists and is empty. Code written
 * before 0259 ignores all of it — which is what lets ONE fixture produce the golden (Task 1,
 * today's code) and prove the new code against it (Tasks 5–6).
 */
import { buildCountsFixture, LOC, OTHER } from "./counts-onhand-fixture";

type Row = Record<string, unknown>;
export { LOC, OTHER };

export const ACTIVE_FROM = "2026-08-01T00:00:00.000Z";
export const OLD_FROM = "2026-07-01T00:00:00.000Z";
/** A business date after every pack boundary in the fixture: its dated graph IS the live graph. */
export const QUIET_DAY = "2026-10-14";

/** Turn plain chain rows into the post-0259 shape: one global version per (sku, active) set, dated. */
export function withBackfilledVersions(tables: Record<string, Row[]>): Record<string, Row[]> {
  const levels = tables.sku_pack_levels ?? [];
  const versions: Row[] = [];
  const versionIdFor = new Map<string, string>();
  for (const l of levels) {
    if (l.version_id != null) continue;
    const active = l.active !== false;
    const from = (l.effective_from as string | undefined) ?? (active ? ACTIVE_FROM : OLD_FROM);
    l.effective_from = from;
    const key = `${String(l.sku_id)}|${from}|${active}`;
    let vid = versionIdFor.get(key);
    if (!vid) {
      vid = `pv-${String(l.sku_id)}-${active ? "live" : "old"}`;
      versionIdFor.set(key, vid);
      versions.push({
        id: vid, sku_id: l.sku_id, location_id: null, based_on_version_id: null,
        active, valid_from: from, valid_to: active ? null : ACTIVE_FROM,
        note: null, created_at: from, created_by: null, retired_by: null,
      });
    }
    l.version_id = vid;
    if (!("location_id" in l)) l.location_id = null;
  }
  tables.sku_pack_versions = [...(tables.sku_pack_versions ?? []), ...versions];
  for (const p of tables.vendor_price_history ?? []) {
    if (!("location_id" in p)) p.location_id = null;
    if (!("price_lane_id" in p)) p.price_lane_id = null;
  }
  tables.sku_price_lanes ??= [];
  return tables;
}

export function buildShopVersionsFixture(): Record<string, Row[]> {
  const t = buildCountsFixture();
  const sku = (id: string) => {
    const row = (t.vendor_items ?? []).find((r) => r.id === id);
    if (!row) throw new Error(`fixture: no SKU ${id}`);
    return row;
  };
  // Unchained SKUs on the legacy flat path.
  Object.assign(sku("s-lettuce"), { pack_format: "case", units_per_pack: 24, each_size: 1, each_measure: "lb" });
  Object.assign(sku("s-mayo"), { pack_format: "tub", units_per_pack: 1, each_size: 30, each_measure: "lb" });
  Object.assign(sku("s-pickle"), { pack_format: "jar", units_per_pack: 1, each_size: 32, each_measure: "oz" });
  // A chained count leaf that converts through the SKU's avg.
  Object.assign(sku("s-tomato"), { avg_oz_per_each: "4.5" });
  t.sku_pack_levels!.push({
    id: "pl-tom-case", sku_id: "s-tomato", label: "case", contains_qty: 20,
    contains_level_id: null, contains_measure_unit: "each", display_ordinal: 1, active: true,
  });

  t.items = [{ id: "i-slaw", name: "Slaw", oz_per_par_unit: 32, default_par_unit: "quart", active: true }];
  t.menu_items = [
    { id: "m-italian", name: "Italian", name_es: null, active: true },
    { id: "m-pickle-side", name: "Pickle side", name_es: null, active: true },
    { id: "m-old", name: "Old sub", name_es: null, active: false },
  ];
  t.recipes = [
    { id: "r-slaw", name: "Slaw", batch_yield: 2, active: true, created_at: "2026-09-01T00:00:00.000Z" },
    { id: "r-italian", name: "Italian", batch_yield: 1, active: true, created_at: "2026-09-02T00:00:00.000Z" },
    { id: "r-pickle", name: "Pickle side", batch_yield: 4, active: true, created_at: "2026-09-03T00:00:00.000Z" },
    { id: "r-old", name: "Old sub", batch_yield: 1, active: false, created_at: "2026-06-01T00:00:00.000Z" },
  ];
  const input = (id: string, recipe_id: string, quantity: number, unit: string, target: Row): Row =>
    ({ id, recipe_id, quantity, unit, component_sku_id: null, component_item_id: null, component_product_id: null, ...target });
  t.recipe_inputs = [
    input("ri-01", "r-slaw", 48, "oz", { component_sku_id: "s-lettuce" }),
    input("ri-02", "r-slaw", 16, "oz", { component_sku_id: "s-mayo" }),
    input("ri-03", "r-italian", 0.0125, "case", { component_sku_id: "s-turkey" }),
    input("ri-04", "r-italian", 2, "oz", { component_item_id: "i-slaw" }),
    input("ri-05", "r-italian", 3, "oz", { component_product_id: "p-ham" }),
    input("ri-06", "r-italian", 1, "each", { component_product_id: "p-bread" }),
    input("ri-07", "r-italian", 2, "each", { component_sku_id: "s-tomato" }),
    input("ri-08", "r-italian", 1.5, "oz", { component_sku_id: "s-cheese" }),
    input("ri-09", "r-pickle", 1, "jar", { component_sku_id: "s-pickle" }),
    input("ri-10", "r-old", 1, "oz", { component_sku_id: "s-onion" }),
  ];
  t.recipe_outputs = [
    { id: "ro-1", recipe_id: "r-slaw", output_item_id: "i-slaw", output_menu_item_id: null, yield: 2 },
    { id: "ro-2", recipe_id: "r-italian", output_item_id: null, output_menu_item_id: "m-italian", yield: 1 },
    { id: "ro-3", recipe_id: "r-pickle", output_item_id: null, output_menu_item_id: "m-pickle-side", yield: 4 },
    { id: "ro-4", recipe_id: "r-old", output_item_id: null, output_menu_item_id: "m-old", yield: 1 },
  ];
  const price = (id: string, vendor_item_id: string, unit_price: number | string, effective_date: string, recorded_at: string): Row =>
    ({ id, vendor_item_id, unit_price, effective_date, recorded_at, recorded_by: null, source: null, source_note: null });
  t.vendor_price_history = [
    price("ph-01", "s-turkey", 120, "2026-09-01", "2026-09-01T12:00:00.000Z"),
    price("ph-02", "s-turkey", 128, "2026-10-01", "2026-10-01T12:00:00.000Z"),
    price("ph-03", "s-cheese", "45.10", "2026-10-01", "2026-10-01T10:00:00.000Z"),
    price("ph-04", "s-cheese", "46.20", "2026-10-01", "2026-10-01T12:00:00.000Z"),
    price("ph-05", "s-ham-a", 3.1, "2026-10-02", "2026-10-02T12:00:00.000Z"),
    price("ph-06", "s-ham-b", 6.4, "2026-10-02", "2026-10-02T12:00:00.000Z"),
    price("ph-07", "s-twin-x", 4, "2026-10-02", "2026-10-02T12:00:00.000Z"),
    price("ph-08", "s-twin-y", 4.5, "2026-10-02", "2026-10-02T12:00:00.000Z"),
    price("ph-09", "s-lettuce", 38, "2026-10-03", "2026-10-03T12:00:00.000Z"),
    price("ph-10", "s-mayo", 22, "2026-10-03", "2026-10-03T12:00:00.000Z"),
    price("ph-11", "s-pickle", 9.99, "2026-10-03", "2026-10-03T12:00:00.000Z"),
    price("ph-12", "s-tomato", 25, "2026-10-03", "2026-10-03T12:00:00.000Z"),
    price("ph-13", "s-old", 7, "2026-10-03", "2026-10-03T12:00:00.000Z"),
    price("ph-14", "s-bags", 30, "2026-10-03", "2026-10-03T12:00:00.000Z"),
  ];
  t.locations = [
    { id: LOC, name: "Shop one", active: true },
    { id: OTHER, name: "Shop two", active: true },
  ];
  return withBackfilledVersions(t);
}
