/**
 * Seed 35: Juan's eight floor answers of 2026-09-13 (Claude chat), applied to the catalog.
 *   1. Farmers Market After Dark uses Salsa Verde, not Green Goddess → the build's 0.5 oz line moves to the Salsa Verde item.
 *   2. Lemon Oil is made in house: "In a 16oz bottle 1/3rd lemon juice, 2 strong pinches of salt, the rest is olive oil."
 *      → a global prep item + a production recipe (lemon juice 5.33 oz, salt 0.04 oz ESTIMATE, olive oil 10.63 oz → one 16 oz
 *        bottle), Never Been Cheddar's 0.1 oz line moves from the placeholder SKU to the item, and the placeholder SKU is retired.
 *   4/6. Packaging comes from PFG AND Leonard "as needed"; cannoli shells from PFG AND Baldor → one SKU per vendor
 *      (multi-vendor doctrine 2026-08-20): a Leonard/Baldor twin per guide row, carrying the guide's code and par; rows the app
 *      never had become new Leonard SKUs.
 *   5. Leonard order days per the sheet: Sunday and Thursday by 3:30 (was Mon–Fri) — ASSUMPTION flagged to Juan: his "Ok"
 *      read as "the sheet is right", consistent with answer 7; append-only, so a revert is one more pair set.
 *   7. "The sheet is current" → every guide par whose unit maps onto the SKU's pack is applied in pack units (a #10 can of
 *      a six-can case is 0.17 case; a jar of a four-jar case is 0.25). Rows whose sheet unit cannot be mapped (qt, lb, flats,
 *      "backup pallets") are left alone and reported.
 *   8. Eggs (cooked) is ordered by the case of 12 bags; "4 pks" = 0.33 case.
 * Dry-run default. CC runs sim, then prod; this module never loads an env file.
 * --target sim|prod [--dry-run | --execute --plan-digest <dry-run digest>]
 * Seed 26 guards unchanged; direct writes follow seeds 31–34 (not a transaction; interrupted rows refuse on retry).
 * No schema changes, no new audit actions.
 */
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonical, type RawRow } from "@/lib/angel-wave7";
import type { AuditAction } from "@/lib/audit-actions";
import { createWave7Client, loadAll, validateTarget } from "./26-angel-wave7";

