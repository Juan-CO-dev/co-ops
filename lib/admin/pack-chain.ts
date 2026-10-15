/**
 * Admin SKU pack-chain data layer (pack-hierarchy PR 1 — 0159 sku_pack_levels).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level floor → assertStepUp)
 * AND re-checked here per-action (defense in depth; the lib is the authority).
 * Consistent with lib/admin/skus.ts.
 *
 * APPEND-ONLY, SUPERSEDE-AS-A-SET (council L3): a chain is versioned as a WHOLE.
 * Editing ANY level rewrites the entire active chain — deactivate ALL current
 * active rows in one pass, then insert the full new set with a fresh
 * effective_from. There is NO in-place row UPDATE of chain content and NO
 * DELETE. This keeps history sacred and sidesteps the pointer-rewire hazard of
 * partial edits (the detached-sibling trap surfaces only in ephemeral input,
 * never in a persisted half-edited chain).
 *
 * Validations (council L1/L2/L7):
 *  - label ∉ active measure_units labels (cross-table namespace rule, L1).
 *  - labels unique within the submitted set (mirrors the partial UNIQUE index).
 *  - exactly one link per level: contains_level_id XOR contains_measure_unit.
 *  - single root; pointers acyclic + every level reachable from the root.
 *  - the chain terminates in a weight-dim measure (or a count/volume leaf, which
 *    resolves via the SKU's avg_oz_per_each — documented, not rejected, per L2).
 *  - depth-1 chains (tub → oz) are valid.
 *
 * Every UPDATE checks error AND rowcount; audited action `sku.pack_chain_update`.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import {
  buildPackChain,
  validateChainReachable,
  validateChainStructure,
  isChainUnverified,
  firstLabelMeasureCollision,
  type PackChainLevel,
  type PackChainSkuClass,
} from "@/lib/pack-chain-shared";
import { GLOBAL_VERSION_WRITE_MIN, skuOwnerAllowed } from "@/lib/sku-versions-shared";

// Mirror the SKU floors (view chain = catalog read; write chain = catalog write).
export const PACK_CHAIN_READ_MIN = 6; // AGM+
export const PACK_CHAIN_WRITE_MIN = 7; // GM+

/** Typed error the routes map to jsonError(status, code). Mirrors AdminSkuError. */
export class PackChainError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "PackChainError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new PackChainError(403, "forbidden", "Insufficient role level for this action");
  }
}
function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** One level as submitted by the editor. Levels are linked by ARRAY INDEX
 *  (containsIndex) or a terminal measure unit — index-linking is UI-friendly and
 *  the lib resolves indices to freshly-minted row ids on insert (never trusting
 *  client-supplied ids for the new set). */
export interface PackChainLevelInput {
  label: string;
  containsQty: number;
  /** Index (in this same array) of the level this one contains, XOR containsMeasureUnit. */
  containsIndex: number | null;
  containsMeasureUnit: string | null;
}

/** A hydrated active chain for one SKU (read surface). */
export interface SkuPackChainView {
  skuId: string;
  levels: PackChainLevel[];
  /** true when the chain is structurally invalid (any class) OR oz-unresolvable
   *  on a RAW SKU — the class-aware "chain unverified" badge (council PR-A,
   *  cried-wolf law). A non-raw count-terminated chain is complete by design and
   *  is NEVER flagged. See isChainUnverified in lib/pack-chain-shared.ts. */
  unverified: boolean;
}

export async function loadMeasuresMap(): Promise<Map<string, MeasureUnitFactor>> {
  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("measure_units")
    .select("label, dimension, to_base_factor")
    .eq("active", true)
    .returns<Array<{ label: string; dimension: "weight" | "volume" | "count"; to_base_factor: number | string }>>();
  return new Map((data ?? []).map((m) => [m.label, { dimension: m.dimension, toBaseFactor: num(m.to_base_factor) ?? 0 }]));
}

