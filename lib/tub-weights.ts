/**
 * WAVE 5 — Juan's shop-floor tub readings, 2026-08-21. PURE core (zero I/O, no
 * server imports; the `*-shared` law's sibling — `lib/angel-wave3.ts` and
 * `lib/angel-wave4.ts` are the templates this file follows).
 *
 * ── WHAT THIS WAVE IS ────────────────────────────────────────────────────────
 * Waves 1-4 costed the pantry from a distributor's feed. Every one of them ended
 * at the same wall: **a pack string is not a weighing.** Wave 3 wrote the oregano
 * and onion-powder jugs at their NOMINAL 5 lb precisely because it could not tell
 * a real 5 lb jug from a feed constant, and named the unblock — "one tub on a
 * scale". Wave 4 narrowed that gate to the two jugs and left it open.
 *
 * Juan walked the shop and read five tubs. That is the unblock arriving.
 *
 * ── THE EVIDENCE CLASS IS NOT YET KNOWN, AND THAT IS DELIBERATE ──────────────
 * One question decides how every row below is classed: did he read the tubs'
 * printed weights, or did he put them on a scale?
 *
 *   label -> SPEC          a document states it; nothing was weighed here
 *   scale -> OPERATIONAL   our own measurement, the class wave 3 minted
 *
 * The answer is ONE CONSTANT (`resolveEvidenceClass`), not a rewrite, and the
 * script defaults to the conservative side (SPEC) until he answers. Guessing the
 * class from the numbers is exactly what `WEIGHT_CLASS_MEANING.ESTIMATE` forbids:
 * "a number cannot tell you whether somebody weighed it or guessed it".
 *
 * What the numbers CAN tell us is which SOURCE each reading agrees with, and that
 * is `classifyReadingAgainstPackString` — a discriminator, not a verdict. Its
 * output on today's data is the single most useful thing in this file, so it is
 * stated here rather than buried. Four of the five tubs have an Angel row to
 * compare against; **three of those four readings equal a pack string, and
 * oregano equals the MEASUREMENT (6 against 6.001) while CONTRADICTING its pack
 * string (5).** A pure label-reader could not have produced the oregano number,
 * which is the wave's strongest evidence that these are readings of physical
 * tubs. The fifth tub, chili flake, has no Angel row at all and agrees with our
 * own live pack to the ounce.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────────
 * It does not overwrite a MEASURED weight with a reading. `disposeTub` routes
 * that case to `CONFLICT_PRESENT_ONLY` — the garlic row — because an
 * INVOICE_DERIVED pack is the average of seven real deliveries and a conflict
 * between two evidence classes is a question for Juan, not an arithmetic to
 * resolve in a seed. See `GARLIC_TARE_CONFLICT`.
 */

import { costPerOz } from "@/lib/angel-wave3";
import { lbsToPackOz, isMeasuredWeightClass, type WeightClass } from "@/lib/angel-wave4";

// ── Juan's words ──────────────────────────────────────────────────────────────

/**
 * The relay, VERBATIM. A reading paraphrased into code is a reading nobody can
 * audit — the same discipline as `HERB_WEIGHT_POLICY`, `GARLIC_RATIFICATION` and
 * seed 27's `RULING`.
 *
 * The final clause is load-bearing and is the reason it is quoted whole: **"those
 * are all the tubs I see"** is a completeness claim about what was VISIBLE on the
 * floor, not an inventory. Onion powder — the other half of wave 4's scale gate —
 * is absent from the list, and the honest reading of that absence is "not
 * observed", never "does not exist". It is a question to put back to him, and
 * `ONION_POWDER_STILL_GATED` is where that question lives.
 */
export const JUAN_TUB_READING =
  'Juan 2026-08-21, from the shop: "Garlic powder tub is 6 LB, oregano tub is 6 LB, garlic tub is 5 LB, ' +
  'crushed red pepper tub is 4 LB, whole black pepper is 5.75 LB — those are all the tubs I see."';

/**
 * The question that decides the whole wave's evidence class, recorded as asked so
 * the answer can be matched to it later.
 */
