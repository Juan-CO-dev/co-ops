/**
 * W4a seeded dormant smoke — regression harness for catering PREP-DEMAND
 * (reserve on confirm → location/date overlay w/ over-par flags → consume on out →
 * idempotent re-reserve → release).
 *
 * Run against the service-role DB (the engine is DORMANT in prod — 0 catering menu
 * rows — so this smoke SEEDS its own temp data, drives the REAL lib code paths, and
 * hard-deletes everything it created in a finally block, leaving ZERO residue):
 *   npx tsx --env-file=.env.local scripts/w4a-smoke.ts
 *
 * Mirrors scripts/w1b-smoke.ts structure: env via --env-file, service-role client via
 * getServiceRoleClient, capture-ids-then-rollback discipline. audit_log rows stay
 * (the "audit_log is permanent" convention — the record of the smoke is valid evidence).
 *
 * Covers (all against a real active location, real level-10 cgs actor):
 *   - Seed: a 'quote_sent' pipeline lead + accepted current quote (event_date 2026-08-15)
 *     with 3 line shapes — direct item (qty 3), direct sub half-portion (qty 4), and a
 *     package line (qty 2) whose package has a FIXED item component (qty 3) and a CHOICE
 *     slot (qty 1).
 *   - reservePrepDemand → 4 catering_prep_demand rows: direct item qty 3; sub qty 4
 *     portion 'half'; package fixed item qty 2×3=6; ONE unresolved choice row qty 2×1=2.
 *   - loadCateringPrepDemand overlay → one PrepDemandDay: direct item parValue=10,
 *     wholeEquiv 3, overPar=false; package-fixed item parValue=5, wholeEquiv 6,
 *     overPar=TRUE (the over-par branch); half sub wholeEquiv 4×0.5=2, parValue=null;
 *     choice line needsPick=true.
 *   - loadLeadPrepDemand → the lead's own 4 aggregated lines (no par enrichment).
 *   - consumePrepDemand → all 4 rows 'consumed' + consumed_at set; overlay drains to [].
 *   - reservePrepDemand again (re-confirm idempotency) → a FRESH 4-row reserved set;
 *     the consumed set stays consumed (8 rows total, 0 released).
 *   - releasePrepDemand → the fresh reserved set flips to 'released'; consumed stays.
 */

import assert from "node:assert/strict";
import { getServiceRoleClient } from "@/lib/supabase-server";
import {
  reservePrepDemand,
  consumePrepDemand,
  releasePrepDemand,
  loadCateringPrepDemand,
  loadLeadPrepDemand,
} from "@/lib/catering/prep-demand";
import type { AuthContext } from "@/lib/session";

type Sb = ReturnType<typeof getServiceRoleClient>;

// Fixed future date (never `new Date()` — deterministic day-of-week for par overrides).
const NEED_DATE = "2026-08-15";

const ITEM_DIRECT_NAME = "W4A SMOKE Extra Direct";
const ITEM_PKGFIX_NAME = "W4A SMOKE Extra PkgFixed";
const SUB_NAME = "W4A SMOKE Sub Half";
const CHOICE_LABEL = "W4A SMOKE Choose your sub";
// Timestamped label → unique slug (catering_packages.slug is unique).
const PKG_SLUG = `w4a-smoke-platter-${Date.now()}`;
const PKG_LABEL = `W4A SMOKE Platter ${Date.now()}`;

// Par choreography: direct item demand 3 < par 10 → overPar=false;
// package-fixed item demand 2×3=6 >= par 5 → overPar=TRUE (the over-par branch).
const DIRECT_PAR = 10;
const PKGFIX_PAR = 5;

/** A catering_prep_demand row as this smoke reads it back. */
interface DemandRow {
  id: string;
  quote_id: string;
  location_id: string;
  need_date: string;
  item_id: string | null;
  menu_item_id: string | null;
  choice_package_item_id: string | null;
  portion: string | null;
  qty: number | string;
  status: string;
  consumed_at: string | null;
}

async function loadDemandRows(sb: Sb, pipelineId: string): Promise<DemandRow[]> {
  const { data, error } = await sb
    .from("catering_prep_demand")
    .select("id, quote_id, location_id, need_date, item_id, menu_item_id, choice_package_item_id, portion, qty, status, consumed_at")
    .eq("pipeline_id", pipelineId)
    .returns<DemandRow[]>();
  if (error) throw new Error(`load prep demand rows: ${error.message}`);
  return data ?? [];
}

