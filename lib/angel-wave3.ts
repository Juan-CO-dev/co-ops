/**
 * Angel harvest WAVE 3 — the PIECE MODEL: pure arithmetic + cross-checks.
 *
 * Zero I/O, like lib/angel-price-fill.ts (wave 1) and lib/angel-wave2.ts (wave 2),
 * both of which this module EXTENDS rather than replaces.
 * scripts/seed/20-angel-wave3.ts is the only I/O shell around it.
 *
 * ── WHAT HARVEST 2 FOUND, AND WHY IT IS A DIFFERENT KIND OF FACT ──────────────
 * Wave 2 could not price seven of the eight Boar's Head deli SKUs. Its refusal was
 * honest and specific: Angel knew what a Delmar case weighed, our SKUs did not know
 * what one of OUR packs weighed (no pack chain, no `each_size`), and there is
 * nothing to multiply a $/lb by when you cannot measure your own pack.
 *
 * Harvest 2 answers that from a field the Purchases grid never showed — a product
 * subtitle carrying `1 CT`. All eight Delmar items carry it, and the arithmetic
 * agrees: `Quantity` on the invoice is a COUNT OF PIECES and `Net Weight ÷ Quantity`
 * is the weight of ONE PIECE. There is no case. What wave 2 called a "case weight of
 * ~9.23 lb" is one turkey breast.
 *
 * So the pack semantics that unlock these SKUs are: **our pack is one piece.** That
 * is not a modelling preference, it is what the vendor invoices, and it also happens
 * to be the granularity Juan's own order guide already uses — his pars read "8 pcs",
 * "5 Logs", "22 (not prepped)". A par counted in pieces against a pack of one piece
 * is exact; against a "Case of 5" it is 1.6 cases.
 *
 * ── THE ONE RULE THIS MODULE EXISTS TO ENFORCE ────────────────────────────────
 * Juan's measured slice table (scripts/seed/10-fill-sku-weights.ts) is FLOOR TRUTH.
 * The piece model produces a second, independent-ish opinion on oz-per-slice
 * (piece_oz ÷ slices_per_piece) and the two must be reconciled OUT LOUD before any
 * weight is written, because `avg_oz_per_each` is what every `1 unit` portioned
 * recipe line depletes. Getting it wrong does not throw; it silently changes how
 * much meat the system thinks left the building.
 *
 * ⚠ And be honest about what that cross-check IS. `slices_per_piece` in the harvest
 * CSV was itself computed as floor(piece_oz ÷ Juan's oz-per-slice), so dividing back
 * is close to an identity. It is a ROUNDING-CONSISTENCY check, not independent
 * corroboration. Its real value is the third opinion it makes visible: what the LIVE
 * database actually carries, which on four SKUs is neither of the other two.
 *
 * ── WHY $/lb, STILL ──────────────────────────────────────────────────────────
 * Unchanged from wave 2: Delmar prices per POUND and ships a variable weight. Every
 * price here is `$/lb × our-piece-lb`, never a case price read off one invoice,
 * because that would freeze one delivery's particular weight into our cost forever.
 */

import { parseCsvLine } from "@/lib/angel-price-fill";

// ── Source rows: docs/angel-piece-structure.csv ────────────────────────────────

/** One parsed row of the harvest-2 piece-structure CSV. */
export interface PieceRow {
  product: string;
  angelSubtitle: string;
  unitDescriptor: string;
  /** `1` for the catch-weight pieces; `192` for the mozzarella case. Kept raw —
   *  the bacon row is a RANGE and must not be coerced to a number. */
  piecesPerInvoiceUnitRaw: string;
  lbsPerPiece: number | null;
  lbsPerPieceMin: number | null;
  lbsPerPieceMax: number | null;
  ozPerPiece: number | null;
  coopsSku: string;
  coopsOzPerSlice: number | null;
  /** `148`, or `180-210` for bacon. Raw for the same reason. */
  slicesPerPieceRaw: string;
  pricePerLb: number | null;
  costPerSliceRaw: string;
  costPerPiece: number | null;
}

function numOrNull(s: string | undefined): number | null {
  const t = (s ?? "").trim();
  if (t === "" || t === "—") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Parse the piece-structure CSV. Header-driven — column ORDER is never assumed. */
export function parsePieceStructure(csvText: string): PieceRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]!).map((h) => h.trim());
  const idx = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`parsePieceStructure: expected column "${name}" in the header, got: ${header.join(", ")}`);
    return i;
  };
  const c = {
    product: idx("product"), subtitle: idx("angel_subtitle"), descriptor: idx("unit_descriptor"),
    pieces: idx("pieces_per_invoice_unit"), lbs: idx("lbs_per_piece"),
    lbsMin: idx("lbs_per_piece_min"), lbsMax: idx("lbs_per_piece_max"), oz: idx("oz_per_piece"),
    sku: idx("coops_sku"), ozSlice: idx("coops_oz_per_slice"), slices: idx("slices_per_piece"),
    ppl: idx("price_per_lb"), costSlice: idx("cost_per_slice"), costPiece: idx("cost_per_piece"),
  };
  return lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    const t = (i: number) => (f[i] ?? "").trim();
    return {
      product: t(c.product), angelSubtitle: t(c.subtitle), unitDescriptor: t(c.descriptor),
      piecesPerInvoiceUnitRaw: t(c.pieces),
      lbsPerPiece: numOrNull(f[c.lbs]), lbsPerPieceMin: numOrNull(f[c.lbsMin]), lbsPerPieceMax: numOrNull(f[c.lbsMax]),
      ozPerPiece: numOrNull(f[c.oz]),
      coopsSku: t(c.sku), coopsOzPerSlice: numOrNull(f[c.ozSlice]), slicesPerPieceRaw: t(c.slices),
      pricePerLb: numOrNull(f[c.ppl]), costPerSliceRaw: t(c.costSlice), costPerPiece: numOrNull(f[c.costPiece]),
    };
  });
}

