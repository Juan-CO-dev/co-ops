/**
 * Seed 34: the parts of Juan's laminated order guides (photographed 2026-09-13,
 * transcribed in docs/seed/source/order-guide-2026-09-13.json) that the catalog lacked
 * and that the sheet states unambiguously in the SKU's own order unit:
 *   PARS   — the three Just Ice Teas (2 case / 3 case; a case is the 12-can pack the SKU
 *            already carries) and Gluten Free Bread (27 rolls / 27 rolls; the SKU is per roll).
 *   RHYTHM — Sarah (the GF bread baker): order Sunday by 4:00 for Tuesday and Thursday by
 *            4:00 for Saturday → two rhythm pairs per location (lead 2) and two global cutoffs.
 * Everything else on the sheets is either already in the app (PFG item numbers, the
 * PFG / Boar's Head / Trimark / Cardinal / Leonard rhythms), differs from the app in a way
 * only Juan can settle (see the diff CC reports), or is written in a unit the SKU's pack
 * cannot express yet (the Utz cases). Those are questions, not writes.
 * Dry-run default. CC runs sim, then prod; this module never loads an env file.
 * --target sim|prod [--dry-run | --execute --plan-digest <dry-run digest>]
 * Uses seed 26's target/project/production-confirmation guards unchanged.
 * Direct writes follow seeds 16/22/31/32/33; they are NOT a transaction. No schema
 * changes, no new audit actions (vendor_item.update / vendor.full_profile_edit /
 * vendor.cutoff_change, all registered and all written with the lib's own metadata shape).
 */
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonical, type RawRow } from "@/lib/angel-wave7";
import type { AuditAction } from "@/lib/audit-actions";
import { createWave7Client, loadAll, validateTarget } from "./26-angel-wave7";

