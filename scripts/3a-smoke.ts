/**
 * 3a seeded lifecycle smoke — the order-artifact draft lifecycle end to end.
 *
 * The flow is DORMANT in prod (0 catering menu rows), so this smoke SEEDS its own temp data,
 * drives the REAL lib code paths (lib/portal/draft.ts), and hard-deletes everything in a finally
 * block (ZERO residue). Mirrors scripts/w1a-smoke.ts. audit_log rows stay (the permanent-audit
 * convention).
 *
 *   npx tsx --env-file=.env.local scripts/3a-smoke.ts
 *
 * Covers:
 *   - createDraftFromIntake → a pipeline lead (stage 'inquiry', lead_source 'portal', intake
 *     fields incl. headcount 24) + a draft quote (status 'draft', origin 'self_serve', 0 items).
 *   - setDraftLines → server-priced lines (D20) replaced IN PLACE, no version churn (still v1, no
 *     new quote row); the returned stack matches computeChargeStack.
 *   - previewDraft → tip + napkins reflected in the stack, NOTHING persisted (re-load proves it).
 *   - submitDraft → draft → 'submitted', napkins line added, deposit-due catering_payments row.
 *   - immutability → setDraftLines on the submitted quote throws not_draft (409).
 *   - stage vocabulary → confirmed → out → completed all pass the CHECK (the migration's 'out').
 */

import assert from "node:assert/strict";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadPublicCateringMenu, loadPublicPricingContext } from "@/lib/portal/menu";
import { computeChargeStack, lineTotalCents } from "@/lib/catering/quotes";
import {
  createDraftFromIntake, setDraftLines, previewDraft, submitDraft, PortalDraftError, ADDON_SECTION,
} from "@/lib/portal/draft";

type Sb = ReturnType<typeof getServiceRoleClient>;

const CUSTOMER_EMAIL = "co-3a-smoke@example.com";
const SUB_NAME = "3A SMOKE Sub";
const NAPKINS_NAME = "3A SMOKE Napkins";
const TIP_BPS = 1800;

