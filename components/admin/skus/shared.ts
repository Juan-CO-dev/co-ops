/**
 * Shared client helpers + error resolver for the SKU-catalog admin UI
 * (Item/Inventory Spine — vendor mini-arc, Slice C1). Mirrors
 * components/admin/vendors/shared.ts: re-exports the same pessimistic postJson
 * (redirect:"manual", machine-stable `code`) plus a SKU-scoped error resolver.
 */

import type { TranslationKey } from "@/lib/i18n/types";
import type { SkuView } from "@/lib/admin/skus";
import { buildPackChain, formatChainDescriptor, type PackChainLevel } from "@/lib/pack-chain-shared";

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
  "invalid_avg_oz_per_each",
  "invalid_dimension",
  "invalid_factor",
  "invalid_label",
  "sku_not_found",
  "invalid_payload",
  "step_up_required",
  "step_up_stale",
  "invalid_price",
  "invalid_date",
  "invalid_sku",
  // Pack-chain (0159) route/lib codes.
  "empty_chain",
  "label_is_measure_unit",
  "duplicate_label",
  "invalid_qty",
  "invalid_link",
  "invalid_pointer",
  "self_reference",
  "unknown_measure",
  "chain_cycle",
  "chain_unreachable",
  "leaf_needs_avg",
  "chain_invalid",
]);

/** Resolve an error `code` to a localized message, falling back to generic. */
export function resolveErrorKey(code: string): TranslationKey {
  if (KNOWN_ERROR_CODES.has(code)) {
    return `admin.skus.error.${code}` as TranslationKey;
  }
  return "admin.skus.error.generic";
}

/**
 * Compose the pack model into a single human-readable string (SKU top-tier PR-C —
 * chain-aware). When the SKU carries an active pack CHAIN, render CHAIN language via
 * the pure descriptor ("Case → 4 log → 34 oz" / "Case → 12 each") — the chain is
 * the source of truth for pack vocabulary. Otherwise fall back to the legacy flat
 * format: "Case of 6 × 32 oz" / "Each — 32 oz" / "Case of 6" / "Case" / "—".
 * Client-safe (takes the translator; the descriptor needs no i18n — labels + measure
 * units are already the manager's own words).
 */
export function formatSkuPack(
  sku: Pick<SkuView, "packFormat" | "unitsPerPack" | "eachSize" | "eachMeasure">,
  t: (key: TranslationKey) => string,
  chain?: PackChainLevel[] | null,
): string {
  if (chain && chain.length > 0) {
    const descriptor = formatChainDescriptor(buildPackChain(chain));
    if (descriptor != null) return descriptor;
    // Malformed chain (no unique root, etc.) → fall through to the flat format.
  }
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