// ── Source rows: docs/angel-pack-recheck.csv ───────────────────────────────────

/** One parsed row of the harvest-2 pack-recheck CSV (the jug/bunch structures). */
export interface PackRecheckRow {
  product: string;
  brand: string;
  vendor: string;
  packSizeField: string;
  angelPackDescriptor: string;
  unitsPerCase: number | null;
  nominalLbs: number | null;
  angelNetLbsPerCase: number | null;
  netOverNominal: number | null;
  casePrice: number | null;
  angelPricePerLb: number | null;
  pricePerLbIfNominal: number | null;
  structure: string;
}

export function parsePackRecheck(csvText: string): PackRecheckRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]!).map((h) => h.trim());
  const idx = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`parsePackRecheck: expected column "${name}" in the header, got: ${header.join(", ")}`);
    return i;
  };
  const c = {
    product: idx("product"), brand: idx("brand"), vendor: idx("vendor"),
    packField: idx("pack_size_field"), descriptor: idx("angel_pack_descriptor"),
    units: idx("units_per_case"), nominal: idx("nominal_lbs"), net: idx("angel_net_lbs_per_case"),
    ratio: idx("net_over_nominal"), price: idx("case_price"), ppl: idx("angel_price_per_lb"),
    pplNominal: idx("price_per_lb_if_nominal"), structure: idx("structure"),
  };
  return lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    const t = (i: number) => (f[i] ?? "").trim();
    return {
      product: t(c.product), brand: t(c.brand), vendor: t(c.vendor),
      packSizeField: t(c.packField), angelPackDescriptor: t(c.descriptor),
      unitsPerCase: numOrNull(f[c.units]), nominalLbs: numOrNull(f[c.nominal]),
      angelNetLbsPerCase: numOrNull(f[c.net]), netOverNominal: numOrNull(f[c.ratio]),
      casePrice: numOrNull(f[c.price]), angelPricePerLb: numOrNull(f[c.ppl]),
      pricePerLbIfNominal: numOrNull(f[c.pplNominal]), structure: t(c.structure),
    };
  });
}

/** Identity of a pack-recheck row. Product name alone is NOT unique — `OREGANO
 *  LEAVES` appears twice under one brand at two sizes, and `BASIL FRSH` twice under
 *  two brands. Same key shape as wave 1's `rowKey` so the tables can be joined. */
export function packRecheckKey(r: { product: string; brand: string; vendor: string; packSizeField: string }): string {
  return [r.product, r.brand, r.vendor, r.packSizeField].map((s) => s.trim()).join(" | ");
}

// ── Section A: the piece model ─────────────────────────────────────────────────

/** One Boar's Head SKU that harvest 2 converts to the piece model. */
export interface PieceModelRule {
  /** Angel product name, verbatim — the join key into BOTH harvest CSVs. */
  product: string;
  /** Our `vendor_items.name`. Resolved to an id LIVE, never hardcoded. */
  skuName: string;
  /** Asserted live before any write. A vendor drift means STOP, not guess. */
  expectVendor: string;
  /** The chain level's label. Deliberately NOT a `measure_units` label (checked). */
  chainLabel: string;
  matchNote: string;
}

/**
 * The seven SKUs wave 2 refused for `OUR_PACK_UNRESOLVABLE`.
 *
 * Bacon is deliberately absent: it is the one Delmar item sold as a packed 15 lb
 * BOX rather than a whole muscle, its 240 oz `each_size` was already correct and
 * already validated to the ounce against Angel, and wave 2 therefore priced it
 * ($70.35, live). Bacon's harvest-2 correction is a WEIGHT correction and lives in
 * section B. Putting it here would rewrite a pack that is right.
 *
 * The match table is wave 2's `DELMAR_CATCH_WEIGHT_RULES`, unchanged — those
 * pairings were reviewed once and harvest 2 gives no reason to revisit them. The
 * single INFERRED one (London Broil → Roast Beef) is still flagged.
 */
