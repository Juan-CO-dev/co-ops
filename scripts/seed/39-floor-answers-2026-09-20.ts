/**
 * Seed 39: Juan's floor answers of 2026-09-20 (Saturday shop day, Claude chat), applied to the catalog.
 *   A. PFG CustomerFirst product pages (screenshots): Worcestershire = Lea & Perrins 341010, 3/1 GA, $65.74/case;
 *      Cholula = 525032, 4/.5 GA, $57.70/case. The catalog's "Worcestershire" SKU had no vendor, pack or price → it becomes the
 *      PFG row (vendor, item number, pack chain, basis, price). Cholula gets a NEW PFG SKU (multi-vendor doctrine: one SKU per
 *      vendor; the Baldor SKU SAUCE6B stays active as the backup on the Baldor starter guide) and the Cholula Mayo recipe line
 *      moves to it, because PFG is where it is bought now.
 *   B. Leonard Paper invoice 734032 (2026-09-15, P Street): prices for the eight SKUs whose item numbers match, per case
 *      (sub wrap per bundle), and a one-level pack chain where the invoice states the count. Gloves: price only (boxes per case
 *      not on the invoice). SW-182 film is NOT the catalog's SW-242 → not written, reported. Customer number 37630 → vendor.
 *   C. Weights: one cannoli shell 0.3 oz (PFG and Baldor SKUs); a quart of Jus 1 lb 13 oz = 29 oz per par unit; the French
 *      Dip build's "1 ladle" of Jus = 5 oz. Chicken salad "6 oz" is HELD (portion or tub? ask), not written.
 * Dry-run default. CC runs sim, then prod; this module never loads an env file.
 * --target sim|prod [--dry-run | --execute --plan-digest <dry-run digest>]; prod also needs ANGEL_WAVE7_PROD_CONFIRM.
 * Direct writes follow seed 35 (not a transaction; an interrupted row refuses on retry until reconciled). No schema changes.
 */
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonical, type RawRow } from "@/lib/angel-wave7";
import type { AuditAction } from "@/lib/audit-actions";
import { createWave7Client, loadAll, validateTarget } from "./26-angel-wave7";

export const SOURCE = "floor-answers-2026-09-20";
const JUAN = "Juan 2026-09-20 (Claude chat, shop day)";
const PFG_PAGE = `${JUAN}: PFG CustomerFirst product page screenshot`;
const LEONARD_INVOICE = `${JUAN}: Leonard Paper invoice 734032 dated 09/15/26 (photo)`;
export const IDS = {
  pfg: "a0d8986c-e097-46f0-9e3f-e70943d4291b",
  leonard: "e7a52be1-7697-4db8-97aa-eb34bda62080",
  worcestershire: "11f7f7ad-4515-42db-a4e0-9b0fabbef4d4",
  baldorCholula: "f70a0a6d-d7ac-4a01-b529-56abbbd2ea3d",
  pfgCholula: "39000000-0000-5000-a000-000000000001",
  cholulaMayoLine: "a521dae7-5236-419e-b30f-e7d4474d6471",
  frenchDipLadle: "a1f39c2a-73b4-4c67-be40-b974f01f7eb3",
  jusItem: "f1e2d0a3-183f-45fe-a680-9d1cb8ba4022",
  cannoliPfg: "2f71d6db-919f-48d6-8da4-62e95335023f",
  cannoliBaldor: "8175a393-5d1a-4354-8a78-75eb4b3fc8ac",
} as const;
const level = (n: number) => `39000000-0000-5000-a000-0000000000${n.toString(16).padStart(2, "0")}`;

