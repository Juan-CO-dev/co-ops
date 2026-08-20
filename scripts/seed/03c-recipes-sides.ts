/**
 * Operational Seed — Stage 3c: SIDES recipes. Thin caller over lib-recipe-seed.ts.
 * Wires the 6 Sides items (Cannoli Cream, Chix Salad→Chicken Salad, Egg Salad,
 * Onion Dip→French Onion Dip, Tuna Salad, Antipasto Pasta). Antipasto Pasta =
 * APPROXIMATE (no .docx). Misses auto-placeholder (Vanilla Bean Paste, Ever Roast
 * Chicken [BH — reconciles at BH seed], Dried Chives).
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/03c-recipes-sides.ts   (SEED_DRY=1 = report only)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { pathToFileURL } from "node:url";
import { seedRecipes, type RecipeDef } from "./lib-recipe-seed";

const RECIPES: RecipeDef[] = [
  { recipe: "Cannoli Cream", item: "Cannoli Cream", batchYield: 2, containerLabel: "piping bag",
    directions: "Measure all ingredients into a stand-mixer bowl. Whisk until combined (scrape sides periodically); taste for smoothness/sweetness, add sugar if needed. Split between 2 piping bags, tie, label 'Cannoli Cream' + date. Yield: 2 bags.",
    inputs: [{ name: "Ricotta", qty: 48, unit: "oz" }, { name: "Confectioners Sugar", qty: 1, unit: "cup" }, { name: "Vanilla Bean Paste", qty: 1, unit: "tsp" }] },
  { recipe: "Chicken Salad", item: "Chix Salad", batchYield: 12, containerLabel: "6 oz deli",
    directions: "Dice chicken into ¼\" cubes; small-dice celery; finely dice chives. Combine all ingredients and mix by hand (breaks chicken down). Season s&p to taste. Portion into 6 oz delis; label + 5-day use-by.",
    inputs: [{ name: "Ever Roast Chicken", qty: 72, unit: "oz" }, { name: "Celery", qty: 16, unit: "oz" }, { name: "Chives", qty: 2, unit: "oz" }, { name: "Onion Powder", qty: 1, unit: "oz" }, { name: "Duke's Mayo", qty: 17.6, unit: "oz" }, { name: "Whole Grain Mustard", qty: 3.6, unit: "oz" }, { name: "Salt", qty: 0.08, unit: "oz" }, { name: "Black Pepper", qty: 0.08, unit: "oz" }] },
  { recipe: "Egg Salad", item: "Egg Salad", batchYield: 12, containerLabel: "6 oz deli",
    directions: "Press 24 pre-cooked eggs through a wire rack into a ⅓ pan (rinse first). Small-dice celery. Combine all ingredients, mix gently. Portion into 6 oz delis; date bottom + 5 days; FIFO.",
    inputs: [{ name: "Eggs", qty: 24, unit: "each" }, { name: "Duke's Mayo", qty: 16, unit: "oz" }, { name: "Celery", qty: 8, unit: "oz" }, { name: "Dijon Mustard", qty: 0.5, unit: "oz" }, { name: "Old Bay", qty: 0.37, unit: "oz" }, { name: "Salt", qty: 0.05, unit: "oz" }, { name: "Black Pepper", qty: 0.05, unit: "oz" }] },
  { recipe: "French Onion Dip", item: "Onion Dip", batchYield: 12, containerLabel: "6 oz deli",
    directions: "Caramelize large/med-diced onions in olive oil (salted) at 180 until deep golden (2–3 hrs); cool. Mix sour cream, mayo, onion powder, chives, s&p on a scale; add onions, mix. Portion into 6 oz delis; 5-day use-by; FIFO.",
    inputs: [{ name: "Yellow Onions", qty: 8, unit: "each" }, { name: "Sour Cream", qty: 64, unit: "oz" }, { name: "Duke's Mayo", qty: 32, unit: "oz" }, { name: "Onion Powder", qty: 0.51, unit: "oz" }, { name: "Dried Chives", qty: 0.15, unit: "oz" }, { name: "Salt", qty: 0.05, unit: "oz" }, { name: "Black Pepper", qty: 0.05, unit: "oz" }] },
  { recipe: "Tuna Salad", item: "Tuna Salad", batchYield: 15, containerLabel: "6 oz deli",
    directions: "Drain tuna in a perforated pan; break up by hand, squeeze out moisture. Small-dice celery + red onion. Combine celery, red onion, dijon, mayo & tuna; mix gently by hand (over-mixing = mealy). Portion into 6 oz delis; date + 5 days; FIFO.",
    inputs: [{ name: "Tuna", qty: 2, unit: "can" }, { name: "Duke's Mayo", qty: 28, unit: "oz" }, { name: "Dijon Mustard", qty: 2.13, unit: "oz" }, { name: "Red onion", qty: 10.5, unit: "oz" }, { name: "Celery", qty: 16, unit: "oz" }, { name: "Salt", qty: 0.05, unit: "oz" }, { name: "Black Pepper", qty: 0.05, unit: "oz" }] },
  { recipe: "Antipasto Pasta (approximate)", item: "Antipasto Pasta", batchYield: 12, containerLabel: "portion", approximate: true,
    directions: "APPROXIMATE (recipe TBD): cook fusilli, cool; toss with antipasto veg/meats + dressing. Portion + date.",
    inputs: [{ name: "Fusilli Pasta", qty: 32, unit: "oz" }, { name: "Olive Oil", qty: 4, unit: "oz" }] },
];

async function main() {
  await seedRecipes(getServiceRoleClient(), { dry: process.env.SEED_DRY === "1", phase: "operational_seed_stage3c" }, RECIPES);
}
if (import.meta.url === pathToFileURL(process.argv[1]!).href) main().catch((e) => { console.error(e); process.exit(1); });
