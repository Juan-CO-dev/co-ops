/**
 * Angel WAVE 6 → vendor_price_history: the full price fill, PURE half.
 *
 * Zero I/O, like waves 1–4, which this module EXTENDS rather than replaces:
 * `computePackUnitPrice`, `exactQuotient`, `parseAngelCatalog`, `parseCsvLine` and
 * `rowKey` are imported from lib/angel-price-fill.ts and reused verbatim.
 * scripts/seed/34-wave6-price-fill.ts is the only I/O shell around it.
 *
 * ── THE ORDER, AND WHY THIS WAVE EXISTS ──────────────────────────────────────
 * Juan, 2026-08-29: *"why haven't we added the prices to the SKUs if we have all
 * the pricing already… pricing should update from what we are receiving. But we can
 * and should seed it since we have it basically on tap with angel spend."*
 *
 * Live state at authoring (lead-verified 2026-08-29, re-verified here 2026-08-30):
 * `vendor_price_history` holds 32 rows over 30 distinct SKUs, every one Angel-era.
 * **140 of 169 active SKUs have ZERO price rows.** Waves 1–4 priced the high-spend
 * core; this wave sweeps what is left.
 *
 * ── THE ONE IDEA IS UNCHANGED, AND IT IS STILL THE WHOLE JOB ─────────────────
 * `vendor_price_history.unit_price` is the price of ONE OF OUR PACKS — our ORDER
 * UNIT, the same quantity `contentOzForSku` resolves. Angel quotes the price of ONE
 * OF ITS CASES. Wave 1's header says it plainly and it has not stopped being true:
 * writing a case price straight through overstates Ham 13× and Butter 36×. Every
 * divisor below is transcribed after resolving our LIVE pack oz against Angel's
 * case oz row by row; this module never derives a divisor on its own.
 *
 * ── WHAT WAVE 6 ADDS: THE COUNT-SPACE RULE, MADE FIRST-CLASS ─────────────────
 * Wave 2 established count-space pricing for exactly one row (the Cardinal sub
 * roll) because Angel supplied no weight. Wave 6 needs it again for Cannoli Shell,
 * whose pack is `120 count` with NO per-shell weight on our side (seed 30 left that
 * open: *"the per-shell WEIGHT stays open until Juan weighs one"*). So `COUNT_AGREES`
 * is a named relation here rather than an improvised divisor. It is NOT a weaker
 * fill — when our pack IS Angel's pack, the price needs no denominator at all, and
 * introducing an invented weight would be the §C.3 PICKLES CHIPS failure.
 *
 * ── THE FINDING THAT GOVERNS THIS WAVE: THE 2024 SHEET IS NOT A SECOND SOURCE ─
 * The brief for this wave named `docs/seed/source/inventory-costing.csv` as a
 * co-equal price source alongside the Angel catalog. It is not one, and the repo
 * already says so in three independent places:
 *
 *   1. The reconciliation report's own source table rates it
 *      *"2024 manual costing ancestor — Historical, unversioned, internally
 *      inconsistent in places"*, against the catalog's "SOURCE WITH DOCUMENTED
 *      DEFECTS". §C.4 triangulates 25 comparable pairs: **9 agree, 16 conflict.**
 *   2. Wave 4 REFUSED it as a price of record when a fresher Angel row existed —
 *      *"two years old, and on a lane we migrated away from"* — and wave 4's
 *      Mortadella ruling went further: it bound the vendor and deliberately did NOT
 *      write the price, with the sheet's `$4.29 / 16 oz` sitting right there.
 *   3. **It cannot corroborate our pack shapes, because it IS our pack shapes.**
 *      `scripts/seed/02-skus.ts:137` (`loadInventoryPacks`) seeds
 *      `each_size` from column 4 of that very sheet — the column beside the price.
 *      So "the 2024 row matches our pack exactly" is a TAUTOLOGY for every SKU
 *      seeded that way, not an independent confirmation. Roughly twenty of the
 *      priceless SKUs show that exact-match signature, and reading it as
 *      agreement would be reading our own echo back as evidence.
 *
 * So this module writes from the Angel catalog ONLY. The 2024 sheet appears here in
 * exactly one role — as a printed CROSS-CHECK beside a fill, so a divisor that
 * disagrees with two-year-old reality is visible — and in a HELD tier the dry run
 * presents with the arithmetic finished, for Juan to ratify or reject. That is the
 * wave-3/4 pattern verbatim: refuse, present, let the human rule, fold in next wave.
 *
 * ── WHAT IT REFUSES, AND WHY EACH REFUSAL IS LOAD-BEARING ────────────────────
 * Wave 1's and wave 2's codes are reused unchanged where they still apply (a
 * refusal that has not changed must not be re-spelled — a second name for one
 * reason is drift). Three codes are NEW because wave 6 meets three shapes the
 * earlier waves did not have to name:
 *
 * PACK_CONFLICT      Both sides are in weight-space and both carry a real number,
 *                    but there is no whole relation between them: Panko is our 320
 *                    oz against Angel's 400 oz case, Dijon our 176 against Angel's
 *                    152. A ratio of 1.25 or 0.86 is not a divisor, and picking one
 *                    side silently re-denominates what `unit_price` MEANS. Per the
 *                    harvest's §5 rule the disagreement is the SIGNAL — neither side
 *                    wins automatically — so the row is presented, never guessed.
 * NO_OZ_BASIS        Angel's row is a COUNT or VOLUME parse with no weight at all
 *                    (`6/#10 CN`, `1/12 CT`, `4/6 CT`) while our pack is denominated
 *                    in ounces. There is no bridge without inventing a per-can or
 *                    per-head weight, which is precisely the invented denominator
 *                    report §C.3 is a cautionary tale about. Distinct from
 *                    PACK_CONFLICT on purpose: there the two numbers disagree, here
 *                    the second number does not exist, and the errands differ (a
 *                    reconciliation versus a weigh).
 * PACK_SHAPE_OPEN    OUR OWN pack shape is a flagged-open question, so no price can
 *                    be honest against it yet. Seed 30 A-FLAGGED Chicken Breast in
 *                    writing (*"if CO actually orders the 4-bag case, units_per_pack
 *                    becomes 4"*) and live now reads as the case — the flag is
 *                    unresolved, not answered. Wave 3 refused the oregano/onion-powder
 *                    jugs on exactly this ground until the scale spoke; pricing
 *                    against an open pack is how a 4× error ships quietly.
 *
 * Every refusal below carries FINISHED arithmetic. A refusal in this series is a
 * question posed precisely enough to be answered in one line, not a silence.
 */

