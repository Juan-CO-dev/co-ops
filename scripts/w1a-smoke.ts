/**
 * W1a seeded dormant smoke — regression harness for the catering price-derivation
 * substrate (menu_items subs in ¼/½/whole portions + items extras whole, all derived
 * from the regular sell price × a section/entity catering rate).
 *
 * Run against the service-role DB (the engine is DORMANT in prod — 0 catering menu
 * rows — so this smoke SEEDS its own temp data, drives the REAL lib code paths, and
 * hard-deletes everything it created in a finally block, leaving ZERO residue):
 *   npx tsx --env-file=.env.local scripts/w1a-smoke.ts
 *
 * Mirrors scripts/portal-3-smoke.ts structure: env via --env-file, service-role client
 * via getServiceRoleClient, capture-ids-then-rollback discipline. audit_log rows stay
 * (the "audit_log is permanent" convention — the record of the smoke is valid evidence).
 *
 * Covers (all against a real active location):
 *   - loadPublicCateringMenu derivation: a portionable sub @ $12.00 under a section rate
 *     of 8500bps → {whole:1020, half:510, quarter:255}; a non-portionable extra @ $2.00
 *     under a per-item rate of 9000bps → portionPricesCents === null, unitPriceCents 180.
 *   - submitOrder server price authority: a half-portion sub line prices from the derived
 *     portion table (unit 510, line_total 1020 for qty 2) and persists portion + FK.
 */

import assert from "node:assert/strict";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadPublicCateringMenu } from "@/lib/portal/menu";
import { submitOrder } from "@/lib/portal/orders";

type Sb = ReturnType<typeof getServiceRoleClient>;

const CUSTOMER_EMAIL = "co-w1a-smoke@example.com";
const SUB_NAME = "W1A SMOKE Sub";
const EXTRA_NAME = "W1A SMOKE Chips";

