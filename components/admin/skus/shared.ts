/**
 * Shared client helpers + error resolver for the SKU-catalog admin UI
 * (Item/Inventory Spine — vendor mini-arc, Slice C1). Mirrors
 * components/admin/vendors/shared.ts: re-exports the same pessimistic postJson
 * (redirect:"manual", machine-stable `code`) plus a SKU-scoped error resolver.
 */

import type { TranslationKey } from "@/lib/i18n/types";
import type { SkuView } from "@/lib/admin/skus";
import { buildPackChain, formatChainDescriptor, type PackChainLevel } from "@/lib/pack-chain-shared";
import { GLOBAL_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

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
  "step_up_grant_required",
  "avg_required_by_chain",
  "invalid_price",
  "invalid_date",
  "invalid_sku",
  // polish-c: emitted by createSku/updateSku but used to fall to generic.
  "invalid_sku_class",
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
  // VO-7 (per-location SKU overlay).
  "invalid_active_override",
  "invalid_weekday_par",
  "invalid_weekend_par",
  // The overlay's optimistic-concurrency refusal (audit fix): the row moved under the
  // editor — most often /ordering accepting a par suggestion on the OTHER day-class.
  "overlay_changed",
  // Product membership (0179), now delegated to lib/products.ts's attach/detach writers.
  // Their refusals reach this form, and a named 409 with a generic message is half a fix.
  "already_member",
  "primary_must_be_reassigned",
  "invalid_product",
  "products_schema_pending",
  // Catalog Phase 2a (D5): the global pack/price boundary.
  "global_requires_moo",
  "version_changed",
  "sku_inactive",
  // the owning-shop bind on a shop-owned SKU (pack-chain.ts skuOwnerAllowed)
  "not_found",
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

/** A chain save's outcome, CODE included — the editor shows that code's own message, never a stale prop. */
export type SaveChainResult = { ok: true } | { ok: false; code: string };
/** The step-up prompt was dismissed: nothing to say. */
export const STEP_UP_CANCELLED = "step_up_cancelled";

/**
 * Does this SKU ALREADY have a GLOBAL pack? A live chain, or any flat pack field set — the
 * 'Each (no case)' placeholder alone is "unknown", not a value. Mirrors 0259's first-value rule
 * (save_sku_pack_version v_had_flat), so the screen never offers a save the database refuses.
 */
export function hasGlobalPack(
  sku: { packFormat: string | null; unitsPerPack: number | null; eachSize: number | null; eachMeasure: string | null },
  chainLength: number,
): boolean {
  return chainLength > 0 || sku.unitsPerPack != null || sku.eachSize != null || sku.eachMeasure != null
    || (sku.packFormat != null && sku.packFormat !== "Each (no case)");
}

/**
 * May this actor change the GLOBAL pack here? MoO (8) and up always; below that only the FIRST pack
 * of a SKU that has none (catalog Phase 2a, D5). When false the editor opens READ-ONLY with a plain
 * line, and never asks for a password for a save that cannot succeed.
 */
export function canChangeGlobalPack(actorLevel: number, skuHasGlobalPack: boolean): boolean {
  return actorLevel >= GLOBAL_VERSION_WRITE_MIN || !skuHasGlobalPack;
}
