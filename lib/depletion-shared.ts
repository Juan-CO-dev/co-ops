export interface DepletionAggregateRow { skuId: string; directOz: number; }
export interface DepletionAttributionRow { itemId: string; itemPath: readonly string[]; skuId: string; oz: number; }

/** Juan's item/day rule: sales count unless that prep item has logged production. */
export function selectSalesDepletion(
  direct: readonly DepletionAggregateRow[],
  attributed: readonly DepletionAttributionRow[],
  producedItemIds: ReadonlySet<string>,
): Map<string, number> {
  const selected = new Map<string, number>();
  for (const row of direct) selected.set(row.skuId, (selected.get(row.skuId) ?? 0) + Math.max(0, row.directOz));
  for (const row of attributed) {
    if (row.itemPath.some((itemId) => producedItemIds.has(itemId))) continue;
    selected.set(row.skuId, (selected.get(row.skuId) ?? 0) + Math.max(0, row.oz));
  }
  return selected;
}

export function findNestedProductionDuplicates(
  producedItemIds: ReadonlySet<string>,
  descendants: ReadonlyMap<string, ReadonlySet<string>>,
): Array<{ ancestorItemId: string; descendantItemId: string }> {
  const out: Array<{ ancestorItemId: string; descendantItemId: string }> = [];
  for (const ancestorItemId of producedItemIds) {
    for (const descendantItemId of descendants.get(ancestorItemId) ?? []) {
      if (producedItemIds.has(descendantItemId)) out.push({ ancestorItemId, descendantItemId });
    }
  }
  return out;
}

/** W16/B092 — how long a logged production covers later sales of the same prep item. */
export const DEFAULT_CARRY_DAYS = 5;   // recipes.shelf_life_days default (0215, Juan: "Everything is 5 days")
export const CARRY_CAP_DAYS = 14;      // bounds the productions read; a longer shelf life still carries 14 days

/** The carry for an item from the shelf lives of the recipes that make it: the longest, else the default, capped. */
export function carryDaysFor(shelfLives: readonly number[] | undefined): number {
  const valid = (shelfLives ?? []).filter((d) => Number.isFinite(d) && d > 0);
  const days = valid.length > 0 ? Math.max(...valid) : DEFAULT_CARRY_DAYS;
  return Math.min(Math.floor(days), CARRY_CAP_DAYS);
}

const dayNumber = (ymd: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`producedItemsForDay: bad ymd "${ymd}"`);
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
};

/**
 * W16/B092 — the items whose logged production COVERS sales on ET day `day` at one shop: a live production
 * dated (ET) inside [day − carryDays(item), day]. Juan's item/day rule, widened to the batch's carry: a tuna
 * salad made Monday and sold through Friday was depleted once by Monday's production_inputs, so Tuesday's
 * sales may not deplete its raw SKUs again through the fallback. A production on a LATER day never covers an
 * earlier one; an item never produced in the window keeps the fallback. `productionDays` = item → its live
 * production ET dates at this shop.
 */
export function producedItemsForDay(
  productionDays: ReadonlyMap<string, readonly string[]>,
  day: string,
  carryDays: (itemId: string) => number,
): Set<string> {
  const d = dayNumber(day);
  const out = new Set<string>();
  for (const [itemId, dates] of productionDays) {
    const carry = carryDays(itemId);
    if (dates.some((p) => { const n = dayNumber(p); return n <= d && n >= d - carry; })) out.add(itemId);
  }
  return out;
}
