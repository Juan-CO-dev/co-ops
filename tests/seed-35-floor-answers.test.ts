import { describe, expect, it } from "vitest";
import { IDS, LEMON_OIL, LEONARD_RHYTHM, PARS, TWINS, planFloorAnswers, validateArgs, verifyWriteScope, type Tables } from "@/scripts/seed/35-floor-answers-2026-09-13";
import { SIM_PROJECT_REF } from "@/lib/sim-isolation-shared";

const V: Record<string, string> = { PFG: "v-pfg", "Boar's Head": "v-bh", Trimark: "v-tri", "Leonard Paper": "v-leo", Baldor: "v-bal", "Penny Candy": "v-pc", Amazon: "v-amz", "US Foods": "v-usf", Webstaurant: "v-web" };
function before(): Tables {
  const t: Tables = { vendor_items: [], vendors: [], locations: [], items: [], recipes: [], recipe_inputs: [], recipe_outputs: [], vendor_delivery_rhythm: [], vendor_cutoffs: [] };
  for (const [name, id] of Object.entries(V)) t.vendors.push({ id, name, active: true });
  t.locations.push({ id: "loc-a", name: "Capitol Hill", active: true }, { id: "loc-b", name: "P Street", active: true });
  t.items.push({ id: IDS.salsaVerdeItem, name: "Salsa Verde", location_id: null, active: true }, { id: IDS.greenGoddessItem, name: "Green Goddess", location_id: null, active: true });
  t.recipes.push({ id: "r-farmers", name: "Farmers Market After Dark (build)", active: true }, { id: "r-cheddar", name: "Never Been Cheddar (build)", active: true });
  t.recipe_inputs.push({ id: IDS.farmersInput, recipe_id: "r-farmers", component_sku_id: null, component_item_id: IDS.greenGoddessItem, component_product_id: null, quantity: 0.5, unit: "oz" });
  t.recipe_inputs.push({ id: IDS.cheddarInput, recipe_id: "r-cheddar", component_sku_id: IDS.lemonOilSku, component_item_id: null, component_product_id: null, quantity: 0.1, unit: "oz" });
  t.vendor_items.push({ id: IDS.lemonOilSku, name: "Lemon Oil", vendor_id: null, active: true });
  for (const i of LEMON_OIL.inputs) t.vendor_items.push({ id: i.sku, name: i.name, vendor_id: V.PFG, active: true });
  for (const spec of PARS) if (!t.vendor_items.some(r => r.name === spec.name && r.vendor_id === V[spec.vendor])) t.vendor_items.push({ id: `sku-${spec.name}`, name: spec.name, vendor_id: V[spec.vendor], active: true, weekday_par: 1, weekend_par: 2 });
  const siblingVendor: Record<string, string> = { "Oven Cleaner": V["US Foods"]!, "Butcher Paper": V.Trimark!, "Trash Liners 40x46": V.Trimark!, "Plastic Wraop": V.Trimark!, "Toilet Paper": V.Amazon!, "Stainless Steel Scrubbies": V.Webstaurant! };
  for (const spec of TWINS) if (spec.sibling && !t.vendor_items.some(r => r.name === spec.sibling)) t.vendor_items.push({ id: `sib-${spec.sibling}`, name: spec.sibling, vendor_id: siblingVendor[spec.sibling] ?? V.PFG, active: true, pack_format: "Case", inventory_only: true, sku_class: "packaging" });
  for (const loc of ["loc-a", "loc-b"]) for (const dow of [1, 2, 3, 4, 5]) t.vendor_delivery_rhythm.push({ id: `leo-${loc}-${dow}`, vendor_id: V["Leonard Paper"], location_id: loc, order_dow: dow, lead_days: 1, active: true });
  for (const dow of [1, 2, 3, 4, 5]) t.vendor_cutoffs.push({ id: `leo-cut-${dow}`, vendor_id: V["Leonard Paper"], location_id: null, order_day: dow, cutoff_time: "15:30:00", active: true });
  return t;
}
function after(): Tables {
  const t = before();
  t.recipe_inputs.find(r => r.id === IDS.farmersInput)!.component_item_id = IDS.salsaVerdeItem;
  const note = `[floor-answers-2026-09-13] ${LEMON_OIL.source}`;
  t.items.push({ id: "item-lemon", name: "Lemon Oil", location_id: null, active: true, notes: note });
  t.recipes.push({ id: "r-lemon", name: "Lemon Oil", recipe_type: "production", batch_yield: 1, active: true, notes: note });
  LEMON_OIL.inputs.forEach((i, k) => t.recipe_inputs.push({ id: `li-${k}`, recipe_id: "r-lemon", component_sku_id: i.sku, component_item_id: null, quantity: i.quantity, unit: i.unit }));
  t.recipe_outputs.push({ id: "lo", recipe_id: "r-lemon", output_item_id: "item-lemon", yield: 1 });
  Object.assign(t.recipe_inputs.find(r => r.id === IDS.cheddarInput)!, { component_sku_id: null, component_item_id: "item-lemon" });
  Object.assign(t.vendor_items.find(r => r.id === IDS.lemonOilSku)!, { active: false, updated_at: "later" });
  for (const spec of TWINS) t.vendor_items.push({ id: `twin-${spec.name}`, name: spec.name, vendor_id: V[spec.vendor], active: true, item_number: spec.item_number, weekday_par: spec.weekday, weekend_par: spec.weekend, notes: `[floor-answers-2026-09-13] ...` });
  for (const spec of PARS) Object.assign(t.vendor_items.find(r => r.name === spec.name && r.vendor_id === V[spec.vendor])!, { weekday_par: spec.weekday, weekend_par: spec.weekend ?? 2, updated_at: "later" });
  for (const r of t.vendor_delivery_rhythm) r.active = false;
  for (const r of t.vendor_cutoffs) r.active = false;
  for (const loc of ["loc-a", "loc-b"]) for (const x of LEONARD_RHYTHM.pairs) t.vendor_delivery_rhythm.push({ id: `new-${loc}-${x.order_dow}`, vendor_id: V["Leonard Paper"], location_id: loc, ...x, active: true });
  for (const x of LEONARD_RHYTHM.pairs) t.vendor_cutoffs.push({ id: `newcut-${x.order_dow}`, vendor_id: V["Leonard Paper"], location_id: null, order_day: x.order_dow, cutoff_time: LEONARD_RHYTHM.cutoff, active: true });
  return t;
}

