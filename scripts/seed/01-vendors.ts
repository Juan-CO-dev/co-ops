/**
 * Operational Seed — Stage 1: Vendors.
 * Idempotent. Seeds the vendor directory from the Vendor Master List + the CSV sources:
 * vendor rows + category/order-type joins (≥1 each) + ≥1 contact + ≥1 ordering-detail
 * (real where known, placeholder "TBD" otherwise — placeholders to be replaced by Juan).
 * Reconciles the existing "Sisco" → "Sysco" in place (keeps its id). Existing "Baldor" reused.
 *
 * Run: npx tsx --env-file=.env.local scripts/seed/01-vendors.ts
 * Decisions: docs/superpowers/specs/2026-07-21-operational-seed-decisions.md (Q8 = plain vendor rows).
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";

type Method = "email" | "url" | "phone" | "portal" | "other";
interface VendorDef {
  name: string;
  cats: string[];       // categories axis (prep-section aligned): Veg/Cooks/Sides/Sauces/Slicing/Misc/Paper/Cleaning/Other
  orderTypes: string[]; // supply-type axis: Produce/Protein/Dairy/DryGoods/Paper/Chemical/Beverage/Specialty/Equipment/Other
  ordering: { method: Method; value: string; label: string };
  contact: { name: string; email?: string; phone?: string };
  notes: string;
}

const VENDORS: VendorDef[] = [
  { name: "PFG", cats: ["Veg", "Cooks", "Sides", "Sauces", "Slicing", "Paper"], orderTypes: ["Produce", "Protein", "Dairy", "DryGoods", "Paper", "Beverage"], ordering: { method: "portal", value: "TBD — PFG order portal", label: "Order portal" }, contact: { name: "PFG Rep" }, notes: "Broadline distributor; current primary ordering vendor (2025 guide). 2-day order cycle. [seeded]" },
  { name: "US Foods", cats: ["Veg", "Cooks", "Sides", "Paper"], orderTypes: ["Produce", "Dairy", "DryGoods", "Paper"], ordering: { method: "portal", value: "TBD — US Foods portal", label: "Order portal" }, contact: { name: "US Foods Rep" }, notes: "Broadline distributor. 2-day order cycle. [seeded]" },
  { name: "Baldor", cats: ["Veg", "Cooks", "Sauces"], orderTypes: ["Produce", "Dairy", "Protein", "Specialty"], ordering: { method: "portal", value: "TBD — Baldor portal", label: "Order portal" }, contact: { name: "Baldor Rep" }, notes: "Specialty distributor. 2-day order cycle. [seeded]" },
  { name: "Sysco", cats: ["Cooks", "Paper"], orderTypes: ["DryGoods", "Paper", "Protein"], ordering: { method: "portal", value: "TBD — Sysco portal", label: "Order portal" }, contact: { name: "Sysco Rep" }, notes: "Broadline distributor. 15-case minimum Mon–Sat. [seeded]" },
  { name: "Boar's Head", cats: ["Slicing"], orderTypes: ["Protein", "Specialty", "Beverage"], ordering: { method: "phone", value: "TBD", label: "Order by phone" }, contact: { name: "Boar's Head Rep" }, notes: "Deli purveyor — meats, cheeses, pickles, peppers, DB sodas. Order Sun–Fri. [seeded]" },
  { name: "Trimark", cats: ["Cleaning", "Paper"], orderTypes: ["Chemical", "Paper", "Equipment"], ordering: { method: "portal", value: "TBD — Trimark portal", label: "Order portal" }, contact: { name: "Trimark Rep" }, notes: "Chemicals, cleaning, trash liners, plastic wrap, smallwares. Has item #s. [seeded]" },
  { name: "Cardinal Bakery", cats: ["Misc"], orderTypes: ["DryGoods", "Specialty"], ordering: { method: "phone", value: "TBD", label: "Order by phone" }, contact: { name: "Cardinal Bakery" }, notes: "Bakery — sub rolls, baguettes, onion rolls. [seeded]" },
  { name: "Saval", cats: ["Cooks", "Sauces"], orderTypes: ["Dairy", "Specialty"], ordering: { method: "phone", value: "TBD", label: "Order by phone" }, contact: { name: "Saval Rep" }, notes: "Distributor — ricotta, vegan Duke's mayo. [seeded]" },
  { name: "Webstaurant", cats: ["Other", "Paper"], orderTypes: ["Equipment", "Paper", "Other"], ordering: { method: "url", value: "https://www.webstaurantstore.com", label: "Online" }, contact: { name: "Webstaurant" }, notes: "Online restaurant supply — smallwares, office. [seeded]" },
  { name: "Amazon", cats: ["Other", "Cleaning"], orderTypes: ["Other", "Equipment", "Chemical"], ordering: { method: "url", value: "https://www.amazon.com", label: "Online" }, contact: { name: "Amazon" }, notes: "Online — misc cleaning / office / food. [seeded]" },
  { name: "Continental Tape", cats: ["Paper"], orderTypes: ["Paper"], ordering: { method: "url", value: "TBD — Continental Tape Printers", label: "Custom order" }, contact: { name: "Continental Tape Printers" }, notes: "Custom printed logo tape — 6 wk lead time. [seeded]" },
  { name: "Vistaprint", cats: ["Other"], orderTypes: ["Other"], ordering: { method: "url", value: "https://www.vistaprint.com", label: "Online" }, contact: { name: "Vistaprint" }, notes: "Loyalty cards. [seeded]" },
  { name: "Penny Candy", cats: ["Misc"], orderTypes: ["Specialty"], ordering: { method: "email", value: "mason@pennycandy.com", label: "Order by email" }, contact: { name: "Mason", email: "mason@pennycandy.com" }, notes: "Frooties — order by email. [seeded]" },
  { name: "Country Snacks", cats: ["Sides"], orderTypes: ["Specialty"], ordering: { method: "phone", value: "TBD", label: "Order by phone" }, contact: { name: "Country Snacks" }, notes: "UTZ chip varieties. [seeded]" },
  { name: "Costco", cats: ["Other"], orderTypes: ["Other"], ordering: { method: "other", value: "Retail — in person", label: "Retail" }, contact: { name: "Costco" }, notes: "Retail — toilet paper (alt). [seeded]" },
  { name: "Sarah", cats: ["Misc"], orderTypes: ["Specialty"], ordering: { method: "other", value: "Internal — coordinate directly", label: "Internal source" }, contact: { name: "Sarah" }, notes: "Internal person-source — Gluten-free bread. [seeded]" },
  { name: "Cristian", cats: ["Sauces", "Misc"], orderTypes: ["Specialty"], ordering: { method: "other", value: "Internal — coordinate directly", label: "Internal source" }, contact: { name: "Cristian" }, notes: "Internal person-source — cranberry sauce, GF bread. [seeded]" },
];

async function main() {
  const sb = getServiceRoleClient();

  // Slug → id maps for categories + order_types.
  const { data: cats, error: cErr } = await sb.from("categories").select("id, slug").eq("active", true).returns<Array<{ id: string; slug: string }>>();
  if (cErr) throw new Error(`load categories: ${cErr.message}`);
  const { data: ots, error: oErr } = await sb.from("order_types").select("id, slug").eq("active", true).returns<Array<{ id: string; slug: string }>>();
  if (oErr) throw new Error(`load order_types: ${oErr.message}`);
  const catBySlug = new Map((cats ?? []).map((c) => [c.slug, c.id]));
  const otBySlug = new Map((ots ?? []).map((o) => [o.slug, o.id]));

  // Reconcile the existing "Sisco" typo → "Sysco" (in place, keeps its id).
  const { data: sisco } = await sb.from("vendors").select("id").eq("name", "Sisco").maybeSingle<{ id: string }>();
  if (sisco) {
    const { error } = await sb.from("vendors").update({ name: "Sysco", updated_at: new Date().toISOString() }).eq("id", sisco.id);
    if (error) throw new Error(`rename Sisco→Sysco: ${error.message}`);
    console.log("  ✓ renamed existing 'Sisco' → 'Sysco'");
  }

  let created = 0, reused = 0, catJoins = 0, otJoins = 0, contacts = 0, orderings = 0;

  for (const v of VENDORS) {
    // Upsert vendor by exact name.
    let { data: row } = await sb.from("vendors").select("id").eq("name", v.name).maybeSingle<{ id: string }>();
    if (!row) {
      const { data: ins, error } = await sb.from("vendors").insert({ name: v.name, active: true, notes: v.notes, created_by: null }).select("id").single<{ id: string }>();
      if (error) throw new Error(`insert vendor ${v.name}: ${error.message}`);
      row = ins;
      created++;
      void audit({ actorId: null, actorRole: null, action: "vendor.create", resourceTable: "vendors", resourceId: ins.id, metadata: { name: v.name, creation_method: "seed_script", phase: "operational_seed_stage1" }, ipAddress: null, userAgent: null });
    } else {
      reused++;
    }
    const vid = row.id;

    // Category joins (≥1) — idempotent per (vendor, category).
    for (const slug of v.cats) {
      const catId = catBySlug.get(slug);
      if (!catId) { console.warn(`  ! unknown category slug '${slug}' for ${v.name}`); continue; }
      const { data: ex } = await sb.from("vendor_categories").select("id").eq("vendor_id", vid).eq("category_id", catId).maybeSingle<{ id: string }>();
      if (!ex) { const { error } = await sb.from("vendor_categories").insert({ vendor_id: vid, category_id: catId, created_by: null }); if (error) throw new Error(`vendor_categories ${v.name}/${slug}: ${error.message}`); catJoins++; }
    }
    // Order-type joins (≥1) — the supply-type axis.
    for (const slug of v.orderTypes) {
      const otId = otBySlug.get(slug);
      if (!otId) { console.warn(`  ! unknown order_type slug '${slug}' for ${v.name}`); continue; }
      const { data: ex } = await sb.from("vendor_order_types").select("id").eq("vendor_id", vid).eq("order_type_id", otId).maybeSingle<{ id: string }>();
      if (!ex) { const { error } = await sb.from("vendor_order_types").insert({ vendor_id: vid, order_type_id: otId, created_by: null }); if (error) throw new Error(`vendor_order_types ${v.name}/${slug}: ${error.message}`); otJoins++; }
    }

    // ≥1 contact (only if the vendor has none yet).
    const { data: existingContacts } = await sb.from("vendor_contacts").select("id").eq("vendor_id", vid).limit(1);
    if (!existingContacts || existingContacts.length === 0) {
      const { error } = await sb.from("vendor_contacts").insert({ vendor_id: vid, name: v.contact.name, email: v.contact.email ?? null, phone: v.contact.phone ?? null, display_order: 0, active: true, created_by: null });
      if (error) throw new Error(`vendor_contacts ${v.name}: ${error.message}`);
      contacts++;
    }
    // ≥1 ordering detail (only if the vendor has none yet).
    const { data: existingOrdering } = await sb.from("vendor_ordering_details").select("id").eq("vendor_id", vid).limit(1);
    if (!existingOrdering || existingOrdering.length === 0) {
      const { error } = await sb.from("vendor_ordering_details").insert({ vendor_id: vid, method: v.ordering.method, value: v.ordering.value, label: v.ordering.label, display_order: 0, active: true, created_by: null });
      if (error) throw new Error(`vendor_ordering_details ${v.name}: ${error.message}`);
      orderings++;
    }
  }

  console.log(`\nStage 1 vendors: ${created} created, ${reused} reused | ${catJoins} category joins, ${otJoins} order-type joins, ${contacts} contacts, ${orderings} ordering-details added.`);

  // Verify: every seeded vendor has ≥1 category + ≥1 order-type + ≥1 contact + ≥1 ordering.
  const { data: allV } = await sb.from("vendors").select("id, name").eq("active", true).returns<Array<{ id: string; name: string }>>();
  const seededNames = new Set(VENDORS.map((v) => v.name));
  let bad = 0;
  for (const v of allV ?? []) {
    if (!seededNames.has(v.name)) continue;
    const [{ count: nc }, { count: no }, { count: nk }, { count: nd }] = await Promise.all([
      sb.from("vendor_categories").select("id", { count: "exact", head: true }).eq("vendor_id", v.id),
      sb.from("vendor_order_types").select("id", { count: "exact", head: true }).eq("vendor_id", v.id),
      sb.from("vendor_contacts").select("id", { count: "exact", head: true }).eq("vendor_id", v.id),
      sb.from("vendor_ordering_details").select("id", { count: "exact", head: true }).eq("vendor_id", v.id),
    ]);
    if (!nc || !no || !nk || !nd) { console.warn(`  ! ${v.name}: cats=${nc} orderTypes=${no} contacts=${nk} ordering=${nd}`); bad++; }
  }
  console.log(bad === 0 ? "  ✓ all seeded vendors satisfy ≥1 category / order-type / contact / ordering" : `  ! ${bad} vendors below min-1 — review above`);
  console.log("Stage 1 done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
