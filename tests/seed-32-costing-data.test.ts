import { describe, expect, it } from "vitest";
import { PACKS, PORTIONS, RESALES, SOURCE, TEA_WARNING, packChain, planCostingData, resaleSource, validateArgs, verifyWriteScope, type Tables } from "@/scripts/seed/32-costing-data-readiness";
import { deriveFlatFieldsFromChain } from "@/lib/admin/catalog-shared";
import { ozForRecipeInput, skuContentOz, type MeasureUnitFactor } from "@/lib/recipe-math";
import { SIM_PROJECT_REF } from "@/lib/sim-isolation-shared";

const PFG = "a0d8986c-e097-46f0-9e3f-e70943d4291b", BH = "aff69f0d-0a7e-4b6f-9371-3eef47df86e3";
function before(): Tables {
  const t: Tables = { vendor_items: [], sku_pack_levels: [], items: [], recipes: [], recipe_inputs: [], recipe_outputs: [], menu_items: [], measure_units: [] };
  t.measure_units = ["oz", "fl oz", "each", "unit", "count", "can"].map(label => ({ id: label, label, active: true, dimension: label === "oz" ? "weight" : label === "fl oz" ? "volume" : "count", to_base_factor: 1 }));
  for (const spec of PACKS) {
    t.vendor_items.push({ id: spec.id, name: spec.name, vendor_id: PFG, active: true, ...spec.before, avg_oz_per_each: "avg" in spec ? spec.avg : null, weight_class: "ESTIMATE" });
    t.sku_pack_levels.push({ id: `chain-${spec.id}`, sku_id: spec.id, active: true, label: spec.before.pack_format === "Each (no case)" ? "container" : "case", contains_qty: spec.before.each_size, contains_level_id: null, contains_measure_unit: "oz", display_ordinal: 0 });
  }
  for (const spec of PORTIONS) {
    if (!t.vendor_items.some(r => r.id === spec.skuId)) t.vendor_items.push({ id: spec.skuId, name: spec.sku, active: true });
    t.items.push({ id: spec.name, name: spec.name, active: true, location_id: null, default_par_unit: "Quart", oz_per_par_unit: null });
    t.recipes.push({ id: `recipe-${spec.name}`, name: `${spec.name} (portioned)`, active: true, recipe_type: "production", batch_yield: 1, notes: "Original operator notes" });
    t.recipe_inputs.push({ id: `input-${spec.name}`, recipe_id: `recipe-${spec.name}`, quantity: 1, unit: "unit", component_sku_id: spec.skuId, component_item_id: null, component_product_id: null });
    t.recipe_outputs.push({ id: `output-${spec.name}`, recipe_id: `recipe-${spec.name}`, output_item_id: spec.name, output_menu_item_id: null, yield: 1 });
  }
  for (const spec of RESALES) {
    t.menu_items.push({ id: spec.name, name: spec.name, active: true });
    if (!t.vendor_items.some(r => r.id === spec.skuId)) t.vendor_items.push({ id: spec.skuId, name: spec.sku, vendor_id: BH, active: true, pack_format: spec.tea ? "Pack" : "Each", units_per_pack: spec.tea ? 12 : 1, each_size: spec.tea ? 12 : 1, each_measure: spec.tea ? "fl oz" : "count", avg_oz_per_each: spec.tea ? 1 : 4 });
  }
  return t;
}
function after(): Tables {
  const t = before();
  for (const spec of PACKS) {
    Object.assign(t.vendor_items.find(r => r.id === spec.id)!, spec.after, "setAvg" in spec ? { avg_oz_per_each: spec.setAvg } : {}, "containerLabel" in spec ? { each_container_label: spec.containerLabel } : {});
    t.sku_pack_levels = t.sku_pack_levels.filter(r => r.sku_id !== spec.id);
    t.sku_pack_levels.push(...packChain(spec).map((l, i) => ({ id: `${spec.id}-${i}`, sku_id: spec.id, active: true, label: l.label, contains_qty: l.containsQty, contains_level_id: l.containsIndex == null ? null : `${spec.id}-${l.containsIndex}`, contains_measure_unit: l.containsMeasureUnit, display_ordinal: i })));
  }
  for (const spec of PORTIONS) {
    const input = t.recipe_inputs.find(r => r.id === `input-${spec.name}`)!;
    Object.assign(input, { quantity: spec.oz, unit: "oz" });
    t.items.find(r => r.id === spec.name)!.oz_per_par_unit = spec.oz;
    t.recipes.find(r => r.id === `recipe-${spec.name}`)!.notes += `\n[${SOURCE}; recipe input ${String(input.id)}] ${spec.source}`;
  }
  for (const spec of RESALES) {
    t.recipes.push({ id: `resale-${spec.name}`, name: `${spec.name} (build)`, active: true, recipe_type: "consumer", batch_yield: 1, notes: `[${SOURCE}] ${resaleSource(spec)}` });
    t.recipe_inputs.push({ id: `resale-input-${spec.name}`, recipe_id: `resale-${spec.name}`, component_sku_id: spec.skuId, component_item_id: null, component_product_id: null, quantity: spec.quantity, unit: spec.unit });
    t.recipe_outputs.push({ id: `resale-output-${spec.name}`, recipe_id: `resale-${spec.name}`, output_item_id: null, output_menu_item_id: spec.name, yield: 1, output_container_label: spec.label });
  }
  return t;
}
const find = (t: Tables, name: string) => planCostingData(t).find(p => p.name === name)!;

