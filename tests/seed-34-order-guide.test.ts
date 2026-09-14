import { describe, expect, it } from "vitest";
import { PARS, RHYTHM, planOrderGuide, validateArgs, verifyWriteScope, type Tables } from "@/scripts/seed/34-order-guide-2026-09-13";
import { SIM_PROJECT_REF } from "@/lib/sim-isolation-shared";

const BH = "bh", SARAH = "sarah", LOC_A = "loc-a", LOC_B = "loc-b";
function before(): Tables {
  const t: Tables = { vendor_items: [], vendors: [], locations: [], vendor_delivery_rhythm: [], vendor_cutoffs: [] };
  t.vendors.push({ id: BH, name: "Boar's Head", active: true }, { id: SARAH, name: "Sarah", active: true }, { id: "pfg", name: "PFG", active: true });
  t.locations.push({ id: LOC_A, name: "Capitol Hill", active: true }, { id: LOC_B, name: "P Street", active: true }, { id: "old", name: "Closed", active: false });
  for (const spec of PARS) t.vendor_items.push({ id: `sku-${spec.name}`, name: spec.name, vendor_id: spec.vendor === "Sarah" ? SARAH : BH, active: true, ...spec.before });
  t.vendor_delivery_rhythm.push({ id: "pfg-pair", vendor_id: "pfg", location_id: LOC_A, order_dow: 1, lead_days: 1, active: true });
  t.vendor_cutoffs.push({ id: "pfg-cut", vendor_id: "pfg", location_id: null, order_day: 1, cutoff_time: "16:00:00", active: true });
  return t;
}
function after(): Tables {
  const t = before();
  for (const spec of PARS) Object.assign(t.vendor_items.find(r => r.name === spec.name)!, spec.after, { updated_at: "later" });
  for (const loc of [LOC_A, LOC_B]) for (const x of RHYTHM.pairs) t.vendor_delivery_rhythm.push({ id: `${loc}-${x.order_dow}`, vendor_id: SARAH, location_id: loc, ...x, active: true });
  for (const x of RHYTHM.cutoffs) t.vendor_cutoffs.push({ id: `cut-${x.order_day}`, vendor_id: SARAH, location_id: null, ...x, active: true });
  return t;
}

describe("seed 34 planner", () => {
  it("plans four pars and one rhythm set from the pinned before-state", () => {
    const plans = planOrderGuide(before());
    expect(plans.map(p => [p.section, p.name, p.status])).toEqual([...PARS.map(s => ["pars", s.name, "ready"]), ["rhythm", "Sarah", "ready"]]);
    expect(plans.find(p => p.name === "Gluten Free Bread")!.before).toEqual({ weekday_par: 14, weekend_par: null });
  });
  it("is idempotent on the modelled after-state", () => {
    expect(planOrderGuide(after()).map(p => p.status)).toEqual(Array(PARS.length + 1).fill("already"));
  });
  it("refuses a moved par and a vendor with a different live rhythm", () => {
    const t = before();
    t.vendor_items.find(r => r.name === "Just Ice Tea Lemon")!.weekday_par = 5;
    t.vendor_delivery_rhythm.push({ id: "stray", vendor_id: SARAH, location_id: LOC_A, order_dow: 2, lead_days: 1, active: true });
    const plans = planOrderGuide(t);
    expect(plans.find(p => p.name === "Just Ice Tea Lemon")!.reason).toMatch(/before-state/);
    expect(plans.find(p => p.section === "rhythm")!.reason).toMatch(/different live rhythm/);
  });
  it("marks a SKU or vendor missing on the target absent", () => {
    const t = before();
    t.vendor_items = t.vendor_items.filter(r => r.name !== "Just Ice Tea Raspberry");
    t.vendors = t.vendors.filter(v => v.id !== SARAH);
    const plans = planOrderGuide(t);
    expect(plans.find(p => p.name === "Just Ice Tea Raspberry")!.status).toBe("absent");
    expect(plans.find(p => p.section === "rhythm")!.status).toBe("absent");
    expect(plans.find(p => p.name === "Gluten Free Bread")!.status).toBe("absent");
  });
  it("write-scope verifier accepts each operation's own writes and rejects an unrelated change", () => {
    const b = before(), a = after();
    const rhythmPlan = planOrderGuide(b).find(p => p.section === "rhythm")!;
    const rhythmOnly = before();
    rhythmOnly.vendor_delivery_rhythm.push(...a.vendor_delivery_rhythm.filter(r => r.vendor_id === SARAH));
    rhythmOnly.vendor_cutoffs.push(...a.vendor_cutoffs.filter(r => r.vendor_id === SARAH));
    expect(() => verifyWriteScope(b, rhythmOnly, rhythmPlan)).not.toThrow();
    const parPlan = planOrderGuide(b).find(p => p.name === "Gluten Free Bread")!;
    const parOnly = before();
    Object.assign(parOnly.vendor_items.find(r => r.name === "Gluten Free Bread")!, { weekday_par: 27, weekend_par: 27, updated_at: "later" });
    expect(() => verifyWriteScope(b, parOnly, parPlan)).not.toThrow();
    expect(() => verifyWriteScope(b, rhythmOnly, parPlan)).toThrow(/unrelated\/concurrent vendor_delivery_rhythm/);
    const drift = before();
    drift.vendors.find(v => v.id === "pfg")!.name = "PFG Foods";
    expect(() => verifyWriteScope(b, drift, parPlan)).toThrow(/unrelated\/concurrent vendors/);
  });
  it("derives Sarah's delivery days from the sheet: Sunday → Tuesday, Thursday → Saturday", () => {
    expect(RHYTHM.pairs.map(x => (x.order_dow + x.lead_days) % 7)).toEqual([2, 6]);
  });
  it("validateArgs keeps seed 26's target guard", () => {
    expect(() => validateArgs(["--dry-run", "--execute", "--target", "sim"])).toThrow(/Conflicting/);
    expect(validateArgs(["--target", "sim", "--dry-run"], { NEXT_PUBLIC_SUPABASE_URL: `https://${SIM_PROJECT_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: "k" }).target).toBe("sim");
  });
});