export const EVIDENCE_CLASS_QUESTION =
  "Asked of Juan 2026-08-21, unanswered at authoring time: were the five tub weights READ OFF THE TUBS " +
  "(a printed net weight -> weight_class SPEC) or WEIGHED ON A SCALE (our own measurement -> weight_class " +
  "OPERATIONAL)? The two classes are not interchangeable: wave 3 measured spec running 20-60% above " +
  "operational on every deli item Juan has actually weighed, so a SPEC number is a placeholder awaiting a " +
  "scale and an OPERATIONAL one is the answer. This wave is authored with the class as a single constant " +
  "(--evidence-class), defaulting to the conservative SPEC, so his one-word answer is a one-constant fill " +
  "and never a re-derivation.";

// ── The evidence class, parameterised ─────────────────────────────────────────

/**
 * The two classes Juan's answer can produce. A strict SUBSET of `WeightClass` —
 * neither INVOICE_DERIVED (that is the vendor's scale, not his) nor ESTIMATE
 * (nobody is guessing here) can be the answer to the label-or-scale question, so
 * neither is offerable.
 */
export type EvidenceClass = Extract<WeightClass, "SPEC" | "OPERATIONAL">;

export const EVIDENCE_CLASS_DEFAULT: EvidenceClass = "SPEC";

/** What each answer to `EVIDENCE_CLASS_QUESTION` means, for the source note. */
export const EVIDENCE_CLASS_BASIS: Readonly<Record<EvidenceClass, string>> = {
  SPEC: "Juan read the weight PRINTED ON THE TUB. A document states it; no scale was involved here, so it is a placeholder of documentary standing awaiting a weighing — wave 3's SPEC, exactly.",
  OPERATIONAL: "Juan WEIGHED the tub. Our own measurement, taken by the person who runs the kitchen — wave 3's OPERATIONAL, the class that outranks every label.",
};

/**
 * Validate the `--evidence-class` flag. THROWS on anything else rather than
 * falling back, because a silent fallback would stamp the conservative class onto
 * a run the operator believed was writing the measured one — and the two classes
 * differ by exactly the 20-60% gap wave 3 measured.
 *
 * `null`/absent is the ONLY accepted absence and yields the documented default.
 */
export function resolveEvidenceClass(raw: string | null | undefined): EvidenceClass {
  if (raw == null || raw === "") return EVIDENCE_CLASS_DEFAULT;
  const up = raw.trim().toUpperCase();
  if (up === "SPEC" || up === "OPERATIONAL") return up;
  throw new Error(
    `--evidence-class must be SPEC or OPERATIONAL (got "${raw}"). ` +
      "It answers one question — did Juan read the tub's label or put it on a scale — and there is no " +
      "third answer. Omit the flag for the conservative default (SPEC).",
  );
}

// ── Angel cross-reference ─────────────────────────────────────────────────────

/**
 * What Angel knows about the row a tub costs from. Present for four of the five
 * tubs; `null` where Angel has no row at all (chili flake), which is a real
 * finding rather than a lookup failure — see the census's PFG-omitted list.
 */
export interface AngelCrossReference {
  product: string;
  brand: string;
  vendor: string;
  /** The pack string verbatim, e.g. `1/5 LB` or `3/6 LB`. */
  packString: string;
  /** Pounds the pack string declares for ONE INNER unit (the `6` in `3/6 LB`). */
  packStringLbs: number;
  /** Inner units per Angel purchase unit (the `3` in `3/6 LB`; 1 for `1/5 LB`). */
  unitsPerAngelUnit: number;
  /** Invoice-measured pounds per ANGEL PURCHASE UNIT (so a case, where N > 1). */
  measured: { meanLbs: number; minLbs: number; maxLbs: number; lines: number };
  /** Latest observed price of one ANGEL PURCHASE UNIT, and when. */
  latestUnitPriceUsd: number;
  latestSeen: string;
}

/** Is this Angel row's measured weight indistinguishable from a stored constant? */
export function measuredSpreadFraction(x: AngelCrossReference): number {
  if (x.measured.meanLbs <= 0) return 0;
  return (x.measured.maxLbs - x.measured.minLbs) / x.measured.meanLbs;
}

// ── The discriminator: which source does a reading agree with? ────────────────

/**
 * Which of the two documented numbers a reading matches.
 *
 * This is EVIDENCE ABOUT THE READING, not about the tub. A reading that equals
 * the pack string is consistent with a label read AND with a scale that happened
 * to confirm the label; a reading that equals the measurement while contradicting
 * the pack string can only have come from something other than that pack string.
 * The asymmetry is the whole value: `MATCHES_MEASUREMENT` is informative,
 * `MATCHES_PACK_STRING` is not.
 */