export interface PfgSku { sku: string | null; name: string; item_number: string; caseQty: number; eachSize: number; eachMeasure: "fl oz"; eachLabel: string; price: number; effective: string; levels: [string, string] }
export const PFG: readonly PfgSku[] = [
  { sku: IDS.worcestershire, name: "Worcestershire", item_number: "341010", caseQty: 3, eachSize: 128, eachMeasure: "fl oz", eachLabel: "Jug", price: 65.74, effective: "2026-09-20", levels: [level(0x10), level(0x11)] },
  { sku: null, name: "Cholula", item_number: "525032", caseQty: 4, eachSize: 64, eachMeasure: "fl oz", eachLabel: "Bottle", price: 57.70, effective: "2026-09-20", levels: [level(0x12), level(0x13)] },
];
export interface LeonardLine { item_number: string; price: number; basis: "per_case" | "per_bundle"; pack: { label: string; qty: number; unit: "each" | "oz" } | null; levelId: string; note: string }
export const LEONARD: readonly LeonardLine[] = [
  { item_number: "FC-NP72", price: 39.95, basis: "per_case", pack: { label: "Case", qty: 250, unit: "each" }, levelId: level(0x20), note: "KRAFT 10x6.75x12 SHOPPING BAG 250/BDL" },
  { item_number: "FC-NP12916", price: 54.95, basis: "per_case", pack: { label: "Case", qty: 200, unit: "each" }, levelId: level(0x21), note: "KRAFT 12.8x9x15.75 SHOP BAG 200/BDL" },
  { item_number: "PL-RDTFL", price: 17.99, basis: "per_case", pack: { label: "Case", qty: 500, unit: "each" }, levelId: level(0x22), note: "POLY-PRO CLEAR DELI CONT LID 500/CS" },
  { item_number: "PL-RD8C", price: 24.99, basis: "per_case", pack: { label: "Case", qty: 500, unit: "each" }, levelId: level(0x23), note: "8 OZ POLY-PRO CLEAR DELI CONT 500/CS" },
  { item_number: "EM-PF252", price: 42.50, basis: "per_case", pack: null, levelId: level(0x24), note: "LARGE LATEX POWDER FREE GLOVE 100/BOX, billed per CS (boxes per case not stated)" },
  { item_number: "EM-PF251", price: 42.50, basis: "per_case", pack: null, levelId: level(0x25), note: "MEDIUM LATEX POWDER FREE GLOVE 100/BOX, billed per CS (boxes per case not stated)" },
  { item_number: "JR-4046XH", price: 24.95, basis: "per_case", pack: { label: "Case", qty: 100, unit: "each" }, levelId: level(0x26), note: "40x46 X-HEAVY BLACK LINER 100/CS" },
  { item_number: "S-1824PS", price: 58.50, basis: "per_bundle", pack: { label: "Bundle", qty: 640, unit: "oz" }, levelId: level(0x27), note: "18x24 PREMIUM SUB WRAP 40#/BDL = 640 oz" },
];
export const LEONARD_EFFECTIVE = "2026-09-15";
export const LEONARD_ACCOUNT = "37630";
export const PRICE_SOURCE = "floor-prices-2026-09-20";
export const WEIGHTS = { cannoliOz: 0.3, jusQuartOz: 29, ladleOz: 5 } as const;
export const HELD = [
  "Chicken salad 6 oz: per-sandwich portion or the whole tub? Not written until Juan says which.",
  "Gloves EM-PF252 / EM-PF251: $42.50 per case recorded; boxes per case not on the invoice, so no pack chain.",
  "Leonard SW-182 18x2000 sealwrap ($19.95/roll) is not the catalog's SW-242 Plastic Wrap: not written; a new SKU needs Juan's word.",
  "White Wine and Vanilla Bean Paste still have no vendor or price.",
  "Baldor Cholula (SAUCE6B) stays active as the backup and keeps its Baldor starter-guide line.",
] as const;

interface Tables { vendors: RawRow[]; vendor_items: RawRow[]; sku_pack_levels: RawRow[]; vendor_price_history: RawRow[]; items: RawRow[]; recipe_inputs: RawRow[]; users: RawRow[] }
export interface Plan { section: "skus" | "prices" | "packs" | "weights" | "items" | "recipes" | "vendor"; name: string; status: "ready" | "already" | "refused"; before: unknown; after: unknown; source: string; reason?: string; expected: RawRow }
const n = (v: unknown): number | null => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const one = (rows: RawRow[], what: string): RawRow => { if (rows.length !== 1) throw new Error(`${what}: expected one row, found ${rows.length}`); return rows[0]!; };
const leonardSku = (t: Tables, item: string) => one(t.vendor_items.filter(r => r.vendor_id === IDS.leonard && r.item_number === item && r.active === true), `Leonard ${item}`);
const latestPrice = (t: Tables, skuId: string) => t.vendor_price_history.filter(r => r.vendor_item_id === skuId).sort((a, b) => String(b.effective_date).localeCompare(String(a.effective_date)) || String(b.recorded_at).localeCompare(String(a.recorded_at)))[0] ?? null;

