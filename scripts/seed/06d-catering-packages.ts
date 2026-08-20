/**
 * Operational Seed — Stage 6d: catering packages (the last Stage-6 script).
 *
 * Seeds the Toast catering packages (Sandwich Platters, Individual Lunch Boxes, Really
 * Big Subs) into catering_packages — PER-LOCATION (both shops, same price). Each package
 * with a sub choose-from slot gets one catering_package_items row (slot_type='choice')
 * + catering_package_slot_options referencing the eligible sub menu_items (from 6b-1).
 * The slot children are seeded only when the package row is newly created (idempotent).
 *
 * Source: docs/seed/source/toast-menu-catering.md. Run: npx tsx --conditions=react-server --env-file=.env.local scripts/seed/06d-catering-packages.ts
 * SEED_DRY=1 → report only.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";
const LOCATIONS = [
  { id: "54ce1029-400e-4a92-9c2b-0ccb3b031f0a", name: "Capitol Hill" },
  { id: "d2cced11-b167-49fa-bab6-86ec9bf4ff09", name: "P Street" },
];

// The Classics + Favorites sub set the platters choose from.
const PLATTER_SUBS = ["The Teamster", "Crunchy Boi", "Marisa Tomei Eats Free", "Hot Pants", "Farmers Market After Dark"];
const FOOTER_SUBS = ["The Teamster", "Crunchy Boi"];
const ALL_SIGNATURE = ["Crunchy Boi", "The Teamster", "Marisa Tomei Eats Free", "Farmers Market After Dark", "Never Been Cheddar", "Hot Pants", "Turkey Caesar Sub", "The Frex", "It's a BOI", "Vesuvio II", "Sicky Wicky Club", "Our French Dip", "Regular BLT", "The chicken cutlet", "Chicken parm"];

interface Pkg {
  slug: string; label: string; desc: string;
  mode: "per_platter" | "per_head" | "fixed"; priceCents: number; minHead: number; leadHours: number;
  slot?: { quantity: number; options: string[] };
}
const PACKAGES: Pkg[] = [
  { slug: "sandwich-platter-8", label: "8 pc platter", desc: "Serves 4-6 people. Eight 5\" sandwiches — choose from the Classics or Favorites mix.", mode: "per_platter", priceCents: 6000, minHead: 4, leadHours: 24, slot: { quantity: 8, options: PLATTER_SUBS } },
  { slug: "sandwich-platter-16", label: "16 pc platter", desc: "Serves 8-16 people. Sixteen 5\" sandwiches — choose from the Classics or Favorites mix.", mode: "per_platter", priceCents: 11500, minHead: 8, leadHours: 24, slot: { quantity: 16, options: PLATTER_SUBS } },
  { slug: "sandwich-platter-32", label: "32 pc platter", desc: "Serves 16-32 people. Thirty-two 5\" sandwiches — choose from the Classics or Favorites mix.", mode: "per_platter", priceCents: 21000, minHead: 16, leadHours: 24, slot: { quantity: 32, options: PLATTER_SUBS } },
  { slug: "sandwich-platter-48", label: "48 pc platter", desc: "Serves 24-48 people. Forty-eight 5\" sandwiches — choose from the Classics or Favorites mix.", mode: "per_platter", priceCents: 33000, minHead: 24, leadHours: 24, slot: { quantity: 48, options: PLATTER_SUBS } },
  { slug: "light-lunch", label: "Light Lunch", desc: "A 5\" sub of choice, a small bag of original Utz chips, water bottle & napkin.", mode: "per_head", priceCents: 1200, minHead: 1, leadHours: 24, slot: { quantity: 1, options: ALL_SIGNATURE } },
  { slug: "full-lunch", label: "Full Lunch", desc: "A 10\" sub, assorted Utz, bottle of water.", mode: "per_head", priceCents: 1999, minHead: 1, leadHours: 24, slot: { quantity: 1, options: ALL_SIGNATURE } },
  { slug: "three-footer", label: "Three Footer", desc: "**48 HOURS ADVANCE NOTICE** 3-foot sub roll from Cardinal Bakery. Choice of Teamster or Crunchy Boi. Serves 6-12.", mode: "per_platter", priceCents: 13500, minHead: 6, leadHours: 48, slot: { quantity: 1, options: FOOTER_SUBS } },
  { slug: "six-footer", label: "Six Footer", desc: "**72 HOURS NOTICE** six feet of sub. Choice of Teamster or Crunchy Boi. Feeds 15-20.", mode: "per_platter", priceCents: 26000, minHead: 15, leadHours: 72, slot: { quantity: 1, options: FOOTER_SUBS } },
];

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");

  const { data: menuItems } = await sb.from("menu_items").select("id, name").eq("active", true).returns<Array<{ id: string; name: string }>>();
  const menuItemByName = new Map((menuItems ?? []).map((m) => [m.name.toLowerCase(), m.id]));

  let pkgCreated = 0, pkgExisting = 0, slots = 0, options = 0;
  const missingOptions: string[] = [];

  for (const loc of LOCATIONS) {
    let order = 0;
    for (const p of PACKAGES) {
      const { data: ex } = await sb.from("catering_packages").select("id").eq("slug", p.slug).eq("location_id", loc.id).maybeSingle<{ id: string }>();
      if (ex) { pkgExisting++; order++; continue; }
      pkgCreated++;
      // Pre-count the slot + options this package would add (dry reporting).
      if (p.slot) { slots++; for (const opt of p.slot.options) { if (menuItemByName.has(opt.toLowerCase())) options++; else if (!missingOptions.includes(opt)) missingOptions.push(opt); } }
      if (DRY) { order++; continue; }

      const { data: pkg, error } = await sb.from("catering_packages").insert({
        location_id: loc.id, slug: p.slug, label_en: p.label, description_en: p.desc,
        pricing_mode: p.mode, price_cents: p.priceCents, min_headcount: p.minHead, lead_time_hours: p.leadHours,
        active: true, display_order: order++, created_by: null,
      }).select("id").single<{ id: string }>();
      if (error) throw new Error(`insert package ${p.slug}@${loc.name}: ${error.message}`);
      void audit({ actorId: null, actorRole: null, action: "catering_package.create", resourceTable: "catering_packages", resourceId: pkg.id, metadata: { slug: p.slug, location: loc.name, price_cents: p.priceCents, creation_method: "seed_script", phase: "operational_seed_stage6d" }, ipAddress: null, userAgent: null });

      if (p.slot) {
        const { data: pi, error: piErr } = await sb.from("catering_package_items").insert({
          package_id: pkg.id, slot_type: "choice", description: `Choose your sub${p.slot.quantity > 1 ? ` (×${p.slot.quantity})` : ""}`,
          quantity: p.slot.quantity, display_order: 0, active: true, created_by: null,
        }).select("id").single<{ id: string }>();
        if (piErr) throw new Error(`insert package_item ${p.slug}: ${piErr.message}`);
        let optOrder = 0;
        for (const opt of p.slot.options) {
          const mid = menuItemByName.get(opt.toLowerCase());
          if (!mid) { if (!missingOptions.includes(opt)) missingOptions.push(opt); continue; }
          const { error: soErr } = await sb.from("catering_package_slot_options").insert({ package_item_id: pi.id, menu_item_id: mid, item_id: null, display_order: optOrder++, active: true, created_by: null });
          if (soErr) throw new Error(`insert slot_option ${p.slug}/${opt}: ${soErr.message}`);
        }
      }
    }
  }

  console.log(`\nStage 6d catering packages: ${pkgCreated} created, ${pkgExisting} existed | ${slots} choice-slots | ${options} slot options (across ${LOCATIONS.length} locations).`);
  if (missingOptions.length) { console.log(`Slot option subs not found as menu_items (skipped):`); for (const m of missingOptions) console.log(`  - ${m}`); }
  if (!DRY) {
    const { count: pk } = await sb.from("catering_packages").select("id", { count: "exact", head: true }).eq("active", true);
    const { count: so } = await sb.from("catering_package_slot_options").select("id", { count: "exact", head: true });
    console.log(`Verify: ${pk} active catering_packages (${PACKAGES.length}×${LOCATIONS.length}=${PACKAGES.length * LOCATIONS.length} expected); ${so} slot options.`);
  }
  console.log("Stage 6d done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
