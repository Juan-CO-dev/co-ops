/**
 * Shared recipe-seed engine for the Operational Seed Stage 3 (recipe-driven item wiring).
 *
 * Wires prep ITEMS to RECIPES on the canonical production graph
 * (recipe_inputs → recipe → recipe_outputs.output_item_id). Used by every section
 * script (03a Sauces, 03b Cooks, 03c Sides, …). Key behaviors:
 *   - Idempotent at BOTH the recipe level (get-or-create by name) AND the input/output
 *     level (only insert a recipe_input/output that isn't already present) — so re-runs
 *     top up missing edges without duplicating.
 *   - Ingredient → SKU match is alias-aware; a MISS auto-creates an EMPTY PLACEHOLDER
 *     SKU (global, active, no vendor/pack/price) and wires it, so no recipe input ever
 *     dangles. Placeholders surface in the SKU admin to be filled in (or reconciled
 *     against a real SKU when its guide is seeded, e.g. Boar's Head). (Juan 2026-07-21.)
 *   - Sub-item inputs (item:true) resolve to component_item_id (recursive graph); a
 *     missing sub-item is reported (its recipe is seeded in another section), NOT
 *     placeholdered (items are born from recipes, not SKUs).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";

export interface RInput { name: string; qty: number; unit: string; item?: boolean; portioned?: boolean }
export interface RecipeDef {
  recipe: string; item: string; batchYield: number; containerLabel: string;
  directions: string; inputs: RInput[]; approximate?: boolean;
}

/** Comprehensive ingredient-name → seeded SKU-name alias map (all Stage-3 sections). */
const INGREDIENT_ALIAS: Record<string, string> = {
  // dairy / fats / mayo
  "dukes mayo": "Duke's Mayo", "duke's mayo": "Duke's Mayo", "mayo": "Duke's Mayo", "dukes": "Duke's Mayo",
  "butter": "Butter", "sour cream": "Sour Cream", "heavy cream": "Heavy Cream", "ricotta": "Ricotta",
  "parmesan": "Parmesan (Grated)", "parmesan cheese": "Parmesan (Grated)", "grated parmesan": "Parmesan (Grated)",
  // produce / aromatics
  "garlic": "Garlic", "onion": "Onion (White)", "spanish onions": "Onion (White)", "yellow onions": "Onion (White)",
  "red onion": "Onion (red)", "celery": "Celery", "basil": "Basil", "parsley": "Parsley", "thyme": "Thyme",
  "chives": "Chives", "chives (fresh)": "Chives",
  // oils / acids
  "olive oil": "Olive Oil", "evoo": "Olive Oil", "grapeseed oil": "Grapeseed Oil", "lemon juice": "Lemon Juice",
  "red wine vinegar": "Red wine vinegar", "balsamic vin": "Balsamic Vin", "balsamic vinegar": "Balsamic Vin",
  // dry / spice / sauces
  "salt": "Salt", "black pepper": "Black peppercorn", "chili flake": "Chili Flake", "red pepper flakes": "Chili Flake",
  "oregano": "Oregano", "garlic powder": "Garlic Powder", "onion powder": "Onion Powder", "old bay": "Old Bay",
  "honey": "Honey", "cholula": "Cholula", "cholula hot sauce": "Cholula", "horseradish": "Horseradish",
  "whole grain mustard": "Mustard (Whole)", "dijon mustard": "Mustard (Dijon)", "confectioners sugar": "Confectioners Sugar",
  "roasted red peppers": "Roasted Red Peppers", "tomato paste": "Tomato Paste",
  "crushed tomatoes": "Tomatoes Crushed (10#)", "tomatoes crushed": "Tomatoes Crushed (10#)",
  "panko": "Panko (Japanese)", "fusilli pasta": "Fusilli Pasta",
  // proteins / carbs
  "chicken breast": "Chicken Breast", "eggs": "Eggs", "tuna": "Tuna",
};