describe("Wave 8 expected/after contracts", () => {
  it("plans all six packs, five portions and five resale recipes from the reviewed before-state", () => {
    const plans = planCostingData(before());
    expect(plans).toHaveLength(16);
    expect(plans.map(p => p.status)).toEqual(Array(16).fill("ready"));
    expect(plans.filter(p => p.section === "packs")).toHaveLength(6);
    expect(plans.filter(p => p.section === "portions")).toHaveLength(5);
    expect(plans.filter(p => p.section === "resales")).toHaveLength(5);
    expect(plans.some(p => p.name === "Roasted Red Peppers")).toBe(false);
  });
  it("reports already for every complete after-state on a second run", () => {
    expect(planCostingData(after()).map(p => p.status)).toEqual(Array(16).fill("already"));
  });
  it.each([
    // The produce packs are COUNT packs (24 heads · 6 stalks · 6 cans) so the Angel import can relate them;
    // the weight basis rides on avg_oz_per_each (CC sim finding 2026-09-11).
    ["Iceberg", "Case", 24, 1, "each"], ["Celery", "Case", 6, 1, "each"],
    ["Tomatoes Crushed (10#)", "Case", 6, 1, "can"], ["Chives", "Each", 1, 8, "oz"],
    ["Lemon Juice", "Case", 6, 32, "oz"], ["Tomatoes", "Case", 1, 400, "oz"],
  ])("%s writes the reviewed pack and derives matching flat fields", (name, packFormat, unitsPerPack, eachSize, eachMeasure) => {
    const spec = PACKS.find(s => s.name === name)!;
    expect(deriveFlatFieldsFromChain(packChain(spec))).toEqual({ packFormat, unitsPerPack, eachSize, eachMeasure });
    expect(find(before(), String(name)).source).toContain("Angel #");
  });
  it.each([["Onion", 0.25], ["Pickles", 0.5], ["Tomato", 2.5], ["Cucumber", 1.2], ["Radish", 0.5]])("%s declares exactly %s oz for both ingredient and finished portion", (name, oz) => {
    expect(find(before(), String(name)).after).toEqual({ quantity: oz, unit: "oz", oz_per_par_unit: oz, yield: 1 });
  });
  it("clearly separates the two verbatim portions from the three pending scale estimates", () => {
    expect(PORTIONS.filter(p => p.estimated).map(p => p.name)).toEqual(["Tomato", "Cucumber", "Radish"]);
    for (const spec of PORTIONS) expect(spec.source).toContain(spec.estimated ? "pending a scale" : "verbatim");
  });
  it("uses 1 whole pickle and 3 whole pickles (four spears each), retaining the unpriced disclosure", () => {
    expect(find(before(), "Deli Pickle").after).toMatchObject({ quantity: 1, unit: "each" });
    const quart = find(before(), "Quart of Pickle Spears (12pcs)");
    expect(quart.after).toMatchObject({ quantity: 3, unit: "each" });
    expect(quart.source).toContain("four spears");
    expect(quart.source).toContain("unpriced");
  });
});

