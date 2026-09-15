/**
 * Seed 36: group the packaging vendor twins under products (Juan 2026-09-15).
 * Seed 35 gave every packaging row on the Leonard sheet a Leonard SKU beside its PFG one (and
 * Cannoli Shell a Baldor twin) — "both as needed". With pars on both rows the ordering walk
 * suggested each item from both vendors on the same day. The product-identity layer (0179)
 * is the fix the catalog already has: one product per pair, both SKUs as members, and the
 * resolver's ladder decides who answers — the manager's designated primary if one is set,
 * ELSE the most-recently-received active member, else any active member.
 * Juan's ruling: "primary vendor should be a naturally occurring thing … manager should set
 * preferred vendor, but whatever is actually coming in is the primary." So this seed designates
 * NO primary (no product_primaries rows): receiving decides, and a manager may set a
 * preference on /admin/products whenever they want it to win.
 * Dry-run default. CC runs sim, then prod; this module never loads an env file.
 * --target sim|prod [--dry-run | --execute --plan-digest <dry-run digest>]
 * Seed 26 guards unchanged; direct writes follow seeds 31–35 (not a transaction; an interrupted
 * pair refuses on retry for CC to reconcile). No schema change; audit actions `product.create`
 * and `product.member_attach` are registered (lib/products.ts writes the same ones).
 */
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonical, type RawRow } from "@/lib/angel-wave7";
import type { AuditAction } from "@/lib/audit-actions";
import { createWave7Client, loadAll, validateTarget } from "./26-angel-wave7";

