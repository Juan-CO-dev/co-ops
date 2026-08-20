/**
 * Angel harvest WAVE 2 → vendor_price_history: the PURE arithmetic + classification.
 *
 * Zero I/O, like lib/angel-price-fill.ts (wave 1), which this module EXTENDS rather
 * than replaces: wave 1's `classify`, `DIVISION_RULES`, `computePackUnitPrice` and
 * `parseCsvLine` are imported and reused. scripts/seed/19-angel-fill-wave2.ts is the
 * only I/O shell around it.
 *
 * ── WHAT WAVE 2 ADDS THAT WAVE 1 COULD NOT DO ─────────────────────────────────
 * Wave 1 read `angel-product-catalog.csv`, which carried a pack STRING and a case
 * price. Wave 2 reads Claude Cowork's harvest (`docs/angel-products-rollup.csv`,
 * 159 products over 441 invoice lines), which adds two columns wave 1 never had:
 *
 *   lbs_per_unit   — the case weight, recovered algebraically as
 *                    line_total / price_per_lb / quantity
 *   weight_source  — whether that weight is REAL or fabricated
 *
 * The derivation was validated against a known ground truth (SALT KSHR COARSE:
 * derived 27.80 lb/case vs the product page's 27.75 — agreement to rounding), so
 * `lbs_per_unit` is real data when `weight_source = invoice_catch_weight`.
 *
 * That unlocks three things wave 1 refused for lack of a denominator:
 *   1. Delmar/Boar's Head catch-weight pricing (wave 1's single largest refusal,
 *      $20.6K of spend) — for the 8 products where Angel has a MEASURED weight.
 *   2. A re-sweep of wave 1's refusals against the newly-derived weights.
 *   3. A pack-string-vs-invoice-weight cross-check over wave 1's OWN division table,
 *      which is where the interesting findings turned out to be (see below).
 *
 * ── THE ONE RULE THAT GOVERNS EVERYTHING HERE ─────────────────────────────────
 * The harvest doc's §5 is explicit, and it is the opposite of the naive reading:
 *
 *   "co-ops' pack-chain derives weight structurally, and Angel's invoice weight is
 *    the 'ground truth' you'd normally defer to. This table shows you CAN'T blindly
 *    defer. Compute both, store both, and let disagreement be a SIGNAL rather than
 *    a resolution."
 *
 * So a measured weight is NOT a licence to fill. It is a second opinion. When it
 * agrees with our pack, confidence goes up and the row may be written; when it
 * disagrees materially, NEITHER side wins and the row becomes a question for Juan.
 * 18 of the 81 parseable pack strings diverge by >15%, so this is the common case,
 * not the exception.
 *
 * ── THE THREE TRAPS, ENCODED AS EXCLUSIONS ────────────────────────────────────
 * ASSUMED_WEIGHT      `weight_source = assumed_default_1lb` means the vendor feed
 *                     sent no weight and Angel silently substituted 1.000 lb/unit.
 *                     The `$/lb` on those rows is just the case price wearing a
 *                     $/lb label. This is the basil/cream trap: `BASIL FRSH`
 *                     [FRSH ADV] shows $10.34/lb against an assumed 1.0 lb while
 *                     the Peak Fresh row shows $13.48 against a MEASURED 1.4505 lb
 *                     — so Angel's own $/lb ranking of the two is upside-down.
 *                     Never derive anything from an assumed weight.
 * DROPPED_MULTIPLIER  The chive-shaker bug. Angel recorded the weight of ONE
 *                     shaker (1.12 oz) as the weight of the whole 6-pack case, so
 *                     the ratio is exactly 1/6 and the $/lb is 6× high ($138.86
 *                     against a true $23.14). This does NOT produce the
 *                     `$/lb == $/case` signature, so the assumed-weight detector
 *                     misses it entirely. `detectDroppedMultiplier` is the harvest's
 *                     own transferable rule, encoded.
 * MATERIAL_DISAGREEMENT
 *                     Everything else that diverges >15%: tare inclusion (glass
 *                     1.92×, bottles 1.17×), plainly wrong pack strings (the PFG
 *                     `1/5 LB → 6.00 lb` family), and genuine product variance
 *                     (herb bunches at 1.4–1.9×). Different causes, same handling:
 *                     report as CONFLICT, write nothing.
 *
 * ── CATCH WEIGHT: WHY $/lb IS THE STABLE NUMBER ───────────────────────────────
 * Delmar's deli meats are priced per POUND and shipped at a VARIABLE case weight.
 * London Broil's case ran 6.55–7.19 lb across the window — a 10% swing — while its
 * $/lb never moved off $8.69. So the case price is noise and the $/lb is signal,
 * which is why every fill in section 2 derives as `$/lb × our-pack-lb` and says so
 * in its source_note. Reading a case price off one invoice would bake that
 * invoice's particular weight into our cost forever.
 */

