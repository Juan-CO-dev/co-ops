/* eslint-disable */
// @ts-nocheck — frozen verbatim copy; type drift in its dependencies must never break the build.
/**
 * FROZEN ORACLE (B9, 2026-10-14) — the Counts READ PATH of lib/counts.ts exactly as it was
 * on origin/main b2770c0d (`git show b2770c0d:lib/counts.ts`, lines 1, 47-347, 811-1809,
 * 1893-2350; the write path and the dashboard tile are omitted, nothing else is edited).
 *
 * tests/counts-onhand-equivalence.test.ts runs THIS and the live lib/counts.ts over the
 * same in-memory database and asserts identical output: it is the proof that the B9
 * round-trip work changed no number. NEVER edit the code below to make a test pass —
 * a difference is a finding about the new code, not about this file.
 */
import { loadEffectiveSalesRows, loadEffectiveSalesWindow, loadEffectiveSalesCoverage, loadSalesCoverageDisclosure, type SalesCoverage, type EffectiveSalesWindow } from "@/lib/toast/effective-depletion";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";
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
  isProductCountLine,
  type CountLineInput,
  type CountLineEntry,
  type CountProductLineInput,
  type OnHandResult,
  type OnHandUnitsResult,
} from "@/lib/counts-shared";
import { loadProductIndex, loadProductLots, type ProductIndexEntry } from "@/lib/products";
import {
  allocateProductCountToMembers,
  withZeroMemberShares,
  buildProductOnHandRow,
  productSplitAvailability,
  remainingByLot,
  type LotShare,
  type ProductGrainMemberInput,
  type ProductOnHandRow,
  type ReceiptLot,
} from "@/lib/products-shared";

/** Trailing calendar window (days) for the inference bootstrap (spec D6, locked). */
const INFERRED_WINDOW_DAYS = 28;
/** Forward coverage (days) an inferred baseline represents (spec D6, locked). */
const INFERRED_COVERAGE_DAYS = 7;

export const COUNT_READ_MIN = 6; // AGM+
export const COUNT_WRITE_MIN = 4; // Assigned KH+; levels 4-5 re-enter PIN, AGM+ use Tier-A password step-up