describe("seed 35 planner", () => {
  it("plans every section ready from the pinned before-state", () => {
    const plans = planFloorAnswers(before());
    expect(plans.filter(p => p.section === "recipes").map(p => p.status)).toEqual(["ready", "ready"]);
    expect(plans.filter(p => p.section === "twins")).toHaveLength(TWINS.length);
    expect(plans.filter(p => p.section === "pars")).toHaveLength(PARS.length);
    expect(plans.filter(p => p.status === "refused")).toEqual([]);
    expect(plans.find(p => p.section === "rhythm")!.status).toBe("ready");
  });
  it("is idempotent on the modelled after-state", () => {
    const plans = planFloorAnswers(after());
    expect(plans.filter(p => p.status !== "already").map(p => [p.name, p.status, p.reason])).toEqual([]);
  });
  it("refuses the wrong Farmers line, a partial Lemon Oil, and a twin that already differs", () => {
    const t = before();
    t.recipe_inputs.find(r => r.id === IDS.farmersInput)!.quantity = 1;
    t.items.push({ id: "half", name: "Lemon Oil", location_id: null, active: true });
    t.vendor_items.push({ id: "dup", name: "Plastic forks", vendor_id: V["Leonard Paper"], active: true, item_number: "OLD", weekday_par: 9 });
    const plans = planFloorAnswers(t);
    expect(plans.find(p => p.name.startsWith("Farmers"))!.reason).toMatch(/0.5 oz Green Goddess/);
    expect(plans.find(p => p.name.startsWith("Lemon Oil"))!.reason).toMatch(/partial Lemon Oil/);
    expect(plans.find(p => p.name === "Plastic forks (Leonard Paper)")!.reason).toMatch(/different values/);
  });
  it("refuses to retire a placeholder SKU another recipe still uses", () => {
    const t = before();
    t.recipe_inputs.push({ id: "other", recipe_id: "r-x", component_sku_id: IDS.lemonOilSku, quantity: 1, unit: "oz" });
    expect(planFloorAnswers(t).find(p => p.name.startsWith("Lemon Oil"))!.reason).toMatch(/still used by 1/);
  });
  it("treats missing rows as absent", () => {
    const t = before();
    t.vendor_items = t.vendor_items.filter(r => r.name !== "Turkey" && r.name !== "Cannoli Shell");
    t.vendors = t.vendors.filter(v => v.id !== V.Baldor);
    const plans = planFloorAnswers(t);
    expect(plans.find(p => p.name === "Turkey")!.status).toBe("absent");
    expect(plans.find(p => p.name === "Cannoli Shell (Baldor)")!.status).toBe("absent");
  });
  it("Lemon Oil inputs total one 16 oz bottle and Leonard's pairs land on Monday and Friday", () => {
    expect(LEMON_OIL.inputs.reduce((s, i) => s + i.quantity, 0)).toBeCloseTo(16, 2);
    expect(LEONARD_RHYTHM.pairs.map(x => (x.order_dow + x.lead_days) % 7)).toEqual([1, 5]);
  });
  it("write-scope verifier accepts each operation's own writes and rejects a stray change", () => {
    const b = before(), a = after();
    const plans = planFloorAnswers(b);
    const par = plans.find(p => p.name === "Turkey")!;
    const parOnly = before(); Object.assign(parOnly.vendor_items.find(r => r.name === "Turkey")!, { weekday_par: 9, weekend_par: 22, updated_at: "later" });
    expect(() => verifyWriteScope(b, parOnly, par)).not.toThrow();
    const rhythm = plans.find(p => p.section === "rhythm")!;
    const rhythmOnly = before();
    for (const r of rhythmOnly.vendor_delivery_rhythm) r.active = false; for (const r of rhythmOnly.vendor_cutoffs) r.active = false;
    rhythmOnly.vendor_delivery_rhythm.push(...a.vendor_delivery_rhythm.filter(r => String(r.id).startsWith("new-")));
    rhythmOnly.vendor_cutoffs.push(...a.vendor_cutoffs.filter(r => String(r.id).startsWith("newcut-")));
    expect(() => verifyWriteScope(b, rhythmOnly, rhythm)).not.toThrow();
    expect(() => verifyWriteScope(b, rhythmOnly, par)).toThrow(/unrelated\/concurrent vendor_delivery_rhythm/);
    const lemon = plans.find(p => p.name.startsWith("Lemon Oil"))!;
    const lemonOnly = before();
    lemonOnly.items.push(a.items.find(i => i.id === "item-lemon")!); lemonOnly.recipes.push(a.recipes.find(r => r.id === "r-lemon")!);
    lemonOnly.recipe_inputs.push(...a.recipe_inputs.filter(r => r.recipe_id === "r-lemon")); lemonOnly.recipe_outputs.push(...a.recipe_outputs);
    Object.assign(lemonOnly.recipe_inputs.find(r => r.id === IDS.cheddarInput)!, { component_sku_id: null, component_item_id: "item-lemon" });
    Object.assign(lemonOnly.vendor_items.find(r => r.id === IDS.lemonOilSku)!, { active: false, updated_at: "later" });
    expect(() => verifyWriteScope(b, lemonOnly, lemon)).not.toThrow();
  });
  it("validateArgs keeps seed 26's target guard", () => {
    expect(() => validateArgs(["--dry-run", "--execute", "--target", "sim"])).toThrow(/Conflicting/);
    expect(validateArgs(["--target", "sim", "--dry-run"], { NEXT_PUBLIC_SUPABASE_URL: `https://${SIM_PROJECT_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: "k" }).target).toBe("sim");
  });
});
