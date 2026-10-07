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
