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
import { reconcileFamilyPayments } from "@/lib/catering/payment-carry";
import { createPaymentDue, syncDuePaymentAmount } from "@/lib/catering/payments";
import { paymentPlan } from "@/lib/catering/payment-plan";
import {
  createCheckoutSession,
  retireCheckoutSession,
  retrieveCheckoutSession,
  stripeCredentialsFor,
  StripeError,
  type CheckoutSessionState,
  type StripeCredentials,
} from "@/lib/stripe/client";
import { retireSessionInOwningAccount, stripeAccountsForShop } from "@/lib/stripe/session-owner";
import { TENANT_NAME } from "@/lib/tenant";
import type { Quote, QuoteItem, QuoteDetail } from "@/lib/catering/quotes";
import { isQuoteLineKind } from "@/lib/catering/prep-demand-shared";
import { isQuoteStatus } from "@/lib/catering/quotes";
import { offerDeadlineMs, quotePayability, quoteTimeExpired } from "@/lib/portal/payability-shared";
import { checkoutSessionExpiry } from "@/lib/stripe/shared";

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
  /** When the offer stops being open, epoch ms — null for a quote not judged by the clock
   *  (a team-confirmed order, or no `expires_at`). A checkout must not outlive it. */
  offerDeadlineMs: number | null;
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
    .select("id, root_id, customer_id, location_id, origin, status, superseded_at, expires_at, event_date, deposit_cents, total_cents")
    .eq("id", quoteId)
    .maybeSingle<{
      id: string;
      root_id: string | null;
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

  // THE FAMILY'S PAYMENTS MUST BE ON THIS REVISION (review r1 of audit W02/B006). Every
  // check below this gate — the already-paid guard above all — asks "payments for THIS
  // quote id". A paid deposit still sitting on a superseded revision (a carry that failed,
  // or a revise made before the carry existed) is invisible to them, and the customer
  // would be charged again. So the carry is re-run here when anything is stranded, and a
  // quote whose money still cannot be accounted for is NOT payable: 409, "try again
  // shortly", no intent raised, no session minted. A quote that was never revised has no
  // earlier revision and costs nothing here.
  const family = await reconcileFamilyPayments(sb, {
    id: row.id,
    rootId: row.root_id ?? null,
    locationId: row.location_id,
    depositCents: row.deposit_cents,
    totalCents: row.total_cents,
  });
  if (family.attempted) {
    // Awaited: on the refusal we throw on the next line (audit() is fail-open, never throws).
    await audit({
      actorId: null,
      actorRole: null,
      action: "catering.quote.revise",
      resourceTable: "catering_quotes",
      resourceId: row.id,
      metadata: {
        outcome: family.reconciled ? "payments_reconciled" : "payments_reconcile_failed",
        context: "portal_pay",
        root_id: row.root_id,
        stranded: family.stranded,
        payments: family.healed,
        error: family.error,
      },
      ipAddress: null,
      userAgent: null,
    });
  }
  if (!family.reconciled) {
    throw new PortalQuoteError(409, "payment_reconciling", "We are updating this order's payment records — please try again shortly");
  }

  return {
    id: row.id,
    locationId: row.location_id,
    origin: normalizeOrigin(row.origin),
    eventDate: row.event_date,
    depositCents: row.deposit_cents,
    totalCents: row.total_cents,
    offerDeadlineMs: offerDeadlineMs(row.status, row.expires_at),
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
  // then written in ONE guarded UPDATE. "Confirm" means the account that OWNS the session
  // says so (review r4): the account the shop uses now may not be the one it was minted in.
  if (existing && existing.amount_cents !== amountCents) {
    const openSession = existing.provider_session_id;
    if (openSession) {
      const accounts = stripeAccountsForShop(await locationCodeFor(sb, quote.locationId));
      if (accounts.length === 0) {
        throw new PortalQuoteError(503, "payment_unavailable", "Payment is temporarily unavailable — please try again");
      }
      await retireOrRefuse(accounts, openSession);
    }
    // BOUND TO THIS QUOTE (review r5). `amountCents` is THIS revision's amount, and a
    // manager's revise can land between the read above and this write: its carry moves the
    // intent to the new revision and prices it for that one. The write therefore names the
    // quote and applies only while the intent is still on it — otherwise v1's $200 lands on
    // v2's $300 intent. Nothing written = find out which of the two things happened.
    const repriced = await syncDuePaymentAmount(sb, {
      paymentId: existing.id,
      quoteId,
      amountCents,
      retiredSessionId: openSession,
    });
    if (!repriced) {
      const { data: now, error: nowErr } = await sb
        .from("catering_payments")
        .select("id, status, quote_id")
        .eq("id", existing.id)
        .maybeSingle<{ id: string; status: string; quote_id: string }>();
      if (nowErr) throw new Error(`initiatePayment re-price re-read: ${nowErr.message}`);
      if (now?.status === "due" && now.quote_id !== quoteId) {
        // Still due, on another revision: the quote was revised under this request.
        throw new PortalQuoteError(409, "not_payable", "This quote was revised — reload it to see the current one");
      }
      throw new PortalQuoteError(409, "not_due", "That payment is no longer due");
    }
  }

  const paymentId = existing
    ? existing.id
    : (await createPaymentDue(sb, { quoteId, customerId, kind, amountCents, createdBy: customerId })).id;

  // THE GATE ABOVE IS A READ, AND A SETTLEMENT CAN LAND AFTER IT (review r3). The deposit's
  // webhook can finish between the already-paid read and the insert just made: it found no
  // `full` intent to void, and this request would go on to open a checkout for the whole
  // total beside a paid deposit. So the question is asked AGAIN now that the intent exists.
  // The two sides each WRITE and then READ the other's write (the webhook: flip to paid,
  // then void the quote's due deposit/full intents; this request: insert the intent, then
  // read for a paid row), so whichever order they land in, at least one of them sees the
  // other. An intent THIS request raised is voided — it is priced for an unpaid quote and
  // must not sit on the board as money due; one that was already there is left as it is.
  if (await quoteHasPaidPayment(sb, quoteId, "initiatePayment paid re-check")) {
    if (!existing) {
      const { error: voidErr } = await sb
        .from("catering_payments")
        .update({ status: "void" })
        .eq("id", paymentId)
        .eq("quote_id", quoteId)
        .eq("status", "due")
        .is("provider_session_id", null);
      if (voidErr) console.error(`[catering] could not void the intent ${paymentId} raised beside a settled payment:`, voidErr.message);
    }
    throw new PortalQuoteError(409, "already_paid", "A payment has already been received for this order");
  }

  // …AND SO CAN A REVISE (review r5). `loadPayableQuote` read this quote as the live
  // revision; a manager's revise can have superseded it before the intent was raised or
  // re-priced above. The intent would then sit `due` on a revision that is no longer the
  // offer, at that revision's amount, and this request would answer "recorded" (or go on to
  // open a checkout the attach refuses). Asked AFTER our own write, for the same reason as
  // the paid re-check: the revise supersedes and then its carry reads the family's
  // payments; this request writes and then reads `superseded_at` — whichever order they
  // land in, one of them sees the other. An intent THIS request raised is closed (guarded
  // on the row exactly as it was inserted: still due, still on this quote, no session — if
  // the carry has already taken it to the new revision it is that revision's intent and is
  // left alone). One that was already there is the carry's to move. Either way the customer
  // is told the quote changed.
  if (!(await quoteStillLive(sb, quoteId))) {
    if (!existing) {
      const { error: voidErr } = await sb
        .from("catering_payments")
        .update({ status: "void" })
        .eq("id", paymentId)
        .eq("quote_id", quoteId)
        .eq("status", "due")
        .is("provider_session_id", null);
      if (voidErr) console.error(`[catering] could not void the intent ${paymentId} raised on a superseded revision:`, voidErr.message);
    }
    throw new PortalQuoteError(409, "not_payable", "This quote was revised — reload it to see the current one");
  }

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

/** Is there a `paid` payment on this quote RIGHT NOW? THROWS on a read error — "we could not
 *  look" is never "nothing is paid". */
async function quoteHasPaidPayment(
  sb: ReturnType<typeof getServiceRoleClient>,
  quoteId: string,
  label: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("catering_payments")
    .select("id")
    .eq("quote_id", quoteId)
    .eq("status", "paid")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`${label}: ${error.message}`);
  return data != null;
}

/**
 * The quote's UNRESOLVED checkouts other than `exceptPaymentId`'s own: every `due` OR `void`
 * row that still names a Checkout Session (lib/catering/payment-sessions.ts has the rule).
 * A void intent is closed on OUR books only — its hosted page stays payable until Stripe
 * confirms it expired, and only then is its id cleared (review r3). `paid` / `refunded`
 * rows keep their id as history and are never returned.
 */
async function unresolvedCheckouts(
  sb: ReturnType<typeof getServiceRoleClient>,
  quoteId: string,
  exceptPaymentId: string,
  label: string,
): Promise<Array<{ id: string; status: string; provider_session_id: string }>> {
  const { data, error } = await sb
    .from("catering_payments")
    .select("id, status, provider_session_id")
    .eq("quote_id", quoteId)
    .in("status", ["due", "void"])
    .not("provider_session_id", "is", null)
    .returns<Array<{ id: string; status: string; provider_session_id: string | null }>>();
  if (error) throw new Error(`${label}: ${error.message}`);
  return (data ?? []).filter(
    (r): r is { id: string; status: string; provider_session_id: string } =>
      r.id !== exceptPaymentId && r.provider_session_id != null,
  );
}

/** What recording a minted session on its intent came to. Only `attached` hands out a URL. */
type AttachOutcome =
  | "attached" //           the intent now names the session
  | "already_paid" //       a payment has landed on the quote: nothing more is collectable here
  | "session_unresolved" // another due/void intent of the quote still names a checkout
  | "in_progress" //        the intent already names a session (another request attached first)
  | "not_due" //            the intent is gone or no longer due
  | "not_payable"; //       the quote was superseded, or the intent moved / was re-priced

const ATTACH_OUTCOMES: readonly AttachOutcome[] = ["attached", "already_paid", "session_unresolved", "in_progress", "not_due", "not_payable"];

interface AttachInput {
  paymentId: string;
  quoteId: string;
  amountCents: number;
  sessionId: string;
}

/**
 * Record a minted Checkout Session on its intent — the step that makes the checkout the
 * customer is about to be sent to OURS — and decide, at that same moment, whether the quote
 * may still be collected on at all (review r3).
 *
 * ── WITH MIGRATION 0303: ONE DECISION UNDER THE QUOTE'S LOCK ─────────────────────────
 * `catering_payment_attach_checkout` locks the quote row (FOR UPDATE — which also holds
 * back any payment being inserted on, or moved onto, the quote: their foreign-key check
 * needs that row) and every payment row of the quote (which holds back a status flip:
 * a webhook's or a person's `due → paid`), and only then reads: is the intent still due,
 * on this quote, at this amount, with no session; is anything on the quote PAID; does any
 * other due/void intent still name a checkout. A settlement therefore lands entirely
 * before the attach (which then refuses) or entirely after it (and the settlement closes
 * the checkout it finds — lib/catering/payment-sessions.ts). Never in between.
 *
 * ── BEFORE 0303: WRITE, THEN LOOK AGAIN ──────────────────────────────────────────────
 * PostgREST answers PGRST202 for a function that does not exist. The attach is then the
 * compare-and-set it always was, FOLLOWED by a re-read of the same facts the function
 * reads: is anything on the quote paid, is the quote still the family's LIVE revision
 * (review r4 — a settlement can have been carried off a revision superseded under us), does
 * another intent still name a checkout. If any
 * has turned true the attach is undone (guarded on the exact session) and refused. That is
 * not a lock, but it is not a hole either: this request writes its session and then reads;
 * a settlement writes `paid` and then reads the quote's open checkouts; a competing attach
 * writes its own session and then reads. Whatever the order, the later READ sees the
 * earlier WRITE, and the side that sees it backs out. Two attaches that see each other
 * both back out — nobody is sent to pay, which is the safe way to lose a race.
 */
async function attachCheckoutSession(
  sb: ReturnType<typeof getServiceRoleClient>,
  input: AttachInput,
): Promise<AttachOutcome> {
  const { data, error } = await sb.rpc("catering_payment_attach_checkout", {
    p_payment_id: input.paymentId,
    p_quote_id: input.quoteId,
    p_amount_cents: input.amountCents,
    p_session_id: input.sessionId,
  });
  if (!error) {
    if (typeof data === "string" && (ATTACH_OUTCOMES as readonly string[]).includes(data)) return data as AttachOutcome;
    throw new Error(`createQuoteCheckout attach: unexpected answer ${JSON.stringify(data)}`);
  }
  // 0303 not applied (see above). Anything else about the function is a real failure.
  if (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message)) {
    return attachCheckoutSessionUnlocked(sb, input);
  }
  // 0303's `catering_payments_one_open_checkout`, or a lock the function could not take:
  // another request is working this quote's checkout right now. That request wins.
  if (error.code === "23505" || error.code === "40P01" || error.code === "55P03") return "in_progress";
  throw new Error(`createQuoteCheckout attach: ${error.message}`);
}

