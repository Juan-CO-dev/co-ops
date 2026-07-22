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
const FILLS: Array<{ name: string; avgOz: number; note: string; pack?: Pack }> = [
  { name: "Sub Roll", avgOz: 4.0, note: "each = one 8in roll; 6/pack, 5 packs/rack (Juan)", pack: { unitsPerPack: 6, eachSize: 1, eachMeasure: "each", packFormat: "pack" } },
  { name: "Ham", avgOz: 1.0, note: "unit = one thin deli slice", pack: { unitsPerPack: 1, eachSize: 16, eachMeasure: "oz", packFormat: "case" } },
  { name: "Mortadella", avgOz: 1.0, note: "unit = one slice", pack: { unitsPerPack: 1, eachSize: 16, eachMeasure: "oz", packFormat: "case" } },
  { name: "Prosciutto", avgOz: 0.5, note: "each = one thin slice", pack: { unitsPerPack: 1, eachSize: 12, eachMeasure: "oz", packFormat: "case" } },
  { name: "Bacon", avgOz: 0.75, note: "each = one strip", pack: { unitsPerPack: 1, eachSize: 240, eachMeasure: "oz", packFormat: "case" } },
  { name: "Capicola", avgOz: 1.0, note: "unit = one slice" },
  { name: "Genoa", avgOz: 1.0, note: "unit = one slice" },
  { name: "Pepperoni", avgOz: 0.25, note: "unit = one thin slice" },
  { name: "Provolone", avgOz: 0.75, note: "unit = one slice" },
  { name: "Cheddar", avgOz: 0.75, note: "unit = one slice" },
  { name: "Roast Beef", avgOz: 1.5, note: "unit = one slice (thicker cut)" },
  { name: "Turkey", avgOz: 1.0, note: "unit = one slice" },
  { name: "Fresh Mozzarella", avgOz: 1.0, note: "unit = one piece", pack: { unitsPerPack: 72, eachSize: 1, eachMeasure: "each", packFormat: "case" } },
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
    const { data: rows } = await sb.from("vendor_items").select("id, avg_oz_per_each, units_per_pack, each_size, each_measure, pack_format")
      .eq("name", f.name).is("location_id", null).eq("active", true)
      .returns<Array<{ id: string; avg_oz_per_each: number | string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; pack_format: string | null }>>();
    const list = rows ?? [];
    const isPh = (r: typeof list[number]) => r.pack_format == null && r.units_per_pack == null && r.each_size == null && r.avg_oz_per_each == null;
    const sku = list.find(isPh) ?? list[0];
    if (!sku) { missing.push(f.name); continue; }
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
