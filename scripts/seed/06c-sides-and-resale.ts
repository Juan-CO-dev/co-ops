/**
 * Operational Seed — Stage 6c: prepped-item sides + resale menu_items.
 *
 * Two writes, per the Stage-6 modeling rule:
 *  (1) SIDES that ARE wired prep items → flip the existing `items` row to
 *      sold_directly=true + menu_price + sell_portion + catering_available (W1a's
 *      "extras = items whole"). No duplicate menu_item.
 *  (2) RESALE lines (chips, drinks, sweets, gear, + composed/non-item sides) → insert
 *      flat `menu_items` with a price, no build. Drinks/sweets/sides catering_available;
 *      gear off.
 *
 * Prices from docs/seed/source/toast-menu-regular.md. Idempotent. SEED_DRY=1 → report.
 * Run: npx tsx --env-file=.env.local scripts/seed/06c-sides-and-resale.ts
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";

// (1) Sides that are existing prep items → sold_directly. [item name, price, sellPortion, unit]
const SIDE_ITEMS: Array<[string, number, number, string]> = [
  ["Meatballs", 5.50, 3, "each"],        // Side of Meatballs
  ["Egg Salad", 4.25, 8, "oz"],          // Egg Salad- 1/2 pint
  ["Chix Salad", 7.50, 8, "oz"],         // Whole Grain Chicken Salad
  ["Tuna Salad", 4.25, 8, "oz"],         // Tuna Salad 1/2 Pint
  ["Onion Dip", 5.00, 6, "oz"],          // French Onion Dip
  ["Antipasto Pasta", 6.00, 8, "oz"],    // AntiPasto Pasta
];

// (2) Resale / non-item menu lines → menu_items (no build). [name, price, section, cateringAvailable]
const RESALE: Array<[string, number, string, boolean]> = [
  // Chips
  ["Utz Original Chips", 3.25, "Chips", true], ["Utz Salt & Vinegar Chips", 3.25, "Chips", true],
  ["Utz BBQ Chips", 3.25, "Chips", true], ["Utz Sour Cream & Onion", 3.25, "Chips", true],
  ["Salt & Pepper Chips", 3.25, "Chips", true], ["Mini Chips- Utz Original", 0.75, "Chips", true],
  // Drinks
  ["Dr. Browns Root Beer", 2.99, "Drinks", true], ["Dr. Brown's Cream Soda", 2.99, "Drinks", true],
  ["Dr. Browns Diet Cream Soda", 2.99, "Drinks", true], ["Dr. Browns Black Cherry", 2.99, "Drinks", true],
  ["Dr. Browns Diet Black Cherry", 2.99, "Drinks", true], ["Dr. Browns Cel-Ray Soda", 2.99, "Drinks", true],
  ["Coke", 2.79, "Drinks", true], ["Diet Coke", 2.79, "Drinks", true], ["Topo Chico Lime", 3.00, "Drinks", true],
  ["Saratoga", 3.00, "Drinks", true], ["JustIced Tea- Raspberry Tea", 3.25, "Drinks", true],
  ["JustIced Tea - Dragon Green tea", 3.25, "Drinks", true], ["JustIced Tea- Lemon Tea", 3.25, "Drinks", true],
  ["Natalie's Lemonade", 3.41, "Drinks", true], ["Water Bottle", 1.99, "Drinks", true],
  ["Red Bull", 5.00, "Drinks", true], ["Red Bull - Sugar Free", 5.00, "Drinks", true],
  ["Happy Hour Diet Coke", 1.00, "Drinks", true], ["Happy Hour Coke", 1.00, "Drinks", true],
  // Sweets
  ["Whisked Chocolate Chip Cookie", 2.25, "Sweets", true], ["Fruity Pebble Cannolis", 4.00, "Sweets", true],
  ["Berger Cookies - 2 pk", 4.00, "Sweets", true], ["Berger Cookies- Large", 9.99, "Sweets", true],
  // Gear
  ["Compliments Only T-Shirt", 35.00, "Gear", false], ["Little Sticker", 1.00, "Gear", false],
  // Composed / non-item sides (builds deferred; priced menu lines for now)
  ["Deli Pickle", 3.00, "Sides", true], ["Garlic Bread", 12.50, "Sides", true],
  ["Quart of Pickle Spears (12pcs)", 9.00, "Sides", true], ["Bacon Caesar Pasta Salad", 9.00, "Sides", true],
  ["Stuffed Peppers", 16.00, "Sides", true], ["MeatBall Parm", 10.00, "Sides", true],
  ["Roasted Red Peppers", 4.00, "Sides", true],
];

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");

  // (1) Flip prepped-item sides to sold_directly.
  let flipped = 0, sideUnchanged = 0;
  const missingSideItems: string[] = [];
  for (const [name, price, portion, unit] of SIDE_ITEMS) {
    const { data: it } = await sb.from("items").select("id, sold_directly, menu_price, sell_portion, sell_portion_unit, catering_available")
      .eq("name", name).is("location_id", null).eq("active", true)
      .maybeSingle<{ id: string; sold_directly: boolean; menu_price: number | null; sell_portion: number | null; sell_portion_unit: string | null; catering_available: boolean }>();
    if (!it) { missingSideItems.push(name); continue; }
    const changed = !it.sold_directly || Number(it.menu_price) !== price || Number(it.sell_portion) !== portion || it.sell_portion_unit !== unit || !it.catering_available;
    if (!changed) { sideUnchanged++; continue; }
    flipped++;
    if (!DRY) {
      const { error } = await sb.from("items").update({ sold_directly: true, menu_price: price, sell_portion: portion, sell_portion_unit: unit, catering_available: true, updated_at: new Date().toISOString(), updated_by: null }).eq("id", it.id);
      if (error) throw new Error(`flip side ${name}: ${error.message}`);
      void audit({ actorId: null, actorRole: null, action: "item.update", resourceTable: "items", resourceId: it.id, metadata: { name, sold_directly: true, menu_price: price, sell_portion: portion, reason: "catering_side_sold_directly", phase: "operational_seed_stage6c" }, ipAddress: null, userAgent: null });
    }
  }

  // (2) Resale menu_items.
  let created = 0, updated = 0, unchanged = 0;
  for (const [name, price, section, cateringAvail] of RESALE) {
    const { data: ex } = await sb.from("menu_items").select("id, menu_price, section, catering_available")
      .eq("name", name).maybeSingle<{ id: string; menu_price: number | null; section: string | null; catering_available: boolean }>();
    if (!ex) {
      created++;
      if (!DRY) {
        const { data: ins, error } = await sb.from("menu_items").insert({ name, section, menu_price: price, active: true, catering_available: cateringAvail, catering_portionable: false, catering_only: false, created_by: null }).select("id").single<{ id: string }>();
        if (error) throw new Error(`insert menu_item ${name}: ${error.message}`);
        void audit({ actorId: null, actorRole: null, action: "menu_item.create", resourceTable: "menu_items", resourceId: ins.id, metadata: { name, section, menu_price: price, resale: true, creation_method: "seed_script", phase: "operational_seed_stage6c" }, ipAddress: null, userAgent: null });
      }
    } else {
      const changed = Number(ex.menu_price) !== price || ex.section !== section || ex.catering_available !== cateringAvail;
      if (changed) {
        updated++;
        if (!DRY) { const { error } = await sb.from("menu_items").update({ menu_price: price, section, catering_available: cateringAvail, updated_at: new Date().toISOString(), updated_by: null }).eq("id", ex.id); if (error) throw new Error(`update menu_item ${name}: ${error.message}`); }
      } else unchanged++;
    }
  }

  console.log(`\nStage 6c: sides flipped to sold_directly ${flipped} (${sideUnchanged} already) | resale menu_items ${created} created, ${updated} updated, ${unchanged} unchanged.`);
  if (missingSideItems.length) { console.log(`Side items NOT found (skipped):`); for (const m of missingSideItems) console.log(`  - ${m}`); }
  if (!DRY) {
    const { count: sd } = await sb.from("items").select("id", { count: "exact", head: true }).eq("sold_directly", true);
    const { count: mi } = await sb.from("menu_items").select("id", { count: "exact", head: true });
    console.log(`Verify: ${sd} items sold_directly; ${mi} total menu_items.`);
  }
  console.log("Stage 6c done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
