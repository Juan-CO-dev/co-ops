/**
 * SHOP VERSIONS — the gated writers and the history read (catalog Phase 2a, 0259). SERVER-ONLY,
 * service role. THE LIB IS THE AUTHORITY (spec §2): every writer decides role and shop HERE, before
 * any I/O — the route is the outer layer, not the lock (writeParFromSuggestion's posture):
 *   · AGM (6) / GM (7) write ONLY their own shop's version — and at level 6 only the OPERATIONAL
 *     managers (AGM, prep, catering; never social media — a role check, lead decision); MoO (8)+ write ANY active shop (D2 —
 *     catalogShopAllowed, deliberately not lockLocationContext) and the global default;
 *   · below MoO a global write is FIRST-VALUE-ONLY, decided by the writer RPC UNDER THE SKU LOCK in
 *     the same transaction as the insert (D5) — two requests cannot both see "none".
 * Atomicity lives in SQL; every write is audited with a closed AuditAction.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import {
  assertScopeToken, catalogShopAllowed, catalogWriteRoleAllowed, GLOBAL_VERSION_WRITE_MIN, skuOwnerAllowed, versionWriteGate,
  type VersionKind, type VersionScope, type VersionWriteRefusal,
} from "@/lib/sku-versions-shared";
import {
  assertSkuExists, loadMeasureLabels, loadMeasuresMap, validateSubmission,
  PackChainError, type PackChainLevelInput,
} from "@/lib/admin/pack-chain";

export class SkuVersionError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "SkuVersionError";
  }
}

function refuse(r: VersionWriteRefusal): never {
  throw new SkuVersionError(r.status, r.code);
}

/** THE BIND (a BIND_PRIMITIVES name): role + shop, decided before any I/O. Returns firstOnly for the RPC. */
function requireLocation(actor: AuthContext, kind: VersionKind, scope: VersionScope): { firstOnly: boolean } {
  const gate = versionWriteGate({ kind, role: actor.role, level: actor.level, scope, scopeAllowed: scope !== null && catalogShopAllowed(actor, scope) });
  if (!gate.ok) refuse(gate);
  return { firstOnly: gate.firstOnly };
}

/**
 * THE OWNING-SHOP BIND for a GLOBAL write (Astra 2a r3#1; skuOwnerAllowed): below MoO, a shop-owned
 * SKU's global value belongs to the people of that shop. One indexed read; refused as not_found.
 */
async function requireOwningShop(actor: AuthContext, skuId: string): Promise<void> {
  if (actor.level >= GLOBAL_VERSION_WRITE_MIN) return;
  const { data, error } = await getServiceRoleClient().from("vendor_items").select("id, location_id").eq("id", skuId)
    .maybeSingle<{ id: string; location_id: string | null }>();
  if (error) throw new Error(`requireOwningShop: ${error.message}`);
  if (!data) throw new SkuVersionError(404, "sku_not_found");
  if (!skuOwnerAllowed(actor, data.location_id)) throw new SkuVersionError(404, "not_found");
}

/** A shop-scope write on a SKU OWNED by a different shop is refused by name (chunk-4 review P3b). */
async function requireNotOtherShopsSku(skuId: string, shopId: string): Promise<void> {
  const { data, error } = await getServiceRoleClient().from("vendor_items").select("id, location_id").eq("id", skuId)
    .maybeSingle<{ id: string; location_id: string | null }>();
  if (error) throw new Error(`requireNotOtherShopsSku: ${error.message}`);
  if (!data) throw new SkuVersionError(404, "sku_not_found");
  if (data.location_id !== null && data.location_id !== shopId) throw new SkuVersionError(409, "sku_owned_by_other_shop");
}

