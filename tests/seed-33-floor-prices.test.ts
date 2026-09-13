import { describe, expect, it } from "vitest";
import { EFFECTIVE_DATE, PFG, ROWS, SOURCE, packChain, planFloorPrices, priceOrder, validateArgs, verifyWriteScope, type Tables } from "@/scripts/seed/33-floor-prices-2026-09-12";
import { deriveFlatFieldsFromChain } from "@/lib/admin/catalog-shared";
import { skuContentOz, type MeasureUnitFactor } from "@/lib/recipe-math";
import { SIM_PROJECT_REF } from "@/lib/sim-isolation-shared";

const MEASURES = ["oz", "each", "can", "gallon", "liter", "#10 can"];
const dimension = (label: string) => label === "oz" ? "weight" : ["gallon", "liter", "#10 can"].includes(label) ? "volume" : "count";
function before(): Tables {
  const t: Tables = { vendor_items: [], sku_pack_levels: [], measure_units: [], vendor_price_history: [] };
  t.measure_units = MEASURES.map(label => ({ id: label, label, active: true, dimension: dimension(label), to_base_factor: 1 }));
  for (const row of ROWS) {
    const flat = row.pack?.before ?? { pack_format: "Case", units_per_pack: 1, each_size: 64, each_measure: "oz" };
    t.vendor_items.push({ id: row.id, name: row.name, vendor_id: PFG, active: true, ...flat, avg_oz_per_each: null, each_container_label: null, weight_class: null });
    if (row.name !== "Eggs (cooked)" && row.name !== "Balsamic Glaze") t.sku_pack_levels.push({ id: `chain-${row.id}`, sku_id: row.id, active: true, label: flat.pack_format.toLowerCase(), contains_qty: flat.each_size, contains_level_id: null, contains_measure_unit: flat.each_measure, display_ordinal: 0 });
  }
  t.vendor_price_history.push({ id: "lemon-wave7", vendor_item_id: "6004d43b-f624-4884-bdb2-5e195ebc6c87", unit_price: "32.70", effective_date: "2026-08-14", recorded_at: "2026-09-10T00:00:00Z", source: "angel-wave7-2026-09-10" });
  t.vendor_price_history.push({ id: "dijon-old", vendor_item_id: "dbff905e-1086-43f5-bc07-f05bcadd0eb6", unit_price: "22.68", effective_date: "2026-07-01", recorded_at: "2026-07-01T00:00:00Z", source: null });
  return t;
}
function applyPack(t: Tables, row: (typeof ROWS)[number]): void {
  if (!row.pack) return;
  Object.assign(t.vendor_items.find(r => r.id === row.id)!, row.pack.after, row.pack.setAvg != null ? { avg_oz_per_each: row.pack.setAvg } : {}, row.pack.containerLabel != null ? { each_container_label: row.pack.containerLabel } : {}, { updated_at: "later" });
  for (const l of t.sku_pack_levels.filter(r => r.sku_id === row.id)) l.active = false;
  t.sku_pack_levels.push(...packChain(row.pack).map((l, i) => ({ id: `${row.id}-${i}`, sku_id: row.id, active: true, label: l.label, contains_qty: l.containsQty, contains_level_id: l.containsIndex == null ? null : `${row.id}-${l.containsIndex}`, contains_measure_unit: l.containsMeasureUnit, display_ordinal: i })));
}
function applyPrice(t: Tables, row: (typeof ROWS)[number]): void {
  t.vendor_price_history.push({ id: `floor-${row.id}`, vendor_item_id: row.id, unit_price: String(row.price), effective_date: EFFECTIVE_DATE, recorded_at: "2026-09-12T20:00:00Z", source: SOURCE });
}
function after(): Tables {
  const t = before();
  for (const row of ROWS) { applyPack(t, row); if (row.name !== "Lemon Juice") applyPrice(t, row); }
  return t;
}
const measures = new Map<string, MeasureUnitFactor>(MEASURES.map(l => [l, { dimension: dimension(l) as MeasureUnitFactor["dimension"], toBaseFactor: 1 }]));

