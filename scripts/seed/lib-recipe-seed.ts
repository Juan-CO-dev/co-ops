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
  recipe: string; batchYield: number; containerLabel: string;
  directions: string; inputs: RInput[]; approximate?: boolean;
  /** Output target — provide exactly one: `item` (production, → items) or
   *  `outputMenuItemName` (consumer, → menu_items). */
  item?: string;
  outputMenuItemName?: string;
  recipeType?: "production" | "consumer";
  /** When `item` is missing, birth it with this section (production only). */
  createItemIfMissing?: { section: string };
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
  const { data: menuItems } = await sb.from("menu_items").select("id, name").eq("active", true).returns<Array<{ id: string; name: string }>>();
  const menuItemByName = new Map((menuItems ?? []).map((m) => [m.name.toLowerCase(), m.id]));

  let recCreated = 0, recExisting = 0, inputsAdded = 0, subItemInputs = 0, placeholders = 0, approx = 0;
  const missingItems: string[] = [];
  const missingSubItems: string[] = [];
  const placeholdersCreated: string[] = [];
  const itemsCreated: string[] = [];

  /** Birth a prep item (production output) when missing. */
  async function ensureItem(name: string, section: string): Promise<string> {
    const ex = itemByName.get(name.toLowerCase());
    if (ex) return ex;
    itemsCreated.push(name);
    if (dry) { itemByName.set(name.toLowerCase(), "DRY"); return "DRY"; }
    const { data, error } = await sb.from("items").insert({
      name, section, location_id: null, is_default: true, active: true,
      tracking_type: "portioned", batch_yield: 1, required: false, opening_verify: false,
      sold_directly: false, catering_available: false, catering_only: false, created_by: null,
    }).select("id").single<{ id: string }>();
    if (error) throw new Error(`create item ${name}: ${error.message}`);
    itemByName.set(name.toLowerCase(), data.id);
    void audit({ actorId: null, actorRole: null, action: "item.create", resourceTable: "items", resourceId: data.id, metadata: { name, section, creation_method: "seed_script", phase }, ipAddress: null, userAgent: null });
    return data.id;
  }

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
    // Resolve the output target: menu_item (consumer) OR item (production, birth-if-missing).
    const isConsumer = !!r.outputMenuItemName;
    let outputItemId: string | null = null, outputMenuItemId: string | null = null;
    if (isConsumer) {
      outputMenuItemId = menuItemByName.get(r.outputMenuItemName!.toLowerCase()) ?? null;
      if (!outputMenuItemId) { missingItems.push(`${r.recipe} → menu_item "${r.outputMenuItemName}"`); continue; }
    } else {
      const nm = r.item ?? "";
      outputItemId = itemByName.get(nm.toLowerCase()) ?? null;
      if (!outputItemId && r.createItemIfMissing) outputItemId = await ensureItem(nm, r.createItemIfMissing.section);
      if (!outputItemId) { missingItems.push(`${r.recipe} → item "${nm}"`); continue; }
    }
    if (r.approximate) approx++;
    const recipeType = r.recipeType ?? (isConsumer ? "consumer" : "production");

    // Recipe: get-or-create by name.
    let recipeId: string;
    const { data: ex } = await sb.from("recipes").select("id").eq("name", r.recipe).maybeSingle<{ id: string }>();
    if (ex) { recipeId = ex.id; recExisting++; }
    else if (dry) { recipeId = "DRY"; recCreated++; }
    else {
      const { data: rec, error } = await sb.from("recipes").insert({
        name: r.recipe, recipe_type: recipeType, batch_yield: r.batchYield, directions: r.directions,
        active: true, created_by: null, notes: r.approximate ? `APPROXIMATE — recipe TBD; refine when found. [seed ${phase}]` : `[seed ${phase}]`,
      }).select("id").single<{ id: string }>();
      if (error) throw new Error(`insert recipe ${r.recipe}: ${error.message}`);
      recipeId = rec.id; recCreated++;
      void audit({ actorId: null, actorRole: null, action: "recipe.create", resourceTable: "recipes", resourceId: rec.id, metadata: { name: r.recipe, output_item: r.item ?? null, output_menu_item: r.outputMenuItemName ?? null, recipe_type: recipeType, approximate: r.approximate ?? false, creation_method: "seed_script", phase }, ipAddress: null, userAgent: null });
    }

    // Output: ensure a recipe_output → the target (item or menu_item) exists.
    if (!dry) {
      const outQ = sb.from("recipe_outputs").select("id").eq("recipe_id", recipeId);
      const { data: exOut } = await (outputMenuItemId ? outQ.eq("output_menu_item_id", outputMenuItemId) : outQ.eq("output_item_id", outputItemId!)).maybeSingle<{ id: string }>();
      if (!exOut) {
        const { error } = await sb.from("recipe_outputs").insert({ recipe_id: recipeId, output_item_id: outputItemId, output_menu_item_id: outputMenuItemId, yield: r.batchYield, output_container_label: r.containerLabel, display_order: 0, created_by: null });
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

  console.log(`\n${phase}: ${recCreated} recipes created (${recExisting} existed) | ${inputsAdded} inputs added (${subItemInputs} sub-item) | ${itemsCreated.length} item(s) birthed | ${placeholders} placeholder SKU(s) | ${approx} approximate.`);
  if (itemsCreated.length) { console.log(`Items birthed (createItemIfMissing):`); for (const i of itemsCreated) console.log(`  * ${i}`); }
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
