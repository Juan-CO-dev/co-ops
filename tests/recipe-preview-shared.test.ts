/** Catalog Phase 3b — "What this changes" (pure): sandwich deltas, the line text, the menu preview, the tokens. */
import { describe, expect, it } from "vitest";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";
import { costPerOzFromGraph } from "@/lib/menu-costing-shared";
import {
  lineText, menuCostDeltas, menuPreviewMath, menuPreviewToken, menuPromoteChangedShops, menuPromoteNames, normalizeMenuPatch,
  recipePreviewToken, MENU_PROMOTE_NAME_KEYS,
} from "@/lib/catalog/recipe-preview-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const measures = new Map<string, MeasureUnitFactor>([["oz", { dimension: "weight", toBaseFactor: 1 }]]);
const turkey: RecipeInputSku = { packFormat: "case", eachContainerLabel: null, unitsPerPack: 1, eachSize: 160, eachMeasure: "oz", avgOzPerEach: null };
const recipe = (qty: number): GraphRecipe => ({
  recipeId: "r", batchYield: 1,
  inputs: [{ quantity: qty, unit: "oz", componentSkuId: "turkey", componentItemId: null }],
  outputs: [{ outputItemId: null, outputMenuItemId: "m-italian", yield: 1, ozPerParUnit: null }],
});
const side = (): GraphRecipe => ({
  recipeId: "s", batchYield: 1,
  inputs: [{ quantity: 1, unit: "oz", componentSkuId: "turkey", componentItemId: null }],
  outputs: [{ outputItemId: null, outputMenuItemId: "m-side", yield: 1, ozPerParUnit: null }],
});
const prices = new Map([["turkey", 80]]); // $80 / 160 oz = $0.50 / oz

describe("menuCostDeltas — only the sandwiches that move", () => {
  const names = new Map([["m-italian", { name: "Italian", nameEs: "Italiano" }], ["m-side", { name: "Side", nameEs: null }]]);
  it("the Italian goes $2.00 → $2.50; the side does not move and is left out", () => {
    const before = buildRecipeGraph([recipe(4), side()], new Map([["turkey", turkey]]), measures);
    const after = buildRecipeGraph([recipe(5), side()], new Map([["turkey", turkey]]), measures);
    const d = menuCostDeltas(["m-italian", "m-side"], names,
      { graph: before, costPerOz: costPerOzFromGraph(before, prices) }, { graph: after, costPerOz: costPerOzFromGraph(after, prices) });
    expect(d).toEqual([{ menuItemId: "m-italian", name: "Italian", nameEs: "Italiano", before: 2, after: 2.5, statusBefore: "costed", statusAfter: "costed" }]);
  });
  it("a costing STATUS change is a move even when no cost can be shown (a price disappears)", () => {
    const g = buildRecipeGraph([recipe(4)], new Map([["turkey", turkey]]), measures);
    const d = menuCostDeltas(["m-italian"], names, { graph: g, costPerOz: costPerOzFromGraph(g, prices) }, { graph: g, costPerOz: costPerOzFromGraph(g, new Map()) });
    expect(d).toHaveLength(1);
    expect(d[0]!.before).toBe(2);
    expect(d[0]!.statusAfter).not.toBe(d[0]!.statusBefore);
  });
  it("nothing moves → nothing listed", () => {
    const g = buildRecipeGraph([recipe(4), side()], new Map([["turkey", turkey]]), measures);
    const c = { graph: g, costPerOz: costPerOzFromGraph(g, prices) };
    expect(menuCostDeltas(["m-italian", "m-side"], names, c, c)).toEqual([]);
  });
});

describe("lineText — a line in plain words", () => {
  it("name, amount, unit; a missing name falls back to the key", () => {
    const names = { "sku:turkey": "Turkey" };
    expect(lineText({ componentSkuId: "turkey", componentItemId: null, componentProductId: null, quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false }, names, (n) => String(n))).toBe("Turkey 4 oz");
    expect(lineText({ componentSkuId: "ham", componentItemId: null, componentProductId: null, quantity: 1, unit: null, eachContainerLabel: null, portioned: false }, names, (n) => String(n))).toBe("sku:ham 1");
  });
});

describe("menuPreviewMath — price and margin before and after", () => {
  it("a shop price on a $1.80 cost", () => {
    expect(menuPreviewMath({ before: 12.5, after: 13.5, cost: 1.8 })).toEqual({ marginBefore: 10.7, marginAfter: 11.7 });
    expect(menuPreviewMath({ before: null, after: 13.5, cost: null })).toEqual({ marginBefore: null, marginAfter: null });
    expect(menuPreviewMath({ before: null, after: 13.5, cost: 1.8 })).toEqual({ marginBefore: null, marginAfter: 11.7 });
  });
});

