/**
 * Customer-facing quote access — Portal-3 (the shared review+pay surface's data layer).
 *
 * SERVER-ONLY. Service-role reads/writes (the portal tables are deny-all to end-users), but
 * the AUTHORIZATION BOUNDARY is the ownership check, NOT RLS: a customer may see / act on a
 * quote ONLY when its `customer_id` equals their session `customerId`. Every export re-checks
 * ownership before returning anything or writing anything — a mismatch yields `null` (reads) or
 * a 404-style error (writes) so another customer's quote is never leaked or acted upon.
 *
 * Why rows are re-mapped here (not reusing lib/catering/quotes.ts loaders): the staff loaders
 * are actor-gated (requireLevel + lockLocationContext against an AuthContext) — there is no
 * staff AuthContext on the portal path. We import the `Quote`/`QuoteItem` view TYPES for shape
 * reuse but re-map DB rows against the customer ownership check instead. We additionally read
 * `origin` (absent from the staff `Quote` type, present on the row since migration 0127) because
 * the pay panel's payment plan is origin-driven.
 *
 * PAYMENT PROVIDER — TWO PATHS, ONE INTENT. `initiatePayment` is unchanged in what it
 * GUARANTEES: a `catering_payments` deposit/full intent exists in `status='due'` and the
 * intent is audited. What it now also REPORTS is whether this shop has Stripe credentials
 * (`stub: false`), which is the route's cue to call `createQuoteCheckout` and hand back a
 * hosted Checkout URL. With no keys set, `stub` is true and the behaviour is byte-for-byte
 * what it was: the intent is recorded and the customer sees the stub message.
 *
 * NO MONEY IS EVER COMPUTED HERE FROM CLIENT INPUT. The amount is read from the quote's own
 * snapshot (`deposit_cents` / `total_cents`) and the requested kind must be an option the
 * pure `paymentPlan` allows — the same authority the staff path answers to.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { createPaymentDue } from "@/lib/catering/payments";
import { paymentPlan } from "@/lib/catering/payment-plan";
import { createCheckoutSession, stripeCredentialsFor, StripeError } from "@/lib/stripe/client";
import { TENANT_NAME } from "@/lib/tenant";
import type { Quote, QuoteItem, QuoteDetail } from "@/lib/catering/quotes";
import { isQuoteStatus } from "@/lib/catering/quotes";

/** 404-style error for the customer path (ownership failures surface as "not found"). */
export class PortalQuoteError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "PortalQuoteError";
  }
}

/** Canonical UUID — quoteId is caller-supplied (a route param), and an unguarded value
 *  reaches PostgREST as a uuid cast that raises 22P02 instead of taking the not-found
 *  branch. Guard it first so a malformed URL is a clean 404, never an error boundary
 *  (lib/portal/draft.ts idiom). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QuoteOrigin = "self_serve" | "staff";

/** One of the quote's payment intents, as the customer's own surface needs to see it.
 *  Deliberately narrower than lib/catering/payments.ts's staff `Payment`: no provider
 *  refs, no created_by, nothing about how the money was taken — a customer is owed the
 *  fact and the amount, not the plumbing. */
export interface PortalPayment {
  kind: "deposit" | "balance" | "full";
  status: "due" | "paid" | "refunded" | "void";
  amountCents: number;
  paidAt: string | null;
}

/** QuoteDetail (shape reused) + the origin the payment plan is driven by + what has
 *  actually been paid. The payments ride ALONG with the quote because the pay panel's
 *  correctness depends on them: a `paid` deposit must hide its own button, and that is a
 *  server-authoritative fact, never a `?checkout=success` query parameter. */
export interface PortalQuoteDetail extends QuoteDetail {
  origin: QuoteOrigin;
  payments: PortalPayment[];
}

interface DbQuoteRow {
  id: string;
  root_id: string | null;
  version: number;
  pipeline_id: string | null;
  customer_id: string | null;
  location_id: string;
  status: string;
  origin: string;
  event_date: string | null;
  headcount: number | null;
  is_delivery: boolean;
  delivery_zone_id: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  service_charge_cents: number;
  gratuity_cents: number;
  tax_cents: number;
  total_cents: number;
  deposit_cents: number;
  tax_rate_bps: number;
  gratuity_bps: number;
  service_charge_bps: number;
  deposit_pct_bps: number;
  tax_on_delivery: boolean;
  tax_on_gratuity: boolean;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  sent_at: string | null;
  sent_by: string | null;
  superseded_at: string | null;
}

interface DbItemRow {
  id: string;
  item_id: string | null;
  menu_item_id: string | null;
  package_id: string | null;
  description: string | null;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  display_order: number;
  portion: string | null;
}