export type ReadingAgreement =
  | "MATCHES_PACK_STRING"
  | "MATCHES_MEASUREMENT"
  | "MATCHES_BOTH"
  | "MATCHES_NEITHER"
  | "NO_ANGEL_ROW";

/**
 * An ABSOLUTE hundredth of a pound on the pack-string side, a RELATIVE two
 * percent on the measurement side. Both halves of that asymmetry are deliberate.
 *
 * A pack string is a printed figure: a reading either equals it or does not, so
 * 0.01 lb is float slack rather than judgement.
 *
 * The measurement side is relative because the quantity varies with the tub —
 * 0.4 lb is nothing on a 40 lb case and a great deal on a 4 lb tub — and it is
 * TIGHT because `MATCHES_MEASUREMENT` is the only informative answer this
 * function gives. It is the label that says "a pack-string reader could not have
 * produced this number", and handing it out on a loose band would let a reading
 * that merely lands somewhere near the invoice claim evidence it has not earned.
 * Two percent grants it to oregano's 6 against 6.001 (0.02%) and withholds it
 * from black pepper's 5.75 against 6.119 (6.0%) and garlic powder's 6 against
 * 6.624 (9.4%), which is the honest reading of all three.
 *
 * The deliberate consequence: because Juan reads to the whole or quarter pound,
 * a tub genuinely weighing 6.1 lb read as "6" would be reported as disagreeing
 * with its own measurement. That is the conservative direction — the function
 * under-claims agreement rather than over-claiming evidence.
 */
export const PACK_STRING_TOLERANCE_LBS = 0.01;
export const MEASUREMENT_TOLERANCE_FRACTION = 0.02;

export function classifyReadingAgainstPackString(
  readingLbs: number,
  angel: AngelCrossReference | null,
): ReadingAgreement {
  if (angel == null) return "NO_ANGEL_ROW";
  const packHit = Math.abs(readingLbs - angel.packStringLbs) <= PACK_STRING_TOLERANCE_LBS;
  // Per INNER unit, so a `3/6 LB` case's 19.872 lb is compared as 6.624 lb/tub —
  // the grain Juan actually read. Comparing his tub against a case would report
  // disagreement on a units mismatch and call it evidence.
  const measuredPerInner = angel.measured.meanLbs / Math.max(1, angel.unitsPerAngelUnit);
  const measHit =
    measuredPerInner > 0 &&
    Math.abs(readingLbs - measuredPerInner) / measuredPerInner <= MEASUREMENT_TOLERANCE_FRACTION;
  if (packHit && measHit) return "MATCHES_BOTH";
  if (packHit) return "MATCHES_PACK_STRING";
  if (measHit) return "MATCHES_MEASUREMENT";
  return "MATCHES_NEITHER";
}

/**
 * The one row whose agreement carries information, named so the finding cannot be
 * lost in a table. Read `CANNOT_BE_A_PACK_STRING_READ` as: whatever produced this
 * number, it was not PFG's catalog.
 */
export const READING_AGREEMENT_MEANING: Readonly<Record<ReadingAgreement, string>> = {
  MATCHES_PACK_STRING:
    "Equals the vendor's pack string. Consistent with a label read AND with a scale that confirmed the label — so it distinguishes nothing on its own.",
  MATCHES_MEASUREMENT:
    "Equals the invoice measurement and CONTRADICTS the pack string. Whatever produced this number, it was not the vendor's catalog — the strongest evidence in the wave that these readings are of the physical tubs.",
  MATCHES_BOTH: "Pack string and measurement agree with each other and with the reading. Three sources, one number.",
  MATCHES_NEITHER: "Agrees with neither documented number — investigate before writing anything.",
  NO_ANGEL_ROW: "Angel carries no row for this product, so there is nothing to agree or disagree with. The reading is the only evidence that exists.",
};

// ── The readings ──────────────────────────────────────────────────────────────

/** Whether Juan's phrase IS our SKU's name, or a functional synonym for it. */
export type NameMatch = "VERBATIM" | "SYNONYM";