export const SOURCE = "floor-answers-2026-09-13";
export const GUIDE = "docs/seed/source/order-guide-2026-09-13.json";
const JUAN = "Juan 2026-09-13 (Claude chat)";
export const IDS = {
  farmersInput: "50f789ec-687e-4653-bf01-d682765450ff",
  cheddarInput: "4215d6d2-ca37-4634-b0fd-97b2962092dc",
  greenGoddessItem: "5d91ad06-8003-43a8-9d7f-22aeb9033a48",
  salsaVerdeItem: "f661f4f1-426a-4920-8163-44f72f393542",
  lemonOilSku: "68071bb3-2ea8-4901-ae1b-cff12b28285d",
  lemonJuiceSku: "6004d43b-f624-4884-bdb2-5e195ebc6c87",
  saltSku: "b69d26ff-551d-4bdf-93ca-441c5c5436cf",
  oliveOilSku: "b99206db-21b4-4349-b69a-aac7bd2a69df",
} as const;
export const LEMON_OIL = {
  item: { name: "Lemon Oil", name_es: "Aceite de limón", section: "Sauces", default_par: 1, default_par_unit: "Bottle", oz_per_par_unit: 16 },
  recipe: { name: "Lemon Oil", directions: "In a 16 oz squeeze bottle: fill one third with lemon juice, add two strong pinches of salt, fill the rest with olive oil. Cap and shake.", container: "16 oz squeeze bottle" },
  inputs: [
    { sku: IDS.lemonJuiceSku, name: "Lemon Juice", quantity: 5.33, unit: "oz", note: "one third of 16 oz" },
    { sku: IDS.saltSku, name: "Salt", quantity: 0.04, unit: "oz", note: "OPERATIONAL_ESTIMATE: two strong pinches ≈ 1 g" },
    { sku: IDS.oliveOilSku, name: "Olive Oil", quantity: 10.63, unit: "oz", note: "the rest of 16 oz" },
  ],
  source: `${JUAN}: "In a 16oz bottle 1/3rd lemon juice, 2 strong pinches of salt, the rest is olive oil."`,
} as const;
export interface TwinSpec { name: string; vendor: "Leonard Paper" | "Baldor"; item_number: string | null; par: string; weekday: number | null; weekend: number | null; sibling: string | null }
/** Guide rows ordered from Leonard (or Baldor); `sibling` = the app's existing SKU name to mirror, null = brand-new row. */
export const TWINS: readonly TwinSpec[] = [
  { name: "Kraft 10x5x13 (Small Bags)", vendor: "Leonard Paper", item_number: "FC-NP72", par: "2.5 cs", weekday: 2.5, weekend: null, sibling: "Kraft 10x5x13 (Small Bags)" },
  { name: "Kraft 12x9x13 (Large Bags)", vendor: "Leonard Paper", item_number: "FC-NP12916", par: "1 cs", weekday: 1, weekend: null, sibling: "Kraft 12x9x13 (Large Bags)" },
  { name: "Quart (Large)", vendor: "Leonard Paper", item_number: "TP-TD41032", par: "2 sleeves", weekday: 2, weekend: null, sibling: "Quart (Large)" },
  { name: "Pint (Medium)", vendor: "Leonard Paper", item_number: "TP-TD41016", par: "2 sleeves", weekday: 2, weekend: null, sibling: "Pint (Medium)" },
  { name: "Half Pint 8oz (hard)", vendor: "Leonard Paper", item_number: "TP-TD41008", par: "4 sleeves", weekday: 4, weekend: null, sibling: "Half Pint 8oz (hard)" },
  { name: "Lid for 8-32 oz cont.", vendor: "Leonard Paper", item_number: "TP-TL410", par: "3 sleeves", weekday: 3, weekend: null, sibling: null },
  { name: "1/2 pint top (flexi)", vendor: "Leonard Paper", item_number: "PL-RDTFL", par: "3 sleeves", weekday: 3, weekend: null, sibling: "1/2 pint top (flexi)" },
  { name: "1/2 pint bottoms (flexi)", vendor: "Leonard Paper", item_number: "PL-RD8C", par: "3 sleeves", weekday: 3, weekend: null, sibling: "1/2 pint bottoms (flexi)" },
  { name: "2 oz portion cups", vendor: "Leonard Paper", item_number: "AC-PCP200C", par: "2 sleeves", weekday: 2, weekend: null, sibling: "2 oz portion cups" },
  { name: "2 oz portion cup lids", vendor: "Leonard Paper", item_number: "AC-PCLT2", par: "2 sleeves", weekday: 2, weekend: null, sibling: "2 oz portion cup lids" },
  { name: "Plastic forks", vendor: "Leonard Paper", item_number: "EM-261FB", par: ".25 cs", weekday: 0.25, weekend: null, sibling: "Plastic forks" },
  { name: "Plastic Spoons", vendor: "Leonard Paper", item_number: "EM-264SB", par: ".25 cs", weekday: 0.25, weekend: null, sibling: "Plastic Spoons" },
  { name: "Plastic Knives", vendor: "Leonard Paper", item_number: "EM-263KB", par: ".25 cs", weekday: 0.25, weekend: null, sibling: "Plastic Knives" },
  { name: "Plates 8\"", vendor: "Leonard Paper", item_number: "T-R090", par: ".25 cs", weekday: 0.25, weekend: null, sibling: "Plates 8\"" },
  { name: "Patty Paper", vendor: "Leonard Paper", item_number: "MN-PP55", par: "3 pks", weekday: 3, weekend: null, sibling: "Patty Paper" },
  { name: "Paper Deli Sheets (Wax Paper)", vendor: "Leonard Paper", item_number: "MN-105505", par: "Order by PCK.", weekday: null, weekend: null, sibling: "Paper Deli Sheets (Wax Paper)" },
  { name: "Foil roll", vendor: "Leonard Paper", item_number: "WP-286", par: ".25 roll", weekday: 0.25, weekend: null, sibling: "Foil roll" },
  { name: "Round Salad Bowls & Lids", vendor: "Leonard Paper", item_number: "EP-SB24", par: ".25 cs", weekday: 0.25, weekend: null, sibling: "Round Salad Bowls & Lids" },
  { name: "Salad Clam Shell (55oz)", vendor: "Leonard Paper", item_number: null, par: ".25 cs", weekday: 0.25, weekend: null, sibling: "Salad Clam Shell (55oz)" },
  { name: "Aluminum Full Pan (Catering)", vendor: "Leonard Paper", item_number: "H-2050FC", par: "N/A", weekday: null, weekend: null, sibling: "Aluminum Full Pan (Catering)" },
  { name: "Aluminum Full Pan Lid (Catering)", vendor: "Leonard Paper", item_number: "H-20190050", par: "N/A", weekday: null, weekend: null, sibling: "Aluminum Full Pan Lid (Catering)" },
  { name: "Gloves Medium", vendor: "Leonard Paper", item_number: "EM-PF251", par: "4 pks each", weekday: 4, weekend: null, sibling: "Gloves Medium" },
  { name: "Gloves Large", vendor: "Leonard Paper", item_number: "EM-PF252", par: "4 pks each", weekday: 4, weekend: null, sibling: "Gloves Large" },
  { name: "Gloves Extra Large", vendor: "Leonard Paper", item_number: "EM-PF256", par: "4 pks each", weekday: 4, weekend: null, sibling: "Gloves Extra Large" },
  { name: "C- Fold napkins", vendor: "Leonard Paper", item_number: "NP-P100B", par: "4 pks", weekday: 4, weekend: null, sibling: "C- Fold napkins" },
  { name: "Reciept Paper (thermal)", vendor: "Leonard Paper", item_number: "IX-90780668", par: "4 rolls", weekday: 4, weekend: null, sibling: "Reciept Paper (thermal)" },
  { name: "Oven Cleaner", vendor: "Leonard Paper", item_number: "CBD-991206", par: "2 each", weekday: 2, weekend: null, sibling: "Oven Cleaner" },
  { name: "Quart Bags (single)", vendor: "Leonard Paper", item_number: "D-40036", par: ".25 cs", weekday: 0.25, weekend: null, sibling: null },
  { name: "Pastry bags", vendor: "Leonard Paper", item_number: "DM-IT115437", par: ".25 cs", weekday: 0.25, weekend: null, sibling: null },
  { name: "Butcher Paper", vendor: "Leonard Paper", item_number: "S-1824PS", par: "4 stacks", weekday: 4, weekend: null, sibling: "Butcher Paper" },
  { name: "Blue Tape (labeling)", vendor: "Leonard Paper", item_number: "ST-104952", par: "2 each", weekday: 2, weekend: null, sibling: null },
  { name: "Trash Liners 40x46", vendor: "Leonard Paper", item_number: "JR-4046XH", par: ".5 cs/1 cs", weekday: 0.5, weekend: 1, sibling: "Trash Liners 40x46" },
  { name: "Plastic Wrap", vendor: "Leonard Paper", item_number: "SW-242", par: "1 roll", weekday: 1, weekend: null, sibling: "Plastic Wraop" },
  { name: "Toilet Paper", vendor: "Leonard Paper", item_number: "RT-276", par: "4 each", weekday: 4, weekend: null, sibling: "Toilet Paper" },
  { name: "Stainless Steel Scrubbies", vendor: "Leonard Paper", item_number: "OC-96143", par: "3 each", weekday: 3, weekend: null, sibling: "Stainless Steel Scrubbies" },
  { name: "Green scouring pads", vendor: "Leonard Paper", item_number: "M-96", par: "3 each", weekday: 3, weekend: null, sibling: null },
  { name: "Catering Box Bottoms", vendor: "Leonard Paper", item_number: null, par: "1.5 cs", weekday: 1.5, weekend: null, sibling: null },
  { name: "Catering Box Tops", vendor: "Leonard Paper", item_number: null, par: "1.5 cs", weekday: 1.5, weekend: null, sibling: null },
  { name: "Cannoli Shell", vendor: "Baldor", item_number: null, par: "1 layer", weekday: 1, weekend: null, sibling: "Cannoli Shell" },
];
export interface ParSpec { name: string; vendor: string; sheet: string; weekday: number; weekend: number | null; note?: string }
/** Guide pars in the SKU's PACK unit. `weekend: null` = the sheet gives one number or a unit that cannot be mapped; leave the weekend as is. */
export const PARS: readonly ParSpec[] = [
  { name: "Arugula", vendor: "PFG", sheet: "5 bags/9 bags", weekday: 5, weekend: 9 },
  { name: "Celery", vendor: "PFG", sheet: "3 ea/6 ea", weekday: 3, weekend: 6 },
  { name: "Chives", vendor: "PFG", sheet: "4 oz", weekday: 0.5, weekend: null, note: "4 oz of the 8 oz container" },
  { name: "Cucumber", vendor: "PFG", sheet: "7 ea/10 ea", weekday: 7, weekend: 10 },
  { name: "Garlic", vendor: "PFG", sheet: ".75 jar/1.25 jar", weekday: 0.75, weekend: 1.25 },
  { name: "Iceberg", vendor: "PFG", sheet: "4 cs/9 cs", weekday: 4, weekend: 9 },
  { name: "Lemon Juice", vendor: "PFG", sheet: "4 btl/5 btl", weekday: 0.67, weekend: 0.83, note: "bottles of the six-bottle case" },
  { name: "Onion (red)", vendor: "PFG", sheet: "5 ea", weekday: 5, weekend: null },
  { name: "Onion (White)", vendor: "PFG", sheet: ".5 sck/1 sck", weekday: 0.5, weekend: 1 },
  { name: "Parsley", vendor: "PFG", sheet: "1 ea/2 ea", weekday: 1, weekend: 2 },
  { name: "Watermelon Radish", vendor: "PFG", sheet: "2 bags/4 bags", weekday: 2, weekend: 4 },
  { name: "Tomatoes", vendor: "PFG", sheet: ".75 cs/1.5 cs", weekday: 0.75, weekend: 1.5 },
  { name: "Thyme", vendor: "PFG", sheet: "2 oz", weekday: 0.27, weekend: null, note: "2 oz of the 7.52 oz case" },
  { name: "Ricotta", vendor: "PFG", sheet: "1 tub", weekday: 1, weekend: null },
  { name: "Shredded Mozz", vendor: "PFG", sheet: "2 bag", weekday: 2, weekend: null },
  { name: "Cheddar", vendor: "PFG", sheet: ".25 blck/1 blck", weekday: 0.25, weekend: 1 },
  { name: "Butter", vendor: "PFG", sheet: "5 lbs", weekday: 5, weekend: null, note: "the SKU is the 1 lb block" },
  { name: "Heavy Cream", vendor: "PFG", sheet: "6 ea", weekday: 6, weekend: null },
  { name: "Fresh Mozzarella", vendor: "PFG", sheet: "2 cs/4 cs", weekday: 2, weekend: 4 },
  { name: "Sour Cream", vendor: "PFG", sheet: "1 bckt", weekday: 1, weekend: null },
  { name: "Eggs (cooked)", vendor: "PFG", sheet: "48 eggs (4 pks)", weekday: 0.33, weekend: null, note: `${JUAN}: ordered by the case of 12 bags; 4 bags = 0.33 case` },
  { name: "Balsamic Vin", vendor: "PFG", sheet: ".25 jug", weekday: 0.25, weekend: null },
  { name: "Balsamic Glaze", vendor: "PFG", sheet: "1 bottle", weekday: 0.25, weekend: null, note: "one bottle of the four-bottle case" },
  { name: "Red wine vinegar", vendor: "PFG", sheet: ".25 jug", weekday: 0.06, weekend: null, note: "a quarter jug of the four-jug case" },
  { name: "Cholula", vendor: "Baldor", sheet: ".5 bottle", weekday: 0.5, weekend: null },
  { name: "Confectioners Sugar", vendor: "PFG", sheet: "1 box", weekday: 0.08, weekend: null, note: "one 2 lb bag of the twelve-bag case" },
  { name: "Duke's Mayo", vendor: "PFG", sheet: "3 cs", weekday: 3, weekend: null },
  { name: "Honey", vendor: "PFG", sheet: ".5 bottle", weekday: 0.5, weekend: null },
  { name: "Horseradish", vendor: "PFG", sheet: ".25 jar", weekday: 0.25, weekend: null },
  { name: "Mustard (Dijon)", vendor: "PFG", sheet: ".25 bckt", weekday: 0.25, weekend: null },
  { name: "Mustard (Whole)", vendor: "PFG", sheet: ".25 bckt", weekday: 0.25, weekend: null },
  { name: "Old Bay", vendor: "PFG", sheet: ".25 bottle", weekday: 0.25, weekend: null },
  { name: "Olive Oil", vendor: "PFG", sheet: "3 jugs/4 jugs", weekday: 3, weekend: 4 },
  { name: "Oregano", vendor: "PFG", sheet: ".25 container", weekday: 0.25, weekend: null },
  { name: "Garlic Powder", vendor: "PFG", sheet: ".25 container", weekday: 0.25, weekend: null },
  { name: "Salt", vendor: "PFG", sheet: "1 box", weekday: 1, weekend: null },
  { name: "Roasted Red Peppers", vendor: "PFG", sheet: "1 #10 can", weekday: 0.17, weekend: null, note: "one can of the six-can case" },
  { name: "Tomatoes Crushed (10#)", vendor: "PFG", sheet: "4 #10 can", weekday: 0.67, weekend: null, note: "four cans of the six-can case" },
  { name: "Tomato Paste", vendor: "PFG", sheet: "1 #10 can", weekday: 0.17, weekend: null, note: "one can of the six-can case" },
  { name: "Grapeseed Oil", vendor: "PFG", sheet: ".25 bottle", weekday: 0.13, weekend: null, note: "a quarter jug of the two-jug case" },
  { name: "Canola Oil", vendor: "PFG", sheet: ".25 container", weekday: 0.25, weekend: null },
  { name: "Tuna", vendor: "PFG", sheet: "3 ea", weekday: 3, weekend: null },
  { name: "Ground Beef", vendor: "PFG", sheet: "2 ea/4 ea", weekday: 2, weekend: 4 },
  { name: "Chicken Breast", vendor: "PFG", sheet: "1 10lb bag", weekday: 0.25, weekend: null, note: "one bag of the four-bag case" },
  { name: "Ground Pork", vendor: "PFG", sheet: "2 ea/4 ea", weekday: 2, weekend: 4 },
  { name: "Ham", vendor: "PFG", sheet: "3 ea/5 ea", weekday: 3, weekend: 5 },
  { name: "Saratoga", vendor: "PFG", sheet: "24 bottles", weekday: 1, weekend: null, note: "one 24-bottle case" },
  { name: "Natalie's Lemonade", vendor: "PFG", sheet: "2 cs/4 cs", weekday: 2, weekend: 4 },
  { name: "Employee Water", vendor: "PFG", sheet: "1 case", weekday: 1, weekend: null },
  { name: "Formula C gallons", vendor: "Trimark", sheet: "2 each", weekday: 2, weekend: null },
  { name: "Solid Suds (cap hill only)", vendor: "Trimark", sheet: "3 each", weekday: 3, weekend: null },
  { name: "Pot & Pan Sanitizer", vendor: "Trimark", sheet: "2 each", weekday: 2, weekend: null },
  { name: "Bleach Gallons", vendor: "Trimark", sheet: "1 each", weekday: 1, weekend: null },
  { name: "Foam Soap", vendor: "Trimark", sheet: "3 each", weekday: 3, weekend: null },
  { name: "Checkmate gallons (dupont only)", vendor: "Trimark", sheet: "2 each", weekday: 2, weekend: null },
  { name: "Fancy Napkins", vendor: "Trimark", sheet: ".5 cs/1.5 cs", weekday: 0.5, weekend: 1.5 },
  { name: "Multi Cleaner (Kitchen Citrus #8)", vendor: "Trimark", sheet: "1 each", weekday: 1, weekend: null },
  { name: "EZ Dry gallons", vendor: "Trimark", sheet: "2 each", weekday: 2, weekend: null },
  { name: "Turkey", vendor: "Boar's Head", sheet: "9/22 not prepped", weekday: 9, weekend: 22 },
  { name: "Bacon", vendor: "Boar's Head", sheet: ".5 box/1.25 box", weekday: 0.5, weekend: 1.25 },
  { name: "Genoa", vendor: "Boar's Head", sheet: "5 logs/8 logs", weekday: 5, weekend: 8 },
  { name: "Prosciutto", vendor: "Boar's Head", sheet: "4 pk/5 pk", weekday: 4, weekend: 5 },
  { name: "Pepperoni", vendor: "Boar's Head", sheet: "3 ea/5 ea", weekday: 3, weekend: 5 },
  { name: "Capicola", vendor: "Boar's Head", sheet: "8 pcs/14 pcs", weekday: 8, weekend: 14 },
  { name: "Provolone", vendor: "Boar's Head", sheet: "8 pcs/14 pcs", weekday: 8, weekend: 14 },
  { name: "Roast Beef", vendor: "Boar's Head", sheet: "2 ea/4 ea", weekday: 2, weekend: 4 },
  { name: "Ever Roast Chicken", vendor: "Boar's Head", sheet: "1 ea/2 ea", weekday: 1, weekend: 2 },
  { name: "Pickle slices", vendor: "Boar's Head", sheet: "1.5 buckets/3 buckets", weekday: 1.5, weekend: 3 },
  { name: "Whole pickles", vendor: "Boar's Head", sheet: "1/2 bucket/whole bucket unopened", weekday: 0.5, weekend: 1 },
  { name: "Banana Peppers", vendor: "Boar's Head", sheet: "1 gallon/1 gallon", weekday: 0.25, weekend: 0.25, note: "one jar of the four-jar case" },
  { name: "Hot Peppers", vendor: "Boar's Head", sheet: "5 gallons/6 gallons", weekday: 1.25, weekend: 1.5, note: "jars of the four-jar case" },
  { name: "Sweet Peppers", vendor: "Boar's Head", sheet: "5 gallons/6 gallons", weekday: 1.25, weekend: 1.5, note: "jars of the four-jar case" },
  { name: "DB Root Beer", vendor: "Boar's Head", sheet: "3 inner pack/1.5 backup pallets", weekday: 3, weekend: null, note: "'backup pallets' is not a pack unit; weekend left as is" },
  { name: "DB Cherry Soda", vendor: "Boar's Head", sheet: "3 inner pack/1.5 backup pallets", weekday: 3, weekend: null, note: "weekend left as is" },
  { name: "DB Cream Soda", vendor: "Boar's Head", sheet: "3 inner pack/1.5 backup pallets", weekday: 3, weekend: null, note: "weekend left as is" },
  { name: "DB Cel Ray", vendor: "Boar's Head", sheet: "2 inner pack/2 inner pack", weekday: 2, weekend: 2 },
  { name: "DB Diet Cherry Soda", vendor: "Boar's Head", sheet: "3 inner pack/1.5 backup pallets", weekday: 3, weekend: null, note: "weekend left as is" },
  { name: "DB Diet Cream Soda", vendor: "Boar's Head", sheet: "3 inner pack/1.5 backup pallets", weekday: 3, weekend: null, note: "weekend left as is" },
  { name: "Branded (C/O) Water", vendor: "Boar's Head", sheet: "1 case/2 case", weekday: 1, weekend: 2 },
  { name: "Diet Coke", vendor: "Boar's Head", sheet: "1.5 case/3 case", weekday: 1.5, weekend: 3 },
  { name: "Coke", vendor: "Boar's Head", sheet: "1.5 case/2 case", weekday: 1.5, weekend: 2 },
  { name: "Frooties", vendor: "Penny Candy", sheet: "4 bags", weekday: 4, weekend: null },
  { name: "Circle Label Stickers", vendor: "Amazon", sheet: "1.5 box", weekday: 1.5, weekend: null },
];
/** Sheet rows whose unit cannot be mapped onto the SKU's pack; reported, never written. */
export const UNMAPPED = ["Basil (1.5 lb/2 lb vs a 23.2 oz case)", "Parmesan (Grated) (1.5 qt vs a 4×80 oz case)", "Eggs (2 flats vs a 360-egg case)", "Chili Flake (1 qt vs a 64 oz case)", "Black peppercorn (1 qt vs a 92 oz tub)", "Onion Powder (1 qt vs an 80 oz jug)", "Panko (Japanese) (6 qt vs a 320 oz case)", "Fusilli Pasta (2 lb vs a 21.8 lb case)", "the six Utz chips (cases vs single-bag SKUs; pack size coming tomorrow)"] as const;
export const LEONARD_RHYTHM = { vendor: "Leonard Paper", sheet: "Packaging (Leonard Paper): sun by 3:30, Thurs by 3:30", pairs: [{ order_dow: 0, lead_days: 1 }, { order_dow: 4, lead_days: 1 }], cutoff: "15:30:00", assumption: `${JUAN} answered "Ok" to "app says Mon–Fri 3:30, sheet says Sun and Thu 3:30"; read as the sheet being current (answer 7). Lead day unchanged (1).` } as const;

