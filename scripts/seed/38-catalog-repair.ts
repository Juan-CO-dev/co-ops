/**
 * Seed 38. No env loading or network activity on import.
 * node --env-file=<env> --import tsx scripts/seed/38-catalog-repair.ts
 *   [--execute --target sim|prod] [--i-have-juans-word]
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SIM_PROJECT_REF } from "../../lib/sim-isolation-shared";
import { isDestructive } from "../../lib/destructive-actions";
import type { AuditAction } from "../../lib/audit-actions";
import { buildWritePlan, TABLES, type Evidence, type Snapshot, type Row, type Operation, type Plan, type Mutation } from "./38-manifest";

export const SOURCE_DIR = "docs/seed/source/vendor-exports";
export const HOSTS = { sim: `${SIM_PROJECT_REF}.supabase.co`, prod: "bgcvurheqzylyfehqgzh.supabase.co" } as const;
export const INPUT_DIGEST = "5d9f255a21bbe0cb1b5646212af1a082b63c939a8c966443df9ef013f15d5d14";
export const ACTION_ORDER: AuditAction[] = ["vendor.create", "vendor.deactivate", "vendor.merge", "sku.vendor_repoint", "vendor_item.create", "sku.item_number_set", "sku.price_basis_set", "sku.pack_level_supersede", "sku.price_supersede"];
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export function validateArgs(args: string[], env: Record<string, string | undefined> = process.env) {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (flags.has(a)) throw new Error("Duplicate option");
    if (["--execute", "--dry-run", "--i-have-juans-word"].includes(a)) flags.set(a, "true");
    else if (a === "--target" && ["sim", "prod"].includes(args[i + 1] ?? "")) flags.set(a, args[++i]!);
    else throw new Error("Unknown/incomplete option");
  }
  const execute = flags.has("--execute");
  if (execute && flags.has("--dry-run")) throw new Error("Conflicting execution options");
  if (execute && !flags.has("--target")) throw new Error("--execute requires --target");
  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL required");
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("Invalid target URL"); }
  const target = flags.get("--target") ?? Object.entries(HOSTS).find(([, host]) => host === url.hostname)?.[0];
  if (target !== "sim" && target !== "prod") throw new Error("Unknown target host");
  if (rawUrl !== `https://${HOSTS[target]}` && rawUrl !== `https://${HOSTS[target]}/`) throw new Error("Target URL mismatch");
  if (execute && target === "prod" && !flags.has("--i-have-juans-word")) throw new Error("Production execution requires --i-have-juans-word");
  return { target, execute, url: rawUrl };
}

/** Reads only committed, non-secret evidence. Caller decides when to invoke it. */
export function loadInputs(root = process.cwd()) {
  const dir = resolve(root, SOURCE_DIR);
  const csv = readFileSync(resolve(dir, "review/seed38-review.csv"), "utf8");
  const rulings = readFileSync(resolve(dir, "review/seed38-rulings.md"), "utf8");
  const catalogText = readFileSync(resolve(dir, "context/catalog-prod-2026-09-19.json"), "utf8");
  const baseline = JSON.parse(catalogText.replace(/^\uFEFF/, "")) as Snapshot;
  const files = readdirSync(resolve(dir, "normalized")).filter(f => f.endsWith(".json")).sort();
  const evidence: Evidence[] = [];
  const hash = createHash("sha256").update(csv).update(rulings).update(catalogText);
  for (const file of files) {
    const text = readFileSync(resolve(dir, "normalized", file), "utf8");
    hash.update(file).update(text);
    const starts = [...text.matchAll(/\n  \{/g)].map(m => text.slice(0, m.index + 1).split("\n").length);
    const rows = JSON.parse(text) as Evidence[];
    if (rows.length !== starts.length) throw new Error(`Cannot locate evidence lines: ${file}`);
    evidence.push(...rows.map((row, i) => ({ ...row, citation: `${SOURCE_DIR}/normalized/${file}:${starts[i]}` })));
  }
  return { csv, rulings, baseline, evidence, digest: hash.digest("hex") };
}

/** Stable pagination, including an exact final count; never accept a REST row cap. */
async function loadAll(sb: SupabaseClient, table: string, auditsOnly = false): Promise<Row[]> {
  const rows: Row[] = [], ids = new Set<string>();
  let expected: number | null = null;
  for (let offset = 0; ; offset += 500) {
    let q = sb.from(table).select("*", { count: "exact" }).order("id").range(offset, offset + 499);
    if (auditsOnly) q = q.contains("metadata", { actor_context: "seed_38" });
    const { data, error, count } = await q;
    if (error || !data || count == null || expected != null && expected !== count) throw new Error(`Incomplete/concurrent read: ${table}`);
    expected = count;
    for (const row of data as Row[]) { const id = String(row.id); if (!row.id || ids.has(id)) throw new Error(`Duplicate/missing id: ${table}`); ids.add(id); rows.push(row); }
    if (data.length < 500) break;
  }
  let last = sb.from(table).select("id", { count: "exact", head: true });
  if (auditsOnly) last = last.contains("metadata", { actor_context: "seed_38" });
  const check = await last;
  if (check.error || rows.length !== expected || check.count !== expected) throw new Error(`Truncated/concurrent read: ${table}`);
  return rows;
}
async function readSnapshot(sb: SupabaseClient): Promise<Snapshot> {
  return Object.fromEntries(await Promise.all(TABLES.map(async table => [table, await loadAll(sb, table)]))) as Snapshot;
}
interface Column { table_name: string; column_name: string; data_type: string; udt_name: string }
export function validateSchema(columns: Column[], plan: Plan): boolean {
  const has = (table: string, column: string) => columns.find(c => c.table_name === table && c.column_name === column);
  if (has("vendor_items", "price_basis")?.data_type !== "text") throw new Error("Apply migration 0210 before running seed 38");
  for (const op of plan.operations) for (const m of op.mutations) {
    // Guide amendment is through the already-deployed ownership-checked RPC.
    if (m.table === "order_guide_lines") continue;
    for (const key of Object.keys(m.after)) {
      const column = has(m.table, key);
      if (!column) throw new Error(`Schema column missing: ${m.table}.${key}`);
      // No enum insertion is authorized: refuse schema drift rather than infer pg_enum.
      if (column.data_type === "USER-DEFINED") throw new Error(`Unexpected enum/domain: ${m.table}.${key}; requires live pg_enum review`);
    }
  }
  for (const key of ["actor_id", "actor_role", "action", "resource_table", "resource_id", "metadata", "destructive"]) if (!has("audit_log", key)) throw new Error(`Audit column missing: ${key}`);
  return !!has("vendors", "notes");
}
export function verifyScope(before: Snapshot, after: Snapshot, operations: Operation[]): void {
  const mutations = operations.flatMap(o => o.mutations);
  const amendedGuides = new Set(mutations.filter(m => m.table === "order_guide_lines").map(m => {
    const section = before.order_guide_sections.find(s => s.id === m.before?.section_id);
    return section?.guide_id;
  }));
  for (const table of TABLES) {
    const additions = new Set(mutations.filter(m => m.table === table && !m.before).map(m => m.after.id));
    const ignore = (row: Row): string[] => {
      const changed = mutations.filter(m => m.table === table && m.before?.id === row.id);
      if (table === "vendor_order_guides" && amendedGuides.has(row.id)) return ["updated_at"];
      return changed.flatMap(m => Object.keys(m.after).filter(key => key !== "id"));
    };
    const normalized = (rows: Row[]) => rows.filter(r => !additions.has(r.id)).map(r => Object.fromEntries(Object.entries(r).filter(([key]) => !ignore(r).includes(key)))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (!equal(normalized(before[table]), normalized(after[table]))) throw new Error(`Unexpected/concurrent change to ${table}; reconcile before continuing`);
  }
}
function subset(actual: Row, expected: Row): boolean { return Object.entries(expected).every(([key, value]) => equal(actual[key] ?? null, value)); }
async function readBack(sb: SupabaseClient, table: string, expected: Row): Promise<Row> {
  const { data, error } = await sb.from(table).select("*").eq("id", String(expected.id)).single();
  if (error || !data || !subset(data as Row, expected)) throw new Error(`${table} read-back failed; stop and reconcile`);
  return data as Row;
}
async function applyMutation(sb: SupabaseClient, mutation: Mutation, snapshot: Snapshot): Promise<void> {
  const { table, before, after } = mutation;
  if (table === "order_guide_lines") {
    const section = snapshot.order_guide_sections.find(s => s.id === before?.section_id)!;
    const guide = snapshot.vendor_order_guides.find(g => g.id === section.guide_id)!;
    const sections = snapshot.order_guide_sections.filter(s => s.guide_id === guide.id).sort((a, b) => Number(a.position) - Number(b.position)).map(s => ({
      id: s.id, name: s.name, position: s.position,
      lines: snapshot.order_guide_lines.filter(l => l.section_id === s.id).sort((a, b) => Number(a.position) - Number(b.position)).map(l => {
        const row = l.id === before?.id ? { ...l, ...after } : l;
        return { id: row.id, position: row.position, skuId: row.sku_id, label: row.label, itemNumber: row.item_number, note: row.note };
      }),
    }));
    const { error } = await sb.rpc("save_order_guide", { p_guide_id: guide.id, p_expected_updated_at: guide.updated_at, p_name: guide.name, p_sections: sections });
    if (error) throw new Error("IN-068 guarded guide RPC failed; no guide amendment committed");
    await readBack(sb, table, after);
    const reread = await readBack(sb, "vendor_order_guides", { id: guide.id, name: guide.name, vendor_id: guide.vendor_id });
    if (reread.updated_at === guide.updated_at) throw new Error("IN-068 guide token did not advance");
    return;
  }
  if (before) {
    const values = { ...after }; delete values.id;
    let q = sb.from(table).update(values, { count: "exact" }).eq("id", String(before.id));
    for (const [key, value] of Object.entries(before)) {
      if (key === "id" || value !== null && typeof value === "object") continue;
      q = value == null ? q.is(key, null) : q.eq(key, value);
    }
    const { error, count } = await q;
    if (error || count !== 1) throw new Error(`${table}: guarded update failed or rowcount != 1; stop and reconcile`);
  } else {
    const { error } = await sb.from(table).insert(after);
    if (error) throw new Error(`${table}: insert failed; stop and reconcile`);
  }
  await readBack(sb, table, after);
}

/** No class can silently resume after some of its writes committed without its audit. */
export function validateProvenance(plan: Plan, initial: Plan, audits: Row[], digest: string): void {
  for (const action of ACTION_ORDER) {
    const entries = plan.operations.filter(o => o.action === action), previous = audits.filter(a => a.action === action);
    if (previous.length > 1) throw new Error(`${action}: duplicate seed_38 audit`);
    const ready = entries.some(o => o.status === "ready");
    if (previous.length) {
      const metadata = previous[0]!.metadata as Row;
      if (metadata.input_digest !== digest || previous[0]!.destructive !== isDestructive(action) || ready) throw new Error(`${action}: audited state drift; reconcile`);
    } else if (entries.some(o => o.status === "already" && initial.operations.find(i => i.action === action && i.key === o.key)?.status === "ready")) {
      throw new Error(`${action}: missing provenance for already-applied operation; interrupted seed, reconcile`);
    }
  }
}
async function recordClass(sb: SupabaseClient, action: AuditAction, ops: Operation[], digest: string, before: Snapshot, after: Snapshot): Promise<void> {
  // House helper owns the vocabulary/classification and credentialed client.
  const { audit } = await import("../../lib/audit");
  const mutations = ops.flatMap(o => o.mutations);
  const beforeRows = mutations.map(m => ({ table: m.table, row: m.before }));
  const afterRows = mutations.map(m => ({ table: m.table, row: after[m.table].find(r => r.id === m.after.id) }));
  const metadata = {
    actor_context: "seed_38", input_digest: digest,
    counts: { operations: ops.length, writes: mutations.length, inserts: mutations.filter(m => !m.before).length, updates: mutations.filter(m => m.before).length },
    before_ids: mutations.flatMap(m => m.before ? [m.before.id] : []), after_ids: mutations.map(m => m.after.id),
    before: beforeRows, after: afterRows, evidence_lines: [...new Set(ops.flatMap(o => o.evidence))], details: ops.map(o => ({ key: o.key, detail: o.detail })),
    ...(action === "vendor.merge" ? { loser_id: before.vendors.find(v => v.name === "Delmar Provisions")?.id, survivor_id: after.vendors.find(v => v.name === "Boar's Head")?.id } : {}),
  };
  await audit({ actorId: null, actorRole: null, action, resourceTable: mutations[0]?.table ?? "vendors", resourceId: null, metadata, ipAddress: null, userAgent: null });
  const { data, error } = await sb.from("audit_log").select("*").eq("action", action).contains("metadata", { actor_context: "seed_38", input_digest: digest });
  if (error || data?.length !== 1 || data[0]!.destructive !== isDestructive(action) || !subset(data[0]!.metadata as Row, metadata)) throw new Error(`${action}: audit read-back failed; helper is fail-open, reconcile before retry`);
}
export async function main(args = process.argv.slice(2)): Promise<void> {
  const config = validateArgs(args), input = loadInputs();
  if (input.digest !== INPUT_DIGEST) throw new Error("Reviewed input digest changed; refuse before connecting");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");
  const sb = createClient(config.url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const schema = await sb.rpc("angel_wave7_snapshot", { p_sku_id: null });
  if (schema.error || schema.data?.capability !== "angel-wave7-atomic-v1" || !Array.isArray(schema.data.columns)) throw new Error("Runtime information_schema preflight unavailable (0201 snapshot RPC)");
  const columns = schema.data.columns as Column[], notes = columns.some(c => c.table_name === "vendors" && c.column_name === "notes");
  let snapshot = await readSnapshot(sb);
  const plan = buildWritePlan(input.csv, input.baseline, snapshot, input.evidence, notes);
  const initial = buildWritePlan(input.csv, input.baseline, input.baseline, input.evidence, notes);
  validateSchema(columns, plan);
  validateProvenance(plan, initial, await loadAll(sb, "audit_log", true), input.digest);
  console.log(`seed_38 ${config.execute ? "EXECUTE" : "DRY RUN"}; target=${config.target}; input_digest=${input.digest}`);
  for (const op of plan.operations) console.log(JSON.stringify(op));
  for (const basis of plan.basis) console.log(JSON.stringify({ reconciliation: basis }));
  for (const report of [...plan.held, ...plan.reports]) console.log(report);
  console.table(ACTION_ORDER.map(action => ({ action, ready: plan.operations.filter(o => o.action === action && o.status === "ready").length, already: plan.operations.filter(o => o.action === action && o.status === "already").length })));
  if (!config.execute) { console.log("No writes. Review assumptions and every proposed mutation before --execute."); return; }
  for (const action of ACTION_ORDER) {
    const operations = plan.operations.filter(o => o.action === action && o.status === "ready");
    if (!operations.length) { console.log(`already: ${action}`); continue; }
    const current = await readSnapshot(sb);
    if (!equal(current, snapshot)) throw new Error("Database changed after dry-run snapshot; no further writes");
    for (const operation of operations) for (const mutation of operation.mutations) await applyMutation(sb, mutation, snapshot);
    const after = await readSnapshot(sb);
    verifyScope(snapshot, after, operations);
    for (const operation of operations) for (const m of operation.mutations) if (!subset(after[m.table].find(r => r.id === m.after.id) ?? {}, m.after)) throw new Error(`${action}: class verification failed`);
    await recordClass(sb, action, operations, input.digest, snapshot, after);
    snapshot = after;
    console.log(`verified: ${action} (${operations.length} operations)`);
  }
  const final = buildWritePlan(input.csv, input.baseline, snapshot, input.evidence, notes);
  if (final.operations.some(o => o.status === "ready")) throw new Error("Final idempotence check failed");
  validateProvenance(final, initial, await loadAll(sb, "audit_log", true), input.digest);
  console.log("Verified all classes, read-backs and provenance; rerun has zero writes.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The specified CLI works without extra flags. Only execute needs the house
  // audit helper's server-only graph; restart with Node's react-server condition.
  if (process.argv.includes("--execute") && !process.execArgv.includes("--conditions=react-server")) {
    try {
      validateArgs(process.argv.slice(2));
      const child = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", process.argv[1], ...process.argv.slice(2)], { stdio: "inherit", windowsHide: true, env: process.env });
      process.exitCode = child.status ?? 1;
    } catch (error) { console.error(error instanceof Error ? error.message : "Seed 38 refused"); process.exitCode = 1; }
  } else main().catch(error => { console.error(error instanceof Error ? error.message : "Seed 38 failed"); process.exitCode = 1; });
}
