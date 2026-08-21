/**
 * Weight & trim audit — PURE core (zero I/O, no server imports, client-safe; the
 * `*-shared.ts` law, AGENTS.md). `lib/products-shared.ts` is the sibling template.
 *
 * JUAN'S RULING IS THE DESIGN CONSTRAINT, verbatim (spec 2026-08-20): "triggered on
 * demand. Behaves just like the regular audit to establish ground truth as needed."
 * NO clocks, NO due dates, NO gates — doctrine-identical to the inventory audit at
 * /operations/counts. Concretely, in this module:
 *
 *   - nothing calls Date.now(). `now` is an ARGUMENT, always, so the ranking is
 *     deterministic and testable and can never become a deadline;
 *   - nothing here computes "overdue", "due", or a next-weigh date. The output is a
 *     RANKED LIST — an ordering, not a schedule;
 *   - staleness is an INPUT to that ordering, never a threshold that trips.
 *
 * The board's three questions, three answers:
 *   - what does the system BELIEVE a thing weighs, and on what authority
 *     -> WeightBelief, carried straight off the persisted provenance columns (D10)
 *   - does what we OBSERVE agree with the standard we published
 *     -> observedTrimFromProduction + classifyWeightDrift (expectation vs measured,
 *        the count-variance philosophy applied to weights)
 *   - what is worth putting on a scale next
 *     -> rankWeightSuggestions (cost impact x staleness, blockers first)
 */

// ── What the system believes ─────────────────────────────────────────────────

/** Which layer a believed weight lives on. Three grains, one board. */
export type WeightSubjectKind = "sku" | "product" | "item";

/**
 * ONE weight the system believes, with everything needed to judge it.
 *
 * `valueOz` is nullable and a null is LOAD-BEARING: 124 of 164 active SKUs carry no
 * avg_oz_per_each, and the honest rendering of that is an absence, never a 0. Same
 * for every provenance field — `weight_established_by` is NULL on every seed-written
 * weight because the seeds audit with actorId null, so there is genuinely nobody to
 * name (0161's LOCK-1 doctrine: a sentinel would be a silent-wrong-number trap).
 */
export interface WeightBelief {
  subjectKind: WeightSubjectKind;
  subjectId: string;
  /** Display name — also the stable tiebreak, so the ordering is total. */
  name: string;
  /** The believed weight in ounces. NULL = never established (honest absence). */
  valueOz: number | null;
  /** What one `valueOz` is a weight OF — "each", "slice", "unit", "par unit". */
  unit: string;
  /** OPERATIONAL | SPEC | INVOICE_DERIVED (lib/angel-wave4.ts). Unconstrained text
   *  by design (0177's precedent) — the vocabulary is expected to grow. */
  weightClass: string | null;
  /** ISO instant the value was established. NULL = never, or never recorded. */
  establishedAt: string | null;
  /** users.id of whoever established it. NULL on every seed-written weight. */
  establishedBy: string | null;
  sourceNote: string | null;
  /** $/oz for this subject, or null when it cannot be priced. */
  costPerOz: number | null;
  /** Ounces of this subject flowing through the operation, or null when unknown. */
  usageOz: number | null;
  /**
   * This weight's absence is what stops the Phase-4 re-point: a multi-member product
   * with no unit_oz whose members disagree about what one unit weighs. A member flip
   * silently re-denominates every count-denominated line — the hazard
   * scripts/seed/18-twin-adjudication.ts refused its own pin-move over.
   */
  blocksRepoint: boolean;
}

// ── Observed trim (spec: expectation vs measured, drift is the signal) ────────

