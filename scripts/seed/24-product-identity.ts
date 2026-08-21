/**
 * Seed 24 — product identity: create products, attach member SKUs, set primaries.
 *
 * Phase 2 of docs/superpowers/plans/2026-08-20-product-identity.md (spec §2).
 * Migration 0179 ships the tables; this fills them. **Pure data, zero behavior
 * change** — nothing in the app reads `vendor_items.product_id` until Phase 3, and
 * this script never touches `active`, `weekday_par` or `weekend_par`, which is what
 * makes it safe to run in front of a live order walk.
 *
 * ── WHAT A PRODUCT IS FOR (and why only 12 of them exist) ─────────────────────
 * A product is the raw identity a recipe means ("HAM"), independent of which vendor
 * supplied it. A SKU with `product_id` NULL is an implicit SINGLETON — resolution is
 * trivially itself — so ~95% of the catalog needs no row here. Products are created
 * where PLURALITY exists: the multi-vendor names, plus ICEBERG (spec §Payoff), which
 * is named explicitly because a $3,230.74 attribution question needs a grain to live
 * at even while it has one member.
 *
 * ── THE DRY RUN IS THE DECISION DOCUMENT ──────────────────────────────────────
 * Seed 18's convention, kept. Default mode writes nothing and prints:
 *   (1) a DISCOVERY report computed live — which names carry 2+ vendors TODAY,
 *       never trusted from the audit's list;
 *   (2) the plan, per product;
 *   (3) THE DECISION TABLE — the 8 unadjudicated pairs, each with a best-reading
 *       default that Juan's eyeball confirms or amends. That table IS gate S1.
 *   (4) the ICEBERG attribution question, presented and NOT resolved.
 *
 * ── WHAT IS ALREADY RULED, AND WHERE THAT IS AN INFERENCE ─────────────────────
 * HAM — PFG primary, Baldor backup. EXPLICIT (Juan 2026-08-20; the Angel row behind
 *   the $2,164.94 spend is a PFG product). Source: seed 18.
 * FRESH MOZZARELLA — PFG primary, Baldor backup. **INFERRED**, flagged as such by
 *   seed 18 and still flagged here: Juan named the SHAPE ("both — one primary, one
 *   backup"), not the sides. Veto is one field.
 * LETTUCE — Sysco primary, Baldor backup. **INFERRED**, flagged by seed 21 wave 4
 *   §B: Sysco is the currently-active twin and the only one with a pack chain.
 * THE OTHER 8 — unruled. They get a product row and members and **NO PRIMARY ROW**,
 *   because a primary nobody designated is a fact invented by a script. Resolution
 *   then answers on the ladder's lower rungs, which is honest and (verified live,
 *   printed in the report) lands on the same member the default proposes.
 *
 * Say so out loud rather than letting an inference harden into a fact — seed 18's
 * discipline, verbatim.
 *
 * ── unit_oz: RULED VALUES ONLY ────────────────────────────────────────────────
 * `products.unit_oz` is what ONE unit of the product weighs, and it is the whole
 * reason a product-pinned recipe line survives a member flip (deviation D2). It is
 * seeded ONLY from `OPERATIONAL_SLICE_OZ` (lib/angel-wave3.ts) — Juan's own surprise
 * 3-sample weighings — with class OPERATIONAL. Products whose members happen to
 * agree on `avg_oz_per_each` are REPORTED as candidates and left NULL: an agreement
 * between two estimates is not a measurement, and NULL is the honest value (the 0161
 * LOCK-1 doctrine).
 *
 * ── THE FOUR WRITE-LOOP INVARIANTS (seed 18/20, verbatim) ─────────────────────
 *   1. re-read the live row at write time and FATAL on a name/vendor change;
 *   2. idempotency skip when the value already matches;
 *   3. plan-drift REFUSAL when the before-value moved under us — "re-run the dry run";
 *   4. `if (!count) throw` on every UPDATE (Supabase swallows constraint violations
 *      and an UPDATE that matched nothing returns no error).
 * Plus one this script adds because gate S1 verifies it: an ORDERABILITY assertion.
 * Every member's (active, weekday_par, weekend_par) is snapshotted before the writes
 * and re-read after; any movement is FATAL. This seed attaches identity — it does
 * not adjudicate orderability, and re-litigating seed 18's P1 decision by accident
 * is exactly the failure the assertion exists to make impossible.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/24-product-identity.ts
 *        → DRY RUN (default). Prints discovery + plan + decision table. Writes nothing.
 *      ... 24-product-identity.ts --markdown   → the same, as markdown (authors the report doc)
 *      ... 24-product-identity.ts --execute    → WRITES. 🔒 GATE S1 — LEAD ONLY, after
 *                                                Juan adjudicates the 8 pairs.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { loadMeasures, loadSkuPackChains } from "@/lib/prep-consumption";
import { skuContentOz, type MeasureUnitFactor } from "@/lib/recipe-math";
import {
  resolveProductMember,
  membersDisagreeOnUnitOz,
  type ProductMember,
} from "@/lib/products-shared";
import { OPERATIONAL_SLICE_OZ } from "@/lib/angel-wave3";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import { pathToFileURL } from "node:url";

const EXECUTE = process.argv.includes("--execute");
const MD = process.argv.includes("--markdown");

const SCRIPT = "scripts/seed/24-product-identity.ts";
const SOURCE_REPORT = "docs/seed/source/product-seed-dryrun.md";
const PHASE = "product_identity";
const DECISION_SOURCES =
  "docs/superpowers/specs/2026-08-20-product-identity-design.md §2 · " +
  "docs/superpowers/plans/2026-08-20-product-identity.md Phase 2 · " +
  "docs/seed/source/twin-adjudication-dryrun.md (ham/mozz) · " +
  "docs/seed/source/angel-wave4-dryrun.md §B (lettuce), §D1 (the 8 pairs)";

// ── Output helpers (seed 21's idiom — one writer for both renderings) ──────────

function h(level: number, text: string): void {
  console.log(
    MD
      ? `\n${"#".repeat(level)} ${text}\n`
      : `\n${"─".repeat(3)} ${text.toUpperCase()} ${"─".repeat(Math.max(3, 70 - text.length))}\n`,
  );
}
function p(text = ""): void {
  console.log(text);
}
function pre(): void {
  if (MD) console.log("```");
}

function table(head: string[], rows: string[][], align: string[] = []): void {
  if (rows.length === 0) {
    p(MD ? "_(none)_" : "  (none)");
    return;
  }
  if (MD) {
    // A bare `|` inside a cell silently shears the row into the wrong columns, and
    // pack descriptors legitimately contain one. Escaped here rather than at every
    // call site — the fix that cannot be forgotten.
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
const money = (n: number) =>
  `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

/** The ladder's rung, spelled the way the spec numbers it. */
const RUNG_LABEL: Record<string, string> = {
  primary: "1 · flagged primary",
  recent: "2 · most-recently-received",
  any: "3 · any active member",
  unresolved: "4 · unresolved",
};
const ozStr = (v: number | null) => (v == null ? "—" : `${Number(v.toFixed(4))} oz`);
const parStr = (wd: number | null, we: number | null) =>
  wd == null && we == null ? "—" : `${wd ?? "–"}/${we ?? "–"}`;

// ── The plan (the evidence table) ─────────────────────────────────────────────

/** One member SKU of a planned product. Matched on (name, vendor) — never on id
 *  alone, because both members share a NAME and only the pair identifies the row. */
interface MemberPlan {
  skuName: string;
  expectVendor: string;
}

/** A primary designation somebody actually made. */
interface PrimaryPlan {
  /** null = the GLOBAL default (the vendor_cutoffs / vendor_items house idiom, D6).
   *  No per-location primary is seeded: no location has ever disagreed, and a row
   *  per shop that agrees is noise Juan would have to maintain twice. */
  locationId: null;
  vendor: string;
  /** TRUE where "primary" is read off the evidence rather than said by Juan. */
  isInferred: boolean;
  /** Who decided, and when. Rides into the audit row. */
  decidedBy: string;
  basis: string;
}

/** A primary NOBODY has designated — printed as a proposal, never written. */
interface ProposedPrimary {
  vendor: string;
  rationale: string;
}

interface UnitOzPlan {
  value: number;
  klass: string;
  sourceNote: string;
}

interface ProductPlan {
  name: string;
  notes: string;
  members: MemberPlan[];
  /** Exactly one of these two is non-null. A ruled product gets `primary`; an
   *  unruled one gets `proposed` and NO product_primaries row. */
  primary: PrimaryPlan | null;
  proposed: ProposedPrimary | null;
  unitOz: UnitOzPlan | null;
  /** Mandatory: WHO decided this product exists in this shape, and whether any part
   *  of it is an inference. Seed 18's rule — an inference that is not said out loud
   *  hardens into a fact. */
  decision: string;
}

/** Juan's own operational weighing, recorded as the source note on every unit_oz. */
const OPERATIONAL_NOTE =
  "Juan's surprise 3-sample slice weighing, 2026-08-20 (OPERATIONAL_SLICE_OZ, lib/angel-wave3.ts:267). " +
  "Not a spec figure and not an invoice derivation — a measurement on the line.";

/** The shape all 8 unruled pairs share, live-verified 2026-08-20 (wave 4 §D1). */
const BH_SHAPE_RATIONALE =
  "Boar's Head is the only ACTIVE member and holds the par; the Baldor twin is inactive, parless and priceless. " +
  "The resolution ladder already answers Boar's Head today (rung 3 — see the ladder column); a primary row makes " +
  "that explicit and keeps it true the day the Baldor row is reactivated as a backup.";