const QUOTE_COLS =
  "id, root_id, version, pipeline_id, customer_id, location_id, status, origin, event_date, headcount, is_delivery, delivery_zone_id, subtotal_cents, delivery_fee_cents, service_charge_cents, gratuity_cents, tax_cents, total_cents, deposit_cents, tax_rate_bps, gratuity_bps, service_charge_bps, deposit_pct_bps, tax_on_delivery, tax_on_gratuity, expires_at, notes, created_at, created_by, sent_at, sent_by, superseded_at";
const ITEM_COLS =
  "id, item_id, menu_item_id, package_id, description, quantity, unit_price_cents, line_total_cents, display_order, portion";

function mapQuote(r: DbQuoteRow, now: number = Date.now()): Quote {
  const status = isQuoteStatus(r.status) ? r.status : "draft";
  const isExpired = status === "sent" && r.expires_at != null && Date.parse(r.expires_at) < now;
  return {
    id: r.id,
    rootId: r.root_id,
    version: r.version,
    pipelineId: r.pipeline_id,
    customerId: r.customer_id,
    locationId: r.location_id,
    status,
    eventDate: r.event_date,
    headcount: r.headcount,
    isDelivery: r.is_delivery,
    deliveryZoneId: r.delivery_zone_id,
    subtotalCents: r.subtotal_cents,
    deliveryFeeCents: r.delivery_fee_cents,
    serviceChargeCents: r.service_charge_cents,
    gratuityCents: r.gratuity_cents,
    taxCents: r.tax_cents,
    totalCents: r.total_cents,
    depositCents: r.deposit_cents,
    taxRateBps: r.tax_rate_bps,
    gratuityBps: r.gratuity_bps,
    serviceChargeBps: r.service_charge_bps,
    depositPctBps: r.deposit_pct_bps,
    taxOnDelivery: r.tax_on_delivery,
    taxOnGratuity: r.tax_on_gratuity,
    expiresAt: r.expires_at,
    notes: r.notes,
    createdAt: r.created_at,
    createdBy: r.created_by,
    sentAt: r.sent_at,
    sentBy: r.sent_by,
    supersededAt: r.superseded_at,
    isExpired,
  };
}

function mapItem(r: DbItemRow): QuoteItem {
  return {
    id: r.id,
    itemId: r.item_id,
    menuItemId: r.menu_item_id,
    packageId: r.package_id,
    description: r.description,
    quantity: Number(r.quantity),
    unitPriceCents: r.unit_price_cents,
    lineTotalCents: r.line_total_cents,
    displayOrder: r.display_order,
    portion:
      r.portion === "quarter" || r.portion === "half" || r.portion === "whole"
        ? r.portion
        : null,
  };
}

function normalizeOrigin(v: string): QuoteOrigin {
  return v === "self_serve" ? "self_serve" : "staff";
}

/**
 * Load a quote + its line items for a customer. The ownership check is the authorization
 * boundary: if the row's `customer_id` is not the caller's `customerId`, return null (never
 * leak another customer's quote). Also returns null when the quote doesn't exist.
 */
export async function loadCustomerQuoteDetail(
  customerId: string,
  quoteId: string,
): Promise<PortalQuoteDetail | null> {
  if (!UUID_RE.test(quoteId)) return null;
  const sb = getServiceRoleClient();
  const { data: row, error } = await sb
    .from("catering_quotes")
    .select(QUOTE_COLS)
    .eq("id", quoteId)
    .maybeSingle<DbQuoteRow>();
  if (error) throw new Error(`loadCustomerQuoteDetail quote: ${error.message}`);
  if (!row) return null;
  // OWNERSHIP CHECK — the authorization boundary. A quote is only ever visible to its owner.
  if (row.customer_id !== customerId) return null;

  const [{ data: itemRows, error: iErr }, { data: payRows, error: pErr }] = await Promise.all([
    sb
      .from("catering_quote_items")
      .select(ITEM_COLS)
      .eq("quote_id", quoteId)
      .order("display_order", { ascending: true })
      .returns<DbItemRow[]>(),
    sb
      .from("catering_payments")
      .select("kind, status, amount_cents, paid_at")
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: true })
      .returns<Array<{ kind: string; status: string; amount_cents: number; paid_at: string | null }>>(),
  ]);
  if (iErr) throw new Error(`loadCustomerQuoteDetail items: ${iErr.message}`);
  if (pErr) throw new Error(`loadCustomerQuoteDetail payments: ${pErr.message}`);

  return {
    quote: mapQuote(row),
    items: (itemRows ?? []).map(mapItem),
    origin: normalizeOrigin(row.origin),
    payments: (payRows ?? []).map(mapPortalPayment),
  };
}

