/**
 * Manager physical-count data layer (pack hierarchy PR 2, migration 0160).
 * SERVER-ONLY, service-role client; authorization is APP-LAYER (AGM+ gate +
 * location-bind IDOR; the WRITE also requires Tier-A step-up, enforced at the
 * route per adjudication A4). Pure math lives in lib/counts-shared.ts.
 *
 * ── ANCHOR SEMANTIC (adversarial review #2, controller-adjudicated F1) ─────────
 *   EVENTS ARE SESSIONS; ANCHORS ARE PER-SKU (latest counted line wins); SPOT
 *   COUNTS ARE FIRST-CLASS. A count event is an immutable session — createCountEvent
 *   NEVER deactivates prior events (no location-wide supersede). Every event stays
 *   active. The anchor for a SKU is the most-recent count LINE for that SKU (by its
 *   event's counted_at) across ALL active events at the location. A spot count of
 *   ONE SKU therefore never strands any other SKU's anchor — each SKU's drift +
 *   variance window runs from that SKU's own anchor timestamp, independently.
 *
 * Juan's model — RECEIVING FEEDS, COUNTS VERIFY, THE DIFFERENCE IS VARIANCE:
 *   on-hand(sku) = anchor(sku) + received_since(sku) − consumed_since(sku)  (OZ, A3)
 *   anchor(sku)  = the summed resolved oz of the latest count LINE(s) for that SKU
 *   variance     = newest count(sku) − (prev count(sku) + received_between
 *                  − consumed_between), each window per that SKU's own anchors.
 *
 * COUNCIL LOCKS:
 *   L3  count lines persist resolved_oz at write; readers read stored oz.
 *   L4  count events are location-scoped rows; SKUs stay global.
 *   L5  ONE event per session (createCountEvent writes one event + its lines in
 *       one call); events are immutable sessions (NO supersede); disjoint-by-law
 *       lines; anchor = per-SKU oz snapshot; anchor age + retro-edit staleness
 *       surfaced (read-time).
 *   L8  shrinkage delta = variance, surfaced with a reason code.
 *
 * A3 SOURCES (oz-native, advisory-null; each window per-SKU from that SKU's anchor):
 *   received_since  = SUM(vendor_delivery_items.resolved_oz) for this SKU on
 *                     deliveries at this location dated after THAT SKU's anchor.
 *                     Legacy lines with NULL resolved_oz can't contribute → that
 *                     SKU's received term is advisory-null (never a fabricated #).
 *   consumed_since  = SUM(production_inputs.input_oz) for this SKU on LIVE
 *                     productions (superseded_at/revoked_at NULL) at this location
 *                     with produced_at after THAT SKU's anchor. A NULL input_oz row →
 *                     null-drift advisory for that SKU (production_inputs.input_oz
 *                     is NOT NULL in schema, but we stay defensive).
 *
 * Every UPDATE checks error AND rowcount (AGENTS.md silent-UPDATE law). Audited.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { loadMeasures, loadSkuPackChains } from "@/lib/prep-consumption";
import { type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";
import { buildPackChain, chainCountLeafMeasure, chainLeafUnitsFrom, type PackChainLevel } from "@/lib/pack-chain-shared";
import {
  resolveCountLinesDim,
  resolvePerSkuAnchors,
  resolvePerSkuUnitAnchors,
  reconcileAnchorDimensions,
  computeOnHand,
  computeOnHandUnits,
  computeVariance,
  computeUsedOrLost,
  computeInferredBaselineOz,
  chainLabelsInWalkOrder,
  etBusinessDate,
  isGapEligibleDate,
  salesWindowUntrustworthy,
  type CountLineInput,
  type OnHandResult,
  type OnHandUnitsResult,
} from "@/lib/counts-shared";

/** Trailing calendar window (days) for the inference bootstrap (spec D6, locked). */
const INFERRED_WINDOW_DAYS = 28;
/** Forward coverage (days) an inferred baseline represents (spec D6, locked). */
const INFERRED_COVERAGE_DAYS = 7;

export const COUNT_READ_MIN = 6; // AGM+
export const COUNT_WRITE_MIN = 6; // AGM+ (Tier-A step-up enforced at the route)

export class CountError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "CountError";
  }
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new CountError(403, "forbidden", "Insufficient role level for counts");
  }
}
function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

// ── Form data (SKUs + their chain labels for the level picker) ───────────────────
export interface CountSkuOption {
  id: string;
  name: string;
  chainLabels: string[];
  packFormat: string | null;
}
export interface CountFormData {
  skus: CountSkuOption[];
}

/** Load active SKUs + each one's root→leaf chain labels for the count level picker. */
export async function loadCountFormData(actor: AuthContext, locationId: string): Promise<CountFormData> {
  requireLevel(actor, COUNT_READ_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new CountError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: skus, error } = await sb.from("vendor_items").select("id, name, pack_format").eq("active", true).order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; pack_format: string | null }>>();
  if (error) throw new Error(`loadCountFormData skus: ${error.message}`);
  const list = skus ?? [];
  const chainsBySku = await loadSkuPackChains(list.map((s) => s.id));
  return {
    skus: list.map((s) => ({ id: s.id, name: s.name, packFormat: s.pack_format, chainLabels: chainLabelsInWalkOrder(chainsBySku.get(s.id) ?? []) })),
  };
}

