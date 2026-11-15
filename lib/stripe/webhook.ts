/**
 * Stripe inbound-webhook PROCESSOR (the codebase's second signed inbound feed, after
 * ezCater's). SERVER-ONLY, service-role, NO actor — every row this writes is a system
 * observation of money that moved, so `actor_id` is null and the three audit actions live
 * on the NON_DESTRUCTIVE list beside `product.resolution_flip`.
 *
 * ── THE BODY IS UNTRUSTED ────────────────────────────────────────────────────────────
 * A valid signature proves the sender holds the endpoint secret. It proves NOTHING about
 * the shape or the honesty of the payload. So:
 *   - `metadata.payment_id` / `metadata.quote_id` are HINTS. Both are UUID-validated in
 *     lib/stripe/shared.ts before they are allowed near a query (an unguarded value
 *     reaches PostgREST as a uuid cast and raises 22P02 instead of taking the not-found
 *     branch), and the row they name is re-read and re-checked against this shop.
 *   - No amount from the payload is ever written to a money column. The payment row's own
 *     `amount_cents` is the authority; the event's amount rides in the audit metadata as
 *     evidence, so a mismatch is FINDABLE rather than silently adopted.
 *   - Nothing from the payload is rendered as markup or used as an href.
 *
 * ── LEDGER-FIRST, AND THE PRIMARY KEY IS THE IDEMPOTENCY GUARD ───────────────────────
 * Every delivery is appended to `stripe_events` (PK = Stripe's own event id) BEFORE a
 * single payment row is touched. A 23505 means "we have already seen this exact event".
 * Stripe retries until it gets a 2xx and explicitly warns a delivery may repeat even after
 * one, so this is the difference between a refund recorded once and a refund recorded
 * five times.
 *
 * ── "SEEN" IS NOT "FINISHED" (audit W02/B005) ────────────────────────────────────────
 * The ledger row is written BEFORE the work, so a row can exist for an event whose work
 * never completed: the function died after the append (outcome still NULL), or the payment
 * write hit a transient fault (outcome `processing_failed`). Treating those as `duplicate`
 * meant a card payment that was TAKEN stayed `due` forever — every redelivery and every
 * dashboard replay answered "already seen". So on a 23505 the processor reads the row's
 * own outcome: a TERMINAL verdict stops (no payment reads, no writes, result
 * `duplicate`); NULL or `processing_failed` runs the dispatch again. That is safe to
 * repeat because every money write below is a guarded compare-and-set (`due → paid`,
 * `paid → refunded`): a second run of work that did land matches zero rows and reports
 * itself, and the audit row and the staff email ride only on the run that actually moved
 * the row. The final stamp is guarded the same way, so a retry can never overwrite a
 * terminal verdict a concurrent delivery already wrote.
 *
 * A FAILED LEDGER APPEND (or a failed read of a seen event's verdict) throws, and a
 * PROCESSING FAILURE returns `processing_failed`; the route answers 500 to all three,
 * because those are exactly the cases a Stripe retry can fix. Everything else returns a
 * named result the route answers 200 with: to a webhook provider a non-2xx means "retry",
 * and there is nothing to retry about an event we understood and deliberately ignored.
 *
 * ── A PAYMENT IS JUDGED AGAINST ITS ORDER, NOT ONLY ITS ROW (audit W02/B035) ─────────
 * "Is this row still due?" is necessary and it is not sufficient. A quote can have two
 * intents (deposit, full), a customer can complete both checkouts, and the second flip used
 * to be as quiet as the first — a double charge recorded as two ordinary payments. So:
 *   - THE MONEY IS ALWAYS RECORDED. A charge that really happened flips its row to `paid`
 *     (from `due`, or from `void` if we had closed the intent), because the row must say
 *     what is true and the refund leg finds it by the PaymentIntent that flip writes.
 *   - …AND A PAYMENT THAT LOOKS WRONG SAYS SO. Another payment on the quote already paid
 *     (other than the designed deposit → balance pair), a charged amount that is not the
 *     intent's amount, an intent we had voided, a quote that is no longer open, or a row
 *     that was already settled another way: each is a named reason, the ledger outcome is
 *     `paid_needs_review`, the audit row carries the reasons, and the staff email asks for
 *     a look. Nothing is refunded automatically — moving money back is a human decision.
 *   - …INCLUDING A PAYMENT THAT SETTLED AFTER THE OFFER EXPIRED (review r2). The pay gate
 *     reads the clock when a checkout is OPENED; a checkout opened in time can be completed
 *     late. The settlement time is the event's own `created` (never later than now) — not
 *     the moment a retried delivery was processed — it is what `paid_at` records, and it is
 *     weighed against the offer with the one shared rule (`quoteTimeExpired`): reason
 *     `paid_after_expiry`. The staff accept reads the same two facts (`offerTakenUpInTime`).
 *   - THE OTHER INTENT IS CLOSED. When a deposit or a full payment lands, the quote's other
 *     due deposit/full intent is voided: both are priced for an UNPAID quote, so neither is
 *     collectable any more.
 *   - …AND SO IS ITS CHECKOUT (review r3). Voiding an intent is our bookkeeping; its hosted
 *     Checkout Session stays payable at Stripe until it is retired. A full-amount checkout
 *     attached a moment before the deposit landed was left open by the void — the customer
 *     could pay the deposit and the whole total. So after the flip every other deposit /
 *     full checkout of the quote is retired (`closeQuoteCheckouts`, lib/catering/
 *     payment-sessions.ts) and its id cleared on Stripe's confirmation. One that cannot be
 *     confirmed closed keeps its id on its row — the pay path goes on treating it as an
 *     unresolved checkout — and the payment is flagged `sibling_checkout_open`.
 *   - …AND ALL OF THAT IS DONE WHERE THE PAYMENT IS NOW, NOT WHERE IT WAS READ (review r4).
 *     A manager's revise can land between this processor's read of the payment and its
 *     flip: the carry moves the payment (and the rest of the family) onto a new quote row,
 *     and a checkout can be attached there. Reviewing and cleaning up against the revision
 *     that was READ found nothing — a full-amount checkout stayed open beside a paid
 *     deposit, unflagged. So the flip RETURNS the row it wrote (its revision now, the
 *     session it names); the order is judged on that revision (re-read; a failed re-read is
 *     `quote_recheck_failed`); the siblings are looked for across the whole FAMILY; and the
 *     cleanup closes the paid row's own stored session too when it is not the session that
 *     was just paid. A cleanup that could not finish looking reports itself the same way
 *     as one that could not close (`sibling_checkout_open`) — never as "nothing open".
 *     The flip itself stays unguarded on the revision: money Stripe took is recorded.
 * EVERYTHING AFTER THE FLIP IS NON-THROWING. An event whose processing fails is retried
 * (B005), and a retry of a flip that did land reports `already_advanced` with no audit row
 * and no email. A failure in the review step therefore degrades to a reason
 * (`sibling_check_failed`), never to an exception.
 *
 * ── TWO DEPLOYMENT SHAPES, ONE PROCESSOR ─────────────────────────────────────────────
 * DEFAULT — one Stripe account for the whole business, endpoint `/api/webhooks/stripe`.
 *   The URL carries no shop, so `locationId` arrives null and the shop is LEARNED from the
 *   payment's quote; the ledger row's `location_id` is filled in by the final stamp.
 * PER-LOCATION — one connected account per shop, endpoint `/api/webhooks/stripe/<code>`.
 *   The shop is known before the signature is even checked (that shop's secret is what
 *   verifies it), so `locationId` arrives set and a payment belonging to a DIFFERENT shop
 *   is refused as `location_mismatch` with no write. That refusal is the whole point of
 *   the per-location shape: an event signed by shop A's account must never advance shop
 *   B's money, however well-formed its metadata is.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { sendEmail, teamFrom } from "@/lib/email";
import { renderEmailLayout, appUrl, escapeHtml } from "@/lib/email-templates/_layout";
import { resolveCateringManager } from "@/lib/catering/system-intake";
import { TENANT_NAME } from "@/lib/tenant";
import { parseCheckoutEvent, stripeEnvSuffix, type CheckoutEventOutcome } from "@/lib/stripe/shared";
import { quoteTimeExpired } from "@/lib/portal/payability-shared";
import { closeQuoteCheckouts, type ClosedCheckouts } from "@/lib/catering/payment-sessions";
import { familyRevisionIds, type RetireSession } from "@/lib/catering/payment-carry";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/**
 * THE CLOSED OUTCOME VOCABULARY. Every delivery resolves to exactly one of these and the
 * value is stamped on its ledger row, so "what did we do about event evt_…" is a single
 * indexed read and never a reconstruction. `stripe_events.outcome` deliberately carries no
 * DB CHECK — the vocabulary is closed on the WRITE side here, the same posture `audit_log`
 * takes with `AuditAction`.
 */
