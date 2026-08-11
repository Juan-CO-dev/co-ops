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
import { selectAllRows } from "@/lib/supabase-paginate";
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
import { loadOnHandDerived, type OnHandRow } from "@/lib/counts";
import { etBusinessDate } from "@/lib/counts-shared";
import { resolvePar, resolveActive, type LocationSkuOverlay } from "@/lib/location-sku-shared";
import {
  createDraftsFromLines,
  PurchaseOrderError,
  type CreatedDraft,
  type DraftLineInput,
} from "@/lib/purchase-orders";
import { etCalendarDate, etYmdMinusDays, operationalDayUtcRange } from "@/lib/operational-day";
import { etDayFromDate } from "@/lib/et-day-shared";
import { formatTime } from "@/lib/i18n/format";

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

/**
 * ET-anchored walk-day derivation — the SINGLE authority for both loadWalkerData and
 * submitParPass. Vercel runs UTC, and evening walks (exactly when shops order) must not
 * roll into tomorrow's weekday. etBusinessDate gives the ET calendar date; the dow +
 * weekend-par flag derive from it via the shared lib/et-day-shared.etDayFromDate (the
 * ONE home for that derivation — purchase-orders.ts's etToday delegates to the same
 * helper, no import cycle). Both functions MUST use this helper — never inline a
 * new Date().getDay() in day-rule context.
 */
function etWalkDay(): { walkDateEt: string; weekend: boolean; todayDow: number } {
  const walkDateEt = etBusinessDate(new Date().toISOString());
  const { dow: todayDow, weekend } = etDayFromDate(walkDateEt);
  return { walkDateEt, weekend, todayDow };
}

// ── Cutoff matching (MIRRORS lib/purchase-orders.ts resolveGoverningCutoffIso, which is
// private there — the plan authorizes mirroring the exact approach) ──────────────────────
/**
 * The UTC instant of an ET wall-clock TIME (bare "HH:MM[:SS]") on an ET calendar date, as
 * an ISO timestamptz — byte-identical derivation to purchase-orders.ts etWallClockToUtcIso:
 * operationalDayUtcRange(dateEt).startIso (ET-midnight-as-UTC, DST-correct) + the cutoff's
 * seconds-of-day. The offset is fixed for the whole ET day (DST never flips mid-day). Returns
 * null on a malformed time (advisory — never fabricate a deadline).
 */
function cutoffWallClockToUtcIso(dateEt: string, time: string): string | null {
  const parts = time.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? "0");
  const s = Number(parts[2] ?? "0");
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  if (!Number.isFinite(m) || m < 0 || m > 59) return null;
  if (!Number.isFinite(s) || s < 0 || s > 59) return null;
  const { startIso } = operationalDayUtcRange(dateEt);
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;
  return new Date(startMs + (h * 3600 + Math.floor(m) * 60 + Math.floor(s)) * 1000).toISOString();
}

/**
 * Pick the GOVERNING cutoff row from a vendor's matched rows (location null-or-match, active,
 * today's ET dow) — mirrors purchase-orders.ts resolveGoverningCutoffIso's tiebreak EXACTLY:
 * a location-scoped row beats a both-shops row (most specific), then the EARLIEST cutoff_time
 * governs (the binding deadline; bare "HH:MM[:SS]" sorts lexically). Returns the bare time
 * string, or null when no row matches. Pure over the passed rows.
 */
function governingCutoffTime(
  rows: Array<{ location_id: string | null; cutoff_time: string }>,
  locationId: string,
): string | null {
  if (rows.length === 0) return null;
  const scoped = rows.filter((r) => r.location_id === locationId);
  const pool = scoped.length > 0 ? scoped : rows;
  pool.sort((a, b) => a.cutoff_time.localeCompare(b.cutoff_time));
  return pool[0]?.cutoff_time ?? null;
}

/**
 * All active cutoffs for a vendor set on today's ET dow, keyed by vendorId → the matched rows
 * (location null-or-match). ONE batched query (never per-vendor). Empty map = day-one (no
 * cutoffs configured → walker chips + attention are silent, per spec §7 additive rollout).
 */
