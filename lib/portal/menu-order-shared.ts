/**
 * Order-builder section ordering — pure (zero I/O, client-safe).
 *
 * The catering catalog has no category column; a menu row only carries its `section`
 * heading ("Drinks", "Catering Sides", "Sweets", "Subs", …). The order builder needs a
 * customer-decision order for those headings — Juan's rule from the 2026-09-03 first-live
 * test: packages first (rendered by the page, not a section), then DRINKS, then SIDES,
 * then DESSERTS, and à la carte (subs / build-your-own / anything unclassified) last.
 *
 * `catForSection` is the same heuristic the coverage meter has always used on the page;
 * it lives here so the ordering and the meter can never disagree about what a heading is.
 */

export type MenuCat = "main" | "side" | "sweet" | "drink";

/** Customer decision order. Lower renders first. */
export const SECTION_RANK: Readonly<Record<MenuCat, number>> = {
  drink: 0,
  side: 1,
  sweet: 2,
  main: 3,
};

/** Classify a section heading. Unknown / missing headings are à la carte (main). */
export function catForSection(section: string | null | undefined): MenuCat {
  const s = (section ?? "").toLowerCase();
  if (/(side|chip|salad)/.test(s)) return "side";
  if (/(sweet|cookie|dessert|cannoli|treat)/.test(s)) return "sweet";
  if (/(drink|soda|water|beverage)/.test(s)) return "drink";
  return "main";
}

/** Stable sort of section groups into customer decision order. Never mutates the input. */
export function orderSections<T extends { label: string }>(groups: readonly T[]): T[] {
  return groups
    .map((g, i) => ({ g, i, rank: SECTION_RANK[catForSection(g.label)] }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.g);
}
