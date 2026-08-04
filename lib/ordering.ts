/**
 * Par-pass ordering data layer (delivery-intake P3, migration 0172). SERVER-ONLY,
 * service-role client; authorization is APP-LAYER (KH+ gate + location-bind IDOR).
 * NO Tier-A step-up — the shelf-walk is an operational KH+ capture, not an admin
 * mutation (spec D5). Mirrors the credits.ts posture (typed error, requireLevel,
 * actorLoc, num).
 *
 * ── THE PAR-PASS (spec D5/D6) ──────────────────────────────────────────────────
 * Staff walk the shelf and record, per par'd SKU, the ORDER QTY needed to reach
 * par — in the SKU's ORDER UNIT (its top pack level: the chain root label when the
 * SKU is chained, else pack_format). The system derives (a) draft orders per vendor
 * and (b) a soft on-hand anchor: implied_on_hand = par − order_qty (the "par_estimate"
 * truth tier consumed by lib/counts.ts). A ZERO order_qty line is an EXPLICIT "we're
 * full" observation (implied on-hand = full par), NOT a no-op — it is stored.
 *
 * ── UNIT SEMANTICS (locked; migration 0172 comment block is law) ───────────────
 *   order unit  = the SKU's chain ROOT label (chained) else pack_format. par_qty and
 *                 order_qty are BOTH in this unit — the same implicit unit the seeded
 *                 weekday_par/weekend_par guide values use.
 *   par for day = weekend_par when the walk date's getDay() ∈ {5,6,0} (Fri/Sat/Sun)
 *                 AND weekend_par is set, else weekday_par. A SKU with NEITHER par
 *                 set is EXCLUDED from the walk (nothing to order to).
 *   per-order-unit oz = oz of ONE order unit. Chained: ozForRecipeInput(1, rootLabel,
 *                 skuShape, measures) (walks the chain to the root container's oz).
 *                 Unchained: skuContentOz (oz of one pack = one pack_format unit).
 *                 advisory-null when unconvertible — NEVER fabricated (A3 / BC-026).
 *   implied_on_hand_oz = perUnitOz != null ? max(par − order_qty, 0) × perUnitOz : null.
 *
 * ── SHRINKAGE SIGNAL (spec D6, L8-flavored, ADVISORY not variance) ─────────────
 * When a line's implied_on_hand_oz AND the CURRENTLY-computed advisory on-hand oz
 * (loadOnHand's par_estimate/census/inferred weight rows) are BOTH non-null and
 * diverge beyond max(0.25 × par_oz, one order-unit oz), we surface a shrinkage
 * notice — "the par-pass sees less than the computed feed/verify model predicts →
 * possible unrecorded waste". Persist NOTHING new; surfaced read-time (submit +
 * loadShrinkageSignals). Advisory voice — never "variance" (that stays census-only).
 *
 * BATCH LAW (loadRecipeGraph): loadWalkerData makes exactly ONE loadOnHand call, ONE
 * pack-chains load, ONE measures load, ONE usage-rank computation, ONE last-order-qty
 * query. Never per-SKU.
 *
 * APPEND-ONLY: par_pass_events / par_pass_lines rows are never DELETEd or mutated.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { loadMeasures, loadSkuPackChains } from "@/lib/prep-consumption";
import {
  ozForRecipeInput,
  skuContentOz,
  type MeasureUnitFactor,
  type RecipeInputSku,
} from "@/lib/recipe-math";
import {
  buildPackChain,
  chainRootLabel,
  type PackChainLevel,
} from "@/lib/pack-chain-shared";
import { loadOnHand, type OnHandRow } from "@/lib/counts";
import { etBusinessDate } from "@/lib/counts-shared";

/** KH+ read/write floor for the par-pass. NO step-up (operational capture, spec D5). */
export const PAR_PASS_MIN = 4; // key_holder+

export class OrderingError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "OrderingError";
  }
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new OrderingError(403, "forbidden", "Insufficient role level for the par-pass");
  }
}
function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

// ── The weekend-par day rule (semantics block, locked) ──────────────────────────
/** Fri/Sat/Sun = getDay() ∈ {5,6,0} (JS getDay convention, matches vendors.order_days). */
function isWeekendParDay(d: Date): boolean {
  const day = d.getDay();
  return day === 5 || day === 6 || day === 0;
}

/**
 * The par that applies on the walk day: weekend_par when it is a weekend-par day AND
 * weekend_par is set, else weekday_par. Returns { par, isWeekend } — par is null only
 * when NEITHER par is set (such a SKU is excluded from the walk by the caller).
 */
function parForDay(
  weekdayPar: number | null,
  weekendPar: number | null,
  weekend: boolean,
): { par: number | null; isWeekend: boolean } {
  if (weekend && weekendPar != null) return { par: weekendPar, isWeekend: true };
  return { par: weekdayPar, isWeekend: false };
}

// ── Per-order-unit oz conversion (chain root, else pack content) ─────────────────
/**
 * oz of ONE order unit for a SKU. The order unit is the chain ROOT container (chained)
 * or one pack_format pack (unchained). Advisory-null when the conversion can't resolve
 * (A3 — never fabricate):
 *   chained  → ozForRecipeInput(1, rootLabel, skuShape, measures) (walks the chain).
 *              A malformed / count-terminated-unresolvable chain → null.
 *   unchained→ skuContentOz(skuShape, measures) = oz of one pack (the pack_format unit).
 * Pure over the passed shapes; the caller batch-loads chains + measures once.
 */
