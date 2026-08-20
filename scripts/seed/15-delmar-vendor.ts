/**
 * Seed 15 — register Delmar Provisions as a vendor (Angel data arc, action J2).
 *
 * WHY. Angel's export carries exactly three vendor values; Delmar Provisions is
 * 37.4% of all spend ($20,604.35 over 27 rows) and is absent from our `vendors`
 * table. It is the deli lane: two of its rows literally carry `brand = Boar's Head`
 * (BANANA PEPPER RINGS, CEL-RAY DR. BROWNS) and its product set — OvenGold turkey,
 * London Broil, mild provolone, Genoa, cappy, Dr. Brown's sodas, pickles — is our
 * `Boar's Head` vendor's 23 SKUs. Angel models the DISTRIBUTOR; we modelled the
 * BRAND. Juan's call (2026-08-20): register the distributor, because POs and
 * invoices go to Delmar and `vendors.name` should name whoever actually receives
 * the order. "Boar's Head" stays as the brand.
 *
 * SCOPE — REGISTRATION ONLY. This script creates the vendor row plus the minimum
 * classification the directory requires (≥1 category, ≥1 order type, ≥1 contact,
 * ≥1 ordering detail). It deliberately does NOT:
 *   - re-point the 23 Boar's Head SKUs to Delmar (a 23-SKU data-model change that
 *     is its own reviewed step, not a side-effect of registration);
 *   - record any pack size, case weight or units-per-case. ALL 27 Delmar rows in
 *     the export are flagged NO_PACK_SIZE|BROKER_DIRECT: every one gives a case
 *     price and nothing else. Report §C.3 shows what happens when someone supplies
 *     the missing denominator by guessing — Angel's own UI turned a $35.95 CASE
 *     price for PICKLES CHIPS into "$35.95/lb" by assuming a ~1 lb pack. Pack sizes
 *     for this lane come from Juan (report J3), not from inference here;
 *   - invent a cutoff, ordering email, phone, portal URL, account number, payment
 *     terms, or an order/delivery-day schedule. None of those appear in any source
 *     we have. The ordering row is an explicit "TBD" placeholder, which is the
 *     house convention from seed 01 for a known vendor whose channel is unrecorded.
 *
 * Idempotent: get-or-create by exact name; sub-rows added only when absent. Safe to
 * re-run. Audited `vendor.create` (destructive=true auto-derives via the registry).
 *
 * Run: SEED_DRY=1 npx tsx --conditions=react-server --env-file=.env.local scripts/seed/15-delmar-vendor.ts  (report only)
 *      npx tsx --conditions=react-server --env-file=.env.local scripts/seed/15-delmar-vendor.ts              (write)
 *
 * NOTE on --conditions=react-server: lib/supabase-server.ts carries `import "server-only"`
 * (the module-boundary guard added 2026-07-23). Under plain `tsx` that package resolves to
 * its throwing entry point and every seed dies on import. The react-server export condition
 * resolves it to the empty stub, which is exactly what a Node-side script wants. Seeds 01–14
 * still document the pre-guard run line and will fail without this flag.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const DRY = process.env.SEED_DRY === "1";

const VENDOR_NAME = "Delmar Provisions";

/** Classification axes, both justified by the export's own product set —
 *  deli meats + cheeses (Protein), pickles/peppers/prosciutto (Specialty),
 *  Dr. Brown's / Coke / bottled water (Beverage). Mirrors how the Boar's Head
 *  row is classified in seed 01, because it is the same physical lane. */
const CATEGORIES = ["Slicing"] as const;
const ORDER_TYPES = ["Protein", "Specialty", "Beverage"] as const;

const NOTES = [
  "Broker-direct deli distributor — the lane we previously modelled under the BRAND name",
  "\"Boar's Head\" (which stays the brand). Identified from the Angel Spend catalog export",
  "(docs/seed/source/angel-product-catalog.csv, 27 rows, $20,604.35 = 37.4% of captured spend);",
  "two of its rows carry brand = Boar's Head outright, and its product set maps 1:1 onto 23 of",
  "our Boar's Head SKUs. Carries the single highest-spend item in the dataset (OvenGold turkey).",
  "PACK SIZES UNKNOWN: all 27 export rows are flagged NO_PACK_SIZE|BROKER_DIRECT — case price",
  "only, no pack string, no units-per-case, no case weight. Per-ounce costing for this lane is",
  "BLOCKED until Juan supplies real pack sizes (reconciliation report J3). Ordering channel,",
  "cutoffs and terms are not yet recorded. [seeded: angel-data-arc 2026-08-20]",
].join(" ");

