import { describe, expect, it } from "vitest";
import { HELD, IDS, LEONARD, PFG, PRICE_SOURCE, WEIGHTS, planFloorAnswers, validateArgs, verifyWriteScope } from "../scripts/seed/39-floor-answers-2026-09-20";

type Row = Record<string, unknown>;
const leonardSku = (item_number: string, extra: Row = {}): Row => ({ id: `leo-${item_number}`, vendor_id: IDS.leonard, item_number, active: true, price_basis: null, pack_format: null, units_per_pack: null, each_size: null, each_measure: null, ...extra });
function fixture(overrides: Partial<Record<string, Row[]>> = {}) {
  return {
    vendors: [{ id: IDS.pfg, name: "PFG", active: true }, { id: IDS.leonard, name: "Leonard Paper", active: true, account_number: null }],
    vendor_items: [
      { id: IDS.worcestershire, name: "Worcestershire", vendor_id: null, item_number: null, active: true, pack_format: null, units_per_pack: null, each_size: null, each_measure: null, price_basis: null },
      { id: IDS.baldorCholula, name: "Cholula", vendor_id: "baldor", item_number: "SAUCE6B", active: true },
      { id: IDS.cannoliPfg, name: "Cannoli Shell", vendor_id: IDS.pfg, active: true, avg_oz_per_each: null, weight_class: null },
      { id: IDS.cannoliBaldor, name: "Cannoli Shell", vendor_id: "baldor", active: true, avg_oz_per_each: null, weight_class: null },
      ...LEONARD.map(l => leonardSku(l.item_number)),
    ],
    sku_pack_levels: [],
    vendor_price_history: [],
    items: [{ id: IDS.jusItem, name: "Jus", active: true, default_par_unit: "Quart", oz_per_par_unit: null }],
    recipe_inputs: [
      { id: IDS.cholulaMayoLine, recipe_id: "r1", component_sku_id: IDS.baldorCholula, quantity: 7.5, unit: "oz" },
      { id: IDS.frenchDipLadle, recipe_id: "r2", component_item_id: IDS.jusItem, quantity: 1, unit: "ladle" },
    ],
    users: [],
    ...overrides,
  };
}

describe("seed 39 floor answers", () => {
  it("plans every row ready on the reviewed before-state", () => {
    const plans = planFloorAnswers(fixture());
    expect(plans).toHaveLength(2 + 2 + LEONARD.length + LEONARD.filter(l => l.pack).length + 1 + 2 + 1 + 2);
    expect(plans.filter(p => p.status !== "ready").map(p => `${p.name}: ${p.reason}`)).toEqual([]);
    expect(PFG.map(s => s.price)).toEqual([65.74, 57.70]);
    expect(LEONARD.find(l => l.item_number === "S-1824PS")?.basis).toBe("per_bundle");
    expect(HELD.some(h => h.startsWith("Chicken salad"))).toBe(true);
  });
  it("reads an applied catalog as already and refuses a drifted one", () => {
    const applied = fixture({
      vendor_items: [
        { id: IDS.worcestershire, name: "Worcestershire", vendor_id: IDS.pfg, item_number: "341010", active: true, pack_format: "Case", units_per_pack: 3, each_size: 128, each_measure: "fl oz", price_basis: "per_case" },
        { id: IDS.pfgCholula, name: "Cholula", vendor_id: IDS.pfg, item_number: "525032", active: true, pack_format: "Case", units_per_pack: 4, each_size: 64, each_measure: "fl oz", price_basis: "per_case" },
        { id: IDS.baldorCholula, name: "Cholula", vendor_id: "baldor", item_number: "SAUCE6B", active: true },
        { id: IDS.cannoliPfg, name: "Cannoli Shell", vendor_id: IDS.pfg, active: true, avg_oz_per_each: 0.3, weight_class: "OPERATIONAL" },
        { id: IDS.cannoliBaldor, name: "Cannoli Shell", vendor_id: "baldor", active: true, avg_oz_per_each: 0.3, weight_class: "OPERATIONAL" },
        ...LEONARD.map(l => leonardSku(l.item_number, { price_basis: l.basis, ...(l.pack ? { pack_format: l.pack.label, units_per_pack: 1, each_size: l.pack.qty, each_measure: l.pack.unit } : {}) })),
      ],
      vendors: [{ id: IDS.pfg, name: "PFG", active: true }, { id: IDS.leonard, name: "Leonard Paper", active: true, account_number: "37630" }],
      sku_pack_levels: [
        ...PFG.flatMap(s => s.levels.map(id => ({ id, sku_id: s.sku ?? IDS.pfgCholula, active: true }))),
        ...LEONARD.filter(l => l.pack).map(l => ({ id: l.levelId, sku_id: `leo-${l.item_number}`, active: true })),
      ],
      vendor_price_history: [
        ...PFG.map(s => ({ id: `p-${s.item_number}`, vendor_item_id: s.sku ?? IDS.pfgCholula, unit_price: s.price, effective_date: s.effective, source: PRICE_SOURCE, recorded_at: "x" })),
        ...LEONARD.map(l => ({ id: `p-${l.item_number}`, vendor_item_id: `leo-${l.item_number}`, unit_price: l.price, effective_date: "2026-09-15", source: PRICE_SOURCE, recorded_at: "x" })),
      ],
      items: [{ id: IDS.jusItem, name: "Jus", active: true, default_par_unit: "Quart", oz_per_par_unit: WEIGHTS.jusQuartOz }],
      recipe_inputs: [
        { id: IDS.cholulaMayoLine, recipe_id: "r1", component_sku_id: IDS.pfgCholula, quantity: 7.5, unit: "oz" },
        { id: IDS.frenchDipLadle, recipe_id: "r2", component_item_id: IDS.jusItem, quantity: WEIGHTS.ladleOz, unit: "oz" },
      ],
    });
    expect(planFloorAnswers(applied).every(p => p.status === "already")).toBe(true);
    const drifted = fixture();
    (drifted.vendor_items[0] as Row).vendor_id = "someone-else";
    (drifted.items[0] as Row).default_par_unit = "Pint";
    const plans = planFloorAnswers(drifted);
    expect(plans.find(p => p.name.startsWith("Worcestershire (PFG"))?.status).toBe("refused");
    expect(plans.find(p => p.section === "items")?.reason).toContain("Pint");
  });
  it("refuses an unrelated change between snapshot and write", () => {
    const before = fixture(), after = fixture();
    const plan = planFloorAnswers(before).find(p => p.section === "items")!;
    (after.items[0] as Row).oz_per_par_unit = WEIGHTS.jusQuartOz;
    expect(() => verifyWriteScope(before, after, plan)).not.toThrow();
    (after.vendors[0] as Row).name = "Renamed";
    expect(() => verifyWriteScope(before, after, plan)).toThrow(/unrelated/);
  });
  it("requires an explicit target and refuses parity flags", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://jepgzucrvklhqpthowsc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };
    expect(validateArgs(["--target", "sim"], env).execute).toBe(false);
    expect(() => validateArgs(["--target", "sim", "--wave7"], env)).toThrow();
    expect(() => validateArgs(["--dry-run", "--execute", "--target", "sim"], env)).toThrow();
  });
});
