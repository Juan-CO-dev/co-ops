/**
 * Operational Seed — Stage 3a: SAUCES recipes (the recipe-wiring exemplar).
 *
 * Wires each existing Sauces ITEM to its RECIPE on the canonical production graph
 * (recipe_inputs → recipe → recipe_outputs.output_item_id). This is how prepped
 * items get their composition + cost + readiness (item_components is the dead
 * legacy graph — see lib/production.ts). recipe_type = 'production' (outputs items).
 *
 * Per Juan (2026-07-21): recipe-driven, section by section, Sauces first. Ranch /
 * Horsey Mayo / Vin have no .docx yet → seeded as APPROXIMATE simple house mixes
 * (flagged; refine when the recipes surface). Ingredient → SKU match is alias-aware
 * and REPORTS misses (unseeded SKUs like BH pickles / ranch packet) rather than
 * fabricating. Directions live on recipes.directions (bilingual), not recipe_steps.
 *
 * Idempotent (keyed on recipe name). Run: npx tsx --env-file=.env.local scripts/seed/03a-recipes-sauces.ts
 * SEED_DRY=1 → parse/report only, no writes.
 * Source: docs/seed/recipes/ALL-RECIPES.md. Decisions: docs/superpowers/specs/2026-07-21-operational-seed-decisions.md.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";

interface RInput { name: string; qty: number; unit: string }
interface RecipeDef {
  recipe: string;        // recipe name (.docx canonical)
  item: string;          // existing output item name (one of the 45)
  batchYield: number;    // recipes.batch_yield (units of the output per batch)
  containerLabel: string;// output_container_label
  directions: string;
  inputs: RInput[];
  approximate?: boolean; // Ranch/Horsey/Vin — no .docx yet
}

// Ingredient name → seeded SKU name (alias-aware). Only SKUs seeded in Stage 2.
function skuAlias(n: string): string {
  const k = n.toLowerCase().replace(/\.+$/, "").replace(/'/g, "").replace(/\s+/g, " ").trim();
  const map: Record<string, string> = {
    "dukes mayo": "Duke's Mayo", "duke's mayo": "Duke's Mayo", "mayo": "Duke's Mayo", "dukes": "Duke's Mayo",
    "garlic": "Garlic", "garlic (grated)": "Garlic", "lemon juice": "Lemon Juice", "salt": "Salt",
    "evoo": "Olive Oil", "olive oil": "Olive Oil", "grapeseed oil": "Grapeseed Oil",
    "roasted red peppers": "Roasted Red Peppers", "honey": "Honey", "chili flake": "Chili Flake",
    "red pepper flakes": "Chili Flake", "black pepper": "Black peppercorn", "cholula": "Cholula",
    "cholula hot sauce": "Cholula", "whole grain mustard": "Mustard (Whole)", "dijon mustard": "Mustard (Dijon)",
    "basil": "Basil", "sour cream": "Sour Cream", "horseradish": "Horseradish",
    "balsamic vin": "Balsamic Vin", "balsamic vinegar": "Balsamic Vin", "red wine vinegar": "Red wine vinegar",
  };
  return map[k] ?? n; // fall through to exact name match
}

const RECIPES: RecipeDef[] = [
  {
    recipe: "Garlic Mayo (Aioli)", item: "Aioli", batchYield: 7.5, containerLabel: "32 oz bottle",
    directions: "Press garlic into a large bowl (trim dried ends). Add lemon juice & mayo, whisk to combine, add salt, mix and taste. Transfer to 32 oz squeeze bottles; label 'A', made-on + 5-day discard date.",
    inputs: [
      { name: "Duke's Mayo", qty: 2, unit: "gallon" }, { name: "Garlic", qty: 8, unit: "oz" },
      { name: "Lemon Juice", qty: 16, unit: "oz" }, { name: "Salt", qty: 0.64, unit: "oz" },
    ],
  },
  {
    recipe: "Honey Chili Aioli", item: "HC Aioli", batchYield: 2.25, containerLabel: "quart",
    directions: "Small-dice roasted red peppers. Measure all ingredients into a bowl (honey last). Stick-blend until smooth (small red specks remain). Bottle; label 'HC' + date + 5-day discard.",
    inputs: [
      { name: "Duke's Mayo", qty: 56.5, unit: "oz" }, { name: "Roasted Red Peppers", qty: 7.5, unit: "oz" },
      { name: "Garlic", qty: 0.55, unit: "oz" }, { name: "Honey", qty: 3.8, unit: "oz" },
      { name: "Lemon Juice", qty: 2.8, unit: "oz" }, { name: "Black Pepper", qty: 0.08, unit: "oz" },
      { name: "Salt", qty: 0.08, unit: "oz" }, { name: "Chili Flake", qty: 0.08, unit: "oz" },
    ],
  },
  {
    recipe: "Cholula Mayo", item: "HP Mayo", batchYield: 1.25, containerLabel: "quart",
    directions: "Measure all ingredients into a bowl on a scale. Whisk until combined. Transfer to quarts / squeeze bottles; label 'HP' (Hot Pants) + date + 5-day discard.",
    inputs: [
      { name: "Duke's Mayo", qty: 32, unit: "oz" }, { name: "Cholula", qty: 7.5, unit: "oz" },
      { name: "Lemon Juice", qty: 2.1, unit: "oz" }, { name: "Salt", qty: 0.08, unit: "oz" },
    ],
  },
  {
    recipe: "Mustard Aioli", item: "Mustard Aioli", batchYield: 3, containerLabel: "small squeeze bottle",
    directions: "Measure all ingredients into a bowl on a scale. Whisk until combined. Bottle; label 'Must Aioli' + date + 5-day discard.",
    inputs: [
      { name: "Duke's Mayo", qty: 39, unit: "oz" }, { name: "Whole Grain Mustard", qty: 2.3, unit: "oz" },
      { name: "Dijon Mustard", qty: 4.9, unit: "oz" }, { name: "Garlic", qty: 0.4, unit: "oz" },
      { name: "Lemon Juice", qty: 1.6, unit: "oz" }, { name: "Salt", qty: 0.08, unit: "oz" },
    ],
  },
  {
    recipe: "Italian Salsa Verde", item: "Salsa Verde", batchYield: 1, containerLabel: "16 oz squeeze bottle",
    directions: "Gather 3 oz picked basil + 3 oz past-peak herbs (parsley/chives/more basil — waste-mitigation). Add all ingredients to a blender, blend until smooth. Reserve in a 16 oz squeeze bottle — 3-day shelf life.",
    inputs: [
      { name: "Basil", qty: 3, unit: "oz" }, { name: "Garlic", qty: 1.5, unit: "oz" },
      { name: "Lemon Juice", qty: 3, unit: "oz" }, { name: "Pickle Chips", qty: 2.5, unit: "oz" },
      { name: "EVOO", qty: 5.5, unit: "oz" }, { name: "Salt", qty: 0.3, unit: "oz" },
      { name: "Black Pepper", qty: 0.2, unit: "oz" }, { name: "Red Pepper Flakes", qty: 0.05, unit: "oz" },
    ],
  },
  {
    recipe: "Dukes (portioned)", item: "Dukes", batchYield: 3, containerLabel: "bottle",
    directions: "Portion Duke's Mayo into squeeze bottles. Label + date.",
    inputs: [{ name: "Duke's Mayo", qty: 16, unit: "oz" }],
  },
  // ── Approximate house mixes (no .docx yet — Juan: "just do 1 for now", refine later) ──
  {
    recipe: "Ranch (house — approximate)", item: "Ranch", batchYield: 3, containerLabel: "bottle", approximate: true,
    directions: "APPROXIMATE (recipe TBD): whisk mayo + sour cream + ranch seasoning to taste; bottle + date.",
    inputs: [{ name: "Duke's Mayo", qty: 24, unit: "oz" }, { name: "Sour Cream", qty: 16, unit: "oz" }],
  },
  {
    recipe: "Horsey Mayo (house — approximate)", item: "Horsey Mayo", batchYield: 4, containerLabel: "bottle", approximate: true,
    directions: "APPROXIMATE (recipe TBD): whisk mayo + horseradish to taste; bottle + date.",
    inputs: [{ name: "Duke's Mayo", qty: 32, unit: "oz" }, { name: "Horseradish", qty: 4, unit: "oz" }],
  },
  {
    recipe: "Vin (house vinaigrette — approximate)", item: "Vin", batchYield: 6, containerLabel: "bottle", approximate: true,
    directions: "APPROXIMATE (recipe TBD): emulsify olive oil + balsamic vinegar + seasoning; bottle + date.",
    inputs: [{ name: "Olive Oil", qty: 24, unit: "oz" }, { name: "Balsamic Vin", qty: 12, unit: "oz" }],
  },
];

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): parse/report only, NO writes ──\n");

  // Existing global active items (output targets) + global active SKUs (inputs).
  const { data: items } = await sb.from("items").select("id, name").eq("active", true).is("location_id", null).returns<Array<{ id: string; name: string }>>();
  const itemByName = new Map((items ?? []).map((i) => [i.name.toLowerCase(), i.id]));
  const { data: skus } = await sb.from("vendor_items").select("id, name").eq("active", true).is("location_id", null).returns<Array<{ id: string; name: string }>>();
  const skuByName = new Map<string, string>();
  for (const s of skus ?? []) if (!skuByName.has(s.name.toLowerCase())) skuByName.set(s.name.toLowerCase(), s.id);

  let created = 0, exists = 0, inputsWired = 0, outputsWired = 0, approx = 0;
  const missingItems: string[] = [];
  const missingInputs: string[] = [];

  for (const r of RECIPES) {
    const itemId = itemByName.get(r.item.toLowerCase());
    if (!itemId) { missingItems.push(`${r.recipe} → item "${r.item}"`); continue; }
    if (r.approximate) approx++;

    // Idempotent by recipe name.
    const { data: ex } = await sb.from("recipes").select("id").eq("name", r.recipe).maybeSingle<{ id: string }>();
    if (ex) { exists++; continue; }

    // Resolve inputs → SKU ids (report misses; don't fabricate).
    const resolved: Array<{ skuId: string; qty: number; unit: string }> = [];
    for (const inp of r.inputs) {
      const skuId = skuByName.get(skuAlias(inp.name).toLowerCase());
      if (!skuId) { missingInputs.push(`${r.recipe}: "${inp.name}" (no seeded SKU)`); continue; }
      resolved.push({ skuId, qty: inp.qty, unit: inp.unit });
    }

    created++;
    inputsWired += resolved.length;
    outputsWired += 1;
    if (DRY) continue;

    // Insert recipe → output → inputs (service-role; created_by null).
    const { data: rec, error: rErr } = await sb.from("recipes").insert({
      name: r.recipe, recipe_type: "production", batch_yield: r.batchYield,
      directions: r.directions, active: true, created_by: null,
      notes: r.approximate ? "APPROXIMATE house mix — recipe TBD; refine when found. [seed stage3a]" : "[seed stage3a]",
    }).select("id").single<{ id: string }>();
    if (rErr) throw new Error(`insert recipe ${r.recipe}: ${rErr.message}`);

    const { error: oErr } = await sb.from("recipe_outputs").insert({
      recipe_id: rec.id, output_item_id: itemId, output_menu_item_id: null,
      yield: r.batchYield, output_container_label: r.containerLabel, display_order: 0, created_by: null,
    });
    if (oErr) throw new Error(`insert recipe_output ${r.recipe}: ${oErr.message}`);

    let ord = 0;
    for (const inp of resolved) {
      const { error: iErr } = await sb.from("recipe_inputs").insert({
        recipe_id: rec.id, component_sku_id: inp.skuId, component_item_id: null,
        quantity: inp.qty, unit: inp.unit, portioned: false, display_order: ord++, created_by: null,
      });
      if (iErr) throw new Error(`insert recipe_input ${r.recipe}/${inp.skuId}: ${iErr.message}`);
    }

    void audit({ actorId: null, actorRole: null, action: "recipe.create", resourceTable: "recipes", resourceId: rec.id, metadata: { name: r.recipe, output_item: r.item, input_count: resolved.length, approximate: r.approximate ?? false, creation_method: "seed_script", phase: "operational_seed_stage3a" }, ipAddress: null, userAgent: null });
  }

  // ── Report ──
  console.log(`\nStage 3a Sauces recipes: ${created} created (${exists} already existed) | outputs wired ${outputsWired}, inputs wired ${inputsWired}, approximate ${approx}.`);
  if (missingItems.length) { console.log(`\nOutput items NOT found (recipe skipped):`); for (const m of missingItems) console.log(`  - ${m}`); }
  if (missingInputs.length) { console.log(`\nInputs with no seeded SKU (left unwired — refine when SKU seeded):`); for (const m of missingInputs) console.log(`  - ${m}`); }

  // ── Verify ──
  if (!DRY) {
    const names = RECIPES.map((r) => r.recipe);
    const { count: recCount } = await sb.from("recipes").select("id", { count: "exact", head: true }).in("name", names).eq("active", true);
    console.log(`\nVerify: ${recCount} of ${RECIPES.length} Sauces recipes active in prod.`);
  }
  console.log("Stage 3a done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