const PRODUCTS: readonly ProductPlan[] = [
  {
    name: "Ham",
    notes:
      "Two vendors, both active since seed 18. PFG holds the par ($2,164.94/yr of Angel spend is a PFG row); Baldor is the backup.",
    members: [
      { skuName: "Ham", expectVendor: "PFG" },
      { skuName: "Ham", expectVendor: "Baldor" },
    ],
    primary: {
      locationId: null,
      vendor: "PFG",
      isInferred: false,
      decidedBy: "Juan 2026-08-20 (explicit)",
      basis:
        "The Angel row behind the spend (`HAM 35% WATER FC 4X6 TFF` [ROMA], $2,164.94/yr) is a PFG product, and PFG is the live distributor lane. Recorded in seed 18.",
    },
    proposed: null,
    unitOz: { value: OPERATIONAL_SLICE_OZ.Ham!, klass: "OPERATIONAL", sourceNote: OPERATIONAL_NOTE },
    decision:
      "Juan 2026-08-20, EXPLICIT — PFG primary / Baldor backup (seed 18). unit_oz 1.2 is his own weighing; it is what unblocks the Phase-4 ham re-point that seed 18 refused itself over.",
  },
  {
    name: "Fresh Mozzarella",
    notes: "Two vendors, both active since seed 18. PFG holds the par; Baldor is the backup.",
    members: [
      { skuName: "Fresh Mozzarella", expectVendor: "PFG" },
      { skuName: "Fresh Mozzarella", expectVendor: "Baldor" },
    ],
    primary: {
      locationId: null,
      vendor: "PFG",
      isInferred: true,
      decidedBy: "Juan 2026-08-20 (shape only) — SIDE INFERRED by seed 18",
      basis:
        "Juan said 'both — one primary, one backup' without naming which. PFG was inferred from the same evidence shape as ham (`CHEESE MOZZ 1OZ SLCD LOG 32 CT` [ROMA] is a PFG row, $1,365.90/yr) and from ham's explicit answer. Veto = swap the vendor on this one line.",
    },
    proposed: null,
    unitOz: null,
    decision:
      "Juan 2026-08-20 for the SHAPE; the SIDE is an INFERENCE carried forward from seed 18 and still flagged. No unit_oz: mozzarella is not in OPERATIONAL_SLICE_OZ, so nobody has weighed it.",
  },
  {
    name: "Lettuce",
    notes:
      "Two vendors, both active since seed 21 (wave 4 §B). Neither twin has ever carried a par — the pair is correctly shaped and still unorderable, and a par is a floor decision.",
    members: [
      { skuName: "Lettuce", expectVendor: "Sysco" },
      { skuName: "Lettuce", expectVendor: "Baldor" },
    ],
    primary: {
      locationId: null,
      vendor: "Sysco",
      isInferred: true,
      decidedBy: "Juan 2026-08-20 (shape only) — SIDE INFERRED by seed 21 wave 4 §B",
      basis:
        "Juan named the shape (both-active, primary + backup, like ham). Sysco was inferred because it is the currently-active twin and the only one with a pack chain (box = 15 × 15 oz = 225 oz); the Baldor row is packless, priceless and pinless. Veto = swap the vendor on this one line.",
    },
    proposed: null,
    unitOz: null,
    decision:
      "Juan 2026-08-20 for the SHAPE; the SIDE is an INFERENCE carried forward from wave 4 §B and still flagged. See the ICEBERG section — whether this product and ICEBERG are ONE product is an OPEN question this seed does not answer.",
  },
  {
    name: "Iceberg",
    notes:
      "One member today (PFG/Iceberg — active, par 4, one recipe pin, 640 oz case). The product row exists because the $3,230.74 Angel attribution question needs a grain to live at, not because plurality exists yet.",
    members: [{ skuName: "Iceberg", expectVendor: "PFG" }],
    primary: null,
    proposed: null,
    unitOz: null,
    decision:
      "Created per spec §2/§Payoff ('ICEBERG product absorbs the $3,231 attribution'). NO primary row: with exactly one member the ladder already answers it on rung 3, and designating a primary before the MEMBERSHIP question is settled would encode an answer to the open question. See the ICEBERG section.",
  },
  {
    name: "Turkey",
    notes: "Boar's Head active + par 9/22; Baldor inactive, parless, pinless.",
    members: [
      { skuName: "Turkey", expectVendor: "Boar's Head" },
      { skuName: "Turkey", expectVendor: "Baldor" },
    ],
    primary: null,
    proposed: { vendor: "Boar's Head", rationale: BH_SHAPE_RATIONALE },
    unitOz: null,
    decision: "UNADJUDICATED — awaiting Juan (gate S1). Product + members only; NO primary row is written.",
  },
  {
    name: "Roast Beef",
    notes: "Boar's Head active + par 2/4; Baldor inactive, parless, pinless.",
    members: [
      { skuName: "Roast Beef", expectVendor: "Boar's Head" },
      { skuName: "Roast Beef", expectVendor: "Baldor" },
    ],
    primary: null,
    proposed: { vendor: "Boar's Head", rationale: BH_SHAPE_RATIONALE },
    unitOz: null,
    decision: "UNADJUDICATED — awaiting Juan (gate S1). Product + members only; NO primary row is written.",
  },
  {
    name: "Provolone",
    notes: "Boar's Head active + par 8/16; Baldor inactive, parless, pinless.",
    members: [
      { skuName: "Provolone", expectVendor: "Boar's Head" },
      { skuName: "Provolone", expectVendor: "Baldor" },
    ],
    primary: null,
    proposed: { vendor: "Boar's Head", rationale: BH_SHAPE_RATIONALE },
    unitOz: { value: OPERATIONAL_SLICE_OZ.Provolone!, klass: "OPERATIONAL", sourceNote: OPERATIONAL_NOTE },
    decision:
      "UNADJUDICATED primary — awaiting Juan. unit_oz 0.7 IS ruled (Juan's own weighing) and is written regardless: what one slice weighs is a fact about the product, not about which vendor sells it.",
  },
  {
    name: "Capicola",
    notes: "Boar's Head active + par 8/16; Baldor inactive, parless, pinless.",
    members: [
      { skuName: "Capicola", expectVendor: "Boar's Head" },
      { skuName: "Capicola", expectVendor: "Baldor" },
    ],
    primary: null,
    proposed: { vendor: "Boar's Head", rationale: BH_SHAPE_RATIONALE },
    unitOz: { value: OPERATIONAL_SLICE_OZ.Capicola!, klass: "OPERATIONAL", sourceNote: OPERATIONAL_NOTE },
    decision:
      "UNADJUDICATED primary — awaiting Juan. unit_oz 0.4 IS ruled (Juan's own weighing) and is written regardless.",
  },
  {
    name: "Pepperoni",
    notes: "Boar's Head active + par 3/5; Baldor inactive, parless, pinless.",
    members: [
      { skuName: "Pepperoni", expectVendor: "Boar's Head" },
      { skuName: "Pepperoni", expectVendor: "Baldor" },
    ],
    primary: null,
    proposed: { vendor: "Boar's Head", rationale: BH_SHAPE_RATIONALE },
    unitOz: { value: OPERATIONAL_SLICE_OZ.Pepperoni!, klass: "OPERATIONAL", sourceNote: OPERATIONAL_NOTE },
    decision:
      "UNADJUDICATED primary — awaiting Juan. unit_oz 0.2 IS ruled (Juan's own weighing) and is written regardless.",
  },
  {
    name: "Banana Peppers",
    notes:
      "Boar's Head active + par 1/–; Baldor inactive. NOTE: the Baldor row carries avg_oz_per_each = 512 and is the ONLY member of any candidate product with a delivery line on file.",
    members: [
      { skuName: "Banana Peppers", expectVendor: "Boar's Head" },
      { skuName: "Banana Peppers", expectVendor: "Baldor" },
    ],
    primary: null,
    proposed: { vendor: "Boar's Head", rationale: BH_SHAPE_RATIONALE },
    unitOz: null,
    decision: "UNADJUDICATED — awaiting Juan (gate S1). Product + members only; NO primary row is written.",
  },
  {
    name: "Hot Peppers",
    notes:
      "Boar's Head active + par 6/8; Baldor inactive — but UNLIKE the other seven, BOTH members carry a recipe pin (audit gap P5: two Hot Peppers recipes pin different vendors, and buildRecipeGraph first-wins between them).",
    members: [
      { skuName: "Hot Peppers", expectVendor: "Boar's Head" },
      { skuName: "Hot Peppers", expectVendor: "Baldor" },
    ],
    primary: null,
    proposed: { vendor: "Boar's Head", rationale: BH_SHAPE_RATIONALE },
    unitOz: null,
    decision:
      "UNADJUDICATED — awaiting Juan (gate S1). This is the ONE pair that is not the common shape: a pin sits on the INACTIVE Baldor row too. Product identity is what eventually fixes that (Phase 4 re-points both pins at the product), but this seed does not touch a pin.",
  },
  {
    name: "Sweet Peppers",
    notes: "Boar's Head active + par 6/8; Baldor inactive, parless, pinless.",
    members: [
      { skuName: "Sweet Peppers", expectVendor: "Boar's Head" },
      { skuName: "Sweet Peppers", expectVendor: "Baldor" },
    ],
    primary: null,
    proposed: { vendor: "Boar's Head", rationale: BH_SHAPE_RATIONALE },
    unitOz: null,
    decision: "UNADJUDICATED — awaiting Juan (gate S1). Product + members only; NO primary row is written.",
  },
];

/**
 * Angel's four iceberg rows — the $3,230.74 that attributes to no SKU we hold.
 * Verbatim from docs/seed/source/angel-wave4-dryrun.md §B1 (itself derived live from
 * docs/angel-products-rollup.csv). Evidence for a DECISION, never for a write.
 */