/** Is this quote row still its family's live revision? THROWS on a read error. */
async function quoteStillLive(sb: ReturnType<typeof getServiceRoleClient>, quoteId: string): Promise<boolean> {
  const { data, error } = await sb
    .from("catering_quotes")
    .select("id, superseded_at")
    .eq("id", quoteId)
    .maybeSingle<{ id: string; superseded_at: string | null }>();
  if (error) throw new Error(`quote live re-check: ${error.message}`);
  return data != null && data.superseded_at == null;
}

/** The pre-0303 attach: compare-and-set, then re-check, then undo if the quote moved. */
async function attachCheckoutSessionUnlocked(
  sb: ReturnType<typeof getServiceRoleClient>,
  input: AttachInput,
): Promise<AttachOutcome> {
  // COMPARE-AND-SET: only the still-due row that still holds NO session takes this one —
  // and only while it is still the intent this session was MINTED FOR (review r2): on this
  // quote, at this amount. A manager's revise can land while the mint is at Stripe; its
  // carry moves the intent to the new revision and re-prices it, and a session at the old
  // amount must not then be recorded on a row that says the new one.
  const { error: updErr, count } = await sb
    .from("catering_payments")
    .update({ provider: "stripe", provider_session_id: input.sessionId }, { count: "exact" })
    .eq("id", input.paymentId)
    .eq("status", "due")
    .eq("quote_id", input.quoteId)
    .eq("amount_cents", input.amountCents)
    .is("provider_session_id", null);
  if (updErr) {
    // 0303's index without its function cannot happen (one file), but the index is the
    // same fact either way: another request attached a session to this quote first.
    if (updErr.code === "23505") return "in_progress";
    throw new Error(`createQuoteCheckout persist session: ${updErr.message}`);
  }
  if (count === 0) {
    // Lost the compare-and-set. Either the money already landed (the row is no longer due),
    // or the quote was revised under us (the intent now belongs to another revision or
    // carries another amount), or another request recorded its own checkout on this intent
    // first. Tell them apart for the customer's sake; the redirect is refused every time.
    const { data: now } = await sb
      .from("catering_payments")
      .select("id, status, quote_id, amount_cents")
      .eq("id", input.paymentId)
      .maybeSingle<{ id: string; status: string; quote_id: string; amount_cents: number }>();
    if (now?.status === "due" && (now.quote_id !== input.quoteId || now.amount_cents !== input.amountCents)) return "not_payable";
    if (now?.status === "due") return "in_progress";
    return "not_due";
  }

  // WRITE, THEN LOOK AGAIN (see `attachCheckoutSession`). A failed read here must not leave
  // the session attached AND unexamined, so it is treated as the worst answer.
  let verdict: AttachOutcome = "attached";
  try {
    if (await quoteHasPaidPayment(sb, input.quoteId, "createQuoteCheckout paid re-check")) verdict = "already_paid";
    // IS THIS STILL THE ORDER? (review r4.) Both reads here ask about `input.quoteId`. A
    // revise that landed while the session was at Stripe makes that a SUPERSEDED revision,
    // and its carry empties it one row at a time — a deposit settled a moment ago may
    // already be on the new revision while this intent has not been moved yet, so "nothing
    // paid here" would be true and meaningless. 0303's function re-reads `superseded_at`
    // under the quote's lock; this is the same question, asked after our own write.
    else if (!(await quoteStillLive(sb, input.quoteId))) verdict = "not_payable";
    else if ((await unresolvedCheckouts(sb, input.quoteId, input.paymentId, "createQuoteCheckout session re-check")).length > 0) {
      verdict = "session_unresolved";
    }
  } catch (e) {
    console.error("[catering] could not re-check the quote after attaching a checkout:", e instanceof Error ? e.message : e);
    verdict = "session_unresolved";
  }
  if (verdict === "attached") return verdict;

  // Undo our own attach, guarded on the exact session: the caller closes it at Stripe.
  const { error: undoErr } = await sb
    .from("catering_payments")
    .update({ provider_session_id: null })
    .eq("id", input.paymentId)
    .eq("provider_session_id", input.sessionId);
  if (undoErr) console.error(`[catering] could not detach checkout ${input.sessionId} from payment ${input.paymentId}:`, undoErr.message);
  return verdict;
}

