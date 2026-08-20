/**
 * Angel catalog → vendor_price_history: the PURE division + classification logic.
 *
 * Zero I/O. Everything here is a total function over data the caller supplies, so
 * the arithmetic that decides what a SKU costs is unit-testable without a database
 * (house law: new mixed modules separate the pure math so it CAN be tested).
 * scripts/seed/17-angel-price-fill.ts is the only I/O shell around it.
 *
 * ── THE ONE IDEA ──────────────────────────────────────────────────────────────
 * `vendor_price_history.unit_price` is the price of ONE OF OUR PACKS. Angel quotes
 * the price of ONE OF ITS CASES. Those are the same number for only 12 of the 38
 * rows where both sides resolve to ounces; for 18 more our pack is one unit inside
 * Angel's case and the price must be DIVIDED (÷2 … ÷36).
 *
 * Getting this wrong is not a rounding error. `HAM 35% WATER FC 4X6 TFF` is $36.06
 * for a `1/13 LB` case = 208 oz; our Ham pack is 16 oz. Writing $36.06 as that SKU's
 * unit_price overstates ham cost THIRTEEN-FOLD. The correct fill is $36.06 ÷ 13 =
 * $2.77/lb — which independently matches the 2024 costing sheet's $2.72 to within
 * 2%. Butter would be 36× wrong, Cheddar 10× wrong. The division IS the job, and a
 * naive bulk import of case prices is the single most dangerous outcome available
 * here (report R3).
 *
 * So there is no inference in this module. The divisor for every fillable row is
 * transcribed from the reconciliation report's §D.2 tables, where a human resolved
 * our pack oz against Angel's case oz row by row. A CSV row with no entry in that
 * table is NOT a candidate — this module never derives a divisor on its own.
 *
 * ── WHAT IT REFUSES, AND WHY EACH REFUSAL IS LOAD-BEARING ─────────────────────
 * DELMAR_NO_PACK_SIZE   All Delmar rows carry a case price and NO denominator
 *                       (flagged NO_PACK_SIZE|BROKER_DIRECT). Report §C.3 is the
 *                       cautionary tale: Angel's own UI turned a $35.95 CASE price
 *                       for PICKLES CHIPS into "$35.95/lb" by assuming a ~1 lb
 *                       pack. Inventing a denominator is how that happens. Blocked
 *                       until Juan supplies real pack sizes (J3).
 * HIGH_PPL_REVIEW       The exporter itself flagged the derived $/lb implausible
 *                       (CHIVES $35.76/lb, THYME $66.16/lb, chive shaker $23.14).
 *                       Arithmetically fine, operationally misleading — tiny herb
 *                       packs genuinely cost a lot per pound. Thyme also disagrees
 *                       with our own sheet by +176%, the largest gap in the dataset.
 * US_FOODS_HISTORICAL   We migrated the US Foods lane to PFG; those rows are old
 *                       order guides, a redundant naming dialect for products we
 *                       now buy from PFG. Cross-check only, never price of record.
 * AMBIGUOUS_PRODUCT_IDENTITY
 *                       `CHEESE MOZZ PROV 50/50 SHRED` may be a second real product
 *                       alongside plain shredded mozz rather than another quote for
 *                       it (Angel lists both with separate spend). Pricing one SKU
 *                       from the other's row is a silent mis-cost. Juan decides (J5).
 * DUPLICATE_CLUSTER     Angel has no canonical-item grouping, so several of its rows
 *                       can quote ONE of our SKUs at wildly different prices — the
 *                       two BASIL FRSH rows are $10.34 and $19.55, an 89% spread for
 *                       the same line item. When two or more surviving candidates
 *                       land on one SKU there is no defensible automatic winner, so
 *                       BOTH are refused and Juan picks (J8). Silently taking the
 *                       first would make the cost depend on CSV row order.
 *
 * Refusals are computed in that order, and the FIRST match wins, so a row that is
 * both a duplicate and untrustworthy reports the stronger reason.
 */

