/** Catalog Phase 1 — the recipe LINE (one recipe_inputs row), pure surface. */
import { describe, expect, it } from "vitest";
import {
  diffRecipeLine,
  lineDraftFromView,
  lineFromRow,
  lineSnapshotFromView,
  beginLineEdit,
  lineToRow,
  lineUnitChoices,
  normalizeRecipeLine,
  parseRecipeLineEdit,
  parseRecipeLinePatch,
  parseRecipeLineSnapshot,
  recipeLineKind,
  type RecipeLineFields,
} from "@/lib/recipe-line-shared";
import type { RecipeInputView } from "@/lib/recipes-shared";

const sku = (over: Partial<RecipeLineFields> = {}): RecipeLineFields => ({
  componentSkuId: "sku-ham", componentItemId: null, componentProductId: null,
  quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false, ...over,
});
const view = (over: Partial<RecipeInputView> = {}): RecipeInputView => ({
  id: "line-1", componentSkuId: "sku-ham", componentItemId: null, componentProductId: null,
  componentName: "Ham", kind: "sku", componentRetired: false, quantity: 4, unit: " oz ",
  eachContainerLabel: null, portioned: false, displayOrder: 1, ...over,
});

describe("parseRecipeLinePatch — the wire shape of one whole NEW line", () => {
  it("accepts a SKU line and normalises its text", () => {
    expect(parseRecipeLinePatch({ componentSkuId: " sku-1 ", quantity: 4, unit: " oz ", eachContainerLabel: "", portioned: true }))
      .toEqual({ ok: true, line: { componentSkuId: "sku-1", componentItemId: null, componentProductId: null, quantity: 4, unit: "oz", eachContainerLabel: null, portioned: true } });
  });

  it("an item line never carries a container label or portioned", () => {
    expect(parseRecipeLinePatch({ componentItemId: "item-1", quantity: 2, unit: "qt", eachContainerLabel: "bag", portioned: true }))
      .toEqual({ ok: true, line: { componentSkuId: null, componentItemId: "item-1", componentProductId: null, quantity: 2, unit: "qt", eachContainerLabel: null, portioned: false } });
  });

  it("a product line needs a unit (WHICH units is the server's measure-registry check)", () => {
    expect(parseRecipeLinePatch({ componentProductId: "p-1", quantity: 3 })).toEqual({ ok: false, code: "product_line_needs_measure_unit" });
  });

  it("exactly one target; quantity a positive finite NUMBER; typed fields", () => {
    expect(parseRecipeLinePatch({ quantity: 1 })).toEqual({ ok: false, code: "invalid_component" });
    expect(parseRecipeLinePatch({ componentSkuId: "a", componentItemId: "b", quantity: 1 })).toEqual({ ok: false, code: "invalid_component" });
    for (const quantity of ["4", 0, -1, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(parseRecipeLinePatch({ componentSkuId: "a", quantity })).toEqual({ ok: false, code: "invalid_quantity" });
    }
    for (const raw of [null, [], "x", { componentSkuId: 5, quantity: 1 }, { componentSkuId: "  ", quantity: 1 },
      { componentSkuId: "a", quantity: 1, unit: 3 }, { componentSkuId: "a", quantity: 1, portioned: "yes" }]) {
      expect(parseRecipeLinePatch(raw)).toEqual({ ok: false, code: "invalid_payload" });
    }
  });
});

describe("the EXPECTED line (compare-and-set, Astra r1 P2-4)", () => {
  it("a snapshot keeps text RAW — it must equal the stored value byte for byte", () => {
    expect(parseRecipeLineSnapshot({ componentSkuId: "sku-ham", quantity: 4, unit: " oz ", eachContainerLabel: null, portioned: false }))
      .toEqual(sku({ unit: " oz " }));
  });

  it("a snapshot of a legacy product line without a unit is still a snapshot", () => {
    expect(parseRecipeLineSnapshot({ componentProductId: "p-1", quantity: 1, unit: null, portioned: true }))
      .toEqual({ componentSkuId: null, componentItemId: null, componentProductId: "p-1", quantity: 1, unit: null, eachContainerLabel: null, portioned: true });
  });

  it("a malformed snapshot is null", () => {
    for (const raw of [null, [], {}, { componentSkuId: "a", componentItemId: "b", quantity: 1 }, { componentSkuId: "a", quantity: 0 }, { componentSkuId: "a", quantity: 1, portioned: "x" }]) {
      expect(parseRecipeLineSnapshot(raw)).toBeNull();
    }
  });

  it("parseRecipeLineEdit needs both halves", () => {
    expect(parseRecipeLineEdit({ line: { componentSkuId: "sku-ham", quantity: 5, unit: "oz" }, expected: { componentSkuId: "sku-ham", quantity: 4, unit: " oz " } }))
      .toEqual({ ok: true, line: sku({ quantity: 5 }), expected: sku({ unit: " oz " }) });
    expect(parseRecipeLineEdit({ line: { componentSkuId: "sku-ham", quantity: 5 } })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeLineEdit({ line: { quantity: 5 }, expected: {} })).toEqual({ ok: false, code: "invalid_component" });
    expect(parseRecipeLineEdit(null)).toEqual({ ok: false, code: "invalid_payload" });
  });

  it("view → snapshot is raw; view → draft is normalised", () => {
    expect(lineSnapshotFromView(view())).toEqual(sku({ unit: " oz " }));
    expect(lineDraftFromView(view())).toEqual({ ...sku(), componentName: "Ham" });
  });

  it("beginLineEdit captures BOTH halves at the moment editing begins (Astra r2 #1)", () => {
    const started = beginLineEdit(view());
    // The page refreshes mid-edit: another manager swapped the ingredient. The capture must not follow.
    const refreshed = view({ componentSkuId: "sku-turkey", componentName: "Turkey" });
    expect(refreshed.componentSkuId).toBe("sku-turkey");
    expect(started).toEqual({ id: "line-1", initial: { ...sku(), componentName: "Ham" }, expected: sku({ unit: " oz " }) });
  });
});

describe("row ↔ line, normalise, diff, kind", () => {
  it("lineFromRow reads numeric strings and blank text the way the column stores them", () => {
    expect(lineFromRow({ component_sku_id: "sku-ham", component_item_id: null, component_product_id: null, quantity: "4", unit: " oz ", each_container_label: "", portioned: null }))
      .toEqual(sku());
  });

  it("lineToRow is the exact column patch", () => {
    expect(lineToRow(sku({ quantity: 5 }))).toEqual({
      component_sku_id: "sku-ham", component_item_id: null, component_product_id: null,
      quantity: 5, unit: "oz", each_container_label: null, portioned: false,
    });
  });

  it("normalizeRecipeLine trims text only", () => {
    expect(normalizeRecipeLine(sku({ unit: " oz ", eachContainerLabel: "  " }))).toEqual(sku());
  });

  it("diffRecipeLine names exactly the fields that moved", () => {
    expect(diffRecipeLine(sku(), sku())).toEqual([]);
    expect(diffRecipeLine(sku(), sku({ quantity: 5, unit: "lb" }))).toEqual(["quantity", "unit"]);
    expect(diffRecipeLine(sku(), sku({ componentSkuId: null, componentProductId: "p-1" }))).toEqual(["componentSkuId", "componentProductId"]);
  });

  it("recipeLineKind follows the one non-null target", () => {
    expect(recipeLineKind(sku())).toBe("sku");
    expect(recipeLineKind(sku({ componentSkuId: null, componentItemId: "i" }))).toBe("item");
    expect(recipeLineKind(sku({ componentSkuId: null, componentProductId: "p" }))).toBe("product");
  });
});

describe("lineUnitChoices — the server's unit rules, offered up front", () => {
  const pack = { packFormat: "case", eachContainerLabel: "bag", eachMeasure: "lb" };
  const measures = ["each", "gal", "lb", "oz"];

  it("a PRODUCT line offers every active measure-registry unit and never a vendor's pack label", () => {
    expect(lineUnitChoices("product", pack, measures, "case")).toEqual(["each", "gal", "lb", "oz"]);
  });

  it("a SKU line keeps its own unit first, then its pack labels, then the measures, without duplicates", () => {
    expect(lineUnitChoices("sku", pack, measures, "log")).toEqual(["log", "case", "bag", "lb", "each", "gal", "oz"]);
    expect(lineUnitChoices("sku", { packFormat: " ", eachContainerLabel: null, eachMeasure: null }, measures, null)).toEqual(["each", "gal", "lb", "oz"]);
  });

  it("a prep-item line keeps its free-text unit (null = no list)", () => {
    expect(lineUnitChoices("item", null, measures, "qt")).toBeNull();
  });
});
