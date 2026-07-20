/**
 * Pipeline-search seeded smoke — regression harness for the catering pipeline
 * federated search (searchPipeline: leads + customer email/phone/name + company
 * name → enriched results w/ customer email + current-quote status/total).
 *
 * The search surface is DORMANT-adjacent in prod (few/no catering rows), so this
 * smoke SEEDS its own temp data, drives the REAL lib code path, and hard-deletes
 * everything it created in a finally block, leaving ZERO residue:
 *   npx tsx --env-file=.env.local scripts/pipeline-search-smoke.ts
 *
 * Mirrors scripts/w4a-smoke.ts structure: env via --env-file, service-role client
 * via getServiceRoleClient, capture-ids-then-rollback discipline. audit_log rows
 * stay (the "audit_log is permanent" convention — none are emitted here anyway;
 * searchPipeline is a pure read and the seed is direct-insert).
 *
 * Covers (all against a real active location, real level-10 cgs actor — cgs is
 * all-locations, so assertions are INCLUSION-only; location EXCLUSION needs a
 * lower-level actor and is out of scope):
 *   - Seed: company "PS SMOKE Acme Corp" + customer (unique email + phone,
 *     company-linked) + 3 inquiry leads — A (unique contact name, no customer),
 *     B (customer-linked), C (company TEXT on the lead) — + an accepted current
 *     quote on B (total_cents 12345).
 *   - Name term → A found via contact_name ilike.
 *   - Email term → B found via customer email; enrichment carries email +
 *     quoteStatus 'accepted' + quoteTotalCents 12345.
 *   - Phone term → B found via customer phone.
 *   - Company term → BOTH C (lead.company text) AND B (company_id → customer).
 *   - Injection term "Acme),(" → structural chars stripped, no throw, still hits.
 *   - Garbage term → [].
 */

import assert from "node:assert/strict";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { searchPipeline } from "@/lib/catering/pipeline";
import type { AuthContext } from "@/lib/session";

type Sb = ReturnType<typeof getServiceRoleClient>;

const COMPANY_NAME = "PS SMOKE Acme Corp";
const CUSTOMER_NAME = "PS SMOKE Contact";
// Unique per run — catering_customers has a UNIQUE index on lower(email) WHERE active.
const CUSTOMER_EMAIL = `pssmoke-${Date.now()}@acme-test.example`;
const CUSTOMER_PHONE = "5551234999";
const LEAD_A_NAME = "PS SMOKE Alice Zzqxy";
const LEAD_B_NAME = "PS SMOKE Bob";
const LEAD_C_NAME = "PS SMOKE Carol";
const QUOTE_TOTAL_CENTS = 12345;
const EVENT_DATE = "2026-09-01"; // fixed future date, deterministic