/** Map an RPC P0001 refusal (`area:code`) to a typed error; anything else is a 500. */
export function versionErrorFromRpc(message: string): never {
  const m = /(?:sku_pack_version|sku_price|sku_pack_change):([a-z_]+)/.exec(message);
  const code = m?.[1];
  const status: Record<string, number> = {
    version_changed: 409, not_live: 409, no_shop_price: 409, par_changed: 409, request_not_open: 409,
    global_requires_moo: 403, global_cannot_retire: 400, invalid_levels: 400, unknown_measure: 400,
    // 0259's chain-shape refusals (migration review P3b)
    non_positive_qty: 400, duplicate_label: 400, shared_child: 400, not_one_root: 400, cycle: 400,
    invalid_based_on: 400, invalid_price: 400, invalid_date: 400, invalid_payload: 400, location_required: 400,
    // chunk-4 review: a first chain that would move a set flat pack; a shop-owned SKU priced/packed by another shop
    flat_pack_exists: 403, sku_owned_by_other_shop: 409, version_sku_mismatch: 409,
    // 0261 apply_sku_price_change: the price snapshot re-taken under the SKU lock differs from the preview's.
    price_changed: 409,
    par_lane_mismatch: 400, invalid_patch: 400, request_mismatch: 400,
    // 0261: the dependency snapshot re-taken under the SKU lock differs from the preview's.
    dependencies_changed: 409,
    sku_not_found: 404, location_not_found: 404, not_found: 404,
  };
  if (code && status[code]) throw new SkuVersionError(status[code]!, code);
  throw new Error(`shop-version rpc failed: ${message}`);
}

export interface PreparedPackWrite { levels: PackChainLevelInput[]; firstOnly: boolean }

/**
 * Gate (before I/O) + the full chain validation (the same validateSubmission the legacy editor runs).
 * Exported so the 2b item page's atomic pack+par apply shares EXACTLY this decision.
 */
export async function preparePackVersionWrite(
  actor: AuthContext,
  input: { skuId: string; scope: VersionScope; levels: PackChainLevelInput[] },
): Promise<PreparedPackWrite> {
  const { firstOnly } = requireLocation(actor, "pack", input.scope);
  if (input.levels.length === 0) throw new SkuVersionError(400, "empty_chain");
  try {
    const { avgOzPerEach, skuClass, ownerLocationId } = await assertSkuExists(input.skuId);
    // A GLOBAL chain of a shop-owned SKU binds that shop below MoO (Astra 2a r3#1).
    if (input.scope === null && !skuOwnerAllowed(actor, ownerLocationId)) throw new SkuVersionError(404, "not_found");
    // A shop-owned SKU has no other shop: no other shop holds a version of it (chunk-4 P3b; also in SQL).
    if (input.scope !== null && ownerLocationId !== null && ownerLocationId !== input.scope) {
      throw new SkuVersionError(409, "sku_owned_by_other_shop");
    }
    const [measureLabels, measures] = await Promise.all([loadMeasureLabels(), loadMeasuresMap()]);
    return { levels: validateSubmission(input.levels, measureLabels, measures, avgOzPerEach, skuClass), firstOnly };
  } catch (e) {
    if (e instanceof PackChainError) throw new SkuVersionError(e.status, e.code, e.message);
    throw e;
  }
}

/** The RPC payload of a validated chain (index-linked, trimmed). */
export function rpcLevels(levels: readonly PackChainLevelInput[]): Array<Record<string, unknown>> {
  return levels.map((l) => ({
    label: l.label.trim(), containsQty: l.containsQty, containsIndex: l.containsIndex,
    containsMeasureUnit: l.containsIndex != null ? null : (l.containsMeasureUnit ?? "").trim(),
  }));
}

export interface SavePackVersionInput {
  skuId: string;
  scope: VersionScope;
  levels: PackChainLevelInput[];
  /** The live version the editor saw for this scope (null = none). A mismatch is 409 version_changed. */
  expectedLiveVersionId: string | null;
  basedOnVersionId?: string | null;
  note?: string | null;
  restoredFromVersionId?: string | null;
}