export interface TubReading {
  /** Juan's phrase for this tub, verbatim from the relay above. */
  spoken: string;
  /** Pounds as he said them. */
  lbs: number;
  /** Our SKU. Re-resolved live by the script; ambiguity is a refusal. */
  skuName: string;
  vendor: string;
  nameMatch: NameMatch;
  /** Why this SKU, where the name is not his phrase. Empty for VERBATIM. */
  matchEvidence: string;
  angel: AngelCrossReference | null;
  /**
   * The pack we expect to find live, in ounces — an ASSERTION the script checks
   * against production, never an input to the arithmetic. `null` asserts the SKU
   * has no pack at all. A drift here stops the row rather than flattening
   * whatever it finds (wave 4's PACK_SHAPE_CHANGED discipline).
   */
  expectedLivePackOz: number | null;
  /**
   * The weight class carried by the newest `sku.pack_chain_update` audit row for
   * this SKU — the provenance of the pack we are proposing to move. Asserted here
   * and verified live, because it is what decides WRITE versus CONFLICT.
   */
  expectedLivePackClass: WeightClass | null;
  /** Anything about this row a reader would otherwise have to rediscover. */
  note: string;
}

/**
 * The five tubs, each with everything needed to judge it.
 *
 * Angel figures are quoted from `docs/angel-products-rollup.csv` and re-derived
 * live from `docs/angel-purchase-history.csv` by the script; they are assertions
 * here so a CSV that moved under them fails loudly.
 */
export const TUB_READINGS: readonly TubReading[] = [
  {
    spoken: "Garlic powder tub is 6 LB",
    lbs: 6,
    skuName: "Garlic Powder",
    vendor: "PFG",
    nameMatch: "VERBATIM",
    matchEvidence: "",
    angel: {
      product: "GARLIC PWDR",
      brand: "MAGELLAN",
      vendor: "PFG",
      packString: "3/6 LB",
      packStringLbs: 6,
      unitsPerAngelUnit: 3,
      measured: { meanLbs: 19.872, minLbs: 19.872, maxLbs: 19.872, lines: 1 },
      latestUnitPriceUsd: 210.84,
      latestSeen: "2026-08-14",
    },
    expectedLivePackOz: null,
    expectedLivePackClass: null,
    note:
      "OUR SKU HAS NO PACK OF ANY KIND — no pack_format, no units, no each_size. It has never had a " +
      "denominator, which is why it has never had a price. Juan's 6 LB names the INNER unit of Angel's " +
      "`3/6 LB` exactly, so the case is 3 x his tub and the pack can be written at both levels with no " +
      "divisor invented anywhere. NOTE the census (docs/seed/source/angel-reconciliation-report.md " +
      "E.2) lists Garlic Powder as PFG-OMITTED — that is true of the Angel CATALOG export and FALSE of " +
      "the purchase history, which carries one invoice line. The catalog and the invoice feed are " +
      "different artifacts and the census only ever read the first.",
  },
  {
    spoken: "oregano tub is 6 LB",
    lbs: 6,
    skuName: "Oregano",
    vendor: "PFG",
    nameMatch: "VERBATIM",
    matchEvidence: "",
    angel: {
      product: "OREGANO LEAVES",
      brand: "ROMA",
      vendor: "PFG",
      packString: "1/5 LB",
      packStringLbs: 5,
      unitsPerAngelUnit: 1,
      measured: { meanLbs: 6.001, minLbs: 6.001, maxLbs: 6.001, lines: 3 },
      latestUnitPriceUsd: 55.27,
      latestSeen: "2026-08-14",
    },
    expectedLivePackOz: 80,
    expectedLivePackClass: null,
    note:
      "THE ROW THE SCALE GATE WAS ABOUT. Wave 3 §C wrote 80 oz at the pack string's NOMINAL 5 lb, " +
      "cost-neutral and explicitly pending a scale, because Angel's 6.001 lb never moved across three " +
      "months and a weight that never moves might be a feed constant rather than a weighing. Juan's " +
      "reading is 6 LB — the MEASURED value, not the pack string. Two independent sources now agree on " +
      "6 lb and only PFG's catalog says 5, so the gate closes in favour of 96 oz and wave 4's own " +
      "caveat is what turned out to be right: 'a zero spread is not proof of fabrication — a " +
      "manufactured jug fill really is constant'.",
  },
  {
    spoken: "garlic tub is 5 LB",
    lbs: 5,
    skuName: "Garlic",
    vendor: "PFG",
    nameMatch: "VERBATIM",
    matchEvidence: "",
    angel: {
      product: "GARLIC WHL PLD DOM",
      brand: "PEAK FRS",
      vendor: "PFG",
      packString: "1/5 LB",
      packStringLbs: 5,
      unitsPerAngelUnit: 1,
      measured: { meanLbs: 5.996, minLbs: 5.9935, maxLbs: 6.0077, lines: 7 },
      latestUnitPriceUsd: 19.72,
      latestSeen: "2026-08-14",
    },
    expectedLivePackOz: 95.94,
    expectedLivePackClass: "INVOICE_DERIVED",
    note:
      "THE CONFLICT. Wave 4 §C wrote 95.94 oz as INVOICE_DERIVED — the average of seven real deliveries, " +
      "ratified by Juan on 2026-08-20 on the strength of its VARYING per-tub weight. His 5 LB reading " +
      "contradicts it. Nothing is written here; see GARLIC_TARE_CONFLICT.",
  },
  {
    spoken: "crushed red pepper tub is 4 LB",
    lbs: 4,
    skuName: "Chili Flake",
    vendor: "PFG",
    nameMatch: "SYNONYM",
    matchEvidence:
      "`crushed red pepper` and `chili flake` are the same product; the recipe seed's own alias table " +
      "maps both (`scripts/seed/lib-recipe-seed.ts`: \"chili flake\" and \"red pepper flakes\" -> " +
      "\"Chili Flake\"). It is also the only candidate: no live SKU matches `crushed`, `red pepper` or " +
      "`flake` under any spelling. The pack agreeing to the ounce is itself corroboration of the match.",
    angel: null,
    expectedLivePackOz: 64,
    expectedLivePackClass: null,
    note:
      "Angel has NO crushed-red-pepper or chili-flake row anywhere — not in the catalog, not in 441 " +
      "invoice lines — which matches the census's PFG-omitted list. Juan's reading is therefore the " +
      "ONLY evidence that exists for this pack, and it agrees with the live 64 oz to the ounce. A " +
      "confirmation, not a correction.",
  },
  {
    spoken: "whole black pepper is 5.75 LB",
    lbs: 5.75,
    skuName: "Black peppercorn",
    vendor: "PFG",
    nameMatch: "SYNONYM",
    matchEvidence:
      "Our SKU is named `Black peppercorn`; Juan said `whole black pepper`, which is the same product " +
      "said the other way round and is how Angel spells it too (`PEPPER BLK WHL`). The recipe seed's " +
      "alias table maps \"black pepper\" -> \"Black peppercorn\", and it is the only pepper SKU under " +
      "PFG.",
    angel: {
      product: "PEPPER BLK WHL",
      brand: "ROMA",
      vendor: "PFG",
      packString: "1/5.75LB",
      packStringLbs: 5.75,
      unitsPerAngelUnit: 1,
      measured: { meanLbs: 6.119, minLbs: 6.117, maxLbs: 6.12, lines: 3 },
      latestUnitPriceUsd: 53.52,
      latestSeen: "2026-08-14",
    },
    expectedLivePackOz: null,
    expectedLivePackClass: null,
    note:
      "NO PACK LIVE, and 13 recipe pins hang off it. The 5.75 is NOT the scale tell it looks like: " +
      "Angel's pack string is literally `1/5.75LB`, so the quarter-pound comes from McCormick's pack " +
      "size and Juan's reading matches it exactly. Angel's own measured weight is 6.119 lb — 1.064x " +
      "nominal — but it is near-CONSTANT across its three lines (0.05% spread), which by wave 4's own " +
      "discriminator is the signature of a stored number rather than a weighing. So the pack string " +
      "wins here, corroborated by Juan, and the invoice figure is reported rather than used.",
  },
];

