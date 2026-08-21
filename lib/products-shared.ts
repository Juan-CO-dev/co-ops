/**
 * Product identity — PURE core (zero I/O, no server imports, client-safe; the
 * `*-shared.ts` pattern, AGENTS.md). lib/location-sku-shared.ts is the template.
 *
 * A PRODUCT is the raw identity a recipe means ("HAM"), independent of which vendor
 * supplied it. Member SKUs attach beneath it. A SKU with no product is an implicit
 * SINGLETON: resolution is trivially itself, which is why ~95% of the catalog needs
 * no product row and no data migration.
 *
 * THREE QUESTIONS, THREE ANSWERS, NEVER CONFLATED (spec 2026-08-20):
 *   - what to ORDER / what to PRICE  -> resolveProductMember (the primary-first ladder)
 *   - what actually got EATEN        -> attributeFifo over receipt lots
 *   - what is ON HAND                -> rollupProductGrain (per-SKU ledgers are the
 *                                      truth; the product grain is their sum)
 *
 * Everything here is total and deterministic: no Date.now(), no Math.random(), no
 * dependence on input array order. That is what lets ONE function be consumed by
 * costing, depletion, production and ordering without any of them disagreeing.
 */
import type { RecipeInputSku } from "@/lib/recipe-math";

// -- Resolution ---------------------------------------------------------------

/** One member SKU of a product, as the resolver needs to see it. */
export interface ProductMember {
  skuId: string;
  vendorId: string | null;
  /** Display only — the twin label on count sheets and order walks. */
  vendorName: string | null;
  /** The location-RESOLVED active flag (overlay ?? global), never the raw column. */
  active: boolean;
  /** The member's own avg_oz_per_each — used ONLY as the fallback basis when the
   *  product has no unit_oz, and reported for the member-divergence advisory. */
  avgOzPerEach: number | null;
  /** ISO of the most recent delivery line for this SKU at the resolving location.
   *  null = never received here. Rung 2 reads this and nothing else. */
  lastReceivedAt: string | null;
}

export interface ProductResolutionInput {
  productId: string;
  /** The primary designated for this location, else the global default, else null. */
  primarySkuId: string | null;
  members: ProductMember[];
}

/** Which rung of the ladder answered. Carried into the audit row on every flip. */
export type ProductResolutionRung = "primary" | "recent" | "any" | "unresolved";

export interface ProductResolution {
  productId: string;
  /** null ONLY on rung "unresolved" — never a fabricated pick. */
  skuId: string | null;
  rung: ProductResolutionRung;
  /** Every member id considered, in input order — the "why" half of the audit row. */
  consideredSkuIds: string[];
}

