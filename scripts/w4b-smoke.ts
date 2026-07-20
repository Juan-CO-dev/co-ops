/**
 * W4b seeded dormant smoke — regression harness for catering SKU-DEMAND
 * (reserved prep-demand → recipe flatten → per-SKU oz by date → content-oz/on-hand
 * → advisory shortfall / order-more signal).
 *
 * Run against the service-role DB (the engine is DORMANT in prod — 0 catering menu
 * rows — so this smoke SEEDS its own temp data, drives the REAL lib code paths, and
 * hard-deletes everything it created in a finally block, leaving ZERO residue):
 *   npx tsx --env-file=.env.local scripts/w4b-smoke.ts
 *
 * Mirrors scripts/w4a-smoke.ts structure: env via --env-file, service-role client via
 * getServiceRoleClient, capture-ids-then-rollback discipline. audit_log rows stay
 * (the "audit_log is permanent" convention — the record of the smoke is valid evidence).
 *
 * Covers (all against a real active location, real level-10 cgs actor, real recipes):
 *   - Seed: 3 SKUs (vendor_items) + 3 recipes wiring them to 2 catering extras (items)
 *     and 1 sub (menu_items), a delivery for on-hand, a package with ONLY a choice slot,
 *     and a 'quote_sent' lead + accepted quote (event_date 2026-08-20) with 4 lines.
 *   - reservePrepDemand (W4a) populates the catering_prep_demand ledger the SKU layer reads.
 *   - loadCateringSkuDemand over [NEED_DATE, NEED_DATE] → exactly 3 SKU rows, covering
 *     all three branches:
 *       SKU_SHORT  content 80 oz, on-hand 1 pack; extra recipe 2 oz/unit × qty 50
 *                  → demand 100 oz > 80 → shortfallOz 20, suggestOrderPacks 1, short=TRUE.
 *       SKU_OK     content 100 oz, on-hand 2 packs; extra recipe 1 oz/unit × qty 5
 *                  → demand 5 oz < 200 → shortfallOz 0, short=false, suggest null.
 *       SKU_OZONLY pack fields null → contentOz null (oz-only display); sub recipe
 *                  3 oz/sub × qty 6 half (×0.5) → demand 9 oz; packs/onHandOz/shortfall
 *                  all null, short=false.
 *   - The unresolved choice slot → unresolvedChoiceLines === 1 (never flattened);
 *     noRecipeLines === 0 (every concrete ref resolves through a seeded recipe).
 *
 * Flatten math note (verified against lib/prep-consumption.ts + lib/recipe-math.ts):
 * per-unit SKU oz = batch input oz × output share ÷ OUTPUT yield (recipes.batch_yield is
 * only a >0 validity gate in the flatten). All seeded recipes use batch_yield 1, single
 * output yield 1, inputs in unit 'oz' (measure_units 'oz' = weight, to_base_factor 1 —
 * verified live), so input quantity IS the per-unit oz. All expected values are exact.
 */

import assert from "node:assert/strict";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { reservePrepDemand } from "@/lib/catering/prep-demand";
import { loadCateringSkuDemand } from "@/lib/catering/sku-demand";
import type { AuthContext } from "@/lib/session";

type Sb = ReturnType<typeof getServiceRoleClient>;

// Fixed future date (never `new Date()` — deterministic; distinct from w4a's 2026-08-15
// so residue from either smoke can never cross-contaminate the other's window).
const NEED_DATE = "2026-08-20";
const DELIVERY_DATE = "2026-08-01";

const SKU_SHORT_NAME = "W4B SMOKE Sku Short";
const SKU_OK_NAME = "W4B SMOKE Sku Ok";
const SKU_OZONLY_NAME = "W4B SMOKE Sku OzOnly";
const ITEM_SHORT_NAME = "W4B SMOKE Extra Short";
const ITEM_OK_NAME = "W4B SMOKE Extra Ok";
const SUB_NAME = "W4B SMOKE Sub OzOnly";
const RECIPE_SHORT_NAME = "W4B SMOKE Recipe Short";
const RECIPE_OK_NAME = "W4B SMOKE Recipe Ok";
const RECIPE_SUB_NAME = "W4B SMOKE Recipe Sub";
const CHOICE_LABEL = "W4B SMOKE Choose your sub";
// Timestamped label → unique slug (catering_packages.slug is unique).
const PKG_SLUG = `w4b-smoke-platter-${Date.now()}`;
const PKG_LABEL = `W4B SMOKE Platter ${Date.now()}`;