describe("normalizeMenuPatch — what a menu token binds is what the writer stores (Astra 3b r4#2)", () => {
  it("blank names are inherit (null); text is trimmed; price and sold-here pass through", () => {
    expect(normalizeMenuPatch({ price: 13.5, soldHere: false, nameOverride: "  Big Italian ", nameOverrideEs: "  " }))
      .toEqual({ price: 13.5, soldHere: false, nameOverride: "Big Italian", nameOverrideEs: null });
  });
});

describe("menuPromoteChangedShops — field by field (Astra 3b r1#4)", () => {
  const shops = [{ id: "A", name: "A" }, { id: "B", name: "B" }, { id: "C", name: "C" }, { id: "S", name: "Src" }];
  it("promoting price AND name: a shop with its own price but the default name still changes", () => {
    const live = [{ location_id: "B", price: 14, name_override: null }, { location_id: "C", price: 14, name_override: "Mine" }, { location_id: "S", price: 13, name_override: "New" }];
    expect(menuPromoteChangedShops({ shops, sourceShopId: "S", fields: ["price", "name"], live })).toEqual([{ shopId: "A", shopName: "A" }, { shopId: "B", shopName: "B" }]);
    expect(menuPromoteChangedShops({ shops, sourceShopId: "S", fields: ["price"], live }).map((c) => c.shopId)).toEqual(["A"]);
    expect(menuPromoteChangedShops({ shops, sourceShopId: "S", fields: ["name"], live }).map((c) => c.shopId)).toEqual(["A", "B"]);
  });
});

describe("menuPromoteNames — the Spanish result, truthfully (CC note 1 #2: the promote copies the shop's name pair EXACTLY)", () => {
  const global = { name: "Italian", nameEs: "Italiano" };
  it("a full pair is copied as it is", () => {
    expect(menuPromoteNames({ fields: ["name"], global, source: { nameOverride: "Big Italian", nameOverrideEs: "Italiano grande" }, typedNameEs: null }))
      .toEqual({ before: { name: "Italian", nameEs: "Italiano" }, after: { name: "Big Italian", nameEs: "Italiano grande" }, spanishFallsBackToEnglish: false });
  });
  it("an English-only rename leaves NO Spanish name — the old one is never resurrected; Spanish users see the English name", () => {
    expect(menuPromoteNames({ fields: ["name"], global, source: { nameOverride: "Big Italian", nameOverrideEs: null }, typedNameEs: null }))
      .toEqual({ before: { name: "Italian", nameEs: "Italiano" }, after: { name: "Big Italian", nameEs: null }, spanishFallsBackToEnglish: true });
  });
  it("the optional Spanish name field fills it in the same step (blank = not typed)", () => {
    expect(menuPromoteNames({ fields: ["name"], global, source: { nameOverride: "Big Italian", nameOverrideEs: null }, typedNameEs: "  Italiano grande " }).after)
      .toEqual({ name: "Big Italian", nameEs: "Italiano grande" });
    expect(menuPromoteNames({ fields: ["name"], global, source: { nameOverride: "Big Italian", nameOverrideEs: null }, typedNameEs: "   " }).spanishFallsBackToEnglish).toBe(true);
  });
  it("a price-only promote leaves both names as they are (and says when the default already has no Spanish name)", () => {
    expect(menuPromoteNames({ fields: ["price"], global, source: { nameOverride: "Big Italian", nameOverrideEs: null }, typedNameEs: "ignored" }))
      .toEqual({ before: global, after: global, spanishFallsBackToEnglish: false });
    expect(menuPromoteNames({ fields: ["price"], global: { name: "Italian", nameEs: null }, source: { nameOverride: null, nameOverrideEs: null }, typedNameEs: null }).spanishFallsBackToEnglish).toBe(true);
  });
  it("its two strings exist in en AND es, the fallback says it in plain words", () => {
    const enMap = en as Record<string, string>;
    const esMap = es as Record<string, string>;
    for (const k of MENU_PROMOTE_NAME_KEYS) {
      expect(enMap[k], k).toBeTruthy();
      expect(esMap[k], k).toBeTruthy();
      expect(esMap[k], k).not.toBe(enMap[k]);
    }
    expect(enMap["catalog.menu.preview.name_es_fallback"]).toBe("Spanish users will see the English name until you add one.");
  });
});

describe("tokens — the same preview, the same token; any difference, another", () => {
  it("recipe and menu", () => {
    const a = { kind: "lines", recipeId: "r", target: { kind: "global" }, expected: "v1", basedOn: null, lines: [1], reached: ["a"], untouched: ["b"] };
    expect(recipePreviewToken(a)).toBe(recipePreviewToken({ ...a }));
    expect(recipePreviewToken(a)).not.toBe(recipePreviewToken({ ...a, untouched: [] }));
    expect(menuPreviewToken({ x: 1 })).toBe(menuPreviewToken({ x: 1 }));
    expect(menuPreviewToken({ x: 1 })).not.toBe(menuPreviewToken({ x: 2 }));
    // the two kinds never collide on the same parts
    expect(recipePreviewToken({ x: 1 })).not.toBe(menuPreviewToken({ x: 1 }));
  });
});