/** The set of active measure-unit labels (for the label-collision rule, L1). */
export async function loadMeasureLabels(): Promise<Set<string>> {
  const sb = getServiceRoleClient();
  const { data } = await sb.from("measure_units").select("label").eq("active", true).returns<Array<{ label: string }>>();
  return new Set((data ?? []).map((m) => m.label));
}

/** SKU class fallback (matches the 0157 column default) for a null/legacy row. */
function normalizeSkuClass(v: string | null): PackChainSkuClass {
  return v === "packaging" || v === "cleaning" || v === "misc" ? v : "raw";
}

/** Verify a SKU exists (active OR inactive — chains can be inspected either way).
 *  Returns the SKU's avg_oz_per_each + sku_class (the class gates the leaf law:
 *  raw chains must be oz-resolvable; non-raw may terminate at a bare count leaf). */
export async function assertSkuExists(skuId: string): Promise<{ avgOzPerEach: number | null; skuClass: PackChainSkuClass; ownerLocationId: string | null }> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendor_items")
    .select("id, avg_oz_per_each, sku_class, location_id")
    .eq("id", skuId)
    .maybeSingle<{ id: string; avg_oz_per_each: number | string | null; sku_class: string | null; location_id: string | null }>();
  if (error) throw new Error(`assertSkuExists failed: ${error.message}`);
  if (!data) throw new PackChainError(404, "sku_not_found", "SKU not found");
  return { avgOzPerEach: num(data.avg_oz_per_each), skuClass: normalizeSkuClass(data.sku_class), ownerLocationId: data.location_id };
}

// ── Read (AGM+) ────────────────────────────────────────────────────────────────
/** Load one SKU's active chain, with an unverified flag from a reachability check. */
export async function loadSkuPackChain(actor: AuthContext, skuId: string): Promise<SkuPackChainView> {
  requireLevel(actor, PACK_CHAIN_READ_MIN);
  const { avgOzPerEach, skuClass } = await assertSkuExists(skuId);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("sku_pack_levels")
    .select("id, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal")
    .eq("sku_id", skuId)
    .eq("active", true)
    .is("location_id", null)
    .order("display_ordinal", { ascending: true })
    .returns<Array<{ id: string; label: string; contains_qty: number | string; contains_level_id: string | null; contains_measure_unit: string | null; display_ordinal: number }>>();
  if (error) throw new Error(`loadSkuPackChain failed: ${error.message}`);
  const levels: PackChainLevel[] = (data ?? []).map((r) => ({
    id: r.id, label: r.label, containsQty: num(r.contains_qty) ?? 0,
    containsLevelId: r.contains_level_id, containsMeasureUnit: r.contains_measure_unit,
    displayOrdinal: r.display_ordinal,
  }));
  let unverified = false;
  if (levels.length > 0) {
    const measures = await loadMeasuresMap();
    const chain = buildPackChain(levels);
    // Class-aware badge: structural break (any class) OR oz-unresolvable on raw.
    unverified = isChainUnverified(chain, measures, avgOzPerEach, skuClass);
  }
  return { skuId, levels, unverified };
}

// ── Validation (pure over the submitted set + the registries) ────────────────────
/** Validate a submitted chain; throws PackChainError on the first problem.
 *  Returns the parsed level shape (index-linked) ready for insert. */
