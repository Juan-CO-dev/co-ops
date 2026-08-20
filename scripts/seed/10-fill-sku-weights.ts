/**
 * Seed 10 — fill SKU per-each weights + register recipe units, so the recipe→SKU flatten resolves
 * (unblocking catering depletion / W4a-W4b + real production depletion).
 *
 * TWO writes:
 *  (1) Register the informal recipe units as measure_units (each/unit/handful/leaf/clove/sprig/can +
 *      volume quart/cup/Tbsp/tsp/#10 can). Count-ish → count dim; volume → volume dim (the oz-model
 *      uses avg_oz_per_each for non-weight units, so the factor is informational).
 *  (2) Set avg_oz_per_each = "oz per ONE of that SKU's recipe unit" on the CONFIDENT SKUs (deli slices,
 *      rolls, eggs, chips, herbs, oils…), + pack fields on the placeholder ones (for content/cost).
 *
 * ALL avg_oz_per_each values here are ESTIMATES (my best food-knowledge inference) pending Juan's scale
 * weights — see the weigh-checklist (CHIEF + memory). For COUNT items the weight cancels in the
 * reorder-packs math, so "order N packs" is exact regardless. Ambiguous "unit" produce, the Onion
 * each/quart conflict, cans, Mixed Herbs, Shredded Mozz are DEFERRED to the checklist (not guessed).
 *
 * ── AMENDED 2026-08-20 BY THE ANGEL HARVEST-2 PIECE MODEL (wave 3) ────────────
 * Three constants below are no longer estimates — they are corrected against vendor
 * spec data, and they are amended HERE as well as in the DB so that a future re-run
 * of this seed cannot silently regress them (which is exactly what a re-run of the
 * un-amended file would do):
 *   · Bacon 0.75 → 1.23 oz/strip. The Angel subtitle `IMP LAYER BACON 12/14` is a
 *     SLICE SPEC — 12-14 strips per POUND — so 16/13 = 1.23. The old 0.75 implied
 *     21.3 strips/lb and understated bacon cost by 64%. Corroborated from the other
 *     direction: the 240 oz box ÷ 1.23 = 195 strips, dead centre of 180-210.
 *   · Fresh Mozzarella unitsPerPack 72 → 192. One case is 6 logs × 32 CT × 1 oz =
 *     192 slices = 12 lb, which closes against BOTH the `6/2 LB` pack field and the
 *     `12 LB` subtitle. At 72 the implied case is 4.5 lb — neither number.
 *   · Ever Roast Chicken added at 1.0 oz/slice (it had no entry at all).
 * Full evidence + the arithmetic: docs/ANGEL-HARVEST-2-PIECES.md §1 and §3, and the
 * dry-run report docs/seed/source/angel-wave3-dryrun.md.
 *
 * ── JUAN'S RULING, 2026-08-20: OPERATIONAL WEIGHTS SUPERSEDE THIS FILE'S SPEC ─────
 * Wave 3's dry run STOPPED on five rows whose production values matched neither this
 * file nor the piece model, with no audit row explaining them. Juan's answer: **the
 * live values are his own measurements** — 3-sample averages taken as a SURPRISE
 * check, slicing unchanged and unbiased.
 *
 * So the numbers below were never rival readings of one quantity. They are two
 * different quantities that had been sharing a column:
 *
 *   SPEC / ASPIRATIONAL   what a slice should weigh at the intended thickness
 *   OPERATIONAL           what a slice actually weighs coming off our slicer
 *
 * Costing and depletion answer "how much product left the building", so they take the
 * OPERATIONAL number. Slices are normal thickness — operations simply differ from
 * spec, which is the ordinary condition of every kitchen and not a defect.
 *
 * The five ruled rows below are therefore updated to Juan's measured values:
 *   Genoa 1.0 → 0.4 · Capicola 1.0 → 0.4 · Provolone 0.75 → 0.7 ·
 *   Pepperoni 0.25 → 0.2 · Ham 1.0 → 1.2
 *
 * ⚠⚠ **DO NOT "CORRECT" THESE BACK FROM A SPEC SHEET.** A Boar's Head cut sheet, a
 * recipe card or a food-knowledge prior will all disagree with these numbers, and all
 * three are describing the spec quantity, not this one. They were measured on OUR
 * line. Anything that moves them needs another weigh, not another reference.
 *
 * Turkey (1.0), Roast Beef (1.5) and Bacon never diverged from this file, so either
 * they were not weighed or they came back at spec; both leave nothing to record.
 * Bacon's separate 0.75 → 1.23 correction is NOT the ruling — it is vendor-portioned
 * (a 12/14 layer box we do not slice), so the vendor spec IS its operational fact.
 *
 * ── SELECTING THE RIGHT ROW WHEN A NAME IS DUPLICATED ─────────────────────────
 * `Ham` and `Fresh Mozzarella` each have TWO active twins (PFG + Baldor) since the
 * multi-vendor P1 adjudication. The placeholder-preferring heuristic below used to
 * disambiguate them by accident; now that both twins carry pack data it would fall
 * through to `list[0]`, whose ORDER IS UNDEFINED — a coin flip over which twin gets
 * written. The optional `vendor` field pins those two rows to the twin this seed
 * historically wrote (confirmed against its own audit rows), so a re-run is
 * deterministic rather than lucky.
 *
 * Idempotent. SEED_DRY=1 → report. Run:
 *   SEED_DRY=1 npx tsx --env-file=.env.local scripts/seed/10-fill-sku-weights.ts   (dry)
 *   npx tsx --env-file=.env.local scripts/seed/10-fill-sku-weights.ts               (prod)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";

// (1) Recipe units to register. factor: count=1; volume = fl-oz-per-unit (informational — the model
// converts non-weight units via the SKU's avg_oz_per_each).
const UNITS: Array<{ label: string; dimension: "count" | "volume"; factor: number }> = [
  { label: "each", dimension: "count", factor: 1 },
  { label: "unit", dimension: "count", factor: 1 },
  { label: "handful", dimension: "count", factor: 1 },
  { label: "leaf", dimension: "count", factor: 1 },
  { label: "clove", dimension: "count", factor: 1 },
  { label: "sprig", dimension: "count", factor: 1 },
  { label: "can", dimension: "count", factor: 1 },
  { label: "quart", dimension: "volume", factor: 32 },
  { label: "cup", dimension: "volume", factor: 8 },
  { label: "Tbsp", dimension: "volume", factor: 0.5 },
  { label: "tsp", dimension: "volume", factor: 0.166667 },
  { label: "#10 can", dimension: "volume", factor: 109 },
];

// (2) CONFIDENT SKU fills. avgOz = oz per ONE of its recipe unit (estimate). pack (placeholders only)
// = units_per_pack × each_size × each_measure for content/cost.
interface Pack { unitsPerPack: number; eachSize: number; eachMeasure: string; packFormat: string }
/** `vendor` is set ONLY on the duplicated names (Ham, Fresh Mozzarella) — see the
 *  header. Elsewhere it is omitted and the placeholder heuristic still applies. */
