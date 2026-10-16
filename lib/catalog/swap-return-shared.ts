/** Fixed internal return route; never accept an arbitrary return URL. Authorization
 * of the source SKU belongs to the server page's swap loader. */
import { swapVendorJobHref } from "@/lib/catalog/jobs-shared";
export function swapReturnContext(raw: unknown): string | null {
  return typeof raw === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}
export function swapReturnHref(sourceSkuId: string, scope: string | null, replacementSkuId: string): string {
  return `${swapVendorJobHref(sourceSkuId, scope)}&replacement=${encodeURIComponent(replacementSkuId)}`;
}
