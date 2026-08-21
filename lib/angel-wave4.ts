/**
 * Angel harvest WAVE 4 — the REFUSAL-RESOLUTION wave: pure arithmetic + policy.
 *
 * Zero I/O, like `lib/angel-price-fill.ts` (wave 1), `lib/angel-wave2.ts` (wave 2)
 * and `lib/angel-wave3.ts` (wave 3), all three of which this module EXTENDS rather
 * than replaces. `scripts/seed/21-angel-wave4.ts` is the only I/O shell around it.
 *
 * ── WHAT THIS WAVE IS ─────────────────────────────────────────────────────────
 * Waves 1–3 each ended with a ledger of things they REFUSED to write, and each
 * refusal named the one fact that would unblock it. Juan supplied those facts on
 * 2026-08-20. Wave 4 spends them. It discovers almost nothing new; it converts
 * standing questions into writes, and — just as importantly — it keeps refusing
 * the ones his rulings did not actually reach.
 *
 * ── THE DURABLE RULING THIS WAVE ADDS TO THE MODEL ────────────────────────────
 * Wave 3 split one column into two ideas: a portion's SPEC weight (what it should
 * be) versus its OPERATIONAL weight (what our line actually produces). Wave 4 adds
 * the third, and it is genuinely a third rather than a variant of either:
 *
 *   INVOICE_DERIVED — what the vendor actually delivered, averaged over every
 *                     invoice line we have. Not a label (SPEC) and not something
 *                     anyone put on a scale here (OPERATIONAL). It is the only
 *                     honest answer for a product whose pack weight is a RANGE
 *                     rather than a number: fresh herbs arrive in bunches and the
 *                     box holds whatever it holds.
 *
 * The three are not ranked. They answer different questions, and which one a
 * column should carry depends on who determines the quantity — the label printer,
 * our slicer, or the grower. Keeping them distinct is what lets the queued
 * weight-audit design tell a measured number from an inferred one without
 * re-deriving the distinction from scratch.
 *
 * ── AMENDED 2026-08-21 BY JUAN'S ESTIMATE-CLASS RULING ────────────────────────
 * A FOURTH member, `ESTIMATE`, is minted. It is the one the first three could not
 * cover, and seed 26's Phase-6a backfill stopped dead on the gap: 35 SKUs carry a
 * weight and an audit row, and that row says `estimate: true` with no class —
 * seed 10's own words, "my best food-knowledge inference pending Juan's scale".
 *
 * That is not OPERATIONAL (nobody weighed it), not SPEC (no label or pack
 * arithmetic produced it) and not INVOICE_DERIVED (no delivery average behind it).
 * Rather than stretch one of the three — the exact defect the spec-vs-operational
 * split existed to repair — the vocabulary grows by one honest term.
 *
 * **AND THE FOURTH ONE IS RANKED, WHICH THE FIRST THREE ARE NOT.** The sentence
 * above ("the three are not ranked") still holds for the three, and it holds for a
 * reason: they answer different questions. ESTIMATE does not answer a fourth
 * question — it answers the SAME question as the others with NO evidence behind
 * it. So it sits strictly below all of them, and `WEIGHT_CLASS_RANK` says so in a
 * form code can read rather than only prose a human can.
 *
 * NOT TO BE CONFUSED WITH `OPERATIONAL_ESTIMATE` (`lib/trim-standards-shared.ts`),
 * which is a `TrimEvidence` value, a DIFFERENT vocabulary describing how a TRIM
 * FRACTION was arrived at. The two never meet, and whether that one keeps its name
 * is a separate still-open question (docs/ROADMAP.md). This ruling does not reach
 * it, and nothing here touches it.
 */

import { parseCsvLine } from "@/lib/angel-price-fill";
import { classifyWeightSource } from "@/lib/angel-wave2";

// ── The weight-class enum, extended ────────────────────────────────────────────

/**
 * Where a weight number CAME FROM. Rides in audit metadata as `weight_class` on
 * every weight-bearing write, waves 3 and 4 alike.
 *
 * Wave 3 minted the first two (`scripts/seed/20-angel-wave3.ts`, the `WeightWrite`
 * interface). Wave 4 adds the third rather than stretching either, because
 * stretching is how a column ends up meaning two things again — the exact defect
 * Juan's spec-vs-operational ruling existed to repair.
 */
export type WeightClass = "OPERATIONAL" | "SPEC" | "INVOICE_DERIVED" | "ESTIMATE";

export const WEIGHT_CLASS_MEANING: Readonly<Record<WeightClass, string>> = {
  OPERATIONAL:
    "Observed here, or set by whoever actually produces the portion. Juan's surprise 3-sample slice averages are the canonical case; a vendor's own spec counts too when the vendor does the portioning and we do not (bacon's 12/14 layer box).",
  SPEC:
    "Derived from a label, a pack string or an arithmetic identity, and awaiting a scale. A placeholder, not a peer of a measured value — wave 3 established that spec and operational diverge by -20% to -60% on every deli item Juan has actually weighed.",
  INVOICE_DERIVED:
    "The average of what the vendor actually delivered, across every invoice line in the capture window. Neither a label nor a local measurement. This is the right class when the pack weight is genuinely a RANGE — bunch and catch-weight produce — because there is no single true number to measure, only a distribution to summarise. Refreshed as new invoices land.",
  ESTIMATE:
    "An EDUCATED GUESS. Nobody weighed it, no label states it, no invoice averages it — somebody who knows food reasoned a plausible number so a downstream calculation could run at all, and said out loud that that is what they were doing. Explicitly ranked BELOW every measured class (see WEIGHT_CLASS_RANK): it is not a peer of the other three, it is what a row carries until one of them can replace it. Ratified by Juan 2026-08-21 for seed 10's `estimate: true` fills. It is claimed only where the evidence SAYS so — never inferred from a value, because a number cannot tell you whether somebody weighed it or guessed it, and that distinction is the entire reason the class exists.",
};

/**
 * How much a class rests on. THREE TIERS, and the tiers are the ruling:
 *
 *   2  MEASURED    somebody's scale produced this. OPERATIONAL is ours;
 *                  INVOICE_DERIVED is the vendor's, averaged over real deliveries.
 *                  Different scales, same standing — which is why they SHARE a
 *                  rank rather than being ordered against each other. Ordering
 *                  them would assert a preference nobody ruled.
 *   1  DOCUMENTED  SPEC. A label or a pack identity states it. Real evidence, but
 *                  nothing was ever put on a scale — wave 3 measured that gap at
 *                  -20% to -60% on every deli item Juan has actually weighed.
 *   0  GUESSED     ESTIMATE. No scale, no document. Juan's 2026-08-21 ruling put
 *                  it here: below the measured classes, and below SPEC too, but
 *                  emphatically above a blank column — a named guess you can
 *                  argue with beats a number with no story at all.
 *
 * A NULL class has NO RANK and is deliberately absent from this table. "We believe
 * a number and cannot say why" is not a tier, it is the absence of one, and
 * handing callers a 0 for it would quietly equate an unexplained number with an
 * honestly-labelled guess. Every predicate below takes the null explicitly.
 */