// ── Source rows ────────────────────────────────────────────────────────────────

/** One parsed row of docs/seed/source/angel-product-catalog.csv. */
export interface AngelCatalogRow {
  product: string;
  brand: string;
  vendor: string;
  packSizeRaw: string;
  casePriceUsd: number | null;
  totalSpendUsd: number | null;
  /** Split `flags` column, e.g. ["NO_PACK_SIZE", "BROKER_DIRECT"]. */
  flags: string[];
}

/**
 * Identity of a catalog row. Product name alone is NOT unique: `BASIL FRSH` appears
 * twice under different brands and `OREGANO LEAVES` twice under the same brand with
 * different pack sizes. Brand and pack string are part of the key precisely because
 * those duplicates carry different prices.
 */
export function rowKey(r: { product: string; brand: string; vendor: string; packSizeRaw: string }): string {
  return [r.product, r.brand, r.vendor, r.packSizeRaw].map((s) => s.trim()).join(" | ");
}

// ── The division table (transcribed from report §D.2) ──────────────────────────

/** PACK_AGREES = our pack oz equals Angel's case oz (divisor 1, price as-is).
 *  CASE_MULTIPLE = our pack is one unit inside Angel's case (divide). */
export type PackRelation = "PACK_AGREES" | "CASE_MULTIPLE";

export interface DivisionRule {
  product: string;
  brand: string;
  vendor: string;
  packSizeRaw: string;
  /** Our SKU's `vendor_items.name`. */
  skuName: string;
  relation: PackRelation;
  /** Angel case oz ÷ our pack oz. Always 1 for PACK_AGREES. */
  divisor: number;
  ourPackOz: number;
  angelCaseOz: number;
}

/**
 * Every row the report resolved to a pack relation: 12 PACK_AGREES + 18
 * CASE_MULTIPLE = 30. This is the COMPLETE candidate universe. The other 123 CSV
 * rows have no oz comparison on at least one side (count/volume parse, NO_PACK_SIZE,
 * non-food, or a genuine pack CONFLICT awaiting adjudication) and are deliberately
 * absent — absence here means "not fillable", never "fill it some other way".
 *
 * Every `ourPackOz` below was re-verified against live `vendor_items` on 2026-08-20
 * and all 21 distinct SKUs matched the report exactly.
 */