/** Save a pack chain version for a shop or the global default. */
export async function saveSkuPackVersion(
  actor: AuthContext,
  input: SavePackVersionInput,
): Promise<{ versionId: string; retiredVersionId: string | null; flatFieldsSynced: boolean | null }> {
  // The bind, visibly in THIS writer's body (tests/location-bind-differential.test.ts reads bodies):
  // pure and before any I/O. preparePackVersionWrite repeats it for its other callers (2b).
  requireLocation(actor, "pack", input.scope);
  const prepared = await preparePackVersionWrite(actor, input);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.rpc("save_sku_pack_version", {
    p_sku: input.skuId, p_location: input.scope, p_levels: rpcLevels(prepared.levels),
    p_expected_live: input.expectedLiveVersionId, p_based_on: input.basedOnVersionId ?? null,
    p_note: input.note ?? null, p_actor: actor.user.id, p_first_only: prepared.firstOnly,
  });
  if (error) versionErrorFromRpc(error.message);
  const result = data as { version_id: string; retired_version_id: string | null; mirror_synced: boolean | null };
  // The GLOBAL flat mirror was derived INSIDE the RPC's locked transaction (0259 sku_flat_mirror_apply,
  // Astra 2a r2#6) — never synced afterwards, so two saves can never leave the mirror of the older one.
  const flatFieldsSynced = result.mirror_synced;
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.pack_version_save", resourceTable: "sku_pack_versions", resourceId: result.version_id,
    metadata: {
      sku_id: input.skuId, location_id: input.scope, scope: input.scope === null ? "global" : "shop",
      retired_version_id: result.retired_version_id, based_on_version_id: input.basedOnVersionId ?? result.retired_version_id,
      restored_from_version_id: input.restoredFromVersionId ?? null, first_only: prepared.firstOnly,
      labels: prepared.levels.map((l) => l.label.trim()), level_count: prepared.levels.length, flat_fields_synced: flatFieldsSynced,
    },
    ipAddress: null, userAgent: null,
  });
  return { versionId: result.version_id, retiredVersionId: result.retired_version_id, flatFieldsSynced };
}

/** Restore = a NEW version with the old one's levels, based on the old one. Never a delete, never a revive. */
export async function restoreSkuPackVersion(
  actor: AuthContext,
  input: { skuId: string; scope: VersionScope; fromVersionId: string; expectedLiveVersionId: string | null },
): Promise<{ versionId: string; retiredVersionId: string | null }> {
  requireLocation(actor, "pack", input.scope);
  const sb = getServiceRoleClient();
  // The source version must be THIS SKU's, and global or THIS scope's own (chunk-4 review P3a):
  // adopting another shop's version is Phase 3's job. Refused as not_found (no existence leak).
  const { data: from, error: fromErr } = await sb.from("sku_pack_versions").select("id, sku_id, location_id")
    .eq("id", input.fromVersionId).maybeSingle<{ id: string; sku_id: string; location_id: string | null }>();
  if (fromErr) throw new Error(`restoreSkuPackVersion version: ${fromErr.message}`);
  if (!from || from.sku_id !== input.skuId || (from.location_id !== null && from.location_id !== input.scope)) {
    throw new SkuVersionError(404, "not_found");
  }
  const { data: rows, error } = await sb.from("sku_pack_levels")
    .select("id, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal")
    .eq("version_id", input.fromVersionId).eq("sku_id", input.skuId)
    .order("display_ordinal", { ascending: true }).order("id", { ascending: true })
    .returns<Array<{ id: string; label: string; contains_qty: number | string; contains_level_id: string | null; contains_measure_unit: string | null; display_ordinal: number }>>();
  if (error) throw new Error(`restoreSkuPackVersion read: ${error.message}`);
  if (!rows || rows.length === 0) throw new SkuVersionError(404, "not_found");
  const indexById = new Map(rows.map((r, i) => [r.id, i]));
  const levels: PackChainLevelInput[] = rows.map((r) => ({
    label: r.label, containsQty: Number(r.contains_qty),
    containsIndex: r.contains_level_id != null ? (indexById.get(r.contains_level_id) ?? -1) : null,
    containsMeasureUnit: r.contains_level_id != null ? null : r.contains_measure_unit,
  }));
  const saved = await saveSkuPackVersion(actor, {
    skuId: input.skuId, scope: input.scope, levels, expectedLiveVersionId: input.expectedLiveVersionId,
    basedOnVersionId: input.fromVersionId, restoredFromVersionId: input.fromVersionId,
  });
  return { versionId: saved.versionId, retiredVersionId: saved.retiredVersionId };
}