/** Milliseconds since epoch, or null for absent/unparseable. Never `now`. */
function receivedMs(iso: string | null): number | null {
  if (iso == null) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * THE resolution ladder (spec, "the stable question"):
 *   (1) the member flagged primary for this location, IF ACTIVE
 *   (2) else the most-recently-RECEIVED active member
 *   (3) else any active member (skuId ascending — a STABLE, not arbitrary, pick)
 *   (4) else honest `unresolved`
 *
 * A flagged primary that is inactive or not a member FALLS THROUGH; it never fails
 * the whole product. That is the vendor-down behavior the entire arc exists for.
 * Rungs 2 and 3 break ties on skuId so two callers holding the same data in
 * different row order can never disagree.
 */
export function resolveProductMember(input: ProductResolutionInput): ProductResolution {
  const consideredSkuIds = input.members.map((m) => m.skuId);
  const base = { productId: input.productId, consideredSkuIds };

  const active = input.members.filter((m) => m.active);
  if (active.length === 0) return { ...base, skuId: null, rung: "unresolved" };

  // (1) flagged primary, if it is an ACTIVE member of this product.
  if (input.primarySkuId != null && active.some((m) => m.skuId === input.primarySkuId)) {
    return { ...base, skuId: input.primarySkuId, rung: "primary" };
  }

  // (2) most-recently-received active member.
  const received = active
    .map((m) => ({ skuId: m.skuId, ms: receivedMs(m.lastReceivedAt) }))
    .filter((m): m is { skuId: string; ms: number } => m.ms != null)
    .sort((a, b) => (b.ms !== a.ms ? b.ms - a.ms : a.skuId.localeCompare(b.skuId)));
  if (received.length > 0) return { ...base, skuId: received[0]!.skuId, rung: "recent" };

  // (3) any active member, stably.
  const any = [...active].sort((a, b) => a.skuId.localeCompare(b.skuId));
  return { ...base, skuId: any[0]!.skuId, rung: "any" };
}

// -- Recipe basis (deviation D3) ----------------------------------------------

/** What a product knows about its own mass. */
export interface ProductMassBasis {
  productId: string;
  /** products.unit_oz — what ONE unit of the product weighs. */
  unitOz: number | null;
}

/**
 * The pack shape a PRODUCT-pinned recipe line resolves through.
 *
 * MEASURE-REGISTRY ONLY, BY CONSTRUCTION. packChain / packFormat /
 * eachContainerLabel are all null, so lib/recipe-math.ts ozForRecipeInput skips
 * steps 1 and 2 and lands on step 3 (the measure registry). Those two steps match
 * the unit against a SKU's OWN pack spellings, and "1 case" of Baldor ham is not
 * "1 case" of PFG ham — a product pin has no honest way to choose between them, so
 * it is not offered the choice.
 *
 * avgOzPerEach comes from the PRODUCT (unit_oz), falling back to the resolved
 * member's own value only when the product has not been weighed. The fallback is
 * deliberately last: while it is in play, a member flip CAN move the number, which
 * is exactly the hazard scripts/seed/18-twin-adjudication.ts refused over — so the
 * weight board ranks unweighed multi-member products at the top of its suggestions
 * and the Phase-4 re-point script refuses those lines outright.
 */
export function productInputBasis(
  product: ProductMassBasis,
  resolvedMember: ProductMember | null,
): RecipeInputSku {
  return {
    packFormat: null,
    eachContainerLabel: null,
    unitsPerPack: null,
    eachSize: null,
    eachMeasure: null,
    avgOzPerEach: product.unitOz ?? resolvedMember?.avgOzPerEach ?? null,
    packChain: null,
  };
}

/**
 * Do this product's ACTIVE members disagree about what one unit weighs? Advisory
 * only — it never blocks resolution. It is what the weight board ranks on and what
 * the Phase-4 re-point script refuses on: while members disagree AND the product has
 * no unit_oz, a member flip silently re-denominates every count-based line.
 * Tolerance is a fraction of the larger value. Fewer than 2 KNOWN values -> false
 * (nothing to disagree about; an unknown is not a dissent).
 */
export function membersDisagreeOnUnitOz(
  members: ReadonlyArray<ProductMember>,
  tolerance = 0.02,
): boolean {
  const vals = members
    .filter((m) => m.active)
    .map((m) => m.avgOzPerEach)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  if (vals.length < 2) return false;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return hi > 0 && (hi - lo) / hi > tolerance;
}

// -- FIFO over receipt lots (spec: "what actually got eaten") ------------------

/**
 * ONE receipt line, pooled across every member of a product at one location. Lots
 * come from vendor_delivery_items, which are already dated per delivery — the spec's
 * "Lot data already exists" is literally true, and nothing new is captured.
 */
export interface ReceiptLot {
  lotId: string;
  skuId: string;
  /** ISO receipt instant (vendor_delivery_items.created_at — the true write instant,
   *  which is what an anchor timestamp is comparable to; delivery_date is a bare date). */
  receivedAt: string;
  /** vendor_delivery_items.resolved_oz. A NULL resolved_oz never becomes a lot — the
   *  caller drops it and null-taints the term, exactly as the counts received term
   *  already does (lib/counts.ts sumReceivedOzWindow). */
  oz: number;
}

/** A slice of one lot. Negative oz is legal ONLY in allocateProductVariance. */
export interface LotShare {
  lotId: string;
  skuId: string;
  oz: number;
}

/** Oldest first, tie-broken on lotId so the order is TOTAL, not merely mostly-stable
 *  (the same reasoning loadRecipeGraph's `created_at, id` ordering uses). */
function oldestFirst(lots: ReadonlyArray<ReceiptLot>): ReceiptLot[] {
  return [...lots]
    .filter((l) => Number.isFinite(l.oz) && l.oz > 0)
    .sort((a, b) => {
      const ta = Date.parse(a.receivedAt);
      const tb = Date.parse(b.receivedAt);
      const va = Number.isFinite(ta) ? ta : Number.POSITIVE_INFINITY; // unparseable sorts LAST
      const vb = Number.isFinite(tb) ? tb : Number.POSITIVE_INFINITY;
      return va !== vb ? va - vb : a.lotId.localeCompare(b.lotId);
    });
}

/**
 * Attribute `consumeOz` of product-grain consumption across member lots, OLDEST
 * FIRST, regardless of vendor — Juan: "we will FIFO operationally."
 *
 * `unattributedOz` is the honest remainder when the lots cannot explain the
 * consumption (a pre-ledger opening balance, an unrecorded receipt). It is REPORTED,
 * never smeared across lots and never silently dropped: a number the ledger cannot
 * account for is a finding, not a rounding error.
 */
export function attributeFifo(
  lots: ReadonlyArray<ReceiptLot>,
  consumeOz: number,
): { shares: LotShare[]; unattributedOz: number } {
  if (!Number.isFinite(consumeOz) || consumeOz <= 0) return { shares: [], unattributedOz: 0 };
  const shares: LotShare[] = [];
  let left = consumeOz;
  for (const l of oldestFirst(lots)) {
    if (left <= 0) break;
    const take = Math.min(l.oz, left);
    shares.push({ lotId: l.lotId, skuId: l.skuId, oz: take });
    left -= take;
  }
  return { shares, unattributedOz: left > 0 ? left : 0 };
}

/**
 * What is LEFT after FIFO consumption — the newest-back tail. This is the spec's
 * "Lot-level remaining = per-SKU on-hand distributed newest-back after FIFO
 * consumption", and it is what a product-level count is allocated against.
 * Returned OLDEST-FIRST (partial lot first) so callers can read it as a shelf.
 */
export function remainingByLot(
  lots: ReadonlyArray<ReceiptLot>,
  consumedOz: number,
): LotShare[] {
  const consumed = Number.isFinite(consumedOz) && consumedOz > 0 ? consumedOz : 0;
  const out: LotShare[] = [];
  let left = consumed;
  for (const l of oldestFirst(lots)) {
    const eaten = Math.min(l.oz, left);
    left -= eaten;
    const rest = l.oz - eaten;
    if (rest > 0) out.push({ lotId: l.lotId, skuId: l.skuId, oz: rest });
  }
  return out;
}

/**
 * Turn ONE product-level count into ordinary per-SKU count lines (deviation D8).
 *
 * NEWEST-BACK, deliberately: FIFO says the oldest stock left the shelf first, so what
 * the counter is looking at is the freshest lots. Lots of the same SKU merge into one
 * line because sku_count_lines is per-SKU and two lines for one SKU in one event would
 * be a disjointness violation (council L5).
 *
 * `unallocatedOz` is counted stock the lot ledger cannot explain. It is REPORTED to
 * the caller, which surfaces it rather than silently attributing it to a vendor — a
 * count is ground truth, but WHOSE stock it is remains a claim the ledger must support.
 */
export function allocateProductCount(
  countedOz: number,
  remaining: ReadonlyArray<LotShare>,
): { perSku: Array<{ skuId: string; oz: number }>; unallocatedOz: number } {
  if (!Number.isFinite(countedOz) || countedOz <= 0) return { perSku: [], unallocatedOz: 0 };
  const newestFirst = [...remaining].filter((l) => l.oz > 0).reverse();
  const bySku = new Map<string, number>();
  const order: string[] = [];
  let left = countedOz;
  for (const l of newestFirst) {
    if (left <= 0) break;
    const take = Math.min(l.oz, left);
    if (!bySku.has(l.skuId)) order.push(l.skuId);
    bySku.set(l.skuId, (bySku.get(l.skuId) ?? 0) + take);
    left -= take;
  }
  return {
    perSku: order.map((skuId) => ({ skuId, oz: bySku.get(skuId)! })),
    unallocatedOz: left > 0 ? left : 0,
  };
}

/**
 * Allocate a product-grain VARIANCE down to lots — spec: "Product-level counts
 * allocate variance FIFO (oldest lot absorbs)."
 *
 * NEGATIVE (counted less than predicted: shrinkage / waste / over-portion) spills
 * oldest-first and is CAPPED at each lot's remaining oz, because a lot cannot lose
 * more than it held. POSITIVE (counted more) lands whole on the oldest lot and is NOT
 * capped: a surplus is an uncounted receipt or an earlier over-count, and spreading
 * it would invent a distribution nothing supports. Advisory attribution for the
 * reason-code trail — it never edits a ledger row.
 */
export function allocateProductVariance(
  varianceOz: number,
  remaining: ReadonlyArray<LotShare>,
): LotShare[] {
  if (!Number.isFinite(varianceOz) || varianceOz === 0) return [];
  const oldest = [...remaining].filter((l) => l.oz > 0);
  if (oldest.length === 0) return [];
  if (varianceOz > 0) {
    const head = oldest[0]!;
    return [{ lotId: head.lotId, skuId: head.skuId, oz: varianceOz }];
  }
  const out: LotShare[] = [];
  let left = -varianceOz;
  for (const l of oldest) {
    if (left <= 0) break;
    const take = Math.min(l.oz, left);
    out.push({ lotId: l.lotId, skuId: l.skuId, oz: -take });
    left -= take;
  }
  return out;
}

// -- Two-grain rollup (spec: "On-hand") ---------------------------------------

export interface ProductGrainInput {
  productId: string;
  /** oz per member; null = that member's own derivation could not resolve. */
  members: Array<{ skuId: string; oz: number | null }>;
}

export interface ProductGrainRollup {
  productId: string;
  /** NON-NULL only when EVERY member resolved (the MenuCostRollup completeness rule). */
  totalOz: number | null;
  /** Sum of what we COULD resolve. A lower bound, never "the total". */
  knownOz: number;
  knownMemberCount: number;
  /** Which members we could not resolve, sorted — name the address, not just the fault. */
  unknownSkuIds: string[];
}

/**
 * Roll member SKUs up to the product grain. The per-SKU ledgers stay the source of
 * truth; this is their sum, and it is where the audit's mirrored false SHORT/OVER
 * alarm dies: a twin reading +140 and a twin reading -40 net to the 100 that is
 * actually on the shelf, without re-keying a single ledger row.
 */
export function rollupProductGrain(input: ProductGrainInput): ProductGrainRollup {
  let knownOz = 0;
  let knownMemberCount = 0;
  const unknownSkuIds: string[] = [];
  for (const m of input.members) {
    if (m.oz == null || !Number.isFinite(m.oz)) { unknownSkuIds.push(m.skuId); continue; }
    knownOz += m.oz;
    knownMemberCount += 1;
  }
  unknownSkuIds.sort();
  const complete = unknownSkuIds.length === 0 && input.members.length > 0;
  return {
    productId: input.productId,
    totalOz: complete ? knownOz : null,
    knownOz,
    knownMemberCount,
    unknownSkuIds,
  };
}

// -- Count sheet C-mode (spec "Counting UX (locked: option C)", plan Phase 5) ---

/** Why a product-level count could not be fully placed on the receipt ledger. */
export type ProductCountAllocationReason = "count_exceeds_lots" | null;

export interface ProductCountAllocation {
  /** One entry per member SKU, in the order the lots named them. */
  perSku: Array<{ skuId: string; oz: number }>;
  /** Counted oz the receipt lots could not explain (an unrecorded delivery, a
   *  pre-ledger opening balance, or simply the first count at this location). */
  unallocatedOz: number;
  /** The member that ABSORBED `unallocatedOz`. null when there was none to absorb,
   *  or when no primary could be named (then the oz genuinely stays unplaced). */
  absorbedBySkuId: string | null;
  reason: ProductCountAllocationReason;
}

/**
 * Turn ONE product-level count into the per-SKU anchor lines the existing engine
 * eats (deviation D8), and decide what happens to the part the ledger cannot place.
 *
 * LEAD RULING 2026-08-20 — `count_exceeds_lots` NEVER HARD-REFUSES. The earlier
 * plan draft refused the line outright; the ruling reversed it, and the reasoning is
 * the module's own doctrine: A COUNT IS GROUND TRUTH AND THEORY YIELDS TO IT. The
 * counter is standing at the shelf; the lot ledger is a belief about how the shelf
 * got that way. So the counted oz is preserved EXACTLY — `perSku` always sums to
 * `countedOz` whenever a primary can be named — and the ledger-unexplained portion
 * is attributed to the RESOLVED PRIMARY (the honest default vendor: the one we buy
 * this product from) and carried as an advisory `reason` the caller surfaces and
 * audits. WHOSE stock it is remains a claim; THAT it is there is a measurement.
 *
 * With no primary to name (an `unresolved` product — every member inactive) the
 * remainder stays UNALLOCATED rather than being fabricated onto an arbitrary member.
 * Callers reject an unresolved product before they get here; this is the backstop.
 *
 * PURE. `remaining` is oldest-first (the shelf); allocateProductCount walks it
 * newest-back because the freshest lots are what the counter is looking at.
 */
export function allocateProductCountToMembers(
  countedOz: number,
  remaining: ReadonlyArray<LotShare>,
  fallbackSkuId: string | null,
): ProductCountAllocation {
  const base = allocateProductCount(countedOz, remaining);
  if (base.unallocatedOz <= 0) {
    return { perSku: base.perSku, unallocatedOz: 0, absorbedBySkuId: null, reason: null };
  }
  if (fallbackSkuId == null) {
    return {
      perSku: base.perSku,
      unallocatedOz: base.unallocatedOz,
      absorbedBySkuId: null,
      reason: "count_exceeds_lots",
    };
  }
  // MERGE, never append a second line for the same SKU: two lines for one SKU in one
  // event would break the disjointness the anchor sum rests on (council L5).
  const perSku = base.perSku.map((p) => ({ ...p }));
  const existing = perSku.find((p) => p.skuId === fallbackSkuId);
  if (existing) existing.oz += base.unallocatedOz;
  else perSku.push({ skuId: fallbackSkuId, oz: base.unallocatedOz });
  return {
    perSku,
    unallocatedOz: base.unallocatedOz,
    absorbedBySkuId: fallbackSkuId,
    reason: "count_exceeds_lots",
  };
}

/**
 * Give EVERY active member a line, including the ones the shelf allocated nothing to.
 *
 * A product count is a statement about the whole product, so it must RE-ANCHOR the
 * whole product. Without this, a count of "HAM 300 oz" that the lots place entirely
 * under PFG writes one line, Baldor keeps whatever stale anchor it had, and the two
 * grains disagree forever — which is precisely the mirrored false SHORT/OVER pair the
 * arc exists to kill. A zero here is a MEASURED zero ("the product totals 300 and none
 * of it is Baldor's"), categorically different from the F3 refusal of an operator
 * typing 0 on a SKU row, which means "I did not count this".
 *
 * The counted total is untouched — the added lines carry 0 oz. Allocated members keep
 * their lot order; the zero tail sorts on skuId so the order is TOTAL.
 */
export function withZeroMemberShares(
  perSku: ReadonlyArray<{ skuId: string; oz: number }>,
  memberSkuIds: ReadonlyArray<string>,
): Array<{ skuId: string; oz: number }> {
  const seen = new Set(perSku.map((p) => p.skuId));
  const missing = [...new Set(memberSkuIds)].filter((id) => !seen.has(id)).sort((a, b) => a.localeCompare(b));
  return [...perSku.map((p) => ({ ...p })), ...missing.map((skuId) => ({ skuId, oz: 0 }))];
}

export interface ProductSplitAvailability {
  /** Does the count sheet offer tap-to-split for this product at this location? */
  splitAvailable: boolean;
  /** Distinct ACTIVE members with at least one positive-oz receipt lot here. */
  lotBearingMemberCount: number;
}

/**
 * Does the count sheet offer TAP-TO-SPLIT? (spec: "when 2+ members carry expected
 * stock at that location".)
 *
 * RULED (lead, flag ④): this derives from the LOT LOADER + the member count, and
 * NEVER from `loadOnHand`. loadOnHand WRITES on read (the sku_inferred_baselines
 * upsert, lib/counts.ts) — the loadCountsTileState lesson — so it is never safe on
 * a render path, and this is a per-render decision.
 *
 * Three cases, and the middle one is the point:
 *   - 2+ members carry positive-oz lots here → both are stocked → SPLIT (the spec's
 *     trigger, read literally off the receipt ledger).
 *   - ZERO members carry lots here → the ledger knows nothing about this product at
 *     this location and cannot say the split is pointless. The member count alone
 *     opens it: a counter who finds real stock the ledger has not seen must never be
 *     trapped in product-only mode (count beats theory — the same doctrine that made
 *     count_exceeds_lots advisory rather than a refusal).
 *   - exactly ONE member carries lots → the ledger positively says only that vendor
 *     is stocked here, so the product row already IS that vendor's row and a split
 *     would be one real row beside an empty one. No split.
 *
 * PURE. A lot naming a non-member (or an inactive member) is ignored entirely.
 */
export function productSplitAvailability(input: {
  activeMemberSkuIds: ReadonlyArray<string>;
  lots: ReadonlyArray<ReceiptLot>;
}): ProductSplitAvailability {
  const active = new Set(input.activeMemberSkuIds);
  const bearing = new Set<string>();
  for (const l of input.lots) {
    if (!active.has(l.skuId)) continue;
    if (!Number.isFinite(l.oz) || l.oz <= 0) continue;
    bearing.add(l.skuId);
  }
  const lotBearingMemberCount = bearing.size;
  const splitAvailable =
    active.size >= 2 && (lotBearingMemberCount >= 2 || lotBearingMemberCount === 0);
  return { splitAvailable, lotBearingMemberCount };
}

/** One member SKU's on-hand row, as the product grain needs to see it. */
export interface ProductGrainMemberInput {
  skuId: string;
  skuName: string;
  vendorName: string | null;
  /** The member row's on-hand oz. null = advisory, or not weight-anchored at all. */
  onHandOz: number | null;
  /** The member row's variance oz. null = advisory or a non-census anchor. */
  varianceOz: number | null;
  /** True ONLY for a WEIGHT-dimension, CENSUS-anchored row. Variance is census-only
   *  (spec D6): a par_estimate or inferred anchor can never be a variance reference. */
  censusAnchored: boolean;
}

/** The product-grain on-hand row: headline number, per-vendor split, lot shelf. */
export interface ProductOnHandRow {
  productId: string;
  productName: string;
  /** rollupProductGrain over the member rows. NON-NULL only when every member resolved. */
  totalOz: number | null;
  /** Sum of what we COULD resolve. A LOWER BOUND — never render it where totalOz belongs. */
  knownOz: number;
  unknownSkuIds: string[];
  /** The per-vendor split — Juan's "200 PFG + 100 Baldor". */
  members: Array<{ skuId: string; skuName: string; vendorName: string | null; onHandOz: number | null }>;
  /** Product-grain variance: the members' variances summed, null if ANY is null or
   *  any member is non-census. This is where the audit's mirrored false SHORT/OVER dies. */
  varianceOz: number | null;
  /** Advisory FIFO attribution of varianceOz to lots (oldest absorbs). */
  varianceLots: LotShare[];
  /** Lot-level remaining, oldest-first — the shelf, filled newest-back. */
  remaining: LotShare[];
}

/**
 * THE TWO-GRAIN READ (spec "On-hand"): the per-SKU ledgers stay the source of truth
 * and are not touched; the product grain is their SUM, with the per-vendor split and
 * the lot remaining underneath.
 *
 * Two rules carried in from the engine rather than re-decided here:
 *   - COMPLETENESS (the MenuCostRollup rule): one member we could not resolve makes
 *     `totalOz` null. `knownOz` is a lower bound and must never be rendered as the
 *     total (recurring bug class: "partial results presented as totals").
 *   - VARIANCE IS CENSUS-ONLY (spec D6): every member must be census-anchored AND
 *     carry a non-null variance, or the product's variance is null. A par_estimate
 *     or inferred anchor is not a counted ground truth.
 *
 * The lot shelf is derived, not stored: what the members say is on hand, distributed
 * back over the receipt lots newest-back. A product holding MORE than the ledger ever
 * received here consumes nothing (never a negative shelf); an unresolved product has
 * no honest shelf at all and gets an empty one rather than a guess.
 *
 * PURE, and totally ordered: members sort on (name, skuId) so two callers holding the
 * same data in different row order can never disagree.
 */
export function buildProductOnHandRow(input: {
  productId: string;
  productName: string;
  members: ReadonlyArray<ProductGrainMemberInput>;
  lots: ReadonlyArray<ReceiptLot>;
  /** A receipt line at this location carried a NULL resolved_oz, so the lot set is
   *  INCOMPLETE (lib/products.ts loadProductLots drops and reports those lines, the
   *  same taint discipline sumReceivedOzWindow already applies). The member totals
   *  are unaffected — they come from the per-SKU ledgers — but the lot shelf and its
   *  variance attribution go ADVISORY-EMPTY rather than presenting a split we know
   *  is missing stock. */
  lotsTainted?: boolean;
}): ProductOnHandRow {
  const rollup = rollupProductGrain({
    productId: input.productId,
    members: input.members.map((m) => ({ skuId: m.skuId, oz: m.onHandOz })),
  });

  const varianceComplete =
    input.members.length > 0 &&
    input.members.every((m) => m.censusAnchored && m.varianceOz != null && Number.isFinite(m.varianceOz));
  const varianceOz = varianceComplete
    ? input.members.reduce((s, m) => s + (m.varianceOz ?? 0), 0)
    : null;

  const lotTotalOz = input.lots.reduce(
    (s, l) => s + (Number.isFinite(l.oz) && l.oz > 0 ? l.oz : 0),
    0,
  );
  // The shelf only exists when the product grain does: distributing an unknown total
  // would be a fabricated split of a number we do not have.
  const remaining =
    rollup.totalOz == null || input.lotsTainted === true
      ? []
      : remainingByLot(input.lots, Math.max(0, lotTotalOz - rollup.totalOz));

  const varianceLots =
    varianceOz == null || varianceOz === 0 ? [] : allocateProductVariance(varianceOz, remaining);

  const members = [...input.members]
    .sort((a, b) => (a.skuName !== b.skuName ? a.skuName.localeCompare(b.skuName) : a.skuId.localeCompare(b.skuId)))
    .map((m) => ({ skuId: m.skuId, skuName: m.skuName, vendorName: m.vendorName, onHandOz: m.onHandOz }));

  return {
    productId: input.productId,
    productName: input.productName,
    totalOz: rollup.totalOz,
    knownOz: rollup.knownOz,
    unknownSkuIds: rollup.unknownSkuIds,
    members,
    varianceOz,
    varianceLots,
    remaining,
  };
}

/**
 * Give every member of a product the PRODUCT's total trailing usage (deviation D9).
 *
 * Today all consumption is pinned to one twin (production_inputs.input_sku_id and
 * toast_daily_depletion.sku_id are both pin-derived), so the un-pinned twin reads
 * null and `?? -Infinity` sorts it dead last on the order walk — the audit's "the
 * twin with the real spend reads null and sorts LAST". Sharing the product's number
 * makes both members sort where the PRODUCT belongs.
 *
 * A SKU whose product has zero total stays ABSENT from the map (not zero), so the
 * caller's existing `?? -Infinity` null-sorts-last semantics are preserved exactly.
 * Returns a NEW map; never mutates the input.
 */
export function rollupUsageByProduct(
  usageBySku: ReadonlyMap<string, number>,
  productBySku: ReadonlyMap<string, string>,
): Map<string, number> {
  const totalByProduct = new Map<string, number>();
  for (const [skuId, oz] of usageBySku) {
    const p = productBySku.get(skuId);
    if (p == null) continue;
    totalByProduct.set(p, (totalByProduct.get(p) ?? 0) + oz);
  }
  const out = new Map(usageBySku);
  for (const [skuId, productId] of productBySku) {
    const total = totalByProduct.get(productId);
    if (total != null && total > 0) out.set(skuId, total);
  }
  return out;
}
