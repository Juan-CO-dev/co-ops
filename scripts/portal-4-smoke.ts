/**
 * Portal-4 seeded account-home smoke — regression harness for the customer's
 * "your orders" data layer (lib/portal/account.ts).
 *
 * Run (no dev server needed — this calls the lib directly against the service-role DB):
 *   npx tsx --env-file=.env.local scripts/portal-4-smoke.ts
 *
 * lib/portal/account.ts exports:
 *   - loadCustomerAccount(customerId) → { customer, orders: CustomerOrder[] }
 *   - customerOrderStatus(quote, payments) → CustomerStatus
 * It scopes orders to `customer_id = customerId` + `superseded_at IS NULL` + `status <> 'draft'`
 * (the customer_id filter IS the authorization boundary), loads payments by those quote ids,
 * and translates (quote.status, payments, origin) into a customer-facing status key.
 *
 * This smoke SEEDS one temp customer + seven quotes covering the customer-facing status
 * matrix (plus a draft and a superseded quote that must be EXCLUDED), drives the REAL lib,
 * and hard-deletes everything it created. Model + client/assert/cleanup shape mirror
 * scripts/portal-3-smoke.ts. audit_log rows (if any) stay, per the "audit_log is permanent"
 * convention.
 *
 * Coverage (seeded quotes → expected customerOrderStatus.key):
 *   1. submitted / self_serve, no payments                         → reserve      (payable)
 *   2. sent / staff, no payments                                    → review       (payable)
 *   3. submitted / self_serve + paid deposit                        → pending
 *   4. accepted / staff + paid deposit (not fully paid)             → balance_due  (payable)
 *   5. accepted + paid full                                         → paid
 *   6. draft / self_serve                                           → EXCLUDED from orders
 *   7. submitted / self_serve, superseded_at set                    → EXCLUDED from orders
 * Plus: ownership (a different random customer id returns orders: []) and a populated
 * customer profile (name/email).
 */

import { getServiceRoleClient } from "../lib/supabase-server";
import { loadCustomerAccount } from "../lib/portal/account";

const EMAIL = "co-portal-4-smoke@example.com";
const CUST_NAME = "Portal-4 Smoke Customer";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

type Sb = ReturnType<typeof getServiceRoleClient>;

/** Hard-delete everything a (possibly crashed prior) smoke run seeded. Idempotent. */
async function cleanup(sb: Sb): Promise<void> {
  const { data: custs } = await sb
    .from("catering_customers")
    .select("id")
    .eq("email", EMAIL)
    .returns<Array<{ id: string }>>();
  const custIds = (custs ?? []).map((c) => c.id);
  if (custIds.length === 0) return;

  const { data: quotes } = await sb
    .from("catering_quotes")
    .select("id")
    .in("customer_id", custIds)
    .returns<Array<{ id: string }>>();
  const quoteIds = (quotes ?? []).map((q) => q.id);

  if (quoteIds.length > 0) {
    await sb.from("catering_payments").delete().in("quote_id", quoteIds);
    await sb.from("catering_quotes").delete().in("id", quoteIds);
  }
  await sb.from("catering_customers").delete().in("id", custIds);
}