export function validateSubmission(
  input: PackChainLevelInput[],
  measureLabels: Set<string>,
  measures: Map<string, MeasureUnitFactor>,
  avgOzPerEach: number | null,
  skuClass: PackChainSkuClass,
): PackChainLevelInput[] {
  if (input.length === 0) throw new PackChainError(400, "empty_chain", "A chain needs at least one level");

  // L1: no chain label may collide with a measure_units label (pure, testable).
  const collision = firstLabelMeasureCollision(input.map((l) => l.label), measureLabels);
  if (collision != null) {
    throw new PackChainError(400, "label_is_measure_unit", `"${collision}" is a measure unit — pick a container name`);
  }

  const seenLabels = new Set<string>();
  input.forEach((lvl, i) => {
    const label = lvl.label.trim();
    if (!label) throw new PackChainError(400, "invalid_label", "Every level needs a label");
    if (seenLabels.has(label)) throw new PackChainError(400, "duplicate_label", `Duplicate level label "${label}"`);
    seenLabels.add(label);

    if (!Number.isFinite(lvl.containsQty) || lvl.containsQty <= 0) {
      throw new PackChainError(400, "invalid_qty", `"${label}" needs a positive contains-quantity`);
    }

    const hasPtr = lvl.containsIndex != null;
    const hasMeasure = lvl.containsMeasureUnit != null && lvl.containsMeasureUnit.trim() !== "";
    if (hasPtr === hasMeasure) {
      throw new PackChainError(400, "invalid_link", `"${label}" must contain either a level OR a measure unit (exactly one)`);
    }
    if (hasPtr) {
      const idx = lvl.containsIndex!;
      if (!Number.isInteger(idx) || idx < 0 || idx >= input.length) {
        throw new PackChainError(400, "invalid_pointer", `"${label}" points at a level that doesn't exist`);
      }
      if (idx === i) throw new PackChainError(400, "self_reference", `"${label}" can't contain itself`);
    } else {
      const unit = lvl.containsMeasureUnit!.trim();
      if (!measures.has(unit)) {
        throw new PackChainError(400, "unknown_measure", `"${unit}" is not a registered measure unit`);
      }
    }
  });

  // Structural check via the SAME pure walk the spine uses (single root, acyclic,
  // all reachable, terminating). Build a temp PackChainLevel[] with synthetic ids
  // = the array index (string), resolving containsIndex → that id.
  const temp: PackChainLevel[] = input.map((lvl, i) => ({
    id: String(i),
    label: lvl.label.trim(),
    containsQty: lvl.containsQty,
    containsLevelId: lvl.containsIndex != null ? String(lvl.containsIndex) : null,
    containsMeasureUnit: lvl.containsIndex != null ? null : lvl.containsMeasureUnit!.trim(),
    displayOrdinal: i,
  }));
  // Class-aware leaf law (council PR-A): raw chains MUST be oz-resolvable (they
  // feed depletion/cost) → the full reachable check throws leaf_needs_avg on a
  // count/volume leaf with no avg. Non-raw chains (packaging/cleaning/misc) only
  // need to be STRUCTURALLY sound — a bare count leaf ("case → 12 each") is
  // complete by design, no avg required. The structural check still enforces
  // single-root / acyclic / all-reachable / terminates-in-a-registered-measure
  // for every class; only the oz-resolvability gate is class-gated.
  const chain = buildPackChain(temp);
  const res = skuClass === "raw"
    ? validateChainReachable(chain, measures, avgOzPerEach)
    : validateChainStructure(chain, measures);
  if (!res.ok) {
    // Map the pure failure to a caller-facing code.
    const code =
      res.reason === "cycle" ? "chain_cycle" :
      res.reason === "dangling_pointer" ? "chain_unreachable" : // detached sibling / fork
      res.reason === "missing_measure" ? "unknown_measure" :
      res.reason === "missing_avg" ? "leaf_needs_avg" : // raw-only (structure never returns this)
      "chain_invalid";
    const msg =
      code === "chain_unreachable" ? "Every level must be reachable from a single root container (no detached siblings)" :
      code === "chain_cycle" ? "The chain loops back on itself" :
      code === "leaf_needs_avg" ? "This chain ends in a count/volume unit — set the SKU's avg oz per each so it can convert" :
      "The chain is invalid";
    throw new PackChainError(400, code, msg);
  }
  return input;
}

// ── Write (GM+; supersede-as-a-SET) ──────────────────────────────────────────────
/**
 * Replace a SKU's whole active chain with a new version (append-only): validate,
 * deactivate ALL current active rows in one pass (checked), insert the new set
 * with fresh ids + effective_from, wiring contains_level_id to the newly-minted
 * ids. Audited `sku.pack_chain_update`. Idempotent enough to be safe on retry
 * (a partial failure leaves the old set deactivated + is re-runnable — but the
 * two writes are ordered deactivate→insert so a mid-failure never leaves TWO
 * active chains).
 *
 * Returns the level count AND whether the legacy flat-field mirror synced. The chain is
 * saved either way (`flatFieldsSynced: false` is a partial success, never a failed save) —
 * the flag exists so a caller can say so, and it is on the audit row regardless.
 */