/** Ordering placeholder. method 'other' + a TBD value is seed 01's documented
 *  convention for "we know the vendor, we have not recorded the channel" — it is a
 *  visible gap for Juan to fill, NOT a guess at how ordering happens. */
const ORDERING = {
  method: "other" as const,
  value: "TBD — broker-direct; ordering channel not recorded",
  label: "Broker-direct",
};

async function main() {
  const sb = getServiceRoleClient();
  if (DRY) console.log("── DRY RUN (SEED_DRY=1): report only, NO writes ──\n");

  // Pre-flight the registries so an unknown slug fails loudly instead of silently
  // registering a vendor with no classification.
  const { data: cats, error: cErr } = await sb.from("categories").select("id, slug").eq("active", true).returns<Array<{ id: string; slug: string }>>();
  if (cErr) throw new Error(`load categories: ${cErr.message}`);
  const { data: ots, error: oErr } = await sb.from("order_types").select("id, slug").eq("active", true).returns<Array<{ id: string; slug: string }>>();
  if (oErr) throw new Error(`load order_types: ${oErr.message}`);
  const catBySlug = new Map((cats ?? []).map((c) => [c.slug, c.id]));
  const otBySlug = new Map((ots ?? []).map((o) => [o.slug, o.id]));

  for (const slug of CATEGORIES) {
    if (!catBySlug.has(slug)) throw new Error(`FATAL: category slug '${slug}' is not an active category — refusing to register ${VENDOR_NAME} unclassified.`);
  }
  for (const slug of ORDER_TYPES) {
    if (!otBySlug.has(slug)) throw new Error(`FATAL: order_type slug '${slug}' is not an active order type — refusing to register ${VENDOR_NAME} unclassified.`);
  }

  // Get-or-create by exact name (idempotent).
  const { data: existing, error: exErr } = await sb.from("vendors").select("id, name, active").eq("name", VENDOR_NAME).maybeSingle<{ id: string; name: string; active: boolean }>();
  if (exErr) throw new Error(`lookup ${VENDOR_NAME}: ${exErr.message}`);

  let vendorId: string;
  if (existing) {
    vendorId = existing.id;
    console.log(`  = vendor "${VENDOR_NAME}" already registered (id=${existing.id}, active=${existing.active}) — reusing, no field overwrite.`);
  } else if (DRY) {
    console.log(`  + WOULD CREATE vendor "${VENDOR_NAME}"`);
    console.log(`      categories:  ${CATEGORIES.join(", ")}`);
    console.log(`      orderTypes:  ${ORDER_TYPES.join(", ")}`);
    console.log(`      contact:     ${VENDOR_NAME} (no email/phone — none known)`);
    console.log(`      ordering:    ${ORDERING.method} / ${ORDERING.value}`);
    console.log(`      notes:       ${NOTES}`);
    console.log("\n  (dry run — nothing else to check without a vendor id)");
    console.log("Seed 15 done.");
    return;
  } else {
    const { data: ins, error } = await sb
      .from("vendors")
      .insert({ name: VENDOR_NAME, active: true, notes: NOTES, created_by: null })
      .select("id")
      .single<{ id: string }>();
    if (error) throw new Error(`insert vendor ${VENDOR_NAME}: ${error.message}`);
    vendorId = ins.id;
    console.log(`  + created vendor "${VENDOR_NAME}" (id=${ins.id})`);
    void audit({
      actorId: null, actorRole: null,
      action: "vendor.create", resourceTable: "vendors", resourceId: ins.id,
      metadata: {
        name: VENDOR_NAME,
        creation_method: "seed_script",
        phase: "angel_data_arc",
        reason: "angel_reconciliation_j2_register_distributor",
        source: "docs/seed/source/angel-product-catalog.csv",
        source_report: "docs/seed/source/angel-reconciliation-report.md §A.2 / J2",
        spend_share_pct: 37.4,
        angel_rows: 27,
        pack_sizes_known: false,
        skus_repointed: 0,
      },
      ipAddress: null, userAgent: null,
    });
  }

  // Sub-rows: add only what is missing (idempotent on re-run).
  let catJoins = 0, otJoins = 0, contacts = 0, orderings = 0;

  for (const slug of CATEGORIES) {
    const catId = catBySlug.get(slug)!;
    const { data: ex } = await sb.from("vendor_categories").select("id").eq("vendor_id", vendorId).eq("category_id", catId).maybeSingle<{ id: string }>();
    if (ex) continue;
    if (!DRY) {
      const { error } = await sb.from("vendor_categories").insert({ vendor_id: vendorId, category_id: catId, created_by: null });
      if (error) throw new Error(`vendor_categories ${slug}: ${error.message}`);
    }
    catJoins++;
  }

  for (const slug of ORDER_TYPES) {
    const otId = otBySlug.get(slug)!;
    const { data: ex } = await sb.from("vendor_order_types").select("id").eq("vendor_id", vendorId).eq("order_type_id", otId).maybeSingle<{ id: string }>();
    if (ex) continue;
    if (!DRY) {
      const { error } = await sb.from("vendor_order_types").insert({ vendor_id: vendorId, order_type_id: otId, created_by: null });
      if (error) throw new Error(`vendor_order_types ${slug}: ${error.message}`);
    }
    otJoins++;
  }

  // ≥1 contact — name only. No email/phone is known for Delmar and none is invented.
  const { data: exContacts } = await sb.from("vendor_contacts").select("id").eq("vendor_id", vendorId).limit(1);
  if (!exContacts || exContacts.length === 0) {
    if (!DRY) {
      const { error } = await sb.from("vendor_contacts").insert({ vendor_id: vendorId, name: VENDOR_NAME, email: null, phone: null, display_order: 0, active: true, created_by: null });
      if (error) throw new Error(`vendor_contacts: ${error.message}`);
    }
    contacts++;
  }

  // ≥1 ordering detail — explicit TBD placeholder (seed 01 convention).
  const { data: exOrdering } = await sb.from("vendor_ordering_details").select("id").eq("vendor_id", vendorId).limit(1);
  if (!exOrdering || exOrdering.length === 0) {
    if (!DRY) {
      const { error } = await sb.from("vendor_ordering_details").insert({ vendor_id: vendorId, method: ORDERING.method, value: ORDERING.value, label: ORDERING.label, display_order: 0, active: true, created_by: null });
      if (error) throw new Error(`vendor_ordering_details: ${error.message}`);
    }
    orderings++;
  }

  console.log(`  ${DRY ? "would add" : "added"}: ${catJoins} category join(s), ${otJoins} order-type join(s), ${contacts} contact(s), ${orderings} ordering-detail(s).`);

  // Read back from the destination (discipline zero: verify the persisted shape).
  if (!DRY) {
    const [{ count: nc }, { count: no }, { count: nk }, { count: nd }, { count: nsku }] = await Promise.all([
      sb.from("vendor_categories").select("id", { count: "exact", head: true }).eq("vendor_id", vendorId),
      sb.from("vendor_order_types").select("id", { count: "exact", head: true }).eq("vendor_id", vendorId),
      sb.from("vendor_contacts").select("id", { count: "exact", head: true }).eq("vendor_id", vendorId),
      sb.from("vendor_ordering_details").select("id", { count: "exact", head: true }).eq("vendor_id", vendorId),
      sb.from("vendor_items").select("id", { count: "exact", head: true }).eq("vendor_id", vendorId),
    ]);
    console.log(`  ✓ read-back: categories=${nc} orderTypes=${no} contacts=${nk} ordering=${nd} skus=${nsku} (0 SKUs is CORRECT — re-pointing is a separate step)`);
    if (!nc || !no || !nk || !nd) console.warn("  ! below the min-1 directory floor — review above");
  }

  console.log("Seed 15 done.");
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
