/**
 * Platter/assortment depletion semantics (spec 2026-07-25). PURE, client-safe,
 * unit-tested — the doctrine constants and pool math the Toast sales
 * projection uses when a sold Toast line maps to a CO catering_package.
 *
 * Model (Juan 2026-07-25): a platter's choice slot already encodes WHOLE SUBS
 * (halves doctrine: 8 pc = 4 whole subs — seeded by the platter-slot
 * reconcile). The shop assembles the assortment, so depletion is an EVEN MIX
 * across the eligible pool: the full enabled slot options ("Our Favorites" —
 * the platter product line), or the classic-flagged subset ("The Classics").
 */

/** Which pool an assortment pick selects. */
export type AssortmentKind = "full" | "classics";

/**
 * One platter PIECE is half a sub (halves doctrine) — the default portion for
 * a menu_item-target modifier application (a named-sub pick under a platter).
 */
export const MENU_ITEM_MODIFIER_PORTION_WHOLE_SUBS = 0.5;

/** portion_unit label for menu_item-target modifier rows (documentation value). */
export const WHOLE_SUB_UNIT = "whole_sub";

/**
 * Select the depletion pool for an assortment. "classics" takes the
 * classic-flagged subset; an empty subset FALLS BACK to the full pool (a
 * mis-flagged KB must degrade to Our-Favorites behavior, never to zero
 * depletion).
 */
export function selectAssortmentPool<T extends { classic: boolean }>(
  options: T[],
  kind: AssortmentKind,
): T[] {
  if (kind === "classics") {
    const subset = options.filter((o) => o.classic);
    if (subset.length > 0) return subset;
  }
  return options;
}

/** Even-mix share per pool option. 0 on an empty pool (caller surfaces the advisory). */
export function evenMixPerOption(wholeSubs: number, poolSize: number): number {
  if (poolSize <= 0 || !Number.isFinite(wholeSubs)) return 0;
  return wholeSubs / poolSize;
}

export interface PackagePickSlot {
  id: string;
  quantity: number;
  depletionQty: number;
  displayOrder: number;
  menuItemIds: string[];
}

export interface PackagePickAllocation {
  picks: Array<{ menuItemId: string; units: number }>;
  remaining: number;
  excess: boolean;
}

/** Bind in ledger order to the first eligible slot, then spend only its capacity. */
export function allocatePackagePicks(
  slots: PackagePickSlot[], picks: Array<{ id: string; menuItemId: string; qty: number }>, saleQty: number,
): { bySlot: Map<string, PackagePickAllocation>; consumed: Set<string> } {
  const ordered = slots.slice().sort((a, b) => a.displayOrder - b.displayOrder);
  const bySlot = new Map<string, PackagePickAllocation>(slots.map((slot) => [slot.id, {
    picks: [], remaining: slot.depletionQty * saleQty, excess: false,
  }]));
  const consumed = new Set<string>();
  for (const pick of picks) {
    const slot = ordered.find((candidate) => candidate.menuItemIds.includes(pick.menuItemId));
    if (!slot) continue;
    const allocation = bySlot.get(slot.id)!;
    const requested = pick.qty * (slot.depletionQty / slot.quantity);
    const units = Math.min(requested, allocation.remaining);
    if (units > 0) allocation.picks.push({ menuItemId: pick.menuItemId, units });
    allocation.remaining -= units;
    if (requested > units) allocation.excess = true;
    consumed.add(pick.id);
  }
  return { bySlot, consumed };
}
