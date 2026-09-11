import { describe, expect, it, vi } from "vitest";
import { DATA_ERRAND_CODES, skuDataReadiness, evaluateWave7Tables, summarizeSkuDataShop, worstSkuDataReadiness, type SkuDataReadinessInput, type LiveTables, type Wave7ReadinessReport, type JourneyState } from "@/lib/sku-data-readiness";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import { printWave7Comparison } from "../scripts/parity-angel";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const measures = new Map<string, MeasureUnitFactor>([["oz", { dimension: "weight", toBaseFactor: 1 }], ["each", { dimension: "count", toBaseFactor: 1 }]]);
const level = (patch: Partial<PackChainLevel> = {}): PackChainLevel => ({ id: "case", label: "Case", containsQty: 240, containsLevelId: null, containsMeasureUnit: "each", displayOrdinal: 0, ...patch });
function input(): SkuDataReadinessInput {
  return { sku: { skuClass: "raw", weightClass: "OPERATIONAL", packFormat: "Case", eachContainerLabel: null, unitsPerPack: 1, eachSize: 16, eachMeasure: "oz", avgOzPerEach: null, packChain: [] }, headPrice: { value: 10, effectiveDate: "2026-09-01" }, par: 1, rhythmPresent: true, vendorActive: true, unresolvedRecipes: [], asOf: "2026-09-11", measures };
}
const codes = (value: SkuDataReadinessInput) => skuDataReadiness(value).errands.map(e => e.code);