export const SOURCE = "packaging-products-2026-09-15";
const JUAN = "Juan 2026-09-15 (Claude chat): \"primary vendor should be a naturally occurring thing … manager should set preferred vendor, but whatever is actually coming in is the primary.\"";
export interface PairSpec { product: string; members: readonly { name: string; vendor: string }[] }
/** One product per twin pair. Member names are the live SKU names; the product name is the clean one. */
export const PAIRS: readonly PairSpec[] = [
  { product: "Kraft 10x5x13 (Small Bags)", members: [{ name: "Kraft 10x5x13 (Small Bags)", vendor: "PFG" }, { name: "Kraft 10x5x13 (Small Bags)", vendor: "Leonard Paper" }] },
  { product: "Kraft 12x9x13 (Large Bags)", members: [{ name: "Kraft 12x9x13 (Large Bags)", vendor: "PFG" }, { name: "Kraft 12x9x13 (Large Bags)", vendor: "Leonard Paper" }] },
  { product: "Quart (Large)", members: [{ name: "Quart (Large)", vendor: "PFG" }, { name: "Quart (Large)", vendor: "Leonard Paper" }] },
  { product: "Pint (Medium)", members: [{ name: "Pint (Medium)", vendor: "PFG" }, { name: "Pint (Medium)", vendor: "Leonard Paper" }] },
  { product: "Half Pint 8oz (hard)", members: [{ name: "Half Pint 8oz (hard)", vendor: "PFG" }, { name: "Half Pint 8oz (hard)", vendor: "Leonard Paper" }] },
  { product: "1/2 pint top (flexi)", members: [{ name: "1/2 pint top (flexi)", vendor: "PFG" }, { name: "1/2 pint top (flexi)", vendor: "Leonard Paper" }] },
  { product: "1/2 pint bottoms (flexi)", members: [{ name: "1/2 pint bottoms (flexi)", vendor: "PFG" }, { name: "1/2 pint bottoms (flexi)", vendor: "Leonard Paper" }] },
  { product: "2 oz portion cups", members: [{ name: "2 oz portion cups", vendor: "PFG" }, { name: "2 oz portion cups", vendor: "Leonard Paper" }] },
  { product: "2 oz portion cup lids", members: [{ name: "2 oz portion cup lids", vendor: "PFG" }, { name: "2 oz portion cup lids", vendor: "Leonard Paper" }] },
  { product: "Plastic forks", members: [{ name: "Plastic forks", vendor: "PFG" }, { name: "Plastic forks", vendor: "Leonard Paper" }] },
  { product: "Plastic Spoons", members: [{ name: "Plastic Spoons", vendor: "PFG" }, { name: "Plastic Spoons", vendor: "Leonard Paper" }] },
  { product: "Plastic Knives", members: [{ name: "Plastic Knives", vendor: "PFG" }, { name: "Plastic Knives", vendor: "Leonard Paper" }] },
  { product: "Plates 8\"", members: [{ name: "Plates 8\"", vendor: "PFG" }, { name: "Plates 8\"", vendor: "Leonard Paper" }] },
  { product: "Patty Paper", members: [{ name: "Patty Paper", vendor: "PFG" }, { name: "Patty Paper", vendor: "Leonard Paper" }] },
  { product: "Paper Deli Sheets (Wax Paper)", members: [{ name: "Paper Deli Sheets (Wax Paper)", vendor: "PFG" }, { name: "Paper Deli Sheets (Wax Paper)", vendor: "Leonard Paper" }] },
  { product: "Foil roll", members: [{ name: "Foil roll", vendor: "PFG" }, { name: "Foil roll", vendor: "Leonard Paper" }] },
  { product: "Round Salad Bowls & Lids", members: [{ name: "Round Salad Bowls & Lids", vendor: "PFG" }, { name: "Round Salad Bowls & Lids", vendor: "Leonard Paper" }] },
  { product: "Salad Clam Shell (55oz)", members: [{ name: "Salad Clam Shell (55oz)", vendor: "PFG" }, { name: "Salad Clam Shell (55oz)", vendor: "Leonard Paper" }] },
  { product: "Aluminum Full Pan (Catering)", members: [{ name: "Aluminum Full Pan (Catering)", vendor: "PFG" }, { name: "Aluminum Full Pan (Catering)", vendor: "Leonard Paper" }] },
  { product: "Aluminum Full Pan Lid (Catering)", members: [{ name: "Aluminum Full Pan Lid (Catering)", vendor: "PFG" }, { name: "Aluminum Full Pan Lid (Catering)", vendor: "Leonard Paper" }] },
  { product: "Gloves Medium", members: [{ name: "Gloves Medium", vendor: "PFG" }, { name: "Gloves Medium", vendor: "Leonard Paper" }] },
  { product: "Gloves Large", members: [{ name: "Gloves Large", vendor: "PFG" }, { name: "Gloves Large", vendor: "Leonard Paper" }] },
  { product: "Gloves Extra Large", members: [{ name: "Gloves Extra Large", vendor: "PFG" }, { name: "Gloves Extra Large", vendor: "Leonard Paper" }] },
  { product: "C- Fold napkins", members: [{ name: "C- Fold napkins", vendor: "PFG" }, { name: "C- Fold napkins", vendor: "Leonard Paper" }] },
  { product: "Reciept Paper (thermal)", members: [{ name: "Reciept Paper (thermal)", vendor: "PFG" }, { name: "Reciept Paper (thermal)", vendor: "Leonard Paper" }] },
  { product: "Oven Cleaner", members: [{ name: "Oven Cleaner", vendor: "US Foods" }, { name: "Oven Cleaner", vendor: "Leonard Paper" }] },
  { product: "Butcher Paper", members: [{ name: "Butcher Paper", vendor: "Trimark" }, { name: "Butcher Paper", vendor: "Leonard Paper" }] },
  { product: "Trash Liners 40x46", members: [{ name: "Trash Liners 40x46", vendor: "Trimark" }, { name: "Trash Liners 40x46", vendor: "Leonard Paper" }] },
  { product: "Plastic Wrap", members: [{ name: "Plastic Wraop", vendor: "Trimark" }, { name: "Plastic Wrap", vendor: "Leonard Paper" }] },
  { product: "Toilet Paper", members: [{ name: "Toilet Paper", vendor: "Amazon" }, { name: "Toilet Paper", vendor: "Leonard Paper" }] },
  { product: "Stainless Steel Scrubbies", members: [{ name: "Stainless Steel Scrubbies", vendor: "Webstaurant" }, { name: "Stainless Steel Scrubbies", vendor: "Leonard Paper" }] },
  { product: "Cannoli Shell", members: [{ name: "Cannoli Shell", vendor: "PFG" }, { name: "Cannoli Shell", vendor: "Baldor" }] },
];
export type Tables = Record<"vendor_items" | "vendors" | "products" | "product_primaries", RawRow[]>;
export interface Plan { name: string; status: "ready" | "already" | "refused" | "absent"; before: unknown; after: unknown; source: string; reason?: string; expected: RawRow }
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const active = (rows: RawRow[]) => rows.filter(r => r.active === true);
export function pairSource(spec: PairSpec): string { return `[${SOURCE}] ${JUAN} Pair: ${spec.members.map(m => `${m.name} (${m.vendor})`).join(" + ")}; no designated primary — receiving decides.`; }