export const PIECE_MODEL_RULES: readonly PieceModelRule[] = [
  { product: "OVENGOLD TURKEY", skuName: "Turkey", expectVendor: "Boar's Head", chainLabel: "piece", matchNote: "OvenGold is Boar's Head's turkey line; our only BH turkey SKU. One piece = one whole breast." },
  { product: "LONDON BROIL", skuName: "Roast Beef", expectVendor: "Boar's Head", chainLabel: "piece", matchNote: "London Broil is a seasoned roast-beef cut, not a distinct species. The ONLY name-inference in this table — Juan should confirm this is our roast beef." },
  { product: "MILD PROVOLONE", skuName: "Provolone", expectVendor: "Boar's Head", chainLabel: "piece", matchNote: "Our only BH provolone SKU. One piece = one loaf." },
  { product: "DILANDRI GENOA SALAME", skuName: "Genoa", expectVendor: "Boar's Head", chainLabel: "piece", matchNote: "DiLandri is the maker; Genoa is the product. One piece = one log (Juan's par reads \"5 Logs\")." },
  { product: "HOT BUTT CAPPY", skuName: "Capicola", expectVendor: "Boar's Head", chainLabel: "piece", matchNote: "\"Cappy\" is trade shorthand for capicola; \"hot butt\" is the cut+heat. Juan's par reads \"8 pcs\"." },
  { product: "EVERROAST CHICKEN", skuName: "Ever Roast Chicken", expectVendor: "Boar's Head", chainLabel: "piece", matchNote: "EverRoast is Boar's Head's chicken line; names match. No entry in Juan's slice table — harvest 2 proposes 1.0 oz/slice alongside turkey." },
  { product: "Pepperoni Slicing", skuName: "Pepperoni", expectVendor: "Boar's Head", chainLabel: "piece", matchNote: "Our only BH pepperoni SKU. One piece = one stick." },
];

/**
 * Juan's ruling of 2026-08-20, which settles wave 3's STOP list and — more usefully —
 * names a distinction this codebase did not previously have.
 *
 * The dry run found five SKUs whose live `avg_oz_per_each` matched neither the seed-10
 * table nor the piece model, with no audit row explaining the change, and refused to
 * write any of them. The answer: **the live values are his own measurements.** He took
 * 3-sample averages as a SURPRISE check — slicing unchanged, nobody adjusting for the
 * scale — so they are unbiased observations of what the line actually produces.
 *
 * So the two numbers were never competing measurements of one quantity. They are two
 * different quantities that had been sharing a column:
 *
 *   SPEC / ASPIRATIONAL  what a slice is supposed to weigh at the intended thickness
 *                        (seed 10's estimates — reasonable, and not what happens)
 *   OPERATIONAL          what a slice actually weighs coming off our slicer, measured
 *                        under observation-free conditions
 *
 * Costing and depletion must use OPERATIONAL: the question they answer is "how much
 * product left the building", and the answer is the real slice, not the intended one.
 * Slices are normal thickness — operations simply differ from spec, which is the
 * ordinary condition of every kitchen and not a defect to be corrected away.
 */
export const JUAN_RULING =
  "Juan 2026-08-20: the live avg_oz_per_each values are HIS OWN measurements — 3-sample averages taken as a SURPRISE check, slicing unchanged and unbiased. Live = OPERATIONAL truth (what a slice really weighs); the seed-10 table = ASPIRATIONAL/SPEC weights (what it is supposed to weigh). Slices are normal thickness; operations differ from spec. Costing and depletion use the operational number. Do not 'correct' back from spec sheets.";

/**
 * The SPEC (aspirational) oz-per-slice table, transcribed verbatim from the FILLS array
 * of scripts/seed/10-fill-sku-weights.ts as it stood BEFORE the ruling.
 *
 * Kept, not deleted, because it is what the piece model's `slices_per_piece` column was
 * computed from — so it is the only thing that explains why the harvest's slices-per-piece
 * and $/slice tables read the way they do. It is NO LONGER a truth reference: after the
 * ruling, a derived-vs-spec agreement says the harvest's arithmetic is self-consistent
 * and says nothing about what the line produces.
 */
export const SPEC_SLICE_OZ: Readonly<Record<string, number>> = {
  Turkey: 1.0,
  "Roast Beef": 1.5,
  Provolone: 0.75,
  Genoa: 1.0,
  Capicola: 1.0,
  Pepperoni: 0.25,
  Bacon: 0.75,
  /** Ham lives outside the piece model (it is a PFG product, not a Delmar piece), but
   *  it is one of the five rows the ruling covers, so its spec value belongs here —
   *  otherwise the ruling's own gap cannot be stated for it. */
  Ham: 1.0,
};

/**
 * The OPERATIONAL oz-per-slice table — Juan's surprise 3-sample averages, 2026-08-20.
 *
 * These are exactly the five rows where production diverged from seed 10, which is the
 * evidence that a measurement happened: Turkey, Roast Beef and Bacon never moved, so
 * either he did not weigh them or they came back at spec, and in both cases there is
 * nothing to record.
 *
 * ── WHY THIS EXISTS AS A CONSTANT WHEN THE SCRIPT READS LIVE ──────────────────
 * The script resolves every weight live and writes none of these. The table's job is to
 * let it ASSERT that live still equals the ruling — so that if one of these drifts again
 * without an audit row, wave 3 catches it as a NEW divergence instead of silently
 * accepting whatever is there. A ruling that cannot be checked is a comment.
 */
