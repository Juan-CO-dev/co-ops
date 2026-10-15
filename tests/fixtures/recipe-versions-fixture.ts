/**
 * Catalog Phase 3a — THE FIXTURE MATRIX the recipe / menu equivalence pin runs over.
 *
 * Built on Phase 2a's shop-versions fixture (tests/fixtures/shop-versions-fixture.ts): products with
 * per-shop primaries, dated pack versions, price lanes, and four recipes —
 *   r-slaw    → i-slaw (prep)        48 oz lettuce + 16 oz mayo, yield 2
 *   r-italian → m-italian (menu)     turkey by chain label, slaw by weight, ham + bread products,
 *                                    tomato by count, cheese
 *   r-pickle  → m-pickle-side (menu) 1 jar of pickle (a legacy pack label)
 *   r-old     → m-old (menu)         RETIRED
 * — then extended to the POST-0262/0263 SHAPE:
 *   · every recipe has ONE baseline GLOBAL recipe_versions row (valid_from 2000-01-01, active) whose
 *     recipe_version_lines are a copy of its recipe_inputs (source_line_id = the input id);
 *   · menu_item_shop_settings and recipe_notice_dismissals exist and are empty;
 *   · menu_items carry the columns the costing board reads: the Italian is typed at $12.50, a lunch
 *     Italian has no recipe and inherits the Italian's price ("same as"), the pickle side is $2.25.
 * Code written before 0262 ignores the new tables, which is what lets ONE fixture produce the
 * golden (Task 1, today's code) and prove the new code against it (Tasks 5–6).
 */
import { buildShopVersionsFixture, LOC, OTHER, QUIET_DAY } from "./shop-versions-fixture";

type Row = Record<string, unknown>;
export { LOC, OTHER, QUIET_DAY };

export const RECIPE_BASELINE_FROM = "2000-01-01T00:00:00.000Z";
/** Before every pack version in the 2a fixture: the dated graph really runs its as-of path. */
export const EARLY_DAY = "2026-07-15";
/** After every pack boundary, inside the price history. */
export const MID_DAY = "2026-09-15";

/** The 0262 backfill, in fixture form: one baseline global version per recipe, lines copied. */
export function withBackfilledRecipeVersions(tables: Record<string, Row[]>): Record<string, Row[]> {
  const versions: Row[] = [...(tables.recipe_versions ?? [])];
  const lines: Row[] = [...(tables.recipe_version_lines ?? [])];
  const hasGlobal = new Set(versions.filter((v) => v.location_id == null).map((v) => String(v.recipe_id)));
  for (const r of tables.recipes ?? []) {
    const rid = String(r.id);
    if (hasGlobal.has(rid)) continue;
    const vid = `rv-${rid}-base`;
    versions.push({
      id: vid, recipe_id: rid, location_id: null, based_on_version_id: null, adopted_from_version_id: null,
      promoted_from_version_id: null, active: true, valid_from: RECIPE_BASELINE_FROM, valid_to: null,
      note: "0262 baseline", created_at: RECIPE_BASELINE_FROM, created_by: null, retired_by: null,
    });
    for (const i of (tables.recipe_inputs ?? []).filter((x) => x.recipe_id === rid)) {
      lines.push({
        id: `rvl-${String(i.id)}`, version_id: vid, recipe_id: rid, location_id: null,
        component_sku_id: i.component_sku_id ?? null, component_item_id: i.component_item_id ?? null,
        component_product_id: i.component_product_id ?? null, quantity: i.quantity, unit: i.unit ?? null,
        each_container_label: i.each_container_label ?? null, portioned: i.portioned === true,
        display_order: typeof i.display_order === "number" ? i.display_order : 0, source_line_id: i.id,
      });
    }
  }
  tables.recipe_versions = versions;
  tables.recipe_version_lines = lines;
  tables.menu_item_shop_settings ??= [];
  tables.recipe_notice_dismissals ??= [];
  return tables;
}

export function buildRecipeVersionsFixture(): Record<string, Row[]> {
  const t = buildShopVersionsFixture();
  const menu = (id: string) => {
    const row = (t.menu_items ?? []).find((r) => r.id === id);
    if (!row) throw new Error(`fixture: no menu item ${id}`);
    return row;
  };
  Object.assign(menu("m-italian"), { name_es: "Italiano", section: "Subs", menu_price: 12.5, price_same_as_id: null, catering_available: false });
  Object.assign(menu("m-pickle-side"), { name_es: "Pepinillos", section: "Sides", menu_price: 2.25, price_same_as_id: null, catering_available: false });
  Object.assign(menu("m-old"), { section: "Subs", menu_price: 9, price_same_as_id: null, catering_available: false });
  t.menu_items!.push({
    id: "m-italian-lunch", name: "Italian (lunch)", name_es: "Italiano (almuerzo)", active: true, section: "Subs",
    menu_price: null, price_same_as_id: "m-italian", catering_available: false,
  });
  return withBackfilledRecipeVersions(t);
}