/** Pure planner: the pinned pairs against the live catalog. */
export function planPackagingProducts(t: Tables): Plan[] {
  const vendorByName = new Map(active(t.vendors).map(v => [String(v.name), v]));
  return PAIRS.map((spec): Plan => {
    const p: Plan = { name: spec.product, status: "ready", before: null, after: { product: spec.product, members: spec.members.map(m => `${m.name} (${m.vendor})`), primary: null }, source: pairSource(spec), expected: {} };
    try {
      const members = spec.members.map(m => {
        const vendor = vendorByName.get(m.vendor);
        const rows = vendor ? active(t.vendor_items).filter(r => r.name === m.name && r.vendor_id === vendor.id) : [];
        return { spec: m, vendor: vendor ?? null, rows };
      });
      if (members.some(m => !m.vendor || m.rows.length === 0)) { p.status = "absent"; p.reason = `member missing on this target: ${members.filter(m => !m.vendor || !m.rows.length).map(m => `${m.spec.name} (${m.spec.vendor})`).join(", ")}`; return p; }
      const skus = members.map(m => { if (m.rows.length !== 1) throw new Error(`${m.spec.name} (${m.spec.vendor}): expected one active row, found ${m.rows.length}`); return m.rows[0]!; });
      const products = active(t.products).filter(r => String(r.name).toLowerCase() === spec.product.toLowerCase());
      const product = products[0] ?? null;
      p.expected = { skus, product };
      p.before = { product_ids: skus.map(s => s.product_id ?? null), existing_product: product?.id ?? null };
      if (products.length > 1) throw new Error("More than one active product with this name");
      if (product && skus.every(s => s.product_id === product.id) && !t.product_primaries.some(r => r.product_id === product.id)) { p.status = "already"; return p; }
      if (product && skus.every(s => s.product_id === product.id) && t.product_primaries.some(r => r.product_id === product.id)) { p.status = "already"; p.reason = "a manager has since designated a primary; left as they set it"; return p; }
      if (product && String(product.notes ?? "").includes(SOURCE)) throw new Error("This seed's product exists but not every member points at it; reconcile the interrupted pair");
      if (product) throw new Error("An active product with this name already exists that this seed did not create");
      if (skus.some(s => s.product_id != null)) throw new Error("A member already belongs to another product");
    } catch (e) { p.status = "refused"; p.reason = e instanceof Error ? e.message : "Invalid before-state"; }
    return p;
  });
}