async function main() {
  const sb: Sb = getServiceRoleClient();
  console.log("pipeline-search smoke (catering federated search)\n");

  // ── 1. An existing active location + a real level-10 cgs actor ───────────────
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
  // Minimal actor: searchPipeline reads actor.user.role (requireLevel + readScopeOr)
  // and actor.locations. cgs is level 10 → all-locations → readScopeOr returns null.
  const actor = { user: { id: cgsUser.id, role: cgsUser.role }, locations: [] } as unknown as AuthContext;
  console.log(`acting as: cgs ${cgsUser.id}`);

  // Ids captured for rollback (populated as we seed).
  let companyId: string | null = null;
  let customerId: string | null = null;
  const leadIds: string[] = [];
  let quoteId: string | null = null;

  try {
    // ── 2. SEED (capture every id) ───────────────────────────────────────────────
    const { data: company, error: coErr } = await sb
      .from("catering_companies")
      .insert({ name: COMPANY_NAME, active: true, created_by: cgsUser.id })
      .select("id")
      .single<{ id: string }>();
    if (coErr) throw new Error(`seed company: ${coErr.message}`);
    companyId = company.id;

    const { data: customer, error: custErr } = await sb
      .from("catering_customers")
      .insert({
        name: CUSTOMER_NAME,
        email: CUSTOMER_EMAIL,
        phone: CUSTOMER_PHONE,
        company_id: companyId,
        primary_location_id: locationId,
        active: true,
        created_by: cgsUser.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (custErr) throw new Error(`seed customer: ${custErr.message}`);
    customerId = customer.id;

    // Lead A — unique NAME term match, no customer link.
    const { data: leadA, error: aErr } = await sb
      .from("catering_pipeline")
      .insert({
        contact_name: LEAD_A_NAME,
        stage: "inquiry",
        location_id: locationId,
        created_by: cgsUser.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (aErr) throw new Error(`seed lead A: ${aErr.message}`);
    const leadAId = leadA.id;
    leadIds.push(leadAId);

    // Lead B — customer-linked (matches via customer EMAIL + PHONE + company-via-customer).
    const { data: leadB, error: bErr } = await sb
      .from("catering_pipeline")
      .insert({
        contact_name: LEAD_B_NAME,
        stage: "inquiry",
        location_id: locationId,
        customer_id: customerId,
        created_by: cgsUser.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (bErr) throw new Error(`seed lead B: ${bErr.message}`);
    const leadBId = leadB.id;
    leadIds.push(leadBId);

    // Lead C — company TEXT on the lead itself (direct company-term match), no customer.
    const { data: leadC, error: cErr } = await sb
      .from("catering_pipeline")
      .insert({
        contact_name: LEAD_C_NAME,
        company: COMPANY_NAME,
        stage: "inquiry",
        location_id: locationId,
        created_by: cgsUser.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (cErr) throw new Error(`seed lead C: ${cErr.message}`);
    const leadCId = leadC.id;
    leadIds.push(leadCId);

    // Quote on B — accepted, current (superseded_at null), total 12345 (the enrichment).
    const { data: quote, error: quoteErr } = await sb
      .from("catering_quotes")
      .insert({
        root_id: null, // v1 convention (createQuote writes v1 with root_id NULL)
        version: 1,
        pipeline_id: leadBId,
        customer_id: customerId,
        location_id: locationId,
        status: "accepted",
        event_date: EVENT_DATE,
        total_cents: QUOTE_TOTAL_CENTS,
        created_by: cgsUser.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (quoteErr) throw new Error(`seed quote: ${quoteErr.message}`);
    quoteId = quote.id;
    console.log(
      `  seeded: company ${companyId}, customer ${customerId} (${CUSTOMER_EMAIL}), ` +
        `leads A/B/C ${leadAId}/${leadBId}/${leadCId}, accepted quote ${quoteId} (${QUOTE_TOTAL_CENTS}¢)`,
    );

    // ── 3. Name term → A (contact_name ilike) ────────────────────────────────────
    const byName = await searchPipeline(actor, { query: "Alice Zzqxy" });
    const foundA = byName.find((r) => r.id === leadAId);
    assert.ok(foundA, `name term "Alice Zzqxy" returns lead A (got ${byName.length} results, ids ${byName.map((r) => r.id).join(",")})`);
    assert.ok(foundA.contactName.includes("Alice Zzqxy"), "A result carries the seeded contact name");
    console.log(`  ✓ name term → A found (${byName.length} result(s))`);

    // ── 4. Email term → B + the enrichment (email / quoteStatus / quoteTotalCents) ─
    const byEmail = await searchPipeline(actor, { query: CUSTOMER_EMAIL });
    const foundBByEmail = byEmail.find((r) => r.id === leadBId);
    assert.ok(foundBByEmail, `email term returns lead B via customer email (got ${byEmail.length} results)`);
    assert.equal(foundBByEmail.email, CUSTOMER_EMAIL, "B result is enriched with the customer email");
    assert.equal(foundBByEmail.quoteStatus, "accepted", "B result is enriched with the current quote status 'accepted'");
    assert.equal(foundBByEmail.quoteTotalCents, QUOTE_TOTAL_CENTS, `B result is enriched with quoteTotalCents ${QUOTE_TOTAL_CENTS}`);
    console.log("  ✓ email term → B found + enrichment (email / 'accepted' / 12345)");

    // ── 5. Phone term → B (via customer phone) ───────────────────────────────────
    const byPhone = await searchPipeline(actor, { query: CUSTOMER_PHONE });
    const foundBByPhone = byPhone.find((r) => r.id === leadBId);
    assert.ok(foundBByPhone, `phone term "${CUSTOMER_PHONE}" returns lead B via customer phone (got ${byPhone.length} results)`);
    console.log("  ✓ phone term → B found via customer phone");

    // ── 6. Company term → BOTH C (lead.company text) AND B (company_id → customer) ─
    const byCompany = await searchPipeline(actor, { query: COMPANY_NAME });
    const foundCByCompany = byCompany.find((r) => r.id === leadCId);
    const foundBByCompany = byCompany.find((r) => r.id === leadBId);
    assert.ok(foundCByCompany, `company term returns lead C via the lead's own company text (got ids ${byCompany.map((r) => r.id).join(",")})`);
    assert.ok(foundBByCompany, "company term returns lead B via company_id → customer federation");
    assert.equal(foundCByCompany.company, COMPANY_NAME, "C result carries the company text");
    console.log(`  ✓ company term → both C (direct text) and B (via company_id), ${byCompany.length} result(s) total`);

    // ── 7. Injection term — structural chars stripped, no throw ──────────────────
    const byInjection = await searchPipeline(actor, { query: "Acme),(" });
    assert.ok(Array.isArray(byInjection), "injection term returns an array (no throw — ',()' stripped)");
    const injectionHit = byInjection.find((r) => r.id === leadBId || r.id === leadCId);
    assert.ok(injectionHit, `injection term degrades to "Acme" and still matches B or C (got ${byInjection.length} results)`);
    console.log(`  ✓ injection term "Acme),(" → sanitized to "Acme", ${byInjection.length} result(s), no throw`);

    // ── 8. Garbage term → [] ─────────────────────────────────────────────────────
    const byGarbage = await searchPipeline(actor, { query: "zzznomatchzzz9999" });
    assert.equal(byGarbage.length, 0, `garbage term returns [] (got ${byGarbage.length})`);
    console.log("  ✓ garbage term → []");
  } finally {
    // ── Rollback: hard-delete every seeded row (leave ZERO residue) ───────────────
    console.log("\ncleanup");
    // FK-safe order: quotes (FK pipeline+customer) → pipeline (FK customer)
    // → customers (FK company) → companies.
    if (leadIds.length > 0) await sb.from("catering_quotes").delete().in("pipeline_id", leadIds);
    if (quoteId) await sb.from("catering_quotes").delete().eq("id", quoteId); // belt+braces (same row)
    if (leadIds.length > 0) await sb.from("catering_pipeline").delete().in("id", leadIds);
    if (customerId) await sb.from("catering_customers").delete().eq("id", customerId);
    if (companyId) await sb.from("catering_companies").delete().eq("id", companyId);

    // Verify zero residue (re-select by seeded ids/names → expect none).
    const { data: leftQuotes } = quoteId
      ? await sb.from("catering_quotes").select("id").eq("id", quoteId).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftLeads } = leadIds.length
      ? await sb.from("catering_pipeline").select("id").in("id", leadIds).returns<Array<{ id: string }>>()
      : { data: [] as Array<{ id: string }> };
    const { data: leftCustomers } = await sb
      .from("catering_customers")
      .select("id")
      .eq("email", CUSTOMER_EMAIL)
      .returns<Array<{ id: string }>>();
    const { data: leftCompanies } = await sb
      .from("catering_companies")
      .select("id")
      .eq("name", COMPANY_NAME)
      .returns<Array<{ id: string }>>();
    const residue = {
      quotes: (leftQuotes ?? []).length,
      leads: (leftLeads ?? []).length,
      customers: (leftCustomers ?? []).length,
      companies: (leftCompanies ?? []).length,
    };
    console.log(`  residue: ${JSON.stringify(residue)}`);
    if (Object.values(residue).some((n) => n > 0)) {
      throw new Error(`cleanup left residue: ${JSON.stringify(residue)}`);
    }
    console.log("  ✓ zero residue");
  }

  console.log("\npipeline-search-smoke: PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