export const MEASURED_FLOOR = 2;

export const WEIGHT_CLASS_RANK: Readonly<Record<WeightClass, number>> = {
  OPERATIONAL: 2,
  INVOICE_DERIVED: 2,
  SPEC: 1,
  ESTIMATE: 0,
};

/**
 * Has a scale ever produced this number? OPERATIONAL and INVOICE_DERIVED yes;
 * SPEC and ESTIMATE no.
 *
 * NULL answers `false`, and that is the conservative direction: an unexplained
 * number has not earned the claim "measured". Unknown strings answer `false` for
 * the same reason — the column is unconstrained text (0177's precedent) so the
 * vocabulary CAN grow, and a term this build has never heard of does not get the
 * benefit of the doubt.
 *
 * Callers that must distinguish "unclassed" from "classed but unmeasured" have to
 * check the null themselves; this predicate deliberately collapses them, because
 * for the question it answers they are the same answer.
 */
export function isMeasuredWeightClass(cls: string | null): boolean {
  if (cls == null) return false;
  const rank = WEIGHT_CLASS_RANK[cls as WeightClass];
  return rank != null && rank >= MEASURED_FLOOR;
}

/**
 * Juan's ruling, verbatim, because a ruling paraphrased into code is a ruling
 * nobody can audit — the same discipline as HERB_WEIGHT_POLICY above.
 */
export const ESTIMATE_CLASS_RATIFICATION =
  "Juan 2026-08-21: the ESTIMATE weight class is APPROVED. Seed 10's `estimate: true` fills are educated guesses and should say so, ranked below every measured class rather than left blank. This retires the gap seed 26's Phase-6a dry run stopped on.";

/**
 * Juan's fresh-herb / variable-catch weight policy, 2026-08-20 — verbatim, because
 * a policy paraphrased into code is a policy nobody can audit.
 *
 * The reasoning behind it is harvest 2's §2(b), which found that the fresh-herb
 * rows run 1.4–2.0x their pack string with no common factor (parsley 1.40, basil
 * 1.45, chives 1.60, thyme 2.00). That absence of a common factor is the whole
 * argument: a feed artifact is a CONSTANT multiplier, so a scattered ratio is
 * physical rather than clerical. For these products the pack string is a unit
 * SIZE and the box holds whatever it holds — so the invoice weight is the
 * trustworthy side and the pack string should be ignored.
 */
export const HERB_WEIGHT_POLICY =
  "Juan 2026-08-20: for fresh herbs and the variable-catch produce class, pack weight = the AVERAGE of the derived invoice weights, refreshed as new invoices land. The pack string is a unit size, not a content weight; the invoice is the measurement. Applies to basil, thyme, chives, parsley, garlic. The jug trio (oregano, onion powder, and the garlic pack WEIGHT) stays SCALE-GATED — that cluster is a separate question and one tub on a scale settles it.";

/**
 * The amendment, recorded rather than folded back into the ruling above.
 *
 * The first dry run found garlic caught between the policy's own two halves — named
 * in the variable class AND held by the jug-trio scale gate, with our `Garlic` SKU
 * resolving to the very row the gate covers. It reported the collision rather than
 * picking, and offered one fact nobody had: **garlic's per-tub weight varies across
 * deliveries (5.9935–6.0077 lb over 7 lines) while oregano's is byte-identical on
 * every invoice for three months.** Same 1.20x ratio, opposite fingerprints.
 *
 * Juan ratified that reading. So the gate narrows to what it was actually about —
 * the two JUGS, whose constant weight is evidence of a stored number rather than a
 * scale — and garlic joins the invoice-averaged class.
 *
 * The original text is kept verbatim above because a ruling edited in place is a
 * ruling nobody can audit. This is an amendment, and it reads like one.
 */
export const GARLIC_RATIFICATION =
  "Juan 2026-08-20 (amending the jug-trio carve-out): the invoice evidence is accepted — a weight that VARIES per delivery is a real weighing and a weight that never moves is a feed constant. Garlic is the produce tub, it varies, so it takes the INVOICE_DERIVED average like the other fresh produce. The scale gate now covers ONLY oregano and onion powder, whose weights are byte-identical on every invoice.";

/**
 * Juan's ruling on the Beef Base pack, which the first dry run tabled rather than
 * guessed at.
 *
 * The dry run refused to price it for two reasons: our SKU had no pack of any kind,
 * and PFG carries two competing beef-base rows that fail in opposite directions. It
 * put both questions in a table with a recommendation. He took the recommendation.
 *
 * Worth keeping the second half of that reasoning, because it is the part that
 * survives into the source_note: the naive `$9.34/lb x our pack` was rejected
 * BEFORE the row was picked, on the grounds that `priceFromPerLb` is for catch-weight
 * goods where $/lb is the contract term. Beef base is a manufactured fixed pack whose
 * contract term is the case price, and Angel's $/lb is case-price-over-GROSS-weight
 * because the 6.703 lb includes the glass.
 */
export const BEEF_BASE_RULING =
  "Juan 2026-08-20: Beef Base takes the jar model — the MINORS `BASE BEEF NO MSG` row, pack = 6 x 16 oz jars, unit_price = the $62.61 case price. The $/lb route is rejected: Angel's $9.34/lb is the case price over a GROSS weight that includes the glass jar (6.703 lb against a 6.0 lb nominal = 1.117x, the tare pattern harvest 2 §5 names for bottles), so multiplying it back by a nominal pack understates by 10.5%.";

/**
 * How the average is defined, pinned so a refresh is deterministic.
 *
 * Two readings of "average" are available and they are not the same computation:
 * the unweighted mean of each line's `lbs_per_unit`, or total pounds received
 * divided by total units received. The second is the value of record here, for two
 * reasons. It is the average weight of a box we ACTUALLY RECEIVED (a line covering
 * four boxes should count four times), and it divides raw totals rather than
 * per-line figures the CSV has already rounded to four places.
 *
 * On today's data the two agree to better than 0.01% on every SKU, so the choice
 * is not load-bearing yet — which is precisely why it is worth pinning now, while
 * nothing depends on it.
 */
export const AVERAGE_DEFINITION =
  "total net pounds received / total units received (quantity-weighted), over invoice lines whose weight_source is invoice_catch_weight";

// ── Source rows: docs/angel-purchase-history.csv ───────────────────────────────

/** One parsed invoice LINE of the harvest-1 purchase history (441 lines). */
export interface PurchaseRow {
  date: string;
  product: string;
  brand: string;
  manufacturer: string;
  vendor: string;
  packSize: string;
  quantity: number | null;
  unitPricePerCase: number | null;
  pricePerLb: number | null;
  netWeightLbs: number | null;
  lbsPerUnit: number | null;
  weightSource: string;
  lineTotal: number | null;
}