import {
  computePackUnitPrice,
  exactQuotient,
  rowKey,
  DIVISION_RULES,
  type AngelCatalogRow,
} from "@/lib/angel-price-fill";

// ── Fill rules ─────────────────────────────────────────────────────────────────

/**
 * PACK_AGREES  — our pack IS one whole Angel case (divisor 1, price as-is).
 * CASE_MULTIPLE— our pack is one unit inside Angel's case (divide).
 * COUNT_AGREES — the relation is established in COUNT space and there is no weight
 *                on either side; divisor 1, and deliberately NOT expressed in oz.
 */
export type Wave6Relation = "PACK_AGREES" | "CASE_MULTIPLE" | "COUNT_AGREES";

export interface Wave6FillRule {
  /** Our `vendor_items.name`. Resolved to an id LIVE — never hardcoded. */
  skuName: string;
  /** The Angel catalog row's identity (product+brand+vendor+pack is the key). */
  product: string;
  brand: string;
  vendor: string;
  packSizeRaw: string;
  relation: Wave6Relation;
  /** Angel case ÷ our pack. Always 1 for PACK_AGREES and COUNT_AGREES. */
  divisor: number;
  /** Our pack in oz. NULL only for COUNT_AGREES, where oz plays no part. */
  ourPackOz: number | null;
  angelCaseOz: number | null;
  /** Populated only for COUNT_AGREES. */
  ourPackCount: number | null;
  angelCaseCount: number | null;
  /** How the denominator was established, in one line. Printed in the dry run so
   *  Juan checks the MATCH, not only the arithmetic (the wave-2 matchNote law). */
  evidence: string;
  /** The 2024 sheet's figure for the same SKU, as a printed CROSS-CHECK only —
   *  never an input to the price. NULL where the sheet has no comparable row. */
  crossCheck2024: string | null;
}

/**
 * The COMPLETE wave-6 fill set: 11 rules, each re-verified against live
 * `vendor_items` on 2026-08-30 (chain-aware `contentOzForSku`, the same derivation
 * the cost board rides — never the raw flat columns).
 *
 * Absence from this table means NOT FILLABLE, never "fill it some other way".
 */
export const WAVE6_FILL_RULES: readonly Wave6FillRule[] = [
  // ── CASE-MULTIPLE (3) — our pack is one unit inside Angel's case ─────────────
  {
    skuName: "Duke's Mayo", product: "MAYO HD", brand: "DUKES", vendor: "PFG", packSizeRaw: "4/1 GA",
    relation: "CASE_MULTIPLE", divisor: 4, ourPackOz: 128, angelCaseOz: 512, ourPackCount: null, angelCaseCount: null,
    evidence: "Angel's case is 4 × 1 gallon = 512 fl oz; our pack chain resolves to one gallon (128 oz). Highest-spend PFG row still unpriced ($5,771/yr).",
    crossCheck2024: "Duke's Mayo, US food, $18.50 / 128 oz — agrees to the CENT with $73.99 ÷ 4 = $18.50.",
  },
  {
    skuName: "Olive Oil", product: "OIL OLIVE 100% EXTRA VIRGIN", brand: "ASSOLUTI", vendor: "PFG", packSizeRaw: "3/3 LT",
    relation: "CASE_MULTIPLE", divisor: 3, ourPackOz: 101.43, angelCaseOz: 304.33, ourPackCount: null, angelCaseCount: null,
    evidence: "Angel's case is 3 × 3 LT; one 3-LT bottle is 101.44 fl oz against our recorded 101.43 — a 0.01% artifact of the litre constant, not a disagreement.",
    crossCheck2024: "Olive Oil, US food, $30.86 / 101.43 oz — 1.2% under $31.24.",
  },
  {
    skuName: "Balsamic Vin", product: "VINEGAR BALSAMIC", brand: "PIANCONE", vendor: "PFG", packSizeRaw: "2/5 LT",
    relation: "CASE_MULTIPLE", divisor: 2, ourPackOz: 169.07, angelCaseOz: 338.14, ourPackCount: null, angelCaseCount: null,
    evidence: "Angel's case is 2 × 5 LT; our pack chain resolves to one 5-LT bottle (169.07 oz). $34.51 ÷ 2 lands exactly on a half-cent — the tie rule is live here, not hypothetical.",
    crossCheck2024: "Balsamic Vin, b, $15.65 / 169.07 oz — 10% under $17.26 across two years.",
  },

  // ── PACK-AGREES (7) — our pack IS one whole Angel case, divisor 1 ────────────
  {
    skuName: "Canola Oil", product: "OIL CANOLA CLR FRY", brand: "PACKER", vendor: "PFG", packSizeRaw: "1/35 LB",
    relation: "PACK_AGREES", divisor: 1, ourPackOz: 560, angelCaseOz: 560, ourPackCount: null, angelCaseCount: null,
    evidence: "35 lb = 560 oz, exactly our pack. Seed 30 DERIVED this SKU's pack from this same catalog row, so pack and price are same-row consistent by construction.",
    crossCheck2024: null,
  },
  {
    skuName: "Arugula", product: "ARUGULA BABY", brand: "PACKER", vendor: "PFG", packSizeRaw: "2/2 LB",
    relation: "PACK_AGREES", divisor: 1, ourPackOz: 64, angelCaseOz: 64, ourPackCount: null, angelCaseCount: null,
    evidence: "Angel's case is 2 × 2 lb = 64 oz; our chain's root container resolves to 64 oz. The US Foods twin ($19.69) drops out under the historical-lane rule before clustering.",
    crossCheck2024: "Arugula, baldor, $17.91 / 48 oz — a DIFFERENT (48 oz) pack on a lane we left; $0.373/oz vs Angel's $0.323/oz.",
  },
  {
    skuName: "Parmesan (Grated)", product: "CHEESE PARMESAN GRATED TUB", brand: "ROMA", vendor: "PFG", packSizeRaw: "4/5 LB",
    relation: "PACK_AGREES", divisor: 1, ourPackOz: 320, angelCaseOz: 320, ourPackCount: null, angelCaseCount: null,
    evidence: "Angel's case is 4 × 5 lb = 320 oz, exactly our 4 × 80 oz. Seed 30 DERIVED this pack from this same row — same-row consistent.",
    crossCheck2024: "No parmesan row; the sheet's nearest is Pecorino (grated) $21.40 / 80 oz, a different cheese — deliberately NOT conflated.",
  },
  {
    skuName: "Watermelon Radish", product: "RADISH WATERMELON", brand: "PACKER", vendor: "PFG", packSizeRaw: "1/10 LB",
    relation: "PACK_AGREES", divisor: 1, ourPackOz: 160, angelCaseOz: 160, ourPackCount: null, angelCaseCount: null,
    evidence: "10 lb = 160 oz, exactly our bag. Seed 30 DERIVED this pack from this same row. The US Foods `Radish, Fresh Ref` 14/1 LB row is a different radish AND a historical lane.",
    crossCheck2024: "Radish, US food, $0.70 / 6 oz — a per-bunch line, not a comparable pack.",
  },
  {
    skuName: "Black peppercorn", product: "PEPPER BLK WHL", brand: "ROMA", vendor: "PFG", packSizeRaw: "1/5.75LB",
    relation: "PACK_AGREES", divisor: 1, ourPackOz: 92, angelCaseOz: 92, ourPackCount: null, angelCaseCount: null,
    evidence: "5.75 lb = 92 oz, exactly our chained pack. Identity is clean on both sides: our SKU says peppercorn, Angel's says WHL (whole) — not the ground product.",
    crossCheck2024: "Black Pepper, b, $20.65 and $18.29, both / 16 oz — the sheet carries the SKU twice at $1.29 and $1.14/oz against Angel's $0.56/oz. Those are 16-oz retail tubs against a 5.75-lb bulk case; bulk being ~2× cheaper per oz is expected, and the sheet disagreeing with ITSELF is the documented 'internally inconsistent' character.",
  },
  {
    skuName: "Saratoga", product: "WATER SPRKLNG SPRING GLASS", brand: "SARATOGA", vendor: "PFG", packSizeRaw: "24/12 OZ",
    relation: "PACK_AGREES", divisor: 1, ourPackOz: 288, angelCaseOz: 288, ourPackCount: null, angelCaseCount: null,
    evidence: "24 × 12 fl oz = 288, exactly the pack JUAN LABELLED on 2026-08-28 (seed 30). Angel's count and Juan's count agree independently. US Foods twin ($35.85) excluded as historical.",
    crossCheck2024: null,
  },
  {
    skuName: "Natalie's Lemonade", product: "JUICE LEMONADE NAT", brand: "NATALIES", vendor: "PFG", packSizeRaw: "6/12 OZ",
    relation: "PACK_AGREES", divisor: 1, ourPackOz: 72, angelCaseOz: 72, ourPackCount: null, angelCaseCount: null,
    evidence: "6 × 12 fl oz = 72, matching Juan's 2026-08-28 label (seed 30 repaired the malformed shape to exactly this). US Foods twin ($13.41) excluded as historical.",
    crossCheck2024: "Natalie's Lemonade, baldor, $11.05 / 6 ea — 4% over $10.63, on the old lane.",
  },

  // ── COUNT-AGREES (1) — the relation is count-space; no weight on either side ──
  {
    skuName: "Cannoli Shell", product: "SHELL CANNOLI SM", brand: "ROMA", vendor: "PFG", packSizeRaw: "1/120 CT",
    relation: "COUNT_AGREES", divisor: 1, ourPackOz: null, angelCaseOz: null, ourPackCount: 120, angelCaseCount: 120,
    evidence: "Angel's `1/120 CT` case is our 120-count pack — seed 30 derived our pack from this same row. Our per-shell WEIGHT is still open (Juan has not weighed one), and it is not needed: when our pack IS Angel's pack the price needs no denominator. Introducing an oz basis here would invent the very number seed 30 left honestly open.",
    crossCheck2024: "Cannoli Shell 3\", b, $57.70 / 200 ea = $0.289/shell against Angel's $0.356 — a DIFFERENT 200-count pack, so the per-shell gap is not a like-for-like price move.",
  },
];

