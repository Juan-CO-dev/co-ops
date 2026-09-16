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
 * single payment row is touched. A 23505 means "we have already seen this exact event" and
 * the processor stops: no reads, no writes, result `duplicate`. Stripe retries until it
 * gets a 2xx and explicitly warns a delivery may repeat even after one, so this is the
 * difference between a refund recorded once and a refund recorded five times.
 *
 * Only a FAILED LEDGER APPEND throws. Everything else returns a named result the route
 * answers 200 with, because to a webhook provider a non-2xx means "retry", and there is
 * nothing to retry about an event we understood and deliberately ignored.
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
  | "already_advanced"    // the guarded update matched 0 rows — someone/something got there first
  | "payment_not_found"   // metadata + session-id lookup both came up empty
  | "location_mismatch"   // per-location mode: the payment belongs to another shop
  | "async_failed"        // delayed-notification payment failed; the row stays 'due'
  | "expired"             // the Checkout Session expired unpaid; the row stays 'due'
  | "refunded"            // a paid row became refunded
  | "no_paid_row"         // charge.refunded arrived for a payment that was not 'paid'
  | "ignored"             // an event type (or a completed-but-unpaid session) we do not act on
  | "duplicate"           // this exact event id is already on the ledger
  | "processing_failed"   // recorded, then something below it threw (a DB/transport fault)
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
}

export interface NotifyPaidArgs {
  paymentId: string;
  quoteId: string;
  locationId: string | null;
  kind: string;
  amountCents: number;
}

interface PaymentRow {
  id: string;
  quote_id: string;
  kind: string;
  amount_cents: number;
  status: string;
}

const PAYMENT_COLS = "id, quote_id, kind, amount_cents, status";

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

/** Stamp the verdict. Best-effort by design: the work is already committed, and throwing
 *  here would turn a completed payment into a 500 and an infinite Stripe retry. */
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
  const { error } = await sb.from("stripe_events").update(patch).eq("id", id);
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

/** The shop that owns a payment, via its quote. Null when the quote cannot be read. */
async function locationOfQuote(sb: ServiceClient, quoteId: string): Promise<string | null> {
  const { data, error } = await sb
    .from("catering_quotes")
    .select("id, location_id")
    .eq("id", quoteId)
    .maybeSingle<{ id: string; location_id: string }>();
  if (error) throw new Error(`locationOfQuote: ${error.message}`);
  return data?.location_id ?? null;
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
  if (appended === "duplicate") return { result: "duplicate", locationId: ctx.locationId };

  let result: StripeProcessingResult = "ignored";
  let resolvedLocation: string | null = ctx.locationId;
  try {
    const dispatched = await dispatch(sb, outcome, ctx, deps);
    result = dispatched.result;
    resolvedLocation = dispatched.locationId ?? ctx.locationId;
  } catch (e) {
    // A processing failure is recorded on the ledger and answered 200: the delivery is
    // already ledgered, so a Stripe retry would hit the duplicate guard and change nothing.
    // The retry is noise; the row — with `processing_failed` stamped on it and the payload
    // kept verbatim — is the thing a human needs. It is deliberately NOT `invalid_payload`:
    // the payload was fine, our side was not, and conflating the two would send someone to
    // read a healthy event looking for a defect in it.
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

  const locationId = await locationOfQuote(sb, payment.quote_id);

  // PER-LOCATION MODE ONLY: an event signed by one shop's account may not touch another
  // shop's money. Single-account mode has no such assertion to make — one account serves
  // every shop by design — so `ctx.locationId` is null and this check does not run.
  if (ctx.locationId && locationId !== ctx.locationId) {
    return { result: "location_mismatch", locationId };
  }

  if (outcome.kind === "async_failed") return { result: "async_failed", locationId };
  if (outcome.kind === "expired") return { result: "expired", locationId };

  // completed / async_succeeded — the money is real. Guarded flip, exactly the shape
  // markPaymentPaid uses: `.eq("status","due")` makes a concurrent/replayed advance a
  // no-op that REPORTS itself rather than a silent second write.
  const { error, count } = await sb
    .from("catering_payments")
    .update(
      {
        status: "paid",
        paid_at: new Date().toISOString(),
        provider: "stripe",
        provider_ref: outcome.paymentIntentId ?? null,
      },
      { count: "exact" },
    )
    .eq("id", payment.id)
    .eq("status", "due");
  if (error) throw new Error(`stripe mark paid: ${error.message}`);
  if (count === 0) return { result: "already_advanced", locationId };

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
    },
    ipAddress: null,
    userAgent: null,
  });

  // BEST-EFFORT, ALWAYS. A mail failure must never fail a webhook: the money has landed
  // and the row says so; the email is how a human hears about it sooner.
  const notify = deps.notifyPaid ?? ((args: NotifyPaidArgs) => notifyPaymentPaid(sb, args));
  try {
    await notify({
      paymentId: payment.id,
      quoteId: payment.quote_id,
      locationId,
      kind: payment.kind,
      amountCents: payment.amount_cents,
    });
  } catch (e) {
    console.error(`[stripe webhook] paid-notify failed for ${payment.id}:`, e instanceof Error ? e.message : e);
  }

  return { result: "paid", locationId };
}

