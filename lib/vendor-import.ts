import "server-only";

import { createHash } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { audit } from "@/lib/audit";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { ORDER_GUIDE_EDIT_MIN } from "@/lib/order-guides";
import { buildPackChain, chainRootLabel, type PackChainLevel } from "@/lib/pack-chain-shared";
import { detectAdapter } from "@/lib/vendor-import-shared/adapters";
import type { CatalogSku, Decision, Observation, PlanOp } from "@/lib/vendor-import-shared/model";
import { matchObservations, observationKey, planDigest, planFromDecisions, snapshotBeforeState } from "@/lib/vendor-import-shared/match";

export class VendorImportError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}
export const VENDOR_IMPORT_STAGE_MIN = ORDER_GUIDE_EDIT_MIN;
export const VENDOR_IMPORT_APPLY_MIN = 9;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const ADAPTER_VERSION = "v3c2-v1";
type BeforeState = Record<string, Record<string, unknown>>;
interface PackRow {
  sku_id: string; id: string; label: string; contains_qty: number;
  contains_level_id: string | null; contains_measure_unit: string | null; display_ordinal: number;
}
interface Vendor { id: string; name: string; active: boolean; account_number: string | null; portal_url: string | null }
interface Measure { label: string; dimension: "weight" | "volume" | "count"; to_base_factor: number }
interface ImportReport {
  counts: Record<string, number>;
  reasons: Record<string, number>;
  needs_person: Array<{ key: string; reason: string; href: string }>;
  before_state: BeforeState;
  ignored_rows: number;
}
interface BatchRow {
  id: string; vendor_id: string; location_id: null; account_id: string | null;
  adapter: string; adapter_version: string; source_name: string; source_sha256: string;
  exported_at: string | null; row_count: number; report: ImportReport;
  status: "staged" | "applied" | "superseded"; created_by: string; created_at: string;
}
export interface ImportBatchView {
  batch: BatchRow;
  observations: Observation[];
  /** Keys are observationKey(observation), not a row number: a row can have several kinds. */
  decisions: Record<string, Decision>;
  beforeState: BeforeState;
  ops: PlanOp[];
  expectedDigest: string;
}
export interface ImportApplyResult {
  batch_id: string; plan_digest: string;
  ops: Array<{ action: PlanOp["action"]; sku_id: string; source_row: number; new_ids: string[] }>;
  non_atomic: string[];
}

function requireLevel(actor: AuthContext, min: number) {
  if (getRoleLevel(actor.user.role) < min) throw new VendorImportError(403, "forbidden");
}
function id(value: string) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) throw new VendorImportError(400, "invalid_payload");
}
function check(error: { message: string } | null) {
  if (error) throw new VendorImportError(500, "internal_error");
}
const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
function family(vendor: Vendor): string {
  const name = norm(vendor.name);
  // Adapter identities describe supplier formats, never tenant/location vocabulary.
  if (name === "pfg" || name.startsWith("performancefoodservice")) return "pfg";
  if (name === "usfoods") return "usfoods";
  return name;
}
async function loadVendor(vendorId: string): Promise<Vendor> {
  id(vendorId);
  const { data, error } = await getServiceRoleClient().from("vendors")
    .select("id,name,active,account_number,portal_url").eq("id", vendorId).maybeSingle<Vendor>();
  check(error);
  if (!data || !data.active) throw new VendorImportError(404, "vendor_not_found");
  return data;
}

