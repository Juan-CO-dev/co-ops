/**
 * Operational Seed — Stage 8 (catering sub-project A): item_sizes + catering-only bundles.
 *
 * Two writes:
 *  (1) SIZES → for the four catering side items (Tuna/Egg Salad, Antipasto Pasta, Onion Dip),
 *      insert explicit-price catering `item_sizes` (½-pint/pint/6oz small + 32oz large). The small
 *      size equals the item's existing menu_price (so the catering "from" price is unchanged);
 *      the 32oz is the catering upsell. buildCateringMenuItem derives each size's catering price
 *      (size.price_cents × rate) and prices the item "from" its smallest size.
 *  (2) BUNDLES → catering-only `menu_items` (larger platters/cases) that only appear on the
 *      catering menu (catering_only=true, catering_available=true, no build).
 *
 * Resolves items by name (global active). Idempotent (upsert by (item_id,label) for sizes, by
 * name for bundles). SEED_DRY=1 → report only, no writes. Reports items not found (never fabricates).
 *
 * NOTE: "Quart of Pickle Spears" is intentionally NOT here — 06c already created
 * "Quart of Pickle Spears (12pcs)" $9 (catering_available) and it already surfaces on the menu.
 *
 * Run: SEED_DRY=1 npx tsx --conditions=react-server --env-file=.env.local scripts/seed/08-catering-sizes.ts   (dry)
 *      npx tsx --conditions=react-server --env-file=.env.local scripts/seed/08-catering-sizes.ts               (prod)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";

// (1) Catering sizes per side item. [label, price_cents, serves]. Small first (display_order 0).
const SIZES: Record<string, Array<[string, number, number]>> = {
  "Tuna Salad": [["½ pint", 425, 1], ["32 oz", 1800, 4]],
  "Egg Salad": [["½ pint", 425, 1], ["32 oz", 1600, 4]],
  "Antipasto Pasta": [["pint", 600, 1], ["32 oz", 1600, 4]],
  "Onion Dip": [["6 oz", 500, 1], ["32 oz", 2000, 4]],
};

// (2) Catering-only bundle menu_items (no build). [name, price_dollars, section]
const BUNDLES: Array<[string, number, string]> = [
  ["House Greek Salad", 12, "Catering Sides"],
  ["Caesar Salad", 12, "Catering Sides"],
  ["Case of Mini Chips (24)", 20, "Catering Sides"],
  ["Case of Assorted Chips (24)", 52, "Catering Sides"],
  ["Dozen Waters", 12, "Catering Drinks"],
  ["24 Mixed Sodas", 48, "Catering Drinks"],
];

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");

  // (1) item_sizes for the four side items.
  let sizesCreated = 0, sizesUpdated = 0, sizesUnchanged = 0;
  const missingItems: string[] = [];
  for (const [itemName, sizes] of Object.entries(SIZES)) {
    const { data: it } = await sb.from("items").select("id")
      .eq("name", itemName).is("location_id", null).eq("active", true)
      .maybeSingle<{ id: string }>();
    if (!it) { missingItems.push(itemName); continue; }
    for (let idx = 0; idx < sizes.length; idx++) {
      const [label, priceCents, serves] = sizes[idx]!;
      const { data: ex } = await sb.from("item_sizes").select("id, price_cents, serves, display_order")
        .eq("item_id", it.id).eq("label", label)
        .maybeSingle<{ id: string; price_cents: number; serves: number | string | null; display_order: number }>();
      if (!ex) {
        sizesCreated++;
        if (!DRY) {
          const { data: ins, error } = await sb.from("item_sizes")
            .insert({ item_id: it.id, label, price_cents: priceCents, serves, display_order: idx, active: true, created_by: null })
            .select("id").single<{ id: string }>();
          if (error) throw new Error(`insert size ${itemName}/${label}: ${error.message}`);
          void audit({ actorId: null, actorRole: null, action: "item_size.create", resourceTable: "item_sizes", resourceId: ins.id, metadata: { item_name: itemName, label, price_cents: priceCents, serves, creation_method: "seed_script", phase: "catering_sizes_a" }, ipAddress: null, userAgent: null });
        }
      } else {
        const changed = Number(ex.price_cents) !== priceCents || (ex.serves == null ? null : Number(ex.serves)) !== serves || ex.display_order !== idx;
        if (changed) {
          sizesUpdated++;
          if (!DRY) { const { error } = await sb.from("item_sizes").update({ price_cents: priceCents, serves, display_order: idx, updated_at: new Date().toISOString(), updated_by: null }).eq("id", ex.id); if (error) throw new Error(`update size ${itemName}/${label}: ${error.message}`); }
        } else sizesUnchanged++;
      }
    }
  }

  // (2) catering-only bundle menu_items.
  let created = 0, updated = 0, unchanged = 0;
  for (const [name, price, section] of BUNDLES) {
    const { data: ex } = await sb.from("menu_items").select("id, menu_price, section, catering_available, catering_only")
      .eq("name", name).maybeSingle<{ id: string; menu_price: number | null; section: string | null; catering_available: boolean; catering_only: boolean }>();
    if (!ex) {
      created++;
      if (!DRY) {
        const { data: ins, error } = await sb.from("menu_items").insert({ name, section, menu_price: price, active: true, catering_available: true, catering_portionable: false, catering_only: true, created_by: null }).select("id").single<{ id: string }>();
        if (error) throw new Error(`insert bundle ${name}: ${error.message}`);
        void audit({ actorId: null, actorRole: null, action: "menu_item.create", resourceTable: "menu_items", resourceId: ins.id, metadata: { name, section, menu_price: price, catering_only: true, bundle: true, creation_method: "seed_script", phase: "catering_sizes_a" }, ipAddress: null, userAgent: null });
      }
    } else {
      const changed = Number(ex.menu_price) !== price || ex.section !== section || !ex.catering_available || !ex.catering_only;
      if (changed) {
        updated++;
        if (!DRY) { const { error } = await sb.from("menu_items").update({ menu_price: price, section, catering_available: true, catering_only: true, updated_at: new Date().toISOString(), updated_by: null }).eq("id", ex.id); if (error) throw new Error(`update bundle ${name}: ${error.message}`); }
      } else unchanged++;
    }
  }

  console.log(`\nStage 8: item_sizes ${sizesCreated} created, ${sizesUpdated} updated, ${sizesUnchanged} unchanged | bundles ${created} created, ${updated} updated, ${unchanged} unchanged.`);
  if (missingItems.length) { console.log(`Items NOT found (sizes skipped):`); for (const m of missingItems) console.log(`  - ${m}`); }
  if (!DRY) {
    const { count: sz } = await sb.from("item_sizes").select("id", { count: "exact", head: true }).eq("active", true);
    const { count: bn } = await sb.from("menu_items").select("id", { count: "exact", head: true }).eq("catering_only", true).eq("active", true);
    console.log(`Verify: ${sz} active item_sizes; ${bn} active catering-only menu_items.`);
  }
  console.log("Stage 8 done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