const ICEBERG_ANGEL_ROWS: ReadonlyArray<{
  row: string;
  brand: string;
  vendor: string;
  pack: string;
  lines: number;
  spend: number;
  note: string;
}> = [
  {
    row: "LETTUCE ICEBERG LINER",
    brand: "PEAK FRS",
    vendor: "PFG",
    pack: "24/1 CT",
    lines: 5,
    spend: 1937.92,
    note: "The dominant row by a distance — 61 units. ~42 lb per 24-count case ≈ 1.75 lb/head, which reads like whole heads.",
  },
  {
    row: "Lettuce, Iceberg Cleaned & Trimmed Fresh Ref",
    brand: "Cross Valley Farms",
    vendor: "US Foods",
    pack: "4/6 EA",
    lines: 5,
    spend: 1050.15,
    note: "The biggest percentage price mover in the whole harvest (+70.1%). On the US Foods lane we migrated away from.",
  },
  {
    row: "LETTUCE ICEBERG C&T",
    brand: "PACKER",
    vendor: "PFG",
    pack: "4/6 CT",
    lines: 3,
    spend: 140.61,
    note: "PFG's own cleaned-&-trimmed line. Price never moved across 3 lines.",
  },
  {
    row: "LETTUCE CELLO ICEBERG CA",
    brand: "PACKER",
    vendor: "PFG",
    pack: "1/24 CT",
    lines: 2,
    spend: 102.06,
    note: "Cello-wrapped, 24 count. The most likely occasional substitute rather than a standing buy.",
  },
];

/**
 * Claims the SOURCE DOCUMENTS make about live state, each re-checked against prod
 * at run time. Discipline zero, made executable: a plan drifts from ground truth and
 * the live system wins, so a seed that quietly assumes a stale sentence is the bug
 * class this table exists to catch. A MOVED row is information, never a failure —
 * it is reported so the reader knows which paragraph of the plan to stop trusting.
 */
const SOURCE_CLAIMS: ReadonlyArray<{
  claim: string;
  source: string;
  /** (name, vendor) of the SKU the claim is about. */
  sku: [string, string];
  /** Reads the live row; returns what is true NOW. */
  observe: (s: LiveSku) => string;
  /** What the source document said. */
  expected: string;
}> = [
  {
    claim: "PFG/Ham carries avg_oz_per_each = NULL, so a product pin would resolve to null on the PFG side",
    source: "seed 18 dry run · plan deviation D2",
    sku: ["Ham", "PFG"],
    observe: (s) => (s.avgOzPerEach == null ? "NULL" : String(s.avgOzPerEach)),
    expected: "NULL",
  },
  {
    claim: "the Ham recipe pin sits on the BALDOR twin (seed 18 refused to move it)",
    source: "seed 18 dry run §3 · audit P1 update",
    sku: ["Ham", "Baldor"],
    observe: (s) => `${s.pins} pin(s) on Baldor/Ham`,
    expected: "1 pin(s) on Baldor/Ham",
  },
  {
    claim: "PFG/Fresh Mozzarella carries avg_oz_per_each = NULL and its pack content is UNRESOLVABLE",
    source: "seed 18 dry run §4",
    sku: ["Fresh Mozzarella", "PFG"],
    observe: (s) => `${s.avgOzPerEach == null ? "NULL" : s.avgOzPerEach} / content ${ozStr(s.contentOz)}`,
    expected: "NULL / content —",
  },
  {
    claim: "Baldor/Lettuce is INACTIVE",
    source: "wave 4 §D1 table (before its §B activation ran)",
    sku: ["Lettuce", "Baldor"],
    observe: (s) => (s.active ? "active" : "inactive"),
    expected: "inactive",
  },
];

// ── Live shapes ───────────────────────────────────────────────────────────────

interface LiveSku {
  id: string;
  name: string;
  vendorId: string | null;
  vendorName: string;
  active: boolean;
  locationId: string | null;
  weekdayPar: number | null;
  weekendPar: number | null;
  avgOzPerEach: number | null;
  unitsPerPack: number | null;
  eachSize: number | null;
  eachMeasure: string | null;
  packFormat: string | null;
  productId: string | null;
  chain: PackChainLevel[];
  contentOz: number | null;
  pins: number;
  latestPrice: { unitPrice: number | null; effectiveDate: string | null; source: string | null } | null;
  /** Most recent vendor_delivery_items.created_at, per location id. */
  lastReceivedByLocation: Map<string, string>;
}

interface LiveProductRow {
  id: string;
  name: string;
  unit_oz: number | string | null;
  unit_oz_class: string | null;
  active: boolean | null;
}

interface LivePrimaryRow {
  id: string;
  product_id: string;
  location_id: string | null;
  primary_sku_id: string;
}

interface Catalog {
  skus: LiveSku[];
  byKey: Map<string, LiveSku[]>;
  products: LiveProductRow[];
  primaries: LivePrimaryRow[];
  locations: Array<{ id: string; name: string }>;
  /**
   * lower(name) → the Spanish name the PREP layer already uses for this thing.
   * Sourced from the ACTIVE `items` row of the same name, never invented: the
   * kitchen has been calling ham "Jamón" since the operational seed, and a product
   * inventing a second Spanish word for the same thing is the drift the
   * system-key-vs-display-string rule exists to prevent. Ambiguous (0 or 2+ active
   * matches) → absent → the product's `name_es` stays NULL, which is honest.
   */
  itemNameEs: Map<string, string>;
}

const key = (name: string) => name.trim().toLowerCase();

type Sb = ReturnType<typeof getServiceRoleClient>;

/**
 * The whole live picture in a fixed number of batch queries — never per-product
 * (the loadRecipeGraph law, applied to a seed so a re-run stays cheap).
 */
async function loadCatalog(sb: Sb, measures: Map<string, MeasureUnitFactor>): Promise<Catalog> {
  const { data: skuRows, error: sErr } = await sb
    .from("vendor_items")
    .select(
      "id, name, vendor_id, active, location_id, weekday_par, weekend_par, avg_oz_per_each, units_per_pack, each_size, each_measure, pack_format, product_id, vendors(name)",
    )
    .returns<
      Array<{
        id: string;
        name: string;
        vendor_id: string | null;
        active: boolean | null;
        location_id: string | null;
        weekday_par: number | string | null;
        weekend_par: number | string | null;
        avg_oz_per_each: number | string | null;
        units_per_pack: number | null;
        each_size: number | string | null;
        each_measure: string | null;
        pack_format: string | null;
        product_id: string | null;
        vendors: { name: string } | null;
      }>
    >();
  if (sErr) throw new Error(`load vendor_items: ${sErr.message}`);
  const rows = skuRows ?? [];
  if (rows.length === 0) throw new Error("FATAL: vendor_items loaded empty — refusing to reason about an empty catalog.");

  const ids = rows.map((r) => r.id);
  const chains = await loadSkuPackChains(ids);

  const { data: pinRows, error: pErr } = await sb
    .from("recipe_inputs")
    .select("component_sku_id")
    .in("component_sku_id", ids)
    .returns<Array<{ component_sku_id: string | null }>>();
  if (pErr) throw new Error(`load recipe_inputs: ${pErr.message}`);
  const pinCount = new Map<string, number>();
  for (const r of pinRows ?? []) {
    if (r.component_sku_id == null) continue;
    pinCount.set(r.component_sku_id, (pinCount.get(r.component_sku_id) ?? 0) + 1);
  }

  const { data: priceRows, error: prErr } = await sb
    .from("vendor_price_history")
    .select("vendor_item_id, unit_price, effective_date, recorded_at, source")
    .order("effective_date", { ascending: false })
    .order("recorded_at", { ascending: false })
    .returns<
      Array<{
        vendor_item_id: string;
        unit_price: number | string | null;
        effective_date: string | null;
        recorded_at: string | null;
        source: string | null;
      }>
    >();
  if (prErr) throw new Error(`load vendor_price_history: ${prErr.message}`);
  const latestPrice = new Map<string, { unitPrice: number | null; effectiveDate: string | null; source: string | null }>();
  for (const r of priceRows ?? []) {
    if (latestPrice.has(r.vendor_item_id)) continue; // ordered desc — first wins
    latestPrice.set(r.vendor_item_id, {
      unitPrice: num(r.unit_price),
      effectiveDate: r.effective_date,
      source: r.source,
    });
  }

  // TWO-STEP, not an embed: vendor_delivery_items has more than one FK path to
  // vendor_deliveries, so PostgREST refuses to disambiguate the embed (and the house
  // rule already prefers two-step over relation embeds).
  const { data: headerRows, error: dhErr } = await sb
    .from("vendor_deliveries")
    .select("id, location_id")
    .returns<Array<{ id: string; location_id: string | null }>>();
  if (dhErr) throw new Error(`load vendor_deliveries: ${dhErr.message}`);
  const locationByDelivery = new Map<string, string | null>();
  for (const d of headerRows ?? []) locationByDelivery.set(d.id, d.location_id);

  const { data: deliveryRows, error: dErr } = await sb
    .from("vendor_delivery_items")
    .select("vendor_item_id, created_at, delivery_id")
    .order("created_at", { ascending: false })
    .returns<
      Array<{
        vendor_item_id: string | null;
        created_at: string | null;
        delivery_id: string | null;
      }>
    >();
  if (dErr) throw new Error(`load vendor_delivery_items: ${dErr.message}`);
  const receivedBySku = new Map<string, Map<string, string>>();
  for (const r of deliveryRows ?? []) {
    const loc = r.delivery_id == null ? null : locationByDelivery.get(r.delivery_id) ?? null;
    if (r.vendor_item_id == null || loc == null || r.created_at == null) continue;
    const perLoc = receivedBySku.get(r.vendor_item_id) ?? new Map<string, string>();
    if (!perLoc.has(loc)) perLoc.set(loc, r.created_at); // ordered desc — first wins
    receivedBySku.set(r.vendor_item_id, perLoc);
  }

  const skus: LiveSku[] = rows.map((r) => {
    const chain = chains.get(r.id) ?? [];
    const shape = {
      unitsPerPack: r.units_per_pack,
      eachSize: num(r.each_size),
      eachMeasure: r.each_measure,
      avgOzPerEach: num(r.avg_oz_per_each),
      packChain: chain.length > 0 ? chain : null,
    };
    return {
      id: r.id,
      name: r.name,
      vendorId: r.vendor_id,
      vendorName: r.vendors?.name ?? "(no vendor)",
      active: r.active ?? true,
      locationId: r.location_id,
      weekdayPar: num(r.weekday_par),
      weekendPar: num(r.weekend_par),
      avgOzPerEach: num(r.avg_oz_per_each),
      unitsPerPack: r.units_per_pack,
      eachSize: num(r.each_size),
      eachMeasure: r.each_measure,
      packFormat: r.pack_format,
      productId: r.product_id,
      chain,
      contentOz: skuContentOz(shape, measures),
      pins: pinCount.get(r.id) ?? 0,
      latestPrice: latestPrice.get(r.id) ?? null,
      lastReceivedByLocation: receivedBySku.get(r.id) ?? new Map<string, string>(),
    };
  });

  const byKey = new Map<string, LiveSku[]>();
  for (const s of skus) {
    const list = byKey.get(key(s.name)) ?? [];
    list.push(s);
    byKey.set(key(s.name), list);
  }

  const { data: productRows, error: pdErr } = await sb
    .from("products")
    .select("id, name, unit_oz, unit_oz_class, active")
    .returns<LiveProductRow[]>();
  if (pdErr) throw new Error(`load products: ${pdErr.message}`);

  const { data: primaryRows, error: ppErr } = await sb
    .from("product_primaries")
    .select("id, product_id, location_id, primary_sku_id")
    .returns<LivePrimaryRow[]>();
  if (ppErr) throw new Error(`load product_primaries: ${ppErr.message}`);

  const { data: locationRows, error: lErr } = await sb
    .from("locations")
    .select("id, name")
    .returns<Array<{ id: string; name: string }>>();
  if (lErr) throw new Error(`load locations: ${lErr.message}`);

  const { data: itemRows, error: iErr } = await sb
    .from("items")
    .select("name, name_es, active")
    .eq("active", true)
    .returns<Array<{ name: string; name_es: string | null; active: boolean | null }>>();
  if (iErr) throw new Error(`load items: ${iErr.message}`);
  const seen = new Map<string, number>();
  const itemNameEs = new Map<string, string>();
  for (const it of itemRows ?? []) {
    const k = key(it.name);
    seen.set(k, (seen.get(k) ?? 0) + 1);
    if (it.name_es != null && it.name_es.trim() !== "") itemNameEs.set(k, it.name_es.trim());
  }
  for (const [k, n] of seen) if (n > 1) itemNameEs.delete(k); // ambiguous → NULL, not a guess.

  return {
    skus,
    byKey,
    products: productRows ?? [],
    primaries: primaryRows ?? [],
    locations: locationRows ?? [],
    itemNameEs,
  };
}