describe("SKU data errands", () => {
  it("reconciles the closed errand vocabulary against both locales and interpolation contracts (BC018)", () => {
    const prefix = "admin.skus.data.errand.";
    const placeholders = (value: string) => [...value.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]).sort();
    for (const locale of [en, es]) {
      expect(Object.keys(locale).filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)).sort()).toEqual([...DATA_ERRAND_CODES].sort());
    }
    for (const code of DATA_ERRAND_CODES) {
      const key = `${prefix}${code}` as keyof typeof en;
      expect(en[key].trim(), `en ${code}`).not.toBe("");
      expect(es[key].trim(), `es ${code}`).not.toBe("");
      expect(placeholders(en[key]), code).toEqual(placeholders(es[key]));
      expect(placeholders(en[key]), code).toEqual(code === "recipe_unresolved" ? ["recipes"] : []);
    }
  });
  it("has exactly the ten adjudicated codes and a clean baseline", () => {
    expect(DATA_ERRAND_CODES).toEqual(["no_price", "price_stale", "no_countable_chain", "raw_pack_contents_missing", "weight_estimate", "no_par", "no_rhythm", "no_vendor", "no_order_unit", "recipe_unresolved"]);
    expect(skuDataReadiness(input())).toEqual({ order: "usable", count: "usable", cost: "usable", errands: [] });
  });
  it.each([null, 0, -1])("blocks cost for absent/nonpositive price %s", value => {
    const x = input(); x.headPrice = value === null ? null : { value, effectiveDate: null };
    expect(skuDataReadiness(x)).toMatchObject({ order: "usable", count: "usable", cost: "blocked", errands: [{ code: "no_price", blocks: ["cost"], degrades: [] }] });
  });
  it.each([["2026-08-12", false], ["2026-08-11", true], [null, false], ["2026-09-12", false]] as const)("price date %s honors the strictly greater than 30 days boundary", (effectiveDate, stale) => {
    const x = input(); x.headPrice = { value: 10, effectiveDate };
    expect(codes(x).includes("price_stale")).toBe(stale);
    expect(skuDataReadiness(x).cost).toBe(stale ? "degraded" : "usable");
  });
  it("a missing raw pack blocks cost and degrades order/count without inventing a supply errand", () => {
    const x = input(); x.sku.eachSize = null;
    expect(skuDataReadiness(x)).toEqual({ order: "degraded", count: "degraded", cost: "blocked", errands: [{ code: "raw_pack_contents_missing", blocks: ["cost"], degrades: ["order", "count"] }] });
  });
  it.each(["ESTIMATE", "SPEC", null, "UNKNOWN"])("flags %s weight evidence and preserves supply count", weightClass => {
    const x = input(); x.sku.weightClass = weightClass; x.sku.avgOzPerEach = 2;
    expect(skuDataReadiness(x)).toMatchObject({ order: "usable", count: "degraded", cost: "degraded" });
    expect(codes(x)).toEqual(["weight_estimate"]);
    x.sku.skuClass = "packaging"; x.sku.packChain = [level()];
    expect(skuDataReadiness(x)).toMatchObject({ count: "usable", cost: "degraded", errands: [{ code: "weight_estimate", blocks: [], degrades: ["cost"] }] });
  });
  it.each(["OPERATIONAL", "INVOICE_DERIVED"])("accepts %s evidence", weightClass => {
    const x = input(); x.sku.weightClass = weightClass; x.sku.avgOzPerEach = 2;
    expect(codes(x)).toEqual([]);
  });
  it("does not call an absent unclassified weight an estimate", () => {
    const x = input(); x.sku.weightClass = null;
    expect(codes(x)).toEqual([]);
  });
  it("zero par is configured; absent par blocks, absent rhythm degrades, inactive vendor blocks", () => {
    const x = input(); x.par = 0;
    expect(skuDataReadiness(x).order).toBe("usable");
    x.rhythmPresent = false;
    expect(skuDataReadiness(x)).toMatchObject({ order: "degraded", errands: [{ code: "no_rhythm", blocks: [], degrades: ["order"] }] });
    x.par = null; x.vendorActive = false; x.sku.packFormat = "  ";
    expect(skuDataReadiness(x).order).toBe("blocked");
    expect(codes(x)).toEqual(["no_par", "no_rhythm", "no_vendor", "no_order_unit"]);
  });
  it("recipe failure carries sorted distinct names, changes cost only, and loses to a cost block", () => {
    const x = input(); x.unresolvedRecipes = ["Sub", "Jus", "Jus"];
    expect(skuDataReadiness(x)).toEqual({ order: "usable", count: "usable", cost: "degraded", errands: [{ code: "recipe_unresolved", blocks: [], degrades: ["cost"], recipes: ["Jus", "Sub"] }] });
    x.headPrice = null;
    expect(skuDataReadiness(x).cost).toBe("blocked");
    expect(codes(x)).toEqual(["no_price", "recipe_unresolved"]);
    expect(x.unresolvedRecipes).toEqual(["Sub", "Jus", "Jus"]);
  });
  it.each([
    ["absent", []], ["zero", [level({ containsQty: 0 })]], ["negative", [level({ containsQty: -1 })]],
    ["nonfinite", [level({ containsQty: Infinity })]], ["dangling", [level({ containsLevelId: "missing", containsMeasureUnit: null })]],
    ["cycle", [level({ containsLevelId: "case", containsMeasureUnit: null })]],
    ["unknown measure", [level({ containsMeasureUnit: "mystery" })]], ["measure label collision", [level({ label: "each" })]],
    ["detached sibling", [level(), level({ id: "other", label: "Bag" })]],
  ] satisfies [string, PackChainLevel[]][])("blocks supply count for %s chain", (_name, chain) => {
    const x = input(); x.sku.skuClass = "packaging"; x.sku.packChain = chain;
    expect(skuDataReadiness(x).count).toBe("blocked");
    expect(codes(x)).toContain("no_countable_chain");
    expect(codes(x)).not.toContain("raw_pack_contents_missing");
  });
  it("count chain needs no fabricated weight and supplies the order root", () => {
    const x = input(); x.sku.skuClass = "packaging"; x.sku.packChain = [level()]; x.sku.packFormat = null;
    expect(skuDataReadiness(x)).toEqual({ order: "usable", count: "usable", cost: "usable", errands: [] });
  });
});