async function loadCatalog(vendorId: string): Promise<{ catalog: CatalogSku[]; packs: Map<string, PackRow[]>; measures: Measure[] }> {
  const sb = getServiceRoleClient();
  const skus = await selectAllRows<Omit<CatalogSku, "root" | "latestPrice">>((from, to) => sb.from("vendor_items")
    .select("id,vendor_id,name,item_number,active,price_basis").eq("vendor_id", vendorId).order("id").range(from, to));
  const packs = new Map<string, PackRow[]>();
  const latest = new Map<string, NonNullable<CatalogSku["latestPrice"]>>();
  // Bounded ID windows avoid an unbounded PostgREST URL; 84 SKUs use ONE pack query.
  for (let start = 0; start < skus.length; start += 100) {
    const ids = skus.slice(start, start + 100).map(s => s.id);
    const [levels, prices] = await Promise.all([
      selectAllRows<PackRow>((from, to) => sb.from("sku_pack_levels")
        .select("sku_id,id,label,contains_qty,contains_level_id,contains_measure_unit,display_ordinal")
        .in("sku_id", ids).eq("active", true).order("id").range(from, to)),
      // Mirrors loadCurrentSkuPrices, lib/admin/cost.ts:88–97, including pagination
      // and all THREE sort keys. Add id because the apply precondition needs it.
      selectAllRows<{ id: string; vendor_item_id: string; unit_price: number | string; effective_date: string }>((from, to) => sb
        .from("vendor_price_history").select("id,vendor_item_id,unit_price,effective_date,recorded_at")
        .in("vendor_item_id", ids).order("effective_date", { ascending: false })
        .order("recorded_at", { ascending: false }).order("id", { ascending: false }).range(from, to)),
    ]);
    for (const level of levels) {
      const list = packs.get(level.sku_id) ?? [];
      list.push({ ...level, contains_qty: Number(level.contains_qty) }); packs.set(level.sku_id, list);
    }
    for (const price of prices) if (!latest.has(price.vendor_item_id)) {
      const amount = Number(price.unit_price);
      if (!Number.isFinite(amount)) throw new VendorImportError(500, "invalid_catalog_price");
      latest.set(price.vendor_item_id, { id: price.id, unit_price: amount, effective_date: price.effective_date });
    }
  }
  const measureRows = await selectAllRows<Measure>((from, to) => sb
    .from("measure_units").select("label,dimension,to_base_factor").eq("active", true).order("label").range(from, to));
  const measures = measureRows.map(m => ({ ...m, to_base_factor: Number(m.to_base_factor) }));
  const measureMap = new Map(measures.map(m => [m.label, m]));
  return { packs, measures, catalog: skus.map(sku => {
    const raw = packs.get(sku.id) ?? [];
    // Same active-level hydration as loadSkuPackChain (admin/pack-chain.ts:144–164).
    // Root is the unique unreferenced node (pack-chain-shared.ts:182), NOT ordinal zero.
    const levels: PackChainLevel[] = raw.map(r => ({ id: r.id, label: r.label, containsQty: r.contains_qty,
      containsLevelId: r.contains_level_id, containsMeasureUnit: r.contains_measure_unit, displayOrdinal: r.display_ordinal }));
    const chain = buildPackChain(levels);
    const label = chainRootLabel(chain);
    const root = label ? chain.byLabel.get(label) : undefined;
    let node = root; let quantity = 1; const seen = new Set<string>();
    let resolved: CatalogSku["root"] = null;
    while (node && root && !seen.has(node.id)) {
      seen.add(node.id); quantity *= node.containsQty;
      if (node.containsLevelId) { node = chain.byId.get(node.containsLevelId); continue; }
      const measure = measureMap.get(node.containsMeasureUnit ?? "");
      if (measure && seen.size === levels.length) {
        quantity *= Number(measure.to_base_factor);
        if (Number.isFinite(quantity) && quantity > 0) resolved = { levelId: root.id, label: root.label, quantity,
          unit: measure.dimension === "weight" ? "oz" : measure.dimension === "volume" ? "fl oz" : "each", dimension: measure.dimension };
      }
      break;
    }
    return { ...sku, root: resolved, latestPrice: latest.get(sku.id) ?? null };
  }) };
}

