/**
 * Catering refunds — the server half. SERVER-ONLY (service-role reads; Stripe calls). Pure rules live in
 * lib/catering/refunds-shared.ts; the database authority is migration 0357.
 *
 * THE FLOW
 *   1. `requestRefund` — the confirm tap. App gate (role + shop) → `catering_refund_reserve` (0357: the actor rule
 *      again, the order's payment rows locked, every figure recomputed under the locks, the amount allocated over the
 *      Stripe-paid payments, an over-refund refused by name, one `catering_refund_requests` row per payment and its
 *      destructive `catering.refund.request` audit row, all in one transaction) → `submitRefundRow` for each new row.
 *      A tap whose `clientToken` the database has seen is the SAME tap: the rows it made are returned and Stripe is
 *      NOT called again (a double tap, a re-sent request, a browser retry = exactly one Stripe refund).
 *   2. `submitRefundRow` — one row, one Stripe request, under the row's own exclusive, expiring claim (0357
 *      `catering_refund_claim`; every outcome write is fenced on the claim token, review r1), so two presses never send
 *      at once and a press that outlived its claim cannot overwrite the newer one. Every attempt first lists the
 *      PaymentIntent's refunds for one carrying this row's id. Idempotency-Key `catering-refund:<row id>`, the same parameters every time.
 *      A refusal Stripe certainly did not act on → `failed` (the amount is released). An unknown outcome (no response,
 *      5xx, 409, 429) → the row STAYS `pending`, counted against what is refundable, with the error recorded:
 *      a clear, retryable state.
 *   3. `retryRefundRequest` — a pending row: first look for a Stripe refund carrying this row's id (a lost response
 *      that did land), else send again with the same key, but only inside Stripe's 24-hour retry window; past it the
 *      row is `needs_reconcile` and a person checks Stripe. A submitted row (Stripe `pending`): read it again.
 *   The Stripe webhook (`charge.refunded`) then records the refund events and, for a whole-charge refund, moves the
 *   payment to `refunded` — the figures every report reads. Nothing here writes a payment row or a refund event.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, isAllLocationsAccess } from "@/lib/locations";
import { audit } from "@/lib/audit";
import { ownEntry } from "@/lib/api-helpers";
import {
  createRefund,
  listRefundsForPaymentIntent,
  retrievePaymentIntentCharge,
  retrieveRefund,
  StripeError,
  type StripeCredentials,
  type StripeRefund,
} from "@/lib/stripe/client";
import { stripeAccountsForShop } from "@/lib/stripe/session-owner";
import {
  canRequestRefund,
  refundFigures,
  refundIdempotencyKey,
  refundStatusFromStripe,
  requestRetryState,
  outsideRefundedCents,
  stripeCreateFailure,
  stripeRefundReason,
  summarizeTotals,
  REFUND_SQL_REFUSALS,
  isRefundReasonCode,
  isRefundTrigger,
  type RefundErrorCode,
  type RefundPaymentView,
  type RefundRequestBody,
  type RefundRequestView,
  type RefundStatus,
  type RefundSummary,
} from "@/lib/catering/refunds-shared";
import type { AuthContext } from "@/lib/session";

export * from "@/lib/catering/refunds-shared";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/** Viewing the refund panel: the payments read floor (shift lead+), at a shop the viewer can see. */
export const REFUND_READ_MIN = 5;

export class CateringRefundError extends Error {
  constructor(public status: number, public code: RefundErrorCode, public detail?: Record<string, unknown>) {
    super(code);
    this.name = "CateringRefundError";
  }
}

function missingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return ["PGRST205", "42P01", "PGRST202", "42883"].includes(error.code ?? "") || /could not find the (table|function)/i.test(error.message ?? "");
}

function canSee(actor: AuthContext, locationId: string): boolean {
  return isAllLocationsAccess({ role: actor.user.role, locations: actor.locations }) || actor.locations.includes(locationId);
}

/** The app half of the refund gate. 0357's `catering_refund_actor_ok` decides again under the lock. */
export function actorMayRefund(actor: AuthContext, locationId: string): boolean {
  return canRequestRefund(actor.user.role) && lockLocationContext({ role: actor.user.role, locations: actor.locations }, locationId);
}

