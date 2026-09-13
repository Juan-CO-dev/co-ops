/**
 * Seed 33: Juan's floor prices, 2026-09-12 (14 PFG lines read off the shop's current order guide).
 * Dry-run default. CC runs sim, then prod; this module never loads an env file.
 * --target sim|prod [--dry-run | --execute --plan-digest <dry-run digest>]
 * Uses seed 26's target/project/production-confirmation guards unchanged.
 * Two sections, in order: PACKS restates a SKU whose catalog pack does not match the invoice
 * line (guarded UPDATE of the flat fields + one chain supersede, exactly seed 32's shape), then
 * PRICES appends one vendor_price_history row per line (append-only; the newest effective date
 * wins in loadCurrentSkuPrices). A line whose current price already matches is "already"; a
 * newer app price refuses. Direct writes follow seeds 16/22/31/32; they are NOT a transaction.
 * No schema changes or new audit actions (sku.pack_chain_update / vendor_item.update /
 * vendor_item.price_recorded, all registered).
 */
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveFlatFieldsFromChain, type StarterChainLevel } from "@/lib/admin/catalog-shared";
import { firstLabelMeasureCollision } from "@/lib/pack-chain-shared";
import { canonical, type RawRow } from "@/lib/angel-wave7";
import type { AuditAction } from "@/lib/audit-actions";
import { createWave7Client, loadAll, validateTarget } from "./26-angel-wave7";