function defaultDecisions(observations: Observation[]): Record<string, Decision> {
  const seen = new Set<string>();
  return Object.fromEntries(observations.map(o => {
    const target = `${o.match.sku_id}:${o.kind}`;
    const accepts = ["price", "item_number", "pack"].includes(o.kind) && !seen.has(target);
    seen.add(target);
    return [observationKey(o), accepts ? "accept" : "skip"];
  }));
}
function makeOps(observations: Observation[], decisions: Record<string, Decision>, before: BeforeState): PlanOp[] {
  try { return planFromDecisions(observations, decisions, before); }
  catch (e) { throw new VendorImportError(400, e instanceof Error ? e.message : "invalid_payload"); }
}

export async function stageVendorImport(actor: AuthContext, vendorId: string, file: { name: string; text: string }): Promise<ImportBatchView> {
  requireLevel(actor, VENDOR_IMPORT_STAGE_MIN);
  if (Buffer.byteLength(file.text, "utf8") > MAX_IMPORT_BYTES) throw new VendorImportError(413, "too_large");
  const vendor = await loadVendor(vendorId);
  const adapter = detectAdapter(file.text);
  if (!adapter) throw new VendorImportError(400, "unknown_adapter");
  if (adapter.vendor !== "receipts" && adapter.vendor !== family(vendor)) throw new VendorImportError(400, "adapter_vendor_mismatch");
  const sourceName = file.name.split(/[\\/]/).pop() ?? "";
  let parsed: ReturnType<typeof adapter.parse>;
  try { parsed = adapter.parse(file.text, sourceName); }
  catch { throw new VendorImportError(400, "invalid_payload"); }
  // A receipt file can contain several vendors; preserve row citations and stage
  // only THIS vendor's unit, reporting how many unrelated observations were excluded.
  const rows = parsed.filter(row => adapter.vendor !== "receipts" || norm(row.vendor) === norm(vendor.name));
  if (rows.length === 0) throw new VendorImportError(400, "adapter_vendor_mismatch");
  // [ASSUMPTION] MOXe has no account column. The offline adapter's fixture account
  // is not runtime evidence: use configured vendor metadata, or honestly unknown.
  if (adapter.vendor === "usfoods") for (const row of rows) row.account_id = vendor.account_number ?? "";
  const accounts = [...new Set(rows.map(r => r.account_id).filter(Boolean))];
  if (accounts.length > 1) throw new VendorImportError(400, "multiple_accounts");
  const sha = createHash("sha256").update(file.text, "utf8").digest("hex");
  const sb = getServiceRoleClient();
  const { data: existing, error: findError } = await sb.from("vendor_import_batches").select("id")
    .eq("vendor_id", vendorId).eq("source_sha256", sha).eq("adapter_version", ADAPTER_VERSION).eq("status", "staged").maybeSingle<{ id: string }>();
  check(findError);
  if (existing) return loadImportBatch(actor, vendorId, existing.id);
  const { catalog, packs, measures } = await loadCatalog(vendorId);
  // [ASSUMPTION] The v1 root-only proposal cannot distinguish a changed case
  // count from a changed descendant size. Never turn 12 x 32oz into 24 x 16oz.
  // Multi-level physical changes go to the existing pack editor for now.
  const matched = matchObservations(rows, catalog, vendorId);
  const observations = matched.flatMap((o): Observation[] => {
    if (o.kind !== "pack" || (packs.get(o.match.sku_id ?? "")?.length ?? 0) <= 1) return [o];
    if (matched.some(other => other.source_row === o.source_row && other.kind === "needs_person")) return [];
    return [{ ...o, kind: "needs_person", reason: "pack_hierarchy_review", proposed: null }];
  });
  const before = snapshotBeforeState(observations, catalog);
  for (const observation of observations) {
    const snapshot = before[observationKey(observation)];
    if (!snapshot || !observation.match.sku_id) continue;
    const sku = catalog.find(s => s.id === observation.match.sku_id)!;
    snapshot.price_basis = sku.price_basis; snapshot.item_number = sku.item_number;
    const levels = packs.get(sku.id) ?? [];
    snapshot.pack_levels = levels.map(level => ({ id: level.id, label: level.label, contains_qty: level.contains_qty,
      contains_level_id: level.contains_level_id, contains_measure_unit: level.contains_measure_unit, display_ordinal: level.display_ordinal }));
    snapshot.measures = measures.filter(m => levels.some(l => l.contains_measure_unit === m.label));
    snapshot.name = sku.name;
    snapshot.evidence = { vendor_id: vendorId, account_id: accounts[0] ?? null, location_id: null,
      source_sha256: sha, adapter_version: ADAPTER_VERSION, row: observation.row };
  }
  const report: ImportReport = { counts: {}, reasons: {}, needs_person: [], before_state: before, ignored_rows: parsed.length - rows.length };
  for (const o of observations) {
    report.counts[o.kind] = (report.counts[o.kind] ?? 0) + 1;
    report.reasons[o.reason] = (report.reasons[o.reason] ?? 0) + 1;
    if (o.kind === "needs_person") report.needs_person.push({ key: observationKey(o), reason: o.reason,
      href: o.match.sku_id ? "/admin/skus" : `/admin/vendors/${vendorId}#order-guide-${vendorId}` });
  }
  const { data: staged, error } = await sb.rpc("stage_vendor_import", {
    p_batch: { vendor_id: vendorId, account_id: accounts[0] ?? null, adapter: adapter.id, adapter_version: ADAPTER_VERSION,
      source_name: sourceName, source_sha256: sha, exported_at: rows.map(r => r.exported_at).sort().at(-1) ?? null,
      row_count: rows.length, report, created_by: actor.user.id }, p_observations: observations,
  });
  check(error);
  const batchId = (staged as { batch_id?: unknown } | null)?.batch_id;
  if (typeof batchId !== "string") throw new VendorImportError(500, "internal_error");
  const view = await loadImportBatch(actor, vendorId, batchId);
  if (!(staged as { created: boolean }).created) return view;
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "vendor.import_staged",
    resourceTable: "vendor_import_batches", resourceId: batchId, metadata: { actor_context: "vendor_import",
      vendor_id: vendorId, account_id: accounts[0] ?? null, counts: view.batch.report.counts, sha, adapter: adapter.id }, ipAddress: null, userAgent: null });
  return view;
}