function perOrderUnitOz(
  sku: RecipeInputSku,
  chain: PackChainLevel[] | null,
  measures: Map<string, MeasureUnitFactor>,
): number | null {
  const hasChain = chain != null && chain.length > 0;
  if (hasChain) {
    const root = chainRootLabel(buildPackChain(chain));
    if (root == null) return null; // no unique root → can't name the order unit → advisory-null.
    return ozForRecipeInput(1, root, sku, measures);
  }
  // Unchained: the order unit is one pack_format pack; its oz is the pack content.
  return skuContentOz(sku, measures);
}

/** The order-unit label = chain root label (chained) else pack_format else null. */
function orderUnitLabelFor(packFormat: string | null, chain: PackChainLevel[] | null): string | null {
  if (chain != null && chain.length > 0) {
    const root = chainRootLabel(buildPackChain(chain));
    if (root != null) return root;
  }
  return packFormat;
}

// ── Usage rank (trailing-30d consumed oz; mirrors receiving.ts loadSkuUsageRank) ──
/**
 * Trailing-30-day consumed oz per SKU at a location — the "most used" ordering rank
 * (higher = walked first). Mirrors lib/receiving.ts loadSkuUsageRank + the counts drift
 * consumed term EXACTLY (the double-count law's two lanes):
 *   production lane = SUM(production_inputs.input_oz) over LIVE productions
 *                     (superseded_at/revoked_at NULL) at this location in the last 30d.
 *   sales lane      = SUM(toast_daily_depletion.direct_oz) at this location over the
 *                     last 30d (ONLY the direct lane depletes raw stock; flattened_oz
 *                     is production-covered — never summed).
 * Two grouped batch queries, summed in memory (loadRecipeGraph law — never per-SKU). A
 * SKU absent from both lanes is absent from the map (usageRank null → sorts last).
 */
