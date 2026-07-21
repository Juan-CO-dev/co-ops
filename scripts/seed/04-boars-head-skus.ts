/**
 * Operational Seed — Stage 4-BH: Boar's Head SKUs (deli / pepper / beverage).
 *
 * Seeds the BH purchasing catalog from docs/seed/source/boars-head-order-guide-vA.md
 * (Version A = accurate) as GLOBAL Boar's-Head-vendor vendor_items. This is the FIRST
 * source with DUAL pars → sets both weekday_par AND weekend_par. Pack model from the
 * "N/cs" notation (units_per_pack + pack_format Case); each_size/cost → Stage 4 (from
 * the "BH" rows in inventory-costing.csv).
 *
 * Reconciliation (Juan-locked):
 *   - FILLS the Stage-3 recipe placeholders IN PLACE where a BH item matches: "Ever
 *     Roast Chicken" (exact) + BH "Pickle slices" → the "Pickle Chips" placeholder
 *     (so the recipe_input wiring is preserved and the empty placeholder becomes real).
 *   - DEACTIVATES the Stage-2 Baldor deli/pepper STAND-IN placeholders now superseded
 *     by a same-name real BH SKU (Turkey, Pepperoni, Capicola, Provolone, Roast Beef,
 *     Banana/Hot/Sweet Peppers). Reported; append-only-reversible.
 *
 * Idempotent. Run: npx tsx --env-file=.env.local scripts/seed/04-boars-head-skus.ts
 * SEED_DRY=1 → report only.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";

interface BHItem {
  name: string;
  unitsPerCase?: number;          // from "N/cs"
  weekdayPar: number | null;
  weekendPar: number | null;
  parWk: string;                  // verbatim
  parWknd: string;                // verbatim
  fillsPlaceholder?: string;      // existing placeholder SKU name to fill in place
}

const BH: BHItem[] = [
  // Deli / meats / cheese
  { name: "Turkey", unitsPerCase: 2, weekdayPar: 9, weekendPar: 22, parWk: "9 (not prepped)", parWknd: "22 (not prepped)" },
  { name: "Bacon", weekdayPar: 1, weekendPar: 1, parWk: "1 Layer", parWknd: "1 box" },
  { name: "Genoa", unitsPerCase: 6, weekdayPar: 5, weekendPar: 8, parWk: "5 Logs", parWknd: "8 logs" },
  { name: "Prosciutto", weekdayPar: 4, weekendPar: 6, parWk: "4 pk", parWknd: "6 pk" },
  { name: "Pepperoni", unitsPerCase: 3, weekdayPar: 3, weekendPar: 5, parWk: "3 ea", parWknd: "5 ea" },
  { name: "Capicola", unitsPerCase: 5, weekdayPar: 8, weekendPar: 16, parWk: "8 pcs", parWknd: "16 pcs" },
  { name: "Provolone", unitsPerCase: 6, weekdayPar: 8, weekendPar: 16, parWk: "8 pcs", parWknd: "16 pcs" },
  { name: "Roast Beef", unitsPerCase: 2, weekdayPar: 2, weekendPar: 4, parWk: "2 ea", parWknd: "4 ea" },
  { name: "Ever Roast Chicken", weekdayPar: 2, weekendPar: 2, parWk: "2 ea", parWknd: "2 ea", fillsPlaceholder: "Ever Roast Chicken" },
  // Pickles / peppers
  { name: "Pickle slices", weekdayPar: 1.5, weekendPar: 3, parWk: "1.5 buckets", parWknd: "3 buckets", fillsPlaceholder: "Pickle Chips" },
  { name: "Whole pickles", weekdayPar: 0.5, weekendPar: null, parWk: "1/2 bucket", parWknd: "whole bucket unopened" },
  { name: "Banana Peppers", unitsPerCase: 4, weekdayPar: 1, weekendPar: null, parWk: "1 gallon", parWknd: "—" },
  { name: "Hot Peppers", unitsPerCase: 4, weekdayPar: 6, weekendPar: 8, parWk: "6 gallons", parWknd: "8 gallons" },
  { name: "Sweet Peppers", unitsPerCase: 4, weekdayPar: 6, weekendPar: 8, parWk: "6 gallons", parWknd: "8 gallons" },
  // Beverage (Dr. Brown's / branded)
  { name: "DB Root Beer", weekdayPar: 1, weekendPar: 2, parWk: "1 backup pallet", parWknd: "2 backup pallets" },
  { name: "DB Cherry Soda", weekdayPar: 1, weekendPar: 2, parWk: "1 backup pallet", parWknd: "2 backup pallets" },
  { name: "DB Cream Soda", weekdayPar: 1, weekendPar: 2, parWk: "1 backup pallet", parWknd: "2 backup pallets" },
  { name: "DB Cel Ray", weekdayPar: 1, weekendPar: null, parWk: "1 backup pallet", parWknd: "—" },
  { name: "DB Diet Cherry Soda", weekdayPar: 1, weekendPar: 2, parWk: "1 backup pallet", parWknd: "2 backup pallets" },
  { name: "DB Diet Cream Soda", weekdayPar: 1, weekendPar: 2, parWk: "1 backup pallet", parWknd: "2 backup pallets" },
  { name: "Branded (C/O) Water", weekdayPar: 2, weekendPar: 4, parWk: "2 cases", parWknd: "4 cases" },
  { name: "Diet Coke", weekdayPar: 36, weekendPar: 72, parWk: "36 cans", parWknd: "72 cans" },
  { name: "Coke", weekdayPar: 36, weekendPar: 72, parWk: "36 cans", parWknd: "72 cans" },
];

// Stage-2 Baldor deli/pepper stand-in placeholders now superseded by a same-name BH SKU.
const BALDOR_STANDINS_TO_DEACTIVATE = ["Turkey", "Pepperoni", "Capicola", "Provolone", "Roast Beef", "Banana Peppers", "Hot Peppers", "Sweet Peppers"];

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");

  const { data: vends } = await sb.from("vendors").select("id, name").in("name", ["Boar's Head", "Baldor"]).returns<Array<{ id: string; name: string }>>();
  const bhId = (vends ?? []).find((v) => v.name === "Boar's Head")?.id;
  const baldorId = (vends ?? []).find((v) => v.name === "Baldor")?.id;
  if (!bhId) throw new Error("Boar's Head vendor not found (run Stage 1 first)");

  let created = 0, updated = 0, filled = 0, unchanged = 0, deactivated = 0;

  for (const it of BH) {
    const notes = `Par (BH guide vA): weekday ${it.parWk} / weekend ${it.parWknd}. [seed BH]`;
    const desired = {
      vendor_id: bhId, location_id: null as string | null, name: it.name,
      pack_format: it.unitsPerCase ? "Case" : null, units_per_pack: it.unitsPerCase ?? null,
      weekday_par: it.weekdayPar, weekend_par: it.weekendPar, notes, active: true, inventory_only: false,
    };

    // If this BH item fills a Stage-3 recipe placeholder, update THAT row in place.
    if (it.fillsPlaceholder) {
      const { data: ph } = await sb.from("vendor_items").select("id, vendor_id, notes").eq("name", it.fillsPlaceholder).is("location_id", null).eq("active", true)
        .like("notes", "%placeholder ingredient SKU%").maybeSingle<{ id: string; vendor_id: string | null; notes: string | null }>();
      if (ph) {
        filled++;
        if (!DRY) {
          const { error } = await sb.from("vendor_items").update({ ...desired, updated_at: new Date().toISOString(), updated_by: null }).eq("id", ph.id);
          if (error) throw new Error(`fill placeholder ${it.fillsPlaceholder}: ${error.message}`);
          void audit({ actorId: null, actorRole: null, action: "vendor_item.update", resourceTable: "vendor_items", resourceId: ph.id, metadata: { name: it.name, filled_placeholder: it.fillsPlaceholder, vendor: "Boar's Head", sync_method: "seed_script", phase: "operational_seed_bh" }, ipAddress: null, userAgent: null });
        }
        continue;
      }
      // placeholder already filled/absent → fall through to normal BH upsert
    }

    // Idempotent upsert by (name, BH vendor, global).
    const { data: ex } = await sb.from("vendor_items").select("id, weekday_par, weekend_par, units_per_pack, pack_format, notes")
      .eq("name", it.name).eq("vendor_id", bhId).is("location_id", null)
      .maybeSingle<{ id: string; weekday_par: number | null; weekend_par: number | null; units_per_pack: number | null; pack_format: string | null; notes: string | null }>();
    if (!ex) {
      created++;
      if (!DRY) {
        const { data: ins, error } = await sb.from("vendor_items").insert({ ...desired, created_by: null, updated_by: null }).select("id").single<{ id: string }>();
        if (error) throw new Error(`insert BH SKU ${it.name}: ${error.message}`);
        void audit({ actorId: null, actorRole: null, action: "vendor_item.create", resourceTable: "vendor_items", resourceId: ins.id, metadata: { name: it.name, vendor: "Boar's Head", location_id: null, creation_method: "seed_script", phase: "operational_seed_bh" }, ipAddress: null, userAgent: null });
      }
    } else {
      const changed = Number(ex.weekday_par) !== Number(it.weekdayPar) || Number(ex.weekend_par) !== Number(it.weekendPar) ||
        ex.units_per_pack !== (it.unitsPerCase ?? null) || ex.pack_format !== desired.pack_format || ex.notes !== notes;
      if (changed) {
        updated++;
        if (!DRY) {
          const { error } = await sb.from("vendor_items").update({ ...desired, updated_at: new Date().toISOString(), updated_by: null }).eq("id", ex.id);
          if (error) throw new Error(`update BH SKU ${it.name}: ${error.message}`);
        }
      } else unchanged++;
    }
  }

  // Deactivate superseded Baldor deli/pepper stand-in placeholders.
  const deactivatedNames: string[] = [];
  if (baldorId) {
    for (const name of BALDOR_STANDINS_TO_DEACTIVATE) {
      const { data: rows } = await sb.from("vendor_items").select("id").eq("name", name).eq("vendor_id", baldorId).is("location_id", null).eq("active", true).returns<Array<{ id: string }>>();
      for (const row of rows ?? []) {
        deactivated++; deactivatedNames.push(name);
        if (!DRY) {
          const { error } = await sb.from("vendor_items").update({ active: false, updated_at: new Date().toISOString(), updated_by: null }).eq("id", row.id);
          if (error) throw new Error(`deactivate Baldor stand-in ${name}: ${error.message}`);
          void audit({ actorId: null, actorRole: null, action: "vendor_item.deactivate", resourceTable: "vendor_items", resourceId: row.id, metadata: { name, reason: "superseded_by_boars_head_sku", phase: "operational_seed_bh" }, ipAddress: null, userAgent: null });
        }
      }
    }
  }

  console.log(`\nBoar's Head SKUs: ${created} created, ${updated} updated, ${filled} placeholder(s) filled in place, ${unchanged} unchanged.`);
  console.log(`Baldor stand-in placeholders deactivated (superseded): ${deactivated}${deactivatedNames.length ? " — " + deactivatedNames.join(", ") : ""}.`);

  if (!DRY) {
    const names = BH.map((b) => b.name);
    const { count: bhActive } = await sb.from("vendor_items").select("id", { count: "exact", head: true }).eq("vendor_id", bhId).is("location_id", null).eq("active", true);
    const { count: withWknd } = await sb.from("vendor_items").select("id", { count: "exact", head: true }).eq("vendor_id", bhId).is("location_id", null).not("weekend_par", "is", null);
    const { count: phLeft } = await sb.from("vendor_items").select("id", { count: "exact", head: true }).in("name", ["Pickle Chips", "Ever Roast Chicken"]).like("notes", "%placeholder ingredient SKU%");
    console.log(`\nVerify: ${bhActive} active BH global SKUs (${names.length} in guide); ${withWknd} carry a weekend_par; recipe placeholders still empty: ${phLeft} (expect 0).`);
  }
  console.log("BH SKU seed done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
