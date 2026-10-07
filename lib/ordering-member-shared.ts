import type { ProductMember } from "@/lib/products-shared";

/** Ordering labels describe available suppliers, not the product's cost source.
 * Store members are not orderable, so adding one cannot demote a lone vendor. */
export function orderableMemberRole(
  skuId: string,
  product: { primarySkuId: string | null; members: readonly ProductMember[] } | null,
): "solo" | "primary" | "backup" {
  if (product == null) return "solo";
  const orderable = product.members.filter((member) => member.active && member.vendorActive !== false &&
    !member.pendingReview && member.vendorId != null && member.sourceKind !== "store");
  if (!orderable.some((member) => member.skuId === skuId)) return "backup";
  return product.primarySkuId === skuId || orderable.length === 1 ? "primary" : "backup";
}
