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
 * ── THE EVIDENCE CLASS: ASKED, AND ANSWERED ─────────────────────────────────
 * One question decided how every row below is classed: did he read the tubs'
 * printed weights, or did he put them on a scale?
 *
 *   label -> SPEC          a document states it; nothing was weighed here
 *   scale -> OPERATIONAL   our own measurement, the class wave 3 minted
 *
 * **He answered: "it's the label."** Every reading here is SPEC. The class is
 * still ONE CONSTANT (`resolveEvidenceClass`) rather than a hard-coded literal,
 * because the parameter is what made the answer a one-word fill instead of a
 * re-derivation — and the question, the answer and the default are all recorded
 * so the trail shows a ruling rather than a coincidence.
 *
 * **The retraction that matters.** The first dry run observed that oregano's 6
 * equals Angel's MEASURED 6.001 while contradicting PFG's `1/5 LB` pack string,
 * and inferred from that that a pack-string reader could not have produced it —
 * i.e. that a scale was involved. **That inference is RETRACTED.** It confused
 * two different documents: the TUB's own printed label and PFG's CATALOG string
 * are not the same artifact, and Juan was reading the first. The observation
 * survives intact and is worth more than the inference was: the tub's label and
 * the vendor's invoice independently agree on 6 lb, and PFG's catalog is the
 * outlier. That is a label CORROBORATED BY A MEASUREMENT — still SPEC, and the
 * strongest SPEC this arc has.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────────
 * It does not overwrite a MEASURED weight with a reading. `disposeTub` routes
 * that case to `CONFLICT_PRESENT_ONLY`: an INVOICE_DERIVED pack is the average
 * of real deliveries, and a conflict between two evidence classes is a question
 * for Juan, not an arithmetic to resolve in a seed.
 *
 * That branch is UNEXERCISED this run, and the reason is the second answer.
 * "Garlic tub is 5 LB" turned out to be a garlic POWDER tub, not the peeled
 * garlic SKU — so no reading bears on `Garlic` at all, its 95.94 oz stands
 * untouched, and the tare conflict the first dry run presented dissolved rather
 * than being resolved. See `GARLIC_REATTRIBUTION`. The branch stays because the
 * policy is right and the next wave will need it.
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
 * Juan's two follow-up answers, 2026-08-21, relayed through the lead. Verbatim,
 * and kept SEPARATE from the reading above rather than folded into it — a relay
 * edited in place is a relay nobody can audit, and the second of these
 * REATTRIBUTES one of the five tubs to a different SKU. Which words were the
 * original observation and which were the correction is exactly the thing a
 * merged quote would destroy.
 */
export const JUAN_CLARIFICATIONS = {
  evidenceClass: 'Juan 2026-08-21, asked whether the five tub weights were label reads or scale weighings: "It\'s the label."',
  garlicReattribution: 'Juan 2026-08-21, asked which garlic the "garlic tub is 5 LB" line referred to: "It\'s garlic powder tub."',
} as const;

/**
 * The question that decided the whole wave's evidence class, recorded as asked so
 * the answer can be matched to it.
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

/**
 * What Juan actually answered. The default below equals it — which is a fact
 * worth stating rather than a tautology to hide: the run authored BEFORE he
 * answered defaulted to the conservative side and the conservative side turned
 * out to be right, so no row's class ever changed. Had he said "scale", one flag
 * would have moved every row, which is the whole reason the class was a
 * parameter.
 */
export const EVIDENCE_CLASS_RULED: EvidenceClass = "SPEC";

export const EVIDENCE_CLASS_ANSWER =
  `${JUAN_CLARIFICATIONS.evidenceClass} -> weight_class SPEC on every row of this wave. The readings are ` +
  "printed net weights on the tubs, not weighings. RETRACTS the first dry run's inference that oregano's " +
  "agreement with Angel's measurement implied a scale: it conflated the TUB's label with PFG's CATALOG " +
  "pack string, which are different documents. The observation stands and is stronger than the inference " +
  "was — the tub's label and the vendor's invoice agree on 6 lb independently, and the catalog is the odd " +
  "one out. A label corroborated by a measurement is still a label, and it is the best SPEC we hold.";