// ── The garlic conflict ───────────────────────────────────────────────────────

/**
 * Garlic is the only row where Juan's reading contradicts a MEASURED class, and
 * it is presented rather than written. The reasoning, in full, because the
 * recommendation is only worth as much as the argument behind it:
 *
 * **What each side is.** Live is 95.94 oz, the quantity-weighted mean of seven
 * invoice lines covering 21 tubs (5.9935-6.0077 lb), written by wave 4 §C and
 * ratified by Juan on 2026-08-20. His reading is 5 LB = 80 oz, which is also
 * exactly what PFG's pack string says.
 *
 * **Why the ratification's evidence does not settle it.** `GARLIC_RATIFICATION`
 * turns on ONE observation: garlic's per-tub weight VARIES (0.24% spread) while
 * oregano's never moves, so garlic's is a real weighing. That inference is sound
 * and it is also insufficient — it establishes that something was weighed, not
 * WHAT was weighed. A tub of peeled garlic packed in water weighs its garlic plus
 * its water plus its tub, and all three vary a little from tub to tub. The spread
 * discriminates a measurement from a constant; it cannot discriminate NET product
 * from GROSS shipping weight, and that is the question here.
 *
 * **The arithmetic of the gap.** 5.996 - 5.000 = 0.996 lb, just under 16 oz of
 * water and plastic on a 5 lb net fill. That is an entirely ordinary tare for a
 * brine-packed produce tub, and it is suspiciously round.
 *
 * **THE PRECEDENT IS ALREADY IN THIS REPO, AND IT POINTS THE OTHER WAY.** Wave 4
 * §A2 refused Angel's beef-base $/lb for exactly this reason, in Juan's own
 * ruling: "Angel's $9.34/lb is the case price over a GROSS weight that includes
 * the glass jar (6.703 lb against a 6.0 lb nominal = 1.117x, the tare pattern
 * harvest 2 §5 names for bottles)". Beef base at 1.117x gross was refused as a
 * costing denominator; garlic at 1.199x gross was accepted as one, in the same
 * wave, on the strength of a spread column that beef base was never asked about.
 * The two calls are not obviously reconcilable, and noticing that is this row's
 * main contribution.
 *
 * **What is NOT claimed.** That wave 4 is wrong. 95.94 oz is very likely the
 * correct BILLED weight — what PFG weighed and charged for. The question is
 * whether a billed weight is the right denominator under a recipe's ounces, and
 * the beef-base ruling says it is not: costing wants USABLE product.
 *
 * **The decisive test, and it is cheap.** Weigh one full tub, then drain it and
 * weigh the garlic. Gross ~6 lb with net ~5 lb proves the tare reading and 80 oz
 * becomes the costing denominator; gross ~5 lb proves the opposite and 95.94
 * stands with a puzzle attached.
 */
