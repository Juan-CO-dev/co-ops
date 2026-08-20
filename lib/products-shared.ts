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