/** A shop goes BACK TO DEFAULT for its pack: retire its live version (never the global one). */
export async function retireShopPackVersion(actor: AuthContext, input: { skuId: string; versionId: string; locationId: string }): Promise<void> {
  requireLocation(actor, "pack", input.locationId);
  const sb = getServiceRoleClient();
  const { data: v, error: vErr } = await sb.from("sku_pack_versions").select("id, sku_id, location_id")
    .eq("id", input.versionId).maybeSingle<{ id: string; sku_id: string; location_id: string | null }>();
  if (vErr) throw new Error(`retireShopPackVersion read: ${vErr.message}`);
  // The version must be THIS shop's — the bind above was on the shop the caller named.
  if (!v || v.location_id !== input.locationId) throw new SkuVersionError(404, "not_found");
  // …and THIS SKU's: the route addresses /sku/[id], so a version of another SKU is a mismatch,
  // never a silent retire of the wrong item (Astra full-branch r1 P3).
  if (v.sku_id !== input.skuId) throw new SkuVersionError(409, "version_sku_mismatch");
  const { error } = await sb.rpc("retire_sku_pack_version", { p_version: input.versionId, p_actor: actor.user.id });
  if (error) versionErrorFromRpc(error.message);
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.pack_version_retire", resourceTable: "sku_pack_versions", resourceId: input.versionId,
    metadata: { sku_id: v.sku_id, location_id: input.locationId }, ipAddress: null, userAgent: null,
  });
}

export interface SavePriceInput {
  skuId: string; scope: VersionScope; unitPrice: number; effectiveDate: string;
  /**
   * The price snapshot the person's preview was computed on (0261 sku_price_snapshot). Present → the
   * write re-takes it under the SKU lock and refuses `price_changed` on any difference; absent (the
   * legacy Record price, which shows no preview) → no re-check.
   */
  expectedSnapshot?: unknown;
}

/** Record a price for a shop (opens its lane on the first one) or the global default (MoO+, or a FIRST global price). */
export async function saveSkuPrice(actor: AuthContext, input: SavePriceInput): Promise<{ priceId: string; laneId: string | null; laneCreated: boolean }> {
  const { firstOnly } = requireLocation(actor, "price", input.scope);
  if (!Number.isFinite(input.unitPrice) || input.unitPrice <= 0) throw new SkuVersionError(400, "invalid_price");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate) || Number.isNaN(Date.parse(input.effectiveDate))) {
    throw new SkuVersionError(400, "invalid_date");
  }
  // A GLOBAL price of a shop-owned SKU binds that shop below MoO (Astra 2a r3#1).
  if (input.scope === null) await requireOwningShop(actor, input.skuId);
  // A shop-owned SKU has no other shop: no other shop prices it (chunk-4 P3b; also in SQL).
  else await requireNotOtherShopsSku(input.skuId, input.scope);
  const sb = getServiceRoleClient();
  // ONE atomic write (0261 apply_sku_price_change): the SKU lock first, the preview's price snapshot
  // re-checked under it, then 0259's shop or global writer inside the same transaction.
  const { data, error } = await sb.rpc("apply_sku_price_change", {
    p_sku: input.skuId, p_location: input.scope, p_unit_price: input.unitPrice, p_effective_date: input.effectiveDate,
    p_actor: actor.user.id, p_first_only: firstOnly, p_snapshot: input.expectedSnapshot ?? null,
  });
  if (error) versionErrorFromRpc(error.message);
  if (input.scope !== null) {
    const r = data as { price_id: string; lane_id: string; lane_created: boolean };
    await audit({
      actorId: actor.user.id, actorRole: actor.user.role,
      action: "vendor_item.price_recorded", resourceTable: "vendor_price_history", resourceId: r.price_id,
      metadata: { vendor_item_id: input.skuId, unit_price: input.unitPrice, effective_date: input.effectiveDate, location_id: input.scope, price_lane_id: r.lane_id, lane_created: r.lane_created },
      ipAddress: null, userAgent: null,
    });
    return { priceId: r.price_id, laneId: r.lane_id, laneCreated: r.lane_created };
  }
  const r = data as { price_id: string };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "vendor_item.price_recorded", resourceTable: "vendor_price_history", resourceId: r.price_id,
    metadata: { vendor_item_id: input.skuId, unit_price: input.unitPrice, effective_date: input.effectiveDate, location_id: null, first_only: firstOnly },
    ipAddress: null, userAgent: null,
  });
  return { priceId: r.price_id, laneId: null, laneCreated: false };
}