export const SOURCE = "order-guide-2026-09-13";
export const GUIDE = "docs/seed/source/order-guide-2026-09-13.json";
export interface ParSpec { name: string; vendor: string; sheet: string; before: { weekday_par: number | null; weekend_par: number | null }; after: { weekday_par: number; weekend_par: number } }
export const PARS: readonly ParSpec[] = [
  { name: "Just Ice Tea Dragon Green", vendor: "Boar's Head", sheet: "Green Tea 2 case / 3 case", before: { weekday_par: null, weekend_par: null }, after: { weekday_par: 2, weekend_par: 3 } },
  { name: "Just Ice Tea Lemon", vendor: "Boar's Head", sheet: "Lemon tea 2 case / 3 case", before: { weekday_par: null, weekend_par: null }, after: { weekday_par: 2, weekend_par: 3 } },
  { name: "Just Ice Tea Raspberry", vendor: "Boar's Head", sheet: "Raspberry Tea 2 case / 3 case", before: { weekday_par: null, weekend_par: null }, after: { weekday_par: 2, weekend_par: 3 } },
  { name: "Gluten Free Bread", vendor: "Sarah", sheet: "GF Bread (18/cs) 27 Rolls / 27 Rolls", before: { weekday_par: 14, weekend_par: null }, after: { weekday_par: 27, weekend_par: 27 } },
];
export const RHYTHM = {
  vendor: "Sarah",
  sheet: "Gluten Free Bread: Order Sunday by 4:00 for Tuesday; Order Thursday by 4:00 for Saturday",
  pairs: [{ order_dow: 0, lead_days: 2 }, { order_dow: 4, lead_days: 2 }],
  cutoffs: [{ order_day: 0, cutoff_time: "16:00:00" }, { order_day: 4, cutoff_time: "16:00:00" }],
} as const;
export type Tables = Record<"vendor_items" | "vendors" | "locations" | "vendor_delivery_rhythm" | "vendor_cutoffs", RawRow[]>;
export interface Plan {
  section: "pars" | "rhythm";
  name: string;
  status: "ready" | "already" | "refused" | "absent";
  before: unknown;
  after: unknown;
  source: string;
  reason?: string;
  expected: RawRow;
}
const n = (v: unknown): number | null => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const active = (rows: RawRow[]) => rows.filter(r => r.active === true);
const one = (rows: RawRow[], what: string): RawRow => { if (rows.length !== 1) throw new Error(`${what}: expected one row, found ${rows.length}`); return rows[0]!; };
export function parSource(spec: ParSpec): string { return `Juan's order guide 2026-09-13 (${GUIDE}): "${spec.sheet}".`; }
export function rhythmSource(): string { return `Juan's order guide 2026-09-13 (${GUIDE}): "${RHYTHM.sheet}".`; }
function vendorByName(t: Tables, name: string): RawRow | null {
  const rows = active(t.vendors).filter(r => r.name === name);
  return rows.length === 1 ? rows[0]! : null;
}
/** Pure planner: facts are pinned above, never inferred from a drifted live row. */
export function planOrderGuide(t: Tables): Plan[] {
  const result: Plan[] = [];
  const add = (section: Plan["section"], name: string, source: string, after: unknown, work: (p: Plan) => void) => {
    const p: Plan = { section, name, source, before: null, after, status: "ready", expected: {} };
    try { work(p); } catch (e) { p.status = "refused"; p.reason = e instanceof Error ? e.message : "Invalid before-state"; }
    result.push(p);
  };
  for (const spec of PARS) add("pars", spec.name, parSource(spec), spec.after, p => {
    const vendor = vendorByName(t, spec.vendor);
    const rows = vendor ? active(t.vendor_items).filter(r => r.name === spec.name && r.vendor_id === vendor.id) : [];
    if (!vendor || rows.length === 0) { p.status = "absent"; p.reason = `${spec.name} (${spec.vendor}): not on this target`; return; }
    const sku = one(rows, spec.name);
    p.expected = { sku };
    p.before = { weekday_par: n(sku.weekday_par), weekend_par: n(sku.weekend_par) };
    if (equal(p.before, spec.after)) { p.status = "already"; return; }
    if (!equal(p.before, spec.before)) throw new Error("Par differs from the expected before-state; Juan or the walk moved it");
  });
  add("rhythm", RHYTHM.vendor, rhythmSource(), { pairs: RHYTHM.pairs, cutoffs: RHYTHM.cutoffs }, p => {
    const vendor = vendorByName(t, RHYTHM.vendor);
    if (!vendor) { p.status = "absent"; p.reason = `${RHYTHM.vendor}: vendor not on this target`; return; }
    const locations = active(t.locations).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (!locations.length) throw new Error("No active locations");
    const pairs = active(t.vendor_delivery_rhythm).filter(r => r.vendor_id === vendor.id);
    const cutoffs = active(t.vendor_cutoffs).filter(r => r.vendor_id === vendor.id);
    p.expected = { vendor, locations, pairs, cutoffs };
    p.before = { pairs: pairs.map(r => ({ location_id: r.location_id, order_dow: n(r.order_dow), lead_days: n(r.lead_days) })), cutoffs: cutoffs.map(r => ({ location_id: r.location_id, order_day: n(r.order_day), cutoff_time: r.cutoff_time })) };
    const wantPairs = locations.flatMap(l => RHYTHM.pairs.map(x => ({ location_id: l.id, ...x })));
    const wantCutoffs = RHYTHM.cutoffs.map(x => ({ location_id: null, ...x }));
    const key = (r: RawRow) => canonical(r);
    const havePairs = new Set((p.before as { pairs: RawRow[] }).pairs.map(key)), haveCutoffs = new Set((p.before as { cutoffs: RawRow[] }).cutoffs.map(key));
    if (wantPairs.every(x => havePairs.has(key(x))) && wantCutoffs.every(x => haveCutoffs.has(key(x))) && pairs.length === wantPairs.length && cutoffs.length === wantCutoffs.length) { p.status = "already"; return; }
    if (pairs.length || cutoffs.length) throw new Error("Vendor already has a different live rhythm/cutoff set; author the change in the app, not here");
  });
  return result;
}