export const GARLIC_TARE_CONFLICT = {
  skuName: "Garlic",
  liveOz: 95.94,
  liveClass: "INVOICE_DERIVED" as WeightClass,
  liveBasis: "quantity-weighted mean of 7 invoice lines / 21 tubs, 5.9935-6.0077 lb (wave 4 §C, Juan-ratified 2026-08-20)",
  readingOz: 80,
  readingBasis: "Juan 2026-08-21: \"garlic tub is 5 LB\" — which is also, exactly, PFG's `1/5 LB` pack string",
  unitPriceUsd: 19.72,
  /** The billed-versus-net gap, in ounces of one tub. */
  gapOz: 15.94,
  hypothesis:
    "The invoice weight is GROSS (garlic + brine + tub) and the label's 5 lb is NET product. 0.996 lb of " +
    "water and plastic on a 5 lb fill is an ordinary tare for a brine-packed produce tub.",
  counterHypothesis:
    "The tubs really do hold ~6 lb of garlic and Juan read the pack string off the lid rather than " +
    "weighing anything — in which case the reading adds no information wave 4 did not already have.",
  precedent:
    "Wave 4 §A2 (BEEF_BASE_RULING) refused a GROSS invoice weight as a costing denominator at 1.117x " +
    "nominal because the excess was glass. Garlic sits at 1.199x and was accepted in the same wave. The " +
    "two calls need one reconciliation, and it is Juan's to make.",
  recommendation:
    "DO NOT WRITE either way today. Ask one question — label or scale — and if scale, whether the tub was " +
    "weighed full and undrained. If the tare reading holds, supersede the pack to 80 oz and the costing " +
    "denominator becomes usable product; the $19.72 price is correct under BOTH readings and does not move.",
  decisiveTest:
    "Weigh one full tub, drain it, weigh the garlic. Gross ~6 lb with net ~5 lb settles it in 90 seconds — " +
    "the same 90 seconds wave 3 asked for and got.",
} as const;

/**
 * The note class the garlic row creates, named because it will recur.
 *
 * Harvest 2 §5 already found it on bottles (beef base's glass) and it is the same
 * phenomenon on tubs (brine) and boxes (ice, on catch-weight protein): **the
 * weight a distributor bills is not always the weight of the food.** Where the
 * two differ, costing wants the food. This is not a correction to any existing
 * class — an INVOICE_DERIVED average of billed weights is a perfectly true
 * number — it is a statement about which number belongs under a recipe.
 */
