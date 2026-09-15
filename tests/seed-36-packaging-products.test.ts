import { describe, expect, it } from "vitest";
import { PAIRS, SOURCE, planPackagingProducts, validateArgs, verifyWriteScope, type Tables } from "@/scripts/seed/36-packaging-products";
import { SIM_PROJECT_REF } from "@/lib/sim-isolation-shared";

const V: Record<string, string> = { PFG: "v-pfg", "Leonard Paper": "v-leo", Baldor: "v-bal", Trimark: "v-tri", "US Foods": "v-usf", Amazon: "v-amz", Webstaurant: "v-web" };
function before(): Tables {
  const t: Tables = { vendor_items: [], vendors: [], products: [], product_primaries: [] };
  for (const [name, id] of Object.entries(V)) t.vendors.push({ id, name, active: true });
  for (const p of PAIRS) for (const m of p.members) t.vendor_items.push({ id: `${m.name}|${m.vendor}`, name: m.name, vendor_id: V[m.vendor]!, active: true, product_id: null });
  return t;
}
function after(): Tables {
  const t = before();
  for (const p of PAIRS) {
    const id = `prod-${p.product}`;
    t.products.push({ id, name: p.product, active: true, notes: `[${SOURCE}] …` });
    for (const m of p.members) Object.assign(t.vendor_items.find(r => r.id === `${m.name}|${m.vendor}`)!, { product_id: id, updated_at: "later" });
  }
  return t;
}

describe("seed 36 planner", () => {
  it("plans one product per pair, all ready, none with a designated primary", () => {
    const plans = planPackagingProducts(before());
    expect(plans).toHaveLength(PAIRS.length);
    expect(plans.every(p => p.status === "ready")).toBe(true);
    expect(plans.every(p => (p.after as { primary: unknown }).primary === null)).toBe(true);
  });
  it("is idempotent on the modelled after-state, and respects a primary a manager set since", () => {
    const t = after();
    expect(planPackagingProducts(t).every(p => p.status === "already")).toBe(true);
    t.product_primaries.push({ id: "pp", product_id: "prod-Plastic forks", location_id: null, primary_sku_id: "Plastic forks|Leonard Paper" });
    const plan = planPackagingProducts(t).find(p => p.name === "Plastic forks")!;
    expect(plan.status).toBe("already");
    expect(plan.reason).toMatch(/manager has since designated/);
  });
  it("refuses a member that already belongs to another product, a foreign product with the name, and an interrupted pair", () => {
    const t = before();
    t.vendor_items.find(r => r.id === "Plastic forks|PFG")!.product_id = "someone-else";
    t.products.push({ id: "foreign", name: "Gloves Medium", active: true, notes: "made in the app" });
    t.products.push({ id: "mine", name: "Foil roll", active: true, notes: `[${SOURCE}] partial` });
    t.vendor_items.find(r => r.id === "Foil roll|PFG")!.product_id = "mine";
    const plans = planPackagingProducts(t);
    expect(plans.find(p => p.name === "Plastic forks")!.reason).toMatch(/another product/);
    expect(plans.find(p => p.name === "Gloves Medium")!.reason).toMatch(/did not create/);
    expect(plans.find(p => p.name === "Foil roll")!.reason).toMatch(/interrupted pair/);
  });
  it("marks a pair absent when a member is missing on the target", () => {
    const t = before();
    t.vendor_items = t.vendor_items.filter(r => r.id !== "Cannoli Shell|Baldor");
    expect(planPackagingProducts(t).find(p => p.name === "Cannoli Shell")!.status).toBe("absent");
  });
  it("write-scope verifier accepts one pair's writes and rejects a stray change", () => {
    const b = before();
    const plan = planPackagingProducts(b).find(p => p.name === "Plastic forks")!;
    const one = before();
    one.products.push({ id: "prod-Plastic forks", name: "Plastic forks", active: true });
    for (const m of PAIRS.find(p => p.product === "Plastic forks")!.members) Object.assign(one.vendor_items.find(r => r.id === `${m.name}|${m.vendor}`)!, { product_id: "prod-Plastic forks", updated_at: "later" });
    expect(() => verifyWriteScope(b, one, plan)).not.toThrow();
    one.vendor_items.find(r => r.id === "Plastic Spoons|PFG")!.product_id = "stray";
    expect(() => verifyWriteScope(b, one, plan)).toThrow(/unrelated\/concurrent vendor_items/);
  });
  it("validateArgs keeps seed 26's target guard", () => {
    expect(() => validateArgs(["--dry-run", "--execute", "--target", "sim"])).toThrow(/Conflicting/);
    expect(validateArgs(["--target", "sim", "--dry-run"], { NEXT_PUBLIC_SUPABASE_URL: `https://${SIM_PROJECT_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: "k" }).target).toBe("sim");
  });
});