export async function loadImportBatch(actor: AuthContext, vendorId: string, batchId: string): Promise<ImportBatchView> {
  requireLevel(actor, VENDOR_IMPORT_STAGE_MIN); id(vendorId); id(batchId);
  const sb = getServiceRoleClient();
  const { data: batch, error } = await sb.from("vendor_import_batches").select("*").eq("id", batchId)
    .eq("vendor_id", vendorId).maybeSingle<BatchRow>();
  check(error);
  if (!batch) throw new VendorImportError(404, "batch_not_found");
  const stored = await selectAllRows<{ source_row: number; kind: Observation["kind"]; reason: string;
    match_rule: Observation["match"]["rule"]; sku_id: string | null; candidates: string[];
    payload: Observation["row"]; proposed: Observation["proposed"]; decision: Decision | null }>((from, to) => sb
    .from("vendor_import_observations").select("source_row,kind,reason,match_rule,sku_id,candidates,payload,proposed,decision")
    .eq("batch_id", batchId).order("source_row").order("kind").range(from, to));
  const observations: Observation[] = stored.map(o => ({ source_row: o.source_row, row: o.payload,
    kind: o.kind, reason: o.reason, match: { rule: o.match_rule, sku_id: o.sku_id, candidates: o.candidates }, proposed: o.proposed }));
  const decisions = defaultDecisions(observations);
  for (const o of stored) if (o.decision) decisions[`${o.source_row}:${o.kind}`] = o.decision;
  const beforeState = batch.report.before_state;
  const ops = makeOps(observations, decisions, beforeState);
  return { batch, observations, decisions, beforeState, ops, expectedDigest: await planDigest(ops, beforeState) };
}