export const OPERATIONAL_SLICE_OZ: Readonly<Record<string, number>> = {
  Genoa: 0.4,
  Capicola: 0.4,
  Provolone: 0.7,
  Pepperoni: 0.2,
  /** The Baldor twin's measured value; the PFG twin mirrors it (§B3) — same physical
   *  ham through the same slicer, so one measurement covers both. */
  Ham: 1.2,
};

/**
 * Does the ruling cover this SKU's weight, and does production still agree with it?
 *
 * Three outcomes, and they are genuinely different situations:
 *   RULED_KEEP_LIVE  live matches the ruling — the operational number stands, no write
 *   RULED_DRIFTED    the ruling covers this SKU but live has moved off it AGAIN
 *   UNRULED          no measurement exists; fall back to spec/piece-model comparison
 */
export type RulingStatus = "RULED_KEEP_LIVE" | "RULED_DRIFTED" | "UNRULED";

export function rulingStatus(skuName: string, liveOz: number | null): RulingStatus {
  const ruled = OPERATIONAL_SLICE_OZ[skuName];
  if (ruled == null) return "UNRULED";
  if (liveOz == null) return "RULED_DRIFTED";
  return Math.abs(liveOz - ruled) < 1e-9 ? "RULED_KEEP_LIVE" : "RULED_DRIFTED";
}

/**
 * Slices actually obtainable from one piece, and what each really costs — recomputed at
 * the OPERATIONAL weight.
 *
 * This is the deliverable the ruling unlocks. The harvest's own slices-per-piece and
 * $/slice columns were computed off the spec table, so for the five ruled SKUs they are
 * wrong in the direction that matters most: they UNDERSTATE how many slices a piece
 * yields and therefore OVERSTATE what a slice costs. Genoa is the extreme — 103 slices
 * at $0.2744 on paper against 257 at $0.1100 on the line.
 */
export function sliceEconomics(
  pieceOz: number | null,
  ozPerSlice: number | null,
  piecePrice: number | null,
): { slicesPerPiece: number | null; costPerSlice: number | null } {
  if (pieceOz == null || ozPerSlice == null || !(pieceOz > 0) || !(ozPerSlice > 0)) {
    return { slicesPerPiece: null, costPerSlice: null };
  }
  const slicesPerPiece = Math.floor(pieceOz / ozPerSlice);
  if (slicesPerPiece <= 0) return { slicesPerPiece: null, costPerSlice: null };
  return {
    slicesPerPiece,
    costPerSlice: piecePrice != null && piecePrice > 0 ? piecePrice / slicesPerPiece : null,
  };
}

/**
 * How far the derived oz-per-slice may sit from a reference before the row is called a
 * disagreement.
 *
 * 5% is chosen against the actual rounding floor, not picked round. `slices_per_piece`
 * is an INTEGER floor of piece_oz ÷ spec_oz, so the derived value is biased high by
 * at most 1/slices — worst case in this dataset is capicola at 57 slices (+0.88%).
 * 5% clears every rounding artifact with five times the headroom and still catches
 * the smallest spec-vs-operational gap present (pepperoni's 0.2 vs 0.25 is -20%).
 *
 * Post-ruling, a derived-vs-LIVE disagreement is no longer a defect — it is the
 * measured spec-to-operational gap, and its SIZE is the useful output.
 */
export const SLICE_CROSSCHECK_TOLERANCE = 0.05;

export type SliceVerdict = "AGREES" | "DISAGREES" | "NO_REFERENCE" | "UNCOMPUTABLE";

export interface SliceCrossCheck {
  /** piece_oz ÷ slices_per_piece. */
  derivedOzPerSlice: number | null;
  referenceOzPerSlice: number | null;
  /** derived ÷ reference − 1. Null when either side is missing. */
  deltaFraction: number | null;
  verdict: SliceVerdict;
}

/**
 * Compare the piece model's implied oz-per-slice against a reference value.
 *
 * Used twice per SKU with two different references, and the two answers mean
 * different things:
 *   · vs Juan's table  → does the harvest's arithmetic reproduce the floor truth?
 *   · vs the LIVE row  → does production carry the floor truth at all?
 * The second is the one that found something.
 */
export function crossCheckSlice(
  pieceOz: number | null,
  slicesPerPiece: number | null,
  referenceOzPerSlice: number | null,
  tolerance = SLICE_CROSSCHECK_TOLERANCE,
): SliceCrossCheck {
  const derived =
    pieceOz != null && slicesPerPiece != null && Number.isFinite(pieceOz) && Number.isFinite(slicesPerPiece) && slicesPerPiece > 0 && pieceOz > 0
      ? pieceOz / slicesPerPiece
      : null;
  if (derived == null) {
    return { derivedOzPerSlice: null, referenceOzPerSlice, deltaFraction: null, verdict: "UNCOMPUTABLE" };
  }
  if (referenceOzPerSlice == null || !Number.isFinite(referenceOzPerSlice) || referenceOzPerSlice <= 0) {
    return { derivedOzPerSlice: derived, referenceOzPerSlice: null, deltaFraction: null, verdict: "NO_REFERENCE" };
  }
  const deltaFraction = derived / referenceOzPerSlice - 1;
  return {
    derivedOzPerSlice: derived,
    referenceOzPerSlice,
    deltaFraction,
    verdict: Math.abs(deltaFraction) > tolerance ? "DISAGREES" : "AGREES",
  };
}

