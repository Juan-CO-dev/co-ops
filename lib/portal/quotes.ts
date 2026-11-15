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

import { randomUUID } from "node:crypto";

import { portalOrigin } from "@/lib/portal/origin-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { createPaymentDue, syncDuePaymentAmount } from "@/lib/catering/payments";
import { paymentPlan } from "@/lib/catering/payment-plan";
import {
  createCheckoutSession,
  retireCheckoutSession,
  retrieveCheckoutSession,
  stripeCredentialsFor,
  StripeError,
  type CheckoutSessionState,
} from "@/lib/stripe/client";
import { TENANT_NAME } from "@/lib/tenant";
import type { Quote, QuoteItem, QuoteDetail } from "@/lib/catering/quotes";
import { isQuoteLineKind } from "@/lib/catering/prep-demand-shared";
import { isQuoteStatus } from "@/lib/catering/quotes";
import { quotePayability, quoteTimeExpired } from "@/lib/portal/payability-shared";

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
  line_kind: string | null;
  components_listed: boolean | null;
}

const QUOTE_COLS =
  "id, root_id, version, pipeline_id, customer_id, location_id, status, origin, event_date, headcount, is_delivery, delivery_zone_id, subtotal_cents, delivery_fee_cents, service_charge_cents, gratuity_cents, tax_cents, total_cents, deposit_cents, tax_rate_bps, gratuity_bps, service_charge_bps, deposit_pct_bps, tax_on_delivery, tax_on_gratuity, expires_at, notes, created_at, created_by, sent_at, sent_by, superseded_at";
const ITEM_COLS =
  "id, item_id, menu_item_id, package_id, description, quantity, unit_price_cents, line_total_cents, display_order, portion, line_kind, components_listed";

