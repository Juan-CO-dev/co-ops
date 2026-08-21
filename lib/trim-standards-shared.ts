/**
 * The STANDARD TRIM REGISTRY — PURE, client-safe (`*-shared.ts` law, AGENTS.md).
 *
 * Lifted VERBATIM out of `scripts/seed/22-portioned-recipe-fix.ts` (PR #271), which
 * is where it was born and where it stayed: a `const` inside a one-shot seed script
 * that exports nothing. Its values reached the database only as baked-in
 * `recipe_inputs.quantity`, a prose stanza in `recipes.notes`, and
 * `audit_log.metadata.trim_fraction` — so the "standard" half of the spec's
 * standard-vs-observed comparison had no importable existence at all.
 *
 * This module is that existence. Deviation D11 of
 * `docs/superpowers/plans/2026-08-20-product-identity.md`: lift it so the weight &
 * trim board can render the expectation beside the observation, and have seed 22
 * import it so there is exactly ONE copy of every number and every rationale.
 *
 * NOTHING HERE IS NEW. Every `trim`, every `evidence` grade and every `rationale`
 * string is byte-for-byte what seed 22 carried; the published-yield citation on
 * HEAD_LETTUCE_CORED_CHOPPED is load-bearing evidence and is reproduced whole. If a
 * number ever changes it changes HERE, and seed 22 re-derives from it.
 */

// ── THE STANDARD TRIM REGISTRY ────────────────────────────────────────────────
//
// Five classes, each with a trim FRACTION and the evidence behind it. Two evidence
// grades, deliberately kept apart, because conflating them is how an estimate
// acquires the authority of a citation:
//
//   PUBLISHED_YIELD_TABLE — the number comes off a foodservice yield reference and
//     can be looked up by anyone who doubts it.
//   OPERATIONAL_ESTIMATE  — no published table covers this operation. The number is
//     reasoned from the named physical loss and is FIRST IN LINE to be replaced by
//     observed trim once production capture runs. It is a placeholder that knows it
//     is one, which is the entire difference from what stage 3d left behind.
//   VENDOR_PREPROCESSED   — the vendor already did the trimming. Zero is not an
//     estimate here, it is the correct value, and it must not drift upward just
//     because its neighbours in the table are non-zero.
//
// A note on why the deli rows are estimates. Published yield tables (US Foods'
// Common Product Yields, the Book of Yields, the USDA Food Buying Guide) cover RAW
// FABRICATION — breaking down a primal, peeling and coring produce. None of them
// costs "machine-slicing an already-cooked, rindless deli piece", because in the
// trade that loss is a shop constant, not a published one. Rather than dress a
// guess as a citation, these rows name the physical loss (the heel the slicer
// carriage cannot hold, casing or netting peel, the film left on the plate) and
// take a low single-digit allowance consistent with it.
export type TrimEvidence = "PUBLISHED_YIELD_TABLE" | "OPERATIONAL_ESTIMATE" | "VENDOR_PREPROCESSED";

export interface TrimStandard {
  /** Fraction of the raw input that never reaches the pan. 0.02 = 2% trim = 98% yield. */
  trim: number;
  evidence: TrimEvidence;
  rationale: string;
}