export const BILLED_VS_NET_NOTE_CLASS =
  "BILLED_VS_NET — the vendor's invoice weight includes packaging or packing medium that the recipe " +
  "cannot use (brine, glass, ice). The invoice figure stays true as a BILLED weight; the costing " +
  "denominator should be USABLE product ounces. Precedents: beef base's glass jars (wave 4 §A2, refused " +
  "the gross denominator), garlic's brine (wave 5, open). Distinguishable from a feed artifact by the " +
  "fact that tare is physical and scales with the container, not with a constant multiplier.";

/** Billed ounces minus usable ounces, or null when either side is unknown. */
export function billedVsNetGapOz(billedOz: number | null, netOz: number | null): number | null {
  if (billedOz == null || netOz == null) return null;
  if (!Number.isFinite(billedOz) || !Number.isFinite(netOz)) return null;
  return Number((billedOz - netOz).toFixed(4));
}

// ── Onion powder: the half of the gate that stays shut ────────────────────────

/**
 * Onion powder is NOT in Juan's list, so nothing about it is written or implied.
 *
 * Its circumstantial case just got much stronger and that is worth saying out
 * loud without acting on it: it is the same vendor, the same brand, the same
 * `1/5 LB` pack string and the same near-exact 1.20x as oregano, and oregano's
 * 1.20x has now been confirmed by a human standing in front of the tub. If a
 * cluster argument were ever going to be trusted, this is the strongest form of
 * it available.
 *
 * It is still not a reading, and the whole reason wave 3 refused to write these
 * jugs was that a plausible inference is not a measurement. One more tub reading
 * closes it — and Juan's own "those are all the tubs I see" makes that ask
 * concrete rather than open-ended: is there an onion powder tub on the floor at
 * all?
 */
export const ONION_POWDER_STILL_GATED = {
  skuName: "Onion Powder",
  vendor: "PFG",
  livePackOz: 80,
  wouldBeOz: 96,
  angelMeasuredLbs: 6.002,
  angelPackString: "1/5 LB",
  unblock:
    "One reading of the onion powder tub. Juan listed five tubs and said they were all he could see, so " +
    "the first question is whether an onion powder tub is on the floor at all — its single invoice line " +
    "is from Jul 31, which is consistent with a tub that has since been used up.",
  whyNotInferred:
    "Same vendor, brand, pack string and 1.20x ratio as oregano, whose 1.20x a human has now confirmed. " +
    "That is the strongest cluster argument this arc will ever have and it is still an inference. Wave 3 " +
    "refused to write these jugs precisely because an inference is not a measurement, and one row " +
    "resolving does not change what the other row is.",
} as const;

// ── Disposition ───────────────────────────────────────────────────────────────

export type TubDisposition =
  /** No pack lives on our side; the reading establishes the first one. */
  | "WRITE_NEW_PACK"
  /** A pack lives and the reading moves it, with no measured class in the way. */
  | "WRITE_RESOLUTION"
  /** The reading equals the live pack. Corroboration, and nothing to write. */
  | "CONFIRMS_LIVE"
  /** The reading contradicts a MEASURED pack. Present it; never overwrite it. */
  | "CONFLICT_PRESENT_ONLY"
  /** No live SKU answers to this tub — a decision-table row, not a write. */
  | "NO_MATCHING_SKU";

export const DISPOSITION_MEANING: Readonly<Record<TubDisposition, string>> = {
  WRITE_NEW_PACK: "our SKU had no pack at all; the reading gives it its first denominator",
  WRITE_RESOLUTION: "a pack exists, the reading moves it, and nothing measured is being overruled",
  CONFIRMS_LIVE: "the reading and the live pack are the same number — corroboration, no write",
  CONFLICT_PRESENT_ONLY: "the reading contradicts a weight a scale produced; present both, write neither",
  NO_MATCHING_SKU: "no live SKU answers to this tub — the answer goes in a decision table",
};

/** An ounce of slack. Packs are written to 2 dp, so this is float slack only. */
export const PACK_MATCH_TOLERANCE_OZ = 0.01;

/**
 * Which of the five outcomes a tub gets. PURE, and the ORDER OF THE CHECKS IS THE
 * POLICY:
 *
 *   no SKU        -> nothing to write against
 *   no live pack  -> a fill, never an overwrite; no class can be in the way
 *   already equal -> a confirmation outranks a conflict, because there is nothing
 *                    to conflict ABOUT; checking the measured class first would
 *                    report a conflict on two numbers that agree
 *   measured live -> refuse
 *   otherwise     -> write
 */