/** A shop goes BACK TO DEFAULT for its price: retire its live lane (the rows stay). */
export async function retireShopPriceLane(actor: AuthContext, input: { skuId: string; locationId: string }): Promise<void> {
  requireLocation(actor, "price", input.locationId);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.rpc("retire_sku_price_lane", { p_sku: input.skuId, p_location: input.locationId, p_actor: actor.user.id });
  if (error) versionErrorFromRpc(error.message);
  const r = data as { lane_id: string };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.price_lane_retire", resourceTable: "sku_price_lanes", resourceId: r.lane_id,
    metadata: { sku_id: input.skuId, location_id: input.locationId }, ipAddress: null, userAgent: null,
  });
}

export interface PackVersionHistoryRow {
  id: string; locationId: string | null; active: boolean; basedOnVersionId: string | null;
  validFrom: string; validTo: string | null; createdBy: string | null; note: string | null; labels: string[];
}

/** Every pack version of a SKU visible to a scope (global + that shop), newest first. Read floor 6; D2 allowance. */
export async function loadSkuPackVersionHistory(actor: AuthContext, skuId: string, scope: VersionScope): Promise<PackVersionHistoryRow[]> {
  if (!catalogWriteRoleAllowed(actor.role, actor.level)) throw new SkuVersionError(403, "forbidden");
  if (scope !== null && !catalogShopAllowed(actor, scope)) throw new SkuVersionError(404, "not_found");
  const sb = getServiceRoleClient();
  const base = sb.from("sku_pack_versions").select("id, location_id, active, based_on_version_id, valid_from, valid_to, created_by, note").eq("sku_id", skuId);
  const scoped = scope === null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
  const { data: versions, error } = await scoped.order("valid_from", { ascending: false }).order("id", { ascending: false })
    .returns<Array<{ id: string; location_id: string | null; active: boolean; based_on_version_id: string | null; valid_from: string; valid_to: string | null; created_by: string | null; note: string | null }>>();
  if (error) throw new Error(`loadSkuPackVersionHistory: ${error.message}`);
  const ids = (versions ?? []).map((v) => v.id);
  const labelsBy = new Map<string, string[]>();
  if (ids.length > 0) {
    const { data: levels, error: lErr } = await sb.from("sku_pack_levels").select("version_id, label, display_ordinal")
      .in("version_id", ids).order("display_ordinal", { ascending: true })
      .returns<Array<{ version_id: string; label: string; display_ordinal: number }>>();
    if (lErr) throw new Error(`loadSkuPackVersionHistory levels: ${lErr.message}`);
    for (const l of levels ?? []) labelsBy.set(l.version_id, [...(labelsBy.get(l.version_id) ?? []), l.label]);
  }
  return (versions ?? []).map((v) => ({
    id: v.id, locationId: v.location_id, active: v.active, basedOnVersionId: v.based_on_version_id,
    validFrom: v.valid_from, validTo: v.valid_to, createdBy: v.created_by, note: v.note, labels: labelsBy.get(v.id) ?? [],
  }));
}
