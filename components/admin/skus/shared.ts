/**
 * Shared client helpers + error resolver for the SKU-catalog admin UI
 * (Item/Inventory Spine — vendor mini-arc, Slice C1). Mirrors
 * components/admin/vendors/shared.ts: re-exports the same pessimistic postJson
 * (redirect:"manual", machine-stable `code`) plus a SKU-scoped error resolver.
 */

import type { TranslationKey } from "@/lib/i18n/types";

export { postJson, type PostResult } from "@/components/admin/vendors/shared";

/** Error codes the SKU routes + lib can emit that have a localized message. */
const KNOWN_ERROR_CODES = new Set([
  "forbidden",
  "mixed_concerns",
  "invalid_vendor",
  "invalid_location",
  "invalid_lead_time",
  "invalid_name",
  "invalid_unit",
  "sku_not_found",
  "invalid_payload",
  "step_up_required",
  "step_up_stale",
]);

/** Resolve an error `code` to a localized message, falling back to generic. */
export function resolveErrorKey(code: string): TranslationKey {
  if (KNOWN_ERROR_CODES.has(code)) {
    return `admin.skus.error.${code}` as TranslationKey;
  }
  return "admin.skus.error.generic";
}
