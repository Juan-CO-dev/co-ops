/**
 * Operational Seed — Stage 3a: SAUCES recipes. Thin caller over lib-recipe-seed.ts
 * (shared engine: canonical production graph, auto-placeholder misses, idempotent).
 * Wires the 9 Sauces items. Ranch/Horsey/Vin = APPROXIMATE house mixes (no .docx yet).
 * Run: npx tsx --env-file=.env.local scripts/seed/03a-recipes-sauces.ts   (SEED_DRY=1 = report only)
 * Source: docs/seed/recipes/ALL-RECIPES.md.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { pathToFileURL } from "node:url";
import { seedRecipes, type RecipeDef } from "./lib-recipe-seed";

const RECIPES: RecipeDef[] = [
  { recipe: "Garlic Mayo (Aioli)", item: "Aioli", batchYield: 7.5, containerLabel: "32 oz bottle",
    directions: "Press garlic into a large bowl (trim dried ends). Add lemon juice & mayo, whisk to combine, add salt, mix and taste. Transfer to 32 oz squeeze bottles; label 'A', made-on + 5-day discard date.",
    inputs: [{ name: "Duke's Mayo", qty: 2, unit: "gallon" }, { name: "Garlic", qty: 8, unit: "oz" }, { name: "Lemon Juice", qty: 16, unit: "oz" }, { name: "Salt", qty: 0.64, unit: "oz" }] },
  { recipe: "Honey Chili Aioli", item: "HC Aioli", batchYield: 2.25, containerLabel: "quart",
    directions: "Small-dice roasted red peppers. Measure all ingredients into a bowl (honey last). Stick-blend until smooth (small red specks remain). Bottle; label 'HC' + date + 5-day discard.",
    inputs: [{ name: "Duke's Mayo", qty: 56.5, unit: "oz" }, { name: "Roasted Red Peppers", qty: 7.5, unit: "oz" }, { name: "Garlic", qty: 0.55, unit: "oz" }, { name: "Honey", qty: 3.8, unit: "oz" }, { name: "Lemon Juice", qty: 2.8, unit: "oz" }, { name: "Black Pepper", qty: 0.08, unit: "oz" }, { name: "Salt", qty: 0.08, unit: "oz" }, { name: "Chili Flake", qty: 0.08, unit: "oz" }] },
  { recipe: "Cholula Mayo", item: "HP Mayo", batchYield: 1.25, containerLabel: "quart",
    directions: "Measure all ingredients into a bowl on a scale. Whisk until combined. Transfer to quarts / squeeze bottles; label 'HP' (Hot Pants) + date + 5-day discard.",
    inputs: [{ name: "Duke's Mayo", qty: 32, unit: "oz" }, { name: "Cholula", qty: 7.5, unit: "oz" }, { name: "Lemon Juice", qty: 2.1, unit: "oz" }, { name: "Salt", qty: 0.08, unit: "oz" }] },
  { recipe: "Mustard Aioli", item: "Mustard Aioli", batchYield: 3, containerLabel: "small squeeze bottle",
    directions: "Measure all ingredients into a bowl on a scale. Whisk until combined. Bottle; label 'Must Aioli' + date + 5-day discard.",
    inputs: [{ name: "Duke's Mayo", qty: 39, unit: "oz" }, { name: "Whole Grain Mustard", qty: 2.3, unit: "oz" }, { name: "Dijon Mustard", qty: 4.9, unit: "oz" }, { name: "Garlic", qty: 0.4, unit: "oz" }, { name: "Lemon Juice", qty: 1.6, unit: "oz" }, { name: "Salt", qty: 0.08, unit: "oz" }] },
  { recipe: "Italian Salsa Verde", item: "Salsa Verde", batchYield: 1, containerLabel: "16 oz squeeze bottle",
    directions: "Gather 3 oz picked basil + 3 oz past-peak herbs (parsley/chives/more basil — waste-mitigation). Add all ingredients to a blender, blend until smooth. Reserve in a 16 oz squeeze bottle — 3-day shelf life.",
    inputs: [{ name: "Basil", qty: 3, unit: "oz" }, { name: "Garlic", qty: 1.5, unit: "oz" }, { name: "Lemon Juice", qty: 3, unit: "oz" }, { name: "Pickle Chips", qty: 2.5, unit: "oz" }, { name: "EVOO", qty: 5.5, unit: "oz" }, { name: "Salt", qty: 0.3, unit: "oz" }, { name: "Black Pepper", qty: 0.2, unit: "oz" }, { name: "Red Pepper Flakes", qty: 0.05, unit: "oz" }] },
  { recipe: "Dukes (portioned)", item: "Dukes", batchYield: 3, containerLabel: "bottle",
    directions: "Portion Duke's Mayo into squeeze bottles. Label + date.",
    inputs: [{ name: "Duke's Mayo", qty: 16, unit: "oz" }] },
  { recipe: "Ranch (house — approximate)", item: "Ranch", batchYield: 3, containerLabel: "bottle", approximate: true,
    directions: "APPROXIMATE (recipe TBD): whisk mayo + sour cream + ranch seasoning to taste; bottle + date.",
    inputs: [{ name: "Duke's Mayo", qty: 24, unit: "oz" }, { name: "Sour Cream", qty: 16, unit: "oz" }] },
  { recipe: "Horsey Mayo (house — approximate)", item: "Horsey Mayo", batchYield: 4, containerLabel: "bottle", approximate: true,
    directions: "APPROXIMATE (recipe TBD): whisk mayo + horseradish to taste; bottle + date.",
    inputs: [{ name: "Duke's Mayo", qty: 32, unit: "oz" }, { name: "Horseradish", qty: 4, unit: "oz" }] },
  { recipe: "Vin (house vinaigrette — approximate)", item: "Vin", batchYield: 6, containerLabel: "bottle", approximate: true,
    directions: "APPROXIMATE (recipe TBD): emulsify olive oil + balsamic vinegar + seasoning; bottle + date.",
    inputs: [{ name: "Olive Oil", qty: 24, unit: "oz" }, { name: "Balsamic Vin", qty: 12, unit: "oz" }] },
];

async function main() {
  await seedRecipes(getServiceRoleClient(), { dry: process.env.SEED_DRY === "1", phase: "operational_seed_stage3a" }, RECIPES);
}
if (import.meta.url === pathToFileURL(process.argv[1]!).href) main().catch((e) => { console.error(e); process.exit(1); });