function numOrNull(s: string | undefined): number | null {
  const t = (s ?? "").trim();
  if (t === "" || t === "—") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Parse the purchase-history CSV. Header-driven — column ORDER is never assumed. */
export function parsePurchaseHistory(csvText: string): PurchaseRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]!).map((h) => h.trim());
  const idx = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`parsePurchaseHistory: expected column "${name}" in the header, got: ${header.join(", ")}`);
    return i;
  };
  const c = {
    date: idx("date"), product: idx("product"), brand: idx("brand"),
    manufacturer: idx("manufacturer"), vendor: idx("vendor"), packSize: idx("pack_size"),
    qty: idx("quantity"), unitPrice: idx("unit_price_per_case"), ppl: idx("price_per_lb"),
    net: idx("net_weight_lbs"), lbsPerUnit: idx("lbs_per_unit"), ws: idx("weight_source"),
    total: idx("line_total"),
  };
  return lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    const t = (i: number) => (f[i] ?? "").trim();
    return {
      date: t(c.date), product: t(c.product), brand: t(c.brand),
      manufacturer: t(c.manufacturer), vendor: t(c.vendor), packSize: t(c.packSize),
      quantity: numOrNull(f[c.qty]), unitPricePerCase: numOrNull(f[c.unitPrice]),
      pricePerLb: numOrNull(f[c.ppl]), netWeightLbs: numOrNull(f[c.net]),
      lbsPerUnit: numOrNull(f[c.lbsPerUnit]), weightSource: t(c.ws),
      lineTotal: numOrNull(f[c.total]),
    };
  });
}

/**
 * Identity of a purchase LINE's product, matching wave 1's `rowKey` and wave 2's
 * `rollupKey` shape so all three tables join.
 *
 * Product name alone is emphatically not unique here — `BASIL FRSH` appears under
 * two brands with the SAME `1/1 LB` pack string, and one of them is the fabricated
 * weight. Keying on the name would silently blend a real measurement with a
 * fabrication and average them.
 */
export function purchaseRowKey(r: { product: string; brand: string; vendor: string; packSize: string }): string {
  return [r.product, r.brand, r.vendor, r.packSize].map((s) => s.trim()).join(" | ");
}

// ── The invoice-average engine ─────────────────────────────────────────────────

export interface InvoiceAverage {
  /** Invoice LINES that contributed. */
  lines: number;
  /** Units (boxes/tubs) received across those lines. */
  units: number;
  totalLbs: number;
  /** total lbs / total units — THE value of record (see AVERAGE_DEFINITION). */
  meanLbs: number;
  /** Unweighted mean of each line's `lbs_per_unit`, reported as a cross-check. */
  meanUnweightedLbs: number;
  minLbs: number;
  maxLbs: number;
  /**
   * (max - min) / mean.
   *
   * Read this as the fingerprint question: **did anything actually get weighed?**
   * A per-delivery weight that varies is a scale reporting; a per-delivery weight
   * that is byte-identical across months is a stored constant wearing a
   * measurement's clothes. It is the one statistic here that distinguishes the
   * two, and on this dataset it separates the produce rows from the jug rows even
   * though their nominal-vs-measured RATIOS are the same 1.20.
   */
  spreadFraction: number;
  /** Lines skipped because their weight is Angel's fabricated 1.0 lb (or unknown). */
  excludedNonMeasured: number;
}

/**
 * Average pack weight from invoice lines — the function Juan's policy names.
 *
 * ── THE EXCLUSION IS THE LOAD-BEARING PART ────────────────────────────────────
 * Lines whose `weight_source` is not `invoice_catch_weight` are dropped before any
 * arithmetic happens. That is not hygiene, it is the whole safety property: Angel
 * substitutes a fabricated 1.000 lb/unit when a vendor feed sends no weight, and
 * `BASIL FRSH` [FRSH ADV] is exactly that — 7 lines, every one of them 1.0 x
 * quantity, sitting beside a genuinely-measured sibling with an IDENTICAL `1/1 LB`
 * pack string. Averaging the two together would produce a number that is neither,
 * and nothing about the inputs would look wrong.
 *
 * Returns null rather than a number when nothing measured survives, so the caller
 * refuses instead of writing a confident zero.
 */
export function invoiceAverageLbs(rows: readonly PurchaseRow[]): InvoiceAverage | null {
  let excludedNonMeasured = 0;
  const usable: Array<{ lbsPerUnit: number; quantity: number; netWeightLbs: number }> = [];
  for (const r of rows) {
    if (classifyWeightSource(r.weightSource) !== "MEASURED") {
      excludedNonMeasured++;
      continue;
    }
    const { lbsPerUnit, quantity, netWeightLbs } = r;
    if (lbsPerUnit == null || quantity == null || netWeightLbs == null) {
      excludedNonMeasured++;
      continue;
    }
    if (!(lbsPerUnit > 0) || !(quantity > 0) || !(netWeightLbs > 0)) {
      excludedNonMeasured++;
      continue;
    }
    usable.push({ lbsPerUnit, quantity, netWeightLbs });
  }
  if (usable.length === 0) return null;

  const units = usable.reduce((a, r) => a + r.quantity, 0);
  const totalLbs = usable.reduce((a, r) => a + r.netWeightLbs, 0);
  if (!(units > 0) || !(totalLbs > 0)) return null;

  const meanLbs = totalLbs / units;
  const meanUnweightedLbs = usable.reduce((a, r) => a + r.lbsPerUnit, 0) / usable.length;
  const perUnit = usable.map((r) => r.lbsPerUnit);
  const minLbs = Math.min(...perUnit);
  const maxLbs = Math.max(...perUnit);

  return {
    lines: usable.length,
    units,
    totalLbs,
    meanLbs,
    meanUnweightedLbs,
    minLbs,
    maxLbs,
    spreadFraction: (maxLbs - minLbs) / meanLbs,
    excludedNonMeasured,
  };
}

/**
 * The spread at or below which a "measured" weight should be read as a stored
 * constant rather than a scale reading. **It is exactly zero, and that is the
 * point** — not a tolerance anyone tuned.
 *
 * The question this answers is binary: *did this number ever move?* A weight that
 * moved by 0.07% across four deliveries DID move, and a tolerance loose enough to
 * call that "constant" would erase the only signal available. Basil sits at
 * 6.9e-4 and parsley at 3.6e-4 — both tiny, both real. Oregano and fresh chives
 * sit at exactly 0 across three and seven lines respectively, which is a different
 * kind of fact entirely.
 *
 * Note what this does NOT establish. A zero spread does not prove a number is
 * fabricated — a manufactured jug fill really is constant, and a supplier really
 * can ship 0.81 lb of chives every single week. It proves only that no evidence of
 * weighing is present, which is exactly the state in which a scale is worth 90
 * seconds. And a nonzero spread over a SINGLE line is not evidence of anything, so
 * callers must check the line count before reading this at all.
 */
export const CONSTANT_WEIGHT_SPREAD_CEILING = 0;

// ── Pack premise ───────────────────────────────────────────────────────────────

