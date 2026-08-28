/**
 * Seed 32 — the seed-31 HELD answers + the chips cohort. 2026-08-28.
 *
 * Source, Juan verbatim (2026-08-28, answering seed 31's held questions):
 *   "1. Repair  2. We only sell the branded c/o water  3. Packed to order
 *    Chips each need their own flavors … the utz ripples is what we use for crunchy bois
 *    net WT per bag is 12.5 oz … the flavored bags(salt and pepper, salt and vinegar,
 *    sour cream and onion, bbq and original) net WT is 2.75 oz …"
 *
 * ── WHAT IT DOES, PER RULING ─────────────────────────────────────────────────
 * ① NATALIE'S LEMONADE — "Repair". The active chain level is `case = 6 count`, a count
 *    leaf whose per-bottle avg was never set, CONTRADICTING the flat fields (Case of
 *    6 × 12 fl oz). Repair, append-only: deactivate that level, author the two-level
 *    truth (`case` contains 6 → `bottle`; `bottle` contains 12 × 'fl oz'), and set
 *    avg_oz_per_each = 1 — the fluid-ounce density convention every drink now uses
 *    (volume leaves resolve through the avg BY DESIGN, recipe-math + pack-chain parity).
 *    Chain and flat then agree: one case = 72 oz. Then the 1:1 link (161 sold/21d).
 * ② WATER — "We only sell the branded c/o water". `Water Bottle` (133/21d) links to
 *    `Branded (C/O) Water` at 12 fl oz; `Dozen Waters` links to the same SKU at
 *    144 fl oz (12 bottles × 12 fl oz — one catering dozen).
 * ③ 24 MIXED SODAS — "Packed to order". NO LINK, deliberately and permanently until a
 *    standard mix exists: apportioning an operator-chosen assortment would put
 *    fabricated oz on eight SKUs at once. 2 sold/21d; recorded, not modeled.
 * ④ CHIPS — five per-flavor SKUs CREATED under Country Snacks (the Utz Ripples vendor):
 *    Sour Cream & Onion / Salt & Vinegar / Original / BBQ / Salt & Pepper, each
 *    `Bag of 1 × 2.75 oz` (weight — resolves through the registry, no avg needed,
 *    no density convention in play), sku_class 'raw', no pars (pars are Juan's).
 *    Then five 1:1 links (input = 2.75 oz per bag sold; 2,031 sales/21d combined).
 *    UTZ RIPPLES IS NOT TOUCHED: live shape `Box of 9 × 12.5 oz` already carries
 *    Juan's net weight, and its avg (2.2 — the Crunchy Boi handful basis) and its two
 *    recipe refs are load-bearing for menu costing.
 *    HELD: `Mini Chips- Utz Original` (232/21d) — a genuinely different pack whose net
 *    weight Juan has not given. One label read.
 * ⑤ PEPPER DENSITY REPAIR (the "hot and sweet peppers thing", stated plainly):
 *    seed 30 wrote the jars' pack facts in FL OZ, which makes `avg_oz_per_each` act as
 *    the per-fluid-ounce weight. Boar's Head Sweet Peppers carries avg = 4 — a stale
 *    per-pepper weight from the flat era — so one gallon jar computes as 128 × 4 =
 *    512 oz = THIRTY-TWO POUNDS, and a case as 2,048 oz. Hot Peppers (avg = 1) computes
 *    8 lb/jar, which is right for a gallon of brined peppers. Fix: Sweet 4 → 1,
 *    Banana NULL → 1 (currently unresolvable). Boar's Head rows only — the Baldor
 *    twins carry a different (weight-measure) shape that resolves on its own and is
 *    not touched here.
 *
 * REFUSALS: any menu item already produced by an active recipe · any SKU-create whose
 * name already exists at the vendor · the chain repair refuses if the active chain no
 * longer matches the shape probed above (someone edited it since — re-probe, don't clobber).
 *
 * DRY RUN IS THE DEFAULT; --execute is lead-gated on Juan's word (given 2026-08-28 —
 * this seed IS the execution of his three rulings + the chips order).
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local \
 *        scripts/seed/32-chips-water-lemonade-links.ts          -> DRY RUN
 *      ... --execute                                            -> WRITES (lead-gated)
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";

const EXECUTE = process.argv.includes("--execute");
const PHASE = "seed-32-chips-water-lemonade-2026-08-28";

type Sb = ReturnType<typeof getServiceRoleClient>;

function fail(msg: string): never { throw new Error(msg); }

async function skuByName(sb: Sb, name: string, vendorName?: string) {
  let q = sb.from("vendor_items").select("id, name, vendor_id, avg_oz_per_each, vendors!inner(name)").eq("name", name);
  if (vendorName) q = q.eq("vendors.name", vendorName);
  const { data, error } = await q.returns<Array<{ id: string; name: string; avg_oz_per_each: number | string | null; vendors: { name: string } }>>();
  if (error) fail(`skuByName ${name}: ${error.message}`);
  if (!data || data.length !== 1) fail(`skuByName ${name}${vendorName ? ` @ ${vendorName}` : ""}: expected exactly 1, got ${data?.length ?? 0}`);
  return data[0]!;
}

async function menuItemByName(sb: Sb, name: string) {
  const { data, error } = await sb.from("menu_items").select("id, name").eq("name", name)
    .returns<Array<{ id: string; name: string }>>();
  if (error) fail(`menuItemByName ${name}: ${error.message}`);
  if (!data || data.length !== 1) fail(`menuItemByName ${name}: expected exactly 1, got ${data?.length ?? 0}`);
  return data[0]!;
}

async function hasActiveRecipe(sb: Sb, menuItemId: string): Promise<string | null> {
  const { data, error } = await sb.from("recipe_outputs")
    .select("recipes!inner(name, active)").eq("output_menu_item_id", menuItemId).eq("recipes.active", true)
    .returns<Array<{ recipes: { name: string } }>>();
  if (error) fail(`hasActiveRecipe: ${error.message}`);
  return data?.[0]?.recipes.name ?? null;
}

/** The seed-31 link shape, byte-for-byte: consumer recipe, yield 1, one SKU input. */
async function authorLink(sb: Sb, args: {
  menuItemName: string; skuName: string; skuVendor?: string;
  quantity: number; unit: string; containerLabel: string; note: string;
}) {
  const mi = await menuItemByName(sb, args.menuItemName);
  const producer = await hasActiveRecipe(sb, mi.id);
  if (producer) { console.log(`  ✗ ${args.menuItemName} — REFUSED: already produced by "${producer}"`); return; }
  const sku = await skuByName(sb, args.skuName, args.skuVendor);
  const recipeName = `${args.menuItemName} (build)`;
  console.log(`  ✓ ${args.menuItemName}  ←  ${args.quantity} ${args.unit} of '${args.skuName}'   [${args.containerLabel}]`);
  console.log(`      ${args.note}`);
  if (!EXECUTE) return;
  const { data: rec, error: rErr } = await sb.from("recipes").insert({
    name: recipeName, recipe_type: "consumer", batch_yield: 1,
    directions: `Hand over one ${args.containerLabel}. Resale item — no prep. (Depletion link for ${args.menuItemName}: one ${args.containerLabel} = ${args.quantity} ${args.unit} of ${args.skuName}.)`,
    active: true, created_by: null, notes: `[seed ${PHASE}] ${args.note}`,
  }).select("id").single<{ id: string }>();
  if (rErr) fail(`insert recipe ${recipeName}: ${rErr.message}`);
  const { error: oErr } = await sb.from("recipe_outputs").insert({
    recipe_id: rec.id, output_item_id: null, output_menu_item_id: mi.id,
    yield: 1, output_container_label: args.containerLabel, display_order: 0, created_by: null,
  });
  if (oErr) fail(`insert output ${recipeName}: ${oErr.message}`);
  const { error: iErr } = await sb.from("recipe_inputs").insert({
    recipe_id: rec.id, component_sku_id: sku.id, component_item_id: null, component_product_id: null,
    quantity: args.quantity, unit: args.unit, portioned: false, display_order: 0, created_by: null,
  });
  if (iErr) fail(`insert input ${recipeName}: ${iErr.message}`);
  await audit({
    actorId: null, actorRole: null, action: "recipe.create", resourceTable: "recipes", resourceId: rec.id,
    metadata: { source: PHASE, name: recipeName, output_menu_item: args.menuItemName, input_sku: args.skuName, quantity: args.quantity, unit: args.unit },
    ipAddress: null, userAgent: null,
  });
}

