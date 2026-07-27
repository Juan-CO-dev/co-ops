/**
 * Manager physical-count data layer (pack hierarchy PR 2, migration 0160).
 * SERVER-ONLY, service-role client; authorization is APP-LAYER (AGM+ gate +
 * location-bind IDOR; the WRITE also requires Tier-A step-up, enforced at the
 * route per adjudication A4). Pure math lives in lib/counts-shared.ts.
 *
 * Juan's model — RECEIVING FEEDS, COUNTS VERIFY, THE DIFFERENCE IS VARIANCE:
 *   on-hand(sku) = anchor + received_since − consumed_since   (all IN OZ, A3)
 *   anchor       = latest ACTIVE count event's summed resolved oz per SKU (L5)
 *   variance     = newest count − (prev count + received_between − consumed_between)
 *
 * COUNCIL LOCKS:
 *   L3  count lines persist resolved_oz at write; readers read stored oz.
 *   L4  count events are location-scoped rows; SKUs stay global.
 *   L5  ONE event per session (createCountEvent writes one event + its lines in
 *       one call); disjoint-by-law lines; anchor = oz snapshot; anchor age +
 *       retro-edit staleness surfaced (read-time).
 *   L8  shrinkage delta = variance, surfaced with a reason code.
 *
 * A3 SOURCES (oz-native, advisory-null):
 *   received_since  = SUM(vendor_delivery_items.resolved_oz) for this SKU on
 *                     deliveries at this location dated after the anchor. Legacy
 *                     lines with NULL resolved_oz can't contribute → that SKU's
 *                     received term is advisory-null (never a fabricated number).
 *   consumed_since  = SUM(production_inputs.input_oz) for this SKU on LIVE
 *                     productions (superseded_at/revoked_at NULL) at this location
 *                     with produced_at after the anchor. A NULL input_oz row →
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
import {
  resolveCountLines,
  sumAnchorOzBySku,
  computeOnHand,
  chainLabelsInWalkOrder,
  type CountLineInput,
  type OnHandResult,
} from "@/lib/counts-shared";

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
 * count line with no oz can't anchor — resolved_oz is NOT NULL). The new event
 * becomes the active anchor and the prior latest active event at this location is
 * superseded (active=false, append-only — never DELETE). Audited.
 */
export async function createCountEvent(actor: AuthContext, input: CreateCountEventInput): Promise<{ countEventId: string }> {
  requireLevel(actor, COUNT_WRITE_MIN);
  if (!lockLocationContext(actorLoc(actor), input.locationId)) throw new CountError(404, "not_found", "Location not found");
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new CountError(400, "no_lines", "At least one count line is required");
  for (const l of input.lines) {
    if (typeof l.skuId !== "string" || !l.skuId) throw new CountError(400, "invalid_sku", "Each line needs a SKU");
    if (typeof l.levelLabel !== "string" || !l.levelLabel.trim()) throw new CountError(400, "invalid_level", "Each line needs a level");
    if (!Number.isFinite(l.qty) || l.qty < 0) throw new CountError(400, "invalid_qty", "Quantity must be zero or greater");
    if (l.partialFraction != null && !(l.partialFraction > 0 && l.partialFraction <= 1)) {
      throw new CountError(400, "invalid_fraction", "Partial fraction must be between 0 and 1");
    }
  }

  const sb = getServiceRoleClient();
  const skuIds = [...new Set(input.lines.map((l) => l.skuId))];
  const { data: activeSkus } = await sb.from("vendor_items").select("id").in("id", skuIds).eq("active", true).returns<Array<{ id: string }>>();
  const activeSet = new Set((activeSkus ?? []).map((s) => s.id));
  for (const id of skuIds) if (!activeSet.has(id)) throw new CountError(400, "invalid_sku", "A SKU is not found or inactive");

  // Resolve every line's oz at write (council L3). Reject the whole event if ANY
  // line is unresolvable — a null-oz count line can't anchor.
  const [measures, recipeSkus] = await Promise.all([loadMeasures(), loadRecipeSkus(skuIds)]);
  const resolution = resolveCountLines(input.lines, recipeSkus, measures);
  if (!resolution.ok) {
    throw new CountError(400, "unresolvable_line", `Can't convert "${resolution.badLine.levelLabel}" for a SKU to ounces — set the SKU's pack chain or avg oz first`);
  }

  const now = new Date().toISOString();

  // 1) supersede the prior latest active event at this location (append-only).
  const { error: deErr, count: deCount } = await sb.from("sku_count_events")
    .update({ active: false }, { count: "exact" })
    .eq("location_id", input.locationId).eq("active", true);
  if (deErr) throw new Error(`createCountEvent supersede: ${deErr.message}`);

  // 2) insert the new event header.
  const { data: ev, error: evErr } = await sb.from("sku_count_events").insert({
    location_id: input.locationId, counted_by: actor.user.id, note: input.note?.trim() || null, active: true,
  }).select("id").maybeSingle<{ id: string }>();
  if (evErr) throw new Error(`createCountEvent header: ${evErr.message}`);
  if (!ev) throw new Error("createCountEvent returned no row");

  // 3) insert the resolved lines.
  const { error: lErr } = await sb.from("sku_count_lines").insert(
    resolution.resolved.map((l) => ({
      count_event_id: ev.id, sku_id: l.skuId, level_label: l.levelLabel.trim(), qty: l.qty,
      is_loose: l.isLoose === true, partial_fraction: l.partialFraction ?? null, resolved_oz: l.resolvedOz,
    })),
  );
  if (lErr) throw new Error(`createCountEvent lines: ${lErr.message}`);

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku_count.recorded", resourceTable: "sku_count_events", resourceId: ev.id,
    metadata: { location_id: input.locationId, line_count: resolution.resolved.length, superseded_prior: deCount ?? 0, sku_ids: skuIds },
    ipAddress: null, userAgent: null,
  });

  return { countEventId: ev.id };
}

