/** Door input validation; deliberately independent of server modules. */
export function storeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= 160 ? name : null;
}

export function pendingItemInput(name: unknown, countUnit: unknown, contentOz: unknown):
  { name: string; countUnit: string; contentOz: number | null } | null {
  const n = storeName(name);
  const unit = storeName(countUnit);
  if (!n || !unit || unit.length > 40) return null;
  if (contentOz != null && (typeof contentOz !== "number" || !Number.isFinite(contentOz) || contentOz <= 0)) return null;
  return { name: n, countUnit: unit, contentOz: contentOz == null ? null : contentOz as number };
}

/** A pending count unit must have an explicit, finite ounce basis before review closes. */
export function resolutionContentOz(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Server refusals remain specific; unknown failures never masquerade as connectivity. */
export function storeErrorKey(code: unknown): import("@/lib/i18n/types").TranslationKey {
  const keys: Record<string, import("@/lib/i18n/types").TranslationKey> = {
    forbidden: "receivingStore.error_forbidden", store_location_conflict: "receivingStore.error_store_location_conflict",
    store_item_conflict: "receivingStore.error_store_item_conflict", store_merge_conflict: "receivingStore.error_store_merge_conflict",
    store_inactive: "receivingStore.error_store_inactive", conversion_required: "receivingStore.error_conversion_required",
    invalid_name: "receivingStore.error_invalid_name", not_found: "receivingStore.error_not_found",
    step_up_required: "receivingStore.error_step_up_required", step_up_stale: "receivingStore.error_step_up_stale",
  };
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(keys, code)
    ? keys[code]! : "receivingStore.error_invalid_payload";
}