import {
  parseCsvLine,
  computePackUnitPrice,
  DIVISION_RULES,
  type DivisionRule,
} from "@/lib/angel-price-fill";

// ── Source rows ────────────────────────────────────────────────────────────────

/** One parsed row of docs/angel-products-rollup.csv (159 SKU-level rollups). */
export interface RollupRow {
  product: string;
  brand: string;
  manufacturer: string;
  vendor: string;
  packSize: string;
  purchaseLines: number | null;
  totalQty: number | null;
  totalSpend: number | null;
  latestPricePerLb: number | null;
  pplMin: number | null;
  pplMax: number | null;
  unitPriceMin: number | null;
  unitPriceMax: number | null;
  lbsPerUnitMin: number | null;
  lbsPerUnitMax: number | null;
  /** `invoice_catch_weight` | `assumed_default_1lb` | `unknown`. */
  weightSource: string;
  firstSeen: string;
  lastSeen: string;
}

function numOrNull(s: string | undefined): number | null {
  const t = (s ?? "").trim();
  if (t === "" || t === "—") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Parse the rollup CSV. Header-driven — column ORDER is never assumed. */
export function parseAngelRollup(csvText: string): RollupRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]!).map((h) => h.trim());
  const idx = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`parseAngelRollup: expected column "${name}" in the header, got: ${header.join(", ")}`);
    return i;
  };
  const c = {
    product: idx("product"), brand: idx("brand"), manufacturer: idx("manufacturer"),
    vendor: idx("vendor"), packSize: idx("pack_size"), purchaseLines: idx("purchase_lines"),
    totalQty: idx("total_qty"), totalSpend: idx("total_spend"), latestPpl: idx("latest_price_per_lb"),
    pplMin: idx("ppl_min"), pplMax: idx("ppl_max"), upMin: idx("unit_price_min"), upMax: idx("unit_price_max"),
    lbsMin: idx("lbs_per_unit_min"), lbsMax: idx("lbs_per_unit_max"), ws: idx("weight_source"),
    first: idx("first_seen"), last: idx("last_seen"),
  };
  return lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    const t = (i: number) => (f[i] ?? "").trim();
    return {
      product: t(c.product), brand: t(c.brand), manufacturer: t(c.manufacturer),
      vendor: t(c.vendor), packSize: t(c.packSize),
      purchaseLines: numOrNull(f[c.purchaseLines]), totalQty: numOrNull(f[c.totalQty]),
      totalSpend: numOrNull(f[c.totalSpend]), latestPricePerLb: numOrNull(f[c.latestPpl]),
      pplMin: numOrNull(f[c.pplMin]), pplMax: numOrNull(f[c.pplMax]),
      unitPriceMin: numOrNull(f[c.upMin]), unitPriceMax: numOrNull(f[c.upMax]),
      lbsPerUnitMin: numOrNull(f[c.lbsMin]), lbsPerUnitMax: numOrNull(f[c.lbsMax]),
      weightSource: t(c.ws), firstSeen: t(c.first), lastSeen: t(c.last),
    };
  });
}