async function main() {
  const sb: Sb = getServiceRoleClient();
  console.log("W4b dormant smoke (catering SKU-demand)\n");

  // ── 1. An existing active location + a real level-≥6 actor (cgs = level 10) ───
  const { data: loc, error: locErr } = await sb
    .from("locations")
    .select("id, name")
    .eq("active", true)
    .limit(1)
    .maybeSingle<{ id: string; name: string }>();
  if (locErr) throw new Error(`load location: ${locErr.message}`);
  if (!loc) throw new Error("no active location to seed against");
  const locationId = loc.id;
  console.log(`seeding at location: ${loc.name} (${locationId})`);

  const { data: cgsUser, error: userErr } = await sb
    .from("users")
    .select("id, role")
    .eq("role", "cgs")
    .eq("active", true)
    .limit(1)
    .maybeSingle<{ id: string; role: string }>();
  if (userErr) throw new Error(`load cgs actor: ${userErr.message}`);
  if (!cgsUser) throw new Error("no active cgs user to act as");
  // Minimal actor: the catering libs read only actor.user.id (created_by FK) and
  // actor.user.role (getRoleLevel). cgs is level 10 ≥ PREP_DEMAND_READ_MIN (6).
  const actor = { user: { id: cgsUser.id, role: cgsUser.role }, locations: [] } as unknown as AuthContext;
  console.log(`acting as: cgs ${cgsUser.id}`);

  // Ids captured for rollback (populated as we seed).
  let seededVendorId: string | null = null; // only if no vendor existed to borrow
  let skuShortId: string | null = null;
  let skuOkId: string | null = null;
  let skuOzOnlyId: string | null = null;
  let itemShortId: string | null = null;
  let itemOkId: string | null = null;
  let subId: string | null = null;
  const recipeIds: string[] = [];
  let deliveryId: string | null = null;
  let packageId: string | null = null;
  let pipelineId: string | null = null;
  let quoteId: string | null = null;

  try {
    // ── 2. SEED (capture every id) ───────────────────────────────────────────────
    // A vendor for the delivery header (vendor_deliveries.vendor_id NOT NULL).
    // Borrow an existing vendor when one exists (no residue concern); seed + track otherwise.
    let vendorId: string;
    const { data: vend, error: vendErr } = await sb
      .from("vendors")
      .select("id, name")
      .eq("active", true)
      .limit(1)
      .maybeSingle<{ id: string; name: string }>();
    if (vendErr) throw new Error(`load vendor: ${vendErr.message}`);
    if (vend) {
      vendorId = vend.id;
      console.log(`borrowing existing vendor: ${vend.name} (${vendorId})`);
    } else {
      const { data: newVend, error: nvErr } = await sb
        .from("vendors")
        .insert({ name: "W4B SMOKE Vendor", category: "other", active: true, created_by: cgsUser.id })
        .select("id")
        .single<{ id: string }>();
      if (nvErr) throw new Error(`seed vendor: ${nvErr.message}`);
      seededVendorId = newVend.id;
      vendorId = newVend.id;
      console.log(`seeded vendor: ${vendorId}`);
    }

    // 3 SKUs (vendor_items). content_oz = units_per_pack × each_size × ozPerMeasureUnit.
    // each_measure 'oz' is weight/to_base_factor 1 (verified live) → content = units × size.
    // pack_format 'case' (NOT 'oz' — ozForRecipeInput's pack branch matches unit===pack_format,
    // and our recipe inputs are in 'oz'; keeping labels disjoint keeps the measure branch).
    const { data: skuShort, error: ssErr } = await sb
      .from("vendor_items")
      .insert({
        name: SKU_SHORT_NAME,
        vendor_id: vendorId,
        active: true,
        pack_format: "case",
        units_per_pack: 1,
        each_size: 80,
        each_measure: "oz",
      })
      .select("id")
      .single<{ id: string }>();
    if (ssErr) throw new Error(`seed SKU_SHORT: ${ssErr.message}`);
    skuShortId = skuShort.id;

    const { data: skuOk, error: soErr } = await sb
      .from("vendor_items")
      .insert({
        name: SKU_OK_NAME,
        vendor_id: vendorId,
        active: true,
        pack_format: "case",
        units_per_pack: 1,
        each_size: 100,
        each_measure: "oz",
      })
      .select("id")
      .single<{ id: string }>();
    if (soErr) throw new Error(`seed SKU_OK: ${soErr.message}`);
    skuOkId = skuOk.id;

    // Pack fields null → skuContentOz null → the oz-only branch.
    const { data: skuOz, error: szErr } = await sb
      .from("vendor_items")
      .insert({
        name: SKU_OZONLY_NAME,
        vendor_id: vendorId,
        active: true,
        pack_format: null,
        units_per_pack: null,
        each_size: null,
        each_measure: null,
      })
      .select("id")
      .single<{ id: string }>();
    if (szErr) throw new Error(`seed SKU_OZONLY: ${szErr.message}`);
    skuOzOnlyId = skuOz.id;

    // 2 catering extras (items) — mirror w4a's insert shape.
    const { data: itemShort, error: isErr } = await sb
      .from("items")
      .insert({
        name: ITEM_SHORT_NAME,
        menu_price: 2.0,
        active: true,
        catering_available: true,
        tracking_type: "portioned",
        batch_yield: 1,
        default_par: 10,
      })
      .select("id")
      .single<{ id: string }>();
    if (isErr) throw new Error(`seed short item: ${isErr.message}`);
    itemShortId = itemShort.id;

    const { data: itemOk, error: ioErr } = await sb
      .from("items")
      .insert({
        name: ITEM_OK_NAME,
        menu_price: 3.0,
        active: true,
        catering_available: true,
        tracking_type: "portioned",
        batch_yield: 1,
        default_par: 10,
      })
      .select("id")
      .single<{ id: string }>();
    if (ioErr) throw new Error(`seed ok item: ${ioErr.message}`);
    itemOkId = itemOk.id;

    // The sub (menu_items) — catering-available, half-portionable.
    const { data: sub, error: subErr } = await sb
      .from("menu_items")
      .insert({
        name: SUB_NAME,
        menu_price: 12.0,
        active: true,
        catering_available: true,
        catering_portionable: true,
        section: "W4B Smoke Subs",
      })
      .select("id")
      .single<{ id: string }>();
    if (subErr) throw new Error(`seed sub: ${subErr.message}`);
    subId = sub.id;

    // 3 recipes (batch_yield 1, single output yield 1, inputs in 'oz'):
    //   recipeShort: SKU_SHORT 2 oz → itemShort  (2 oz per extra)
    //   recipeOk:    SKU_OK    1 oz → itemOk     (1 oz per extra)
    //   recipeSub:   SKU_OZONLY 3 oz → sub       (3 oz per whole sub)
    async function seedRecipe(args: {
      name: string;
      inputSkuId: string;
      inputQtyOz: number;
      outputItemId?: string;
      outputMenuItemId?: string;
    }): Promise<string> {
      const { data: rec, error: rErr } = await sb
        .from("recipes")
        .insert({
          name: args.name,
          recipe_type: "production",
          batch_yield: 1,
          active: true,
          created_by: cgsUser!.id,
        })
        .select("id")
        .single<{ id: string }>();
      if (rErr) throw new Error(`seed recipe ${args.name}: ${rErr.message}`);
      const recipeId = rec.id;
      recipeIds.push(recipeId);
      const { error: inErr } = await sb.from("recipe_inputs").insert({
        recipe_id: recipeId,
        component_sku_id: args.inputSkuId,
        component_item_id: null,
        quantity: args.inputQtyOz,
        unit: "oz",
        portioned: false,
        display_order: 0,
        created_by: cgsUser!.id,
      });
      if (inErr) throw new Error(`seed recipe input ${args.name}: ${inErr.message}`);
      const { error: outErr } = await sb.from("recipe_outputs").insert({
        recipe_id: recipeId,
        output_item_id: args.outputItemId ?? null,
        output_menu_item_id: args.outputMenuItemId ?? null,
        yield: 1,
        display_order: 0,
        created_by: cgsUser!.id,
      });
      if (outErr) throw new Error(`seed recipe output ${args.name}: ${outErr.message}`);
      return recipeId;
    }
    await seedRecipe({ name: RECIPE_SHORT_NAME, inputSkuId: skuShortId, inputQtyOz: 2, outputItemId: itemShortId });
    await seedRecipe({ name: RECIPE_OK_NAME, inputSkuId: skuOkId, inputQtyOz: 1, outputItemId: itemOkId });
    await seedRecipe({ name: RECIPE_SUB_NAME, inputSkuId: skuOzOnlyId, inputQtyOz: 3, outputMenuItemId: subId });

    // On-hand: one delivery at the location w/ 2 lines — SKU_SHORT 1 pack, SKU_OK 2 packs.
    // (SKU_OZONLY gets NO delivery → onHandPacks 0; irrelevant to its null-content branch.)
    const { data: del, error: delErr } = await sb
      .from("vendor_deliveries")
      .insert({
        vendor_id: vendorId,
        location_id: locationId,
        delivery_date: DELIVERY_DATE,
        received_by: cgsUser.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (delErr) throw new Error(`seed delivery: ${delErr.message}`);
    deliveryId = del.id;
    const { error: dliErr } = await sb.from("vendor_delivery_items").insert([
      { delivery_id: deliveryId, vendor_item_id: skuShortId, qty_received: 1, created_by: cgsUser.id },
      { delivery_id: deliveryId, vendor_item_id: skuOkId, qty_received: 2, created_by: cgsUser.id },
    ]);
    if (dliErr) throw new Error(`seed delivery items: ${dliErr.message}`);

    // The package — ONLY a choice slot (no fixed component), so its single demand row is
    // the unresolvedChoiceLines counter and never adds SKU demand / noRecipeLines.
    const { data: pkg, error: pkgErr } = await sb
      .from("catering_packages")
      .insert({
        location_id: locationId,
        slug: PKG_SLUG,
        label_en: PKG_LABEL,
        pricing_mode: "per_platter",
        price_cents: 2000,
        active: true,
        created_by: cgsUser.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (pkgErr) throw new Error(`seed package: ${pkgErr.message}`);
    packageId = pkg.id;

    const { error: ccErr } = await sb
      .from("catering_package_items")
      .insert({
        package_id: packageId,
        slot_type: "choice",
        description: CHOICE_LABEL,
        quantity: 1,
        active: true,
        created_by: cgsUser.id,
      });
    if (ccErr) throw new Error(`seed choice component: ${ccErr.message}`);

    // The pipeline lead + its current accepted quote (event_date = NEED_DATE).
    const { data: pipe, error: pipeErr } = await sb
      .from("catering_pipeline")
      .insert({
        contact_name: "W4B Smoke Lead",
        stage: "quote_sent",
        location_id: locationId,
        event_date: NEED_DATE,
        created_by: cgsUser.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (pipeErr) throw new Error(`seed pipeline lead: ${pipeErr.message}`);
    pipelineId = pipe.id;

    const { data: quote, error: quoteErr } = await sb
      .from("catering_quotes")
      .insert({
        root_id: null, // v1 convention (createQuote writes v1 with root_id NULL)
        version: 1,
        pipeline_id: pipelineId,
        location_id: locationId,
        status: "accepted",
        event_date: NEED_DATE,
        created_by: cgsUser.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (quoteErr) throw new Error(`seed quote: ${quoteErr.message}`);
    quoteId = quote.id;

    // 4 quote lines: short extra qty 50; ok extra qty 5; sub qty 6 half; package qty 1.
    // NOTE: the package line (both refs null) MUST carry a description — the live
    // catering_quote_items_identified CHECK requires description OR item_id OR menu_item_id.
    const { error: qiErr } = await sb.from("catering_quote_items").insert([
      {
        quote_id: quoteId,
        item_id: itemShortId,
        quantity: 50,
        portion: null,
        unit_price_cents: 170,
        line_total_cents: 8500,
        display_order: 0,
        created_by: cgsUser.id,
      },
      {
        quote_id: quoteId,
        item_id: itemOkId,
        quantity: 5,
        portion: null,
        unit_price_cents: 255,
        line_total_cents: 1275,
        display_order: 1,
        created_by: cgsUser.id,
      },
      {
        quote_id: quoteId,
        menu_item_id: subId,
        quantity: 6,
        portion: "half",
        unit_price_cents: 510,
        line_total_cents: 3060,
        display_order: 2,
        created_by: cgsUser.id,
      },
      {
        quote_id: quoteId,
        package_id: packageId,
        description: PKG_LABEL,
        quantity: 1,
        portion: null,
        unit_price_cents: 2000,
        line_total_cents: 2000,
        display_order: 3,
        created_by: cgsUser.id,
      },
    ]);
    if (qiErr) throw new Error(`seed quote items: ${qiErr.message}`);
    console.log(
      `  seeded: 3 SKUs (content 80/100/null oz), 3 recipes (2/1/3 oz per unit), ` +
        `on-hand 1/2/0 packs, package w/ choice slot, lead ${pipelineId}, quote ${quoteId} (4 lines, event ${NEED_DATE})`,
    );

    // ── 3. W4a reserve → the prep-demand ledger the SKU layer reads ──────────────
    await reservePrepDemand(actor, pipelineId);
    const { data: demandRows, error: dErr } = await sb
      .from("catering_prep_demand")
      .select("id, status")
      .eq("pipeline_id", pipelineId)
      .returns<Array<{ id: string; status: string }>>();
    if (dErr) throw new Error(`load prep demand rows: ${dErr.message}`);
    assert.equal(
      (demandRows ?? []).length,
      4,
      `reserve resolves the 4 quote lines into exactly 4 demand rows (got ${(demandRows ?? []).length})`,
    );
    assert.ok((demandRows ?? []).every((r) => r.status === "reserved"), "all demand rows start 'reserved'");
    console.log("  ✓ reservePrepDemand: 4 reserved rows (2 extras, 1 half sub, 1 choice)");

    // ── 4. loadCateringSkuDemand — flatten → per-SKU demand vs on-hand ───────────
    // (Window is ours alone: prod catering demand assumed empty at this location/date.)
    const res = await loadCateringSkuDemand(actor, { locationId, from: NEED_DATE, to: NEED_DATE });

    assert.equal(res.rows.length, 3, `exactly 3 SKU rows (got ${res.rows.length})`);
    assert.equal(res.unresolvedChoiceLines, 1, "the choice slot is counted, never flattened");
    assert.equal(res.noRecipeLines, 0, "every concrete ref resolves through a seeded recipe");

    // SKU_SHORT — content known, demand > on-hand → the SHORT branch.
    // 50 extras × 2 oz = 100 oz demand; content 80; on-hand 1 pack = 80 oz → 20 oz short → 1 pack.
    const shortRow = res.rows.find((r) => r.skuId === skuShortId);
    assert.ok(shortRow, "SKU_SHORT row present");
    assert.equal(shortRow.skuName, SKU_SHORT_NAME, "SKU_SHORT name resolves");
    assert.equal(shortRow.contentOz, 80, "SKU_SHORT contentOz = 1 × 80 × 1 = 80");
    assert.equal(shortRow.totalOz, 100, "SKU_SHORT totalOz = 50 × 2 oz = 100");
    assert.equal(shortRow.totalPacks, 1.25, "SKU_SHORT totalPacks = 100 / 80 = 1.25");
    assert.equal(shortRow.onHandPacks, 1, "SKU_SHORT onHandPacks = 1 (delivery qty 1)");
    assert.equal(shortRow.onHandOz, 80, "SKU_SHORT onHandOz = 1 × 80 = 80");
    assert.equal(shortRow.shortfallOz, 20, "SKU_SHORT shortfallOz = 100 − 80 = 20");
    assert.equal(shortRow.suggestOrderPacks, 1, "SKU_SHORT suggestOrderPacks = ceil(20/80) = 1");
    assert.equal(shortRow.short, true, "SKU_SHORT short = TRUE (the short branch)");
    assert.deepEqual(
      shortRow.byDate,
      [{ needDate: NEED_DATE, oz: 100 }],
      "SKU_SHORT byDate = one cell, all 100 oz on the event date",
    );
    console.log("  ✓ SKU_SHORT: 100 oz demand vs 80 on-hand → short, order 1 pack");

    // SKU_OK — content known, demand < on-hand → NOT short.
    // 5 extras × 1 oz = 5 oz demand; content 100; on-hand 2 packs = 200 oz.
    const okRow = res.rows.find((r) => r.skuId === skuOkId);
    assert.ok(okRow, "SKU_OK row present");
    assert.equal(okRow.skuName, SKU_OK_NAME, "SKU_OK name resolves");
    assert.equal(okRow.contentOz, 100, "SKU_OK contentOz = 1 × 100 × 1 = 100");
    assert.equal(okRow.totalOz, 5, "SKU_OK totalOz = 5 × 1 oz = 5");
    assert.equal(okRow.onHandPacks, 2, "SKU_OK onHandPacks = 2 (delivery qty 2)");
    assert.equal(okRow.onHandOz, 200, "SKU_OK onHandOz = 2 × 100 = 200");
    assert.equal(okRow.shortfallOz, 0, "SKU_OK shortfallOz = max(0, 5 − 200) = 0");
    assert.equal(okRow.suggestOrderPacks, null, "SKU_OK suggestOrderPacks null (no shortfall)");
    assert.equal(okRow.short, false, "SKU_OK short = false");
    console.log("  ✓ SKU_OK: 5 oz demand vs 200 on-hand → not short");

    // SKU_OZONLY — pack fields null → contentOz null → the oz-only branch.
    // Sub recipe 3 oz/whole × qty 6 × half (0.5) = 9 oz; all pack-derived fields null.
    const ozRow = res.rows.find((r) => r.skuId === skuOzOnlyId);
    assert.ok(ozRow, "SKU_OZONLY row present");
    assert.equal(ozRow.skuName, SKU_OZONLY_NAME, "SKU_OZONLY name resolves");
    assert.equal(ozRow.contentOz, null, "SKU_OZONLY contentOz null (pack fields incomplete)");
    assert.equal(ozRow.totalOz, 9, "SKU_OZONLY totalOz = 6 × 0.5 × 3 oz = 9");
    assert.equal(ozRow.totalPacks, null, "SKU_OZONLY totalPacks null (no content)");
    assert.equal(ozRow.onHandPacks, 0, "SKU_OZONLY onHandPacks = 0 (no delivery)");
    assert.equal(ozRow.onHandOz, null, "SKU_OZONLY onHandOz null (no content)");
    assert.equal(ozRow.shortfallOz, null, "SKU_OZONLY shortfallOz null (unknowable without content)");
    assert.equal(ozRow.suggestOrderPacks, null, "SKU_OZONLY suggestOrderPacks null");
    assert.equal(ozRow.short, false, "SKU_OZONLY short = false (null shortfall never flags)");
    console.log("  ✓ SKU_OZONLY: 9 oz demand, contentOz null → oz-only row, never short");

    console.log("\nw4b-smoke: PASS");
  } finally {
    // ── Rollback: hard-delete every seeded row (leave ZERO residue) ───────────────
    console.log("\ncleanup");
    // FK-safe order: prep_demand → quote_items → quotes → slot_options → package_items
    // → packages → recipe_inputs/outputs → recipes → delivery_items → deliveries →
    // vendor_items → menu_items → items → pipeline → (seeded vendor last).
    if (pipelineId) await sb.from("catering_prep_demand").delete().eq("pipeline_id", pipelineId);
    if (quoteId) {
      await sb.from("catering_quote_items").delete().eq("quote_id", quoteId);
      await sb.from("catering_quotes").delete().eq("id", quoteId);
    }
    let compIds: string[] = [];
    if (packageId) {
      const { data: comps } = await sb
        .from("catering_package_items")
        .select("id")
        .eq("package_id", packageId)
        .returns<Array<{ id: string }>>();
      compIds = (comps ?? []).map((c) => c.id);
      if (compIds.length > 0) {
        await sb.from("catering_package_slot_options").delete().in("package_item_id", compIds);
        await sb.from("catering_package_items").delete().eq("package_id", packageId);
      }
      await sb.from("catering_packages").delete().eq("id", packageId);
    }
    if (recipeIds.length > 0) {
      await sb.from("recipe_inputs").delete().in("recipe_id", recipeIds);
      await sb.from("recipe_outputs").delete().in("recipe_id", recipeIds);
      await sb.from("recipes").delete().in("id", recipeIds);
    }
    if (deliveryId) {
      await sb.from("vendor_delivery_items").delete().eq("delivery_id", deliveryId);
      await sb.from("vendor_deliveries").delete().eq("id", deliveryId);
    }
    const skuIds = [skuShortId, skuOkId, skuOzOnlyId].filter((x): x is string => x !== null);
    if (skuIds.length > 0) await sb.from("vendor_items").delete().in("id", skuIds);
    if (subId) await sb.from("menu_items").delete().eq("id", subId);
    const itemIds = [itemShortId, itemOkId].filter((x): x is string => x !== null);
    if (itemIds.length > 0) await sb.from("items").delete().in("id", itemIds);
    if (pipelineId) await sb.from("catering_pipeline").delete().eq("id", pipelineId);
    if (seededVendorId) await sb.from("vendors").delete().eq("id", seededVendorId);

    // Verify zero residue (re-select by seeded ids/names → expect none).
    const { data: leftDemand } = pipelineId
      ? await sb.from("catering_prep_demand").select("id").eq("pipeline_id", pipelineId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftQuoteItems } = quoteId
      ? await sb.from("catering_quote_items").select("id").eq("quote_id", quoteId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftQuotes } = quoteId
      ? await sb.from("catering_quotes").select("id").eq("id", quoteId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftOpts } = compIds.length
      ? await sb.from("catering_package_slot_options").select("id").in("package_item_id", compIds).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftComps } = packageId
      ? await sb.from("catering_package_items").select("id").eq("package_id", packageId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftPkgs } = packageId
      ? await sb.from("catering_packages").select("id").eq("id", packageId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftRecipeInputs } = recipeIds.length
      ? await sb.from("recipe_inputs").select("id").in("recipe_id", recipeIds).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftRecipeOutputs } = recipeIds.length
      ? await sb.from("recipe_outputs").select("id").in("recipe_id", recipeIds).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftRecipes } = recipeIds.length
      ? await sb.from("recipes").select("id").in("id", recipeIds).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftDelItems } = deliveryId
      ? await sb.from("vendor_delivery_items").select("id").eq("delivery_id", deliveryId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftDeliveries } = deliveryId
      ? await sb.from("vendor_deliveries").select("id").eq("id", deliveryId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftSkus } = await sb
      .from("vendor_items")
      .select("id")
      .in("name", [SKU_SHORT_NAME, SKU_OK_NAME, SKU_OZONLY_NAME])
      .returns<Array<{ id: string }>>();
    const { data: leftSubs } = await sb
      .from("menu_items")
      .select("id")
      .eq("name", SUB_NAME)
      .returns<Array<{ id: string }>>();
    const { data: leftItems } = await sb
      .from("items")
      .select("id")
      .in("name", [ITEM_SHORT_NAME, ITEM_OK_NAME])
      .returns<Array<{ id: string }>>();
    const { data: leftPipes } = pipelineId
      ? await sb.from("catering_pipeline").select("id").eq("id", pipelineId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftVendors } = seededVendorId
      ? await sb.from("vendors").select("id").eq("id", seededVendorId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const residue = {
      demand: (leftDemand ?? []).length,
      quoteItems: (leftQuoteItems ?? []).length,
      quotes: (leftQuotes ?? []).length,
      slotOptions: (leftOpts ?? []).length,
      packageItems: (leftComps ?? []).length,
      packages: (leftPkgs ?? []).length,
      recipeInputs: (leftRecipeInputs ?? []).length,
      recipeOutputs: (leftRecipeOutputs ?? []).length,
      recipes: (leftRecipes ?? []).length,
      deliveryItems: (leftDelItems ?? []).length,
      deliveries: (leftDeliveries ?? []).length,
      skus: (leftSkus ?? []).length,
      subs: (leftSubs ?? []).length,
      items: (leftItems ?? []).length,
      pipeline: (leftPipes ?? []).length,
      vendors: (leftVendors ?? []).length,
    };
    console.log(`  residue: ${JSON.stringify(residue)}`);
    if (Object.values(residue).some((n) => n > 0)) {
      throw new Error(`cleanup left residue: ${JSON.stringify(residue)}`);
    }
    console.log("  ✓ zero residue");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
