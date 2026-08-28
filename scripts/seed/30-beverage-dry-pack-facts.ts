/**
 * Seed 30 — PACK FACTS for the weight-gap long tail: Juan's labels + Angel derivations.
 * 2026-08-28. Closes most of the 54 `no_weight_basis` rows the Dynamic Pars reason lane
 * surfaced (27 SKUs — the drinks/jars/dry-goods tail; Juan's food weighs were never the gap).
 *
 * Source A, Juan verbatim (2026-08-28):
 *   "Coke and Diet Coke each come in 35x12fl oz … c/o water 24x12 fl oz… all doctor
 *    browns flavors come in backs of 6x12 fl oz… the lemonade is 6x12fl oz… the just ice
 *    teas come in packs of 12x12fl oz… Saratoga comes in a pack of 24x12fl oz … the
 *    sweet/hot/banana peppers are all 4x128fl oz… The the cannolies I still got to do…
 *    but can't we derive the rest from the angel spend inventory?"
 *
 * Source B, Angel Spend (in-repo: docs/seed/source/angel-product-catalog.csv +
 * inventory-costing.csv), derivation per row cited in DERIVED below.
 *
 * ── WHAT IT WRITES ───────────────────────────────────────────────────────────
 * FLAT PACK FIELDS ONLY (pack_format / units_per_pack / each_size / each_measure) — the
 * same fields the SKU admin edits, audited as `vendor_item.update` with seed provenance.
 * It touches NO pack chains, NO prices, NO avg_oz_per_each (that column answers a
 * different question — the per-EACH weight, e.g. one pepper — and one column meaning two
 * things is how the last mess started). `fl oz` is a live measure (dimension volume,
 * to_base_factor 1), so 35 × 12 fl oz resolves to a 420 oz order unit with no new unit law.
 *
 * JUAN'S LABELS (written as stated):
 *   Coke 35×12 fl oz · Diet Coke 35×12 · Branded (C/O) Water 24×12 · Saratoga 24×12 ·
 *   DB Cel Ray / Cherry / Cream / Diet Cherry / Diet Cream / Root Beer 6×12 ·
 *   Natalie's Lemonade 6×12 (REPAIRS the malformed "Case of 1 × 6 count" shape) ·
 *   Banana / Hot / Sweet Peppers case of 4 × 128 fl oz jars (units_per_pack 4 confirmed).
 *
 * DERIVED (Angel, provenance in each row's audit metadata):
 *   Parmesan (Grated)  PFG 4/5 LB tub        → Case of 4 × 80 oz     [catalog: CHEESE PARMESAN GRATED TUB 4/5 LB]
 *   Cholula            64 oz jug             → Each of 1 × 64 oz     [catalog 4/64 OZ + inventory-costing 64 oz]
 *   Canola Oil         PFG 1/35 LB           → Each of 1 × 560 oz    [catalog: OIL CANOLA CLR FRY 1/35 LB]
 *   Watermelon Radish  PFG 1/10 LB bag       → Bag of 1 × 160 oz     [catalog: RADISH WATERMELON 1/10 LB]
 *   Chicken Breast     PFG 4/10 LB → the BAG → Bag of 1 × 160 oz     [catalog: CHICKEN BRST 4/10 LB; CO's
 *                       pack_format is already "Bag" — the order unit is the bag, A-FLAGGED:
 *                       if CO actually orders the 4-bag case, units_per_pack becomes 4]
 *   Eggs               flat of 30 × 1.8 oz   → Flat of 30 × 1.8 oz   [ASSUMED standard flat; Angel's
 *                       catalog row is 1/30 DZ (a 360-egg case) — if CO orders THAT, say so]
 *   Cannoli Shell      PFG 1/120 CT          → Case of 120 count     [catalog; COUNT ONLY — the
 *                       per-shell WEIGHT stays open until Juan weighs one ("still got to do")]
 *
 * HELD — no honest source yet (the 7 label reads left):
 *   Balsamic GLAZE (Angel has balsamic VINEGAR 2/5 LT — a different product; not conflated) ·
 *   Fusilli Pasta · Whole Pickles (two part-facts exist: 45/pail + Delmar "5 GALLON GARLIC
 *   PICKLES" — brine-vs-pickle oz needs Juan's read) · Fruity Pebbles · Frooties ·
 *   Employee Water (Juan's 24×12 was the BRANDED water) · Gluten Free Bread.
 *
 * NOTED, not writable: the "Just" iced teas (12×12 fl oz per Juan) are NOT vendor_items
 * yet — the fact is recorded here for whenever those SKUs are created.
 *
 * DRY RUN IS THE DEFAULT; --execute is lead-gated. Refuses any SKU whose targeted flat
 * fields are ALREADY fully populated (repairs go through the SKU admin, not a seed
 * re-run) — Natalie's Lemonade is the one deliberate exception, named inline.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local \
 *        scripts/seed/30-beverage-dry-pack-facts.ts             -> DRY RUN
 *      ... --execute                                            -> WRITES (lead-gated)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";

const EXECUTE = process.argv.includes("--execute");

interface PackFact {
  skuName: string;
  packFormat: string;
  unitsPerPack: number;
  eachSize: number;
  eachMeasure: string;
  provenance: string;
  /** Allow overwriting a malformed existing shape (named exception). */
  repair?: boolean;
}