export const EVIDENCE_CLASS_DEFAULT: EvidenceClass = EVIDENCE_CLASS_RULED;

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
 * THE PACK STRING COMPARED AGAINST IS PFG'S CATALOG STRING, WHICH IS NOT THE
 * DOCUMENT JUAN READ. He read the tub's own printed label. The first dry run
 * conflated the two and drew an inference from the difference — that oregano's
 * agreement with the invoice implied a scale — which his "it's the label" answer
 * retracted.
 *
 * So this is EVIDENCE ABOUT WHICH OF THE VENDOR'S DOCUMENTS AGREE, not about how
 * Juan obtained a number. `MATCHES_PACK_STRING` means the tub's label and the
 * catalog agree. `MATCHES_MEASUREMENT` means the tub's label and the INVOICE
 * agree while the catalog dissents — the interesting case, because it is the
 * vendor disagreeing with itself and the scale siding with the label.
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
 * What each answer means now that Juan has said the readings are LABELS.
 *
 * The column no longer tells us anything about HOW he obtained a number — he told
 * us. It tells us which of PFG's own two documents the tub's label agrees with,
 * and the interesting case is where they disagree with EACH OTHER.
 */
export const READING_AGREEMENT_MEANING: Readonly<Record<ReadingAgreement, string>> = {
  MATCHES_PACK_STRING:
    "The tub's label and PFG's catalog string agree. Two documents, one number — and no measurement involved on either side, so it stays a documented weight awaiting a scale.",
  MATCHES_MEASUREMENT:
    "The tub's label agrees with the INVOICE and contradicts PFG's CATALOG string — a disagreement between two of the vendor's own documents, in which the one a scale produced sides with the label. The catalog is the outlier. Still SPEC (a label is a label), but a label corroborated by an independent measurement is the strongest SPEC this arc holds.",
  MATCHES_BOTH: "Pack string and measurement agree with each other and with the label. Three sources, one number.",
  MATCHES_NEITHER: "Agrees with neither documented number — investigate before writing anything.",
  NO_ANGEL_ROW: "Angel carries no row for this product, so there is nothing to agree or disagree with. The label is the only evidence that exists.",
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
      "`3/6 LB` exactly: label and catalog string agree. **THIS SKU HAS A SECOND, SMALLER TUB ON THE " +
      "FLOOR** — his \"garlic tub is 5 LB\" line turned out to be garlic powder too (see " +
      "GARLIC_REATTRIBUTION), and 5 lb matches neither the label written here nor the invoice. The 6 lb " +
      "tub is the one written because two documents agree on it; the 5 lb sighting is recorded " +
      "unresolved in STRAY_SHELF_OBSERVATIONS. NOTE the census " +
      "(docs/seed/source/angel-reconciliation-report.md E.2) lists Garlic Powder as PFG-OMITTED — that " +
      "is true of the Angel CATALOG export and FALSE of the purchase history, which carries one invoice " +
      "line. The catalog and the invoice feed are different artifacts and the census only read the first.",
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
      "months and a weight that never moves might be a feed constant rather than a weighing. The tub's " +
      "own label says 6 LB — agreeing with Angel's MEASUREMENT and contradicting PFG's CATALOG string, " +
      "which are two different documents. So the jug really is a 6 lb jug, the catalog's `1/5 LB` is " +
      "the stale side, and wave 4's own caveat is what turned out to be right: 'a zero spread is not " +
      "proof of fabrication — a manufactured jug fill really is constant'. Still SPEC — a label is a " +
      "label — but a label an invoice independently corroborates, which is the best evidence this arc " +
      "has produced for any pack.",
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

// ── The garlic reattribution: a conflict that dissolved ──────────────────────

/**
 * The first dry run presented a CONFLICT on `Garlic`: Juan's "garlic tub is 5 LB"
 * against wave 4's INVOICE_DERIVED 95.94 oz, with a tare hypothesis, a
 * beef-base precedent and a drain-and-weigh test to settle it. **None of that was
 * needed. He was looking at a garlic POWDER tub.**
 *
 * So there was never a reading about peeled garlic at all. The conflict did not
 * get RESOLVED — it was never real, and the difference matters: nothing about
 * wave 4's evidence changed, no ruling was overturned, and `Garlic` keeps its
 * 95.94 oz exactly as it was, still INVOICE_DERIVED, still Juan-ratified.
 *
 * **What survives.** Two things, and they are worth more than the conflict was.
 *
 * First, `BILLED_VS_NET_NOTE_CLASS` — minted to describe this conflict, and it
 * outlives it. It is a real phenomenon with a real precedent already in the repo
 * (beef base's glass jars), and the next brine- or ice-packed row will need it.
 *
 * Second, an OPEN QUESTION that never depended on Juan's reading in the first
 * place: wave 4 §A2 refused a gross invoice weight as a costing denominator at
 * 1.117x nominal because the excess was glass, and wave 4 §C accepted one at
 * 1.199x because its weight varied. Both calls are in the same wave. The spread
 * column distinguishes a measurement from a stored constant, but not NET product
 * from GROSS shipping weight — and peeled garlic ships in water. That tension is
 * a live question about garlic's denominator whatever anybody read off a lid, and
 * it is recorded here rather than closed, because this wave has no evidence
 * bearing on it either way.
 *
 * **The lesson worth keeping.** The first dry run built a careful argument on top
 * of an unverified assumption — that "garlic" meant the garlic SKU — and every
 * step above that assumption was sound and irrelevant. It is exactly why the row
 * was PRESENTED rather than written.
 */
export const GARLIC_REATTRIBUTION = {
  clarification: JUAN_CLARIFICATIONS.garlicReattribution,
  reattributedFrom: "Garlic",
  reattributedTo: "Garlic Powder",
  /** Untouched, and this is the point. */
  garlicLivePackOz: 95.94,
  garlicLiveClass: "INVOICE_DERIVED" as WeightClass,
  dissolvedNotResolved:
    "The conflict was never real — no reading bears on peeled garlic. Wave 4's 95.94 oz stands untouched, " +
    "its ratification unchanged, and nothing was overturned. A conflict that dissolves is not a conflict " +
    "that was decided.",
  openQuestionSurviving:
    "Independent of any tub reading: wave 4 §A2 refused a GROSS invoice weight as a costing denominator at " +
    "1.117x nominal (beef base, the excess being glass) while wave 4 §C accepted one at 1.199x (garlic, on " +
    "the strength of a varying weight). The spread column distinguishes a measurement from a stored " +
    "constant but not NET product from GROSS shipping weight, and peeled garlic ships in water. Open, " +
    "unaffected by this wave, and evidence-free in both directions today.",
  noteClassSurvives: "BILLED_VS_NET_NOTE_CLASS, minted for this conflict, is kept for the next brine- or ice-packed row.",
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

// ── Stray shelf observations ─────────────────────────────────────────────────

/**
 * A thing Juan saw that this wave will not write, and will not throw away either.
 *
 * The reattribution left garlic powder with TWO sighted tubs: 6 LB and 5 LB. Only
 * one can be the pack, and 6 is the one with two documents behind it — the tub's
 * own label and Angel's `3/6 LB` catalog string agree on it, while 5 matches
 * neither that string nor the invoice's 6.624 lb/tub.
 *
 * The 5 lb sighting is most likely a SECOND TUB SIZE OR BRAND on the shelf, which
 * is an ordinary thing in a kitchen that buys from more than one place, and a
 * genuinely useful thing to know if true — it would make garlic powder the first
 * multi-pack-size SKU in the pantry.
 *
 * **It is recorded, not written, and not guessed at.** Inventing a second pack
 * level from one ambiguous sighting would put a number under every garlic-powder
 * recipe on the strength of a glance. Discarding it would lose the only evidence
 * anyone has that a second tub exists. A named unresolved observation is the
 * honest third option, and the unblock is one shelf glance.
 */
export interface StrayShelfObservation {
  spoken: string;
  lbs: number;
  skuName: string;
  /** Why this observation is not being written. */
  whyNotWritten: string;
  /** The one thing that would resolve it. */
  unblock: string;
}

export const STRAY_SHELF_OBSERVATIONS: readonly StrayShelfObservation[] = [
  {
    spoken: "garlic tub is 5 LB",
    lbs: 5,
    skuName: "Garlic Powder",
    whyNotWritten:
      "Reattributed to Garlic Powder by Juan on 2026-08-21, which leaves that SKU with two sighted tubs " +
      "(6 LB and 5 LB). 6 lb is written because the tub's label and Angel's `3/6 LB` catalog string agree " +
      "on it; 5 lb matches neither that string nor the invoice's 6.624 lb per tub, so it is evidence of " +
      "SOMETHING — most likely a second tub size or brand on the shelf — and not evidence of what this " +
      "SKU's pack is. Writing a second pack level off one ambiguous sighting would put an invented number " +
      "under every garlic-powder recipe.",
    unblock:
      "One shelf glance: are there two different garlic powder tubs out there, and if so what does the " +
      "smaller one's label say — brand, net weight, and is it the same product? If confirmed, garlic " +
      "powder becomes the pantry's first multi-pack-size SKU and needs its own decision about which pack " +
      "the par and the price are denominated in.",
  },
];

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
  | "UNRESOLVED_SIGHTING"
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
  UNRESOLVED_SIGHTING:
    "Something was seen that this wave will neither write nor discard. It is evidence of SOMETHING — most often a second pack size on the shelf — without being evidence of what a SKU's pack is. Recorded by name with the one glance that would settle it, because inventing a pack from an ambiguous sighting and throwing the sighting away are both worse.",
  PRICE_NEEDS_APPROVAL:
    "A price is newly derivable now that a pack exists, but pricing is not what a tub reading is evidence about. The arithmetic is done and put in a decision table for one approval.",
};