export const DIVISION_RULES: readonly DivisionRule[] = [
  // ── PACK-AGREES (12) — divisor 1 ────────────────────────────────────────────
  { product: "BEEF GRND BULK 80/20", brand: "WEST CRK", vendor: "PFG", packSizeRaw: "2/5 LB", skuName: "Ground Beef", relation: "PACK_AGREES", divisor: 1, ourPackOz: 160, angelCaseOz: 160 },
  { product: "GARLIC WHL PLD DOM", brand: "PEAK FRS", vendor: "PFG", packSizeRaw: "1/5 LB", skuName: "Garlic", relation: "PACK_AGREES", divisor: 1, ourPackOz: 80, angelCaseOz: 80 },
  { product: "BASIL FRSH", brand: "FRSH ADV", vendor: "PFG", packSizeRaw: "1/1 LB", skuName: "Basil", relation: "PACK_AGREES", divisor: 1, ourPackOz: 16, angelCaseOz: 16 },
  { product: "CREAM HVY WHIPPING 40% TFF", brand: "NTRSBST", vendor: "PFG", packSizeRaw: "12/32 OZ", skuName: "Heavy Cream", relation: "PACK_AGREES", divisor: 1, ourPackOz: 384, angelCaseOz: 384 },
  { product: "CREAM HVY 36% TFF", brand: "NTRSBST", vendor: "PFG", packSizeRaw: "12/32 OZ", skuName: "Heavy Cream", relation: "PACK_AGREES", divisor: 1, ourPackOz: 384, angelCaseOz: 384 },
  { product: "PARSLEY FRSH FLAT ITAL", brand: "PEAK FRS", vendor: "PFG", packSizeRaw: "1/1 LB", skuName: "Parsley", relation: "PACK_AGREES", divisor: 1, ourPackOz: 16, angelCaseOz: 16 },
  { product: "BASIL FRSH", brand: "PEAK FRS", vendor: "PFG", packSizeRaw: "1/1 LB", skuName: "Basil", relation: "PACK_AGREES", divisor: 1, ourPackOz: 16, angelCaseOz: 16 },
  { product: "SOUR CREAM REAL", brand: "DAISY", vendor: "PFG", packSizeRaw: "1/5 LB", skuName: "Sour Cream", relation: "PACK_AGREES", divisor: 1, ourPackOz: 80, angelCaseOz: 80 },
  { product: "Cheese, Ricotta Impastata Whole Milk Tub Ref Del Pastaio", brand: "Grande Cheese Company", vendor: "US Foods", packSizeRaw: "2/5 LB", skuName: "Ricotta", relation: "PACK_AGREES", divisor: 1, ourPackOz: 160, angelCaseOz: 160 },
  { product: "HONEY AMBER EXTRA LIGHT", brand: "WEST CRK", vendor: "PFG", packSizeRaw: "1/5 LB", skuName: "Honey", relation: "PACK_AGREES", divisor: 1, ourPackOz: 80, angelCaseOz: 80 },
  { product: "THYME FRSH", brand: "PEAK FRS", vendor: "PFG", packSizeRaw: "1/4 OZ", skuName: "Thyme", relation: "PACK_AGREES", divisor: 1, ourPackOz: 4, angelCaseOz: 4 },
  { product: "Basil, Fresh Herb", brand: "Cross Valley Farms", vendor: "US Foods", packSizeRaw: "1 LB", skuName: "Basil", relation: "PACK_AGREES", divisor: 1, ourPackOz: 16, angelCaseOz: 16 },

  // ── CASE-MULTIPLE (18) — our pack is one unit inside Angel's case ───────────
  { product: "HAM 35% WATER FC 4X6 TFF", brand: "ROMA", vendor: "PFG", packSizeRaw: "1/13 LB", skuName: "Ham", relation: "CASE_MULTIPLE", divisor: 13, ourPackOz: 16, angelCaseOz: 208 },
  { product: "PORK GRND 80/20 ALL NAT FZ", brand: "WEST CRK", vendor: "PFG", packSizeRaw: "2/5 LB", skuName: "Ground Pork", relation: "CASE_MULTIPLE", divisor: 2, ourPackOz: 80, angelCaseOz: 160 },
  { product: "CHEESE MOZZ LMWM SHRED", brand: "GPREMIO", vendor: "PFG", packSizeRaw: "6/5 LB", skuName: "Shredded Mozz", relation: "CASE_MULTIPLE", divisor: 6, ourPackOz: 80, angelCaseOz: 480 },
  // Tuna is the one rule where angelCaseOz / ourPackOz is not exactly the divisor:
  // 399 / 66.6 = 5.991, not 6. The divisor (6 cans per case) is right; our recorded
  // 66.6 oz is the stale side. Angel's `6/66.5 OZ` parse CONFIRMS 66.5 oz/can, which
  // is report W4's weigh-checklist answer ("is 1 can the big 66.6-oz can or a small
  // ~5-oz one?" — it is the big can). Correcting 66.6 → 66.5 is a SKU weight edit,
  // not a price edit, so it is deliberately not done here; the 0.15% gap does not
  // move the price. Left as-is with the discrepancy documented rather than quietly
  // "tidied" to 66.5, which would misrepresent what the SKU currently says.
  { product: "TUNA CHNK LIGHT CHN", brand: "WRLDDCK", vendor: "PFG", packSizeRaw: "6/66.5OZ", skuName: "Tuna", relation: "CASE_MULTIPLE", divisor: 6, ourPackOz: 66.6, angelCaseOz: 399 },
  { product: "CHEESE CHED SHARP WHI BLOCK TF", brand: "LOL", vendor: "PFG", packSizeRaw: "1/10 LB", skuName: "Cheddar", relation: "CASE_MULTIPLE", divisor: 10, ourPackOz: 16, angelCaseOz: 160 },
  { product: "SALT KSHR COARSE", brand: "DMND CRY", vendor: "PFG", packSizeRaw: "9/3 LB", skuName: "Salt", relation: "CASE_MULTIPLE", divisor: 9, ourPackOz: 48, angelCaseOz: 432 },
  { product: "CHIVES FRSH", brand: "PEAK FRS", vendor: "PFG", packSizeRaw: "1/8 OZ", skuName: "Chives", relation: "CASE_MULTIPLE", divisor: 2, ourPackOz: 4, angelCaseOz: 8 },
  { product: "BUTTER SOLID UNSLTD", brand: "SLVR SRC", vendor: "PFG", packSizeRaw: "36/1 LB", skuName: "Butter", relation: "CASE_MULTIPLE", divisor: 36, ourPackOz: 16, angelCaseOz: 576 },
  { product: "CHEESE MOZZ PROV 50/50 SHRED", brand: "GALBANI", vendor: "PFG", packSizeRaw: "6/5 LB", skuName: "Shredded Mozz", relation: "CASE_MULTIPLE", divisor: 6, ourPackOz: 80, angelCaseOz: 480 },
  { product: "CHEESE RICOTTA IMPASTATA WM", brand: "ROMA", vendor: "PFG", packSizeRaw: "4/5 LB", skuName: "Ricotta", relation: "CASE_MULTIPLE", divisor: 2, ourPackOz: 160, angelCaseOz: 320 },
  { product: "OREGANO LEAVES", brand: "ROMA", vendor: "PFG", packSizeRaw: "1/5 LB", skuName: "Oregano", relation: "CASE_MULTIPLE", divisor: 4, ourPackOz: 20, angelCaseOz: 80 },
  { product: "CHEESE CHED WHI MED LOAF", brand: "TILLAMK", vendor: "PFG", packSizeRaw: "2/5 LB", skuName: "Cheddar", relation: "CASE_MULTIPLE", divisor: 10, ourPackOz: 16, angelCaseOz: 160 },
  { product: "Tuna, Light Skipjack Chunk In Water Can Shelf Stable Imported", brand: "Harvest Value", vendor: "US Foods", packSizeRaw: "6/66.5 OZ", skuName: "Tuna", relation: "CASE_MULTIPLE", divisor: 6, ourPackOz: 66.6, angelCaseOz: 399 },
  { product: "Tomato, Round 4x5 #1 Grade Fresh Ref 2 Layer Box", brand: "Cross Valley Farms", vendor: "US Foods", packSizeRaw: "20 LB", skuName: "Tomatoes", relation: "CASE_MULTIPLE", divisor: 2, ourPackOz: 160, angelCaseOz: 320 },
  { product: "Cheese, Cheddar White Sharp Print Vacuum-Pack Ref", brand: "Glenview Farms", vendor: "US Foods", packSizeRaw: "10 LBA", skuName: "Cheddar", relation: "CASE_MULTIPLE", divisor: 10, ourPackOz: 16, angelCaseOz: 160 },
  { product: "ONION PWDR", brand: "ROMA", vendor: "PFG", packSizeRaw: "1/5 LB", skuName: "Onion Powder", relation: "CASE_MULTIPLE", divisor: 5, ourPackOz: 16, angelCaseOz: 80 },
  { product: "Garlic, White Whole Clove Peeled Fresh Ref", brand: "Cross Valley Farms", vendor: "US Foods", packSizeRaw: "4/5 LB", skuName: "Garlic", relation: "CASE_MULTIPLE", divisor: 4, ourPackOz: 80, angelCaseOz: 320 },
  { product: "Sour Cream, Cultured All Natural Rbst Free Tub Ref", brand: "Glenview Farms", vendor: "US Foods", packSizeRaw: "4/5 LB", skuName: "Sour Cream", relation: "CASE_MULTIPLE", divisor: 4, ourPackOz: 80, angelCaseOz: 320 },
];

