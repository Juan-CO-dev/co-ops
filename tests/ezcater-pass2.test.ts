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
  it("accepts late codes only two through seven days AFTER the event", () => {
    for (const date of ["2026-10-01", "2026-10-06"]) {
      expect(matchSelection(selection, [{ ...order, event_date: date }])).toMatchObject({ orderId: "ez1", reason: "late_code" });
    }
    for (const date of ["2026-09-30", "2026-10-10", "2026-10-15"]) {
      expect(matchSelection(selection, [{ ...order, event_date: date }]).orderId).toBeNull();
    }
    expect(matchSelection(selection, [order, { ...order, id: "late", event_date: "2026-10-06" }]))
      .toMatchObject({ orderId: "ez1", reason: "normalized_code" });
    expect(matchSelection(selection, [{ ...order, event_date: "2026-10-06" }, { ...order, id: "duplicate", event_date: "2026-10-05" }]).reason).toBe("ambiguous_code");
  });
  it("retains bounded code tokens per parent selection without copying free-text notes", () => {
    expect(orderCodeTokens("ezCater AB-1234 call customer")).toEqual(["AB1234"]);
    const captured = normalizeToastOrder({ guid: "ring", businessDate: 20261008, checks: [{ guid: "c", selections: [{ guid: "s", item: { guid: "i" }, quantity: 1, modifiers: [{ guid: "note", selectionType: "SPECIAL_REQUEST", displayName: "ezCater AB-1234" }] }] }] }, "2026-10-08");
    expect(captured.order.selection_units[0]).not.toHaveProperty("ezcater_codes");
    expect(JSON.stringify(captured)).not.toContain("AB1234");
    expect(JSON.stringify(captured)).not.toContain("SPECIAL_REQUEST");
  });
});
describe("ezCater map evidence", () => {
  it("keys customization IDs and quantities deterministically, never display names", () => {
    const a = { customizationId: "a", quantity: 1, name: "first" };
    const b = { customizationId: "b", quantity: 2, name: "second" };
    expect(itemIdentity({ ...item, options: [a, b] })).toBe(itemIdentity({ ...item, options: [b, { ...a, name: "renamed" }] }));
    expect(itemIdentity({ ...item, options: [a] })).not.toBe(itemIdentity({ ...item, options: [b] }));
    expect(itemIdentity({ ...item, options: [a] })).not.toBe(itemIdentity({ ...item, options: [{ ...a, quantity: 2 }] }));
    expect(itemIdentity({ ...item, options: [{ name: "no stable ID" }] })).toBeNull();
  });
  it("uses stable size identity across lines and rejects a missing size", () => {
    expect(itemIdentity(item)).not.toBe(itemIdentity({ ...item, menu_item_size_id: "small" }));
    expect(itemIdentity({ ...item, provider_item_uuid: null })).toBe(itemIdentity(item));
    expect(itemIdentity({ ...item, provider_item_uuid: "different-line" })).toBe(itemIdentity(item));
    expect(itemIdentity({ ...item, menu_item_size_id: null })).toBeNull();
  });
  it("only exact POS identity confirms; names and collisions go to review", () => {
    expect(probeItemMap(item, [target]).confirmed).toEqual(target);
    expect(probeItemMap({ ...item, pos_item_id: "other" }, [target])).toMatchObject({ confirmed: null, reason: "name_candidate" });
    expect(probeItemMap(item, [target, { ...target, item_id: "other" }])).toMatchObject({ confirmed: null, reason: "ambiguous_pos_guid" });
    expect(probeItemMap({ ...item, name: "unknown", pos_item_id: null }, [target]).reason).toBe("unmapped_item");
  });
});
describe("comparison-only sales fallback", () => {
  it("suppresses at both shops after D-1 transfers, including multi-hop and ET boundary", () => {
    const prep = [{ location_id: "old", output_item_id: "prep", produced_at: "2026-10-07T20:00:00Z" }];
    const move = { occurred_at: "2026-10-07T04:00:00Z", metadata: { from_location_id: "old", to_location_id: "L" } };
    expect(shadowAmounts(graph, target, 3, "L", "2026-10-08", prep, [move])[0]?.shadow_oz).toBe(0);
    expect(shadowAmounts(graph, target, 3, "L", "2026-10-08", prep, [{ ...move, occurred_at: "2026-10-07T03:59:59Z" }])[0]?.shadow_oz).toBe(12);
    expect(shadowAmounts(graph, target, 3, "third", "2026-10-08", prep, [move,
      { ...move, occurred_at: "2026-10-08T12:00:00Z", metadata: { from_location_id: "L", to_location_id: "third" } }])[0]?.shadow_oz).toBe(0);
    expect(shadowAmounts(graph, target, 3, "L", "2026-10-08", [{ ...prep[0]!, location_id: "unrelated" }], [move])[0]?.shadow_oz).toBe(12);
  });
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