function mapPortalPayment(r: {
  kind: string;
  status: string;
  amount_cents: number;
  paid_at: string | null;
}): PortalPayment {
  const kind: PortalPayment["kind"] =
    r.kind === "balance" ? "balance" : r.kind === "full" ? "full" : "deposit";
  const status: PortalPayment["status"] =
    r.status === "paid" ? "paid" : r.status === "refunded" ? "refunded" : r.status === "void" ? "void" : "due";
  return { kind, status, amountCents: r.amount_cents, paidAt: r.paid_at };
}

/** What the pay route needs back from an intent. `stub` means "no provider is wired for
 *  this shop" — the historical behaviour, kept as its own boolean rather than inferred
 *  from the absence of a url, so the route's two branches read as two branches. */
export interface InitiatePaymentResult {
  ok: true;
  /** The `catering_payments` row now sitting in `status='due'`. */
  paymentId: string;
  /** Integer cents, from the quote's own snapshot. Never from the client. */
  amountCents: number;
  stub: boolean;
}

/** The payable quote as both payment paths need it. Loaded once, ownership-checked. */
interface PayableQuote {
  id: string;
  locationId: string;
  origin: QuoteOrigin;
  eventDate: string | null;
  depositCents: number;
  totalCents: number;
}

/**
 * Load a quote for a PAYMENT action: exists, owned by this customer, and still payable.
 *
 * The ownership check is the authorization boundary and it is re-run at BOTH payment
 * entry points (intent, then checkout) rather than trusted across the pair — the second
 * call arrives on its own request and must not inherit the first one's conclusion.
 */
async function loadPayableQuote(
  sb: ReturnType<typeof getServiceRoleClient>,
  customerId: string,
  quoteId: string,
): Promise<PayableQuote> {
  if (!UUID_RE.test(quoteId)) throw new PortalQuoteError(404, "not_found", "Quote not found");
  const { data: row, error } = await sb
    .from("catering_quotes")
    .select("id, customer_id, location_id, origin, status, superseded_at, event_date, deposit_cents, total_cents")
    .eq("id", quoteId)
    .maybeSingle<{
      id: string;
      customer_id: string | null;
      location_id: string;
      origin: string;
      status: string;
      superseded_at: string | null;
      event_date: string | null;
      deposit_cents: number;
      total_cents: number;
    }>();
  if (error) throw new Error(`loadPayableQuote: ${error.message}`);
  // OWNERSHIP CHECK — the authorization boundary. Not owned (or missing) ⇒ 404, never actionable.
  if (!row || row.customer_id !== customerId) {
    throw new PortalQuoteError(404, "not_found", "Quote not found");
  }
  // PAYABILITY GATE — a superseded revision or a terminal quote (declined/expired) is not payable.
  if (row.superseded_at != null || row.status === "declined" || row.status === "expired") {
    throw new PortalQuoteError(409, "not_payable", "This quote can no longer be paid");
  }
  return {
    id: row.id,
    locationId: row.location_id,
    origin: normalizeOrigin(row.origin),
    eventDate: row.event_date,
    depositCents: row.deposit_cents,
    totalCents: row.total_cents,
  };
}

/**
 * The shop's `locations.code`, or null. This is the ONLY way a shop code enters the Stripe
 * credential lookup — read from the row at runtime, never a literal in code (AGENTS.md
 * tenant-vocabulary law). A read failure returns null, which resolves to the shared
 * account: an unknown shop must not silently acquire a different account's keys, and it
 * must not lose the ability to take a payment either.
 */
async function locationCodeFor(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("locations")
    .select("code")
    .eq("id", locationId)
    .maybeSingle<{ code: string | null }>();
  if (error) return null;
  return data?.code ?? null;
}

/**
 * "Will this shop take a card online?" — the one question the /order/review copy has to
 * answer before it can be honest about what happens next. Presence of credentials only;
 * no key material crosses this boundary, and the answer is a boolean the client renders,
 * never a capability it is granted.
 */
export async function paymentsOnlineForLocation(locationId: string): Promise<boolean> {
  if (!UUID_RE.test(locationId)) return false;
  const sb = getServiceRoleClient();
  const code = await locationCodeFor(sb, locationId);
  return stripeCredentialsFor(code) !== null;
}