export function planFloorAnswers(t: Tables): Plan[] {
  const result: Plan[] = [];
  const add = (section: Plan["section"], name: string, source: string, after: unknown, work: (p: Plan) => void) => {
    const p: Plan = { section, name, source, before: null, after, status: "ready", expected: {} };
    try { work(p); } catch (e) { p.status = "refused"; p.reason = e instanceof Error ? e.message : "Invalid before-state"; }
    result.push(p);
  };
  const pfg = one(t.vendors.filter(r => r.id === IDS.pfg && r.active === true), "PFG vendor");
  for (const spec of PFG) {
    const mirror = { vendor_id: pfg.id, item_number: spec.item_number, pack_format: "Case", units_per_pack: spec.caseQty, each_size: spec.eachSize, each_measure: spec.eachMeasure, price_basis: "per_case" };
    add("skus", `${spec.name} (PFG ${spec.item_number})`, PFG_PAGE, { ...mirror, levels: [`Case x${spec.caseQty}`, `${spec.eachLabel} ${spec.eachSize} ${spec.eachMeasure}`] }, p => {
      const existing = spec.sku ? one(t.vendor_items.filter(r => r.id === spec.sku), spec.name) : t.vendor_items.find(r => r.id === IDS.pfgCholula) ?? null;
      const levels = t.sku_pack_levels.filter(r => spec.levels.includes(String(r.id)));
      p.expected = { sku: existing, levels };
      p.before = existing ? { vendor_id: existing.vendor_id, item_number: existing.item_number, pack_format: existing.pack_format, units_per_pack: n(existing.units_per_pack), each_size: n(existing.each_size), each_measure: existing.each_measure, price_basis: existing.price_basis, levels: levels.length } : null;
      if (t.vendor_items.some(r => r.id !== existing?.id && r.vendor_id === pfg.id && r.item_number === spec.item_number)) throw new Error(`PFG item ${spec.item_number} already on another SKU`);
      if (existing && existing.active !== true) throw new Error("SKU inactive");
      const done = existing && existing.vendor_id === pfg.id && existing.item_number === spec.item_number && n(existing.units_per_pack) === spec.caseQty && n(existing.each_size) === spec.eachSize && existing.each_measure === spec.eachMeasure && existing.price_basis === "per_case" && levels.length === 2;
      if (done) { p.status = "already"; return; }
      if (existing && spec.sku && existing.vendor_id != null && existing.vendor_id !== pfg.id) throw new Error("SKU already belongs to another vendor");
      if (existing && spec.sku && (existing.item_number != null || levels.length || t.sku_pack_levels.some(r => r.sku_id === existing.id && r.active === true))) throw new Error("SKU already has an item number or pack chain; reconcile");
      if (existing && !spec.sku) throw new Error("Partially created PFG Cholula; reconcile");
    });
    add("prices", `${spec.name} $${spec.price.toFixed(2)} per case @ ${spec.effective}`, PFG_PAGE, { unit_price: spec.price, effective_date: spec.effective, source: PRICE_SOURCE }, p => {
      const skuId = spec.sku ?? IDS.pfgCholula;
      const rows = t.vendor_price_history.filter(r => r.vendor_item_id === skuId);
      const latest = latestPrice(t, skuId);
      p.expected = { skuId };
      p.before = latest ? { unit_price: n(latest.unit_price), effective_date: latest.effective_date, source: latest.source } : null;
      if (rows.some(r => r.source === PRICE_SOURCE && n(r.unit_price) === spec.price && r.effective_date === spec.effective)) { p.status = "already"; return; }
      if (rows.some(r => r.effective_date === spec.effective)) throw new Error("A different price already carries this effective date");
      if (latest && String(latest.effective_date) > spec.effective) throw new Error("Catalog holds a newer price");
    });
  }
  add("recipes", "Cholula Mayo: Cholula line → PFG SKU", `${JUAN}: Cholula is bought from PFG now (added to the PFG list today)`, { component_sku_id: IDS.pfgCholula }, p => {
    const line = one(t.recipe_inputs.filter(r => r.id === IDS.cholulaMayoLine), "Cholula Mayo line");
    p.expected = { line }; p.before = { component_sku_id: line.component_sku_id };
    if (line.component_sku_id === IDS.pfgCholula) { p.status = "already"; return; }
    if (line.component_sku_id !== IDS.baldorCholula) throw new Error("Line no longer points at the Baldor Cholula SKU");
  });
  const leonard = one(t.vendors.filter(r => r.id === IDS.leonard && r.active === true), "Leonard Paper vendor");
  for (const line of LEONARD) {
    add("prices", `${line.item_number} $${line.price.toFixed(2)} ${line.basis} @ ${LEONARD_EFFECTIVE}`, LEONARD_INVOICE, { unit_price: line.price, effective_date: LEONARD_EFFECTIVE, price_basis: line.basis, source: PRICE_SOURCE }, p => {
      const sku = leonardSku(t, line.item_number);
      const rows = t.vendor_price_history.filter(r => r.vendor_item_id === sku.id);
      const latest = latestPrice(t, String(sku.id));
      p.expected = { sku };
      p.before = { price_basis: sku.price_basis, latest: latest ? { unit_price: n(latest.unit_price), effective_date: latest.effective_date, source: latest.source } : null };
      const priced = rows.some(r => r.source === PRICE_SOURCE && n(r.unit_price) === line.price && r.effective_date === LEONARD_EFFECTIVE);
      if (priced && sku.price_basis === line.basis) { p.status = "already"; return; }
      if (priced !== (sku.price_basis === line.basis)) throw new Error("Half-applied price/basis; reconcile");
      if (rows.some(r => r.effective_date === LEONARD_EFFECTIVE)) throw new Error("A different price already carries this effective date");
      if (latest && String(latest.effective_date) > LEONARD_EFFECTIVE) throw new Error("Catalog holds a newer price");
      if (sku.price_basis != null && sku.price_basis !== line.basis) throw new Error(`Basis already ${sku.price_basis}`);
    });
    if (!line.pack) continue;
    add("packs", `${line.item_number} ${line.pack.label} ${line.pack.qty} ${line.pack.unit}`, LEONARD_INVOICE, { pack_format: line.pack.label, units_per_pack: 1, each_size: line.pack.qty, each_measure: line.pack.unit, level: line.levelId }, p => {
      const sku = leonardSku(t, line.item_number);
      const active = t.sku_pack_levels.filter(r => r.sku_id === sku.id && r.active === true);
      const seeded = active.find(r => r.id === line.levelId) ?? null;
      p.expected = { sku, seeded };
      p.before = { pack_format: sku.pack_format, units_per_pack: n(sku.units_per_pack), each_size: n(sku.each_size), each_measure: sku.each_measure, active_levels: active.length };
      if (seeded && sku.pack_format === line.pack!.label && n(sku.units_per_pack) === 1 && n(sku.each_size) === line.pack!.qty && sku.each_measure === line.pack!.unit) { p.status = "already"; return; }
      if (seeded) throw new Error("Level exists but the mirror disagrees; reconcile");
      if (active.length) throw new Error("SKU already has an active pack chain");
      if (n(sku.each_size) != null && n(sku.each_size) !== line.pack!.qty) throw new Error(`Mirror says ${sku.each_size} ${sku.each_measure}; invoice says ${line.pack!.qty}`);
    });
  }
  add("vendor", `Leonard Paper customer number ${LEONARD_ACCOUNT}`, LEONARD_INVOICE, { account_number: LEONARD_ACCOUNT }, p => {
    p.expected = { vendor: leonard }; p.before = { account_number: leonard.account_number };
    if (leonard.account_number === LEONARD_ACCOUNT) { p.status = "already"; return; }
    if (leonard.account_number != null) throw new Error(`Vendor already carries account ${leonard.account_number}`);
  });
  for (const [label, skuId] of [["PFG", IDS.cannoliPfg], ["Baldor", IDS.cannoliBaldor]] as const) {
    add("weights", `Cannoli Shell (${label}) ${WEIGHTS.cannoliOz} oz each`, `${JUAN}: "Cannoli shell - 0.3" on the scale`, { avg_oz_per_each: WEIGHTS.cannoliOz, weight_class: "OPERATIONAL" }, p => {
      const sku = one(t.vendor_items.filter(r => r.id === skuId && r.active === true), `Cannoli Shell ${label}`);
      p.expected = { sku }; p.before = { avg_oz_per_each: n(sku.avg_oz_per_each), weight_class: sku.weight_class };
      if (n(sku.avg_oz_per_each) === WEIGHTS.cannoliOz && sku.weight_class === "OPERATIONAL") { p.status = "already"; return; }
      if (sku.weight_class === "OPERATIONAL" || sku.weight_class === "SPEC") throw new Error(`A ${sku.weight_class} weight is already on file: ${sku.avg_oz_per_each} oz`);
    });
  }
  add("items", `Jus: ${WEIGHTS.jusQuartOz} oz per Quart`, `${JUAN}: "Quart of Jus - 1lb 13oz"`, { oz_per_par_unit: WEIGHTS.jusQuartOz }, p => {
    const item = one(t.items.filter(r => r.id === IDS.jusItem && r.active === true), "Jus item");
    p.expected = { item }; p.before = { oz_per_par_unit: n(item.oz_per_par_unit), default_par_unit: item.default_par_unit };
    if (item.default_par_unit !== "Quart") throw new Error(`Par unit is ${item.default_par_unit}, not Quart`);
    if (n(item.oz_per_par_unit) === WEIGHTS.jusQuartOz) { p.status = "already"; return; }
    if (n(item.oz_per_par_unit) != null) throw new Error(`Already ${item.oz_per_par_unit} oz`);
  });
  add("recipes", `Our French Dip: 1 ladle of Jus → ${WEIGHTS.ladleOz} oz`, `${JUAN}: "Ladle of Jus - 5oz"`, { quantity: WEIGHTS.ladleOz, unit: "oz" }, p => {
    const line = one(t.recipe_inputs.filter(r => r.id === IDS.frenchDipLadle), "French Dip Jus line");
    p.expected = { line }; p.before = { quantity: n(line.quantity), unit: line.unit };
    if (line.component_item_id !== IDS.jusItem) throw new Error("Line no longer points at the Jus item");
    if (line.unit === "oz" && n(line.quantity) === WEIGHTS.ladleOz) { p.status = "already"; return; }
    if (line.unit !== "ladle" || n(line.quantity) !== 1) throw new Error(`Line reads ${line.quantity} ${line.unit}`);
  });
  return result;
}