interface QuoteRow { id: string; location_id: string; root_id: string | null }
interface PaymentRow {
  id: string;
  quote_id: string;
  kind: "deposit" | "balance" | "full";
  amount_cents: number;
  status: string;
  provider: string | null;
  provider_ref: string | null;
  paid_at: string | null;
}
interface RequestRow {
  id: string;
  payment_id: string;
  quote_id: string;
  location_id: string;
  amount_cents: number;
  reason_code: string;
  reason_note: string | null;
  trigger_kind: string;
  status: RefundStatus;
  stripe_refund_id: string | null;
  stripe_status: string | null;
  last_error_code: string | null;
  attempts: number;
  first_attempt_at: string | null;
  requested_by: string;
  requested_at: string;
  outside_refunded_seen_cents: number | null;
}
const REQUEST_COLS =
  "id, payment_id, quote_id, location_id, amount_cents, reason_code, reason_note, trigger_kind, status, stripe_refund_id, stripe_status, last_error_code, attempts, first_attempt_at, requested_by, requested_at, outside_refunded_seen_cents";

async function loadQuote(sb: ServiceClient, quoteId: string): Promise<QuoteRow | null> {
  const { data, error } = await sb.from("catering_quotes").select("id, location_id, root_id").eq("id", quoteId).maybeSingle<QuoteRow>();
  if (error) throw new Error(`refunds quote: ${error.message}`);
  return data ?? null;
}

/** Every payment of the order: the quote's whole revision family (payment-carry.ts keeps them on the live revision). */
async function loadFamilyPayments(sb: ServiceClient, quote: QuoteRow): Promise<PaymentRow[]> {
  const root = quote.root_id ?? quote.id;
  const { data: fam, error: fErr } = await sb.from("catering_quotes").select("id").or(`id.eq.${root},root_id.eq.${root}`).returns<Array<{ id: string }>>();
  if (fErr) throw new Error(`refunds family: ${fErr.message}`);
  const ids = [...new Set([quote.id, ...(fam ?? []).map((r) => r.id)])];
  const { data, error } = await sb
    .from("catering_payments")
    .select("id, quote_id, kind, amount_cents, status, provider, provider_ref, paid_at")
    .in("quote_id", ids)
    .order("created_at", { ascending: true })
    .returns<PaymentRow[]>();
  if (error) throw new Error(`refunds payments: ${error.message}`);
  return data ?? [];
}

