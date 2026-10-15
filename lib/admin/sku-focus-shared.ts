/**
 * How a ?sku= / ?vendor= deep link patches the SKU catalog's client state (catalog Phase 1,
 * Astra r1 P2-6). Pure. The catalog component keeps filters and expansion in useState; a
 * client-side navigation ?sku=A → ?sku=B keeps it mounted, so initialisers alone would ignore
 * B. The component therefore re-applies this patch whenever the params change, using the
 * during-render prev-compare pattern (AGENTS.md), never an effect.
 *
 * A focused SKU wins over every filter: lens, query, errand filter and vendor reset, so a
 * retained filter can never hide the row the link names.
 */
export const SKU_FILTER_ALL = "__all__";

export interface SkuFocusParams {
  focusSkuId: string | null;
  vendorParam: string | null;
}

export interface SkuFocusPatch {
  /** Row to expand, or null. */
  expand: string | null;
  /** New vendor filter, or null = leave it. */
  vendorFilter: string | null;
  /** Reset lens, query and the errand filter. */
  resetOtherFilters: boolean;
}

export function skuFocusPatch(
  prev: SkuFocusParams,
  next: SkuFocusParams,
  vendorIds: ReadonlySet<string>,
): SkuFocusPatch | null {
  if (prev.focusSkuId === next.focusSkuId && prev.vendorParam === next.vendorParam) return null;
  if (next.focusSkuId) return { expand: next.focusSkuId, vendorFilter: SKU_FILTER_ALL, resetOtherFilters: true };
  if (next.vendorParam && vendorIds.has(next.vendorParam)) {
    return { expand: null, vendorFilter: next.vendorParam, resetOtherFilters: false };
  }
  return null;
}