/**
 * Juan's policy says "pack weight = the average of the invoice weights". That
 * sentence contains a hidden premise: **that one of our packs IS one Angel unit.**
 * Where it holds, the write is a clean nominal → measured correction. Where it does
 * not, the average has to be divided by something, and that something came from the
 * very pack string the measurement just contradicted.
 *
 * This is wave 2's `conflictImpact` distinction arriving from the other direction,
 * and it is the same conclusion: a divisor derived from a falsified pack string
 * puts the PRICE in doubt too, so the row stops.
 */
export type PackPremise =
  /** Our pack is one Angel unit — the average applies directly. */
  | "OUR_PACK_IS_THE_ANGEL_UNIT"
  /** Our pack is 1/N of an Angel unit — N came from the contradicted pack string. */
  | "OUR_PACK_IS_A_FRACTION"
  /** Neither: the two packs are not in a whole relation at all. */
  | "PREMISE_BROKEN";

export function classifyPackPremise(
  ourPackOz: number | null,
  angelNominalOz: number | null,
  tolerance = 0.02,
): PackPremise {
  if (ourPackOz == null || angelNominalOz == null) return "PREMISE_BROKEN";
  if (!Number.isFinite(ourPackOz) || !Number.isFinite(angelNominalOz)) return "PREMISE_BROKEN";
  if (ourPackOz <= 0 || angelNominalOz <= 0) return "PREMISE_BROKEN";
  const ratio = angelNominalOz / ourPackOz;
  if (Math.abs(ratio - 1) <= tolerance) return "OUR_PACK_IS_THE_ANGEL_UNIT";
  const nearest = Math.round(ratio);
  if (nearest >= 2 && Math.abs(ratio - nearest) / nearest <= tolerance) return "OUR_PACK_IS_A_FRACTION";
  return "PREMISE_BROKEN";
}

/** Pounds → ounces, rounded to `dp` places without inventing precision. */
export function lbsToPackOz(lbs: number, dp = 2): number {
  if (!Number.isFinite(lbs) || lbs <= 0) throw new Error(`lbsToPackOz: expected positive finite lbs, got ${lbs}`);
  return Number((lbs * 16).toFixed(dp));
}

// ── Section C: the variable-catch class ────────────────────────────────────────

export interface VariableCatchRule {
  /** Angel row identity — product + brand + vendor + pack string, all four. */
  product: string;
  brand: string;
  vendor: string;
  packSizeRaw: string;
  /** Our `vendor_items.name`, resolved to an id LIVE. */
  skuName: string;
  expectVendor: string;
  /** Our pack's ounces as wave 1's division table records them. Asserted live. */
  ourPackOzExpected: number;
  /** The pack string's nominal ounces — what our pack was authored from. */
  angelNominalOz: number;
  /** Angel's latest case price. Used only where the premise holds. */
  latestCasePriceUsd: number;
  /** Angel's per-product `last_seen`, for `effective_date`. */
  lastSeen: string;
  /**
   * True for the members of the 1.20x cluster Juan's ruling explicitly holds back
   * for a scale. Reported with the arithmetic done, never written.
   */
  scaleGated: boolean;
  note: string;
}

/**
 * The five SKUs Juan's herb policy names — and the two of them it does not
 * actually reach, which is the more interesting half.
 *
 * ── THE GARLIC COLLISION, STATED PLAINLY ──────────────────────────────────────
 * The ruling lists garlic among the variable class AND holds the garlic pack
 * weight back for a scale. Both cannot apply to one row, and our `Garlic` SKU
 * resolves to exactly one Angel row (`GARLIC WHL PLD DOM`, the 5 lb produce tub),
 * so the collision is real rather than a naming mix-up. It is left unwritten and
 * put to Juan, because the two readings differ by 17% of garlic's cost per ounce
 * and there is no way to pick from here.
 *
 * What wave 4 CAN add to that decision is one fact nobody had: garlic's per-tub
 * weight VARIES across deliveries (5.9935–6.0077 lb over 7 lines) while oregano's
 * and onion powder's are byte-identical on every invoice (6.001, 6.002). Same
 * 1.20x ratio, opposite fingerprints. That is evidence the tub is genuinely being
 * weighed and the jugs are not — but it is evidence for a decision, not a licence
 * to take one.
 */
export const VARIABLE_CATCH_RULES: readonly VariableCatchRule[] = [
  {
    product: "BASIL FRSH", brand: "PEAK FRS", vendor: "PFG", packSizeRaw: "1/1 LB",
    skuName: "Basil", expectVendor: "PFG",
    ourPackOzExpected: 16, angelNominalOz: 16,
    latestCasePriceUsd: 20.25, lastSeen: "Aug 14, 2026",
    scaleGated: false,
    note: "The REAL basil row. Its fabricated-weight sibling [FRSH ADV] carries an identical `1/1 LB` pack string and is excluded by weight_source, not by name — see BASIL_DUPLICATE_CLUSTER.",
  },
  {
    product: "THYME FRSH", brand: "PEAK FRS", vendor: "PFG", packSizeRaw: "1/4 OZ",
    skuName: "Thyme", expectVendor: "PFG",
    ourPackOzExpected: 4, angelNominalOz: 4,
    latestCasePriceUsd: 16.54, lastSeen: "Aug 7, 2026",
    scaleGated: false,
    note: "ONE invoice line in the whole window. The policy still applies — an average of one is that one — but it is an average with no spread to inspect, so it is the row most likely to move when the next thyme invoice lands.",
  },
  {
    product: "PARSLEY FRSH FLAT ITAL", brand: "PEAK FRS", vendor: "PFG", packSizeRaw: "1/1 LB",
    skuName: "Parsley", expectVendor: "PFG",
    ourPackOzExpected: 16, angelNominalOz: 16,
    latestCasePriceUsd: 15.20, lastSeen: "Aug 7, 2026",
    scaleGated: false,
    note: "Wave 3's PENDING_RECHECKS listed parsley as awaiting exactly this ruling: its price was never in doubt (divisor 1), only its pack weight. The policy settles it.",
  },
  {
    product: "CHIVES FRSH", brand: "PEAK FRS", vendor: "PFG", packSizeRaw: "1/8 OZ",
    skuName: "Chives", expectVendor: "PFG",
    ourPackOzExpected: 4, angelNominalOz: 8,
    latestCasePriceUsd: 17.88, lastSeen: "Aug 14, 2026",
    scaleGated: false,
    note: "Our pack is HALF an Angel unit (wave 1 records it as CASE_MULTIPLE, divisor 2) — so the policy's premise does not hold and the average cannot be applied directly. Note this is the FRESH chive, a different product from the `Dried Chives` SKU section A binds to US Foods.",
  },
  {
    product: "GARLIC WHL PLD DOM", brand: "PEAK FRS", vendor: "PFG", packSizeRaw: "1/5 LB",
    skuName: "Garlic", expectVendor: "PFG",
    ourPackOzExpected: 80, angelNominalOz: 80,
    latestCasePriceUsd: 19.72, lastSeen: "Aug 14, 2026",
    scaleGated: false,
    note: "RATIFIED. The first dry run held this row because the herb policy and the jug-trio scale gate both landed on it. Juan accepted the fingerprint argument: garlic's per-tub weight VARIES across deliveries (5.9935-6.0077 lb over 7 lines) where the jugs' never moves, so the tub is genuinely weighed and takes the invoice average. The scale gate narrows to oregano + onion powder. See GARLIC_RATIFICATION.",
  },
];