export function validateArgs(args: string[], env: Record<string, string | undefined> = process.env) {
  if (args.filter(a => a === "--dry-run").length > 1 || (args.includes("--dry-run") && args.includes("--execute"))) throw new Error("Conflicting/duplicate dry-run option");
  if (args.some(a => ["--wave7", "--readiness", "--as-of"].includes(a))) throw new Error("Unsupported seed-36 option");
  return validateTarget(args.filter(a => a !== "--dry-run"), env);
}
async function readTables(sb: SupabaseClient): Promise<Tables> {
  const names: (keyof Tables)[] = ["vendor_items", "vendors", "products", "product_primaries"];
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
async function record(sb: SupabaseClient, action: AuditAction, table: string, id: string, p: Plan, extra: RawRow = {}): Promise<void> {
  const { audit } = await import("@/lib/audit");
  const operation = randomUUID();
  await audit({ actorId: null, actorRole: null, action, resourceTable: table, resourceId: id, metadata: { source: SOURCE, operation, source_note: p.source, before: p.before, after: p.after, ...extra }, ipAddress: null, userAgent: null });
  const { data, error } = await sb.from("audit_log").select("id").eq("action", action).eq("resource_id", id).contains("metadata", { source: SOURCE, operation });
  if (error || data?.length !== 1) throw new Error(`${table}: audit readback failed; stop and reconcile (audit helper is fail-open)`);
}
async function apply(sb: SupabaseClient, p: Plan): Promise<void> {
  const spec = PAIRS.find(s => s.product === p.name)!, skus = p.expected.skus as RawRow[];
  const now = new Date().toISOString();
  const id = randomUUID();
  const { error } = await sb.from("products").insert({ id, name: spec.product, name_es: null, notes: pairSource(spec), active: true, created_by: null, updated_by: null });
  if (error) throw new Error(`products: INSERT failed (${error.code ?? "unknown"} ${error.message}); stop and reconcile`);
  await record(sb, "product.create", "products", id, p, { name: spec.product, creation_method: "seed_script" });
  for (const sku of skus) {
    await update(sb, "vendor_items", sku, { product_id: id, updated_at: now, updated_by: null });
    await record(sb, "product.member_attach", "vendor_items", String(sku.id), p, { product_id: id, sku_id: sku.id, sku_name: sku.name, vendor_id: sku.vendor_id });
  }
}
async function verifyAudits(sb: SupabaseClient, p: Plan): Promise<void> {
  const product = p.expected.product as RawRow | null, skus = p.expected.skus as RawRow[];
  if (!product) throw new Error(`${p.name}: no product to verify`);
  const checks: [AuditAction, unknown][] = [["product.create", product.id], ...skus.map(s => ["product.member_attach", s.id] as [AuditAction, unknown])];
  for (const [action, resourceId] of checks) {
    const { data, error } = await sb.from("audit_log").select("id").eq("action", action).eq("resource_id", resourceId).contains("metadata", { source: SOURCE, source_note: p.source }).limit(1);
    if (error || !data?.length) throw new Error(`${p.name}: missing matching ${action} provenance audit; reconcile before retry`);
  }
}
export function verifyWriteScope(before: Tables, after: Tables, p: Plan): void {
  const skuIds = new Set((p.expected.skus as RawRow[]).map(s => s.id));
  for (const table of Object.keys(before) as (keyof Tables)[]) {
    const allowed = (r: RawRow): string[] => table === "vendor_items" && skuIds.has(r.id) ? ["product_id", "updated_at", "updated_by"] : [];
    const addedAllowed = (r: RawRow) => table === "products" && String(r.name).toLowerCase() === p.name.toLowerCase();
    const oldIds = new Set(before[table].map(r => r.id));
    const normalize = (rows: RawRow[]) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([key]) => !allowed(r).includes(key)))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const existingAfter = after[table].filter(r => oldIds.has(r.id) || !addedAllowed(r));
    if (!equal(normalize(before[table]), normalize(existingAfter))) throw new Error(`${p.name}: unrelated/concurrent ${table} change; stop for a fresh reviewed dry-run`);
  }
}
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const config = validateArgs(args), sb = createWave7Client(config);
  let expectedTables = await readTables(sb);
  const plans = planPackagingProducts(expectedTables);
  const digest = createHash("sha256").update(canonical({ project: config.projectRef, source: SOURCE, plans })).digest("hex");
  console.log(`${SOURCE}: ${config.execute ? "EXECUTE" : "DRY RUN"}, target ${config.target}`);
  console.table(plans.map(p => ({ row: p.name, before: JSON.stringify(p.before), status: p.status, refusal: p.reason ?? "" })));
  console.log(`Plan digest: ${digest}`);
  if (!config.execute) { console.log("No writes. Execute with the same --target and --execute --plan-digest shown above."); return; }
  if (plans.every(p => p.status === "already" || p.status === "absent")) { for (const p of plans) { if (p.status === "absent") { console.log(`absent (skipped): ${p.name}`); continue; } if (!p.reason) await verifyAudits(sb, p); console.log(`already: ${p.name}`); } return; }
  if (config.planDigest !== digest) throw new Error("Plan changed; review a fresh dry-run");
  if (plans.some(p => p.status === "refused")) throw new Error("Refused before-state(s); no writes. Resolve ledger before execute.");
  for (const p of plans) {
    const tables = await readTables(sb);
    if (!equal(tables, expectedTables)) throw new Error("Database changed after reviewed snapshot; no further writes");
    const current = planPackagingProducts(tables).find(r => r.name === p.name)!;
    if (current.status === "absent") { console.log(`absent (skipped): ${p.name}`); continue; }
    if (current.status === "already") { if (p.status !== "already") await verifyAudits(sb, current); console.log(`already: ${p.name}`); continue; }
    if (current.status !== "ready") throw new Error(`${p.name}: before-state changed during execution`);
    await apply(sb, current);
    const afterTables = await readTables(sb);
    verifyWriteScope(tables, afterTables, current);
    const verified = planPackagingProducts(afterTables).find(r => r.name === p.name)!;
    if (verified.status !== "already") throw new Error(`${p.name}: destination verification failed (${verified.status}: ${verified.reason ?? ""}); reconcile partial operation`);
    await verifyAudits(sb, verified);
    expectedTables = afterTables;
    console.log(`verified: ${p.name}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e instanceof Error ? e.message : "Seed 36 failed"); process.exitCode = 1; });
}
