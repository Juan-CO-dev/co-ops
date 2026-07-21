/**
 * Operational Seed — Stage 3b: COOKS recipes.
 *
 * Wires the 6 existing Cooks items (Caramelized onion, Chicken Cutlet, Compound
 * Butter, Jus, Marinara, Vodka) to recipes on the canonical production graph
 * (recipe_inputs → recipe → recipe_outputs.output_item_id), same pattern as 03a
 * (Sauces), EXTENDED to support recursive SUB-ITEM inputs:
 *   - Beef Jus consumes the "Caramelized onion" ITEM (component_item_id), not a raw SKU.
 * Inputs are SKU-first (raw ingredients) — a name only resolves to a sub-item when
 * explicitly flagged `item: true`, so "Onion"/"Basil" correctly hit the raw SKU, not
 * the prepped Onion/Basil items.
 *
 * Juan (2026-07-21): "Jus is Beef" → wire item "Jus" to the Beef Jus recipe.
 * Chicken Cutlet has no .docx → APPROXIMATE. Ingredient→SKU/item match reports
 * misses (Worcestershire, beef base, white wine, flour — unseeded) instead of
 * fabricating. Directions bilingual-flattened on recipes.directions.
 *
 * Idempotent (recipe name). Run: npx tsx --env-file=.env.local scripts/seed/03b-recipes-cooks.ts
 * SEED_DRY=1 → report only. Source: docs/seed/recipes/ALL-RECIPES.md.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";

interface RInput { name: string; qty: number; unit: string; item?: boolean }
interface RecipeDef {
  recipe: string; item: string; batchYield: number; containerLabel: string;
  directions: string; inputs: RInput[]; approximate?: boolean;
}

// Raw-ingredient name → seeded SKU name (alias-aware). Sub-item inputs bypass this.
function skuAlias(n: string): string {
  const k = n.toLowerCase().replace(/\.+$/, "").replace(/'/g, "").replace(/\s+/g, " ").trim();
  const map: Record<string, string> = {
    "onion": "Onion (White)", "spanish onions": "Onion (White)", "yellow onions": "Onion (White)",
    "olive oil": "Olive Oil", "evoo": "Olive Oil", "butter": "Butter", "salt": "Salt",
    "garlic": "Garlic", "garlic powder": "Garlic Powder", "parsley": "Parsley", "thyme": "Thyme",
    "oregano": "Oregano", "black pepper": "Black peppercorn", "parmesan": "Parmesan (Grated)",
    "parmesan cheese": "Parmesan (Grated)", "grated parmesan": "Parmesan (Grated)",
    "tomato paste": "Tomato Paste", "crushed tomatoes": "Tomatoes Crushed (10#)",
    "tomatoes crushed": "Tomatoes Crushed (10#)", "heavy cream": "Heavy Cream",
    "panko": "Panko (Japanese)", "chicken breast": "Chicken Breast", "eggs": "Eggs",
    "red wine vinegar": "Red wine vinegar", "basil": "Basil",
  };
  return map[k] ?? n;
}

const RECIPES: RecipeDef[] = [
  {
    recipe: "Caramelized Onions", item: "Caramelized onion", batchYield: 4, containerLabel: "Quart",
    directions: "Dice onions evenly. Melt butter + EVOO on med-high; add onions, drop to med-low. Stir continuously (splash water to deglaze) ~2 hrs to a deep caramel brown. At ¾ done add Worcestershire + salt. Cool in a wide tray; store in quarts — 5-day shelf life.",
    inputs: [
      { name: "Spanish Onions", qty: 8, unit: "quart" }, { name: "EVOO", qty: 2, unit: "oz" },
      { name: "Butter", qty: 3, unit: "oz" }, { name: "Worcestershire", qty: 1.5, unit: "oz" },
      { name: "Salt", qty: 0.1, unit: "oz" },
    ],
  },
  {
    recipe: "Chicken Cutlet (approximate)", item: "Chicken Cutlet", batchYield: 15, containerLabel: "Piece", approximate: true,
    directions: "APPROXIMATE (recipe TBD): pound chicken breast, dredge (flour → egg → panko), fry to golden + 165°F. Portion into cutlets.",
    inputs: [
      { name: "Chicken Breast", qty: 10, unit: "lb" }, { name: "Panko", qty: 16, unit: "oz" },
      { name: "Eggs", qty: 6, unit: "each" },
    ],
  },
  {
    recipe: "Garlic Bread / Compound Butter", item: "Compound Butter", batchYield: 2, containerLabel: "1 lb log",
    directions: "Mix all ingredients until combined. Split in half; form each into a log in plastic wrap. Label + date; refrigerate. Yield: 2 one-lb logs.",
    inputs: [
      { name: "Butter", qty: 32, unit: "oz" }, { name: "Garlic", qty: 4.3, unit: "oz" },
      { name: "Garlic Powder", qty: 1.25, unit: "oz" }, { name: "Parsley", qty: 0.1, unit: "oz" },
      { name: "Salt", qty: 0.08, unit: "oz" }, { name: "Black Pepper", qty: 0.08, unit: "oz" },
      { name: "Parmesan", qty: 0.08, unit: "oz" },
    ],
  },
  {
    recipe: "Beef Jus", item: "Jus", batchYield: 5, containerLabel: "Quart",
    directions: "Bring 6 qt water to a rolling boil; whisk in beef base. Add caramelized onion; boil 1 min, reduce to a simmer, skim foam/gelatin. 5 min before done add the bouquet garni (thyme) + red wine vinegar (add late for max flavor). Store in cambros. Yields ~5 quarts.",
    inputs: [
      { name: "Caramelized Onion", qty: 4, unit: "oz", item: true }, { name: "Beef Base", qty: 5, unit: "oz" },
      { name: "Thyme", qty: 12, unit: "sprig" }, { name: "Red Wine Vinegar", qty: 2, unit: "oz" },
    ],
  },
  {
    recipe: "Marinara", item: "Marinara", batchYield: 6, containerLabel: "Quart",
    directions: "Sweat med-diced onion + grated garlic in olive oil until translucent/fragrant (3–5 min), lightly salted. Add 2 #10 cans crushed tomatoes, basil, salt & pepper. Bring to a simmer at 160°F. May refrigerate + reheat ONCE (label 'USE AGAIN'), else discard.",
    inputs: [
      { name: "Onion", qty: 1, unit: "each" }, { name: "Olive Oil", qty: 3, unit: "Tbsp" },
      { name: "Garlic", qty: 4, unit: "clove" }, { name: "Crushed Tomatoes", qty: 2, unit: "#10 can" },
      { name: "Basil", qty: 6, unit: "leaf" }, { name: "Oregano", qty: 3, unit: "gram" },
      { name: "Salt", qty: 0.08, unit: "oz" }, { name: "Black Pepper", qty: 0.08, unit: "oz" },
    ],
  },
  {
    recipe: "Vodka Sauce", item: "Vodka", batchYield: 4, containerLabel: "Quart",
    directions: "Brunoise onion; sweat in olive oil + salt until translucent. Add tomato paste, cook med-low ~90 min until thick/dark/dry. Deglaze with white wine (pull up fond). Whisk in heavy cream; add parmesan, salt & pepper. Hold at 160°F. Final color orange, not pink. Reheat ONCE max.",
    inputs: [
      { name: "Onion", qty: 9, unit: "oz" }, { name: "Olive Oil", qty: 3, unit: "Tbsp" },
      { name: "Tomato Paste", qty: 25, unit: "oz" }, { name: "Heavy Cream", qty: 2, unit: "quart" },
      { name: "Parmesan", qty: 9.5, unit: "gram" }, { name: "White Wine", qty: 4, unit: "oz" },
      { name: "Salt", qty: 0.08, unit: "oz" }, { name: "Black Pepper", qty: 0.08, unit: "oz" },
    ],
  },
];

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): parse/report only, NO writes ──\n");

  const { data: items } = await sb.from("items").select("id, name").eq("active", true).is("location_id", null).returns<Array<{ id: string; name: string }>>();
  const itemByName = new Map((items ?? []).map((i) => [i.name.toLowerCase(), i.id]));
  const { data: skus } = await sb.from("vendor_items").select("id, name").eq("active", true).is("location_id", null).returns<Array<{ id: string; name: string }>>();
  const skuByName = new Map<string, string>();
  for (const s of skus ?? []) if (!skuByName.has(s.name.toLowerCase())) skuByName.set(s.name.toLowerCase(), s.id);

  let created = 0, exists = 0, inputsWired = 0, subItemInputs = 0, approx = 0;
  const missingItems: string[] = [];
  const missingInputs: string[] = [];

  for (const r of RECIPES) {
    const itemId = itemByName.get(r.item.toLowerCase());
    if (!itemId) { missingItems.push(`${r.recipe} → item "${r.item}"`); continue; }
    if (r.approximate) approx++;

    const { data: ex } = await sb.from("recipes").select("id").eq("name", r.recipe).maybeSingle<{ id: string }>();
    if (ex) { exists++; continue; }

    // Resolve inputs → SKU id OR sub-item id.
    const resolved: Array<{ skuId: string | null; itemId: string | null; qty: number; unit: string }> = [];
    for (const inp of r.inputs) {
      if (inp.item) {
        const subId = itemByName.get(inp.name.toLowerCase());
        if (!subId) { missingInputs.push(`${r.recipe}: sub-item "${inp.name}" (no item)`); continue; }
        resolved.push({ skuId: null, itemId: subId, qty: inp.qty, unit: inp.unit }); subItemInputs++;
      } else {
        const skuId = skuByName.get(skuAlias(inp.name).toLowerCase());
        if (!skuId) { missingInputs.push(`${r.recipe}: "${inp.name}" (no seeded SKU)`); continue; }
        resolved.push({ skuId, itemId: null, qty: inp.qty, unit: inp.unit });
      }
    }

    created++;
    inputsWired += resolved.length;
    if (DRY) continue;

    const { data: rec, error: rErr } = await sb.from("recipes").insert({
      name: r.recipe, recipe_type: "production", batch_yield: r.batchYield,
      directions: r.directions, active: true, created_by: null,
      notes: r.approximate ? "APPROXIMATE — recipe TBD; refine when found. [seed stage3b]" : "[seed stage3b]",
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
        recipe_id: rec.id, component_sku_id: inp.skuId, component_item_id: inp.itemId,
        quantity: inp.qty, unit: inp.unit, portioned: false, display_order: ord++, created_by: null,
      });
      if (iErr) throw new Error(`insert recipe_input ${r.recipe}/${inp.name ?? ""}: ${iErr.message}`);
    }

    void audit({ actorId: null, actorRole: null, action: "recipe.create", resourceTable: "recipes", resourceId: rec.id, metadata: { name: r.recipe, output_item: r.item, input_count: resolved.length, approximate: r.approximate ?? false, creation_method: "seed_script", phase: "operational_seed_stage3b" }, ipAddress: null, userAgent: null });
  }

  console.log(`\nStage 3b Cooks recipes: ${created} created (${exists} already existed) | inputs wired ${inputsWired} (${subItemInputs} sub-item), approximate ${approx}.`);
  if (missingItems.length) { console.log(`\nOutput items NOT found (recipe skipped):`); for (const m of missingItems) console.log(`  - ${m}`); }
  if (missingInputs.length) { console.log(`\nInputs with no seeded SKU/item (left unwired — refine later):`); for (const m of missingInputs) console.log(`  - ${m}`); }

  if (!DRY) {
    const names = RECIPES.map((r) => r.recipe);
    const { count } = await sb.from("recipes").select("id", { count: "exact", head: true }).in("name", names).eq("active", true);
    console.log(`\nVerify: ${count} of ${RECIPES.length} Cooks recipes active in prod.`);
  }
  console.log("Stage 3b done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