/**
 * The three Angel rows that all claim to be our `Basil`, and how the duplicate is
 * resolved WITHOUT anyone having to eyeball a name.
 *
 * Harvest 2's §2(c) is blunt about why this one is dangerous: because the pack
 * string genuinely IS `1 LB`, a fabricated 1.0 lb is indistinguishable from a
 * correct 1.0 lb by inspection. The only reason the fabrication was ever caught is
 * that a sibling SKU with the identical pack string measured 1.45. `weight_source`
 * catches it with no sibling needed, which is the transferable lesson — and it is
 * why the resolution below is a filter rather than a judgement call.
 */
export interface BasilCandidate {
  product: string;
  brand: string;
  vendor: string;
  packSizeRaw: string;
  casePriceUsd: number;
  weightSource: string;
  verdict: "USE" | "REJECT";
  why: string;
}

export const BASIL_DUPLICATE_CLUSTER: readonly BasilCandidate[] = [
  {
    product: "BASIL FRSH", brand: "PEAK FRS", vendor: "PFG", packSizeRaw: "1/1 LB",
    casePriceUsd: 20.25, weightSource: "invoice_catch_weight", verdict: "USE",
    why: "The only basil row in Angel with a real weight. 4 invoice lines, 1.4495-1.4505 lb/box — a narrow but non-zero spread, which is what a weighed bunch product looks like.",
  },
  {
    product: "BASIL FRSH", brand: "FRSH ADV", vendor: "PFG", packSizeRaw: "1/1 LB",
    casePriceUsd: 10.34, weightSource: "assumed_default_1lb", verdict: "REJECT",
    why: "Net weight is EXACTLY 1.0 x quantity on all 7 lines — Angel's fabrication, not a measurement. Its $10.34/lb is a case price wearing a $/lb label, which is why Angel ranks it as the mid-priced basil when it is very likely the cheapest. Pricing our pack from it would be the PICKLES CHIPS failure with better camouflage.",
  },
  {
    product: "Basil, Fresh Herb", brand: "Cross Valley Farms", vendor: "US Foods", packSizeRaw: "1 LB",
    casePriceUsd: 16.08, weightSource: "assumed_default_1lb", verdict: "REJECT",
    why: "Same 1.000 signature, and additionally on the US Foods lane we migrated away from. Two independent reasons to leave it.",
  },
];

// ── Section A: the four vendor bindings ────────────────────────────────────────

export interface VendorBinding {
  /** Our `vendor_items.name`. Resolved to an id LIVE. */
  skuName: string;
  /** The vendor Juan named. Resolved to an id LIVE — never hardcoded. */
  vendorName: string;
  /** The Angel row that evidences it, or null when Angel has never seen this product. */
  angelProduct: string | null;
  ruling: string;
  evidence: string;
  /** Whether a price is even in scope for this binding. */
  priceIntent: "PRICE_FROM_ANGEL" | "BIND_ONLY";
  whyBindOnly: string | null;
}

/**
 * Juan's four bindings, 2026-08-20. Every one of them was a `vendor unknown` row
 * in wave 2's decision table; three confirm wave 2's guess and one overrides it.
 *
 * The override is worth naming: wave 2 guessed `Baldor (or PFG)` for Dried Chives
 * at LOW confidence, off a two-year-old costing sheet. Harvest 2 then found the
 * actual product on US Foods, and Juan has taken it. A LOW-confidence guess losing
 * to a found invoice is the system working as designed.
 */
export const VENDOR_BINDINGS: readonly VendorBinding[] = [
  {
    skuName: "Beef Base", vendorName: "PFG",
    angelProduct: "BASE BEEF NO MSG",
    ruling: "Juan 2026-08-20: Beef Base -> PFG, and the jar model — MINORS row, 6 x 16 oz jars, $62.61/case.",
    evidence: "PFG carries two beef-base rows in the window; wave 2 guessed PFG at HIGH confidence off the `BASE BEEF NO MSG JAR` line. The first dry run tabled WHICH row is the buy rather than guessing; Juan picked the MINORS row, so the pack and the price follow.",
    priceIntent: "PRICE_FROM_ANGEL",
    whyBindOnly: null,
  },
  {
    skuName: "Mortadella", vendorName: "Boar's Head",
    angelProduct: null,
    ruling: "Juan 2026-08-20: Mortadella -> Boar's Head. His note: no current sub uses mortadella — keep it anyway, a shelf for the future.",
    evidence: "Absent from Angel's 5-week window entirely, which is consistent with his note rather than in tension with it: a product nothing on the menu uses does not appear on a 5-week invoice run. Wave 2's HIGH-confidence read came from the 2024 costing sheet's `Mortadella, BH, $4.29 / 16 oz`.",
    priceIntent: "BIND_ONLY",
    whyBindOnly:
      "No Angel row exists, so there is no current price to derive. The 2024 sheet's $4.29/16 oz is two years old and is not written. The SKU already carries a complete 16 oz pack and a 1 oz slice weight, so the day a mortadella invoice does land it is priceable in one step.",
  },
  {
    skuName: "Utz Ripples", vendorName: "Country Snacks",
    angelProduct: null,
    ruling: "Juan 2026-08-20: Utz Ripples -> Country Snacks.",
    evidence: "Harvest 2 searched by name AND by class and found NO chips of any kind across all four Angel vendors — the only `CHIP` match in the whole account is `PICKLES CHIPS 1/4`. Chips are bought outside the distributor lane entirely, which is exactly what `Country Snacks` is for.",
    priceIntent: "BIND_ONLY",
    whyBindOnly:
      "Angel structurally cannot see this product, so no invoice-derived price exists or ever will. This SKU stays on the permanent supply-run list for PRICING even though its VENDOR is now settled — the two questions were always separable and this is the row that proves it.",
  },
  {
    skuName: "Dried Chives", vendorName: "US Foods",
    angelProduct: "Spice, Chive Chopped Plastic Shaker Shelf Stable Seasoning",
    ruling: "Juan 2026-08-20: Dried Chives -> US Foods.",
    evidence: "Harvest 2 §4 — the only dried-chive row in Angel, found by name AND class search. Monarch, 6/1.12 OZ, $9.72/case, 1 purchase Jul 17 2026. Overrides wave 2's LOW-confidence `Baldor (or PFG)` guess.",
    priceIntent: "PRICE_FROM_ANGEL",
    whyBindOnly: null,
  },
];

