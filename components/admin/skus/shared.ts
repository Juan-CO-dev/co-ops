/**
 * Shared client helpers + error resolver for the SKU-catalog admin UI
 * (Item/Inventory Spine — vendor mini-arc, Slice C1). Mirrors
 * components/admin/vendors/shared.ts: re-exports the same pessimistic postJson
 * (redirect:"manual", machine-stable `code`) plus a SKU-scoped error resolver.
 */

import type { TranslationKey } from "@/lib/i18n/types";
import type { SkuView } from "@/lib/admin/skus";

export { postJson, type PostResult } from "@/components/admin/vendors/shared";

/** Error codes the SKU routes + lib can emit that have a localized message. */
const KNOWN_ERROR_CODES = new Set([
  "forbidden",
  "mixed_concerns",
  "invalid_vendor",
  "invalid_location",
  "invalid_lead_time",
  "invalid_name",
  "invalid_pack_format",
  "invalid_units_per_pack",
  "invalid_each_size",
  "invalid_label",
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

/**
 * Compose the structured purchase model into a single human-readable string.
 * Examples: "Case of 6 × 32 oz" / "Each — 32 oz" / "Case of 6" / "Case".
 * Client-safe (takes the translator). Falls back to "—" when no pack format.
 */
export function formatSkuPack(
  sku: Pick<SkuView, "packFormat" | "unitsPerPack" | "eachSize" | "eachMeasure">,
  t: (key: TranslationKey) => string,
): string {
  let out = sku.packFormat ?? "—";
  const hasCount = sku.unitsPerPack != null && sku.unitsPerPack > 1;
  if (hasCount) {
    out += ` ${t("admin.skus.pack_of")} ${sku.unitsPerPack}`;
  }
  if (sku.eachSize != null) {
    const each = `${sku.eachSize}${sku.eachMeasure ? ` ${sku.eachMeasure}` : ""}`;
    out += hasCount ? ` × ${each}` : ` — ${each}`;
  }
  return out;
}