// ── Arithmetic ─────────────────────────────────────────────────────────────────

/**
 * Angel case price → the price of ONE OF OUR PACKS, rounded to cents.
 *
 * Rounds half-UP at the cent, deterministically and independent of float
 * representation: two of the real divisions land exactly on a half-cent
 * (TUNA 71.91/6 = 11.985, RICOTTA 68.19/2 = 34.095), so the tie rule is not
 * hypothetical and must not vary.
 *
 * The scaling goes through the string/exponent form rather than `x * 100` because
 * multiplying by 100 is not always exact in IEEE-754: `1.005 * 100` is
 * 100.49999999999999, which rounds DOWN and loses a cent. (Today's two ties happen
 * to scale cleanly — 34.095 * 100 is exactly 3409.5 — but that is luck about these
 * particular numbers, not a property of the operation, and a future export will
 * bring different ones.) `Number("1.005e2")` is decimal-exact and gives 100.5.
 *
 * Cents is the right storage precision — unit_price is a price, and every consumer
 * renders it as dollars. Nothing is lost: the exact quotient and the divisor are
 * written verbatim into `vendor_price_history.source_note`, so any number here can
 * be reconstructed and audited.
 *
 * Throws on a non-finite/non-positive case price or a non-positive divisor rather
 * than emitting a nonsense price — a bad price is worse than a missing one.
 */
