import { describe, expect, it } from "vitest";
import { EGGS, HELD, IDS, PRICE_SOURCE, SIDE_OZ, SIDES, WRAP, planFloorAnswers, validateArgs, verifyWriteScope } from "../scripts/seed/40-floor-answers-2026-09-20b";

type Row = Record<string, unknown>;
function fixture(overrides: Partial<Record<string, Row[]>> = {}) {
  return {
    vendor_items: [
      { id: IDS.eggs, name: "Eggs", vendor_id: IDS.pfg, item_number: EGGS.oldNumber, active: true, pack_format: "Case", units_per_pack: 360, each_size: 1.8, each_measure: "oz", avg_oz_per_each: 1.8, weight_class: "ESTIMATE", price_basis: null },
      { id: IDS.plasticWrap, name: "Plastic Wrap", vendor_id: "leonard", item_number: "SW-242", active: true, price_basis: null, notes: "sheet row" },
      { id: IDS.eggsCooked, name: "Eggs (cooked)", vendor_id: IDS.pfg, item_number: EGGS.oldNumber, active: true },
    ],
    sku_pack_levels: [],
    vendor_price_history: [{ id: "old", vendor_item_id: IDS.eggs, unit_price: 51.93, effective_date: "2026-08-31", source: "angel", recorded_at: "x" }],
    items: SIDES.map(([name, id]) => ({ id, name, active: true, location_id: null, sold_directly: true, sell_portion: 8, sell_portion_unit: "oz" })),
    vendor_order_guides: [{ id: "g1", vendor_id: IDS.pfg, name: "PFG — laminated guide", updated_at: "t0" }],
    order_guide_sections: [{ id: "s1", guide_id: "g1", name: "Dairy", position: 2 }],
    order_guide_lines: [
      { id: "l1", section_id: "s1", position: 9, label: "Eggs", item_number: EGGS.item_number, sku_id: null, note: "tentative — confirm at the door" },
      { id: "l2", section_id: "s1", position: 10, label: "Eggs (cooked)", item_number: EGGS.oldNumber, sku_id: null, note: null },
    ],
    ...overrides,
  };
}

describe("seed 40 floor answers (second batch)", () => {
  it("plans every row ready on the reviewed before-state", () => {
    const plans = planFloorAnswers(fixture());
    expect(plans.map(p => p.section)).toEqual(["sides", "sides", "sides", "eggs", "guide", "wrap"]);
    expect(plans.filter(p => p.status !== "ready").map(p => `${p.name}: ${p.reason}`)).toEqual([]);
    expect(SIDE_OZ).toBe(6);
    expect(EGGS.caseEggs * EGGS.eggOz).toBe(315);
    expect(WRAP.price).toBe(19.95);
    expect(HELD).toHaveLength(1);
  });
  it("reads an applied catalog as already and refuses drift", () => {
    const applied = fixture({
      vendor_items: [
        { id: IDS.eggs, name: "Eggs", vendor_id: IDS.pfg, item_number: EGGS.item_number, active: true, pack_format: "Case", units_per_pack: EGGS.caseEggs, each_size: EGGS.eggOz, each_measure: "oz", avg_oz_per_each: EGGS.eggOz, weight_class: "SPEC", price_basis: "per_case" },
        { id: IDS.plasticWrap, name: "Plastic Wrap", vendor_id: "leonard", item_number: "SW-242", active: true, price_basis: "per_each", notes: `sheet row\n[x] ${WRAP.note}` },
        { id: IDS.eggsCooked, name: "Eggs (cooked)", vendor_id: IDS.pfg, item_number: EGGS.oldNumber, active: true },
      ],
      sku_pack_levels: [{ id: IDS.eggsCaseLevel, sku_id: IDS.eggs, active: true }, { id: IDS.eggsEggLevel, sku_id: IDS.eggs, active: true }],
      vendor_price_history: [
        { id: "e", vendor_item_id: IDS.eggs, unit_price: EGGS.price, effective_date: EGGS.effective, source: PRICE_SOURCE, recorded_at: "x" },
        { id: "w", vendor_item_id: IDS.plasticWrap, unit_price: WRAP.price, effective_date: WRAP.effective, source: PRICE_SOURCE, recorded_at: "x" },
      ],
      items: SIDES.map(([name, id]) => ({ id, name, active: true, location_id: null, sold_directly: true, sell_portion: SIDE_OZ, sell_portion_unit: "oz" })),
      order_guide_lines: [
        { id: "l1", section_id: "s1", position: 9, label: "Eggs", item_number: EGGS.item_number, sku_id: IDS.eggs, note: null },
        { id: "l2", section_id: "s1", position: 10, label: "Eggs (cooked)", item_number: EGGS.oldNumber, sku_id: IDS.eggsCooked, note: null },
      ],
    });
    expect(planFloorAnswers(applied).every(p => p.status === "already")).toBe(true);
    const drifted = fixture();
    (drifted.vendor_items[0] as Row).weight_class = "OPERATIONAL";
    (drifted.order_guide_lines[0] as Row).sku_id = "someone-else";
    const plans = planFloorAnswers(drifted);
    expect(plans.find(p => p.section === "eggs")?.reason).toMatch(/scale weight/);
    expect(plans.find(p => p.section === "guide")?.reason).toMatch(/another SKU/);
  });
  it("refuses an unrelated change between snapshot and write", () => {
    const before = fixture(), after = fixture();
    const plan = planFloorAnswers(before).find(p => p.section === "wrap")!;
    (after.vendor_items[1] as Row).price_basis = "per_each";
    expect(() => verifyWriteScope(before, after, plan)).not.toThrow();
    (after.items[0] as Row).sell_portion = SIDE_OZ;
    expect(() => verifyWriteScope(before, after, plan)).toThrow(/unrelated/);
  });
  it("requires an explicit target", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://jepgzucrvklhqpthowsc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };
    expect(validateArgs(["--target", "sim"], env).execute).toBe(false);
    expect(() => validateArgs(["--target", "sim", "--as-of", "2026-09-20"], env)).toThrow();
  });
});
