/**
 * Wave 8, CC's production observations 2026-09-11 and Juan's authorized build sheet.
 * Dry-run default. CC runs sim, then prod; this module never loads an env file.
 * --target sim|prod [--dry-run | --execute --plan-digest <dry-run digest>]
 * Uses seed 26's target/project/production-confirmation guards unchanged.
 * No schema changes or new audit actions. Direct writes follow seeds 16/22/31;
 * they are NOT a transaction. An interrupted multi-row operation refuses on retry
 * for CC to reconcile; it never silently accepts a partially corrected row.
 * recipe_inputs has no note column (0103/0179): input-specific source notes live
 * in recipes.notes, keyed by input id, and in recipe_input.update audit metadata.
 */
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveFlatFieldsFromChain, type StarterChainLevel } from "@/lib/admin/catalog-shared";
import { firstLabelMeasureCollision } from "@/lib/pack-chain-shared";
import { canonical, type RawRow } from "@/lib/angel-wave7";
import type { AuditAction } from "@/lib/audit-actions";
import { createWave7Client, loadAll, validateTarget } from "./26-angel-wave7";

export const SOURCE = "costing-wave8-2026-09-11";
const PFG = "a0d8986c-e097-46f0-9e3f-e70943d4291b";
const BH = "aff69f0d-0a7e-4b6f-9371-3eef47df86e3";
const flat = (pack_format: string, units_per_pack: number, each_size: number, each_measure: string) => ({ pack_format, units_per_pack, each_size, each_measure });
export const PACKS = [
  { id: "d88500d9-ae59-4807-ac3d-5542f35ca4f3", name: "Iceberg", before: flat("Case", 1, 640, "oz"), after: flat("Case", 24, 1, "each"), inner: "head", avg: 20, source: "Angel #7 24/1 CT; #70 4/6 CT; #87 1/24 CT = 24 heads (a COUNT pack, so the import can relate it); CC 2026-09-11: 20 oz/head kept as the weight basis." },
  { id: "45f9aa24-0263-42dd-bed2-53c50e0f57c6", name: "Celery", before: flat("Each (no case)", 1, 96, "oz"), after: flat("Case", 6, 1, "each"), inner: "stalk", setAvg: 16, source: "Angel #59 1/6 CT = 6 stalks (a COUNT pack); CC 2026-09-11: existing 96 oz / 6 stalks = 16 oz/stalk written as the weight basis." },
  { id: "093ddb58-feb3-46c4-9c22-469aedc84f73", name: "Tomatoes Crushed (10#)", before: flat("Case", 1, 1626, "oz"), after: flat("Case", 6, 1, "can"), inner: "10# can", containerLabel: "#10 can", avg: 109, source: "Angel #34 6/#10 CN; CC 2026-09-11: existing 109 oz/can; six cans = 654 oz." },
  { id: "1c85ccb0-cdd0-4a05-971e-189b61132f8a", name: "Chives", before: flat("Case", 1, 4, "oz"), after: flat("Each", 1, 8, "oz"), inner: "container", source: "Angel #42 1/8 OZ; CC 2026-09-11: replaces stale 4 oz pack with one 8 oz unit." },
  { id: "6004d43b-f624-4884-bdb2-5e195ebc6c87", name: "Lemon Juice", before: flat("Case", 1, 202.86, "oz"), after: flat("Case", 6, 32, "oz"), inner: "bottle", source: "Angel #27 6/32 OZ (the invoice counts it in oz, so ours does too); CC 2026-09-11 adjudication: six 32 oz bottles. #111 12/1 LT is a separate invoice pack." },
  { id: "11d14e78-bdce-4aa9-8602-2e7a7e09e4f3", name: "Cucumber", before: flat("Each (no case)", 1, 158, "oz"), after: flat("Case", 12, 1, "each"), inner: "cucumber", avg: 8, source: "Angel #49 CUCUMBER EURO SDLS 1/12 CT = 12 cucumbers per case (a COUNT pack, so the import can relate it); CC 2026-09-11: the 8 oz whole-cucumber ESTIMATE stays the weight basis until a scale says otherwise." },
  { id: "9fcd86c2-77af-482e-8ccc-d07167aad795", name: "Tomatoes", before: flat("Case", 1, 160, "oz"), after: flat("Case", 1, 400, "oz"), inner: "container", avg: 5, source: "Angel #15 and #105 1/25 LB = 400 oz; keep 5 oz whole-tomato estimate (CC 2026-09-11)." },
] as const;
export const PORTIONS = [
  { name: "Onion", sku: "Onion (red)", skuId: "7e826df5-a12d-4883-bd90-3e8a3b387848", oz: 0.25, estimated: false, source: 'docs/seed/source/sandwich-build-sheet.csv: "Onions 0.25 oz" (verbatim).' },
  { name: "Pickles", sku: "Pickle slices", skuId: "2dcc2757-f3eb-470f-bd39-2881c2a06e4e", oz: 0.5, estimated: false, source: 'docs/seed/source/sandwich-build-sheet.csv: "Pickles 0.5 oz" (verbatim).' },
  { name: "Tomato", sku: "Tomatoes", skuId: "9fcd86c2-77af-482e-8ccc-d07167aad795", oz: 2.5, estimated: true, source: 'OPERATIONAL_ESTIMATE, pending a scale: build sheet "Tomatoes 3 ea"; 3 slices x approximately 0.83 oz, from 5 oz whole tomato; authorized Wave 8 2026-09-11, rounded to 2.5 oz.' },
  { name: "Cucumber", sku: "Cucumber", skuId: "11d14e78-bdce-4aa9-8602-2e7a7e09e4f3", oz: 1.2, estimated: true, source: 'OPERATIONAL_ESTIMATE, pending a scale: build sheet "Cucumbers 3 ea"; 3 slices x 0.4 oz from an estimated 8 oz whole cucumber (20 slices/whole); authorized Wave 8 2026-09-11.' },
  { name: "Radish", sku: "Watermelon Radish", skuId: "8e00d1d8-5e9b-4410-b4d2-fca1971bc34f", oz: 0.5, estimated: true, source: 'OPERATIONAL_ESTIMATE, pending a scale: build sheet "Radish 4 Julliened"; four julienne assumed 0.5 oz from a 3 oz whole radish; authorized Wave 8 2026-09-11.' },
] as const;
export const RESALES = [
  { name: "JustIced Tea - Dragon Green tea", sku: "Just Ice Tea Dragon Green", skuId: "7a1f6d2e-3c5b-4e8a-9f01-2a6b8c4d0e13", quantity: 12, unit: "fl oz", label: "can", tea: true },
  { name: "JustIced Tea- Lemon Tea", sku: "Just Ice Tea Lemon", skuId: "7a1f6d2e-3c5b-4e8a-9f01-2a6b8c4d0e11", quantity: 12, unit: "fl oz", label: "can", tea: true },
  { name: "JustIced Tea- Raspberry Tea", sku: "Just Ice Tea Raspberry", skuId: "7a1f6d2e-3c5b-4e8a-9f01-2a6b8c4d0e12", quantity: 12, unit: "fl oz", label: "can", tea: true },
  { name: "Deli Pickle", sku: "Whole pickles", skuId: "a72ea2c4-1063-4d4c-8bcc-7a47bad3e10b", quantity: 1, unit: "each", label: "pickle", tea: false },
  { name: "Quart of Pickle Spears (12pcs)", sku: "Whole pickles", skuId: "a72ea2c4-1063-4d4c-8bcc-7a47bad3e10b", quantity: 3, unit: "each", label: "quart", tea: false },
] as const;
export const TEA_WARNING = "Requested NULL-to-12 fallback: recipe-math uses avg per fl oz, so 12 means 144 modeled oz/can and 1728 oz/pack. The 1/12 pack cost/depletion fraction remains correct, but physical mass is inflated. Migration 0202 seeds 1; preserve that existing basis. CC must adjudicate any NULL fallback before execution.";
export type Tables = Record<"vendor_items" | "sku_pack_levels" | "items" | "recipes" | "recipe_inputs" | "recipe_outputs" | "menu_items" | "measure_units", RawRow[]>;
export interface Plan {
  section: "packs" | "portions" | "resales";
  name: string;
  status: "ready" | "already" | "refused" | "absent";
  before: unknown;
  after: unknown;
  source: string;
  reason?: string;
  /** Complete loaded dependencies; re-read before every multi-row write. */
  expected: RawRow;
}
const n = (v: unknown): number | null => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const active = (rows: RawRow[]) => rows.filter(r => r.active === true);
const one = (rows: RawRow[], what: string): RawRow => { if (rows.length !== 1) throw new Error(`${what}: expected one row, found ${rows.length}`); return rows[0]!; };
const projectFlat = (sku: RawRow) => flat(String(sku.pack_format), n(sku.units_per_pack)!, n(sku.each_size)!, String(sku.each_measure));
export function packChain(spec: typeof PACKS[number]): StarterChainLevel[] {
  const f = spec.after;
  return f.units_per_pack === 1
    ? [{ label: f.pack_format, containsQty: f.each_size, containsIndex: null, containsMeasureUnit: f.each_measure }]
    : [{ label: f.pack_format, containsQty: f.units_per_pack, containsIndex: 1, containsMeasureUnit: null }, { label: spec.inner, containsQty: f.each_size, containsIndex: null, containsMeasureUnit: f.each_measure }];
}
function chainShape(rows: RawRow[]): StarterChainLevel[] {
  const sorted = [...rows].sort((a, b) => Number(a.display_ordinal) - Number(b.display_ordinal));
  return sorted.map(r => ({ label: String(r.label), containsQty: n(r.contains_qty)!, containsIndex: r.contains_level_id == null ? null : sorted.findIndex(l => l.id === r.contains_level_id), containsMeasureUnit: r.contains_measure_unit == null ? null : String(r.contains_measure_unit) }));
}
function producer(t: Tables, target: string, column: string): RawRow[] {
  const ids = new Set(active(t.recipes).map(r => r.id));
  return t.recipe_outputs.filter(o => o[column] === target && ids.has(o.recipe_id));
}
function provenance(spec: typeof PORTIONS[number], inputId: unknown): string {
  return `[${SOURCE}; recipe input ${String(inputId)}] ${spec.source}`;
}
export function resaleSource(spec: typeof RESALES[number]): string {
  return spec.tea ? "Juan 2026-08-28, seed 30 source A: just ice teas packs of 12x12 fl oz; migration 0202 identities and existing 1 oz/fl oz basis. " + TEA_WARNING
    : `CC 2026-09-11: live Whole pickles SKU, unpriced. ${spec.quantity === 3 ? "ASSUMPTION: four spears per whole pickle; 12 spears = 3 whole pickles." : "One deli pickle = one whole pickle."}`;
}
/** Pure planner: facts are pinned above, never inferred from a drifted live row. */
export function planCostingData(t: Tables): Plan[] {
  const result: Plan[] = [];
  const add = (section: Plan["section"], name: string, source: string, after: unknown, work: (p: Plan) => void) => {
    const p: Plan = { section, name, source, before: null, after, status: "ready", expected: {} };
    try { work(p); } catch (e) { p.status = "refused"; p.reason = e instanceof Error ? e.message : "Invalid before-state"; }
    result.push(p);
  };
  const measures = active(t.measure_units);
  for (const spec of PACKS) add("packs", spec.name, spec.source, { ...spec.after, chain: packChain(spec) }, p => {
    const sku = one(t.vendor_items.filter(r => r.id === spec.id && r.active === true && r.name === spec.name && r.vendor_id === PFG), spec.name);
    const levels = active(t.sku_pack_levels).filter(r => r.sku_id === sku.id);
    const history = t.sku_pack_levels.filter(r => r.sku_id === sku.id);
    p.expected = { sku, levels, history };
    p.before = { ...projectFlat(sku), chain: chainShape(levels) };
    if ("avg" in spec && n(sku.avg_oz_per_each) !== spec.avg) throw new Error(`Recorded average drift: expected ${spec.avg}`);
    const chain = packChain(spec);
    const collision = firstLabelMeasureCollision(chain.map(l => l.label), new Set(measures.map(r => String(r.label))));
    if (collision) throw new Error(`Pack label shadows measure ${collision}`);
    if (!measures.some(m => m.label === spec.after.each_measure)) throw new Error("Missing active measure");
    const extrasMatch = (!("setAvg" in spec) || n(sku.avg_oz_per_each) === spec.setAvg) && (!("containerLabel" in spec) || sku.each_container_label === spec.containerLabel);
    if (equal(projectFlat(sku), spec.after) && equal(chainShape(levels), chain) && extrasMatch) { p.status = "already"; return; }
    if (!equal(projectFlat(sku), spec.before)) throw new Error("Flat pack differs from expected before-state");
    if (!levels.length && history.length) throw new Error("Inactive chain history without an active chain; reconcile interrupted supersede");
    // Every before-state has one weight leaf. Accept seed-13 casing/container
    // labels, but never flatten a changed/multi-level chain just because totals agree.
    if (levels.length && !(levels.length === 1 && levels[0]!.contains_level_id == null && levels[0]!.contains_measure_unit === spec.before.each_measure && n(levels[0]!.contains_qty) === spec.before.each_size && [spec.before.pack_format.toLowerCase(), "container"].includes(String(levels[0]!.label).toLowerCase()))) throw new Error("Active chain differs from expected before-state");
  });
  for (const spec of PORTIONS) add("portions", spec.name, spec.source, { quantity: spec.oz, unit: "oz", oz_per_par_unit: spec.oz, yield: 1 }, p => {
    const item = one(active(t.items).filter(r => r.name === spec.name), spec.name);
    // A NULL par unit (Tomato today) is left NULL; a foreign non-Quart unit is the re-denomination this guard refuses.
    if (item.location_id != null || (item.default_par_unit != null && item.default_par_unit !== "Quart")) throw new Error("Expected Quart par unit; do not re-denominate silently");
    const output = one(producer(t, String(item.id), "output_item_id"), `${spec.name} producer`);
    const recipe = one(active(t.recipes).filter(r => r.id === output.recipe_id && r.name === `${spec.name} (portioned)` && r.recipe_type === "production"), "Portioned recipe");
    const outputs = t.recipe_outputs.filter(r => r.recipe_id === recipe.id);
    const input = one(t.recipe_inputs.filter(r => r.recipe_id === recipe.id), "Single recipe input");
    const sku = one(active(t.vendor_items).filter(r => r.id === spec.skuId && r.name === spec.sku), "Pinned ingredient");
    p.expected = { item, recipe, input, outputs, sku };
    p.before = { quantity: n(input.quantity), unit: input.unit, oz_per_par_unit: n(item.oz_per_par_unit), yield: n(output.yield) };
    if (outputs.length !== 1 || n(output.yield) !== 1 || n(recipe.batch_yield) !== 1 || output.output_menu_item_id != null || input.component_sku_id !== sku.id || input.component_item_id != null || input.component_product_id != null) throw new Error("Recipe identity/shape/yield changed");
    const note = provenance(spec, input.id);
    if (n(input.quantity) === spec.oz && input.unit === "oz" && n(item.oz_per_par_unit) === spec.oz && String(recipe.notes ?? "").includes(note)) { p.status = "already"; return; }
    if (n(input.quantity) !== 1 || input.unit !== "unit" || item.oz_per_par_unit != null || String(recipe.notes ?? "").includes(SOURCE)) throw new Error("Expected unmodified 1 unit placeholder and NULL finished weight");
    if (!measures.some(m => m.label === "oz" && m.dimension === "weight")) throw new Error("Missing oz weight measure");
  });
  for (const spec of RESALES) add("resales", spec.name, resaleSource(spec), { sku: spec.sku, quantity: spec.quantity, unit: spec.unit, yield: 1, ...(spec.tea ? { avg_oz_per_each: "preserve 1 or 12; NULL -> 12" } : {}) }, p => {
    const menu = one(active(t.menu_items).filter(r => r.name === spec.name), spec.name);
    const skuRows = active(t.vendor_items).filter(r => r.id === spec.skuId && r.name === spec.sku && r.vendor_id === BH);
    // A resale SKU that does not exist on THIS target (the sim fixture predates migration 0202's tea rows) is
    // absent, not drifted: dry-run shows it, execute skips it, prod (where the rows exist) plans it.
    if (skuRows.length === 0) { p.status = "absent"; p.reason = `${spec.sku}: not on this target`; return; }
    const sku = one(skuRows, spec.sku);
    const chain = active(t.sku_pack_levels).filter(r => r.sku_id === sku.id);
    const outputs = producer(t, String(menu.id), "output_menu_item_id");
    const recipes = t.recipes.filter(r => r.name === `${spec.name} (build)` || outputs.some(o => o.recipe_id === r.id));
    const recipeIds = new Set(recipes.map(r => r.id));
    const inputs = t.recipe_inputs.filter(r => recipeIds.has(r.recipe_id));
    const allOutputs = t.recipe_outputs.filter(r => recipeIds.has(r.recipe_id));
    p.expected = { menu, sku, chain, recipes, inputs, outputs: allOutputs };
    p.before = { recipes: recipes.map(r => r.name), avg_oz_per_each: n(sku.avg_oz_per_each), ...projectFlat(sku) };
    const expectedPack = spec.tea ? flat("Pack", 12, 12, "fl oz") : flat("Each", 1, 1, "count");
    if (!equal(projectFlat(sku), expectedPack)) throw new Error("Resale pack differs from CC 2026-09-11 before-state");
    if (spec.tea && chain.length) throw new Error("Tea has active chain; volume two-phase requires unchained SKU (seed 31)");
    if (!spec.tea && chain.length && !(chain.length === 1 && chain[0]!.contains_level_id == null && chain[0]!.contains_measure_unit === "count" && n(chain[0]!.contains_qty) === 1 && ["each", "container"].includes(String(chain[0]!.label).toLowerCase()))) throw new Error("Whole-pickle chain differs from reviewed one-count order unit");
    if (spec.tea && ![null, 1, 12].includes(n(sku.avg_oz_per_each))) throw new Error("Tea basis drift; expected existing 1, requested 12, or NULL");
    if (!measures.some(m => m.label === spec.unit)) throw new Error("Missing resale measure");
    const recipe = recipes[0], input = inputs[0], output = allOutputs[0];
    if (recipe && input && output && recipes.length === 1 && recipe.active === true && recipe.recipe_type === "consumer" && n(recipe.batch_yield) === 1 && recipe.notes === `[${SOURCE}] ${resaleSource(spec)}` && inputs.length === 1 && input.component_sku_id === sku.id && input.component_item_id == null && input.component_product_id == null && n(input.quantity) === spec.quantity && input.unit === spec.unit && allOutputs.length === 1 && output.output_menu_item_id === menu.id && output.output_item_id == null && n(output.yield) === 1 && output.output_container_label === spec.label && (!spec.tea || sku.avg_oz_per_each != null)) { p.status = "already"; return; }
    if (recipes.length || outputs.length) throw new Error("Existing, partial, or changed recipe; never create a second producer");
  });
  return result;
}

