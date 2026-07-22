/**
 * Seed 11 — post-fill data cleanup (dedup SKUs + normalize unit conflicts).
 * Surfaced by the depletion-wiring audit / weight fill. Idempotent, SEED_DRY, audit, append-only.
 *
 *  (1) Dedup: three ingredient names have TWO active global SKUs (an auto-placeholder that the recipes
 *      reference + filled, and an unused twin). Deactivate the UNUSED twins (never delete).
 *  (2) Unit conflicts: a SKU consumed in two units can't have one right avg_oz_per_each. Normalize the
 *      odd unit to oz so the recipe stops mis-counting:
 *        - Caramelized Onions: Onion (White) "8 quart" → "128 oz" (8 qt × 16 oz/qt raw diced).
 *        - Basil (portioned):  Basil "1 unit"  → "0.25 oz"; and set Basil avg_oz_per_each 0.1 → 0.017
 *          (per leaf) so Marinara's "6 leaf" ≈ 0.1 oz.
 *
 * Run: SEED_DRY=1 npx tsx --env-file=.env.local scripts/seed/11-data-cleanup.ts  (dry)
 *      npx tsx --env-file=.env.local scripts/seed/11-data-cleanup.ts              (prod)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";

// Unused duplicate twins to deactivate (kept = the recipe-referenced, complete row).
const TWINS: Array<{ id: string; name: string; note: string }> = [
  { id: "27066f2a-8e5c-4c60-8a0f-a62980241998", name: "Fresh Mozzarella", note: "PFG twin, 0 recipe uses, no avg" },
  { id: "804cb32d-ea68-4467-8479-b82f34a143a0", name: "Ham", note: "PFG twin, 0 recipe uses, no avg" },
  { id: "8cbebce5-b2e5-4da4-8a17-17a2d756ec12", name: "Lettuce", note: "placeholder, 0 recipe uses (kept the real Sysco box)" },
];

// Recipe-input unit normalizations: (recipe name, sku name, from-unit) → (to-unit, to-qty).
const NORMALIZE: Array<{ recipe: string; sku: string; fromUnit: string; toUnit: string; toQty: number }> = [
  { recipe: "Caramelized Onions", sku: "Onion (White)", fromUnit: "quart", toUnit: "oz", toQty: 128 },
  { recipe: "Basil (portioned)", sku: "Basil", fromUnit: "unit", toUnit: "oz", toQty: 0.25 },
];

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");

  // (1) dedup
  let deact = 0, deactSkip = 0;
  for (const t of TWINS) {
    const { data: row } = await sb.from("vendor_items").select("id, active").eq("id", t.id).maybeSingle<{ id: string; active: boolean }>();
    if (!row) { console.log(`  ! twin ${t.name} (${t.id}) not found`); continue; }
    if (!row.active) { deactSkip++; continue; }
    deact++;
    if (!DRY) {
      const { error } = await sb.from("vendor_items").update({ active: false, updated_at: new Date().toISOString(), updated_by: null }).eq("id", t.id);
      if (error) throw new Error(`deactivate ${t.name}: ${error.message}`);
      void audit({ actorId: null, actorRole: null, action: "sku.deduplicate", resourceTable: "vendor_items", resourceId: t.id, metadata: { name: t.name, note: t.note, phase: "data_cleanup" }, ipAddress: null, userAgent: null });
    }
  }

  // (2) unit conflicts
  let normed = 0, normSkip = 0;
  const normMissing: string[] = [];
  for (const n of NORMALIZE) {
    const { data: rec } = await sb.from("recipes").select("id").eq("name", n.recipe).maybeSingle<{ id: string }>();
    const { data: sku } = await sb.from("vendor_items").select("id").eq("name", n.sku).eq("active", true).is("location_id", null).limit(1).maybeSingle<{ id: string }>();
    if (!rec || !sku) { normMissing.push(`${n.recipe} / ${n.sku}`); continue; }
    const { data: ri } = await sb.from("recipe_inputs").select("id, unit, quantity").eq("recipe_id", rec.id).eq("component_sku_id", sku.id).eq("unit", n.fromUnit).maybeSingle<{ id: string; unit: string; quantity: number | string }>();
    if (!ri) { normSkip++; continue; } // already normalized (from-unit gone)
    normed++;
    if (!DRY) {
      const { error } = await sb.from("recipe_inputs").update({ unit: n.toUnit, quantity: n.toQty }).eq("id", ri.id);
      if (error) throw new Error(`normalize ${n.recipe}/${n.sku}: ${error.message}`);
      void audit({ actorId: null, actorRole: null, action: "recipe.input_unit_normalize", resourceTable: "recipe_inputs", resourceId: ri.id, metadata: { recipe: n.recipe, sku: n.sku, from: `${n.fromUnit}`, to: `${n.toQty} ${n.toUnit}`, phase: "data_cleanup" }, ipAddress: null, userAgent: null });
    }
  }

  // Basil avg refine: 0.1 → 0.017 (per leaf).
  let basilFixed = false;
  const { data: basil } = await sb.from("vendor_items").select("id, avg_oz_per_each").eq("name", "Basil").eq("active", true).is("location_id", null).limit(1).maybeSingle<{ id: string; avg_oz_per_each: number | string | null }>();
  if (basil && Number(basil.avg_oz_per_each) !== 0.017) {
    basilFixed = true;
    if (!DRY) {
      const { error } = await sb.from("vendor_items").update({ avg_oz_per_each: 0.017, updated_at: new Date().toISOString(), updated_by: null }).eq("id", basil.id);
      if (error) throw new Error(`basil avg: ${error.message}`);
      void audit({ actorId: null, actorRole: null, action: "sku.weight_fill", resourceTable: "vendor_items", resourceId: basil.id, metadata: { name: "Basil", avg_oz_per_each: 0.017, note: "per leaf; refine from 0.1", phase: "data_cleanup" }, ipAddress: null, userAgent: null });
    }
  }

  console.log(`Dedup: ${deact} twins deactivated (${deactSkip} already).`);
  console.log(`Unit normalize: ${normed} recipe inputs (${normSkip} already) ${normMissing.length ? `| NOT found: ${normMissing.join("; ")}` : ""}`);
  console.log(`Basil avg → 0.017: ${basilFixed ? "set" : "already"}.`);
  console.log("Seed 11 done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