export function computePackUnitPrice(casePriceUsd: number, divisor: number): number {
  if (!Number.isFinite(casePriceUsd) || casePriceUsd <= 0) {
    throw new Error(`computePackUnitPrice: case price must be a positive finite number, got ${casePriceUsd}`);
  }
  if (!Number.isFinite(divisor) || divisor <= 0) {
    throw new Error(`computePackUnitPrice: divisor must be a positive finite number, got ${divisor}`);
  }
  const exact = casePriceUsd / divisor;
  // Decimal-exact scale-by-100 (avoids the 34.095 → 3409.4999… binary artifact).
  const scaled = Number(`${exact}e2`);
  return Number(`${Math.round(scaled)}e-2`);
}

/** The exact, unrounded quotient — for the provenance note, so the rounding is visible. */
export function exactQuotient(casePriceUsd: number, divisor: number): number {
  return casePriceUsd / divisor;
}

// ── Classification ─────────────────────────────────────────────────────────────

export type RefusalCode =
  | "DELMAR_NO_PACK_SIZE"
  | "HIGH_PPL_REVIEW"
  | "US_FOODS_HISTORICAL"
  | "AMBIGUOUS_PRODUCT_IDENTITY"
  | "DUPLICATE_CLUSTER";

export const REFUSAL_REASONS: Record<RefusalCode, string> = {
  DELMAR_NO_PACK_SIZE: "Delmar row: case price with NO pack denominator (NO_PACK_SIZE|BROKER_DIRECT). Blocked on Juan supplying real pack sizes (report R1 / J3).",
  HIGH_PPL_REVIEW: "Exporter flagged the derived $/lb implausible (HIGH_PPL_REVIEW). Not a parse bug — a tiny-pack category-band artifact. Never propagate as a commodity price (report R2).",
  US_FOODS_HISTORICAL: "US Foods row: a historical order guide for a lane already migrated to PFG. Cross-check only, never the price of record (report R6).",
  AMBIGUOUS_PRODUCT_IDENTITY: "Product identity unresolved — may be a second real product rather than another quote for this SKU. Juan decides (report J5).",
  DUPLICATE_CLUSTER: "Two or more surviving candidates quote this one SKU at different prices; there is no defensible automatic winner. Juan picks the row of record (report J8).",
};