/**
 * The Dried Chives pack — wave 3's §E1 decision table, now being acted on.
 *
 * ── WHY THIS ONE GETS A PACK WHERE BEEF BASE DOES NOT ─────────────────────────
 * Both SKUs are packless, so on the face of it they should be handled the same
 * way. The difference is what Juan has actually seen. Wave 3 PUBLISHED this exact
 * pack — vendor, chain, content, unit_price and the resulting $/lb — as a five-row
 * table, and said in terms: "Approve that pack and the vendor binding plus the
 * price follow in one step." He then approved the item. Reading that as approval
 * of the tabled package is an INFERENCE, and it is flagged as one, exactly like
 * the Sysco-primary inference in section B. Beef Base has never had such a table
 * put in front of him, so wave 4 writes one instead of acting on one.
 *
 * The arithmetic is unchanged from wave 3 and closes from two directions:
 * 6 x 1.12 oz = 6.72 oz = 0.42 lb, and $9.72 / 0.42 lb = $23.14/lb, which is in
 * line with the other dried spices. Angel's own $138.86/lb is the dropped-x6 bug.
 */
export const DRIED_CHIVES_PACK = {
  skuName: "Dried Chives",
  expectVendor: "US Foods",
  angelProduct: "Spice, Chive Chopped Plastic Shaker Shelf Stable Seasoning",
  brand: "Monarch",
  packSizeRaw: "6/1.12 OZ",
  caseLabel: "case",
  shakerLabel: "shaker",
  shakersPerCase: 6,
  ozPerShaker: 1.12,
  casePriceUsd: 9.72,
  lastSeen: "Jul 17, 2026",
  angelStatedPricePerLb: 138.86,
  get caseOz(): number {
    return Number((DRIED_CHIVES_PACK.shakersPerCase * DRIED_CHIVES_PACK.ozPerShaker).toFixed(4));
  },
  get truePricePerLb(): number {
    return DRIED_CHIVES_PACK.casePriceUsd / (DRIED_CHIVES_PACK.caseOz / 16);
  },
} as const;

/**
 * The two PFG rows that both answer to "beef base", tabled rather than picked.
 *
 * Neither is clean, and they fail in opposite directions, which is why this needs
 * Juan rather than a tie-break rule:
 *
 *   MINORS  `6/1 LB` at $62.61 measures 6.703 lb against a 6.0 lb nominal — 1.117x,
 *           which is the glass-jar TARE signature harvest 2 §5 already names
 *           ("tare inclusion: glass 1.92x, bottles 1.17x"). So its $9.34/lb is
 *           case-price-over-gross-weight, and multiplying it back by a nominal
 *           pack UNDERSTATES by about 10%. The case price is the honest term.
 *   RDGCRST `1/1 LB` at $9.72 measures 6.943 lb against a 1.0 lb nominal — nearly
 *           7x, i.e. Angel has stored a case weight in a unit-weight field. Wave 2
 *           read this as "it is a 6-pack, not one jar".
 *
 * The reassuring part, and the reason this is a low-stakes question: both routes
 * land within 7% of each other per 1 lb jar ($10.44 vs $9.72). Whichever he picks,
 * beef base costs about ten dollars a jar.
 */
export interface BeefBaseCandidate {
  product: string;
  brand: string;
  packSizeRaw: string;
  casePriceUsd: number;
  angelPricePerLb: number;
  measuredLbsPerUnit: number;
  nominalLbs: number;
  purchaseLines: number;
  lastSeen: string;
  reading: string;
  impliedPerJarUsd: number;
}

/**
 * The Beef Base pack Juan ratified, and the arithmetic that justifies each half.
 *
 * ── WHY THE CASE PRICE AND NOT `$/lb x pack` ──────────────────────────────────
 * This is the part worth preserving, because it is a rule about a CLASS of product
 * rather than a fact about this one. `priceFromPerLb` (wave 2) exists for
 * catch-weight goods — Delmar's deli meats — where the $/lb is the contract term
 * and the delivered weight is what varies. Anchoring on $/lb there is right, and
 * reading a case price off one invoice would freeze that delivery's particular
 * weight into our cost forever.
 *
 * Beef base is the mirror image: a manufactured fixed pack where the CASE PRICE is
 * the contract term and the weight is incidental. And Angel's weight is worse than
 * incidental here — 6.703 lb against a 6.0 lb nominal is 1.117x, the glass/bottle
 * tare pattern harvest 2 §5 names explicitly. So Angel's $9.34/lb is
 * case-price-over-GROSS-weight, and multiplying it back by a 6.0 lb nominal pack
 * gives $56.04 against a true $62.61 — a 10.5% understatement, arrived at by an
 * arithmetic that looks more rigorous than the one it replaces.
 *
 * The 16 oz jar, not the 96 oz case, is the level that carries the measure: the
 * case's `6` is a COUNT of jars, which is what the pack string `6/1 LB` says.
 */
export const BEEF_BASE_PACK = {
  skuName: "Beef Base",
  expectVendor: "PFG",
  angelProduct: "BASE BEEF NO MSG",
  brand: "MINORS",
  packSizeRaw: "6/1 LB",
  caseLabel: "case",
  jarLabel: "jar",
  jarsPerCase: 6,
  ozPerJar: 16,
  casePriceUsd: 62.61,
  lastSeen: "Jul 24, 2026",
  /** Angel's derived $/lb — recorded as the number REJECTED, with the reason. */
  angelStatedPricePerLb: 9.34,
  angelMeasuredCaseLbs: 6.703,
  get caseOz(): number {
    return BEEF_BASE_PACK.jarsPerCase * BEEF_BASE_PACK.ozPerJar;
  },
  /** What the product really costs per pound of CONTENT (not of content+glass). */
  get contentPricePerLb(): number {
    return BEEF_BASE_PACK.casePriceUsd / (BEEF_BASE_PACK.caseOz / 16);
  },
  /** The rejected route's answer, kept so the gap is auditable rather than asserted. */
  get rejectedPerLbRouteUsd(): number {
    return BEEF_BASE_PACK.angelStatedPricePerLb * (BEEF_BASE_PACK.caseOz / 16);
  },
  get tareRatio(): number {
    return BEEF_BASE_PACK.angelMeasuredCaseLbs / (BEEF_BASE_PACK.caseOz / 16);
  },
} as const;

export const BEEF_BASE_CANDIDATES: readonly BeefBaseCandidate[] = [
  {
    product: "BASE BEEF NO MSG", brand: "MINORS", packSizeRaw: "6/1 LB",
    casePriceUsd: 62.61, angelPricePerLb: 9.34, measuredLbsPerUnit: 6.703, nominalLbs: 6.0,
    purchaseLines: 1, lastSeen: "Jul 24, 2026",
    reading: "A 6-pack of 1 lb jars. 6.703/6.0 = 1.117x = glass tare, so the 6.0 lb is the product and the case price is the contract term.",
    impliedPerJarUsd: 10.44,
  },
  {
    product: "BASE BEEF NO MSG JAR", brand: "RDGCRST", packSizeRaw: "1/1 LB",
    casePriceUsd: 9.72, angelPricePerLb: 1.40, measuredLbsPerUnit: 6.943, nominalLbs: 1.0,
    purchaseLines: 3, lastSeen: "Aug 14, 2026",
    reading: "Pack string says one 1 lb jar; the weight field says 6.943 lb. One of the two is wrong and Angel cannot say which. Bought 3x to MINORS' 1x, and more recently — so this may well be the actual buy.",
    impliedPerJarUsd: 9.72,
  },
];