describe("r3 rule equivalence", () => {
  it("preserves the captured r3 shop/matrix rendering byte for byte", () => {
    // Golden lines are copied from wave7-dryrun-sim-r3.txt:474,479-481,547,552-554.
    // Only aggregate margins were archived. These synthetic rows independently
    // encode those margins for a FORMATTER regression; they are not source SKU
    // tables, a reconstruction of cross-journey correlations, or a full r3 replay.
    const stateAt = (index: number, usable: number, degraded: number): JourneyState => index < usable ? "usable" : index < usable + degraded ? "degraded" : "blocked";
    const report: Wave7ReadinessReport = {
      asOf: "2026-09-11", counts: {},
      shops: ["Capitol Hill", "P Street"].map((name, shopIndex) => ({
        id: `synthetic-shop-${shopIndex}`, name, recipes: [], products: [],
        rows: Array.from({ length: 161 }, (_, i) => ({
          id: `synthetic-${i}`, name: `Synthetic SKU ${i}`, order: stateAt(i, 102, 4), count: stateAt(i, 51, 50), cost: stateAt(i, 20, 30),
          errands: [], unpriced: false, chainless: false, estimate: false, rawPackMissing: false, age: null, presentAge: null, consumerBasis: "synthetic",
        })),
      })),
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      printWave7Comparison(report, structuredClone(report));
      const lines = log.mock.calls.map(call => String(call[0])).filter(line => /launch SKUs$|^  (ORDER|COUNT|COST):/.test(line));
      expect(lines.join("\n")).toBe([
        "Capitol Hill: 161 → 161 launch SKUs",
        "  ORDER: usable 102 → 102; degraded 4 → 4; blocked 55 → 55",
        "  COUNT: usable 51 → 51; degraded 50 → 50; blocked 60 → 60",
        "  COST: usable 20 → 20; degraded 30 → 30; blocked 111 → 111",
        "P Street: 161 → 161 launch SKUs",
        "  ORDER: usable 102 → 102; degraded 4 → 4; blocked 55 → 55",
        "  COUNT: usable 51 → 51; degraded 50 → 50; blocked 60 → 60",
        "  COST: usable 20 → 20; degraded 30 → 30; blocked 111 → 111",
      ].join("\n"));
    } finally { log.mockRestore(); }
  });
  it("preserves all 2,048 boolean combinations of the original three journey expressions", () => {
    // Oracle copied from the r3 parity implementation, not reconstructed from errands.
    for (let mask = 0; mask < 2048; mask++) {
      const bit = (n: number) => !!(mask & (1 << n));
      const [supply, countable, massPresent, unpriced, uncertain, stale, parMissing, scheduled, vendorActive, packLabel, recipeDegraded] = Array.from({ length: 11 }, (_, i) => bit(i));
      const x = input();
      x.sku.skuClass = supply ? "packaging" : "raw";
      x.sku.packChain = countable ? [level({ containsMeasureUnit: massPresent ? "oz" : "each" })] : [];
      x.sku.eachSize = massPresent ? 16 : null;
      x.sku.weightClass = uncertain ? "SPEC" : "OPERATIONAL";
      x.sku.packFormat = packLabel ? "Case" : null;
      x.headPrice = { value: unpriced ? null : 10, effectiveDate: stale ? "2026-08-11" : "2026-08-12" };
      x.par = parMissing ? null : 0; x.rhythmPresent = !!scheduled; x.vendorActive = !!vendorActive;
      x.unresolvedRecipes = recipeDegraded ? ["Jus"] : [];
      const rawPackMissing = !supply && !massPresent;
      const orderUnit = countable || packLabel;
      const order = !orderUnit || parMissing || !vendorActive ? "blocked" : scheduled && !rawPackMissing ? "usable" : "degraded";
      const count = supply ? countable ? "usable" : "blocked" : rawPackMissing || uncertain ? "degraded" : "usable";
      const cost = unpriced || rawPackMissing ? "blocked" : uncertain || stale || recipeDegraded ? "degraded" : "usable";
      expect(skuDataReadiness(x), `r3 input mask ${mask}`).toMatchObject({ order, count, cost });
    }
  });
});

function tables(): LiveTables {
  const data: LiveTables = Object.fromEntries(["items", "menu_items", "products", "recipes", "recipe_inputs", "recipe_outputs", "vendor_deliveries", "vendor_delivery_items", "product_primaries", "location_sku_settings", "sku_pack_levels", "vendor_price_history", "vendor_cutoffs", "vendor_delivery_rhythm"].map(name => [name, []]));
  data.locations = [{ id: "north", name: "Test North", active: true }, { id: "south", name: "Test South", active: true }];
  data.vendors = [{ id: "vendor", active: true }];
  data.vendor_items = [{ id: "sku", name: "Test ingredient", vendor_id: "vendor", active: true, sku_class: "raw", pack_format: "Case", units_per_pack: 1, each_size: 16, each_measure: "oz", weight_class: "OPERATIONAL", weekday_par: 1, weekend_par: 1 }];
  data.measure_units = [...measures].map(([label, m]) => ({ id: label, label, dimension: m.dimension, to_base_factor: m.toBaseFactor, active: true }));
  data.vendor_price_history = [{ id: "price", vendor_item_id: "sku", unit_price: 10, effective_date: "2026-09-01" }];
  data.vendor_cutoffs = [{ id: "cutoff", vendor_id: "vendor", active: true }];
  data.vendor_delivery_rhythm = [{ id: "rhythm", vendor_id: "vendor", active: true }];
  return data;
}