/**
 * The trim actually observed for one production run: `1 − (mass out ÷ mass in)`.
 *
 * NULL, never 0, whenever the question cannot honestly be asked — an unweighed prep
 * (six live preps carry no `oz_per_par_unit`), an unknown output count, or nothing
 * measurably going in. A 0 would assert "we observed zero loss", which is a
 * fabricated observation and the exact class of number the advisory-null law bans.
 *
 * A NEGATIVE result is RETURNED AS-IS and deliberately not clamped. A pan cannot
 * weigh more than what went into it, so a negative trim is a data bug — and the
 * board exists to surface data bugs, not to launder them. This is the same one-sided
 * reasoning behind `MASS_BALANCE_TOLERANCE` (lib/menu-costing-shared.ts), which
 * likewise only ever flags the impossible direction.
 *
 * NOTE ON AVAILABILITY: `productions` and `production_inputs` are both EMPTY live.
 * Until prep capture flows there is nothing to observe, and the board says so in
 * those words rather than rendering a zero.
 */
export function observedTrimFromProduction(input: {
  /** How many par-units the run declared it produced. */
  outputQty: number | null;
  /** items.oz_per_par_unit — what one of those par-units weighs. */
  ozPerParUnit: number | null;
  /** Σ production_inputs.input_oz — the SKU ounces that went in. */
  inputOz: number | null;
}): number | null {
  const { outputQty, ozPerParUnit, inputOz } = input;
  if (outputQty == null || !Number.isFinite(outputQty)) return null;
  if (ozPerParUnit == null || !Number.isFinite(ozPerParUnit)) return null;
  if (inputOz == null || !Number.isFinite(inputOz) || inputOz <= 0) return null;
  return 1 - (outputQty * ozPerParUnit) / inputOz;
}

/** How an observation sits against the published standard. */
export type WeightDriftClass = "agrees" | "over_trim" | "under_trim" | "no_reference";

/**
 * Standard trim (the expectation, `lib/trim-standards-shared.ts`) versus observed
 * trim (the measurement). Drift is the signal — the count-variance philosophy
 * applied to weights.
 *
 * `no_reference` when EITHER side is missing, and that is the day-one answer for
 * every row: production capture has produced zero rows, so nothing has been observed
 * yet. It is an honest "we cannot say", not a pass.
 *
 * A standard of 0 (VENDOR_PREPPED_NONE) is a VALUE, not an absence — the vendor did
 * the trimming and zero is the correct expectation. Treating it as missing would
 * drop the one class that can prove shrink where none should exist.
 */
export function classifyWeightDrift(input: {
  standardTrim: number | null;
  observedTrim: number | null;
  /** Half-width of the agreement band, as an absolute trim fraction. */
  tolerance: number;
}): WeightDriftClass {
  const { standardTrim, observedTrim, tolerance } = input;
  if (standardTrim == null || !Number.isFinite(standardTrim)) return "no_reference";
  if (observedTrim == null || !Number.isFinite(observedTrim)) return "no_reference";
  const band = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
  const delta = observedTrim - standardTrim;
  // The band is INCLUSIVE at its edge, and the epsilon is what makes that true in
  // binary: 0.40 − 0.38 evaluates to 0.020000000000000018, so a bare `<= 0.02`
  // would call a standard-vs-observation pair drift purely on float representation
  // noise. A classification must never turn on the last bit of a double.
  if (Math.abs(delta) <= band + 1e-9) return "agrees";
  return delta > 0 ? "over_trim" : "under_trim";
}

// ── The ranked suggestion list (SUGGESTS, never nags) ─────────────────────────

/**
 * Which band a suggestion sits in. Bands are the honest admission that these are
 * four DIFFERENT reasons to weigh something, and a single scalar score cannot order
 * across them without inventing an exchange rate between them.
 *
 *   blocks_repoint  the absence is blocking Phase 4's pin re-point outright
 *   never_measured  priced, and never put on a scale — no finite age is staler
 *   aging           priced and measured; ordered by cost impact x staleness
 *   unrankable      no cost basis, so it cannot be ranked — still weighable
 */
export type WeightSuggestionBand = "blocks_repoint" | "never_measured" | "aging" | "unrankable";