/** Products whose identity is unresolved (report §B.2 / J5), keyed by product name. */
const AMBIGUOUS_PRODUCTS = new Set(["CHEESE MOZZ PROV 50/50 SHRED"]);

export interface FillCandidate {
  rule: DivisionRule;
  row: AngelCatalogRow;
  casePriceUsd: number;
  unitPrice: number;
  exact: number;
  /** True when rounding to cents moved the number (a half-cent tie). */
  rounded: boolean;
}

export interface Refusal {
  rule: DivisionRule | null;
  row: AngelCatalogRow;
  code: RefusalCode;
  reason: string;
}

export interface Classification {
  fills: FillCandidate[];
  refusals: Refusal[];
  /** CSV rows with no entry in DIVISION_RULES — not fillable, by construction. */
  notCandidates: AngelCatalogRow[];
}

/** Per-row refusal that does not depend on other rows. Order matters: strongest first. */
function standaloneRefusal(row: AngelCatalogRow): RefusalCode | null {
  if (row.vendor.trim() === "Delmar Provisions" || row.flags.includes("NO_PACK_SIZE")) return "DELMAR_NO_PACK_SIZE";
  if (row.flags.includes("HIGH_PPL_REVIEW")) return "HIGH_PPL_REVIEW";
  if (row.vendor.trim() === "US Foods") return "US_FOODS_HISTORICAL";
  if (AMBIGUOUS_PRODUCTS.has(row.product.trim())) return "AMBIGUOUS_PRODUCT_IDENTITY";
  return null;
}

/**
 * Split the catalog into what may be written, what is refused (with the reason), and
 * what was never a candidate.
 *
 * Two passes, and the order is the point: standalone refusals are applied FIRST, so
 * duplicate-cluster detection runs over SURVIVORS only. That matters — Ricotta is
 * quoted by a PFG row and a US Foods row, and Tuna, Sour Cream and Garlic likewise.
 * Counting those as clusters would refuse a perfectly good PFG fill because a
 * historical row we already reject happened to name the same SKU. After the US Foods
 * rows drop out, the genuine contests are the ones where two live PFG rows disagree.
 */
export function classify(rows: readonly AngelCatalogRow[]): Classification {
  const ruleByKey = new Map(DIVISION_RULES.map((r) => [rowKey(r), r]));

  const fills: FillCandidate[] = [];
  const refusals: Refusal[] = [];
  const notCandidates: AngelCatalogRow[] = [];

  // Pass 1 — candidacy + standalone refusals.
  const survivors: Array<{ rule: DivisionRule; row: AngelCatalogRow }> = [];
  for (const row of rows) {
    const rule = ruleByKey.get(rowKey(row));
    if (!rule) {
      // Still surface a refusal for the flagged rows the report tiers as
      // UNTRUSTWORTHY, so they are explicitly logged as refused rather than
      // quietly dropped into "not a candidate".
      const code = standaloneRefusal(row);
      if (code === "DELMAR_NO_PACK_SIZE" || code === "HIGH_PPL_REVIEW") {
        refusals.push({ rule: null, row, code, reason: REFUSAL_REASONS[code] });
      } else {
        notCandidates.push(row);
      }
      continue;
    }
    const code = standaloneRefusal(row);
    if (code) {
      refusals.push({ rule, row, code, reason: REFUSAL_REASONS[code] });
      continue;
    }
    survivors.push({ rule, row });
  }

  // Pass 2 — duplicate clusters among survivors only.
  const bySku = new Map<string, Array<{ rule: DivisionRule; row: AngelCatalogRow }>>();
  for (const s of survivors) {
    const list = bySku.get(s.rule.skuName) ?? [];
    list.push(s);
    bySku.set(s.rule.skuName, list);
  }

  for (const s of survivors) {
    const contenders = bySku.get(s.rule.skuName)!;
    if (contenders.length > 1) {
      refusals.push({ rule: s.rule, row: s.row, code: "DUPLICATE_CLUSTER", reason: REFUSAL_REASONS.DUPLICATE_CLUSTER });
      continue;
    }
    const casePriceUsd = s.row.casePriceUsd;
    if (casePriceUsd == null || !Number.isFinite(casePriceUsd) || casePriceUsd <= 0) {
      notCandidates.push(s.row);
      continue;
    }
    const exact = exactQuotient(casePriceUsd, s.rule.divisor);
    const unitPrice = computePackUnitPrice(casePriceUsd, s.rule.divisor);
    fills.push({ rule: s.rule, row: s.row, casePriceUsd, unitPrice, exact, rounded: unitPrice !== exact });
  }

  return { fills, refusals, notCandidates };
}