/**
 * `180-210` → { lo: 180, hi: 210 }; `148` → { lo: 148, hi: 148 }.
 *
 * Returns null rather than guessing, because a mis-parsed slice count silently
 * halves or doubles every derived per-slice weight downstream.
 */
export function parseSliceCount(raw: string): { lo: number; hi: number } | null {
  const t = raw.trim();
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(t);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    if (Number.isInteger(lo) && Number.isInteger(hi) && lo > 0 && hi >= lo) return { lo, hi };
    return null;
  }
  const one = /^(\d+)$/.exec(t);
  if (!one) return null;
  const n = Number(one[1]);
  return Number.isInteger(n) && n > 0 ? { lo: n, hi: n } : null;
}

/**
 * Is the harvest's per-piece weight consistent with the invoice range wave 2 derived
 * independently?
 *
 * The two numbers come from the same invoices but by different routes — harvest 1
 * recovered `lbs_per_unit` algebraically (line_total ÷ $/lb ÷ qty) while harvest 2
 * read the product page's own stated weight. Agreement is the check that the piece
 * reframe did not shift a decimal. A 1% slack absorbs the rounding in both.
 */
export function pieceWeightInRange(
  lbsPerPiece: number | null,
  observedMin: number | null,
  observedMax: number | null,
  slackFraction = 0.01,
): boolean {
  if (lbsPerPiece == null || observedMin == null || observedMax == null) return false;
  if (!(lbsPerPiece > 0) || !(observedMin > 0) || !(observedMax > 0)) return false;
  return lbsPerPiece >= observedMin * (1 - slackFraction) && lbsPerPiece <= observedMax * (1 + slackFraction);
}

// ── Section B: the weight-file corrections ─────────────────────────────────────

/**
 * The bacon slice spec, read off the Angel subtitle `IMP LAYER BACON 12/14`.
 *
 * `12/14` is a SLICE COUNT, not a size code: 12–14 strips per POUND. That single
 * reading is the whole correction — co-ops carries 0.75 oz/strip, which implies
 * 21.3 strips per pound, for bacon that is spec'd at 12–14.
 */
export const BACON_SLICE_SPEC = { slicesPerLbLo: 12, slicesPerLbHi: 14 } as const;

/**
 * Slices-per-pound spec → oz per strip, rounded to two decimals.
 *
 * 16 ÷ 13 = 1.2308 → **1.23**, which the piece model then corroborates from the
 * other direction: the 240 oz box at 1.23 oz/strip is 195 strips, dead centre of the
 * 180–210 the spec implies. Two independent routes to the same number.
 *
 * Rounded to 2dp deliberately: `avg_oz_per_each` is a human-auditable estimate that
 * sits beside Juan's hand-measured 0.75s and 1.5s, and a 1.2307692307692308 in that
 * column reads as false precision on a value whose true spread is 12–14 per pound.
 */
export function ozPerStripFromSlicesPerLb(slicesPerLbLo: number, slicesPerLbHi: number): number {
  if (!Number.isFinite(slicesPerLbLo) || !Number.isFinite(slicesPerLbHi)) {
    throw new Error(`ozPerStripFromSlicesPerLb: non-finite spec ${slicesPerLbLo}/${slicesPerLbHi}`);
  }
  if (slicesPerLbLo <= 0 || slicesPerLbHi < slicesPerLbLo) {
    throw new Error(`ozPerStripFromSlicesPerLb: bad spec ${slicesPerLbLo}/${slicesPerLbHi}`);
  }
  const mid = (slicesPerLbLo + slicesPerLbHi) / 2;
  return Number(`${Math.round(Number(`${16 / mid}e2`))}e-2`);
}

/**
 * The corrected bacon strip weight, and the value it supersedes.
 *
 * ── WHY JUAN'S RULING DOES NOT SWEEP THIS ALONG WITH THE DELI SLICES ──────────
 * The ruling says operational beats spec. It is tempting to read that as "never write a
 * spec number again", and that would be wrong here, for a reason worth stating.
 *
 * The ruling's force comes from WHERE the variance lives: a deli slice's weight is set
 * by OUR slicer, so only observing our line can tell you what a slice weighs. Bacon is
 * not sliced by us — it arrives pre-portioned in a 15 lb layer box built to the vendor's
 * `12/14` count. The strip weight is a property of the product AS DELIVERED, so the
 * vendor's spec IS the operational fact, and there is no local process for a surprise
 * weigh to observe.
 *
 * The other half of the argument is evidential. The five ruled SKUs are exactly the five
 * whose live value MOVED after seed 10 ran — that movement is the fingerprint of a
 * measurement. Bacon never moved: its live 0.75 is seed 10's own untouched estimate, not
 * an observation. Applying the ruling to it would ratify a guess by association.
 */
