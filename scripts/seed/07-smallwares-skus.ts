/**
 * Operational Seed — Stage 7 fold-in: smallwares / supplies SKUs.
 *
 * Seeds CO's office / cleaning / misc supplies from smallwares-order-guide-2023.csv as
 * GLOBAL inventory_only SKUs (they're ordered + par'd but never ingredients). The few
 * cleaning items already seeded from the Cap Hill guide's Trimark block (Trash Liners,
 * Formula C, Solid Suds, Bleach) are skipped by the idempotent (name, vendor, global)
 * check. The 2 "Food-ish" lines (Frooties, fruity pebbles) are inventory_only=false
 * (fruity pebbles is a Fruity Pebble Cannoli ingredient).
 *
 * (Checklists — the nominal Stage 7 — are already fully seeded from earlier phases;
 * this fold-in is the ordering-completeness leftover Juan asked to include.)
 *
 * Idempotent. Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/07-smallwares-skus.ts
 * SEED_DRY=1 → report only.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";

interface Def { name: string; vendor: string; parNum: number | null; parVerbatim: string; itemNumber?: string; leadDays?: number; food?: boolean }
const SMALLWARES: Def[] = [
  // Cleaning
  { name: "Trash Liners 40x46", vendor: "Trimark", parNum: 0.5, parVerbatim: "1/2 cs", itemNumber: "36050" },
  { name: "Glass Cleaner (#1)", vendor: "Trimark", parNum: 1, parVerbatim: "1 backup btl" },
  { name: "Floor Cleaner (Kitchen Citrus #8)", vendor: "Trimark", parNum: 1, parVerbatim: "1 btl", itemNumber: "21177" },
  { name: "Sani 512 gallons", vendor: "Trimark", parNum: 1, parVerbatim: "1 gal", itemNumber: "20051" },
  { name: "Solar Green gallons", vendor: "Trimark", parNum: 1, parVerbatim: "1 gal", itemNumber: "20034" },
  { name: "Formula C gallons", vendor: "Trimark", parNum: 1, parVerbatim: "1 gal" },
  { name: "Bleach Gallons", vendor: "Trimark", parNum: 0.5, parVerbatim: "1/2 gal", itemNumber: "20352" },
  { name: "Oven Cleaner", vendor: "US Foods", parNum: 2, parVerbatim: "2 btls" },
  { name: "Stainless Steel Scrubbies", vendor: "Webstaurant", parNum: 6, parVerbatim: "6 pcs" },
  { name: "Foam Soap (restrooms)", vendor: "Trimark", parNum: 1, parVerbatim: "1 pc" },
  { name: "Toilet Paper", vendor: "Amazon", parNum: 12, parVerbatim: "12 rolls" },
  { name: "Solid Suds (cap hill only)", vendor: "Trimark", parNum: 0.75, parVerbatim: "3/4 container" },
  { name: "Isopropyl Alcohol Spray", vendor: "Amazon", parNum: 0.5, parVerbatim: "1/2 btl" },
  // Office
  { name: "Logo Tape", vendor: "Continental Tape", parNum: 18, parVerbatim: "18 rolls", leadDays: 42 },
  { name: "Neon Green Tape", vendor: "Webstaurant", parNum: 6, parVerbatim: "6 rolls" },
  { name: "Register Rolls (3 1/8 thermal)", vendor: "Webstaurant", parNum: 6, parVerbatim: "6 rolls" },
  { name: "Sharpies", vendor: "Amazon", parNum: 6, parVerbatim: "6" },
  { name: "Guest Check Pads", vendor: "Webstaurant", parNum: 4, parVerbatim: "4" },
  { name: "Staples", vendor: "Amazon", parNum: 2, parVerbatim: "2 boxes" },
  { name: "Dry Erase Markers", vendor: "Amazon", parNum: 6, parVerbatim: "6 pcs" },
  { name: "Printer Ink", vendor: "Amazon", parNum: 1, parVerbatim: "1 full of each color" },
  { name: "Circle Label Stickers", vendor: "Amazon", parNum: 0.75, parVerbatim: "3/4 lg box" },
  // Food-ish (NOT inventory_only)
  { name: "Frooties", vendor: "Penny Candy", parNum: 8, parVerbatim: "8 bags", food: true },
  { name: "Fruity Pebbles", vendor: "Amazon", parNum: 1, parVerbatim: "1 qt", food: true },
  // Misc / Kitchen
  { name: "Loyalty Cards", vendor: "Vistaprint", parNum: 1, parVerbatim: "1 full box" },
  { name: "First Aid Items", vendor: "Webstaurant", parNum: null, parVerbatim: "as needed" },
  { name: "Bread Knives", vendor: "Webstaurant", parNum: 2, parVerbatim: "2 backups" },
  { name: "16 oz Bottles", vendor: "Webstaurant", parNum: null, parVerbatim: "" },
  { name: "32 oz Bottles", vendor: "Webstaurant", parNum: null, parVerbatim: "" },
  { name: "Bottle Tops", vendor: "Webstaurant", parNum: null, parVerbatim: "" },
];

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");

  const { data: vends } = await sb.from("vendors").select("id, name").eq("active", true).returns<Array<{ id: string; name: string }>>();
  const vendorId = new Map((vends ?? []).map((v) => [v.name, v.id]));

  let created = 0, unchanged = 0;
  const skippedVendor: string[] = [];

  for (const d of SMALLWARES) {
    const vid = vendorId.get(d.vendor);
    if (!vid) { skippedVendor.push(`${d.name} (vendor "${d.vendor}")`); continue; }
    const notes = d.parVerbatim ? `Par (smallwares guide 2023): ${d.parVerbatim}. [seed stage7]` : "[seed stage7]";
    const { data: ex } = await sb.from("vendor_items").select("id").eq("name", d.name).eq("vendor_id", vid).is("location_id", null).maybeSingle<{ id: string }>();
    if (ex) { unchanged++; continue; }
    created++;
    if (!DRY) {
      const { data: ins, error } = await sb.from("vendor_items").insert({
        name: d.name, vendor_id: vid, location_id: null, active: true,
        inventory_only: !d.food, item_number: d.itemNumber ?? null,
        weekday_par: d.parNum, weekend_par: null, lead_time_days: d.leadDays ?? null,
        notes, created_by: null, updated_by: null,
      }).select("id").single<{ id: string }>();
      if (error) throw new Error(`insert smallware ${d.name}: ${error.message}`);
      void audit({ actorId: null, actorRole: null, action: "vendor_item.create", resourceTable: "vendor_items", resourceId: ins.id, metadata: { name: d.name, vendor: d.vendor, inventory_only: !d.food, creation_method: "seed_script", phase: "operational_seed_stage7" }, ipAddress: null, userAgent: null });
    }
  }

  console.log(`\nStage 7 smallwares: ${created} created, ${unchanged} already existed (${SMALLWARES.length} in guide).`);
  if (skippedVendor.length) { console.log(`Skipped (vendor not seeded):`); for (const s of skippedVendor) console.log(`  - ${s}`); }
  if (!DRY) {
    const { count } = await sb.from("vendor_items").select("id", { count: "exact", head: true }).like("notes", "%stage7%");
    console.log(`Verify: ${count} smallwares SKUs tagged stage7.`);
  }
  console.log("Stage 7 smallwares done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