// ── Refusals ───────────────────────────────────────────────────────────────────

export type Wave6RefusalCode =
  // Reused verbatim from waves 1–2 — an unchanged reason keeps its name.
  | "DELMAR_NO_PACK_SIZE"
  | "US_FOODS_HISTORICAL"
  | "DUPLICATE_CLUSTER"
  | "AMBIGUOUS_PRODUCT_IDENTITY"
  | "HIGH_PPL_REVIEW"
  | "OUR_PACK_UNRESOLVABLE"
  // New to wave 6.
  | "PACK_CONFLICT"
  | "NO_OZ_BASIS"
  | "PACK_SHAPE_OPEN"
  | "COSTING_SHEET_ONLY_2024";

export const WAVE6_REASONS: Record<Wave6RefusalCode, string> = {
  DELMAR_NO_PACK_SIZE:
    "Delmar row: a case price with NO pack denominator (NO_PACK_SIZE|BROKER_DIRECT). Report §C.3 is the cautionary tale — Angel's own UI turned a $35.95 CASE price into '$35.95/lb' by assuming a ~1 lb pack. Blocked until Juan confirms the case count (J3).",
  US_FOODS_HISTORICAL:
    "US Foods row: a historical order guide for a lane already migrated to PFG. Cross-check only, never the price of record (report R6).",
  DUPLICATE_CLUSTER:
    "Two or more surviving rows quote this one SKU at different prices; there is no defensible automatic winner, and taking the first would make the cost depend on CSV row order. Juan picks the row of record (report J8).",
  AMBIGUOUS_PRODUCT_IDENTITY:
    "Product identity unresolved — the candidate may be a different product rather than another quote for this SKU. Pricing one SKU from another's row is a silent mis-cost.",
  HIGH_PPL_REVIEW:
    "The exporter itself flagged the derived $/lb implausible. Arithmetically fine, operationally misleading — never propagate as a commodity price (report R2).",
  OUR_PACK_UNRESOLVABLE:
    "Our own SKU cannot say what one pack is: no pack chain and no usable flat pack fields. A price cannot be denominated against a pack we cannot measure.",
  PACK_CONFLICT:
    "Our pack oz and Angel's case oz are both real numbers with no whole relation between them. The ratio is not a divisor, and choosing a side silently re-denominates what unit_price MEANS. Per the harvest's §5 rule the disagreement is the SIGNAL — neither side wins automatically.",
  NO_OZ_BASIS:
    "Angel's row is a COUNT or VOLUME parse carrying no weight, while our pack is denominated in ounces. Bridging them requires inventing a per-can/per-head weight — the invented denominator report §C.3 warns about.",
  PACK_SHAPE_OPEN:
    "OUR OWN pack shape is a flagged-open question, so no price can be honest against it yet. Wave 3 refused the oregano/onion-powder jugs on exactly this ground until the scale spoke.",
  COSTING_SHEET_ONLY_2024:
    "The ONLY candidate is the 2024 manual costing sheet — rated 'historical, unversioned, internally inconsistent' by the reconciliation report, conflicting with Angel on 16 of 25 comparable pairs, and (critically) the same file our pack shapes were seeded from, so its apparent pack agreement is our own echo rather than corroboration. Wave 4 set the precedent by binding Mortadella's vendor and deliberately NOT writing the sheet's price. Presented with finished arithmetic for Juan to ratify.",
};