function aliasName(n: string): string {
  const k = n.toLowerCase().replace(/\.+$/, "").replace(/'/g, "").replace(/\s+/g, " ").trim();
  return INGREDIENT_ALIAS[k] ?? n;
}

type SB = SupabaseClient;

export async function seedRecipes(sb: SB, opts: { dry: boolean; phase: string }, RECIPES: RecipeDef[]): Promise<void> {
  const { dry, phase } = opts;
  if (dry) console.log("── DRY RUN (SEED_DRY=1): parse/report only, NO writes ──\n");

  const { data: items } = await sb.from("items").select("id, name").eq("active", true).is("location_id", null).returns<Array<{ id: string; name: string }>>();
  const itemByName = new Map((items ?? []).map((i) => [i.name.toLowerCase(), i.id]));
  const { data: skus } = await sb.from("vendor_items").select("id, name").eq("active", true).is("location_id", null).returns<Array<{ id: string; name: string }>>();
  const skuByName = new Map<string, string>();
  for (const s of skus ?? []) if (!skuByName.has(s.name.toLowerCase())) skuByName.set(s.name.toLowerCase(), s.id);

  let recCreated = 0, recExisting = 0, inputsAdded = 0, subItemInputs = 0, placeholders = 0, approx = 0;
  const missingItems: string[] = [];
  const missingSubItems: string[] = [];
  const placeholdersCreated: string[] = [];

  /** Resolve an ingredient → SKU id, creating an empty placeholder SKU on a miss. */
  async function resolveSku(name: string): Promise<string | null> {
    const target = aliasName(name);
    const key = target.toLowerCase();
    const hit = skuByName.get(key);
    if (hit) return hit;
    if (dry) { placeholders++; if (!placeholdersCreated.includes(target)) placeholdersCreated.push(target); skuByName.set(key, "DRY"); return "DRY"; }
    const { data: ins, error } = await sb.from("vendor_items").insert({
      name: target, location_id: null, active: true, inventory_only: false, created_by: null,
      notes: `placeholder ingredient SKU — needs vendor/pack/price [seed ${phase}]`,
    }).select("id").single<{ id: string }>();
    if (error) throw new Error(`create placeholder SKU ${target}: ${error.message}`);
    skuByName.set(key, ins.id);
    placeholders++; placeholdersCreated.push(target);
    void audit({ actorId: null, actorRole: null, action: "vendor_item.create", resourceTable: "vendor_items", resourceId: ins.id, metadata: { name: target, placeholder: true, reason: "recipe_ingredient_placeholder", creation_method: "seed_placeholder", phase }, ipAddress: null, userAgent: null });
    return ins.id;
  }

  for (const r of RECIPES) {
    const itemId = itemByName.get(r.item.toLowerCase());
    if (!itemId) { missingItems.push(`${r.recipe} → item "${r.item}"`); continue; }
    if (r.approximate) approx++;

    // Recipe: get-or-create by name.
    let recipeId: string;
    const { data: ex } = await sb.from("recipes").select("id").eq("name", r.recipe).maybeSingle<{ id: string }>();
    if (ex) { recipeId = ex.id; recExisting++; }
    else if (dry) { recipeId = "DRY"; recCreated++; }
    else {
      const { data: rec, error } = await sb.from("recipes").insert({
        name: r.recipe, recipe_type: "production", batch_yield: r.batchYield, directions: r.directions,
        active: true, created_by: null, notes: r.approximate ? `APPROXIMATE — recipe TBD; refine when found. [seed ${phase}]` : `[seed ${phase}]`,
      }).select("id").single<{ id: string }>();
      if (error) throw new Error(`insert recipe ${r.recipe}: ${error.message}`);
      recipeId = rec.id; recCreated++;
      void audit({ actorId: null, actorRole: null, action: "recipe.create", resourceTable: "recipes", resourceId: rec.id, metadata: { name: r.recipe, output_item: r.item, approximate: r.approximate ?? false, creation_method: "seed_script", phase }, ipAddress: null, userAgent: null });
    }

    // Output: ensure a recipe_output → this item exists.
    if (!dry) {
      const { data: exOut } = await sb.from("recipe_outputs").select("id").eq("recipe_id", recipeId).eq("output_item_id", itemId).maybeSingle<{ id: string }>();
      if (!exOut) {
        const { error } = await sb.from("recipe_outputs").insert({ recipe_id: recipeId, output_item_id: itemId, output_menu_item_id: null, yield: r.batchYield, output_container_label: r.containerLabel, display_order: 0, created_by: null });
        if (error) throw new Error(`insert recipe_output ${r.recipe}: ${error.message}`);
      }
    }

    // Existing inputs on this recipe (for idempotent top-up).
    const existingInputKeys = new Set<string>();
    if (!dry) {
      const { data: exIn } = await sb.from("recipe_inputs").select("component_sku_id, component_item_id").eq("recipe_id", recipeId).returns<Array<{ component_sku_id: string | null; component_item_id: string | null }>>();
      for (const e of exIn ?? []) existingInputKeys.add(e.component_sku_id ? `s:${e.component_sku_id}` : `i:${e.component_item_id}`);
    }

    let ord = existingInputKeys.size;
    for (const inp of r.inputs) {
      let skuId: string | null = null, subId: string | null = null;
      if (inp.item) {
        subId = itemByName.get(inp.name.toLowerCase()) ?? null;
        if (!subId) { missingSubItems.push(`${r.recipe}: sub-item "${inp.name}" (no item yet)`); continue; }
        subItemInputs++;
      } else {
        skuId = await resolveSku(inp.name);
      }
      if (dry) { inputsAdded++; continue; }
      const key = skuId ? `s:${skuId}` : `i:${subId}`;
      if (existingInputKeys.has(key)) continue; // already wired
      const { error } = await sb.from("recipe_inputs").insert({ recipe_id: recipeId, component_sku_id: skuId, component_item_id: subId, quantity: inp.qty, unit: inp.unit, portioned: inp.portioned ?? false, display_order: ord++, created_by: null });
      if (error) throw new Error(`insert recipe_input ${r.recipe}/${inp.name}: ${error.message}`);
      existingInputKeys.add(key); inputsAdded++;
    }
  }

  console.log(`\n${phase}: ${recCreated} recipes created (${recExisting} existed) | ${inputsAdded} inputs added (${subItemInputs} sub-item) | ${placeholders} placeholder SKU(s) | ${approx} approximate.`);
  if (placeholdersCreated.length) { console.log(`Placeholder ingredient SKUs (empty — fill in / reconcile later):`); for (const p of placeholdersCreated) console.log(`  + ${p}`); }
  if (missingItems.length) { console.log(`Output items NOT found (recipe skipped):`); for (const m of missingItems) console.log(`  - ${m}`); }
  if (missingSubItems.length) { console.log(`Sub-item inputs not yet available (wire when their recipe seeds):`); for (const m of missingSubItems) console.log(`  - ${m}`); }

  if (!dry) {
    const names = RECIPES.map((r) => r.recipe);
    const { count } = await sb.from("recipes").select("id", { count: "exact", head: true }).in("name", names).eq("active", true);
    console.log(`Verify: ${count} of ${RECIPES.length} recipes active in prod.`);
  }
  console.log(`${phase} done.`);
}
