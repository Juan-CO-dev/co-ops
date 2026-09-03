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

/**
 * Portal heading for a Toast section. Drinks / sides / desserts MERGE into one section per
 * type (Juan, 2026-09-03: "Drinks" + "Catering Drinks" are one shelf to a customer; same for
 * "Sides" + "Catering Sides" + "Chips"). Mains keep their own heading (Subs, Build Your Own…);
 * a missing heading reads as "More". Labels round-trip through catForSection, so ordering
 * by label and ordering by raw section can never disagree.
 */
export function sectionLabel(section: string | null | undefined): string {
  const cat = catForSection(section);
  if (cat === "drink") return "Drinks";
  if (cat === "side") return "Sides";
  if (cat === "sweet") return "Desserts";
  return section && section.trim() ? section : "More";
}

/** Inside a section: catering-size rows (catering_only) on top, à la carte singles under. Stable. */
export function orderWithinSection<T extends { cateringOnly: boolean }>(rows: readonly T[]): T[] {
  return rows
    .map((r, i) => ({ r, i, rank: r.cateringOnly ? 0 : 1 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.r);
}

/** Stable sort of section groups into customer decision order. Never mutates the input. */
export function orderSections<T extends { label: string }>(groups: readonly T[]): T[] {
  return groups
    .map((g, i) => ({ g, i, rank: SECTION_RANK[catForSection(g.label)] }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.g);
}
