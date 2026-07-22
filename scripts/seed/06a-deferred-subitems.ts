/**
 * Operational Seed — Stage 6a: birth the deferred sub-items the sandwich builds need.
 *
 * The signature-sub builds (Vesuvio, Farmers Market, Turkey Caesar) consume prepped
 * items that don't exist yet. Birth them here via `production` recipes on the shared
 * engine (createItemIfMissing), so 6b's consumer-recipe builds can reference them:
 *   - Meatball Spice Mix (recursive sub-input to Meatballs) — birthed FIRST.
 *   - Meatballs (Vesuvio) — consumes the Meatball Spice Mix ITEM.
 *   - Green Goddess (Farmers Market).
 *   - Caesar Dressing (Turkey Caesar).
 *
 * Idempotent. Run: npx tsx --env-file=.env.local scripts/seed/06a-deferred-subitems.ts
 * SEED_DRY=1 → report only. Source: docs/seed/recipes/ALL-RECIPES.md.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { pathToFileURL } from "node:url";
import { seedRecipes, type RecipeDef } from "./lib-recipe-seed";

const RECIPES: RecipeDef[] = [
  {
    recipe: "Meatball Spice Mix", item: "Meatball Spice Mix", createItemIfMissing: { section: "Cooks" },
    batchYield: 1, containerLabel: "1/2 pint",
    directions: "Measure all ingredients and mix thoroughly. Put into ½ pints, label 'Meatball Spice Mix'. Net weight 77 g.",
    inputs: [
      { name: "Garlic Powder", qty: 20, unit: "gram" }, { name: "Onion Powder", qty: 15, unit: "gram" },
      { name: "Oregano", qty: 7, unit: "gram" }, { name: "Salt", qty: 20, unit: "gram" },
      { name: "Black Pepper", qty: 15, unit: "gram" },
    ],
  },
  {
    recipe: "Meatballs", item: "Meatballs", createItemIfMissing: { section: "Cooks" },
    batchYield: 20, containerLabel: "4 oz ball",
    directions: "Combine all ingredients, mix by hand (gloved). Divide into 4 oz balls on a half-sheet (20 = 5 rows of 4); pat air out. Wrap airtight, label + date (36 hr fridge max before cooking). Cook 450°F 17 min to 160°F internal.",
    inputs: [
      { name: "Ground Pork", qty: 5, unit: "lb" }, { name: "Ground Beef", qty: 5, unit: "lb" },
      { name: "Eggs", qty: 4, unit: "each" }, { name: "Panko", qty: 9, unit: "oz" },
      { name: "Meatball Spice Mix", qty: 2.56, unit: "oz", item: true },
      { name: "Parmesan", qty: 1.02, unit: "oz" },
    ],
  },
  {
    recipe: "Green Goddess", item: "Green Goddess", createItemIfMissing: { section: "Sauces" },
    batchYield: 1.25, containerLabel: "quart",
    directions: "Blend sour cream, lemon juice, garlic & salt. Gather ~1 packed qt past-peak greens (celery, old basil, cucumber, arugula); add + blend smooth. Bottle; label 'GG' + date + 5-day discard.",
    inputs: [
      { name: "Sour Cream", qty: 32, unit: "oz" }, { name: "Lemon Juice", qty: 1.2, unit: "oz" },
      { name: "Mixed Herbs", qty: 1, unit: "quart" }, { name: "Garlic", qty: 0.15, unit: "oz" },
      { name: "Salt", qty: 0.08, unit: "oz" },
    ],
  },
  {
    recipe: "Cesear Dressing", item: "Caesar Dressing", createItemIfMissing: { section: "Sauces" },
    batchYield: 1.5, containerLabel: "16 oz bottle",
    directions: "Combine all ingredients in a Vitamix; blend until smooth (add 1–2 oz water if too tight). Bottle, label 'Caesar' + date + 5-day discard. Do NOT double — won't fit the blender.",
    inputs: [
      { name: "Garlic", qty: 4, unit: "oz" }, { name: "Lemon Juice", qty: 4, unit: "oz" },
      { name: "Dijon Mustard", qty: 2.7, unit: "oz" }, { name: "Salt", qty: 0.16, unit: "oz" },
      { name: "Black Pepper", qty: 0.2, unit: "oz" }, { name: "Duke's Mayo", qty: 16, unit: "oz" },
      { name: "Parmesan", qty: 2, unit: "oz" }, { name: "Grapeseed Oil", qty: 4, unit: "oz" },
    ],
  },
];

async function main() {
  await seedRecipes(getServiceRoleClient(), { dry: process.env.SEED_DRY === "1", phase: "operational_seed_stage6a" }, RECIPES);
}
if (import.meta.url === pathToFileURL(process.argv[1]!).href) main().catch((e) => { console.error(e); process.exit(1); });