export type StripeProcessingResult =
  | "paid"                // a due row became paid (the happy path)
  | "paid_needs_review"   // money was taken and recorded, but something about it needs a human
  | "already_advanced"    // the guarded update matched 0 rows — this same charge got there first
  | "payment_not_found"   // metadata + session-id lookup both came up empty
  | "location_mismatch"   // per-location mode: the payment belongs to another shop
  | "async_failed"        // delayed-notification payment failed; the row stays 'due'
  | "expired"             // the Checkout Session expired unpaid; the row keeps its status, its session id is cleared
  | "refunded"            // a paid row became refunded (the WHOLE charge was refunded)
  | "partially_refunded"  // part of the charge was refunded; the row stays 'paid', the amount is audited
  | "no_paid_row"         // charge.refunded arrived for a payment that was not 'paid'
  | "ignored"             // an event type (or a completed-but-unpaid session) we do not act on
  | "duplicate"           // this exact event id is already on the ledger WITH a terminal verdict
  | "processing_failed"   // recorded, then something below it threw — RETRYABLE (route answers 500)
  | "invalid_payload";    // no usable event id/type — nothing to key a ledger row on

export interface StripeWebhookContext {
  /** Per-location mode: the shop this endpoint belongs to. Null in single-account mode. */
  locationId: string | null;
  /** Free-text label for the audit metadata (`locations.code`, or null). Never a literal. */
  locationCode: string | null;
}

export type WebhookLocation =
  | { ok: true; locationId: string | null; locationCode: string | null }
  | { ok: false; reason: "unknown_location" | "lookup_failed" };

/**
 * Turn the URL's optional `[locationCode]` segment into a shop, or refuse.
 *
 *   null segment  → single-account mode. No shop is claimed, and none is asserted later.
 *   a segment     → it MUST name an active `locations` row. There are no shop codes in
 *                   this codebase (tenant-vocabulary law), so the table is the only
 *                   authority, and an unknown or inactive code is a REFUSAL.
 *
 * The shape check runs first: a code that could not name an env var could not name a
 * credential pair either, so it is refused without spending a query — and the value is
 * never echoed back to the caller, because a caller-supplied segment is attacker-shaped.
 *
 * Split out of the route so the vitest spine can pin it with a stub client; the route
 * keeps its own thinness and this keeps its own test.
 */
export async function resolveWebhookLocation(
  sb: ServiceClient,
  locationCode: string | null,
): Promise<WebhookLocation> {
  if (locationCode === null) return { ok: true, locationId: null, locationCode: null };
  const suffix = stripeEnvSuffix(locationCode);
  if (!suffix) return { ok: false, reason: "unknown_location" };

  const { data, error } = await sb
    .from("locations")
    .select("id, code")
    .eq("code", suffix)
    .eq("active", true)
    .maybeSingle<{ id: string; code: string }>();
  // A DB error is NOT "no such shop": answering 404 would tell Stripe the endpoint is
  // permanently wrong, and it would stop retrying an event we could have processed.
  if (error) return { ok: false, reason: "lookup_failed" };
  if (!data) return { ok: false, reason: "unknown_location" };
  return { ok: true, locationId: data.id, locationCode: data.code };
}