async function loadCutoffsByVendor(
  sb: ReturnType<typeof getServiceRoleClient>,
  vendorIds: string[],
  locationId: string,
  dow: number,
): Promise<Map<string, Array<{ location_id: string | null; cutoff_time: string }>>> {
  const out = new Map<string, Array<{ location_id: string | null; cutoff_time: string }>>();
  if (vendorIds.length === 0) return out;
  const { data, error } = await sb.from("vendor_cutoffs")
    .select("vendor_id, location_id, cutoff_time")
    .in("vendor_id", vendorIds).eq("active", true).eq("order_day", dow)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .returns<Array<{ vendor_id: string; location_id: string | null; cutoff_time: string }>>();
  if (error) throw new Error(`loadCutoffsByVendor: ${error.message}`);
  for (const r of data ?? []) {
    const arr = out.get(r.vendor_id) ?? [];
    arr.push({ location_id: r.location_id, cutoff_time: r.cutoff_time });
    out.set(r.vendor_id, arr);
  }
  return out;
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

  // BOTH production reads are PAGED (the PR #63 lesson): 30 days of productions and
  // their inputs each overrun the 1000-row cap, and a truncated page would silently
  // drop usage from the rank. `id` (the PK) gives the stable total order paging needs;
  // both reads are order-insensitive sums.
  const prodHdrs = await selectAllRows<{ id: string }>(
    async (from, to) => {
      const { data, error } = await sb.from("productions")
        .select("id")
        .eq("location_id", locationId)
        .is("superseded_at", null).is("revoked_at", null)
        .gt("produced_at", cutoffIso)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ id: string }>>();
      if (error) throw new Error(`loadSkuUsageRank productions: ${error.message}`);
      return { data };
    },
  );
  const prodIds = prodHdrs.map((h) => h.id);
  if (prodIds.length > 0) {
    const inputs = await selectAllRows<{ input_sku_id: string; input_oz: number | string | null }>(
      async (from, to) => {
        const { data, error } = await sb.from("production_inputs")
          .select("input_sku_id, input_oz")
          .in("production_id", prodIds)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<Array<{ input_sku_id: string; input_oz: number | string | null }>>();
        if (error) throw new Error(`loadSkuUsageRank production_inputs: ${error.message}`);
        return { data };
      },
    );
    for (const r of inputs) add(r.input_sku_id, num(r.input_oz) ?? 0);
  }

  // 30 days at (location, business_date, sku) grain overruns PostgREST's 1000-row
  // default cap, and an unordered truncated page would silently drop usage from the
  // rank (the PR #63 lesson) — page it under a stable total order (`id`, the PK).
  const sales = await selectAllRows<{ sku_id: string; direct_oz: number | string }>(
    async (from, to) => {
      const { data, error } = await sb.from("toast_daily_depletion")
        .select("sku_id, direct_oz")
        .eq("location_id", locationId)
        .gte("business_date", cutoffDate)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ sku_id: string; direct_oz: number | string }>>();
      if (error) throw new Error(`loadSkuUsageRank toast_daily_depletion: ${error.message}`);
      return { data };
    },
  );
  for (const r of sales) add(r.sku_id, num(r.direct_oz) ?? 0);

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
  /**
   * Is the order-unit→oz conversion DERIVABLE for this SKU (perOrderUnitOz non-null
   * AND > 0)? DISPLAY-ONLY — nothing in the walk math, filtering, or submit reads it.
   *
   * False is a CHRONIC state, not an alert: without a per-order-unit oz this SKU can
   * never anchor an on-hand estimate and never earns a Suggest chip, so both hints go
   * silently missing (the council's mute-face finding). The row renders a muted
   * "no weight set" microcopy so the absence is EXPLAINED rather than unexplained.
   *
   * Gate note: this mirrors the `orderUnits`/`suggestedQty` gate below (`> 0`), NOT the
   * marginally looser submit-side gate (`!= null`, line ~762) that decides whether a
   * walk line stores implied_on_hand_oz. They differ only for a pathological perUnitOz
   * === 0, where an implied "0 oz" would be stored but is not a usable estimate and
   * still yields no chip — so `> 0` is the condition that makes the hint's claim true
   * in every case.
   */
  canImplyOz: boolean;
}
export interface WalkerVendor {
  vendorId: string;
  name: string;
  /** True when TODAY (server local getDay) is one of the vendor's order_days. */
  isOrderDay: boolean;
  /** The governing cutoff time for TODAY (ET dow), formatted "h:mm AM/PM" via the
   *  house formatter — null when no active cutoff governs today. Rendered as a chip
   *  on the vendor section header ("cutoff {time}"). */
  cutoffTimeToday: string | null;
  /** True when today's cutoff is within 2h of now (ET) — warn tone on the chip.
   *  Computed server-side so the client renders tone without any time math. */
  cutoffSoon: boolean;
  skus: WalkerSku[];
}
export interface WalkerData {
  /** The walk date (server local). Its getDay drives the weekend-par rule + isOrderDay. */
  walkDate: string; // ISO
  isWeekendPar: boolean;
  /**
   * Has the sales-depletion ledger materialized before but NOT yet caught up through
   * YESTERDAY? (onHandView.salesThrough < yesterday-ET.) During that window the
   * consumed term of every advisory on-hand is missing its most recent day, so
   * estimates and Suggest chips are stale-or-absent BY DESIGN — the nightly
   * toast-sales-pull cron (09:00 UTC ≈ 5 AM ET) materializes T-1 and they return.
   *
   * DORMANT ≠ BROKEN: salesThrough == null (Toast never materialized at all) is FALSE
   * here — a shop that has never had a sales feed is not "paused", and claiming
   * otherwise would invent a fault. Display-only; changes no math (the advisory stays
   * honestly null/stale — this flag only lets the UI SAY why).
   */
  advisoryPaused: boolean;
  vendors: WalkerVendor[];
}