// ── Load per-SKU RecipeInputSku shapes (chain-aware) for oz resolution ───────────
async function loadRecipeSkus(skuIds: string[]): Promise<Map<string, RecipeInputSku>> {
  if (skuIds.length === 0) return new Map();
  const sb = getServiceRoleClient();
  const { data } = await sb.from("vendor_items")
    .select("id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("id", skuIds)
    .returns<Array<{ id: string; pack_format: string | null; each_container_label: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  const chainsBySku = await loadSkuPackChains(skuIds);
  return new Map((data ?? []).map((s) => [s.id, {
    packFormat: s.pack_format, eachContainerLabel: s.each_container_label,
    unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure,
    avgOzPerEach: num(s.avg_oz_per_each), packChain: chainsBySku.get(s.id) ?? null,
  }]));
}

// ── Create a count event (AGM+; ONE event per call — council L5) ──────────────────
export interface CreateCountEventInput {
  locationId: string;
  note?: string | null;
  lines: CountLineInput[];
}

/**
 * Record one physical-count EVENT + its lines (council L5). Each line resolves oz
 * at write via the SKU pack chain (L3); an unresolvable line is REJECTED loudly (a
 * count line with no oz can't anchor — resolved_oz is NOT NULL). The event is an
 * IMMUTABLE SESSION: we NEVER supersede prior events (F1 — anchors are per-SKU, the
 * latest counted line for a SKU wins, so a spot count of one SKU must not strand
 * any other SKU's anchor). Append-only — never DELETE, never deactivate. Audited.
 */
export async function createCountEvent(actor: AuthContext, input: CreateCountEventInput): Promise<{ countEventId: string }> {
  requireLevel(actor, COUNT_WRITE_MIN);
  if (!lockLocationContext(actorLoc(actor), input.locationId)) throw new CountError(404, "not_found", "Location not found");
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new CountError(400, "no_lines", "At least one count line is required");
  for (const l of input.lines) {
    if (typeof l.skuId !== "string" || !l.skuId) throw new CountError(400, "invalid_sku", "Each line needs a SKU");
    if (typeof l.levelLabel !== "string" || !l.levelLabel.trim()) throw new CountError(400, "invalid_level", "Each line needs a level");
    // F3: count lines require a POSITIVE qty — a zero-qty line counts nothing and
    // must not anchor. The migration CHECK stays qty >= 0 for schema tolerance, but
    // the app is the authority for count semantics; a real count is always > 0.
    if (!Number.isFinite(l.qty) || l.qty <= 0) throw new CountError(400, "invalid_qty", "Quantity must be greater than zero");
    if (l.partialFraction != null && !(l.partialFraction > 0 && l.partialFraction <= 1)) {
      throw new CountError(400, "invalid_fraction", "Partial fraction must be between 0 and 1");
    }
  }

  const sb = getServiceRoleClient();
  const skuIds = [...new Set(input.lines.map((l) => l.skuId))];
  const { data: activeSkus } = await sb.from("vendor_items").select("id").in("id", skuIds).eq("active", true).returns<Array<{ id: string }>>();
  const activeSet = new Set((activeSkus ?? []).map((s) => s.id));
  for (const id of skuIds) if (!activeSet.has(id)) throw new CountError(400, "invalid_sku", "A SKU is not found or inactive");

  // Resolve every line to its ANCHOR DIMENSION at write (council L3 + PR-C LOCK 1):
  // a weight line persists resolved_oz; a count-terminated (packaging/cleaning/misc)
  // line persists resolved_units in LEAF units + resolved_oz NULL. Reject the whole
  // event if ANY line resolves to NEITHER space — a line with no anchor can't verify.
  const [measures, recipeSkus] = await Promise.all([loadMeasures(), loadRecipeSkus(skuIds)]);
  const resolution = resolveCountLinesDim(input.lines, recipeSkus, measures);
  if (!resolution.ok) {
    throw new CountError(400, "unresolvable_line", `Can't anchor "${resolution.badLine.levelLabel}" for a SKU — set the SKU's pack chain (a count leaf like "each" is enough for packaging) or its avg oz first`);
  }

  // F1: NO location-wide supersede. Events are immutable sessions; anchors are
  // resolved per-SKU at read time (latest counted line wins). A spot count of one
  // SKU must never deactivate an event that still carries other SKUs' anchors.

  // 1) insert the new event header (stays active forever, append-only).
  const { data: ev, error: evErr } = await sb.from("sku_count_events").insert({
    location_id: input.locationId, counted_by: actor.user.id, note: input.note?.trim() || null, active: true,
  }).select("id").maybeSingle<{ id: string }>();
  if (evErr) throw new Error(`createCountEvent header: ${evErr.message}`);
  if (!ev) throw new Error("createCountEvent returned no row");

  // 2) insert the resolved lines. Each carries its anchor_dimension + the matching
  //    space's value (weight → resolved_oz; count → resolved_units; the other NULL,
  //    per migration 0161's invariant CHECK).
  const { error: lErr } = await sb.from("sku_count_lines").insert(
    resolution.resolved.map((l) => ({
      count_event_id: ev.id, sku_id: l.skuId, level_label: l.levelLabel.trim(), qty: l.qty,
      is_loose: l.isLoose === true, partial_fraction: l.partialFraction ?? null,
      anchor_dimension: l.anchorDimension, resolved_oz: l.resolvedOz, resolved_units: l.resolvedUnits,
    })),
  );
  if (lErr) throw new Error(`createCountEvent lines: ${lErr.message}`);

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku_count.recorded", resourceTable: "sku_count_events", resourceId: ev.id,
    metadata: { location_id: input.locationId, line_count: resolution.resolved.length, sku_ids: skuIds },
    ipAddress: null, userAgent: null,
  });

  return { countEventId: ev.id };
}

// ── On-hand read (AGM+): anchor + drift + variance ───────────────────────────────
// PR-C: a row is either WEIGHT-anchored (oz drift + variance — the raw path,
// unchanged) or COUNT-anchored (leaf-unit on-hand + "used or lost since last count"
// — the packaging/cleaning/misc path). The `dimension` discriminator lets the UI
// render the right voice; a consumer can switch on it.
export interface OnHandWeightRow extends OnHandResult {
  dimension: "weight";
  skuName: string;
  /** Variance of THIS anchor vs the previous count + intervening ledger (L8). null
   *  = no prior count or a derive side missing (advisory). */
  varianceOz: number | null;
  /** F6 — read-side disjointness annotations for THIS SKU's anchor lines, so the
   *  full/loose/partial split is auditable. Non-mathematical (partial_fraction is
   *  already baked into resolved_oz): counts of lines flagged loose/partial. */
  looseLineCount: number;
  partialLineCount: number;
}
export interface OnHandCountRow extends OnHandUnitsResult {
  dimension: "count";
  skuName: string;
  /** The count-leaf measure label ("each") for unit labeling in the UI. */
  unitLabel: string;
  /** "Used or lost since last count" in leaf units (ADVISORY — never "variance"/
   *  "loss"; packaging has no consumption artifact to attribute a fault to). null =
   *  no prior count or the intake side can't derive. */
  usedOrLostUnits: number | null;
  looseLineCount: number;
  partialLineCount: number;
}
export type OnHandRow = OnHandWeightRow | OnHandCountRow;
export interface OnHandView {
  locationId: string;
  /** ISO of the MOST RECENT count event at this location (any SKU), null if none
   *  yet. Per-SKU anchor timestamps live on each row (anchorAt); this is only the
   *  location-level "last counted" header hint. */
  anchorAt: string | null;
  /** Drift spec 2026-07-31: the latest materialized sales business_date at this
   *  location — the consumed side's sales term is complete THROUGH this date
   *  (the ledger lags one day behind the register). Null = no ledger yet. */
  salesThrough: string | null;
  rows: OnHandRow[];
}

// ── Inference bootstrap (spec D6) ────────────────────────────────────────────────
/**
 * Trailing-28-day consumed oz per SKU at a location — the run-rate the inference
 * bootstrap projects (spec D6). Mirrors lib/receiving.ts `loadSkuUsageRank` and the
 * counts drift consumed term EXACTLY (the SAME two tables/columns the double-count
 * law sums), except the window is INFERRED_WINDOW_DAYS (28) not 30:
 *   production lane = SUM(production_inputs.input_oz) over LIVE productions
 *                     (superseded_at/revoked_at NULL) at this location, produced_at
 *                     in the last 28d (raw SKU depletes at production, BC-026 oz).
 *   sales lane      = SUM(toast_daily_depletion.direct_oz) at this location for
 *                     business_dates in the last 28d (ONLY the direct lane depletes
 *                     raw stock; flattened_oz is production-covered — NEVER summed).
 * Two grouped batch queries (loadRecipeGraph law — never per-SKU), returning per-SKU
 * lane totals so the writer can persist the lane breakdown in `basis`. A SKU absent
 * from both lanes is absent from the map (advisory-null — gets NO baseline).
 */
