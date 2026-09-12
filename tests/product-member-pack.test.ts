import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * LRA-231 (2026-09-11): a product-pinned recipe line resolves to ONE member SKU and the
 * flatten emits that SKU id as the leaf — but loadRecipeGraph only hydrated pack data for
 * SKUs recipes name directly, so the member's pack never reached graph.skuPack and the
 * menu costing board priced every deli sub as "unpriced" while Turkey carried a real
 * price and a real 148 oz piece. The graph must hydrate the resolved member too.
 */
const source = readFileSync("lib/prep-consumption.ts", "utf8");
const fn = source.slice(source.indexOf("export async function loadRecipeGraph("), source.indexOf("export async function perUnitSkuOzForItem("));

describe("LRA-231: the recipe graph hydrates pack data for resolved product members", () => {
  it("collects the resolved member SKU ids from the product index after the parallel loads", () => {
    expect(fn).toContain("productIndex.index.resolution.values()");
    expect(fn).toMatch(/\.map\(\(r\) => r\.skuId\)/);
    expect(fn).toContain("!skuPack.has(id)");
  });
  it("loads those packs with the same loader and merges them into the graph's skuPack before build", () => {
    const merge = fn.indexOf("await loadSkuPack(memberIds)");
    const build = fn.indexOf("buildRecipeGraph(recipes, skuPack, measures, productIndex.index)");
    expect(merge).toBeGreaterThan(0);
    expect(build).toBeGreaterThan(merge);
    expect(fn).toContain("skuPack.set(id, pack)");
  });
  it("the flatten still emits the resolved member id as the leaf (the asymmetry this closes)", () => {
    const graph = readFileSync("lib/prep-consumption-graph.ts", "utf8");
    expect(graph).toContain("return { skuId: res.skuId, oz };");
  });
});