export async function applyVendorImport(actor: AuthContext, vendorId: string, batchId: string,
  decisions: Record<string, Decision>, expectedDigest: string): Promise<ImportApplyResult> {
  requireLevel(actor, VENDOR_IMPORT_APPLY_MIN);
  if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)
    || Object.values(decisions).some(d => d !== "accept" && d !== "skip")
    || typeof expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw new VendorImportError(400, "invalid_payload");
  const view = await loadImportBatch(actor, vendorId, batchId);
  const keys = new Set(view.observations.map(observationKey));
  if (Object.keys(decisions).some(k => !keys.has(k))) throw new VendorImportError(400, "invalid_payload");
  const ops = makeOps(view.observations, decisions, view.beforeState);
  if (await planDigest(ops, view.beforeState) !== expectedDigest) throw new VendorImportError(409, "plan_changed");
  if (ops.length === 0) throw new VendorImportError(400, "no_operations");
  const { data, error } = await getServiceRoleClient().rpc("apply_vendor_import", {
    p_batch_id: batchId, p_plan_digest: expectedDigest, p_actor: actor.user.id, p_ops: ops,
  });
  if (error) {
    if (error.message.includes("stale_before_state")) {
      // The catalog moved under this batch: retire it so the same file can be
      // staged again against the live catalog (0211 keys uniqueness on STAGED only).
      await getServiceRoleClient().from("vendor_import_batches").update({ status: "superseded" })
        .eq("id", batchId).eq("vendor_id", vendorId).eq("status", "staged");
      throw new VendorImportError(409, "stale_before_state");
    }
    if (error.message.includes("plan_changed")) throw new VendorImportError(409, "plan_changed");
    if (error.message.includes("batch_already_applied")) throw new VendorImportError(409, "batch_already_applied");
    if (error.message.includes("batch_not_found")) throw new VendorImportError(404, "batch_not_found");
    if (error.message.includes("vendor_not_found")) throw new VendorImportError(404, "vendor_not_found");
    if (error.message.includes("forbidden")) throw new VendorImportError(403, "forbidden");
    if (error.message.includes("invalid_chain")) throw new VendorImportError(409, "invalid_chain");
    if (error.message.includes("invalid_price")) throw new VendorImportError(409, "invalid_price");
    if (error.message.includes("conflicting_operations")) throw new VendorImportError(409, "conflicting_operations");
    throw new VendorImportError(500, "internal_error");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new VendorImportError(500, "invalid_apply_result");
  const { _audit: shouldAudit, ...result } = data as ImportApplyResult & { _audit?: boolean };
  if (!result || result.batch_id !== batchId || result.plan_digest !== expectedDigest || !Array.isArray(result.ops)) throw new VendorImportError(500, "invalid_apply_result");
  // The stored result is authoritative after uncertain transport. Only the claim
  // winner audits: a replay (including concurrent retries) writes nothing further.
  // A lost first response can leave an audit gap, but the transactional ledger stands.
  if (!shouldAudit) return result;
  for (const op of ops) await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: op.action,
    resourceTable: "vendor_items",
    resourceId: op.sku_id, metadata: { actor_context: "vendor_import", vendor_id: vendorId, batch_id: batchId,
      plan_digest: expectedDigest, source_row: op.source_row, before: op.before, after: op.after,
      result: result.ops.find(r => r.sku_id === op.sku_id && r.action === op.action) }, ipAddress: null, userAgent: null });
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "vendor.import_applied",
    resourceTable: "vendor_import_batches", resourceId: batchId, metadata: { actor_context: "vendor_import",
      vendor_id: vendorId, batch_id: batchId, plan_digest: expectedDigest, op_count: ops.length, result }, ipAddress: null, userAgent: null });
  return result;
}