/** Injection seam so the vitest spine can exercise the dispatcher end-to-end with a stub
 *  service client and no mail. Production passes nothing and gets the real notifier. */
export interface StripeWebhookDeps {
  notifyPaid?: (args: NotifyPaidArgs) => Promise<void>;
  /** Retire a Checkout Session of the paid quote's shop. Omitted in production: the shop's
   *  own credentials are resolved (`retireSessionFor`). Null = this shop cannot reach Stripe. */
  retireSession?: RetireSession;
}

/**
 * Why a payment that WAS taken needs a human to look at it. Closed vocabulary (the write
 * side is here; nothing parses it back), carried in the audit metadata and the staff email.
 */
export type PaymentReviewReason =
  | "another_payment_already_paid" // a second payment on the quote that is not deposit → balance
  | "amount_mismatch"              // Stripe charged an amount the intent does not carry
  | "amount_not_current"           // the amount charged is not what the quote asks for NOW (an older price)
  | "intent_was_void"              // the intent had been closed before the customer paid it
  | "quote_not_payable"            // the quote is superseded, declined or expired
  | "paid_after_expiry"            // the payment settled after the open offer's expires_at
  | "already_settled"              // the row was already paid/refunded another way; NOT moved
  | "sibling_check_failed"         // we could not read the quote's other payments
  | "quote_recheck_failed"         // a revise moved the payment mid-settlement and its new revision could not be read
  | "sibling_checkout_open";       // another checkout of the quote could not be confirmed closed

export interface NotifyPaidArgs {
  paymentId: string;
  quoteId: string;
  locationId: string | null;
  kind: string;
  amountCents: number;
  /** Empty for an ordinary payment. Non-empty ⇒ the email asks for a review. */
  reviewReasons?: PaymentReviewReason[];
}

interface PaymentRow {
  id: string;
  quote_id: string;
  kind: string;
  amount_cents: number;
  status: string;
  provider_ref: string | null;
}

const PAYMENT_COLS = "id, quote_id, kind, amount_cents, status, provider_ref";

/**
 * Append the delivery to the ledger. Returns "duplicate" when Stripe has sent this event
 * before, "inserted" otherwise. THROWS on any other error — that is the one failure the
 * route answers 500 to, because it is the one failure a Stripe retry can actually fix.
 */
async function appendEvent(
  sb: ServiceClient,
  args: { id: string; type: string; livemode: boolean; payload: unknown; locationId: string | null },
): Promise<"inserted" | "duplicate"> {
  const { error } = await sb.from("stripe_events").insert({
    id: args.id,
    type: args.type,
    livemode: args.livemode,
    payload: args.payload ?? {},
    location_id: args.locationId,
  });
  if (!error) return "inserted";
  if (error.code === "23505") return "duplicate";
  throw new Error(`stripe_events append: ${error.message}`);
}

/**
 * The verdict already on the ledger for an event id we have seen before. NULL means the
 * delivery was recorded and never finished. THROWS on a read failure: we cannot tell
 * "finished" from "died mid-flight" without it, and answering 200 to an event whose work
 * may not have landed is the bug this read exists to close — a 500 makes Stripe ask again.
 */
async function readLedgerOutcome(sb: ServiceClient, id: string): Promise<string | null> {
  const { data, error } = await sb
    .from("stripe_events")
    .select("id, outcome")
    .eq("id", id)
    .maybeSingle<{ id: string; outcome: string | null }>();
  if (error) throw new Error(`stripe_events read: ${error.message}`);
  return data?.outcome ?? null;
}

/** A ledger row whose work is NOT known to have landed: never stamped, or stamped failed. */
export function isRetryableLedgerOutcome(outcome: string | null): boolean {
  return outcome === null || outcome === "processing_failed";
}

/** Stamp the verdict. Best-effort by design: the work is already committed, and throwing
 *  here would turn a completed payment into a 500 and an infinite Stripe retry.
 *
 *  GUARDED on the row still being unfinished (`outcome` NULL or `processing_failed`): two
 *  deliveries of one event can run the dispatch concurrently, and the loser of the guarded
 *  money write must not replace the winner's `paid` with its own `already_advanced`. The
 *  first terminal verdict wins. */
async function finalizeEvent(
  sb: ServiceClient,
  id: string,
  result: StripeProcessingResult,
  locationId: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = {
    outcome: result,
    processed_at: new Date().toISOString(),
  };
  // Single-account mode learns the shop during processing; never overwrite a known one
  // with null (`location_id` is only set here when we actually resolved it).
  if (locationId) patch.location_id = locationId;
  const { error } = await sb
    .from("stripe_events")
    .update(patch)
    .eq("id", id)
    .or("outcome.is.null,outcome.eq.processing_failed");
  if (error) console.error(`[stripe webhook] outcome stamp failed for ${id}:`, error.message);
}

/**
 * Locate the payment this event is about. `metadata.payment_id` first (already
 * UUID-validated), then the Checkout Session id we recorded on the due row when we sent
 * the customer to pay — the fallback exists because metadata can be stripped by a
 * dashboard-initiated action, while `provider_session_id` is ours.
 */
async function findPaymentForSession(
  sb: ServiceClient,
  outcome: CheckoutEventOutcome,
): Promise<PaymentRow | null> {
  if (outcome.paymentId) {
    const { data, error } = await sb
      .from("catering_payments")
      .select(PAYMENT_COLS)
      .eq("id", outcome.paymentId)
      .maybeSingle<PaymentRow>();
    if (error) throw new Error(`findPayment by id: ${error.message}`);
    if (data) return data;
  }
  if (outcome.sessionId) {
    const { data, error } = await sb
      .from("catering_payments")
      .select(PAYMENT_COLS)
      .eq("provider_session_id", outcome.sessionId)
      .limit(1)
      .maybeSingle<PaymentRow>();
    if (error) throw new Error(`findPayment by session: ${error.message}`);
    if (data) return data;
  }
  return null;
}