const FACTS: PackFact[] = [
  // ── Juan's labels ──────────────────────────────────────────────────────────
  { skuName: "Coke", packFormat: "Case", unitsPerPack: 35, eachSize: 12, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28" },
  { skuName: "Diet Coke", packFormat: "Case", unitsPerPack: 35, eachSize: 12, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28" },
  { skuName: "Branded (C/O) Water", packFormat: "Case", unitsPerPack: 24, eachSize: 12, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28" },
  { skuName: "Saratoga", packFormat: "Case", unitsPerPack: 24, eachSize: 12, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28" },
  { skuName: "DB Cel Ray", packFormat: "Pack", unitsPerPack: 6, eachSize: 12, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28" },
  { skuName: "DB Cherry Soda", packFormat: "Pack", unitsPerPack: 6, eachSize: 12, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28" },
  { skuName: "DB Cream Soda", packFormat: "Pack", unitsPerPack: 6, eachSize: 12, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28" },
  { skuName: "DB Diet Cherry Soda", packFormat: "Pack", unitsPerPack: 6, eachSize: 12, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28" },
  { skuName: "DB Diet Cream Soda", packFormat: "Pack", unitsPerPack: 6, eachSize: 12, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28" },
  { skuName: "DB Root Beer", packFormat: "Pack", unitsPerPack: 6, eachSize: 12, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28" },
  { skuName: "Natalie's Lemonade", packFormat: "Case", unitsPerPack: 6, eachSize: 12, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28", repair: true },
  { skuName: "Banana Peppers", packFormat: "Case", unitsPerPack: 4, eachSize: 128, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28" },
  { skuName: "Hot Peppers", packFormat: "Case", unitsPerPack: 4, eachSize: 128, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28" },
  { skuName: "Sweet Peppers", packFormat: "Case", unitsPerPack: 4, eachSize: 128, eachMeasure: "fl oz", provenance: "juan-label-2026-08-28" },
  // ── Angel derivations ─────────────────────────────────────────────────────
  { skuName: "Parmesan (Grated)", packFormat: "Case", unitsPerPack: 4, eachSize: 80, eachMeasure: "oz", provenance: "angel-catalog: CHEESE PARMESAN GRATED TUB 4/5 LB" },
  { skuName: "Cholula", packFormat: "Each", unitsPerPack: 1, eachSize: 64, eachMeasure: "oz", provenance: "angel-catalog 4/64 OZ + inventory-costing 64 oz jug" },
  { skuName: "Canola Oil", packFormat: "Each", unitsPerPack: 1, eachSize: 560, eachMeasure: "oz", provenance: "angel-catalog: OIL CANOLA CLR FRY 1/35 LB" },
  { skuName: "Watermelon Radish", packFormat: "Bag", unitsPerPack: 1, eachSize: 160, eachMeasure: "oz", provenance: "angel-catalog: RADISH WATERMELON 1/10 LB" },
  { skuName: "Chicken Breast", packFormat: "Case", unitsPerPack: 4, eachSize: 160, eachMeasure: "oz", provenance: "angel-catalog: CHICKEN BRST 4/10 LB — Juan RULED 2026-08-28: 'def a case' → Case of 4 × 10 lb bags", repair: true },
  // CORRECTED post-execute, same day: Juan first confirmed the 30-flat, then reversed on
  // seeing it in context — "the eggs come in the 360 pack… we get way more than 30 at a
  // time." Angel's catalog row (1/30 DZ = 360 eggs) was right all along. The live row was
  // fixed directly (audited, source seed-30-correction-2026-08-28); this constant carries
  // the FINAL fact so a re-read of this file never resurrects the flat.
  { skuName: "Eggs", packFormat: "Case", unitsPerPack: 360, eachSize: 1.8, eachMeasure: "oz", provenance: "angel-catalog 1/30 DZ = 360-egg case, Juan RULED 2026-08-28 ('we get way more than 30 at a time') × CO's measured 1.8 oz/egg" },
  { skuName: "Cannoli Shell", packFormat: "Case", unitsPerPack: 120, eachSize: 1, eachMeasure: "count", provenance: "angel-catalog: SHELL CANNOLI SM 1/120 CT — COUNT ONLY; per-shell oz open until Juan weighs one" },
  { skuName: "Balsamic Glaze", packFormat: "Each", unitsPerPack: 1, eachSize: 27, eachMeasure: "oz", provenance: "juan-label-2026-08-28: '27oz per bottle'" },
  // Two VARIABLE-WEIGHT goods, shape recorded honestly. Neither clears the weight rung —
  // and must not: a wrapped pickle and a locally-baked loaf genuinely differ each time, so
  // any fixed oz here would be a fabrication. The remaining errand for each is an
  // OPERATIONAL average (the 3-sample surprise-weigh class, Juan's ham precedent); until
  // then the reason lane keeps saying no_weight_basis, which is the truth.
  { skuName: "Whole pickles", packFormat: "Each", unitsPerPack: 1, eachSize: 1, eachMeasure: "count", provenance: "juan-2026-08-28: 'just a whole wrapped pickle… they come in different sizes' — VARIABLE WEIGHT; avg weigh = the open errand" },
  { skuName: "Gluten Free Bread", packFormat: "Each", unitsPerPack: 1, eachSize: 1, eachMeasure: "count", provenance: "juan-2026-08-28: baked locally, loaves differ in weight — VARIABLE WEIGHT; avg weigh = the open errand", repair: true },
];

const HELD = [
  "Fusilli Pasta — no Angel row, no label yet. Label read.",
  "Fruity Pebbles — Amazon, Angel can't see it. Label read.",
  "Frooties — 'come in bags' (Juan) but no bag count/oz yet. Label read.",
  "Employee Water — Juan's 24×12 was the BRANDED water; this one still needs its count.",
];

async function main() {
  const sb = getServiceRoleClient();
  const { data: skus, error } = await sb.from("vendor_items")
    .select("id, name, pack_format, units_per_pack, each_size, each_measure")
    .returns<Array<{ id: string; name: string; pack_format: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null }>>();
  if (error) throw new Error(`skus: ${error.message}`);
  const byName = new Map((skus ?? []).map((s) => [s.name, s]));

  console.log(`\nSeed 30 — pack facts (Juan's labels + Angel) — ${EXECUTE ? "EXECUTE" : "DRY RUN"}\n`);

  for (const f of FACTS) {
    const sku = byName.get(f.skuName);
    if (!sku) { console.log(`✗ ${f.skuName} — SKU NOT FOUND, skipped.`); continue; }
    const populated = sku.units_per_pack != null && sku.each_size != null && sku.each_measure != null;
    if (populated && !f.repair) {
      console.log(`✗ ${f.skuName} — already fully populated, REFUSED (repairs go through the SKU admin).`);
      continue;
    }
    const before = `${sku.pack_format ?? "∅"}/${sku.units_per_pack ?? "∅"}×${sku.each_size ?? "∅"} ${sku.each_measure ?? ""}`.trim();
    console.log(`✓ ${f.skuName} — ${before} → ${f.packFormat} of ${f.unitsPerPack} × ${f.eachSize} ${f.eachMeasure}${f.repair ? "  [REPAIR]" : ""}`);
    console.log(`  ${f.provenance}`);
    if (!EXECUTE) continue;

    const { error: uErr, count } = await sb.from("vendor_items")
      .update({
        pack_format: f.packFormat, units_per_pack: f.unitsPerPack,
        each_size: f.eachSize, each_measure: f.eachMeasure,
      }, { count: "exact" })
      .eq("id", sku.id);
    if (uErr) throw new Error(`${f.skuName} update: ${uErr.message}`);
    if (count === 0) throw new Error(`${f.skuName}: UPDATE matched 0 rows`);
    await audit({
      actorId: null, actorRole: null,
      action: "vendor_item.update", resourceTable: "vendor_items", resourceId: sku.id,
      metadata: {
        source: "seed-30-pack-facts-2026-08-28", provenance: f.provenance,
        before, after: `${f.packFormat} of ${f.unitsPerPack} × ${f.eachSize} ${f.eachMeasure}`,
      },
      ipAddress: null, userAgent: null,
    });
  }

  console.log(`\nHELD (${HELD.length} label reads remain):`);
  for (const h of HELD) console.log(`  ⏸ ${h}`);
  console.log(`\nNOTED: "Just" iced teas = 12×12 fl oz (Juan) — not vendor_items yet; fact recorded for creation.`);
  console.log(`${EXECUTE ? "\nWRITTEN." : "\nNothing written (dry run)."}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