/**
 * Begin a payment for the customer's own quote: ensure a `catering_payments` intent exists
 * for (quote, kind) in `status='due'` — the amount read from the quote's snapshot
 * (deposit_cents for a deposit, total_cents for full) — and audit the intent.
 *
 * Returns the intent's id + amount, and `stub` = "this shop has no Stripe credentials".
 * When `stub` is true the caller behaves exactly as it always did; when it is false the
 * caller follows up with `createQuoteCheckout`. Splitting it this way keeps the INTENT
 * (an append-only fact about what the customer asked for) independent of the PROVIDER
 * call, so a Stripe outage never costs us the record of the request.
 *
 * Ownership is re-verified here — a quote the caller doesn't own is a 404, never actionable.
 */
export async function initiatePayment(
  customerId: string,
  quoteId: string,
  kind: "deposit" | "full",
): Promise<InitiatePaymentResult> {
  const sb = getServiceRoleClient();
  const quote = await loadPayableQuote(sb, customerId, quoteId);

  // PAYMENT-PLAN AUTHORITY — the requested kind must be an option the real money rules allow
  // for this quote (origin/lead-time/deposit-driven). The provider is wired BEHIND this
  // authority, never beside it, so an invalid kind can never create an intent or a session.
  const plan = paymentPlan({
    origin: quote.origin,
    eventDate: quote.eventDate,
    totalCents: quote.totalCents,
    depositCents: quote.depositCents,
  });
  if (!plan.options.some((o) => o.kind === kind)) {
    throw new PortalQuoteError(400, "invalid_payment_kind", "That payment option is not available for this quote");
  }

  // ALREADY-PAID GATE — the double-charge guard, and it is here rather than in the UI.
  // Both of `paymentPlan`'s options are priced for an UNPAID quote (`deposit` =
  // deposit_cents, `full` = total_cents), so a customer who has paid a deposit and then
  // posts `{kind:"full"}` would be charged the whole total a second time. The page hides
  // the panel once anything is paid; this refuses the request whatever the page did. The
  // remaining BALANCE is a `balance` intent the team raises — a kind this endpoint has
  // never accepted — so refusing here closes the hole without closing a real path.
  const { data: alreadyPaid, error: paidErr } = await sb
    .from("catering_payments")
    .select("id")
    .eq("quote_id", quoteId)
    .eq("status", "paid")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (paidErr) throw new Error(`initiatePayment paid check: ${paidErr.message}`);
  if (alreadyPaid) {
    throw new PortalQuoteError(409, "already_paid", "A payment has already been received for this order");
  }

  const amountCents = kind === "deposit" ? quote.depositCents : quote.totalCents;

  // Idempotent: reuse an existing due intent for this (quote, kind). The DB-enforced
  // invariant is migration 0130's partial unique index `catering_payments_one_due`, which
  // createPaymentDue treats as idempotent (23505 → re-read the winner); this SELECT is the
  // fast path in front of it, not the guard.
  const { data: existing, error: exErr } = await sb
    .from("catering_payments")
    .select("id")
    .eq("quote_id", quoteId)
    .eq("kind", kind)
    .eq("status", "due")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (exErr) throw new Error(`initiatePayment existing: ${exErr.message}`);

  const paymentId = existing
    ? existing.id
    : (await createPaymentDue(sb, { quoteId, customerId, kind, amountCents, createdBy: customerId })).id;

  void audit({
    actorId: null,
    actorRole: null,
    action: "catering.order.pay_intent",
    resourceTable: "catering_quotes",
    resourceId: quoteId,
    metadata: { kind, amount_cents: amountCents, customer_id: customerId, payment_id: paymentId },
    ipAddress: null,
    userAgent: null,
  });

  // DORMANCY IS DECIDED PER SHOP, and it is decided HERE rather than at the route so that
  // every caller of initiatePayment inherits the same answer.
  const code = await locationCodeFor(sb, quote.locationId);
  const stub = stripeCredentialsFor(code) === null;

  return { ok: true, paymentId, amountCents, stub };
}

/** What the customer's browser needs to leave for Stripe. */
export interface QuoteCheckout {
  /** The hosted Checkout URL. The ONLY thing the client is told. */
  url: string;
}

