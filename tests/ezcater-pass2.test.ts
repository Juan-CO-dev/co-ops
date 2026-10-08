import { describe, it, expect } from "vitest";
import { itemIdentity, matchSelection, normalizeOrderCode, orderCodeTokens, probeItemMap, shadowAmounts, type LinkSelection } from "@/lib/ezcater/pass2-shared";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import { normalizeToastOrder } from "@/lib/toast/capture-shared";

const selection: LinkSelection = { location_id: "L", business_date: "2026-10-08", order_guid: "ring", snapshot_id: "snapshot", check_guid: "check", selection_guid: "selection", codes: ["ab-1234"] };
const order = { id: "ez1", location_id: "L", event_date: "2026-10-08", order_number: "AB1234" };
const target = { toast_item_guid: "GUID", toast_item_name: "Salad", item_id: "prep", menu_item_id: null };
const item = { provider_item_uuid: "item", menu_item_size_id: "large", pos_item_id: "guid", name: "Salad" };
const recipes: GraphRecipe[] = [{ recipeId: "recipe", batchYield: 1,
  inputs: [{ componentSkuId: "sku", componentItemId: null, quantity: 4, unit: "oz" }],
  outputs: [{ outputItemId: "prep", outputMenuItemId: null, yield: 1, ozPerParUnit: null }] }];
const graph = buildRecipeGraph(recipes, new Map([["sku", { packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null }]]), new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]]));

describe("ezCater selection identity", () => {
  it("normalizes case and dashes only, requires shop and +/- one business day", () => {
    expect(normalizeOrderCode(" ab-1234 ")).toBe("AB1234");
    expect(matchSelection(selection, [order]).orderId).toBe("ez1");
    expect(matchSelection(selection, [{ ...order, location_id: "other" }]).orderId).toBeNull();
    for (const day of ["2026-10-07", "2026-10-09"]) expect(matchSelection(selection, [{ ...order, event_date: day }]).orderId).toBe("ez1");
    expect(matchSelection(selection, [{ ...order, event_date: "2026-10-10" }]).orderId).toBeNull();
    expect(matchSelection({ ...selection, codes: ["123-456"] }, [{ ...order, order_number: "123456" }]).orderId).toBe("ez1");
    expect(matchSelection({ ...selection, codes: ["abc-def"] }, [{ ...order, order_number: "ABCDEF" }]).orderId).toBe("ez1");
    expect(orderCodeTokens("ezCater #123-456")).toEqual(["123456"]);
  });
  it("refuses ambiguity and permits two different orders on separate selections of one ring", () => {
    expect(matchSelection(selection, [order, { ...order, id: "ez2" }]).reason).toBe("ambiguous_code");
    const orders = [order, { ...order, id: "ez2", order_number: "CD5678" }];
    expect(matchSelection(selection, orders).orderId).toBe("ez1");
    expect(matchSelection({ ...selection, selection_guid: "second", codes: ["cd-5678"] }, orders).orderId).toBe("ez2");
  });
  it("retains bounded code tokens per parent selection without copying free-text notes", () => {
    expect(orderCodeTokens("ezCater AB-1234 call customer")).toEqual(["AB1234"]);
    const captured = normalizeToastOrder({ guid: "ring", businessDate: 20261008, checks: [{ guid: "c", selections: [{ guid: "s", item: { guid: "i" }, quantity: 1, modifiers: [{ guid: "note", selectionType: "SPECIAL_REQUEST", displayName: "ezCater AB-1234" }] }] }] }, "2026-10-08");
    expect(captured.order.selection_units[0]?.ezcater_codes).toEqual(["AB1234"]);
    expect(JSON.stringify(captured)).not.toContain("SPECIAL_REQUEST");
  });
});
describe("ezCater map evidence", () => {
  it("separates sizes and rejects a missing provider identity", () => {
    expect(itemIdentity(item)).not.toBe(itemIdentity({ ...item, menu_item_size_id: "small" }));
    expect(itemIdentity({ ...item, provider_item_uuid: null })).toBeNull();
  });
  it("only exact POS identity confirms; names and collisions go to review", () => {
    expect(probeItemMap(item, [target]).confirmed).toEqual(target);
    expect(probeItemMap({ ...item, pos_item_id: "other" }, [target])).toMatchObject({ confirmed: null, reason: "name_candidate" });
    expect(probeItemMap(item, [target, { ...target, item_id: "other" }])).toMatchObject({ confirmed: null, reason: "ambiguous_pos_guid" });
    expect(probeItemMap({ ...item, name: "unknown", pos_item_id: null }, [target]).reason).toBe("unmapped_item");
  });
});
describe("comparison-only sales fallback", () => {
  it("counts sales until prep is logged, including prep on the previous ET day", () => {
    expect(shadowAmounts(graph, target, 3, "L", "2026-10-08", [])[0]).toMatchObject({ sales_oz: 12, suppressed_oz: 0, shadow_oz: 12 });
    const prep = { location_id: "L", output_item_id: "prep", produced_at: "2026-10-08T01:00:00Z" }; // October 7 ET
    expect(shadowAmounts(graph, target, 3, "L", "2026-10-08", [prep])[0]).toMatchObject({ sales_oz: 12, suppressed_oz: 12, shadow_oz: 0 });
    expect(shadowAmounts(graph, target, 3, "other", "2026-10-08", [prep])[0]?.shadow_oz).toBe(12);
    expect(shadowAmounts(graph, target, 3, "L", "2026-10-09", [prep])[0]?.shadow_oz).toBe(12);
  });
  it("uses ET across winter and DST and rejects invalid quantity", () => {
    expect(shadowAmounts(graph, target, 1, "L", "2026-11-02", [{ location_id: "L", output_item_id: "prep", produced_at: "2026-11-02T04:59:59Z" }])[0]?.shadow_oz).toBe(0);
    expect(() => shadowAmounts(graph, target, NaN, "L", "2026-10-08", [])).toThrow("ezcater_invalid_quantity");
  });
  it("suppresses nested prep only, retaining a menu item's direct raw ingredients", () => {
    const nested = buildRecipeGraph([...recipes, { recipeId: "menu", batchYield: 1,
      inputs: [{ componentSkuId: null, componentItemId: "prep", quantity: 2, unit: null },
        { componentSkuId: "bread", componentItemId: null, quantity: 3, unit: "oz" }],
      outputs: [{ outputItemId: null, outputMenuItemId: "sandwich", yield: 1, ozPerParUnit: null }] }],
    new Map(["sku", "bread"].map((id) => [id, { packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null }])),
    new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]]));
    const rows = shadowAmounts(nested, { item_id: null, menu_item_id: "sandwich" }, 2, "L", "2026-10-08",
      [{ location_id: "L", output_item_id: "prep", produced_at: "2026-10-07T20:00:00Z" }]);
    expect(rows.find((r) => r.sku_id === "bread")).toMatchObject({ sales_oz: 6, shadow_oz: 6 });
    expect(rows.find((r) => r.sku_id === "sku")).toMatchObject({ sales_oz: 16, suppressed_oz: 16, shadow_oz: 0 });
  });
});