interface QuoteContext {
  location_id: string;
  status: string | null;
  superseded_at: string | null;
  /** The open offer's deadline. Null when the quote has none. */
  expires_at: string | null;
  /** The quote's own snapshot — what a deposit / a full payment is priced at NOW. */
  deposit_cents: number | null;
  total_cents: number | null;
}

const wholeCents = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** The quote a payment belongs to: its shop, and whether it is still an open order. Null
 *  when the quote row does not exist. THROWS on a read error (this runs BEFORE any write). */
async function quoteOfPayment(sb: ServiceClient, quoteId: string): Promise<QuoteContext | null> {
  const { data, error } = await sb
    .from("catering_quotes")
    .select("id, location_id, status, superseded_at, expires_at, deposit_cents, total_cents")
    .eq("id", quoteId)
    .maybeSingle<{
      id: string;
      location_id: string;
      status: string | null;
      superseded_at: string | null;
      expires_at: string | null;
      deposit_cents: number | null;
      total_cents: number | null;
    }>();
  if (error) throw new Error(`quoteOfPayment: ${error.message}`);
  if (!data) return null;
  return {
    location_id: data.location_id,
    status: data.status ?? null,
    superseded_at: data.superseded_at ?? null,
    expires_at: typeof data.expires_at === "string" ? data.expires_at : null,
    deposit_cents: wholeCents(data.deposit_cents),
    total_cents: wholeCents(data.total_cents),
  };
}

/** The shop that owns a payment, via its quote. Null when the quote cannot be found. */
async function locationOfQuote(sb: ServiceClient, quoteId: string): Promise<string | null> {
  return (await quoteOfPayment(sb, quoteId))?.location_id ?? null;
}

/** deposit → balance (either order of arrival) is the designed two-payment sequence.
 *  Every other pair of paid rows on one quote is money taken twice. */
function isDesignedPair(a: string, b: string): boolean {
  return (a === "deposit" && b === "balance") || (a === "balance" && b === "deposit");
}

/**
 * AFTER a payment has been recorded: look at the rest of the quote. Returns the reasons the
 * siblings give for a review and the ids of the due intents this payment closed.
 *
 * NEVER THROWS (see the header). A read failure is the reason `sibling_check_failed`; a
 * failed void is logged and simply not reported as voided.
 */
async function reviewSiblings(
  sb: ServiceClient,
  payment: PaymentRow,
): Promise<{ reasons: PaymentReviewReason[]; voided: string[] }> {
  const reasons: PaymentReviewReason[] = [];
  const voided: string[] = [];
  try {
    // THE ORDER'S OTHER PAYMENTS, WHEREVER A REVISE HAS PUT THEM (review r4). A settlement
    // runs beside the carry: this payment's siblings may be on the revision it is on now, or
    // still on the one it left. They are asked for across the family, in one statement.
    const family = await familyRevisionIds(sb, payment.quote_id, "reviewSiblings");
    const { data, error } = await sb
      .from("catering_payments")
      .select("id, kind, status")
      .in("quote_id", family)
      .neq("id", payment.id)
      .returns<Array<{ id: string; kind: string; status: string }>>();
    if (error) throw new Error(error.message);
    const siblings = data ?? [];

    if (siblings.some((s) => s.status === "paid" && !isDesignedPair(payment.kind, s.kind))) {
      reasons.push("another_payment_already_paid");
    }

    // Both `deposit` and `full` are priced for an UNPAID quote. Once either has landed, the
    // other is not collectable: close it, so the board stops offering "Mark paid" on it and
    // the digests stop counting it as money due. A `balance` intent is the NEXT step of the
    // designed sequence and is never touched here.
    if (payment.kind === "deposit" || payment.kind === "full") {
      for (const s of siblings) {
        if (s.status !== "due" || (s.kind !== "deposit" && s.kind !== "full")) continue;
        const { error: vErr, count } = await sb
          .from("catering_payments")
          .update({ status: "void" }, { count: "exact" })
          .eq("id", s.id)
          .eq("status", "due");
        if (vErr) {
          console.error(`[stripe webhook] could not void sibling intent ${s.id}:`, vErr.message);
          continue;
        }
        if ((count ?? 0) > 0) voided.push(s.id);
      }
    }
  } catch (e) {
    console.error(`[stripe webhook] sibling review failed for ${payment.id}:`, e instanceof Error ? e.message : e);
    reasons.push("sibling_check_failed");
  }
  return { reasons, voided };
}

/**
 * Process ONE verified delivery.
 *
 * `event` is the parsed body — the RAW body was already consumed by the signature check at
 * the route's front door, which is the only place it can be checked (the HMAC is over
 * bytes, and a JSON round-trip changes them).
 */
