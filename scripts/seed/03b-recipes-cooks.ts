/**
 * Operational Seed — Stage 3b: COOKS recipes. Thin caller over lib-recipe-seed.ts.
 * Wires the 6 Cooks items, incl. the recursive SUB-ITEM input (Beef Jus consumes the
 * "Caramelized onion" ITEM). Juan: Jus = Beef. Chicken Cutlet = APPROXIMATE.
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/03b-recipes-cooks.ts   (SEED_DRY=1 = report only)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { pathToFileURL } from "node:url";
import { seedRecipes, type RecipeDef } from "./lib-recipe-seed";

const RECIPES: RecipeDef[] = [
  { recipe: "Caramelized Onions", item: "Caramelized onion", batchYield: 4, containerLabel: "Quart",
    directions: "Dice onions evenly. Melt butter + EVOO on med-high; add onions, drop to med-low. Stir continuously (splash water to deglaze) ~2 hrs to a deep caramel brown. At ¾ done add Worcestershire + salt. Cool in a wide tray; store in quarts — 5-day shelf life.",
    inputs: [{ name: "Spanish Onions", qty: 8, unit: "quart" }, { name: "EVOO", qty: 2, unit: "oz" }, { name: "Butter", qty: 3, unit: "oz" }, { name: "Worcestershire", qty: 1.5, unit: "oz" }, { name: "Salt", qty: 0.1, unit: "oz" }] },
  { recipe: "Chicken Cutlet (approximate)", item: "Chicken Cutlet", batchYield: 15, containerLabel: "Piece", approximate: true,
    directions: "APPROXIMATE (recipe TBD): pound chicken breast, dredge (flour → egg → panko), fry to golden + 165°F. Portion into cutlets.",
    inputs: [{ name: "Chicken Breast", qty: 10, unit: "lb" }, { name: "Panko", qty: 16, unit: "oz" }, { name: "Eggs", qty: 6, unit: "each" }] },
  { recipe: "Garlic Bread / Compound Butter", item: "Compound Butter", batchYield: 2, containerLabel: "1 lb log",
    directions: "Mix all ingredients until combined. Split in half; form each into a log in plastic wrap. Label + date; refrigerate. Yield: 2 one-lb logs.",
    inputs: [{ name: "Butter", qty: 32, unit: "oz" }, { name: "Garlic", qty: 4.3, unit: "oz" }, { name: "Garlic Powder", qty: 1.25, unit: "oz" }, { name: "Parsley", qty: 0.1, unit: "oz" }, { name: "Salt", qty: 0.08, unit: "oz" }, { name: "Black Pepper", qty: 0.08, unit: "oz" }, { name: "Parmesan", qty: 0.08, unit: "oz" }] },
  { recipe: "Beef Jus", item: "Jus", batchYield: 5, containerLabel: "Quart",
    directions: "Bring 6 qt water to a rolling boil; whisk in beef base. Add caramelized onion; boil 1 min, reduce to a simmer, skim foam/gelatin. 5 min before done add the bouquet garni (thyme) + red wine vinegar (add late for max flavor). Store in cambros. Yields ~5 quarts.",
    inputs: [{ name: "Caramelized Onion", qty: 4, unit: "oz", item: true }, { name: "Beef Base", qty: 5, unit: "oz" }, { name: "Thyme", qty: 12, unit: "sprig" }, { name: "Red Wine Vinegar", qty: 2, unit: "oz" }] },
  { recipe: "Marinara", item: "Marinara", batchYield: 6, containerLabel: "Quart",
    directions: "Sweat med-diced onion + grated garlic in olive oil until translucent/fragrant (3–5 min), lightly salted. Add 2 #10 cans crushed tomatoes, basil, salt & pepper. Bring to a simmer at 160°F. May refrigerate + reheat ONCE (label 'USE AGAIN'), else discard.",
    inputs: [{ name: "Onion", qty: 1, unit: "each" }, { name: "Olive Oil", qty: 3, unit: "Tbsp" }, { name: "Garlic", qty: 4, unit: "clove" }, { name: "Crushed Tomatoes", qty: 2, unit: "#10 can" }, { name: "Basil", qty: 6, unit: "leaf" }, { name: "Oregano", qty: 3, unit: "gram" }, { name: "Salt", qty: 0.08, unit: "oz" }, { name: "Black Pepper", qty: 0.08, unit: "oz" }] },
  { recipe: "Vodka Sauce", item: "Vodka", batchYield: 4, containerLabel: "Quart",
    directions: "Brunoise onion; sweat in olive oil + salt until translucent. Add tomato paste, cook med-low ~90 min until thick/dark/dry. Deglaze with white wine (pull up fond). Whisk in heavy cream; add parmesan, salt & pepper. Hold at 160°F. Final color orange, not pink. Reheat ONCE max.",
    inputs: [{ name: "Onion", qty: 9, unit: "oz" }, { name: "Olive Oil", qty: 3, unit: "Tbsp" }, { name: "Tomato Paste", qty: 25, unit: "oz" }, { name: "Heavy Cream", qty: 2, unit: "quart" }, { name: "Parmesan", qty: 9.5, unit: "gram" }, { name: "White Wine", qty: 4, unit: "oz" }, { name: "Salt", qty: 0.08, unit: "oz" }, { name: "Black Pepper", qty: 0.08, unit: "oz" }] },
];

async function main() {
  await seedRecipes(getServiceRoleClient(), { dry: process.env.SEED_DRY === "1", phase: "operational_seed_stage3b" }, RECIPES);
}
if (import.meta.url === pathToFileURL(process.argv[1]!).href) main().catch((e) => { console.error(e); process.exit(1); });