/** Insert one seed quote for the temp customer at the given location. Returns its id. */
async function seedQuote(
  sb: Sb,
  opts: {
    customerId: string;
    locationId: string;
    status: string;
    origin: string;
    superseded?: boolean;
  },
): Promise<string> {
  const { data, error } = await sb
    .from("catering_quotes")
    .insert({
      customer_id: opts.customerId,
      location_id: opts.locationId,
      status: opts.status,
      origin: opts.origin,
      version: 1,
      // Money surface: total 10000, deposit 2500 (matches the deposit payment amount).
      subtotal_cents: 10000,
      total_cents: 10000,
      deposit_cents: 2500,
      // expires_at left NULL — a 'sent' quote with a null expiry can never be flagged expired
      // by customerOrderStatus (which derives isExpired from expires_at).
      superseded_at: opts.superseded ? new Date().toISOString() : null,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`seedQuote(${opts.status}/${opts.origin}): ${error.message}`);
  return data.id;
}

/** Insert one paid payment row for a quote. */
async function seedPaidPayment(
  sb: Sb,
  opts: { quoteId: string; customerId: string; kind: "deposit" | "balance" | "full"; amountCents: number },
): Promise<void> {
  const { error } = await sb.from("catering_payments").insert({
    quote_id: opts.quoteId,
    customer_id: opts.customerId,
    kind: opts.kind,
    amount_cents: opts.amountCents,
    status: "paid",
    paid_at: new Date().toISOString(),
    provider: "manual",
  });
  if (error) throw new Error(`seedPaidPayment(${opts.kind}): ${error.message}`);
}

async function main() {
  const sb = getServiceRoleClient();
  console.log("Portal-4 account-home smoke (seeded, direct lib call)\n");

  // ── Pre-clean any prior run, then seed ────────────────────────────────────────
  await cleanup(sb);

  // A real location (Portal-4 quotes carry a location_id, NOT NULL).
  const { data: locs, error: locErr } = await sb
    .from("locations")
    .select("id, name")
    .order("created_at", { ascending: true })
    .returns<Array<{ id: string; name: string }>>();
  if (locErr || !locs || locs.length === 0) throw new Error(`no locations: ${locErr?.message ?? "empty"}`);
  const loc = locs[0]!;
  console.log(`seeding at location: ${loc.name} (${loc.id})`);

  const { data: cust, error: cErr } = await sb
    .from("catering_customers")
    .insert({ name: CUST_NAME, email: EMAIL, active: true })
    .select("id")
    .single<{ id: string }>();
  if (cErr) throw new Error(`seed customer: ${cErr.message}`);
  const customerId = cust.id;

  try {
    // ── Seed the seven quotes (+ payments) ──────────────────────────────────────
    const q1 = await seedQuote(sb, { customerId, locationId: loc.id, status: "submitted", origin: "self_serve" });
    const q2 = await seedQuote(sb, { customerId, locationId: loc.id, status: "sent", origin: "staff" });
    const q3 = await seedQuote(sb, { customerId, locationId: loc.id, status: "submitted", origin: "self_serve" });
    await seedPaidPayment(sb, { quoteId: q3, customerId, kind: "deposit", amountCents: 2500 });
    const q4 = await seedQuote(sb, { customerId, locationId: loc.id, status: "accepted", origin: "staff" });
    await seedPaidPayment(sb, { quoteId: q4, customerId, kind: "deposit", amountCents: 2500 });
    const q5 = await seedQuote(sb, { customerId, locationId: loc.id, status: "accepted", origin: "staff" });
    await seedPaidPayment(sb, { quoteId: q5, customerId, kind: "full", amountCents: 10000 });
    // 6th: draft — must be excluded.
    const qDraft = await seedQuote(sb, { customerId, locationId: loc.id, status: "draft", origin: "self_serve" });
    // 7th: superseded — must be excluded.
    const qSuperseded = await seedQuote(sb, {
      customerId,
      locationId: loc.id,
      status: "submitted",
      origin: "self_serve",
      superseded: true,
    });

    // ── Load the account home ───────────────────────────────────────────────────
    console.log("\n1. loadCustomerAccount(temp customer) — the five live non-draft orders");
    const account = await loadCustomerAccount(customerId);
    const orders = account.orders;

    // Exactly the 5 live non-draft, non-superseded orders.
    check("returns exactly 5 orders (draft + superseded excluded)", orders.length === 5, {
      count: orders.length,
      ids: orders.map((o) => o.quote.id),
    });

    // Draft + superseded are excluded.
    const idSet = new Set(orders.map((o) => o.quote.id));
    check("draft quote EXCLUDED from orders", !idSet.has(qDraft), qDraft);
    check("superseded quote EXCLUDED from orders", !idSet.has(qSuperseded), qSuperseded);

    // Per-order status keys. Index by quote id (order is created_at DESC, so don't assume position).
    const byId = new Map(orders.map((o) => [o.quote.id, o]));
    const keyOf = (id: string): string | undefined => byId.get(id)?.status.key;
    const payableOf = (id: string): boolean | undefined => byId.get(id)?.status.payable;

    console.log("\n2. per-order customer-facing status keys");
    check("q1 submitted/self_serve, no payments → key='reserve' + payable", keyOf(q1) === "reserve" && payableOf(q1) === true, {
      key: keyOf(q1),
      payable: payableOf(q1),
    });
    check("q2 sent/staff, no payments → key='review' + payable", keyOf(q2) === "review" && payableOf(q2) === true, {
      key: keyOf(q2),
      payable: payableOf(q2),
    });
    check("q3 submitted/self_serve + paid deposit → key='pending'", keyOf(q3) === "pending", { key: keyOf(q3) });
    check("q4 accepted/staff + paid deposit (partial) → key='balance_due' + payable", keyOf(q4) === "balance_due" && payableOf(q4) === true, {
      key: keyOf(q4),
      payable: payableOf(q4),
    });
    check("q5 accepted + paid full → key='paid'", keyOf(q5) === "paid", { key: keyOf(q5) });

    // Payment attachment sanity: the paid-order rows carry their payments.
    check("q3 order carries its deposit payment", (byId.get(q3)?.payments ?? []).some((p) => p.kind === "deposit" && p.status === "paid"), byId.get(q3)?.payments);
    check("q5 order carries its full payment", (byId.get(q5)?.payments ?? []).some((p) => p.kind === "full" && p.status === "paid"), byId.get(q5)?.payments);

    // ── Customer profile populated ──────────────────────────────────────────────
    console.log("\n3. customer profile");
    check("customer populated (name + email)", account.customer?.name === CUST_NAME && account.customer?.email === EMAIL, account.customer);

    // ── Ownership boundary: a different random customer sees NOTHING ─────────────
    console.log("\n4. ownership boundary");
    const randomId = crypto.randomUUID();
    const strangerAccount = await loadCustomerAccount(randomId);
    check("loadCustomerAccount(random uuid) returns orders: []", strangerAccount.orders.length === 0, {
      count: strangerAccount.orders.length,
    });
    check("random-uuid account never returns another customer's orders", !strangerAccount.orders.some((o) => idSet.has(o.quote.id)), strangerAccount.orders.map((o) => o.quote.id));
    check("random-uuid customer profile is null (no such customer)", strangerAccount.customer === null, strangerAccount.customer);
  } finally {
    // ── Cleanup: leave the DB as found ──────────────────────────────────────────
    console.log("\ncleanup");
    await cleanup(sb);
    const { data: leftoverCust } = await sb.from("catering_customers").select("id").eq("email", EMAIL).returns<Array<{ id: string }>>();
    const leftoverCustIds = (leftoverCust ?? []).map((c) => c.id);
    let leftoverQuotes = 0;
    let leftoverPayments = 0;
    if (leftoverCustIds.length > 0) {
      const { data: lq } = await sb.from("catering_quotes").select("id").in("customer_id", leftoverCustIds).returns<Array<{ id: string }>>();
      leftoverQuotes = (lq ?? []).length;
      const lqIds = (lq ?? []).map((q) => q.id);
      if (lqIds.length > 0) {
        const { data: lp } = await sb.from("catering_payments").select("id").in("quote_id", lqIds).returns<Array<{ id: string }>>();
        leftoverPayments = (lp ?? []).length;
      }
    }
    check("all seeded rows removed (customer + quotes + payments)", leftoverCustIds.length === 0 && leftoverQuotes === 0 && leftoverPayments === 0, {
      cust: leftoverCustIds.length,
      quotes: leftoverQuotes,
      payments: leftoverPayments,
    });
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