async function loadSkuUsageRank(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<Map<string, number>> {
  const usage = new Map<string, number>();
  const add = (skuId: string, oz: number) => {
    if (!Number.isFinite(oz) || oz <= 0) return;
    usage.set(skuId, (usage.get(skuId) ?? 0) + oz);
  };

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();
  const cutoffDate = cutoffIso.slice(0, 10); // YYYY-MM-DD for the business_date filter.

  const { data: prodHdrs, error: phErr } = await sb.from("productions")
    .select("id")
    .eq("location_id", locationId)
    .is("superseded_at", null).is("revoked_at", null)
    .gt("produced_at", cutoffIso)
    .returns<Array<{ id: string }>>();
  if (phErr) throw new Error(`loadSkuUsageRank productions: ${phErr.message}`);
  const prodIds = (prodHdrs ?? []).map((h) => h.id);
  if (prodIds.length > 0) {
    const { data: inputs, error: piErr } = await sb.from("production_inputs")
      .select("input_sku_id, input_oz")
      .in("production_id", prodIds)
      .returns<Array<{ input_sku_id: string; input_oz: number | string | null }>>();
    if (piErr) throw new Error(`loadSkuUsageRank production_inputs: ${piErr.message}`);
    for (const r of inputs ?? []) add(r.input_sku_id, num(r.input_oz) ?? 0);
  }

  const { data: sales, error: sErr } = await sb.from("toast_daily_depletion")
    .select("sku_id, direct_oz")
    .eq("location_id", locationId)
    .gte("business_date", cutoffDate)
    .returns<Array<{ sku_id: string; direct_oz: number | string }>>();
  if (sErr) throw new Error(`loadSkuUsageRank toast_daily_depletion: ${sErr.message}`);
  for (const r of sales ?? []) add(r.sku_id, num(r.direct_oz) ?? 0);

  return usage;
}

/**
 * Advisory on-hand oz per SKU from a loadOnHand result. ONLY weight-dimension rows
 * (census / par_estimate / inferred) carry an honest ounce (onHandOz) — count-dimension
 * rows have no oz (packaging; count-dimension SKUs are deferred for suggested-qty per
 * the plan). A weight row with onHandOz null → advisory-null (never fabricated). The
 * anchorSource is carried through so the walker can render provenance ("~N unit · source").
 */
function advisoryOnHandBySku(view: { rows: OnHandRow[] }): Map<string, { oz: number; source: string }> {
  const out = new Map<string, { oz: number; source: string }>();
  for (const row of view.rows) {
    if (row.dimension !== "weight") continue; // count-dimension → no oz (deferred).
    if (row.onHandOz == null) continue; // advisory-null; not an anchor for suggestion.
    // anchorSource is "census" | "inferred" | null; par_estimate lands here once Task 3
    // adds that tier. null (defensive) reads as "inferred" provenance is wrong — keep the
    // literal source string, defaulting to "inferred" only when the row truly has none.
    out.set(row.skuId, { oz: row.onHandOz, source: row.anchorSource ?? "inferred" });
  }
  return out;
}

// ── loadWalkerData: the shelf-walk payload ───────────────────────────────────────
export interface WalkerSku {
  skuId: string;
  name: string;
  itemNumber: string | null;
  /** Chain root label (chained) else pack_format else null. */
  orderUnitLabel: string | null;
  /** The par that applies on the walk day (order units). Never null here — a SKU with
   *  neither par set is EXCLUDED (not surfaced). */
  parToday: number;
  /** True when parToday came from weekend_par (Fri/Sat/Sun + weekend_par set). */
  parIsWeekend: boolean;
  /** The order_qty of the latest par_pass_lines row for this SKU (any event). null =
   *  never walked. Advisory hint ("last time you ordered N"). */
  lastOrderQty: number | null;
  /** Advisory computed on-hand for the SKU. null when unconvertible / no anchor /
   *  count-dimension. oz + its order-unit equivalent (oz ÷ per-order-unit-oz) + source. */
  advisoryOnHand: { oz: number; orderUnits: number | null; source: string } | null;
  /** max(par − advisoryOrderUnits, 0), rounded UP to whole units — only when the
   *  advisory is convertible to order units; else null (no fabricated suggestion). */
  suggestedQty: number | null;
}
export interface WalkerVendor {
  vendorId: string;
  name: string;
  /** True when TODAY (server local getDay) is one of the vendor's order_days. */
  isOrderDay: boolean;
  skus: WalkerSku[];
}
export interface WalkerData {
  /** The walk date (server local). Its getDay drives the weekend-par rule + isOrderDay. */
  walkDate: string; // ISO
  isWeekendPar: boolean;
  vendors: WalkerVendor[];
}

/**
 * Load the par-pass walker payload for a location (KH+ + location-bind). Vendors with
 * ≥1 active par'd SKU, ordered isOrderDay-first then name; each vendor's SKUs ordered
 * by usage rank desc then name. A SKU is INCLUDED iff it is active, carries a vendor,
 * and has weekday_par OR weekend_par set (parForDay resolves which applies today).
 *
 * BATCH: one loadOnHand, one chains load, one measures load, one usage-rank pass, one
 * last-order-qty query (via the sku_ix), and one vendor lookup. No per-SKU I/O.
 */
export async function loadWalkerData(actor: AuthContext, locationId: string): Promise<WalkerData> {
  requireLevel(actor, PAR_PASS_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new OrderingError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();
  // ET-anchored walk day: Vercel runs UTC, and evening walks (exactly when shops
  // order) must not roll into tomorrow's weekday. etBusinessDate gives the ET
  // calendar date; parsing it at local midnight preserves the date components, so
  // getDay() is that ET date's weekday regardless of server TZ.
  const walkDateEt = etBusinessDate(new Date().toISOString());
  const etDate = new Date(`${walkDateEt}T00:00:00`);
  const weekend = isWeekendParDay(etDate);
  const todayDow = etDate.getDay(); // 0=Sun..6=Sat (order_days convention).

  // Active par'd SKUs (global rows; item spine is location-scoped via the ledgers, not
  // the vendor_items row — same as counts/receiving). A SKU with neither par is excluded.
  const { data: skuRows, error: sErr } = await sb.from("vendor_items")
    .select("id, name, vendor_id, item_number, pack_format, weekday_par, weekend_par, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .eq("active", true)
    .or("weekday_par.not.is.null,weekend_par.not.is.null")
    .returns<Array<{
      id: string; name: string; vendor_id: string | null; item_number: string | null;
      pack_format: string | null; weekday_par: number | string | null; weekend_par: number | string | null;
      each_container_label: string | null; units_per_pack: number | null;
      each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null;
    }>>();
  if (sErr) throw new Error(`loadWalkerData skus: ${sErr.message}`);
  const skus = (skuRows ?? []).filter((s) => s.vendor_id != null); // a par'd SKU with no
  // vendor can't be ordered from anyone → excluded (schema allows null vendor_id, live
  // data has none; defensive).
  if (skus.length === 0) {
    return { walkDate: walkDateEt, isWeekendPar: weekend, vendors: [] };
  }
  const skuIds = skus.map((s) => s.id);
  const vendorIds = [...new Set(skus.map((s) => s.vendor_id as string))];

  // BATCH loads (one each — loadRecipeGraph law).
  const [chainsBySku, measures, usageBySku, onHandView, { data: vendorRows, error: vErr }, lastOrderBySku] =
    await Promise.all([
      loadSkuPackChains(skuIds),
      loadMeasures(),
      loadSkuUsageRank(sb, locationId),
      loadOnHand(actor, locationId), // ONE advisory on-hand pass for the whole location.
      sb.from("vendors").select("id, name, order_days").in("id", vendorIds).eq("active", true)
        .returns<Array<{ id: string; name: string; order_days: number[] | null }>>(),
      loadLatestOrderQtyBySku(sb, skuIds),
    ]);
  if (vErr) throw new Error(`loadWalkerData vendors: ${vErr.message}`);
  const vendorById = new Map((vendorRows ?? []).map((v) => [v.id, v]));
  const advisoryBySku = advisoryOnHandBySku(onHandView);

  // Build a per-SKU WalkerSku, grouped under its (active) vendor.
  const skusByVendor = new Map<string, WalkerSku[]>();
  for (const s of skus) {
    const vendorId = s.vendor_id as string;
    if (!vendorById.has(vendorId)) continue; // vendor inactive/missing → SKU dropped with it.
    const { par, isWeekend } = parForDay(num(s.weekday_par), num(s.weekend_par), weekend);
    if (par == null) continue; // neither par applies today (only weekend_par set, weekday walk).

    const chain = chainsBySku.get(s.id) ?? null;
    const skuShape: RecipeInputSku = {
      packFormat: s.pack_format, eachContainerLabel: s.each_container_label,
      unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure,
      avgOzPerEach: num(s.avg_oz_per_each), packChain: chain,
    };
    const perUnitOz = perOrderUnitOz(skuShape, chain, measures);

    // Advisory on-hand → order-unit equivalent (oz ÷ per-order-unit-oz). Null unless
    // BOTH the advisory oz and the per-unit oz are present (never fabricate a unit count).
    const adv = advisoryBySku.get(s.id) ?? null;
    let advisoryOnHand: WalkerSku["advisoryOnHand"] = null;
    let suggestedQty: number | null = null;
    if (adv != null) {
      const orderUnits = perUnitOz != null && perUnitOz > 0 ? adv.oz / perUnitOz : null;
      advisoryOnHand = { oz: adv.oz, orderUnits, source: adv.source };
      if (orderUnits != null) {
        // Suggest ordering up to par: max(par − on-hand-units, 0), ceil to whole units.
        suggestedQty = Math.max(Math.ceil(par - orderUnits), 0);
      }
    }

    const row: WalkerSku = {
      skuId: s.id,
      name: s.name,
      itemNumber: s.item_number,
      orderUnitLabel: orderUnitLabelFor(s.pack_format, chain),
      parToday: par,
      parIsWeekend: isWeekend,
      lastOrderQty: lastOrderBySku.get(s.id) ?? null,
      advisoryOnHand,
      suggestedQty,
    };
    const arr = skusByVendor.get(vendorId) ?? [];
    arr.push(row);
    skusByVendor.set(vendorId, arr);
  }

  // Assemble vendor groups: usage desc then name within a vendor; vendors isOrderDay-first
  // then name; vendors with zero par'd SKUs omitted (skusByVendor never holds an empty arr).
  const vendors: WalkerVendor[] = [];
  for (const [vendorId, vendorSkus] of skusByVendor) {
    const v = vendorById.get(vendorId)!;
    vendorSkus.sort((a, b) => {
      const ua = usageBySku.get(a.skuId) ?? -Infinity; // null usage sorts last.
      const ub = usageBySku.get(b.skuId) ?? -Infinity;
      if (ua !== ub) return ub - ua; // usage desc.
      return a.name.localeCompare(b.name);
    });
    vendors.push({
      vendorId,
      name: v.name,
      isOrderDay: (v.order_days ?? []).includes(todayDow),
      skus: vendorSkus,
    });
  }
  vendors.sort((a, b) => {
    if (a.isOrderDay !== b.isOrderDay) return a.isOrderDay ? -1 : 1; // order-day vendors first.
    return a.name.localeCompare(b.name);
  });

  return { walkDate: walkDateEt, isWeekendPar: weekend, vendors };
}

/**
 * The latest (by created_at) par_pass_lines.order_qty per SKU — one batched query over
 * the sku_ix (sku_id, created_at desc). We pull the recent rows for the SKU set and
 * keep the FIRST seen per SKU in created_at-desc order (the latest). Bounded by the
 * SKU set; no per-SKU query.
 */
async function loadLatestOrderQtyBySku(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const { data, error } = await sb.from("par_pass_lines")
    .select("sku_id, order_qty, created_at")
    .in("sku_id", skuIds)
    .order("created_at", { ascending: false })
    .returns<Array<{ sku_id: string; order_qty: number | string; created_at: string }>>();
  if (error) throw new Error(`loadLatestOrderQtyBySku: ${error.message}`);
  for (const r of data ?? []) {
    if (out.has(r.sku_id)) continue; // desc order → first seen is the latest.
    const q = num(r.order_qty);
    if (q != null) out.set(r.sku_id, q);
  }
  return out;
}

// ── submitParPass: record the walk + derive draft orders + shrinkage ─────────────
export interface ParPassLineInput {
  skuId: string;
  orderQty: number;
  note?: string | null;
}
export interface DraftOrderLine {
  skuName: string;
  itemNumber: string | null;
  orderQty: number;
  orderUnitLabel: string | null;
}
export interface DraftOrderDelivery {
  method: string; // email | url | phone | portal | other
  value: string;
  label: string | null;
}
export interface DraftOrder {
  vendorId: string;
  vendorName: string;
  orderingDetails: DraftOrderDelivery[];
  lines: DraftOrderLine[];
}
export interface ShrinkageNotice {
  skuId: string;
  skuName: string;
  impliedOz: number;
  computedOz: number;
}

/**
 * The shrinkage divergence threshold (semantics block): the par-pass implied on-hand
 * and the computed advisory on-hand must differ by more than max(0.25 × par_oz, one
 * order-unit oz) to raise a notice. par_oz = parToday × perUnitOz (the full-par oz).
 * One order-unit oz is the noise floor (a single-unit rounding never trips it). Pure.
 */
function shrinkageDiverges(
  impliedOz: number,
  computedOz: number,
  parToday: number,
  perUnitOz: number,
): boolean {
  const threshold = Math.max(0.25 * parToday * perUnitOz, perUnitOz);
  return Math.abs(impliedOz - computedOz) > threshold;
}

/**
 * Record a par-pass EVENT + its lines (KH+, location-bind, NO step-up). Validates the
 * batch (non-empty; each SKU active + par'd today + orderQty finite ≥ 0), snapshots the
 * day's par, computes implied_on_hand_oz per line (advisory-null when the order-unit→oz
 * conversion is unconvertible — never fabricated), inserts the event then its lines
 * (house sequential pattern, each error-checked), audits, then derives:
 *   - draftOrders: per vendor, the orderQty > 0 lines + the vendor's ordering-detail
 *     delivery affordances (email/url/phone/portal/other; active, display_order).
 *   - shrinkage: lines whose implied on-hand diverges from the CURRENT computed advisory
 *     on-hand (from a loadOnHand pass inside this call) beyond the threshold.
 * Append-only — never DELETE/mutate a prior row.
 */
export async function submitParPass(
  actor: AuthContext,
  locationId: string,
  lines: ParPassLineInput[],
): Promise<{ eventId: string; draftOrders: DraftOrder[]; shrinkage: ShrinkageNotice[] }> {
  requireLevel(actor, PAR_PASS_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new OrderingError(404, "not_found", "Location not found");
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new OrderingError(400, "no_lines", "At least one line is required");
  }
  for (const l of lines) {
    if (typeof l.skuId !== "string" || !l.skuId) throw new OrderingError(400, "invalid_sku", "Each line needs a SKU");
    if (!Number.isFinite(l.orderQty) || l.orderQty < 0) throw new OrderingError(400, "invalid_qty", "Order qty must be zero or greater");
  }
  // Reject duplicate SKUs in one submission (a line grain is per-SKU; two rows for one
  // SKU would double-order and store contradictory implied on-hand).
  const skuIds = [...new Set(lines.map((l) => l.skuId))];
  if (skuIds.length !== lines.length) {
    throw new OrderingError(400, "duplicate_sku", "A SKU appears more than once");
  }

  const sb = getServiceRoleClient();
  const now = new Date();
  const weekend = isWeekendParDay(now);

  // Load the referenced SKUs (active + par shape + pack fields for oz). A SKU missing,
  // inactive, or with no applicable par today is rejected loudly (can't order to no par).
  const { data: skuRows, error: sErr } = await sb.from("vendor_items")
    .select("id, name, vendor_id, item_number, pack_format, weekday_par, weekend_par, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("id", skuIds).eq("active", true)
    .returns<Array<{
      id: string; name: string; vendor_id: string | null; item_number: string | null;
      pack_format: string | null; weekday_par: number | string | null; weekend_par: number | string | null;
      each_container_label: string | null; units_per_pack: number | null;
      each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null;
    }>>();
  if (sErr) throw new Error(`submitParPass skus: ${sErr.message}`);
  const skuById = new Map((skuRows ?? []).map((s) => [s.id, s]));
  for (const id of skuIds) if (!skuById.has(id)) throw new OrderingError(400, "invalid_sku", "A SKU is not found or inactive");

  const [chainsBySku, measures] = await Promise.all([
    loadSkuPackChains(skuIds),
    loadMeasures(),
  ]);

  // Resolve each line: snapshot par, per-order-unit oz, implied on-hand oz.
  interface ResolvedLine {
    input: ParPassLineInput;
    sku: NonNullable<ReturnType<typeof skuById.get>>;
    parToday: number;
    orderUnitLabel: string | null;
    perUnitOz: number | null;
    impliedOnHandOz: number | null;
  }
  const resolved: ResolvedLine[] = [];
  for (const l of lines) {
    const sku = skuById.get(l.skuId)!;
    const { par } = parForDay(num(sku.weekday_par), num(sku.weekend_par), weekend);
    if (par == null) throw new OrderingError(400, "no_par", "A SKU has no par set for today");
    const chain = chainsBySku.get(sku.id) ?? null;
    const skuShape: RecipeInputSku = {
      packFormat: sku.pack_format, eachContainerLabel: sku.each_container_label,
      unitsPerPack: sku.units_per_pack, eachSize: num(sku.each_size), eachMeasure: sku.each_measure,
      avgOzPerEach: num(sku.avg_oz_per_each), packChain: chain,
    };
    const perUnitOz = perOrderUnitOz(skuShape, chain, measures);
    // implied on-hand = max(par − orderQty, 0) order units × per-unit oz. NEVER fabricate:
    // perUnitOz null → implied null (the conversion is unknowable).
    const impliedUnits = Math.max(par - l.orderQty, 0);
    const impliedOnHandOz = perUnitOz != null ? impliedUnits * perUnitOz : null;
    resolved.push({
      input: l, sku, parToday: par,
      orderUnitLabel: orderUnitLabelFor(sku.pack_format, chain),
      perUnitOz, impliedOnHandOz,
    });
  }

  // 1) Insert the event header (status submitted; append-only). House sequential pattern.
  const { data: ev, error: evErr } = await sb.from("par_pass_events").insert({
    location_id: locationId, walked_by: actor.user.id, status: "submitted", note: null,
  }).select("id").maybeSingle<{ id: string }>();
  if (evErr) throw new Error(`submitParPass event: ${evErr.message}`);
  if (!ev) throw new Error("submitParPass event returned no row");

  // 2) Insert the lines (zero-qty lines ARE stored — the explicit "we're full" observation).
  const { error: lErr } = await sb.from("par_pass_lines").insert(
    resolved.map((r) => ({
      event_id: ev.id,
      sku_id: r.sku.id,
      vendor_id: r.sku.vendor_id,
      par_qty: r.parToday, // snapshot of the day's par (order units).
      order_qty: r.input.orderQty,
      order_unit_label: r.orderUnitLabel,
      implied_on_hand_oz: r.impliedOnHandOz,
      note: r.input.note?.trim() || null,
    })),
  );
  if (lErr) throw new Error(`submitParPass lines: ${lErr.message}`);

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "par_pass.submitted", resourceTable: "par_pass_events", resourceId: ev.id,
    metadata: { location_id: locationId, line_count: resolved.length },
    ipAddress: null, userAgent: null,
  });

  // ── Draft orders: per vendor, the orderQty > 0 lines + delivery affordances ──
  const orderLines = resolved.filter((r) => r.input.orderQty > 0);
  const draftOrders = await buildDraftOrders(sb, orderLines.map((r) => ({
    vendorId: r.sku.vendor_id, vendorName: null,
    line: {
      skuName: r.sku.name, itemNumber: r.sku.item_number,
      orderQty: r.input.orderQty, orderUnitLabel: r.orderUnitLabel,
    },
  })));

  // ── Shrinkage: implied on-hand vs the CURRENT computed advisory (a loadOnHand pass) ──
  const onHandView = await loadOnHand(actor, locationId);
  const advisoryBySku = advisoryOnHandBySku(onHandView);
  const shrinkage: ShrinkageNotice[] = [];
  for (const r of resolved) {
    if (r.impliedOnHandOz == null || r.perUnitOz == null) continue; // implied side null → no compare.
    const adv = advisoryBySku.get(r.sku.id);
    if (adv == null) continue; // computed side null → no compare (advisory-null never trips).
    if (shrinkageDiverges(r.impliedOnHandOz, adv.oz, r.parToday, r.perUnitOz)) {
      shrinkage.push({ skuId: r.sku.id, skuName: r.sku.name, impliedOz: r.impliedOnHandOz, computedOz: adv.oz });
    }
  }

  return { eventId: ev.id, draftOrders, shrinkage };
}

/**
 * Group orderQty > 0 lines into per-vendor draft orders, attaching each vendor's active
 * ordering-detail delivery affordances (method/value/label, display_order). ONE batched
 * vendor-name lookup + ONE batched ordering-details query (never per-vendor). A line with
 * no vendor is dropped (can't be delivered anywhere). Vendors ordered by name.
 */
async function buildDraftOrders(
  sb: ReturnType<typeof getServiceRoleClient>,
  entries: Array<{ vendorId: string | null; vendorName: string | null; line: DraftOrderLine }>,
): Promise<DraftOrder[]> {
  const withVendor = entries.filter((e): e is { vendorId: string; vendorName: string | null; line: DraftOrderLine } => e.vendorId != null);
  if (withVendor.length === 0) return [];
  const vendorIds = [...new Set(withVendor.map((e) => e.vendorId))];

  const [{ data: vendorRows, error: vErr }, { data: detailRows, error: dErr }] = await Promise.all([
    sb.from("vendors").select("id, name").in("id", vendorIds).returns<Array<{ id: string; name: string }>>(),
    sb.from("vendor_ordering_details")
      .select("vendor_id, method, value, label, display_order")
      .in("vendor_id", vendorIds).eq("active", true)
      .order("display_order", { ascending: true })
      .returns<Array<{ vendor_id: string; method: string; value: string; label: string | null; display_order: number }>>(),
  ]);
  if (vErr) throw new Error(`buildDraftOrders vendors: ${vErr.message}`);
  if (dErr) throw new Error(`buildDraftOrders ordering details: ${dErr.message}`);
  const vName = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));
  const detailsByVendor = new Map<string, DraftOrderDelivery[]>();
  for (const d of detailRows ?? []) {
    const arr = detailsByVendor.get(d.vendor_id) ?? [];
    arr.push({ method: d.method, value: d.value, label: d.label });
    detailsByVendor.set(d.vendor_id, arr);
  }

  const linesByVendor = new Map<string, DraftOrderLine[]>();
  for (const e of withVendor) {
    const arr = linesByVendor.get(e.vendorId) ?? [];
    arr.push(e.line);
    linesByVendor.set(e.vendorId, arr);
  }

  const orders: DraftOrder[] = [];
  for (const [vendorId, orderLines] of linesByVendor) {
    orders.push({
      vendorId,
      vendorName: vName.get(vendorId) ?? "(vendor)",
      orderingDetails: detailsByVendor.get(vendorId) ?? [],
      lines: orderLines,
    });
  }
  orders.sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  return orders;
}

