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
