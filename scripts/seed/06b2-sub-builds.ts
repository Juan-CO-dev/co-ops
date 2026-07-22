/**
 * Operational Seed — Stage 6b-2: sub consumer-recipe builds.
 *
 * Wires each sub menu_item (from 6b-1) to a CONSUMER recipe (output_menu_item_id) whose
 * inputs are the prepped ITEMS (item:true) + raw SKUs it's built from — the first real
 * use of the engine's consumer-output path. Gives each sub a cost-to-make (rolls up
 * through the item recipes) + depletion. 11 signature builds are the full builds from
 * sandwich-build-sheet.csv; the 4 non-sheet signature subs + 9 BYO get simple builds.
 *
 * Build-sheet → item name map applied inline: Shredduce→Iceberg, Oil/Vin→Vin, Shredded
 * Cheese→Shredded Mozzarella, Onions→Onion, Fresh Mozz→Fresh Mozzarella, Carmelized
 * Onion→Caramelized onion, Duke's Mayo→Dukes, Gree Goddess→Green Goddess, Salami→Genoa,
 * Chicken Salad→Chix Salad. Prosciutto/Bacon/Banana Peppers→BH SKUs; Utz Ripples/Sub
 * Roll/Lemon Oil auto-placeholder. Every sub also consumes 1 Sub Roll.
 *
 * Idempotent. Run: npx tsx --env-file=.env.local scripts/seed/06b2-sub-builds.ts   (SEED_DRY=1 = report only)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { pathToFileURL } from "node:url";
import { seedRecipes, type RInput, type RecipeDef } from "./lib-recipe-seed";

const I = (name: string, qty: number, unit: string): RInput => ({ name, qty, unit, item: true }); // prepped item
const S = (name: string, qty: number, unit: string): RInput => ({ name, qty, unit });               // raw SKU
const ROLL = S("Sub Roll", 1, "each");

function sub(menuItem: string, inputs: RInput[]): RecipeDef {
  return { recipe: `${menuItem} (build)`, outputMenuItemName: menuItem, batchYield: 1, containerLabel: "sandwich",
    directions: `Build per spec on a sub roll. (Consumer build for the ${menuItem} — quantities from the sandwich build sheet / Toast menu.)`,
    inputs: [...inputs, ROLL] };
}

const RECIPES: RecipeDef[] = [
  // ── 11 signature builds (sandwich-build-sheet.csv) ──
  sub("Crunchy Boi", [I("Aioli", 1.5, "oz"), I("Provolone", 2, "each"), I("Turkey", 4, "oz"), I("Onion", 0.25, "oz"), I("Pickles", 0.5, "oz"), I("Iceberg", 1, "handful"), I("Vin", 0.25, "oz"), S("Utz Ripples", 1, "handful"), S("Oregano", 0.1, "oz")]),
  sub("The Teamster", [I("Ham", 3, "each"), I("Capicola", 3, "each"), I("Genoa", 4, "each"), I("Provolone", 2, "each"), I("Onion", 0.25, "oz"), I("Sweet Peppers", 0.75, "oz"), I("Hot Peppers", 0.25, "oz"), I("Iceberg", 1, "handful"), I("Vin", 0.25, "oz"), S("Oregano", 0.1, "oz")]),
  sub("Hot Pants", [I("Capicola", 3, "each"), I("Pepperoni", 5, "each"), I("Genoa", 4, "each"), I("Provolone", 2, "each"), I("Onion", 0.25, "oz"), I("Sweet Peppers", 0.74, "oz"), I("Hot Peppers", 0.25, "oz"), I("Iceberg", 1, "handful"), I("Vin", 0.25, "oz"), S("Arugula", 0.5, "handful"), S("Oregano", 0.1, "oz")]),
  sub("The Frex", [I("Ham", 3, "each"), I("Capicola", 3, "each"), I("Genoa", 4, "each"), I("Pepperoni", 5, "each"), I("Fresh Mozzarella", 3, "each"), I("Hot Peppers", 0.5, "oz"), I("Vin", 0.25, "oz"), S("Prosciutto", 2, "each"), S("Arugula", 0.5, "handful"), S("Balsamic Vin", 0.1, "oz"), S("Oregano", 0.1, "oz")]),
  sub("Farmers Market After Dark", [I("Green Goddess", 0.5, "oz"), I("Cucumber", 3, "each"), I("Onion", 0.25, "oz"), I("Sweet Peppers", 0.75, "oz"), I("Hot Peppers", 0.25, "oz"), I("Iceberg", 1, "handful"), I("Vin", 0.25, "oz"), S("Arugula", 0.5, "handful"), S("Oregano", 0.1, "oz")]),
  sub("Marisa Tomei Eats Free", [I("HC Aioli", 1, "oz"), I("Capicola", 3, "each"), I("Genoa", 7, "each"), I("Fresh Mozzarella", 3, "each"), I("Basil", 4, "leaf"), I("Onion", 0.1, "oz"), I("Vin", 0.1, "oz"), S("Arugula", 0.5, "handful"), S("Oregano", 0.1, "oz")]),
  sub("Never Been Cheddar", [I("Mustard Aioli", 1, "oz"), I("Roast Beef", 5, "oz"), I("Cheddar", 2, "each"), I("Radish", 4, "each"), S("Arugula", 0.5, "handful"), S("Salt", 0.02, "oz"), S("Oregano", 0.1, "oz"), S("Lemon Oil", 0.1, "oz")]),
  sub("Turkey Caesar Sub", [I("Compound Butter", 0.5, "oz"), I("Iceberg", 1, "handful"), I("Turkey", 4, "oz"), I("Caesar Dressing", 2, "oz"), S("Parmesan", 0.2, "oz"), S("Black Pepper", 0.02, "oz")]),
  sub("Sicky Wicky Club", [I("Dukes", 1, "oz"), I("Iceberg", 1, "handful"), I("Onion", 0.25, "oz"), I("Tomato", 3, "each"), I("Vin", 0.25, "oz"), I("Provolone", 2, "each"), I("Ham", 2, "each"), I("Turkey", 2, "oz"), S("Bacon", 2, "each"), S("Oregano", 0.1, "oz")]),
  sub("Vesuvio II", [I("Meatballs", 3, "each"), I("Vodka", 2, "ladle"), I("Marinara", 2, "oz"), I("Shredded Mozzarella", 2, "handful"), S("Banana Peppers", 2, "oz"), S("Oregano", 0.1, "oz")]),
  sub("Our French Dip", [I("Horsey Mayo", 1.5, "oz"), I("Roast Beef", 5, "oz"), I("Caramelized onion", 0.75, "oz"), I("Provolone", 3, "each"), I("Jus", 1, "ladle"), S("Black Pepper", 0.02, "oz"), S("Thyme", 0.05, "oz")]),

  // ── 4 non-sheet signature subs (simple builds from Toast descriptions) ──
  sub("It's a BOI", [I("Aioli", 1.5, "oz"), I("Provolone", 2, "each"), I("Onion", 0.25, "oz"), I("Pickles", 0.5, "oz"), I("Iceberg", 1, "handful"), I("Vin", 0.25, "oz"), S("Utz Ripples", 1, "handful"), S("Oregano", 0.1, "oz")]),
  sub("Regular BLT", [I("Iceberg", 1, "handful"), I("Tomato", 3, "each"), I("Dukes", 1, "oz"), S("Bacon", 3, "each")]),
  sub("The chicken cutlet", [I("Chicken Cutlet", 1, "each"), I("Provolone", 2, "each"), I("Iceberg", 1, "handful"), I("Vin", 0.25, "oz")]),
  sub("Chicken parm", [I("Chicken Cutlet", 1, "each"), I("Marinara", 2, "oz"), I("Vodka", 2, "oz"), I("Shredded Mozzarella", 1, "handful"), I("Provolone", 2, "each"), I("Hot Peppers", 0.25, "oz"), S("Oregano", 0.1, "oz")]),

  // ── 9 Build-Your-Own (base item + roll; "add whatever you'd like") ──
  sub("Turkey Sub", [I("Turkey", 4, "oz")]),
  sub("Ham Sub", [I("Ham", 3, "each")]),
  sub("Roast Beef Sub", [I("Roast Beef", 5, "oz")]),
  sub("Salami Sub", [I("Genoa", 5, "each")]),
  sub("Pepperoni Sub", [I("Pepperoni", 5, "each")]),
  sub("Veggie Sub", [I("Iceberg", 1, "handful"), I("Tomato", 3, "each"), I("Onion", 0.25, "oz"), I("Cucumber", 3, "each"), I("Sweet Peppers", 0.75, "oz"), I("Vin", 0.25, "oz")]),
  sub("Tuna Salad Sub", [I("Tuna Salad", 6, "oz")]),
  sub("Egg Salad Sub", [I("Egg Salad", 6, "oz")]),
  sub("Chicken Salad", [I("Chix Salad", 6, "oz")]),
];

async function main() {
  await seedRecipes(getServiceRoleClient(), { dry: process.env.SEED_DRY === "1", phase: "operational_seed_stage6b2" }, RECIPES);
}
if (import.meta.url === pathToFileURL(process.argv[1]!).href) main().catch((e) => { console.error(e); process.exit(1); });