export interface Wave6Refusal {
  skuName: string;
  code: Wave6RefusalCode;
  /** The candidate row(s) considered, quoted verbatim from the source. */
  candidates: readonly string[];
  /** The arithmetic, FINISHED — so the question can be answered in one line. */
  presented: string | null;
  /** What specifically is unresolved, and what would resolve it. */
  note: string;
}

/**
 * Every priceless SKU where a candidate EXISTED and was adjudicated to a refusal.
 * A SKU absent from both this table and WAVE6_FILL_RULES had no candidate at all —
 * the script reports those separately as NO SOURCE rather than folding the two
 * together, because "we looked and said no" and "there was nothing to look at" are
 * different findings with different errands.
 */
export const WAVE6_REFUSALS: readonly Wave6Refusal[] = [
  // ── Pack conflicts: both sides real, no whole relation ──────────────────────
  {
    skuName: "Panko (Japanese)", code: "PACK_CONFLICT",
    candidates: ["BREAD CRUMBS TOASTED PANKO [KIKKOMAN] (PFG) 1/25 LB $27.14"],
    presented: "Angel case 25 lb = 400 oz; our pack 320 oz. Ratio 1.25 — not a divisor. If our 320 oz is right the pack price is $21.71; if Angel's 400 oz is right our pack shape is wrong.",
    note: "One of the two pack numbers is stale. Resolving it is a label read, not a price decision.",
  },
  {
    skuName: "Mustard (Dijon)", code: "PACK_CONFLICT",
    candidates: ["MUSTARD DIJON [ESPRTDPR] (PFG) 1/9.5 LB $19.59"],
    presented: "Angel case 9.5 lb = 152 oz; our pack 176 oz. Ratio 0.86. At Angel's $/oz our 176-oz pack is $22.68; at our pack the case price is $19.59.",
    note: "A 24-oz gap on a jug is a label read. NOTE the 2024 sheet says $30.10 / 176 oz — 54% over Angel, the kind of gap that makes the sheet unusable as a price of record.",
  },
  {
    skuName: "Onion (red)", code: "PACK_CONFLICT",
    candidates: ["ONION RED JUMBO [PEAK FRS] (PFG) 1/25 LB $27.78"],
    presented: "Angel case 25 lb = 400 oz; our pack 160 oz. Ratio 2.5 — not a whole divisor. At Angel's $0.0695/oz our 160-oz pack is $11.11.",
    note: "The $/oz agrees with the 2024 sheet to within 1% ($0.0691), so the PRICE is probably right and the PACK is the open question: do we buy the 25-lb sack or a 10-lb bag?",
  },

  // ── No oz basis: Angel's row is a count/volume parse ────────────────────────
  {
    skuName: "Celery", code: "NO_OZ_BASIS",
    candidates: ["CELERY SPLIT [PEAK FRS] (PFG) 1/6 CT $25.64"],
    presented: "$25.64 per 6-count case = $4.27/stalk. Our pack is 96 oz, so the bridge needs oz-per-stalk (~16 oz would make the pack one case).",
    note: "One stalk weighed closes this.",
  },
  {
    skuName: "Cucumber", code: "NO_OZ_BASIS",
    candidates: ["CUCUMBER EURO SDLS [PACKER] (PFG) 1/12 CT $18.11"],
    presented: "$18.11 per 12-count = $1.51/cucumber. Our pack is 158 oz; 158/12 = 13.2 oz each, but our own avg_oz_per_each says 8.",
    note: "Our SKU's two weight opinions disagree before Angel is even consulted. One cucumber weighed closes both.",
  },
  {
    skuName: "Roasted Red Peppers", code: "NO_OZ_BASIS",
    candidates: ["PEPPERS RED FIRE RSTD [ASSOLUTI] (PFG) 6/#10 CN $49.81"],
    presented: "$49.81 per 6 × #10 cans = $8.30/can. Our pack is 612 oz; at 102 oz drained per #10 can the case is 612 oz and the price would be $49.81.",
    note: "A #10 can's net oz is a label read. The 612 figure already implies ~102 oz/can, so this is close to self-consistent — but implying is not reading.",
  },
  {
    skuName: "Tomatoes Crushed (10#)", code: "NO_OZ_BASIS",
    candidates: ["TOMATO CRUSHED EXTRA HVY PUREE [SAPORITO] (PFG) 6/#10 CN $36.48"],
    presented: "$36.48 per 6 × #10 cans = $6.08/can. Our pack claims 1626 oz.",
    note: "Report §D flags this SKU's own pack as self-contradictory: each_size 1626 oz with units_per_pack 1 AND avg_oz_per_each 109 cannot both be right (1626/109 = 15 cans, but the chain says the case IS one 1626-oz level). Angel cannot resolve it. Juan: how many #10 cans, and what does one weigh?",
  },
  {
    skuName: "Iceberg", code: "NO_OZ_BASIS",
    candidates: [
      "LETTUCE ICEBERG LINER [PEAK FRS] (PFG) 24/1 CT $31.58",
      "LETTUCE ICEBERG C&T [PACKER] (PFG) 4/6 CT $46.87",
      "LETTUCE CELLO ICEBERG CA [PACKER] (PFG) 1/24 CT $34.02",
    ],
    presented: "Three live PFG rows at $31.58 / $46.87 / $34.02, all count parses. Our pack is 640 oz.",
    note: "Compounded: no weight on Angel's side AND three competing rows, so even a weight would leave a DUPLICATE_CLUSTER. Wave 4 §3 already recorded that Angel's lettuce lane does not line up with our registry.",
  },
  {
    skuName: "Eggs (cooked)", code: "NO_OZ_BASIS",
    candidates: ["EGG HRD CKD PLD DRY PACK [NTRSBST] (PFG) 12/12 CT $33.85"],
    presented: "$33.85 per 144 eggs = $0.235/egg. Our pack is 180 OZ, not a count.",
    note: "Count on one side, weight on the other. Peeled-egg oz is a weigh, and it is already on Juan's §A list.",
  },

  // ── Our own pack shape is open ─────────────────────────────────────────────
  {
    skuName: "Chicken Breast", code: "PACK_SHAPE_OPEN",
    candidates: ["CHICKEN BRST RAND B/F B/S HALA [MNTAIRE] (PFG) 4/10 LB $63.58"],
    presented: "If our order unit is the 4-bag CASE (live shape, 640 oz): $63.58. If it is the single 10-lb BAG (what seed 30 proposed): $15.90.",
    note: "Seed 30 A-FLAGGED this in writing — 'if CO actually orders the 4-bag case, units_per_pack becomes 4' — and live now reads as the case, which is the OPPOSITE of what seed 30 proposed to write. The flag is unresolved, not answered, and the two answers are 4× apart. One sentence from Juan closes it.",
  },

  // ── Identity / cluster ─────────────────────────────────────────────────────
  {
    skuName: "Eggs", code: "AMBIGUOUS_PRODUCT_IDENTITY",
    candidates: [
      "EGG WHI LG AA LOOSE [NTRSBST] (PFG) 1/30 DZ $51.93",
      "EGG WHI MED AA LOOSE [NTRSBST] (PFG) 1/15 DZ $12.09",
    ],
    presented: "Large: $51.93 / 360 eggs = $0.144/egg — and 30 DZ = 360 is EXACTLY our units_per_pack. Medium: $12.09 / 180 = $0.067/egg.",
    note: "The count match to the large row is exact and tempting, but our SKU is just 'Eggs' and does not say a grade. The two Angel rows sit 2.1× apart per egg, which is far too wide for a genuine medium/large spread and means one of them is anomalous. Naming the grade resolves it; guessing it prices every egg dish wrong.",
  },
  {
    skuName: "Onion (White)", code: "DUPLICATE_CLUSTER",
    candidates: [
      "ONION YLW COLOSSAL BAG [PEAK] (PFG) 1/50 LB $34.35",
      "ONION YLW JUMBO [PEAK FRS] (PFG) 1/50 LB $31.28",
    ],
    presented: "Both are 1/50 LB = 800 oz, exactly our pack, so the divisor is settled at 1. The prices are $34.35 and $31.28 — a 10% spread with no tiebreak.",
    note: "Doubly blocked: our SKU says WHITE onion and both Angel rows say YELLOW, so identity is open alongside the cluster. If those are the same buy, Juan picks the row; if not, the white onion has no Angel row at all.",
  },
  {
    skuName: "Tomatoes", code: "DUPLICATE_CLUSTER",
    candidates: [
      "TOMATO 5X6 [PEAK FRS] (PFG) 1/25 LB $33.14",
      "TOMATO 6X6 [PEAK FRS] (PFG) 1/25 LB $34.82",
    ],
    presented: "Two live PFG rows, both 25 lb = 400 oz against our 160-oz pack — so this is a DUPLICATE_CLUSTER and a PACK_CONFLICT at once.",
    note: "5x6 and 6x6 are size grades, plausibly both bought. Neither the row nor the pack is settled.",
  },
  {
    skuName: "Lemon Juice", code: "DUPLICATE_CLUSTER",
    candidates: [
      "JUICE LEMON ALL NAT [NATALIES] (PFG) 6/32 OZ $32.70",
      "JUICE LEMON FZ [NATALIES] (PFG) 12/1 LT $62.66",
    ],
    presented: "Case oz 192 and 405.8 against our 202.86-oz pack — 202.86 oz is exactly 6 LT, i.e. HALF the frozen case, which would give $31.33.",
    note: "Refrigerated vs FROZEN is a real product difference, not two quotes for one thing, and 'half a case' is a relation nobody has confirmed. Juan names which one we buy.",
  },
  {
    skuName: "Heavy Cream", code: "DUPLICATE_CLUSTER",
    candidates: [
      "CREAM HVY WHIPPING 40% TFF [NTRSBST] (PFG) 12/32 OZ $46.32",
      "CREAM HVY 36% TFF [NTRSBST] (PFG) 12/32 OZ $44.63",
    ],
    presented: "Both are 12 × 32 oz = 384 oz, exactly our pack — divisor 1 either way. $46.32 (40% fat) vs $44.63 (36% fat).",
    note: "UNCHANGED from wave 1, which refused this same pair, and re-stated here only because the SKU is still priceless. One NEW piece of evidence: the 2024 sheet's $44.46 sits 0.4% from the 36% row and 4% from the 40% row — weak, but it points. Juan names the butterfat.",
  },
  {
    skuName: "Cheddar", code: "DUPLICATE_CLUSTER",
    candidates: [
      "CHEESE CHED SHARP WHI BLOCK TF [LOL] (PFG) 1/10 LB $35.46 (÷10 = $3.55)",
      "CHEESE CHED WHI MED LOAF [TILLAMK] (PFG) 2/5 LB $51.73 (÷10 = $5.17)",
    ],
    presented: "Both divide to our 16-oz pack; $3.55 vs $5.17 is a 46% spread.",
    note: "UNCHANGED from wave 1. Sharp block and medium loaf are plausibly both real buys for different uses — which would mean two SKUs, not one contested price.",
  },
  {
    skuName: "Chives", code: "HIGH_PPL_REVIEW",
    candidates: ["CHIVES FRSH [PEAK FRS] (PFG) 1/8 OZ $17.88 [HIGH_PPL_REVIEW]"],
    presented: "$17.88 for 8 oz ÷ 2 = $8.94 for our 4-oz pack ($35.76/lb).",
    note: "UNCHANGED — wave 1 refused it on the exporter's own flag and wave 4 refused it again, because fresh chives break the herb policy's hidden premise that one of our packs is one Angel unit. Two waves have declined this row; wave 6 does not re-litigate it.",
  },

  // ── Lanes we do not price from ─────────────────────────────────────────────
  {
    skuName: "Cholula", code: "US_FOODS_HISTORICAL",
    candidates: ["Sauce, Hot Plastic Jug Shelf Stable Original [Cholula] (US Foods) 4/64 OZ $69.86"],
    presented: "$69.86 ÷ 4 = $17.47 for our 64-oz jug.",
    note: "The strongest refused row in the wave: $17.47 sits 2% from the 2024 sheet's $17.85, so two independent sources agree. But our SKU is a BALDOR line and the only Angel row is US Foods — the lane we migrated away from. A PFG or Baldor quote would make this an immediate write.",
  },
  {
    skuName: "Horseradish", code: "US_FOODS_HISTORICAL",
    candidates: ["Horseradish, Prepared Ref [Monarch] (US Foods) 4/1 GA $84.92"],
    presented: "$84.92 ÷ 4 = $21.23 for our 128-oz (1 gallon) pack.",
    note: "Pack relation is clean (1 gallon = 128 oz); only the lane is wrong. 2024 sheet says $16.42 — 29% under, across two years.",
  },
  {
    skuName: "Tomato Paste", code: "US_FOODS_HISTORICAL",
    candidates: ["Tomato, Paste 26% Light Shelf Stable Canned [Full Red] (US Foods) 6/#10 CN $62.27"],
    presented: "$62.27 per 6 × #10 cans = $10.38/can against our 111-oz pack.",
    note: "Historical lane AND a count parse, so it fails twice. The 2024 sheet carries tomato paste TWICE at $10.70/111 oz and $64.25/1626 oz — a 15× denominator disagreement inside one file, and a clean illustration of why that file is not a price source.",
  },

  // ── Delmar: a case price with no denominator ───────────────────────────────
  {
    skuName: "Branded (C/O) Water", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["Compliments Branded Water (Delmar Provisions) $12.95 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "If one Delmar unit IS our 24-pack, unit_price = $12.95 with no division at all.",
    note: "The single best-corroborated Delmar row: Angel's $12.95 matches the 2024 sheet's `CO Branded Water, Boar's Head, $12.95 / 24 ea` TO THE CENT across two years, and Juan independently labelled the pack 24 × 12 fl oz on 2026-08-28. Three sources point the same way. Still refused only because the Delmar lane carries no denominator and the rule is blood-bought — but this is the row most likely to become a one-line ratification.",
  },
  {
    skuName: "Coke", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["COKE (Delmar Provisions) $25.45 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "If one Delmar unit IS our 35-can case, unit_price = $25.45.",
    note: "Juan labelled the pack 35 × 12 fl oz; the 2024 sheet says $23.95 / 35 ea, so the COUNT is independently confirmed and Angel's price is +6% over two years. Same shape as Branded Water — needs only 'yes, one Delmar case is our case'.",
  },
  {
    skuName: "Diet Coke", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["DIET COKE (Delmar Provisions) $25.45 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "If one Delmar unit IS our 35-can case, unit_price = $25.45.",
    note: "Identical to Coke; the 2024 sheet prices the two together at $23.95 / 35 ea.",
  },
  {
    skuName: "DB Cel Ray", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["CEL-RAY DR. BROWNS [Boar's Head] (Delmar Provisions) $16.95 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "If one Delmar unit IS our 6-pack, unit_price = $16.95.",
    note: "Weaker than the Coke pair: the 2024 sheet's only Dr. Brown's row is $14.87 / 24 ea, and Juan labelled our pack 6 × 12 fl oz. 24 against 6 is a real conflict, so the Dr. Brown's family needs the case count named before any of the six flavours can be priced.",
  },
  {
    skuName: "DB Root Beer", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["ROOT BEER DR. BROWNS (Delmar Provisions) $14.95 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "If one Delmar unit IS our 6-pack, unit_price = $14.95.",
    note: "Same Dr. Brown's 24-vs-6 conflict as Cel Ray.",
  },
  {
    skuName: "DB Cream Soda", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["CREAM DR. BROWNS (Delmar Provisions) $14.95 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "If one Delmar unit IS our 6-pack, unit_price = $14.95.",
    note: "Same Dr. Brown's 24-vs-6 conflict as Cel Ray.",
  },
  {
    skuName: "DB Diet Cream Soda", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["DIET CREAM DR. BROWNS (Delmar Provisions) $14.95 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "If one Delmar unit IS our 6-pack, unit_price = $14.95.",
    note: "Same Dr. Brown's 24-vs-6 conflict as Cel Ray.",
  },
  {
    skuName: "DB Cherry Soda", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["BLACK CHERRY DR. BROWNS (Delmar Provisions) $14.95 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "If one Delmar unit IS our 6-pack, unit_price = $14.95.",
    note: "Same Dr. Brown's 24-vs-6 conflict as Cel Ray. Identity rider: Angel says BLACK CHERRY, our SKU says Cherry Soda.",
  },
  {
    skuName: "DB Diet Cherry Soda", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["DIET CHERRY DR. BROWNS (Delmar Provisions) $16.50 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "If one Delmar unit IS our 6-pack, unit_price = $16.50.",
    note: "Same Dr. Brown's 24-vs-6 conflict as Cel Ray.",
  },
  {
    skuName: "Prosciutto", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["Food Service Prosciutto (Delmar Provisions) $12.95 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "If one Delmar unit IS our 12-oz pack, unit_price = $12.95.",
    note: "Wave 3's piece model closed seven Boar's Head SKUs this way using harvest-2's per-piece weights; prosciutto was not among them, so its denominator is still missing. The 2024 sheet says $10.95 / 12 oz — 18% under, two years back.",
  },
  {
    skuName: "Pickle slices", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["PICKLES CHIPS 1/4 (Delmar Provisions) $35.95 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "If one Delmar unit IS our 1500-slice tub, unit_price = $35.95.",
    note: "This is the report's §C.3 row ITSELF — the one whose case price Angel's UI turned into '$35.95/lb'. Refusing it is the rule's original purpose. 2024 sheet: $32.95 / 1500 ea.",
  },
  {
    skuName: "Whole pickles", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["5 GALLON GARLIC PICKLES (Delmar Provisions) $35.95 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "2024 sheet implies 45 pickles/pail at $32.95 = $0.73 each; our pack is '1 count', so unit_price would be $0.73 — but only if our pack is ONE pickle and the pail holds 45.",
    note: "Doubly open: Delmar has no denominator AND our own pack says 1 count with no weight. Seed 30 held this row for exactly this reason ('brine-vs-pickle oz needs Juan's read').",
  },
  {
    skuName: "Banana Peppers", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["BANANA PEPPER RINGS [Boar's Head] (Delmar Provisions) $8.75 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "If one Delmar unit is ONE 128-fl-oz jar, our 4-jar case is $35.00. If it is the whole case, $8.75.",
    note: "The two readings are 4× apart, which is the whole reason the Delmar rule exists. Juan labelled our pack 4 × 128 fl oz on 2026-08-28; what Angel's unit is remains unknown. 2024 sheet's `Peppers (Banana), baldor, $7.90 / 96 oz` is a different vendor and a different jar.",
  },
  {
    skuName: "Hot Peppers", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["HOT CHERRY PEPPERS (Delmar Provisions) $8.95 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "Jar reading $35.80 for our 4-jar case; case reading $8.95.",
    note: "Same 4× ambiguity as Banana Peppers. Identity rider: Angel says HOT CHERRY peppers, our SKU says Hot Peppers.",
  },
  {
    skuName: "Sweet Peppers", code: "DELMAR_NO_PACK_SIZE",
    candidates: ["SWEET PEPPERS (Delmar Provisions) $10.25 [NO_PACK_SIZE|BROKER_DIRECT]"],
    presented: "Jar reading $41.00 for our 4-jar case; case reading $10.25.",
    note: "Same 4× ambiguity as Banana Peppers. The 2024 sheet's $10.25 / 96 oz matches Angel's number exactly — which tells us the PRICE is stable and still says nothing about the denominator.",
  },

  // ── The 2024 sheet is the only candidate ───────────────────────────────────
  {
    skuName: "Mortadella", code: "COSTING_SHEET_ONLY_2024",
    candidates: ["2024 sheet: Mortadella, BH, $4.29 / 16 oz"],
    presented: "$4.29 for our 16-oz pack.",
    note: "PRECEDENT ROW. Wave 4 examined this exact number, bound the vendor, and deliberately declined to write the price — 'a product nothing on the menu uses does not appear on a 5-week invoice run'. Wave 6 follows that ruling rather than reversing it.",
  },
  {
    skuName: "Mustard (Whole)", code: "COSTING_SHEET_ONLY_2024",
    candidates: ["2024 sheet: Mustard (Whole), b, $25.85 / 176 oz"],
    presented: "$25.85 for our 176-oz pack.",
    note: "Angel has only a DIJON row, and our whole-grain SKU is a different product. The 176 oz is our own seeded echo of this same sheet, so the pack agreement proves nothing.",
  },
  {
    skuName: "Red wine vinegar", code: "COSTING_SHEET_ONLY_2024",
    candidates: ["2024 sheet: Red Wine Vin, b, $13.39 / 169.07 oz"],
    presented: "$13.39 for our 169.07-oz pack.",
    note: "Angel carries balsamic and apple-cider vinegar but no red wine. The sheet prices apple cider at the identical $13.39/169.07 — same number for two different products, another instance of its internal looseness.",
  },
  {
    skuName: "Grapeseed Oil", code: "COSTING_SHEET_ONLY_2024",
    candidates: ["2024 sheet: Grapeseed Oil, b, $19.49 / 101 oz"],
    presented: "$19.49 for our 101-oz pack.",
    note: "Angel carries olive and canola oil only.",
  },
  {
    skuName: "Chili Flake", code: "COSTING_SHEET_ONLY_2024",
    candidates: ["2024 sheet: CHili Flake, b/s, $19.25 / 64 oz"],
    presented: "$19.25 for our 64-oz pack.",
    note: "No Angel row. Vendor cell reads 'b/s' — two vendors in one field, unresolved in the source.",
  },
  {
    skuName: "Old Bay", code: "COSTING_SHEET_ONLY_2024",
    candidates: ["2024 sheet: Old Bay, b, $15.85 / 24 oz"],
    presented: "$15.85 for our 24-oz pack.",
    note: "No Angel row.",
  },
  {
    skuName: "Confectioners Sugar", code: "COSTING_SHEET_ONLY_2024",
    candidates: ["2024 sheet: Confectioners Sugar, b, $1.61 / 16 oz"],
    presented: "$1.61 for our 16-oz pack.",
    note: "No Angel row.",
  },
  {
    skuName: "Garlic Powder", code: "COSTING_SHEET_ONLY_2024",
    candidates: ["2024 sheet: Garlic Powder, b, $20.65 / 80 (unit cell BLANK)"],
    presented: "If the 80 is ounces, $20.65 buys 80 oz and our 96-oz pack would be $24.78.",
    note: "Weakest of the tier: the sheet's UNIT column is empty for this row, and the quantity disagrees with our 96-oz pack anyway. Angel has ONION PWDR but no garlic powder.",
  },
  {
    skuName: "Vanilla Bean Paste", code: "COSTING_SHEET_ONLY_2024",
    candidates: ["2024 sheet: Vanilla Bean Paste, (vendor blank), $54.80 / 32 oz"],
    presented: "$54.80 for our 32-oz pack.",
    note: "Wave 3 already recorded this finding verbatim: 'No \"vanilla\" match anywhere in Angel.' The vendor cell is blank on our side too.",
  },
  {
    skuName: "Worcestershire", code: "OUR_PACK_UNRESOLVABLE",
    candidates: ["2024 sheet: Worcestershire, b, $31.79 / 128 oz"],
    presented: null,
    note: "Blocked before the price is even reachable: our SKU has NO vendor and NO pack fields at all, so there is nothing to denominate against.",
  },
  {
    skuName: "Fruity Pebbles", code: "OUR_PACK_UNRESOLVABLE",
    candidates: ["2024 sheet: Fruit Pebbles, (vendor blank), $2.99 / 11 oz"],
    presented: null,
    note: "Our SKU carries no pack fields. Already on Juan's open list §A as a label read.",
  },
  {
    skuName: "Fusilli Pasta", code: "OUR_PACK_UNRESOLVABLE",
    candidates: ["2024 sheet: Pasta, Rotini, US food, $1.24 / 16 oz"],
    presented: null,
    note: "Our SKU carries no pack fields, AND rotini is not fusilli — a shape substitution the sheet made, not a naming variant. Already on Juan's open list §A.",
  },
];

// ── Cross-wave safety ──────────────────────────────────────────────────────────

/**
 * Wave 6 must never author a SKU wave 1 already has a rule for.
 *
 * Wave 1's table and this one are independent transcriptions, and a SKU appearing
 * in both would mean two divisors of record for one pack — the exact split-brain
 * `contentOzForSku` was consolidated to end. This is asserted rather than trusted:
 * the tables are edited by hand, months apart, by different passes.
 *
 * (The SKUs wave 1 REFUSED are a different matter — Cheddar, Chives, Heavy Cream and
 * Tomatoes are refused again below under their original codes, which is restating a
 * standing refusal, not authoring a competing rule.)
 */
export function wave1SkuOverlap(): string[] {
  const wave1 = new Set(DIVISION_RULES.map((r) => r.skuName));
  return WAVE6_FILL_RULES.map((r) => r.skuName).filter((n) => wave1.has(n));
}

/** A SKU may appear at most once in the fill table — two prices of record is not a state. */
export function duplicateFillSkus(): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const r of WAVE6_FILL_RULES) {
    if (seen.has(r.skuName)) dupes.add(r.skuName);
    seen.add(r.skuName);
  }
  return [...dupes];
}

/** A SKU may not be both filled and refused — that is an unresolved adjudication. */
export function fillRefusalCollisions(): string[] {
  const filled = new Set(WAVE6_FILL_RULES.map((r) => r.skuName));
  return [...new Set(WAVE6_REFUSALS.map((r) => r.skuName).filter((n) => filled.has(n)))];
}

// ── Arithmetic ─────────────────────────────────────────────────────────────────

export interface Wave6Fill {
  rule: Wave6FillRule;
  row: AngelCatalogRow;
  casePriceUsd: number;
  unitPrice: number;
  exact: number;
  /** True when rounding to cents moved the number (a half-cent tie). */
  rounded: boolean;
}

export interface Wave6Resolution {
  fills: Wave6Fill[];
  /** A rule whose catalog row is gone or unpriced. LOUD — never silently dropped,
   *  because a vanished row means the export changed under a transcribed divisor. */
  unmatchedRules: Array<{ rule: Wave6FillRule; why: string }>;
}

/**
 * Join the transcribed rules against the live CSV and compute each pack price.
 *
 * The join is on wave 1's `rowKey` (product | brand | vendor | pack) rather than
 * product name, for wave 1's reason: product name alone is not unique — two BASIL
 * FRSH rows differ by brand and two OREGANO LEAVES rows by pack, and they carry
 * different prices. Wave 6 has the same hazard in its own set (two ONION YLW rows
 * at one pack string, two TOMATO grades), so the full key is load-bearing here too.
 */
export function resolveWave6(rows: readonly AngelCatalogRow[]): Wave6Resolution {
  const byKey = new Map(rows.map((r) => [rowKey(r), r]));
  const fills: Wave6Fill[] = [];
  const unmatchedRules: Array<{ rule: Wave6FillRule; why: string }> = [];

  for (const rule of WAVE6_FILL_RULES) {
    const row = byKey.get(rowKey(rule));
    if (!row) {
      unmatchedRules.push({ rule, why: "no catalog row with this exact product|brand|vendor|pack key — the export changed under a transcribed divisor" });
      continue;
    }
    const casePriceUsd = row.casePriceUsd;
    if (casePriceUsd == null || !Number.isFinite(casePriceUsd) || casePriceUsd <= 0) {
      unmatchedRules.push({ rule, why: `catalog row carries no usable case price (got ${String(casePriceUsd)})` });
      continue;
    }
    const exact = exactQuotient(casePriceUsd, rule.divisor);
    const unitPrice = computePackUnitPrice(casePriceUsd, rule.divisor);
    fills.push({ rule, row, casePriceUsd, unitPrice, exact, rounded: unitPrice !== exact });
  }

  return { fills, unmatchedRules };
}

/**
 * The provenance string for `vendor_price_history.source_note`.
 *
 * Names the Angel row verbatim (product + brand + pack — the full identity, because
 * product name alone is ambiguous) and shows the arithmetic including the unrounded
 * quotient whenever rounding moved the number, so any figure can be reconstructed
 * from the ledger row alone without re-reading the CSV.
 */
export function buildWave6SourceNote(f: Wave6Fill): string {
  const id = `${f.rule.product} [${f.rule.brand || "no brand"}] ${f.rule.packSizeRaw}`;
  const money = (n: number) => `$${n.toFixed(2)}`;

  if (f.rule.relation === "COUNT_AGREES") {
    return `${id} | case ${money(f.casePriceUsd)} = ${f.rule.angelCaseCount} count, equals our ${f.rule.ourPackCount} count pack → ${money(f.unitPrice)} per pack (count-space, no weight basis used)`;
  }
  if (f.rule.relation === "PACK_AGREES") {
    return `${id} | case ${money(f.casePriceUsd)} = ${f.rule.angelCaseOz} oz, equals our ${f.rule.ourPackOz} oz pack → ${money(f.unitPrice)} per pack (no division)`;
  }
  const exactStr = f.rounded ? ` (exact ${f.exact}, rounded to cents)` : "";
  return `${id} | case ${money(f.casePriceUsd)} = ${f.rule.angelCaseOz} oz ÷ ${f.rule.divisor} = our ${f.rule.ourPackOz} oz pack → ${money(f.unitPrice)} per pack${exactStr}`;
}

/**
 * Does the LIVE pack agree with the pack this rule was transcribed against?
 *
 * The divisor encodes an assumption about what our pack IS, so a pack edit between
 * transcription and execution silently changes what the price MEANS. Wave 1
 * re-verified all 21 of its SKUs by hand for this reason; wave 6 does it in code so
 * a later re-run cannot skip the check.
 *
 * COUNT_AGREES rules are verified against `units_per_pack`, not oz — those SKUs
 * legitimately have no oz basis, and demanding one would fail the very rows the
 * count-space path exists to serve.
 *
 * Tolerance is RELATIVE and tight (0.1%), sized for the litre-constant artifact on
 * Olive Oil (101.43 recorded vs 101.44 derived) and nothing looser.
 */
export function packMatchesLive(
  rule: Wave6FillRule,
  live: { contentOz: number | null; unitsPerPack: number | null },
  relTolerance = 0.001,
): { ok: boolean; why: string | null } {
  if (rule.relation === "COUNT_AGREES") {
    if (live.unitsPerPack == null) return { ok: false, why: "live SKU has no units_per_pack; the count relation cannot be confirmed" };
    if (live.unitsPerPack !== rule.ourPackCount) {
      return { ok: false, why: `live units_per_pack ${live.unitsPerPack} ≠ transcribed ${rule.ourPackCount}` };
    }
    return { ok: true, why: null };
  }
  if (live.contentOz == null) return { ok: false, why: "live SKU resolves to no content_oz; the divisor cannot be confirmed" };
  const expected = rule.ourPackOz;
  if (expected == null) return { ok: false, why: "rule carries no ourPackOz" };
  const drift = Math.abs(live.contentOz - expected) / expected;
  if (drift > relTolerance) {
    return { ok: false, why: `live content_oz ${live.contentOz} ≠ transcribed ${expected} (${(drift * 100).toFixed(2)}% drift) — the pack moved under the divisor` };
  }
  return { ok: true, why: null };
}