export const BACON_CORRECTION = {
  skuName: "Bacon",
  expectVendor: "Boar's Head",
  fromOz: 0.75,
  get toOz(): number {
    return ozPerStripFromSlicesPerLb(BACON_SLICE_SPEC.slicesPerLbLo, BACON_SLICE_SPEC.slicesPerLbHi);
  },
  boxOz: 240,
} as const;

/**
 * The fresh-mozzarella case, closed from three directions on one product page:
 *   1 log  = 32 CT × 1 oz = 32 oz = 2 lb   ← matches the `6/2 LB` pack field
 *   1 case = 6 logs       = 12 lb          ← matches the `12 LB` subtitle
 *   1 case = 192 slices
 * Measured net is 12.7642 lb — 6.4% over — and that gap is brine and packaging, not
 * cheese. We cost the 192 oz of CHEESE, which is why the pack is 192 and not 204.
 */
export const MOZZARELLA_CASE = {
  skuName: "Fresh Mozzarella",
  logsPerCase: 6,
  slicesPerLog: 32,
  ozPerSlice: 1.0,
  fromUnits: 72,
  get slicesPerCase(): number {
    return MOZZARELLA_CASE.logsPerCase * MOZZARELLA_CASE.slicesPerLog;
  },
  get caseOz(): number {
    return MOZZARELLA_CASE.slicesPerCase * MOZZARELLA_CASE.ozPerSlice;
  },
} as const;

// ── Section C: the jug supersedes ──────────────────────────────────────────────

/**
 * A wave-1 price whose DIVISOR the pack recheck falsifies.
 *
 * Wave 1 divided `OREGANO LEAVES` `1/5 LB` by 4 and `ONION PWDR` `1/5 LB` by 5, on
 * the reading that our 20 oz / 16 oz pack was one unit inside a 5 lb case. The pack
 * recheck settles it from Angel's own descriptor: **`units_per_case = 1`. It is one
 * jug.** There is no inner unit to divide by, so the divisor is not merely uncertain
 * (which is where wave 2's re-sweep left it) — it is wrong.
 *
 * ── WHY PRICE AND PACK MOVE TOGETHER, ALWAYS ──────────────────────────────────
 * `unit_price` is the price of ONE OF OUR PACKS. Correcting the price to the jug
 * price while our SKU still models a 20 oz quarter-jug does not half-fix anything;
 * it produces $55.27 ÷ 20 oz = $2.76/oz against a true $0.69/oz — a FOUR-FOLD
 * cost error, worse than the state it replaces. The divisor and the pack are the
 * same fact seen twice. So each supersede below carries the jug's nominal ounces,
 * and the script writes the pack and the price in one step or neither.
 *
 * ── WHAT IS DELIBERATELY *NOT* CORRECTED ──────────────────────────────────────
 * The jug's WEIGHT. Angel measures these at exactly 1.20× nominal (5.0 → 6.0 lb,
 * and 1.5 → 1.8 on the small oregano) across four SKUs of different sizes, which is
 * a feed artifact's signature rather than tare's. `nominalJugOz` below is the pack
 * string's 5 lb — the conservative, higher-$/lb reading the harvest recommends —
 * and it is IDENTICAL to the `angelCaseOz` wave 1's own division table already
 * asserts, so this correction changes cost-per-ounce by exactly zero. If Juan's
 * scale says 6 lb, that is a separate, later, one-line change.
 */
export interface JugSupersede {
  /** Angel row identity (product + brand + vendor + pack field). */
  product: string;
  brand: string;
  vendor: string;
  packSizeField: string;
  /** Our `vendor_items.name`. */
  skuName: string;
  expectVendor: string;
  /** Wave 1's divisor and the unit_price it produced — superseded, never modified. */
  wave1Divisor: number;
  wave1UnitPrice: number;
  /**
   * The jug's price = Angel's CASE price, verified live from the rollup.
   *
   * NOT `wave1UnitPrice × wave1Divisor`. That reconstruction gives $55.28 for
   * oregano because $13.82 is already rounded to cents — a one-cent invention on
   * top of a correction whose whole claim is that it invents nothing. Round-tripping
   * through a rounded number is exactly the class of error wave 1's
   * `computePackUnitPrice` doc-comment exists to prevent, and the test that caught
   * it is kept.
   */
  casePriceUsd: number;
  /** Our pack's oz TODAY (the quarter/fifth jug wave 1 divided down to). */
  currentPackOz: number;
  /** The whole jug at NOMINAL weight = wave 1's own `angelCaseOz`. */
  nominalJugOz: number;
  /** Angel's measured net for the same jug — the open 1.20× question. */
  angelMeasuredJugOz: number;
  /** The new chain level's label. Checked against measure_units for collision. */
  chainLabel: string;
}