describe("seed 33 planner", () => {
  it("plans nine pack restatements and thirteen prices, with Lemon Juice already priced", () => {
    const plans = planFloorPrices(before());
    expect(plans.filter(p => p.section === "packs").map(p => [p.name, p.status])).toEqual(ROWS.filter(r => r.pack).map(r => [r.name, "ready"]));
    expect(plans.filter(p => p.section === "packs")).toHaveLength(9);
    const prices = plans.filter(p => p.section === "prices");
    expect(prices).toHaveLength(14);
    expect(prices.find(p => p.name === "Lemon Juice")!.status).toBe("already");
    expect(prices.filter(p => p.status === "ready")).toHaveLength(13);
    expect(prices.find(p => p.name === "Mustard (Dijon)")!.before).toEqual({ unit_price: 22.68, effective_date: "2026-07-01", source: null });
  });
  it("is idempotent on the modelled after-state", () => {
    expect(planFloorPrices(after()).map(p => p.status)).toEqual(Array(23).fill("already"));
  });
  it("refuses a drifted pack before-state and a newer app price", () => {
    const t = before();
    t.vendor_items.find(r => r.name === "Grapeseed Oil")!.each_size = 202.86;
    t.vendor_price_history.push({ id: "newer", vendor_item_id: "2a705f78-7ea1-409d-a15f-5f45040dac71", unit_price: "14.10", effective_date: "2026-09-20", recorded_at: "2026-09-20T00:00:00Z", source: null });
    const plans = planFloorPrices(t);
    expect(plans.find(p => p.section === "packs" && p.name === "Grapeseed Oil")!).toMatchObject({ status: "refused", reason: "Flat pack differs from expected before-state" });
    expect(plans.find(p => p.section === "prices" && p.name === "Old Bay")!.reason).toMatch(/Newer price exists/);
  });
  it("refuses a different price under this source instead of appending a second one", () => {
    const t = before();
    t.vendor_price_history.push({ id: "mine", vendor_item_id: "2a705f78-7ea1-409d-a15f-5f45040dac71", unit_price: "13.00", effective_date: EFFECTIVE_DATE, recorded_at: "2026-09-12T00:00:00Z", source: SOURCE });
    expect(planFloorPrices(t).find(p => p.section === "prices" && p.name === "Old Bay")!.reason).toMatch(/explicit correction/);
  });
  it("marks a SKU missing on the target absent, never refused", () => {
    const t = before();
    t.vendor_items = t.vendor_items.filter(r => r.name !== "Balsamic Glaze");
    expect(planFloorPrices(t).filter(p => p.name === "Balsamic Glaze").map(p => p.status)).toEqual(["absent", "absent"]);
  });
  it("chains derive the pinned flat fields, shadow no measure, and total the invoice contents", () => {
    for (const row of ROWS) {
      if (!row.pack) continue;
      const chain = packChain(row.pack), derived = deriveFlatFieldsFromChain(chain);
      expect({ pack_format: derived.packFormat, units_per_pack: derived.unitsPerPack, each_size: derived.eachSize, each_measure: derived.eachMeasure }).toEqual(row.pack.after);
      expect(chain.map(l => l.label).some(l => MEASURES.includes(l))).toBe(false);
    }
    const oz = (name: string) => {
      const row = ROWS.find(r => r.name === name)!;
      const sku = { ...row.pack!.after, avg_oz_per_each: row.pack!.setAvg ?? null, packChain: packChain(row.pack!).map((l, i) => ({ id: String(i), label: l.label, containsQty: l.containsQty, containsLevelId: l.containsIndex == null ? null : String(l.containsIndex), containsMeasureUnit: l.containsMeasureUnit })) };
      return skuContentOz(sku as never, measures);
    };
    expect(oz("Confectioners Sugar")).toBe(384);
    expect(oz("Red wine vinegar")).toBe(512);
    expect(oz("Grapeseed Oil")).toBeCloseTo(338.14, 2);
  });
  it("write-scope verifier accepts each operation's own writes and rejects an unrelated change", () => {
    const b = before();
    const eggs = ROWS.find(r => r.name === "Eggs (cooked)")!, chives = ROWS.find(r => r.name === "Chives")!;
    const packPlan = planFloorPrices(b).find(p => p.section === "packs" && p.name === eggs.name)!;
    const packAfter = before(); applyPack(packAfter, eggs);
    expect(() => verifyWriteScope(b, packAfter, packPlan)).not.toThrow();
    const pricePlan = planFloorPrices(b).find(p => p.section === "prices" && p.name === chives.name)!;
    const priceAfter = before(); applyPrice(priceAfter, chives);
    expect(() => verifyWriteScope(b, priceAfter, pricePlan)).not.toThrow();
    // A pack write landing during a price operation is a concurrent change, not this operation's scope.
    expect(() => verifyWriteScope(b, packAfter, pricePlan)).toThrow(/unrelated\/concurrent vendor_items/);
    const drift = before(); applyPrice(drift, chives);
    drift.vendor_items.find(r => r.name === "Chives")!.name = "Chives (fresh)";
    expect(() => verifyWriteScope(b, drift, pricePlan)).toThrow(/unrelated\/concurrent vendor_items/);
  });
  it("priceOrder is newest-first by effective date, then recorded_at, then id", () => {
    const rows = [{ id: "a", effective_date: "2026-09-01", recorded_at: "x" }, { id: "b", effective_date: "2026-09-12", recorded_at: "2026-09-12T01:00:00Z" }, { id: "c", effective_date: "2026-09-12", recorded_at: "2026-09-12T02:00:00Z" }];
    expect(priceOrder(rows).map(r => r.id)).toEqual(["c", "b", "a"]);
  });
  it("validateArgs keeps seed 26's target guard", () => {
    expect(() => validateArgs(["--dry-run", "--execute", "--target", "sim"])).toThrow(/Conflicting/);
    expect(validateArgs(["--target", "sim", "--dry-run"], { NEXT_PUBLIC_SUPABASE_URL: `https://${SIM_PROJECT_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: "k" }).target).toBe("sim");
  });
});
