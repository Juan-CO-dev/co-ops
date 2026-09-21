/**
 * Seed 40: Juan's second batch of 2026-09-20 floor answers (Claude chat, shop day), applied to the catalog.
 *   1. "Chicken salad is a side… all sides are 6oz… the same sides are what we put in a sub" → the Chix / Tuna / Egg Salad
 *      side portions go from 8 oz to 6 oz (the sub builds already use 6 oz).
 *   2. "The eggs are the medium ones" → the PFG "Eggs" SKU carried the COOKED eggs' number (439686, a duplicate key). It becomes
 *      517842 EGG WHITE MEDIUM AA LOOSE 1/15 DZ (PFG purchase history export 2026-09-18: $13.36/CS, last bought 2026-07-18):
 *      item number, a Case → Egg chain of 180 × 1.75 oz (USDA medium = 21 oz/dozen, SPEC), per_case basis, the $13.36 price;
 *      the laminated guide's "Eggs" line links to the SKU and loses its "tentative" note (guide RPC, ownership-checked).
 *      The old $51.93 row (large, 30 dz) stays in history; append-only.
 *   3. "The plastic wrap changes sometimes" → Leonard's Plastic Wrap keeps SW-242 as its number; invoice 734032's SW-182
 *      (18" x 2000') is the same roll under another code: $19.95 per roll (per_each) recorded, code variance noted on the SKU.
 *   Held: gloves (boxes per case unknown — "not sure").
 * Dry-run default. CC runs sim, then prod; this module never loads an env file.
 * --target sim|prod [--dry-run | --execute --plan-digest <dry-run digest>]; prod also needs ANGEL_WAVE7_PROD_CONFIRM.
 */
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonical, type RawRow } from "@/lib/angel-wave7";
import type { AuditAction } from "@/lib/audit-actions";
import { createWave7Client, loadAll, validateTarget } from "./26-angel-wave7";

export const SOURCE = "floor-answers-2026-09-20b";
const JUAN = "Juan 2026-09-20 (Claude chat, shop day, second batch)";
export const PRICE_SOURCE = "floor-prices-2026-09-20";
export const IDS = {
  pfg: "a0d8986c-e097-46f0-9e3f-e70943d4291b",
  eggs: "7de78f9b-bc00-4e42-be3a-80419048eaa3",
  eggsCooked: "d6c913a4-888b-4d2d-a151-9a15c9dd69c4",
  plasticWrap: "9534aaac-d9f2-4fa8-bca5-d2c4bae8a063",
  chixSalad: "08fa8979-c9dc-41f9-904f-9680289d0437",
  tunaSalad: "403d2e13-d22a-4d05-9196-74aeba2f98d7",
  eggSalad: "1f27d888-a7c4-460b-8951-6b0be8454c6b",
  eggsCaseLevel: "40000000-0000-5000-a000-000000000010",
  eggsEggLevel: "40000000-0000-5000-a000-000000000011",
} as const;
export const SIDES = [["Chix Salad", IDS.chixSalad], ["Tuna Salad", IDS.tunaSalad], ["Egg Salad", IDS.eggSalad]] as const;
export const SIDE_OZ = 6;
export const EGGS = { item_number: "517842", oldNumber: "439686", description: "EGG WHITE MEDIUM AA LOOSE 1/15 DZ", caseEggs: 180, eggOz: 1.75, price: 13.36, effective: "2026-09-18",
  evidence: "docs/seed/source/vendor-exports/normalized/pfg-purchase-history-2026-09-18.json row 517842 ($13.36/CS, last purchase 2026-07-18)" } as const;
export const WRAP = { price: 19.95, effective: "2026-09-15", note: "Leonard's code varies: SW-242 on the sheet, SW-182 (18\" x 2000') on invoice 734032; same roll (Juan 2026-09-20: \"the plastic wrap changes sometimes\")" } as const;
export const HELD = ["Gloves EM-PF252 / EM-PF251: boxes per case still unknown (Juan: not sure); price per case is on file from seed 39, no pack chain."] as const;