// ── On-hand read (AGM+): anchor + drift + variance ───────────────────────────────
export interface OnHandRow extends OnHandResult {
  skuName: string;
  /** Variance of THIS anchor vs the previous count + intervening ledger (L8). null
   *  = no prior count or a derive side missing (advisory). */
  varianceOz: number | null;
}
export interface OnHandView {
  locationId: string;
  /** ISO of the anchor count event (latest active), null if none yet. */
  anchorAt: string | null;
  rows: OnHandRow[];
}

/**
 * Load the on-hand panel for a location: the latest active count event is the
 * anchor; drift = received-since − consumed-since IN OZ (A3, advisory-null);
 * variance compares the anchor to the PREVIOUS count + intervening ledger (L8).
 * Retro-edit staleness (a ledger row dated between the anchor and now) flags the
 * anchor stale.
 */
export async function loadOnHand(actor: AuthContext, locationId: string, now: number = Date.now()): Promise<OnHandView> {
  requireLevel(actor, COUNT_READ_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new CountError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();

  // Latest active anchor event + the previous event (for variance).
  const { data: events } = await sb.from("sku_count_events")
    .select("id, counted_at, active")
    .eq("location_id", locationId)
    .order("counted_at", { ascending: false })
    .limit(2)
    .returns<Array<{ id: string; counted_at: string; active: boolean }>>();
  const evList = events ?? [];
  const anchor = evList.find((e) => e.active) ?? evList[0] ?? null;
  if (!anchor) return { locationId, anchorAt: null, rows: [] };
  const prev = evList.find((e) => e.id !== anchor.id) ?? null;

  // Anchor lines → per-SKU anchor oz. Previous lines → per-SKU prev oz.
  const [{ data: anchorLines }, { data: prevLines }] = await Promise.all([
    sb.from("sku_count_lines").select("sku_id, resolved_oz").eq("count_event_id", anchor.id).returns<Array<{ sku_id: string; resolved_oz: number | string }>>(),
    prev
      ? sb.from("sku_count_lines").select("sku_id, resolved_oz").eq("count_event_id", prev.id).returns<Array<{ sku_id: string; resolved_oz: number | string }>>()
      : Promise.resolve({ data: [] as Array<{ sku_id: string; resolved_oz: number | string }> }),
  ]);
  const anchorOzBySku = sumAnchorOzBySku((anchorLines ?? []).map((l) => ({ skuId: l.sku_id, resolvedOz: num(l.resolved_oz) ?? 0 })));
  const prevOzBySku = sumAnchorOzBySku((prevLines ?? []).map((l) => ({ skuId: l.sku_id, resolvedOz: num(l.resolved_oz) ?? 0 })));

  const skuIds = [...anchorOzBySku.keys()];
  if (skuIds.length === 0) return { locationId, anchorAt: anchor.counted_at, rows: [] };

  // Ledger sums since the anchor (drift) and between prev→anchor (variance).
  const [receivedSince, consumedSince, staleSet] = await Promise.all([
    sumReceivedOzSince(sb, skuIds, locationId, anchor.counted_at),
    sumConsumedOzSince(sb, skuIds, locationId, anchor.counted_at),
    detectRetroEditStaleness(sb, locationId, anchor.counted_at, now),
  ]);
  const [receivedBetween, consumedBetween] = prev
    ? await Promise.all([
        sumReceivedOzBetween(sb, skuIds, locationId, prev.counted_at, anchor.counted_at),
        sumConsumedOzBetween(sb, skuIds, locationId, prev.counted_at, anchor.counted_at),
      ])
    : [new Map<string, number | null>(), new Map<string, number | null>()];

  // SKU names.
  const { data: skuRows } = await sb.from("vendor_items").select("id, name").in("id", skuIds).returns<Array<{ id: string; name: string }>>();
  const skuName = new Map((skuRows ?? []).map((s) => [s.id, s.name]));

  const rows: OnHandRow[] = skuIds.map((skuId) => {
    const anchorOz = anchorOzBySku.get(skuId) ?? null;
    const onHand = computeOnHand(
      {
        skuId,
        anchorOz,
        anchorAt: anchor.counted_at,
        receivedSinceOz: receivedSince.get(skuId) ?? null,
        consumedSinceOz: consumedSince.get(skuId) ?? null,
        anchorStale: staleSet,
      },
      now,
    );
    // Variance: this anchor vs prev + between (advisory-null when no prior count).
    const prevOz = prev ? (prevOzBySku.get(skuId) ?? 0) : null;
    let varianceOz: number | null = null;
    if (prevOz != null) {
      const rB = receivedBetween.get(skuId) ?? null;
      const cB = consumedBetween.get(skuId) ?? null;
      varianceOz = rB == null || cB == null ? null : (anchorOz ?? 0) - (prevOz + rB - cB);
    }
    return { ...onHand, skuName: skuName.get(skuId) ?? "(sku)", varianceOz };
  });
  rows.sort((a, b) => a.skuName.localeCompare(b.skuName));
  return { locationId, anchorAt: anchor.counted_at, rows };
}

// ── Ledger oz aggregations (A3, oz-native, advisory-null) ─────────────────────────
/** Deliveries at this location; returns their ids (batch-bounded). */
async function locationDeliveryIds(sb: ReturnType<typeof getServiceRoleClient>, locationId: string): Promise<string[]> {
  const { data } = await sb.from("vendor_deliveries").select("id").eq("location_id", locationId).returns<Array<{ id: string }>>();
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
  const deliveryIds = await locationDeliveryIds(sb, locationId);
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