// ── Read ────────────────────────────────────────────────────────────────────────────────────────────
export async function loadRefundSummary(actor: AuthContext, quoteId: string, nowMs: number = Date.now()): Promise<RefundSummary> {
  if (getRoleLevel(actor.user.role) < REFUND_READ_MIN) throw new CateringRefundError(403, "forbidden");
  const sb = getServiceRoleClient();
  const quote = await loadQuote(sb, quoteId);
  if (!quote || !canSee(actor, quote.location_id)) throw new CateringRefundError(404, "not_found");
  const payments = await loadFamilyPayments(sb, quote);
  const payIds = payments.map((p) => p.id);

  let installed = true;
  let requests: RequestRow[] = [];
  let events: Array<{ payment_id: string; cumulative_refunded_cents: number; charge_amount_cents: number | null }> = [];
  if (payIds.length > 0) {
    const [{ data: rq, error: rqErr }, { data: ev, error: evErr }] = await Promise.all([
      sb.from("catering_refund_requests").select(REQUEST_COLS).in("payment_id", payIds).order("requested_at", { ascending: false }).returns<RequestRow[]>(),
      sb.from("catering_payment_refund_events").select("payment_id, cumulative_refunded_cents, charge_amount_cents").in("payment_id", payIds)
        .returns<Array<{ payment_id: string; cumulative_refunded_cents: number; charge_amount_cents: number | null }>>(),
    ]);
    if (rqErr) {
      if (missingRelation(rqErr)) installed = false;
      else throw new Error(`refunds requests: ${rqErr.message}`);
    } else requests = rq ?? [];
    if (evErr) {
      if (!missingRelation(evErr)) throw new Error(`refunds events: ${evErr.message}`);
    } else events = ev ?? [];
  }

  const views: RefundPaymentView[] = payments.map((p) => ({
    id: p.id,
    kind: p.kind,
    status: p.status,
    provider: p.provider,
    amountCents: p.amount_cents,
    paidAt: p.paid_at,
    figures: refundFigures(
      { amountCents: p.amount_cents, status: p.status, provider: p.provider, providerRef: p.provider_ref },
      events.filter((e) => e.payment_id === p.id).map((e) => ({ cumulativeRefundedCents: Number(e.cumulative_refunded_cents), chargeAmountCents: e.charge_amount_cents == null ? null : Number(e.charge_amount_cents) })),
      requests.filter((r) => r.payment_id === p.id).map((r) => ({
        amountCents: Number(r.amount_cents),
        status: r.status,
        outsideRefundedSeenCents: r.outside_refunded_seen_cents == null ? null : Number(r.outside_refunded_seen_cents),
      })),
    ),
  }));

  const names = new Map<string, string>();
  const people = [...new Set(requests.map((r) => r.requested_by))];
  if (people.length > 0) {
    const { data } = await sb.from("users").select("id, name").in("id", people).returns<Array<{ id: string; name: string | null }>>();
    for (const u of data ?? []) if (u.name) names.set(u.id, u.name);
  }

  const requestViews: RefundRequestView[] = requests.map((r) => ({
    id: r.id,
    paymentId: r.payment_id,
    amountCents: Number(r.amount_cents),
    status: r.status,
    reasonCode: isRefundReasonCode(r.reason_code) ? r.reason_code : "other",
    reasonNote: r.reason_note,
    trigger: isRefundTrigger(r.trigger_kind) ? r.trigger_kind : "panel",
    stripeStatus: r.stripe_status,
    lastErrorCode: r.last_error_code,
    attempts: r.attempts,
    requestedAt: r.requested_at,
    requestedByName: names.get(r.requested_by) ?? null,
    ...requestRetryState({ status: r.status, firstAttemptAt: r.first_attempt_at, requestedAt: r.requested_at }, nowMs),
  }));

  return {
    quoteId: quote.id,
    locationId: quote.location_id,
    canRefund: installed && actorMayRefund(actor, quote.location_id),
    installed,
    payments: views,
    requests: requestViews,
    totals: summarizeTotals(views),
  };
}

// ── Write: the confirm tap ────────────────────────────────────────────────────────────────────────────
export interface RefundAttemptResult {
  id: string;
  paymentId: string;
  amountCents: number;
  status: RefundStatus;
  /** Set when this attempt did not end in a Stripe acceptance (see `submitRefundRow`). */
  errorCode: string | null;
}

export async function requestRefund(
  actor: AuthContext,
  quoteId: string,
  body: RefundRequestBody,
): Promise<{ replay: boolean; results: RefundAttemptResult[] }> {
  const sb = getServiceRoleClient();
  const quote = await loadQuote(sb, quoteId);
  if (!quote || !canSee(actor, quote.location_id)) throw new CateringRefundError(404, "not_found");
  if (!actorMayRefund(actor, quote.location_id)) throw new CateringRefundError(403, "forbidden");

  const { data, error } = await sb.rpc("catering_refund_reserve", {
    p_actor_id: actor.user.id,
    p_quote_id: quoteId,
    p_client_token: body.clientToken,
    p_amount_cents: body.amountCents,
    p_reason_code: body.reasonCode,
    p_reason_note: body.reasonNote,
    p_trigger: body.trigger,
  });
  if (error) {
    if (missingRelation(error)) throw new CateringRefundError(503, "refunds_unavailable");
    const named = ownEntry(REFUND_SQL_REFUSALS, (error.message ?? "").trim());
    if (named) {
      const detail = named.code === "over_refundable" && error.details && /^\d+$/.test(error.details) ? { refundableCents: Number(error.details) } : undefined;
      throw new CateringRefundError(named.status, named.code, detail);
    }
    throw new Error(`catering_refund_reserve: ${error.message}`);
  }
  const reserved = data as { replay: boolean; location_id: string; requests: Array<{ id: string; payment_id: string; amount_cents: number; status: RefundStatus }> };

  if (reserved.replay) {
    // The same tap again: report what it made. Stripe is NOT asked a second time (a pending row is retried by
    // its own Retry button, under its claim).
    return {
      replay: true,
      results: reserved.requests.map((r) => ({ id: r.id, paymentId: r.payment_id, amountCents: Number(r.amount_cents), status: r.status, errorCode: null })),
    };
  }

  const results: RefundAttemptResult[] = [];
  for (const r of reserved.requests) {
    results.push(await submitRefundRow(sb, actor, r.id));
  }
  return { replay: false, results };
}