export const SOURCE = "floor-prices-2026-09-12";
export const EFFECTIVE_DATE = "2026-09-12";
export const PFG = "a0d8986c-e097-46f0-9e3f-e70943d4291b";
export type Flat = { pack_format: string; units_per_pack: number; each_size: number; each_measure: string };
const flat = (pack_format: string, units_per_pack: number, each_size: number, each_measure: string): Flat => ({ pack_format, units_per_pack, each_size, each_measure });
export interface PackSpec { before: Flat; after: Flat; inner?: string; containerLabel?: string; setAvg?: number; note: string }
export interface Row { id: string; name: string; line: string; price: number; pack: PackSpec | null }
// `line` is Juan's text verbatim (Claude chat, 2026-09-12); `price` is the case price on that line.
export const ROWS: readonly Row[] = [
  { id: "1c85ccb0-cdd0-4a05-971e-189b61132f8a", name: "Chives", line: "Chives - 1/8 OZ - 17.88", price: 17.88, pack: null },
  { id: "d6c913a4-888b-4d2d-a151-9a15c9dd69c4", name: "Eggs (cooked)", line: "Eggs(cooked) - 12/12 CT - 39.97", price: 39.97,
    pack: { before: flat("Case", 1, 180, "oz"), after: flat("Case", 12, 12, "each"), inner: "bag", setAvg: 1.775, note: "12 bags of 12 hard-cooked eggs; 1.775 oz per egg = Angel invoice net 15.97 lb / 144 (manifest #54)." } },
  { id: "6004d43b-f624-4884-bdb2-5e195ebc6c87", name: "Lemon Juice", line: "Lemon juice - 6/32 OZ - 32.70", price: 32.70, pack: null },
  { id: "d587fa4b-bae4-4d97-84ef-102b8b44d9a9", name: "Tomato Paste", line: "Paste tomato - 6/#10 CN - 54.56", price: 54.56,
    pack: { before: flat("Case", 1, 111, "oz"), after: flat("Case", 6, 1, "can"), inner: "10# can", containerLabel: "#10 can", setAvg: 111, note: "Six #10 cans; 111 oz per can keeps the existing single-can basis (6 lb 15 oz net)." } },
  { id: "2f3cdefe-5fac-4ce5-b11e-a01bb7ede664", name: "Roasted Red Peppers", line: "Roasted red peppers - 6/#10 CN - 49.81", price: 49.81,
    pack: { before: flat("Case", 1, 612, "oz"), after: flat("Case", 6, 1, "can"), inner: "10# can", containerLabel: "#10 can", setAvg: 102, note: "Six #10 cans; 102 oz per can = the existing 612 oz case / 6 (6 lb 6 oz net)." } },
  { id: "ac1b5724-a7cf-4896-ac76-0139dc652f04", name: "Balsamic Glaze", line: "Balsamic Glaze - 4/27 OZ - 42.04", price: 42.04,
    pack: { before: flat("Each", 1, 27, "oz"), after: flat("Case", 4, 27, "oz"), inner: "bottle", note: "Four 27 oz bottles per case; the 27 oz bottle was already the catalog unit." } },
  { id: "541c2e67-a30f-4189-964c-8d17634b6506", name: "Red wine vinegar", line: "Red wine vinegar - 4/1 GA - 35.65", price: 35.65,
    pack: { before: flat("Case", 1, 169.07, "oz"), after: flat("Case", 4, 128, "oz"), inner: "jug", note: "Four 1 gal jugs; 128 oz per gallon in the catalog's water-ounce convention (the prior 169.07 oz was one 5 L jug)." } },
  { id: "45c5840b-2353-47cc-8319-8cdc352ebe12", name: "Chili Flake", line: "Red pepper crushed/chilli flake - 1/4 LB - 23.40", price: 23.40, pack: null },
  { id: "6f412776-bd4a-4eb7-8458-472e90e8167b", name: "Horseradish", line: "Horseradish - 1/8 LB - 16.30", price: 16.30, pack: null },
  { id: "3430a53e-30b2-4b54-9f18-b10409fac129", name: "Grapeseed Oil", line: "Grapeseed oil - 2/5 LT - 123.15", price: 123.15,
    pack: { before: flat("Case", 1, 101, "oz"), after: flat("Case", 2, 169.07, "oz"), inner: "jug", note: "Two 5 L jugs; 169.07 oz per 5 L is the catalog's litre convention (Balsamic Vin). The prior 101 oz was one 3 L jug." } },
  { id: "c8709801-3266-423a-aa3c-1e14c23f050e", name: "Mustard (Whole)", line: "Mustard Dijon grain/Mustard(whole) - 1/9.3 LB - 18.98", price: 18.98,
    pack: { before: flat("Case", 1, 176, "oz"), after: flat("Case", 1, 148.8, "oz"), note: "One 9.3 lb pail = 148.8 oz (the prior 176 oz was an 11 lb guess)." } },
  { id: "dbff905e-1086-43f5-bc07-f05bcadd0eb6", name: "Mustard (Dijon)", line: "Mustard Dijon - 1/9.5 LB - 20.39", price: 20.39,
    pack: { before: flat("Case", 1, 176, "oz"), after: flat("Case", 1, 152, "oz"), note: "One 9.5 lb pail = 152 oz (the prior 176 oz was an 11 lb guess)." } },
  { id: "1724b425-250b-4d05-876b-2d6bfa6d6f35", name: "Confectioners Sugar", line: "Confectioners Sugar/powered sugar - 12/2 LB - 33.51", price: 33.51,
    pack: { before: flat("Box", 1, 16, "oz"), after: flat("Case", 12, 32, "oz"), inner: "bag", note: "Twelve 2 lb bags per case (the prior 16 oz box was a retail unit)." } },
  { id: "2a705f78-7ea1-409d-a15f-5f45040dac71", name: "Old Bay", line: "Old bay/seasoning blend seafood - 1/24 OZ - 13.77", price: 13.77, pack: null },
];
export const SKU_IDS = ROWS.map(r => r.id);
export type Tables = Record<"vendor_items" | "sku_pack_levels" | "measure_units" | "vendor_price_history", RawRow[]>;
export interface Plan {
  section: "packs" | "prices";
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
const projectFlat = (sku: RawRow): Flat => flat(String(sku.pack_format), n(sku.units_per_pack)!, n(sku.each_size)!, String(sku.each_measure));
export function packSource(row: Row): string { return `Juan 2026-09-12 (shop order guide): "${row.line}". ${row.pack?.note ?? ""}`.trim(); }
export function priceSource(row: Row): string { return `Juan 2026-09-12 (shop order guide): "${row.line}"; case price $${row.price.toFixed(2)} effective ${EFFECTIVE_DATE}.`; }
export function packChain(spec: PackSpec): StarterChainLevel[] {
  const f = spec.after;
  return f.units_per_pack === 1
    ? [{ label: f.pack_format, containsQty: f.each_size, containsIndex: null, containsMeasureUnit: f.each_measure }]
    : [{ label: f.pack_format, containsQty: f.units_per_pack, containsIndex: 1, containsMeasureUnit: null }, { label: spec.inner!, containsQty: f.each_size, containsIndex: null, containsMeasureUnit: f.each_measure }];
}
function chainShape(rows: RawRow[]): StarterChainLevel[] {
  const sorted = [...rows].sort((a, b) => Number(a.display_ordinal) - Number(b.display_ordinal));
  return sorted.map(r => ({ label: String(r.label), containsQty: n(r.contains_qty)!, containsIndex: r.contains_level_id == null ? null : sorted.findIndex(l => l.id === r.contains_level_id), containsMeasureUnit: r.contains_measure_unit == null ? null : String(r.contains_measure_unit) }));
}
/** Newest-first, the same total order loadCurrentSkuPrices uses. */
export function priceOrder(rows: RawRow[]): RawRow[] {
  return [...rows].sort((a, b) => String(b.effective_date).localeCompare(String(a.effective_date)) || String(b.recorded_at ?? "").localeCompare(String(a.recorded_at ?? "")) || String(b.id).localeCompare(String(a.id)));
}
/** Pure planner: facts are pinned above, never inferred from a drifted live row. */
export function planFloorPrices(t: Tables): Plan[] {
  const result: Plan[] = [];
  const add = (section: Plan["section"], name: string, source: string, after: unknown, work: (p: Plan) => void) => {
    const p: Plan = { section, name, source, before: null, after, status: "ready", expected: {} };
    try { work(p); } catch (e) { p.status = "refused"; p.reason = e instanceof Error ? e.message : "Invalid before-state"; }
    result.push(p);
  };
  const measures = active(t.measure_units);
  for (const row of ROWS) if (row.pack) add("packs", row.name, packSource(row), { ...row.pack.after, chain: packChain(row.pack) }, p => {
    const spec = row.pack!;
    const skuRows = t.vendor_items.filter(r => r.id === row.id && r.active === true && r.name === row.name && r.vendor_id === PFG);
    if (skuRows.length === 0) { p.status = "absent"; p.reason = `${row.name}: not on this target`; return; }
    const sku = one(skuRows, row.name);
    const levels = active(t.sku_pack_levels).filter(r => r.sku_id === sku.id);
    const history = t.sku_pack_levels.filter(r => r.sku_id === sku.id);
    p.expected = { sku, levels, history };
    p.before = { ...projectFlat(sku), chain: chainShape(levels), avg_oz_per_each: n(sku.avg_oz_per_each) };
    const chain = packChain(spec);
    const collision = firstLabelMeasureCollision(chain.map(l => l.label), new Set(measures.map(r => String(r.label))));
    if (collision) throw new Error(`Pack label shadows measure ${collision}`);
    if (!measures.some(m => m.label === spec.after.each_measure)) throw new Error("Missing active measure");
    const extrasMatch = (spec.setAvg == null || n(sku.avg_oz_per_each) === spec.setAvg) && (spec.containerLabel == null || sku.each_container_label === spec.containerLabel);
    if (equal(projectFlat(sku), spec.after) && equal(chainShape(levels), chain) && extrasMatch) { p.status = "already"; return; }
    if (!equal(projectFlat(sku), spec.before)) throw new Error("Flat pack differs from expected before-state");
    if (!levels.length && history.length) throw new Error("Inactive chain history without an active chain; reconcile interrupted supersede");
    // Every before-state is unchained or one weight leaf (seed-13 casing tolerated); never flatten a richer chain.
    if (levels.length && !(levels.length === 1 && levels[0]!.contains_level_id == null && levels[0]!.contains_measure_unit === spec.before.each_measure && n(levels[0]!.contains_qty) === spec.before.each_size && [spec.before.pack_format.toLowerCase(), "container", "case", "box"].includes(String(levels[0]!.label).toLowerCase()))) throw new Error("Existing chain is not the single weight leaf this restatement replaces");
    if (spec.after.each_measure !== "oz" && spec.setAvg == null && n(sku.avg_oz_per_each) == null) throw new Error("A count leaf on a raw SKU needs an ounce basis");
  });
  for (const row of ROWS) add("prices", row.name, priceSource(row), { unit_price: row.price, effective_date: EFFECTIVE_DATE, source: SOURCE }, p => {
    const skuRows = t.vendor_items.filter(r => r.id === row.id && r.active === true && r.name === row.name && r.vendor_id === PFG);
    if (skuRows.length === 0) { p.status = "absent"; p.reason = `${row.name}: not on this target`; return; }
    const sku = one(skuRows, row.name);
    const prices = priceOrder(t.vendor_price_history.filter(r => r.vendor_item_id === sku.id));
    const current = prices[0] ?? null;
    p.expected = { sku, prices };
    p.before = current ? { unit_price: n(current.unit_price), effective_date: current.effective_date, source: current.source ?? null } : null;
    const mine = prices.filter(r => r.source === SOURCE);
    if (mine.some(r => Math.abs(n(r.unit_price)! - row.price) >= 0.005 || r.effective_date !== EFFECTIVE_DATE)) throw new Error("A different price already carries this source; create an explicit correction");
    if (current && Math.abs(n(current.unit_price)! - row.price) < 0.005) { p.status = "already"; return; }
    if (current && String(current.effective_date) > EFFECTIVE_DATE) throw new Error(`Newer price exists (${String(current.effective_date)}); the floor line would regress it`);
    if (mine.length) throw new Error("This source's row exists but is not current; reconcile the price order");
  });
  return result;
}

export function validateArgs(args: string[], env: Record<string, string | undefined> = process.env) {
  if (args.filter(a => a === "--dry-run").length > 1 || (args.includes("--dry-run") && args.includes("--execute"))) throw new Error("Conflicting/duplicate dry-run option");
  if (args.some(a => ["--wave7", "--readiness", "--as-of"].includes(a))) throw new Error("Unsupported seed-33 option");
  return validateTarget(args.filter(a => a !== "--dry-run"), env);
}
async function loadPrices(sb: SupabaseClient): Promise<RawRow[]> {
  const rows: RawRow[] = [], ids = new Set<string>();
  let total: number | null = null;
  for (let offset = 0; ; offset += 500) {
    const { data, error, count } = await sb.from("vendor_price_history").select("*", { count: "exact" }).in("vendor_item_id", SKU_IDS).order("id").range(offset, offset + 499);
    if (error || count == null || !data) throw new Error("Incomplete read: vendor_price_history");
    if (total != null && count !== total) throw new Error("Concurrent change during pagination: vendor_price_history");
    total = count;
    for (const row of data as unknown as RawRow[]) {
      if (typeof row.id !== "string" || ids.has(row.id)) throw new Error("Duplicate/missing id during pagination: vendor_price_history");
      ids.add(row.id); rows.push(row);
    }
    if (data.length < 500) break;
  }
  if (rows.length !== total) throw new Error("Incomplete read: vendor_price_history");
  return rows;
}
async function readTables(sb: SupabaseClient): Promise<Tables> {
  const [vendor_items, sku_pack_levels, measure_units, vendor_price_history] = await Promise.all([loadAll(sb, "vendor_items"), loadAll(sb, "sku_pack_levels"), loadAll(sb, "measure_units"), loadPrices(sb)]);
  return { vendor_items, sku_pack_levels, measure_units, vendor_price_history };
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
  const row = ROWS.find(r => r.name === p.name)!;
  const sku = p.expected.sku as RawRow;
  if (p.section === "packs") {
    const spec = row.pack!, levels = p.expected.levels as RawRow[];
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
    if (spec.setAvg != null) extras.avg_oz_per_each = spec.setAvg;
    if (spec.containerLabel != null) extras.each_container_label = spec.containerLabel;
    await update(sb, "vendor_items", sku, { ...values, ...extras, updated_at: now, updated_by: null });
    await record(sb, "vendor_item.update", "vendor_items", String(sku.id), p);
  } else {
    const id = randomUUID();
    await insert(sb, "vendor_price_history", { id, vendor_item_id: sku.id, unit_price: row.price, effective_date: EFFECTIVE_DATE, recorded_at: now, recorded_by: null, source: SOURCE, source_note: p.source });
    await record(sb, "vendor_item.price_recorded", "vendor_price_history", id, p, { sku_id: sku.id, sku_name: row.name, unit_price: row.price, effective_date: EFFECTIVE_DATE });
  }
}
/** Fail-open audit() does not make an unaudited after-state a successful replay. */
async function verifyAudits(sb: SupabaseClient, p: Plan): Promise<void> {
  const sku = p.expected.sku as RawRow;
  const checks: [AuditAction, unknown][] = p.section === "packs"
    ? [["sku.pack_chain_update", sku.id], ["vendor_item.update", sku.id]]
    : [["vendor_item.price_recorded", (p.expected.prices as RawRow[])[0]!.id]];
  for (const [action, id] of checks) {
    const { data, error } = await sb.from("audit_log").select("id").eq("action", action).eq("resource_id", id).contains("metadata", { source: SOURCE, source_note: p.source, after: p.after }).limit(1);
    if (error || !data?.length) throw new Error(`${p.name}: missing matching ${action} provenance audit; reconcile before retry`);
  }
}
/** Normalize only this operation's permitted writes; every other field stays equal. */
export function verifyWriteScope(before: Tables, after: Tables, p: Plan): void {
  const skuId = (p.expected.sku as RawRow).id;
  const spec = ROWS.find(r => r.name === p.name)!.pack;
  for (const table of Object.keys(before) as (keyof Tables)[]) {
    const allowed = (r: RawRow): string[] => {
      if (p.section !== "packs") return [];
      if (table === "vendor_items" && r.id === skuId) return ["pack_format", "units_per_pack", "each_size", "each_measure", "updated_at", "updated_by", ...(spec?.setAvg != null ? ["avg_oz_per_each"] : []), ...(spec?.containerLabel != null ? ["each_container_label"] : [])];
      if (table === "sku_pack_levels" && r.sku_id === skuId) return ["active"];
      return [];
    };
    const addedAllowed = (r: RawRow) => p.section === "packs" ? table === "sku_pack_levels" && r.sku_id === skuId
      : table === "vendor_price_history" && r.vendor_item_id === skuId && r.source === SOURCE;
    const oldIds = new Set(before[table].map(r => r.id));
    const normalize = (rows: RawRow[]) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([key]) => !allowed(r).includes(key)))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const existingAfter = after[table].filter(r => oldIds.has(r.id) || !addedAllowed(r));
    if (!equal(normalize(before[table]), normalize(existingAfter))) throw new Error(`${p.name}: unrelated/concurrent ${table} change; stop for a fresh reviewed dry-run`);
  }
}
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const config = validateArgs(args), sb = createWave7Client(config);
  let expectedTables = await readTables(sb);
  const plans = planFloorPrices(expectedTables);
  const digest = createHash("sha256").update(canonical({ project: config.projectRef, source: SOURCE, plans })).digest("hex");
  console.log(`${SOURCE}: ${config.execute ? "EXECUTE" : "DRY RUN"}, target ${config.target}`);
  for (const section of ["packs", "prices"] as const) {
    console.log(`\n${section}`);
    console.table(plans.filter(p => p.section === section).map(p => ({ row: p.name, before: JSON.stringify(p.before), after: JSON.stringify(p.after), status: p.status, refusal: p.reason ?? "" })));
  }
  console.log(`Plan digest: ${digest}`);
  if (!config.execute) { console.log("No writes. Execute with the same --target and --execute --plan-digest shown above."); return; }
  if (plans.every(p => p.status === "already" || p.status === "absent")) { for (const p of plans) { if (p.status === "absent") { console.log(`absent (skipped): ${p.name}`); continue; } await verifyAudits(sb, p); console.log(`already: ${p.name}`); } return; }
  if (config.planDigest !== digest) throw new Error("Plan changed; review a fresh dry-run");
  if (plans.some(p => p.status === "refused")) throw new Error("Refused before-state(s); no writes. Resolve ledger before execute.");
  for (const p of plans) {
    const tables = await readTables(sb);
    if (!equal(tables, expectedTables)) throw new Error("Database changed after reviewed snapshot; no further writes");
    const current = planFloorPrices(tables).find(r => r.section === p.section && r.name === p.name)!;
    if (current.status === "absent") { console.log(`absent (skipped): ${p.name}`); continue; }
    if (current.status === "already") {
      // A price that already matched from another source (Lemon Juice, wave 7) has no seed-33 audit to verify.
      if (current.section === "packs" || (current.expected.prices as RawRow[])[0]?.source === SOURCE) await verifyAudits(sb, current);
      console.log(`already: ${p.name}`); continue;
    }
    if (current.status !== "ready") throw new Error(`${p.name}: before-state changed during execution`);
    await apply(sb, current);
    const afterTables = await readTables(sb);
    verifyWriteScope(tables, afterTables, current);
    const verified = planFloorPrices(afterTables).find(r => r.section === p.section && r.name === p.name)!;
    if (verified.status !== "already") throw new Error(`${p.name}: destination verification failed; reconcile partial operation`);
    await verifyAudits(sb, verified);
    expectedTables = afterTables;
    console.log(`verified: ${p.name}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e instanceof Error ? e.message : "Seed 33 failed"); process.exitCode = 1; });
}