// ── loadShrinkageSignals: cheap read-time divergence for the mid-shift pulse ──────
/**
 * Shrinkage signal for the mid-shift pulse (Task 3 caller). The LATEST submitted
 * par-pass event within 48h at this location; recompute the divergence set for its
 * lines against the CURRENT computed on-hand (same threshold as submit). Older than
 * 48h (or no event) → count 0. KH+ read + location-bind. CHEAP: one event lookup +
 * its lines + ONE loadOnHand pass (the pulse loader budget). Persists nothing.
 */
export async function loadShrinkageSignals(
  actor: AuthContext,
  locationId: string,
): Promise<{ count: number; skus: Array<{ skuId: string; skuName: string; impliedOz: number; computedOz: number }> }> {
  requireLevel(actor, PAR_PASS_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new OrderingError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();
  const cutoffIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: ev, error: evErr } = await sb.from("par_pass_events")
    .select("id")
    .eq("location_id", locationId).eq("status", "submitted")
    .gte("walked_at", cutoffIso)
    .order("walked_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (evErr) throw new Error(`loadShrinkageSignals event: ${evErr.message}`);
  if (!ev) return { count: 0, skus: [] };

  const { data: lineRows, error: lErr } = await sb.from("par_pass_lines")
    .select("sku_id, par_qty, order_qty, implied_on_hand_oz")
    .eq("event_id", ev.id)
    .returns<Array<{ sku_id: string; par_qty: number | string | null; order_qty: number | string; implied_on_hand_oz: number | string | null }>>();
  if (lErr) throw new Error(`loadShrinkageSignals lines: ${lErr.message}`);
  const lines = (lineRows ?? []).filter((l) => num(l.implied_on_hand_oz) != null);
  if (lines.length === 0) return { count: 0, skus: [] };

  // Current computed on-hand + SKU names (batched).
  const skuIds = [...new Set(lines.map((l) => l.sku_id))];
  const [onHandView, { data: skuRows, error: nErr }] = await Promise.all([
    loadOnHand(actor, locationId),
    sb.from("vendor_items").select("id, name").in("id", skuIds).returns<Array<{ id: string; name: string }>>(),
  ]);
  if (nErr) throw new Error(`loadShrinkageSignals sku names: ${nErr.message}`);
  const advisoryBySku = advisoryOnHandBySku(onHandView);
  const skuName = new Map((skuRows ?? []).map((s) => [s.id, s.name]));

  // perUnitOz for the threshold = implied_on_hand_oz derives from it, but the row does
  // NOT store perUnitOz. Reconstruct the noise floor from the stored par + implied:
  // implied = max(par − order_qty, 0) × perUnitOz  ⇒  perUnitOz = implied / impliedUnits
  // when impliedUnits > 0 (par > order_qty). When impliedUnits == 0 (ordered ≥ par →
  // implied 0), the threshold's per-unit floor is unknowable from the row alone; use
  // 0.25 × par_oz only via the SAME implied=0 path — but par_oz is also perUnitOz-scaled.
  // Simpler + honest: recompute perUnitOz from the live SKU shape (one batched load), so
  // the threshold matches submit's exactly.
  const [chainsBySku, measures, { data: shapeRows, error: shErr }] = await Promise.all([
    loadSkuPackChains(skuIds),
    loadMeasures(),
    sb.from("vendor_items")
      .select("id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
      .in("id", skuIds)
      .returns<Array<{ id: string; pack_format: string | null; each_container_label: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>(),
  ]);
  if (shErr) throw new Error(`loadShrinkageSignals shapes: ${shErr.message}`);
  const shapeById = new Map((shapeRows ?? []).map((s) => [s.id, s]));

  const out: Array<{ skuId: string; skuName: string; impliedOz: number; computedOz: number }> = [];
  for (const l of lines) {
    const impliedOz = num(l.implied_on_hand_oz);
    const parToday = num(l.par_qty);
    if (impliedOz == null || parToday == null) continue; // need both for the threshold.
    const adv = advisoryBySku.get(l.sku_id);
    if (adv == null) continue; // computed side null → no compare.
    const shape = shapeById.get(l.sku_id);
    const chain = chainsBySku.get(l.sku_id) ?? null;
    const perUnitOz = shape
      ? perOrderUnitOz({
          packFormat: shape.pack_format, eachContainerLabel: shape.each_container_label,
          unitsPerPack: shape.units_per_pack, eachSize: num(shape.each_size), eachMeasure: shape.each_measure,
          avgOzPerEach: num(shape.avg_oz_per_each), packChain: chain,
        }, chain, measures)
      : null;
    if (perUnitOz == null) continue; // no per-unit oz → can't compute the threshold.
    if (shrinkageDiverges(impliedOz, adv.oz, parToday, perUnitOz)) {
      out.push({ skuId: l.sku_id, skuName: skuName.get(l.sku_id) ?? "(sku)", impliedOz, computedOz: adv.oz });
    }
  }
  return { count: out.length, skus: out };
}

// ── History: recent par-passes + one detail (re-display draft orders) ────────────
export interface ParPassSummary {
  eventId: string;
  walkedAt: string;
  walkedByName: string | null;
  lineCount: number;
}

/**
 * Recent submitted par-pass events at a location (KH+ read + location-bind), newest
 * first. Batches the walker-name + line-count lookups (never per-event).
 */
export async function loadRecentParPasses(
  actor: AuthContext,
  locationId: string,
  limit = 10,
): Promise<ParPassSummary[]> {
  requireLevel(actor, PAR_PASS_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new OrderingError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();
  const { data: events, error } = await sb.from("par_pass_events")
    .select("id, walked_at, walked_by")
    .eq("location_id", locationId)
    .order("walked_at", { ascending: false })
    .limit(limit)
    .returns<Array<{ id: string; walked_at: string; walked_by: string }>>();
  if (error) throw new Error(`loadRecentParPasses: ${error.message}`);
  const list = events ?? [];
  if (list.length === 0) return [];

  const eventIds = list.map((e) => e.id);
  const userIds = [...new Set(list.map((e) => e.walked_by))];
  const [{ data: us }, { data: lineRows }] = await Promise.all([
    sb.from("users").select("id, name").in("id", userIds).returns<Array<{ id: string; name: string }>>(),
    sb.from("par_pass_lines").select("event_id").in("event_id", eventIds).returns<Array<{ event_id: string }>>(),
  ]);
  const uName = new Map((us ?? []).map((u) => [u.id, u.name]));
  const lineCount = new Map<string, number>();
  for (const l of lineRows ?? []) lineCount.set(l.event_id, (lineCount.get(l.event_id) ?? 0) + 1);

  return list.map((e) => ({
    eventId: e.id,
    walkedAt: e.walked_at,
    walkedByName: uName.get(e.walked_by) ?? null,
    lineCount: lineCount.get(e.id) ?? 0,
  }));
}

export interface ParPassDetail {
  eventId: string;
  locationId: string;
  walkedAt: string;
  walkedByName: string | null;
  note: string | null;
  lines: Array<{
    skuId: string;
    skuName: string;
    itemNumber: string | null;
    parQty: number | null;
    orderQty: number;
    orderUnitLabel: string | null;
    impliedOnHandOz: number | null;
    note: string | null;
  }>;
  /** Reconstructed draft orders for re-display (orderQty > 0 lines, per vendor). */
  draftOrders: DraftOrder[];
}

/**
 * One par-pass event's full detail (KH+ read; location-bind via the event's OWN
 * location_id — IDOR). Returns the stored lines + the reconstructed draft orders (the
 * same per-vendor shape submit returned, so the UI re-displays the delivery affordances).
 */
export async function loadParPassDetail(actor: AuthContext, eventId: string): Promise<ParPassDetail> {
  requireLevel(actor, PAR_PASS_MIN);
  const sb = getServiceRoleClient();
  const { data: ev, error: evErr } = await sb.from("par_pass_events")
    .select("id, location_id, walked_at, walked_by, note")
    .eq("id", eventId)
    .maybeSingle<{ id: string; location_id: string; walked_at: string; walked_by: string; note: string | null }>();
  if (evErr) throw new Error(`loadParPassDetail event: ${evErr.message}`);
  if (!ev) throw new OrderingError(404, "not_found", "Par-pass not found");
  if (!lockLocationContext(actorLoc(actor), ev.location_id)) {
    throw new OrderingError(404, "not_found", "Par-pass not found");
  }

  const { data: lineRows, error: lErr } = await sb.from("par_pass_lines")
    .select("sku_id, vendor_id, par_qty, order_qty, order_unit_label, implied_on_hand_oz, note")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true })
    .returns<Array<{ sku_id: string; vendor_id: string | null; par_qty: number | string | null; order_qty: number | string; order_unit_label: string | null; implied_on_hand_oz: number | string | null; note: string | null }>>();
  if (lErr) throw new Error(`loadParPassDetail lines: ${lErr.message}`);
  const rows = lineRows ?? [];

  const skuIds = [...new Set(rows.map((r) => r.sku_id))];
  const [{ data: skus }, { data: walker }] = await Promise.all([
    skuIds.length
      ? sb.from("vendor_items").select("id, name, item_number").in("id", skuIds).returns<Array<{ id: string; name: string; item_number: string | null }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; item_number: string | null }> }),
    sb.from("users").select("name").eq("id", ev.walked_by).maybeSingle<{ name: string }>(),
  ]);
  const skuById = new Map((skus ?? []).map((s) => [s.id, s]));

  const lines = rows.map((r) => {
    const sku = skuById.get(r.sku_id);
    return {
      skuId: r.sku_id,
      skuName: sku?.name ?? "(sku)",
      itemNumber: sku?.item_number ?? null,
      parQty: num(r.par_qty),
      orderQty: num(r.order_qty) ?? 0,
      orderUnitLabel: r.order_unit_label,
      impliedOnHandOz: num(r.implied_on_hand_oz),
      note: r.note,
    };
  });

  // Reconstruct the draft orders (orderQty > 0), reusing the stored per-line shape so
  // the delivery affordances re-render exactly as at submit time.
  const draftOrders = await buildDraftOrders(
    sb,
    rows
      .filter((r) => (num(r.order_qty) ?? 0) > 0)
      .map((r) => {
        const sku = skuById.get(r.sku_id);
        return {
          vendorId: r.vendor_id, vendorName: null,
          line: {
            skuName: sku?.name ?? "(sku)", itemNumber: sku?.item_number ?? null,
            orderQty: num(r.order_qty) ?? 0, orderUnitLabel: r.order_unit_label,
          },
        };
      }),
  );

  return {
    eventId: ev.id,
    locationId: ev.location_id,
    walkedAt: ev.walked_at,
    walkedByName: walker?.name ?? null,
    note: ev.note,
    lines,
    draftOrders,
  };
}