// ── Section B: the lettuce pair ────────────────────────────────────────────────

/**
 * Lettuce — the pair seed 18 listed in `PENDING_PRODUCTS` and deliberately did not
 * touch, now adjudicated.
 *
 * ── HOW THIS PAIR DIFFERS FROM HAM, MECHANICALLY ──────────────────────────────
 * "Both-active, primary + backup like ham" describes the END state accurately and
 * the ROUTE not at all, and the difference decides which row gets written.
 *
 *   Ham        PFG primary INACTIVE, Baldor backup active -> seed 18 activates the
 *              PRIMARY. Its step-1 write is `.eq("active", false)` on the primary.
 *   Lettuce    Sysco primary ACTIVE, Baldor backup INACTIVE -> the missing row is
 *              the BACKUP. Seed 18 has no branch for this: at line 430 it emits a
 *              warning ("NOT written — out of adjudicated scope") and moves on.
 *
 * So wave 4 activates the backup, which is a write seed 18 cannot make, and it is
 * the only structural write in this section.
 *
 * ── AND THE PART THE RULING DOES NOT REACH ────────────────────────────────────
 * Ham's primary holds a par (weekday 3). Lettuce's primary holds NONE — neither
 * twin has ever had one. Both-active therefore does not make this pair orderable;
 * it makes it correctly-shaped and still parless. Seed 18's own words on inventing
 * one: "Refusing to invent one." Wave 4 refuses too, and says so where Juan will
 * see it rather than in a log nobody reads.
 */
export const LETTUCE_PAIR = {
  product: "Lettuce",
  primary: { expectName: "Lettuce", expectVendor: "Sysco" },
  backup: { expectName: "Lettuce", expectVendor: "Baldor" },
  /**
   * TRUE, and this is the flag the brief asked for. Juan ruled "both-active,
   * primary + backup like ham" without naming which twin is which. Sysco is the
   * inference: it is the one currently ACTIVE and the one carrying a pack chain
   * (box = 15 x 15 oz), while the Baldor row is inactive with no pack at all — the
   * same evidential shape that made every other Boar's Head/Baldor pair resolve
   * toward the active side. Veto-able in one word.
   */
  primaryIsInferred: true,
  primaryInferenceBasis:
    "Sysco is the currently-ACTIVE twin and the only one with a pack chain (box = 15 x 15 oz = 225 oz); the Baldor row is inactive, packless, priceless and pinless. Juan named the SHAPE, not the sides.",
  /** Both twins carry zero recipe pins, so no pin can move and none needs to. */
  expectZeroPins: true,
} as const;

/**
 * Every iceberg row Angel actually holds — and the finding, which is that NONE of
 * them is Sysco or Baldor.
 *
 * Our registry says our lettuce comes from Sysco or Baldor. Angel says every head
 * of iceberg bought in the five-week window came from PFG or US Foods, for
 * $3,230.74. Both statements can be true — the twins are the ORDERING lane and
 * Angel is the INVOICE lane, and a distributor swap that never reached the SKU
 * registry would look exactly like this — but they cannot both be complete.
 *
 * The consequence for this wave is narrow and worth stating precisely: **wave 4
 * cannot price lettuce at all.** Not "declines to"; cannot. There is no Angel row
 * attributable to either twin, so any price would be an attribution guess dressed
 * as arithmetic. What it can do is put the four candidate rows on the table with
 * their spend, because the biggest of them is a bigger line than most things this
 * arc HAS priced.
 */
export interface LettuceCandidate {
  product: string;
  brand: string;
  vendor: string;
  packSizeRaw: string;
  purchaseLines: number;
  totalSpendUsd: number;
  unitPriceMinUsd: number;
  unitPriceMaxUsd: number;
  lbsPerUnitMin: number;
  lbsPerUnitMax: number;
  note: string;
}

export const PFG_LETTUCE_CANDIDATES: readonly LettuceCandidate[] = [
  {
    product: "LETTUCE ICEBERG LINER", brand: "PEAK FRS", vendor: "PFG", packSizeRaw: "24/1 CT",
    purchaseLines: 5, totalSpendUsd: 1937.92, unitPriceMinUsd: 30.235, unitPriceMaxUsd: 32.985,
    lbsPerUnitMin: 41.726, lbsPerUnitMax: 42.2363,
    note: "The dominant row by a distance — 61 units, $1,937.92, and the one a new PFG/Lettuce SKU would most plausibly BE. A 24-count case at ~42 lb is ~1.75 lb per head, which reads like whole heads rather than the trimmed product.",
  },
  {
    product: "Lettuce, Iceberg Cleaned & Trimmed Fresh Ref", brand: "Cross Valley Farms", vendor: "US Foods", packSizeRaw: "4/6 EA",
    purchaseLines: 5, totalSpendUsd: 1050.15, unitPriceMinUsd: 35.49, unitPriceMaxUsd: 60.53,
    lbsPerUnitMin: 27.945, lbsPerUnitMax: 28.0231,
    note: "The single biggest PERCENTAGE price mover in the whole harvest ($1.27 -> $2.16/lb, +70.1%, wave 2 §4). Cleaned & trimmed, so a different product from the liner even though both are 'iceberg'. On the US Foods lane we migrated away from.",
  },
  {
    product: "LETTUCE ICEBERG C&T", brand: "PACKER", vendor: "PFG", packSizeRaw: "4/6 CT",
    purchaseLines: 3, totalSpendUsd: 140.61, unitPriceMinUsd: 46.87, unitPriceMaxUsd: 46.87,
    lbsPerUnitMin: 41.114, lbsPerUnitMax: 41.114,
    note: "PFG's own cleaned-&-trimmed line, and the direct competitor to the US Foods row above. Price never moved across 3 lines.",
  },
  {
    product: "LETTUCE CELLO ICEBERG CA", brand: "PACKER", vendor: "PFG", packSizeRaw: "1/24 CT",
    purchaseLines: 2, totalSpendUsd: 102.06, unitPriceMinUsd: 34.02, unitPriceMaxUsd: 34.02,
    lbsPerUnitMin: 45.973, lbsPerUnitMax: 45.973,
    note: "Cello-wrapped, 24 count. The smallest of the four and the one most likely to be an occasional substitute rather than a standing buy.",
  },
];

// ── Section D: the still-stuck ledger ──────────────────────────────────────────

export interface StuckItem {
  item: string;
  category: "SCALE_GATED" | "WEIGH_PENDING" | "SUPPLY_RUN" | "UNADJUDICATED_PAIR" | "POLICY_PREMISE";
  stuckOn: string;
  unblock: string;
}

/**
 * Everything wave 4 leaves exactly where it found it, with the one fact that would
 * move each.
 *
 * The categories matter more than the rows. `SUPPLY_RUN` is not a backlog — no
 * future harvest resolves it, because Angel can only cost what arrives on an
 * integrated vendor's invoice. `SCALE_GATED` is 90 seconds of Juan's time for the
 * whole cluster. `UNADJUDICATED_PAIR` is a decision, not a lookup. Filing them all
 * as "TODO" would lose exactly the distinction that tells you which to do first.
 */