/**
 * Load the par-pass walker payload for a location (KH+ + location-bind). Vendors with
 * ≥1 active par'd SKU, ordered isOrderDay-first then name; each vendor's SKUs ordered
 * by usage rank desc then name. A SKU is INCLUDED iff it is active, carries a vendor,
 * and has weekday_par OR weekend_par set (resolvePar in location-sku-shared resolves which applies today, overlay-first).
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
  // ET-anchored walk day (single authority — etWalkDay()). Never inline this derivation
  // again; all day-rule consumers must call etWalkDay() to stay in sync with the display.
  const { walkDateEt, weekend, todayDow } = etWalkDay();

  // Par'd SKUs (global rows; item spine is location-scoped via the ledgers, not the
  // vendor_items row — same as counts/receiving). A SKU with neither par is excluded.
  // NOTE: we do NOT filter `.eq("active", true)` here — inclusion is governed by
  // resolveActive(overlay.activeOverride, s.active) below, so a promotional overlay
  // (active_override = true on a globally-INACTIVE SKU, spec §2.1) surfaces. Filtering
  // on the global flag first would make that override dead. `active` is selected.
  const { data: skuRows, error: sErr } = await sb.from("vendor_items")
    .select("id, name, vendor_id, item_number, active, pack_format, weekday_par, weekend_par, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .or("weekday_par.not.is.null,weekend_par.not.is.null")
    .returns<Array<{
      id: string; name: string; vendor_id: string | null; item_number: string | null; active: boolean;
      pack_format: string | null; weekday_par: number | string | null; weekend_par: number | string | null;
      each_container_label: string | null; units_per_pack: number | null;
      each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null;
    }>>();
  if (sErr) throw new Error(`loadWalkerData skus: ${sErr.message}`);
  const skus = (skuRows ?? []).filter((s) => s.vendor_id != null); // a par'd SKU with no
  // vendor can't be ordered from anyone → excluded (schema allows null vendor_id, live
  // data has none; defensive).
  if (skus.length === 0) {
    // No par'd SKUs anywhere → we return BEFORE the loadOnHand batch below, so
    // salesThrough is unknown here. Can't-know → don't claim: false (there is also no
    // walker row for a blackout banner to explain).
    return { walkDate: walkDateEt, isWeekendPar: weekend, advisoryPaused: false, vendors: [] };
  }
  const skuIds = skus.map((s) => s.id);
  const vendorIds = [...new Set(skus.map((s) => s.vendor_id as string))];

  // BATCH loads (one each — loadRecipeGraph law).
  // overlayBySku: per-location active/par overrides; empty map = day-one (pure inheritance).
  const [chainsBySku, measures, usageBySku, onHandView, { data: vendorRows, error: vErr }, lastOrderBySku, overlayBySku, cutoffsByVendor] =
    await Promise.all([
      loadSkuPackChains(skuIds),
      loadMeasures(),
      loadSkuUsageRank(sb, locationId),
      loadOnHandDerived(actor, locationId), // ONE advisory on-hand pass for the whole location.
      sb.from("vendors").select("id, name, order_days").in("id", vendorIds).eq("active", true)
        .returns<Array<{ id: string; name: string; order_days: number[] | null }>>(),
      loadLatestOrderQtyBySku(sb, skuIds),
      loadOverlayBySku(sb, locationId),
      loadCutoffsByVendor(sb, vendorIds, locationId, todayDow),
    ]);
  if (vErr) throw new Error(`loadWalkerData vendors: ${vErr.message}`);
  const vendorById = new Map((vendorRows ?? []).map((v) => [v.id, v]));
  const advisoryBySku = advisoryOnHandBySku(onHandView);

  // Advisory blackout (council UX finding 2026-08-08): the depletion ledger lags the
  // register by a day — the nightly cron materializes T-1. If it has materialized
  // BEFORE but its latest business_date is older than yesterday, last night's run
  // hasn't landed yet, so the advisory feed is mid-refresh and the walker's estimates
  // + Suggest chips are thin for reasons that have nothing to do with the shelf.
  // `< yesterday` is the exact complement of what the cron writes
  // (app/api/cron/toast-sales-pull: materializes etYmdMinusDays(etCalendarDate(now), 1)).
  // null salesThrough = Toast never materialized here = DORMANT, not paused → false.
  const yesterdayEt = etYmdMinusDays(etCalendarDate(new Date().toISOString()), 1);
  const advisoryPaused =
    onHandView.salesThrough != null && onHandView.salesThrough < yesterdayEt;

  // Build a per-SKU WalkerSku, grouped under its (active) vendor.
  const skusByVendor = new Map<string, WalkerSku[]>();
  for (const s of skus) {
    const vendorId = s.vendor_id as string;
    if (!vendorById.has(vendorId)) continue; // vendor inactive/missing → SKU dropped with it.
    // Resolve active + par through the per-location overlay (D1). Day-one: no overlay rows →
    // resolveActive/resolvePar reduce to the global values, byte-identical to prior behavior.
    const overlayRow = overlayBySku.get(s.id) ?? null;
    const overlayForPar: LocationSkuOverlay | null = overlayRow
      ? { weekdayPar: overlayRow.weekdayPar, weekendPar: overlayRow.weekendPar }
      : null;
    // Inclusion governed by the overlay-over-global active resolution (D1): an overlay
    // active_override wins over the global `active` flag — so a promotional SKU
    // (override true, globally inactive) is INCLUDED and a locally-deactivated SKU
    // (override false, globally active) is EXCLUDED. Global inactive + no override → excluded.
    if (!resolveActive(overlayRow?.activeOverride, s.active)) continue;
    const par = resolvePar(overlayForPar, { weekdayPar: num(s.weekday_par), weekendPar: num(s.weekend_par) }, weekend);
    if (par == null) continue; // neither resolved par applies today (excluded from walk).

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

    // parIsWeekend: true when the resolved par came from the weekend_par slot. Mirrors
    // The day rule (weekend pair member w/ weekday fallback) applied to already-resolved values.
    const resolvedWeekendPar = overlayForPar?.weekendPar ?? num(s.weekend_par);
    const parIsWeekend = weekend && resolvedWeekendPar != null;
    const row: WalkerSku = {
      skuId: s.id,
      name: s.name,
      itemNumber: s.item_number,
      orderUnitLabel: orderUnitLabelFor(s.pack_format, chain),
      parToday: par,
      parIsWeekend,
      lastOrderQty: lastOrderBySku.get(s.id) ?? null,
      advisoryOnHand,
      suggestedQty,
      // Display-only (see WalkerSku.canImplyOz): same gate as orderUnits above, so the
      // row can explain a permanently absent estimate/chip instead of just showing none.
      canImplyOz: perUnitOz != null && perUnitOz > 0,
    };
    const arr = skusByVendor.get(vendorId) ?? [];
    arr.push(row);
    skusByVendor.set(vendorId, arr);
  }

  // Assemble vendor groups: usage desc then name within a vendor; vendors isOrderDay-first
  // then name; vendors with zero par'd SKUs omitted (skusByVendor never holds an empty arr).
  // The cutoff chip: today's governing cutoff time (formatted via the house formatter) + a
  // server-computed cutoffSoon (within 2h of now) so the client renders tone without time math.
  const nowMs = Date.now();
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const vendors: WalkerVendor[] = [];
  for (const [vendorId, vendorSkus] of skusByVendor) {
    const v = vendorById.get(vendorId)!;
    vendorSkus.sort((a, b) => {
      const ua = usageBySku.get(a.skuId) ?? -Infinity; // null usage sorts last.
      const ub = usageBySku.get(b.skuId) ?? -Infinity;
      if (ua !== ub) return ub - ua; // usage desc.
      return a.name.localeCompare(b.name);
    });
    // Cutoff for today (most-specific-wins, earliest-time — mirrors purchase-orders.ts).
    const cutoffBare = governingCutoffTime(cutoffsByVendor.get(vendorId) ?? [], locationId);
    let cutoffTimeToday: string | null = null;
    let cutoffSoon = false;
    if (cutoffBare != null) {
      const cutoffIso = cutoffWallClockToUtcIso(walkDateEt, cutoffBare);
      if (cutoffIso != null) {
        // Format the bare TIME through the house formatter (operational TZ + language-aware)
        // by composing it onto today's ET instant. formatTime → "h:mm AM/PM".
        cutoffTimeToday = formatTime(cutoffIso, actor.user.language);
        const cutoffMs = Date.parse(cutoffIso);
        // "Soon" = the deadline is in the future AND within 2h (a passed cutoff is not "soon").
        cutoffSoon = Number.isFinite(cutoffMs) && cutoffMs >= nowMs && cutoffMs - nowMs <= TWO_HOURS_MS;
      }
    }
    vendors.push({
      vendorId,
      name: v.name,
      isOrderDay: (v.order_days ?? []).includes(todayDow),
      cutoffTimeToday,
      cutoffSoon,
      skus: vendorSkus,
    });
  }
  vendors.sort((a, b) => {
    if (a.isOrderDay !== b.isOrderDay) return a.isOrderDay ? -1 : 1; // order-day vendors first.
    return a.name.localeCompare(b.name);
  });

  return { walkDate: walkDateEt, isWeekendPar: weekend, advisoryPaused, vendors };
}

/**
 * The latest (by created_at) par_pass_lines.order_qty per SKU — one batched, PAGED
 * scan over the sku_ix (sku_id, created_at desc; never per-SKU I/O). We pull the
 * rows for the SKU set and keep the FIRST seen per SKU in created_at-desc order
 * (the latest).
 */