/**
 * `charge.refunded` — the only event that moves a row BACKWARDS. It is located by
 * `provider_ref = the charge's payment_intent`, which is exactly the id the paid flip
 * wrote, so a refund can only ever find a payment we actually took. The guard is
 * `.eq("status","paid")`: a partial-refund event replayed against an already-refunded row
 * reports `no_paid_row` instead of writing again.
 *
 * PARTIAL REFUNDS ARE NOT MODELLED, AND THIS SAYS SO RATHER THAN GUESSING. `status` has no
 * "partially_refunded" member (migration 0127's CHECK), so any `charge.refunded` moves the
 * row to `refunded` and the event's `amount_refunded` is recorded in the audit metadata as
 * the honest detail. Splitting the status is a settlement-ledger decision, not a webhook
 * one.
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

  const { error, count } = await sb
    .from("catering_payments")
    .update({ status: "refunded" }, { count: "exact" })
    .eq("id", payment.id)
    .eq("status", "paid");
  if (error) throw new Error(`stripe refund update: ${error.message}`);
  if (count === 0) return { result: "no_paid_row", locationId };

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
      payment_intent_id: outcome.paymentIntentId,
      stripe_event_id: outcome.eventId,
      livemode: outcome.livemode,
      location_id: locationId,
      location_code: ctx.locationCode,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { result: "refunded", locationId };
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
 */
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
  const subject = `${TENANT_NAME}: ${money} ${args.kind} payment received`;
  // appUrl() throws when NEXT_PUBLIC_APP_URL is unset (CI/local); a missing link must not
  // cost the notification, so the CTA degrades to the plain fact.
  let link: string | null = null;
  try {
    link = `${appUrl()}/catering/pipeline`;
  } catch {
    link = null;
  }

  const bodyHtml = `
      <p style="margin:0 0 16px;">A customer just paid a <strong>${escapeHtml(args.kind)}</strong> of <strong>${escapeHtml(money)}</strong> for the event on <strong>${escapeHtml(dateLabel)}</strong>.</p>
      <p style="margin:0;">Quote <code>${escapeHtml(args.quoteId)}</code> — the payment is recorded as paid in CO-OPS.</p>
    `;
  const text = `${money} ${args.kind} payment received for the event on ${dateLabel}. Quote ${args.quoteId} is recorded as paid.${link ? `\n\n${link}` : ""}`;

  await sendEmail({
    to: user.email,
    from: teamFrom(),
    subject,
    html: link
      ? renderEmailLayout({
          preheader: subject,
          heading: "Payment received",
          bodyHtml,
          cta: { label: "OPEN THE PIPELINE", url: link },
          footerNote: "Sent automatically when the payment provider confirmed the charge.",
        })
      : `<p>${text.replace(/\n/g, "<br>")}</p>`,
    text,
  });
}
