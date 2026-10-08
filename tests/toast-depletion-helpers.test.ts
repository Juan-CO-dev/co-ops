import { describe, it, expect } from "vitest";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import { applyModifierEffect, type ModifierEffect } from "@/lib/toast/modifiers-shared";
import { allocatePackagePicks, evenMixPerOption, selectAssortmentPool } from "@/lib/toast/platter-shared";
import { normalizeOpenItemText, shouldSkipOpenItem, resolveLineTarget } from "@/lib/toast/line-target-shared";

const itemInput = (id: string, quantity: number): GraphRecipe["inputs"][number] => ({
  componentItemId: id, componentSkuId: null, quantity, unit: "each",
});
const recipes: GraphRecipe[] = ["prov", "mozz"].map((id) => ({
  recipeId: id, batchYield: 1, inputs: [],
  outputs: [{ outputItemId: id, outputMenuItemId: null, yield: 1, ozPerParUnit: null }],
}));
recipes.push(...["prov", "mozz", "none"].map((id) => ({
  recipeId: `sub-${id}`, batchYield: 1, inputs: id === "none" ? [] : [itemInput(id, 2)],
  outputs: [{ outputItemId: null, outputMenuItemId: `sub-${id}`, yield: 1, ozPerParUnit: null }],
})));
recipes.push({ recipeId: "bread-parent", batchYield: 2,
  inputs: [{ componentItemId: null, componentSkuId: "roll", quantity: 6, unit: "oz" }],
  outputs: [{ outputItemId: null, outputMenuItemId: "bread-parent", yield: 2, ozPerParUnit: null }],
});
const graph = buildRecipeGraph(recipes, new Map([["roll", {
  packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: 4,
}]]), new Map([
  ["each", { dimension: "count", toBaseFactor: 1 }],
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
]));
const effect = (overrides: Partial<ModifierEffect> = {}): ModifierEffect => ({
  targetKind: "item", targetId: "prov", disposition: "remove", portionQty: 10, portionUnit: "each", parentOnly: true, ...overrides,
});

describe("multi-effect parent isolation", () => {
  it("No Cheese removes each parent's own cheese without consuming another sale's cheese", () => {
    const totals = new Map([["prov", 2], ["mozz", 2]]);
    for (const parent of ["sub-prov", "sub-mozz", "sub-none"]) {
      for (const targetId of ["prov", "mozz"]) {
        const application = applyModifierEffect(graph, effect({ targetId }), parent, 1);
        expect(application.kind).toBe("item");
        if (application.kind === "item") totals.set(targetId, totals.get(targetId)! + application.amount);
      }
    }
    expect([...totals]).toEqual([["prov", 0], ["mozz", 0]]);
  });
  it("GF swap on a parent with no roll adds GF and removes zero bread", () => {
    expect(applyModifierEffect(graph, effect({ targetKind: "sku", targetId: "gf", disposition: "deplete", portionQty: 1 }), "sub-none", 1))
      .toMatchObject({ kind: "sku", portion: { qty: 1, unit: "each" }, sign: 1 });
    expect(applyModifierEffect(graph, effect({ targetKind: "sku", targetId: "roll" }), "sub-none", 1))
      .toMatchObject({ kind: "sku", portion: { qty: 0, unit: "oz" }, sign: -1 });
  });
  it("SKU removal uses parent yield-scaled oz; only non-parent-only effects may fall back", () => {
    expect(applyModifierEffect(graph, effect({ targetKind: "sku", targetId: "roll" }), "bread-parent", 2))
      .toMatchObject({ portion: { qty: 3, unit: "oz" }, qty: 2 });
    expect(applyModifierEffect(graph, effect({ targetKind: "sku", targetId: "roll", parentOnly: false }), "sub-none", 1))
      .toMatchObject({ portion: { qty: 10, unit: "each" } });
  });
  it("parentless parent-only removals are zero and missing add portions are advisory", () => {
    expect(applyModifierEffect(graph, effect(), null, 1)).toMatchObject({ amount: -0, removed: 0 });
    expect(applyModifierEffect(graph, effect({ targetId: "unknown", disposition: "deplete", portionQty: null }), null, 1))
      .toEqual({ kind: "portion_needed" });
    expect(applyModifierEffect(graph, effect({ targetKind: "sku", disposition: "deplete", portionQty: null }), null, 1))
      .toEqual({ kind: "portion_needed" });
    expect(applyModifierEffect(graph, effect({ targetKind: "sku", targetId: "roll", portionQty: null }), "bread-parent", 1))
      .toMatchObject({ kind: "sku", portion: { qty: 3, unit: "oz" } });
    expect(applyModifierEffect(graph, effect({ portionQty: null }), "sub-prov", 1))
      .toMatchObject({ kind: "item", amount: -2 });
  });
  it("keeps explicit ignore and half-sub defaults", () => {
    expect(applyModifierEffect(graph, effect({ disposition: "ignore" }), null, 2)).toEqual({ kind: "ignored" });
    expect(applyModifierEffect(graph, effect({ targetKind: "menu_item", disposition: "deplete", portionQty: null }), null, 2))
      .toMatchObject({ amount: 1, removed: 0 });
  });
});