export function validateArgs(args: string[], env: Record<string, string | undefined> = process.env) {
  if (args.filter(a => a === "--dry-run").length > 1 || (args.includes("--dry-run") && args.includes("--execute"))) throw new Error("Conflicting/duplicate dry-run option");
  if (args.some(a => ["--wave7", "--readiness", "--as-of"].includes(a))) throw new Error("Unsupported seed-32 option");
  return validateTarget(args.filter(a => a !== "--dry-run"), env);
}
async function readTables(sb: SupabaseClient): Promise<Tables> {
  const names: (keyof Tables)[] = ["vendor_items", "sku_pack_levels", "items", "recipes", "recipe_inputs", "recipe_outputs", "menu_items", "measure_units"];
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await loadAll(sb, name)]))) as Tables;
}
/** Guard every UPDATE by the values it replaces, and require its exact rowcount. */
async function update(sb: SupabaseClient, table: string, before: RawRow, values: RawRow): Promise<void> {
  let q = sb.from(table).update(values, { count: "exact" }).eq("id", before.id);
  for (const [key, value] of Object.entries(before)) {
    if (key === "id" || typeof value === "object" && value !== null) continue;
    q = value == null ? q.is(key, null) : q.eq(key, value);
  }
  const { error, count } = await q;
  if (error || count !== 1) throw new Error(`${table}: guarded UPDATE failed or matched ${count ?? "unknown"} rows`);
}
async function insert(sb: SupabaseClient, table: string, rows: RawRow | RawRow[]): Promise<void> {
  const { error } = await sb.from(table).insert(rows);
  if (error) throw new Error(`${table}: INSERT failed (${error.code ?? "unknown"}); stop and reconcile partial operation`);
}
async function record(sb: SupabaseClient, action: AuditAction, table: string, id: string, p: Plan, extra: RawRow = {}): Promise<void> {
  // Delayed import: importing this seed for its pure planner never creates a DB client.
  const { audit } = await import("@/lib/audit");
  const operation = randomUUID();
  await audit({ actorId: null, actorRole: null, action, resourceTable: table, resourceId: id, metadata: { source: SOURCE, operation, source_note: p.source, before: p.before, after: p.after, ...extra }, ipAddress: null, userAgent: null });
  const { data, error } = await sb.from("audit_log").select("id").eq("action", action).eq("resource_id", id).contains("metadata", { source: SOURCE, operation });
  if (error || data?.length !== 1) throw new Error(`${table}: audit readback failed; stop and reconcile (audit helper is fail-open)`);
}
async function apply(sb: SupabaseClient, p: Plan): Promise<void> {
  const now = new Date().toISOString();
  if (p.section === "packs") {
    const spec = PACKS.find(s => s.name === p.name)!;
    const sku = p.expected.sku as RawRow, levels = p.expected.levels as RawRow[];
    const chain = packChain(spec), ids = chain.map(() => randomUUID());
    // One UPDATE supersedes the active set (seed 16), never DELETE or mutate history.
    if (levels.length) {
      const { error, count } = await sb.from("sku_pack_levels").update({ active: false }, { count: "exact" }).eq("sku_id", sku.id).eq("active", true).in("id", levels.map(l => String(l.id)));
      if (error || count !== levels.length) throw new Error(`${p.name}: chain supersede rowcount mismatch`);
    }
    await insert(sb, "sku_pack_levels", chain.map((l, i) => ({ id: ids[i], sku_id: sku.id, label: l.label, contains_qty: l.containsQty, contains_level_id: l.containsIndex == null ? null : ids[l.containsIndex], contains_measure_unit: l.containsMeasureUnit, display_ordinal: i, effective_from: now, active: true, created_by: null })));
    await record(sb, "sku.pack_chain_update", "sku_pack_levels", String(sku.id), p, { old_level_ids: levels.map(l => l.id), new_level_ids: ids });
    const derived = deriveFlatFieldsFromChain(chain);
    const values = { pack_format: derived.packFormat, each_size: derived.eachSize, each_measure: derived.eachMeasure, units_per_pack: derived.unitsPerPack };
    if (!equal(values, spec.after)) throw new Error("Internal chain/flat mismatch");
    const extras: RawRow = {};
    if ("setAvg" in spec) extras.avg_oz_per_each = spec.setAvg;
    if ("containerLabel" in spec) extras.each_container_label = spec.containerLabel;
    await update(sb, "vendor_items", sku, { ...values, ...extras, updated_at: now, updated_by: null });
    await record(sb, "vendor_item.update", "vendor_items", String(sku.id), p);
  } else if (p.section === "portions") {
    const spec = PORTIONS.find(s => s.name === p.name)!;
    const item = p.expected.item as RawRow, input = p.expected.input as RawRow, recipe = p.expected.recipe as RawRow;
    const note = provenance(spec, input.id);
    await update(sb, "recipe_inputs", input, { quantity: spec.oz, unit: "oz" });
    await record(sb, "recipe_input.update", "recipe_inputs", String(input.id), p, { recipe_id: recipe.id, weight_source_note: note, pending_surprise_weigh: spec.estimated });
    await update(sb, "items", item, { oz_per_par_unit: spec.oz, updated_at: now, updated_by: null });
    await record(sb, "item.update", "items", String(item.id), p, { weight_source_note: note, pending_surprise_weigh: spec.estimated });
    await update(sb, "recipes", recipe, { notes: [recipe.notes, note].filter(Boolean).join("\n"), updated_at: now, updated_by: null });
    await record(sb, "recipe.update", "recipes", String(recipe.id), p, { input_id: input.id, weight_source_note: note, pending_surprise_weigh: spec.estimated });
  } else {
    const spec = RESALES.find(s => s.name === p.name)!;
    const sku = p.expected.sku as RawRow, menu = p.expected.menu as RawRow;
    // Phase A precedes phase B, as in seed 31. Never overwrite migration 0202's 1.
    if (spec.tea && sku.avg_oz_per_each == null) {
      await update(sb, "vendor_items", sku, { avg_oz_per_each: 12, updated_at: now, updated_by: null });
      await record(sb, "vendor_item.update", "vendor_items", String(sku.id), p, { field: "avg_oz_per_each", before: null, after: 12, warning: TEA_WARNING });
      const { data, error } = await sb.from("vendor_items").select("avg_oz_per_each").eq("id", sku.id).single();
      if (error || n(data?.avg_oz_per_each) !== 12) throw new Error("Tea basis readback mismatch");
    }
    const id = randomUUID();
    // Stage inactive so a failed child insert never exposes an incomplete producer.
    const recipe = { id, name: `${spec.name} (build)`, recipe_type: "consumer", batch_yield: 1, active: false, created_by: null, directions: `Resale: ${spec.quantity} ${spec.unit} of ${spec.sku}; yield one ${spec.label}.`, notes: `[${SOURCE}] ${p.source}` };
    await insert(sb, "recipes", recipe);
    await record(sb, "recipe.create", "recipes", id, p, { staged_inactive: true, input_sku_id: sku.id, output_menu_item_id: menu.id });
    await insert(sb, "recipe_inputs", { recipe_id: id, component_sku_id: sku.id, component_item_id: null, component_product_id: null, quantity: spec.quantity, unit: spec.unit, portioned: false, display_order: 0, created_by: null });
    await insert(sb, "recipe_outputs", { recipe_id: id, output_item_id: null, output_menu_item_id: menu.id, yield: 1, output_container_label: spec.label, display_order: 0, created_by: null });
    await update(sb, "recipes", recipe, { active: true, updated_at: now, updated_by: null });
    await record(sb, "recipe.update", "recipes", id, p, { activated: true });
  }
}
/** Fail-open audit() does not make an unaudited after-state a successful replay. */
async function verifyAudits(sb: SupabaseClient, p: Plan): Promise<void> {
  const sku = p.expected.sku as RawRow;
  const checks: [AuditAction, unknown][] = p.section === "packs"
    ? [["sku.pack_chain_update", sku.id], ["vendor_item.update", sku.id]]
    : p.section === "portions"
      ? [["recipe_input.update", (p.expected.input as RawRow).id], ["item.update", (p.expected.item as RawRow).id], ["recipe.update", (p.expected.recipe as RawRow).id]]
      : [["recipe.create", (p.expected.recipes as RawRow[])[0]!.id], ["recipe.update", (p.expected.recipes as RawRow[])[0]!.id]];
  for (const [action, id] of checks) {
    const { data, error } = await sb.from("audit_log").select("id").eq("action", action).eq("resource_id", id).contains("metadata", { source: SOURCE, source_note: p.source, after: p.after }).limit(1);
    if (error || !data?.length) throw new Error(`${p.name}: missing matching ${action} provenance audit; reconcile before retry`);
  }
}
/** Normalize only this operation's permitted writes; every other field stays equal. */
export function verifyWriteScope(before: Tables, after: Tables, p: Plan): void {
  const skuId = (p.expected.sku as RawRow).id;
  const newRecipeIds = p.section === "resales" ? new Set(after.recipes.filter(r => r.name === `${p.name} (build)` && !before.recipes.some(b => b.id === r.id)).map(r => r.id)) : new Set();
  for (const table of Object.keys(before) as (keyof Tables)[]) {
    const allowed = (r: RawRow): string[] => {
      if (p.section === "packs") {
        if (table === "vendor_items" && r.id === skuId) {
          const spec = PACKS.find(s => s.name === p.name)!;
          return ["pack_format", "units_per_pack", "each_size", "each_measure", "updated_at", "updated_by", ...("setAvg" in spec ? ["avg_oz_per_each"] : []), ...("containerLabel" in spec ? ["each_container_label"] : [])];
        }
        if (table === "sku_pack_levels" && r.sku_id === skuId) return ["active"];
      } else if (p.section === "portions") {
        if (table === "items" && r.id === (p.expected.item as RawRow).id) return ["oz_per_par_unit", "updated_at", "updated_by"];
        if (table === "recipe_inputs" && r.id === (p.expected.input as RawRow).id) return ["quantity", "unit"];
        if (table === "recipes" && r.id === (p.expected.recipe as RawRow).id) return ["notes", "updated_at", "updated_by"];
      } else if (table === "vendor_items" && r.id === skuId && (p.expected.sku as RawRow).avg_oz_per_each == null && RESALES.find(s => s.name === p.name)!.tea) return ["avg_oz_per_each", "updated_at", "updated_by"];
      return [];
    };
    const addedAllowed = (r: RawRow) => p.section === "packs" ? table === "sku_pack_levels" && r.sku_id === skuId
      : p.section === "resales" && (table === "recipes" ? newRecipeIds.has(r.id) : ["recipe_inputs", "recipe_outputs"].includes(table) && newRecipeIds.has(r.recipe_id));
    const oldIds = new Set(before[table].map(r => r.id));
    const normalize = (rows: RawRow[]) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([key]) => !allowed(r).includes(key)))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const existingAfter = after[table].filter(r => oldIds.has(r.id) || !addedAllowed(r));
    if (!equal(normalize(before[table]), normalize(existingAfter))) throw new Error(`${p.name}: unrelated/concurrent ${table} change; stop for a fresh reviewed dry-run`);
  }
}
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const config = validateArgs(args), sb = createWave7Client(config);
  let expectedTables = await readTables(sb);
  const plans = planCostingData(expectedTables);
  const digest = createHash("sha256").update(canonical({ project: config.projectRef, source: SOURCE, plans })).digest("hex");
  console.log(`${SOURCE}: ${config.execute ? "EXECUTE" : "DRY RUN"}, target ${config.target}`);
  for (const section of ["packs", "portions", "resales"] as const) {
    console.log(`\n${section}`);
    console.table(plans.filter(p => p.section === section).map(p => ({ row: p.name, before: JSON.stringify(p.before), after: JSON.stringify(p.after), source: p.source, status: p.status, refusal: p.reason ?? "" })));
  }
  console.log("SKIP: Roasted Red Peppers side; portion unknown, CC asks Juan. Whole-pickle prices remain unresolved.");
  console.log(`Plan digest: ${digest}`);
  if (!config.execute) { console.log("No writes. Execute with the same --target and --execute --plan-digest shown above."); return; }
  if (plans.every(p => p.status === "already" || p.status === "absent")) { for (const p of plans) { if (p.status === "absent") { console.log(`absent (skipped): ${p.name}`); continue; } await verifyAudits(sb, p); console.log(`already: ${p.name}`); } return; }
  if (config.planDigest !== digest) throw new Error("Plan changed; review a fresh dry-run");
  if (plans.some(p => p.status === "refused")) throw new Error("Refused before-state(s); no writes. Resolve ledger before execute.");
  for (const p of plans) {
    const tables = await readTables(sb);
    if (!equal(tables, expectedTables)) throw new Error("Database changed after reviewed snapshot; no further writes");
    const current = planCostingData(tables).find(r => r.section === p.section && r.name === p.name)!;
    if (current.status === "absent") { console.log(`absent (skipped): ${p.name}`); continue; }
    if (current.status === "already") { await verifyAudits(sb, current); console.log(`already: ${p.name}`); continue; }
    if (current.status !== "ready") throw new Error(`${p.name}: before-state changed during execution`);
    await apply(sb, current);
    const afterTables = await readTables(sb);
    verifyWriteScope(tables, afterTables, current);
    const verified = planCostingData(afterTables).find(r => r.section === p.section && r.name === p.name)!;
    if (verified.status !== "already") throw new Error(`${p.name}: destination verification failed; reconcile partial operation`);
    await verifyAudits(sb, verified);
    expectedTables = afterTables;
    console.log(`verified: ${p.name}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e instanceof Error ? e.message : "Seed 32 failed"); process.exitCode = 1; });
}