export function validateArgs(args: string[], env: Record<string, string | undefined> = process.env) {
  if (args.filter(a => a === "--dry-run").length > 1 || (args.includes("--dry-run") && args.includes("--execute"))) throw new Error("Conflicting/duplicate dry-run option");
  if (args.some(a => ["--wave7", "--readiness", "--as-of"].includes(a))) throw new Error("Unsupported seed-39 option");
  return validateTarget(args.filter(a => a !== "--dry-run"), env);
}
async function readTables(sb: SupabaseClient): Promise<Tables> {
  const names: (keyof Tables)[] = ["vendors", "vendor_items", "sku_pack_levels", "vendor_price_history", "items", "recipe_inputs", "users"];
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await loadAll(sb, name, name === "users" ? "id,email,active" : "*")]))) as Tables;
}
async function update(sb: SupabaseClient, table: string, before: RawRow, values: RawRow): Promise<void> {
  let q = sb.from(table).update(values, { count: "exact" }).eq("id", before.id);
  for (const [key, value] of Object.entries(before)) {
    if (key === "id" || typeof value === "object" && value !== null) continue;
    q = value == null ? q.is(key, null) : q.eq(key, value);
  }
  const { error, count } = await q;
  if (error || count !== 1) throw new Error(`${table}: guarded UPDATE failed or matched ${count ?? "unknown"} rows`);
}
async function insert(sb: SupabaseClient, table: string, row: RawRow): Promise<void> {
  const { error } = await sb.from(table).insert(row);
  if (error) throw new Error(`${table}: INSERT failed (${error.code ?? "unknown"} ${error.message}); stop and reconcile partial operation`);
}
async function record(sb: SupabaseClient, action: AuditAction, table: string, id: string, p: Plan, extra: RawRow = {}): Promise<void> {
  const { audit } = await import("@/lib/audit");
  const operation = randomUUID();
  await audit({ actorId: null, actorRole: null, action, resourceTable: table, resourceId: id, metadata: { source: SOURCE, operation, source_note: p.source, before: p.before, after: p.after, ...extra }, ipAddress: null, userAgent: null });
  const { data, error } = await sb.from("audit_log").select("id").eq("action", action).eq("resource_id", id).contains("metadata", { source: SOURCE, operation });
  if (error || data?.length !== 1) throw new Error(`${table}: audit readback failed; stop and reconcile (audit helper is fail-open)`);
}
const juanId = (t: Tables) => t.users.find(u => u.email === "juan@complimentsonlysubs.com" && u.active === true)?.id ?? null;
async function apply(sb: SupabaseClient, p: Plan, t: Tables): Promise<void> {
  const now = new Date().toISOString();
  if (p.section === "skus") {
    const spec = PFG.find(s => p.name.startsWith(`${s.name} `))!, existing = p.expected.sku as RawRow | null;
    const mirror = { vendor_id: IDS.pfg, item_number: spec.item_number, pack_format: "Case", units_per_pack: spec.caseQty, each_size: spec.eachSize, each_measure: spec.eachMeasure, price_basis: "per_case" };
    if (existing) {
      await update(sb, "vendor_items", existing, { ...mirror, updated_at: now, updated_by: null });
      await record(sb, "vendor_item.update", "vendor_items", String(existing.id), p, { fields: Object.keys(mirror), item_number: spec.item_number });
    } else {
      await insert(sb, "vendor_items", { id: IDS.pfgCholula, name: spec.name, location_id: null, active: true, sku_class: "raw", inventory_only: false, product_id: null, ...mirror, notes: `[${SOURCE}] PFG ${spec.item_number} 4/.5 GA from the CustomerFirst product page; twin of the Baldor Cholula SKU (SAUCE6B), which stays as the backup` });
      await record(sb, "vendor_item.create", "vendor_items", IDS.pfgCholula, p, { name: spec.name, vendor: "PFG", twin_of: IDS.baldorCholula, creation_method: "seed_script" });
    }
    const skuId = existing ? String(existing.id) : IDS.pfgCholula;
    await insert(sb, "sku_pack_levels", { id: spec.levels[1], sku_id: skuId, label: spec.eachLabel, contains_qty: spec.eachSize, contains_level_id: null, contains_measure_unit: spec.eachMeasure, display_ordinal: 1, active: true, created_by: null });
    await insert(sb, "sku_pack_levels", { id: spec.levels[0], sku_id: skuId, label: "Case", contains_qty: spec.caseQty, contains_level_id: spec.levels[1], contains_measure_unit: null, display_ordinal: 0, active: true, created_by: null });
    for (const id of spec.levels) await record(sb, "sku.pack_level_supersede", "sku_pack_levels", id, p, { sku_id: skuId, superseded: [], chain: `Case x${spec.caseQty} -> ${spec.eachLabel} ${spec.eachSize} ${spec.eachMeasure}` });
  } else if (p.section === "prices") {
    const spec = PFG.find(s => p.name.startsWith(`${s.name} `)), line = LEONARD.find(l => p.name.startsWith(`${l.item_number} `));
    const skuId = spec ? String(p.expected.skuId) : String((p.expected.sku as RawRow).id);
    const price = spec ? { unit_price: spec.price, effective_date: spec.effective, note: `PFG CustomerFirst product page ${spec.item_number}, read 2026-09-20` } : { unit_price: line!.price, effective_date: LEONARD_EFFECTIVE, note: `Leonard invoice 734032 line: ${line!.note}` };
    const id = randomUUID();
    await insert(sb, "vendor_price_history", { id, vendor_item_id: skuId, unit_price: price.unit_price, effective_date: price.effective_date, recorded_at: now, recorded_by: null, source: PRICE_SOURCE, source_note: `[${SOURCE}] ${price.note}` });
    await record(sb, "sku.price_supersede", "vendor_price_history", id, p, { sku_id: skuId, unit_price: price.unit_price, effective_date: price.effective_date });
    if (line) {
      const sku = p.expected.sku as RawRow;
      if (sku.price_basis !== line.basis) {
        await update(sb, "vendor_items", sku, { price_basis: line.basis, updated_at: now, updated_by: null });
        await record(sb, "sku.price_basis_set", "vendor_items", String(sku.id), p, { price_basis: line.basis });
      }
    }
  } else if (p.section === "packs") {
    const line = LEONARD.find(l => p.name.startsWith(`${l.item_number} `))!, sku = p.expected.sku as RawRow;
    await insert(sb, "sku_pack_levels", { id: line.levelId, sku_id: sku.id, label: line.pack!.label, contains_qty: line.pack!.qty, contains_level_id: null, contains_measure_unit: line.pack!.unit, display_ordinal: 0, active: true, created_by: null });
    await record(sb, "sku.pack_level_supersede", "sku_pack_levels", line.levelId, p, { sku_id: sku.id, superseded: [], chain: `${line.pack!.label} ${line.pack!.qty} ${line.pack!.unit}` });
    await update(sb, "vendor_items", sku, { pack_format: line.pack!.label, units_per_pack: 1, each_size: line.pack!.qty, each_measure: line.pack!.unit, updated_at: now, updated_by: null });
    await record(sb, "vendor_item.update", "vendor_items", String(sku.id), p, { fields: ["pack_format", "units_per_pack", "each_size", "each_measure"] });
  } else if (p.section === "weights") {
    const sku = p.expected.sku as RawRow;
    await update(sb, "vendor_items", sku, { avg_oz_per_each: WEIGHTS.cannoliOz, weight_class: "OPERATIONAL", weight_source_note: `[${SOURCE}] Juan weighed one shell on the shop scale: 0.3 oz`, weight_established_at: now, weight_established_by: juanId(t), updated_at: now, updated_by: null });
    await record(sb, "vendor_item.update", "vendor_items", String(sku.id), p, { fields: ["avg_oz_per_each", "weight_class", "weight_source_note", "weight_established_at", "weight_established_by"] });
  } else if (p.section === "items") {
    const item = p.expected.item as RawRow;
    await update(sb, "items", item, { oz_per_par_unit: WEIGHTS.jusQuartOz, updated_at: now, updated_by: null });
    await record(sb, "item.update", "items", String(item.id), p, { fields: ["oz_per_par_unit"] });
  } else if (p.section === "recipes") {
    const line = p.expected.line as RawRow;
    const values = p.name.startsWith("Cholula") ? { component_sku_id: IDS.pfgCholula } : { quantity: WEIGHTS.ladleOz, unit: "oz" };
    await update(sb, "recipe_inputs", line, values);
    await record(sb, "recipe_input.update", "recipe_inputs", String(line.id), p, { recipe_id: line.recipe_id, ...values });
  } else {
    const vendor = p.expected.vendor as RawRow;
    await update(sb, "vendors", vendor, { account_number: LEONARD_ACCOUNT, updated_at: now, updated_by: null });
    await record(sb, "vendor.full_profile_edit", "vendors", String(vendor.id), p, { scope: "account_number", op: "set" });
  }
}
/** Only this plan's permitted writes may differ; every other row and field stays equal. */
export function verifyWriteScope(before: Tables, after: Tables, p: Plan): void {
  const skuId = String((p.expected.sku as RawRow | null)?.id ?? p.expected.skuId ?? IDS.pfgCholula);
  const spec = p.section === "skus" ? PFG.find(s => p.name.startsWith(`${s.name} `)) : null;
  const line = p.section === "packs" ? LEONARD.find(l => p.name.startsWith(`${l.item_number} `)) : null;
  for (const table of Object.keys(before) as (keyof Tables)[]) {
    const allowed = (r: RawRow): string[] => {
      if (table !== "vendor_items" && table !== "items" && table !== "recipe_inputs" && table !== "vendors") return [];
      if (p.section === "skus" && table === "vendor_items" && r.id === skuId) return ["vendor_id", "item_number", "pack_format", "units_per_pack", "each_size", "each_measure", "price_basis", "updated_at", "updated_by"];
      if (p.section === "prices" && table === "vendor_items" && r.id === skuId) return ["price_basis", "updated_at", "updated_by"];
      if (p.section === "packs" && table === "vendor_items" && r.id === skuId) return ["pack_format", "units_per_pack", "each_size", "each_measure", "updated_at", "updated_by"];
      if (p.section === "weights" && table === "vendor_items" && r.id === skuId) return ["avg_oz_per_each", "weight_class", "weight_source_note", "weight_established_at", "weight_established_by", "updated_at", "updated_by"];
      if (p.section === "items" && table === "items" && r.id === (p.expected.item as RawRow).id) return ["oz_per_par_unit", "updated_at", "updated_by"];
      if (p.section === "recipes" && table === "recipe_inputs" && r.id === (p.expected.line as RawRow).id) return ["component_sku_id", "quantity", "unit"];
      if (p.section === "vendor" && table === "vendors" && r.id === IDS.leonard) return ["account_number", "updated_at", "updated_by"];
      return [];
    };
    const addedAllowed = (r: RawRow) => p.section === "skus" ? (table === "vendor_items" && r.id === IDS.pfgCholula && !spec?.sku) || (table === "sku_pack_levels" && !!spec && spec.levels.includes(String(r.id)))
      : p.section === "prices" ? table === "vendor_price_history" && r.vendor_item_id === skuId && r.source === PRICE_SOURCE
      : p.section === "packs" ? table === "sku_pack_levels" && r.id === line?.levelId : false;
    const oldIds = new Set(before[table].map(r => r.id));
    const normalize = (rows: RawRow[]) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([key]) => !allowed(r).includes(key)))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const existingAfter = after[table].filter(r => oldIds.has(r.id) || !addedAllowed(r));
    if (!equal(normalize(before[table]), normalize(existingAfter))) throw new Error(`${p.name}: unrelated/concurrent ${table} change; stop for a fresh reviewed dry-run`);
  }
}
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const config = validateArgs(args), sb = createWave7Client(config);
  let expectedTables = await readTables(sb);
  const plans = planFloorAnswers(expectedTables);
  const digest = createHash("sha256").update(canonical({ project: config.projectRef, source: SOURCE, plans: plans.map(({ expected: _expected, ...rest }) => rest) })).digest("hex");
  console.log(`${SOURCE}: ${config.execute ? "EXECUTE" : "DRY RUN"}, target ${config.target}`);
  for (const section of ["skus", "prices", "packs", "weights", "items", "recipes", "vendor"] as const) {
    console.log(`\n${section}`);
    console.table(plans.filter(p => p.section === section).map(p => ({ row: p.name, before: JSON.stringify(p.before), after: JSON.stringify(p.after), status: p.status, refusal: p.reason ?? "" })));
  }
  console.log(`HELD (not written):\n- ${HELD.join("\n- ")}`);
  console.log(`Plan digest: ${digest}`);
  if (!config.execute) { console.log("No writes. Execute with the same --target and --execute --plan-digest shown above."); return; }
  if (config.planDigest !== digest) throw new Error("Plan changed; review a fresh dry-run");
  if (plans.some(p => p.status === "refused")) throw new Error("Refused before-state(s); no writes. Resolve before execute.");
  for (const p of plans) {
    const tables = await readTables(sb);
    if (!equal(tables, expectedTables)) throw new Error("Database changed after reviewed snapshot; no further writes");
    const current = planFloorAnswers(tables).find(r => r.section === p.section && r.name === p.name)!;
    if (current.status === "already") { console.log(`already: ${p.name}`); continue; }
    if (current.status !== "ready") throw new Error(`${p.name}: before-state changed during execution`);
    await apply(sb, current, tables);
    const afterTables = await readTables(sb);
    verifyWriteScope(tables, afterTables, current);
    const verified = planFloorAnswers(afterTables).find(r => r.section === p.section && r.name === p.name)!;
    if (verified.status !== "already") throw new Error(`${p.name}: destination verification failed (${verified.status}: ${verified.reason ?? ""}); reconcile partial operation`);
    expectedTables = afterTables;
    console.log(`verified: ${p.name}`);
  }
  const final = planFloorAnswers(await readTables(sb));
  if (final.some(p => p.status !== "already")) throw new Error("Final idempotence check failed");
  console.log("Verified every row and audit read-back; a rerun has zero writes.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Seed 39 failed"); process.exitCode = 1; });
}