describe("named package picks", () => {
  const slots = [
    { id: "first", quantity: 4, depletionQty: 4, displayOrder: 1, menuItemIds: ["a", "both"] },
    { id: "second", quantity: 2, depletionQty: 2, displayOrder: 2, menuItemIds: ["b", "both"] },
  ];
  it("binds two pools independently and resolves overlaps to display_order", () => {
    const result = allocatePackagePicks(slots.slice().reverse(), [
      { id: "p1", menuItemId: "a", qty: 2 }, { id: "p2", menuItemId: "b", qty: 1 },
      { id: "p3", menuItemId: "both", qty: 1 }, { id: "unknown", menuItemId: "other", qty: 1 },
    ], 1);
    expect(result.bySlot.get("first")).toEqual({ picks: [{ menuItemId: "a", units: 2 }, { menuItemId: "both", units: 1 }], remaining: 1, excess: false });
    expect(result.bySlot.get("second")?.remaining).toBe(1);
    expect([...result.consumed]).toEqual(["p1", "p2", "p3"]);
  });
  it("drops excess in ledger order, even after the cap is exhausted", () => {
    const result = allocatePackagePicks(slots, [
      { id: "p1", menuItemId: "a", qty: 3 }, { id: "p2", menuItemId: "both", qty: 3 }, { id: "p3", menuItemId: "a", qty: 1 },
    ], 1);
    expect(result.bySlot.get("first")).toEqual({ picks: [{ menuItemId: "a", units: 3 }, { menuItemId: "both", units: 1 }], remaining: 0, excess: true });
    expect(result.consumed.size).toBe(3);
  });
  it("scales Light Lunch picks separately from customer quantity and multiplies the cap by sales", () => {
    const result = allocatePackagePicks([{ ...slots[0]!, quantity: 1, depletionQty: 0.5 }], [{ id: "p", menuItemId: "a", qty: 1 }], 2);
    expect(result.bySlot.get("first")).toEqual({ picks: [{ menuItemId: "a", units: 0.5 }], remaining: 0.5, excess: false });
  });
  it("named picks may use the full pool while assortment fills only the remainder", () => {
    const options = [{ id: "a", classic: false }, { id: "both", classic: true }];
    const result = allocatePackagePicks(slots, [{ id: "p", menuItemId: "a", qty: 1 }], 1);
    const remaining = result.bySlot.get("first")!.remaining;
    expect(selectAssortmentPool(options, "classics").map((o) => [o.id, evenMixPerOption(remaining, 1)]))
      .toEqual([["both", 3]]);
  });
  it("no picks gives byte-identical spread arithmetic", () => {
    const result = allocatePackagePicks(slots, [], 3);
    const previous = slots.map((s) => evenMixPerOption(s.quantity * 3, s.menuItemIds.length));
    const current = slots.map((s) => evenMixPerOption(result.bySlot.get(s.id)!.remaining, s.menuItemIds.length));
    expect(JSON.stringify(current)).toBe(JSON.stringify(previous));
    expect(result.consumed.size).toBe(0);
  });
});

describe("dual-role resolution", () => {
  it("uses item/sku deplete modifier maps for parentless bases", () => {
    for (const targetKind of ["item", "sku"] as const) {
      const modifier = effect({ disposition: "deplete", targetKind });
      expect(resolveLineTarget(false, undefined, modifier)).toEqual({ kind: "modifier", effect: modifier });
    }
    expect(resolveLineTarget(false, undefined, effect())).toBeNull();
    expect(resolveLineTarget(false, undefined, effect({ disposition: "deplete", targetKind: "menu_item" }))).toBeNull();
  });
  it("uses whole item/menu units for modifier misses, excluding packages", () => {
    for (const kind of ["item", "menu_item"] as const) {
      const base = { kind, id: "drink" };
      expect(resolveLineTarget(true, base, undefined)).toEqual({ kind: "base", target: base });
    }
    expect(resolveLineTarget(true, { kind: "package", id: "box" }, undefined)).toBeNull();
  });
  it("explicit primary-role rows always win, including ignore", () => {
    const base = { kind: "item" as const, id: "drink" };
    const modifier = effect({ disposition: "ignore" });
    expect(resolveLineTarget(false, base, modifier)).toEqual({ kind: "base", target: base });
    expect(resolveLineTarget(true, base, modifier)).toEqual({ kind: "modifier", effect: modifier });
  });
});

describe("open-item text", () => {
  it.each([
    ["  BIG  Chips! ", "big chip"], ["chioz", "chip"], ["crewm soda", "cream soda"],
    ["proscuitto", "prosciutto"], ["cstering", "catering"], ["Kid's", "kid"],
    ["Utz Salt & Pepper Chips", "utz salt pepper chip"], ["", ""],
  ])("normalizes %s", (raw, normalized) => expect(normalizeOpenItemText(raw)).toBe(normalized));
  it.each(["abc-123", " A1B-2c3 ", "Catering Order", "cstering", "10/13/2026", "2026-10-13", "10/13"])("skips %s", (raw) => {
    expect(shouldSkipOpenItem(raw)).toBe(true);
  });
  it.each(["bread", "abc123", "12 chips", "10/13 chips", "hp mayo"])("does not hide %s", (raw) => {
    expect(shouldSkipOpenItem(raw)).toBe(false);
  });
});