async function loadLatestOrderQtyBySku(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  // PAGED (the PR #63 lesson): par_pass_lines grows one row per SKU per walk, so the
  // desc scan loses its tail past 1000 rows — and the tail is where a rarely-walked
  // SKU's only line lives. `id` is a tiebreaker ONLY (created_at stays the primary
  // sort key), making the order total so page boundaries can't reshuffle rows.
  const rows = await selectAllRows<{ sku_id: string; order_qty: number | string; created_at: string }>(
    async (from, to) => {
      const { data, error } = await sb.from("par_pass_lines")
        .select("sku_id, order_qty, created_at")
        .in("sku_id", skuIds)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
        .returns<Array<{ sku_id: string; order_qty: number | string; created_at: string }>>();
      if (error) throw new Error(`loadLatestOrderQtyBySku: ${error.message}`);
      return { data };
    },
  );
  for (const r of rows) {
    if (out.has(r.sku_id)) continue; // desc order → first seen is the latest.
    const q = num(r.order_qty);
    if (q != null) out.set(r.sku_id, q);
  }
  return out;
}

// ── Location SKU overlay batch-load ─────────────────────────────────────────────
/**
 * One query: all location_sku_settings rows for a location, keyed by sku_id.
 * Returns an empty map when no overlay rows exist (day-one behavior — pure inheritance).
 * BATCH LAW: one query per loadWalkerData / submitParPass call; never per-SKU.
 */