async function main() {
  const sb = getServiceRoleClient();
  console.log(`\nSeed 32 — chips + water + lemonade + pepper density — ${EXECUTE ? "EXECUTE" : "DRY RUN"}\n`);

  // ── ① Natalie's chain repair ────────────────────────────────────────────────
  console.log(`── ① Natalie's Lemonade — chain repair + link ${"─".repeat(30)}`);
  const nat = await skuByName(sb, "Natalie's Lemonade");
  const { data: levels, error: lErr } = await sb.from("sku_pack_levels")
    .select("id, label, contains_qty, contains_level_id, contains_measure_unit, active")
    .eq("sku_id", nat.id).eq("active", true)
    .returns<Array<{ id: string; label: string; contains_qty: number | string; contains_level_id: string | null; contains_measure_unit: string | null; active: boolean }>>();
  if (lErr) fail(`natalie levels: ${lErr.message}`);
  const old = levels ?? [];
  const shapeOk = old.length === 1 && old[0]!.label === "case" && Number(old[0]!.contains_qty) === 6
    && old[0]!.contains_level_id == null && old[0]!.contains_measure_unit === "count";
  if (!shapeOk) {
    console.log(`  ✗ REFUSED: active chain is not the probed 'case = 6 count' shape (${old.length} level(s)) — re-probe before repairing.`);
  } else {
    console.log(`  ✓ deactivate 'case = 6 count' → author 'case' ⊃ 6 × 'bottle' ⊃ 12 × 'fl oz' · avg_oz_per_each ∅ → 1`);
    console.log(`      Chain and flat fields then AGREE: one case = 6 × 12 × 1 = 72 oz.`);
    if (EXECUTE) {
      const { error: dErr, count } = await sb.from("sku_pack_levels")
        .update({ active: false }, { count: "exact" }).eq("id", old[0]!.id);
      if (dErr) fail(`deactivate level: ${dErr.message}`);
      if (count === 0) fail("deactivate level: 0 rows");
      const { data: bottle, error: bErr } = await sb.from("sku_pack_levels").insert({
        sku_id: nat.id, label: "bottle", contains_qty: 12, contains_level_id: null,
        contains_measure_unit: "fl oz", display_ordinal: 1, active: true, created_by: null,
      }).select("id").single<{ id: string }>();
      if (bErr) fail(`insert bottle level: ${bErr.message}`);
      const { error: cErr } = await sb.from("sku_pack_levels").insert({
        sku_id: nat.id, label: "case", contains_qty: 6, contains_level_id: bottle.id,
        contains_measure_unit: null, display_ordinal: 0, active: true, created_by: null,
      });
      if (cErr) fail(`insert case level: ${cErr.message}`);
      const { error: aErr } = await sb.from("vendor_items").update({ avg_oz_per_each: 1 }).eq("id", nat.id);
      if (aErr) fail(`natalie avg: ${aErr.message}`);
      await audit({
        actorId: null, actorRole: null, action: "sku.pack_chain_update", resourceTable: "sku_pack_levels", resourceId: nat.id,
        metadata: { source: PHASE, name: "Natalie's Lemonade", before: "case = 6 count (avg NULL, unresolvable)", after: "case > 6 bottle > 12 fl oz, avg 1 (72 oz/case; agrees with flat fields)", ruling: "Juan 2026-08-28: 'Repair'" },
        ipAddress: null, userAgent: null,
      });
    }
  }
  await authorLink(sb, {
    menuItemName: "Natalie's Lemonade", skuName: "Natalie's Lemonade",
    quantity: 12, unit: "fl oz", containerLabel: "bottle",
    note: "161 sold/21d. Unblocked by the chain repair above.",
  });

  // ── ② Water ────────────────────────────────────────────────────────────────
  console.log(`\n── ② Water — the branded bottle (Juan: "we only sell the branded c/o water") ──`);
  await authorLink(sb, {
    menuItemName: "Water Bottle", skuName: "Branded (C/O) Water",
    quantity: 12, unit: "fl oz", containerLabel: "bottle",
    note: "133 sold/21d.",
  });
  await authorLink(sb, {
    menuItemName: "Dozen Waters", skuName: "Branded (C/O) Water",
    quantity: 144, unit: "fl oz", containerLabel: "dozen (12 bottles)",
    note: "7 sold/21d. 12 bottles × 12 fl oz — the catering dozen.",
  });

  // ── ③ 24 Mixed Sodas — recorded, not modeled ───────────────────────────────
  console.log(`\n── ③ 24 Mixed Sodas — NO LINK (Juan: "packed to order") ──`);
  console.log(`  ⏸ An operator-chosen assortment has no honest fixed recipe; apportioning would fabricate oz on 8 SKUs. 2 sold/21d. Revisit only if a standard mix ever exists.`);

  // ── ④ Chips ────────────────────────────────────────────────────────────────
  console.log(`\n── ④ Chips — five flavor SKUs (Country Snacks) + five links ──`);
  const { data: csVendor, error: vErr } = await sb.from("vendors").select("id").eq("name", "Country Snacks").single<{ id: string }>();
  if (vErr) fail(`Country Snacks vendor: ${vErr.message}`);
  const flavors: Array<{ skuName: string; menuItemName: string; sold: string }> = [
    { skuName: "Utz Sour Cream & Onion", menuItemName: "Utz Sour Cream & Onion", sold: "553" },
    { skuName: "Utz Salt & Vinegar", menuItemName: "Utz Salt & Vinegar Chips", sold: "500" },
    { skuName: "Utz Original", menuItemName: "Utz Original Chips", sold: "431" },
    { skuName: "Utz BBQ", menuItemName: "Utz BBQ Chips", sold: "376" },
    { skuName: "Utz Salt & Pepper", menuItemName: "Salt & Pepper Chips", sold: "171" },
  ];
  for (const f of flavors) {
    const { data: existing, error: eErr } = await sb.from("vendor_items")
      .select("id").eq("name", f.skuName).eq("vendor_id", csVendor.id)
      .returns<Array<{ id: string }>>();
    if (eErr) fail(`${f.skuName} existence: ${eErr.message}`);
    if ((existing ?? []).length > 0) {
      console.log(`  ✗ ${f.skuName} — SKU already exists, create REFUSED (link still attempted below).`);
    } else {
      console.log(`  ＋ SKU '${f.skuName}' — Country Snacks · Bag of 1 × 2.75 oz (weight; Juan's net WT) · sku_class raw · no pars`);
      if (EXECUTE) {
        const { data: created, error: cErr } = await sb.from("vendor_items").insert({
          name: f.skuName, vendor_id: csVendor.id, active: true, sku_class: "raw",
          pack_format: "Bag", units_per_pack: 1, each_size: 2.75, each_measure: "oz",
          inventory_only: false,
        }).select("id").single<{ id: string }>();
        if (cErr) fail(`create ${f.skuName}: ${cErr.message}`);
        await audit({
          actorId: null, actorRole: null, action: "vendor_item.create", resourceTable: "vendor_items", resourceId: created.id,
          metadata: { source: PHASE, name: f.skuName, vendor: "Country Snacks", pack: "Bag of 1 x 2.75 oz", provenance: "Juan 2026-08-28: flavored bags net WT 2.75 oz" },
          ipAddress: null, userAgent: null,
        });
      }
    }
    if (EXECUTE || (existing ?? []).length > 0) {
      await authorLink(sb, {
        menuItemName: f.menuItemName, skuName: f.skuName, skuVendor: "Country Snacks",
        quantity: 2.75, unit: "oz", containerLabel: "bag",
        note: `${f.sold} sold/21d. One 2.75 oz bag sold whole.`,
      });
    } else {
      console.log(`  ✓ ${f.menuItemName}  ←  2.75 oz of '${f.skuName}'   [bag]   (${f.sold} sold/21d — authored on execute, after the SKU create)`);
    }
  }
  console.log(`  ⏸ Mini Chips- Utz Original (232/21d) — HELD: a different pack, net weight not given. One label read.`);
  console.log(`  · Utz Ripples untouched — Box of 9 × 12.5 oz already matches Juan's net WT; avg 2.2 is the Crunchy Boi handful basis with 2 live recipe refs.`);

  // ── ⑤ Pepper density repair ────────────────────────────────────────────────
  console.log(`\n── ⑤ Pepper density (Boar's Head jars) ──`);
  const sweet = await skuByName(sb, "Sweet Peppers", "Boar's Head");
  const banana = await skuByName(sb, "Banana Peppers", "Boar's Head");
  console.log(`  ✓ Sweet Peppers (BH) — avg 4 → 1   (jar was computing 128 × 4 = 512 oz = 32 lb; now 8 lb, matching Hot Peppers)`);
  console.log(`  ✓ Banana Peppers (BH) — avg ∅ → 1   (was unresolvable)`);
  if (EXECUTE) {
    for (const [sku, before] of [[sweet, "4"], [banana, null]] as const) {
      const { error } = await sb.from("vendor_items").update({ avg_oz_per_each: 1 }).eq("id", sku.id);
      if (error) fail(`pepper avg ${sku.name}: ${error.message}`);
      await audit({
        actorId: null, actorRole: null, action: "vendor_item.update", resourceTable: "vendor_items", resourceId: sku.id,
        metadata: { source: PHASE, name: sku.name, field: "avg_oz_per_each", before, after: 1, why: "fl-oz density convention; the old value was a per-pepper weight acting as per-fl-oz density after seed 30's volume pack facts" },
        ipAddress: null, userAgent: null,
      });
    }
  }

  console.log(`\n${EXECUTE ? "WRITTEN." : "Nothing written (dry run)."}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
