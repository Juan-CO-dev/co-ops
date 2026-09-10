/**
 * Seed 26: Angel mapping wave. Dry-run by default; never reads an env file itself.
 * CC supplies the isolated environment and runs:
 * npx tsx --conditions=react-server --env-file=.env.sim scripts/seed/26-angel-wave7.ts --target sim
 * ... --target sim --execute --plan-digest <reviewed digest>
 * npx tsx --conditions=react-server --env-file=.env.sim scripts/parity-angel.ts --target sim --wave7 --readiness
 * Prod additionally requires ANGEL_WAVE7_PROD_CONFIRM equal to the production ref.
 * All mutations use migration 0201's atomic RPC. No direct table writes.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SIM_PROJECT_REF } from "@/lib/sim-isolation-shared";
import { deriveFlatFieldsFromChain } from "@/lib/admin/catalog-shared";
import { SOURCE, canonical, readManifest, parseHistory, planWave7, refusal, REFUSAL_TEMPLATES, isoDate, num, type RawRow, type Snapshot, type Decision, type Intent, type RefusalCode } from "@/lib/angel-wave7";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import { loadWave7ReadinessTables, evaluateWave7Tables, printWave7Comparison, verifyWave7Scope } from "../parity-angel";

export type { RawRow };
export type Wave7Snapshot = Snapshot;
const PROD_PROJECT_REF = "bgcvurheqzylyfehqgzh";
const INPUT_FILES = ["docs/angel-wave7-manifest.json", "docs/angel-purchase-history.csv", "docs/angel-piece-structure.csv"] as const;
export const DRY_RUN_HEADINGS = ["MODE / TARGET / INPUTS", "READ THIS FIRST", "A — CONFIRMED MAPPINGS", "B — PRICE DECISIONS", "C — WEIGHT DECISIONS", "D — SUPPLY PACK CHAINS", "E — REFUSALS / NO-OPS / NONE", "EVERY WOULD-WRITE ROW, IN FULL", "PER-SHOP ERRANDS / MATRIX", "EXECUTION GATE"] as const;
export interface Target { target: "sim" | "prod"; projectRef: string; url: string; key: string; execute: boolean; asOf: string; planDigest?: string }
export function validateTarget(args: string[], env: Record<string, string | undefined> = process.env): Target {
  const values = new Map<string, string>();
  const flags = new Set(["--execute", "--wave7", "--readiness"]);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flags.has(flag)) { if (values.has(flag)) throw new Error("Duplicate CLI flag"); values.set(flag, "true"); continue; }
    if (!["--target", "--plan-digest", "--as-of"].includes(flag) || !args[i + 1] || args[i + 1]!.startsWith("--") || values.has(flag)) throw new Error("Unknown, duplicate or incomplete CLI option");
    values.set(flag, args[++i]!);
  }
  const target = values.get("--target");
  if (target !== "sim" && target !== "prod") throw new Error("An explicit --target sim|prod is required (including dry-run)");
  const projectRef = target === "sim" ? SIM_PROJECT_REF : PROD_PROJECT_REF;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (url !== `https://${projectRef}.supabase.co` && url !== `https://${projectRef}.supabase.co/`) throw new Error("Target refused: NEXT_PUBLIC_SUPABASE_URL does not match the named project");
  const execute = values.has("--execute"), planDigest = values.get("--plan-digest");
  if (execute && target === "prod" && env.ANGEL_WAVE7_PROD_CONFIRM !== PROD_PROJECT_REF) throw new Error("Production execution requires ANGEL_WAVE7_PROD_CONFIRM equal to the production project ref");
  if (execute && (!planDigest || !/^[a-f0-9]{64}$/.test(planDigest))) throw new Error("Execution requires --plan-digest from the reviewed dry-run");
  if (execute && (values.has("--wave7") || values.has("--readiness"))) throw new Error("Parity modes are read-only");
  const asOf = values.get("--as-of") ?? "2026-09-11";
  if (isoDate(asOf) !== asOf) throw new Error("Unsupported --as-of date");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  return { target, projectRef, url, key: env.SUPABASE_SERVICE_ROLE_KEY, execute, asOf, ...(planDigest ? { planDigest } : {}) };
}
export function createWave7Client(config: Target): SupabaseClient {
  return createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
/** Stable ordering + exact total + final count + duplicate detection. Never accept a 1,000-row cap. */
export async function loadAll(sb: SupabaseClient, table: string, select = "*", filter?: { column: string; value: string }): Promise<RawRow[]> {
  const rows: RawRow[] = [], ids = new Set<string>();
  let total: number | null = null;
  for (let offset = 0; ; offset += 500) {
    let query = sb.from(table).select(select, { count: "exact" }).order("id").range(offset, offset + 499);
    if (filter) query = query.eq(filter.column, filter.value);
    const { data, error, count } = await query;
    if (error || count == null || !data) throw new Error(`Incomplete read: ${table}`);
    if (total != null && count !== total) throw new Error(`Concurrent change during pagination: ${table}`);
    total = count;
    for (const row of data as unknown as RawRow[]) {
      if (typeof row.id !== "string" || ids.has(row.id)) throw new Error(`Duplicate/missing id during pagination: ${table}`);
      ids.add(row.id); rows.push(row);
    }
    if (data.length < 500) break;
  }
  if (rows.length !== total) throw new Error(`Truncated pagination: ${table}`);
  let final = sb.from(table).select("id", { count: "exact", head: true });
  if (filter) final = final.eq(filter.column, filter.value);
  const check = await final;
  if (check.error || check.count !== total) throw new Error(`Changed pagination total: ${table}`);
  return rows;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function operationUuid(text: string): string {
  const h = hash(text);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function inputs() {
  const texts = INPUT_FILES.map(file => readFileSync(resolve(process.cwd(), file), "utf8"));
  const hashes = Object.fromEntries(INPUT_FILES.map((file, i) => [file, hash(texts[i]!)]));
  const manifest = readManifest(texts[0]!);
  if (manifest.rows.length !== 159) throw new Error("Reviewed manifest must contain 159 rows");
  return { hashes, manifest, history: parseHistory(texts[1]!) };
}
async function preflight(sb: SupabaseClient): Promise<void> {
  const { data, error } = await sb.rpc("angel_wave7_snapshot", { p_sku_id: null });
  if (error || data?.capability !== "angel-wave7-atomic-v1" || !Array.isArray(data.columns)) throw new Error("Schema mismatch or missing migration 0201 transaction capability");
  const required: Record<string, Record<string, string>> = {
    vendor_items: { id: "uuid", vendor_id: "uuid", name: "text", item_number: "text", sku_class: "text", active: "bool", pack_format: "text", units_per_pack: "int4", each_size: "numeric", each_measure: "text", avg_oz_per_each: "numeric", weight_class: "text", weight_source_note: "text", weight_established_at: "timestamptz", weight_established_by: "uuid" },
    vendors: { id: "uuid", name: "text", active: "bool" },
    sku_pack_levels: { id: "uuid", sku_id: "uuid", label: "text", contains_qty: "numeric", contains_level_id: "uuid", contains_measure_unit: "text", display_ordinal: "int4", effective_from: "timestamptz", active: "bool", created_by: "uuid" },
    vendor_price_history: { id: "uuid", vendor_item_id: "uuid", unit_price: "numeric", effective_date: "date", recorded_at: "timestamptz", recorded_by: "uuid", source: "text", source_note: "text" },
    audit_log: { id: "uuid", occurred_at: "timestamptz", actor_id: "uuid", actor_role: "text", action: "text", resource_table: "text", resource_id: "uuid", destructive: "bool", metadata: "jsonb" },
    measure_units: { label: "text", active: "bool", dimension: "text", to_base_factor: "numeric" },
  };
  for (const [table, columns] of Object.entries(required)) for (const [column, type] of Object.entries(columns)) {
    if (!data.columns.some((c: RawRow) => c.table_name === table && c.column_name === column && c.udt_name === type)) throw new Error(`Schema mismatch: ${table}.${column}`);
  }
}
export async function readSnapshot(sb: SupabaseClient, id: string): Promise<Snapshot | null> {
  const { data, error } = await sb.rpc("angel_wave7_snapshot", { p_sku_id: id });
  if (error || !data || !Array.isArray(data.chain)) throw new Error("Snapshot read failed");
  return data.sku ? data as Snapshot : null;
}
interface Operation { decision: Decision; skuId: string; operationId: string; priceId: string; expected: Snapshot; bundle: RawRow; applied: boolean; stored: RawRow | null }
function bundleFor(intent: Intent, operationId: string, hashes: Record<string, string>): RawRow {
  const ids = intent.chain?.map((_, i) => operationUuid(`${operationId}/chain/${i}`));
  const chain = intent.chain?.map((l, i) => ({ id: ids![i]!, label: l.label, contains_qty: l.containsQty, contains_level_id: l.containsIndex == null ? null : ids![l.containsIndex]!, contains_measure_unit: l.containsMeasureUnit, display_ordinal: i })) ?? null;
  return { ...intent, chain, evidence: { ...intent.evidence, input_hashes: hashes } };
}
function statusRefusal(code: RefusalCode, d: Decision) {
  return refusal(code, { row: `${d.row.angel.source_file}:${d.row.angel.source_line} ${d.row.angel.product}`, SKU: d.row.selected_sku?.name ?? d.row.angel.product, n: 0, value: String(d.snapshot?.sku.avg_oz_per_each ?? "missing"), field: "RPC bundle", "collision/cycle/multiple roots/dangling pointer/invalid quantity": "invalid chain", A: d.row.angel.vendor, B: d.row.selected_sku?.vendor ?? "unselected" });
}
/** Same review identity after a verified retry; unrelated consumer drift changes it. */
export function reviewDigest(tables: Record<string, RawRow[]>, applied: readonly { skuId: string; priceId: string; expected: Snapshot; bundle: RawRow }[], review: unknown): string {
  const reviewTables: Record<string, RawRow[]> = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map(r => ({ ...r }))]));
  for (const op of applied) {
    reviewTables.vendor_items = reviewTables.vendor_items!.map(r => r.id === op.skuId ? op.expected.sku : r);
    reviewTables.vendor_price_history = reviewTables.vendor_price_history!.filter(r => r.id !== op.priceId);
    if (op.bundle.chain) {
      const inserted = new Set((op.bundle.chain as RawRow[]).map(r => r.id));
      const original = new Map(op.expected.chain.map(r => [r.id, r]));
      reviewTables.sku_pack_levels = reviewTables.sku_pack_levels!.filter(r => !inserted.has(r.id)).map(r => original.get(r.id) ?? r);
    }
  }
  for (const rows of Object.values(reviewTables)) rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return hash(canonical({ review, consumers: reviewTables }));
}
async function context(config: Target) {
  const source = inputs(), sb = createWave7Client(config);
  await preflight(sb);
  const [measureRows, audits, tables] = await Promise.all([
    loadAll(sb, "measure_units"), loadAll(sb, "audit_log", "id,action,metadata,occurred_at", { column: "action", value: "sku.angel_import" }), loadWave7ReadinessTables(sb),
  ]);
  const measures = new Map<string, MeasureUnitFactor>();
  for (const r of measureRows.filter(r => r.active === true)) {
    if (!["weight", "volume", "count"].includes(String(r.dimension)) || !num(r.to_base_factor) || measures.has(String(r.label))) throw new Error("Invalid measure registry");
    measures.set(String(r.label), { dimension: r.dimension as MeasureUnitFactor["dimension"], toBaseFactor: num(r.to_base_factor)! });
  }
  const snapshots = new Map<string, Snapshot>(), current = new Map<string, Snapshot>();
  const auditById = new Map(audits.map(a => [String(a.id), a]));
  for (const r of source.manifest.rows) {
    const id = r.selected_sku?.id;
    if (!id || current.has(id)) continue;
    const snapshot = await readSnapshot(sb, id);
    if (snapshot) { snapshots.set(id, snapshot); current.set(id, snapshot); }
  }
  // Rebuild the original immutable plan on retries. End-state is independently
  // verified below; source hashes and re-derived payload must still match.
  const replaySkus = new Set<string>();
  for (const r of source.manifest.rows) if (r.selected_sku) {
    const opId = operationUuid(`${SOURCE}/${r.selected_sku.id}/${r.revision}`);
    const metadata = auditById.get(opId)?.metadata as RawRow | undefined;
    if (metadata?.expected) {
      snapshots.set(r.selected_sku.id, metadata.expected as Snapshot);
      replaySkus.add(r.selected_sku.id);
    }
  }
  // Existing audited operations still undergo exact payload/end-state validation.
  // The cent no-op applies to new proposals, never hides a changed replay payload.
  const decisions = planWave7(source.manifest, snapshots, source.history, measures, config.asOf, replaySkus);
  const operations: Operation[] = [];
  for (const decision of decisions) {
    if (!decision.intent || !decision.snapshot || !decision.row.selected_sku) continue;
    const skuId = decision.row.selected_sku.id;
    const operationId = operationUuid(`${SOURCE}/${skuId}/${decision.row.revision}`), priceId = operationUuid(`${operationId}/price`);
    const stored = (auditById.get(operationId)?.metadata as RawRow | undefined) ?? null;
    // A correction elsewhere in the manifest does not rewrite this operation's
    // historical provenance. Its own manifest row and observations are re-derived.
    const storedHashes = ((stored?.bundle as RawRow | undefined)?.evidence as RawRow | undefined)?.input_hashes as Record<string, string> | undefined;
    const bundle = bundleFor(decision.intent, operationId, storedHashes ?? source.hashes);
    const op = { decision, skuId, operationId, priceId, expected: decision.snapshot, bundle, applied: !!stored, stored };
    if (stored && (canonical(stored.bundle) !== canonical(bundle) || canonical(stored.expected) !== canonical(op.expected) || stored.price_id !== priceId)) {
      decision.refusals.push(statusRefusal("SOURCE_PAYLOAD_DRIFT", decision)); decision.intent = null;
    } else if (stored && canonical(stored.result) !== canonical(current.get(skuId) ?? null)) {
      decision.refusals.push(statusRefusal("PACK_SHAPE_CHANGED", decision)); decision.intent = null;
    } else {
      if (stored) decision.refusals.push(statusRefusal("ALREADY_CORRECT", decision));
      operations.push(op);
    }
  }
  // Bind review to recipe/product/ordering consumers too. Reverse only this
  // revision's proven writes so the same digest remains valid on a zero-write retry.
  const digest = reviewDigest(tables, operations.filter(o => o.applied), { project: config.projectRef, asOf: config.asOf, hashes: source.hashes, measures: [...measures], decisions: decisions.map(d => ({ row: d.row, snapshot: d.snapshot, intent: d.intent })) });
  return { source, sb, measures, audits, tables, current, decisions, operations, digest };
}
function projected(op: Operation): Snapshot {
  const intent = op.decision.intent!, sku = { ...op.expected.sku };
  if (intent.chain) {
    const f = deriveFlatFieldsFromChain(intent.chain);
    Object.assign(sku, { pack_format: sku.pack_format ?? f.packFormat, units_per_pack: f.unitsPerPack, each_size: f.eachSize, each_measure: f.eachMeasure });
  }
  if (intent.weight) Object.assign(sku, intent.weight, { weight_class: "INVOICE_DERIVED", weight_established_by: null });
  return { sku, vendor: op.expected.vendor, chain: op.bundle.chain == null ? op.expected.chain : (op.bundle.chain as RawRow[]).map(l => ({ ...l, sku_id: op.skuId, active: true })), price: { ...intent.price, id: op.priceId, vendor_item_id: op.skuId, source: SOURCE, recorded_by: null, recorded_at: `${intent.price.effective_date}T23:59:59Z` } };
}
function printReport(config: Target, ctx: Awaited<ReturnType<typeof context>>) {
  const { decisions, operations, digest, source } = ctx;
  const heading = (i: number) => console.log(`\n${DRY_RUN_HEADINGS[i]}`);
  heading(0); console.log(`${config.execute ? "EXECUTION REQUEST — review output before gate" : "DRY RUN"} | ${config.target} | project ${config.projectRef} | ${SOURCE} | as-of ${config.asOf}`);
  console.log(`Manifest ${source.manifest.rows.length} rows; purchase history ${source.history.length} lines; plan digest ${digest}`);
  console.log(JSON.stringify(source.hashes, null, 2));
  const held = decisions.filter(d => !d.intent && !d.rejected && !d.refusals.some(r => r.code === "ALREADY_CORRECT")).length;
  heading(1); console.log(`${operations.filter(o => !o.applied && !o.expected.price).length} newly priced; ${operations.filter(o => !o.applied && o.bundle.chain).length} changed pack denominators; ${operations.filter(o => !o.applied && o.bundle.weight).length} changed portion weights; ${held} held/excluded mapping rows.`);
  console.log(`${decisions.filter(d => d.rejected).length} rejected competitors (not refusals); ${decisions.filter(d => d.refusals.some(r => r.code === "ALREADY_CORRECT")).length} ALREADY_CORRECT.`);
  console.log("Invoice dates stay historical. Pack changes do not certify slice or sprig weights. Errand counts overlap.");
  heading(2);
  for (const d of decisions.filter(d => d.row.decision === "selected")) {
    console.log(`${d.row.angel.product} [${d.row.angel.brand}] (#${d.row.row_n}) → ${d.row.selected_sku?.name ?? "unresolved"} (${d.row.selected_sku?.vendor ?? "no vendor"}); ${d.row.evidence}; ${d.selection ?? "single selected row"}; ${d.intent?.evidence.arithmetic ?? (d.rejected ? "competitor excluded" : d.refusals.some(r => r.code === "ALREADY_CORRECT") ? "ALREADY_CORRECT" : "relationship refused — see ledger")}`);
    for (const warning of d.warnings ?? []) console.log(warning);
  }
  heading(3);
  for (const d of decisions.filter(d => d.intent)) console.log(`${d.row.selected_sku!.name}: current ${d.snapshot?.price ? `$${d.snapshot.price.unit_price} / ${d.snapshot.price.effective_date} / ${d.snapshot.price.source ?? "app"}` : "unpriced"}; proposed $${d.intent!.price.unit_price} / ${d.intent!.price.effective_date}; ${d.intent!.evidence.arithmetic}; pack oz ${d.intent!.evidence.beforeOz ?? "unresolved"} → ${d.intent!.evidence.afterOz ?? "unresolved"}`);
  heading(4);
  for (const d of decisions.filter(d => d.intent)) console.log(`${d.row.selected_sku!.name}: ${d.intent!.evidence.grain}; old ${d.snapshot!.sku.avg_oz_per_each ?? "missing"} oz (${d.snapshot!.sku.weight_class ?? "unclassified"}); new ${d.intent!.weight ? `${d.intent!.weight.avg_oz_per_each} oz INVOICE_DERIVED` : "kept live"}; samples ${JSON.stringify(d.intent!.evidence.average)}; named recipe effects in PER-SHOP ERRANDS / MATRIX`);
  heading(5);
  for (const op of operations.filter(o => o.bundle.chain)) console.log(`${op.decision.row.selected_sku!.name}: ${JSON.stringify(op.expected.chain.map(l => ({ label: l.label, quantity: l.contains_qty, leaf: l.contains_measure_unit })))} → ${JSON.stringify(op.decision.intent!.chain)}; mirrors ${JSON.stringify(deriveFlatFieldsFromChain(op.decision.intent!.chain!))}; count resolution below`);
  heading(6);
  for (const d of decisions) for (const r of d.refusals) { console.log(r.message); console.log(`  ${r.code} | ${d.row.selected_sku?.name ?? d.row.angel.product} | ${r.operation} | missing fact: ${r.missingFact}`); }
  heading(7);
  for (const op of operations.filter(o => !o.applied)) console.log(JSON.stringify({ sku: op.decision.row.selected_sku!.name, p_sku_id: op.skuId, p_operation_id: op.operationId, p_price_id: op.priceId, p_expected: op.expected, p_bundle: op.bundle }, null, 2));
  heading(8);
  const before = evaluateWave7Tables(ctx.tables, undefined, config.asOf);
  const after = evaluateWave7Tables(ctx.tables, new Map(operations.map(o => [o.skuId, projected(o)])), config.asOf);
  printWave7Comparison(before, after, "Projected (only verified applied changes retire errands)");
  heading(9);
  console.log(`NOTHING WAS WRITTEN. Plan digest: ${digest}`);
  console.log(`${held} unresolved/excluded rows remain; execute writes only the displayed eligible bundles.`);
  console.log(`npx tsx --conditions=react-server --env-file=${config.target === "sim" ? ".env.sim" : ".env.local"} scripts/seed/26-angel-wave7.ts --target ${config.target} --as-of ${config.asOf} --execute --plan-digest ${digest}`);
}
export async function runWave7Verification(args: string[]): Promise<void> {
  const config = validateTarget(args);
  if (config.execute) throw new Error("Parity is read-only");
  const ctx = await context(config);
  if (!ctx.operations.length || ctx.operations.some(o => !o.applied) || ctx.decisions.some(d => d.refusals.some(r => r.code === "SOURCE_PAYLOAD_DRIFT" || r.code === "PACK_SHAPE_CHANGED"))) throw new Error("Wave-7 parity failed: missing operation or changed provenance/end-state");
  for (const op of ctx.operations) {
    const current = ctx.current.get(op.skuId)!;
    if (current.price?.id !== op.priceId || current.price.source !== SOURCE || current.price.effective_date !== op.decision.intent!.price.effective_date || num(current.price.unit_price) !== op.decision.intent!.price.unit_price) throw new Error("Wave-7 current-price consumer mismatch");
    console.log(`VERIFIED ${op.decision.row.selected_sku!.name}: exact price, chain, weight, provenance and audit; rerun is ALREADY_CORRECT.`);
  }
  console.log(`Wave-7 live parity passed: ${ctx.operations.length} complete operations. SQL rollback/concurrency failure injection is a separate sim gate.`);
}
async function main() {
  const config = validateTarget(process.argv.slice(2)), ctx = await context(config);
  printReport(config, ctx);
  if (!config.execute) return;
  if (config.planDigest !== ctx.digest) throw new Error("Reviewed plan digest differs: rerun dry-run");
  if (ctx.decisions.some(d => d.refusals.some(r => r.code === "SOURCE_PAYLOAD_DRIFT" || r.code === "PACK_SHAPE_CHANGED"))) throw new Error("Changed operation/state: resolve refusal ledger before executing");
  let writes = 0;
  const appliedSnapshots = new Map<string, Snapshot>(), newlyApplied = new Set<string>();
  try {
    for (const op of ctx.operations) {
      if (canonical(inputs().hashes) !== canonical(ctx.source.hashes)) throw new Error("Source hashes changed during run");
      // Replays still reach the server guard; this exercises atomic idempotency.
      const { data, error } = await ctx.sb.rpc("angel_wave7_apply_bundle", { p_sku_id: op.skuId, p_operation_id: op.operationId, p_price_id: op.priceId, p_expected: op.expected, p_bundle: op.bundle });
      const code = String(data?.status ?? error?.message?.split(":")[0] ?? "");
      if (error || !["APPLIED", "ALREADY_CORRECT"].includes(code)) {
        if (code in REFUSAL_TEMPLATES) console.log(statusRefusal(code as RefusalCode, op.decision).message);
        throw new Error(`Atomic bundle failed for ${op.decision.row.selected_sku!.name}: ${code in REFUSAL_TEMPLATES ? code : "RPC error"}`);
      }
      if (code === "APPLIED") writes++;
      else console.log(statusRefusal("ALREADY_CORRECT", op.decision).message);
      const after = await readSnapshot(ctx.sb, op.skuId);
      if (!after || canonical(after) !== canonical(data.snapshot)) throw new Error("Fatal post-write readback mismatch");
      appliedSnapshots.set(op.skuId, after);
      if (code === "APPLIED") newlyApplied.add(op.operationId);
      console.log(`${code}: ${op.decision.row.selected_sku!.name}`);
    }
  } finally {
    console.log(`\n${DRY_RUN_HEADINGS[6]} — execution ledger; ${writes} bundles applied`);
    for (const d of ctx.decisions) for (const r of d.refusals) console.log(r.message);
    const afterTables = await loadWave7ReadinessTables(ctx.sb);
    const afterAudits = await loadAll(ctx.sb, "audit_log", "id,action,metadata,occurred_at", { column: "action", value: "sku.angel_import" });
    verifyWave7Scope({ ...ctx.tables, audit_log: ctx.audits }, { ...afterTables, audit_log: afterAudits }, appliedSnapshots, newlyApplied);
    for (const op of ctx.operations.filter(o => appliedSnapshots.has(o.skuId))) {
      const metadata = afterAudits.find(a => a.id === op.operationId)?.metadata as RawRow | undefined;
      if (!metadata || metadata.price_id !== op.priceId || canonical(metadata.expected) !== canonical(op.expected) || canonical(metadata.bundle) !== canonical(op.bundle) || canonical(metadata.result) !== canonical(appliedSnapshots.get(op.skuId))) throw new Error("Fatal post-write audit verification failed");
    }
    console.log(`\n${DRY_RUN_HEADINGS[8]} — verified destination readback`);
    printWave7Comparison(evaluateWave7Tables(ctx.tables, undefined, config.asOf), evaluateWave7Tables(afterTables, undefined, config.asOf), "Actual committed changes");
  }
  console.log(`Verified ${writes} bundle writes; ${ctx.operations.length - writes} ALREADY_CORRECT. No other table writer was used.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Wave-7 failed"); process.exitCode = 1; });
}
