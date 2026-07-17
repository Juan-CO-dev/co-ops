/**
 * Portal-3 seeded order-submission smoke — regression harness for the self-serve
 * customer order engine (submit → lead + 'submitted' quote + deposit-due payment).
 *
 * Run against a LOCAL dev server + service-role DB:
 *   1. npm run dev   (separate terminal; or set SMOKE_BASE_URL)
 *   2. npx tsx --env-file=.env.local scripts/portal-3-smoke.ts
 *
 * The engine is DORMANT in prod (0 menu/pricing rows), so this smoke SEEDS its own
 * temp data (pricing rule + item + customers + sessions), drives the REAL HTTP
 * endpoints, and hard-deletes everything it created (audit_log rows stay, per the
 * "audit_log is permanent" convention — the record of the smoke is valid evidence).
 *
 * Covers: seeded submit happy path (server-computed charge stack 10%/8%/25%);
 * strict server price authority (a client-supplied unitPriceCents is ignored);
 * ownership boundary (another customer's session can't load or pay the quote);
 * pay-stub endpoint (deposit intent reused, not duplicated); dormant/garbage guards
 * (unknown itemId → 400, empty lines → 400).
 *
 * Expected money math for the seeded rule (tax 1000bps, service 800bps, deposit
 * 2500bps, gratuity 0) on 3 × $20.00 = 6000¢ subtotal, no delivery:
 *   service = 8% of 6000                = 480
 *   tax     = 10% of (6000 + 480)       = 648
 *   total   = 6000 + 480 + 648          = 7128
 *   deposit = 25% of 7128               = 1782
 */

import { getServiceRoleClient } from "../lib/supabase-server";
import { createCustomerSession } from "../lib/portal/session";
import { loadCustomerQuoteDetail } from "../lib/portal/quotes";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const EMAIL_OWNER = "co-portal-3-smoke@example.com";
const EMAIL_OTHER = "co-portal-3-smoke-other@example.com";
const ITEM_NAME = "SMOKE Sub";

// Independently derived expectations (do NOT import computeChargeStack — the smoke
// must catch a regression in it, not agree with it).
const EXPECTED = { subtotal: 6000, service: 480, tax: 648, total: 7128, deposit: 1782 };

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
}

type Sb = ReturnType<typeof getServiceRoleClient>;

/** Hard-delete everything a (possibly crashed prior) smoke run seeded. Idempotent. */
async function cleanup(sb: Sb): Promise<void> {
  // Customers first (ids key everything else).
  const { data: custs } = await sb
    .from("catering_customers")
    .select("id")
    .in("email", [EMAIL_OWNER, EMAIL_OTHER])
    .returns<Array<{ id: string }>>();
  const custIds = (custs ?? []).map((c) => c.id);

  if (custIds.length > 0) {
    const { data: quotes } = await sb
      .from("catering_quotes").select("id, pipeline_id").in("customer_id", custIds)
      .returns<Array<{ id: string; pipeline_id: string | null }>>();
    const quoteIds = (quotes ?? []).map((q) => q.id);
    const pipeIdsFromQuotes = (quotes ?? []).map((q) => q.pipeline_id).filter((v): v is string => v != null);
    const { data: pipes } = await sb
      .from("catering_pipeline").select("id").in("customer_id", custIds)
      .returns<Array<{ id: string }>>();
    const pipeIds = [...new Set([...pipeIdsFromQuotes, ...(pipes ?? []).map((p) => p.id)])];

    if (quoteIds.length > 0) {
      await sb.from("catering_payments").delete().in("quote_id", quoteIds);
      await sb.from("catering_quote_items").delete().in("quote_id", quoteIds);
      await sb.from("catering_quotes").delete().in("id", quoteIds);
    }
    if (pipeIds.length > 0) {
      await sb.from("catering_pipeline_events").delete().in("pipeline_id", pipeIds);
      await sb.from("catering_pipeline").delete().in("id", pipeIds);
    }
    await sb.from("catering_portal_rate_limits").delete().in("bucket_key", custIds.map((id) => `order_submit:${id}`));
    await sb.from("catering_portal_sessions").delete().in("customer_id", custIds);
    await sb.from("catering_customers").delete().in("id", custIds);
  }

  // Temp menu item (only after quote_items above are gone — FK).
  await sb.from("items").delete().eq("name", ITEM_NAME);
  // Temp pricing rule: fingerprint = created_by NULL (staff-authored rules carry a user id)
  // AND the exact smoke bps combo — never touches real config.
  await sb.from("catering_pricing_rules").delete()
    .is("created_by", null).eq("tax_rate_bps", 1000).eq("service_charge_bps", 800).eq("deposit_pct_bps", 2500);
}