function mapQuote(r: DbQuoteRow, now: number = Date.now()): Quote {
  const status = isQuoteStatus(r.status) ? r.status : "draft";
  // The customer-side reading of the clock: an open offer (`sent`, or a self-serve
  // `submitted` order) past its date. One rule, lib/portal/payability-shared.ts.
  const isExpired = quoteTimeExpired(status, r.expires_at, now);
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
    lineKind: isQuoteLineKind(r.line_kind) ? r.line_kind : null,
    componentsListed: r.components_listed ?? null,
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
    .select("id, customer_id, location_id, origin, status, superseded_at, expires_at, event_date, deposit_cents, total_cents")
    .eq("id", quoteId)
    .maybeSingle<{
      id: string;
      customer_id: string | null;
      location_id: string;
      origin: string;
      status: string;
      superseded_at: string | null;
      expires_at: string | null;
      event_date: string | null;
      deposit_cents: number;
      total_cents: number;
    }>();
  if (error) throw new Error(`loadPayableQuote: ${error.message}`);
  // OWNERSHIP CHECK — the authorization boundary. Not owned (or missing) ⇒ 404, never actionable.
  if (!row || row.customer_id !== customerId) {
    throw new PortalQuoteError(404, "not_found", "Quote not found");
  }
  // PAYABILITY GATE — the one rule in lib/portal/payability-shared.ts, which the quote page
  // reads too, so a button is never drawn for a quote this gate refuses. A DRAFT is not an
  // offer and cannot be paid (audit W02/B038); a superseded revision and a declined quote
  // are not payable; neither is an EXPIRED one, and expiry is
  // the clock as well as the status (audit W02/B037): nothing sweeps `expires_at`, so a
  // quote past its date used to stay payable at its old price for as long as its status
  // still said `sent`.
  const payability = quotePayability({
    status: row.status,
    supersededAt: row.superseded_at,
    expiresAt: row.expires_at,
  });
  if (!payability.payable) {
    if (payability.reason === "expired") {
      throw new PortalQuoteError(409, "quote_expired", "This quote has expired");
    }
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
 * Read the shop's `locations.code`. This is the ONLY way a shop code enters the Stripe
 * credential lookup — read from the row at runtime, never a literal in code (AGENTS.md
 * tenant-vocabulary law).
 *
 * ── "WE COULD NOT READ THE SHOP" IS NOT "THE SHOP HAS NO CODE" (audit W02/B146) ───────
 * A null code is a real answer: that shop rides the shared Stripe account. A FAILED read
 * (or a missing row) is no answer at all, and it used to be collapsed into that same null
 * — so a transient database error sent a customer of a shop with its OWN account to pay
 * into the shared one, with an audit row saying `credential_source: default` as if that
 * were the plan. The two are kept apart here: only a successful read of a row whose code
 * is null may resolve the default pair.
 */
async function readLocationCode(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<{ ok: true; code: string | null } | { ok: false }> {
  const { data, error } = await sb
    .from("locations")
    .select("code")
    .eq("id", locationId)
    .maybeSingle<{ code: string | null }>();
  if (error || !data) return { ok: false };
  return { ok: true, code: data.code ?? null };
}

/** The shop's code for a PAYMENT action. A shop we could not read is a 503 — "try again",
 *  never a guess at which account takes the money. */
async function locationCodeFor(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<string | null> {
  const read = await readLocationCode(sb, locationId);
  if (!read.ok) {
    throw new PortalQuoteError(503, "payment_unavailable", "Payment is temporarily unavailable — please try again");
  }
  return read.code;
}

/**
 * "Will this shop take a card online?" — the one question the /order/review copy has to
 * answer before it can be honest about what happens next. Presence of credentials only;
 * no key material crosses this boundary, and the answer is a boolean the client renders,
 * never a capability it is granted.
 *
 * A shop we could not read answers FALSE: this boolean only chooses copy, and the copy must
 * never promise a provider it has not proved (LRA-210). No credential pair is resolved
 * from a failed read here either — the payment routes re-resolve on their own request and
 * refuse with a 503 if they cannot.
 */
export async function paymentsOnlineForLocation(locationId: string): Promise<boolean> {
  if (!UUID_RE.test(locationId)) return false;
  const sb = getServiceRoleClient();
  const read = await readLocationCode(sb, locationId);
  if (!read.ok) return false;
  return stripeCredentialsFor(read.code) !== null;
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
    .select("id, amount_cents, provider_session_id")
    .eq("quote_id", quoteId)
    .eq("kind", kind)
    .eq("status", "due")
    .limit(1)
    .maybeSingle<{ id: string; amount_cents: number; provider_session_id: string | null }>();
  if (exErr) throw new Error(`initiatePayment existing: ${exErr.message}`);

  // A REUSED INTENT CARRIES TODAY'S AMOUNT (audit W02/B038). `amountCents` is read from
  // the quote's snapshot on this request; the row may have been raised when the snapshot
  // said something else. The row is the authority the webhook and the staff board read, so
  // it is re-priced before anyone is sent to pay it — guarded on `due`, so a row a payment
  // advanced in the meantime refuses instead of being rewritten under the money.
  //
  // …BUT NEVER UNDER AN OPEN CHECKOUT (review r1). If the intent still points at a Checkout
  // Session, that session can be paid at the OLD amount; re-pricing the row first is how
  // $300 was captured on a row that said $200. So the session is retired FIRST (fail
  // closed: 502 if Stripe will not confirm it, 409 if its payment is already landing, 503
  // if this shop can no longer reach Stripe at all), and the amount and the cleared id are
  // then written in ONE guarded UPDATE.
  if (existing && existing.amount_cents !== amountCents) {
    const openSession = existing.provider_session_id;
    if (openSession) {
      const creds = stripeCredentialsFor(await locationCodeFor(sb, quote.locationId));
      if (!creds) {
        throw new PortalQuoteError(503, "payment_unavailable", "Payment is temporarily unavailable — please try again");
      }
      await retireOrRefuse(creds.secretKey, openSession);
    }
    const repriced = await syncDuePaymentAmount(sb, existing.id, amountCents, openSession);
    if (!repriced) throw new PortalQuoteError(409, "not_due", "That payment is no longer due");
  }

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

/**
 * Retire another Checkout Session of this quote, or refuse the request. Fails CLOSED:
 *   - it cannot be retired (Stripe down, a refusal we cannot explain) → 502, mint nothing;
 *   - it is already `complete` → 409 `payment_in_progress`: that money is landing, and a
 *     second checkout would be a second charge.
 */
async function retireOrRefuse(secretKey: string, sessionId: string): Promise<void> {
  let outcome: Awaited<ReturnType<typeof retireCheckoutSession>>;
  try {
    outcome = await retireCheckoutSession(secretKey, sessionId);
  } catch (e) {
    if (e instanceof StripeError) {
      console.error(`[stripe] could not retire an open checkout session (${e.status}/${e.code}):`, e.message);
      throw new PortalQuoteError(502, "provider_error", "Payment provider is unavailable");
    }
    throw e;
  }
  if (outcome === "complete") {
    throw new PortalQuoteError(409, "payment_in_progress", "A payment for this order is already in progress");
  }
}

/** Close a session we minted and then decided not to hand out. BEST-EFFORT: the request is
 *  already being refused, and an unused session lapses on its own; this only shortens the
 *  time an orphan stays payable. Never throws. */
async function abandonSession(secretKey: string, sessionId: string): Promise<void> {
  try {
    await retireCheckoutSession(secretKey, sessionId);
  } catch (e) {
    console.error("[stripe] could not close an abandoned checkout session:", e instanceof Error ? e.message : e);
  }
}

/** What the customer's browser needs to leave for Stripe. */
export interface QuoteCheckout {
  /** The hosted Checkout URL. The ONLY thing the client is told. */
  url: string;
}

/**
 * What a row's stored Checkout Session is RIGHT NOW, or refuse. Fails CLOSED like
 * `retireOrRefuse`: if Stripe cannot be asked, nothing new is offered (502).
 */
async function inspectOrRefuse(secretKey: string, sessionId: string): Promise<CheckoutSessionState> {
  try {
    return await retrieveCheckoutSession(secretKey, sessionId);
  } catch (e) {
    if (e instanceof StripeError) {
      console.error(`[stripe] could not read a checkout session (${e.status}/${e.code}):`, e.message);
      throw new PortalQuoteError(502, "provider_error", "Payment provider is unavailable");
    }
    throw e;
  }
}

/**
 * Mint a hosted Stripe Checkout Session for an intent `initiatePayment` just guaranteed —
 * or hand back the one this attempt already has.
 *
 * ── ORDER OF OPERATIONS, AND WHY ─────────────────────────────────────────────────────
 *   1. re-load + re-own the quote (a second request is a second authorization),
 *   2. resolve the shop's credentials (no keys ⇒ 409 `not_configured`; the route should
 *      never have got here, and guessing a different account's keys is not a fallback),
 *   3. retire every OTHER open session of the quote,
 *   4. settle the intent's OWN stored session: hand it back, or close it for good,
 *   5. create a session at Stripe under a key no request has used before,
 *   6. COMPARE-AND-SET the still-`due`, session-less row to `provider='stripe'` + the id.
 *
 * ── ONE OPEN CHECKOUT PER QUOTE (audit W02/B035) ─────────────────────────────────────
 * A staff quote far enough out offers two ways to pay — a deposit, or the full amount —
 * and each `catering_payments` row gets its own hosted session. Nothing closed the first
 * when the customer opened the second, so BOTH stayed payable for a day and both charges
 * were accepted: a deposit and the full total for one order. So in step 3 every OTHER open
 * session on this quote's `due` rows is retired at Stripe (`retireCheckoutSession`) and
 * its id cleared from its row. It fails CLOSED: a session we cannot retire is a 502 and
 * nothing new is offered; a session that turns out to be already `complete` is a 409
 * `payment_in_progress`, because that customer's money is landing and the only honest next
 * screen is "your payment is being processed".
 * Migration 0303's partial unique index (`catering_payments_one_open_checkout`) makes the
 * same rule a database fact for the one case code cannot close — two requests racing — and
 * step 6 reads its 23505 as exactly that. Everything here works before 0303 is applied;
 * the index only narrows the race.
 *
 * ── A CHECKOUT ATTEMPT IS ONE SESSION, AND A RETIRED ONE NEVER COMES BACK (review r1) ─
 * The first cut keyed Stripe's idempotency on `<payment id>:<amount>` and let Stripe decide
 * whether a tap was "the same attempt". Stripe's contract (docs.stripe.com/api/
 * idempotent_requests) makes that wrong twice over: a key replays the ORIGINAL response
 * for 24 hours — whatever has happened to the session since — and a key re-used with other
 * parameters is an error. So deposit → full → deposit handed the customer the deposit
 * session we had just retired (a dead link), and a revise that kept the amount moved the
 * row to a new quote id under the same key (a 400 for a day).
 *
 * The attempt is therefore OURS to identify, and the row already does: its stored
 * `provider_session_id` IS the attempt. Step 4 asks Stripe what that session is now:
 *   · `open`, for THIS quote, THIS intent and THIS amount → the same checkout is handed
 *     back and nothing is minted. That is idempotency within an attempt, decided on facts
 *     (a second tap, a second tab) instead of on a key Stripe forgets after a day.
 *   · `complete` → 409 `payment_in_progress`: the money is landing.
 *   · anything else — lapsed, gone, another amount, another quote (a revise whose carry
 *     could not retire it) — is not this attempt. It is retired if it is still open (fail
 *     closed) and its id cleared, guarded on that exact id.
 * Step 5 then mints under a FRESH key every time (`<payment id>:<uuid>`): a session we
 * retired, abandoned or never recorded can never be replayed to a customer, and no two
 * mints can collide on parameters. The key still protects what it is for — one HTTP
 * request retried at the transport layer — and nothing else leans on it.
 *
 * Two requests that both reach step 5 each mint their own session; step 6 is what picks
 * ONE. The write is guarded on `status = 'due'` AND `provider_session_id IS NULL` — the
 * state step 4 left — so the second writer matches nothing, closes the session it minted
 * (best-effort) and answers 409 `payment_in_progress`; a row a webhook advanced to `paid`
 * in the meantime answers 409 `not_due`. Either way the customer is never handed a second
 * checkout for money that is already on its way.
 *
 * Step 6 runs AFTER step 5 on purpose: a session is not a charge, so a session we then
 * fail to record costs nothing but an unused Stripe object, whereas recording a session id
 * we failed to create would leave the webhook's fallback lookup pointing at nothing.
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
    .select("id, quote_id, status, currency, provider_session_id")
    .eq("id", input.paymentId)
    .maybeSingle<{
      id: string;
      quote_id: string;
      status: string;
      currency: string | null;
      provider_session_id: string | null;
    }>();
  if (payErr) throw new Error(`createQuoteCheckout payment: ${payErr.message}`);
  if (!payRow || payRow.quote_id !== input.quoteId) {
    throw new PortalQuoteError(404, "not_found", "Payment not found");
  }
  if (payRow.status !== "due") {
    throw new PortalQuoteError(409, "not_due", "That payment is no longer due");
  }

  // ONE OPEN CHECKOUT PER QUOTE (see the header): retire every other open session on this
  // quote's due rows BEFORE a second way to pay exists. Only `due` rows matter — a paid,
  // refunded or void row's old session id is history, not a live payment surface.
  const { data: openRows, error: openErr } = await sb
    .from("catering_payments")
    .select("id, provider_session_id")
    .eq("quote_id", input.quoteId)
    .eq("status", "due")
    .not("provider_session_id", "is", null)
    .returns<Array<{ id: string; provider_session_id: string | null }>>();
  if (openErr) throw new Error(`createQuoteCheckout open sessions: ${openErr.message}`);
  let retiredSessions = 0;
  for (const other of openRows ?? []) {
    if (other.id === input.paymentId || !other.provider_session_id) continue;
    await retireOrRefuse(creds.secretKey, other.provider_session_id);
    // Guarded on the exact session we retired: a row that moved in the meantime is left alone.
    const { error: clearErr } = await sb
      .from("catering_payments")
      .update({ provider_session_id: null }, { count: "exact" })
      .eq("id", other.id)
      .eq("status", "due")
      .eq("provider_session_id", other.provider_session_id);
    if (clearErr) throw new Error(`createQuoteCheckout clear retired session: ${clearErr.message}`);
    retiredSessions += 1;
  }

  // THE INTENT'S OWN STORED SESSION (see the header): the same attempt, or not ours to reuse.
  const stored = payRow.provider_session_id;
  if (stored) {
    const state = await inspectOrRefuse(creds.secretKey, stored);
    if (state.status === "complete") {
      throw new PortalQuoteError(409, "payment_in_progress", "A payment for this order is already in progress");
    }
    const sameAttempt =
      state.status === "open" &&
      state.url != null &&
      state.amountTotal === input.amountCents &&
      state.quoteId === input.quoteId &&
      state.paymentId === input.paymentId;
    if (sameAttempt) return { url: state.url as string };

    // Not this attempt. Close it for good before anything new exists (an open one may
    // still be paid; `retireOrRefuse` also catches one completed since the read above).
    if (state.status === "open") await retireOrRefuse(creds.secretKey, stored);
    const { error: clearErr, count: cleared } = await sb
      .from("catering_payments")
      .update({ provider_session_id: null }, { count: "exact" })
      .eq("id", input.paymentId)
      .eq("status", "due")
      .eq("provider_session_id", stored);
    if (clearErr) throw new Error(`createQuoteCheckout clear own session: ${clearErr.message}`);
    // Zero rows: the row moved under us (paid, or another request replaced the session).
    if ((cleared ?? 0) === 0) {
      throw new PortalQuoteError(409, "payment_in_progress", "A payment for this order is already in progress");
    }
    retiredSessions += 1;
  }

  const origin = portalOrigin({ ...process.env, NEXT_PUBLIC_APP_URL: input.appOrigin })!.replace(/\/$/, "");
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
      // A FRESH KEY PER MINT (see the header). The payment id is a prefix only so the
      // request is findable in Stripe's logs; the uuid is what makes it this mint's alone.
      `${input.paymentId}:${randomUUID()}`,
    );
  } catch (e) {
    if (e instanceof StripeError) {
      // Stripe's message describes the REQUEST, never the credential — safe to log.
      console.error(`[stripe] checkout session failed (${e.status}/${e.code}):`, e.message);
      throw new PortalQuoteError(502, "provider_error", "Payment provider is unavailable");
    }
    throw e;
  }

  // COMPARE-AND-SET: only the still-due row that still holds NO session takes this one.
  const { error: updErr, count } = await sb
    .from("catering_payments")
    .update({ provider: "stripe", provider_session_id: session.id }, { count: "exact" })
    .eq("id", input.paymentId)
    .eq("status", "due")
    .is("provider_session_id", null);
  if (updErr) {
    await abandonSession(creds.secretKey, session.id);
    // 0303's `catering_payments_one_open_checkout`: another request attached a session to
    // this quote between our read and this write. That request won; ours is closed.
    if (updErr.code === "23505") {
      throw new PortalQuoteError(409, "payment_in_progress", "A payment for this order is already in progress");
    }
    throw new Error(`createQuoteCheckout persist session: ${updErr.message}`);
  }
  if (count === 0) {
    await abandonSession(creds.secretKey, session.id);
    // Lost the compare-and-set. Either the money already landed (the row is no longer due)
    // or another request recorded its own checkout on this intent first. Tell them apart
    // for the customer's sake; refuse the redirect either way.
    const { data: now } = await sb
      .from("catering_payments")
      .select("id, status")
      .eq("id", input.paymentId)
      .maybeSingle<{ id: string; status: string }>();
    if (now?.status === "due") {
      throw new PortalQuoteError(409, "payment_in_progress", "A payment for this order is already in progress");
    }
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
      retired_sessions: retiredSessions,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { url: session.url };
}