export type Tables = Record<"vendor_items" | "vendors" | "locations" | "items" | "recipes" | "recipe_inputs" | "recipe_outputs" | "vendor_delivery_rhythm" | "vendor_cutoffs", RawRow[]>;
export interface Plan { section: "recipes" | "twins" | "pars" | "rhythm"; name: string; status: "ready" | "already" | "refused" | "absent"; before: unknown; after: unknown; source: string; reason?: string; expected: RawRow }
const n = (v: unknown): number | null => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const active = (rows: RawRow[]) => rows.filter(r => r.active === true);
const one = (rows: RawRow[], what: string): RawRow => { if (rows.length !== 1) throw new Error(`${what}: expected one row, found ${rows.length}`); return rows[0]!; };
const vendorByName = (t: Tables, name: string): RawRow | null => { const rows = active(t.vendors).filter(r => r.name === name); return rows.length === 1 ? rows[0]! : null; };
const recipeNote = `[${SOURCE}] ${LEMON_OIL.source}`;
export const twinNote = (spec: TwinSpec) => `[${SOURCE}] ${spec.vendor} row of the ${GUIDE} sheet (par "${spec.par}"${spec.sibling ? `; twin of the ${spec.sibling === spec.name ? "" : `"${spec.sibling}" `}SKU under its other vendor` : "; not previously in the app"}). ${JUAN}: "Both as needed".`;

