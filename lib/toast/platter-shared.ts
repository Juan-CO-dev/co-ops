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