export const JUG_SUPERSEDES: readonly JugSupersede[] = [
  {
    product: "OREGANO LEAVES", brand: "ROMA", vendor: "PFG", packSizeField: "1/5 LB",
    skuName: "Oregano", expectVendor: "PFG",
    wave1Divisor: 4, wave1UnitPrice: 13.82, casePriceUsd: 55.27,
    currentPackOz: 20, nominalJugOz: 80, angelMeasuredJugOz: 96, chainLabel: "jug",
  },
  {
    product: "ONION PWDR", brand: "ROMA", vendor: "PFG", packSizeField: "1/5 LB",
    skuName: "Onion Powder", expectVendor: "PFG",
    wave1Divisor: 5, wave1UnitPrice: 6.65, casePriceUsd: 33.25,
    currentPackOz: 16, nominalJugOz: 80, angelMeasuredJugOz: 96, chainLabel: "jug",
  },
];

/** Price of one ounce, or null. The number that proves a pack+price correction is
 *  cost-neutral (or is not). */
export function costPerOz(unitPrice: number | null, packOz: number | null): number | null {
  if (unitPrice == null || packOz == null) return null;
  if (!Number.isFinite(unitPrice) || !Number.isFinite(packOz) || packOz <= 0) return null;
  return unitPrice / packOz;
}

/** Two cost-per-ounce readings agree to within `tolerance` (default a tenth of a
 *  percent — this is arithmetic, not measurement, so the bar is tight). */
export function costPerOzUnchanged(before: number | null, after: number | null, tolerance = 0.001): boolean {
  if (before == null || after == null || before <= 0) return false;
  return Math.abs(after / before - 1) <= tolerance;
}

/**
 * The rows the pack recheck touches that wave 3 deliberately does NOT write.
 *
 * Garlic and Parsley are the mirror image of the jugs: their DIVISOR is 1 and was
 * always 1, so wave 1's price stands unchallenged; what the recheck questions is
 * their pack WEIGHT (garlic 1.20×, the same feed artifact; parsley 1.40×, which for
 * a fresh bunch product is probably real). A weight change moves cost-per-ounce, and
 * neither has evidence strong enough to move it on. They are listed so the reader
 * sees the whole recheck, and skipped so the report cannot be mistaken for one.
 */
export interface PendingRecheck {
  skuName: string;
  product: string;
  question: string;
  unblock: string;
}

export const PENDING_RECHECKS: readonly PendingRecheck[] = [
  {
    skuName: "Garlic", product: "GARLIC WHL PLD DOM",
    question: "Price $19.72 is right (divisor was always 1). Angel measures the 5 lb tub at 6.00 lb — the same exact 1.20× as the two jugs. If real, cost/oz falls from $0.2465 to $0.2054 (-17%).",
    unblock: "One garlic tub on the scale. The same 90 seconds settles all four members of the 1.20× cluster.",
  },
  {
    skuName: "Parsley", product: "PARSLEY FRSH FLAT ITAL",
    question: "Price $15.20 is right (divisor 1). Angel measures the 1 lb box at 1.40 lb — 1.40×, which does NOT belong to the 1.20× cluster and for a bunch product is likely a real weight, not an artifact.",
    unblock: "Weigh one box, or read a PFG invoice line. The harvest's own §2(b) says for fresh herbs the invoice weight is the trustworthy side and the pack string should be ignored — but that is a rule, not this box.",
  },
];

// ── Section E: what Angel can never cost ───────────────────────────────────────

/**
 * The permanent supply-run gap.
 *
 * Six items searched for in harvest 2 and genuinely absent from Angel — not a lookup
 * that failed, a category Angel structurally cannot see. Five are low-volume,
 * high-flavour-impact pantry goods and one is resale snacks; all are bought on a
 * grocery or restaurant-supply run rather than off a distributor truck, and Angel
 * can only ever cost what arrives on an integrated vendor's invoice.
 *
 * The useful consequence: these must never be left sitting in a "vendor unknown"
 * queue waiting for a future harvest to resolve them. They will need manual pricing,
 * once, from a receipt — and co-ops can hold that where Angel cannot.
 */
export interface SupplyRunGap {
  skuName: string;
  finding: string;
}

export const PERMANENT_SUPPLY_RUN_GAPS: readonly SupplyRunGap[] = [
  { skuName: "Lemon Oil", finding: "Nothing in Angel. Only lemon JUICE (3 SKUs) and lemonade. Appears on the sandwich build sheet at 0.1 oz." },
  { skuName: "Mixed Herbs", finding: "No product. `SPICES-SEASONINGS` exists as a class but carries no blend SKU. Likely a house mix rather than a purchased SKU." },
  { skuName: "Vanilla Bean Paste", finding: "No \"vanilla\" match anywhere in Angel. 2024 costing sheet has $54.80 / 32 oz with the vendor column blank." },
  { skuName: "White Wine", finding: "No alcohol in the account at all. Alcohol is very likely a purchasing lane we have never modelled." },
  { skuName: "Worcestershire", finding: "Nothing. Nearest condiment is a Cholula hot sauce (US Foods, 4/64 OZ). 2024 sheet: Baldor, $31.79 / 128 oz." },
  { skuName: "Utz Ripples", finding: "NO CHIPS OF ANY KIND across all four vendors — the only \"CHIP\" match is `PICKLES CHIPS 1/4`. Chips are bought outside Angel entirely." },
];

