/**
 * W1b seeded dormant smoke — regression harness for the catering PACKAGE BUILDER
 * (fixed lines + choice slots + slot options + advisory package pricing).
 *
 * Run against the service-role DB (the engine is DORMANT in prod — 0 catering menu
 * rows — so this smoke SEEDS its own temp data, drives the REAL lib code paths, and
 * hard-deletes everything it created in a finally block, leaving ZERO residue):
 *   npx tsx --env-file=.env.local scripts/w1b-smoke.ts
 *
 * Mirrors scripts/w1a-smoke.ts structure: env via --env-file, service-role client via
 * getServiceRoleClient, capture-ids-then-rollback discipline. audit_log rows stay
 * (the "audit_log is permanent" convention — the record of the smoke is valid evidence).
 *
 * Covers (all against a real active location, real level-10 cgs actor):
 *   - createPackage (per_platter, location-scoped, flat 1200¢) via the real admin lib.
 *   - addPackageLine FIXED: the $2 extra (items ref), qty 2 → persists slot_type='fixed'
 *     + the item_id spine FK.
 *   - addPackageLine CHOICE ("Choose your sub", qty 1) + addSlotOption for BOTH subs →
 *     loadPackages hydrates slotType='choice' + 2 options with resolved names.
 *   - recommendPackagePrice: fixed extra 170×2=340; choice avg(1020,1360)=1190×1;
 *     alaCarte 1530; impliedDiscountBps = 10000 − impliedRateBps(1200, 1530) = 2157.
 *   - removeSlotOption → 1 option hydrates; removePackageLineItem → line active=false
 *     AND remaining options cascade to active=false (append-only, W1b).
 */

import assert from "node:assert/strict";
import { getServiceRoleClient } from "@/lib/supabase-server";
import {
  createPackage,
  addPackageLine,
  addSlotOption,
  removeSlotOption,
  removePackageLineItem,
  loadPackages,
} from "@/lib/admin/catering/packages";
import { recommendPackagePrice } from "@/lib/admin/catering/package-pricing";
import { cateringUnitPriceCents, impliedRateBps } from "@/lib/catering/pricing-derivation";
import type { AuthContext } from "@/lib/session";

type Sb = ReturnType<typeof getServiceRoleClient>;

const SUB12_NAME = "W1B SMOKE Sub 12";
const SUB16_NAME = "W1B SMOKE Sub 16";
const EXTRA_NAME = "W1B SMOKE Extra 2";
// Timestamped label → unique slug (catering_packages_one_active is a live unique index).
const PKG_LABEL = `W1B SMOKE Platter ${Date.now()}`;
const RATE_BPS = 8500; // location-scope rule seeded below
const PKG_PRICE_CENTS = 1200; // vs alaCarte 1530 → implied rate 7843 → discount 2157 bps

