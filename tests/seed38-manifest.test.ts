import { describe, expect, it } from "vitest";
import { buildWritePlan, latestPrice, MINI_ID, parseReview, reconcileBasis, rootContents, THOMPSON_ID, type Plan, type Snapshot } from "../scripts/seed/38-manifest";
import { HOSTS, INPUT_DIGEST, loadInputs, validateArgs, validateProvenance, validateSchema, verifyScope } from "../scripts/seed/38-catalog-repair";
import { isDestructive } from "../lib/destructive-actions";

const input = loadInputs();
const build = (live = structuredClone(input.baseline)) => buildWritePlan(input.csv, input.baseline, live, input.evidence);
function apply(plan: Plan, initial = input.baseline): Snapshot {
  const state = structuredClone(initial);
  for (const op of plan.operations) for (const m of op.mutations) {
    if (m.before) Object.assign(state[m.table].find(r => r.id === m.before!.id)!, m.after);
    else state[m.table].push({ ...m.after, ...(m.table === "vendor_price_history" ? { recorded_at: "2026-09-20T12:00:00.000000Z" } : {}) });
  }
  return state;
}
describe("seed38 real evidence manifest", () => {
  it("pins reviewed inputs and independent class counts", () => {
    expect(parseReview(input.csv)).toHaveLength(293);
    expect(input.digest).toBe(INPUT_DIGEST);
    const counts: Record<string, number> = {};
    for (const op of build().operations.filter(o => o.status === "ready")) counts[op.action] = (counts[op.action] ?? 0) + 1;
    expect(counts).toEqual({ "vendor.create": 1, "vendor.deactivate": 1, "vendor.merge": 1, "sku.vendor_repoint": 1, "sku.create": 1, "sku.item_number_set": 17, "sku.price_basis_set": 53, "sku.pack_level_supersede": 15, "sku.price_supersede": 13 });
  });
  it.each([["Butter", "per_each"], ["Duke's Mayo", "per_each"], ["Onion Powder", "per_lb"], ["Sour Cream", "per_case"], ["Turkey", "per_lb"], ["Ricotta", null]])("reconciles %s mechanically", (sku, basis) => {
    expect(build().basis.find(b => b.sku === sku)?.basis).toBe(basis);
  });
  it("honors ordered first-hit and the 3 percent boundary", () => {
    const e = input.evidence.find(e => e.item_no === "247189")!;
    expect(reconcileBasis(8.1, e).basis).toBe("per_case");
    expect(reconcileBasis(8.1 * 1.03, e).basis).toBe("per_case");
    expect(reconcileBasis(8.1 * 1.0301, e).basis).toBeNull();
  });
  it("preserves all price history, holds Ever Roast, and appends evidence-dated root prices", () => {
    const plan = build(), state = apply(plan);
    for (const price of input.baseline.vendor_price_history) expect(state.vendor_price_history.find(p => p.id === price.id)).toEqual(price);
    expect(plan.held).toContain("PC-001 Ever Roast Chicken: held, no vendor evidence");
    const pepperoni = plan.operations.find(o => o.key === "PC-002")!.mutations[0]!.after;
    expect(pepperoni).toMatchObject({ unit_price: 17.427575, effective_date: "2026-09-16" });
    expect(plan.operations.find(o => o.key === "PC-004")?.status).toBe("already");
    expect(plan.operations.find(o => o.key === "PC-008")!.mutations[0]!.after.unit_price).toBe(81.89);
  });
  it("reruns independent classes without writes", () => {
    expect(build(apply(build())).operations.every(o => o.status === "already")).toBe(true);
  });
  it("creates the Mini chain, with no invented item number or duplicate ordinal", () => {
    const state = apply(build());
    expect(state.vendor_items.find(s => s.id === MINI_ID)).toMatchObject({ vendor_id: THOMPSON_ID, item_number: null, units_per_pack: 60, each_size: 1 });
    expect(rootContents(state, MINI_ID)).toMatchObject({ quantity: 60, unit: "oz" });
  });
  it("records Utz at purchase-root prices and keeps all five single-bag identities", () => {
    const p = build(), prices = p.operations.filter(o => o.action === "sku.price_supersede" && o.key.startsWith("Utz:"));
    expect(prices.map(o => o.mutations[0]!.after.unit_price).sort((a, b) => Number(a) - Number(b))).toEqual([1.8, 1.8, 1.8, 1.8, 1.8, 23.4, 39.33]);
  });
  it("amends only the unlinked Eggs line and appends its note", () => {
    const live = structuredClone(input.baseline), line = live.order_guide_lines.find(l => l.id === "f08b2b60-5996-4ce8-bc63-2df9e6b8598c")!;
    line.note = "Existing note";
    const state = apply(build(live), live);
    expect(state.order_guide_lines.find(l => l.id === line.id)).toMatchObject({ sku_id: null, item_number: "517842", note: "Existing note\ntentative — confirm at the door" });
    expect(state.vendor_items.filter(s => s.name === "Eggs").map(s => s.item_number)).toEqual(["439686"]);
  });
  it("requires provenance on a rerun and refuses a partial class", () => {
    const initial = build(), final = build(apply(initial));
    expect(() => validateProvenance(final, initial, [], input.digest)).toThrow("missing provenance");
    const audits = [...new Set(initial.operations.filter(o => o.status === "ready").map(o => o.action))].map(action => ({ action, destructive: isDestructive(action), metadata: { input_digest: input.digest } }));
    expect(() => validateProvenance(final, initial, audits, input.digest)).not.toThrow();
    const partial = structuredClone(input.baseline);
    partial.vendor_items.find(s => s.id === "8cbebce5-b2e5-4da4-8a17-17a2d756ec12")!.item_number = "ICE1";
    expect(() => validateProvenance(build(partial), initial, [], input.digest)).toThrow("interrupted seed");
  });
  it("detects unrelated writes and accepts exactly the planned changes", () => {
    const plan = build(), state = apply(plan);
    expect(() => verifyScope(input.baseline, state, plan.operations)).not.toThrow();
    state.vendor_items[0]!.name = "Unrelated overwrite";
    expect(() => verifyScope(input.baseline, state, plan.operations)).toThrow("Unexpected/concurrent");
  });
  it("refuses missing migration 0210 and unexpected enum columns", () => {
    expect(() => validateSchema([], build())).toThrow("0210");
    expect(() => validateSchema([{ table_name: "vendor_items", column_name: "price_basis", data_type: "text", udt_name: "text" }, { table_name: "vendors", column_name: "id", data_type: "USER-DEFINED", udt_name: "unexpected" }], build())).toThrow("Unexpected enum");
  });
  it("repairs exact-number roots without deleting/reactivating history or touching Lettuce", () => {
    const plan = build(), state = apply(plan);
    for (const old of input.baseline.sku_pack_levels) {
      const after = state.sku_pack_levels.find(l => l.id === old.id)!;
      expect(after).toEqual({ ...old, active: after.active });
      if (!old.active) expect(after.active).toBe(false);
    }
    const lettuce = input.baseline.vendor_items.find(s => s.name === "Lettuce")!;
    expect(plan.operations.some(o => o.action === "sku.pack_level_supersede" && o.key === lettuce.id)).toBe(false);
    const oregano = input.baseline.vendor_items.find(s => s.name === "Oregano")!;
    expect(rootContents(state, String(oregano.id))?.quantity).toBe(80);
  });
  it("refuses same-vendor item-number collisions", () => {
    const live = structuredClone(input.baseline), target = live.vendor_items.find(s => s.id === "8cbebce5-b2e5-4da4-8a17-17a2d756ec12")!;
    live.vendor_items.push({ ...target, id: "collision", item_number: "ICE1" });
    expect(() => build(live)).toThrow("item-number collision");
  });
  it("refuses replacing a different non-null number", () => {
    const live = structuredClone(input.baseline);
    live.vendor_items.find(s => s.id === "8cbebce5-b2e5-4da4-8a17-17a2d756ec12")!.item_number = "other";
    expect(() => build(live)).toThrow("different non-null");
  });
  it("refuses any Delmar SKU, including inactive", () => {
    const live = structuredClone(input.baseline);
    live.vendor_items.push({ id: "unexpected", vendor_id: live.vendors.find(v => v.name === "Delmar Provisions")!.id, active: false });
    expect(() => build(live)).toThrow("literally 0 SKUs");
  });
  it("refuses missing Ripples and a conflated identity", () => {
    const live = structuredClone(input.baseline);
    live.vendor_items = live.vendor_items.filter(s => s.name !== "Utz Ripples");
    expect(() => build(live)).toThrow("Reviewed SKU");
    const conflated = structuredClone(input.baseline);
    conflated.vendor_items.find(s => s.name === "Utz Ripples")!.each_size = 2.75;
    expect(() => build(conflated)).toThrow("sku_identity_split_needed");
  });
  it("refuses a newer price rather than claiming the evidence append wins", () => {
    const live = structuredClone(input.baseline), price = live.vendor_price_history.find(p => p.vendor_item_id === "fa14310e-aaa0-4376-be09-09a39f49ddab")!;
    live.vendor_price_history.push({ ...price, id: "newer", effective_date: "2026-09-21" });
    expect(() => build(live)).toThrow("latest price changed since review");
  });
  it("keeps PostgreSQL microsecond and NULL ordering", () => {
    const rows = [{ id: "a", vendor_item_id: "s", effective_date: "2026-09-18", recorded_at: "2026-09-19T00:00:00.000999Z" }, { id: "b", vendor_item_id: "s", effective_date: "2026-09-18", recorded_at: "2026-09-19T00:00:00.000001Z" }];
    expect(latestPrice(rows, "s")?.id).toBe("a");
    expect(latestPrice([...rows, { ...rows[0]!, id: "null", recorded_at: null }], "s")?.id).toBe("null");
  });
  it("adjudicates every requested action", () => {
    for (const action of ["vendor.create", "sku.create", "sku.item_number_set", "sku.price_basis_set"]) expect(isDestructive(action)).toBe(false);
    for (const action of ["vendor.deactivate", "vendor.merge", "sku.pack_level_supersede", "sku.price_supersede", "sku.vendor_repoint"]) expect(isDestructive(action)).toBe(true);
  });
});
describe("seed38 CLI guard (no client created)", () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: `https://${HOSTS.sim}` };
  it("defaults to read-only, allows inferred known target only for dry-run", () => {
    expect(validateArgs([], env)).toMatchObject({ execute: false, target: "sim" });
    expect(() => validateArgs(["--execute"], env)).toThrow("requires --target");
  });
  it("checks the fixed target and prod word flag", () => {
    expect(() => validateArgs(["--target", "prod"], env)).toThrow("mismatch");
    const prod = { NEXT_PUBLIC_SUPABASE_URL: `https://${HOSTS.prod}` };
    expect(() => validateArgs(["--execute", "--target", "prod"], prod)).toThrow("--i-have-juans-word");
    expect(validateArgs(["--execute", "--target", "prod", "--i-have-juans-word"], prod).execute).toBe(true);
  });
  it.each([['--execute', '--dry-run', '--target', 'sim'], ['--target', 'sim', '--target', 'sim'], ['--unknown']])("refuses malformed args %j", (...args) => {
    expect(() => validateArgs(args, env)).toThrow();
  });
  it.each(["https://evil.example", `https://${HOSTS.sim}.evil.example`, `https://user:pass@${HOSTS.sim}`, `http://${HOSTS.sim}`, `https://${HOSTS.sim}/unexpected`])("refuses URL %s", url => {
    expect(() => validateArgs([], { NEXT_PUBLIC_SUPABASE_URL: url })).toThrow();
  });
});