/**
 * Mint a hosted Stripe Checkout Session for an intent `initiatePayment` just guaranteed.
 *
 * ── ORDER OF OPERATIONS, AND WHY ─────────────────────────────────────────────────────
 *   1. re-load + re-own the quote (a second request is a second authorization),
 *   2. resolve the shop's credentials (no keys ⇒ 409 `not_configured`; the route should
 *      never have got here, and guessing a different account's keys is not a fallback),
 *   3. create the session at Stripe,
 *   4. GUARDED UPDATE of the still-`due` row with `provider='stripe'` + the session id.
 *
 * Step 4 runs AFTER step 3 on purpose: a session is not a charge, so a session we then
 * fail to record costs nothing but an unused Stripe object, whereas recording a session id
 * we failed to create would leave the webhook's fallback lookup pointing at nothing. And
 * the update is guarded on `status='due'` so a row a webhook advanced to `paid` in the
 * meantime REFUSES — count 0 ⇒ 409, and the customer is told the payment already landed
 * instead of being handed a second checkout for money they have already sent.
 *
 * The audit row carries ids and the amount and NOTHING ELSE: no URLs (the success/cancel
 * links are ours but the Checkout URL is a live payment surface), no email, no card data.
 */
export async function createQuoteCheckout(input: {
  customerId: string;
  customerEmail: string;
  quoteId: string;
  kind: "deposit" | "full";
  paymentId: string;
  amountCents: number;
  /** Absolute origin for the return links, e.g. `https://co-ops-ashy.vercel.app`. */
  appOrigin: string;
}): Promise<QuoteCheckout> {
  const sb = getServiceRoleClient();
  const quote = await loadPayableQuote(sb, input.customerId, input.quoteId);

  const code = await locationCodeFor(sb, quote.locationId);
  const creds = stripeCredentialsFor(code);
  if (!creds) throw new PortalQuoteError(409, "not_configured", "Online payment is not enabled");

  // The payment row is the authority for currency and for the fact that it is still due.
  const { data: payRow, error: payErr } = await sb
    .from("catering_payments")
    .select("id, quote_id, status, currency")
    .eq("id", input.paymentId)
    .maybeSingle<{ id: string; quote_id: string; status: string; currency: string | null }>();
  if (payErr) throw new Error(`createQuoteCheckout payment: ${payErr.message}`);
  if (!payRow || payRow.quote_id !== input.quoteId) {
    throw new PortalQuoteError(404, "not_found", "Payment not found");
  }
  if (payRow.status !== "due") {
    throw new PortalQuoteError(409, "not_due", "That payment is no longer due");
  }

  const origin = input.appOrigin.replace(/\/$/, "");
  const label = input.kind === "deposit" ? "Catering deposit" : "Catering order";
  const dateLabel = quote.eventDate ?? "date to be confirmed";

  let session: { id: string; url: string };
  try {
    session = await createCheckoutSession(
      creds.secretKey,
      {
        quoteId: input.quoteId,
        paymentId: input.paymentId,
        kind: input.kind,
        amountCents: input.amountCents,
        currency: (payRow.currency ?? "usd").toLowerCase(),
        // Tenant vocabulary comes from lib/tenant.ts (env-backed), never a brand literal.
        productName: `${TENANT_NAME} — ${label} (${dateLabel})`,
        description: `${TENANT_NAME} catering ${input.kind} · quote ${input.quoteId}`,
        customerEmail: input.customerEmail,
        successUrl: `${origin}/order/quote/${input.quoteId}?checkout=success`,
        cancelUrl: `${origin}/order/quote/${input.quoteId}?checkout=cancel`,
      },
      // Keyed on the row AND the amount: the row id alone would make a re-priced intent
      // collide with its own earlier session (Stripe 400s a key replayed with different
      // params), and the amount is the only field of this request that can honestly move.
      `${input.paymentId}:${input.amountCents}`,
    );
  } catch (e) {
    if (e instanceof StripeError) {
      // Stripe's message describes the REQUEST, never the credential — safe to log.
      console.error(`[stripe] checkout session failed (${e.status}/${e.code}):`, e.message);
      throw new PortalQuoteError(502, "provider_error", "Payment provider is unavailable");
    }
    throw e;
  }

  const { error: updErr, count } = await sb
    .from("catering_payments")
    .update({ provider: "stripe", provider_session_id: session.id }, { count: "exact" })
    .eq("id", input.paymentId)
    .eq("status", "due");
  if (updErr) throw new Error(`createQuoteCheckout persist session: ${updErr.message}`);
  if (count === 0) {
    // Advanced between the read and the write — the money already landed. Refuse the
    // redirect rather than invite a second payment.
    throw new PortalQuoteError(409, "not_due", "That payment is no longer due");
  }

  void audit({
    actorId: null,
    actorRole: null,
    action: "catering.payment.checkout_created",
    resourceTable: "catering_payments",
    resourceId: input.paymentId,
    metadata: {
      quote_id: input.quoteId,
      payment_id: input.paymentId,
      kind: input.kind,
      amount_cents: input.amountCents,
      session_id: session.id,
      location_id: quote.locationId,
      credential_source: creds.source,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { url: session.url };
}