async function main() {
  const sb: Sb = getServiceRoleClient();
  console.log("W4a dormant smoke (catering prep-demand)\n");

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
  // Minimal actor: the prep-demand lib reads only actor.user.id (created_by FK) and
  // actor.user.role (getRoleLevel). cgs is level 10 ≥ PREP_DEMAND_READ_MIN (6).
  const actor = { user: { id: cgsUser.id, role: cgsUser.role }, locations: [] } as unknown as AuthContext;
  console.log(`acting as: cgs ${cgsUser.id}`);

  // Ids captured for rollback (populated as we seed).
  let itemDirectId: string | null = null;
  let itemPkgFixId: string | null = null;
  let subId: string | null = null;
  let packageId: string | null = null;
  let choiceCompId: string | null = null;
  let pipelineId: string | null = null;
  let quoteId: string | null = null;

  try {
    // ── 2. SEED (capture every id) ───────────────────────────────────────────────
    // Direct-line item — catering extra, default_par 10 (par resolves via defaultPar;
    // no item_par_levels row needed — pickOverride falls back when no override exists).
    const { data: itemDirect, error: idErr } = await sb
      .from("items")
      .insert({
        name: ITEM_DIRECT_NAME,
        menu_price: 2.0,
        active: true,
        catering_available: true,
        tracking_type: "portioned",
        batch_yield: 1,
        default_par: DIRECT_PAR,
      })
      .select("id")
      .single<{ id: string }>();
    if (idErr) throw new Error(`seed direct item: ${idErr.message}`);
    itemDirectId = itemDirect.id;

    // SEPARATE second item for the package's fixed component (keeps each overlay line
    // unambiguous) — default_par 5 so its demand of 6 exercises the over-par branch.
    const { data: itemPkgFix, error: ipErr } = await sb
      .from("items")
      .insert({
        name: ITEM_PKGFIX_NAME,
        menu_price: 3.0,
        active: true,
        catering_available: true,
        tracking_type: "portioned",
        batch_yield: 1,
        default_par: PKGFIX_PAR,
      })
      .select("id")
      .single<{ id: string }>();
    if (ipErr) throw new Error(`seed package-fixed item: ${ipErr.message}`);
    itemPkgFixId = itemPkgFix.id;

    // The sub (menu_items) — catering-available, half-portionable.
    const { data: sub, error: subErr } = await sb
      .from("menu_items")
      .insert({
        name: SUB_NAME,
        menu_price: 12.0,
        active: true,
        catering_available: true,
        catering_portionable: true,
        section: "W4A Smoke Subs",
      })
      .select("id")
      .single<{ id: string }>();
    if (subErr) throw new Error(`seed sub: ${subErr.message}`);
    subId = sub.id;

    // The package + 2 components (direct inserts — resolveQuoteDemand reads the rows,
    // not the admin lib; direct inserts avoid extra deps).
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

    const { error: fcErr } = await sb
      .from("catering_package_items")
      .insert({
        package_id: packageId,
        slot_type: "fixed",
        item_id: itemPkgFixId,
        quantity: 3,
        active: true,
        created_by: cgsUser.id,
      });
    if (fcErr) throw new Error(`seed fixed component: ${fcErr.message}`);

    const { data: choiceComp, error: ccErr } = await sb
      .from("catering_package_items")
      .insert({
        package_id: packageId,
        slot_type: "choice",
        description: CHOICE_LABEL,
        quantity: 1,
        active: true,
        created_by: cgsUser.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (ccErr) throw new Error(`seed choice component: ${ccErr.message}`);
    choiceCompId = choiceComp.id;

    // The pipeline lead (stage 'quote_sent' — reserve is stage-agnostic in the lib;
    // the moveStage hook is what gates it operationally) + its current accepted quote.
    const { data: pipe, error: pipeErr } = await sb
      .from("catering_pipeline")
      .insert({
        contact_name: "W4A Smoke Lead",
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

    // 3 quote lines: (a) direct item qty 3; (b) direct sub qty 4 half; (c) package qty 2.
    // NOTE: the package line (both refs null) MUST carry a description — the live
    // catering_quote_items_identified CHECK requires description OR item_id OR menu_item_id.
    const { error: qiErr } = await sb.from("catering_quote_items").insert([
      {
        quote_id: quoteId,
        item_id: itemDirectId,
        quantity: 3,
        portion: null,
        unit_price_cents: 170,
        line_total_cents: 510,
        display_order: 0,
        created_by: cgsUser.id,
      },
      {
        quote_id: quoteId,
        menu_item_id: subId,
        quantity: 4,
        portion: "half",
        unit_price_cents: 510,
        line_total_cents: 2040,
        display_order: 1,
        created_by: cgsUser.id,
      },
      {
        quote_id: quoteId,
        package_id: packageId,
        description: PKG_LABEL,
        quantity: 2,
        portion: null,
        unit_price_cents: 2000,
        line_total_cents: 4000,
        display_order: 2,
        created_by: cgsUser.id,
      },
    ]);
    if (qiErr) throw new Error(`seed quote items: ${qiErr.message}`);
    console.log(
      `  seeded: 2 items (par ${DIRECT_PAR}/${PKGFIX_PAR}), 1 sub, package w/ fixed+choice, ` +
        `lead ${pipelineId}, accepted quote ${quoteId} (3 lines, event ${NEED_DATE})`,
    );

    // ── 3. reservePrepDemand → 4 resolved rows ───────────────────────────────────
    await reservePrepDemand(actor, pipelineId);

    const reserved = await loadDemandRows(sb, pipelineId);
    assert.equal(reserved.length, 4, `reserve resolves the 3 quote lines into exactly 4 demand rows (got ${reserved.length})`);
    for (const r of reserved) {
      assert.equal(r.status, "reserved", `row ${r.id} starts status='reserved'`);
      assert.equal(r.need_date, NEED_DATE, `row ${r.id} need_date = quote event_date ${NEED_DATE}`);
      assert.equal(r.location_id, locationId, `row ${r.id} carries the quote's location`);
      assert.equal(r.quote_id, quoteId, `row ${r.id} carries the resolved quote id`);
    }

    const directRow = reserved.find((r) => r.item_id === itemDirectId);
    assert.ok(directRow, "direct item line resolves to an item-ref demand row");
    assert.equal(Number(directRow.qty), 3, "direct item row qty = 3 (line qty)");
    assert.equal(directRow.portion, null, "direct item row portion is null");

    const subRow = reserved.find((r) => r.menu_item_id === subId);
    assert.ok(subRow, "sub line resolves to a menu_item-ref demand row");
    assert.equal(Number(subRow.qty), 4, "sub row qty = 4 (line qty)");
    assert.equal(subRow.portion, "half", "sub row preserves portion='half'");

    const pkgFixRow = reserved.find((r) => r.item_id === itemPkgFixId);
    assert.ok(pkgFixRow, "package FIXED component resolves to an item-ref demand row");
    assert.equal(Number(pkgFixRow.qty), 6, "package fixed row qty = 2 (line) × 3 (component) = 6");
    assert.equal(pkgFixRow.portion, null, "package fixed row portion is null");

    const choiceRows = reserved.filter((r) => r.choice_package_item_id !== null);
    assert.equal(choiceRows.length, 1, "exactly ONE unresolved choice-slot demand row");
    const choiceRow = choiceRows[0];
    assert.ok(choiceRow, "the choice row is present");
    assert.equal(choiceRow.choice_package_item_id, choiceCompId, "choice row references the choice component");
    assert.equal(Number(choiceRow.qty), 2, "choice row qty = 2 (line) × 1 (slot) = 2");
    console.log("  ✓ reserve: item qty 3, sub qty 4 half, pkg-fixed qty 6, choice qty 2 — all reserved");

    // ── 4. Overlay: loadCateringPrepDemand with par + over-par flags ─────────────
    const days = await loadCateringPrepDemand(actor, { locationId, from: NEED_DATE, to: NEED_DATE });
    assert.equal(days.length, 1, `overlay returns exactly one PrepDemandDay for ${NEED_DATE} (prod prep demand assumed empty at this location/date)`);
    const day = days[0];
    assert.ok(day, "the overlay day is present");
    assert.equal(day.needDate, NEED_DATE, "overlay day is the need date");
    assert.equal(day.lines.length, 4, "overlay day aggregates our 4 demand lines");

    const directLine = day.lines.find((l) => l.refKind === "item" && l.refId === itemDirectId);
    assert.ok(directLine, "direct item overlay line present");
    assert.equal(directLine.name, ITEM_DIRECT_NAME, "direct line name resolves to the seeded item name");
    assert.equal(directLine.qty, 3, "direct line qty = 3");
    assert.equal(directLine.portion, null, "direct line portion null");
    assert.equal(directLine.parValue, DIRECT_PAR, `direct line parValue = ${DIRECT_PAR} (items.default_par, no override row)`);
    assert.equal(directLine.wholeEquivDemand, 3, "direct line wholeEquivDemand = 3 (whole grain)");
    assert.equal(directLine.overPar, false, `direct line overPar=false (3 < ${DIRECT_PAR})`);
    assert.equal(directLine.needsPick, false, "direct line needsPick=false");

    const pkgFixLine = day.lines.find((l) => l.refKind === "item" && l.refId === itemPkgFixId);
    assert.ok(pkgFixLine, "package-fixed item overlay line present");
    assert.equal(pkgFixLine.name, ITEM_PKGFIX_NAME, "package-fixed line name resolves");
    assert.equal(pkgFixLine.qty, 6, "package-fixed line qty = 6");
    assert.equal(pkgFixLine.parValue, PKGFIX_PAR, `package-fixed line parValue = ${PKGFIX_PAR}`);
    assert.equal(pkgFixLine.wholeEquivDemand, 6, "package-fixed line wholeEquivDemand = 6");
    assert.equal(pkgFixLine.overPar, true, `package-fixed line overPar=TRUE (6 >= ${PKGFIX_PAR}) — the over-par branch`);

    const subLine = day.lines.find((l) => l.refKind === "menu_item" && l.refId === subId);
    assert.ok(subLine, "half-portion sub overlay line present");
    assert.equal(subLine.name, SUB_NAME, "sub line name resolves to the seeded sub name");
    assert.equal(subLine.portion, "half", "sub line portion 'half'");
    assert.equal(subLine.qty, 4, "sub line qty = 4");
    assert.equal(subLine.wholeEquivDemand, 2, "sub line wholeEquivDemand = 4 × 0.5 = 2");
    assert.equal(subLine.parValue, null, "sub line parValue null (menu_item — no item-grain par)");
    assert.equal(subLine.overPar, false, "sub line overPar=false (par only applies to item refs)");

    const choiceLine = day.lines.find((l) => l.refKind === "choice");
    assert.ok(choiceLine, "choice overlay line present");
    assert.equal(choiceLine.refId, choiceCompId, "choice line refId = the choice component");
    assert.equal(choiceLine.name, CHOICE_LABEL, "choice line name = the slot's description label");
    assert.equal(choiceLine.qty, 2, "choice line qty = 2");
    assert.equal(choiceLine.parValue, null, "choice line parValue null");
    assert.equal(choiceLine.needsPick, true, "choice line needsPick=true (unresolved slot)");
    console.log("  ✓ overlay: par 10 under / par 5 OVER (over-par branch) / half→2 whole-equiv / choice needsPick");

    // ── 5. loadLeadPrepDemand — the lead's own breakdown ─────────────────────────
    const leadLines = await loadLeadPrepDemand(actor, pipelineId);
    assert.equal(leadLines.length, 4, "lead breakdown returns the lead's 4 aggregated lines");
    const leadDirect = leadLines.find((l) => l.refKind === "item" && l.refId === itemDirectId);
    assert.ok(leadDirect, "lead breakdown includes the direct item line");
    assert.equal(leadDirect.qty, 3, "lead direct line qty = 3");
    assert.equal(leadDirect.parValue, null, "lead breakdown has NO par enrichment (parValue null by contract)");
    const leadChoice = leadLines.find((l) => l.refKind === "choice");
    assert.ok(leadChoice, "lead breakdown includes the choice line");
    assert.equal(leadChoice.needsPick, true, "lead choice line needsPick=true");
    console.log("  ✓ loadLeadPrepDemand: 4 lines, no par enrichment, choice flagged");

    // ── 6. consumePrepDemand → consumed + overlay drains ─────────────────────────
    await consumePrepDemand(actor, pipelineId);
    const consumed = await loadDemandRows(sb, pipelineId);
    assert.equal(consumed.length, 4, "consume flips rows in place (still 4 rows)");
    for (const r of consumed) {
      assert.equal(r.status, "consumed", `row ${r.id} is 'consumed' after consume`);
      assert.ok(r.consumed_at, `row ${r.id} has consumed_at set`);
    }
    const daysAfterConsume = await loadCateringPrepDemand(actor, { locationId, from: NEED_DATE, to: NEED_DATE });
    assert.equal(daysAfterConsume.length, 0, "overlay returns [] after consume (only 'reserved' rows overlay)");
    const leadAfterConsume = await loadLeadPrepDemand(actor, pipelineId);
    assert.equal(leadAfterConsume.length, 4, "lead breakdown still shows 4 lines (reserved+consumed by contract)");
    console.log("  ✓ consume: 4 rows consumed w/ consumed_at; overlay drained; lead view retains consumed");

    // ── 7. Re-confirm idempotency: fresh reserved set; consumed stays ────────────
    await reservePrepDemand(actor, pipelineId);
    const afterRereserve = await loadDemandRows(sb, pipelineId);
    assert.equal(afterRereserve.length, 8, "re-reserve appends a fresh 4-row set (8 total — append-only)");
    const stillConsumed = afterRereserve.filter((r) => r.status === "consumed");
    const freshReserved = afterRereserve.filter((r) => r.status === "reserved");
    const releasedNow = afterRereserve.filter((r) => r.status === "released");
    assert.equal(stillConsumed.length, 4, "the prior consumed set stays consumed (never re-released)");
    assert.equal(freshReserved.length, 4, "exactly one fresh reserved set — no duplicate active demand");
    assert.equal(releasedNow.length, 0, "nothing released yet (there were no stale reserved rows to retire)");
    const freshChoice = freshReserved.filter((r) => r.choice_package_item_id !== null);
    assert.equal(freshChoice.length, 1, "fresh set re-resolves the choice slot once");
    const freshQtys = freshReserved.map((r) => Number(r.qty)).sort((a, b) => a - b);
    assert.deepEqual(freshQtys, [2, 3, 4, 6], "fresh set re-resolves the same quantities (2, 3, 4, 6)");
    console.log("  ✓ re-reserve: fresh 4-row reserved set; consumed set untouched");

    // ── 8. releasePrepDemand → reserved flips to released; consumed stays ────────
    await releasePrepDemand(actor, pipelineId);
    const finalRows = await loadDemandRows(sb, pipelineId);
    assert.equal(finalRows.filter((r) => r.status === "reserved").length, 0, "no reserved rows after release");
    assert.equal(finalRows.filter((r) => r.status === "released").length, 4, "the fresh reserved set flipped to 'released'");
    assert.equal(finalRows.filter((r) => r.status === "consumed").length, 4, "consumed rows stay consumed through release");
    const daysAfterRelease = await loadCateringPrepDemand(actor, { locationId, from: NEED_DATE, to: NEED_DATE });
    assert.equal(daysAfterRelease.length, 0, "overlay stays [] after release");
    console.log("  ✓ release: reserved→released; consumed untouched; overlay empty");

    console.log("\nw4a-smoke: PASS");
  } finally {
    // ── Rollback: hard-delete every seeded row (leave ZERO residue) ───────────────
    console.log("\ncleanup");
    // FK-safe order: prep_demand → quote_items → quotes → slot_options → package_items
    // → packages → menu_items → items → pipeline. (prep_demand FKs everything; quote
    // FKs the pipeline; quote/package lines FK items+menu_items.)
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
    if (subId) await sb.from("menu_items").delete().eq("id", subId);
    if (itemDirectId) await sb.from("items").delete().eq("id", itemDirectId);
    if (itemPkgFixId) await sb.from("items").delete().eq("id", itemPkgFixId);
    if (pipelineId) await sb.from("catering_pipeline").delete().eq("id", pipelineId);

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
    const { data: leftPipes } = pipelineId
      ? await sb.from("catering_pipeline").select("id").eq("id", pipelineId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftSubs } = await sb
      .from("menu_items")
      .select("id")
      .eq("name", SUB_NAME)
      .returns<Array<{ id: string }>>();
    const { data: leftItems } = await sb
      .from("items")
      .select("id")
      .in("name", [ITEM_DIRECT_NAME, ITEM_PKGFIX_NAME])
      .returns<Array<{ id: string }>>();
    const residue = {
      demand: (leftDemand ?? []).length,
      quoteItems: (leftQuoteItems ?? []).length,
      quotes: (leftQuotes ?? []).length,
      slotOptions: (leftOpts ?? []).length,
      packageItems: (leftComps ?? []).length,
      packages: (leftPkgs ?? []).length,
      pipeline: (leftPipes ?? []).length,
      subs: (leftSubs ?? []).length,
      items: (leftItems ?? []).length,
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