/** The pure resolver's view of a live SKU, at a given location. */
function asMember(s: LiveSku, locationId: string | null): ProductMember {
  return {
    skuId: s.id,
    vendorId: s.vendorId,
    vendorName: s.vendorName,
    active: s.active,
    avgOzPerEach: s.avgOzPerEach,
    lastReceivedAt: locationId == null ? null : s.lastReceivedByLocation.get(locationId) ?? null,
  };
}

// ── (1) Discovery — computed live, never trusted from the audit ───────────────

interface Candidate {
  productName: string;
  skus: LiveSku[];
  /** In PRODUCTS? A discovered name that is not is a LOUD finding, not a shrug. */
  planned: boolean;
}

function discoverCandidates(cat: Catalog): Candidate[] {
  const out: Candidate[] = [];
  const plannedKeys = new Set(PRODUCTS.map((p) => key(p.name)));

  for (const [k, list] of cat.byKey) {
    const vendors = new Set(list.map((s) => s.vendorId ?? "NULL"));
    if (vendors.size < 2) continue;
    out.push({
      productName: list[0]!.name.trim(),
      skus: [...list].sort((a, b) => a.vendorName.localeCompare(b.vendorName)),
      planned: plannedKeys.has(k),
    });
  }
  // Names the PLAN carries that are NOT multi-vendor (Iceberg): included so the
  // report shows every product this seed will create, not only the plural ones.
  for (const plan of PRODUCTS) {
    if (out.some((c) => key(c.productName) === key(plan.name))) continue;
    const list = cat.byKey.get(key(plan.name)) ?? [];
    out.push({ productName: plan.name, skus: [...list], planned: true });
  }
  return out.sort((a, b) => a.productName.localeCompare(b.productName));
}

function reportDiscovery(cat: Catalog, candidates: Candidate[]): void {
  h(2, "1 — Discovery (computed live, this run)");
  p(
    `${cat.skus.length} SKUs in the registry. **${candidates.filter((c) => c.skus.length > 1 && new Set(c.skus.map((s) => s.vendorId)).size > 1).length} names carry 2+ distinct vendors right now** — recomputed from \`vendor_items\`, not copied from the audit.`,
  );
  p();

  const rows: string[][] = [];
  for (const c of candidates) {
    for (const s of c.skus) {
      rows.push([
        c.productName,
        s.vendorName,
        s.active ? "**active**" : "inactive",
        parStr(s.weekdayPar, s.weekendPar),
        s.avgOzPerEach == null ? "—" : String(s.avgOzPerEach),
        ozStr(s.contentOz),
        String(s.pins),
        s.latestPrice?.unitPrice == null ? "—" : `${money(s.latestPrice.unitPrice)} (${s.latestPrice.effectiveDate ?? "?"})`,
        s.productId == null ? "—" : "ATTACHED",
      ]);
    }
  }
  table(
    ["product", "vendor", "state", "par wd/we", "avg_oz_per_each", "content", "pins", "latest price", "product_id"],
    rows,
    ["", "", "", "r", "r", "r", "r", "", ""],
  );

  const unplanned = candidates.filter((c) => !c.planned);
  p();
  if (unplanned.length > 0) {
    p(
      `> ⚠ **${unplanned.length} multi-vendor name(s) discovered that the plan does not carry: ${unplanned.map((c) => c.productName).join(", ")}.** ` +
        "The registry moved since the plan was authored. Nothing is written for them — they are reported so the plan can be amended rather than silently outgrown.",
    );
  } else {
    p("> Every multi-vendor name discovered live is carried by the plan, and every planned product exists live. No drift.");
  }

  // ── Receipt evidence: what rung 2 can actually see ──────────────────────────
  h(3, "1b — Receipt evidence (what the ladder's rung 2 can see)");
  const recRows: string[][] = [];
  for (const c of candidates) {
    for (const s of c.skus) {
      for (const [loc, at] of s.lastReceivedByLocation) {
        recRows.push([
          c.productName,
          s.vendorName,
          s.active ? "active" : "**inactive**",
          cat.locations.find((l) => l.id === loc)?.name ?? loc,
          at.slice(0, 10),
        ]);
      }
    }
  }
  table(["product", "vendor", "state", "location", "last received"], recRows);
  p();
  p(
    "**This is the finding the plan did not anticipate.** Rung 2 of the ladder (*most-recently-RECEIVED active member*) " +
      "is effectively dark across this whole candidate set: the only delivery line on file for any member sits on an " +
      "**inactive** row, and `resolveProductMember` ignores inactive members by construction. So an unruled pair does " +
      "**not** resolve on receipt recency — it falls to rung 3 (any active member, skuId-ascending). Rung 3 is stable " +
      "and deterministic, never arbitrary at runtime, but it is decided by a uuid sort rather than by anything " +
      "operational. The ladder column in section 3 shows what each pair answers today.",
  );

  // ── Has the ground moved under the source documents? ───────────────────────
  h(3, "1c — Re-checking what the source documents claim (discipline zero, executed)");
  const claimRows: string[][] = [];
  let moved = 0;
  for (const c of SOURCE_CLAIMS) {
    const sku = (cat.byKey.get(key(c.sku[0])) ?? []).find((s) => s.vendorName === c.sku[1]);
    const observedNow = sku == null ? "SKU NOT FOUND" : c.observe(sku);
    const still = observedNow === c.expected;
    if (!still) moved += 1;
    claimRows.push([
      c.claim,
      c.source,
      c.expected,
      observedNow,
      still ? "still true" : "**MOVED**",
    ]);
  }
  table(["the source document says", "source", "expected", "live now", "verdict"], claimRows);
  p();
  if (moved === 0) {
    p("> Every claim the plan rests on is still true live.");
  } else {
    p(
      `> **${moved} of ${SOURCE_CLAIMS.length} claims have MOVED since the source documents were written.** That is ` +
        "information, not a fault, and `audit_log` says exactly why:",
    );
    p();
    p(
      "> - **18:51:53** — wave 3 (`scripts/seed/20-angel-wave3.ts`, `sku.weight_fill`) MIRRORED Juan's 1.2 oz onto the " +
        "PFG ham twin *(\"applied to the PFG twin by MIRROR rather than by its own measurement because the twins are two " +
        "vendor identities for one product\")* and settled the mozzarella twin at 1 oz.",
    );
    p(
      "> - **18:51:56–57** — **seed 18 was re-run**, its oz-preservation gate passed for the first time, and both pins " +
        "moved Baldor → PFG (`recipe.update` / `op: component_sku_repoint`). Seed 18 predicted this verbatim: *\"re-running " +
        "this script afterwards passes the gate and moves the pins with no code change.\"*",
    );
    p(
      "> - **19:58** — wave 4 §B activated the Baldor lettuce backup. **22:09** — seed 22 then re-denominated the " +
        "portioned lines on the now-PFG pins.",
    );
    p();
    p(
      "> Two consequences worth naming. **(a)** The ham and mozzarella twins now **agree** on what one unit weighs — " +
        "which is why `members disagree?` reads *no* for both in section 2, and why the Phase-4 re-point refusal the plan " +
        "worries about is already discharged for those two pairs. **(b)** The pin state deviation D2 describes is not the " +
        "pin state live. **Nothing in this seed depends on either claim** — it writes identity and nothing else — but the " +
        "paragraphs of the plan that cite them should be read against this table rather than from memory.",
    );
  }
}