export const TRIM_STANDARDS: Record<string, TrimStandard> = {
  /**
   * Cooked whole-muscle and formed deli meats sliced to order (ham, turkey breast,
   * roast beef). Loss is the heel — the last inch or so the carriage can no longer
   * grip — plus the film left on the blade and plate between products. No casing to
   * peel on these, so it is the smallest of the slicing allowances.
   */
  DELI_MEAT_COOKED_SLICED: {
    trim: 0.02,
    evidence: "OPERATIONAL_ESTIMATE",
    rationale:
      "Heel/end piece the slicer carriage cannot hold, plus blade-and-plate film. No casing on these products. 2% (98% yield) — the smallest slicing allowance in the table.",
  },

  /**
   * Dry/cured sausage sliced to order (Genoa, capicola, pepperoni, mortadella).
   * Everything the cooked-meat class loses, plus the casing or netting, which comes
   * off as waste and is a real fraction of a narrow log's diameter. Hence a point
   * more than its cooked-meat neighbour, and it should stay higher than that row
   * even if both get retuned.
   */
  DELI_SAUSAGE_CASED_SLICED: {
    trim: 0.03,
    evidence: "OPERATIONAL_ESTIMATE",
    rationale:
      "Heel + blade film as above, PLUS casing/netting peel, which is a meaningful fraction of a narrow log's cross-section. 3% (97% yield) — deliberately one point above the uncased cooked-meat class.",
  },

  /**
   * Deli block cheese sliced to order (cheddar, provolone). Boar's Head and PFG deli
   * blocks arrive rindless and waxless, so this is the same heel-and-film loss as
   * cooked meat rather than a rind allowance.
   */
  BLOCK_CHEESE_SLICED: {
    trim: 0.02,
    evidence: "OPERATIONAL_ESTIMATE",
    rationale:
      "Deli blocks arrive rindless/waxless, so the loss is heel + plate film, not rind. Matched to the cooked-meat class at 2% (98% yield) on purpose: same physical loss, same number.",
  },

  /**
   * Whole-head iceberg, cored and chopped. The one row in this table with a
   * published number behind it, and by far the largest — the core, the wrapper
   * leaves and the tough outer ribs are a third of a head's purchased weight.
   *
   * 38% (62% yield) is the "trimmed and cored" figure carried by US Foods' Common
   * Product Yields and the Book of Yields. It is not the only published figure:
   * shorter charts (e.g. the Christian Chefs yield chart) put a 2.25 lb head at 74%
   * yield / 26% trim, a definition that appears to stop at coring rather than
   * running through to cleaned, chopped, ready-to-build lettuce. Both are named here
   * so the choice is visible; 38% is taken because it matches what actually happens
   * to a head at CO (core out, wrapper leaves off, chopped into the pan) and because
   * where two standards disagree the costing board's own doctrine says take the one
   * that does not flatter the margin. If Juan's floor experience says 26%, that is a
   * one-number edit here and a re-run — which is what the dry-run gate is for.
   */
  HEAD_LETTUCE_CORED_CHOPPED: {
    trim: 0.38,
    evidence: "PUBLISHED_YIELD_TABLE",
    rationale:
      "Core, wrapper leaves and outer ribs. 62% yield for 'iceberg, trimmed and cored' per US Foods Common Product Yields / Book of Yields. A shorter chart puts a whole head at 74% yield; 38% trim is taken as the one that matches CO's core-and-chop and does not flatter the margin.",
  },

  /**
   * Vendor-prepped packs: already shredded, already sliced, already brined and
   * portioned. Nothing is trimmed in our kitchen — the pack is opened and portioned.
   *
   * Zero here is a STATEMENT, not a gap. A non-zero trim on a shredded-cheese bag
   * would be inventing shrink that nobody observes, and would push cost up for no
   * reason a count could ever confirm.
   */
  VENDOR_PREPPED_NONE: {
    trim: 0,
    evidence: "VENDOR_PREPROCESSED",
    rationale:
      "Vendor already did the trimming — pre-shredded, pre-sliced, or brined and portioned. Opened and portioned, never trimmed, so the yield is 100% and zero is the correct value rather than an unfilled one.",
  },
};

/**
 * The 13 portioned items and the trim class each belongs to.
 *
 * SKU, slice weight, declared par-unit weight and yield are NOT listed here — every
 * one of them is read LIVE below, from whatever SKU the recipe pins TODAY (the
 * Angel waves moved several of these pins as recently as this week). Hardcoding a
 * slice weight in this table would recreate the class of bug it is fixing.
 */
export const PORTIONED_ITEMS: Array<{ item: string; trimClass: keyof typeof TRIM_STANDARDS }> = [
  { item: "Capicola", trimClass: "DELI_SAUSAGE_CASED_SLICED" },
  { item: "Cheddar", trimClass: "BLOCK_CHEESE_SLICED" },
  { item: "Fresh Mozzarella", trimClass: "VENDOR_PREPPED_NONE" },
  { item: "Genoa", trimClass: "DELI_SAUSAGE_CASED_SLICED" },
  { item: "Ham", trimClass: "DELI_MEAT_COOKED_SLICED" },
  { item: "Hot Peppers", trimClass: "VENDOR_PREPPED_NONE" },
  { item: "Iceberg", trimClass: "HEAD_LETTUCE_CORED_CHOPPED" },
  { item: "Pepperoni", trimClass: "DELI_SAUSAGE_CASED_SLICED" },
  { item: "Provolone", trimClass: "BLOCK_CHEESE_SLICED" },
  { item: "Roast Beef", trimClass: "DELI_MEAT_COOKED_SLICED" },
  { item: "Shredded Mozzarella", trimClass: "VENDOR_PREPPED_NONE" },
  { item: "Sweet Peppers", trimClass: "VENDOR_PREPPED_NONE" },
  { item: "Turkey", trimClass: "DELI_MEAT_COOKED_SLICED" },
];

/**
 * The standard trim for a prep ITEM by name, or null when the item is not one of
 * the 13 portioned preps. Name-keyed because that is what the registry has always
 * been keyed by (seed 22 resolves items by name too) — and a null return is the
 * honest "no reference", never a fabricated 0.
 */
export function trimStandardForItem(itemName: string): TrimStandard | null {
  const entry = PORTIONED_ITEMS.find((p) => p.item === itemName);
  if (!entry) return null;
  return TRIM_STANDARDS[entry.trimClass] ?? null;
}