async function loadOverlayBySku(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<Map<string, { activeOverride: boolean | null; weekdayPar: number | null; weekendPar: number | null }>> {
  const { data, error } = await sb.from("location_sku_settings")
    .select("sku_id, active_override, weekday_par, weekend_par")
    .eq("location_id", locationId)
    .returns<Array<{
      sku_id: string;
      active_override: boolean | null;
      weekday_par: number | string | null;
      weekend_par: number | string | null;
    }>>();
  if (error) throw new Error(`loadOverlayBySku: ${error.message}`);
  const out = new Map<string, { activeOverride: boolean | null; weekdayPar: number | null; weekendPar: number | null }>();
  for (const r of data ?? []) {
    out.set(r.sku_id, {
      activeOverride: r.active_override,
      weekdayPar: num(r.weekday_par),
      weekendPar: num(r.weekend_par),
    });
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
  /** The birthed draft PO's display code for this vendor (spec §5b.3) — rendered as
   *  the first line of the copy/mailto body ("PO {displayCode}"). null when draft-PO
   *  creation failed (walk still succeeded — poError on the submit response). */
  displayCode: string | null;
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
): Promise<{
  eventId: string;
  draftOrders: DraftOrder[];
  shrinkage: ShrinkageNotice[];
  /** The birthed draft POs (one per vendor with orderQty > 0 lines). Empty when
   *  nothing was ordered OR draft-PO creation failed (poError true). */
  pos: Array<{ vendorId: string; poId: string; displayCode: string }>;
  /** True when draft-PO creation threw — the par-pass (observation data) is still
   *  saved; the manager can re-generate drafts from the cutoff path. */
  poError: boolean;
}> {
  requireLevel(actor, PAR_PASS_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new OrderingError(404, "not_found", "Location not found");
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new OrderingError(400, "no_lines", "At least one line is required");
  }
  for (const l of lines) {
    if (typeof l.skuId !== "string" || !l.skuId) throw new OrderingError(400, "invalid_sku", "Each line needs a SKU");
    // Fractional order_qty is TOLERATED by design: seeded pars are fractional (e.g.
    // 0.25 jug) and submit must accept the matching fractional input without rounding.
    if (!Number.isFinite(l.orderQty) || l.orderQty < 0) throw new OrderingError(400, "invalid_qty", "Order qty must be zero or greater");
  }
  // Reject duplicate SKUs in one submission (a line grain is per-SKU; two rows for one
  // SKU would double-order and store contradictory implied on-hand).
  const skuIds = [...new Set(lines.map((l) => l.skuId))];
  if (skuIds.length !== lines.length) {
    throw new OrderingError(400, "duplicate_sku", "A SKU appears more than once");
  }

  const sb = getServiceRoleClient();
  // ET-anchored weekend rule — must match what loadWalkerData showed the manager.
  const { weekend } = etWalkDay();

  // Load the referenced SKUs (par shape + pack fields for oz + the global `active` flag).
  // We do NOT filter `.eq("active", true)` here — resolveActive(overlay.activeOverride,
  // sku.active) below governs each SKU's usability, so a promotional overlay (active_override
  // = true on a globally-inactive SKU, spec §2.1) is submittable while a locally-deactivated
  // SKU is rejected. A SKU row simply MISSING (bad id) is still rejected loudly. overlayBySku
  // batch-loads per-location active/par overrides (D1); empty map = day-one (pure inheritance).
  const { data: skuRows, error: sErr } = await sb.from("vendor_items")
    .select("id, name, vendor_id, item_number, active, pack_format, weekday_par, weekend_par, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("id", skuIds)
    .returns<Array<{
      id: string; name: string; vendor_id: string | null; item_number: string | null; active: boolean;
      pack_format: string | null; weekday_par: number | string | null; weekend_par: number | string | null;
      each_container_label: string | null; units_per_pack: number | null;
      each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null;
    }>>();
  if (sErr) throw new Error(`submitParPass skus: ${sErr.message}`);
  const skuById = new Map((skuRows ?? []).map((s) => [s.id, s]));
  for (const id of skuIds) if (!skuById.has(id)) throw new OrderingError(400, "invalid_sku", "A SKU is not found or inactive");

  const [chainsBySku, measures, overlayBySku] = await Promise.all([
    loadSkuPackChains(skuIds),
    loadMeasures(),
    loadOverlayBySku(sb, locationId),
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
    // Resolve active + par through the per-location overlay (D1). A SKU deactivated at this
    // location is rejected just like a globally inactive one (can't order a deactivated SKU).
    const overlayRow = overlayBySku.get(sku.id) ?? null;
    // Overlay-over-global active resolution (D1): a promotional override (true on a
    // globally-inactive SKU) is submittable; a locally-deactivated one (override false)
    // is rejected just like a globally inactive SKU with no override.
    if (!resolveActive(overlayRow?.activeOverride, sku.active)) {
      throw new OrderingError(400, "invalid_sku", "A SKU is not found or inactive");
    }
    const overlayForPar: LocationSkuOverlay | null = overlayRow
      ? { weekdayPar: overlayRow.weekdayPar, weekendPar: overlayRow.weekendPar }
      : null;
    const par = resolvePar(overlayForPar, { weekdayPar: num(sku.weekday_par), weekendPar: num(sku.weekend_par) }, weekend);
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

  // ── Draft-PO birth (spec D2): group the orderQty > 0 lines by vendor and create one
  // `draft` PO per vendor. THE WALK IS SACRED: a PurchaseOrderError (or any throw) must
  // NOT lose the par-pass — the observation rows are already committed above. We wrap the
  // birth, log the failure, and return pos: [] with poError true; the manager re-generates
  // drafts from the cutoff path. On success, each vendor's display code threads into the
  // draft card + copy/mailto body ("PO {displayCode}"). ──
  const orderLines = resolved.filter((r) => r.input.orderQty > 0);
  const byVendor = new Map<string, DraftLineInput[]>();
  for (const r of orderLines) {
    const vid = r.sku.vendor_id;
    if (vid == null) continue; // a line with no vendor can't be ordered (never a PO).
    const arr = byVendor.get(vid) ?? [];
    arr.push({
      skuId: r.sku.id,
      orderQty: r.input.orderQty,
      orderUnitLabel: r.orderUnitLabel,
      note: r.input.note ?? null,
    });
    byVendor.set(vid, arr);
  }
  let pos: CreatedDraft[] = [];
  let poError = false;
  if (byVendor.size > 0) {
    try {
      pos = await createDraftsFromLines(actor, locationId, byVendor, ev.id);
    } catch (err) {
      // The par-pass is already persisted (event + lines above). A draft-PO failure is
      // isolated: log, flag poError, keep going — the walk's data is never poisoned. Both
      // PurchaseOrderError (typed lifecycle rejects, e.g. display_code_exhausted) and any
      // unexpected throw are swallowed here; the manager re-generates via the cutoff path.
      poError = true;
      const kind = err instanceof PurchaseOrderError ? `PurchaseOrderError(${err.code})` : "error";
      console.error(`submitParPass draft-PO creation failed [${kind}]`, err);
    }
  }
  const displayCodeByVendor = new Map(pos.map((p) => [p.vendorId, p.displayCode]));

  // ── Draft orders: per vendor, the orderQty > 0 lines + delivery affordances + PO code ──
  const draftOrders = await buildDraftOrders(sb, orderLines.map((r) => ({
    vendorId: r.sku.vendor_id, vendorName: null,
    line: {
      skuName: r.sku.name, itemNumber: r.sku.item_number,
      orderQty: r.input.orderQty, orderUnitLabel: r.orderUnitLabel,
    },
  })), displayCodeByVendor);

  // ── Shrinkage: implied on-hand vs the CURRENT computed advisory (a loadOnHand pass) ──
  const onHandView = await loadOnHandDerived(actor, locationId);
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

  return {
    eventId: ev.id,
    draftOrders,
    shrinkage,
    pos: pos.map((p) => ({ vendorId: p.vendorId, poId: p.poId, displayCode: p.displayCode })),
    poError,
  };
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
  displayCodeByVendor?: Map<string, string>,
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
      displayCode: displayCodeByVendor?.get(vendorId) ?? null,
    });
  }
  orders.sort((a, b) => a.vendorName.localeCompare(b.vendorName));
  return orders;
}

// ── loadShrinkageSignals: cheap read-time divergence for the mid-shift pulse ──────
/**
 * Shrinkage signal for the mid-shift pulse (Task 3 caller). The LATEST submitted
 * par-pass event within 72h at this location; recompute the divergence set for its
 * lines against the CURRENT computed on-hand (same threshold as submit). Older than
 * 72h (or no event) → count 0. KH+ read + location-bind. CHEAP: one event lookup +
 * its lines + ONE loadOnHand pass (the pulse loader budget). Persists nothing.
 *
 * 72h (not 48h): a Friday-evening walk must still surface on Monday morning. The
 * Friday→Monday gap is ~60h at worst; 72h clears it with a comfortable buffer.
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
  // 72h window: Friday-evening walks must still surface on Monday morning (the
  // Friday→Monday gap is ~60h; 72h clears it with a comfortable buffer).
  const cutoffIso = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

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
    loadOnHandDerived(actor, locationId),
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

// ── generateDraftForVendor: a walk-less draft PO from suggested qtys (cutoff path) ────────
/**
 * Build one `draft` PO for a single vendor from the walker's suggestedQty — the cutoff
 * surfacing "generate draft now" affordance (spec §3). Reuses loadWalkerData's internals
 * (all the per-location overlay + flatten + advisory machinery) scoped to ONE vendor: each
 * suggestable SKU (suggestedQty != null AND > 0) becomes an order line at its suggested qty.
 * SKUs with a null suggestion are skipped (no fabricated qty — A3).
 *
 *   409 `no_suggestions` — the vendor has zero suggestable SKUs today (nothing to draft).
 *   409 `po_exists`      — a draft/confirmed PO already exists TODAY (ET) for this vendor
 *                          (regenerating would duplicate the day's order).
 *
 * KH+ + location-bind (both enforced by loadWalkerData's own gate and createDraftsFromLines).
 * Returns the created PO's id + display code. Append-only (createDraftsFromLines audits the
 * batch as source cutoff_draft — parPassEventId null).
 */
export async function generateDraftForVendor(
  actor: AuthContext,
  locationId: string,
  vendorId: string,
): Promise<{ poId: string; displayCode: string }> {
  requireLevel(actor, PAR_PASS_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new OrderingError(404, "not_found", "Location not found");
  }
  if (typeof vendorId !== "string" || !vendorId) {
    throw new OrderingError(400, "invalid_vendor", "A vendor is required");
  }
  const sb = getServiceRoleClient();

  // A draft/confirmed PO already today for this vendor at this location → don't duplicate.
  const { walkDateEt: dateEt } = etWalkDay();
  const { startIso, endExclusiveIso } = operationalDayUtcRange(dateEt);
  const { data: existing, error: exErr } = await sb.from("purchase_orders")
    .select("id")
    .eq("location_id", locationId).eq("vendor_id", vendorId)
    .in("status", ["draft", "confirmed"])
    .gte("created_at", startIso).lt("created_at", endExclusiveIso)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (exErr) throw new Error(`generateDraftForVendor existing PO: ${exErr.message}`);
  if (existing) throw new OrderingError(409, "po_exists", "A draft or confirmed order already exists today for this vendor");

  // Reuse the walker payload (per-location overlay + suggested qtys are computed there).
  const walker = await loadWalkerData(actor, locationId);
  const vendor = walker.vendors.find((v) => v.vendorId === vendorId);
  const suggestable = (vendor?.skus ?? []).filter(
    (s): s is WalkerSku & { suggestedQty: number } => s.suggestedQty != null && s.suggestedQty > 0,
  );
  if (suggestable.length === 0) {
    throw new OrderingError(409, "no_suggestions", "No suggested quantities to draft for this vendor today");
  }

  const byVendor = new Map<string, DraftLineInput[]>([
    [
      vendorId,
      suggestable.map((s) => ({
        skuId: s.skuId,
        orderQty: s.suggestedQty,
        orderUnitLabel: s.orderUnitLabel,
        note: null,
      })),
    ],
  ]);

  let created: CreatedDraft[];
  try {
    // noCodeSuffixRetry: the pre-check above is the fast path (a placed/draft PO today
    // → early 409). It CANNOT close the double-call race (two concurrent generates both
    // pass the pre-check). Passing the flag turns the display-code unique index into the
    // day-idempotency arbiter: the loser of the base-code INSERT gets 409 `po_exists`
    // instead of minting a duplicate -2 second order. See createDraftsFromLines' opts doc
    // for the placed-earlier-today tradeoff (acceptable: an order already went out).
    created = await createDraftsFromLines(actor, locationId, byVendor, null, { noCodeSuffixRetry: true });
  } catch (err) {
    // Surface the PO lib's typed errors as OrderingErrors so the route maps them uniformly.
    if (err instanceof PurchaseOrderError) throw new OrderingError(err.status, err.code, err.message);
    throw err;
  }
  const po = created[0];
  if (!po) throw new OrderingError(500, "draft_failed", "Draft order could not be created");
  return { poId: po.poId, displayCode: po.displayCode };
}

// ── loadOrderingAttention: today's cutoffs with no placed order (mid-shift pulse) ─────────
export interface OrderingCutoffAttention {
  vendorId: string;
  vendorName: string;
  /** The governing cutoff time formatted "h:mm AM/PM" (house formatter, operational TZ). */
  cutoffTime: string;
  /** True when a draft PO already exists today for this vendor ("draft ready" vs "no draft"). */
  hasDraft: boolean;
}

/**
 * Vendors whose cutoff governs TODAY (ET dow) but have NO order yet placed (no PO ≥ confirmed
 * today) — the mid-shift pulse's ordering-cutoff attention (spec §4). KH+ read + location-bind.
 * CHEAP + fail-open-friendly (the pulse composer wraps this in try/catch like shrinkage): at
 * most THREE batched queries — today's active cutoffs on this dow, today's POs for those
 * vendors (status + created window), then the vendor names. A vendor with a confirmed/placed/
 * received/reconciled PO today is CLEARED (the order is in flight); a draft-only vendor stays
 * on the list with hasDraft true ("draft ready"). Earliest cutoff first (the binding deadline).
 */
export async function loadOrderingAttention(
  actor: AuthContext,
  locationId: string,
): Promise<{ count: number; vendors: OrderingCutoffAttention[] }> {
  requireLevel(actor, PAR_PASS_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new OrderingError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();
  const { walkDateEt: dateEt, todayDow: dow } = etWalkDay();

  // (1) Active cutoffs governing today (location null-or-match, this dow).
  const { data: cutoffRows, error: cErr } = await sb.from("vendor_cutoffs")
    .select("vendor_id, location_id, cutoff_time")
    .eq("active", true).eq("order_day", dow)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .returns<Array<{ vendor_id: string; location_id: string | null; cutoff_time: string }>>();
  if (cErr) throw new Error(`loadOrderingAttention cutoffs: ${cErr.message}`);
  const cutoffs = cutoffRows ?? [];
  if (cutoffs.length === 0) return { count: 0, vendors: [] };

  // Group cutoff rows per vendor → the governing bare time (most-specific-wins, earliest).
  const rowsByVendor = new Map<string, Array<{ location_id: string | null; cutoff_time: string }>>();
  for (const r of cutoffs) {
    const arr = rowsByVendor.get(r.vendor_id) ?? [];
    arr.push({ location_id: r.location_id, cutoff_time: r.cutoff_time });
    rowsByVendor.set(r.vendor_id, arr);
  }
  const vendorIds = [...rowsByVendor.keys()];

  // (2) Today's POs for those vendors at this location (status + created window).
  const { startIso, endExclusiveIso } = operationalDayUtcRange(dateEt);
  const { data: poRows, error: pErr } = await sb.from("purchase_orders")
    .select("vendor_id, status")
    .eq("location_id", locationId)
    .in("vendor_id", vendorIds)
    .gte("created_at", startIso).lt("created_at", endExclusiveIso)
    .returns<Array<{ vendor_id: string; status: string }>>();
  if (pErr) throw new Error(`loadOrderingAttention pos: ${pErr.message}`);
  // A PO ≥ confirmed CLEARS the vendor (the order is in flight); track draft presence for hasDraft.
  const PLACED_OR_BEYOND = new Set(["confirmed", "placed", "received", "reconciled"]);
  const clearedVendors = new Set<string>();
  const hasDraftVendors = new Set<string>();
  for (const p of poRows ?? []) {
    if (PLACED_OR_BEYOND.has(p.status)) clearedVendors.add(p.vendor_id);
    if (p.status === "draft") hasDraftVendors.add(p.vendor_id);
  }

  const openVendorIds = vendorIds.filter((vid) => !clearedVendors.has(vid));
  if (openVendorIds.length === 0) return { count: 0, vendors: [] };

  // (3) Vendor names for the open set.
  const { data: vendorRows, error: vErr } = await sb.from("vendors")
    .select("id, name").in("id", openVendorIds)
    .returns<Array<{ id: string; name: string }>>();
  if (vErr) throw new Error(`loadOrderingAttention vendors: ${vErr.message}`);
  const vName = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));

  const vendors: Array<OrderingCutoffAttention & { sortKey: string }> = [];
  for (const vid of openVendorIds) {
    const bare = governingCutoffTime(rowsByVendor.get(vid) ?? [], locationId);
    if (bare == null) continue;
    const iso = cutoffWallClockToUtcIso(dateEt, bare);
    if (iso == null) continue; // malformed time → no honest deadline to surface.
    vendors.push({
      vendorId: vid,
      vendorName: vName.get(vid) ?? "(vendor)",
      cutoffTime: formatTime(iso, actor.user.language),
      hasDraft: hasDraftVendors.has(vid),
      // sortKey (bare governing time, "HH:MM:SS") sorts lexically = chronologically for
      // one ET day; kept out of the returned shape (stripped below).
      sortKey: bare,
    });
  }
  // Earliest cutoff first (the binding deadline) — bare "HH:MM[:SS]" sorts chronologically.
  vendors.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.vendorName.localeCompare(b.vendorName));

  return { count: vendors.length, vendors: vendors.map(({ sortKey: _sortKey, ...v }) => v) };
}
