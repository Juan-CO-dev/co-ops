/**
 * Seed 22 — the PORTIONED-RECIPE MASS FIX.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────────
 * Stage 3d of the 2026-07-21 operational seed wired every slicing and produce-prep
 * item as a single-input "portioned" recipe, and it filled the input quantity with
 * a placeholder: `1 unit`. Its own header said so ("yield is a placeholder
 * estimate; refine with slice/portion data"). Nobody refined it, and eighteen
 * months of downstream work has been reading those rows as fact.
 *
 * `1 unit` resolves through the SKU's avg_oz_per_each, so what the graph believes
 * is that ONE SLICE of ham becomes a whole 34.4 oz bundle of ham. The engine's
 * arithmetic is correct; the DATA violates conservation of mass. Live ratios of
 * declared-output to actual-input, re-derived against production on 2026-08-20:
 *
 *      Turkey 113.8x · Roast Beef 71.2x · Pepperoni 55.0x · Capicola 47.0x
 *      Genoa 44.8x · Provolone 35.1x · Fresh Mozzarella 32.0x · Ham 28.7x
 *      Hot Peppers 20.0x · Cheddar 14.8x · Shredded Mozzarella 6.7x
 *      Sweet Peppers 5.1x · Iceberg 4.2x
 *
 * Two consequences, and the second is the urgent one:
 *   - 21 of 68 menu items misprice. A Ham Sub costed at $0.6777 when the ham on
 *     it costs $0.64 by itself.
 *   - The AM-prep conversion panel would tell a closer that a full pan of turkey
 *     depletes ONE OUNCE of turkey. That is variance poison: it under-depletes
 *     every prep, so the first real physical count would read as a theft signal.
 *
 * ── JUAN'S RULING (2026-08-20 night) ──────────────────────────────────────────
 * Fix it mass-neutral NOW, and do not stop at mass-neutral: carry a rough
 * INDUSTRY-STANDARD trim per item, because "trim will always fluctuate so we need
 * to establish a standard trim, like the cooked onions." Standard trim is the
 * EXPECTATION. Later, OBSERVED trim gets inferred from production capture (SKU-in
 * vs prep-out) and supersedes it.
 *
 * That inference is brainstorm-bound and is NOT built here. What this script owes
 * it is a data shape it can supersede cleanly, which means one rule: TRIM IS
 * NEVER SILENTLY BAKED. Every quantity below is `declared_output ÷ (1 − trim) ÷
 * slice_weight`, the trim fraction that produced it is named on the recipe's own
 * notes and in the audit row, and the class it came from is a labelled row in the
 * registry below rather than a number someone chose in the moment.
 *
 * ── THE FORMULA, AND ITS DIRECTION ────────────────────────────────────────────
 *      new quantity (slices/units) = oz_per_par_unit ÷ (1 − trim) ÷ avg_oz_per_each
 *
 * Dividing by (1 − trim) makes the INPUT mass EXCEED the output mass — you buy
 * more than reaches the pan. That direction is not a detail, it is the whole
 * invariant: a pan cannot weigh more than what went into it. Multiplying by
 * (1 − trim) instead would recreate the very defect this script exists to remove,
 * just smaller, and it is the one sign error that would still look plausible.
 *
 * ── DRY RUN IS THE DEFAULT, AND THE GATE IS A HUMAN ───────────────────────────
 * Running with no arguments WRITES NOTHING. It prints every would-write row with
 * its arithmetic, the trim registry with a rationale per class, the before/after
 * cost of a sample consuming menu item, and every refusal. Writing requires an
 * explicit `--execute`, and that flag is not used until Juan has eyeballed this
 * output. Waves 1-4 of the Angel arc held the same line; it is the reason that
 * data is trustworthy, and there is no reason to hold this data to a lower bar.
 *
 * Idempotent: every step re-reads the live row and writes only the delta, so a
 * second `--execute` reports "already" on everything and writes nothing.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/22-portioned-recipe-fix.ts
 *        -> DRY RUN (default). Prints everything, writes nothing.
 *      ... 22-portioned-recipe-fix.ts --markdown   -> dry run as markdown (the PR table)
 *      ... 22-portioned-recipe-fix.ts --execute    -> WRITES. Requires Juan's eyeball first.
 *
 * NOTE on --conditions=react-server: lib/supabase-server.ts carries `import
 * "server-only"`; under plain tsx that resolves to its throwing entry point and the
 * seed dies on import. The react-server condition resolves it to the empty stub.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph } from "@/lib/admin/menu-costing";
import { itemMassBalance, massBalanceIndex, MASS_BALANCE_TOLERANCE } from "@/lib/menu-costing-shared";
import { perUnitSkuOzForMenuItemFromGraph, type RecipeGraph } from "@/lib/prep-consumption-graph";
import { pathToFileURL } from "node:url";

/** Provenance key. Dated + named for this fix, so its rows can never be confused
 *  with the Angel waves' `angel-wave*-2026-08-*` or stage 3d's own seed rows. */
const SOURCE_KEY = "portioned-mass-fix-2026-08-20";
const SCRIPT = "scripts/seed/22-portioned-recipe-fix.ts";
const SHEET_CSV = "docs/seed/source/sandwich-build-sheet.csv";
const SOURCE_FINDING =
  "2026-08-20 portioned-recipe debug, findings D1 (placeholder `1 unit` inputs violate mass balance) " +
  "and D2 (the board's new mass-balance guard), plus Juan's 2026-08-20 standard-trim ruling.";

const EXECUTE = process.argv.includes("--execute");
const MD = process.argv.includes("--markdown");

const money = (n: number) => `$${n.toFixed(2)}`;
const money4 = (n: number) => `$${n.toFixed(4)}`;
const pctOf = (f: number) => `${(f * 100).toFixed(1)}%`;
const round = (v: number, dp = 4) => Number(v.toFixed(dp));

function h(level: number, text: string): void {
  console.log(MD ? `\n${"#".repeat(level)} ${text}\n` : `\n${"─".repeat(3)} ${text.toUpperCase()} ${"─".repeat(Math.max(3, 66 - text.length))}\n`);
}
function p(text = ""): void { console.log(text); }

