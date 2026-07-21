/**
 * Operational Seed — Stage 6b-1: sub menu_items.
 *
 * Inserts the SUB menu lines (15 signature + 9 Build-Your-Own) as menu_items with the
 * regular menu_price (from docs/seed/source/toast-menu-regular.md), catering-flagged +
 * portionable (catering sells subs by ¼/½/whole — the W1a pricing basis). Their
 * consumer-recipe BUILDS come in 6b-2 (which resolves against these rows).
 *
 * Idempotent (by name). Run: npx tsx --env-file=.env.local scripts/seed/06b1-menu-subs.ts
 * SEED_DRY=1 → report only.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";

// [name, regular price $, section]  — all catering_available + catering_portionable.
const SUBS: Array<[string, number, string]> = [
  // Signature subs
  ["Crunchy Boi", 15.79, "Subs"],
  ["The Teamster", 16.29, "Subs"],
  ["Marisa Tomei Eats Free", 15.29, "Subs"],
  ["Farmers Market After Dark", 12.09, "Subs"],
  ["Never Been Cheddar", 15.29, "Subs"],
  ["Hot Pants", 15.79, "Subs"],
  ["Turkey Caesar Sub", 16.79, "Subs"],
  ["The Frex", 18.39, "Subs"],
  ["It's a BOI", 15.79, "Subs"],
  ["Vesuvio II", 19.99, "Subs"],
  ["Sicky Wicky Club", 15.79, "Subs"],
  ["Our French Dip", 18.99, "Subs"],
  ["Regular BLT", 10.00, "Subs"],
  ["The chicken cutlet", 19.50, "Subs"],
  ["Chicken parm", 19.99, "Subs"],
  // Build-Your-Own subs
  ["Tuna Salad Sub", 10.49, "Build Your Own"],
  ["Egg Salad Sub", 10.49, "Build Your Own"],
  ["Turkey Sub", 14.19, "Build Your Own"],
  ["Roast Beef Sub", 14.19, "Build Your Own"],
  ["Veggie Sub", 9.49, "Build Your Own"],
  ["Ham Sub", 13.19, "Build Your Own"],
  ["Salami Sub", 13.19, "Build Your Own"],
  ["Pepperoni Sub", 13.19, "Build Your Own"],
  ["Chicken Salad", 16.00, "Build Your Own"],
];

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");

  let created = 0, updated = 0, unchanged = 0;
  for (const [name, price, section] of SUBS) {
    const cents = Math.round(price * 100) / 100; // menu_price is numeric dollars
    const { data: ex } = await sb.from("menu_items").select("id, menu_price, section, catering_available, catering_portionable")
      .eq("name", name).maybeSingle<{ id: string; menu_price: number | null; section: string | null; catering_available: boolean; catering_portionable: boolean }>();
    if (!ex) {
      created++;
      if (!DRY) {
        const { data: ins, error } = await sb.from("menu_items").insert({
          name, section, menu_price: cents, active: true,
          catering_available: true, catering_portionable: true, catering_only: false, created_by: null,
        }).select("id").single<{ id: string }>();
        if (error) throw new Error(`insert menu_item ${name}: ${error.message}`);
        void audit({ actorId: null, actorRole: null, action: "menu_item.create", resourceTable: "menu_items", resourceId: ins.id, metadata: { name, section, menu_price: cents, creation_method: "seed_script", phase: "operational_seed_stage6b" }, ipAddress: null, userAgent: null });
      }
    } else {
      const changed = Number(ex.menu_price) !== cents || ex.section !== section || !ex.catering_available || !ex.catering_portionable;
      if (changed) {
        updated++;
        if (!DRY) {
          const { error } = await sb.from("menu_items").update({ menu_price: cents, section, catering_available: true, catering_portionable: true, updated_at: new Date().toISOString(), updated_by: null }).eq("id", ex.id);
          if (error) throw new Error(`update menu_item ${name}: ${error.message}`);
        }
      } else unchanged++;
    }
  }

  console.log(`\nStage 6b-1 sub menu_items: ${created} created, ${updated} updated, ${unchanged} unchanged (${SUBS.length} subs).`);
  if (!DRY) {
    const { count } = await sb.from("menu_items").select("id", { count: "exact", head: true }).in("name", SUBS.map((s) => s[0]));
    console.log(`Verify: ${count} of ${SUBS.length} sub menu_items present.`);
  }
  console.log("Stage 6b-1 done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