async function loadInferredConsumedOz(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  now: number,
): Promise<Map<string, { productionOz: number; directOz: number }>> {
  const lanes = new Map<string, { productionOz: number; directOz: number }>();
  const addProd = (skuId: string, oz: number) => {
    if (!Number.isFinite(oz) || oz <= 0) return;
    const e = lanes.get(skuId) ?? { productionOz: 0, directOz: 0 };
    e.productionOz += oz;
    lanes.set(skuId, e);
  };
  const addDirect = (skuId: string, oz: number) => {
    if (!Number.isFinite(oz) || oz <= 0) return;
    const e = lanes.get(skuId) ?? { productionOz: 0, directOz: 0 };
    e.directOz += oz;
    lanes.set(skuId, e);
  };

  // 28-day window. Productions compare on produced_at (timestamptz); the depletion
  // ledger compares on business_date (a bare date) — derive both from one instant.
  const cutoff = new Date(now - INFERRED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();
  const cutoffDate = cutoffIso.slice(0, 10); // YYYY-MM-DD for the business_date filter.

  // Production lane — live productions at this location in the window, then inputs.
  // WINDOW BOUNDARY: inclusive (.gte) on the cutoff instant so both lanes intend the
  // SAME calendar window — the sales lane filters business_date >= cutoffDate (a bare
  // date, inherently inclusive of that whole day), so production uses .gte(cutoffIso)
  // to match (a production exactly at the cutoff instant belongs to the 28-day window).
  const { data: prodHdrs, error: phErr } = await sb.from("productions")
    .select("id")
    .eq("location_id", locationId)
    .is("superseded_at", null).is("revoked_at", null)
    .gte("produced_at", cutoffIso)
    .returns<Array<{ id: string }>>();
  if (phErr) throw new Error(`loadInferredConsumedOz productions: ${phErr.message}`);
  const prodIds = (prodHdrs ?? []).map((h) => h.id);
  if (prodIds.length > 0) {
    const { data: inputs, error: piErr } = await sb.from("production_inputs")
      .select("input_sku_id, input_oz")
      .in("production_id", prodIds)
      .returns<Array<{ input_sku_id: string; input_oz: number | string | null }>>();
    if (piErr) throw new Error(`loadInferredConsumedOz production_inputs: ${piErr.message}`);
    for (const r of inputs ?? []) addProd(r.input_sku_id, num(r.input_oz) ?? 0);
  }

  // Sales direct lane — the materialized depletion ledger over the window (0166).
  const { data: sales, error: sErr } = await sb.from("toast_daily_depletion")
    .select("sku_id, direct_oz")
    .eq("location_id", locationId)
    .gte("business_date", cutoffDate)
    .returns<Array<{ sku_id: string; direct_oz: number | string }>>();
  if (sErr) throw new Error(`loadInferredConsumedOz toast_daily_depletion: ${sErr.message}`);
  for (const r of sales ?? []) addDirect(r.sku_id, num(r.direct_oz) ?? 0);

  return lanes;
}

/**
 * INFERRED ON-HAND ROWS (spec D6). For active SKUs at this location that have NO
 * census anchor (`censusSkuIds` — passed so an inferred baseline NEVER shadows a
 * counted SKU) but real consumption history, surface a cold-start baseline:
 *   1. batch-load any pre-existing sku_inferred_baselines for this location;
 *   2. for SKUs missing a baseline, compute the two 28d consumption lanes
 *      (loadInferredConsumedOz) and, for each with positive total consumed oz,
 *      compute the baseline (computeInferredBaselineOz) and INSERT it upsert-
 *      ignoreDuplicates — computed ONCE, race-safe, never regenerated (D6);
 *   3. anchor each baseline SKU at inferred_oz / computed_at (anchorSource
 *      "inferred") and accrue received/consumed-since from that anchor EXACTLY like
 *      a census weight row (same ledger helpers, same gap-taint) — the drift math is
 *      source-blind. varianceOz is ALWAYS null (an inferred baseline is not a counted
 *      ground truth — it can never be a variance reference; VARIANCE IS CENSUS-ONLY).
 *
 * MERGE-IN-MEMORY (D6 controller note): for a SKU whose baseline we just computed,
 * we use the in-memory inferred_oz + anchorAt = now(ISO) directly rather than
 * re-reading the row we wrote. The persisted row only matters for FUTURE loads;
 * ignoreDuplicates makes the insert race-safe (a concurrent request that wrote first
 * wins — the compute is deterministic over the same window, so any winner is fine).
 * Pre-existing baselines anchor at their stored computed_at.
 */
async function loadInferredRows(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  censusSkuIds: ReadonlySet<string>,
  now: number,
): Promise<OnHandRow[]> {
  // Active SKU roster (global; the item spine is location-scoped via deliveries, not
  // the vendor_items row) minus any SKU already carrying a census anchor.
  const { data: activeSkus, error: aErr } = await sb.from("vendor_items")
    .select("id, name")
    .eq("active", true)
    .returns<Array<{ id: string; name: string }>>();
  if (aErr) throw new Error(`loadInferredRows active skus: ${aErr.message}`);
  const roster = (activeSkus ?? []).filter((s) => !censusSkuIds.has(s.id));
  if (roster.length === 0) return [];
  const skuName = new Map(roster.map((s) => [s.id, s.name]));
  const rosterIds = roster.map((s) => s.id);

  // (a) Pre-existing baselines for this location (batch).
  const { data: existing, error: bErr } = await sb.from("sku_inferred_baselines")
    .select("sku_id, inferred_oz, computed_at")
    .eq("location_id", locationId)
    .in("sku_id", rosterIds)
    .returns<Array<{ sku_id: string; inferred_oz: number | string; computed_at: string }>>();
  if (bErr) throw new Error(`loadInferredRows baselines: ${bErr.message}`);
  const baselineBySku = new Map<string, { inferredOz: number; anchorAt: string }>();
  for (const r of existing ?? []) {
    const oz = num(r.inferred_oz);
    if (oz == null) continue; // defensive — column is NOT NULL, but never fabricate.
    baselineBySku.set(r.sku_id, { inferredOz: oz, anchorAt: r.computed_at });
  }

  // (b) For SKUs missing a baseline, compute lanes over 28d and lazily persist a
  //     baseline for each with positive consumption. Zero-consumption SKUs get NO
  //     row (advisory-null). Computed once (upsert ignoreDuplicates); merge in memory.
  const needsBaseline = rosterIds.filter((id) => !baselineBySku.has(id));
  if (needsBaseline.length > 0) {
    const lanes = await loadInferredConsumedOz(sb, locationId, now);
    const nowIso = new Date(now).toISOString();
    const toInsert: Array<{
      location_id: string;
      sku_id: string;
      inferred_oz: number;
      basis: Record<string, unknown>;
    }> = [];
    for (const id of needsBaseline) {
      const lane = lanes.get(id);
      if (!lane) continue; // no consumption in the window → no baseline (advisory-null).
      const total = lane.productionOz + lane.directOz;
      const baseline = computeInferredBaselineOz(total, INFERRED_WINDOW_DAYS, INFERRED_COVERAGE_DAYS);
      if (baseline == null) continue; // total <= 0 / non-finite → no baseline.
      baselineBySku.set(id, { inferredOz: baseline.inferredOz, anchorAt: nowIso });
      toInsert.push({
        location_id: locationId,
        sku_id: id,
        inferred_oz: baseline.inferredOz,
        basis: {
          method: "consumption_runrate",
          window_days: INFERRED_WINDOW_DAYS,
          coverage_days: INFERRED_COVERAGE_DAYS,
          daily_avg_oz: baseline.dailyAvgOz,
          lanes: { production_oz: lane.productionOz, direct_oz: lane.directOz },
        },
      });
    }
    if (toInsert.length > 0) {
      // Computed ONCE, race-safe: a concurrent loader that wrote first keeps its row;
      // ignoreDuplicates makes our insert a no-op there. We keep our in-memory values
      // for THIS render (they only matter for future loads — see the merge note).
      const { error: insErr } = await sb.from("sku_inferred_baselines")
        .upsert(toInsert, { onConflict: "location_id,sku_id", ignoreDuplicates: true });
      if (insErr) throw new Error(`loadInferredRows persist baselines: ${insErr.message}`);
    }
  }

  const inferredIds = [...baselineBySku.keys()];
  if (inferredIds.length === 0) return [];

  // Sales-coverage gap dates for the inferred anchors' earliest window start — loaded
  // ONCE (not per SKU), same taint discipline as the census path.
  const earliestSalesDate = inferredIds
    .map((id) => etBusinessDate(baselineBySku.get(id)!.anchorAt))
    .reduce((min, d) => (d < min ? d : min));
  const gapDates = await loadSalesGapDates(
    sb, locationId, earliestSalesDate, etBusinessDate(new Date(now).toISOString()),
  );

  // BATCHED (mirrors the census path's array-taking calls): the since-helpers all take
  // a full skuIds array + one anchorAt, and detectRetroEditStaleness is location+time
  // scoped (identical for every SKU sharing an anchorAt). Group inferred SKUs by their
  // EXACT anchorAt, then make ONE call per since-helper per group and ONE staleness
  // probe per distinct anchorAt — N×4 per-SKU queries collapse to 4 per anchor-group.
  // Day-one cold start = every SKU anchored at now() → a SINGLE group.
  const idsByAnchorAt = new Map<string, string[]>();
  for (const id of inferredIds) {
    const at = baselineBySku.get(id)!.anchorAt;
    let group = idsByAnchorAt.get(at);
    if (!group) { group = []; idsByAnchorAt.set(at, group); }
    group.push(id);
  }

  const rowGroups = await Promise.all(
    [...idsByAnchorAt.entries()].map(async ([anchorAt, groupIds]): Promise<OnHandRow[]> => {
      const [receivedSince, consumedSince, salesSince, anchorStale] = await Promise.all([
        sumReceivedOzSince(sb, groupIds, locationId, anchorAt),
        sumConsumedOzSince(sb, groupIds, locationId, anchorAt),
        sumSalesDirectOzSince(sb, groupIds, locationId, anchorAt, gapDates),
        detectRetroEditStaleness(sb, locationId, anchorAt, now),
      ]);
      // Build a weight row per SKU in the group: anchor + received-since − consumed-since,
      // accrued from computed_at exactly like a census weight row (drift is source-blind).
      return groupIds.map((skuId): OnHandRow => {
        const b = baselineBySku.get(skuId)!;
        const prodSince = consumedSince.get(skuId) ?? null;
        const salesSinceOz = salesSince.get(skuId) ?? null;
        const onHand = computeOnHand(
          {
            skuId,
            anchorOz: b.inferredOz,
            anchorAt: b.anchorAt,
            receivedSinceOz: receivedSince.get(skuId) ?? null,
            consumedSinceOz: prodSince == null || salesSinceOz == null ? null : prodSince + salesSinceOz,
            anchorStale,
            anchorSource: "inferred", // DISPLAY provenance — never touches the math.
          },
          now,
        );
        return {
          dimension: "weight",
          ...onHand,
          skuName: skuName.get(skuId) ?? "(sku)",
          // VARIANCE IS CENSUS-ONLY (D6): an inferred baseline is not a counted ground
          // truth, so it can never be a variance reference. Always null here. We do NOT
          // call computeVariance for inferred rows.
          varianceOz: null,
          looseLineCount: 0,
          partialLineCount: 0,
        };
      });
    }),
  );
  return rowGroups.flat();
}

/**
 * PAR-ESTIMATE ON-HAND ROWS (spec D6 — the middle truth tier, census > par_estimate
 * > inferred). For active SKUs at this location that have NO census anchor
 * (`censusSkuIds` — passed so a par-pass estimate NEVER shadows a counted SKU) but a
 * par-pass line carrying a non-null `implied_on_hand_oz` (par − order_qty, oz — the
 * shelf-walk soft snapshot), surface a par_estimate baseline:
 *   1. batch-load the LATEST par_pass_lines row per roster SKU (by created_at) whose
 *      implied_on_hand_oz is non-null, SCOPED TO THIS LOCATION through par_pass_events
 *      (two-step: submitted events at this location → lines in those events; house law
 *      — embedded-select .eq() on a relation is fragile under RLS). The sku_ix
 *      (sku_id, created_at desc) serves the latest-per-SKU pick.
 *   2. anchor each such SKU at implied_on_hand_oz / line.created_at (anchorSource
 *      "par_estimate") and accrue received/consumed-since from that anchor EXACTLY like
 *      a census weight row (same ledger helpers, same anchor-group batching, same
 *      gap-taint) — the drift math is source-blind. varianceOz is ALWAYS null (a
 *      par-pass estimate is not a counted ground truth — it can never be a variance
 *      reference; VARIANCE IS CENSUS-ONLY).
 *
 * Patterned on loadInferredRows: batch-load the anchors, group SKUs by their EXACT
 * anchorAt, then ONE call per since-helper per anchor-group (N×4 per-SKU queries
 * collapse to 4 per group). Persists NOTHING (the par-pass event already stored the
 * line — this is a derive-on-read tier).
 */
async function loadParEstimateRows(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  censusSkuIds: ReadonlySet<string>,
  now: number,
): Promise<{ rows: OnHandRow[]; skuIds: string[] }> {
  // Active SKU roster (global; the item spine is location-scoped via the ledgers, not
  // the vendor_items row) minus any SKU already carrying a census anchor.
  const { data: activeSkus, error: aErr } = await sb.from("vendor_items")
    .select("id, name")
    .eq("active", true)
    .returns<Array<{ id: string; name: string }>>();
  if (aErr) throw new Error(`loadParEstimateRows active skus: ${aErr.message}`);
  const roster = (activeSkus ?? []).filter((s) => !censusSkuIds.has(s.id));
  if (roster.length === 0) return { rows: [], skuIds: [] };
  const skuName = new Map(roster.map((s) => [s.id, s.name]));
  const rosterIds = roster.map((s) => s.id);

  // (a) Location-scoped par-pass event ids (two-step — NOT an embedded .eq() on the
  //     lines→events relation, which is RLS-fragile per house law). Submitted events
  //     only (a draft walk is not a truth anchor).
  const { data: evRows, error: evErr } = await sb.from("par_pass_events")
    .select("id")
    .eq("location_id", locationId)
    .eq("status", "submitted")
    .returns<Array<{ id: string }>>();
  if (evErr) throw new Error(`loadParEstimateRows events: ${evErr.message}`);
  const eventIds = (evRows ?? []).map((e) => e.id);
  if (eventIds.length === 0) return { rows: [], skuIds: [] };

  // (b) Latest par_pass line per roster SKU with a non-null implied_on_hand_oz, among
  //     those events. Ordered created_at desc (the sku_ix) → first seen per SKU wins.
  const { data: lineRows, error: lErr } = await sb.from("par_pass_lines")
    .select("sku_id, implied_on_hand_oz, created_at")
    .in("event_id", eventIds)
    .in("sku_id", rosterIds)
    .not("implied_on_hand_oz", "is", null)
    .order("created_at", { ascending: false })
    .returns<Array<{ sku_id: string; implied_on_hand_oz: number | string | null; created_at: string }>>();
  if (lErr) throw new Error(`loadParEstimateRows lines: ${lErr.message}`);
  const anchorBySku = new Map<string, { impliedOz: number; anchorAt: string }>();
  for (const r of lineRows ?? []) {
    if (anchorBySku.has(r.sku_id)) continue; // desc order → first seen is the latest.
    const oz = num(r.implied_on_hand_oz);
    if (oz == null) continue; // defensive — filtered above, but never fabricate.
    anchorBySku.set(r.sku_id, { impliedOz: oz, anchorAt: r.created_at });
  }
  const parSkuIds = [...anchorBySku.keys()];
  if (parSkuIds.length === 0) return { rows: [], skuIds: [] };

  // Sales-coverage gap dates for the earliest par-estimate window start — loaded ONCE
  // (not per SKU), same taint discipline as the census + inferred paths.
  const earliestSalesDate = parSkuIds
    .map((id) => etBusinessDate(anchorBySku.get(id)!.anchorAt))
    .reduce((min, d) => (d < min ? d : min));
  const gapDates = await loadSalesGapDates(
    sb, locationId, earliestSalesDate, etBusinessDate(new Date(now).toISOString()),
  );

  // BATCHED (mirrors loadInferredRows): group par-estimate SKUs by their EXACT anchorAt,
  // then make ONE call per since-helper per group + ONE staleness probe per distinct
  // anchorAt. A single walk = every SKU anchored at that event's line created_at → one group.
  const idsByAnchorAt = new Map<string, string[]>();
  for (const id of parSkuIds) {
    const at = anchorBySku.get(id)!.anchorAt;
    let group = idsByAnchorAt.get(at);
    if (!group) { group = []; idsByAnchorAt.set(at, group); }
    group.push(id);
  }

  const rowGroups = await Promise.all(
    [...idsByAnchorAt.entries()].map(async ([anchorAt, groupIds]): Promise<OnHandRow[]> => {
      const [receivedSince, consumedSince, salesSince, anchorStale] = await Promise.all([
        sumReceivedOzSince(sb, groupIds, locationId, anchorAt),
        sumConsumedOzSince(sb, groupIds, locationId, anchorAt),
        sumSalesDirectOzSince(sb, groupIds, locationId, anchorAt, gapDates),
        detectRetroEditStaleness(sb, locationId, anchorAt, now),
      ]);
      // Build a weight row per SKU: anchor + received-since − consumed-since, accrued
      // from the par-pass line's created_at exactly like a census weight row (source-blind).
      return groupIds.map((skuId): OnHandRow => {
        const b = anchorBySku.get(skuId)!;
        const prodSince = consumedSince.get(skuId) ?? null;
        const salesSinceOz = salesSince.get(skuId) ?? null;
        const onHand = computeOnHand(
          {
            skuId,
            anchorOz: b.impliedOz,
            anchorAt: b.anchorAt,
            receivedSinceOz: receivedSince.get(skuId) ?? null,
            consumedSinceOz: prodSince == null || salesSinceOz == null ? null : prodSince + salesSinceOz,
            anchorStale,
            anchorSource: "par_estimate", // DISPLAY provenance — never touches the math.
          },
          now,
        );
        return {
          dimension: "weight",
          ...onHand,
          skuName: skuName.get(skuId) ?? "(sku)",
          // VARIANCE IS CENSUS-ONLY (D6): a par-pass estimate is not a counted ground
          // truth, so it can never be a variance reference. Always null here. We do NOT
          // call computeVariance for par_estimate rows.
          varianceOz: null,
          looseLineCount: 0,
          partialLineCount: 0,
        };
      });
    }),
  );
  return { rows: rowGroups.flat(), skuIds: parSkuIds };
}

/**
 * Load the on-hand panel for a location with PER-SKU anchors (F1). Events are
 * immutable sessions; there is no single "anchor event". For each SKU:
 *   - its ANCHOR is the summed resolved oz of the lines from the most-recent event
 *     (by counted_at) that counted that SKU; the anchor timestamp is THAT event's
 *     counted_at (so a spot count of one SKU never moves another SKU's window);
 *   - its PREV is the summed oz from the next-most-recent event that counted it;
 *   - drift = received-since − consumed-since IN OZ from THAT SKU's anchor (A3);
 *   - variance = newCount − (prevCount + received_between − consumed_between) via
 *     the pure computeVariance (F2): a SKU never previously counted → prevCountOz
 *     null → variance null (advisory "first count"), NEVER 0.
 * Retro-edit staleness (a backdated delivery landing after a SKU's anchor) flags
 * that SKU stale. SKUs with NO census anchor but real consumption history get an
 * INFERRED baseline row (spec D6, anchorSource "inferred") — see loadInferredRows.
 */
export async function loadOnHand(actor: AuthContext, locationId: string, now: number = Date.now()): Promise<OnHandView> {
  requireLevel(actor, COUNT_READ_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new CountError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const salesThrough = await salesLedgerThrough(sb, locationId);

  // ALL active count events at this location, newest first — every event is a live
  // session (F1: no supersede). We resolve each SKU's anchor across all of them.
  const { data: events } = await sb.from("sku_count_events")
    .select("id, counted_at")
    .eq("location_id", locationId)
    .eq("active", true)
    .order("counted_at", { ascending: false })
    .returns<Array<{ id: string; counted_at: string }>>();
  const evList = events ?? [];
  if (evList.length === 0) {
    // COLD START (spec D6): no physical count has EVER anchored this location. Still
    // surface soft baselines so the panel isn't empty on day one — par_estimate first
    // (the shelf-walk snapshot, firmer than a run-rate guess), then inferred for the
    // rest. No census SKUs → both tiers see the full active roster; inference EXCLUDES
    // whatever par_estimate already anchored.
    const parEstimate = await loadParEstimateRows(sb, locationId, new Set<string>(), now);
    const inferredRows = await loadInferredRows(sb, locationId, new Set(parEstimate.skuIds), now);
    const rows = [...parEstimate.rows, ...inferredRows].sort((a, b) => a.skuName.localeCompare(b.skuName));
    return { locationId, anchorAt: null, salesThrough, rows };
  }
  const eventAt = new Map(evList.map((e) => [e.id, e.counted_at]));
  const locationLastCountedAt = evList[0]!.counted_at; // header hint only.

  // ALL lines across those active events, each tagged with its event's counted_at.
  // PR-C: read anchor_dimension + resolved_units to partition weight vs count rows.
  const eventIds = evList.map((e) => e.id);
  const { data: allLines } = await sb.from("sku_count_lines")
    .select("count_event_id, sku_id, anchor_dimension, resolved_oz, resolved_units, is_loose, partial_fraction")
    .in("count_event_id", eventIds)
    .returns<Array<{ count_event_id: string; sku_id: string; anchor_dimension: "weight" | "count" | null; resolved_oz: number | string | null; resolved_units: number | string | null; is_loose: boolean; partial_fraction: number | string | null }>>();
  const lines = allLines ?? [];
  // Legacy rows (anchor_dimension NULL) read as weight-anchored (0161 rationale).
  const isWeight = (d: "weight" | "count" | null): boolean => d !== "count";

  // F1: per-SKU anchor resolution PER DIMENSION. Weight lines → oz anchor; count
  // lines → leaf-unit anchor. A SKU's chain determines its dimension at write —
  // but a chain edit ACROSS dimensions between counts leaves historical lines in
  // BOTH spaces, so the maps are reconciled below (latest anchor wins; one row
  // per SKU, never two).
  const anchorBySku = resolvePerSkuAnchors(
    lines.filter((l) => isWeight(l.anchor_dimension)).map((l) => ({
      countEventId: l.count_event_id,
      eventCountedAt: eventAt.get(l.count_event_id) ?? "",
      skuId: l.sku_id,
      resolvedOz: num(l.resolved_oz) ?? 0,
      isLoose: l.is_loose,
      partialFraction: num(l.partial_fraction),
    })),
  );
  const unitAnchorBySku = resolvePerSkuUnitAnchors(
    lines.filter((l) => l.anchor_dimension === "count").map((l) => ({
      countEventId: l.count_event_id,
      eventCountedAt: eventAt.get(l.count_event_id) ?? "",
      skuId: l.sku_id,
      resolvedUnits: num(l.resolved_units) ?? 0,
      isLoose: l.is_loose,
      partialFraction: num(l.partial_fraction),
    })),
  );

  // DIMENSION-FLIP reconciliation (adversarial review HIGH): a SKU present in
  // both maps keeps only its most recent anchor's dimension.
  reconcileAnchorDimensions(anchorBySku, unitAnchorBySku);

  const weightSkuIds = [...anchorBySku.keys()];
  const countSkuIds = [...unitAnchorBySku.keys()];
  const skuIds = [...new Set([...weightSkuIds, ...countSkuIds])];
  if (skuIds.length === 0) {
    // Events exist but resolved to no anchors (edge) — still run the par_estimate then
    // inference tiers (par_estimate first; inference excludes what it anchored).
    const parEstimate = await loadParEstimateRows(sb, locationId, new Set<string>(), now);
    const inferredRows = await loadInferredRows(sb, locationId, new Set(parEstimate.skuIds), now);
    const rows = [...parEstimate.rows, ...inferredRows].sort((a, b) => a.skuName.localeCompare(b.skuName));
    return { locationId, anchorAt: locationLastCountedAt, salesThrough, rows };
  }

  // SKU names + chains (count rows derive received-units read-time from the chain).
  const [{ data: skuRows }, chainsBySku, measures] = await Promise.all([
    sb.from("vendor_items").select("id, name").in("id", skuIds).returns<Array<{ id: string; name: string }>>(),
    loadSkuPackChains(countSkuIds),
    loadMeasures(),
  ]);
  const skuName = new Map((skuRows ?? []).map((s) => [s.id, s.name]));

  // Sales-coverage gap dates (hardening 2026-07-31): loaded ONCE for the whole
  // location from the earliest weight-SKU window start, then membership-tested
  // in memory per SKU — no per-SKU query. Empty set when no weight SKUs / no
  // ledger. `prevAt ?? anchorAt` picks the earliest date any window reaches.
  const earliestSalesDate = weightSkuIds.length
    ? weightSkuIds
        .map((id) => etBusinessDate(anchorBySku.get(id)!.prevAt ?? anchorBySku.get(id)!.anchorAt))
        .reduce((min, d) => (d < min ? d : min))
    : null;
  const gapDates = earliestSalesDate
    ? await loadSalesGapDates(sb, locationId, earliestSalesDate, etBusinessDate(new Date(now).toISOString()))
    : new Set<string>();

  // ── Weight rows (oz drift + variance) ──
  // BATCHED (council audit 2026-08-08 P1-3; same group idiom as the par_estimate +
  // inferred tiers above): census SKUs group by their EXACT (anchorAt, prevAt)
  // window pair → ONE call per ledger helper per group, instead of the full helper
  // fan-out per SKU (~10-12 queries × the whole roster on the first physical
  // count). A single walk anchors most SKUs at one event → 1-2 groups in practice.
  // Staleness probes are per-anchorAt (identical for every SKU sharing one) —
  // memoized here and shared with the count tier below.
  const stalenessByAnchorAt = new Map<string, Promise<boolean>>();
  const stalenessFor = (anchorAt: string): Promise<boolean> => {
    let p = stalenessByAnchorAt.get(anchorAt);
    if (!p) {
      p = detectRetroEditStaleness(sb, locationId, anchorAt, now);
      stalenessByAnchorAt.set(anchorAt, p);
    }
    return p;
  };

  const weightGroups = new Map<string, { anchorAt: string; prevAt: string | null; ids: string[] }>();
  for (const skuId of weightSkuIds) {
    const a = anchorBySku.get(skuId)!;
    const key = `${a.anchorAt}|${a.prevAt ?? ""}`;
    let g = weightGroups.get(key);
    if (!g) { g = { anchorAt: a.anchorAt, prevAt: a.prevAt, ids: [] }; weightGroups.set(key, g); }
    g.ids.push(skuId);
  }

  const weightRowGroups = await Promise.all(
    [...weightGroups.values()].map(async ({ anchorAt, prevAt, ids }): Promise<OnHandRow[]> => {
      const [receivedSince, consumedSince, salesSince, anchorStale, between] = await Promise.all([
        sumReceivedOzSince(sb, ids, locationId, anchorAt),
        sumConsumedOzSince(sb, ids, locationId, anchorAt),
        sumSalesDirectOzSince(sb, ids, locationId, anchorAt, gapDates),
        stalenessFor(anchorAt),
        prevAt == null
          ? Promise.resolve(null)
          : Promise.all([
              sumReceivedOzBetween(sb, ids, locationId, prevAt, anchorAt),
              sumConsumedOzBetween(sb, ids, locationId, prevAt, anchorAt),
              sumSalesDirectOzBetween(sb, ids, locationId, prevAt, anchorAt, gapDates),
            ]),
      ]);
      return ids.map((skuId): OnHandRow => {
        const a = anchorBySku.get(skuId)!;
        // Drift spec 2026-07-31: consumed = prep production + DIRECT sales lane.
        // BOTH terms may null-taint now (production when it can't derive; sales
        // when its window has a materialization gap or collapsed — hardening
        // 2026-07-31). Either null → consumed null → drift advisory. Honest-null.
        const prodSince = consumedSince.get(skuId) ?? null;
        const salesSinceOz = salesSince.get(skuId) ?? null;
        const onHand = computeOnHand(
          {
            skuId,
            anchorOz: a.anchorOz,
            anchorAt: a.anchorAt,
            receivedSinceOz: receivedSince.get(skuId) ?? null,
            consumedSinceOz: prodSince == null || salesSinceOz == null ? null : prodSince + salesSinceOz,
            anchorStale,
            // CENSUS provenance: this row's anchor is a real physical count event
            // (anchorBySku is resolved from sku_count_lines). Par_estimate AND inferred
            // anchors are composed in SEPARATE passes below and never reach this variance
            // loop — only census rows do.
            anchorSource: "census",
          },
          now,
        );
        let receivedBetweenOz: number | null = null;
        let consumedBetweenOz: number | null = null;
        if (between != null) {
          const [rB, cB, sB] = between;
          receivedBetweenOz = rB.get(skuId) ?? null;
          const prodBetween = cB.get(skuId) ?? null;
          const salesBetween = sB.get(skuId) ?? null;
          consumedBetweenOz = prodBetween == null || salesBetween == null ? null : prodBetween + salesBetween;
        }
        // VARIANCE IS CENSUS-ONLY (spec D6, LOAD-BEARING). computeVariance verifies a
        // NEW physical count against the PREVIOUS one + intervening ledger. Both
        // newCountOz and prevCountOz here come from `a` (anchorBySku → resolved
        // strictly from sku_count_lines), so this call NEVER receives a par_estimate OR
        // an inferred anchor. Par_estimate rows (loadParEstimateRows) and inferred rows
        // (loadInferredRows) BOTH carry varianceOz = null by law — a par-pass estimate
        // and a run-rate baseline are not counted ground truths and cannot be a variance
        // reference. Do NOT wire either non-census anchor into this call.
        const variance = computeVariance({
          skuId,
          newCountOz: a.anchorOz,
          prevCountOz: a.prevOz,
          receivedBetweenOz,
          consumedBetweenOz,
        });
        return {
          dimension: "weight",
          ...onHand,
          skuName: skuName.get(skuId) ?? "(sku)",
          varianceOz: variance.varianceOz,
          looseLineCount: a.looseLineCount,
          partialLineCount: a.partialLineCount,
        };
      });
    }),
  );
  const weightRows: OnHandRow[] = weightRowGroups.flat();

  // ── Count rows (leaf-unit on-hand + "used or lost since last count") ──
  // received-units derive READ-TIME from level-aware receiving: received_qty_at_level
  // × chain multipliers to the leaf. No consumption term (packaging has no ledger).
  const countRows: OnHandRow[] = await Promise.all(
    countSkuIds.map(async (skuId): Promise<OnHandRow> => {
      const a = unitAnchorBySku.get(skuId)!;
      const chain = chainsBySku.get(skuId) ?? null;
      const unitLabel = chain ? (chainCountLeafMeasure(buildPackChain(chain), measures) ?? "units") : "units";
      const [receivedSince, anchorStale] = await Promise.all([
        sumReceivedUnitsSince(sb, skuId, locationId, a.anchorAt, chain),
        stalenessFor(a.anchorAt), // memoized — shared with the weight tier's probes.
      ]);
      const onHand = computeOnHandUnits(
        { skuId, anchorUnits: a.anchorUnits, anchorAt: a.anchorAt, receivedUnitsSince: receivedSince, anchorStale },
        now,
      );
      let receivedBetweenUnits: number | null = null;
      if (a.prevAt != null) {
        receivedBetweenUnits = await sumReceivedUnitsBetween(sb, skuId, locationId, a.prevAt, a.anchorAt, chain);
      }
      const usedOrLost = computeUsedOrLost({
        skuId,
        newCountUnits: a.anchorUnits,
        prevCountUnits: a.prevUnits,
        receivedBetweenUnits,
      });
      return {
        dimension: "count",
        ...onHand,
        skuName: skuName.get(skuId) ?? "(sku)",
        unitLabel,
        usedOrLostUnits: usedOrLost.usedOrLostUnits,
        looseLineCount: a.looseLineCount,
        partialLineCount: a.partialLineCount,
      };
    }),
  );

  // ── Par-estimate rows (spec D6, middle tier) ── for active SKUs with NO census
  // anchor (weight or count) but a par-pass line's implied on-hand: a soft shelf-walk
  // snapshot. `skuIds` is every census-anchored SKU this pass — pass it so a par
  // estimate NEVER shadows a counted SKU.
  const parEstimate = await loadParEstimateRows(sb, locationId, new Set(skuIds), now);

  // ── Inferred rows (spec D6, cold-start tier) ── for active SKUs with NEITHER a census
  // anchor NOR a par_estimate anchor but real consumption history. Exclude BOTH sets so
  // inference never shadows a counted OR par-pass-estimated SKU (census > par_estimate >
  // inferred precedence).
  const inferredExcluded = new Set([...skuIds, ...parEstimate.skuIds]);
  const inferredRows = await loadInferredRows(sb, locationId, inferredExcluded, now);

  const rows = [...weightRows, ...countRows, ...parEstimate.rows, ...inferredRows].sort((a, b) => a.skuName.localeCompare(b.skuName));
  return { locationId, anchorAt: locationLastCountedAt, salesThrough, rows };
}

// ── Ledger oz aggregations (A3, oz-native, advisory-null) ─────────────────────────
/**
 * Deliveries at this location whose write instant (vendor_deliveries.created_at)
 * falls in the drift window — F4: bound the id set by the SAME window the line sum
 * uses (created_at > anchor, <= until when set) rather than pulling the location's
 * entire delivery history into the .in() clause. Cheaper + tighter (a huge legacy
 * history no longer bloats the id list); correctness is unchanged because the line
 * sum re-filters on the item created_at anyway.
 */
async function locationDeliveryIds(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  afterIso: string,
  untilIso: string | null,
): Promise<string[]> {
  let q = sb.from("vendor_deliveries").select("id").eq("location_id", locationId).gt("created_at", afterIso);
  if (untilIso != null) q = q.lte("created_at", untilIso);
  const { data } = await q.returns<Array<{ id: string }>>();
  return (data ?? []).map((d) => d.id);
}

/**
 * Received oz for each SKU on deliveries at this location dated STRICTLY AFTER the
 * anchor. Uses vendor_delivery_items.resolved_oz (the persisted oz-at-write, L3).
 * A SKU with ANY NULL resolved_oz among its in-window lines → null (advisory:
 * can't derive a clean received term). No in-window lines at all → 0.
 */
async function sumReceivedOzSince(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
  locationId: string,
  afterIso: string,
): Promise<Map<string, number | null>> {
  return sumReceivedOzWindow(sb, skuIds, locationId, afterIso, null);
}
async function sumReceivedOzBetween(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
  locationId: string,
  afterIso: string,
  untilIso: string,
): Promise<Map<string, number | null>> {
  return sumReceivedOzWindow(sb, skuIds, locationId, afterIso, untilIso);
}
async function sumReceivedOzWindow(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
  locationId: string,
  afterIso: string,
  untilIso: string | null,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const id of skuIds) out.set(id, 0);
  const deliveryIds = await locationDeliveryIds(sb, locationId, afterIso, untilIso);
  if (deliveryIds.length === 0) return out;
  // vendor_delivery_items has created_at; use it as the receipt timestamp (the
  // delivery_date is a bare date, created_at is the true write instant that the
  // anchor timestamp is comparable to).
  let q = sb.from("vendor_delivery_items")
    .select("vendor_item_id, resolved_oz, created_at")
    .in("vendor_item_id", skuIds)
    .in("delivery_id", deliveryIds)
    .gt("created_at", afterIso);
  if (untilIso != null) q = q.lte("created_at", untilIso);
  const { data } = await q.returns<Array<{ vendor_item_id: string; resolved_oz: number | string | null; created_at: string }>>();
  // Sum resolved oz per SKU; a SKU with ANY NULL resolved_oz in-window line →
  // advisory null (can't derive a clean received term). Tracked separately so a
  // null line taints the whole SKU regardless of row order.
  const sums = new Map<string, number>();
  const nulled = new Set<string>();
  for (const r of data ?? []) {
    const oz = num(r.resolved_oz);
    if (oz == null) { nulled.add(r.vendor_item_id); continue; }
    sums.set(r.vendor_item_id, (sums.get(r.vendor_item_id) ?? 0) + oz);
  }
  for (const [id, s] of sums) out.set(id, s);
  for (const id of nulled) out.set(id, null); // taint wins over any partial sum.
  return out;
}

// ── Count-space received-units (PR-C): derive LEAF units from level-aware receiving ─
// For a count-anchored SKU, on-hand needs "how many leaf units arrived since the
// anchor". We derive it READ-TIME from the receiving line's entered level + qty:
//   line_units = received_qty_at_level × chainLeafUnitsFrom(chain, received_level_label)
// A line with no level label, no qty-at-level, or an unresolvable walk → the SKU's
// received-units term is advisory-NULL (never a fabricated count). No chain → null.
async function sumReceivedUnitsSince(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuId: string,
  locationId: string,
  afterIso: string,
  chain: PackChainLevel[] | null,
): Promise<number | null> {
  return sumReceivedUnitsWindow(sb, skuId, locationId, afterIso, null, chain);
}
async function sumReceivedUnitsBetween(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuId: string,
  locationId: string,
  afterIso: string,
  untilIso: string,
  chain: PackChainLevel[] | null,
): Promise<number | null> {
  return sumReceivedUnitsWindow(sb, skuId, locationId, afterIso, untilIso, chain);
}
async function sumReceivedUnitsWindow(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuId: string,
  locationId: string,
  afterIso: string,
  untilIso: string | null,
  chain: PackChainLevel[] | null,
): Promise<number | null> {
  if (chain == null || chain.length === 0) return null; // no chain → can't map to leaf units.
  const packChain = buildPackChain(chain);
  const deliveryIds = await locationDeliveryIds(sb, locationId, afterIso, untilIso);
  if (deliveryIds.length === 0) return 0;
  let q = sb.from("vendor_delivery_items")
    .select("received_level_label, received_qty_at_level, created_at")
    .eq("vendor_item_id", skuId)
    .in("delivery_id", deliveryIds)
    .gt("created_at", afterIso);
  if (untilIso != null) q = q.lte("created_at", untilIso);
  const { data } = await q.returns<Array<{ received_level_label: string | null; received_qty_at_level: number | string | null; created_at: string }>>();
  const rows = data ?? [];
  if (rows.length === 0) return 0;
  let sum = 0;
  for (const r of rows) {
    const level = r.received_level_label?.trim();
    const qty = num(r.received_qty_at_level);
    // A line with no level or no qty-at-level can't map to leaf units → advisory-null
    // taint (the whole SKU's intake term is unknowable this window).
    if (!level || qty == null) return null;
    const perContainer = chainLeafUnitsFrom(packChain, level);
    if (perContainer == null) return null; // unresolvable level → advisory-null.
    sum += qty * perContainer;
  }
  return Number.isFinite(sum) ? sum : null;
}

/**
 * Consumed oz for each SKU from LIVE productions (superseded_at/revoked_at NULL) at
 * this location with produced_at STRICTLY AFTER the anchor, summing
 * production_inputs.input_oz (A3). A NULL input_oz row → null for that SKU
 * (defensive; the column is NOT NULL but we never fabricate). No in-window rows → 0.
 */
async function sumConsumedOzSince(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
  locationId: string,
  afterIso: string,
): Promise<Map<string, number | null>> {
  return sumConsumedOzWindow(sb, skuIds, locationId, afterIso, null);
}
async function sumConsumedOzBetween(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
  locationId: string,
  afterIso: string,
  untilIso: string,
): Promise<Map<string, number | null>> {
  return sumConsumedOzWindow(sb, skuIds, locationId, afterIso, untilIso);
}

// ── Sales direct-lane depletion (drift spec 2026-07-31) ───────────────────────
/**
 * SUM(direct_oz) per SKU from the materialized toast_daily_depletion ledger —
 * ONLY the direct lane (the double-count law: flattened_oz depletes at
 * production, never here). Day-grain window per etBusinessDate's tiling:
 * business_date >= fromDate, and < untilDateExclusive when given. Absence of
 * rows = 0 (a materialized day with no direct sales for a SKU writes no row);
 * this term is never null — null-tainting stays the production term's job.
 */
async function sumSalesDirectOzWindow(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
  locationId: string,
  fromDate: string,
  untilDateExclusive: string | null,
  gapDates: ReadonlySet<string>,
): Promise<Map<string, number | null>> {
  // Untrustworthy window (gap or collapsed) → the sales term is null (advisory),
  // exactly like the production term when it can't derive. Honest-null > silent-0.
  if (salesWindowUntrustworthy(gapDates, fromDate, untilDateExclusive)) {
    return new Map<string, number | null>(skuIds.map((id) => [id, null]));
  }
  const out = new Map<string, number | null>(skuIds.map((id) => [id, 0]));
  let q = sb.from("toast_daily_depletion")
    .select("sku_id, direct_oz")
    .eq("location_id", locationId)
    .in("sku_id", skuIds)
    .gte("business_date", fromDate);
  if (untilDateExclusive != null) q = q.lt("business_date", untilDateExclusive);
  const { data, error } = await q.returns<Array<{ sku_id: string; direct_oz: number | string }>>();
  if (error) throw new Error(`sumSalesDirectOzWindow: ${error.message}`);
  for (const r of data ?? []) {
    out.set(r.sku_id, (out.get(r.sku_id) ?? 0) + (num(r.direct_oz) ?? 0));
  }
  return out;
}

async function sumSalesDirectOzSince(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
  locationId: string,
  anchorIso: string,
  gapDates: ReadonlySet<string>,
): Promise<Map<string, number | null>> {
  return sumSalesDirectOzWindow(sb, skuIds, locationId, etBusinessDate(anchorIso), null, gapDates);
}

async function sumSalesDirectOzBetween(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
  locationId: string,
  prevIso: string,
  anchorIso: string,
  gapDates: ReadonlySet<string>,
): Promise<Map<string, number | null>> {
  return sumSalesDirectOzWindow(sb, skuIds, locationId, etBusinessDate(prevIso), etBusinessDate(anchorIso), gapDates);
}

/**
 * Sales-coverage GAP dates for a location on/after `sinceDate` (hardening
 * 2026-07-31): business_dates that HAVE toast_sales_events but ZERO
 * toast_daily_depletion rows — the cron pulled that day but never materialized
 * its depletion (or the materialize failed). Two distinct-date queries, unioned
 * in memory; run ONCE per loadOnHand (not per SKU). Known conservative edge: a
 * day whose sales were ALL excluded/unmapped also materializes to zero rows and
 * reads as a gap → that window's SKUs go advisory-null. Acceptable (honest
 * pessimism; a fully-excluded day at a sub shop is effectively never) and safe.
 *
 * The OPEN (current) business day is NEVER gap-eligible (`openEtDate` guard,
 * council 2026-07-31 Fable C3): same-day event pulls land events hours before
 * the close/nightly materialize — counting today as a gap would advisory-null
 * every SKU all afternoon. See isGapEligibleDate (counts-shared).
 */
async function loadSalesGapDates(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  sinceDate: string,
  openEtDate: string,
): Promise<Set<string>> {
  const [evRes, deplRes] = await Promise.all([
    sb.from("toast_sales_events").select("business_date").eq("location_id", locationId).gte("business_date", sinceDate)
      .returns<Array<{ business_date: string }>>(),
    sb.from("toast_daily_depletion").select("business_date").eq("location_id", locationId).gte("business_date", sinceDate)
      .returns<Array<{ business_date: string }>>(),
  ]);
  if (evRes.error) throw new Error(`loadSalesGapDates events: ${evRes.error.message}`);
  if (deplRes.error) throw new Error(`loadSalesGapDates depletion: ${deplRes.error.message}`);
  const materialized = new Set((deplRes.data ?? []).map((r) => r.business_date));
  const gaps = new Set<string>();
  for (const r of evRes.data ?? []) {
    if (!materialized.has(r.business_date) && isGapEligibleDate(r.business_date, openEtDate)) {
      gaps.add(r.business_date);
    }
  }
  // Defense-in-depth (adversarial review 2026-07-31 C1): a ledger row for the
  // OPEN (or future) business date is anomalous — no legitimate writer
  // materializes an unclosed day (the nightly T-1 cron is the sole
  // materializer; system triggers are events-only). If one ever appears, its
  // coverage is partial by construction: treat the date as a GAP so it
  // null-taints (advisory) instead of feeding drift as trusted.
  for (const d of materialized) if (d >= openEtDate) gaps.add(d);
  return gaps;
}

/** The latest materialized sales business_date at a location (the coverage hint
 *  the counts UI renders: "sales counted through <date>"). Null = no ledger yet. */
async function salesLedgerThrough(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<string | null> {
  const { data, error } = await sb.from("toast_daily_depletion")
    .select("business_date")
    .eq("location_id", locationId)
    .order("business_date", { ascending: false })
    .limit(1)
    .maybeSingle<{ business_date: string }>();
  if (error) throw new Error(`salesLedgerThrough: ${error.message}`);
  return data?.business_date ?? null;
}
async function sumConsumedOzWindow(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
  locationId: string,
  afterIso: string,
  untilIso: string | null,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const id of skuIds) out.set(id, 0);
  // Live production headers at this location in the window.
  let hq = sb.from("productions").select("id").eq("location_id", locationId)
    .is("superseded_at", null).is("revoked_at", null).gt("produced_at", afterIso);
  if (untilIso != null) hq = hq.lte("produced_at", untilIso);
  const { data: hdrs } = await hq.returns<Array<{ id: string }>>();
  const prodIds = (hdrs ?? []).map((h) => h.id);
  if (prodIds.length === 0) return out;
  const { data: lines } = await sb.from("production_inputs")
    .select("input_sku_id, input_oz")
    .in("input_sku_id", skuIds)
    .in("production_id", prodIds)
    .returns<Array<{ input_sku_id: string; input_oz: number | string | null }>>();
  const sums = new Map<string, number>();
  const nulled = new Set<string>();
  for (const l of lines ?? []) {
    const oz = num(l.input_oz);
    if (oz == null) { nulled.add(l.input_sku_id); continue; }
    sums.set(l.input_sku_id, (sums.get(l.input_sku_id) ?? 0) + oz);
  }
  for (const [id, s] of sums) out.set(id, s);
  for (const id of nulled) out.set(id, null); // NULL input_oz → null-drift advisory.
  return out;
}

/**
 * Retro-edit staleness (L5): true when a BACKDATED delivery exists — one whose
 * write instant (vendor_deliveries.created_at) is AFTER the anchor count but whose
 * effective delivery_date is on-or-BEFORE the anchor. Such a row landed after the
 * manager counted yet claims stock the count should already have reflected — so it
 * can't be cleanly folded into the since-anchor drift, and the anchor's ground
 * truth is suspect. Sound + cheap: the mismatch between write-time and effective-
 * time IS the retro edit.
 *
 * SCOPE NOTE: only the delivery ledger is checkable — `productions` has NO
 * created_at (schema: only produced_at, verified against live), so a backdated
 * production is not observable without a created_at column. Documented seam: if a
 * production created_at lands later, add the symmetric check here. We surface the
 * honest signal we CAN derive rather than a fabricated one.
 */
async function detectRetroEditStaleness(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  anchorIso: string,
  _now: number,
): Promise<boolean> {
  const anchorDate = anchorIso.slice(0, 10); // YYYY-MM-DD for the bare delivery_date compare.
  const { data: delivHit } = await sb.from("vendor_deliveries").select("id")
    .eq("location_id", locationId)
    .gt("created_at", anchorIso).lte("delivery_date", anchorDate).limit(1)
    .returns<Array<{ id: string }>>();
  return (delivHit ?? []).length > 0;
}
