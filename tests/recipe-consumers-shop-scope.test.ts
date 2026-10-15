/**
 * Catalog Phase 3a — lead decision 4 (Astra 3a r1#1): every recipe-line reader answers with THE SHOP'S
 * recipe. LOC's slaw swaps mayo (s-mayo) for pickle (s-pickle); OTHER rides the default. Production's
 * picker and its conversion check, the par advisories' demand sources, readiness's line read, and the
 * any-scope "used in" all follow it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildRecipeVersionsFixture, LOC, OTHER } from "./fixtures/recipe-versions-fixture";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipeInputsAcrossScopes, loadResolvedRecipeInputs } from "@/lib/prep-consumption";
import { loadSkuToItems, recordProduction, ProductionError } from "@/lib/production";
import { loadDemandSources } from "@/lib/ordering";
import { loadGraphRows } from "@/lib/admin/readiness-load";
import { loadSkuUsageMap } from "@/lib/admin/cost";
import { attributeNotReady, itemsLandingView, readinessScopeHref } from "@/lib/admin/readiness-scope-shared";
import { readFileSync } from "node:fs";
import type { AuthContext } from "@/lib/session";
import type { Readiness } from "@/lib/readiness";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
afterEach(() => { current = null; });

const SHOP_SAVE = "2026-10-01T12:00:00.000Z";
const owner = { user: { id: "u-owner", role: "owner" }, role: "owner", level: 9, locations: [LOC, OTHER] } as unknown as AuthContext;

/** LOC's slaw: lettuce as before, PICKLE where the default has mayo. */
function withShopSlaw(): Record<string, Array<Record<string, unknown>>> {
  const t = buildRecipeVersionsFixture();
  t.recipe_versions!.push({
    id: "rv-slaw-loc", recipe_id: "r-slaw", location_id: LOC, based_on_version_id: "rv-r-slaw-base",
    adopted_from_version_id: null, promoted_from_version_id: null, active: true, valid_from: SHOP_SAVE, valid_to: null,
    note: null, created_at: SHOP_SAVE, created_by: null, retired_by: null,
  });
  const line = (id: string, sku: string, qty: number, order: number) => ({
    id, version_id: "rv-slaw-loc", recipe_id: "r-slaw", location_id: LOC, component_sku_id: sku, component_item_id: null,
    component_product_id: null, quantity: qty, unit: "oz", each_container_label: null, portioned: false, display_order: order,
    source_line_id: null,
  });
  t.recipe_version_lines!.push(line("rvl-loc-1", "s-lettuce", 48, 0), line("rvl-loc-2", "s-pickle", 16, 1));
  return t;
}
const skusOf = (rows: Array<{ recipe_id: string; component_sku_id: string | null }>, recipe: string) =>
  rows.filter((r) => r.recipe_id === recipe).map((r) => r.component_sku_id).sort();

describe("the one line resolver", () => {
  it("a shop's version replaces its recipe's rows; the default and other shops keep recipe_inputs", async () => {
    current = createFakeDb(withShopSlaw());
    expect(skusOf(await loadResolvedRecipeInputs(LOC), "r-slaw")).toEqual(["s-lettuce", "s-pickle"]);
    expect(skusOf(await loadResolvedRecipeInputs(OTHER), "r-slaw")).toEqual(["s-lettuce", "s-mayo"]);
    expect(skusOf(await loadResolvedRecipeInputs(null), "r-slaw")).toEqual(["s-lettuce", "s-mayo"]);
  });
  it("with no shop version every scope answers recipe_inputs exactly (same rows)", async () => {
    const t = buildRecipeVersionsFixture();
    current = createFakeDb(t);
    const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();
    expect(ids(await loadResolvedRecipeInputs(LOC))).toEqual(ids(t.recipe_inputs as Array<{ id: string }>));
  });
  it("across scopes = the default's lines plus every live shop version's", async () => {
    current = createFakeDb(withShopSlaw());
    expect(skusOf(await loadRecipeInputsAcrossScopes(), "r-slaw")).toEqual(["s-lettuce", "s-lettuce", "s-mayo", "s-pickle"]);
  });
});

describe("production follows the shop's recipe", () => {
  it("the picker offers pickle → slaw at LOC and mayo → slaw at OTHER", async () => {
    current = createFakeDb(withShopSlaw());
    const atLoc = await loadSkuToItems(["s-mayo", "s-pickle"], LOC);
    expect((atLoc["s-pickle"] ?? []).map((x) => x.itemId)).toContain("i-slaw");
    expect((atLoc["s-mayo"] ?? []).map((x) => x.itemId)).not.toContain("i-slaw");
    const atOther = await loadSkuToItems(["s-mayo", "s-pickle"], OTHER);
    expect((atOther["s-mayo"] ?? []).map((x) => x.itemId)).toContain("i-slaw");
    expect((atOther["s-pickle"] ?? []).map((x) => x.itemId)).not.toContain("i-slaw");
  });
  it("the conversion check refuses what that shop's recipe does not make", async () => {
    current = createFakeDb(withShopSlaw());
    const tryRecord = async (locationId: string, inputSkuId: string) => {
      try {
        await recordProduction(owner, { locationId, inputSkuId, inputQty: 1, outputItemId: "i-slaw", outputQty: 1 });
        return "accepted";
      } catch (e) {
        if (e instanceof ProductionError) return e.code;
        throw e;
      }
    };
    expect(await tryRecord(LOC, "s-mayo")).toBe("invalid_conversion");
    expect(await tryRecord(OTHER, "s-pickle")).toBe("invalid_conversion");
    // …and accepts what it does make (chunk-2 review P3a: the positive case).
    expect(await tryRecord(LOC, "s-pickle")).toBe("accepted");
    expect(await tryRecord(OTHER, "s-mayo")).toBe("accepted");
  });
});

