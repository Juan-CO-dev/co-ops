/**
 * Catalog Phase 3a — shop recipe versions PRESENT. The one resolver point answers:
 *   · live, per shop: a shop's own version replaces the global lines for THAT shop only;
 *   · as of a business date: a global edit made today never changes yesterday's rebuilt depletion; a
 *     shop version that went back to default still answers inside its own dates;
 *   · previews: hypothetical lines through the same loader, their SKUs hydrated;
 *   · the global live graph reads no version table at all; a quiet day reuses the live graph.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import { createDatedGraphs, loadPackBoundaries, loadRecipeGraph, loadRecipeLineOverlay, packIntervalIndex } from "@/lib/prep-consumption";
import { perUnitSkuOzForItemFromGraph, perUnitSkuOzForMenuItemFromGraph, type RecipeGraph } from "@/lib/prep-consumption-graph";
import type { RecipeVersionLineRow } from "@/lib/recipe-versions-shared";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));

const SHOP_SAVE = "2026-10-10T16:00:00.000Z";
const BACK_TO_DEFAULT = "2026-10-12T16:00:00.000Z";
const TODAY_EDIT = "2026-10-15T14:00:00.000Z"; // 10 AM ET on 2026-10-15

type Row = Record<string, unknown>;
const vrow = (id: string, recipe: string, loc: string | null, from: string, to: string | null): Row => ({
  id, recipe_id: recipe, location_id: loc, based_on_version_id: null, adopted_from_version_id: null, promoted_from_version_id: null,
  active: to === null, valid_from: from, valid_to: to, note: null, created_at: from, created_by: null, retired_by: null,
});
const lrow = (id: string, version: string, recipe: string, loc: string | null, sku: string, qty: number, unit: string, order: number): Row => ({
  id, version_id: version, recipe_id: recipe, location_id: loc, component_sku_id: sku, component_item_id: null, component_product_id: null,
  quantity: qty, unit, each_container_label: null, portioned: false, display_order: order, source_line_id: null,
});

function withVersions(): Record<string, Row[]> {
  const t = buildRecipeVersionsFixture();
  // (1) LOC's own slaw since 10-10: 24 oz of mayo instead of 16.
  t.recipe_versions!.push(vrow("sv-slaw", "r-slaw", LOC, SHOP_SAVE, null));
  t.recipe_version_lines!.push(
    lrow("svl-1", "sv-slaw", "r-slaw", LOC, "s-lettuce", 48, "oz", 0),
    lrow("svl-2", "sv-slaw", "r-slaw", LOC, "s-mayo", 24, "oz", 1),
  );
  // (2) OTHER's own pickle side from 10-10 to 10-12 (then back to default): 2 jars instead of 1.
  t.recipe_versions!.push(vrow("ov-pickle", "r-pickle", OTHER, SHOP_SAVE, BACK_TO_DEFAULT));
  t.recipe_version_lines!.push(lrow("ovl-1", "ov-pickle", "r-pickle", OTHER, "s-pickle", 2, "jar", 0));
  // (3) A GLOBAL edit today at 10 AM ET: the Italian's turkey 0.0125 case (4 oz) → 0.025 case (8 oz).
  const base = t.recipe_versions!.find((v) => v.id === "rv-r-italian-base")!;
  Object.assign(base, { active: false, valid_to: TODAY_EDIT });
  t.recipe_versions!.push(vrow("gv-italian-2", "r-italian", null, TODAY_EDIT, null));
  for (const l of t.recipe_version_lines!.filter((x) => x.version_id === "rv-r-italian-base")) {
    t.recipe_version_lines!.push({ ...l, id: `g2-${String(l.id)}`, version_id: "gv-italian-2", quantity: l.source_line_id === "ri-03" ? 0.025 : l.quantity });
  }
  t.recipe_inputs!.find((r) => r.id === "ri-03")!.quantity = 0.025; // recipe_inputs IS the live global head
  return t;
}

const turkey = (g: RecipeGraph) => perUnitSkuOzForMenuItemFromGraph(g, "m-italian").get("s-turkey");
const pickle = (g: RecipeGraph) => perUnitSkuOzForMenuItemFromGraph(g, "m-pickle-side").get("s-pickle");
const slawMayo = (g: RecipeGraph) => perUnitSkuOzForItemFromGraph(g, "i-slaw").get("s-mayo");

beforeEach(() => { current = createFakeDb(withVersions()); });
afterEach(() => { current = null; });

describe("live — a shop's own version answers for that shop only", () => {
  it("LOC's slaw uses 24 oz of mayo (12 per unit); OTHER and global keep the default (8 per unit)", async () => {
    expect(slawMayo(await loadRecipeGraph({ locationId: LOC }))).toBeCloseTo(12, 10);
    expect(slawMayo(await loadRecipeGraph({ locationId: OTHER }))).toBeCloseTo(8, 10);
    expect(slawMayo(await loadRecipeGraph())).toBeCloseTo(8, 10);
  });
  it("capture paths that pass only versionLocationId follow the shop's recipe too", async () => {
    expect(slawMayo(await loadRecipeGraph({ versionLocationId: LOC }))).toBeCloseTo(12, 10);
  });
  it("a retired shop version is never live: OTHER's pickle side is back on the default", async () => {
    expect(pickle(await loadRecipeGraph({ locationId: OTHER }))).toBeCloseTo(8, 10);
  });
  it("the global live graph reads no version table (zero extra queries)", async () => {
    const before = current!.log.length;
    await loadRecipeGraph();
    const tables = current!.log.slice(before).map((q) => q.table);
    expect(tables).not.toContain("recipe_versions");
    expect(tables).not.toContain("recipe_version_lines");
    expect((await loadRecipeLineOverlay(null, null)).size).toBe(0);
  });
});

describe("as of a business date — recipes are dated now (closes 2a open question 1)", () => {
  it("a GLOBAL edit made today: yesterday still depletes 4 oz of turkey, today 8, live 8", async () => {
    const dated = createDatedGraphs({ locationId: null });
    expect(turkey(await dated("2026-10-14"))).toBeCloseTo(4, 10);
    expect(turkey(await dated("2026-10-15"))).toBeCloseTo(8, 10);
    expect(turkey(await loadRecipeGraph())).toBeCloseTo(8, 10);
  });
  it("every shop riding the default sees the same dated edit", async () => {
    const dated = createDatedGraphs({ locationId: LOC });
    expect(turkey(await dated("2026-10-14"))).toBeCloseTo(4, 10);
    expect(turkey(await dated("2026-10-15"))).toBeCloseTo(8, 10);
  });
  it("back to default, seen from the past: OTHER's 2-jar version answers on 10-11 only", async () => {
    const dated = createDatedGraphs({ locationId: OTHER });
    expect(pickle(await dated("2026-10-09"))).toBeCloseTo(8, 10);
    expect(pickle(await dated("2026-10-11"))).toBeCloseTo(16, 10);
    expect(pickle(await dated("2026-10-13"))).toBeCloseTo(8, 10);
  });
  it("LOC's slaw version starts on 10-10: 10-09 is the default, 10-11 is LOC's — INSIDE ONE pack interval (Astra 3a r3#1)", async () => {
    // 2a caches one graph per pack interval; 10-09 and 10-11 sit in the SAME pack interval, so only the recipe
    // boundary (merged into the cuts by loadCatalogBoundaries) can tell them apart.
    const packs = await loadPackBoundaries(LOC);
    expect(packIntervalIndex(packs, Date.parse("2026-10-10T03:59:59.999Z"))).toBe(packIntervalIndex(packs, Date.parse("2026-10-12T03:59:59.999Z")));
    const dated = createDatedGraphs({ locationId: LOC });
    expect(slawMayo(await dated("2026-10-09"))).toBeCloseTo(8, 10);
    expect(slawMayo(await dated("2026-10-11"))).toBeCloseTo(12, 10);
  });
  it("a day after every pack and recipe boundary reuses the live graph (no extra graph load)", async () => {
    const dated = createDatedGraphs({ locationId: LOC });
    const before = current!.log.filter((q) => q.table === "recipes").length;
    await dated("2026-10-16");
    await dated("2026-10-17");
    expect(current!.log.filter((q) => q.table === "recipes").length - before).toBe(1);
  });
});

describe("preview overrides — hypothetical lines through the same loader", () => {
  it("override wins over the version and hydrates a SKU no recipe names", async () => {
    const lines: RecipeVersionLineRow[] = [
      { id: "h1", version_id: "preview", recipe_id: "r-slaw", component_sku_id: "s-mayo", component_item_id: null, component_product_id: null, quantity: 40, unit: "oz", each_container_label: null, portioned: false, display_order: 0 },
      { id: "h2", version_id: "preview", recipe_id: "r-slaw", component_sku_id: "s-bags", component_item_id: null, component_product_id: null, quantity: 2, unit: "oz", each_container_label: null, portioned: false, display_order: 1 },
    ];
    const g = await loadRecipeGraph({ locationId: LOC, recipeOverrides: new Map([["r-slaw", lines]]) });
    expect(slawMayo(g)).toBeCloseTo(20, 10);
    expect(g.skuPack.has("s-bags")).toBe(true);
  });
});