async function main() {
  const sb: Sb = getServiceRoleClient();
  console.log("W1a dormant smoke\n");

  // ── 1. An existing active location ─────────────────────────────────────────────
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

  // Ids captured for rollback (populated as we seed / as submitOrder creates rows).
  let subId: string | null = null;
  let extraId: string | null = null;
  let sectionRuleId: string | null = null;
  let itemRuleId: string | null = null;
  let customerId: string | null = null;
  let quoteId: string | null = null;
  let pipelineId: string | null = null;

  try {
    // ── 2. SEED (capture every id) ───────────────────────────────────────────────
    // The sub (menu_items) — portionable, catering-available, $12.00, section 'Subs'.
    const { data: sub, error: subErr } = await sb
      .from("menu_items")
      .insert({
        name: SUB_NAME,
        menu_price: 12.0,
        active: true,
        catering_available: true,
        catering_portionable: true,
        section: "Subs",
      })
      .select("id")
      .single<{ id: string }>();
    if (subErr) throw new Error(`seed sub: ${subErr.message}`);
    subId = sub.id;

    // The extra (items) — a catering extra, whole only, $2.00. tracking_type + batch_yield
    // are NOT NULL (defaults exist, but set them explicitly for clarity).
    const { data: extra, error: extraErr } = await sb
      .from("items")
      .insert({
        name: EXTRA_NAME,
        menu_price: 2.0,
        active: true,
        catering_available: true,
        tracking_type: "portioned",
        batch_yield: 1,
      })
      .select("id")
      .single<{ id: string }>();
    if (extraErr) throw new Error(`seed extra: ${extraErr.message}`);
    extraId = extra.id;

    // Section rate rule: Subs → 8500 bps (85% of regular).
    const { data: sectionRule, error: srErr } = await sb
      .from("catering_rate_rules")
      .insert({ location_id: locationId, scope: "section", scope_ref: "Subs", rate_bps: 8500, active: true })
      .select("id")
      .single<{ id: string }>();
    if (srErr) throw new Error(`seed section rate rule: ${srErr.message}`);
    sectionRuleId = sectionRule.id;

    // Per-entity override for the extra: item → 9000 bps (90% of regular).
    const { data: itemRule, error: irErr } = await sb
      .from("catering_rate_rules")
      .insert({ location_id: locationId, scope: "item", scope_ref: extraId, rate_bps: 9000, active: true })
      .select("id")
      .single<{ id: string }>();
    if (irErr) throw new Error(`seed item rate rule: ${irErr.message}`);
    itemRuleId = itemRule.id;

    // The owning customer (submitOrder requires an active catering_customers row).
    const { data: customer, error: custErr } = await sb
      .from("catering_customers")
      .insert({ name: "W1A Smoke Customer", email: CUSTOMER_EMAIL, active: true })
      .select("id")
      .single<{ id: string }>();
    if (custErr) throw new Error(`seed customer: ${custErr.message}`);
    customerId = customer.id;

    // ── 3a. loadPublicCateringMenu derivation ────────────────────────────────────
    const menu = await loadPublicCateringMenu(locationId);

    const seededSub = menu.find((m) => m.kind === "menu_item" && m.id === subId);
    assert.ok(seededSub, "seeded sub should appear in the public catering menu");
    assert.ok(seededSub.portionPricesCents, "seeded sub should be portionable (portionPricesCents present)");
    assert.equal(seededSub.portionPricesCents.whole, 1020, "sub whole = round(1200*1*0.85)");
    assert.equal(seededSub.portionPricesCents.half, 510, "sub half = round(1200*0.5*0.85)");
    assert.equal(seededSub.portionPricesCents.quarter, 255, "sub quarter = round(1200*0.25*0.85)");

    const seededExtra = menu.find((m) => m.kind === "item" && m.id === extraId);
    assert.ok(seededExtra, "seeded extra should appear in the public catering menu");
    assert.equal(seededExtra.portionPricesCents, null, "extra is not portionable → portionPricesCents null");
    assert.equal(seededExtra.unitPriceCents, 180, "extra whole = round(200*0.90) with per-item 9000bps override");
    console.log("  ✓ derivation: sub {whole:1020,half:510,quarter:255}; extra null / 180");

    // ── 3b. submitOrder — half-portion sub, server price authority ────────────────
    const result = await submitOrder(customerId, {
      locationId,
      contactName: "Smoke",
      lines: [{ menuItemId: subId, portion: "half", quantity: 2 }],
    });
    quoteId = result.quoteId;
    pipelineId = result.pipelineId;
    assert.ok(quoteId, "submitOrder should return a quoteId");

    const { data: lines, error: linesErr } = await sb
      .from("catering_quote_items")
      .select("item_id, menu_item_id, portion, quantity, unit_price_cents, line_total_cents")
      .eq("quote_id", quoteId)
      .returns<
        Array<{
          item_id: string | null;
          menu_item_id: string | null;
          portion: string | null;
          quantity: number;
          unit_price_cents: number;
          line_total_cents: number;
        }>
      >();
    if (linesErr) throw new Error(`load quote items: ${linesErr.message}`);
    assert.equal((lines ?? []).length, 1, "exactly one quote item");
    const line = lines?.[0];
    assert.ok(line, "quote item row present");
    assert.equal(line.portion, "half", "line portion persisted");
    assert.equal(line.menu_item_id, subId, "line menu_item_id FK persisted");
    assert.equal(line.item_id, null, "sub line has no item_id");
    assert.equal(line.unit_price_cents, 510, "unit price = derived half (510)");
    assert.equal(line.line_total_cents, 1020, "line total = 510 * 2");
    console.log("  ✓ submitOrder: half sub → portion='half', unit 510, line_total 1020");

    console.log("\nw1a-smoke: PASS");
  } finally {
    // ── Rollback: delete every seeded/created row (leave ZERO residue) ────────────
    console.log("\ncleanup");
    // Order matters (FKs): quote_items + payments → quotes → pipeline_events → pipeline;
    // then rate rules, menu_item, item; rate-limit bucket; customer.
    if (quoteId) {
      await sb.from("catering_quote_items").delete().eq("quote_id", quoteId);
      await sb.from("catering_payments").delete().eq("quote_id", quoteId);
      await sb.from("catering_quotes").delete().eq("id", quoteId);
    }
    if (pipelineId) {
      await sb.from("catering_pipeline_events").delete().eq("pipeline_id", pipelineId);
      await sb.from("catering_pipeline").delete().eq("id", pipelineId);
    }
    if (sectionRuleId) await sb.from("catering_rate_rules").delete().eq("id", sectionRuleId);
    if (itemRuleId) await sb.from("catering_rate_rules").delete().eq("id", itemRuleId);
    if (subId) await sb.from("menu_items").delete().eq("id", subId);
    if (extraId) await sb.from("items").delete().eq("id", extraId);
    if (customerId) {
      await sb.from("catering_portal_rate_limits").delete().eq("bucket_key", `order_submit:${customerId}`);
      await sb.from("catering_customers").delete().eq("id", customerId);
    }

    // Verify zero residue (distinguish our seeded rows from any pre-existing).
    const { data: leftSubs } = await sb.from("menu_items").select("id").eq("name", SUB_NAME).returns<Array<{ id: string }>>();
    const { data: leftExtras } = await sb.from("items").select("id").eq("name", EXTRA_NAME).returns<Array<{ id: string }>>();
    const { data: leftCusts } = await sb.from("catering_customers").select("id").eq("email", CUSTOMER_EMAIL).returns<Array<{ id: string }>>();
    const { data: leftRules } = sectionRuleId || itemRuleId
      ? await sb.from("catering_rate_rules").select("id").in("id", [sectionRuleId, itemRuleId].filter((v): v is string => v != null)).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const residue = {
      subs: (leftSubs ?? []).length,
      extras: (leftExtras ?? []).length,
      customers: (leftCusts ?? []).length,
      rateRules: (leftRules ?? []).length,
    };
    console.log(`  residue: ${JSON.stringify(residue)}`);
    if (residue.subs || residue.extras || residue.customers || residue.rateRules) {
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
