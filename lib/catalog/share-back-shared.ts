/** Pure confirmation contracts for the Share and Back jobs. */
import type { PublicShareSkuPreview, PublicShareRecipePreview, PublicShareMenuItemPreview } from "@/lib/catalog/job-preview-shared";
import type { TranslationKey } from "@/lib/i18n/types";
export type ShareKind = "sku" | "recipe" | "menu-item";
export type SharePreview = PublicShareSkuPreview | PublicShareRecipePreview | PublicShareMenuItemPreview;
export interface BackResult { back: string[]; kept: string[]; primary: string; grouping: string }
const sameIds = (selected: string[], expected: Array<{ id: string }>) => selected.length === expected.length
  && new Set(selected).size === expected.length && expected.every(row => selected.includes(row.id));
export function shareConfirmation(kind: ShareKind, preview: SharePreview, skus: string[], items: string[]): Record<string, unknown> | null {
  const common = { expectedOwner: preview.ownerShopId, previewToken: preview.token };
  if (kind === "sku") return "skuId" in preview ? common : null;
  if (!("blockedBy" in preview) || preview.blockedBy.length || !sameIds(skus, preview.shopOnlySkus)) return null;
  if (kind === "recipe") return "recipeId" in preview && !preview.makesSandwich && sameIds(items, preview.shopOnlyItems)
    ? { ...common, shareSkuIds: [...skus], shareItemIds: [...items] } : null;
  return "menuItemId" in preview && sameIds(items, preview.shopOnlyItems) ? { ...common, shareSkuIds: [...skus] } : null;
}
export function shareProducerHref(producer: { id: string; ownerLocationId: string | null }): string {
  return `/admin/catalog/recipe/${encodeURIComponent(producer.id)}?location=${producer.ownerLocationId === null ? "global" : encodeURIComponent(producer.ownerLocationId)}`;
}
export function readBackResult(value: unknown): BackResult | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(id => typeof id === "string");
  return ids(row.back) && ids(row.kept) && typeof row.primary === "string" && typeof row.grouping === "string"
    ? { back: [...row.back], kept: [...row.kept], primary: row.primary, grouping: row.grouping } : null;
}
export function backOutcomeKey(outcome: string): TranslationKey {
  const keys: Record<string, TranslationKey> = {
    restored: "catalog.jobs.back.outcome_restored", changed_since: "catalog.jobs.back.outcome_changed_since",
    kept: "catalog.jobs.back.outcome_kept", retired: "catalog.jobs.back.outcome_retired", none: "catalog.jobs.back.outcome_none", unchanged: "catalog.jobs.back.outcome_none",
  };
  return keys[outcome] ?? "catalog.jobs.back.outcome_unknown";
}