// ── (2) The plan, per product ────────────────────────────────────────────────

interface ResolvedMember {
  plan: MemberPlan;
  sku: LiveSku;
}

interface ResolvedProduct {
  plan: ProductPlan;
  members: ResolvedMember[];
  existing: LiveProductRow | null;
  /** Carried from the prep layer's own item, never authored here (see Catalog). */
  nameEs: string | null;
  /** Which member the ladder answers TODAY, with the plan's primary applied. */
  ladderToday: ReturnType<typeof resolveProductMember>;
  /** Which member the ladder answers with NO primary row at all. */
  ladderUnruled: ReturnType<typeof resolveProductMember>;
  disagree: boolean;
}

/**
 * Resolve a planned product's members against the live catalog.
 * FATAL on any identity drift — both members share a NAME, so only (name, vendor)
 * identifies the row, and guessing is how a seed writes to the wrong SKU.
 */
function resolvePlan(cat: Catalog, plan: ProductPlan): ResolvedProduct {
  const members: ResolvedMember[] = [];
  for (const m of plan.members) {
    const matches = (cat.byKey.get(key(m.skuName)) ?? []).filter((s) => s.vendorName === m.expectVendor);
    if (matches.length === 0) {
      throw new Error(
        `FATAL: no SKU named "${m.skuName}" under vendor "${m.expectVendor}" — the registry moved under the plan. Refusing to guess.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `FATAL: ${matches.length} SKUs named "${m.skuName}" under vendor "${m.expectVendor}" (${matches.map((s) => s.id).join(", ")}) — ambiguous. Refusing to attach.`,
      );
    }
    const sku = matches[0]!;
    if (sku.locationId !== null) {
      throw new Error(
        `FATAL: SKU ${sku.id} (${m.expectVendor}/${m.skuName}) is location-scoped (${sku.locationId}); this seed is written for GLOBAL rows only.`,
      );
    }
    members.push({ plan: m, sku });
  }

  const existing = cat.products.find((r) => key(r.name) === key(plan.name) && (r.active ?? true)) ?? null;
  const memberViews = members.map((m) => asMember(m.sku, null));
  const primarySkuId =
    plan.primary == null ? null : members.find((m) => m.sku.vendorName === plan.primary!.vendor)?.sku.id ?? null;
  if (plan.primary != null && primarySkuId == null) {
    throw new Error(
      `FATAL: ${plan.name}'s planned primary vendor "${plan.primary.vendor}" is not among its members. Refusing.`,
    );
  }

  return {
    plan,
    members,
    existing,
    nameEs: cat.itemNameEs.get(key(plan.name)) ?? null,
    ladderToday: resolveProductMember({ productId: plan.name, primarySkuId, members: memberViews }),
    ladderUnruled: resolveProductMember({ productId: plan.name, primarySkuId: null, members: memberViews }),
    disagree: membersDisagreeOnUnitOz(memberViews),
  };
}

function reportPlan(resolved: ResolvedProduct[]): void {
  h(2, "2 — The plan, product by product");
  p(
    "Every row below is a would-write in `--execute` mode. `products` rows are created, `vendor_items.product_id` is " +
      "set, `product_primaries` rows are inserted **only where somebody actually ruled**, and `products.unit_oz` is " +
      "filled **only from a measurement**.",
  );
  p();

  const rows: string[][] = [];
  for (const r of resolved) {
    const memberLabel = r.members.map((m) => `${m.sku.vendorName}${m.sku.active ? "" : " *(inactive)*"}`).join(" · ");
    const primary =
      r.plan.primary == null
        ? r.plan.proposed == null
          ? "— *(none; single member)*"
          : `**none — awaiting Juan** *(proposal: ${r.plan.proposed.vendor})*`
        : `**${r.plan.primary.vendor}**${r.plan.primary.isInferred ? " ⚠ *inferred*" : ""}`;
    rows.push([
      r.plan.name,
      r.existing == null ? "CREATE" : "exists — reuse",
      r.nameEs ?? "— *(no item match)*",
      String(r.members.length),
      memberLabel,
      primary,
      r.plan.unitOz == null ? "— *(NULL, honest)*" : `**${r.plan.unitOz.value}** (${r.plan.unitOz.klass})`,
      r.disagree ? "⚠ yes" : "no",
    ]);
  }
  table(
    ["product", "products row", "name_es", "#", "members", "primary (global)", "unit_oz", "members disagree?"],
    rows,
    ["", "", "", "r", "", "", "r", ""],
  );
  p();
  p(
    "> `name_es` is **carried from the prep layer's own item**, never authored here — the kitchen has called ham " +
      "*Jamón* since the operational seed, and a product inventing a second Spanish word for the same thing is exactly " +
      "the drift the system-key-vs-display-string rule prevents. No unambiguous active item of that name → NULL.",
  );

  h(3, "2b — Who decided each product, and where that is an inference");
  for (const r of resolved) {
    p(`- **${r.plan.name}** — ${r.plan.decision}`);
    if (r.plan.primary != null) {
      p(`  - primary basis (${r.plan.primary.decidedBy}): ${r.plan.primary.basis}`);
    }
  }
}

// ── (3) The decision table (gate S1) ─────────────────────────────────────────

function reportDecisionTable(cat: Catalog, resolved: ResolvedProduct[]): void {
  const open = resolved.filter((r) => r.plan.primary == null && r.plan.proposed != null);
  h(2, `3 — THE DECISION TABLE: ${open.length} pairs awaiting Juan's word 🔒 GATE S1`);
  p(
    "**This table is the adjudication sheet.** For each pair: which vendor is PRIMARY, and is that answer explicit or " +
      "an inference. A default is proposed for every row — the reading the live data already supports — so the sitting " +
      "is a confirm-or-amend, not a blank page. **Nothing in this section is written until the answers are encoded in " +
      "`PRODUCTS` and the dry run is re-run.**",
  );
  p();

  const rows: string[][] = [];
  for (const r of open) {
    const bh = r.members.find((m) => m.sku.vendorName === r.plan.proposed!.vendor);
    const other = r.members.filter((m) => m.sku.vendorName !== r.plan.proposed!.vendor);
    const ladderSku = r.ladderUnruled.skuId;
    const ladderVendor = r.members.find((m) => m.sku.id === ladderSku)?.sku.vendorName ?? "unresolved";
    rows.push([
      r.plan.name,
      `${bh?.sku.vendorName ?? "?"} (active, par ${parStr(bh?.sku.weekdayPar ?? null, bh?.sku.weekendPar ?? null)}, ${bh?.sku.pins ?? 0} pin)`,
      other.map((m) => `${m.sku.vendorName} (${m.sku.active ? "active" : "inactive"}, ${m.sku.pins} pin)`).join(" · "),
      `**${r.plan.proposed!.vendor}**`,
      `${ladderVendor} *(rung ${RUNG_LABEL[r.ladderUnruled.rung] ?? r.ladderUnruled.rung})*`,
      "☐ confirm  ☐ amend → ______",
    ]);
  }
  table(
    ["pair", "proposed primary", "the other member", "DEFAULT", "ladder answers today", "Juan"],
    rows,
  );

  p();
  p(`> **Why this default.** ${BH_SHAPE_RATIONALE}`);
  p();
  p(
    "> **Confirming the default changes nothing operationally today** — the ladder already lands on the same member, " +
      "because it is the only active one. What the primary row buys is durability: the day a Baldor row is reactivated " +
      "as a backup, resolution keeps answering Boar's Head instead of silently re-deciding on rung 3.",
  );
  p();
  p(
    "> **Amending is one field.** Swap `proposed` → `primary` with the other vendor in `PRODUCTS` and re-run the dry " +
      "run; nothing else in this script encodes the choice.",
  );

  const oddities = resolved.filter((r) => r.members.filter((m) => m.sku.pins > 0).length > 1);
  if (oddities.length > 0) {
    p();
    p(
      `> ⚠ **Not all ${open.length} are the same shape.** ${oddities.map((r) => `**${r.plan.name}**`).join(", ")} carries a recipe pin on MORE THAN ONE member — ` +
        "including an inactive one. That is audit gap P5 (two recipes pinning different vendors, resolved by a row-order " +
        "coin flip inside `buildRecipeGraph`). Product identity is the eventual fix; this seed does not touch a pin.",
    );
  }

  const locs = cat.locations.map((l) => l.name).join(" · ");
  p();
  p(
    `> **Per-location primaries are not seeded.** Every primary here is the GLOBAL row (\`location_id\` NULL), which both ` +
      `shops (${locs}) resolve against. A per-shop override is one row and can be added from \`/admin/products\` the day ` +
      "a shop genuinely disagrees; writing two identical rows today would only be two rows to maintain.",
  );
}

// ── (4) ICEBERG — the attribution question, presented not answered ───────────

function reportIceberg(resolved: ResolvedProduct[]): void {
  h(2, "4 — ICEBERG: the $3,230.74 attribution question 🔒 DECISION, NOT A WRITE");
  const total = ICEBERG_ANGEL_ROWS.reduce((a, r) => a + r.spend, 0);
  const lines = ICEBERG_ANGEL_ROWS.reduce((a, r) => a + r.lines, 0);
  p(
    `Angel invoiced **${money(total)} of iceberg across ${lines} lines** in the five-week window. Every one of those ` +
      "rows is a **PFG** or **US Foods** row. Our registry's lettuce lane is **Sysco** and **Baldor** — neither twin " +
      "appears in the purchase history once, under any spelling (wave 4 §B1).",
  );
  p();
  table(
    ["Angel row", "brand", "vendor", "pack", "lines", "spend", "reading"],
    ICEBERG_ANGEL_ROWS.map((r) => [r.row, r.brand, r.vendor, r.pack, String(r.lines), money(r.spend), r.note]),
    ["", "", "", "", "r", "r", ""],
  );

  p();
  h(3, "4a — what we actually hold, live");
  const iceberg = resolved.find((r) => key(r.plan.name) === "iceberg");
  const lettuce = resolved.find((r) => key(r.plan.name) === "lettuce");
  const skuRows: string[][] = [];
  for (const r of [iceberg, lettuce]) {
    if (r == null) continue;
    for (const m of r.members) {
      skuRows.push([
        `${m.sku.vendorName}/${m.sku.name}`,
        m.sku.active ? "active" : "inactive",
        parStr(m.sku.weekdayPar, m.sku.weekendPar),
        ozStr(m.sku.contentOz),
        String(m.sku.pins),
        m.sku.latestPrice?.unitPrice == null ? "—" : money(m.sku.latestPrice.unitPrice),
      ]);
    }
  }
  table(["our SKU", "state", "par wd/we", "pack content", "pins", "latest price"], skuRows, ["", "", "r", "r", "r", "r"]);
  p();
  p(
    "Three facts that bear on the question and are easy to miss: (a) the **prep layer already calls this thing " +
      "Iceberg** — there is an active `items` row named *Iceberg* and **no item named Lettuce**; (b) the only SKU " +
      "carrying a par, a recipe pin and a price is **PFG/Iceberg**; (c) both `Lettuce` twins carry **zero** pins, " +
      "**zero** pars and no price, and the Baldor one has no pack chain at all.",
  );

  p();
  h(3, "4b — the question, and the three dispositions");
  p("**Does the ICEBERG product absorb the Lettuce twins, or are they two different products?**");
  p();
  p(
    "- **A — one product.** Attach `Sysco/Lettuce` and `Baldor/Lettuce` to **ICEBERG** as members and retire the " +
      "separate LETTUCE product (`active = false`; nothing is ever deleted). Reading: shredduce is shredduce, the " +
      "vendor lane moved to PFG, and the Sysco/Baldor rows are the backup lane. This is the disposition the live data " +
      "leans toward — but leaning is not ruling.",
  );
  p(
    "- **B — two products.** ICEBERG (the PFG whole-head lane, which is what the recipes consume) stays distinct from " +
      "LETTUCE (the Sysco/Baldor lane). Reading: `LETTUCE ICEBERG LINER` at ~1.75 lb/head is whole heads, while the " +
      "C&T rows are a genuinely different, pre-trimmed product — two products that happen to share a word.",
  );
  p(
    "- **C — retire the twins.** If the Sysco/Baldor lettuce lane is simply dead history, deactivate both SKUs and let " +
      "ICEBERG be a singleton. Reading: the twins have never been received, priced, pinned or par'd. **Note this is " +
      "the one disposition that touches `active`, which this seed will not do** — it would be a separate, named write.",
  );
  p();
  p(
    "> **This seed answers none of the three.** It creates the ICEBERG product with `PFG/Iceberg` attached and **no " +
      "primary row**, and it creates LETTUCE with its ruled (inferred) Sysco primary. Whichever way Juan rules, the " +
      "move is one attach/detach and one `active` flip from `/admin/products` — no migration, no re-seed. What the " +
      "product row buys today is a **grain for the question to live at**, which is the whole reason the spec names " +
      "ICEBERG explicitly.",
  );
  p();
  p(
    "> **What it does NOT decide.** Whether a `PFG/Lettuce` SKU should be created for `LETTUCE ICEBERG LINER` " +
      "(wave 4 §B1's open registry question) is still open and still not a thing a script can infer from a spend table.",
  );
}

// ── (5) unit_oz — ruled vs merely observed ───────────────────────────────────

function reportUnitOz(resolved: ResolvedProduct[]): void {
  h(2, "5 — unit_oz: what is RULED (written) vs what is merely OBSERVED (not written)");
  p(
    "`products.unit_oz` is what ONE unit of the product weighs, and it is what keeps a product-pinned recipe line " +
      "meaning the same ounces after a member flip (deviation D2). Only a **measurement** is written.",
  );
  p();

  const written: string[][] = [];
  const observed: string[][] = [];
  for (const r of resolved) {
    const activeVals = r.members
      .filter((m) => m.sku.active)
      .map((m) => ({ v: m.sku.avgOzPerEach, vendor: m.sku.vendorName }))
      .filter((x): x is { v: number; vendor: string } => x.v != null);
    if (r.plan.unitOz != null) {
      written.push([
        r.plan.name,
        String(r.plan.unitOz.value),
        r.plan.unitOz.klass,
        activeVals.map((x) => `${x.vendor} ${x.v}`).join(" · ") || "—",
        "Juan's weighing (OPERATIONAL_SLICE_OZ)",
      ]);
    } else {
      const uniq = [...new Set(activeVals.map((x) => x.v))];
      observed.push([
        r.plan.name,
        uniq.length === 0 ? "— *(no member value)*" : uniq.length === 1 ? String(uniq[0]) : `⚠ ${uniq.join(" vs ")}`,
        activeVals.map((x) => `${x.vendor} ${x.v}`).join(" · ") || "—",
        uniq.length === 0
          ? "no active member carries a weight — nothing to observe"
          : activeVals.length === 1
            ? "ONE member's estimate — a candidate, not a measurement"
            : uniq.length === 1
              ? "members agree — but two estimates agreeing is still not a measurement"
              : "members DISAGREE — a flip would re-denominate the line",
      ]);
    }
  }
  h(3, "5a — written this run");
  table(["product", "unit_oz", "class", "live member values", "provenance"], written, ["", "r", "", "", ""]);
  h(3, "5b — left NULL (reported only)");
  table(["product", "candidate", "live member values", "why not written"], observed, ["", "r", "", ""]);
  p();
  p(
    "> **Agreement between two estimates is not a measurement.** Every `avg_oz_per_each` in column 3 that is not one of " +
      "Juan's five ruled values is a seed-10 estimate. NULL is the honest value (the 0161 LOCK-1 doctrine: *a sentinel " +
      "would be a SILENT-WRONG-NUMBER trap*), and the Phase-4 re-point script refuses a count-denominated line whose " +
      "product has no `unit_oz` rather than resolving it through whichever member happens to be primary that day — " +
      "which is exactly the refusal seed 18 made.",
  );
  p(
    "> Genoa (0.4) is in `OPERATIONAL_SLICE_OZ` and is deliberately **absent** here: Genoa is a single-vendor SKU, so " +
      "it is an implicit singleton and needs no product row. Its weight already lives where it belongs, on the SKU.",
  );
}

// ── (6) The write half ───────────────────────────────────────────────────────

interface Outcome {
  product: string;
  productCreated: boolean;
  productReused: boolean;
  membersAttached: number;
  membersAlready: number;
  membersRefused: number;
  primaryWritten: boolean;
  primaryAlready: boolean;
  primaryRefused: boolean;
  primaryDeferred: boolean;
  unitOzWritten: boolean;
  unitOzAlready: boolean;
  unitOzRefused: boolean;
  refusals: string[];
}

function blankOutcome(name: string): Outcome {
  return {
    product: name,
    productCreated: false,
    productReused: false,
    membersAttached: 0,
    membersAlready: 0,
    membersRefused: 0,
    primaryWritten: false,
    primaryAlready: false,
    primaryRefused: false,
    primaryDeferred: false,
    unitOzWritten: false,
    unitOzAlready: false,
    unitOzRefused: false,
    refusals: [],
  };
}

const seedMeta = (reason: string, extra: Record<string, unknown> = {}) => ({
  phase: PHASE,
  reason,
  script: SCRIPT,
  source_report: SOURCE_REPORT,
  actor_context: "seed",
  decision_sources: DECISION_SOURCES,
  ...extra,
});

/** Re-read a SKU at write time. INVARIANT 1: a name/vendor drift is FATAL. */
async function reReadSku(sb: Sb, m: ResolvedMember): Promise<{ id: string; product_id: string | null; active: boolean; weekday_par: number | null; weekend_par: number | null }> {
  const { data, error } = await sb
    .from("vendor_items")
    .select("id, name, product_id, active, weekday_par, weekend_par, vendors(name)")
    .eq("id", m.sku.id)
    .maybeSingle<{
      id: string;
      name: string;
      product_id: string | null;
      active: boolean | null;
      weekday_par: number | string | null;
      weekend_par: number | string | null;
      vendors: { name: string } | null;
    }>();
  if (error) throw new Error(`re-read SKU ${m.sku.id}: ${error.message}`);
  if (!data) throw new Error(`FATAL: SKU ${m.sku.id} (${m.plan.expectVendor}/${m.plan.skuName}) vanished mid-run.`);
  if (data.name !== m.sku.name) {
    throw new Error(
      `FATAL: SKU ${m.sku.id} is now named "${data.name}", was "${m.sku.name}" — refusing to attach the wrong SKU.`,
    );
  }
  if ((data.vendors?.name ?? "(no vendor)") !== m.plan.expectVendor) {
    throw new Error(
      `FATAL: SKU ${m.sku.id} now sits under vendor "${data.vendors?.name}", expected "${m.plan.expectVendor}" — refusing.`,
    );
  }
  return {
    id: data.id,
    product_id: data.product_id,
    active: data.active ?? true,
    weekday_par: num(data.weekday_par),
    weekend_par: num(data.weekend_par),
  };
}

async function applyProduct(sb: Sb, r: ResolvedProduct): Promise<Outcome> {
  const out = blankOutcome(r.plan.name);
  const label = r.plan.name;

  // ── product row ────────────────────────────────────────────────────────────
  let productId: string;
  if (r.existing != null) {
    out.productReused = true;
    productId = r.existing.id;
    p(`  = products row already exists for "${label}" [${productId}] — reusing, no write.`);
  } else {
    const { data, error } = await sb
      .from("products")
      .insert({
        name: r.plan.name,
        name_es: r.nameEs, // the prep layer's own word for it, or NULL
        notes: r.plan.notes,
        active: true,
        created_by: null, // a seed has no actor; NULL is the honest value.
        updated_by: null,
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error?.code === "23505") {
      throw new Error(
        `FATAL: an ACTIVE product named "${label}" appeared between the plan and the write (unique index products_name_lower_uq). Refusing — re-run the dry run.`,
      );
    }
    if (error) throw new Error(`create product ${label}: ${error.message}`);
    if (!data) throw new Error(`create product ${label}: insert returned no row`);
    productId = data.id;
    out.productCreated = true;
    p(`  + created products row "${label}" [${productId}]`);
    await audit({
      actorId: null,
      actorRole: null,
      action: "product.create",
      resourceTable: "products",
      resourceId: productId,
      metadata: seedMeta("Product identity above SKUs — plurality exists for this name.", {
        name: r.plan.name,
        member_count: r.members.length,
        decision: r.plan.decision,
      }),
      ipAddress: null,
      userAgent: null,
    });
  }

  // ── members ────────────────────────────────────────────────────────────────
  for (const m of r.members) {
    const live = await reReadSku(sb, m);
    if (live.product_id === productId) {
      out.membersAlready += 1;
      p(`  = ${m.plan.expectVendor}/${m.plan.skuName} already a member — no write.`);
      continue;
    }
    if (live.product_id != null) {
      // INVARIANT 3: the before-value moved under us. Never re-parent silently.
      out.membersRefused += 1;
      const msg = `${m.plan.expectVendor}/${m.plan.skuName} is already attached to a DIFFERENT product [${live.product_id}] — refusing to re-parent. Re-run the dry run.`;
      out.refusals.push(msg);
      p(`  ✗ REFUSING: ${msg}`);
      continue;
    }
    const { error, count } = await sb
      .from("vendor_items")
      .update(
        { product_id: productId, updated_at: new Date().toISOString(), updated_by: null },
        { count: "exact" },
      )
      .eq("id", m.sku.id)
      .is("product_id", null); // guard: only attach a row still reading unattached.
    if (error) throw new Error(`attach ${m.plan.expectVendor}/${m.plan.skuName}: ${error.message}`);
    if (!count) {
      throw new Error(
        `FATAL: attach of ${m.plan.expectVendor}/${m.plan.skuName} matched 0 rows — the row moved under the guard. Refusing to continue.`,
      );
    }
    out.membersAttached += 1;
    p(`  + attached ${m.plan.expectVendor}/${m.plan.skuName} [${m.sku.id}]`);
    await audit({
      actorId: null,
      actorRole: null,
      action: "product.member_attach",
      resourceTable: "vendor_items",
      resourceId: m.sku.id,
      metadata: seedMeta("Attach the member SKU to its product identity.", {
        product_id: productId,
        product_name: r.plan.name,
        vendor: m.plan.expectVendor,
        sku_name: m.plan.skuName,
      }),
      ipAddress: null,
      userAgent: null,
    });
  }

  // ── primary ────────────────────────────────────────────────────────────────
  if (r.plan.primary == null) {
    out.primaryDeferred = true;
    p(
      r.plan.proposed == null
        ? `  · no primary row (single member — the ladder answers on rung 3).`
        : `  · NO primary row — "${label}" is UNADJUDICATED. Proposal on the sheet: ${r.plan.proposed.vendor}.`,
    );
  } else {
    const primaryPlan = r.plan.primary;
    const primarySku = r.members.find((m) => m.sku.vendorName === primaryPlan.vendor)!;
    const { data: existing, error: exErr } = await sb
      .from("product_primaries")
      .select("id, primary_sku_id")
      .eq("product_id", productId)
      .is("location_id", null)
      .maybeSingle<{ id: string; primary_sku_id: string }>();
    if (exErr) throw new Error(`primary lookup ${label}: ${exErr.message}`);

    if (existing && existing.primary_sku_id === primarySku.sku.id) {
      out.primaryAlready = true;
      p(`  = primary already ${primaryPlan.vendor} — no write.`);
    } else if (existing) {
      // INVARIANT 3 again: somebody designated a different primary. Never overwrite.
      out.primaryRefused = true;
      const msg = `"${label}" already names a DIFFERENT global primary [${existing.primary_sku_id}] — refusing to overwrite a designation this script did not make. Re-run the dry run.`;
      out.refusals.push(msg);
      p(`  ✗ REFUSING: ${msg}`);
    } else {
      const { data, error } = await sb
        .from("product_primaries")
        .insert({
          product_id: productId,
          location_id: null,
          primary_sku_id: primarySku.sku.id,
          note: `${primaryPlan.decidedBy}${primaryPlan.isInferred ? " — SIDE IS AN INFERENCE" : ""}. ${primaryPlan.basis}`,
          updated_by: null,
        })
        .select("id")
        .maybeSingle<{ id: string }>();
      if (error) throw new Error(`set primary ${label}: ${error.message}`);
      if (!data) throw new Error(`set primary ${label}: insert returned no row`);
      out.primaryWritten = true;
      p(`  + primary (global) = ${primaryPlan.vendor}${primaryPlan.isInferred ? "  ⚠ INFERRED" : ""}`);
      await audit({
        actorId: null,
        actorRole: null,
        action: "product.primary_set",
        resourceTable: "product_primaries",
        resourceId: productId,
        metadata: seedMeta("Designate the primary member from a standing adjudication.", {
          product_name: r.plan.name,
          location_id: null,
          primary_sku_id: primarySku.sku.id,
          primary_vendor: primaryPlan.vendor,
          primary_is_inferred: primaryPlan.isInferred,
          decided_by: primaryPlan.decidedBy,
          basis: primaryPlan.basis,
        }),
        ipAddress: null,
        userAgent: null,
      });
    }
  }

  // ── unit_oz ────────────────────────────────────────────────────────────────
  if (r.plan.unitOz != null) {
    const { data: before, error: bErr } = await sb
      .from("products")
      .select("id, name, unit_oz, unit_oz_class")
      .eq("id", productId)
      .maybeSingle<{ id: string; name: string; unit_oz: number | string | null; unit_oz_class: string | null }>();
    if (bErr) throw new Error(`unit_oz lookup ${label}: ${bErr.message}`);
    if (!before) throw new Error(`FATAL: product ${label} [${productId}] vanished mid-run.`);
    if (before.name !== r.plan.name) {
      throw new Error(`FATAL: product [${productId}] is now named "${before.name}", expected "${label}" — refusing.`);
    }

    const liveOz = num(before.unit_oz);
    if (liveOz != null && Math.abs(liveOz - r.plan.unitOz.value) < 1e-9) {
      out.unitOzAlready = true;
      p(`  = unit_oz already ${r.plan.unitOz.value} — no write.`);
    } else if (liveOz != null) {
      out.unitOzRefused = true;
      const msg = `"${label}" already carries unit_oz = ${liveOz} (class ${before.unit_oz_class ?? "—"}); the plan says ${r.plan.unitOz.value}. Somebody weighed it. Refusing to overwrite — re-run the dry run.`;
      out.refusals.push(msg);
      p(`  ✗ REFUSING: ${msg}`);
    } else {
      const { error, count } = await sb
        .from("products")
        .update(
          {
            unit_oz: r.plan.unitOz.value,
            unit_oz_class: r.plan.unitOz.klass,
            unit_oz_source_note: r.plan.unitOz.sourceNote,
            unit_oz_established_at: new Date().toISOString(),
            // NULL is honest: the seeds audit with actorId null, so there is genuinely
            // nobody to name. Never backfill a placeholder actor (0179's own comment).
            unit_oz_established_by: null,
            updated_at: new Date().toISOString(),
            updated_by: null,
          },
          { count: "exact" },
        )
        .eq("id", productId)
        .is("unit_oz", null); // guard: only fill a row still reading NULL.
      if (error) throw new Error(`set unit_oz ${label}: ${error.message}`);
      if (!count) {
        throw new Error(`FATAL: unit_oz write for ${label} matched 0 rows — the row moved under the guard. Refusing.`);
      }
      out.unitOzWritten = true;
      p(`  + unit_oz = ${r.plan.unitOz.value} (${r.plan.unitOz.klass})`);
      await audit({
        actorId: null,
        actorRole: null,
        action: "product.unit_oz_set",
        resourceTable: "products",
        resourceId: productId,
        metadata: seedMeta("Establish what one unit of the product weighs, from Juan's operational weighing.", {
          product_name: r.plan.name,
          before_unit_oz: null,
          before_unit_oz_class: before.unit_oz_class,
          after_unit_oz: r.plan.unitOz.value,
          after_unit_oz_class: r.plan.unitOz.klass,
          weight_class: r.plan.unitOz.klass,
          source_note: r.plan.unitOz.sourceNote,
        }),
        ipAddress: null,
        userAgent: null,
      });
    }
  }

  return out;
}

/**
 * The orderability assertion. This seed attaches IDENTITY; it does not adjudicate
 * orderability. Seed 18 already made that decision and re-litigating it by accident
 * — even by one stray column in an update payload — would silently undo Juan's P1
 * ruling. Snapshot before, re-read after, FATAL on any movement. Gate S1 verifies
 * exactly this, so the script proves it rather than promising it.
 */
async function assertNoOrderabilityDrift(
  sb: Sb,
  snapshot: Map<string, { active: boolean; weekdayPar: number | null; weekendPar: number | null; label: string }>,
): Promise<void> {
  const ids = [...snapshot.keys()];
  const { data, error } = await sb
    .from("vendor_items")
    .select("id, active, weekday_par, weekend_par")
    .in("id", ids)
    .returns<Array<{ id: string; active: boolean | null; weekday_par: number | string | null; weekend_par: number | string | null }>>();
  if (error) throw new Error(`orderability re-read: ${error.message}`);
  const drift: string[] = [];
  for (const row of data ?? []) {
    const was = snapshot.get(row.id);
    if (!was) continue;
    const now = { active: row.active ?? true, weekdayPar: num(row.weekday_par), weekendPar: num(row.weekend_par) };
    if (now.active !== was.active || now.weekdayPar !== was.weekdayPar || now.weekendPar !== was.weekendPar) {
      drift.push(
        `${was.label}: active ${was.active}→${now.active}, weekday_par ${was.weekdayPar}→${now.weekdayPar}, weekend_par ${was.weekendPar}→${now.weekendPar}`,
      );
    }
  }
  if (drift.length > 0) {
    throw new Error(
      `FATAL: this seed moved orderability, which it must never do:\n  ${drift.join("\n  ")}\nSeed 18's P1 adjudication owns those columns.`,
    );
  }
  p(`  ✓ orderability unchanged on all ${ids.length} member SKUs (active / weekday_par / weekend_par re-read from the destination).`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const sb = getServiceRoleClient();

  if (MD) {
    p("# Product identity — seed 24 DRY RUN (the 8-pair adjudication sheet)");
    p();
    p(
      EXECUTE
        ? "> **STATUS: EXECUTE MODE.** This run WRITES to `products`, `vendor_items.product_id` and `product_primaries`."
        : "> **STATUS: NOTHING HAS BEEN WRITTEN.** This is the output of `scripts/seed/24-product-identity.ts` in its " +
            "default (dry-run) mode. The script writes only under an explicit `--execute` flag, and that flag is " +
            "**gate S1** — it is not used until Juan has eyeballed section 3 and adjudicated the open pairs.",
    );
    p();
    p(
      `**Generated:** ${new Date().toISOString().slice(0, 10)}, against live prod (\`bgcvurheqzylyfehqgzh\`) with migration ` +
        "`0179_product_identity` applied. Every SKU id, vendor, par, weight, pack content, price and delivery date below " +
        "was resolved **live at run time** — nothing is copied from the audit's tables.",
    );
    p();
    p(`**Sources:** ${DECISION_SOURCES}`);
  } else {
    p(
      EXECUTE
        ? "══ EXECUTE MODE — this run WRITES to products / vendor_items.product_id / product_primaries ══"
        : "══ DRY RUN (default) — no writes. Pass --execute to write (GATE S1: lead only). ══",
    );
    p(`\nSOURCES: ${DECISION_SOURCES}`);
  }

  const measures = await loadMeasures();
  if (measures.size === 0) {
    throw new Error("FATAL: measure_units loaded empty — every pack-content figure below would be a guess.");
  }

  const cat = await loadCatalog(sb, measures);
  const candidates = discoverCandidates(cat);
  const resolved = PRODUCTS.map((plan) => resolvePlan(cat, plan));

  // Plan sanity: exactly one of primary/proposed, and a proposal is never a write.
  for (const r of resolved) {
    if (r.plan.primary != null && r.plan.proposed != null) {
      throw new Error(
        `FATAL: ${r.plan.name} carries BOTH a ruled primary and a proposal. A proposal is what an unruled pair has; a ruling replaces it.`,
      );
    }
  }

  reportDiscovery(cat, candidates);
  reportPlan(resolved);
  reportDecisionTable(cat, resolved);
  reportIceberg(resolved);
  reportUnitOz(resolved);

  h(2, "6 — What this seed will NOT touch");
  p(
    "- **`active`, `weekday_par`, `weekend_par`** on any SKU. Seed 18 adjudicated orderability and seed 21 §B finished " +
      "the lettuce pair; re-litigating either here would silently undo Juan's P1 decision. The execute run snapshots " +
      "all three columns on every member and re-reads them afterwards — any movement is a FATAL, not a warning.",
  );
  p("- **`recipe_inputs`.** Not one pin moves. Re-pointing is Phase 4, deliberately after the reader exists (deviation D1).");
  p("- **`vendor_price_history`.** Append-only and untouched; no price is derived, corrected or attributed here.");
  p("- **`avg_oz_per_each`** on any SKU. The SKU layer's weights are the SKU layer's business; `products.unit_oz` is a new, separate fact.");
  p("- **Any behavior.** Nothing in the app reads `vendor_items.product_id` until Phase 3, so every board, walk and count sheet renders byte-identically after this runs.");

  // ── The write half ─────────────────────────────────────────────────────────
  h(2, "7 — Writes");
  const outcomes: Outcome[] = [];
  const snapshot = new Map<string, { active: boolean; weekdayPar: number | null; weekendPar: number | null; label: string }>();
  for (const r of resolved) {
    for (const m of r.members) {
      snapshot.set(m.sku.id, {
        active: m.sku.active,
        weekdayPar: m.sku.weekdayPar,
        weekendPar: m.sku.weekendPar,
        label: `${m.sku.vendorName}/${m.sku.name}`,
      });
    }
  }

  if (!EXECUTE) {
    pre();
    for (const r of resolved) {
      const memberWrites = r.members.filter((m) => m.sku.productId == null).length;
      const memberSkips = r.members.length - memberWrites;
      p(`${r.plan.name}`);
      p(`  ${r.existing == null ? "would CREATE" : "= reuse"} products row`);
      p(`  would attach ${memberWrites} member${memberWrites === 1 ? "" : "s"}${memberSkips > 0 ? ` (${memberSkips} already attached)` : ""}`);
      p(
        r.plan.primary == null
          ? `  NO primary row${r.plan.proposed == null ? " (single member)" : ` — UNADJUDICATED (proposal: ${r.plan.proposed.vendor})`}`
          : `  would set primary = ${r.plan.primary.vendor}${r.plan.primary.isInferred ? "  ⚠ INFERRED" : ""}`,
      );
      if (r.plan.unitOz != null) p(`  would set unit_oz = ${r.plan.unitOz.value} (${r.plan.unitOz.klass})`);
    }
    pre();
  } else {
    for (const r of resolved) {
      p(`\n${r.plan.name}`);
      outcomes.push(await applyProduct(sb, r));
    }
    p();
    await assertNoOrderabilityDrift(sb, snapshot);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  h(2, "8 — Summary");
  const plannedProducts = resolved.filter((r) => r.existing == null).length;
  const plannedMembers = resolved.reduce((a, r) => a + r.members.filter((m) => m.sku.productId == null).length, 0);
  const plannedPrimaries = resolved.filter((r) => r.plan.primary != null).length;
  const plannedUnitOz = resolved.filter((r) => r.plan.unitOz != null).length;
  const openPairs = resolved.filter((r) => r.plan.proposed != null).length;

  if (!EXECUTE) {
    table(
      ["would write", "count"],
      [
        ["`products` rows", String(plannedProducts)],
        ["member attachments (`vendor_items.product_id`)", String(plannedMembers)],
        ["`product_primaries` rows", `${plannedPrimaries}  *(1 explicit, ${plannedPrimaries - 1} inferred)*`],
        ["`products.unit_oz` fills", String(plannedUnitOz)],
        ["**pairs left UNADJUDICATED (no primary row)**", `**${openPairs}**`],
        ["rows touching `active` / par / pins / prices", "**0**"],
      ],
      ["", "r"],
    );
    p();
    p(
      `**${openPairs} of ${resolved.length} products will have no primary row after this seed runs.** That is the ` +
        "designed end-state of the dry run, not a shortfall: resolution answers them on the ladder's lower rungs " +
        "(section 3's ladder column shows exactly what each one answers today), and a primary nobody designated would " +
        "be a fact invented by a script.",
    );
    p();
    h(3, "To proceed");
    pre();
    p("# 1. Juan adjudicates section 3 (and rules on section 4's ICEBERG question).");
    p("# 2. LEAD encodes the answers in PRODUCTS (swap `proposed` -> `primary`) and re-runs the dry run.");
    p("# 3. LEAD runs, and pastes the output into the PR:");
    p(`npx tsx --conditions=react-server --env-file=.env.local ${SCRIPT} --execute`);
    pre();
    p();
    p(
      "Every write is guarded on the live row still reading the state the plan was built against — `.is(\"product_id\", " +
        "null)` on an attach, `.is(\"unit_oz\", null)` on a weight, an existing-row check before a primary — so a second " +
        "run reports \"already\" on everything and writes nothing.",
    );
  } else {
    table(
      ["product", "products", "members", "primary", "unit_oz"],
      outcomes.map((o) => [
        o.product,
        o.productCreated ? "created" : "reused",
        `+${o.membersAttached}${o.membersAlready ? ` (=${o.membersAlready})` : ""}${o.membersRefused ? ` ✗${o.membersRefused}` : ""}`,
        o.primaryWritten ? "written" : o.primaryAlready ? "already" : o.primaryRefused ? "REFUSED" : "deferred",
        o.unitOzWritten ? "written" : o.unitOzAlready ? "already" : o.unitOzRefused ? "REFUSED" : "—",
      ]),
    );
    const refusals = outcomes.flatMap((o) => o.refusals);
    if (refusals.length > 0) {
      p();
      p(`⚠ ${refusals.length} REFUSAL(S) — nothing was forced:`);
      for (const r of refusals) p(`  · ${r}`);
    }
  }

  p();
  p(`Seed 24 done (${EXECUTE ? "execute" : "dry run"}).`);
  if (!EXECUTE) p("**NOTHING WAS WRITTEN.**");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