interface Tables { vendor_items: RawRow[]; sku_pack_levels: RawRow[]; vendor_price_history: RawRow[]; items: RawRow[]; vendor_order_guides: RawRow[]; order_guide_sections: RawRow[]; order_guide_lines: RawRow[] }
export interface Plan { section: "sides" | "eggs" | "guide" | "wrap"; name: string; status: "ready" | "already" | "refused"; before: unknown; after: unknown; source: string; reason?: string; expected: RawRow }
const n = (v: unknown): number | null => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const one = (rows: RawRow[], what: string): RawRow => { if (rows.length !== 1) throw new Error(`${what}: expected one row, found ${rows.length}`); return rows[0]!; };
const priced = (t: Tables, skuId: string, price: number, effective: string) => t.vendor_price_history.some(r => r.vendor_item_id === skuId && r.source === PRICE_SOURCE && n(r.unit_price) === price && r.effective_date === effective);

export function planFloorAnswers(t: Tables): Plan[] {
  const result: Plan[] = [];
  const add = (section: Plan["section"], name: string, source: string, after: unknown, work: (p: Plan) => void) => {
    const p: Plan = { section, name, source, before: null, after, status: "ready", expected: {} };
    try { work(p); } catch (e) { p.status = "refused"; p.reason = e instanceof Error ? e.message : "Invalid before-state"; }
    result.push(p);
  };
  for (const [name, id] of SIDES) {
    add("sides", `${name}: side portion ${SIDE_OZ} oz`, `${JUAN}: "all sides are 6oz"`, { sell_portion: SIDE_OZ, sell_portion_unit: "oz" }, p => {
      const item = one(t.items.filter(r => r.id === id && r.active === true && r.location_id == null), name);
      p.expected = { item }; p.before = { sell_portion: n(item.sell_portion), sell_portion_unit: item.sell_portion_unit, sold_directly: item.sold_directly };
      if (item.sold_directly !== true) throw new Error("Item is not sold directly");
      if (n(item.sell_portion) === SIDE_OZ && item.sell_portion_unit === "oz") { p.status = "already"; return; }
      if (item.sell_portion_unit !== "oz") throw new Error(`Portion unit is ${item.sell_portion_unit}`);
    });
  }
  add("eggs", `Eggs → PFG ${EGGS.item_number} medium, Case 180 × ${EGGS.eggOz} oz, $${EGGS.price.toFixed(2)} per case`, `${JUAN}: "The eggs are the medium ones"; ${EGGS.evidence}`,
    { item_number: EGGS.item_number, units_per_pack: EGGS.caseEggs, each_size: EGGS.eggOz, each_measure: "oz", avg_oz_per_each: EGGS.eggOz, weight_class: "SPEC", price_basis: "per_case", price: EGGS.price, effective_date: EGGS.effective }, p => {
      const sku = one(t.vendor_items.filter(r => r.id === IDS.eggs && r.active === true), "Eggs SKU");
      const levels = t.sku_pack_levels.filter(r => r.sku_id === sku.id && r.active === true);
      p.expected = { sku, levels };
      p.before = { item_number: sku.item_number, pack_format: sku.pack_format, units_per_pack: n(sku.units_per_pack), each_size: n(sku.each_size), each_measure: sku.each_measure, avg_oz_per_each: n(sku.avg_oz_per_each), weight_class: sku.weight_class, price_basis: sku.price_basis, active_levels: levels.length };
      if (sku.vendor_id !== IDS.pfg) throw new Error("Eggs SKU is not under PFG");
      const seeded = levels.length === 2 && levels.every(l => l.id === IDS.eggsCaseLevel || l.id === IDS.eggsEggLevel);
      const done = sku.item_number === EGGS.item_number && n(sku.units_per_pack) === EGGS.caseEggs && n(sku.each_size) === EGGS.eggOz && sku.price_basis === "per_case" && seeded && priced(t, IDS.eggs, EGGS.price, EGGS.effective);
      if (done) { p.status = "already"; return; }
      if (t.vendor_items.some(r => r.id !== sku.id && r.vendor_id === IDS.pfg && r.item_number === EGGS.item_number)) throw new Error(`PFG ${EGGS.item_number} already on another SKU`);
      if (sku.item_number !== EGGS.oldNumber && sku.item_number !== EGGS.item_number) throw new Error(`Item number is ${sku.item_number}, expected ${EGGS.oldNumber}`);
      if (levels.length && !seeded) throw new Error("Eggs already has an active pack chain from elsewhere");
      if (t.vendor_price_history.some(r => r.vendor_item_id === sku.id && r.effective_date === EGGS.effective && n(r.unit_price) !== EGGS.price)) throw new Error("A different price already carries the export date");
      if (sku.weight_class === "OPERATIONAL") throw new Error("A scale weight is on file; not overwriting with a spec");
    });
  add("guide", "PFG laminated guide: Eggs line -> the Eggs SKU (517842), Eggs (cooked) line -> its SKU (439686), tentative note removed", `${JUAN}: "The eggs are the medium ones"`, { eggs: { sku_id: IDS.eggs, item_number: EGGS.item_number, note: null }, cooked: { sku_id: IDS.eggsCooked, item_number: EGGS.oldNumber } }, p => {
    // Natural keys, not prod ids: the sim re-mints guide ids on every restore (guide tables are HISTORY there). The Eggs line
    // carries 517842 on prod (seed 38) and the laminate's shared 439686 on a sim rebuilt by seed 37; either way it becomes 517842,
    // and once 439686 is unique to the cooked eggs its line can link too.
    const guide = one(t.vendor_order_guides.filter(r => r.vendor_id === IDS.pfg), "PFG guide");
    const sectionIds = new Set(t.order_guide_sections.filter(s => s.guide_id === guide.id).map(s => s.id));
    const line = one(t.order_guide_lines.filter(r => sectionIds.has(r.section_id) && r.label === "Eggs" && ([EGGS.item_number, EGGS.oldNumber, null] as (string | null)[]).includes(r.item_number as string | null)), "Eggs guide line");
    const cooked = one(t.order_guide_lines.filter(r => sectionIds.has(r.section_id) && r.label === "Eggs (cooked)" && r.item_number === EGGS.oldNumber), "Eggs (cooked) guide line");
    const cookedSku = one(t.vendor_items.filter(r => r.id === IDS.eggsCooked && r.vendor_id === IDS.pfg && r.active === true && r.item_number === EGGS.oldNumber), "Eggs (cooked) SKU");
    p.expected = { guide, line, cooked, cookedSku };
    p.before = { eggs: { sku_id: line.sku_id, note: line.note, item_number: line.item_number }, cooked: { sku_id: cooked.sku_id, item_number: cooked.item_number }, updated_at: guide.updated_at };
    const eggsDone = line.sku_id === IDS.eggs && line.note == null && line.item_number === EGGS.item_number;
    const cookedDone = cooked.sku_id === IDS.eggsCooked;
    if (eggsDone && cookedDone) { p.status = "already"; return; }
    if (line.sku_id != null && line.sku_id !== IDS.eggs) throw new Error("Eggs line already linked to another SKU");
    if (cooked.sku_id != null && cooked.sku_id !== IDS.eggsCooked) throw new Error("Eggs (cooked) line already linked to another SKU");
    for (const [skuId, own] of [[IDS.eggs, line.id], [IDS.eggsCooked, cooked.id]] as const) {
      if (t.order_guide_lines.some(r => r.id !== own && r.sku_id === skuId && sectionIds.has(r.section_id))) throw new Error(`SKU ${skuId} already placed elsewhere on this guide`);
    }
  });
  add("wrap", `Plastic Wrap: $${WRAP.price.toFixed(2)} per roll @ ${WRAP.effective}, code variance noted`, `${JUAN}: Leonard invoice 734032 line SW-182 (photo); "the plastic wrap changes sometimes"`, { unit_price: WRAP.price, effective_date: WRAP.effective, price_basis: "per_each", note: WRAP.note }, p => {
    const sku = one(t.vendor_items.filter(r => r.id === IDS.plasticWrap && r.active === true), "Plastic Wrap SKU");
    p.expected = { sku }; p.before = { item_number: sku.item_number, price_basis: sku.price_basis, notes: sku.notes };
    const noted = String(sku.notes ?? "").includes("SW-182");
    if (priced(t, IDS.plasticWrap, WRAP.price, WRAP.effective) && sku.price_basis === "per_each" && noted) { p.status = "already"; return; }
    if (priced(t, IDS.plasticWrap, WRAP.price, WRAP.effective) || noted || (sku.price_basis != null && sku.price_basis !== "per_each")) throw new Error("Half-applied or conflicting state; reconcile");
    if (t.vendor_price_history.some(r => r.vendor_item_id === sku.id && r.effective_date === WRAP.effective)) throw new Error("A different price already carries this effective date");
  });
  return result;
}