export function planFloorAnswers(t: Tables): Plan[] {
  const result: Plan[] = [];
  const add = (section: Plan["section"], name: string, source: string, after: unknown, work: (p: Plan) => void) => {
    const p: Plan = { section, name, source, before: null, after, status: "ready", expected: {} };
    try { work(p); } catch (e) { p.status = "refused"; p.reason = e instanceof Error ? e.message : "Invalid before-state"; }
    result.push(p);
  };
  // ── 1. Farmers Market After Dark: Green Goddess → Salsa Verde ─────────────────
  add("recipes", "Farmers Market After Dark: Salsa Verde", `${JUAN}: "The farmers doesn't use green goddess anymore. It uses salsa verde."`, { component_item_id: IDS.salsaVerdeItem, quantity: 0.5, unit: "oz" }, p => {
    const rows = t.recipe_inputs.filter(r => r.id === IDS.farmersInput);
    if (!rows.length) { p.status = "absent"; p.reason = "Farmers Market input not on this target"; return; }
    const input = one(rows, "Farmers Market input");
    const salsa = active(t.items).filter(r => r.id === IDS.salsaVerdeItem && r.name === "Salsa Verde" && r.location_id == null);
    if (!salsa.length) { p.status = "absent"; p.reason = "Salsa Verde item not on this target"; return; }
    p.expected = { input, item: salsa[0]! };
    p.before = { component_item_id: input.component_item_id, quantity: n(input.quantity), unit: input.unit };
    if (input.component_item_id === IDS.salsaVerdeItem && n(input.quantity) === 0.5 && input.unit === "oz") { p.status = "already"; return; }
    if (input.component_item_id !== IDS.greenGoddessItem || n(input.quantity) !== 0.5 || input.unit !== "oz" || input.component_sku_id != null) throw new Error("Input is not the 0.5 oz Green Goddess line this answer replaces");
  });
  // ── 2. Lemon Oil: item + production recipe; Never Been Cheddar line; retire the placeholder SKU ──
  add("recipes", "Lemon Oil (in house)", LEMON_OIL.source, { item: LEMON_OIL.item, recipe: LEMON_OIL.recipe.name, inputs: LEMON_OIL.inputs.map(i => `${i.name} ${i.quantity} ${i.unit}`), cheddar_line: "0.1 oz → item", placeholder_sku: "retired" }, p => {
    const cheddarRows = t.recipe_inputs.filter(r => r.id === IDS.cheddarInput);
    if (!cheddarRows.length) { p.status = "absent"; p.reason = "Never Been Cheddar input not on this target"; return; }
    const cheddar = one(cheddarRows, "Never Been Cheddar input");
    const sku = t.vendor_items.find(r => r.id === IDS.lemonOilSku) ?? null;
    const ingredients = LEMON_OIL.inputs.map(i => active(t.vendor_items).filter(r => r.id === i.sku && r.name === i.name));
    if (ingredients.some(rows => rows.length !== 1)) { p.status = "absent"; p.reason = "An ingredient SKU (lemon juice / salt / olive oil) is not on this target"; return; }
    const items = t.items.filter(r => r.name === LEMON_OIL.item.name && r.location_id == null);
    const recipes = t.recipes.filter(r => r.name === LEMON_OIL.recipe.name);
    const recipeIds = new Set(recipes.map(r => r.id));
    const inputs = t.recipe_inputs.filter(r => recipeIds.has(r.recipe_id)), outputs = t.recipe_outputs.filter(r => recipeIds.has(r.recipe_id));
    const otherUses = t.recipe_inputs.filter(r => r.component_sku_id === IDS.lemonOilSku && r.id !== IDS.cheddarInput);
    p.expected = { cheddar, sku, items, recipes, inputs, outputs, ingredients: ingredients.map(r => r[0]!) };
    p.before = { cheddar: { component_sku_id: cheddar.component_sku_id, component_item_id: cheddar.component_item_id, quantity: n(cheddar.quantity), unit: cheddar.unit }, item: items.length, recipe: recipes.length, sku_active: sku?.active ?? null };
    const item = items[0], recipe = recipes[0];
    const done = item && item.active === true && recipe && recipe.active === true && recipe.recipe_type === "production" && n(recipe.batch_yield) === 1 && String(recipe.notes ?? "") === recipeNote
      && outputs.length === 1 && outputs[0]!.output_item_id === item.id && n(outputs[0]!.yield) === 1
      && inputs.length === 3 && LEMON_OIL.inputs.every(i => inputs.some(x => x.component_sku_id === i.sku && n(x.quantity) === i.quantity && x.unit === i.unit))
      && cheddar.component_item_id === item.id && cheddar.component_sku_id == null && n(cheddar.quantity) === 0.1 && cheddar.unit === "oz"
      && (sku == null || sku.active === false);
    if (done) { p.status = "already"; return; }
    if (items.length || recipes.length) throw new Error("A partial Lemon Oil item/recipe exists; reconcile before retry");
    if (cheddar.component_sku_id !== IDS.lemonOilSku || n(cheddar.quantity) !== 0.1 || cheddar.unit !== "oz") throw new Error("Never Been Cheddar line is not the 0.1 oz placeholder-SKU line this answer replaces");
    if (!sku || sku.active !== true || sku.vendor_id != null) throw new Error("Placeholder Lemon Oil SKU is not the vendor-less active row expected");
    if (otherUses.length) throw new Error(`Placeholder SKU is still used by ${otherUses.length} other recipe line(s)`);
  });
  // ── 4/6. Twins ──────────────────────────────────────────────────────────────────
  for (const spec of TWINS) add("twins", `${spec.name} (${spec.vendor})`, twinNote(spec), { vendor: spec.vendor, item_number: spec.item_number, weekday_par: spec.weekday, weekend_par: spec.weekend, mirrors: spec.sibling }, p => {
    const vendor = vendorByName(t, spec.vendor);
    if (!vendor) { p.status = "absent"; p.reason = `${spec.vendor}: vendor not on this target`; return; }
    const existing = active(t.vendor_items).filter(r => r.name === spec.name && r.vendor_id === vendor.id);
    const siblings = spec.sibling ? active(t.vendor_items).filter(r => r.name === spec.sibling && r.vendor_id !== vendor.id) : [];
    if (spec.sibling && !siblings.length) { p.status = "absent"; p.reason = `sibling "${spec.sibling}" not on this target`; return; }
    if (siblings.length > 1) throw new Error(`sibling "${spec.sibling}" is ambiguous (${siblings.length} rows)`);
    p.expected = { vendor, existing, sibling: siblings[0] ?? null };
    p.before = existing.length ? { item_number: existing[0]!.item_number, weekday_par: n(existing[0]!.weekday_par), weekend_par: n(existing[0]!.weekend_par) } : null;
    if (existing.length > 1) throw new Error("More than one active row under this vendor");
    if (existing.length === 1) {
      const e = existing[0]!;
      if ((e.item_number ?? null) === spec.item_number && n(e.weekday_par) === spec.weekday && n(e.weekend_par) === spec.weekend && String(e.notes ?? "").includes(SOURCE)) { p.status = "already"; return; }
      throw new Error("A row under this vendor already exists with different values; edit it in the app");
    }
  });
  // ── 7. Pars ─────────────────────────────────────────────────────────────────────
  for (const spec of PARS) add("pars", spec.name, `Juan's order guide 2026-09-13 (${GUIDE}): "${spec.sheet}"${spec.note ? `; ${spec.note}` : ""}. ${JUAN}: "The sheet is current."`, { weekday_par: spec.weekday, weekend_par: spec.weekend ?? "(unchanged)" }, p => {
    const vendor = vendorByName(t, spec.vendor);
    const rows = vendor ? active(t.vendor_items).filter(r => r.name === spec.name && r.vendor_id === vendor.id) : [];
    if (!vendor || !rows.length) { p.status = "absent"; p.reason = `${spec.name} (${spec.vendor}): not on this target`; return; }
    const sku = one(rows, spec.name);
    p.expected = { sku };
    p.before = { weekday_par: n(sku.weekday_par), weekend_par: n(sku.weekend_par) };
    const target = { weekday_par: spec.weekday, weekend_par: spec.weekend ?? n(sku.weekend_par) };
    if (equal(p.before, target)) { p.status = "already"; return; }
  });
  // ── 5. Leonard rhythm ───────────────────────────────────────────────────────────
  add("rhythm", LEONARD_RHYTHM.vendor, `Juan's order guide 2026-09-13: "${LEONARD_RHYTHM.sheet}". ASSUMPTION: ${LEONARD_RHYTHM.assumption}`, { pairs: LEONARD_RHYTHM.pairs, cutoffs: LEONARD_RHYTHM.pairs.map(x => ({ order_day: x.order_dow, cutoff_time: LEONARD_RHYTHM.cutoff })) }, p => {
    const vendor = vendorByName(t, LEONARD_RHYTHM.vendor);
    if (!vendor) { p.status = "absent"; p.reason = "Leonard Paper: vendor not on this target"; return; }
    const locations = active(t.locations).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (!locations.length) throw new Error("No active locations");
    const pairs = active(t.vendor_delivery_rhythm).filter(r => r.vendor_id === vendor.id), cutoffs = active(t.vendor_cutoffs).filter(r => r.vendor_id === vendor.id);
    p.expected = { vendor, locations, pairs, cutoffs };
    p.before = { pairs: pairs.map(r => ({ location_id: r.location_id, order_dow: n(r.order_dow), lead_days: n(r.lead_days) })).sort((a, b) => canonical(a).localeCompare(canonical(b))), cutoffs: cutoffs.map(r => ({ location_id: r.location_id, order_day: n(r.order_day), cutoff_time: r.cutoff_time })).sort((a, b) => canonical(a).localeCompare(canonical(b))) };
    const wantPairs = locations.flatMap(l => LEONARD_RHYTHM.pairs.map(x => ({ location_id: l.id, ...x }))).sort((a, b) => canonical(a).localeCompare(canonical(b)));
    const wantCutoffs = LEONARD_RHYTHM.pairs.map(x => ({ location_id: null, order_day: x.order_dow, cutoff_time: LEONARD_RHYTHM.cutoff })).sort((a, b) => canonical(a).localeCompare(canonical(b)));
    if (equal((p.before as { pairs: unknown }).pairs, wantPairs) && equal((p.before as { cutoffs: unknown }).cutoffs, wantCutoffs)) { p.status = "already"; return; }
  });
  return result;
}