// ── One row, one Stripe request ───────────────────────────────────────────────────────────────────────
async function loadRequest(sb: ServiceClient, requestId: string): Promise<RequestRow | null> {
  const { data, error } = await sb.from("catering_refund_requests").select(REQUEST_COLS).eq("id", requestId).maybeSingle<RequestRow>();
  if (error) {
    if (missingRelation(error)) throw new CateringRefundError(503, "refunds_unavailable");
    throw new Error(`refund request: ${error.message}`);
  }
  return data ?? null;
}

/**
 * A row this press holds the claim on (0357 `catering_refund_claim`, review r1): an exclusive, expiring sender lock.
 * Every outcome below is written ONLY while the row still carries this press's claim token (and releases it), so a
 * press that outlived its claim can never overwrite what a newer one recorded.
 */
interface ClaimedRow extends RequestRow {
  claimToken: string;
  /** Was anything possibly sent for this row before this press? (attempts counted before this claim) */
  sentBefore: boolean;
}

type Outcome = {
  status?: RefundStatus;
  stripe_refund_id?: string | null;
  stripe_status?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  outside_refunded_seen_cents?: number | null;
};

/** Write an outcome, fenced on the claim and the status it was claimed in. Returns false when the claim was lost. */
async function settleRow(sb: ServiceClient, row: ClaimedRow, patch: Outcome): Promise<boolean> {
  const now = new Date().toISOString();
  const terminal = patch.status === "succeeded" || patch.status === "failed";
  const { error, count } = await sb
    .from("catering_refund_requests")
    .update({ ...patch, claim_token: null, claimed_until: null, updated_at: now, ...(terminal ? { settled_at: now } : {}) }, { count: "exact" })
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("claim_token", row.claimToken);
  if (error) throw new Error(`refund settle: ${error.message}`);
  return (count ?? 0) > 0;
}

/** Take the row's sender claim. null = another press holds a live claim, or the row is finished. */
async function claimRow(sb: ServiceClient, row: RequestRow): Promise<ClaimedRow | null> {
  const { data, error } = await sb.rpc("catering_refund_claim", { p_request_id: row.id });
  if (error) {
    if (missingRelation(error)) throw new CateringRefundError(503, "refunds_unavailable");
    throw new Error(`catering_refund_claim: ${error.message}`);
  }
  const c = data as { claim_token: string; attempts: number; first_attempt_at: string | null; status: RefundStatus } | null;
  if (!c || typeof c.claim_token !== "string") return null;
  const attempts = Number(c.attempts);
  return {
    ...row,
    status: c.status,
    attempts,
    first_attempt_at: c.first_attempt_at,
    claimToken: c.claim_token,
    sentBefore: c.status === "pending" ? attempts - 1 > 0 : true,
  };
}

function result(row: RequestRow, status: RefundStatus, errorCode: string | null): RefundAttemptResult {
  return { id: row.id, paymentId: row.payment_id, amountCents: Number(row.amount_cents), status, errorCode };
}

function stripeOutcomeAudit(actor: AuthContext, row: RequestRow, outcome: Record<string, unknown>): void {
  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.refund.stripe_result",
    resourceTable: "catering_refund_requests",
    resourceId: row.id,
    metadata: { quote_id: row.quote_id, payment_id: row.payment_id, location_id: row.location_id, amount_cents: Number(row.amount_cents), ...outcome },
    ipAddress: null,
    userAgent: null,
  });
}

