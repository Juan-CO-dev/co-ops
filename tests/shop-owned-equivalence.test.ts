/** Chunk 1: frozen shared baseline plus executable future isolation contracts.
 * Tests labelled CHUNK 3 intentionally remain red until the reader sweep lands.
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