export async function replaceSkuPackChain(
  actor: AuthContext,
  args: { skuId: string; levels: PackChainLevelInput[] },
): Promise<{ levelCount: number; flatFieldsSynced: boolean }> {
  requireLevel(actor, PACK_CHAIN_WRITE_MIN);
  const { avgOzPerEach, skuClass, ownerLocationId } = await assertSkuExists(args.skuId);
  // A shop-owned SKU's GLOBAL chain belongs to that shop's people below MoO (skuOwnerAllowed).
  if (!skuOwnerAllowed({ level: getRoleLevel(actor.user.role), locations: actor.locations }, ownerLocationId)) {
    throw new PackChainError(404, "not_found", "SKU not found");
  }
  const [measureLabels, measures] = await Promise.all([loadMeasureLabels(), loadMeasuresMap()]);
  const validated = validateSubmission(args.levels, measureLabels, measures, avgOzPerEach, skuClass);

  const sb = getServiceRoleClient();

  // CATALOG PHASE 2a (D5): the legacy editor writes the GLOBAL default through the one atomic writer.
  // Below MoO it may set the FIRST chain of a SKU that has none (the add-SKU flow) and never change
  // one — decided by the RPC under the SKU lock. A GM changes how an item arrives for their own shop
  // on the item page (2b). The old deactivate-all/insert pair would also have deactivated every shop
  // version's levels, so it is gone.
  const { data: live, error: liveErr } = await sb.from("sku_pack_versions").select("id")
    .eq("sku_id", args.skuId).is("location_id", null).eq("active", true).maybeSingle<{ id: string }>();
  if (liveErr) throw new Error(`replaceSkuPackChain live version: ${liveErr.message}`);
  const { data: saved, error: rpcErr } = await sb.rpc("save_sku_pack_version", {
    p_sku: args.skuId, p_location: null,
    p_levels: validated.map((l) => ({ label: l.label.trim(), containsQty: l.containsQty, containsIndex: l.containsIndex, containsMeasureUnit: l.containsIndex != null ? null : l.containsMeasureUnit!.trim() })),
    p_expected_live: live?.id ?? null, p_based_on: null, p_note: null, p_actor: actor.user.id,
    p_first_only: getRoleLevel(actor.user.role) < GLOBAL_VERSION_WRITE_MIN,
  });
  if (rpcErr) {
    if (rpcErr.message.includes("sku_pack_version:global_requires_moo")) throw new PackChainError(403, "global_requires_moo", "Only a Manager of Operations or higher can change this for everyone");
    if (rpcErr.message.includes("sku_pack_version:version_changed")) throw new PackChainError(409, "version_changed", "This pack changed since it was loaded — reload and re-apply");
    throw new Error(`replaceSkuPackChain save: ${rpcErr.message}`);
  }
  const rows = validated.map((l) => ({ label: l.label.trim() }));
  // The flat mirror was derived inside the RPC's locked transaction (Astra 2a r2#6).
  const flatFieldsSynced = (saved as { mirror_synced: boolean | null }).mirror_synced === true;

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "sku.pack_chain_update",
    resourceTable: "sku_pack_levels",
    resourceId: args.skuId,
    metadata: {
      sku_id: args.skuId,
      level_count: rows.length,
      labels: rows.map((r) => r.label),
      // THE SIGNAL A SWALLOWED FAILURE USED TO LACK. `false` means the chain is saved and
      // correct while the legacy flat mirror on vendor_items is stale — findable by a query
      // rather than only by noticing a wrong number months later.
      flat_fields_synced: flatFieldsSynced,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { levelCount: rows.length, flatFieldsSynced };
}