export async function processStripeEvent(
  sb: ServiceClient,
  event: unknown,
  ctx: StripeWebhookContext,
  deps: StripeWebhookDeps = {},
): Promise<{ result: StripeProcessingResult; locationId: string | null }> {
  const outcome = parseCheckoutEvent(event);

  // No id ⇒ no idempotency key ⇒ we cannot honour ledger-first. A genuine Stripe event
  // always carries one, so this is a malformed delivery from a holder of the secret, and
  // the honest answer is to refuse it rather than store it under a surrogate identity that
  // a retry would not match.
  if (!outcome.eventId || !outcome.type) return { result: "invalid_payload", locationId: null };

  const appended = await appendEvent(sb, {
    id: outcome.eventId,
    type: outcome.type,
    livemode: outcome.livemode,
    payload: event,
    locationId: ctx.locationId,
  });
  if (appended === "duplicate") {
    // Seen before — but was it FINISHED? (See the header.) A terminal verdict stops here;
    // a row that never got one, or got `processing_failed`, is worked again.
    const prior = await readLedgerOutcome(sb, outcome.eventId);
    if (!isRetryableLedgerOutcome(prior)) return { result: "duplicate", locationId: ctx.locationId };
  }

  let result: StripeProcessingResult = "ignored";
  let resolvedLocation: string | null = ctx.locationId;
  try {
    const dispatched = await dispatch(sb, outcome, ctx, deps);
    result = dispatched.result;
    resolvedLocation = dispatched.locationId ?? ctx.locationId;
  } catch (e) {
    // A processing failure is recorded on the ledger AND reported, so the route answers
    // 500 and Stripe redelivers: `processing_failed` is a retryable ledger state (see the
    // header), so the redelivery runs the dispatch again instead of dying on the duplicate
    // guard. It is deliberately NOT `invalid_payload`: the payload was fine, our side was
    // not, and conflating the two would send someone to read a healthy event looking for a
    // defect in it.
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[stripe webhook] processing failed for ${outcome.eventId}:`, message);
    await finalizeEvent(sb, outcome.eventId, "processing_failed", resolvedLocation);
    return { result: "processing_failed", locationId: resolvedLocation };
  }

  await finalizeEvent(sb, outcome.eventId, result, resolvedLocation);
  return { result, locationId: resolvedLocation };
}

async function dispatch(
  sb: ServiceClient,
  outcome: CheckoutEventOutcome,
  ctx: StripeWebhookContext,
  deps: StripeWebhookDeps,
): Promise<{ result: StripeProcessingResult; locationId: string | null }> {
  if (outcome.kind === "ignored") return { result: "ignored", locationId: null };

  if (outcome.kind === "refunded") return refund(sb, outcome, ctx);

  const payment = await findPaymentForSession(sb, outcome);
  if (!payment) return { result: "payment_not_found", locationId: null };

  let quote = await quoteOfPayment(sb, payment.quote_id);
  const locationId = quote?.location_id ?? null;

  // PER-LOCATION MODE ONLY: an event signed by one shop's account may not touch another
  // shop's money. Single-account mode has no such assertion to make — one account serves
  // every shop by design — so `ctx.locationId` is null and this check does not run.
  if (ctx.locationId && locationId !== ctx.locationId) {
    return { result: "location_mismatch", locationId };
  }

  if (outcome.kind === "async_failed") return { result: "async_failed", locationId };
  if (outcome.kind === "expired") {
    // STRIPE'S OWN WORD THAT A CHECKOUT IS CLOSED (review r3). A session id on a due or void
    // row is an unresolved checkout that blocks new collection on the quote until its
    // retirement is CONFIRMED (lib/catering/payment-sessions.ts). `checkout.session.expired`
    // is that confirmation, from the only party that can give it — so the id is cleared here
    // too, which is what un-blocks a quote whose shop could not reach Stripe to retire it.
    // Guarded on the exact session the event names: a row that has since been given another
    // checkout is left alone. The intent itself is untouched (a due row stays due).
    if (outcome.sessionId) {
      const { error: clearErr } = await sb
        .from("catering_payments")
        .update({ provider_session_id: null })
        .eq("id", payment.id)
        .in("status", ["due", "void"])
        .eq("provider_session_id", outcome.sessionId);
      if (clearErr) throw new Error(`stripe expired clear session: ${clearErr.message}`);
    }
    return { result: "expired", locationId };
  }

  // completed / async_succeeded — the money is real. Guarded flip: only a row that is
  // still `due` — or one we had VOIDED, because a charge on a closed intent is still a
  // charge and must not vanish — may be advanced. A concurrent/replayed advance matches
  // zero rows and REPORTS itself rather than writing a second time.
  const notify = deps.notifyPaid ?? ((args: NotifyPaidArgs) => notifyPaymentPaid(sb, args));
  // WHEN THE MONEY SETTLED (see the header): the event's own `created`, never later than
  // now — a redelivery hours later must not make an in-time payment look late, and a
  // timestamp from the future must not make a late one look early.
  const nowMs = Date.now();
  const settledAtMs = outcome.createdSec != null ? Math.min(outcome.createdSec * 1000, nowMs) : nowMs;
  const settledAt = new Date(settledAtMs).toISOString();
  // THE FLIP RETURNS THE ROW IT WROTE (review r4). The read above can be a revise old: the
  // carry may since have moved this payment onto a new revision and a checkout may have been
  // attached there. The flip is deliberately NOT guarded on the revision (unlike a
  // hand-recorded payment) — money Stripe took is recorded wherever its row now is — so the
  // row's CURRENT revision and session come back from the write itself, and everything after
  // this line works from them.
  const { data: flippedRows, error } = await sb
    .from("catering_payments")
    .update({
      status: "paid",
      paid_at: settledAt,
      provider: "stripe",
      provider_ref: outcome.paymentIntentId ?? null,
    })
    .eq("id", payment.id)
    .in("status", ["due", "void"])
    .select("id, quote_id, provider_session_id")
    .returns<Array<{ id: string; quote_id: string; provider_session_id: string | null }>>();
  if (error) throw new Error(`stripe mark paid: ${error.message}`);
  const flipped = flippedRows?.[0] ?? null;

  if (!flipped) {
    // The row was already paid or refunded. WHO got there first decides what this is, so the
    // row is re-read (the pre-read may predate a concurrent delivery of this very charge).
    const { data: fresh, error: freshErr } = await sb
      .from("catering_payments")
      .select(PAYMENT_COLS)
      .eq("id", payment.id)
      .maybeSingle<PaymentRow>();
    if (freshErr) throw new Error(`stripe mark paid re-read: ${freshErr.message}`);
    const sameCharge =
      outcome.paymentIntentId != null && fresh?.provider_ref != null && fresh.provider_ref === outcome.paymentIntentId;
    if (sameCharge) return { result: "already_advanced", locationId };

    // A DIFFERENT settlement got there first — staff marked it paid by hand, or it was paid
    // and refunded — and now Stripe has taken money for it as well. There is no row to flip,
    // and saying `already_advanced` would bury a charge nobody has recorded. Say it loudly.
    const reasons: PaymentReviewReason[] = ["already_settled"];
    void audit({
      actorId: null,
      actorRole: null,
      action: "catering.payment.provider_paid",
      resourceTable: "catering_payments",
      resourceId: payment.id,
      metadata: {
        actor_context: "stripe_webhook",
        quote_id: payment.quote_id,
        kind: payment.kind,
        amount_cents: payment.amount_cents,
        event_amount_cents: outcome.amountCents ?? null,
        session_id: outcome.sessionId ?? null,
        payment_intent_id: outcome.paymentIntentId ?? null,
        stripe_event_id: outcome.eventId,
        livemode: outcome.livemode,
        location_id: locationId,
        location_code: ctx.locationCode,
        // `row_moved: false` ⇒ this row was NOT written; it keeps its earlier settlement.
        row_moved: false,
        row_status: fresh?.status ?? null,
        needs_review: reasons,
        voided_sibling_ids: [],
      },
      ipAddress: null,
      userAgent: null,
    });
    try {
      await notify({
        paymentId: payment.id,
        quoteId: payment.quote_id,
        locationId,
        kind: payment.kind,
        amountCents: outcome.amountCents ?? payment.amount_cents,
        reviewReasons: reasons,
      });
    } catch (e) {
      console.error(`[stripe webhook] review-notify failed for ${payment.id}:`, e instanceof Error ? e.message : e);
    }
    return { result: "paid_needs_review", locationId };
  }

  // THE ROW IS PAID. From here to the return NOTHING MAY THROW (see the header).
  const reasons: PaymentReviewReason[] = [];
  // WHERE THE PAYMENT IS NOW (review r4). If a revise moved it between the read and the
  // flip, the order is judged as it stands on the revision the row is on — its price, its
  // deadline, whether it is still open — not on the one that was read.
  const readOnQuoteId = payment.quote_id;
  const moved = flipped.quote_id !== readOnQuoteId;
  if (moved) {
    payment.quote_id = flipped.quote_id;
    try {
      const now = await quoteOfPayment(sb, flipped.quote_id);
      if (!now) throw new Error("the revision the payment is on could not be found");
      quote = now;
    } catch (e) {
      console.error(`[stripe webhook] could not re-read the quote of ${payment.id} after a revise:`, e instanceof Error ? e.message : e);
      reasons.push("quote_recheck_failed");
    }
  }
  if (payment.status === "void") reasons.push("intent_was_void");
  if (outcome.amountCents != null && outcome.amountCents !== payment.amount_cents) reasons.push("amount_mismatch");
  // AN OLDER PRICE (review r1). An intent whose checkout could not be retired when the quote
  // was re-priced keeps the amount that checkout charges (lib/catering/payment-carry.ts), so
  // the row and the charge AGREE and `amount_mismatch` is silent — while the customer has
  // paid a deposit or a total this quote no longer asks for. A `balance` is total − paid and
  // has no snapshot to be weighed against.
  const asked = payment.kind === "deposit" ? quote?.deposit_cents : payment.kind === "full" ? quote?.total_cents : null;
  if (asked != null && (outcome.amountCents ?? payment.amount_cents) !== asked) reasons.push("amount_not_current");
  if (quote && (quote.superseded_at != null || quote.status === "declined" || quote.status === "expired")) {
    reasons.push("quote_not_payable");
  }
  // SETTLED AFTER THE OFFER EXPIRED (review r2): the one shared clock rule, read at the
  // moment the money settled. An `accepted` order is not on that clock and is never flagged.
  const settledLate = quote != null && quoteTimeExpired(quote.status ?? "", quote.expires_at, settledAtMs);
  if (settledLate) reasons.push("paid_after_expiry");
  const siblings = await reviewSiblings(sb, payment);
  reasons.push(...siblings.reasons);
  // CLOSE WHAT CAN NO LONGER BE COLLECTED (review r3 — see the header). After the siblings
  // are voided, so a checkout attached a moment ago is found on a row this payment closed.
  // Never throws; what it could not confirm closed — or could not finish looking for — is a
  // reason for a person to look. It works from what the FLIP returned (review r4): the
  // session this row names is closed too unless it is the very session that was just paid.
  const closed: ClosedCheckouts = await closeQuoteCheckouts(sb, {
    quoteId: flipped.quote_id,
    locationId,
    settledPaymentId: payment.id,
    settledSessionId: flipped.provider_session_id ?? null,
    paidThroughSessionId: outcome.sessionId ?? null,
    retire: deps.retireSession,
  });
  if (closed.stillOpen.length > 0) reasons.push("sibling_checkout_open");

  void audit({
    actorId: null,
    actorRole: null,
    action: "catering.payment.provider_paid",
    resourceTable: "catering_payments",
    resourceId: payment.id,
    metadata: {
      actor_context: "stripe_webhook",
      quote_id: payment.quote_id,
      kind: payment.kind,
      // The row's own amount is the authority; the event's is evidence beside it, so a
      // disagreement is findable instead of adopted.
      amount_cents: payment.amount_cents,
      event_amount_cents: outcome.amountCents ?? null,
      session_id: outcome.sessionId ?? null,
      payment_intent_id: outcome.paymentIntentId ?? null,
      stripe_event_id: outcome.eventId,
      livemode: outcome.livemode,
      location_id: locationId,
      location_code: ctx.locationCode,
      row_moved: true,
      // Present only when a revise moved the payment between this event's read and its
      // flip: `quote_id` above is where the payment is NOW, this is where it was read.
      ...(moved ? { read_on_quote_id: readOnQuoteId } : {}),
      // When the money settled (the row's `paid_at`), beside the offer's deadline.
      settled_at: settledAt,
      offer_expires_at: quote?.expires_at ?? null,
      // Empty for an ordinary payment. See PaymentReviewReason.
      needs_review: reasons,
      voided_sibling_ids: siblings.voided,
      // The quote's other checkouts, by payment id: retired / could not be confirmed closed
      // / already complete (that money is landing; its own event records it).
      closed_checkouts: closed,
    },
    ipAddress: null,
    userAgent: null,
  });

  // BEST-EFFORT, ALWAYS. A mail failure must never fail a webhook: the money has landed
  // and the row says so; the email is how a human hears about it sooner.
  try {
    await notify({
      paymentId: payment.id,
      quoteId: payment.quote_id,
      locationId,
      kind: payment.kind,
      amountCents: payment.amount_cents,
      reviewReasons: reasons,
    });
  } catch (e) {
    console.error(`[stripe webhook] paid-notify failed for ${payment.id}:`, e instanceof Error ? e.message : e);
  }

  return { result: reasons.length > 0 ? "paid_needs_review" : "paid", locationId };
}

/** Has the WHOLE charge been refunded? Read from the charge alone (see `refund` below). */
export function chargeFullyRefunded(outcome: Pick<CheckoutEventOutcome, "chargeFullyRefunded" | "amountCents" | "chargeAmountCents">): boolean {
  if (outcome.chargeFullyRefunded !== undefined) return outcome.chargeFullyRefunded;
  // `amountCents` is the charge's CUMULATIVE `amount_refunded` (Stripe sums every refund on
  // the charge), so two partial refunds that together cover the charge do read as full.
  return (
    outcome.amountCents != null &&
    outcome.chargeAmountCents != null &&
    outcome.chargeAmountCents > 0 &&
    outcome.amountCents >= outcome.chargeAmountCents
  );
}

/**
 * `charge.refunded` — the only event that moves a row BACKWARDS. It is located by
 * `provider_ref = the charge's payment_intent`, which is exactly the id the paid flip
 * wrote, so a refund can only ever find a payment we actually took. The guard is
 * `.eq("status","paid")`: a refund event replayed against an already-refunded row
 * reports `no_paid_row` instead of writing again.
 *
 * ── ONLY A FULL REFUND MOVES THE ROW (audit W02/B036) ────────────────────────────────
 * Stripe sends `charge.refunded` for EVERY refund, a $20 goodwill refund on a $300 deposit
 * included. `status` has no "partially_refunded" member (migration 0127's CHECK), and the
 * row used to move to `refunded` on any of them — which told the customer portal nothing
 * had been paid, re-opened the pay panel, and let the already-paid gate wave a second
 * deposit through. So the row moves to `refunded` only when the WHOLE charge is refunded.
 * Anything less leaves the row `paid` — the customer HAS paid — and the refunded amount is
 * recorded on the same audit action with `partial: true`, result `partially_refunded`.
 * Splitting the status is still a settlement-ledger decision, not a webhook one.
 *
 * ── "WHOLE" IS THE CHARGE'S OWN FACT, NEVER THE ROW'S (review r1) ────────────────────
 * The first cut of this weighed `amount_refunded` against the ROW's `amount_cents`. The
 * row's amount is ours — a person, a re-price or an old bug can leave it below what Stripe
 * captured — and then a refund of the row's amount read as "fully refunded" with money
 * still held: $300 captured on a row saying $200, $200 refunded, payment re-opened. The
 * charge is the money, so only the charge may say it is all gone (`chargeFullyRefunded`
 * above): Stripe's `refunded` flag when the payload carries one — in either direction —
 * else `amount_refunded` against the charge's own `amount`. A payload with neither is
 * treated as partial: when we cannot tell, the conservative reading is the one that does
 * not invite a second charge.
 */
async function refund(
  sb: ServiceClient,
  outcome: CheckoutEventOutcome,
  ctx: StripeWebhookContext,
): Promise<{ result: StripeProcessingResult; locationId: string | null }> {
  if (!outcome.paymentIntentId) return { result: "payment_not_found", locationId: null };

  const { data: payment, error: findErr } = await sb
    .from("catering_payments")
    .select(PAYMENT_COLS)
    .eq("provider_ref", outcome.paymentIntentId)
    .limit(1)
    .maybeSingle<PaymentRow>();
  if (findErr) throw new Error(`stripe refund find: ${findErr.message}`);
  if (!payment) return { result: "payment_not_found", locationId: null };

  const locationId = await locationOfQuote(sb, payment.quote_id);
  if (ctx.locationId && locationId !== ctx.locationId) {
    return { result: "location_mismatch", locationId };
  }

  const fullyRefunded = chargeFullyRefunded(outcome);

  if (fullyRefunded) {
    const { error, count } = await sb
      .from("catering_payments")
      .update({ status: "refunded" }, { count: "exact" })
      .eq("id", payment.id)
      .eq("status", "paid");
    if (error) throw new Error(`stripe refund update: ${error.message}`);
    if (count === 0) return { result: "no_paid_row", locationId };
  } else if (payment.status !== "paid") {
    // A partial refund against a row that is not `paid` has nothing to annotate.
    return { result: "no_paid_row", locationId };
  }

  void audit({
    actorId: null,
    actorRole: null,
    action: "catering.payment.provider_refunded",
    resourceTable: "catering_payments",
    resourceId: payment.id,
    metadata: {
      actor_context: "stripe_webhook",
      quote_id: payment.quote_id,
      kind: payment.kind,
      amount_cents: payment.amount_cents,
      refunded_amount_cents: outcome.amountCents ?? null,
      charge_amount_cents: outcome.chargeAmountCents ?? null,
      // `partial: true` ⇒ the row was NOT moved; it is still `paid`.
      partial: !fullyRefunded,
      row_status: fullyRefunded ? "refunded" : "paid",
      payment_intent_id: outcome.paymentIntentId,
      stripe_event_id: outcome.eventId,
      livemode: outcome.livemode,
      location_id: locationId,
      location_code: ctx.locationCode,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { result: fullyRefunded ? "refunded" : "partially_refunded", locationId };
}

// ── The paid notification ───────────────────────────────────────────────────────────

/**
 * Tell the human who owns this event that the money arrived.
 *
 * There is NO in-app notification path for machine catering events — lib/catering/
 * system-intake.ts resolves an ASSIGNEE and nothing more — so the one available channel is
 * a plain team email from `teamFrom()` (the staff/internal sender, per lib/email.ts's
 * scheme), addressed to the lead's assignee, falling back to the shop's catering manager
 * via `resolveCateringManager`. With no assignee and no active catering manager, nobody is
 * mailed and that is the correct outcome, not a failure: inventing a recipient is how a
 * payment notice ends up in the wrong inbox.
 *
 * `sendEmail` never throws (lib/email.ts contract) and this whole call is wrapped in the
 * caller's try/catch anyway. The subject carries the amount so it is readable on a lock
 * screen; the body carries no card data, because we never receive any.
 *
 * A payment with `reviewReasons` (audit W02/B035) goes to the SAME person through the SAME
 * channel — it is not a new email, it is this one telling the truth: the subject ends
 * "NEEDS REVIEW" and the body names each reason in a plain sentence, because "payment
 * received" over a double charge is how a refund gets missed.
 */
const REVIEW_SENTENCE: Record<PaymentReviewReason, string> = {
  another_payment_already_paid:
    "Another payment on this order was already marked paid. This may be a duplicate charge that needs a refund.",
  amount_mismatch: "The amount the customer was charged does not match the amount on the payment record.",
  amount_not_current:
    "The customer paid an earlier price for this order: the amount charged is not what the quote asks for now. They may be owed a refund of the difference, or still owe it.",
  intent_was_void: "This payment request had been closed before the customer paid it.",
  quote_not_payable: "The quote is no longer open (it was replaced, declined or expired).",
  paid_after_expiry:
    "The customer paid after this quote had expired (the checkout was opened while it was still open). Check that the price and date still stand: revise the quote to confirm the order, or refund the payment.",
  already_settled:
    "This payment was already recorded another way (for example marked paid by hand), so this card charge may be a duplicate that needs a refund.",
  sibling_check_failed: "We could not check this order's other payments. Please check for a duplicate charge.",
  quote_recheck_failed:
    "This order was revised while the payment was landing, and we could not re-read the new revision. Check the amount paid against what the current quote asks for.",
  sibling_checkout_open:
    "An online checkout for this order could not be confirmed closed, so the customer may still be able to pay it. Expire the order's checkout sessions in the Stripe dashboard and check this order for a second charge.",
};

export async function notifyPaymentPaid(sb: ServiceClient, args: NotifyPaidArgs): Promise<void> {
  const { data: quote, error: qErr } = await sb
    .from("catering_quotes")
    .select("id, pipeline_id, location_id, event_date")
    .eq("id", args.quoteId)
    .maybeSingle<{ id: string; pipeline_id: string | null; location_id: string; event_date: string | null }>();
  if (qErr || !quote) return;

  let assignee: string | null = null;
  if (quote.pipeline_id) {
    const { data: lead } = await sb
      .from("catering_pipeline")
      .select("id, assigned_to")
      .eq("id", quote.pipeline_id)
      .maybeSingle<{ id: string; assigned_to: string | null }>();
    assignee = lead?.assigned_to ?? null;
  }
  if (!assignee) assignee = await resolveCateringManager(sb, quote.location_id);
  if (!assignee) return; // nobody to tell — see the header; this is not a failure

  const { data: user } = await sb
    .from("users")
    .select("id, email, active")
    .eq("id", assignee)
    .maybeSingle<{ id: string; email: string | null; active: boolean }>();
  if (!user?.email || user.active !== true) return;

  const money = (args.amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const dateLabel = quote.event_date ?? "date to be confirmed";
  const reasons = args.reviewReasons ?? [];
  const flagged = reasons.length > 0;
  const subject = `${TENANT_NAME}: ${money} ${args.kind} payment received${flagged ? " — NEEDS REVIEW" : ""}`;
  // appUrl() throws when NEXT_PUBLIC_APP_URL is unset (CI/local); a missing link must not
  // cost the notification, so the CTA degrades to the plain fact.
  let link: string | null = null;
  try {
    link = `${appUrl()}/catering/pipeline`;
  } catch {
    link = null;
  }

  const reviewHtml = flagged
    ? `
      <p style="margin:16px 0 8px;"><strong>This payment needs a review:</strong></p>
      <ul style="margin:0 0 0 18px;padding:0;">${reasons.map((r) => `<li>${escapeHtml(REVIEW_SENTENCE[r])}</li>`).join("")}</ul>
      <p style="margin:12px 0 0;">Nothing was refunded automatically.</p>`
    : "";
  const reviewText = flagged
    ? `\n\nThis payment needs a review:\n${reasons.map((r) => `- ${REVIEW_SENTENCE[r]}`).join("\n")}\nNothing was refunded automatically.`
    : "";
  const bodyHtml = `
      <p style="margin:0 0 16px;">A customer just paid a <strong>${escapeHtml(args.kind)}</strong> of <strong>${escapeHtml(money)}</strong> for the event on <strong>${escapeHtml(dateLabel)}</strong>.</p>
      <p style="margin:0;">Quote <code>${escapeHtml(args.quoteId)}</code> — the payment is recorded in CO-OPS.</p>${reviewHtml}
    `;
  const text = `${money} ${args.kind} payment received for the event on ${dateLabel}. Quote ${args.quoteId} is recorded in CO-OPS.${reviewText}${link ? `\n\n${link}` : ""}`;

  await sendEmail({
    to: user.email,
    from: teamFrom(),
    subject,
    html: link
      ? renderEmailLayout({
          preheader: subject,
          heading: flagged ? "Payment received — needs review" : "Payment received",
          bodyHtml,
          cta: { label: "OPEN THE PIPELINE", url: link },
          footerNote: "Sent automatically when the payment provider confirmed the charge.",
        })
      : `<p>${text.replace(/\n/g, "<br>")}</p>`,
    text,
  });
}
