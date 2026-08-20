/**
 * Operational Seed — Stage 3d: SLICING + VEG (portioned items).
 *
 * Wires the deli-slicing and produce-prep items as SINGLE-INPUT "portioned" recipes
 * (raw SKU → item) through the shared engine, so cost/readiness/depletion work
 * uniformly with the recipe-born items (Juan-locked). Each recipe: 1 portioned input
 * (the raw SKU) → 1 output (the existing item). batch_yield = 1 as a Q6 ESTIMATE
 * (1 raw unit → 1 par-unit of the item); refine with real slice/portion data later.
 *
 * Mortadella has no seeded SKU (not on the BH vA guide) → auto-placeholder.
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/03d-recipes-portioned.ts   (SEED_DRY=1 = report only)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { pathToFileURL } from "node:url";
import { seedRecipes, type RecipeDef } from "./lib-recipe-seed";

// [item name, raw SKU input name, container/par-unit label, verb]
const PORTIONED: Array<[string, string, string, string]> = [
  // Slicing (deli meats / cheese → their raw deli SKU)
  ["Capicola", "Capicola", "pieces", "Slice"],
  ["Cheddar", "Cheddar", "block", "Slice"],
  ["Genoa", "Genoa", "logs", "Slice"],
  ["Ham", "Ham", "pieces", "Slice"],
  ["Mortadella", "Mortadella", "pieces", "Slice"],
  ["Pepperoni", "Pepperoni", "pieces", "Slice"],
  ["Provolone", "Provolone", "pieces", "Slice"],
  ["Roast Beef", "Roast Beef", "1/3 Pan", "Slice"],
  ["Turkey", "Turkey", "1/3 Pan", "Slice"],
  // Veg (produce prep → their raw produce SKU)
  ["Basil", "Basil", "Quart", "Pick/prep"],
  ["Cucumber", "Cucumber", "Quart", "Slice"],
  ["Fresh Mozzarella", "Fresh Mozzarella", "Quart", "Slice/prep"],
  ["Hot Peppers", "Hot Peppers", "Quart", "Portion"],
  ["Iceberg", "Iceberg", "1/3 Pan", "Chop"],
  ["Onion", "Onion (red)", "Quart", "Slice"],
  ["Pickles", "Pickle slices", "Quart", "Portion"],
  ["Radish", "Watermelon Radish", "Quart", "Slice"],
  ["Shredded Mozzarella", "Shredded Mozz", "Quart", "Portion"],
  ["Sweet Peppers", "Sweet Peppers", "Quart", "Portion"],
  ["Tomato", "Tomatoes", "each", "Slice"],
];

const RECIPES: RecipeDef[] = PORTIONED.map(([item, sku, label, verb]) => ({
  recipe: `${item} (portioned)`,
  item,
  batchYield: 1,
  containerLabel: label,
  directions: `${verb} ${sku} to spec; portion into ${label}, label + date. (Portioned item — yield is a placeholder estimate; refine with slice/portion data.)`,
  inputs: [{ name: sku, qty: 1, unit: "unit", portioned: true }],
}));

async function main() {
  await seedRecipes(getServiceRoleClient(), { dry: process.env.SEED_DRY === "1", phase: "operational_seed_stage3d" }, RECIPES);
}
if (import.meta.url === pathToFileURL(process.argv[1]!).href) main().catch((e) => { console.error(e); process.exit(1); });
