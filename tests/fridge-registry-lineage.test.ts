/**
 * W15/B022: a publish re-mints every checklist line with a new id. The fridge registry
 * used ONLY the two pointer columns, so after any publish the new temp line's readings
 * were nobody's and a 55°F reading was never flagged. The registry now also claims
 * fridge-linked lines (equipment_id) on every version at the shop; pointers still win.
 */
import { describe, expect, it } from "vitest";
import { buildTempItemRegistry, isHotReading, itemsOwnedBy, type FridgeRegistryRow } from "@/lib/fridge-registry";

const F: FridgeRegistryRow = { id: "F", opening_temp_item_id: "a1", closing_temp_item_id: "c1", safe_max_f: 41, active: true, created_at: "2026-01-01" };

describe("W15/B022 fridge registry across template versions", () => {
  it("a reading on the republished copy of a fridge's PM line is claimed and flagged", () => {
    const reg = buildTempItemRegistry([F], [
      { itemId: "c1", equipmentId: "F", templateType: "closing" },
      { itemId: "c2", equipmentId: "F", templateType: "closing" },
    ]);
    expect(reg.get("c2")).toMatchObject({ fridgeId: "F", phase: "PM", safeMaxF: 41 });
    expect(isHotReading(reg, "c2", 55)).toBe(true);
  });

  it("an opening line's copy is AM", () => {
    const reg = buildTempItemRegistry([F], [{ itemId: "a2", equipmentId: "F", templateType: "opening" }]);
    expect(reg.get("a2")).toMatchObject({ fridgeId: "F", phase: "AM" });
  });

  it("the old version's line stays claimed after the pointer moves (history kept)", () => {
    const moved = { ...F, closing_temp_item_id: "c2" };
    const reg = buildTempItemRegistry([moved], [{ itemId: "c1", equipmentId: "F", templateType: "closing" }]);
    expect(itemsOwnedBy(reg, "F").sort()).toEqual(["a1", "c1", "c2"]);
  });

  it("pointer claims still win over a linked line", () => {
    const G: FridgeRegistryRow = { id: "G", opening_temp_item_id: null, closing_temp_item_id: "c9", safe_max_f: 38, active: true, created_at: "2026-02-01" };
    const reg = buildTempItemRegistry([F, G], [{ itemId: "c9", equipmentId: "F", templateType: "closing" }]);
    expect(reg.get("c9")).toMatchObject({ fridgeId: "G", safeMaxF: 38 });
  });

  it("a line linked to an equipment row that is not one of these fridges is ignored", () => {
    const reg = buildTempItemRegistry([F], [{ itemId: "x1", equipmentId: "slicer", templateType: "closing" }]);
    expect(reg.has("x1")).toBe(false);
  });

  it("with no linked lines the registry is byte-identical to the pointer-only build", () => {
    expect([...buildTempItemRegistry([F], [])]).toEqual([...buildTempItemRegistry([F])]);
  });
});