export const STILL_STUCK: readonly StuckItem[] = [
  {
    item: "Oregano (both jug sizes) + Onion Powder — pack WEIGHT",
    category: "SCALE_GATED",
    stuckOn: "Angel measures the 5 lb jug at 6.001 lb on all THREE oregano lines and 6.002 on onion powder's single line — oregano's never moved in three months. A weight that never moves is a stored number rather than a weighing, so the 1.20x may be a feed artifact, in which case cost/oz is overstated by 17%. **This is now the WHOLE of the scale gate**: garlic left the cluster on 2026-08-20 when Juan accepted that its varying per-delivery weight is evidence of a real weighing, which is exactly the evidence these two lack.",
    unblock: "One oregano jug on a scale. Settles both jugs at once — and it is the only physical measurement this arc is still waiting on for pricing.",
  },
  {
    item: "Ever Roast Chicken — oz per slice",
    category: "WEIGH_PENDING",
    stuckOn: "Wave 3 filled 1.0 oz as a SPEC-class placeholder (74.1 oz piece / 74 slices). Every deli item Juan has actually weighed came in 20-60% under its spec, so this one almost certainly will too.",
    unblock: "A surprise 3-sample weigh, the same way the five ruled SKUs were settled.",
  },
  {
    item: "Lemon Oil · Mixed Herbs · Vanilla Bean Paste · White Wine · Worcestershire",
    category: "SUPPLY_RUN",
    stuckOn: "Genuinely absent from Angel — searched by name AND by class. Bought on a grocery or restaurant-supply run, so no distributor invoice will ever carry them.",
    unblock: "One receipt, entered once, by hand. This is the category co-ops can hold and Angel structurally cannot.",
  },
  {
    item: "Utz Ripples — PRICE (vendor now bound)",
    category: "SUPPLY_RUN",
    stuckOn: "Section A binds the vendor Juan named, but Angel has no chips of any kind, so the PRICE side of this row stays on the supply-run list. Vendor and price were always separable questions; this is the row that demonstrates it.",
    unblock: "A Country Snacks receipt. The SKU already carries a full pack (Box of 9 x 12.5 oz bags), so the price lands in one step.",
  },
  {
    item: "Pepperoncini — vendor",
    category: "SUPPLY_RUN",
    stuckOn: "Not in Angel under that name. Two functional Delmar neighbours exist (`BANANA PEPPER RINGS`, `HOT CHERRY PEPPERS`) but BOTH carry Angel's fabricated 1.0 lb weight, so neither can be costed by weight even if adopted.",
    unblock: "Juan's word on whether banana pepper rings are the sourcing answer, plus a real case weight.",
  },
  {
    item: "Chives (fresh) — pack weight",
    category: "POLICY_PREMISE",
    stuckOn: "The herb policy names chives, but our pack is HALF an Angel unit (divisor 2 from a pack string the measurement contradicts at 1.62x). Wave 2's rule for exactly this shape: when the divisor comes from a falsified pack string, the price is in doubt too.",
    unblock: "Confirm what one of our chive packs physically is — a whole 8 oz box, or half of one.",
  },
  {
    item: "8 multi-vendor pairs (Turkey · Roast Beef · Provolone · Capicola · Pepperoni · Banana Peppers · Hot Peppers · Sweet Peppers)",
    category: "UNADJUDICATED_PAIR",
    stuckOn: "Named here for the first time — the audit recorded only the COUNT (11 products, minus Ham, Fresh Mozzarella and Lettuce = 8) and the enumeration lived in a subagent transcript that was never filed. All 8 share one shape: Boar's Head active and holding the par, Baldor inactive and empty.",
    unblock: "Juan's per-pair word, or a single ruling covering the shape — every one of the 8 is the same decision.",
  },
];

// ── Refusal vocabulary ─────────────────────────────────────────────────────────

export type Wave4Code =
  | "SKU_UNRESOLVED"
  | "VENDOR_DRIFT"
  | "VENDOR_UNREGISTERED"
  | "ALREADY_CORRECT"
  | "OUR_PACK_UNRESOLVABLE"
  | "PACK_SHAPE_CHANGED"
  | "NO_ANGEL_ROW"
  | "SCALE_GATED"
  | "PACK_PREMISE_BROKEN"
  | "NO_MEASURED_INVOICE_WEIGHT"
  | "ATTRIBUTION_UNRESOLVED"
  | "PAR_ABSENT";

export const WAVE4_REASONS: Readonly<Record<Wave4Code, string>> = {
  SKU_UNRESOLVED:
    "The SKU name did not resolve to exactly one GLOBAL vendor_items row. A binding or a weight written to the wrong twin is invisible, so this is never guessed at.",
  VENDOR_DRIFT:
    "The SKU resolved but already sits under a different vendor than this ruling expects. A binding that would OVERWRITE an existing attribution is a different decision from filling an empty one, and it needs saying out loud first.",
  VENDOR_UNREGISTERED:
    "The vendor Juan named is not in the `vendors` registry, or is inactive. Registration is the seed-15 (Delmar) path and it creates directory rows, categories and ordering details — not something to do as a side-effect of a price fill.",
  ALREADY_CORRECT:
    "The live row already carries the value this wave would write. Idempotency working — reported, not written.",
  OUR_PACK_UNRESOLVABLE:
    "Our own SKU cannot say what one pack is: no chain, and the flat columns carry no each_size/each_measure. There is no denominator, and inventing one is the PICKLES CHIPS $35.95/lb failure.",
  PACK_SHAPE_CHANGED:
    "The live pack is not the shape this correction was written against. Someone changed it since the harvest; re-derive the fix rather than flattening whatever is there now.",
  NO_ANGEL_ROW:
    "Angel has never invoiced this product, so there is no price to derive — only a vendor to bind. Not a lookup that failed: a product bought outside the integrated-distributor lane.",
  SCALE_GATED:
    "Juan's ruling explicitly holds this weight back for a physical measurement. The arithmetic is done and reported so that approving it later is one line, but the 1.20x cluster is not resolved by more reading.",
  PACK_PREMISE_BROKEN:
    "The herb policy assumes one of OUR packs is one ANGEL unit. Here it is not, so the average would have to be divided by a number that came from the same pack string the measurement just contradicted. Per wave 2's conflictImpact rule, that puts the price in doubt as well as the weight.",
  NO_MEASURED_INVOICE_WEIGHT:
    "Every invoice line for this product carries Angel's fabricated 1.000 lb/unit (or no weight at all), so there is nothing to average. Deriving from it is the basil/FRSH ADV trap.",
  ATTRIBUTION_UNRESOLVED:
    "Angel's rows for this product belong to vendors that are not either of our twins, so no Angel price can be attributed to our SKU. Any number would be an attribution guess wearing arithmetic's clothes.",
  PAR_ABSENT:
    "Neither twin carries a par, so the pair is correctly shaped and still unorderable. Seed 18's rule holds: a par is Juan's call and this script refuses to invent one.",
};