export class CountError extends Error {
  /** Structured facts the client can translate (e.g. which line could not be anchored). */
  public detail: Record<string, string | null> | undefined;
  constructor(public status: number, public code: string, message?: string, detail?: Record<string, string | null>) {
    super(message ?? code);
    this.name = "CountError";
    this.detail = detail;
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

// ── Migration gate M2: is 0180_count_product_allocation applied? ─────────────────
/**
 * PRE-M2 DEGRADATION — the products_schema_pending pattern (Phase 1, lib/products.ts).
 *
 * The count C-mode ships BEFORE `sku_count_lines.allocated_from_product_id` exists:
 * migration 0180 is authored in this PR and applied only at the named LEAD/JUAN gate.
 * A product count without that column would write anchor lines with no provenance —
 * an auditor could not tell a measurement from an allocation — so instead the whole
 * C-mode surface stays DARK until the column lands:
 *   - loadCountFormData returns `products: []`  → the sheet is byte-identical to today
 *   - loadOnHand returns `products: []`         → the panel is byte-identical to today
 *   - createCountEvent refuses a product line with a named 503, never a silent write
 *
 * The probe caches only the TRUE answer and re-probes while false (one head request
 * against an indexed table), so the surface lights itself up the moment the migration
 * applies — no redeploy, no flag to flip, and no stale `false` stranded in a warm
 * serverless process.
 */
let countProductAllocationColumnReady = false;
let countProductAllocationPendingLogged = false;
async function countProductAllocationReady(
  sb: ReturnType<typeof getServiceRoleClient>,
): Promise<boolean> {
  if (countProductAllocationColumnReady) return true;
  const { error } = await sb.from("sku_count_lines").select("allocated_from_product_id").limit(1);
  if (error) {
    if (!countProductAllocationPendingLogged) {
      countProductAllocationPendingLogged = true;
      console.warn(
        `[counts] product count allocation is DORMANT — migration 0180 (GATE M2) is not applied yet: ${error.message}`,
      );
    }
    return false;
  }
  countProductAllocationColumnReady = true;
  return true;
}

// ── Form data (SKUs + their chain labels for the level picker) ───────────────────
export interface CountSkuOption {
  id: string;
  name: string;
  chainLabels: string[];
  packFormat: string | null;
  /**
   * Owning vendor's display name, null when unassigned (audit P8). Rendered ONLY when the
   * same name appears under 2+ vendors — see twinVendorLabels in lib/counts-shared.ts.
   */
  vendorName: string | null;
  /** The product this SKU is a member of; null = an implicit SINGLETON (the ~95%
   *  case), which is what the sheet lists as its own row. */
  productId: string | null;
  /** That product's display name — what a split row is grouped under. */
  productName: string | null;
}

/** One PRODUCT row on the count sheet (spec option C). */
export interface CountProductOption {
  productId: string;
  name: string;
  /** Member SKU ids at this location, active first — the tap-to-split rows. */
  memberSkuIds: string[];
  /** The resolved primary — whose chain labels the product row's level picker uses. */
  defaultSkuId: string | null;
  /** Level labels borrowed from the resolved primary (see the note below). */
  chainLabels: string[];
  /** True when the spec's tap-to-split trigger fires — productSplitAvailability. */
  splitAvailable: boolean;
  /** How many members carry positive-oz receipt lots here (the split's other half). */
  lotBearingMemberCount: number;
  /**
   * The members do NOT all spell their pack chain the same way, so the borrowed level
   * labels are the PRIMARY's vocabulary and may not fit another member's containers.
   * The form says so and points at tap-to-split — the honest minimum. A product-owned
   * unit vocabulary is a bigger design and is explicitly not in this arc.
   */
  chainsDiffer: boolean;
}

export interface CountFormData {
  skus: CountSkuOption[];
  /**
   * The PRODUCT rows (spec option C: one product, one number, by default). EMPTY
   * before migration 0180 applies — see countProductAllocationReady. Empty is
   * "C-mode is not available", not "no products exist".
   */
  products: CountProductOption[];
}

/** Load active SKUs + each one's root→leaf chain labels for the count level picker. */
export async function loadCountFormData(actor: AuthContext, locationId: string): Promise<CountFormData> {
  requireLevel(actor, COUNT_WRITE_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new CountError(404, "not_found", "Location not found");
  if (!(await canDoOperationalTask(actor, locationId, "counts"))) throw new CountError(403, "forbidden");
  return loadCountCatalog(locationId);
}

/** Reference labels for the AGM+ read-only variance/on-hand panel; never authorizes a count. */
export async function loadCountReferenceData(actor: AuthContext, locationId: string): Promise<CountFormData> {
  requireLevel(actor, COUNT_READ_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new CountError(404, "not_found", "Location not found");
  return loadCountCatalog(locationId);
}

async function loadCountCatalog(locationId: string): Promise<CountFormData> {
  const sb = getServiceRoleClient();
  const { data: skus, error } = await sb.from("vendor_items").select("id, name, pack_format, vendor_id, product_id").eq("active", true).order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; pack_format: string | null; vendor_id: string | null; product_id: string | null }>>();
  if (error) throw new Error(`loadCountFormData skus: ${error.message}`);
  const list = skus ?? [];
  // Vendor names (P8) — ONE batched lookup over the distinct vendors, never per-SKU.
  // LABEL-ONLY: a failure here must not break the count sheet, so it degrades to null
  // labels (the twin rows just stay ambiguous, exactly as they were before P8).
  const vendorIds = [...new Set(list.map((s) => s.vendor_id).filter((v): v is string => v !== null))];
  const vendorNameById = new Map<string, string>();
  if (vendorIds.length > 0) {
    const { data: vs, error: vErr } = await sb.from("vendors").select("id, name").in("id", vendorIds)
      .returns<Array<{ id: string; name: string }>>();
    if (vErr) console.error(`[counts] loadCountFormData vendor names lookup failed:`, vErr.message);
    for (const v of vs ?? []) vendorNameById.set(v.id, v.name);
  }
  const chainsBySku = await loadSkuPackChains(list.map((s) => s.id));
  const chainLabelsFor = (skuId: string): string[] =>
    chainLabelsInWalkOrder(chainsBySku.get(skuId) ?? []);

  const productIds = [...new Set(list.map((s) => s.product_id).filter((v): v is string => v !== null))];
  const products =
    productIds.length > 0 && (await countProductAllocationReady(sb))
      ? await loadCountProductOptions(locationId, productIds, chainLabelsFor)
      : [];

  // A member's productName is only known while C-mode is live; before migration 0180
  // it stays null and the SKU renders exactly as it does today.
  const productNameById = new Map(products.map((p) => [p.productId, p.name]));
  return {
    skus: list.map((s) => ({
      id: s.id, name: s.name, packFormat: s.pack_format,
      vendorName: s.vendor_id != null ? vendorNameById.get(s.vendor_id) ?? null : null,
      productId: s.product_id,
      productName: s.product_id != null ? productNameById.get(s.product_id) ?? null : null,
      chainLabels: chainLabelsFor(s.id),
    })),
    products,
  };
}

/**
 * Build the C-mode PRODUCT rows: one row, one number, with tap-to-split underneath.
 *
 * Reads the SAME product index every other consumer reads (lib/products.ts
 * loadProductIndex) — never a second opinion about which member a product means —
 * plus the receipt lots, which are what the split trigger and the write-time
 * allocation both stand on.
 *
 * A product with NO active member is skipped entirely: the ladder's honest
 * `unresolved` rung has no row to offer and its members are not on the sheet either.
 *
 * NOTE ON LEVEL LABELS (plan Task 5.3). A product's members may carry different pack
 * chains, so there is no product-owned level vocabulary. The C-mode row borrows the
 * RESOLVED PRIMARY's chainLabels, and when the members' chains differ the form says
 * so and points at tap-to-split. That is the honest minimum; a product-owned unit
 * vocabulary is a bigger design and is explicitly not in this arc.
 */
async function loadCountProductOptions(
  locationId: string,
  productIds: string[],
  chainLabelsFor: (skuId: string) => string[],
): Promise<CountProductOption[]> {
  const { byProduct } = await loadProductIndex(productIds, locationId);
  if (byProduct.size === 0) return [];

  // ACTIVE members only, and `active` here is the LOCATION-resolved value the index
  // computed (overlay ?? global) — the same activation the order walk sees.
  //
  // A PRODUCT THAT DOES NOT RESOLVE OFFERS NO PRODUCT ROW (2026-08-21). One rule,
  // two causes: every member inactive, or — since Juan's retirement ruling — the
  // identity itself retired. Either way there is no primary to borrow level labels
  // from, `allocateProductLines` refuses the submit with `product_unresolved`, and
  // rendering the row anyway would be an affordance that cannot be completed. The
  // physical stock is NOT hidden: the members stay countable as ordinary per-SKU
  // rows, which is the honest question to ask about an identity we no longer buy.
  const activeMembersByProduct = new Map<string, ProductIndexEntry["members"]>();
  for (const [productId, entry] of byProduct) {
    if (entry.resolution.skuId == null) continue;
    const active = entry.members.filter((m) => m.active);
    if (active.length > 0) activeMembersByProduct.set(productId, active);
  }
  if (activeMembersByProduct.size === 0) return [];

  const memberIdsByProduct = new Map<string, string[]>(
    [...activeMembersByProduct].map(([productId, members]) => [productId, members.map((m) => m.skuId)]),
  );
  const { lotsByProduct } = await loadProductLots(locationId, memberIdsByProduct);

  const options: CountProductOption[] = [];
  for (const [productId, members] of activeMembersByProduct) {
    const entry = byProduct.get(productId)!;
    const defaultSkuId = entry.resolution.skuId;
    const lots = lotsByProduct.get(productId) ?? [];
    const split = productSplitAvailability({
      activeMemberSkuIds: members.map((m) => m.skuId),
      lots,
    });
    // Active first is already true (we filtered), but the order must be TOTAL so two
    // renders of the same data never disagree: name, then skuId.
    const ordered = [...members].sort((a, b) =>
      a.name !== b.name ? a.name.localeCompare(b.name) : a.skuId.localeCompare(b.skuId),
    );
    const primaryChain = defaultSkuId != null ? chainLabelsFor(defaultSkuId) : [];
    const chainKey = (skuId: string) => chainLabelsFor(skuId).join("");
    const primaryKey = primaryChain.join("");
    options.push({
      productId,
      name: entry.name,
      memberSkuIds: ordered.map((m) => m.skuId),
      defaultSkuId,
      chainLabels: primaryChain,
      splitAvailable: split.splitAvailable,
      lotBearingMemberCount: split.lotBearingMemberCount,
      chainsDiffer: ordered.some((m) => chainKey(m.skuId) !== primaryKey),
    });
  }
  options.sort((a, b) => (a.name !== b.name ? a.name.localeCompare(b.name) : a.productId.localeCompare(b.productId)));
  return options;
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
  salesCoverage?: SalesCoverage;
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
  /**
   * THE PRODUCT GRAIN (Phase 5). Computed PURELY from `rows` plus the receipt lots —
   * `rows` is untouched and remains the source of truth. Populated only by
   * `loadOnHand` (the counts surface); `loadOnHandDerived`'s advisory callers (the
   * order walk) get `[]` and must NOT read that as "no products exist". Also `[]`
   * before migration 0180 applies.
   */
  products: ProductOnHandRow[];
  /**
   * 0215 batch vs bottle — the bulk backup a prep session TOSSED (prep_batch_sessions
   * rows with tossed_qty > 0), newest first. ADVISORY: this is counted prep waste, not a
   * SKU variance — it never enters `rows`. Populated only by `loadOnHand` (the counts
   * surface); absent on the advisory derivation and before 0215 applies.
   */
  prepWaste?: PrepWasteRow[];
}

/** One tossed bulk container (0215). `tossedQty` is in the item's par unit. */
export interface PrepWasteRow {
  templateItemId: string;
  itemName: string;
  businessDate: string;
  tossedQty: number;
  parUnit: string | null;
  tossedAt: string | null;
  tossedByName: string | null;
  source: "opening_p2" | "mid_day_p2";
}

/** Re-exported so server consumers keep their `@/lib/counts` paths (the *-shared law). */
export type { ProductOnHandRow } from "@/lib/products-shared";

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
  // BOTH production reads are PAGED (the PR #63 lesson): 28 days of productions and
  // their inputs each overrun the 1000-row cap, and a truncated page would silently
  // understate the run-rate. `id` (the PK) gives the stable total order paging needs;
  // both reads are order-insensitive sums.
  const prodHdrs = await selectAllRows<{ id: string }>(
    async (from, to) => {
      const { data, error } = await sb.from("productions")
        .select("id")
        .eq("location_id", locationId)
        .is("superseded_at", null).is("revoked_at", null)
        .gte("produced_at", cutoffIso)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ id: string }>>();
      if (error) throw new Error(`loadInferredConsumedOz productions: ${error.message}`);
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
        if (error) throw new Error(`loadInferredConsumedOz production_inputs: ${error.message}`);
        return { data };
      },
    );
    for (const r of inputs) addProd(r.input_sku_id, num(r.input_oz) ?? 0);
  }