export function validateArgs(args: string[], env: Record<string, string | undefined> = process.env) {
  if (args.filter(a => a === "--dry-run").length > 1 || (args.includes("--dry-run") && args.includes("--execute"))) throw new Error("Conflicting/duplicate dry-run option");
  if (args.some(a => ["--wave7", "--readiness", "--as-of"].includes(a))) throw new Error("Unsupported seed-40 option");
  return validateTarget(args.filter(a => a !== "--dry-run"), env);
}
async function readTables(sb: SupabaseClient): Promise<Tables> {
  const names: (keyof Tables)[] = ["vendor_items", "sku_pack_levels", "vendor_price_history", "items", "vendor_order_guides", "order_guide_sections", "order_guide_lines"];
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await loadAll(sb, name)]))) as Tables;
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
async function apply(sb: SupabaseClient, p: Plan, t: Tables): Promise<void> {
  const now = new Date().toISOString();
  if (p.section === "sides") {
    const item = p.expected.item as RawRow;
    await update(sb, "items", item, { sell_portion: SIDE_OZ, sell_portion_unit: "oz", updated_at: now, updated_by: null });
    await record(sb, "item.update", "items", String(item.id), p, { fields: ["sell_portion", "sell_portion_unit"] });
  } else if (p.section === "eggs") {
    const sku = p.expected.sku as RawRow;
    const mirror = { item_number: EGGS.item_number, pack_format: "Case", units_per_pack: EGGS.caseEggs, each_size: EGGS.eggOz, each_measure: "oz", avg_oz_per_each: EGGS.eggOz, weight_class: "SPEC", weight_source_note: `[${SOURCE}] USDA medium egg = 21 oz per dozen = 1.75 oz each; Juan: the medium ones (${EGGS.description})`, weight_established_at: now, weight_established_by: null, price_basis: "per_case" };
    await update(sb, "vendor_items", sku, { ...mirror, updated_at: now, updated_by: null });
    await record(sb, "vendor_item.update", "vendor_items", String(sku.id), p, { fields: Object.keys(mirror), from_item_number: EGGS.oldNumber, to_item_number: EGGS.item_number });
    await insert(sb, "sku_pack_levels", { id: IDS.eggsEggLevel, sku_id: sku.id, label: "Egg", contains_qty: EGGS.eggOz, contains_level_id: null, contains_measure_unit: "oz", display_ordinal: 1, active: true, created_by: null });
    await insert(sb, "sku_pack_levels", { id: IDS.eggsCaseLevel, sku_id: sku.id, label: "Case", contains_qty: EGGS.caseEggs, contains_level_id: IDS.eggsEggLevel, contains_measure_unit: null, display_ordinal: 0, active: true, created_by: null });
    for (const id of [IDS.eggsCaseLevel, IDS.eggsEggLevel]) await record(sb, "sku.pack_level_supersede", "sku_pack_levels", id, p, { sku_id: sku.id, superseded: [], chain: `Case x${EGGS.caseEggs} -> Egg ${EGGS.eggOz} oz` });
    const priceId = randomUUID();
    await insert(sb, "vendor_price_history", { id: priceId, vendor_item_id: sku.id, unit_price: EGGS.price, effective_date: EGGS.effective, recorded_at: now, recorded_by: null, source: PRICE_SOURCE, source_note: `[${SOURCE}] ${EGGS.evidence}` });
    await record(sb, "sku.price_supersede", "vendor_price_history", priceId, p, { sku_id: sku.id, unit_price: EGGS.price, effective_date: EGGS.effective });
  } else if (p.section === "guide") {
    const guide = p.expected.guide as RawRow, line = p.expected.line as RawRow, cooked = p.expected.cooked as RawRow;
    const sections = t.order_guide_sections.filter(s => s.guide_id === guide.id).sort((a, b) => Number(a.position) - Number(b.position)).map(s => ({
      id: s.id, name: s.name, position: s.position,
      lines: t.order_guide_lines.filter(l => l.section_id === s.id).sort((a, b) => Number(a.position) - Number(b.position)).map(l => {
        const row = l.id === line.id ? { ...l, sku_id: IDS.eggs, item_number: EGGS.item_number, note: null } : l.id === cooked.id ? { ...l, sku_id: IDS.eggsCooked } : l;
        return { id: row.id, position: row.position, skuId: row.sku_id, label: row.label, itemNumber: row.item_number, note: row.note };
      }),
    }));
    const { error } = await sb.rpc("save_order_guide", { p_guide_id: guide.id, p_expected_updated_at: guide.updated_at, p_name: guide.name, p_sections: sections });
    if (error) throw new Error(`Guide RPC refused (${error.message}); nothing committed`);
    await record(sb, "vendor.order_guide.edited", "vendor_order_guides", String(guide.id), p, { lines: [{ line_id: line.id, sku_id: IDS.eggs, item_number: EGGS.item_number }, { line_id: cooked.id, sku_id: IDS.eggsCooked }], via: "save_order_guide" });
  } else {
    const sku = p.expected.sku as RawRow;
    const priceId = randomUUID();
    await insert(sb, "vendor_price_history", { id: priceId, vendor_item_id: sku.id, unit_price: WRAP.price, effective_date: WRAP.effective, recorded_at: now, recorded_by: null, source: PRICE_SOURCE, source_note: `[${SOURCE}] Leonard invoice 734032 line SW-182 18x2000 SEALWRAP PVC FILM $19.95/RL` });
    await record(sb, "sku.price_supersede", "vendor_price_history", priceId, p, { sku_id: sku.id, unit_price: WRAP.price, effective_date: WRAP.effective });
    await update(sb, "vendor_items", sku, { price_basis: "per_each", notes: `${sku.notes ? `${sku.notes}\n` : ""}[${SOURCE}] ${WRAP.note}`, updated_at: now, updated_by: null });
    await record(sb, "sku.price_basis_set", "vendor_items", String(sku.id), p, { price_basis: "per_each", notes_appended: true });
  }
}
/** Only this plan's permitted writes may differ; every other row and field stays equal. */
export function verifyWriteScope(before: Tables, after: Tables, p: Plan): void {
  for (const table of Object.keys(before) as (keyof Tables)[]) {
    const allowed = (r: RawRow): string[] => {
      if (p.section === "sides" && table === "items" && r.id === (p.expected.item as RawRow).id) return ["sell_portion", "sell_portion_unit", "updated_at", "updated_by"];
      if (p.section === "eggs" && table === "vendor_items" && r.id === IDS.eggs) return ["item_number", "pack_format", "units_per_pack", "each_size", "each_measure", "avg_oz_per_each", "weight_class", "weight_source_note", "weight_established_at", "weight_established_by", "price_basis", "updated_at", "updated_by"];
      if (p.section === "guide" && table === "order_guide_lines" && r.id === (p.expected.line as RawRow).id) return ["sku_id", "item_number", "note"];
      if (p.section === "guide" && table === "order_guide_lines" && r.id === (p.expected.cooked as RawRow).id) return ["sku_id"];
      if (p.section === "guide" && table === "vendor_order_guides" && r.id === (p.expected.guide as RawRow).id) return ["updated_at"];
      if (p.section === "wrap" && table === "vendor_items" && r.id === IDS.plasticWrap) return ["price_basis", "notes", "updated_at", "updated_by"];
      return [];
    };
    const addedAllowed = (r: RawRow) => p.section === "eggs" ? (table === "sku_pack_levels" && (r.id === IDS.eggsCaseLevel || r.id === IDS.eggsEggLevel)) || (table === "vendor_price_history" && r.vendor_item_id === IDS.eggs && r.source === PRICE_SOURCE)
      : p.section === "wrap" ? table === "vendor_price_history" && r.vendor_item_id === IDS.plasticWrap && r.source === PRICE_SOURCE : false;
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
  const digest = createHash("sha256").update(canonical({ project: config.projectRef, source: SOURCE, plans: plans.map(p => Object.fromEntries(Object.entries(p).filter(([key]) => key !== "expected"))) })).digest("hex");
  console.log(`${SOURCE}: ${config.execute ? "EXECUTE" : "DRY RUN"}, target ${config.target}`);
  console.table(plans.map(p => ({ section: p.section, row: p.name, before: JSON.stringify(p.before), after: JSON.stringify(p.after), status: p.status, refusal: p.reason ?? "" })));
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
  if (planFloorAnswers(await readTables(sb)).some(p => p.status !== "already")) throw new Error("Final idempotence check failed");
  console.log("Verified every row and audit read-back; a rerun has zero writes.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Seed 40 failed"); process.exitCode = 1; });
}
