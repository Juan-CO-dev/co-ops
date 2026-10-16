/** Frozen shared baseline plus ownership isolation contracts implemented in Chunk 3.
 * The CHUNK 3 labels preserve the original test-first handoff identities.
 * Do not skip/xfail them or regenerate the existing goldens to conceal a regression.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopOwnedFixture, OWNED } from "./fixtures/shop-owned-fixture";
import { EARLY_DAY, LOC, MID_DAY, OTHER, QUIET_DAY } from "./fixtures/recipe-versions-fixture";
import { computeLineReaderOutputs, computeRecipeOutputs, liveRecipeApi } from "./fixtures/recipe-versions-harness";
import { loadRecipeGraph, loadResolvedRecipeInputs, loadResolvedRecipeInputsByScope, loadRecipeInputsAcrossScopes } from "@/lib/prep-consumption";
import { perUnitSkuOzForMenuItemFromGraph } from "@/lib/prep-consumption-graph";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fixture installed");
  return current.client;
} }));
afterEach(() => { current = null; });
function install(owned = true) {
  const tables = buildShopOwnedFixture(owned);
  current = createFakeDb(tables);
  return tables;
}

describe("Phase 3a frozen baseline with explicit shared ownership", () => {
  it("keeps costing, depletion and menu board byte-identical in all three scopes", async () => {
    const tables = install(false);
    const got = await computeRecipeOutputs(liveRecipeApi, tables, [LOC, OTHER], [EARLY_DAY, MID_DAY, QUIET_DAY]);
    expect(got).toEqual(JSON.parse(readFileSync("tests/fixtures/recipe-versions-golden.json", "utf8")));
  });
  it("keeps every line-reader golden unchanged", async () => {
    const tables = install(false);
    expect(await computeLineReaderOutputs(tables, [LOC, OTHER]))
      .toEqual(JSON.parse(readFileSync("tests/fixtures/recipe-line-readers-golden.json", "utf8")));
  });
  it.each([null, LOC, OTHER])("adding unrelated owned chains does not alter shared depletion in %s", async scope => {
    install(false);
    const before = await liveRecipeApi.graph(scope);
    install();
    const after = await liveRecipeApi.graph(scope);
    for (const id of ["m-italian", "m-pickle-side"]) {
      const baseline = [...perUnitSkuOzForMenuItemFromGraph(before, id)];
      expect(baseline.length).toBeGreaterThan(0);
      expect([...perUnitSkuOzForMenuItemFromGraph(after, id)]).toEqual(baseline);
    }
  });
});

describe("owned two-shop matrix", () => {
  it.each(OWNED)("owner $shop resolves its own prep and sandwich", async own => {
    install();
    const graph = await loadRecipeGraph({ locationId: own.shop });
    expect(graph.byOutputItem.has(own.item)).toBe(true);
    expect(graph.byOutputMenuItem.has(own.menu)).toBe(true);
    expect([...perUnitSkuOzForMenuItemFromGraph(graph, own.menu)]).toEqual([[own.sku, 8]]);
  });
  it("impact/share readers keep both shops in their complete universe", async () => {
    install();
    const inputs = await loadRecipeInputsAcrossScopes();
    for (const own of OWNED) {
      expect(inputs.some(row => row.recipe_id === own.prep)).toBe(true);
      expect(inputs.some(row => row.recipe_id === own.recipe)).toBe(true);
    }
  });
  it.each([null, LOC, OTHER])("CHUNK 3: graph excludes foreign-owned outputs at %s", async scope => {
    install();
    const graph = await liveRecipeApi.graph(scope);
    expect(graph.byOutputMenuItem.has("m-italian")).toBe(true);
    for (const own of OWNED) {
      expect.soft(graph.byOutputItem.has(own.item)).toBe(own.shop === scope);
      expect.soft(graph.byOutputMenuItem.has(own.menu)).toBe(own.shop === scope);
    }
  });
  it.each([null, LOC, OTHER])("CHUNK 3: single and batch line readers exclude foreign recipes at %s", async scope => {
    install();
    const single = await loadResolvedRecipeInputs(scope);
    const batch = await loadResolvedRecipeInputsByScope([null, LOC, OTHER]);
    const rows = batch.get(scope ?? "global");
    expect(rows).toBeDefined();
    for (const inputs of [single, rows!]) {
      expect(inputs.some(row => row.recipe_id === "r-italian")).toBe(true);
      for (const own of OWNED) {
        expect.soft(inputs.some(row => row.recipe_id === own.prep)).toBe(own.shop === scope);
        expect.soft(inputs.some(row => row.recipe_id === own.recipe)).toBe(own.shop === scope);
      }
    }
  });
});


describe("owned reader projections", () => {
  it("explicit global version selection does not hide a recipe owned by the selected shop", async () => {
    install();
    const graph = await loadRecipeGraph({ locationId: LOC, versionLocationId: null });
    expect(graph.byOutputMenuItem.has(OWNED[0]!.menu)).toBe(true);
    expect(graph.byOutputMenuItem.has(OWNED[1]!.menu)).toBe(false);
  });
  it.each([null, LOC, OTHER])("readiness excludes hidden recipes and items in %s, including preloaded rows", async scope => {
    install();
    const { loadGraphRows, loadGraphReadiness } = await import("@/lib/admin/readiness-load");
    const { OWNER_ACTOR } = await import("./fixtures/recipe-versions-harness");
    const rows = await loadGraphRows(scope);
    const result = await loadGraphReadiness(OWNER_ACTOR, scope, { rows, skuStatus: new Map(), measureUnits: [] });
    for (const own of OWNED) {
      expect(result.recipeReadiness.has(own.recipe)).toBe(own.shop === scope);
      expect(result.itemReadiness.has(own.item)).toBe(own.shop === scope);
      if (own.shop === scope) {
        expect(result.recipeReadiness.get(own.recipe)).toBeDefined();
        expect(result.recipeReadiness.get(own.recipe)!.reasons.map(r => r.code)).not.toContain("no_inputs");
      }
    }
  });
});


it("global admin costing uses each owned menu item's owner and shop boards exclude foreign menus", async () => {
  install();
  const { loadMenuCostingBoard } = await import("@/lib/admin/menu-costing");
  const { OWNER_ACTOR } = await import("./fixtures/recipe-versions-harness");
  const global = await loadMenuCostingBoard(OWNER_ACTOR);
  for (const own of OWNED) {
    const board = await loadMenuCostingBoard(OWNER_ACTOR, { scope: own.shop });
    const local = board.rows.find(r => r.id === own.menu);
    expect(local).toBeDefined();
    expect(local!.rollup.cost).toBe(2);
    expect(global.rows.find(r => r.id === own.menu)!.rollup.cost).toBe(local!.rollup.cost);
    expect(board.rows.some(r => r.id === OWNED.find(o => o.shop !== own.shop)!.menu)).toBe(false);
  }
});


it("ownership read failures cannot expose unprojected lines", async () => {
  const tables = install();
  delete tables.recipes;
  await expect(loadResolvedRecipeInputs(LOC)).rejects.toThrow("loadRecipeOwners");
  await expect(loadResolvedRecipeInputsByScope([null, LOC])).rejects.toThrow("loadRecipeOwners");
});

it("the organization catalog keeps owned prep and menu producer graphs", async () => {
  const tables = install();
  for (const table of ["catering_packages", "catering_package_items", "catering_package_slot_options", "toast_menu_map", "checklist_template_items", "item_sizes", "units", "checklist_templates"]) tables[table] ??= [];
  const { loadCatalogView } = await import("@/lib/admin/catalog");
  const { OWNER_ACTOR } = await import("./fixtures/recipe-versions-harness");
  const entities = await loadCatalogView(OWNER_ACTOR);
  for (const own of OWNED) {
    expect(entities.find(e => e.id === own.item)!.edges.producedBy.map(r => r.id)).toEqual([own.prep]);
    expect(entities.find(e => e.id === own.menu)!.edges.build?.id).toBe(own.recipe);
  }
});


it("preloaded readiness rows are projected again for the requested scope", async () => {
  install();
  const { loadGraphRows, loadGraphReadiness } = await import("@/lib/admin/readiness-load");
  const { OWNER_ACTOR } = await import("./fixtures/recipe-versions-harness");
  const rows = await loadGraphRows(LOC);
  expect(rows.recipes.some(r => r.id === OWNED[0]!.recipe)).toBe(true);
  const result = await loadGraphReadiness(OWNER_ACTOR, OTHER, { rows, skuStatus: new Map(), measureUnits: [] });
  expect(result.recipeReadiness.has("r-italian")).toBe(true);
  expect(result.recipeReadiness.has(OWNED[0]!.recipe)).toBe(false);
  expect(result.itemReadiness.has(OWNED[0]!.item)).toBe(false);
});

it("preview overrides cannot hydrate hidden existing recipes", async () => {
  const tables = install();
  const foreign = OWNED[1]!;
  const lines = tables.recipe_version_lines!.filter(r => r.recipe_id === foreign.recipe);
  const graph = await loadRecipeGraph({ locationId: LOC, recipeOverrides: new Map([[foreign.recipe, lines as unknown as import("@/lib/recipe-versions-shared").RecipeVersionLineRow[]]]) });
  expect(graph.byOutputMenuItem.has(foreign.menu)).toBe(false);
  expect(graph.skuPack.has(foreign.sku)).toBe(false);
});


it("manual Toast picker preserves ownership metadata for every entity lane", async () => {
  const tables = install();
  tables.catering_packages = [];
  for (const own of OWNED) tables.vendor_items!.find(r => r.id === own.sku)!.sku_class = "raw";
  const { listMappableEntities } = await import("@/lib/admin/toast-map");
  const { OWNER_ACTOR } = await import("./fixtures/recipe-versions-harness");
  const entities = await listMappableEntities(OWNER_ACTOR);
  for (const own of OWNED) for (const id of [own.item, own.menu, own.sku]) {
    expect(entities.find(e => e.id === id)).toMatchObject({ locationId: own.shop });
  }
});