const FILLS: Array<{ name: string; avgOz: number; note: string; pack?: Pack; vendor?: string }> = [
  { name: "Sub Roll", avgOz: 4.0, note: "each = one 8in roll; 6/pack, 5 packs/rack (Juan)", pack: { unitsPerPack: 6, eachSize: 1, eachMeasure: "each", packFormat: "pack" } },
  { name: "Ham", avgOz: 1.2, note: "unit = one deli slice — OPERATIONAL, Juan surprise 3-sample 2026-08-20 (spec was 1.0); do not correct back from spec", vendor: "Baldor", pack: { unitsPerPack: 1, eachSize: 16, eachMeasure: "oz", packFormat: "case" } },
  { name: "Mortadella", avgOz: 1.0, note: "unit = one slice", pack: { unitsPerPack: 1, eachSize: 16, eachMeasure: "oz", packFormat: "case" } },
  { name: "Prosciutto", avgOz: 0.5, note: "each = one thin slice", pack: { unitsPerPack: 1, eachSize: 12, eachMeasure: "oz", packFormat: "case" } },
  // CORRECTED 2026-08-20 (harvest 2): "12/14" on the Angel subtitle is 12-14 strips per POUND,
  // so 16/13 = 1.23 oz/strip. The prior 0.75 implied 21.3/lb and understated bacon cost 64%.
  // The 240 oz case was already right — it matches Angel's 15.0 lb box to the ounce.
  { name: "Bacon", avgOz: 1.23, note: "each = one strip; 12/14 slice spec = 12-14 per lb → 16/13 (harvest 2, was 0.75)", pack: { unitsPerPack: 1, eachSize: 240, eachMeasure: "oz", packFormat: "case" } },
  // ── The four ruled deli slices. OPERATIONAL weights (Juan surprise 3-sample averages,
  // 2026-08-20). The parenthesised figure is the SPEC value these replace — kept in the
  // note so nobody has to go digging for what changed, and so the gap stays visible.
  { name: "Capicola", avgOz: 0.4, note: "unit = one slice — OPERATIONAL, Juan surprise 3-sample 2026-08-20 (spec was 1.0); do not correct back from spec" },
  { name: "Genoa", avgOz: 0.4, note: "unit = one slice — OPERATIONAL, Juan surprise 3-sample 2026-08-20 (spec was 1.0); do not correct back from spec" },
  { name: "Pepperoni", avgOz: 0.2, note: "unit = one thin slice — OPERATIONAL, Juan surprise 3-sample 2026-08-20 (spec was 0.25); do not correct back from spec" },
  { name: "Provolone", avgOz: 0.7, note: "unit = one slice — OPERATIONAL, Juan surprise 3-sample 2026-08-20 (spec was 0.75); do not correct back from spec" },
  { name: "Cheddar", avgOz: 0.75, note: "unit = one slice" },
  { name: "Roast Beef", avgOz: 1.5, note: "unit = one slice (thicker cut)" },
  { name: "Turkey", avgOz: 1.0, note: "unit = one slice" },
  // ADDED 2026-08-20 (harvest 2): had no entry at all. Sliced deli chicken breast, behaves like
  // turkey; the piece model agrees (74.1 oz / 74 slices = 1.0014).
  { name: "Ever Roast Chicken", avgOz: 1.0, note: "unit = one slice; behaves like turkey (harvest 2). SPEC — piece-model derived, PENDING a Juan surprise-weigh; every deli slice he has actually weighed came in 20-60% off spec, so treat this as a placeholder" },
  // CORRECTED 2026-08-20 (harvest 2): unitsPerPack 72 → 192. One case = 6 logs x 32 CT x 1 oz =
  // 192 slices = 12 lb, closing against both the "6/2 LB" pack field and the "12 LB" subtitle.
  // At 72 the implied case is 4.5 lb — neither the nominal nor the 12.76 lb measured.
  { name: "Fresh Mozzarella", avgOz: 1.0, note: "unit = one 1 oz slice; case = 6 logs x 32 CT (harvest 2, units was 72)", vendor: "Baldor", pack: { unitsPerPack: 192, eachSize: 1, eachMeasure: "each", packFormat: "case" } },
  { name: "Eggs", avgOz: 1.8, note: "each = one large egg" },
  { name: "Utz Ripples", avgOz: 1.0, note: "handful ≈ 1 oz", pack: { unitsPerPack: 1, eachSize: 7.75, eachMeasure: "oz", packFormat: "bag" } },
  { name: "Arugula", avgOz: 0.5, note: "handful of leaves ≈ 0.5 oz" },
  { name: "Pickle slices", avgOz: 0.2, note: "unit = one slice", pack: { unitsPerPack: 1500, eachSize: 1, eachMeasure: "each", packFormat: "tub" } },
  { name: "Garlic", avgOz: 0.17, note: "clove ≈ 0.17 oz" },
  { name: "Thyme", avgOz: 0.02, note: "sprig ≈ 0.02 oz" },
  { name: "Olive Oil", avgOz: 0.48, note: "Tbsp ≈ 0.48 oz" },
  { name: "Heavy Cream", avgOz: 32.0, note: "quart ≈ 32 oz" },
  { name: "Confectioners Sugar", avgOz: 4.0, note: "cup ≈ 4 oz" },
  { name: "Vanilla Bean Paste", avgOz: 0.2, note: "tsp ≈ 0.2 oz", pack: { unitsPerPack: 1, eachSize: 32, eachMeasure: "oz", packFormat: "jar" } },
  // ── Batch 2: needed to finish unblocking the subs/sides. LOWER CONFIDENCE — verify on the weigh-list. ──
  // Whole-vegetable "unit"/"each" — estimate cancels in the reorder-packs math (it's count-based).
  { name: "Onion (White)", avgOz: 8.0, note: "each = whole large onion. NOTE also used 'quart' (1 recipe) — that line under-counts until recipe fixed" },
  { name: "Onion (red)", avgOz: 5.0, note: "unit = whole red onion" },
  { name: "Cucumber", avgOz: 8.0, note: "unit = whole cucumber" },
  { name: "Tomatoes", avgOz: 5.0, note: "unit = whole tomato" },
  { name: "Hot Peppers", avgOz: 1.0, note: "unit = whole small pepper — LOW confidence" },
  { name: "Sweet Peppers", avgOz: 4.0, note: "unit = whole bell — LOW confidence" },
  { name: "Iceberg", avgOz: 20.0, note: "unit = one head — LOW confidence" },
  { name: "Watermelon Radish", avgOz: 3.0, note: "unit = whole radish" },
  { name: "Basil", avgOz: 0.1, note: "conflicting units (leaf + unit) — recipe data bug; verify" },
  { name: "Shredded Mozz", avgOz: 2.0, note: "unit = a portion — LOW confidence" },
  // Volume/can — estimate does NOT cancel; these genuinely need real numbers (density/can size).
  { name: "Duke's Mayo", avgOz: 130.0, note: "gallon ≈ 130 oz by weight — verify" },
  { name: "Mixed Herbs", avgOz: 4.0, note: "quart — VERY low confidence, verify" },
  { name: "Tomatoes Crushed (10#)", avgOz: 109.0, note: "#10 can ≈ 109 oz" },
  { name: "Tuna", avgOz: 66.6, note: "can = the 66.6 oz can (per inventory) — verify vs a small can" },
];

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");

  // (1) units
  let unitsAdded = 0, unitsSkipped = 0;
  for (const u of UNITS) {
    const { data: ex } = await sb.from("measure_units").select("label").eq("label", u.label).maybeSingle<{ label: string }>();
    if (ex) { unitsSkipped++; continue; }
    unitsAdded++;
    if (!DRY) {
      const { error } = await sb.from("measure_units").insert({ label: u.label, dimension: u.dimension, to_base_factor: u.factor, active: true });
      if (error) throw new Error(`measure_units ${u.label}: ${error.message}`);
    }
  }

  // (2) SKU fills (global active vendor_items by name)
  let filled = 0, unchanged = 0;
  const missing: string[] = [];
  for (const f of FILLS) {
    // Some names are duplicated (an auto-placeholder + a real twin); the recipes reference the
    // PLACEHOLDER, so prefer it when there are dups (else the single row).
    const { data: rows } = await sb.from("vendor_items").select("id, avg_oz_per_each, units_per_pack, each_size, each_measure, pack_format, vendors(name)")
      .eq("name", f.name).is("location_id", null).eq("active", true)
      .returns<Array<{ id: string; avg_oz_per_each: number | string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; pack_format: string | null; vendors: { name: string } | null }>>();
    // A `vendor` on the fill pins a duplicated name to one twin. Without it the
    // placeholder heuristic runs, and its `list[0]` fallback is order-undefined —
    // fine while a name is unique, a coin flip once it is not.
    const all = rows ?? [];
    const list = f.vendor ? all.filter((r) => r.vendors?.name === f.vendor) : all;
    const isPh = (r: typeof list[number]) => r.pack_format == null && r.units_per_pack == null && r.each_size == null && r.avg_oz_per_each == null;
    const sku = list.find(isPh) ?? list[0];
    if (!sku) { missing.push(f.vendor ? `${f.name} [${f.vendor}]` : f.name); continue; }
    const update: Record<string, unknown> = { avg_oz_per_each: f.avgOz };
    if (f.pack) { update.units_per_pack = f.pack.unitsPerPack; update.each_size = f.pack.eachSize; update.each_measure = f.pack.eachMeasure; update.pack_format = f.pack.packFormat; }
    const already = Number(sku.avg_oz_per_each) === f.avgOz && (!f.pack || (sku.units_per_pack === f.pack.unitsPerPack && Number(sku.each_size) === f.pack.eachSize && sku.each_measure === f.pack.eachMeasure && sku.pack_format === f.pack.packFormat));
    if (already) { unchanged++; continue; }
    filled++;
    if (!DRY) {
      const { error } = await sb.from("vendor_items").update({ ...update, updated_at: new Date().toISOString(), updated_by: null }).eq("id", sku.id);
      if (error) throw new Error(`fill ${f.name}: ${error.message}`);
      void audit({ actorId: null, actorRole: null, action: "sku.weight_fill", resourceTable: "vendor_items", resourceId: sku.id, metadata: { name: f.name, avg_oz_per_each: f.avgOz, note: f.note, estimate: true, phase: "sku_weight_fill" }, ipAddress: null, userAgent: null });
    }
  }

  console.log(`Units: ${unitsAdded} registered (${unitsSkipped} already).`);
  console.log(`SKU weights: ${filled} filled, ${unchanged} unchanged.`);
  if (missing.length) { console.log("SKUs NOT found (skipped):"); for (const m of missing) console.log(`  - ${m}`); }
  console.log("Seed 10 done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