describe("complete-table evaluation and shop summaries", () => {
  it("names direct and transitive unresolved recipe consumers and removes the errand after the line is fixed", () => {
    const data = tables();
    data.items = [{ id: "jus", name: "Jus", default_par_unit: "batch", oz_per_par_unit: 1 }, { id: "sub", name: "Sub", default_par_unit: "each", oz_per_par_unit: 1 }];
    data.recipes = [{ id: "r-jus", name: "Jus", active: true, batch_yield: 1 }, { id: "r-sub", name: "Sub", active: true, batch_yield: 1 }];
    data.recipe_inputs = [{ id: "line-jus", recipe_id: "r-jus", component_sku_id: "sku", quantity: 1, unit: "ladle" }, { id: "line-sub", recipe_id: "r-sub", component_item_id: "jus", quantity: 1, unit: null }];
    data.recipe_outputs = [{ id: "out-jus", recipe_id: "r-jus", output_item_id: "jus", yield: 1 }, { id: "out-sub", recipe_id: "r-sub", output_item_id: "sub", yield: 1 }];
    for (const shop of evaluateWave7Tables(data).shops) {
      expect(shop.rows[0]).toMatchObject({ order: "usable", count: "usable", cost: "degraded", errands: [{ code: "recipe_unresolved", blocks: [], degrades: ["cost"], recipes: ["Jus", "Sub"] }] });
      expect(shop.recipes.map(r => r.cost)).toEqual([null, null]);
    }
    data.recipe_inputs[0]!.unit = "oz";
    for (const shop of evaluateWave7Tables(data).shops) {
      expect(shop.rows[0]).toMatchObject({ cost: "usable", errands: [] });
      expect(shop.recipes.every(r => r.cost != null)).toBe(true);
    }
  });
  it("limits visible shops before producing results, with empty scope showing none", () => {
    const data = tables();
    expect(evaluateWave7Tables(data).shops.map(s => s.id)).toEqual(["north", "south"]);
    expect(evaluateWave7Tables(data, undefined, "2026-09-11", "2026-09-11", new Set(["south"])).shops.map(s => s.id)).toEqual(["south"]);
    expect(evaluateWave7Tables(data, undefined, "2026-09-11", "2026-09-11", new Set()).shops).toEqual([]);
  });
  it("applies local pars/rhythm and summarizes each shop independently with worst state per journey", () => {
    const data = tables();
    data.location_sku_settings = [{ id: "setting", location_id: "south", sku_id: "sku", weekday_par: 0, weekend_par: 0 }];
    data.vendor_delivery_rhythm = [{ id: "rhythm", vendor_id: "vendor", location_id: "north", active: true }];
    const rows = evaluateWave7Tables(data).shops.map(shop => shop.rows[0]!);
    expect(rows[0]?.order).toBe("usable"); expect(rows[1]?.order).toBe("degraded");
    expect(worstSkuDataReadiness(rows)).toEqual({ order: "degraded", count: "usable", cost: "usable" });
    const blocked = input(); blocked.headPrice = null; blocked.par = null; blocked.sku.skuClass = "packaging";
    const result = skuDataReadiness(blocked);
    expect(worstSkuDataReadiness([...rows, result])).toEqual({ order: "blocked", count: "blocked", cost: "blocked" });
    expect(worstSkuDataReadiness([])).toBeNull();
    expect(summarizeSkuDataShop("north", "Test North", { a: rows[0]!, b: rows[1]!, c: result }).counts).toEqual({ order: { usable: 1, degraded: 1, blocked: 1 }, count: { usable: 2, degraded: 0, blocked: 1 }, cost: { usable: 2, degraded: 0, blocked: 1 } });
    expect(summarizeSkuDataShop("empty", "Empty", {}).counts.cost).toEqual({ usable: 0, degraded: 0, blocked: 0 });
  });
});