/**
 * The provenance string for `vendor_price_history.source_note`. Names the Angel row
 * verbatim (product + brand + pack string — the full identity, because product name
 * alone is ambiguous) and shows the arithmetic, including the unrounded quotient
 * whenever rounding moved the number.
 */
export function buildSourceNote(f: FillCandidate): string {
  const id = `${f.rule.product} [${f.rule.brand || "no brand"}] ${f.rule.packSizeRaw}`;
  const money = (n: number) => `$${n.toFixed(2)}`;
  if (f.rule.relation === "PACK_AGREES") {
    return `${id} | case ${money(f.casePriceUsd)} = ${f.rule.angelCaseOz} oz, equals our ${f.rule.ourPackOz} oz pack → ${money(f.unitPrice)} per pack (no division)`;
  }
  const exactStr = f.rounded ? ` (exact ${f.exact}, rounded to cents)` : "";
  return `${id} | case ${money(f.casePriceUsd)} = ${f.rule.angelCaseOz} oz ÷ ${f.rule.divisor} = our ${f.rule.ourPackOz} oz pack → ${money(f.unitPrice)} per pack${exactStr}`;
}

// ── CSV parsing (pure) ─────────────────────────────────────────────────────────

/**
 * Minimal RFC-4180 field splitter: handles quoted fields containing commas and
 * doubled quotes (`""`). Both appear in the real export — several US Foods product
 * names are comma-laden and `Onion, Yellow Jumbo 3""+ Fresh Ref Bag` carries an
 * escaped quote. A naive `split(",")` shears those rows into the wrong columns and
 * silently mis-prices them, so this is not incidental.
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function numOrNull(s: string | undefined): number | null {
  const t = (s ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Parse the whole CSV text into rows. Header-driven (column ORDER is not assumed). */
export function parseAngelCatalog(csvText: string): AngelCatalogRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]!).map((h) => h.trim());
  const idx = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`parseAngelCatalog: expected column "${name}" in the header, got: ${header.join(", ")}`);
    return i;
  };
  const iProduct = idx("product"), iBrand = idx("brand"), iVendor = idx("vendor");
  const iPack = idx("pack_size_raw"), iPrice = idx("latest_price_per_case_usd");
  const iSpend = idx("total_spend_usd"), iFlags = idx("flags");

  return lines.slice(1).map((line) => {
    const c = parseCsvLine(line);
    return {
      product: (c[iProduct] ?? "").trim(),
      brand: (c[iBrand] ?? "").trim(),
      vendor: (c[iVendor] ?? "").trim(),
      packSizeRaw: (c[iPack] ?? "").trim(),
      casePriceUsd: numOrNull(c[iPrice]),
      totalSpendUsd: numOrNull(c[iSpend]),
      flags: (c[iFlags] ?? "").split("|").map((f) => f.trim()).filter((f) => f !== ""),
    };
  });
}