/**
 * Retire another Checkout Session of this quote, or refuse the request. Fails CLOSED:
 *   - it cannot be retired (Stripe down, a refusal we cannot explain) → 502, mint nothing;
 *   - NO ACCOUNT THIS SHOP IS CONFIGURED WITH KNOWS IT (review r4) → 502 as well. A 404 is
 *     "this key cannot see it", not "it is closed": the shop's Stripe account can have
 *     changed since the session was minted, and it is still payable where it lives. So the
 *     session's OWNING account is asked (`retireSessionInOwningAccount` tries each account
 *     the shop is configured with); when none of them knows it, the id stays on its row and
 *     nothing new is offered;
 *   - it is already `complete` → 409 `payment_in_progress`: that money is landing, and a
 *     second checkout would be a second charge.
 */
async function retireOrRefuse(accounts: ReadonlyArray<Pick<StripeCredentials, "secretKey">>, sessionId: string): Promise<void> {
  let outcome: Awaited<ReturnType<typeof retireSessionInOwningAccount>>;
  try {
    outcome = await retireSessionInOwningAccount(accounts, sessionId);
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
 *   3. refuse if anything on the quote is already paid; then resolve every OTHER unresolved
 *      checkout of the quote (a `due` OR a `void` row that still names a session),
 *   4. settle the intent's OWN stored session: hand it back, or close it for good,
 *   5. create a session at Stripe under a key no request has used before,
 *   6. ATTACH it — and decide, in that same step, whether the quote may still be collected
 *      on (`attachCheckoutSession`: 0303's function under the quote's lock, or before 0303 a
 *      compare-and-set followed by a re-check).
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
 * the index and the attach function only make the race's outcome a database fact.
 *
 * ── A VOID INTENT'S CHECKOUT IS NOT CLOSED UNTIL STRIPE SAYS SO (review r3) ──────────
 * Step 3 used to look at `due` rows only. But an intent is voided on OUR books — by a
 * revise whose new deposit is zero, by a payment landing on its sibling — and its hosted
 * page stays payable unless the session was actually retired. When that retirement failed,
 * the row was `void` with the session id still on it, invisible here, and a second checkout
 * opened beside it. A session id on a `due` or `void` row is an UNRESOLVED checkout (the
 * rule is written out in lib/catering/payment-sessions.ts): it blocks this request until
 * Stripe confirms it expired — 502 when Stripe will not, 409 when it is already complete —
 * and its id is cleared only then. A replacement is offered after confirmed retirement,
 * never instead of it.
 *
 * ── SETTLEMENT AND CHECKOUT ARE DECIDED TOGETHER, PER QUOTE (review r3) ──────────────
 * `initiatePayment`'s already-paid gate is a read, and a deposit's webhook could land
 * between that read and this function's attach: the full-amount checkout then opened
 * beside a PAID deposit — which is not a due row, so nothing above saw it, and not in
 * 0303's index either. A paid row on the quote now refuses in step 3 and again, decisively,
 * in step 6 (see `attachCheckoutSession` for why that second look cannot be raced past).
 *
 * ── A CHECKOUT ATTEMPT IS ONE SESSION, AND A RETIRED ONE NEVER COMES BACK (review r1) ─
 * The first cut keyed Stripe's idempotency on `<payment id>:<amount>` and let Stripe decide
 * whether a tap was "the same attempt". Stripe's contract (docs.stripe.com/api/
 * idempotent_requests) makes that wrong twice over: a key replays the ORIGINAL response
 * for at least 24 hours — whatever has happened to the session since — and a key re-used with other
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
 *   · anything else — lapsed, another amount, another quote (a revise whose carry could not
 *     retire it) — is not this attempt. It is retired if it is still open (fail closed) and
 *     its id cleared, guarded on that exact id.
 *   · `not_found` — the account this shop uses NOW does not know it (review r4). That is
 *     not "lapsed": the session may be open in the account the shop used when it was minted.
 *     It is treated exactly like an open one — its owning account must confirm it retired
 *     (`retireOrRefuse`), or the request is refused (502) with the id still on the row.
 * Step 5 then mints under a FRESH key every time (`<payment id>:<uuid>`): a session we
 * retired, abandoned or never recorded can never be replayed to a customer, and no two
 * mints can collide on parameters. The key still protects what it is for — one HTTP
 * request retried at the transport layer — and nothing else leans on it.
 *
 * Two requests that both reach step 5 each mint their own session; step 6 is what picks
 * ONE. The attach requires `status = 'due'` AND `provider_session_id IS NULL` — the
 * state step 4 left — so the second writer is refused, closes the session it minted
 * (best-effort) and answers 409 `payment_in_progress`; a row a webhook advanced to `paid`
 * in the meantime answers 409 `not_due`. Either way the customer is never handed a second
 * checkout for money that is already on its way. The same write is guarded on the intent
 * still being on THIS quote at THIS amount (review r2): an intent a revise moved or
 * re-priced while the mint was at Stripe answers 409 `not_payable`, and the session priced
 * for the old revision is closed instead of recorded.
 *
 * ── A CHECKOUT DOES NOT OUTLIVE THE OFFER IT PAYS (review r2) ────────────────────────
 * The pay gate reads the clock (B037), but only when a checkout is OPENED. A session minted
 * five minutes before the offer's `expires_at` stayed payable for Stripe's default 24 hours.
 * So the session is minted with `expires_at` = the offer's own deadline, inside the range
 * Stripe allows — "anywhere from 30 minutes to 24 hours after Checkout Session creation"
 * (docs.stripe.com/api/checkout/sessions/create) — see `checkoutSessionExpiry`. An offer
 * with less than that minimum left still gets a checkout, at the minimum: the customer
 * tapped Pay while the offer was open. A payment that settles in that overhang (or through
 * a session minted before this rule) is recorded and FLAGGED by the webhook
 * (`paid_after_expiry`), and does not by itself let the team accept the lapsed offer
 * (`offerTakenUpInTime`). A team-confirmed (`accepted`) order is not on the offer's clock.
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
  // `creds` is where NEW money goes. A session that already exists is closed by the account
  // that OWNS it, which may be another one of the shop's (review r4 — `retireOrRefuse`).
  const accounts = stripeAccountsForShop(code);

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

  // NOTHING IS COLLECTED ON A QUOTE THAT HAS BEEN PAID TOWARD (review r3). `initiatePayment`
  // asked this; a settlement can have landed since (this is a second request, and the first
  // one's answer is not inherited). Asked here before anything is retired or minted, and
  // once more, atomically, when the session is attached (`attachCheckoutSession`).
  if (await quoteHasPaidPayment(sb, input.quoteId, "createQuoteCheckout paid check")) {
    throw new PortalQuoteError(409, "already_paid", "A payment has already been received for this order");
  }

  // ONE OPEN CHECKOUT PER QUOTE (see the header): resolve every OTHER unresolved checkout
  // of the quote BEFORE a second way to pay exists. That is every `due` row that names a
  // session AND every `void` one (review r3): a voided intent whose session could not be
  // retired — a revise's carry with Stripe down, a webhook that could not close a sibling
  // — is closed on our books and still payable at Stripe. Each is retired or the request is
  // refused (`retireOrRefuse`, fail closed), and its id is cleared only on Stripe's word. A
  // paid or refunded row's id is history, not a live payment surface.
  const others = await unresolvedCheckouts(sb, input.quoteId, input.paymentId, "createQuoteCheckout open sessions");
  let retiredSessions = 0;
  for (const other of others) {
    await retireOrRefuse(accounts, other.provider_session_id);
    // Guarded on the exact session we retired: a row that moved in the meantime is left alone.
    const { error: clearErr } = await sb
      .from("catering_payments")
      .update({ provider_session_id: null }, { count: "exact" })
      .eq("id", other.id)
      .in("status", ["due", "void"])
      .eq("provider_session_id", other.provider_session_id);
    if (clearErr) throw new Error(`createQuoteCheckout clear retired session: ${clearErr.message}`);
    retiredSessions += 1;
  }

  // THE SESSION DOES NOT OUTLIVE THE OFFER (review r2 — see the header). Stripe's default
  // session lives 24 hours; an offer with two hours left would stay payable for twenty-two
  // more through a checkout this gate is never asked about again.
  const sessionExpiresAt = checkoutSessionExpiry(
    Math.floor(Date.now() / 1000),
    quote.offerDeadlineMs == null ? null : quote.offerDeadlineMs / 1000,
  );

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
      state.paymentId === input.paymentId &&
      // …and it ends no later than a checkout minted now would. A session that outlives the
      // offer (minted before this rule, or before the offer's date moved) is not handed back.
      (sessionExpiresAt === undefined || state.expiresAt == null || state.expiresAt <= sessionExpiresAt);
    if (sameAttempt) return { url: state.url as string };

    // Not this attempt. Close it for good before anything new exists (an open one may
    // still be paid; `retireOrRefuse` also catches one completed since the read above).
    // `not_found` is NOT closed (review r4): this account cannot see it, so the account that
    // minted it has to say it is retired — or the id stays where it is and we refuse.
    if (state.status === "open" || state.status === "not_found") await retireOrRefuse(accounts, stored);
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
        expiresAtSec: sessionExpiresAt,
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

  // RECORD IT, AND DECIDE ELIGIBILITY AT THE SAME MOMENT (`attachCheckoutSession`): the
  // intent must still be due, on THIS quote, at THIS amount (review r2), holding no session;
  // nothing on the quote may be paid, and no other intent may still name a checkout (review
  // r3). Any answer but `attached` closes the session we just minted — it must not stay
  // payable with nothing of ours naming it — and refuses the redirect.
  let attached: AttachOutcome;
  try {
    attached = await attachCheckoutSession(sb, {
      paymentId: input.paymentId,
      quoteId: input.quoteId,
      amountCents: input.amountCents,
      sessionId: session.id,
    });
  } catch (e) {
    await abandonSession(creds.secretKey, session.id);
    throw e;
  }
  if (attached !== "attached") {
    await abandonSession(creds.secretKey, session.id);
    switch (attached) {
      case "already_paid":
        // A payment landed while this checkout was being opened.
        throw new PortalQuoteError(409, "already_paid", "A payment has already been received for this order");
      case "not_payable":
        throw new PortalQuoteError(409, "not_payable", "This quote can no longer be paid");
      case "not_due":
        throw new PortalQuoteError(409, "not_due", "That payment is no longer due");
      default:
        // `in_progress` / `session_unresolved`: another checkout for this order exists.
        throw new PortalQuoteError(409, "payment_in_progress", "A payment for this order is already in progress");
    }
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