export function disposeTub(input: {
  skuFound: boolean;
  readingOz: number;
  livePackOz: number | null;
  livePackClass: string | null;
}): TubDisposition {
  const { skuFound, readingOz, livePackOz, livePackClass } = input;
  if (!skuFound) return "NO_MATCHING_SKU";
  if (livePackOz == null) return "WRITE_NEW_PACK";
  if (Math.abs(readingOz - livePackOz) <= PACK_MATCH_TOLERANCE_OZ) return "CONFIRMS_LIVE";
  if (isMeasuredWeightClass(livePackClass)) return "CONFLICT_PRESENT_ONLY";
  return "WRITE_RESOLUTION";
}

/** Pounds as Juan said them -> the ounces a pack level carries. */
export function tubPackOz(lbs: number): number {
  return lbsToPackOz(lbs);
}

/**
 * What a pack change does to cost per ounce, WITHOUT touching the price.
 *
 * The distinction this encodes is the one wave 5 has to get right and wave 3 did
 * not have to face. Wave 3 §C changed the DIVISOR — our pack went from a quarter
 * of a jug to a whole jug — so the price of one of our packs genuinely changed
 * and a superseding price row was mandatory. Wave 5 changes what a pack CONTAINS
 * while the pack stays the same physical object: one jug cost $55.27 before and
 * one jug costs $55.27 after. `unit_price` is the price of one of OUR packs, so
 * it does not move; only the derived $/oz does. A superseding price row here
 * would assert a change nobody made.
 */
export interface PackRecostEffect {
  packOzBefore: number | null;
  packOzAfter: number;
  unitPriceUsd: number | null;
  costPerOzBefore: number | null;
  costPerOzAfter: number | null;
  /** Fractional change in $/oz; null when either side cannot be computed. */
  costPerOzChange: number | null;
  /** True when the price row is untouched — i.e. always, for a content-only move. */
  priceRowUnchanged: true;
}

export function packRecostEffect(input: {
  packOzBefore: number | null;
  packOzAfter: number;
  unitPriceUsd: number | null;
}): PackRecostEffect {
  const { packOzBefore, packOzAfter, unitPriceUsd } = input;
  const before = costPerOz(unitPriceUsd, packOzBefore);
  const after = costPerOz(unitPriceUsd, packOzAfter);
  const change = before != null && after != null && before !== 0 ? after / before - 1 : null;
  return {
    packOzBefore,
    packOzAfter,
    unitPriceUsd,
    costPerOzBefore: before,
    costPerOzAfter: after,
    costPerOzChange: change,
    priceRowUnchanged: true,
  };
}

// ── Refusal vocabulary ────────────────────────────────────────────────────────

export type Wave5Code =
  | "SKU_UNRESOLVED"
  | "VENDOR_DRIFT"
  | "PACK_SHAPE_CHANGED"
  | "PACK_CLASS_DRIFT"
  | "MEASURED_CONFLICT"
  | "ALREADY_CORRECT"
  | "NOT_IN_READING"
  | "PRICE_NEEDS_APPROVAL";

export const WAVE5_REASONS: Readonly<Record<Wave5Code, string>> = {
  SKU_UNRESOLVED:
    "No single live SKU answers to this tub — zero matches, or more than one. A seed that guesses which twin a reading meant is how a weight lands on the wrong row invisibly.",
  VENDOR_DRIFT:
    "The SKU exists but not under the vendor this reading asserts. The vendor is part of the identity; a pack written across a vendor boundary is a different product's pack.",
  PACK_SHAPE_CHANGED:
    "The live pack is not the shape this plan asserted. Something moved between the dry run and now, so the row stops and is re-derived rather than flattened over.",
  PACK_CLASS_DRIFT:
    "The live pack's provenance is not what this plan asserted, which means the WRITE-versus-CONFLICT decision was made against the wrong evidence. Re-read before proceeding.",
  MEASURED_CONFLICT:
    "The reading contradicts a pack a scale produced. Presented in full with both numbers and a recommendation; never silently overwritten.",
  ALREADY_CORRECT: "The live value already equals the reading. Corroboration, and nothing to write.",
  NOT_IN_READING: "Juan did not name this tub, so this wave has nothing to say about it. Absence from his list is 'not observed', never 'does not exist'.",
  PRICE_NEEDS_APPROVAL:
    "A price is newly derivable now that a pack exists, but pricing is not what a tub reading is evidence about. The arithmetic is done and put in a decision table for one approval.",
};