describe("par advisories and readiness follow the shop's recipe", () => {
  it("demand sources: pickle gains a recipe at LOC only; mayo loses its only one at LOC", async () => {
    current = createFakeDb(withShopSlaw());
    const skus = [{ id: "s-mayo", product_id: null }, { id: "s-pickle", product_id: null }];
    const atLoc = await loadDemandSources(getServiceRoleClient(), skus, LOC);
    const atOther = await loadDemandSources(getServiceRoleClient(), skus, OTHER);
    expect(atLoc.activeRefsBySku.get("s-pickle")).toBe((atOther.activeRefsBySku.get("s-pickle") ?? 0) + 1);
    expect(atLoc.activeRefsBySku.get("s-mayo") ?? 0).toBe(0);
    expect(atOther.activeRefsBySku.get("s-mayo")).toBe(1);
  });
  it("readiness reads the scope's lines (the default for null)", async () => {
    current = createFakeDb(withShopSlaw());
    expect(skusOf((await loadGraphRows(LOC)).inputs, "r-slaw")).toEqual(["s-lettuce", "s-pickle"]);
    expect(skusOf((await loadGraphRows(null)).inputs, "r-slaw")).toEqual(["s-lettuce", "s-mayo"]);
  });
});

describe("hub readiness is attributed per scope (lead decision (c), Astra 3a r2#5)", () => {
  it("a shop-only failure is counted once AND says which shop; the default is its own entry", () => {
    const bad: Readiness = { status: "incomplete", reasons: [] };
    const ok: Readiness = { status: "ready", reasons: [] };
    const r = attributeNotReady([
      { scope: null, scopeName: null, recipeReadiness: new Map([["r-slaw", ok], ["r-old", bad]]), itemReadiness: new Map() },
      { scope: LOC, scopeName: "Shop one", recipeReadiness: new Map([["r-slaw", bad], ["r-old", bad]]), itemReadiness: new Map([["i-slaw", bad]]) },
      { scope: OTHER, scopeName: "Shop two", recipeReadiness: new Map([["r-slaw", ok]]), itemReadiness: new Map() },
    ]);
    expect(r.recipes).toBe(2); // r-old and r-slaw, each counted once
    expect(r.items).toBe(1);
    expect(r.byScope).toEqual([
      { scope: null, scopeName: null, recipes: 1, items: 0 },
      { scope: LOC, scopeName: "Shop one", recipes: 2, items: 1 },
    ]);
  });
  it("a shop's item warning lands on THAT shop's registry view, never the default catalog (Astra 3a r4#2)", () => {
    expect(readinessScopeHref("items", "/admin/items", LOC)).toBe(`/admin/items?view=registry&location=${LOC}`);
    expect(readinessScopeHref("recipes", "/admin/recipes", LOC)).toBe(`/admin/recipes?location=${LOC}`);
    expect(readinessScopeHref("items", "/admin/items", null)).toBe("/admin/items?view=registry&location=global");
    expect(itemsLandingView({ location: LOC })).toBe("registry");
    expect(itemsLandingView({})).toBe("catalog");
    expect(itemsLandingView({ view: "catalog", location: LOC })).toBe("catalog");
    expect(readFileSync("app/admin/items/page.tsx", "utf8")).toContain("itemsLandingView({ view: sp.view, location: explicit })");
  });
  it("the recipes and items lists read the scope the hub links to", () => {
    for (const f of ["app/admin/recipes/page.tsx", "app/admin/items/page.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("loadGraphReadiness(auth, scope)");
      expect(src, f).toContain("readiness.scope.shop");
    }
    expect(readFileSync("app/admin/page.tsx", "utf8")).toContain("readiness.hub.where_shop");
  });
});

describe("'used anywhere' answers count every shop", () => {
  it("the SKU usage map lists pickle under the slaw once a shop's slaw uses it", async () => {
    current = createFakeDb(buildRecipeVersionsFixture());
    const before = (await loadSkuUsageMap()).get("s-pickle") ?? [];
    current = createFakeDb(withShopSlaw());
    const after = (await loadSkuUsageMap()).get("s-pickle") ?? [];
    expect(after.length).toBe(before.length + 1);
  });
});

describe("shared reads (chunk-2 review P3c) — the hub reads recipe_inputs ONCE for every scope", () => {
  it("countNotReady: one recipe_inputs read and one SKU list read, however many shops", async () => {
    current = createFakeDb(withShopSlaw());
    const before = current.log.length;
    const { countNotReady } = await import("@/lib/admin/readiness-load");
    const r = await countNotReady(owner);
    const tables = current.log.slice(before).map((q) => q.table);
    expect(tables.filter((t) => t === "recipe_inputs").length).toBe(1);
    expect(tables.filter((t) => t === "recipe_outputs").length).toBe(1);
    expect(r.byScope.length).toBeGreaterThanOrEqual(0);
  });
});