const BAND_ORDER: Readonly<Record<WeightSuggestionBand, number>> = {
  blocks_repoint: 0,
  never_measured: 1,
  aging: 2,
  unrankable: 3,
};

export interface WeightSuggestion {
  belief: WeightBelief;
  band: WeightSuggestionBand;
  /** costPerOz x usageOz — dollars flowing through this weight. NULL = no basis. */
  costImpact: number | null;
  /** Whole days since the value was established. NULL = never established. */
  stalenessDays: number | null;
  /** costImpact x (stalenessDays + 1). NULL wherever costImpact is. Ordering only. */
  score: number | null;
}

const MS_PER_DAY = 86_400_000;

/** Whole days from `at` to `now`, floored at 0. NULL for absent/unparseable — never
 *  `now`, and never a negative credit for a clock skew. */
function stalenessDays(at: string | null, nowMs: number): number | null {
  if (at == null) return null;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / MS_PER_DAY));
}

function costImpactOf(b: WeightBelief): number | null {
  if (b.costPerOz == null || !Number.isFinite(b.costPerOz)) return null;
  if (b.usageOz == null || !Number.isFinite(b.usageOz)) return null;
  return b.costPerOz * b.usageOz;
}

/**
 * What is worth putting on a scale next — ADVISORY, and only advisory.
 *
 * This function deliberately produces an ORDER and nothing else. It emits no date,
 * no deadline, no "due" flag and no count anybody could hang a red badge off. Juan
 * ruled the audit is a tool you reach for, not a clock that reaches for you, and the
 * surface that renders this list says "suggests" in its own header.
 *
 * The ordering is TOTAL and INDEPENDENT OF INPUT ROW ORDER: band, then the band's
 * own key, then name, then subjectId. Two callers holding the same beliefs in
 * different row order get the same list, which is the same discipline
 * `resolveProductMember` holds itself to.
 *
 * Every input comes back. A suggestion list that silently drops rows is a lie about
 * its own coverage — an unrankable weight is still weighable, so it lands last
 * rather than vanishing.
 */
export function rankWeightSuggestions(
  beliefs: ReadonlyArray<WeightBelief>,
  opts: { now: string | number },
): WeightSuggestion[] {
  const parsedNow = typeof opts.now === "number" ? opts.now : Date.parse(opts.now);
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : 0;

  const suggestions: WeightSuggestion[] = beliefs.map((belief) => {
    const costImpact = costImpactOf(belief);
    const days = stalenessDays(belief.establishedAt, nowMs);
    const band: WeightSuggestionBand = belief.blocksRepoint
      ? "blocks_repoint"
      : costImpact == null
        ? "unrankable"
        : days == null
          ? "never_measured"
          : "aging";
    // +1 so a weight measured TODAY still carries its full cost impact — a fresh
    // measurement lowers a weight's rank, it does not zero it out of existence.
    const score = costImpact == null ? null : costImpact * ((days ?? 0) + 1);
    return { belief, band, costImpact, stalenessDays: days, score };
  });

  // Within a band, the key that orders it. blocks_repoint and never_measured order
  // on raw cost impact (staleness is already maxed or irrelevant); aging orders on
  // the product; unrankable has no key at all and falls through to the name.
  const bandKey = (s: WeightSuggestion): number => {
    switch (s.band) {
      case "blocks_repoint":
      case "never_measured":
        return s.costImpact ?? 0;
      case "aging":
        return s.score ?? 0;
      case "unrankable":
        return 0;
    }
  };

  return suggestions.sort((a, b) => {
    const bandDelta = BAND_ORDER[a.band] - BAND_ORDER[b.band];
    if (bandDelta !== 0) return bandDelta;
    const keyDelta = bandKey(b) - bandKey(a); // bigger impact first
    if (keyDelta !== 0) return keyDelta;
    const nameDelta = a.belief.name.localeCompare(b.belief.name);
    if (nameDelta !== 0) return nameDelta;
    return a.belief.subjectId.localeCompare(b.belief.subjectId);
  });
}