async function postJson(path: string, body: unknown, cookie?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function main() {
  const sb = getServiceRoleClient();
  console.log(`Portal-3 smoke (base ${BASE})\n`);

  // ── Pre-clean any prior run, then seed ────────────────────────────────────────
  await cleanup(sb);

  // A real location WITHOUT an active pricing rule (one-active-per-location partial unique).
  const { data: locs, error: locErr } = await sb
    .from("locations").select("id, name").order("created_at", { ascending: true })
    .returns<Array<{ id: string; name: string }>>();
  if (locErr || !locs || locs.length === 0) throw new Error(`no locations: ${locErr?.message ?? "empty"}`);
  const { data: activeRules } = await sb
    .from("catering_pricing_rules").select("location_id").eq("active", true)
    .returns<Array<{ location_id: string }>>();
  const ruled = new Set((activeRules ?? []).map((r) => r.location_id));
  const loc = locs.find((l) => !ruled.has(l.id));
  if (!loc) throw new Error("every location already has an active pricing rule — refusing to touch real config");
  console.log(`seeding at location: ${loc.name} (${loc.id})`);

  const { data: rule, error: ruleErr } = await sb
    .from("catering_pricing_rules")
    .insert({
      location_id: loc.id,
      tax_rate_bps: 1000, gratuity_bps: 0, service_charge_bps: 800, deposit_pct_bps: 2500,
      tax_on_delivery: true, tax_on_gratuity: false,
      active: true, created_by: null, // created_by NULL = smoke fingerprint (cleanup key)
    })
    .select("id").single<{ id: string }>();
  if (ruleErr) throw new Error(`seed pricing rule: ${ruleErr.message}`);

  const { data: item, error: itemErr } = await sb
    .from("items")
    .insert({ name: ITEM_NAME, active: true, catering_available: true, menu_price: 20.0 })
    .select("id").single<{ id: string }>();
  if (itemErr) throw new Error(`seed item: ${itemErr.message}`);

  const { data: owner, error: oErr } = await sb
    .from("catering_customers")
    .insert({ name: "Portal-3 Smoke Owner", email: EMAIL_OWNER, active: true })
    .select("id").single<{ id: string }>();
  if (oErr) throw new Error(`seed owner customer: ${oErr.message}`);
  const { data: other, error: o2Err } = await sb
    .from("catering_customers")
    .insert({ name: "Portal-3 Smoke Other", email: EMAIL_OTHER, active: true })
    .select("id").single<{ id: string }>();
  if (o2Err) throw new Error(`seed other customer: ${o2Err.message}`);

  const ownerSession = await createCustomerSession(owner.id, EMAIL_OWNER);
  const otherSession = await createCustomerSession(other.id, EMAIL_OTHER);
  const ownerCookie = `${ownerSession.cookieName}=${ownerSession.jwt}`;
  const otherCookie = `${otherSession.cookieName}=${otherSession.jwt}`;

  try {
    // ── 1. Submit happy path: lead + submitted quote + deposit-due payment ───────
    console.log("\n1. submit → lead + 'submitted' quote + deposit-due payment");
    const s1 = await postJson("/api/portal/order/submit", {
      locationId: loc.id,
      contactName: "Portal-3 Smoke Owner",
      headcount: 10,
      lines: [{ itemId: item.id, quantity: 3 }],
    }, ownerCookie);
    check("submit returns 200 {ok:true}", s1.status === 200 && s1.json.ok === true, s1);
    const quoteId1 = typeof s1.json.quoteId === "string" ? s1.json.quoteId : null;
    check("submit returns quoteId", quoteId1 !== null, s1.json);
    if (!quoteId1) throw new Error("no quoteId — cannot continue");

    const { data: q1 } = await sb
      .from("catering_quotes")
      .select("id, pipeline_id, customer_id, location_id, status, origin, subtotal_cents, service_charge_cents, gratuity_cents, tax_cents, delivery_fee_cents, total_cents, deposit_cents, tax_rate_bps, service_charge_bps, deposit_pct_bps")
      .eq("id", quoteId1)
      .maybeSingle<{ id: string; pipeline_id: string | null; customer_id: string | null; location_id: string; status: string; origin: string; subtotal_cents: number; service_charge_cents: number; gratuity_cents: number; tax_cents: number; delivery_fee_cents: number; total_cents: number; deposit_cents: number; tax_rate_bps: number; service_charge_bps: number; deposit_pct_bps: number }>();
    check("quote row exists", !!q1);
    check("quote status='submitted'", q1?.status === "submitted", q1?.status);
    check("quote origin='self_serve'", q1?.origin === "self_serve", q1?.origin);
    check("quote customer = owner", q1?.customer_id === owner.id);
    check(`subtotal ${EXPECTED.subtotal} (3 × $20 — server-priced)`, q1?.subtotal_cents === EXPECTED.subtotal, q1?.subtotal_cents);
    check(`service charge ${EXPECTED.service} (8%)`, q1?.service_charge_cents === EXPECTED.service, q1?.service_charge_cents);
    check(`tax ${EXPECTED.tax} (10% of subtotal+service)`, q1?.tax_cents === EXPECTED.tax, q1?.tax_cents);
    check(`total ${EXPECTED.total}`, q1?.total_cents === EXPECTED.total, q1?.total_cents);
    check(`deposit ${EXPECTED.deposit} (25% of total)`, q1?.deposit_cents === EXPECTED.deposit, q1?.deposit_cents);
    check("rate snapshot frozen on row (1000/800/2500)", q1?.tax_rate_bps === 1000 && q1?.service_charge_bps === 800 && q1?.deposit_pct_bps === 2500);

    const { data: lead } = q1?.pipeline_id
      ? await sb.from("catering_pipeline").select("id, lead_source, stage, customer_id, location_id, estimated_revenue_cents").eq("id", q1.pipeline_id)
          .maybeSingle<{ id: string; lead_source: string | null; stage: string; customer_id: string | null; location_id: string | null; estimated_revenue_cents: number | null }>()
      : { data: null };
    check("pipeline lead exists (quote.pipeline_id)", !!lead);
    check("lead_source='portal'", lead?.lead_source === "portal", lead?.lead_source);
    check("lead stage='inquiry' + owner + location", lead?.stage === "inquiry" && lead?.customer_id === owner.id && lead?.location_id === loc.id);

    const { data: items1 } = await sb
      .from("catering_quote_items")
      .select("item_id, quantity, unit_price_cents, line_total_cents")
      .eq("quote_id", quoteId1)
      .returns<Array<{ item_id: string | null; quantity: number; unit_price_cents: number; line_total_cents: number }>>();
    check("exactly 1 quote item", (items1 ?? []).length === 1, items1?.length);
    const it1 = items1?.[0];
    check("item line: seeded item, qty 3, unit 2000, total 6000",
      it1?.item_id === item.id && Number(it1?.quantity) === 3 && it1?.unit_price_cents === 2000 && it1?.line_total_cents === 6000, it1);

    const { data: pay1 } = await sb
      .from("catering_payments")
      .select("id, kind, status, amount_cents, customer_id")
      .eq("quote_id", quoteId1)
      .returns<Array<{ id: string; kind: string; status: string; amount_cents: number; customer_id: string | null }>>();
    check("exactly 1 payment row after submit", (pay1 ?? []).length === 1, pay1?.length);
    check(`payment is deposit/due for ${EXPECTED.deposit}`,
      pay1?.[0]?.kind === "deposit" && pay1?.[0]?.status === "due" && pay1?.[0]?.amount_cents === EXPECTED.deposit && pay1?.[0]?.customer_id === owner.id, pay1?.[0]);

    // ── 2. Price authority: a client-supplied unitPriceCents is IGNORED ──────────
    console.log("\n2. server price authority (bogus unitPriceCents: 1 ignored)");
    const s2 = await postJson("/api/portal/order/submit", {
      locationId: loc.id,
      contactName: "Portal-3 Smoke Owner",
      headcount: 10,
      lines: [{ itemId: item.id, quantity: 3, unitPriceCents: 1, lineTotalCents: 3, price: 0.01 }],
    }, ownerCookie);
    check("bogus-price submit still 200", s2.status === 200 && s2.json.ok === true, s2);
    const quoteId2 = typeof s2.json.quoteId === "string" ? s2.json.quoteId : null;
    if (quoteId2) {
      const { data: q2 } = await sb
        .from("catering_quotes").select("subtotal_cents, total_cents, deposit_cents").eq("id", quoteId2)
        .maybeSingle<{ subtotal_cents: number; total_cents: number; deposit_cents: number }>();
      check("subtotal still 6000 — client price ignored", q2?.subtotal_cents === EXPECTED.subtotal, q2?.subtotal_cents);
      check("deposit still 1782 — deposit from server stack", q2?.deposit_cents === EXPECTED.deposit, q2?.deposit_cents);
      const { data: qi2 } = await sb
        .from("catering_quote_items").select("unit_price_cents").eq("quote_id", quoteId2)
        .returns<Array<{ unit_price_cents: number }>>();
      check("stored unit price is the menu's 2000, not 1", qi2?.[0]?.unit_price_cents === 2000, qi2?.[0]);
    } else {
      check("bogus-price submit returned a quoteId", false, s2.json);
    }

    // ── 3. Ownership: another customer can neither load nor pay the quote ────────
    console.log("\n3. ownership boundary");
    const asOther = await loadCustomerQuoteDetail(other.id, quoteId1);
    check("loadCustomerQuoteDetail(other, quote1) === null", asOther === null);
    const asOwner = await loadCustomerQuoteDetail(owner.id, quoteId1);
    check("loadCustomerQuoteDetail(owner, quote1) returns it", asOwner?.quote.id === quoteId1 && asOwner?.origin === "self_serve");
    const payOther = await postJson(`/api/portal/quote/${quoteId1}/pay`, { kind: "deposit" }, otherCookie);
    check("pay as OTHER customer → 404", payOther.status === 404, payOther);
    const { data: payAfterOther } = await sb
      .from("catering_payments").select("id").eq("quote_id", quoteId1).returns<Array<{ id: string }>>();
    check("no payment row created by the foreign pay attempt", (payAfterOther ?? []).length === 1, payAfterOther?.length);

    // ── 4. Pay stub as owner: {ok, stub}; deposit intent reused not duplicated ───
    console.log("\n4. pay (deposit) as owner — stub");
    const payOwner = await postJson(`/api/portal/quote/${quoteId1}/pay`, { kind: "deposit" }, ownerCookie);
    check("pay returns 200 {ok:true, stub:true}", payOwner.status === 200 && payOwner.json.ok === true && payOwner.json.stub === true, payOwner);
    const { data: payAfterOwner } = await sb
      .from("catering_payments").select("id, kind, status").eq("quote_id", quoteId1)
      .returns<Array<{ id: string; kind: string; status: string }>>();
    check("still exactly 1 deposit/due row (reused, not duplicated)",
      (payAfterOwner ?? []).length === 1 && payAfterOwner?.[0]?.kind === "deposit" && payAfterOwner?.[0]?.status === "due", payAfterOwner);

    // ── 5. Dormant/garbage guards ────────────────────────────────────────────────
    console.log("\n5. guards (unknown item / empty lines)");
    const sBad = await postJson("/api/portal/order/submit", {
      locationId: loc.id, contactName: "Smoke", lines: [{ itemId: crypto.randomUUID(), quantity: 1 }],
    }, ownerCookie);
    check("unknown itemId → 400", sBad.status === 400, sBad);
    const sEmpty = await postJson("/api/portal/order/submit", {
      locationId: loc.id, contactName: "Smoke", lines: [],
    }, ownerCookie);
    check("empty lines → 400", sEmpty.status === 400, sEmpty);
    const { data: allQuotes } = await sb
      .from("catering_quotes").select("id").eq("customer_id", owner.id).returns<Array<{ id: string }>>();
    check("guards created no extra quotes (still 2)", (allQuotes ?? []).length === 2, allQuotes?.length);
  } finally {
    // ── Cleanup: leave the DB as found (audit_log rows stay, by convention) ──────
    console.log("\ncleanup");
    await cleanup(sb);
    const { data: leftoverRule } = await sb.from("catering_pricing_rules").select("id").eq("id", rule.id).returns<Array<{ id: string }>>();
    const { data: leftoverItem } = await sb.from("items").select("id").eq("id", item.id).returns<Array<{ id: string }>>();
    const { data: leftoverCust } = await sb.from("catering_customers").select("id").in("email", [EMAIL_OWNER, EMAIL_OTHER]).returns<Array<{ id: string }>>();
    check("all seeded rows removed",
      (leftoverRule ?? []).length === 0 && (leftoverItem ?? []).length === 0 && (leftoverCust ?? []).length === 0,
      { rule: leftoverRule?.length, item: leftoverItem?.length, cust: leftoverCust?.length });
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
