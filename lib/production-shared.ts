/**
 * Production — CLIENT-SAFE shared surface (pure; no I/O, no server imports).
 *
 * B8 #12 (sim walk 2026-10-14): the Production SKU picker listed two "1/2 pint bottoms (flexi)
 * (0 in stock)". Not a join fan-out — the picker reads `vendor_items` by id, one row each — but two
 * distinct active SKUs carry the same name (the same container bought from two vendors, or a
 * store-run copy). Both are real and must stay pickable, so a name that collides is shown with
 * its vendor; a unique name stays bare.
 */

export interface ProductionSkuOption {
  id: string;
  name: string;
  inStockPacks: number;
  vendorName: string | null;
  /** Another active SKU shares this name (trimmed, case-insensitive) — show the vendor. */
  nameClash: boolean;
}

/** Marks SKUs whose name collides with another's. Order and ids are preserved; nothing is dropped. */
export function markSkuNameClashes<T extends { name: string }>(rows: readonly T[]): Array<T & { nameClash: boolean }> {
  const key = (name: string) => name.trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(key(r.name), (counts.get(key(r.name)) ?? 0) + 1);
  return rows.map((r) => ({ ...r, nameClash: (counts.get(key(r.name)) ?? 0) > 1 }));
}

/** The picker label's name part: bare, or "name — vendor" when the name collides. */
export function skuOptionName(option: Pick<ProductionSkuOption, "name" | "vendorName" | "nameClash">, noVendorLabel: string): string {
  return option.nameClash ? `${option.name.trim()} — ${option.vendorName ?? noVendorLabel}` : option.name;
}
