import { describe, expect, it } from "vitest";
import {
  STORE_RUN_PROMOTION_STREAK, productInputBasis, resolveProductMember,
  storeRunReceiptStreak, type ProductMember, type ProductReceiptEvent,
} from "@/lib/products-shared";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import { rollupMenuItemCost } from "@/lib/menu-costing-shared";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";

const regular: ProductMember = {
  skuId: "regular", vendorId: "vendor", vendorName: "Vendor", sourceKind: "vendor",
  active: true, avgOzPerEach: 8, lastReceivedAt: "2026-10-01T12:00:00Z",
};
const store: ProductMember = {
  ...regular, skuId: "a-store", vendorId: "store", vendorName: "Store", sourceKind: "store",
  hasOzBasis: true, lastReceivedAt: "2026-10-07T12:00:00Z",
};
const resolve = (streak: number, members = [regular, store], primarySkuId: string | null = null) =>
  resolveProductMember({ productId: "product", active: true, primarySkuId, members, storeRunStreak: streak });
const receipt = (id: string, day: number, sourceKind: "vendor" | "store" = "store", locationId = "shop"): ProductReceiptEvent => ({
  receiptId: id, receivedAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`, sourceKind, locationId,
});

describe("store receipt promotion through the single product resolver", () => {
  it.each([0, 2, 3])("applies the threshold at streak %i on the recent rung", (streak) => {
    expect(STORE_RUN_PROMOTION_STREAK).toBe(3);
    expect(resolve(streak)).toMatchObject({ skuId: streak < 3 ? regular.skuId : store.skuId, rung: "recent" });
  });
  it.each([0, 2, 3])("also gates the fallback rung at streak %i", (streak) => {
    const members = [regular, store].map((m) => ({ ...m, lastReceivedAt: null }));
    expect(resolve(streak, members)).toMatchObject({ skuId: streak < 3 ? regular.skuId : store.skuId, rung: "any" });
  });
  it("a designated store primary cannot bypass the promotion threshold", () => {
    expect(resolve(2, [regular, store], store.skuId).skuId).toBe(regular.skuId);
    expect(resolve(3, [regular, store], store.skuId)).toMatchObject({ skuId: store.skuId, rung: "primary" });
  });
  it("a designated active regular primary stays primary after promotion", () => {
    expect(resolve(3, [regular, store], regular.skuId)).toMatchObject({ skuId: regular.skuId, rung: "primary" });
  });
  it("allows an ounce-backed store member immediately when the regular vendor is down", () => {
    expect(resolve(0, [{ ...regular, active: false }, store], regular.skuId).skuId).toBe(store.skuId);
    expect(resolve(0, [store]).skuId).toBe(store.skuId);
  });
  it.each([
    { pendingReview: true, hasOzBasis: true },
    { pendingReview: false, hasOzBasis: false },
    { pendingReview: false, hasOzBasis: undefined },
  ])("never resolves a pending or unweighed store member even with no regular member: %j", (flags) => {
    expect(resolve(3, [{ ...store, ...flags }], store.skuId)).toMatchObject({ skuId: null, rung: "unresolved" });
  });
  it("omitting location streak data conservatively keeps regular supply", () => {
    expect(resolveProductMember({ productId: "product", active: true, primarySkuId: null, members: [regular, store] }).skuId).toBe(regular.skuId);
  });
});

describe("product receipt streaks", () => {
  it("a regular receipt from any member resets promotion and three later store receipts restore it", () => {
    // Events have already been grouped by PRODUCT, never by reference SKU.
    const history = [receipt("store-1", 1), receipt("store-2", 2), receipt("store-3", 3)];
    expect(resolve(storeRunReceiptStreak(history, "shop")).skuId).toBe(store.skuId);
    history.push(receipt("other-regular-member", 4, "vendor"));
    expect(storeRunReceiptStreak(history, "shop")).toBe(0);
    expect(resolve(storeRunReceiptStreak(history, "shop")).skuId).toBe(regular.skuId);
    history.push(receipt("store-4", 5), receipt("store-5", 6));
    expect(storeRunReceiptStreak(history, "shop")).toBe(2);
    expect(resolve(storeRunReceiptStreak(history, "shop")).skuId).toBe(regular.skuId);
    history.push(receipt("store-6", 7));
    expect(resolve(storeRunReceiptStreak(history, "shop")).skuId).toBe(store.skuId);
  });
  it("counts receipts once despite several member lines and isolates locations", () => {
    const events = [receipt("same-receipt", 4), receipt("same-receipt", 4), receipt("second", 5),
      receipt("foreign", 7, "vendor", "other-shop"), receipt("foreign-store", 8, "store", "other-shop")];
    expect(storeRunReceiptStreak(events, "shop")).toBe(2);
    expect(storeRunReceiptStreak(events, "other-shop")).toBe(1);
    expect(storeRunReceiptStreak(events, "unknown-shop")).toBe(0);
  });
  it("does not let row order or an equal-time store receipt override a regular reset", () => {
    const events = [receipt("store", 7), receipt("regular", 7, "vendor"), receipt("earlier", 6)];
    expect(storeRunReceiptStreak(events, "shop")).toBe(0);
    expect(storeRunReceiptStreak([...events].reverse(), "shop")).toBe(0);
  });
});

describe("store prices reach product-pinned recipe costing only after promotion", () => {
  const pack: RecipeInputSku = { packFormat: null, eachContainerLabel: null, unitsPerPack: 1,
    eachSize: 8, eachMeasure: "oz", avgOzPerEach: 8 };
  const measures = new Map<string, MeasureUnitFactor>([["oz", { dimension: "weight", toBaseFactor: 1 }]]);
  const recipes: GraphRecipe[] = [
    { recipeId: "product-recipe", batchYield: 1,
      inputs: [{ quantity: 4, unit: "oz", componentSkuId: null, componentItemId: null, componentProductId: "product" }],
      outputs: [{ outputMenuItemId: "product-menu", outputItemId: null, yield: 1, ozPerParUnit: null }] },
    { recipeId: "sku-recipe", batchYield: 1,
      inputs: [{ quantity: 4, unit: "oz", componentSkuId: regular.skuId, componentItemId: null }],
      outputs: [{ outputMenuItemId: "sku-menu", outputItemId: null, yield: 1, ozPerParUnit: null }] },
  ];
  it.each([0, 2, 3])("costs through the resolved SKU at streak %i while explicit SKU pins stay unchanged", (streak) => {
    const resolution = resolve(streak);
    const member = [regular, store].find((m) => m.skuId === resolution.skuId) ?? null;
    const graph = buildRecipeGraph(recipes, new Map([[regular.skuId, pack], [store.skuId, pack]]), measures, {
      resolution: new Map([["product", resolution]]),
      basis: new Map([["product", productInputBasis({ productId: "product", unitOz: 8 }, member)]]),
    });
    // Prices are both recorded/visible: regular $0.50/oz, store $0.75/oz.
    const prices = new Map([[regular.skuId, 0.5], [store.skuId, 0.75]]);
    expect(rollupMenuItemCost(graph, "product-menu", prices)).toMatchObject({ status: "costed", cost: streak < 3 ? 2 : 3 });
    expect(rollupMenuItemCost(graph, "sku-menu", prices)).toMatchObject({ status: "costed", cost: 2 });
  });
});