export function validateArgs(args: string[], env: Record<string, string | undefined> = process.env) {
  if (args.filter(a => a === "--dry-run").length > 1 || (args.includes("--dry-run") && args.includes("--execute"))) throw new Error("Conflicting/duplicate dry-run option");
  if (args.some(a => ["--wave7", "--readiness", "--as-of"].includes(a))) throw new Error("Unsupported seed-35 option");
  return validateTarget(args.filter(a => a !== "--dry-run"), env);
}
async function readTables(sb: SupabaseClient): Promise<Tables> {
  const names: (keyof Tables)[] = ["vendor_items", "vendors", "locations", "items", "recipes", "recipe_inputs", "recipe_outputs", "vendor_delivery_rhythm", "vendor_cutoffs"];
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await loadAll(sb, name)]))) as Tables;
}
async function update(sb: SupabaseClient, table: string, before: RawRow, values: RawRow): Promise<void> {
  let q = sb.from(table).update(values, { count: "exact" }).eq("id", before.id);
  for (const [key, value] of Object.entries(before)) {
    if (key === "id" || typeof value === "object" && value !== null) continue;
    q = value == null ? q.is(key, null) : q.eq(key, value);
  }
  const { error, count } = await q;
  if (error || count !== 1) throw new Error(`${table}: guarded UPDATE failed or matched ${count ?? "unknown"} rows`);
}
async function insert(sb: SupabaseClient, table: string, row: RawRow): Promise<void> {
  const { error } = await sb.from(table).insert(row);
  if (error) throw new Error(`${table}: INSERT failed (${error.code ?? "unknown"} ${error.message}); stop and reconcile partial operation`);
}
async function record(sb: SupabaseClient, action: AuditAction, table: string, id: string, p: Plan, extra: RawRow = {}): Promise<void> {
  const { audit } = await import("@/lib/audit");
  const operation = randomUUID();
  await audit({ actorId: null, actorRole: null, action, resourceTable: table, resourceId: id, metadata: { source: SOURCE, operation, source_note: p.source, before: p.before, after: p.after, ...extra }, ipAddress: null, userAgent: null });
  const { data, error } = await sb.from("audit_log").select("id").eq("action", action).eq("resource_id", id).contains("metadata", { source: SOURCE, operation });
  if (error || data?.length !== 1) throw new Error(`${table}: audit readback failed; stop and reconcile (audit helper is fail-open)`);
}
const SKU_COPY = ["category", "unit", "unit_size", "source_url", "lead_time_days", "pack_format", "units_per_pack", "each_size", "each_measure", "avg_oz_per_each", "each_container_label", "inventory_only", "sku_class", "weight_class", "weight_source_note", "weight_established_at", "weight_established_by", "cushion_class", "par_step"] as const;
async function apply(sb: SupabaseClient, p: Plan): Promise<void> {
  const now = new Date().toISOString();
  if (p.section === "recipes" && p.name.startsWith("Farmers")) {
    const input = p.expected.input as RawRow;
    await update(sb, "recipe_inputs", input, { component_item_id: IDS.salsaVerdeItem });
    await record(sb, "recipe_input.update", "recipe_inputs", String(input.id), p, { recipe_id: input.recipe_id, from_item_id: IDS.greenGoddessItem, to_item_id: IDS.salsaVerdeItem });
  } else if (p.section === "recipes") {
    const cheddar = p.expected.cheddar as RawRow, sku = p.expected.sku as RawRow;
    const itemId = randomUUID();
    await insert(sb, "items", { id: itemId, ...LEMON_OIL.item, location_id: null, is_default: true, active: true, tracking_type: "portioned", batch_yield: 1, required: false, opening_verify: false, sold_directly: false, catering_available: false, catering_only: false, item_type: "prepped", notes: recipeNote, created_by: null, updated_by: null });
    await record(sb, "item.create", "items", itemId, p, { name: LEMON_OIL.item.name, section: LEMON_OIL.item.section, creation_method: "seed_script" });
    const recipeId = randomUUID();
    const recipe = { id: recipeId, name: LEMON_OIL.recipe.name, recipe_type: "production", batch_yield: 1, active: false, created_by: null, directions: LEMON_OIL.recipe.directions, notes: recipeNote };
    await insert(sb, "recipes", recipe);
    await record(sb, "recipe.create", "recipes", recipeId, p, { staged_inactive: true, output_item_id: itemId });
    for (const [i, x] of LEMON_OIL.inputs.entries()) await insert(sb, "recipe_inputs", { recipe_id: recipeId, component_sku_id: x.sku, component_item_id: null, component_product_id: null, quantity: x.quantity, unit: x.unit, portioned: false, display_order: i, created_by: null });
    await insert(sb, "recipe_outputs", { recipe_id: recipeId, output_item_id: itemId, output_menu_item_id: null, yield: 1, output_container_label: LEMON_OIL.recipe.container, display_order: 0, created_by: null });
    await update(sb, "recipes", recipe, { active: true, updated_at: now, updated_by: null });
    await record(sb, "recipe.update", "recipes", recipeId, p, { activated: true });
    await update(sb, "recipe_inputs", cheddar, { component_sku_id: null, component_item_id: itemId });
    await record(sb, "recipe_input.update", "recipe_inputs", String(cheddar.id), p, { recipe_id: cheddar.recipe_id, from_sku_id: IDS.lemonOilSku, to_item_id: itemId });
    await update(sb, "vendor_items", sku, { active: false, updated_at: now, updated_by: null });
    await record(sb, "vendor_item.deactivate", "vendor_items", String(sku.id), p, { name: "Lemon Oil", reason: "in_house", replaced_by_item_id: itemId });
  } else if (p.section === "twins") {
    const spec = TWINS.find(s => `${s.name} (${s.vendor})` === p.name)!, vendor = p.expected.vendor as RawRow, sibling = p.expected.sibling as RawRow | null;
    const id = randomUUID();
    const copied: RawRow = sibling ? Object.fromEntries(SKU_COPY.map(k => [k, sibling[k] ?? null])) : { inventory_only: true, sku_class: "packaging" };
    await insert(sb, "vendor_items", { id, ...copied, name: spec.name, vendor_id: vendor.id, location_id: null, active: true, item_number: spec.item_number, weekday_par: spec.weekday, weekend_par: spec.weekend, notes: twinNote(spec), product_id: null, created_by: null, updated_by: null });
    await record(sb, "vendor_item.create", "vendor_items", id, p, { name: spec.name, vendor: spec.vendor, twin_of: sibling?.id ?? null, creation_method: "seed_script" });
  } else if (p.section === "pars") {
    const spec = PARS.find(s => s.name === p.name)!, sku = p.expected.sku as RawRow;
    await update(sb, "vendor_items", sku, { weekday_par: spec.weekday, ...(spec.weekend == null ? {} : { weekend_par: spec.weekend }), updated_at: now, updated_by: null });
    await record(sb, "vendor_item.update", "vendor_items", String(sku.id), p, { fields: spec.weekend == null ? ["weekday_par"] : ["weekday_par", "weekend_par"] });
  } else {
    const vendor = p.expected.vendor as RawRow, locations = p.expected.locations as RawRow[], pairs = p.expected.pairs as RawRow[], cutoffs = p.expected.cutoffs as RawRow[];
    for (const r of pairs) { await update(sb, "vendor_delivery_rhythm", r, { active: false }); await record(sb, "vendor.full_profile_edit", "vendor_delivery_rhythm", String(r.id), p, { scope: "delivery_rhythm", op: "deactivate", vendor_id: vendor.id, location_id: r.location_id, order_dow: r.order_dow }); }
    for (const r of cutoffs) { await update(sb, "vendor_cutoffs", r, { active: false }); await record(sb, "vendor.cutoff_change", "vendor_cutoffs", String(r.id), p, { op: "deactivate", vendor_id: vendor.id, location_id: r.location_id, order_day: r.order_day }); }
    for (const loc of locations) for (const x of LEONARD_RHYTHM.pairs) {
      const id = randomUUID();
      await insert(sb, "vendor_delivery_rhythm", { id, vendor_id: vendor.id, location_id: loc.id, order_dow: x.order_dow, lead_days: x.lead_days, active: true, created_by: null });
      await record(sb, "vendor.full_profile_edit", "vendor_delivery_rhythm", id, p, { scope: "delivery_rhythm", op: "set", vendor_id: vendor.id, location_id: loc.id, order_dow: x.order_dow, lead_days: x.lead_days, superseded: 0 });
    }
    for (const x of LEONARD_RHYTHM.pairs) {
      const id = randomUUID();
      await insert(sb, "vendor_cutoffs", { id, vendor_id: vendor.id, location_id: null, order_day: x.order_dow, cutoff_time: LEONARD_RHYTHM.cutoff, active: true });
      await record(sb, "vendor.cutoff_change", "vendor_cutoffs", id, p, { op: "add", vendor_id: vendor.id, location_id: null, order_day: x.order_dow, cutoff_time: LEONARD_RHYTHM.cutoff });
    }
  }
}
async function verifyAudits(sb: SupabaseClient, p: Plan): Promise<void> {
  const checks: [AuditAction, unknown][] = p.section === "recipes" && p.name.startsWith("Farmers") ? [["recipe_input.update", (p.expected.input as RawRow).id]]
    : p.section === "recipes" ? [["item.create", (p.expected.items as RawRow[])[0]!.id], ["recipe.create", (p.expected.recipes as RawRow[])[0]!.id], ["recipe_input.update", (p.expected.cheddar as RawRow).id]]
    : p.section === "twins" ? [["vendor_item.create", (p.expected.existing as RawRow[])[0]!.id]]
    : p.section === "pars" ? [["vendor_item.update", (p.expected.sku as RawRow).id]]
    : [...(p.expected.pairs as RawRow[]).map(r => ["vendor.full_profile_edit", r.id] as [AuditAction, unknown]), ...(p.expected.cutoffs as RawRow[]).map(r => ["vendor.cutoff_change", r.id] as [AuditAction, unknown])];
  for (const [action, id] of checks) {
    const { data, error } = await sb.from("audit_log").select("id").eq("action", action).eq("resource_id", id).contains("metadata", { source: SOURCE, source_note: p.source }).limit(1);
    if (error || !data?.length) throw new Error(`${p.name}: missing matching ${action} provenance audit; reconcile before retry`);
  }
}
/** Normalize only this operation's permitted writes; every other field stays equal. */
export function verifyWriteScope(before: Tables, after: Tables, p: Plan): void {
  const farmers = p.section === "recipes" && p.name.startsWith("Farmers"), lemon = p.section === "recipes" && !farmers;
  const skuId = p.section === "pars" ? (p.expected.sku as RawRow).id : null;
  const vendorId = p.section === "rhythm" || p.section === "twins" ? (p.expected.vendor as RawRow).id : null;
  const twinName = p.section === "twins" ? TWINS.find(s => `${s.name} (${s.vendor})` === p.name)!.name : null;
  for (const table of Object.keys(before) as (keyof Tables)[]) {
    const allowed = (r: RawRow): string[] => {
      if (farmers && table === "recipe_inputs" && r.id === IDS.farmersInput) return ["component_item_id"];
      if (lemon && table === "recipe_inputs" && r.id === IDS.cheddarInput) return ["component_sku_id", "component_item_id"];
      if (lemon && table === "vendor_items" && r.id === IDS.lemonOilSku) return ["active", "updated_at", "updated_by"];
      if (p.section === "pars" && table === "vendor_items" && r.id === skuId) return ["weekday_par", "weekend_par", "updated_at", "updated_by"];
      if (p.section === "rhythm" && (table === "vendor_delivery_rhythm" || table === "vendor_cutoffs") && r.vendor_id === vendorId) return ["active"];
      return [];
    };
    const addedAllowed = (r: RawRow) => lemon ? (table === "items" && r.name === LEMON_OIL.item.name) || (table === "recipes" && r.name === LEMON_OIL.recipe.name) || ((table === "recipe_inputs" || table === "recipe_outputs") && after.recipes.some(x => x.id === r.recipe_id && x.name === LEMON_OIL.recipe.name && !before.recipes.some(b => b.id === x.id)))
      : p.section === "twins" ? table === "vendor_items" && r.vendor_id === vendorId && r.name === twinName
      : p.section === "rhythm" ? (table === "vendor_delivery_rhythm" || table === "vendor_cutoffs") && r.vendor_id === vendorId : false;
    const oldIds = new Set(before[table].map(r => r.id));
    const normalize = (rows: RawRow[]) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([key]) => !allowed(r).includes(key)))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const existingAfter = after[table].filter(r => oldIds.has(r.id) || !addedAllowed(r));
    if (!equal(normalize(before[table]), normalize(existingAfter))) throw new Error(`${p.name}: unrelated/concurrent ${table} change; stop for a fresh reviewed dry-run`);
  }
}
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const config = validateArgs(args), sb = createWave7Client(config);
  let expectedTables = await readTables(sb);
  const plans = planFloorAnswers(expectedTables);
  const digest = createHash("sha256").update(canonical({ project: config.projectRef, source: SOURCE, plans })).digest("hex");
  console.log(`${SOURCE}: ${config.execute ? "EXECUTE" : "DRY RUN"}, target ${config.target}`);
  for (const section of ["recipes", "twins", "pars", "rhythm"] as const) {
    console.log(`\n${section}`);
    console.table(plans.filter(p => p.section === section).map(p => ({ row: p.name, before: JSON.stringify(p.before), after: JSON.stringify(p.after), status: p.status, refusal: p.reason ?? "" })));
  }
  console.log(`NOT WRITTEN (sheet unit cannot be mapped onto the SKU's pack): ${UNMAPPED.join(" · ")}`);
  console.log(`Plan digest: ${digest}`);
  if (!config.execute) { console.log("No writes. Execute with the same --target and --execute --plan-digest shown above."); return; }
  if (plans.every(p => p.status === "already" || p.status === "absent")) {
    // A par that already matched the sheet before this seed ever ran carries no seed-35 audit; only rows this seed
    // itself wrote (recipes, twins, rhythm — all stamped with SOURCE) are held to the provenance check here.
    for (const p of plans) { if (p.status === "absent") { console.log(`absent (skipped): ${p.name}`); continue; } if (p.section !== "pars") await verifyAudits(sb, p); console.log(`already: ${p.name}`); }
    return;
  }
  if (config.planDigest !== digest) throw new Error("Plan changed; review a fresh dry-run");
  if (plans.some(p => p.status === "refused")) throw new Error("Refused before-state(s); no writes. Resolve ledger before execute.");
  for (const p of plans) {
    const tables = await readTables(sb);
    if (!equal(tables, expectedTables)) throw new Error("Database changed after reviewed snapshot; no further writes");
    const current = planFloorAnswers(tables).find(r => r.section === p.section && r.name === p.name)!;
    if (current.status === "absent") { console.log(`absent (skipped): ${p.name}`); continue; }
    if (current.status === "already") { if (p.status !== "already") await verifyAudits(sb, current); console.log(`already: ${p.name}`); continue; }
    if (current.status !== "ready") throw new Error(`${p.name}: before-state changed during execution`);
    await apply(sb, current);
    const afterTables = await readTables(sb);
    verifyWriteScope(tables, afterTables, current);
    const verified = planFloorAnswers(afterTables).find(r => r.section === p.section && r.name === p.name)!;
    if (verified.status !== "already") throw new Error(`${p.name}: destination verification failed (${verified.status}: ${verified.reason ?? ""}); reconcile partial operation`);
    await verifyAudits(sb, verified);
    expectedTables = afterTables;
    console.log(`verified: ${p.name}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e instanceof Error ? e.message : "Seed 35 failed"); process.exitCode = 1; });
}