async function shopCode(sb: ServiceClient, locationId: string): Promise<string | null> {
  const { data, error } = await sb.from("locations").select("id, code").eq("id", locationId).maybeSingle<{ id: string; code: string | null }>();
  if (error) throw new Error(`refund shop: ${error.message}`);
  return data?.code ?? null;
}

/**
 * Which configured account owns this PaymentIntent: the first that can see it. An account that cannot be asked (a
 * revoked key, an outage) does not stop the search (review r3: the shared account may own an older payment while the
 * shop's own key is failing) — the same pattern as session-owner.ts `retireSessionInOwningAccount`. null = every
 * account answered and none knows it; THROWS (the first error) only when no account owns it and one could not be asked.
 */
async function owningAccount(accounts: StripeCredentials[], paymentIntentId: string): Promise<{ account: StripeCredentials; capturedCents: number | null; refundedCents: number | null } | null> {
  let couldNotAsk: unknown = null;
  for (const account of accounts) {
    try {
      const read = await retrievePaymentIntentCharge(account.secretKey, paymentIntentId);
      if (read.status === "found") return { account, capturedCents: read.amountCapturedCents, refundedCents: read.amountRefundedCents };
    } catch (e) {
      couldNotAsk ??= e;
    }
  }
  if (couldNotAsk) throw couldNotAsk;
  return null;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Record "still unknown" (the row stays pending, the claim is released). The claim lost = nothing written. */
async function keepPending(sb: ServiceClient, actor: AuthContext, row: ClaimedRow, code: string, message: string, extra: Record<string, unknown> = {}): Promise<RefundAttemptResult> {
  const recorded = await settleRow(sb, row, { last_error_code: code.slice(0, 80), last_error_message: message.slice(0, 500) });
  stripeOutcomeAudit(actor, row, { outcome: "pending", error_code: code, attempt: row.attempts, recorded, ...extra });
  return result(row, "pending", recorded ? code : "claim_lost");
}

/**
 * Send ONE request row to Stripe (or find what an earlier send did). Never throws for a Stripe problem: the row records
 * it. Throws only for our own database failures (and then the row is still `pending` and its claim expires by itself).
 */
export async function submitRefundRow(sb: ServiceClient, actor: AuthContext, requestId: string, nowMs: number = Date.now()): Promise<RefundAttemptResult> {
  const row = await loadRequest(sb, requestId);
  if (!row) throw new CateringRefundError(404, "not_found");
  if (row.status !== "pending") return result(row, row.status, null);
  if (requestRetryState({ status: row.status, firstAttemptAt: row.first_attempt_at, requestedAt: row.requested_at }, nowMs).needsReconcile) {
    return result(row, "pending", "needs_reconcile");
  }

  // THE CLAIM: one sender per row at a time. A press that does not get it sends nothing.
  const claimed = await claimRow(sb, row);
  if (!claimed) return result(row, "pending", "in_progress");
  if (claimed.status !== "pending") {
    // Moved on between the read and the claim (another press recorded Stripe's answer): release, report as it is.
    await settleRow(sb, claimed, {});
    return result(claimed, claimed.status, null);
  }

  // Nothing can have been sent for this row before this press: a problem on OUR side can close it (the amount is
  // released). After a possible send, only Stripe's own answer may close it.
  const ourSideStop = async (code: string, message: string) => {
    if (!claimed.sentBefore) {
      const recorded = await settleRow(sb, claimed, { status: "failed", last_error_code: code, last_error_message: message });
      stripeOutcomeAudit(actor, claimed, { outcome: "failed", error_code: code, attempt: claimed.attempts, recorded });
      return result(claimed, recorded ? "failed" : "pending", recorded ? code : "claim_lost");
    }
    return keepPending(sb, actor, claimed, code, message);
  };

  const { data: pay, error: pErr } = await sb
    .from("catering_payments")
    .select("id, provider, provider_ref")
    .eq("id", row.payment_id)
    .maybeSingle<{ id: string; provider: string | null; provider_ref: string | null }>();
  if (pErr) throw new Error(`refund payment: ${pErr.message}`);
  const paymentIntentId = pay?.provider === "stripe" ? pay.provider_ref : null;
  if (!paymentIntentId) return ourSideStop("payment_not_stripe", "This payment was not taken through Stripe");

  const accounts = stripeAccountsForShop(await shopCode(sb, row.location_id));
  if (accounts.length === 0) return ourSideStop("stripe_not_configured", "No Stripe account is configured for this shop");

  let owner: Awaited<ReturnType<typeof owningAccount>>;
  try {
    owner = await owningAccount(accounts, paymentIntentId);
  } catch (e) {
    return keepPending(sb, actor, claimed, "stripe_unreachable", errText(e));
  }
  if (!owner) return ourSideStop("payment_not_in_stripe", "No configured Stripe account knows this payment");

  // EVERY attempt first asks Stripe whether a refund for THIS row already exists (a lost answer, or another press
  // that outlived its claim): adopt it, never send a second one.
  let found: StripeRefund | undefined;
  let outside: number;
  try {
    const listed = await listRefundsForPaymentIntent(owner.account.secretKey, paymentIntentId);
    found = listed.find((r) => r.requestId === row.id);
    outside = outsideRefundedCents(listed);
  } catch (e) {
    return keepPending(sb, actor, claimed, "stripe_unreachable", errText(e));
  }
  if (found) return adopt(sb, actor, claimed, found, claimed.sentBefore ? "found_on_retry" : "found", outside);

  if (!claimed.sentBefore && owner.capturedCents != null && owner.refundedCents != null && Number(row.amount_cents) > owner.capturedCents - owner.refundedCents) {
    // The live cap, before the first send: Stripe says less is left on the charge than this row asks for (a refund
    // made in the Stripe dashboard that the webhook has not reported yet). Nothing is sent; the amount is released.
    return ourSideStop("over_charge_remaining", `Stripe has ${owner.capturedCents - owner.refundedCents} cents left on this charge`);
  }

  const reasonCode = isRefundReasonCode(row.reason_code) ? row.reason_code : "other";
  try {
    const refund = await createRefund(
      owner.account.secretKey,
      {
        paymentIntentId,
        amountCents: Number(row.amount_cents),
        reason: stripeRefundReason(reasonCode),
        metadata: { refund_request_id: row.id, quote_id: row.quote_id, payment_id: row.payment_id },
      },
      refundIdempotencyKey(row.id),
    );
    return adopt(sb, actor, claimed, refund, "created", outside);
  } catch (e) {
    const status = e instanceof StripeError ? e.status : 0;
    const code = e instanceof StripeError ? e.code : "network_error";
    if (stripeCreateFailure(status) === "refused") {
      const recorded = await settleRow(sb, claimed, { status: "failed", last_error_code: code.slice(0, 80), last_error_message: errText(e) });
      stripeOutcomeAudit(actor, claimed, { outcome: "failed", error_code: code, http_status: status, attempt: claimed.attempts, recorded });
      return result(claimed, recorded ? "failed" : "pending", recorded ? code : "claim_lost");
    }
    return keepPending(sb, actor, claimed, code, errText(e), { http_status: status });
  }
}

/**
 * `outsideCents`: the refunds on this charge CO-OPS did NOT make, from the list of the PaymentIntent's refunds taken in
 * this attempt (`outsideRefundedCents`, review r4/r5). Identity, not arithmetic on a snapshot: two of our refunds that
 * both read the same Stripe total can never count the dashboard refund twice or hide each other. null = no list this
 * attempt. Recorded once, with the acceptance; a later failed refund (status `failed`) stops counting it.
 */
async function adopt(
  sb: ServiceClient,
  actor: AuthContext,
  row: ClaimedRow,
  refund: StripeRefund,
  how: "created" | "found" | "found_on_retry" | "found_on_reconcile" | "refreshed",
  outsideCents: number | null = null,
): Promise<RefundAttemptResult> {
  // Stripe gave it an id: it exists. An unknown status still means "accepted" (submitted), never "failed".
  const status: RefundStatus = refundStatusFromStripe(refund.status) ?? "submitted";
  const seen = row.outside_refunded_seen_cents == null && outsideCents != null && status !== "failed" ? { outside_refunded_seen_cents: outsideCents } : {};
  const recorded = status === row.status
    ? await settleRow(sb, row, { stripe_status: refund.status, last_error_code: null, last_error_message: null, ...seen })
    : await settleRow(sb, row, { status, stripe_refund_id: row.stripe_refund_id ?? refund.id, stripe_status: refund.status, last_error_code: null, last_error_message: null, ...seen });
  stripeOutcomeAudit(actor, row, { outcome: status, how, stripe_refund_id: refund.id, stripe_status: refund.status, attempt: row.attempts, recorded });
  return result(row, recorded ? status : row.status, recorded ? null : "claim_lost");
}

/**
 * RECONCILE a pending row past Stripe's 24-hour retry window (review r2). Stripe: "If the outcome is still unknown after
 * that window, don't retry with either the old key or a new one. Retrieve the relevant object ... to reconcile the
 * outcome" (docs.stripe.com/error-low-level). So this NEVER sends: under the row's claim it lists the PaymentIntent's
 * refunds and adopts one carrying this row's id (a lost answer that landed — its money is already in the webhook's
 * events, and the row must stop holding a second reservation). When Stripe shows none, the row stays pending and says
 * so — unless the person asked to RELEASE it, which closes it `failed` (`released_no_refund`) after that same fresh
 * look, giving its amount back to "refundable". A release before the window is refused (`not_releasable`).
 */
async function reconcileRefundRow(sb: ServiceClient, actor: AuthContext, row: RequestRow, release: boolean): Promise<RefundAttemptResult> {
  const claimed = await claimRow(sb, row);
  if (!claimed) return result(row, row.status, "in_progress");
  if (claimed.status !== "pending") {
    await settleRow(sb, claimed, {});
    return result(claimed, claimed.status, null);
  }
  const { data: pay, error: pErr } = await sb
    .from("catering_payments")
    .select("id, provider, provider_ref")
    .eq("id", row.payment_id)
    .maybeSingle<{ id: string; provider: string | null; provider_ref: string | null }>();
  if (pErr) throw new Error(`refund payment: ${pErr.message}`);
  const paymentIntentId = pay?.provider === "stripe" ? pay.provider_ref : null;
  const accounts = stripeAccountsForShop(await shopCode(sb, row.location_id));
  if (!paymentIntentId || accounts.length === 0) return keepPending(sb, actor, claimed, "needs_reconcile", "Stripe cannot be asked about this payment", { reconcile: true });
  let found: StripeRefund | undefined;
  let seenOnReconcile: number | null = null;
  try {
    const owner = await owningAccount(accounts, paymentIntentId);
    if (!owner) return keepPending(sb, actor, claimed, "needs_reconcile", "No configured Stripe account knows this payment", { reconcile: true });
    const listed = await listRefundsForPaymentIntent(owner.account.secretKey, paymentIntentId);
    found = listed.find((r) => r.requestId === row.id);
    seenOnReconcile = outsideRefundedCents(listed);
  } catch (e) {
    return keepPending(sb, actor, claimed, "stripe_unreachable", errText(e), { reconcile: true });
  }
  if (found) return adopt(sb, actor, claimed, found, "found_on_reconcile", seenOnReconcile);
  if (!release) return keepPending(sb, actor, claimed, "needs_reconcile", "Stripe shows no refund for this request", { reconcile: true });
  const recorded = await settleRow(sb, claimed, { status: "failed", last_error_code: "released_no_refund", last_error_message: "Released by a person after Stripe showed no refund for it" });
  stripeOutcomeAudit(actor, claimed, { outcome: "released", error_code: "released_no_refund", attempt: claimed.attempts, recorded });
  return result(claimed, recorded ? "failed" : "pending", recorded ? "released_no_refund" : "claim_lost");
}

// ── Retry / refresh ───────────────────────────────────────────────────────────────────────────────────
export async function retryRefundRequest(
  actor: AuthContext,
  quoteId: string,
  requestId: string,
  nowMs: number = Date.now(),
  /** `retry` = send / refresh / (past 24 h) reconcile; `release` = close a past-24 h row Stripe shows no refund for. */
  mode: "retry" | "release" = "retry",
): Promise<RefundAttemptResult> {
  const sb = getServiceRoleClient();
  const quote = await loadQuote(sb, quoteId);
  if (!quote || !canSee(actor, quote.location_id)) throw new CateringRefundError(404, "not_found");
  if (!actorMayRefund(actor, quote.location_id)) throw new CateringRefundError(403, "forbidden");
  const row = await loadRequest(sb, requestId);
  const familyIds = new Set((await loadFamilyPayments(sb, quote)).map((p) => p.id));
  if (!row || !familyIds.has(row.payment_id)) throw new CateringRefundError(404, "not_found");
  // The SQL actor rule is the authority for writes it makes; a retry writes only outcomes, so re-check it here too.
  const { data: okData, error: okErr } = await sb.rpc("catering_refund_actor_ok", { p_actor_id: actor.user.id, p_shop_id: row.location_id });
  if (okErr) {
    if (missingRelation(okErr)) throw new CateringRefundError(503, "refunds_unavailable");
    throw new Error(`catering_refund_actor_ok: ${okErr.message}`);
  }
  if (okData !== true) throw new CateringRefundError(403, "forbidden");

  if (row.status === "pending") {
    const state = requestRetryState({ status: row.status, firstAttemptAt: row.first_attempt_at, requestedAt: row.requested_at }, nowMs);
    // Past Stripe's 24-hour window nothing is SENT again; the press reconciles (review r2).
    if (mode === "release" && !state.needsReconcile) throw new CateringRefundError(409, "not_releasable");
    if (state.needsReconcile) return reconcileRefundRow(sb, actor, row, mode === "release");
    return submitRefundRow(sb, actor, row.id, nowMs);
  }
  if (mode === "release") throw new CateringRefundError(409, "not_releasable");
  if (row.status === "submitted" && row.stripe_refund_id) {
    const accounts = stripeAccountsForShop(await shopCode(sb, row.location_id));
    const { data: pay } = await sb.from("catering_payments").select("provider_ref").eq("id", row.payment_id).maybeSingle<{ provider_ref: string | null }>();
    if (accounts.length === 0 || !pay?.provider_ref) throw new CateringRefundError(503, "stripe_not_configured");
    const claimed = await claimRow(sb, row);
    if (!claimed) return result(row, row.status, "in_progress");
    try {
      const owner = await owningAccount(accounts, pay.provider_ref);
      if (!owner) {
        await settleRow(sb, claimed, {});
        throw new CateringRefundError(503, "stripe_not_configured");
      }
      const refund = await retrieveRefund(owner.account.secretKey, row.stripe_refund_id);
      return adopt(sb, actor, claimed, refund, "refreshed");
    } catch (e) {
      if (e instanceof CateringRefundError) throw e;
      await settleRow(sb, claimed, {});
      return result(row, row.status, "stripe_unreachable");
    }
  }
  throw new CateringRefundError(409, "not_retryable");
}


/** Lead → the live quotes of its order(s) with money still refundable (the pipeline's "Refund" banner). */
export async function loadLeadRefundables(actor: AuthContext, leadId: string): Promise<Array<{ quoteId: string; refundableCents: number; paidCents: number }>> {
  if (getRoleLevel(actor.user.role) < REFUND_READ_MIN) throw new CateringRefundError(403, "forbidden");
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_quotes")
    .select("id, location_id, root_id")
    .eq("pipeline_id", leadId)
    .is("superseded_at", null)
    .returns<QuoteRow[]>();
  if (error) throw new Error(`refunds lead quotes: ${error.message}`);
  const out: Array<{ quoteId: string; refundableCents: number; paidCents: number }> = [];
  for (const q of data ?? []) {
    if (!canSee(actor, q.location_id)) continue;
    const s = await loadRefundSummary(actor, q.id);
    if (s.totals.paidCents > 0) out.push({ quoteId: q.id, refundableCents: s.totals.refundableCents, paidCents: s.totals.paidCents });
  }
  return out;
}
