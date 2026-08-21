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