export function validateArgs(args: string[], env: Record<string, string | undefined> = process.env) {
  if (args.filter(a => a === "--dry-run").length > 1 || (args.includes("--dry-run") && args.includes("--execute"))) throw new Error("Conflicting/duplicate dry-run option");
  if (args.some(a => ["--wave7", "--readiness", "--as-of"].includes(a))) throw new Error("Unsupported seed-34 option");
  return validateTarget(args.filter(a => a !== "--dry-run"), env);
}
async function readTables(sb: SupabaseClient): Promise<Tables> {
  const names: (keyof Tables)[] = ["vendor_items", "vendors", "locations", "vendor_delivery_rhythm", "vendor_cutoffs"];
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
  if (error) throw new Error(`${table}: INSERT failed (${error.code ?? "unknown"}); stop and reconcile partial operation`);
}
async function record(sb: SupabaseClient, action: AuditAction, table: string, id: string, p: Plan, extra: RawRow = {}): Promise<void> {
  const { audit } = await import("@/lib/audit");
  const operation = randomUUID();
  await audit({ actorId: null, actorRole: null, action, resourceTable: table, resourceId: id, metadata: { source: SOURCE, operation, source_note: p.source, before: p.before, after: p.after, ...extra }, ipAddress: null, userAgent: null });
  const { data, error } = await sb.from("audit_log").select("id").eq("action", action).eq("resource_id", id).contains("metadata", { source: SOURCE, operation });
  if (error || data?.length !== 1) throw new Error(`${table}: audit readback failed; stop and reconcile (audit helper is fail-open)`);
}
async function apply(sb: SupabaseClient, p: Plan): Promise<void> {
  const now = new Date().toISOString();
  if (p.section === "pars") {
    const spec = PARS.find(s => s.name === p.name)!, sku = p.expected.sku as RawRow;
    await update(sb, "vendor_items", sku, { ...spec.after, updated_at: now, updated_by: null });
    await record(sb, "vendor_item.update", "vendor_items", String(sku.id), p, { fields: ["weekday_par", "weekend_par"] });
  } else {
    const vendor = p.expected.vendor as RawRow, locations = p.expected.locations as RawRow[];
    for (const loc of locations) for (const x of RHYTHM.pairs) {
      const id = randomUUID();
      await insert(sb, "vendor_delivery_rhythm", { id, vendor_id: vendor.id, location_id: loc.id, order_dow: x.order_dow, lead_days: x.lead_days, active: true, created_by: null });
      // The lib's metadata shape (setVendorRhythmPair) plus this seed's provenance.
      await record(sb, "vendor.full_profile_edit", "vendor_delivery_rhythm", id, p, { scope: "delivery_rhythm", op: "set", vendor_id: vendor.id, location_id: loc.id, order_dow: x.order_dow, lead_days: x.lead_days, superseded: 0 });
    }
    for (const x of RHYTHM.cutoffs) {
      const id = randomUUID();
      await insert(sb, "vendor_cutoffs", { id, vendor_id: vendor.id, location_id: null, order_day: x.order_day, cutoff_time: x.cutoff_time, active: true });
      await record(sb, "vendor.cutoff_change", "vendor_cutoffs", id, p, { op: "add", vendor_id: vendor.id, location_id: null, order_day: x.order_day, cutoff_time: x.cutoff_time });
    }
  }
}
async function verifyAudits(sb: SupabaseClient, p: Plan): Promise<void> {
  const checks: [AuditAction, unknown][] = p.section === "pars"
    ? [["vendor_item.update", (p.expected.sku as RawRow).id]]
    : [...(p.expected.pairs as RawRow[]).map(r => ["vendor.full_profile_edit", r.id] as [AuditAction, unknown]), ...(p.expected.cutoffs as RawRow[]).map(r => ["vendor.cutoff_change", r.id] as [AuditAction, unknown])];
  for (const [action, id] of checks) {
    const { data, error } = await sb.from("audit_log").select("id").eq("action", action).eq("resource_id", id).contains("metadata", { source: SOURCE, source_note: p.source }).limit(1);
    if (error || !data?.length) throw new Error(`${p.name}: missing matching ${action} provenance audit; reconcile before retry`);
  }
}
/** Normalize only this operation's permitted writes; every other field stays equal. */
export function verifyWriteScope(before: Tables, after: Tables, p: Plan): void {
  const skuId = p.section === "pars" ? (p.expected.sku as RawRow).id : null;
  const vendorId = p.section === "rhythm" ? (p.expected.vendor as RawRow).id : null;
  for (const table of Object.keys(before) as (keyof Tables)[]) {
    const allowed = (r: RawRow): string[] => table === "vendor_items" && skuId != null && r.id === skuId ? ["weekday_par", "weekend_par", "updated_at", "updated_by"] : [];
    const addedAllowed = (r: RawRow) => vendorId != null && (table === "vendor_delivery_rhythm" || table === "vendor_cutoffs") && r.vendor_id === vendorId;
    const oldIds = new Set(before[table].map(r => r.id));
    const normalize = (rows: RawRow[]) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([key]) => !allowed(r).includes(key)))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const existingAfter = after[table].filter(r => oldIds.has(r.id) || !addedAllowed(r));
    if (!equal(normalize(before[table]), normalize(existingAfter))) throw new Error(`${p.name}: unrelated/concurrent ${table} change; stop for a fresh reviewed dry-run`);
  }
}
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const config = validateArgs(args), sb = createWave7Client(config);
  let expectedTables = await readTables(sb);
  const plans = planOrderGuide(expectedTables);
  const digest = createHash("sha256").update(canonical({ project: config.projectRef, source: SOURCE, plans })).digest("hex");
  console.log(`${SOURCE}: ${config.execute ? "EXECUTE" : "DRY RUN"}, target ${config.target}`);
  console.table(plans.map(p => ({ section: p.section, row: p.name, before: JSON.stringify(p.before), after: JSON.stringify(p.after), status: p.status, refusal: p.reason ?? "" })));
  console.log(`Plan digest: ${digest}`);
  if (!config.execute) { console.log("No writes. Execute with the same --target and --execute --plan-digest shown above."); return; }
  if (plans.every(p => p.status === "already" || p.status === "absent")) { for (const p of plans) { if (p.status === "absent") { console.log(`absent (skipped): ${p.name}`); continue; } await verifyAudits(sb, p); console.log(`already: ${p.name}`); } return; }
  if (config.planDigest !== digest) throw new Error("Plan changed; review a fresh dry-run");
  if (plans.some(p => p.status === "refused")) throw new Error("Refused before-state(s); no writes. Resolve ledger before execute.");
  for (const p of plans) {
    const tables = await readTables(sb);
    if (!equal(tables, expectedTables)) throw new Error("Database changed after reviewed snapshot; no further writes");
    const current = planOrderGuide(tables).find(r => r.section === p.section && r.name === p.name)!;
    if (current.status === "absent") { console.log(`absent (skipped): ${p.name}`); continue; }
    if (current.status === "already") { await verifyAudits(sb, current); console.log(`already: ${p.name}`); continue; }
    if (current.status !== "ready") throw new Error(`${p.name}: before-state changed during execution`);
    await apply(sb, current);
    const afterTables = await readTables(sb);
    verifyWriteScope(tables, afterTables, current);
    const verified = planOrderGuide(afterTables).find(r => r.section === p.section && r.name === p.name)!;
    if (verified.status !== "already") throw new Error(`${p.name}: destination verification failed; reconcile partial operation`);
    await verifyAudits(sb, verified);
    expectedTables = afterTables;
    console.log(`verified: ${p.name}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e instanceof Error ? e.message : "Seed 34 failed"); process.exitCode = 1; });
}