/**
 * Dried Chives — the one hunt that SUCCEEDED, and still cannot be written.
 *
 * Harvest 2 found the product: Monarch chopped chive shaker at US Foods, `6/1.12 OZ`,
 * $9.72/case, true $23.14/lb once the dropped-×6 is undone (Angel prints $138.86).
 * That resolves the VENDOR question completely.
 *
 * What it does not resolve is ours. Our `Dried Chives` SKU carries no vendor, no pack
 * format, no units, no each_size, no avg_oz_per_each — nothing. There is no pack to
 * price. Binding a vendor and a price to a SKU with no pack is how `PICKLES CHIPS`
 * became $35.95/lb, so this stays a decision table with the answer already in it:
 * approve the pack below and the vendor + price follow in one step.
 */
export const DRIED_CHIVES = {
  skuName: "Dried Chives",
  angelProduct: "Spice, Chive Chopped Plastic Shaker Shelf Stable Seasoning",
  brand: "Monarch",
  vendor: "US Foods",
  packSizeRaw: "6/1.12 OZ",
  casePriceUsd: 9.72,
  shakersPerCase: 6,
  ozPerShaker: 1.12,
  angelStatedPricePerLb: 138.86,
  observedDate: "Jul 17, 2026",
  get caseOz(): number {
    return DRIED_CHIVES.shakersPerCase * DRIED_CHIVES.ozPerShaker;
  },
  get truePricePerLb(): number {
    return DRIED_CHIVES.casePriceUsd / (DRIED_CHIVES.caseOz / 16);
  },
} as const;

// ── Refusal vocabulary ─────────────────────────────────────────────────────────

export type Wave3Code =
  | "SKU_UNRESOLVED"
  | "VENDOR_DRIFT"
  | "NO_MEASURED_WEIGHT"
  | "PIECE_WEIGHT_OUT_OF_RANGE"
  | "SLICE_TABLE_DISAGREEMENT"
  | "OPERATIONAL_KEEP_LIVE"
  | "OPERATIONAL_DRIFT"
  | "LIVE_WEIGHT_UNEXPLAINED"
  | "PACK_SHAPE_CHANGED"
  | "OUR_PACK_UNRESOLVABLE"
  | "ALREADY_CORRECT";

export const WAVE3_REASONS: Record<Wave3Code, string> = {
  SKU_UNRESOLVED:
    "The SKU name did not resolve to exactly one ACTIVE, GLOBAL vendor_items row. A weight or price written to the wrong twin is invisible, so this is never guessed at.",
  VENDOR_DRIFT:
    "The SKU resolved but sits under a different vendor than this rule expects. The registry moved under the rule; re-adjudicate rather than rewrite a pack chain on a row that may no longer be the same product.",
  NO_MEASURED_WEIGHT:
    "The rollup carries no `invoice_catch_weight` for this product, so the per-piece weight has no independent invoice-side confirmation. Never derive a pack from an assumed or absent weight.",
  PIECE_WEIGHT_OUT_OF_RANGE:
    "Harvest 2's per-piece weight falls outside the min/max range harvest 1 derived algebraically from the same invoices. The two harvests disagree about the same physical fact — that is a data question, not a fill.",
  SLICE_TABLE_DISAGREEMENT:
    "The piece model's implied oz-per-slice disagrees with Juan's measured slice table by more than the tolerance. His table is floor truth; the row stops and reports rather than overwriting a hand-measured number with a derived one.",
  OPERATIONAL_KEEP_LIVE:
    "RESOLVED by Juan's 2026-08-20 ruling: the live value is his own surprise-measured 3-sample average — the OPERATIONAL weight — and the seed-10 figure was the aspirational/spec one. Live stands, no write. The seed-10 constant is amended to match so a future re-run cannot regress the measurement.",
  OPERATIONAL_DRIFT:
    "The ruling covers this SKU, but LIVE has moved off the ruled operational value AGAIN. That is a new divergence, not the one Juan settled, and it needs a fresh measurement rather than a re-application of the old one.",
  LIVE_WEIGHT_UNEXPLAINED:
    "The LIVE avg_oz_per_each matches neither the spec table nor the piece-derived value, and the ruling does not cover this SKU. Overwriting it would silently change what every consuming recipe depletes, in a direction nobody has signed off. Adjudicate before writing.",
  PACK_SHAPE_CHANGED:
    "The live pack chain is not the shape this correction was written against. Someone changed it since the harvest; re-derive the fix rather than flattening whatever is there now.",
  OUR_PACK_UNRESOLVABLE:
    "Our own SKU cannot say what one pack is: no chain, and the flat columns carry no each_size/each_measure. There is no denominator, and inventing one is the PICKLES CHIPS $35.95/lb failure.",
  ALREADY_CORRECT:
    "The live row already carries the corrected value. Idempotency working — reported, not written.",
};