async function main() {
  const sb: Sb = getServiceRoleClient();
  console.log("W1b dormant smoke (package builder)\n");

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
  // Minimal actor: the gated lib funcs read only actor.user.id (created_by FK) and
  // actor.user.role (getRoleLevel). cgs is level 10 ≥ the level-9 all-locations
  // override, so loadPackages returns every location's packages with locations: [].
  const actor = { user: { id: cgsUser.id, role: cgsUser.role }, locations: [] } as unknown as AuthContext;
  console.log(`acting as: cgs ${cgsUser.id}`);

  // Pre-flight: the derivation math below assumes OUR 8500bps location rule is the only
  // active rule at this location (loadActiveRateRules is unordered; resolveRateBps takes
  // the first location-scope match). Fail loudly if the location already has active rules.
  const { data: preRules, error: preErr } = await sb
    .from("catering_rate_rules")
    .select("id, scope, scope_ref, rate_bps")
    .eq("location_id", locationId)
    .eq("active", true)
    .returns<Array<{ id: string; scope: string; scope_ref: string | null; rate_bps: number }>>();
  if (preErr) throw new Error(`pre-flight rate rules: ${preErr.message}`);
  if ((preRules ?? []).length > 0) {
    throw new Error(
      `pre-flight: location ${locationId} already has ${preRules!.length} active rate rule(s) — ` +
        `the seeded-rate math would be nondeterministic. Pick a clean location or update the smoke. ` +
        `Rules: ${JSON.stringify(preRules)}`,
    );
  }

  // Ids captured for rollback (populated as we seed / as the lib creates rows).
  let sub12Id: string | null = null;
  let sub16Id: string | null = null;
  let extraId: string | null = null;
  let ruleId: string | null = null;
  let packageId: string | null = null;
  let fixedLineId: string | null = null;
  let choiceLineId: string | null = null;

  try {
    // ── 2. SEED (capture every id) ───────────────────────────────────────────────
    // Two subs (menu_items) — catering-available, $12.00 / $16.00. Unique section name
    // so no pre-existing section-scope rate rule can ever shadow the location rule.
    const { data: sub12, error: s12Err } = await sb
      .from("menu_items")
      .insert({
        name: SUB12_NAME,
        menu_price: 12.0,
        active: true,
        catering_available: true,
        catering_portionable: true,
        section: "W1B Smoke Subs",
      })
      .select("id")
      .single<{ id: string }>();
    if (s12Err) throw new Error(`seed sub12: ${s12Err.message}`);
    sub12Id = sub12.id;

    const { data: sub16, error: s16Err } = await sb
      .from("menu_items")
      .insert({
        name: SUB16_NAME,
        menu_price: 16.0,
        active: true,
        catering_available: true,
        catering_portionable: true,
        section: "W1B Smoke Subs",
      })
      .select("id")
      .single<{ id: string }>();
    if (s16Err) throw new Error(`seed sub16: ${s16Err.message}`);
    sub16Id = sub16.id;

    // The extra (items) — a catering extra, whole only, $2.00 (same shape as w1a).
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

    // Location-scope rate rule: 8500 bps (85% of regular) for everything here.
    const { data: rule, error: ruleErr } = await sb
      .from("catering_rate_rules")
      .insert({ location_id: locationId, scope: "location", scope_ref: null, rate_bps: RATE_BPS, active: true })
      .select("id")
      .single<{ id: string }>();
    if (ruleErr) throw new Error(`seed location rate rule: ${ruleErr.message}`);
    ruleId = rule.id;

    // The per_platter package at this location — via the REAL admin lib (createPackage
    // handles slug derivation, display_order, created_by).
    const created = await createPackage(actor, {
      locationId,
      labelEn: PKG_LABEL,
      pricingMode: "per_platter",
      priceCents: PKG_PRICE_CENTS,
    });
    packageId = created.id;
    console.log(`  seeded: 2 subs, 1 extra, 8500bps location rule, package ${created.slug} (${packageId})`);

    // ── 3a. addPackageLine FIXED — the $2 extra, qty 2 ───────────────────────────
    const fixedLine = await addPackageLine(actor, {
      packageId,
      slotType: "fixed",
      ref: { kind: "item", id: extraId },
      quantity: 2,
    });
    fixedLineId = fixedLine.id;

    const { data: fixedRow, error: frErr } = await sb
      .from("catering_package_items")
      .select("id, slot_type, item_id, menu_item_id, quantity, active")
      .eq("id", fixedLineId)
      .maybeSingle<{
        id: string;
        slot_type: string;
        item_id: string | null;
        menu_item_id: string | null;
        quantity: number | string;
        active: boolean;
      }>();
    if (frErr) throw new Error(`load fixed line row: ${frErr.message}`);
    assert.ok(fixedRow, "fixed line row should persist in catering_package_items");
    assert.equal(fixedRow.slot_type, "fixed", "fixed line persists slot_type='fixed'");
    assert.equal(fixedRow.item_id, extraId, "fixed line persists the item_id spine FK");
    assert.equal(fixedRow.menu_item_id, null, "fixed items-ref line has no menu_item_id");
    assert.equal(Number(fixedRow.quantity), 2, "fixed line quantity = 2");
    assert.equal(fixedRow.active, true, "fixed line starts active");
    console.log("  ✓ fixed line: slot_type='fixed', item_id FK, qty 2");

    // ── 3b. addPackageLine CHOICE + both sub options → loadPackages hydration ────
    const choiceLine = await addPackageLine(actor, {
      packageId,
      slotType: "choice",
      description: "Choose your sub",
      quantity: 1,
    });
    choiceLineId = choiceLine.id;

    const opt12 = await addSlotOption(actor, { lineItemId: choiceLineId, ref: { kind: "menu_item", id: sub12Id } });
    const opt16 = await addSlotOption(actor, { lineItemId: choiceLineId, ref: { kind: "menu_item", id: sub16Id } });

    const packages1 = await loadPackages(actor);
    const pkg1 = packages1.find((p) => p.id === packageId);
    assert.ok(pkg1, "seeded package should appear in loadPackages for the cgs actor");
    const choiceView1 = pkg1.lineItems.find((l) => l.id === choiceLineId);
    assert.ok(choiceView1, "choice line should hydrate on the package view");
    assert.equal(choiceView1.slotType, "choice", "choice line hydrates slotType='choice'");
    assert.equal(choiceView1.options.length, 2, "choice line hydrates BOTH slot options");
    const optionNames = choiceView1.options.map((o) => o.name).sort();
    assert.deepEqual(
      optionNames,
      [SUB12_NAME, SUB16_NAME].sort(),
      "both option names resolve to the seeded sub names",
    );
    const fixedView1 = pkg1.lineItems.find((l) => l.id === fixedLineId);
    assert.ok(fixedView1, "fixed line should hydrate on the package view");
    assert.equal(fixedView1.refName, EXTRA_NAME, "fixed line refName resolves to the seeded extra name");
    console.log("  ✓ choice slot: slotType='choice', 2 options, names resolve");

    // ── 3c. recommendPackagePrice — expected computed dynamically ────────────────
    const extraUnit = cateringUnitPriceCents(200, "whole", RATE_BPS); // 170
    const sub12Unit = cateringUnitPriceCents(1200, "whole", RATE_BPS); // 1020
    const sub16Unit = cateringUnitPriceCents(1600, "whole", RATE_BPS); // 1360
    const expectedFixedCents = Math.round(extraUnit * 2); // 340
    const expectedChoiceCents = Math.round(((sub12Unit + sub16Unit) / 2) * 1); // 1190
    const expectedAlaCarte = expectedFixedCents + expectedChoiceCents; // 1530

    const rec = await recommendPackagePrice(actor, { packageId, locationId });
    assert.equal(rec.hasBasis, true, "recommendation has a basis (location-scoped package, priced lines)");
    assert.equal(rec.unpriceableLines, 0, "no unpriceable lines (fixed ref + populated choice)");
    assert.equal(
      rec.alaCarteCents,
      expectedAlaCarte,
      `alaCarteCents = fixed ${expectedFixedCents} + choice ${expectedChoiceCents} = ${expectedAlaCarte}`,
    );
    assert.equal(rec.priceCents, PKG_PRICE_CENTS, "priceCents echoes the team's flat package price");
    const impRate = impliedRateBps(PKG_PRICE_CENTS, expectedAlaCarte);
    assert.ok(impRate !== null, "impliedRateBps should resolve (baseline > 0)");
    const expectedDiscount = 10000 - impRate;
    assert.equal(
      rec.impliedDiscountBps,
      expectedDiscount,
      `impliedDiscountBps = 10000 − impliedRateBps(${PKG_PRICE_CENTS}, ${expectedAlaCarte}) = ${expectedDiscount}`,
    );
    console.log(
      `  ✓ pricing: alaCarte ${rec.alaCarteCents} (expected ${expectedAlaCarte}); ` +
        `price ${rec.priceCents} → impliedDiscountBps ${rec.impliedDiscountBps} (expected ${expectedDiscount})`,
    );

    // ── 3d. removeSlotOption → 1 option; removePackageLineItem → cascade ────────
    await removeSlotOption(actor, { optionId: opt16.id });
    const packages2 = await loadPackages(actor);
    const pkg2 = packages2.find((p) => p.id === packageId);
    assert.ok(pkg2, "package still hydrates after option removal");
    const choiceView2 = pkg2.lineItems.find((l) => l.id === choiceLineId);
    assert.ok(choiceView2, "choice line still hydrates after option removal");
    assert.equal(choiceView2.options.length, 1, "removed option no longer hydrates (1 left)");
    const remaining = choiceView2.options[0];
    assert.ok(remaining, "the remaining option is present");
    assert.equal(remaining.refId, sub12Id, "the remaining option is the sub12 ref");
    console.log("  ✓ removeSlotOption: choice line hydrates 1 remaining option");

    await removePackageLineItem(actor, { itemId: choiceLineId });
    const { data: lineAfter, error: laErr } = await sb
      .from("catering_package_items")
      .select("id, active")
      .eq("id", choiceLineId)
      .maybeSingle<{ id: string; active: boolean }>();
    if (laErr) throw new Error(`load removed line: ${laErr.message}`);
    assert.ok(lineAfter, "removed line row still exists (append-only — active flip, not DELETE)");
    assert.equal(lineAfter.active, false, "removed choice line is active=false");

    const { data: optsAfter, error: oaErr } = await sb
      .from("catering_package_slot_options")
      .select("id, active")
      .eq("package_item_id", choiceLineId)
      .returns<Array<{ id: string; active: boolean }>>();
    if (oaErr) throw new Error(`load cascaded options: ${oaErr.message}`);
    assert.equal((optsAfter ?? []).length, 2, "both option rows still exist (append-only)");
    for (const o of optsAfter ?? []) {
      assert.equal(o.active, false, `option ${o.id} cascaded to active=false with the removed line`);
    }
    // Sanity: opt12 (never explicitly removed) is among the cascaded-inactive rows.
    assert.ok(
      (optsAfter ?? []).some((o) => o.id === opt12.id),
      "the cascaded set includes the never-explicitly-removed option",
    );
    console.log("  ✓ removePackageLineItem: line active=false + remaining option cascaded to active=false");

    console.log("\nw1b-smoke: PASS");
  } finally {
    // ── Rollback: hard-delete every seeded row (leave ZERO residue) ───────────────
    console.log("\ncleanup");
    // FK-safe order: slot_options → package_items → package → rate rule → menu_items → items.
    let lineIds: string[] = [];
    if (packageId) {
      const { data: lines } = await sb
        .from("catering_package_items")
        .select("id")
        .eq("package_id", packageId)
        .returns<Array<{ id: string }>>();
      lineIds = (lines ?? []).map((l) => l.id);
      if (lineIds.length > 0) {
        await sb.from("catering_package_slot_options").delete().in("package_item_id", lineIds);
        await sb.from("catering_package_items").delete().eq("package_id", packageId);
      }
      await sb.from("catering_packages").delete().eq("id", packageId);
    }
    if (ruleId) await sb.from("catering_rate_rules").delete().eq("id", ruleId);
    if (sub12Id) await sb.from("menu_items").delete().eq("id", sub12Id);
    if (sub16Id) await sb.from("menu_items").delete().eq("id", sub16Id);
    if (extraId) await sb.from("items").delete().eq("id", extraId);

    // Verify zero residue (re-select by seeded names/ids → expect none).
    const { data: leftSubs } = await sb
      .from("menu_items")
      .select("id")
      .in("name", [SUB12_NAME, SUB16_NAME])
      .returns<Array<{ id: string }>>();
    const { data: leftExtras } = await sb
      .from("items")
      .select("id")
      .eq("name", EXTRA_NAME)
      .returns<Array<{ id: string }>>();
    const { data: leftPkgs } = packageId
      ? await sb.from("catering_packages").select("id").eq("id", packageId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftLines } = packageId
      ? await sb.from("catering_package_items").select("id").eq("package_id", packageId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftOpts } = lineIds.length
      ? await sb.from("catering_package_slot_options").select("id").in("package_item_id", lineIds).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftRules } = ruleId
      ? await sb.from("catering_rate_rules").select("id").eq("id", ruleId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const residue = {
      subs: (leftSubs ?? []).length,
      extras: (leftExtras ?? []).length,
      packages: (leftPkgs ?? []).length,
      lines: (leftLines ?? []).length,
      options: (leftOpts ?? []).length,
      rateRules: (leftRules ?? []).length,
    };
    console.log(`  residue: ${JSON.stringify(residue)}`);
    if (residue.subs || residue.extras || residue.packages || residue.lines || residue.options || residue.rateRules) {
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