function table(head: string[], rows: string[][], align: string[] = []): void {
  if (rows.length === 0) { p(MD ? "_(none)_" : "  (none)"); return; }
  if (MD) {
    // A bare `|` inside a cell silently shears the row into the wrong columns
    // (seed 21's lesson). Escape here rather than at every call site.
    const cell = (s: string) => (s ?? "").replace(/\|/g, "\\|");
    p(`| ${head.map(cell).join(" | ")} |`);
    p(`|${head.map((_, i) => (align[i] === "r" ? "---:" : "---")).join("|")}|`);
    for (const r of rows) p(`| ${r.map(cell).join(" | ")} |`);
    return;
  }
  const w = head.map((hd, i) => Math.max(hd.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (c: string[]) => c.map((x, i) => (x ?? "").padEnd(w[i]!)).join("  ");
  p(line(head));
  p(w.map((x) => "-".repeat(x)).join("  "));
  for (const r of rows) p(line(r));
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

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
type TrimEvidence = "PUBLISHED_YIELD_TABLE" | "OPERATIONAL_ESTIMATE" | "VENDOR_PREPROCESSED";

interface TrimStandard {
  /** Fraction of the raw input that never reaches the pan. 0.02 = 2% trim = 98% yield. */
  trim: number;
  evidence: TrimEvidence;
  rationale: string;
}

const TRIM_STANDARDS: Record<string, TrimStandard> = {
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
const PORTIONED_ITEMS: Array<{ item: string; trimClass: keyof typeof TRIM_STANDARDS }> = [
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
 * The three subs whose whole cost is one meat plus a roll — so the fix's effect on
 * them is legible to the penny, with nothing else moving underneath.
 */
const HEADLINE_SUBS = ["Ham Sub", "Turkey Sub", "Roast Beef Sub"];

// ── §2 — THE BUILD LINES THIS FIX EXPOSES ─────────────────────────────────────
//
// A build line referencing a PREP with a count-dimension unit — or with a unit that
// is not in `measure_units` at all — is read by the engine as that many PAR-UNITS of
// the prep (`itemRefParUnits`: "unit null / unregistered / count-dimension →
// quantity IS par-units"). A SKU-ref with a count unit resolves through
// avg_oz_per_each instead. That asymmetry is the whole trap, and §1 springs it: while
// a "pan" of fresh mozzarella weighed 1 oz, "3 each" and "3 slices" were numerically
// indistinguishable. Once the pan weighs 32 oz, the same row means THREE QUARTS.
//
// Ground truth is `docs/seed/source/sandwich-build-sheet.csv` — the paper sheet these
// builds were seeded from. Nineteen live lines resolve through par-units; each is
// adjudicated below against what the sheet actually says, and the adjudication is
// one of exactly three verdicts:
//
//   CONVERT — the sheet quotes a count AND the piece weight is a recorded fact, so
//     the line can be re-denominated to ounces with no inference. TWO rows qualify.
//   AS_IS   — the prep's par-unit genuinely IS one piece (Meatballs' output label is
//     literally "4 oz ball", Bacon's is "strip", Chicken Cutlet's is "Piece"), so the
//     count line is already correct and touching it would BREAK it. SIX rows. This
//     verdict is the reason the sweep could not be a blanket "convert every count
//     line" — a third of them are right.
//   REFUSE  — the sheet is silent or ambiguous in ounces. ELEVEN rows.
//
// The refusals are not caution for its own sake. Seed 10, which set these weights,
// refused the same rows in the same words: "the Onion each/quart conflict, cans,
// Mixed Herbs, Shredded Mozz are DEFERRED to the checklist (not guessed)", with
// per-SKU notes reading "unit = whole cucumber", "unit = whole tomato", "unit = a
// portion — LOW confidence", and on basil "conflicting units (leaf + unit) — recipe
// data bug; verify". Where the sheet says "3 ea" of a cucumber and the only recorded
// weight is a WHOLE cucumber, the sheet means slices and we do not have a slice
// weight. Guessing one is the exact move that produced the defect §1 is cleaning up.
type BuildVerdict = "CONVERT" | "AS_IS" | "REFUSE";

interface BuildLineRule {
  /** menu_item name as it appears on the board. */
  consumer: string;
  /** component ITEM (prep) name. */
  prep: string;
  /** Verbatim from sandwich-build-sheet.csv, or the fact that it is absent. */
  sheetQuote: string;
  verdict: BuildVerdict;
  /** CONVERT/REFUSE: the count the sheet states, asserted against the live row. */
  sheetCount?: number;
  /** Where the per-piece weight comes from. CONVERT requires this to be a FACT. */
  pieceProvenance?: string;
  /** AS_IS: why the count line is already right. */
  asIsReason?: string;
  /** REFUSE: the unanswerable part, and the reading we would take if forced. */
  refuseCode?: RefusalCode;
  bestReading?: string;
  question?: string;
}

const BUILD_LINE_RULES: BuildLineRule[] = [
  // ── CONVERT ────────────────────────────────────────────────────────────────
  // One "each" of Fresh Mozzarella is a 1 oz SLICE, and that is vendor spec rather
  // than inference: Angel harvest 2 closed the case as 6 logs x 32 CT x 1 oz = 192
  // slices = 12 lb against BOTH the `6/2 LB` pack field and the `12 LB` subtitle
  // (seed 10's amendment block). The sheet says 3 ea on both subs. 3 x 1 = 3 oz.
  { consumer: "Marisa Tomei Eats Free", prep: "Fresh Mozzarella", sheetQuote: "Marisa Tomei / Fresh Mozz / 3 / ea", verdict: "CONVERT", sheetCount: 3,
    pieceProvenance: "one each = one 1 oz slice — vendor spec, closed by Angel harvest 2 (6 logs x 32 CT x 1 oz = 192/case = 12 lb, agrees with both the pack field and the subtitle); seed 10 amendment block" },
  { consumer: "The Frex", prep: "Fresh Mozzarella", sheetQuote: "Frex / Fresh Mozz / 3 / ea", verdict: "CONVERT", sheetCount: 3,
    pieceProvenance: "one each = one 1 oz slice — same vendor spec as above" },

  // ── AS_IS — the par-unit IS the piece, so the count line is already correct ──
  { consumer: "Vesuvio II", prep: "Meatballs", sheetQuote: "Vesuvio / Meatballs / 3 / ea (cut in half)", verdict: "AS_IS",
    asIsReason: "the Meatballs recipe's output container label is literally \"4 oz ball\" and the item's par unit is Each — one par-unit IS one meatball, so 3 par-units is 3 meatballs, which is what the sheet says" },
  { consumer: "Side of Meatballs", prep: "Meatballs", sheetQuote: "(not on the sheet — but the same par-unit semantics)", verdict: "AS_IS",
    asIsReason: "same: one par-unit is one meatball" },
  { consumer: "Sicky Wicky Club", prep: "Bacon", sheetQuote: "Sicky Wicky Club / Bacon / 2 / ea", verdict: "AS_IS",
    asIsReason: "Cooked Bacon yields 12 with output label \"strip\" — one par-unit is one strip, so 2 par-units is the 2 strips the sheet asks for" },
  { consumer: "Regular BLT", prep: "Bacon", sheetQuote: "(not on the sheet)", verdict: "AS_IS",
    asIsReason: "same strip semantics; 3 strips on a BLT needs no sheet to be plausible" },
  { consumer: "The chicken cutlet", prep: "Chicken Cutlet", sheetQuote: "(not on the sheet)", verdict: "AS_IS",
    asIsReason: "Chicken Cutlet yields 15 with output label \"Piece\" and par unit Piece — one par-unit is one cutlet" },
  { consumer: "Chicken parm", prep: "Chicken Cutlet", sheetQuote: "(not on the sheet)", verdict: "AS_IS",
    asIsReason: "same: one par-unit is one cutlet" },

  // ── REFUSE ─────────────────────────────────────────────────────────────────
  { consumer: "Chicken parm", prep: "Shredded Mozzarella", sheetQuote: "(not on the sheet)", verdict: "REFUSE", sheetCount: 1,
    refuseCode: "UNIT_NOT_IN_OZ", bestReading: "1 handful = 2 oz (the SKU's avg_oz_per_each) -> 2 oz",
    question: "What does a handful of shredded mozzarella weigh? Seed 10 set 2 oz and labelled it \"unit = a portion — LOW confidence\", and listed Shredded Mozz among the rows DEFERRED to the weigh checklist. Chicken parm is not on the build sheet at all, so there is no second source." },
  { consumer: "Vesuvio II", prep: "Shredded Mozzarella", sheetQuote: "Vesuvio / Shredded Cheese / Handfulls / 2", verdict: "REFUSE", sheetCount: 2,
    refuseCode: "UNIT_NOT_IN_OZ", bestReading: "2 handfuls x 2 oz -> 4 oz",
    question: "Same handful question. The sheet confirms the COUNT (2) but states no weight — and note the sheet's own columns are swapped on this row (\"Handfulls\" in the quantity column, \"2\" in the unit column)." },
  { consumer: "Farmers Market After Dark", prep: "Cucumber", sheetQuote: "Farmers Market / Cucumbers / 3 / ea", verdict: "REFUSE", sheetCount: 3,
    refuseCode: "PIECE_IS_NOT_THE_UNIT", bestReading: "3 SLICES, weight unknown (a whole cucumber is 8 oz; 3 whole cucumbers on a sub is not a thing)",
    question: "How much does a cucumber slice weigh, or how many slices come off one cucumber? The only recorded weight is seed 10's \"unit = whole cucumber\" 8 oz." },
  { consumer: "Veggie Sub", prep: "Cucumber", sheetQuote: "(not on the sheet)", verdict: "REFUSE", sheetCount: 3,
    refuseCode: "PIECE_IS_NOT_THE_UNIT", bestReading: "3 slices, weight unknown", question: "Same cucumber-slice question." },
  { consumer: "Regular BLT", prep: "Tomato", sheetQuote: "(not on the sheet)", verdict: "REFUSE", sheetCount: 3,
    refuseCode: "PIECE_IS_NOT_THE_UNIT", bestReading: "3 SLICES, weight unknown (a whole tomato is 5 oz)",
    question: "How much does a tomato slice weigh, or how many slices per tomato? Seed 10 recorded \"unit = whole tomato\" 5 oz, and the Tomato prep's own par-unit is one whole tomato." },
  { consumer: "Sicky Wicky Club", prep: "Tomato", sheetQuote: "Sicky Wicky Club / Tomatoes / 3 / ea", verdict: "REFUSE", sheetCount: 3,
    refuseCode: "PIECE_IS_NOT_THE_UNIT", bestReading: "3 slices, weight unknown", question: "Same tomato-slice question; the sheet says \"3 ea\" but a sub does not carry 3 whole tomatoes." },
  { consumer: "Veggie Sub", prep: "Tomato", sheetQuote: "(not on the sheet)", verdict: "REFUSE", sheetCount: 3,
    refuseCode: "PIECE_IS_NOT_THE_UNIT", bestReading: "3 slices, weight unknown", question: "Same tomato-slice question." },
  { consumer: "Never Been Cheddar", prep: "Radish", sheetQuote: "Never Been Cheddar / Radish / 4 / Julliened", verdict: "REFUSE", sheetCount: 4,
    refuseCode: "PIECE_IS_NOT_THE_UNIT", bestReading: "4 julienne strips, weight unknown (a whole watermelon radish is 3 oz)",
    question: "Is \"4 Julliened\" four radishes julienned, or four julienne strips? The two readings differ by more than an order of magnitude and the sheet's wording does not settle it." },
  { consumer: "Marisa Tomei Eats Free", prep: "Basil", sheetQuote: "Marisa Tomei / Basil / 4 leaves", verdict: "REFUSE", sheetCount: 4,
    refuseCode: "KNOWN_UNIT_CONFLICT", bestReading: "4 leaves x 0.017 oz -> 0.068 oz",
    question: "Basil is the one SKU seed 10 flagged in its own note as \"conflicting units (leaf + unit) — recipe data bug; verify\", and the live per-leaf weight has since moved (0.1 -> 0.017) under the herb-weight policy. Confirm the leaf weight before this row is rewritten against it." },
  { consumer: "Our French Dip", prep: "Jus", sheetQuote: "French Dip / Jus / 1 / ladle", verdict: "REFUSE", sheetCount: 1,
    refuseCode: "UNIT_NOT_IN_OZ", bestReading: "1 ladle ~ 2-4 oz; currently read as 1 QUART",
    question: "How many ounces is a ladle of jus? Note `ladle` is not in `measure_units` at all — an UNREGISTERED unit falls into the same par-unit branch as a count unit, silently, which is a hazard in its own right." },
  { consumer: "Vesuvio II", prep: "Vodka", sheetQuote: "Vesuvio / Vodka Sauce / 2 / ladles", verdict: "REFUSE", sheetCount: 2,
    refuseCode: "UNIT_NOT_IN_OZ", bestReading: "2 ladles; currently read as 2 QUARTS",
    question: "Same ladle question, same unregistered-unit hazard." },
];

// ── §3 — THE HORSEY MAYO SEAM ─────────────────────────────────────────────────
//
// Horsey Mayo is a fourteenth mass violation and NOT one of §1's placeholders: its
// recipe is 32 oz Duke's + 4 oz horseradish = 36 oz in, against 4 outputs declaring
// 16 oz each = 64 oz out (1.78x). Nothing about it is a trim question. Exactly one
// of three numbers is wrong and only Juan knows which, so the script holds it as
// refused and leaves this seam: fill the constant, re-run the dry run, and the write
// plans itself. Leave it `null` and nothing about Horsey Mayo is touched.
type HorseyMayoRuling =
  /** "The recipe makes more than that" — batch inputs scale to the declared 64 oz,
   *  keeping the mayo:horseradish ratio the recipe already states. */
  | { kind: "inputs_wrong"; batchInputOz: number; note: string }
  /** "It doesn't make 4" — recipe_outputs.yield is the wrong number. 36/16 = 2.25. */
  | { kind: "yield_wrong"; outputYield: number; note: string }
  /** "Those bottles aren't 16 oz" — items.oz_per_par_unit is wrong. 36/4 = 9. */
  | { kind: "bottle_size_wrong"; ozPerParUnit: number; note: string };

/** Juan's answer goes HERE. `null` = unanswered = still refused, nothing written. */
const HORSEY_MAYO_RULING: HorseyMayoRuling | null = null;

type RefusalCode =
  | "NO_RECIPE"
  | "AMBIGUOUS_ITEM"
  | "NOT_SINGLE_SKU_INPUT"
  | "NO_DECLARED_PAR_WEIGHT"
  | "NO_SLICE_WEIGHT"
  | "NOT_A_COUNT_UNIT"
  | "ALREADY_BALANCED"
  | "DUAL_PRODUCER_UNREACHABLE"
  // §2 codes
  | "UNIT_NOT_IN_OZ"
  | "PIECE_IS_NOT_THE_UNIT"
  | "KNOWN_UNIT_CONFLICT"
  | "LINE_MOVED"
  | "NO_PIECE_WEIGHT"
  // §3
  | "AWAITING_JUAN";

interface Refusal {
  item: string;
  subject: string;
  code: RefusalCode;
  detail: string;
}

/** §2: one build line to re-denominate from par-units to ounces. */
interface LinePlan {
  inputId: string;
  consumer: string;
  prep: string;
  prepItemId: string;
  menuItemId: string | null;
  sheetQuote: string;
  oldQty: number;
  oldUnit: string | null;
  newQty: number;
  pieceOz: number;
  pieceProvenance: string;
}

/** §3: the Horsey Mayo write, planned only when HORSEY_MAYO_RULING is filled. */
interface HorseyPlan {
  kind: HorseyMayoRuling["kind"];
  itemId: string;
  recipeId: string;
  note: string;
  before: string;
  after: string;
  /** inputs_wrong: per-input id -> new quantity. */
  inputScale?: Array<{ id: string; name: string; oldQty: number; newQty: number; unit: string | null }>;
  /** yield_wrong: recipe_outputs row + new yield. */
  outputRow?: { id: string; oldYield: number; newYield: number };
  /** bottle_size_wrong: items.oz_per_par_unit. */
  newOzPerParUnit?: { old: number; next: number };
}

interface Plan {
  item: string;
  itemId: string;
  recipeId: string;
  recipeName: string;
  recipeNotes: string | null;
  recipeDirections: string | null;
  inputId: string;
  skuId: string;
  skuName: string;
  vendorName: string;
  parUnitLabel: string;
  /** items.oz_per_par_unit — the declared finished weight of one par-unit. */
  declaredOz: number;
  /** recipe_outputs.yield — par-units one batch makes. */
  outYield: number;
  /** vendor_items.avg_oz_per_each — the weight of ONE slice/unit of the pinned SKU. */
  sliceOz: number;
  trimClass: keyof typeof TRIM_STANDARDS;
  trim: number;
  oldQty: number;
  newQty: number;
  /** Input mass one batch will carry after the fix, in oz. */
  newInputOz: number;
  /** How badly the OLD row violated mass balance. */
  oldRatio: number;
  /** Whether the live costing graph actually routes this item through this recipe. */
  liveInGraph: boolean;
}

const plans: Plan[] = [];
const linePlans: LinePlan[] = [];
const asIsLines: Array<{ consumer: string; prep: string; sheetQuote: string; reason: string; qty: number; unit: string | null }> = [];
const refusals: Refusal[] = [];
let horseyPlan: HorseyPlan | null = null;

// ── Live shapes ───────────────────────────────────────────────────────────────

interface LiveRecipe {
  recipeId: string;
  recipeName: string;
  active: boolean;
  notes: string | null;
  directions: string | null;
  itemId: string;
  outYield: number;
  outLabel: string | null;
  inputs: Array<{ id: string; skuId: string | null; itemId: string | null; quantity: number; unit: string | null }>;
}

/** The notes stanza that makes the trim visible ON the row, not only in the audit log. */
function trimStanza(plan: Plan): string {
  const std = TRIM_STANDARDS[plan.trimClass]!;
  return (
    `[standard-trim ${SOURCE_KEY}] ${plan.trimClass} = ${pctOf(plan.trim)} trim (${pctOf(1 - plan.trim)} yield, ${std.evidence}). ` +
    `Input ${round(plan.newQty)} x ${plan.sliceOz} oz = ${round(plan.newInputOz, 2)} oz raw -> ${plan.declaredOz} oz per ${plan.parUnitLabel} x ${plan.outYield}. ` +
    `STANDARD, not observed: supersede with measured trim from production capture when it exists.`
  );
}

/** Stage 3d's parenthetical is FALSE once the input is standards-based. Replace it. */
const STALE_DIRECTIONS_TAIL = " (Portioned item — yield is a placeholder estimate; refine with slice/portion data.)";
function fixedDirections(plan: Plan): string | null {
  const d = plan.recipeDirections;
  if (d == null) return null;
  const base = d.endsWith(STALE_DIRECTIONS_TAIL) ? d.slice(0, -STALE_DIRECTIONS_TAIL.length) : d;
  const tail =
    plan.trim > 0
      ? ` (Portion count assumes ${pctOf(plan.trim)} standard trim — the raw input weighs more than the pan.)`
      : " (Vendor-prepped: nothing is trimmed here, so the pack weight is the pan weight.)";
  return base.endsWith(tail) ? base : base + tail;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const sb = getServiceRoleClient();

  if (!MD) {
    p(EXECUTE
      ? "══ EXECUTE MODE — this run WRITES to recipe_inputs / recipes ══"
      : "══ DRY RUN (default) — no writes. Pass --execute after Juan's eyeball. ══");
  }

  // ── Live universe ───────────────────────────────────────────────────────────
  const graphBefore = await loadRecipeGraph();
  const prices = await loadCurrentSkuPrices([...graphBefore.skuPack.keys()]);
  const costPerOz = costPerOzFromGraph(graphBefore, prices);

  const { data: itemRows, error: itemErr } = await sb
    .from("items").select("id, name, oz_per_par_unit, active, location_id")
    .returns<Array<{ id: string; name: string; oz_per_par_unit: number | string | null; active: boolean; location_id: string | null }>>();
  if (itemErr) throw new Error(`items: ${itemErr.message}`);
  const itemNameById = new Map((itemRows ?? []).map((i) => [i.id, i.name]));

  /**
   * Item names are NOT unique and a Map keyed by name silently keeps the last row.
   *
   * Every one of these 13 names has THREE rows live: two inactive per-location
   * legacy rows (from before items went global) and one active row with a null
   * location_id. The first version of this script keyed on name and got lucky on
   * 12 of them — Sweet Peppers came back in an order that handed it the inactive
   * Cap Hill row, which carries no oz_per_par_unit, and it was refused as if the
   * data were missing. It was not missing; the lookup was wrong.
   *
   * So: match ACTIVE rows only, and when more than one is active REFUSE rather
   * than pick. A silent pick between two live items is precisely how a fix lands
   * on the wrong row.
   */
  const activeItemsByName = new Map<string, Array<(typeof itemRows extends null ? never : NonNullable<typeof itemRows>)[number]>>();
  for (const i of itemRows ?? []) {
    if (!i.active) continue;
    const list = activeItemsByName.get(i.name) ?? [];
    list.push(i);
    activeItemsByName.set(i.name, list);
  }

  const { data: skuRows, error: skuErr } = await sb
    .from("vendor_items").select("id, name, avg_oz_per_each, active, vendor_id")
    .returns<Array<{ id: string; name: string; avg_oz_per_each: number | string | null; active: boolean; vendor_id: string | null }>>();
  if (skuErr) throw new Error(`vendor_items: ${skuErr.message}`);
  const skuById = new Map((skuRows ?? []).map((s) => [s.id, s]));

  const { data: vendorRows } = await sb.from("vendors").select("id, name").returns<Array<{ id: string; name: string }>>();
  const vendorById = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));

  const { data: menuRows, error: menuErr } = await sb
    .from("menu_items").select("id, name, menu_price").eq("active", true).order("name")
    .returns<Array<{ id: string; name: string; menu_price: number | string | null }>>();
  if (menuErr) throw new Error(`menu_items: ${menuErr.message}`);

  const recipes = await loadPortionedRecipes(sb);
  const balanceBefore = massBalanceIndex(graphBefore);

  // ── Plan ────────────────────────────────────────────────────────────────────
  for (const { item, trimClass } of PORTIONED_ITEMS) {
    const std = TRIM_STANDARDS[trimClass]!;
    const candidates = activeItemsByName.get(item) ?? [];
    if (candidates.length === 0) { refusals.push({ item, subject: "item", code: "NO_RECIPE", detail: "no ACTIVE item by that name" }); continue; }
    if (candidates.length > 1) {
      refusals.push({ item, subject: "item", code: "AMBIGUOUS_ITEM", detail: `${candidates.length} ACTIVE items share this name (${candidates.map((c) => c.id).join(", ")}) — refusing to pick one` });
      continue;
    }
    const target = candidates[0]!;

    const rec = recipes.find((r) => r.itemId === target.id);
    if (!rec) { refusals.push({ item, subject: "recipe", code: "NO_RECIPE", detail: `no active "${item} (portioned)" recipe produces it` }); continue; }

    const skuInputs = rec.inputs.filter((i) => i.skuId != null);
    if (rec.inputs.length !== 1 || skuInputs.length !== 1) {
      refusals.push({ item, subject: "input", code: "NOT_SINGLE_SKU_INPUT", detail: `${rec.inputs.length} input line(s), ${skuInputs.length} SKU-ref — the single-input shape this fix assumes is gone; re-derive by hand` });
      continue;
    }
    const line = skuInputs[0]!;
    const sku = skuById.get(line.skuId!);
    if (!sku) { refusals.push({ item, subject: "sku", code: "NOT_SINGLE_SKU_INPUT", detail: `pinned SKU ${line.skuId} not found` }); continue; }

    const declaredOz = num(target.oz_per_par_unit);
    if (declaredOz == null || declaredOz <= 0) {
      refusals.push({ item, subject: "oz_per_par_unit", code: "NO_DECLARED_PAR_WEIGHT", detail: "the item declares no finished par-unit weight, so there is nothing to solve the input against — fill items.oz_per_par_unit first" });
      continue;
    }
    const sliceOz = num(sku.avg_oz_per_each);
    if (sliceOz == null || sliceOz <= 0) {
      refusals.push({ item, subject: "avg_oz_per_each", code: "NO_SLICE_WEIGHT", detail: `SKU "${sku.name}" carries no avg_oz_per_each — a count-denominated input cannot be converted to ounces without it` });
      continue;
    }

    // The unit must be a COUNT unit for "quantity = slices" to mean anything. A
    // weight-denominated line would need the quantity expressed in ounces instead,
    // and silently reinterpreting one as the other is how this bug class starts.
    const measure = line.unit != null ? graphBefore.measures.get(line.unit) : undefined;
    if (!measure || measure.dimension !== "count") {
      refusals.push({ item, subject: "input unit", code: "NOT_A_COUNT_UNIT", detail: `input unit "${line.unit}" is ${measure ? measure.dimension : "unregistered"}, not count — this fix writes a COUNT of slices/units and will not reinterpret a weight line` });
      continue;
    }

    const trim = std.trim;
    const newQty = round(declaredOz / (1 - trim) / sliceOz);
    const newInputOz = newQty * sliceOz;
    const oldInputOz = line.quantity * sliceOz;
    const oldRatio = oldInputOz > 0 ? (declaredOz * rec.outYield) / oldInputOz : Infinity;

    if (Math.abs(newQty - line.quantity) < 1e-9) {
      refusals.push({ item, subject: "quantity", code: "ALREADY_BALANCED", detail: `already ${line.quantity} — nothing to write` });
      continue;
    }

    plans.push({
      item, itemId: target.id,
      recipeId: rec.recipeId, recipeName: rec.recipeName,
      recipeNotes: rec.notes, recipeDirections: rec.directions,
      inputId: line.id,
      skuId: sku.id, skuName: sku.name, vendorName: sku.vendor_id != null ? vendorById.get(sku.vendor_id) ?? "(unbound)" : "(unbound)",
      parUnitLabel: rec.outLabel ?? "par-unit",
      declaredOz, outYield: rec.outYield, sliceOz,
      trimClass, trim,
      oldQty: line.quantity, newQty, newInputOz, oldRatio,
      // Does the live costing graph actually route this item through THIS recipe?
      // buildRecipeGraph is first-wins per output and does NOT filter on active, so
      // the answer is not automatically yes — see §D.
      liveInGraph: graphBefore.byOutputItem.get(target.id)?.recipeId === rec.recipeId,
    });
  }

  // ── §2 plan: the build lines ────────────────────────────────────────────────
  const parUnitLines = await loadParUnitDenominatedLines(sb);
  const menuIdByName = new Map((menuRows ?? []).map((m) => [m.name, m.id]));
  const seenRules = new Set<string>();

  for (const line of parUnitLines) {
    const key = `${line.consumer} ${line.prep}`;
    const rule = BUILD_LINE_RULES.find((r) => r.consumer === line.consumer && r.prep === line.prep);
    if (!rule) {
      // A par-unit line nobody adjudicated. NOT silently skipped — an unreviewed
      // row of exactly this shape is what §2 exists to catch.
      refusals.push({ item: line.consumer, subject: `${line.prep} line`, code: "LINE_MOVED", detail: `${line.qty} ${line.unit ?? "(null)"} ${line.prep} resolves through par-units but is not in BUILD_LINE_RULES — the build data changed since this script was written; adjudicate it against the sheet before --execute` });
      continue;
    }
    seenRules.add(key);

    if (rule.verdict === "AS_IS") {
      asIsLines.push({ consumer: line.consumer, prep: line.prep, sheetQuote: rule.sheetQuote, reason: rule.asIsReason ?? "", qty: line.qty, unit: line.unit });
      continue;
    }
    if (rule.sheetCount != null && Math.abs(line.qty - rule.sheetCount) > 1e-9) {
      refusals.push({ item: line.consumer, subject: `${line.prep} line`, code: "LINE_MOVED", detail: `live quantity is ${line.qty}, the sheet and this rule say ${rule.sheetCount} — someone edited the build; re-adjudicate` });
      continue;
    }
    if (rule.verdict === "REFUSE") {
      refusals.push({ item: line.consumer, subject: `${line.prep} line`, code: rule.refuseCode ?? "UNIT_NOT_IN_OZ", detail: `${rule.question ?? ""} BEST READING: ${rule.bestReading ?? "—"}` });
      continue;
    }

    // CONVERT. The piece weight is read LIVE off the SKU the prep pins today —
    // never from this file — for the same reason §1 refuses to hardcode a slice oz.
    const pieceOz = resolvePieceOz(graphBefore, line.prepItemId);
    if (pieceOz == null) {
      refusals.push({ item: line.consumer, subject: `${line.prep} line`, code: "NO_PIECE_WEIGHT", detail: `${line.prep}'s producing recipe does not resolve to a single priced SKU with an avg_oz_per_each — cannot convert a count to ounces` });
      continue;
    }
    linePlans.push({
      inputId: line.inputId, consumer: line.consumer, prep: line.prep,
      prepItemId: line.prepItemId, menuItemId: line.menuItemId ?? menuIdByName.get(line.consumer) ?? null,
      sheetQuote: rule.sheetQuote,
      oldQty: line.qty, oldUnit: line.unit,
      newQty: round(rule.sheetCount! * pieceOz),
      pieceOz, pieceProvenance: rule.pieceProvenance ?? "",
    });
  }
  for (const r of BUILD_LINE_RULES) {
    if (r.verdict === "AS_IS") continue;
    if (!seenRules.has(`${r.consumer} ${r.prep}`)) {
      refusals.push({ item: r.consumer, subject: `${r.prep} line`, code: "LINE_MOVED", detail: "this rule matched no live par-unit line — the row was already fixed, removed, or renamed; drop the rule or re-adjudicate" });
    }
  }

  // ── §3 plan: Horsey Mayo, only if Juan has ruled ────────────────────────────
  horseyPlan = await planHorseyMayo(sb, activeItemsByName);

  // ── The AFTER graph ─────────────────────────────────────────────────────────
  // A SECOND, independently loaded graph, mutated before anything reads it. Two
  // separate graph objects matter: menu-costing-shared memoizes the mass-balance
  // index per graph object (WeakMap), so mutating the graph we already costed
  // BEFORE against would hand us a stale index and a flattering answer.
  const graphAfter = await loadRecipeGraph();
  applyPlansTo(graphAfter);
  const balanceAfter = massBalanceIndex(graphAfter);

  // ── Report ──────────────────────────────────────────────────────────────────
  if (MD) {
    p(`# Portioned-recipe mass fix — dry run (${new Date().toISOString().slice(0, 10)})`);
    p();
    p("Generated by `" + SCRIPT + "` in its default (dry-run) mode. The script writes only");
    p("under an explicit `--execute` flag, and that flag is not used until Juan has eyeballed");
    p("this output. Every SKU, slice weight and declared par weight below was read live.");
  }

  h(2, "The trim registry");
  p(MD
    ? "Standard trim per Juan's 2026-08-20 ruling. `PUBLISHED_YIELD_TABLE` can be looked up; `OPERATIONAL_ESTIMATE` is reasoned from a named physical loss and is first in line to be replaced by observed trim; `VENDOR_PREPPED_NONE`'s zero is a statement, not a gap."
    : "");
  table(
    ["class", "trim", "yield", "evidence", "rationale"],
    Object.entries(TRIM_STANDARDS).map(([k, v]) => [k, pctOf(v.trim), pctOf(1 - v.trim), v.evidence, v.rationale]),
    ["", "r", "r", "", ""],
  );

  h(2, `A. The ${plans.length} portioned recipes — old qty → new qty`);
  p(MD ? "`new qty = oz_per_par_unit ÷ (1 − trim) ÷ slice oz`. Quantities are the un-rounded quotient at 4 dp — not prettified to whole slices, per the garlic precedent (a derived number that reads oddly is still the derived number)." : "");
  table(
    ["item", "SKU (vendor)", "slice oz", "par-unit oz", "trim", "old qty", "new qty", "new input oz", "was", "live?"],
    plans.map((w) => [
      w.item,
      `${w.skuName} (${w.vendorName})`,
      String(w.sliceOz),
      `${w.declaredOz} / ${w.parUnitLabel}`,
      pctOf(w.trim),
      String(w.oldQty),
      `**${round(w.newQty)}**`,
      `${round(w.newInputOz, 2)} oz`,
      `${w.oldRatio.toFixed(1)}x over`,
      w.liveInGraph ? "yes" : "NO — see §D",
    ]),
    ["", "", "r", "r", "r", "r", "r", "r", "r", ""],
  );

  h(2, "B. Cost effect — the three single-meat subs");
  p(MD ? "Flatten cost = Σ(leaf oz × $/oz), which is the arithmetic regardless of what status the board decides to show. These three are a meat plus a roll and nothing else, so the delta is entirely this fix." : "");
  const headlineRows: string[][] = [];
  for (const name of HEADLINE_SUBS) {
    const m = (menuRows ?? []).find((x) => x.name === name);
    if (!m) continue;
    const before = flattenCost(graphBefore, m.id, costPerOz);
    const after = flattenCost(graphAfter, m.id, costPerOz);
    const price = num(m.menu_price);
    headlineRows.push([
      name,
      price != null ? money(price) : "—",
      before.unpriced === 0 ? money4(before.cost) : `${money4(before.cost)} (+${before.unpriced} unpriced)`,
      after.unpriced === 0 ? money4(after.cost) : `${money4(after.cost)} (+${after.unpriced} unpriced)`,
      `+${money4(after.cost - before.cost)}`,
      price != null && price > 0 && after.unpriced === 0 ? `${((after.cost / price) * 100).toFixed(1)}%` : "—",
    ]);
  }
  table(["menu item", "price", "flatten cost BEFORE", "flatten cost AFTER", "delta", "FC% after"], headlineRows, ["", "r", "r", "r", "r", "r"]);

  h(2, "C. Cost effect — one sample consuming menu item per fixed prep");
  p(MD ? "The sample is the alphabetically-first active menu item whose flatten reaches the prep. Columns isolate THAT prep's own leaf SKU, so a sub with five fixed preps on it still shows one line's worth of movement per row." : "");
  const sampleRows: string[][] = [];
  for (const w of plans) {
    const sample = (menuRows ?? []).find((m) => {
      const oz = perUnitSkuOzForMenuItemFromGraph(graphAfter, m.id).get(w.skuId);
      return oz != null && oz > 0;
    });
    if (!sample) { sampleRows.push([w.item, "(no active menu item reaches it)", "—", "—", "—"]); continue; }
    const ozBefore = perUnitSkuOzForMenuItemFromGraph(graphBefore, sample.id).get(w.skuId) ?? 0;
    const ozAfter = perUnitSkuOzForMenuItemFromGraph(graphAfter, sample.id).get(w.skuId) ?? 0;
    const cpo = costPerOz.get(w.skuId) ?? null;
    sampleRows.push([
      w.item,
      sample.name,
      `${round(ozBefore)} oz${cpo != null ? ` = ${money4(ozBefore * cpo)}` : ""}`,
      `${round(ozAfter)} oz${cpo != null ? ` = ${money4(ozAfter * cpo)}` : ""}`,
      cpo != null ? `+${money4((ozAfter - ozBefore) * cpo)}` : "(SKU unpriced)",
    ]);
  }
  table(["prep", "sample menu item", "its SKU BEFORE", "its SKU AFTER", "line delta"], sampleRows, ["", "", "r", "r", "r"]);

  h(2, "D. Mass balance — before and after, and what is left standing");
  table(
    ["item", "declared oz/batch", "input oz BEFORE", "ratio BEFORE", "input oz AFTER", "ratio AFTER", "verdict"],
    [...balanceBefore.keys()].sort((a, b) => (itemNameById.get(a) ?? a).localeCompare(itemNameById.get(b) ?? b)).map((id) => {
      const b = balanceBefore.get(id)!;
      const a = itemMassBalance(graphAfter, id);
      return [
        itemNameById.get(id) ?? id,
        `${round(b.declaredOz, 2)}`,
        `${round(b.inputOz, 3)}`,
        `${b.ratio.toFixed(2)}x`,
        a ? `${round(a.inputOz, 3)}` : "—",
        a ? `${a.ratio.toFixed(3)}x` : "—",
        balanceAfter.has(id) ? "STILL VIOLATING" : "resolved",
      ];
    }),
    ["", "r", "r", "r", "r", "r", ""],
  );
  p();
  p(MD ? `Tolerance is \`MASS_BALANCE_TOLERANCE\` = ${pctOf(MASS_BALANCE_TOLERANCE)}, one-sided: output below input is normal (cook-downs, trim), output above it is the violation.` : "");

  h(2, "D1. The dual-producer finding");
  p("**`Hot Peppers (portioned)` is fixed here but is not what the graph costs today.**");
  p("`loadRecipeGraph` does not filter on `recipes.active`, and `buildRecipeGraph` is");
  p("first-wins by (created_at, id). The retired 2026-07-01 Baldor recipe (512 oz in,");
  p("yield 10) is OLDER than the 2026-07-21 portioned one, so it wins the index and the");
  p("live cost of anything with hot peppers on it runs through an INACTIVE recipe pinning a");
  p("vendor we may not even buy from. That widens the multi-vendor audit's P5 dual-producer");
  p("caveat, which is written as if both competing producers were active. Fixing the");
  p("portioned row is still right — it is the row that becomes correct the moment the");
  p("active filter lands — but nobody should expect this fix to move a hot-peppers number.");
  p("Filed as a separate finding; NOT changed here, because adding an `active` filter to the");
  p("graph loader silently re-costs the whole board and deserves its own PR and smoke.");

  // ── §2 ──────────────────────────────────────────────────────────────────────
  h(2, `§2. Build lines that resolve through PAR-UNITS — ${parUnitLines.length} swept`);
  p("A build line referencing a PREP with a count unit — or with a unit that is not in");
  p("`measure_units` at all — is read as that many PAR-UNITS of the prep, while the same");
  p("unit on a SKU line resolves through avg_oz_per_each. That asymmetry is the trap, and");
  p("§1 springs it: while a pan of fresh mozzarella weighed 1 oz, \"3 each\" and \"3 slices\"");
  p("were numerically identical. Once the pan weighs 32 oz, the row means THREE QUARTS.");
  p("This is the Wave-1.5 unit class ('2 oz Marinara' read as 2 QUARTS), latent until now");
  p("BECAUSE the placeholder was hiding it — and the mass-balance guard will NOT catch it,");
  p("since the preps themselves balance. Ground truth: `docs/seed/source/sandwich-build-sheet.csv`.");
  p();
  p(`**${linePlans.length} CONVERT · ${asIsLines.length} already correct · ${parUnitLines.length - linePlans.length - asIsLines.length} refused.**`);
  p("The middle column is why this could not be a blanket \"convert every count line\":");
  p("a third of them are right, because those preps' par-unit genuinely IS one piece.");

  h(3, "§2a. CONVERT — sheet quote → old line → new line → cost effect");
  const convertRows: string[][] = [];
  for (const l of linePlans) {
    const w = plans.find((x) => x.itemId === l.prepItemId);
    const skuId = w?.skuId ?? null;
    const cpo = skuId != null ? costPerOz.get(skuId) ?? null : null;
    const ozB = skuId != null && l.menuItemId != null ? perUnitSkuOzForMenuItemFromGraph(graphBefore, l.menuItemId).get(skuId) ?? 0 : 0;
    const ozA = skuId != null && l.menuItemId != null ? perUnitSkuOzForMenuItemFromGraph(graphAfter, l.menuItemId).get(skuId) ?? 0 : 0;
    // What the line WOULD have cost after §1 if §2 had not corrected it.
    const unfixedOz = w != null ? l.oldQty * (w.declaredOz / (1 - w.trim)) : 0;
    convertRows.push([
      l.consumer, `\`${l.sheetQuote}\``,
      `${l.oldQty} ${l.oldUnit ?? "(null)"}`,
      `**${round(l.newQty)} oz**`,
      `${round(ozB, 3)} oz${cpo != null ? ` / ${money4(ozB * cpo)}` : ""}`,
      `${round(ozA, 3)} oz${cpo != null ? ` / ${money4(ozA * cpo)}` : ""}`,
      cpo != null ? `${round(unfixedOz, 1)} oz / ${money4(unfixedOz * cpo)}` : "—",
    ]);
  }
  table(["menu item", "sheet says", "old line", "new line", "SKU oz/$ BEFORE", "SKU oz/$ AFTER", "if §1 shipped WITHOUT §2"], convertRows, ["", "", "r", "r", "r", "r", "r"]);
  p();
  p("The last column is the point: §1 alone would have put 96 oz of fresh mozzarella on");
  p("two sandwiches. The piece weight used is read live off the SKU each prep pins today —");
  p("never hardcoded here — and for these rows it is vendor spec, not inference:");
  for (const l of linePlans) p(MD ? `- **${l.prep}** — ${l.pieceOz} oz: ${l.pieceProvenance}` : `  ${l.prep} — ${l.pieceOz} oz: ${l.pieceProvenance}`);

  h(3, `§2b. ALREADY CORRECT — ${asIsLines.length} lines left alone`);
  p(MD ? "Touching these would BREAK them: the prep's par-unit is one piece, so a count is the honest unit." : "");
  table(["menu item", "prep", "the line", "sheet says", "why it is already right"],
    asIsLines.map((a) => [a.consumer, a.prep, `${a.qty} ${a.unit ?? "(null)"}`, `\`${a.sheetQuote}\``, a.reason]));

  h(3, "§2c. REFUSED — the Juan-questions");
  p(MD ? "Each carries the reading we would take if forced. None of them is written." : "");
  table(["menu item", "prep", "code", "the question + best reading"],
    refusals.filter((r) => ["UNIT_NOT_IN_OZ", "PIECE_IS_NOT_THE_UNIT", "KNOWN_UNIT_CONFLICT"].includes(r.code))
      .map((r) => [r.item, r.subject.replace(" line", ""), r.code, r.detail]));
  p();
  p("Seed 10 — the seed that SET these weights — refused the same rows in the same words:");
  p("\"the Onion each/quart conflict, cans, Mixed Herbs, Shredded Mozz are DEFERRED to the");
  p("checklist (not guessed)\", with per-SKU notes reading \"unit = whole cucumber\", \"unit =");
  p("whole tomato\", \"unit = a portion — LOW confidence\", and on basil \"conflicting units");
  p("(leaf + unit) — recipe data bug; verify\". These refusals inherit that position rather");
  p("than inventing it. **Consequence if they stay unanswered:** Chicken parm and Vesuvio II");
  p("keep an overstated shredded-mozzarella line after `--execute` (6.65x and 13.3x), and the");
  p("cucumber/tomato/radish/basil/ladle rows keep the par-unit reading they have today.");

  // ── §3 ──────────────────────────────────────────────────────────────────────
  h(2, "§3. Horsey Mayo — the seam");
  if (horseyPlan == null) {
    p("**HELD AS REFUSED.** `HORSEY_MAYO_RULING` is `null`, so nothing about Horsey Mayo is");
    p("touched. Its recipe is 32 oz Duke's + 4 oz horseradish = **36 oz in**, against 4 outputs");
    p("declaring 16 oz each = **64 oz out** (1.78x, the illegal direction). It is NOT a §1");
    p("placeholder and NOT a trim question: exactly one of three numbers is wrong.");
    p();
    table(["if Juan says…", "fill", "implies", "resulting balance"], [
      ["\"the batch is bigger than that\"", "`{ kind: \"inputs_wrong\", batchInputOz: 64 }`", "the recipe really uses ~57 oz mayo + ~7 oz horseradish", "64 oz in vs 64 oz out = 1.00x"],
      ["\"it doesn't make 4\"", "`{ kind: \"yield_wrong\", outputYield: 2.25 }`", "36 oz fills 2.25 of those bottles", "36 oz in vs 36 oz out = 1.00x"],
      ["\"those bottles aren't 16 oz\"", "`{ kind: \"bottle_size_wrong\", ozPerParUnit: 9 }`", "4 bottles of 9 oz", "36 oz in vs 36 oz out = 1.00x"],
    ]);
    p();
    p("Fill the constant, re-run this dry run, and the write plans itself — each ruling");
    p("resolves to exactly one column. **CONSEQUENCE while unanswered:** `Our French Dip`");
    p("keeps reading `inconsistent` on the board after `--execute`, which is correct — it IS");
    p("built on a recipe whose weights do not add up.");
  } else {
    p(`**RULED: \`${horseyPlan.kind}\`.** ${horseyPlan.note}`);
    p();
    table(["before", "after"], [[horseyPlan.before, horseyPlan.after]]);
    if (horseyPlan.inputScale) {
      table(["input", "old qty", "new qty"], horseyPlan.inputScale.map((i) => [i.name, `${i.oldQty} ${i.unit ?? ""}`, `${i.newQty} ${i.unit ?? ""}`]), ["", "r", "r"]);
    }
  }

  h(2, "§4. Refusals (full ledger)");
  table(["item", "subject", "code", "why"], refusals.map((r) => [r.item, r.subject, r.code, r.detail]));

  h(2, "§5. What --execute would write");
  p(`§1: ${plans.length} \`recipe_inputs.quantity\` update(s) + ${plans.length} \`recipes\` notes/directions update(s).`);
  p(`§2: ${linePlans.length} \`recipe_inputs\` re-denomination(s) (quantity + unit -> oz).`);
  p(`§3: ${horseyPlan == null ? "nothing — held as refused." : "1 Horsey Mayo correction."}`);
  p("Every one re-reads its live row first and writes only the delta; a second run reports");
  p("\"already\" and writes nothing. All carry an audit row naming the arithmetic and the finding.");
  p();
  p("Sample notes stanza (Ham):");
  const hamPlan = plans.find((w) => w.item === "Ham");
  if (hamPlan) p(MD ? "```\n" + trimStanza(hamPlan) + "\n```" : `  ${trimStanza(hamPlan)}`);

  if (!EXECUTE) {
    p();
    p("---");
    p();
    p("**NOTHING WAS WRITTEN.** Re-run with `--execute` once Juan has signed off on the tables above.");
    p("Seed 22 done (dry run).");
    return;
  }

  await execute(sb);
}

// ── Loaders ───────────────────────────────────────────────────────────────────

async function loadPortionedRecipes(sb: ReturnType<typeof getServiceRoleClient>): Promise<LiveRecipe[]> {
  const { data: recRows, error: rErr } = await sb
    .from("recipes").select("id, name, active, notes, directions").eq("active", true).like("name", "%(portioned)%")
    .returns<Array<{ id: string; name: string; active: boolean; notes: string | null; directions: string | null }>>();
  if (rErr) throw new Error(`recipes: ${rErr.message}`);
  const ids = (recRows ?? []).map((r) => r.id);
  if (ids.length === 0) throw new Error("FATAL: no active '(portioned)' recipes found — the fix has nothing to act on, which is itself a finding.");

  const [{ data: outs, error: oErr }, { data: ins, error: iErr }] = await Promise.all([
    sb.from("recipe_outputs").select("recipe_id, output_item_id, output_menu_item_id, yield, output_container_label").in("recipe_id", ids)
      .returns<Array<{ recipe_id: string; output_item_id: string | null; output_menu_item_id: string | null; yield: number | string; output_container_label: string | null }>>(),
    sb.from("recipe_inputs").select("id, recipe_id, component_sku_id, component_item_id, quantity, unit").in("recipe_id", ids)
      .returns<Array<{ id: string; recipe_id: string; component_sku_id: string | null; component_item_id: string | null; quantity: number | string; unit: string | null }>>(),
  ]);
  if (oErr) throw new Error(`recipe_outputs: ${oErr.message}`);
  if (iErr) throw new Error(`recipe_inputs: ${iErr.message}`);

  const out: LiveRecipe[] = [];
  for (const r of recRows ?? []) {
    const myOuts = (outs ?? []).filter((o) => o.recipe_id === r.id && o.output_item_id != null);
    // Exactly one ITEM output is the portioned shape. Anything else is not this
    // script's business, and guessing which output the declared weight belongs to
    // is exactly the kind of inference that produced the defect.
    if (myOuts.length !== 1) continue;
    const o = myOuts[0]!;
    out.push({
      recipeId: r.id, recipeName: r.name, active: r.active, notes: r.notes, directions: r.directions,
      itemId: o.output_item_id!,
      outYield: num(o.yield) ?? 0, outLabel: o.output_container_label,
      inputs: (ins ?? []).filter((i) => i.recipe_id === r.id).map((i) => ({
        id: i.id, skuId: i.component_sku_id, itemId: i.component_item_id,
        quantity: num(i.quantity) ?? 0, unit: i.unit,
      })),
    });
  }
  return out;
}

interface ParUnitLine {
  inputId: string;
  prepItemId: string;
  prep: string;
  consumer: string;
  menuItemId: string | null;
  qty: number;
  unit: string | null;
  unitDimension: string;
}

/**
 * EVERY active build line whose unit resolves through an item PAR-UNIT rather than
 * ounces — the whole population §2 adjudicates, not just the ones §1 happens to
 * touch. Three shapes qualify, and the third is the quiet one:
 *   - unit is NULL (the seed's "quantity is par-units" convention),
 *   - unit is a COUNT-dimension measure (each / handful / leaf / …),
 *   - unit is not in `measure_units` AT ALL (`ladle`) — `itemRefParUnits` treats an
 *     unregistered label exactly like a count unit, with no error anywhere.
 * A WEIGHT unit is the only shape that is already honest, so it is the only one
 * filtered out.
 */
async function loadParUnitDenominatedLines(sb: ReturnType<typeof getServiceRoleClient>): Promise<ParUnitLine[]> {
  const { data: lines, error } = await sb
    .from("recipe_inputs").select("id, recipe_id, component_item_id, quantity, unit").not("component_item_id", "is", null)
    .returns<Array<{ id: string; recipe_id: string; component_item_id: string; quantity: number | string; unit: string | null }>>();
  if (error) throw new Error(`recipe_inputs (par-unit sweep): ${error.message}`);
  const recipeIds = [...new Set((lines ?? []).map((l) => l.recipe_id))];
  if (recipeIds.length === 0) return [];

  const [{ data: recs }, { data: outs }, { data: measures }, { data: items }, { data: menus }] = await Promise.all([
    sb.from("recipes").select("id, name, active").in("id", recipeIds).returns<Array<{ id: string; name: string; active: boolean }>>(),
    sb.from("recipe_outputs").select("recipe_id, output_item_id, output_menu_item_id").in("recipe_id", recipeIds)
      .returns<Array<{ recipe_id: string; output_item_id: string | null; output_menu_item_id: string | null }>>(),
    sb.from("measure_units").select("label, dimension").returns<Array<{ label: string; dimension: string }>>(),
    sb.from("items").select("id, name").returns<Array<{ id: string; name: string }>>(),
    sb.from("menu_items").select("id, name").returns<Array<{ id: string; name: string }>>(),
  ]);
  const dim = new Map((measures ?? []).map((m) => [m.label, m.dimension]));
  const recActive = new Map((recs ?? []).map((r) => [r.id, r.active]));
  const recName = new Map((recs ?? []).map((r) => [r.id, r.name]));
  const prepName = new Map((items ?? []).map((i) => [i.id, i.name]));
  const menuName = new Map((menus ?? []).map((m) => [m.id, m.name]));

  const out: ParUnitLine[] = [];
  for (const l of lines ?? []) {
    if (recActive.get(l.recipe_id) !== true) continue;
    const d = l.unit == null ? "(null unit)" : dim.get(l.unit) ?? "unregistered";
    if (d === "weight") continue;
    const o = (outs ?? []).find((x) => x.recipe_id === l.recipe_id);
    const menuItemId = o?.output_menu_item_id ?? null;
    out.push({
      inputId: l.id,
      prepItemId: l.component_item_id,
      prep: prepName.get(l.component_item_id) ?? l.component_item_id,
      consumer: (menuItemId != null ? menuName.get(menuItemId) : undefined) ?? recName.get(l.recipe_id) ?? l.recipe_id,
      menuItemId,
      qty: num(l.quantity) ?? 0,
      unit: l.unit,
      unitDimension: d,
    });
  }
  return out.sort((a, b) => a.consumer.localeCompare(b.consumer) || a.prep.localeCompare(b.prep));
}

/**
 * Ounces in ONE of a prep's own count units, read off the SKU its recipe pins today.
 * Null when the prep is not a single-SKU portioned recipe — in which case "3 each"
 * has no defensible ounce reading and §2 refuses rather than inventing one.
 */
function resolvePieceOz(graph: RecipeGraph, prepItemId: string): number | null {
  const node = graph.byOutputItem.get(prepItemId);
  if (!node) return null;
  const skuLines = node.inputs.filter((i) => i.componentSkuId != null);
  if (skuLines.length !== 1) return null;
  const pack = graph.skuPack.get(skuLines[0]!.componentSkuId!);
  const avg = pack?.avgOzPerEach ?? null;
  return avg != null && avg > 0 ? avg : null;
}

/**
 * §3. Plans nothing while HORSEY_MAYO_RULING is null — that is the refusal, and it
 * is the default. Each ruling kind resolves to exactly ONE column's worth of write,
 * which is why the seam is a single constant rather than a branch anyone has to wire.
 */
async function planHorseyMayo(
  sb: ReturnType<typeof getServiceRoleClient>,
  activeItemsByName: Map<string, Array<{ id: string; name: string; oz_per_par_unit: number | string | null }>>,
): Promise<HorseyPlan | null> {
  const ruling = HORSEY_MAYO_RULING;
  if (ruling == null) {
    refusals.push({
      item: "Horsey Mayo", subject: "mass balance", code: "AWAITING_JUAN",
      detail: "36 oz in (32 oz Duke's + 4 oz horseradish) vs 64 oz declared out (4 x 16 oz) = 1.78x. Which number is real: the inputs, the yield of 4, or the 16 oz bottle size? Fill HORSEY_MAYO_RULING and re-run.",
    });
    return null;
  }

  const candidates = activeItemsByName.get("Horsey Mayo") ?? [];
  if (candidates.length !== 1) {
    refusals.push({ item: "Horsey Mayo", subject: "item", code: "AMBIGUOUS_ITEM", detail: `${candidates.length} active items named Horsey Mayo — refusing` });
    return null;
  }
  const item = candidates[0]!;
  const { data: outs } = await sb.from("recipe_outputs").select("id, recipe_id, yield").eq("output_item_id", item.id)
    .returns<Array<{ id: string; recipe_id: string; yield: number | string }>>();
  const outRow = (outs ?? [])[0];
  if (!outRow) { refusals.push({ item: "Horsey Mayo", subject: "recipe", code: "NO_RECIPE", detail: "no producing recipe output row" }); return null; }
  const { data: ins } = await sb.from("recipe_inputs").select("id, component_sku_id, quantity, unit").eq("recipe_id", outRow.recipe_id)
    .returns<Array<{ id: string; component_sku_id: string | null; quantity: number | string; unit: string | null }>>();
  const { data: skus } = await sb.from("vendor_items").select("id, name")
    .in("id", (ins ?? []).map((i) => i.component_sku_id).filter((x): x is string => x != null))
    .returns<Array<{ id: string; name: string }>>();
  const skuName = new Map((skus ?? []).map((s) => [s.id, s.name]));
  const oldYield = num(outRow.yield) ?? 0;
  const oldOpp = num(item.oz_per_par_unit) ?? 0;

  if (ruling.kind === "inputs_wrong") {
    // ONE number from Juan (the real batch input mass) scales every input line by a
    // single factor, preserving the ratio the recipe already states. Scaling the
    // ratio would be a second, unasked-for decision.
    const currentOz = (ins ?? []).reduce((s, i) => s + (i.unit === "oz" ? num(i.quantity) ?? 0 : 0), 0);
    if (currentOz <= 0) { refusals.push({ item: "Horsey Mayo", subject: "inputs", code: "NOT_A_COUNT_UNIT", detail: "inputs are not all oz-denominated — scale by hand" }); return null; }
    const factor = ruling.batchInputOz / currentOz;
    return {
      kind: "inputs_wrong", itemId: item.id, recipeId: outRow.recipe_id, note: ruling.note,
      before: `${round(currentOz, 2)} oz in vs ${round(oldYield * oldOpp, 2)} oz declared`,
      after: `${round(ruling.batchInputOz, 2)} oz in vs ${round(oldYield * oldOpp, 2)} oz declared`,
      inputScale: (ins ?? []).filter((i) => i.unit === "oz").map((i) => ({
        id: i.id, name: i.component_sku_id != null ? skuName.get(i.component_sku_id) ?? "(sku)" : "(item)",
        oldQty: num(i.quantity) ?? 0, newQty: round((num(i.quantity) ?? 0) * factor), unit: i.unit,
      })),
    };
  }
  if (ruling.kind === "yield_wrong") {
    return {
      kind: "yield_wrong", itemId: item.id, recipeId: outRow.recipe_id, note: ruling.note,
      before: `yield ${oldYield} x ${oldOpp} oz = ${round(oldYield * oldOpp, 2)} oz declared`,
      after: `yield ${ruling.outputYield} x ${oldOpp} oz = ${round(ruling.outputYield * oldOpp, 2)} oz declared`,
      outputRow: { id: outRow.id, oldYield, newYield: ruling.outputYield },
    };
  }
  return {
    kind: "bottle_size_wrong", itemId: item.id, recipeId: outRow.recipe_id, note: ruling.note,
    before: `yield ${oldYield} x ${oldOpp} oz = ${round(oldYield * oldOpp, 2)} oz declared`,
    after: `yield ${oldYield} x ${ruling.ozPerParUnit} oz = ${round(oldYield * ruling.ozPerParUnit, 2)} oz declared`,
    newOzPerParUnit: { old: oldOpp, next: ruling.ozPerParUnit },
  };
}

// ── Pure helpers over the graph ───────────────────────────────────────────────

/**
 * Apply §1's and §2's planned quantities to a graph IN PLACE. Call before anything
 * reads it — the mass-balance index is memoized per graph object.
 *
 * §2 is applied too, deliberately: an "after" that showed §1's 32 oz mozzarella pan
 * without §2's corrected 3 oz line would report a $23 sandwich that this PR never
 * intends to ship, and the two halves are only honest read together.
 */
function applyPlansTo(graph: RecipeGraph): void {
  for (const w of plans) {
    const node = graph.byOutputItem.get(w.itemId);
    if (!node || node.recipeId !== w.recipeId) continue; // the dormant-producer case
    for (const c of node.inputs) {
      if (c.componentSkuId === w.skuId) c.quantity = w.newQty;
    }
  }
  for (const l of linePlans) {
    const node = l.menuItemId != null ? graph.byOutputMenuItem.get(l.menuItemId) : undefined;
    if (!node) continue;
    for (const c of node.inputs) {
      if (c.componentItemId === l.prepItemId && c.unit === l.oldUnit) {
        c.quantity = l.newQty;
        c.unit = "oz"; // re-denominated: the engine now converts oz -> par-units honestly
      }
    }
  }
}

/**
 * Σ(leaf oz × $/oz) for one menu item, with a count of the leaves that had no
 * price. Deliberately NOT the board's rollup: the board (correctly) refuses to
 * publish a number for an incomplete or inconsistent row, and this report's whole
 * job is to show what that suppressed number was and what it becomes.
 */
function flattenCost(graph: RecipeGraph, menuItemId: string, costPerOz: Map<string, number | null>): { cost: number; unpriced: number } {
  let cost = 0;
  let unpriced = 0;
  for (const [skuId, oz] of perUnitSkuOzForMenuItemFromGraph(graph, menuItemId)) {
    const c = costPerOz.get(skuId) ?? null;
    if (c == null) { unpriced += 1; continue; }
    cost += oz * c;
  }
  return { cost, unpriced };
}

// ── The write path ────────────────────────────────────────────────────────────

async function execute(sb: ReturnType<typeof getServiceRoleClient>): Promise<void> {
  p("\n── writing ──");

  for (const w of plans) {
    // 1) The quantity. Re-read and assert the row is still the one we planned
    //    against — same recipe, same SKU, same quantity we called "old".
    const { data: cur, error: cErr } = await sb
      .from("recipe_inputs").select("id, recipe_id, component_sku_id, quantity, unit").eq("id", w.inputId)
      .maybeSingle<{ id: string; recipe_id: string; component_sku_id: string | null; quantity: number | string; unit: string | null }>();
    if (cErr) throw new Error(`re-read ${w.item} input: ${cErr.message}`);
    if (!cur) throw new Error(`FATAL: ${w.item} input [${w.inputId}] disappeared between the dry run and the write`);
    if (cur.recipe_id !== w.recipeId) throw new Error(`FATAL: ${w.item} input now belongs to recipe ${cur.recipe_id}, planned against ${w.recipeId} — refusing`);
    if (cur.component_sku_id !== w.skuId) throw new Error(`FATAL: ${w.item} input now pins SKU ${cur.component_sku_id}, planned against "${w.skuName}" [${w.skuId}] — the pin moved, re-run the dry run`);

    const curQty = num(cur.quantity);
    if (curQty != null && Math.abs(curQty - w.newQty) < 1e-9) {
      p(`  = qty ${w.item}: already ${w.newQty} — skipping`);
    } else {
      if (curQty == null || Math.abs(curQty - w.oldQty) > 1e-9) {
        throw new Error(`FATAL: ${w.item} input quantity is now ${cur.quantity}, planned against ${w.oldQty} — someone edited it, re-run the dry run`);
      }
      const { error: uErr, count } = await sb
        .from("recipe_inputs").update({ quantity: w.newQty }, { count: "exact" })
        .eq("id", w.inputId).eq("component_sku_id", w.skuId);
      if (uErr) throw new Error(`qty ${w.item}: ${uErr.message}`);
      if (!count) throw new Error(`qty ${w.item}: UPDATE affected 0 rows (silent RLS denial, or the pin moved under us?)`);
      p(`  + qty ${w.item}: ${w.oldQty} -> ${w.newQty} ${cur.unit ?? ""} (${round(w.newInputOz, 2)} oz raw for ${w.declaredOz} oz out, ${pctOf(w.trim)} trim)`);

      void audit({
        actorId: null, actorRole: null,
        action: "recipe_input.update", resourceTable: "recipe_inputs", resourceId: w.inputId,
        metadata: {
          recipe_id: w.recipeId, recipe_name: w.recipeName, item: w.item,
          component_sku_id: w.skuId, sku_name: w.skuName, vendor: w.vendorName,
          quantity_before: w.oldQty, quantity_after: w.newQty, unit: cur.unit,
          trim_class: w.trimClass, trim_fraction: w.trim,
          trim_evidence: TRIM_STANDARDS[w.trimClass]!.evidence,
          trim_rationale: TRIM_STANDARDS[w.trimClass]!.rationale,
          slice_oz: w.sliceOz, declared_oz_per_par_unit: w.declaredOz, output_yield: w.outYield,
          input_oz_before: round(w.oldQty * w.sliceOz, 4), input_oz_after: round(w.newInputOz, 4),
          mass_ratio_before: round(w.oldRatio, 3),
          arithmetic: `${w.declaredOz} oz / (1 - ${w.trim}) / ${w.sliceOz} oz per unit = ${w.newQty}`,
          live_in_costing_graph: w.liveInGraph,
          phase: "portioned_mass_fix", reason: "portioned_placeholder_quantity_corrected",
          script: SCRIPT, source: SOURCE_KEY, source_note: SOURCE_FINDING,
        },
        ipAddress: null, userAgent: null,
      });
    }

    // 2) The notes stanza + the now-false directions tail. Trim must be readable
    //    on the recipe itself, not only in an audit row nobody opens.
    const { data: rec, error: rErr } = await sb
      .from("recipes").select("id, name, notes, directions").eq("id", w.recipeId)
      .maybeSingle<{ id: string; name: string; notes: string | null; directions: string | null }>();
    if (rErr) throw new Error(`re-read ${w.recipeName}: ${rErr.message}`);
    if (!rec) throw new Error(`FATAL: recipe ${w.recipeName} [${w.recipeId}] disappeared`);
    if (rec.name !== w.recipeName) throw new Error(`FATAL: recipe ${w.recipeId} is now named "${rec.name}" — refusing`);

    const stanza = trimStanza(w);
    // Strip any stanza THIS script wrote before (a re-run after a retune must
    // replace its own line, never stack a second one), keep everything else.
    const keptNotes = (rec.notes ?? "")
      .split("\n").filter((l) => !l.startsWith(`[standard-trim ${SOURCE_KEY}]`)).join("\n").trim();
    const nextNotes = keptNotes.length > 0 ? `${keptNotes}\n${stanza}` : stanza;
    const nextDirections = fixedDirections({ ...w, recipeDirections: rec.directions });

    if (rec.notes === nextNotes && rec.directions === nextDirections) {
      p(`  = notes ${w.item}: already current — skipping`);
      continue;
    }
    const { error: nErr, count: nCount } = await sb
      .from("recipes")
      .update({ notes: nextNotes, directions: nextDirections, updated_at: new Date().toISOString(), updated_by: null }, { count: "exact" })
      .eq("id", w.recipeId);
    if (nErr) throw new Error(`notes ${w.item}: ${nErr.message}`);
    if (!nCount) throw new Error(`notes ${w.item}: UPDATE affected 0 rows (silent RLS denial?)`);
    p(`  + notes ${w.item}: trim stanza recorded`);

    void audit({
      actorId: null, actorRole: null,
      action: "recipe.update", resourceTable: "recipes", resourceId: w.recipeId,
      metadata: {
        name: w.recipeName, item: w.item,
        patch: { notes: nextNotes, directions: nextDirections },
        trim_class: w.trimClass, trim_fraction: w.trim,
        phase: "portioned_mass_fix", reason: "standard_trim_recorded_on_recipe",
        script: SCRIPT, source: SOURCE_KEY, source_note: SOURCE_FINDING,
      },
      ipAddress: null, userAgent: null,
    });
  }

  // ── §2: re-denominate the adjudicated build lines ───────────────────────────
  for (const l of linePlans) {
    const { data: cur, error: cErr } = await sb
      .from("recipe_inputs").select("id, component_item_id, quantity, unit").eq("id", l.inputId)
      .maybeSingle<{ id: string; component_item_id: string | null; quantity: number | string; unit: string | null }>();
    if (cErr) throw new Error(`re-read ${l.consumer}/${l.prep} line: ${cErr.message}`);
    if (!cur) throw new Error(`FATAL: ${l.consumer}/${l.prep} line [${l.inputId}] disappeared between the dry run and the write`);
    if (cur.component_item_id !== l.prepItemId) throw new Error(`FATAL: ${l.consumer}/${l.prep} line now references item ${cur.component_item_id} — refusing`);

    const curQty = num(cur.quantity);
    if (cur.unit === "oz" && curQty != null && Math.abs(curQty - l.newQty) < 1e-9) {
      p(`  = line ${l.consumer}/${l.prep}: already ${l.newQty} oz — skipping`);
      continue;
    }
    // Guard BOTH columns: a row that already reads oz at a different quantity is not
    // the row this plan adjudicated, and re-denominating it again would compound.
    if (cur.unit !== l.oldUnit || curQty == null || Math.abs(curQty - l.oldQty) > 1e-9) {
      throw new Error(`FATAL: ${l.consumer}/${l.prep} line is now ${cur.quantity} ${cur.unit ?? "(null)"}, planned against ${l.oldQty} ${l.oldUnit ?? "(null)"} — someone edited the build, re-run the dry run`);
    }
    const { error: uErr, count } = await sb
      .from("recipe_inputs").update({ quantity: l.newQty, unit: "oz" }, { count: "exact" })
      .eq("id", l.inputId).eq("component_item_id", l.prepItemId);
    if (uErr) throw new Error(`line ${l.consumer}/${l.prep}: ${uErr.message}`);
    if (!count) throw new Error(`line ${l.consumer}/${l.prep}: UPDATE affected 0 rows (silent RLS denial?)`);
    p(`  + line ${l.consumer}/${l.prep}: ${l.oldQty} ${l.oldUnit ?? "(null)"} -> ${l.newQty} oz`);

    void audit({
      actorId: null, actorRole: null,
      action: "recipe_input.update", resourceTable: "recipe_inputs", resourceId: l.inputId,
      metadata: {
        consumer: l.consumer, prep: l.prep, component_item_id: l.prepItemId,
        quantity_before: l.oldQty, unit_before: l.oldUnit,
        quantity_after: l.newQty, unit_after: "oz",
        piece_oz: l.pieceOz, piece_provenance: l.pieceProvenance,
        sheet_quote: l.sheetQuote, sheet_source: SHEET_CSV,
        arithmetic: `${l.oldQty} x ${l.pieceOz} oz per each = ${l.newQty} oz`,
        phase: "portioned_mass_fix", reason: "build_line_redenominated_from_par_units_to_oz",
        script: SCRIPT, source: SOURCE_KEY, source_note: SOURCE_FINDING,
      },
      ipAddress: null, userAgent: null,
    });
  }

  // ── §3: Horsey Mayo, only when Juan has ruled ───────────────────────────────
  if (horseyPlan != null) await executeHorsey(sb, horseyPlan);

  p(`\nSeed 22 done (§1 ${plans.length} · §2 ${linePlans.length} · §3 ${horseyPlan == null ? 0 : 1}).`);
}

/** One column's worth of write, whichever of the three numbers Juan named. */
async function executeHorsey(sb: ReturnType<typeof getServiceRoleClient>, h: HorseyPlan): Promise<void> {
  if (h.inputScale) {
    for (const i of h.inputScale) {
      const { error, count } = await sb.from("recipe_inputs")
        .update({ quantity: i.newQty }, { count: "exact" }).eq("id", i.id);
      if (error) throw new Error(`horsey input ${i.name}: ${error.message}`);
      if (!count) throw new Error(`horsey input ${i.name}: UPDATE affected 0 rows`);
      p(`  + horsey ${i.name}: ${i.oldQty} -> ${i.newQty} ${i.unit ?? ""}`);
    }
  }
  if (h.outputRow) {
    const { error, count } = await sb.from("recipe_outputs")
      .update({ yield: h.outputRow.newYield }, { count: "exact" }).eq("id", h.outputRow.id);
    if (error) throw new Error(`horsey yield: ${error.message}`);
    if (!count) throw new Error("horsey yield: UPDATE affected 0 rows");
    p(`  + horsey yield: ${h.outputRow.oldYield} -> ${h.outputRow.newYield}`);
  }
  if (h.newOzPerParUnit) {
    const { error, count } = await sb.from("items")
      .update({ oz_per_par_unit: h.newOzPerParUnit.next, updated_at: new Date().toISOString(), updated_by: null }, { count: "exact" })
      .eq("id", h.itemId);
    if (error) throw new Error(`horsey oz_per_par_unit: ${error.message}`);
    if (!count) throw new Error("horsey oz_per_par_unit: UPDATE affected 0 rows");
    p(`  + horsey bottle size: ${h.newOzPerParUnit.old} -> ${h.newOzPerParUnit.next} oz`);
  }
  void audit({
    actorId: null, actorRole: null,
    action: "recipe.update", resourceTable: "recipes", resourceId: h.recipeId,
    metadata: {
      name: "Horsey Mayo (house — approximate)", ruling_kind: h.kind, ruling_note: h.note,
      before: h.before, after: h.after,
      phase: "portioned_mass_fix", reason: "horsey_mayo_mass_balance_ruling_applied",
      script: SCRIPT, source: SOURCE_KEY, source_note: SOURCE_FINDING,
    },
    ipAddress: null, userAgent: null,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) main().catch((e) => { console.error(e); process.exit(1); });