describe("drift and partial-write refusals", () => {
  it.each(PACKS.map(s => [s.name, s.id]))("%s refuses a drifted flat before-state", (name, id) => {
    const t = before(); t.vendor_items.find(r => r.id === id)!.each_size = 999;
    expect(find(t, name!).status).toBe("refused");
  });
  it("refuses a changed chain even when flat fields still match", () => {
    const t = before(); t.sku_pack_levels[0]!.contains_qty = 999;
    expect(find(t, "Iceberg").status).toBe("refused");
  });
  it("refuses a deactivated chain without replacement after an interrupted supersede", () => {
    const t = before(); t.sku_pack_levels[0]!.active = false;
    expect(find(t, "Iceberg").reason).toContain("interrupted supersede");
  });
  it("refuses an unexpected whole-pickle chain that overrides the flat one-count order unit", () => {
    const t = before(); t.sku_pack_levels.push({ id: "pickles", sku_id: RESALES[3]!.skuId, active: true, label: "pail", contains_qty: 45, contains_measure_unit: "count", contains_level_id: null });
    expect(find(t, "Deli Pickle").status).toBe("refused");
  });
  it("scope verification detects unintended weight classification and unrelated-row changes", () => {
    const t = before(), u = structuredClone(t), p = find(t, "Iceberg");
    Object.assign(u.vendor_items[0]!, PACKS[0]!.after);
    expect(() => verifyWriteScope(t, u, p)).not.toThrow();
    u.vendor_items[0]!.weight_class = "INVOICE_DERIVED";
    expect(() => verifyWriteScope(t, u, p)).toThrow("unrelated/concurrent");
    const v = structuredClone(t); v.items[0]!.name = "renamed elsewhere";
    expect(() => verifyWriteScope(t, v, p)).toThrow("unrelated/concurrent");
  });
  it("refuses a pack-label measure collision", () => {
    const t = before(); t.measure_units.push({ id: "head", label: "head", active: true });
    expect(find(t, "Iceberg").reason).toContain("shadows");
  });
  it("never accepts corrected flats with an old active chain as already", () => {
    const t = before(); Object.assign(t.vendor_items[0]!, PACKS[0]!.after);
    expect(find(t, "Iceberg").status).toBe("refused");
  });
  it("preserves recorded avg values and refuses a changed average where the source pins it", () => {
    const t = before(); t.vendor_items[0]!.avg_oz_per_each = 19;
    expect(find(t, "Iceberg").reason).toContain("average drift");
  });
  it.each(PORTIONS.map(p => p.name))("%s refuses a changed placeholder quantity", name => {
    const t = before(); t.recipe_inputs.find(r => r.id === `input-${name}`)!.quantity = 2;
    expect(find(t, name).status).toBe("refused");
  });
  it("refuses an ambiguous active item even if only one is global", () => {
    const t = before(); t.items.push({ ...t.items[0], id: "duplicate", location_id: "shop" });
    expect(find(t, "Onion").status).toBe("refused");
  });
  it("refuses a different SKU, extra recipe output, or partial portion write", () => {
    const t = before(); t.recipe_inputs[0]!.component_sku_id = "different";
    expect(find(t, "Onion").status).toBe("refused");
    const u = before(); u.recipe_outputs.push({ ...u.recipe_outputs[0], id: "extra" });
    expect(find(u, "Onion").status).toBe("refused");
    const v = before(); v.items[0]!.oz_per_par_unit = 0.25;
    expect(find(v, "Onion").status).toBe("refused");
  });
  it("requires input-specific source notes before calling portions already", () => {
    const t = after(); t.recipes[0]!.notes = "Old note";
    expect(find(t, "Onion").status).toBe("refused");
  });
  it("refuses both existing producer recipes and incomplete staged recipes", () => {
    const t = after(); const name = RESALES[0]!.name;
    const recipe = t.recipes.find(r => r.id === `resale-${name}`)!;
    recipe.notes = "another author";
    expect(find(t, name).status).toBe("refused");
    recipe.notes = `[${SOURCE}]`; recipe.active = false;
    expect(find(t, name).status).toBe("refused");
  });
  it("refuses changed resale quantity after a successful run", () => {
    const t = after(), name = RESALES[0]!.name;
    t.recipe_inputs.find(r => r.id === `resale-input-${name}`)!.quantity = 24;
    expect(find(t, name).status).toBe("refused");
  });
});

describe("tea volume two-phase", () => {
  it("preserves migration 0202's existing avg 1, permits requested NULL fallback 12, refuses unrelated drift", () => {
    const t = before(), spec = RESALES[0]!;
    const sku = t.vendor_items.find(r => r.id === spec.skuId)!;
    for (const value of [1, null, 12]) { sku.avg_oz_per_each = value; expect(find(t, spec.name).status).toBe("ready"); }
    sku.avg_oz_per_each = 2;
    expect(find(t, spec.name).status).toBe("refused");
  });
  it.each([1, 12])("12 fl oz tea at avg=%s consumes exactly 1/12 pack through production recipe math", avg => {
    const measures = new Map<string, MeasureUnitFactor>([["fl oz", { dimension: "volume", toBaseFactor: 1 }]]);
    const sku = { packFormat: "Pack", eachContainerLabel: null, unitsPerPack: 12, eachSize: 12, eachMeasure: "fl oz", avgOzPerEach: avg };
    const sold = ozForRecipeInput(12, "fl oz", sku, measures)!, pack = skuContentOz(sku, measures)!;
    expect(sold / pack).toBe(1 / 12);
    expect(sold).toBe(12 * avg);
    expect(pack).toBe(144 * avg);
    expect(TEA_WARNING).toContain("144 modeled oz/can");
  });
  it("refuses a tea active chain instead of silently writing a second weight opinion", () => {
    const t = before(); t.sku_pack_levels.push({ id: "tea-chain", sku_id: RESALES[0]!.skuId, active: true });
    expect(find(t, RESALES[0]!.name).status).toBe("refused");
  });
});

describe("seed 26 target safety", () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: `https://${SIM_PROJECT_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: "test-only" };
  it("defaults dry with an explicit matching target and supports --dry-run", () => {
    expect(validateArgs(["--target", "sim"], env).execute).toBe(false);
    expect(validateArgs(["--target", "sim", "--dry-run"], env).execute).toBe(false);
  });
  it.each([[], ["--target", "prod"], ["--target", "sim", "--execute"], ["--target", "sim", "--dry-run", "--execute"], ["--target", "sim", "--wave7"]].map(args => ({ args })))("refuses invalid/unsafe arguments $args", ({ args }) => {
    expect(() => validateArgs(args, env)).toThrow();
  });
});