async function main() {
  const sb: Sb = getServiceRoleClient();
  console.log("3a lifecycle smoke\n");

  const { data: loc, error: locErr } = await sb
    .from("locations").select("id, name").eq("active", true).limit(1).maybeSingle<{ id: string; name: string }>();
  if (locErr) throw new Error(`load location: ${locErr.message}`);
  if (!loc) throw new Error("no active location to seed against");
  const locationId = loc.id;
  console.log(`seeding at location: ${loc.name} (${locationId})`);

  // Rollback ledger.
  let subId: string | null = null;
  let napkinsId: string | null = null;
  let sectionRuleId: string | null = null;
  let pricingRuleId: string | null = null; // only set if WE seeded it
  let customerId: string | null = null;
  let quoteId: string | null = null;
  let pipelineId: string | null = null;

  try {
    // ── SEED ──────────────────────────────────────────────────────────────────────
    const { data: sub, error: subErr } = await sb
      .from("menu_items")
      .insert({ name: SUB_NAME, menu_price: 12.0, active: true, catering_available: true, catering_portionable: true, section: "Subs" })
      .select("id").single<{ id: string }>();
    if (subErr) throw new Error(`seed sub: ${subErr.message}`);
    subId = sub.id;

    const { data: napkins, error: napErr } = await sb
      .from("items")
      .insert({ name: NAPKINS_NAME, menu_price: 25.0, active: true, catering_available: true, catering_only: true, section: ADDON_SECTION, tracking_type: "portioned", batch_yield: 1 })
      .select("id").single<{ id: string }>();
    if (napErr) throw new Error(`seed napkins: ${napErr.message}`);
    napkinsId = napkins.id;

    const { data: sectionRule, error: srErr } = await sb
      .from("catering_rate_rules")
      .insert({ location_id: locationId, scope: "section", scope_ref: "Subs", rate_bps: 8500, active: true })
      .select("id").single<{ id: string }>();
    if (srErr) throw new Error(`seed section rate rule: ${srErr.message}`);
    sectionRuleId = sectionRule.id;

    // Ensure a non-trivial active pricing rule so the deposit/tax/service are meaningful. Reuse an
    // existing active rule if present (unique-active per location); else seed one + track it.
    const { data: existingRule } = await sb
      .from("catering_pricing_rules").select("id").eq("location_id", locationId).eq("active", true).maybeSingle<{ id: string }>();
    if (!existingRule) {
      const { data: pr, error: prErr } = await sb
        .from("catering_pricing_rules")
        .insert({ location_id: locationId, tax_rate_bps: 1000, service_charge_bps: 800, deposit_pct_bps: 2500, gratuity_bps: 0, tax_on_delivery: true, tax_on_gratuity: false, active: true })
        .select("id").single<{ id: string }>();
      if (prErr) throw new Error(`seed pricing rule: ${prErr.message}`);
      pricingRuleId = pr.id;
    }

    const { data: customer, error: custErr } = await sb
      .from("catering_customers").insert({ name: "3A Smoke Customer", email: CUSTOMER_EMAIL, active: true }).select("id").single<{ id: string }>();
    if (custErr) throw new Error(`seed customer: ${custErr.message}`);
    customerId = customer.id;

    // Effective rates the engine will actually use (whatever active rule resolved to).
    const pricing = await loadPublicPricingContext(locationId);

    // Derived unit prices (the engine's authority) for building the expected stacks.
    const menu = await loadPublicCateringMenu(locationId);
    const seededSub = menu.find((m) => m.kind === "menu_item" && m.id === subId);
    assert.ok(seededSub?.portionPricesCents, "seeded sub is portionable");
    const subHalfCents = seededSub.portionPricesCents.half;               // round(1200*0.5*0.85) = 510
    const subLineTotal = lineTotalCents(2, subHalfCents);                  // 1020
    const seededNapkins = menu.find((m) => m.kind === "item" && m.id === napkinsId);
    assert.ok(seededNapkins, "seeded napkins appears in the catering menu");
    const napkinsCents = seededNapkins.unitPriceCents;                     // 2500 (default 100% rate)

    // ── createDraftFromIntake ───────────────────────────────────────────────────────
    const created = await createDraftFromIntake(customerId, {
      locationId, contactName: "3a Smoke", email: CUSTOMER_EMAIL, company: "Acme",
      eventDate: "2026-09-01", headcount: 24, isDelivery: false,
      contactPhone: "202-555-0100", timeWindow: "11:00–11:30 AM", eventType: "Corporate",
      dietaryNotes: "nut-free", eventName: "Q3 kickoff", dropoffDoor: null,
    });
    quoteId = created.quoteId;
    pipelineId = created.pipelineId;

    const { data: lead } = await sb
      .from("catering_pipeline").select("stage, lead_source, headcount, contact_phone, event_type, event_name, dietary_notes, customer_id").eq("id", pipelineId)
      .maybeSingle<{ stage: string; lead_source: string | null; headcount: number | null; contact_phone: string | null; event_type: string | null; event_name: string | null; dietary_notes: string | null; customer_id: string | null }>();
    assert.ok(lead, "lead row created");
    assert.equal(lead.stage, "inquiry", "lead stage inquiry");
    assert.equal(lead.lead_source, "portal", "lead_source portal");
    assert.equal(lead.headcount, 24, "headcount 24 persisted on the lead (24→20 fix substrate)");
    assert.equal(lead.contact_phone, "202-555-0100", "intake contact_phone persisted");
    assert.equal(lead.event_type, "Corporate", "intake event_type persisted");
    assert.equal(lead.event_name, "Q3 kickoff", "intake event_name persisted");
    assert.equal(lead.customer_id, customerId, "lead owned by the customer");

    const { data: q0 } = await sb
      .from("catering_quotes").select("status, origin, version, headcount").eq("id", quoteId)
      .maybeSingle<{ status: string; origin: string; version: number; headcount: number | null }>();
    assert.ok(q0, "draft quote created");
    assert.equal(q0.status, "draft", "quote status draft");
    assert.equal(q0.origin, "self_serve", "quote origin self_serve");
    assert.equal(q0.version, 1, "quote version 1");
    assert.equal(q0.headcount, 24, "quote headcount 24");
    const { count: items0 } = await sb.from("catering_quote_items").select("id", { count: "exact", head: true }).eq("quote_id", quoteId);
    assert.equal(items0 ?? 0, 0, "draft starts with 0 items");
    console.log("  ✓ createDraftFromIntake: lead(inquiry/portal/hc24) + draft quote(self_serve/v1/0 items)");

    // ── setDraftLines (D20, in place) ─────────────────────────────────────────────────
    const view = await setDraftLines(customerId, quoteId, [{ menuItemId: subId, portion: "half", quantity: 2 }]);
    const expectStack1 = computeChargeStack([subLineTotal], 0, { ...pricing.rates, gratuityBps: 0 });
    assert.deepEqual(view.stack, expectStack1, "returned stack = computeChargeStack (no tip yet)");

    const { data: lines1 } = await sb
      .from("catering_quote_items").select("menu_item_id, item_id, portion, quantity, unit_price_cents, line_total_cents").eq("quote_id", quoteId)
      .returns<Array<{ menu_item_id: string | null; item_id: string | null; portion: string | null; quantity: number; unit_price_cents: number; line_total_cents: number }>>();
    assert.equal((lines1 ?? []).length, 1, "one line persisted");
    const l1 = lines1?.[0];
    assert.ok(l1, "line present");
    assert.equal(l1.menu_item_id, subId, "server-resolved menu_item_id");
    assert.equal(l1.portion, "half", "portion persisted");
    assert.equal(l1.unit_price_cents, subHalfCents, "unit price = SERVER-derived half (D20)");
    assert.equal(l1.line_total_cents, subLineTotal, "line total = unit * 2");

    // In place: still v1, still ONE quote row for this pipeline (no revision spawned).
    const { data: qAfter } = await sb.from("catering_quotes").select("version, subtotal_cents").eq("id", quoteId).maybeSingle<{ version: number; subtotal_cents: number }>();
    assert.equal(qAfter?.version, 1, "still version 1 (in-place edit, no version churn)");
    assert.equal(qAfter?.subtotal_cents, subLineTotal, "snapshot subtotal updated");
    const { count: quoteFamily } = await sb.from("catering_quotes").select("id", { count: "exact", head: true }).eq("pipeline_id", pipelineId);
    assert.equal(quoteFamily ?? 0, 1, "exactly one quote row (no new version created)");

    // A second edit replaces (not appends) — still one line, still v1.
    await setDraftLines(customerId, quoteId, [{ menuItemId: subId, portion: "half", quantity: 2 }]);
    const { count: itemsAfter2 } = await sb.from("catering_quote_items").select("id", { count: "exact", head: true }).eq("quote_id", quoteId);
    assert.equal(itemsAfter2 ?? 0, 1, "re-set replaces lines (no duplicate)");
    console.log("  ✓ setDraftLines: server-priced half sub (unit 510, total 1020), in place, v1, 1 row");

    // ── B1 hardening: input guards reject bad payloads (still-draft, nothing persisted) ──
    const isTip = (e: unknown) => e instanceof PortalDraftError && e.code === "invalid_tip";
    const isLine = (e: unknown) => e instanceof PortalDraftError && e.code === "invalid_line";
    await assert.rejects(() => previewDraft(customerId!, quoteId!, { tipBps: -100 }), isTip, "A-H1 negative tip rejected");
    await assert.rejects(() => previewDraft(customerId!, quoteId!, { tipBps: 99999 }), isTip, "A-H1 out-of-range tip rejected");
    await assert.rejects(() => previewDraft(customerId!, quoteId!, { tipBps: 15.5 }), isTip, "A-H1 fractional tip rejected");
    await assert.rejects(() => setDraftLines(customerId!, quoteId!, [{ menuItemId: subId!, portion: "half", quantity: 2.5 }]), isLine, "A-H4 fractional qty rejected");
    await assert.rejects(
      () => setDraftLines(customerId!, quoteId!, Array.from({ length: 201 }, () => ({ menuItemId: subId!, quantity: 1 }))),
      (e: unknown) => e instanceof PortalDraftError && e.code === "too_many_lines",
      "A-H4 over-cap cart rejected",
    );
    // The guards threw BEFORE mutating — the draft still has exactly its one line.
    const { count: itemsAfterGuards } = await sb.from("catering_quote_items").select("id", { count: "exact", head: true }).eq("quote_id", quoteId);
    assert.equal(itemsAfterGuards ?? 0, 1, "guard rejections left the draft untouched");
    console.log("  ✓ B1 guards: bad tip / fractional qty / over-cap cart all rejected, draft untouched");

    // ── previewDraft (compute-only) ────────────────────────────────────────────────────
    const preview = await previewDraft(customerId, quoteId, { tipBps: TIP_BPS, napkins: true });
    const expectPreview = computeChargeStack([subLineTotal, lineTotalCents(1, napkinsCents)], 0, { ...pricing.rates, gratuityBps: TIP_BPS });
    assert.deepEqual(preview, expectPreview, "preview stack = subtotal + napkins, tip as gratuity");
    assert.equal(preview.gratuityCents, Math.round(expectPreview.subtotalCents * TIP_BPS / 10000), "gratuity = 18% of (sub + napkins) subtotal");

    // NOTHING persisted by preview.
    const { count: itemsAfterPreview } = await sb.from("catering_quote_items").select("id", { count: "exact", head: true }).eq("quote_id", quoteId);
    assert.equal(itemsAfterPreview ?? 0, 1, "preview persisted no napkins line");
    const { data: qStillDraft } = await sb.from("catering_quotes").select("status, gratuity_cents").eq("id", quoteId).maybeSingle<{ status: string; gratuity_cents: number }>();
    assert.equal(qStillDraft?.status, "draft", "preview left status draft");
    assert.equal(qStillDraft?.gratuity_cents, 0, "preview left the snapshot untouched (gratuity still 0)");
    console.log("  ✓ previewDraft: tip+napkins reflected, nothing persisted");

    // ── submitDraft ─────────────────────────────────────────────────────────────────────
    const submitted = await submitDraft(customerId, quoteId, { tipBps: TIP_BPS, napkins: true });
    assert.equal(submitted.totalCents, expectPreview.totalCents, "submit total = preview total");
    assert.equal(submitted.depositCents, expectPreview.depositCents, "submit deposit = preview deposit");

    const { data: qSub } = await sb.from("catering_quotes").select("status, gratuity_cents, total_cents, deposit_cents").eq("id", quoteId).maybeSingle<{ status: string; gratuity_cents: number; total_cents: number; deposit_cents: number }>();
    assert.equal(qSub?.status, "submitted", "quote flipped to submitted");
    assert.equal(qSub?.gratuity_cents, expectPreview.gratuityCents, "gratuity snapshot = 18%");
    assert.equal(qSub?.total_cents, expectPreview.totalCents, "total snapshot frozen");

    const { data: linesSub } = await sb.from("catering_quote_items").select("item_id").eq("quote_id", quoteId).returns<Array<{ item_id: string | null }>>();
    assert.equal((linesSub ?? []).length, 2, "napkins line added → two lines");
    assert.ok((linesSub ?? []).some((l) => l.item_id === napkinsId), "napkins item line present");

    const { data: pay } = await sb.from("catering_payments").select("kind, status, amount_cents").eq("quote_id", quoteId).maybeSingle<{ kind: string; status: string; amount_cents: number }>();
    assert.ok(pay, "deposit payment intent created");
    assert.equal(pay.kind, "deposit", "payment kind deposit");
    assert.equal(pay.status, "due", "payment status due");
    assert.equal(pay.amount_cents, expectPreview.depositCents, "deposit amount = stack deposit");
    console.log("  ✓ submitDraft: submitted + napkins line + deposit-due payment");

    // ── immutability ──────────────────────────────────────────────────────────────────
    await assert.rejects(
      () => setDraftLines(customerId!, quoteId!, [{ menuItemId: subId!, portion: "whole", quantity: 1 }]),
      (err: unknown) => err instanceof PortalDraftError && err.code === "not_draft" && err.status === 409,
      "setDraftLines on a submitted quote must throw not_draft (409)",
    );
    console.log("  ✓ immutability: setDraftLines on submitted → not_draft (409)");

    // ── stage vocabulary (the migration's 'out') ────────────────────────────────────────
    const stages: string[] = ["confirmed", "out", "completed"];
    for (const stage of stages) {
      // Explicit result type — Supabase's update() builder generics otherwise resolve to a
      // self-referential type under strict TS (TS7022) for this single-field update.
      const upd: { error: unknown } = await sb.from("catering_pipeline").update({ stage }).eq("id", pipelineId!);
      assert.equal(upd.error, null, `stage '${stage}' accepted by the CHECK`);
    }
    console.log("  ✓ stage vocabulary: confirmed → out → completed all valid");

    console.log("\n3a-smoke: PASS");
  } finally {
    console.log("\ncleanup");
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
    if (pricingRuleId) await sb.from("catering_pricing_rules").delete().eq("id", pricingRuleId);
    if (subId) await sb.from("menu_items").delete().eq("id", subId);
    if (napkinsId) await sb.from("items").delete().eq("id", napkinsId);
    if (customerId) await sb.from("catering_customers").delete().eq("id", customerId);

    const { data: leftSubs } = await sb.from("menu_items").select("id").eq("name", SUB_NAME).returns<Array<{ id: string }>>();
    const { data: leftNap } = await sb.from("items").select("id").eq("name", NAPKINS_NAME).returns<Array<{ id: string }>>();
    const { data: leftCust } = await sb.from("catering_customers").select("id").eq("email", CUSTOMER_EMAIL).returns<Array<{ id: string }>>();
    const residue = { subs: (leftSubs ?? []).length, napkins: (leftNap ?? []).length, customers: (leftCust ?? []).length };
    console.log(`  residue: ${JSON.stringify(residue)}`);
    if (residue.subs || residue.napkins || residue.customers) throw new Error(`cleanup left residue: ${JSON.stringify(residue)}`);
    console.log("  ✓ zero residue");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