/** Rollup identity, matching wave 1's `rowKey` shape so the two can be joined. */
export function rollupKey(r: { product: string; brand: string; vendor: string; packSize: string }): string {
  return [r.product, r.brand, r.vendor, r.packSize].map((s) => s.trim()).join(" | ");
}

/**
 * Angel's display date ("Aug 13, 2026") → an ISO date ("2026-08-13").
 *
 * Used for `effective_date`, which must be the day the price was OBSERVED, never
 * today — post-dating overstates how fresh a number is. Wave 1 stamped a single
 * export date on every row; the rollup carries a per-product `last_seen`, which is
 * strictly better provenance, so wave 2 uses it. Returns null on anything it does
 * not fully recognise rather than guessing a date.
 */
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
export function parseAngelDate(s: string): string | null {
  const m = /^([A-Za-z]{3,})\s+(\d{1,2}),\s*(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mon = MONTHS[m[1]!.slice(0, 3).toLowerCase()];
  if (!mon) return null;
  const day = Number(m[2]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return `${m[3]}-${mon}-${String(day).padStart(2, "0")}`;
}

// ── Weight-source classification ───────────────────────────────────────────────

export type WeightTrust = "MEASURED" | "ASSUMED" | "UNKNOWN";

/**
 * How much the row's weight may be relied on.
 *
 * Only `invoice_catch_weight` is MEASURED. `assumed_default_1lb` is the 1.0-lb
 * fabrication (never derive from it). `unknown` is Angel declining to supply a
 * weight at all — which the harvest notes is the HONEST failure mode: Cardinal
 * Bakery's row shows `—` rather than faking a number. UNKNOWN is therefore not a
 * disqualifier on its own; it simply means any relation must be established in
 * count-space instead of weight-space (which is exactly the Sub Roll case).
 */
export function classifyWeightSource(weightSource: string): WeightTrust {
  const w = weightSource.trim().toLowerCase();
  if (w === "invoice_catch_weight") return "MEASURED";
  if (w.startsWith("assumed")) return "ASSUMED";
  return "UNKNOWN";
}

// ── Pack-string vs invoice-weight cross-check ──────────────────────────────────

/**
 * actual ÷ nominal. > 1 means Angel weighed MORE than the pack string implies.
 * Null when either side is missing or non-positive (loudly-null, never a wrong
 * ratio).
 */
export function packVsActualRatio(actualOz: number | null, nominalOz: number | null): number | null {
  if (actualOz == null || nominalOz == null) return null;
  if (!Number.isFinite(actualOz) || !Number.isFinite(nominalOz)) return null;
  if (actualOz <= 0 || nominalOz <= 0) return null;
  return actualOz / nominalOz;
}

/** The harvest's threshold: 18 of 81 parseable pack strings diverge by more than this. */
export const DISAGREEMENT_TOLERANCE = 0.15;

/** True when the two weight opinions differ by more than the tolerance. */
export function isMaterialDisagreement(ratio: number | null, tolerance = DISAGREEMENT_TOLERANCE): boolean {
  if (ratio == null) return false;
  return Math.abs(ratio - 1) > tolerance;
}

/**
 * The harvest's dropped-multiplier detector, verbatim from §2:
 *
 *   "flag any line where invoice_net_weight / pack_chain_nominal_weight rounds to
 *    1/N for integer N >= 2. That's not a catch-weight wobble; that's a dropped
 *    multiplier."
 *
 * Returns N when the ratio is (close to) 1/N, else null. The chive shaker sits at
 * exactly 0.167 = 1/6: Angel stored one 1.12-oz shaker's weight as the weight of
 * the whole 6-pack, making its $/lb 6× too high. This failure mode is invisible to
 * the assumed-weight detector because it produces no `$/lb == $/case` signature,
 * which is precisely why it needs its own rule.
 *
 * The 2% relative window is tight enough that a genuine catch-weight wobble never
 * trips it (the widest real one in the dataset, London Broil, is 1.10×, nowhere
 * near any 1/N) and loose enough to survive the rounding in a derived weight.
 */
export function detectDroppedMultiplier(ratio: number | null, relTolerance = 0.02): number | null {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return null;
  const n = 1 / ratio;
  const nearest = Math.round(n);
  if (nearest < 2) return null;
  if (Math.abs(n - nearest) / nearest > relTolerance) return null;
  return nearest;
}

// ── Arithmetic ─────────────────────────────────────────────────────────────────

/**
 * A dollar amount → whole cents, decimal-exactly.
 *
 * `usd * 100` is NOT safe: `1.005 * 100` is 100.49999999999999 in IEEE-754 and
 * rounds DOWN, losing a cent. Scaling through the string/exponent form is
 * decimal-exact — this is the same guard wave 1 applies in computePackUnitPrice,
 * kept here because wave 2's count arithmetic needs cents as INTEGERS up front.
 */
export function centsFromUsd(usd: number): number {
  if (!Number.isFinite(usd)) throw new Error(`centsFromUsd: not a finite number: ${usd}`);
  return Math.round(Number(`${usd}e2`));
}

export interface CountScaledPrice {
  /** Price of one of OUR packs, in dollars, rounded to cents. */
  unitPrice: number;
  /** Angel units per one of our packs — the multiplier, as an exact rational. */
  ourUnitsPerAngelUnit: number;
  /** Cents before the final rounding, so the report can show the tie. */
  exactCents: number;
  /** True when rounding to cents moved the number. */
  rounded: boolean;
}

/**
 * Price of ONE OF OUR PACKS when the relation is established in COUNT-space.
 *
 * This is the Sub Roll path: Angel sells a 12-count of Large Hero Hearth at $7.87
 * and our pack chain says one flat holds 30 rolls, so our pack costs
 * 7.87 x 30 / 12. There is no weight anywhere in that sentence, and there must not
 * be — Angel supplies no weight for the Cardinal lane (it shows `—`, honestly), so
 * introducing one would be inventing the denominator that §C.3 of the
 * reconciliation report is a cautionary tale about.
 *
 * ── WHY INTEGER CENTS, AND NOT wave 1's divisor path ──────────────────────────
 * Wave 1 divides a DOLLAR price by a divisor. Reusing that here would compute
 * 7.87 / (12/30). Today's numbers survive it — that expression evaluates to
 * 19.675000000000000711, which rounds up to $19.68 correctly — so this is NOT a
 * live bug being fixed. It is a trap being closed before the next export walks
 * into it, because the dollar path is only accidentally right here.
 *
 * Change the price by a few cents at the SAME 12-to-30 ratio and it breaks: at
 * $8.19 the true value is 2047.5 cents = $20.48, but 8.19 / (12/30) floats to
 * 20.474999999999998 and rounds DOWN to $20.47. A scan of every cent price from
 * $5.00 to $30.00 across four plausible count ratios finds 530 such rows — every
 * one a half-cent tie the dollar path loses. Cardinal re-prices; that is a
 * question of when, not whether.
 *
 * So the whole computation runs in INTEGER cents — 787 x 30 = 23610 exactly, then
 * one final division by 12 = 1967.5, rounded half-up to 1968 = $19.68. The
 * arithmetic is exact until the last step, and the last step is the only place a
 * tie can arise. Half-up on a positive is JS `Math.round`'s own behaviour, so the
 * tie rule is explicit rather than emergent.
 *
 * Throws rather than emitting a nonsense price: a bad price is worse than none.
 */
export function scalePriceByCount(
  angelUnitPriceUsd: number,
  angelCountPerUnit: number,
  ourCountPerPack: number,
): CountScaledPrice {
  if (!Number.isFinite(angelUnitPriceUsd) || angelUnitPriceUsd <= 0) {
    throw new Error(`scalePriceByCount: angel unit price must be positive finite, got ${angelUnitPriceUsd}`);
  }
  if (!Number.isInteger(angelCountPerUnit) || angelCountPerUnit <= 0) {
    throw new Error(`scalePriceByCount: angel count must be a positive integer, got ${angelCountPerUnit}`);
  }
  if (!Number.isInteger(ourCountPerPack) || ourCountPerPack <= 0) {
    throw new Error(`scalePriceByCount: our count must be a positive integer, got ${ourCountPerPack}`);
  }
  const cents = centsFromUsd(angelUnitPriceUsd);
  const exactCents = (cents * ourCountPerPack) / angelCountPerUnit;
  const roundedCents = Math.round(exactCents);
  return {
    unitPrice: Number(`${roundedCents}e-2`),
    ourUnitsPerAngelUnit: ourCountPerPack / angelCountPerUnit,
    exactCents,
    rounded: roundedCents !== exactCents,
  };
}

export interface PerLbPrice {
  /** Price of one of OUR packs, in dollars, rounded to cents. */
  unitPrice: number;
  /** Our pack expressed in pounds — the multiplicand. */
  ourPackLb: number;
  /** The unrounded product, for the provenance note. */
  exact: number;
  rounded: boolean;
}

/**
 * Price of ONE OF OUR PACKS from a catch-weight $/lb.
 *
 * `$/lb x our-pack-lb`, and the direction matters: for a catch-weight product the
 * $/lb is the contract term and the case weight is what varies, so anchoring on
 * $/lb and multiplying by OUR pack's weight gives the cost of what WE hold. Reading
 * a case price off one invoice would freeze that invoice's particular case weight
 * into our cost — for London Broil that is a 10% error depending on which delivery
 * you happened to read.
 */
export function priceFromPerLb(pricePerLb: number, ourPackOz: number): PerLbPrice {
  if (!Number.isFinite(pricePerLb) || pricePerLb <= 0) {
    throw new Error(`priceFromPerLb: $/lb must be positive finite, got ${pricePerLb}`);
  }
  if (!Number.isFinite(ourPackOz) || ourPackOz <= 0) {
    throw new Error(`priceFromPerLb: our pack oz must be positive finite, got ${ourPackOz}`);
  }
  const ourPackLb = ourPackOz / 16;
  const exact = pricePerLb * ourPackLb;
  return {
    unitPrice: computePackUnitPrice(exact, 1),
    ourPackLb,
    exact,
    rounded: computePackUnitPrice(exact, 1) !== exact,
  };
}

// ── Section 1: Sub Roll → Cardinal Bakery ──────────────────────────────────────

/**
 * The Cardinal Bakery row, transcribed verbatim from the harvest.
 *
 * Juan confirmed the vendor fact (Sub Roll comes from Cardinal Bakery); Cowork
 * found the product. Angel shows NO `$/lb` for this row at all — the harvest's §4
 * calls that out as Angel behaving correctly, because Cardinal's feed supplies no
 * weight and Angel only fabricates 1.0 lb when the feed sends a quantity-shaped
 * field. So the relation here is count-only, and that is a feature: no assumed
 * weight can leak into it.
 */
export const CARDINAL_SUB_ROLL = {
  product: "Large Hero Hearth",
  vendor: "Cardinal Bakery",
  packSize: "12 ct",
  /** Rolls in one Angel pack — parsed from `12 ct` and asserted here so a change
   *  in the CSV cannot silently change the arithmetic. */
  countPerAngelPack: 12,
  unitPriceUsd: 7.87,
  observedDate: "Aug 13, 2026",
  qtyPurchased: 20,
  lineTotalUsd: 157.4,
  /** Our SKU, by name. Resolved to an id LIVE — never hardcoded. */
  ourSkuName: "Sub Roll",
} as const;

/**
 * `12 ct` → 12. Deliberately strict: only a bare integer followed by a count word.
 * Anything else returns null and the caller refuses, because a mis-parsed pack
 * count is a silently wrong price.
 */
export function parseCountPack(packSize: string): number | null {
  const m = /^(\d+)\s*(ct|count|ea|each|pk|pack)$/i.exec(packSize.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Section 2: Delmar / Boar's Head catch-weight map ───────────────────────────

/** How confident the Angel-product → our-SKU name match is. */
export type MatchConfidence = "DIRECT" | "INFERRED";

export interface DelmarCatchWeightRule {
  /** Angel product name, verbatim. */
  product: string;
  /** Our `vendor_items.name` under the Boar's Head vendor. */
  skuName: string;
  confidence: MatchConfidence;
  /** Why this pairing, in one line — printed in the dry run so Juan checks the
   *  MATCH, not just the arithmetic. */
  matchNote: string;
}

/**
 * The 8 Delmar products carrying a MEASURED catch weight, mapped to our SKUs.
 *
 * The other 19 Delmar rows are the 1.0-lb fabrication and are excluded by rule —
 * the split is exactly along product lines (sliced deli meat and cheese have real
 * weights; anything jarred, bucketed or canned does not), which is the shape of the
 * vendor feed rather than a coincidence.
 *
 * The reconciliation report's §A.2 established that Delmar == our Boar's Head lane
 * (two Delmar rows literally carry `brand = Boar's Head`; the 2024 costing sheet
 * uses vendor code `BH` for exactly this product set). Juan ruled on 2026-08-20:
 * register Delmar as the distributor, keep "Boar's Head" as the brand, and do NOT
 * re-point the 23 SKUs as a side-effect — so wave 2 prices the Boar's Head SKUs
 * where they live today. Prices key on `vendor_item_id`, so a later re-point does
 * not invalidate anything written here.
 *
 * Every pairing is re-verified against live `vendor_items` by the script; a name
 * that does not resolve is reported, never guessed at.
 */
export const DELMAR_CATCH_WEIGHT_RULES: readonly DelmarCatchWeightRule[] = [
  { product: "OVENGOLD TURKEY", skuName: "Turkey", confidence: "DIRECT", matchNote: "OvenGold is Boar's Head's turkey line; our only BH turkey SKU." },
  { product: "LONDON BROIL", skuName: "Roast Beef", confidence: "INFERRED", matchNote: "London Broil is a seasoned roast-beef cut, not a distinct species. The ONLY name-inference in this table — Juan should confirm this is our roast beef." },
  { product: "MILD PROVOLONE", skuName: "Provolone", confidence: "DIRECT", matchNote: "Our only BH provolone SKU." },
  { product: "DILANDRI GENOA SALAME", skuName: "Genoa", confidence: "DIRECT", matchNote: "DiLandri is the maker; Genoa is the product. Our only BH genoa SKU." },
  { product: "HOT BUTT CAPPY", skuName: "Capicola", confidence: "DIRECT", matchNote: "\"Cappy\" is the trade shorthand for capicola; \"hot butt\" is the cut+heat. Our only BH capicola SKU." },
  { product: "EVERROAST CHICKEN", skuName: "Ever Roast Chicken", confidence: "DIRECT", matchNote: "EverRoast is Boar's Head's chicken line; names match." },
  { product: "Pepperoni Slicing", skuName: "Pepperoni", confidence: "DIRECT", matchNote: "Our only BH pepperoni SKU." },
  { product: "IMP LAYER BACON 12/14", skuName: "Bacon", confidence: "DIRECT", matchNote: "Imported layer bacon, 12/14 slice count. Our only BH bacon SKU." },
];

// ── Refusal / conflict vocabulary ──────────────────────────────────────────────

export type Wave2Code =
  | "ASSUMED_WEIGHT"
  | "DROPPED_MULTIPLIER"
  | "MATERIAL_DISAGREEMENT"
  | "OUR_PACK_UNRESOLVABLE"
  | "SKU_UNRESOLVED"
  | "NO_MEASURED_WEIGHT"
  | "WAVE1_RULE_UNCHANGED";

export const WAVE2_REASONS: Record<Wave2Code, string> = {
  ASSUMED_WEIGHT:
    "Angel's weight is the fabricated 1.000 lb/unit default (weight_source = assumed_default_1lb), so its $/lb is the case price wearing a $/lb label. This is the basil/cream trap — deriving anything from it is exactly the PICKLES CHIPS $35.95/lb failure.",
  DROPPED_MULTIPLIER:
    "Angel's net weight is 1/N of the pack-string weight for integer N — it recorded ONE inner unit's weight as the whole case's. The Angel record is corrupt for this row; its $/lb is N times too high.",
  MATERIAL_DISAGREEMENT:
    "Angel's measured weight and our pack chain disagree by more than 15%. Per the harvest's §5, the disagreement is the SIGNAL and neither side wins automatically — this is a question for Juan, not a fill.",
  OUR_PACK_UNRESOLVABLE:
    "Our own SKU cannot say what one pack weighs: no pack chain, and the flat columns carry no each_size/each_measure. Angel's case weight cannot be related to a pack we cannot measure.",
  SKU_UNRESOLVED:
    "The SKU name did not resolve to exactly one active, global vendor_items row. A price written to the wrong twin is invisible, so this is never guessed at.",
  NO_MEASURED_WEIGHT:
    "Angel carries no measured weight for this row (weight_source is not invoice_catch_weight), and no count relation is available either.",
  WAVE1_RULE_UNCHANGED:
    "Wave 1 refused this row for a reason the harvest does not touch (US Foods historical lane, unresolved product identity, or a duplicate cluster needing Juan's pick). The new weight data changes nothing about it.",
};

// ── Section 3: the re-sweep over wave 1's own division table ───────────────────

/**
 * Whether a weight disagreement puts the PRICE in doubt, or only the WEIGHT.
 *
 * This distinction is the most useful thing wave 2 produces, and it is easy to get
 * backwards. Wave 1's arithmetic is `case price / divisor`, where the divisor is a
 * COUNT of our packs inside one Angel case, read off the pack string:
 *
 *   PACK_AGREES (divisor 1) — our pack IS one whole Angel case. We pay the case
 *     price for it. If Angel then weighs that case at 6.0 lb where the string said
 *     5.0, the PRICE we pay has not changed by a penny; what is wrong is our SKU's
 *     recorded pack WEIGHT, and therefore every derived cost-PER-OUNCE. Garlic is
 *     the live example: $19.72/pack stands, but 80 oz should be ~96 oz, so cost/oz
 *     is overstated by 20%.
 *
 *   CASE_MULTIPLE (divisor N>1) — our pack is one of N units inside the case, and
 *     N came from the same pack string the weight just contradicted. If the case
 *     really weighs 1.2x the string, either N is wrong or our pack oz is wrong, and
 *     there is no way to tell which from here. The DIVISOR is in doubt, so the
 *     price is too.
 *
 * Getting this backwards would either withhold good prices or propagate bad ones.
 */
export type ConflictImpact = "PRICE_IN_DOUBT" | "PACK_WEIGHT_ONLY";

export function conflictImpact(rule: DivisionRule): ConflictImpact {
  return rule.relation === "CASE_MULTIPLE" ? "PRICE_IN_DOUBT" : "PACK_WEIGHT_ONLY";
}

export interface ResweepFinding {
  rule: DivisionRule;
  rollup: RollupRow | null;
  /** Angel's measured case oz (midpoint of min/max), null when not measured. */
  measuredCaseOz: number | null;
  trust: WeightTrust;
  ratio: number | null;
  droppedMultiplierN: number | null;
  /** Set when the row is refused/flagged; null when nothing is wrong with it. */
  code: Wave2Code | null;
  impact: ConflictImpact | null;
  /** True when wave 1 listed this row among its 14 would-write fills. */
  wasWave1Fill: boolean;
}

/**
 * Cross-check ONE wave-1 division rule against the harvest's measured weight.
 *
 * Pure: the caller supplies the joined rollup row and whether wave 1 filled it.
 * Returns a finding with `code: null` when the two weight opinions AGREE — which is
 * the confirmation case and is worth reporting as loudly as a conflict, because it
 * is independent corroboration of wave 1's divisor.
 */
export function resweepRule(
  rule: DivisionRule,
  rollup: RollupRow | null,
  wasWave1Fill: boolean,
): ResweepFinding {
  const base = { rule, rollup, wasWave1Fill };
  if (!rollup) {
    return { ...base, measuredCaseOz: null, trust: "UNKNOWN", ratio: null, droppedMultiplierN: null, code: "NO_MEASURED_WEIGHT", impact: null };
  }
  const trust = classifyWeightSource(rollup.weightSource);
  const lo = rollup.lbsPerUnitMin;
  const hi = rollup.lbsPerUnitMax;
  const measuredCaseOz = lo != null && hi != null ? ((lo + hi) / 2) * 16 : null;

  if (trust === "ASSUMED") {
    return { ...base, measuredCaseOz, trust, ratio: null, droppedMultiplierN: null, code: "ASSUMED_WEIGHT", impact: null };
  }
  if (trust === "UNKNOWN" || measuredCaseOz == null) {
    return { ...base, measuredCaseOz, trust, ratio: null, droppedMultiplierN: null, code: "NO_MEASURED_WEIGHT", impact: null };
  }

  const ratio = packVsActualRatio(measuredCaseOz, rule.angelCaseOz);
  const dropped = detectDroppedMultiplier(ratio);
  if (dropped != null) {
    return { ...base, measuredCaseOz, trust, ratio, droppedMultiplierN: dropped, code: "DROPPED_MULTIPLIER", impact: "PRICE_IN_DOUBT" };
  }
  if (isMaterialDisagreement(ratio)) {
    return { ...base, measuredCaseOz, trust, ratio, droppedMultiplierN: null, code: "MATERIAL_DISAGREEMENT", impact: conflictImpact(rule) };
  }
  return { ...base, measuredCaseOz, trust, ratio, droppedMultiplierN: null, code: null, impact: null };
}

/** Run the cross-check over wave 1's whole division table. */
export function resweepAll(
  rollupByKey: Map<string, RollupRow>,
  wave1FillKeys: ReadonlySet<string>,
): ResweepFinding[] {
  return DIVISION_RULES.map((rule) => {
    const key = rollupKey({ product: rule.product, brand: rule.brand, vendor: rule.vendor, packSize: rule.packSizeRaw });
    return resweepRule(rule, rollupByKey.get(key) ?? null, wave1FillKeys.has(key));
  });
}

// ── Section 4: price movement ──────────────────────────────────────────────────

export interface PriceMovement {
  row: RollupRow;
  pplMin: number;
  pplMax: number;
  /** Fractional change, max over min. */
  changeFraction: number;
  spend: number;
}

/**
 * Rollup rows whose $/lb MOVED across the capture window, sorted by spend.
 *
 * $/lb rather than case price is the right lens, and for catch-weight products it
 * is the ONLY correct one: a case price that varies because the case weighed more
 * is not a price change. Pepperoni's case ran $17.79–$18.09 while its $/lb moved
 * only $5.09→$5.19 — most of that case-price spread is weight, not money.
 *
 * Rows whose weight is assumed or unknown are excluded outright: their "$/lb" is a
 * case price in disguise, so movement in it is not a per-pound signal at all.
 */
export function priceMovements(rows: readonly RollupRow[]): PriceMovement[] {
  const out: PriceMovement[] = [];
  for (const row of rows) {
    if (classifyWeightSource(row.weightSource) !== "MEASURED") continue;
    const { pplMin, pplMax } = row;
    if (pplMin == null || pplMax == null) continue;
    if (!(pplMin > 0) || !(pplMax > 0)) continue;
    if (Math.abs(pplMax - pplMin) < 1e-9) continue;
    out.push({ row, pplMin, pplMax, changeFraction: (pplMax - pplMin) / pplMin, spend: row.totalSpend ?? 0 });
  }
  return out.sort((a, b) => b.spend - a.spend);
}