  // Sales direct lane — the materialized depletion ledger over the window (0166).
  // 28 days × the SKU roster overruns PostgREST's 1000-row default cap, and an
  // unordered truncated page would silently understate the run-rate (the PR #63
  // lesson) — page it under a stable total order (`id`, the primary key).
  const sales = await loadEffectiveSalesRows(sb, { locationId, fromDate: cutoffDate });
  for (const r of sales) addDirect(r.sku_id, num(r.direct_oz) ?? 0);

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
 * Pre-existing baselines anchor at their stored computed_at. With seedBaselines
 * false, the same merge computes this render without writing future anchors.
 */
async function loadInferredRows(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  censusSkuIds: ReadonlySet<string>,
  now: number,
  { seedBaselines }: { seedBaselines: boolean } = { seedBaselines: true },
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
    if (seedBaselines && toInsert.length > 0) {
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
  //     PAGED (the PR #63 lesson): par_pass_lines grows one row per SKU per walk, so
  //     the desc scan loses its tail past 1000 rows — dropping a rarely-walked SKU's
  //     only anchor. `id` is a tiebreaker ONLY (created_at stays the primary sort key),
  //     making the order total so page boundaries can't reshuffle the first-seen pick.
  const lineRows = await selectAllRows<{ sku_id: string; implied_on_hand_oz: number | string | null; created_at: string }>(
    async (from, to) => {
      const { data, error } = await sb.from("par_pass_lines")
        .select("sku_id, implied_on_hand_oz, created_at")
        .in("event_id", eventIds)
        .in("sku_id", rosterIds)
        .not("implied_on_hand_oz", "is", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
        .returns<Array<{ sku_id: string; implied_on_hand_oz: number | string | null; created_at: string }>>();
      if (error) throw new Error(`loadParEstimateRows lines: ${error.message}`);
      return { data };
    },
  );
  const anchorBySku = new Map<string, { impliedOz: number; anchorAt: string }>();
  for (const r of lineRows) {
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
  // The counts SURFACE gets the product grain; the advisory derivation below does not
  // (see withProducts). This is the only entry point that renders a two-grain panel.
  const view = await loadOnHandDerived(actor, locationId, now, { withProducts: true, seedBaselines: false });
  // 0215 — prep waste rides on the counts surface only (advisory; never in `rows`).
  return { ...view, prepWaste: await loadPrepWasteRows(getServiceRoleClient(), locationId) };
}

/**
 * 0215 batch vs bottle — the bulk backup tossed at prep, newest first (bounded). Every
 * read throws on error: a dropped read would render "no waste" as a fact.
 */
async function loadPrepWasteRows(sb: ReturnType<typeof getServiceRoleClient>, locationId: string, limit = 30): Promise<PrepWasteRow[]> {
  const { data, error } = await sb
    .from("prep_batch_sessions")
    .select("template_item_id, item_id, business_date, source, tossed_qty, tossed_par_unit, tossed_at, tossed_by")
    .eq("location_id", locationId)
    .gt("tossed_qty", 0)
    .order("tossed_at", { ascending: false })
    .limit(limit)
    .returns<Array<{ template_item_id: string; item_id: string; business_date: string; source: "opening_p2" | "mid_day_p2"; tossed_qty: number | string; tossed_par_unit: string | null; tossed_at: string | null; tossed_by: string | null }>>();
  if (error) throw new Error(`loadPrepWasteRows: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const itemIds = [...new Set(rows.map((r) => r.item_id))];
  const userIds = [...new Set(rows.map((r) => r.tossed_by).filter((v): v is string => !!v))];
  const [{ data: items, error: iErr }, { data: users, error: uErr }] = await Promise.all([
    sb.from("items").select("id, name").in("id", itemIds).returns<Array<{ id: string; name: string }>>(),
    userIds.length ? sb.from("users").select("id, name").in("id", userIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
  ]);
  if (iErr) throw new Error(`loadPrepWasteRows items: ${iErr.message}`);
  if (uErr) throw new Error(`loadPrepWasteRows users: ${uErr.message}`);
  const itemName = new Map((items ?? []).map((i) => [i.id, i.name]));
  const userName = new Map((users ?? []).map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    templateItemId: r.template_item_id,
    itemName: itemName.get(r.item_id) ?? "(item)",
    businessDate: r.business_date,
    tossedQty: Number(r.tossed_qty) || 0,
    parUnit: r.tossed_par_unit,
    tossedAt: r.tossed_at,
    tossedByName: r.tossed_by ? (userName.get(r.tossed_by) ?? null) : null,
    source: r.source,
  }));
}

/** KH+ floor for the ADVISORY on-hand derivation — matches the ordering walker's
 *  PAR_PASS_MIN (kept as a local constant: ordering.ts imports this module, so
 *  importing the walker's constant back would cycle). The counts SURFACE stays
 *  AGM+ via loadOnHand above. */
export const ON_HAND_DERIVED_MIN = 4;

/**
 * DERIVATION CORE (sim-day P1 fix, 2026-08-11): the counts SURFACE stays AGM+
 * (loadOnHand above adds COUNT_READ_MIN), but the ordering walker consumes
 * on-hand as SERVER-SIDE ADVISORY for KH+ actors — gating the derivation at
 * COUNT_READ_MIN 500'd /ordering for every key-holder (caught by the sim's KH
 * persona; never seen live because all prior smokes ran at L10). SELF-GATED
 * (security review 2026-08-11): KH+ + location bind enforced HERE, never
 * delegated to callers — an exported service-role read must carry its own gate.
 */
export async function loadOnHandDerived(
  actor: AuthContext,
  locationId: string,
  now: number = Date.now(),
  /**
   * `withProducts` OPTS IN to the product grain. It is deliberately off by default:
   * the order walk consumes this loader as advisory and would pay ~8 extra queries
   * (product index + receipt lots) for a view it never renders. The counts surface
   * turns it on; every other caller keeps its cost byte-identical to today.
   * `seedBaselines` defaults to true for the ordering walk. Read surfaces MUST
   * pass false: inferred values still merge in memory without persisting them.
   */
  opts: { withProducts?: boolean; seedBaselines?: boolean } = {},
): Promise<OnHandView> {
  requireLevel(actor, ON_HAND_DERIVED_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new CountError(404, "not_found", "Location not found");
  return onHandCore(locationId, now, opts);
}

/**
 * The ACTOR-LESS, INTRINSICALLY READ-ONLY on-hand read (the deriveCateringSkuDemand /
 * deriveSalesConsumption split) for callers that are already system-authorized and location-bound —
 * the catering morning digest's count-anchored readiness. It has NO seedBaselines option: it always
 * passes false, so no option, default or future caller can reach the inferred-baseline upsert
 * (Astra r3). Seeding stays reachable only through the authorized loadOnHandDerived wrapper.
 */
export async function deriveOnHand(
  locationId: string,
  now: number = Date.now(),
  opts: { withProducts?: boolean } = {},
): Promise<OnHandView> {
  return onHandCore(locationId, now, { withProducts: opts.withProducts === true, seedBaselines: false });
}

/**
 * PRIVATE core of loadOnHandDerived (pure refactor: the gated wrapper behaves byte-identically).
 * Not exported — the only public paths are the gated wrapper (may seed, ordering walk default) and
 * the read-only deriveOnHand above.
 */
async function onHandCore(
  locationId: string,
  now: number,
  opts: { withProducts?: boolean; seedBaselines?: boolean },
): Promise<OnHandView> {
  const withProducts = opts.withProducts === true;
  const seedBaselines = opts.seedBaselines ?? true;
  const sb = getServiceRoleClient();
  const salesThrough = await loadDepletionWatermark(locationId, sb);

  // ALL active count events at this location, newest first — every event is a live
  // session (F1: no supersede). We resolve each SKU's anchor across all of them.
  // A failed read MUST throw: an empty result is the COLD START signal ("this
  // location was never counted"), so a swallowed error would fabricate it. PAGED (the
  // PR #63 lesson): one row per count session accumulates forever, and evList[0] is
  // the location's "last counted" hint — `id` is a tiebreaker ONLY (counted_at stays
  // the primary sort key), making the order total so paging can't reorder the head.
  const evList = await selectAllRows<{ id: string; counted_at: string }>(
    async (from, to) => {
      const { data, error } = await sb.from("sku_count_events")
        .select("id, counted_at")
        .eq("location_id", locationId)
        .eq("active", true)
        .order("counted_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
        .returns<Array<{ id: string; counted_at: string }>>();
      if (error) throw new Error(`loadOnHand count events: ${error.message}`);
      return { data };
    },
  );
  const disclosureFrom = [new Date(now - 28 * 86_400_000).toISOString().slice(0, 10),
    ...evList.map((event) => etBusinessDate(event.counted_at))].sort()[0]!;
  const salesCoverage = await loadSalesCoverageDisclosure(sb, { locationId, fromDate: disclosureFrom });
  if (evList.length === 0) {
    // COLD START (spec D6): no physical count has EVER anchored this location. Still
    // surface soft baselines so the panel isn't empty on day one — par_estimate first
    // (the shelf-walk snapshot, firmer than a run-rate guess), then inferred for the
    // rest. No census SKUs → both tiers see the full active roster; inference EXCLUDES
    // whatever par_estimate already anchored.
    const parEstimate = await loadParEstimateRows(sb, locationId, new Set<string>(), now);
    const inferredRows = await loadInferredRows(sb, locationId, new Set(parEstimate.skuIds), now, { seedBaselines });
    const rows = [...parEstimate.rows, ...inferredRows].sort((a, b) => a.skuName.localeCompare(b.skuName));
    return { locationId, salesCoverage, anchorAt: null, salesThrough, rows, products: await loadProductOnHandRows(sb, locationId, rows, withProducts) };
  }
  const eventAt = new Map(evList.map((e) => [e.id, e.counted_at]));
  const locationLastCountedAt = evList[0]!.counted_at; // header hint only.

  // ALL lines across those active events, each tagged with its event's counted_at.
  // PR-C: read anchor_dimension + resolved_units to partition weight vs count rows.
  const eventIds = evList.map((e) => e.id);
  // A failed read MUST throw: these lines ARE every SKU's anchor — an empty result
  // reads as "the events resolved to no anchors" and silently drops the census tier.
  // PAGED (the PR #63 lesson): a full census writes one line per SKU (~163), so all
  // lines across all active events cross 1000 rows within a handful of counts; a
  // truncated page would silently strand whichever SKUs fell off. `id` (the PK) gives
  // the stable total order paging requires — anchors resolve by event counted_at, so
  // row order is not otherwise load-bearing.
  const lines = await selectAllRows<{ count_event_id: string; sku_id: string; anchor_dimension: "weight" | "count" | null; resolved_oz: number | string | null; resolved_units: number | string | null; is_loose: boolean; partial_fraction: number | string | null }>(
    async (from, to) => {
      const { data, error } = await sb.from("sku_count_lines")
        .select("count_event_id, sku_id, anchor_dimension, resolved_oz, resolved_units, is_loose, partial_fraction")
        .in("count_event_id", eventIds)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ count_event_id: string; sku_id: string; anchor_dimension: "weight" | "count" | null; resolved_oz: number | string | null; resolved_units: number | string | null; is_loose: boolean; partial_fraction: number | string | null }>>();
      if (error) throw new Error(`loadOnHand count lines: ${error.message}`);
      return { data };
    },
  );
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
    const inferredRows = await loadInferredRows(sb, locationId, new Set(parEstimate.skuIds), now, { seedBaselines });
    const rows = [...parEstimate.rows, ...inferredRows].sort((a, b) => a.skuName.localeCompare(b.skuName));
    return { locationId, salesCoverage, anchorAt: locationLastCountedAt, salesThrough, rows, products: await loadProductOnHandRows(sb, locationId, rows, withProducts) };
  }

  // SKU names + chains (count rows derive received-units read-time from the chain).
  const [nameRes, chainsBySku, measures] = await Promise.all([
    sb.from("vendor_items").select("id, name").in("id", skuIds).returns<Array<{ id: string; name: string }>>(),
    loadSkuPackChains(countSkuIds),
    loadMeasures(),
  ]);
  // LABEL-ONLY read: names never touch the drift math (rows fall back to "(sku)"), so
  // a failure logs and continues best-effort rather than failing the whole panel.
  if (nameRes.error) console.error(`[counts] loadOnHand sku names lookup failed:`, nameRes.error.message);
  const skuName = new Map((nameRes.data ?? []).map((s) => [s.id, s.name]));

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
  const inferredRows = await loadInferredRows(sb, locationId, inferredExcluded, now, { seedBaselines });

  const rows = [...weightRows, ...countRows, ...parEstimate.rows, ...inferredRows].sort((a, b) => a.skuName.localeCompare(b.skuName));
  return { locationId, salesCoverage, anchorAt: locationLastCountedAt, salesThrough, rows, products: await loadProductOnHandRows(sb, locationId, rows, withProducts) };
}

/**
 * THE TWO-GRAIN READ (spec "On-hand", plan Task 5.5). The per-SKU `rows` above are
 * the source of truth and are NOT touched; this is a VIEW over them — their sum at
 * the product grain, with the per-vendor split and the lot shelf underneath. It is
 * where the audit's mirrored false SHORT/OVER pair dies: a twin reading +140 and a
 * twin reading −40 net to the +100 that is actually on the shelf.
 *
 * Every active member is included, and a member with NO row on the panel contributes
 * `onHandOz: null` — which nulls the product total. That is the honest answer: the
 * panel genuinely does not know that vendor's stock, and presenting the members it
 * DOES know as "the total" is the "partial results presented as totals" bug class.
 * `knownOz` carries the lower bound for the surface to say so out loud.
 *
 * FAIL-SOFT: the product grain is a view over rows that already exist, so a failure
 * here loses no truth. It logs and degrades to `[]` rather than 500-ing the count
 * sheet — the panel then reads exactly as it did before this arc.
 *
 * A RETIRED PRODUCT STILL GETS AN ON-HAND ROW, deliberately (2026-08-21). Unlike the
 * count sheet's C-mode — which asks a question and therefore needs a primary to ask
 * it through — this is a READ over per-SKU ledgers that are still true: discontinuing
 * ham does not empty the fridge, and hiding the rollup would leave real stock visible
 * only as two unlinked twin rows, which is exactly the mirrored SHORT/OVER read the
 * grain exists to kill. Retirement suppresses RESOLUTION, not arithmetic over ledgers.
 */
async function loadProductOnHandRows(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  rows: OnHandRow[],
  enabled: boolean,
): Promise<ProductOnHandRow[]> {
  if (!enabled || rows.length === 0) return [];
  try {
    if (!(await countProductAllocationReady(sb))) return []; // GATE M2 — see the probe.

    // Which of these rows' SKUs belong to a product? ONE batched read — never per-row
    // — and PAGED (the PR #63 lesson): a truncated page would silently drop a product
    // from the panel and leave its members rendering as unrolled twins, which is the
    // exact display this arc exists to end. `id` (the PK) is the stable total order.
    const rowSkuIds = [...new Set(rows.map((r) => r.skuId))];
    const memberRows = await selectAllRows<{ id: string; product_id: string | null }>(
      async (from, to) => {
        const { data, error } = await sb
          .from("vendor_items")
          .select("id, product_id")
          .in("id", rowSkuIds)
          .not("product_id", "is", null)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<Array<{ id: string; product_id: string | null }>>();
        if (error) throw new Error(`loadProductOnHandRows membership: ${error.message}`);
        return { data };
      },
    );
    const productIds = [...new Set(memberRows.map((m) => m.product_id).filter((v): v is string => v != null))];
    if (productIds.length === 0) return [];

    const { byProduct } = await loadProductIndex(productIds, locationId);
    if (byProduct.size === 0) return [];

    const memberIdsByProduct = new Map<string, string[]>();
    for (const [productId, entry] of byProduct) {
      const active = entry.members.filter((m) => m.active).map((m) => m.skuId);
      if (active.length > 0) memberIdsByProduct.set(productId, active);
    }
    if (memberIdsByProduct.size === 0) return [];
    const { lotsByProduct, nullOzLotCountByProduct } = await loadProductLots(locationId, memberIdsByProduct);

    const rowBySku = new Map(rows.map((r) => [r.skuId, r]));
    const out: ProductOnHandRow[] = [];
    for (const [productId, memberIds] of memberIdsByProduct) {
      const entry = byProduct.get(productId)!;
      const members: ProductGrainMemberInput[] = memberIds.map((skuId) => {
        const m = entry.members.find((x) => x.skuId === skuId)!;
        const row = rowBySku.get(skuId);
        // A COUNT-dimension row (packaging) has no honest ounce and no product grain
        // to sum into, so it reads as unresolved here — plan Task 5.5, verbatim.
        const weightRow = row != null && row.dimension === "weight" ? row : null;
        return {
          skuId,
          skuName: m.name,
          vendorName: m.vendorName,
          onHandOz: weightRow?.onHandOz ?? null,
          varianceOz: weightRow?.varianceOz ?? null,
          // VARIANCE IS CENSUS-ONLY (spec D6): a par_estimate or inferred anchor is
          // not a counted ground truth and can never be a variance reference.
          censusAnchored: weightRow?.anchorSource === "census",
        };
      });
      out.push(
        buildProductOnHandRow({
          productId,
          productName: entry.name,
          members,
          lots: lotsByProduct.get(productId) ?? [],
          lotsTainted: (nullOzLotCountByProduct.get(productId) ?? 0) > 0,
        }),
      );
    }
    out.sort((a, b) => (a.productName !== b.productName ? a.productName.localeCompare(b.productName) : a.productId.localeCompare(b.productId)));
    return out;
  } catch (err) {
    console.error("[counts] loadProductOnHandRows failed (degrading to per-SKU rows):", err);
    return [];
  }
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
  // Feeds the received-since term: a short id list silently zeroes intake for every
  // delivery it drops, so this read must neither swallow an error nor truncate. The
  // window is anchor→now, which widens without bound while a location goes uncounted
  // — PAGED (the PR #63 lesson) under `id` (the PK) as the stable total order; the
  // caller only uses the set membership, so row order is not load-bearing.
  const rows = await selectAllRows<{ id: string }>(
    async (from, to) => {
      let q = sb.from("vendor_deliveries").select("id").eq("location_id", locationId).gt("created_at", afterIso);
      if (untilIso != null) q = q.lte("created_at", untilIso);
      const { data, error } = await q
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ id: string }>>();
      if (error) throw new Error(`locationDeliveryIds: ${error.message}`);
      return { data };
    },
  );
  return rows.map((d) => d.id);
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
  // PAGED (the PR #63 lesson): a wide window over the delivery ledger crosses the
  // 1000-row cap, and a truncated page silently UNDERSTATES the received term —
  // which reads downstream as shrinkage. `id` (the PK) gives the stable total order
  // paging requires; the per-SKU sum and the null-taint are order-insensitive.
  const rows = await selectAllRows<{ vendor_item_id: string; resolved_oz: number | string | null; created_at: string }>(
    async (from, to) => {
      let q = sb.from("vendor_delivery_items")
        .select("vendor_item_id, resolved_oz, created_at")
        .in("vendor_item_id", skuIds)
        .in("delivery_id", deliveryIds)
        .gt("created_at", afterIso);
      if (untilIso != null) q = q.lte("created_at", untilIso);
      const { data, error } = await q
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ vendor_item_id: string; resolved_oz: number | string | null; created_at: string }>>();
      if (error) throw new Error(`sumReceivedOzWindow: ${error.message}`);
      return { data };
    },
  );
  // Sum resolved oz per SKU; a SKU with ANY NULL resolved_oz in-window line →
  // advisory null (can't derive a clean received term). Tracked separately so a
  // null line taints the whole SKU regardless of row order.
  const sums = new Map<string, number>();
  const nulled = new Set<string>();
  for (const r of rows) {
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
  // PAGED (the PR #63 lesson): a truncated page silently UNDERSTATES the received-
  // units term. `id` (the PK) gives the stable total order paging requires; the sum
  // and its advisory-null taint are order-insensitive.
  const rows = await selectAllRows<{ received_level_label: string | null; received_qty_at_level: number | string | null; created_at: string }>(
    async (from, to) => {
      let q = sb.from("vendor_delivery_items")
        .select("received_level_label, received_qty_at_level, created_at")
        .eq("vendor_item_id", skuId)
        .in("delivery_id", deliveryIds)
        .gt("created_at", afterIso);
      if (untilIso != null) q = q.lte("created_at", untilIso);
      const { data, error } = await q
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ received_level_label: string | null; received_qty_at_level: number | string | null; created_at: string }>>();
      if (error) throw new Error(`sumReceivedUnitsWindow: ${error.message}`);
      return { data };
    },
  );
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
 * rows = 0 only for covered days (a materialized day with no direct sales for
 * a SKU writes no row); missing coverage makes the sales term unknown.
 */
// Scoped to the caller's gap read, never retained across requests. All anchor
// groups share the same generation of amounts and coverage for this interval.
class CapturedSalesGapDates extends Set<string> {
  constructor(readonly locationId: string, readonly fromDate: string, readonly end: string,
    readonly snapshot: EffectiveSalesWindow) {
    super(snapshot.coverage.byLocation[locationId]?.missingDates ?? []);
  }
}

export async function sumSalesDirectOzWindow(
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
  // PAGED (the PR #63 lesson): this ledger is one row per (day, SKU), so a 28-day
  // window over the ~163-SKU roster is ~4.5k rows — a truncated page would silently
  // UNDERSTATE the sales lane, inflating computed on-hand. `id` (the PK) gives the
  // stable total order paging requires; the per-SKU sum is order-insensitive.
  const capture = process.env.DEPLETION_SOURCE === "capture";
  const end = untilDateExclusive ?? (capture ? etCalendarDate(new Date().toISOString()) : null);
  const cached = gapDates instanceof CapturedSalesGapDates && gapDates.locationId === locationId &&
    fromDate >= gapDates.fromDate && end !== null && end <= gapDates.end ? gapDates.snapshot : null;
  const snapshot = cached ?? await loadEffectiveSalesWindow(sb, { locationId, fromDate, untilDateExclusive, skuIds });
  // A refresh can invalidate a day after an earlier gap probe. Never turn that
  // new gap into a zero-sales amount by discarding the same read's disclosure.
  const currentGaps = new Set(snapshot.coverage.byLocation[locationId]?.missingDates ?? []);
  if (salesWindowUntrustworthy(currentGaps, fromDate, untilDateExclusive)) {
    return new Map<string, number | null>(skuIds.map((id) => [id, null]));
  }
  const selected = new Set(skuIds);
  for (const r of snapshot.rows) {
    if (r.location_id !== locationId || !selected.has(r.sku_id) || r.business_date < fromDate ||
      (end !== null && r.business_date >= end)) continue;
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
export async function loadSalesGapDates(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  sinceDate: string,
  openEtDate: string,
): Promise<Set<string>> {
  if (process.env.DEPLETION_SOURCE === "capture") {
    const snapshot = await loadEffectiveSalesWindow(sb, { locationId, fromDate: sinceDate, untilDateExclusive: openEtDate });
    return new CapturedSalesGapDates(locationId, sinceDate, openEtDate, snapshot);
  }
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

/**
 * The latest materialized sales business_date at a location (the coverage hint
 * the counts UI renders: "sales counted through <date>"). Null = no ledger yet.
 *
 * ── ALSO THE DEPLETION WATERMARK (Dynamic Pars, plan D9) ─────────────────────
 * r3 asks the nightly pars step for "a `depletion_current_through` watermark per
 * location". This query already IS that fact — one indexed ORDER BY … LIMIT 1 — so it
 * is EXPORTED under the name the pars engine uses rather than stored a second time. A
 * stored watermark would be a second opinion about something the ledger already states,
 * and it would go stale the moment anyone ran a manual backfill.
 *
 * Actor-less by design: the caller (the cron) is already the system.
 */
export async function loadDepletionWatermark(
  locationId: string,
  sb: ReturnType<typeof getServiceRoleClient> = getServiceRoleClient(),
): Promise<string | null> {
  if (process.env.EZCATER_DEPLETION_ENABLED === "1") {
    if (process.env.DEPLETION_SOURCE !== "capture") throw new Error("ezcater_depletion_requires_capture");
    const end = etCalendarDate(new Date().toISOString());
    const { data, error } = await sb.from("toast_capture_runs").select("business_date")
      .eq("location_id", locationId).eq("status", "completed").lt("business_date", end)
      .order("business_date", { ascending: false }).limit(1).maybeSingle<{ business_date: string }>();
    if (error) throw new Error("capture_depletion_runs_unavailable");
    if (!data) return null;
    // Validate just the newest candidate, never derive all historical sales for
    // a watermark. A concurrent changed read remains conservatively unknown.
    const coverage = await loadSalesCoverageDisclosure(sb, { locationId, fromDate: data.business_date,
      untilDateExclusive: etYmdMinusDays(data.business_date, -1) });
    return coverage.byLocation[locationId]?.hasGaps === false ? data.business_date : null;
  }
  if (process.env.DEPLETION_SOURCE === "capture") {
    const covered = await loadEffectiveSalesCoverage(sb, { locationId, fromDate: "1900-01-01" });
    return covered.map((r) => r.business_date).sort().at(-1) ?? null;
  }
  const { data, error } = await sb.from("toast_daily_depletion")
    .select("business_date")
    .eq("location_id", locationId)
    .order("business_date", { ascending: false })
    .limit(1)
    .maybeSingle<{ business_date: string }>();
  if (error) throw new Error(`loadDepletionWatermark: ${error.message}`);
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
  // BOTH reads are PAGED (the PR #63 lesson): the header set is bounded only by
  // location + window, and its inputs multiply it — a truncated page would silently
  // UNDERSTATE the consumed term, inflating computed on-hand. `id` (the PK) gives the
  // stable total order paging requires; both reads are order-insensitive sums.
  const hdrs = await selectAllRows<{ id: string }>(
    async (from, to) => {
      let hq = sb.from("productions").select("id").eq("location_id", locationId)
        .is("superseded_at", null).is("revoked_at", null).gt("produced_at", afterIso);
      if (untilIso != null) hq = hq.lte("produced_at", untilIso);
      const { data, error } = await hq
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ id: string }>>();
      if (error) throw new Error(`sumConsumedOzWindow productions: ${error.message}`);
      return { data };
    },
  );
  const prodIds = hdrs.map((h) => h.id);
  if (prodIds.length === 0) return out;
  const lines = await selectAllRows<{ input_sku_id: string; input_oz: number | string | null }>(
    async (from, to) => {
      const { data, error } = await sb.from("production_inputs")
        .select("input_sku_id, input_oz")
        .in("input_sku_id", skuIds)
        .in("production_id", prodIds)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ input_sku_id: string; input_oz: number | string | null }>>();
      if (error) throw new Error(`sumConsumedOzWindow production_inputs: ${error.message}`);
      return { data };
    },
  );
  const sums = new Map<string, number>();
  const nulled = new Set<string>();
  for (const l of lines) {
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
  // Absence of rows means "not stale" — a swallowed error would assert trust in an
  // anchor we couldn't check. Throw instead of overstating the anchor's soundness.
  const { data: delivHit, error } = await sb.from("vendor_deliveries").select("id")
    .eq("location_id", locationId)
    .gt("created_at", anchorIso).lte("delivery_date", anchorDate).limit(1)
    .returns<Array<{ id: string }>>();
  if (error) throw new Error(`detectRetroEditStaleness: ${error.message}`);
  return (delivHit ?? []).length > 0;
}

// ── oracle exports (the only addition) ──
export { onHandCore as v0OnHandCore, loadCountCatalog as v0LoadCountCatalog, loadPrepWasteRows as v0LoadPrepWasteRows };
