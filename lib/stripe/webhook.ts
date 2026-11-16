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
 * itself (what a second run of a PAID settlement then does — finish the cleanup, or
 * nothing — is decided by the marker on the payment row, below). The final stamp is guarded
 * the same way, so a retry can never overwrite a terminal verdict a concurrent delivery
 * already wrote.
 *
 * A FAILED LEDGER APPEND (or a failed read of a seen event's verdict, or of the row the
 * duplicate gate consults) throws, a PROCESSING FAILURE returns `processing_failed`, and a
 * settlement whose required work is unfinished returns `settlement_incomplete` (review r7,
 * below); the route answers 500 to all of them, because those are exactly the cases a Stripe
 * retry can fix. Everything else returns a
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
 * EVERYTHING AFTER THE FLIP IS NON-THROWING. A failure in the review step degrades to a
 * reason (`sibling_check_failed`), never to an exception.
 *
 * ── A SETTLEMENT IS FINISHED WHEN ITS CLEANUP IS RECORDED AS DONE — ON THE PAYMENT ROW ──────
 * (review r5, then r6.) Recording money is: (1) the paid flip, (2) voiding the order's other
 * deposit / full intent, (3) closing the order's other checkouts, (4) the verdict on the
 * ledger row. The function can be cut off between any two (a timeout, a crash, a deploy), and
 * two deliveries of ONE event can overlap. Round r5 let "a redelivery of an event whose
 * ledger row was never stamped" resume the cleanup — i.e. it asked WHICH DELIVERY INSERTED
 * THE LEDGER ROW. That question has a wrong answer (review r6, reproduced): delivery A
 * inserts the ledger row and pauses; delivery B, a retry of the same event, flips the payment
 * and dies before the cleanup; A resumes, finds the charge on the row, is "not a redelivery",
 * stamps `already_advanced` — and every later retry is a `duplicate`. Steps 2 and 3 never
 * ran, a full-amount checkout stayed payable beside a paid deposit, and nothing would ever
 * look again.
 *
 * So "is the cleanup still owed?" is no longer inferred from the ledger at all. It is a
 * DURABLE FACT ON THE PAYMENT ROW: `catering_payments.settlement_cleanup_at` (migration
 * 0303; lib/catering/payment-sessions.ts has the rule). NULL = not confirmed complete.
 *   · ANY DELIVERY THAT FINDS ITS CHARGE ALREADY ON A SETTLED ROW (`paid`, or `refunded`
 *     since — review r8, below) WHOSE MARKER IS NULL RUNS THE SETTLEMENT AGAIN (`settle`): the first delivery of the event or its tenth, the
 *     delivery that inserted the ledger row or one that did not, the same event or another
 *     event about the same charge. (Stripe documents all three: "Webhook endpoints might
 *     occasionally receive the same event more than once"; "In some cases, two separate
 *     Event objects are generated and sent"; and a manual resend "doesn't cancel Stripe's
 *     automatic retry behavior" — docs.stripe.com/webhooks, read 2026-11-15.) Steps 2 and 3 run from the row as it is now and the order
 *     is judged again. Every write in them is idempotent — the sibling void is guarded on
 *     `due`, a retire of a session that is already expired answers `expired`, every clear is
 *     guarded on the exact session id — so two runs side by side, or a run after one that
 *     had in fact finished, change nothing the second time.
 *   · THE MARKER IS WRITTEN ONLY WHEN THE CLEANUP IS CONFIRMED COMPLETE: the order's other
 *     payments were read and every sibling void landed, every other checkout was confirmed
 *     closed (or is already landing), and the whole family was looked at. A run that could
 *     not confirm that tells a person (`sibling_checkout_open` / `sibling_check_failed`),
 *     leaves the unresolved checkout's id on its row, LEAVES THE MARKER NULL — and answers
 *     `settlement_incomplete` (review r7, below), so Stripe sends the event again and the
 *     next delivery tries again.
 *   · `already_advanced` IS STAMPED ONLY WHEN THE MARKER IS SET. It means exactly: this
 *     charge is on its row and its cleanup is recorded as done. It never again means
 *     "somebody else is probably handling it" — and never "the row was refunded, so there is
 *     nothing to tidy" (review r8, below: that was false).
 *   · THE REPORT RIDES ON THE MARKER — AND WHICH SIDE OF IT DEPENDS ON WHAT THERE IS TO SAY.
 *     The marker is written by compare-and-set (NULL → now). An ORDINARY payment (nothing to
 *     review) is reported right AFTER that write, by the run whose write landed: a NULL
 *     marker then means nobody has been told yet, the run that finishes the cleanup tells
 *     them, and nobody is told twice (two runs at the same moment both do the idempotent
 *     work; one write lands and that run reports; a write that FAILED — a database error —
 *     is not a lost one: that run answers `settlement_incomplete`, and its redelivery reports
 *     when its own write lands — review r7). The price is
 *     that a run cut off between that write and its email sends no "payment received" note;
 *     the row says it. A payment that NEEDS REVIEW is reported BEFORE the marker, by every
 *     run that finds it: a finding must never be the thing a cut-off loses, so if the run
 *     dies while telling someone, the marker is still NULL and the next delivery finds and
 *     tells it again. A person may hear about one problem twice; never zero times.
 *   · The ledger stamp comes last and decides nothing: it only stops Stripe's retries. A
 *     delivery cut off between the marker and its stamp is redelivered, finds the marker
 *     set, and is stamped `already_advanced`.
 *   · One fact a later run cannot recompute: whether the intent had been VOID before it was
 *     paid (`intent_was_void`) — the flip overwrote that status. Everything else (the
 *     amount, the order's price now, its deadline, its other payments, its open checkouts)
 *     is read again and judged again.
 * WITHOUT MIGRATION 0303 the paid flip still lands (it reads and writes no 0303 column); its
 * marker cannot be written, so that delivery answers `settlement_incomplete`; a delivery that
 * then finds its charge already on the row cannot read the marker and fails as
 * `processing_failed`. Either way Stripe redelivers until the migration is applied. Stripe
 * keys are never set before 0303 (see the migration's header).
 *
 * ── A COMPARE-AND-SET THAT MATCHES NOTHING IS A QUESTION, NOT AN ANSWER (review r6) ──────
 * Writing the interleaving matrix (tests/catering-payment-interleavings.test.ts: every pair
 * of flows that can touch one order, its serialization point, the test that interleaves
 * them) found two pairs that had none. Both are closed here.
 *   · THE SIBLING VOID. The settlement reads the order's other intent as `due` and voids it,
 *     guarded on `due`. If that write matches nothing, something else wrote the row in
 *     between — and it used to be dropped silently. A person marking that intent paid by
 *     hand, or its own card payment landing, at that moment left a deposit and the whole
 *     total both recorded and NOBODY TOLD. So the row is read again and what it has become
 *     decides: `paid` → `another_payment_already_paid`; still `due` on a revision a revise
 *     created meanwhile → voided there (once); anything unreadable → cleanup not complete.
 *   · A REFUND PROCESSED BEFORE ITS PAYMENT. Stripe does not promise delivery order, and a
 *     failing event is retried for days. `charge.refunded` finds its row by `provider_ref`,
 *     which only the paid flip writes — so a refund worked before its payment's event found
 *     nothing, answered `payment_not_found` for good, and the payment then landed and stayed
 *     `paid` with the money already given back. THE LEDGER REMEMBERS: a settlement looks
 *     for `charge.refunded` events that name its PaymentIntent and moved no row — closed
 *     `payment_not_found`, or not closed yet (a refund delivery in flight appended its
 *     ledger row before it looked for the payment, so one of the two always sees the other)
 *     (`refundsSeenFirst`) — tells a person (`refund_seen_first`), and THEN applies each one
 *     with the live path's own `refund` and corrects that event's ledger verdict. The telling
 *     comes first because the applying can move the row to `refunded`, after which no later
 *     run judges the payment again (a later run still finishes its cleanup — review r8,
 *     below). A look that could not be made is `refund_check_failed`, the
 *     settlement's marker is not written, and — like a refund that could not be APPLIED —
 *     the delivery answers `settlement_incomplete`, so it is tried again (review r7).
 *
 * ── UNFINISHED WORK IS NEVER ANSWERED 2xx, AND "DUPLICATE" ASKS THE ROWS FIRST (review r7) ──
 * Round r6 made "is the cleanup still owed?" a fact on the payment row — and then answered
 * Stripe `200` over a settlement whose marker was still NULL (`paid_needs_review`, stamped on
 * the ledger as a terminal verdict). Stripe does not send an acknowledged event again; and if
 * a person resent it, the duplicate gate read the ledger, saw a terminal verdict and stopped
 * before anything looked at the marker. Reproduced by the reviewer twice: a checkout that
 * could not be retired for a moment stayed attached and payable for good; a whole-charge
 * refund seen before its payment, whose application hit ONE database error, left the fully
 * refunded charge `paid` for good. The marker said "owed" and nothing would ever read it.
 *
 * Two rules close it, and they are the same rule seen from each side:
 *   · A SETTLEMENT WHOSE REQUIRED WORK IS NOT FINISHED ANSWERS `settlement_incomplete`, WHICH
 *     THE ROUTE ANSWERS 500. Required work = the order's other payments read and every
 *     sibling void landed, every other checkout confirmed closed, every refund Stripe had
 *     already reported applied, and the marker written (`won`, or `lost` to a run that wrote
 *     it). The money write is NOT undone and NOT repeated
 *     — the paid flip stays a guarded compare-and-set — only the answer changes. Stripe then
 *     sends the SAME event again: "Stripe attempts to deliver events to your destination for
 *     up to three days with an exponential back off in live mode. … We retry event deliveries
 *     created in a sandbox three times over the course of a few hours." and "If Stripe
 *     retries an event (for example, your endpoint previously replied with a non-`2xx` status
 *     code), then we generate a new signature and timestamp for the new delivery attempt."
 *     (docs.stripe.com/webhooks, "Automatic retries" / "Preventing replay attacks", read
 *     2026-11-15; the same page tells receivers to "Track event IDs to identify duplicate
 *     deliveries" — a retried delivery is the event it was.) `settlement_incomplete` is a
 *     RETRYABLE ledger state like `processing_failed`: the redelivery runs the dispatch,
 *     finds its charge on the row with the marker NULL, and runs the settlement again.
 *   · THE DUPLICATE GATE CONSULTS THE ROW BEFORE IT SAYS `duplicate` (`workStillOwed`). A
 *     terminal verdict on the ledger no longer ends a payment event by itself: if a settled
 *     row (`paid` or `refunded` — review r8) carries this event's charge and its marker is
 *     NULL, the settlement is run again
 *     (the marker is written only after every seen-first refund was applied, so "marker NULL"
 *     is also "a seen-first refund may be unapplied"). And a `charge.refunded` event whose
 *     verdict is `payment_not_found` is not a duplicate while a `paid` row now carries its
 *     charge: it is applied, and its verdict corrected. A failed read at the gate throws (the
 *     route answers 500): "finished" must be known, not assumed.
 *
 * ── THE MARKER ALONE OWNS THE CLEANUP — A REFUND NEVER ENDS A SETTLEMENT (review r8) ────
 * Rounds r6 / r7 wrote "a `paid` row whose marker is NULL" in three places here — the resume
 * gate, the duplicate gate (`workStillOwed`), and "`lost` = … or the row is no longer `paid`"
 * at the marker — and `markSettlementCleanupDone` was itself guarded on `status = 'paid'`.
 * But this file can move a row to `refunded` in the middle of its own settlement: a refund
 * seen first is applied AFTER the report and BEFORE the marker. Reproduced by the reviewer: a
 * whole-charge refund arrives before its payment; the payment lands, voids the full-amount
 * intent, cannot retire its checkout for a moment, applies the refund, answers
 * `settlement_incomplete` — and the SAME event, sent again, found a row that was not `paid`,
 * answered `already_advanced`, and was a `duplicate` ever after. The checkout stayed attached
 * and payable; retirement had been tried exactly once.
 *
 * The rule (lib/catering/payment-sessions.ts has it in full): WHETHER A SETTLEMENT'S CLEANUP
 * IS OWED IS `settlement_cleanup_at` AND NOTHING ELSE. A row money was recorded on — `paid`,
 * or `refunded` since (`settlementRecorded`) — whose marker is NULL owes it. Every gate reads
 * that one definition: the resume gate and the "another settlement got there first" branch
 * in `dispatch`, `workStillOwed`, the marker write, and "Mark paid"'s resume
 * (lib/catering/payments.ts). THE CLEANUP NEVER WRITES THE MONEY STATUS: a refunded row stays
 * refunded, and the order ends where "settled, then refunded" would have left it. What
 * changes for a refunded row is only what is said about it (see `settle`). The one gate that
 * still reads `paid` is the one that is ABOUT money: a refund is applied only to a `paid`
 * row (`refund`, and `workStillOwed` for a refund event that had found no payment).
 * tests/catering-payment-interleavings.test.ts walks every gate over every money status ×
 * marker NULL / set.
 *
 * WHAT A PERSON HEARS (the stated policy). A payment that NEEDS REVIEW is told by every run
 * that finds it — AT LEAST ONCE, and once more per redelivery while its work is unfinished
 * (bounded by Stripe's own retry window above; each mail says what is still open, and they
 * stop the moment the work is done). An ORDINARY "payment received" is told AT MOST ONCE: by
 * the run whose marker write landed (`won`), and by no other — a run whose marker write
 * FAILED no longer reports (round r6 did, "because nobody else is known to"; now the
 * redelivery is known to, and reports when its own write lands).
 *
 * ONE THING A RETRY CANNOT FIX IS NOT RETRIED: a look for earlier refunds that came back
 * FULL (`REFUNDS_SEEN_FIRST_LIMIT` unmatched refund events on the ledger). Asking again would
 * read the same page. It is told to a person (`refund_check_failed`) and does not hold the
 * settlement open; a look that FAILED (a database error) does.
 *
 * ── A DELAYED PAYMENT THAT FAILED FREES ITS INTENT (review r5) ───────────────────────
 * Checkout is minted with no `payment_method_types`, so the methods offered are the ones the
 * Stripe account has switched on, and those can include bank debits. Stripe: "Some payment
 * methods aren't instant, such as ACH direct debit and other bank transfers. This means,
 * funds won't be immediately available when Checkout completes." (docs.stripe.com/checkout/
 * fulfillment). Such a session reads `complete` with `payment_status: unpaid` — which this
 * codebase rightly treats as "money may be landing": the pay path refuses another checkout
 * (409 `payment_in_progress`) and nothing can expire a complete session. The verdict arrives
 * as `checkout.session.async_payment_succeeded` ("Occurs when a payment intent using a
 * delayed payment method finally succeeds.") or `checkout.session.async_payment_failed`
 * ("Occurs when a payment intent using a delayed payment method fails." — both
 * docs.stripe.com/api/events/types). The failure used to change nothing, so the dead session
 * stayed on the due row and the customer could never try again.
 *
 * `async_payment_failed` is Stripe's own word that the attempt is over, exactly as
 * `checkout.session.expired` is. So it CLEARS the session id — guarded on the exact session
 * the event names and on the row still being `due` or `void`, so a late or repeated failure
 * event can never clear a NEWER checkout the row has been given since — and writes an audit
 * row (`catering.payment.provider_payment_failed`). The intent itself is untouched: a due
 * row stays due at its amount and the next pay tap mints a fresh checkout. (The Stripe pages
 * quoted here do not say whether a `complete` session can ever be paid after its delayed
 * payment failed — UNVERIFIED — and nothing here depends on it: a later success for that
 * session still finds the row by `metadata.payment_id` and is recorded, or flagged.)
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
import {
  closeQuoteCheckouts,
  markSettlementCleanupDone,
  settlementCleanupComplete,
  settlementRecorded,
  type ClosedCheckouts,
} from "@/lib/catering/payment-sessions";
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
  | "paid"                // a due row became paid AND its order was cleaned up (by the run that flipped it, or one that finished for it)
  | "paid_needs_review"   // money was taken and recorded, but something about it needs a human
  | "already_advanced"    // this charge is already on its row AND its cleanup is recorded as done — whatever the row's money status (review r8)
  | "payment_not_found"   // metadata + session-id lookup both came up empty
  | "location_mismatch"   // per-location mode: the payment belongs to another shop
  | "async_failed"        // delayed-notification payment failed; the row keeps its status, the failed session's id is cleared
  | "expired"             // the Checkout Session expired unpaid; the row keeps its status, its session id is cleared
  | "refunded"            // a paid row became refunded (the WHOLE charge was refunded)
  | "partially_refunded"  // part of the charge was refunded; the row stays 'paid', the amount is audited
  | "no_paid_row"         // charge.refunded arrived for a payment that was not 'paid'
  | "ignored"             // an event type (or a completed-but-unpaid session) we do not act on
  | "duplicate"           // this exact event id is already on the ledger WITH a terminal verdict
  | "processing_failed"   // recorded, then something below it threw — RETRYABLE (route answers 500)
  | "settlement_incomplete" // the money IS recorded; required work after it is not finished — RETRYABLE (route answers 500)
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
  | "sibling_check_failed"         // we could not read the quote's other payments, or could not close one of them
  | "refund_seen_first"            // Stripe reported a refund of this charge BEFORE the payment was recorded here
  | "refund_check_failed"          // we could not look for (or apply) such an earlier refund
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
  /** True when the payment has since been REFUNDED IN FULL and this notice is a later run
   *  finishing its settlement (review r8): the email says so, and it only ever carries what
   *  is still OPEN on the order. Never set on an ordinary "payment received". */
  refunded?: boolean;
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

/** A ledger row whose work is NOT known to have landed: never stamped, stamped failed, or
 *  stamped over a settlement whose required work was not finished (review r7). */
export function isRetryableLedgerOutcome(outcome: string | null): boolean {
  return outcome === null || outcome === "processing_failed" || outcome === "settlement_incomplete";
}

/**
 * The results the ROUTE must answer non-2xx to, so Stripe sends the SAME event again (review
 * r7 — see the header). One spelling, read by the route and by the tests, so "retryable on
 * the ledger" and "retried by Stripe" cannot drift apart.
 */
export function isRetryableResult(
  result: StripeProcessingResult,
): result is "processing_failed" | "settlement_incomplete" {
  return result === "processing_failed" || result === "settlement_incomplete";
}

/** The ledger verdicts a final stamp may replace: the retryable ones. PostgREST `or` filter. */
const LEDGER_UNFINISHED = "outcome.is.null,outcome.eq.processing_failed,outcome.eq.settlement_incomplete";

/** Stamp the verdict. Best-effort by design: the work is already committed, and throwing
 *  here would turn a completed payment into a 500 and an infinite Stripe retry.
 *
 *  GUARDED on the row still being unfinished (`outcome` NULL, `processing_failed` or
 *  `settlement_incomplete`): two deliveries of one event can run the dispatch concurrently,
 *  and the loser of the guarded money write must not replace the winner's `paid` with its
 *  own `already_advanced` — or with its own `settlement_incomplete`. The first terminal
 *  verdict wins.
 *
 *  `alsoReplace` (review r7): the ONE terminal verdict a stamp may replace as well — a
 *  `charge.refunded` event's `payment_not_found`, when the duplicate gate found that a paid
 *  row now carries its charge and this run applied it. Nothing else is ever replaced.
 *
 *  THE STAMP DECIDES NOTHING ELSE (review r6). It stops Stripe's retries; whether a
 *  settlement's cleanup is still owed, and who reports the payment, are decided by the
 *  marker on the payment row (see the header), before this is written. */
async function finalizeEvent(
  sb: ServiceClient,
  id: string,
  result: StripeProcessingResult,
  locationId: string | null,
  alsoReplace: "payment_not_found" | null = null,
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
    .or(alsoReplace ? `${LEDGER_UNFINISHED},outcome.eq.${alsoReplace}` : LEDGER_UNFINISHED);
  if (error) console.error(`[stripe webhook] outcome stamp failed for ${id}:`, error.message);
}

interface Dispatched {
  result: StripeProcessingResult;
  locationId: string | null;
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
 * NEVER THROWS (see the header). A read failure is the reason `sibling_check_failed` — and
 * so is a sibling void that FAILED (review r6): an intent that should have been closed and
 * was not is unfinished cleanup, so it is told to a person and the settlement's marker is
 * not written (`complete: false`); the next look voids it.
 */
async function reviewSiblings(
  sb: ServiceClient,
  payment: PaymentRow,
): Promise<{ reasons: PaymentReviewReason[]; voided: string[]; complete: boolean }> {
  const reasons: PaymentReviewReason[] = [];
  const voided: string[] = [];
  let complete = true;
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
        let scope = family;
        for (let attempt = 1; ; attempt += 1) {
          // Guarded on the row as it was read: still `due`, and still on a revision of THIS
          // order (review r5 — every write to a due intent is bound to what was read; a
          // payment never leaves its family, so this holds wherever a revise has put it). The
          // session id is deliberately left on the row: voiding is our bookkeeping, and the
          // checkout is closed — and its id cleared — only on Stripe's word
          // (`closeQuoteCheckouts`).
          const { error: vErr, count } = await sb
            .from("catering_payments")
            .update({ status: "void" }, { count: "exact" })
            .eq("id", s.id)
            .eq("status", "due")
            .in("quote_id", scope);
          if (vErr) {
            // Not "nothing to void": this intent is still due and should not be (review r6).
            console.error(`[stripe webhook] could not void sibling intent ${s.id}:`, vErr.message);
            complete = false;
            break;
          }
          if ((count ?? 0) > 0) {
            voided.push(s.id);
            break;
          }
          // NOTHING WAS WRITTEN — SO SOMETHING ELSE WROTE THIS ROW AFTER IT WAS READ (review
          // r6, the interleaving matrix). A compare-and-set that misses is a question, not an
          // answer: the row is read again, and what it has BECOME decides.
          const { data: now, error: nowErr } = await sb
            .from("catering_payments")
            .select("id, kind, status, quote_id")
            .eq("id", s.id)
            .maybeSingle<{ id: string; kind: string; status: string; quote_id: string }>();
          if (nowErr || !now) {
            console.error(`[stripe webhook] could not re-read sibling intent ${s.id} after its void matched nothing:`, nowErr?.message ?? "row not found");
            complete = false;
            break;
          }
          if (now.status === "paid") {
            // It was PAID in between — a person marked it by hand, or its own card payment
            // landed — after this settlement had read it as due. That is a second payment on
            // the order, and this run is the one that can see both.
            if (!isDesignedPair(payment.kind, now.kind) && !reasons.includes("another_payment_already_paid")) {
              reasons.push("another_payment_already_paid");
            }
            break;
          }
          if (now.status !== "due") break; // void / refunded meanwhile: nothing left to close
          // STILL DUE: a revise carried it onto a revision that did not exist when the family
          // was read. Look at the family again and void it where it is — once.
          if (attempt >= 2) {
            complete = false;
            break;
          }
          scope = await familyRevisionIds(sb, payment.quote_id, "reviewSiblings retry");
          if (!scope.includes(now.quote_id)) {
            complete = false;
            break;
          }
        }
      }
    }
  } catch (e) {
    console.error(`[stripe webhook] sibling review failed for ${payment.id}:`, e instanceof Error ? e.message : e);
    complete = false;
  }
  if (!complete) reasons.push("sibling_check_failed");
  return { reasons, voided, complete };
}

interface EarlierRefund {
  eventId: string;
  payload: unknown;
}

/** How many unmatched refund events are looked through for one charge. More than this on
 *  the ledger and the look is not trusted (it answers `failed`, never "none"). */
const REFUNDS_SEEN_FIRST_LIMIT = 200;

/** A `charge.refunded` ledger row that moved no payment row: it found none, or it has no
 *  terminal verdict yet (in flight, or died). PostgREST `or` filter. */
const REFUND_NOT_APPLIED = "outcome.is.null,outcome.eq.processing_failed,outcome.eq.payment_not_found";

/**
 * REFUNDS THAT ARRIVED BEFORE THEIR PAYMENT (review r6 — the interleaving matrix, paid ×
 * refund). Stripe does not promise the order events are delivered in — "Stripe doesn't
 * guarantee the delivery of events in the order that they're generated. … Make sure that
 * your event destination isn't dependent on receiving events in a specific order" — and an
 * event that failed is retried for days — "Stripe attempts to deliver events to your
 * destination for up to three days with an exponential back off in live mode" (both
 * docs.stripe.com/webhooks, "Event ordering" / "Automatic retries", read 2026-11-15). So
 * `charge.refunded` can be processed while the payment's own event has not been (it was
 * failing, or simply had not arrived). The refund then found no
 * row carrying its PaymentIntent — that id is only written by the paid flip — answered
 * `payment_not_found`, and was closed for good; the payment landed later and stayed `paid`
 * with its money already given back.
 *
 * The ledger remembers. Every delivery is appended before it is worked, so the refund that
 * found nothing is still there, with its payload. When a payment lands, the ledger is asked
 * for `charge.refunded` events whose charge names THIS PaymentIntent and that did NOT move a
 * row: closed `payment_not_found` — or NOT CLOSED AT ALL (outcome NULL / `processing_failed`).
 * The second kind matters: a refund delivery that is in flight at this very moment appended
 * its ledger row BEFORE it looked for the payment, and this look comes AFTER the paid flip —
 * so whichever of the two got there first, one of them sees the other (it finds the row, or
 * this finds its ledger row). Matching is done on the parsed payload (the same parser the
 * live path uses), never on a JSON path in the query.
 *
 * NEVER THROWS. Two ways the look can fall short, and they are NOT the same (review r7):
 *   `failed`    — it could not be made (a database error). TRANSIENT: the caller flags it,
 *                 does not record the settlement's cleanup as done, and the delivery is
 *                 answered `settlement_incomplete` so the same event is tried again.
 *   `truncated` — it was made and came back FULL, so there may be more it did not look at.
 *                 NOT transient: asking again reads the same page. The caller flags it
 *                 (`refund_check_failed` — a person checks the charge in Stripe) and does NOT
 *                 hold the settlement open over it, or every card payment would answer 500
 *                 for as long as that many unmatched refund events sit on the ledger.
 */
async function refundsSeenFirst(
  sb: ServiceClient,
  paymentIntentId: string | null | undefined,
): Promise<{ events: EarlierRefund[]; failed: boolean; truncated: boolean }> {
  if (!paymentIntentId) return { events: [], failed: false, truncated: false };
  try {
    const { data, error } = await sb
      .from("stripe_events")
      .select("id, payload")
      .eq("type", "charge.refunded")
      .or(REFUND_NOT_APPLIED)
      .order("received_at", { ascending: true })
      .limit(REFUNDS_SEEN_FIRST_LIMIT)
      .returns<Array<{ id: string; payload: unknown }>>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const events = rows
      .filter((r) => parseCheckoutEvent(r.payload).paymentIntentId === paymentIntentId)
      .map((r) => ({ eventId: r.id, payload: r.payload }));
    // A full page means there may be more we did not look at.
    return { events, failed: false, truncated: rows.length >= REFUNDS_SEEN_FIRST_LIMIT };
  } catch (e) {
    console.error(`[stripe webhook] could not look for refunds seen before payment ${paymentIntentId}:`, e instanceof Error ? e.message : e);
    return { events: [], failed: true, truncated: false };
  }
}

/**
 * Apply ONE refund that was seen before its payment, now that the payment's row carries the
 * PaymentIntent: the very same `refund` the live path runs (so: only a whole-charge refund
 * moves the row; a partial one is audited and the row stays `paid`), then the refund event's
 * ledger row is given the verdict of what was actually done — guarded on its still saying
 * "nothing applied" (`REFUND_NOT_APPLIED`), so a second run corrects nothing twice, and a
 * refund delivery that was in flight finds its event already closed (its own guarded stamp
 * then matches nothing; its redelivery is a duplicate). Returns false when it could not be
 * applied. NEVER THROWS.
 */
async function applyEarlierRefund(sb: ServiceClient, earlier: EarlierRefund, ctx: StripeWebhookContext): Promise<boolean> {
  try {
    const applied = await refund(sb, parseCheckoutEvent(earlier.payload), ctx);
    // Still nothing to apply it to is not "applied": leave the ledger row as it is.
    if (applied.result === "payment_not_found") return false;
    // Only a verdict that DID something replaces the old one. `no_paid_row` here means
    // another run of this settlement applied it a moment ago — that run writes the verdict.
    if (applied.result === "refunded" || applied.result === "partially_refunded") {
      const { error } = await sb
        .from("stripe_events")
        .update({ outcome: applied.result, processed_at: new Date().toISOString() })
        .eq("id", earlier.eventId)
        .or(REFUND_NOT_APPLIED);
      if (error) console.error(`[stripe webhook] could not correct the ledger row of refund ${earlier.eventId}:`, error.message);
    }
    return true;
  } catch (e) {
    console.error(`[stripe webhook] could not apply the earlier refund ${earlier.eventId}:`, e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * THE DUPLICATE GATE'S QUESTION TO THE ROWS (review r7 — see the header): this event id is on
 * the ledger with a TERMINAL verdict; is there, all the same, work of ITS OWN that the rows
 * say is not finished?
 *
 *   · A PAYMENT event (`completed` / `async_succeeded`): a SETTLED row carries this event's
 *     charge (`provider_ref` = its PaymentIntent — the id only the paid flip writes) and its
 *     settlement marker is NULL. That is the whole of "required post-payment work is
 *     unfinished": the marker is written only after the sibling voids landed, the other
 *     checkouts were confirmed closed AND every refund seen first was applied. SETTLED IS
 *     `paid` OR `refunded` (review r8, `settlementRecorded`): round r7 asked for `paid`, so a
 *     row a refund had been applied to — by the settlement itself, a moment before it found
 *     a checkout it could not close — was a `duplicate` with that checkout still payable.
 *     The marker owns this question; the money status does not.
 *   · A REFUND event whose verdict is `payment_not_found`: a `paid` row NOW carries its
 *     charge — the payment landed after it, and whatever should have applied this refund
 *     since has not (the row would not be `paid`, or this verdict would have been corrected).
 *     This one IS a question about the money status, and stays one: only a `paid` row has a
 *     refund left to apply.
 *
 * One indexed read, no write. Any other event, or a payload with no PaymentIntent, has
 * nothing a replay could finish. THROWS on a read failure — the same posture as
 * `readLedgerOutcome`: answering `duplicate` (a 200) without knowing is the bug this closes.
 * Without migration 0303 the marker column is not there and this read fails for a payment
 * event, which is the retryable answer that state should get (see the header).
 */
async function workStillOwed(sb: ServiceClient, outcome: CheckoutEventOutcome, prior: string | null): Promise<boolean> {
  const paymentEvent = outcome.kind === "completed" || outcome.kind === "async_succeeded";
  const unappliedRefund = outcome.kind === "refunded" && prior === "payment_not_found";
  if (!outcome.paymentIntentId || (!paymentEvent && !unappliedRefund)) return false;
  const { data, error } = await sb
    .from("catering_payments")
    .select("id, status, provider_ref, settlement_cleanup_at")
    .eq("provider_ref", outcome.paymentIntentId)
    .limit(1)
    .returns<Array<{ id: string; status: string; provider_ref: string | null; settlement_cleanup_at: string | null }>>();
  if (error) throw new Error(`stripe duplicate gate: ${error.message}`);
  // The row is read WITHOUT a status filter, and each question reads the status it is about.
  const carrying = data?.[0] ?? null;
  if (!carrying) return false;
  // A refund that found no payment: owed only while the row is still `paid`.
  if (unappliedRefund) return carrying.status === "paid";
  // A payment event: owed while the marker is NULL — `paid` or `refunded` alike (review r8).
  return settlementRecorded(carrying.status) && carrying.settlement_cleanup_at == null;
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
  /** Set when a refund event's `payment_not_found` is being worked again (the gate below). */
  let reopened: "payment_not_found" | null = null;
  if (appended === "duplicate") {
    // Seen before — but was it FINISHED? (See the header.) A row that never got a verdict, or
    // got a retryable one (`processing_failed`, `settlement_incomplete`), is worked again.
    const prior = await readLedgerOutcome(sb, outcome.eventId);
    if (!isRetryableLedgerOutcome(prior)) {
      // A TERMINAL verdict — and still not `duplicate` until the ROWS agree (review r7): a
      // settlement whose marker is NULL (on a paid OR a since-refunded row — review r8), or a
      // refund that found no payment and now has one, is worked again whatever the ledger
      // says about the event.
      if (!(await workStillOwed(sb, outcome, prior))) return { result: "duplicate", locationId: ctx.locationId };
      if (outcome.kind === "refunded" && prior === "payment_not_found") reopened = "payment_not_found";
    }
  }
  // WHICH DELIVERY INSERTED THE LEDGER ROW IS DELIBERATELY NOT REMEMBERED (review r6). Round
  // r5 passed it down as "this is a redelivery, so resume the cleanup" — and the delivery
  // that HAD inserted the row then stamped an overlapping delivery's unfinished settlement
  // as done. Whether cleanup is owed is read from the payment row (see the header).

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

  // THE STAMP COMES LAST (see the header). Everything a settlement has to do and to say —
  // the cleanup, its marker, the report — happened inside `dispatch`, so a delivery cut off
  // here has lost nothing: its redelivery finds the marker and is stamped `already_advanced`.
  // A `settlement_incomplete` result is stamped too — it is a retryable ledger state, and the
  // route answers it 500 (review r7). A refund that the gate re-opened and that this run
  // APPLIED replaces its old `payment_not_found`; nothing else replaces a terminal verdict.
  const applied = result === "refunded" || result === "partially_refunded";
  await finalizeEvent(sb, outcome.eventId, result, resolvedLocation, reopened && applied ? reopened : null);
  return { result, locationId: resolvedLocation };
}

async function dispatch(
  sb: ServiceClient,
  outcome: CheckoutEventOutcome,
  ctx: StripeWebhookContext,
  deps: StripeWebhookDeps,
): Promise<Dispatched> {
  if (outcome.kind === "ignored") return { result: "ignored", locationId: null };

  if (outcome.kind === "refunded") return refund(sb, outcome, ctx);

  const payment = await findPaymentForSession(sb, outcome);
  if (!payment) return { result: "payment_not_found", locationId: null };

  const quote = await quoteOfPayment(sb, payment.quote_id);
  const locationId = quote?.location_id ?? null;

  // PER-LOCATION MODE ONLY: an event signed by one shop's account may not touch another
  // shop's money. Single-account mode has no such assertion to make — one account serves
  // every shop by design — so `ctx.locationId` is null and this check does not run.
  if (ctx.locationId && locationId !== ctx.locationId) {
    return { result: "location_mismatch", locationId };
  }

  if (outcome.kind === "async_failed") {
    // STRIPE'S OWN WORD THAT A DELAYED PAYMENT FAILED (review r5 — see the header). The
    // session is `complete` and can never be expired, so until now its id stayed on the row
    // and every later pay tap answered 409 `payment_in_progress`, for good. The failure is
    // the end of that attempt: its id is cleared, exactly as an expiry's is.
    //
    // GUARDED ON THE EXACT SESSION THE EVENT NAMES, and on the row still being `due` or
    // `void`. A failure event can arrive late, twice, or after the customer has already been
    // given another checkout — it must never clear a session it is not about. A `paid` /
    // `refunded` row's id is history and is not touched. The intent's status and amount are
    // never written here: a due row stays due.
    let sessionCleared = false;
    if (outcome.sessionId) {
      const { data: clearedRows, error: clearErr } = await sb
        .from("catering_payments")
        .update({ provider_session_id: null })
        .eq("id", payment.id)
        .in("status", ["due", "void"])
        .eq("provider_session_id", outcome.sessionId)
        .select("id")
        .returns<Array<{ id: string }>>();
      if (clearErr) throw new Error(`stripe async-failed clear session: ${clearErr.message}`);
      sessionCleared = (clearedRows ?? []).length > 0;
    }
    // The failed attempt is RECORDED: which intent, which session, whether that session was
    // still the row's (false = the row had already moved on — nothing was cleared).
    void audit({
      actorId: null,
      actorRole: null,
      action: "catering.payment.provider_payment_failed",
      resourceTable: "catering_payments",
      resourceId: payment.id,
      metadata: {
        actor_context: "stripe_webhook",
        quote_id: payment.quote_id,
        kind: payment.kind,
        amount_cents: payment.amount_cents,
        row_status: payment.status,
        session_id: outcome.sessionId ?? null,
        session_cleared: sessionCleared,
        payment_intent_id: outcome.paymentIntentId ?? null,
        stripe_event_id: outcome.eventId,
        livemode: outcome.livemode,
        location_id: locationId,
        location_code: ctx.locationCode,
      },
      ipAddress: null,
      userAgent: null,
    });
    return { result: "async_failed", locationId };
  }
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

  if (flipped) {
    // THE ROW IS PAID. From here to the return NOTHING MAY THROW (see the header).
    return settle(sb, {
      payment,
      quote,
      locationId,
      outcome,
      ctx,
      deps,
      notify,
      row: flipped,
      settledAtMs,
      wasVoid: payment.status === "void",
      resumed: false,
      rowStatus: "paid",
    });
  }

  // The row was already paid or refunded. WHO got there first decides what this is, so the
  // row is re-read (the pre-read may predate a concurrent delivery of this very charge) —
  // with its settlement marker (migration 0303; a database without that column fails this
  // read, the event is `processing_failed`, and Stripe delivers it again).
  // THE RESUME GATE (review r8). What follows asks ONE question of the row — "is the marker
  // NULL?" — and never "is it still `paid`?". The money status only says which statuses a
  // settlement can have left behind (`settlementRecorded`: paid, or refunded since).
  const { data: fresh, error: freshErr } = await sb
    .from("catering_payments")
    .select(`${PAYMENT_COLS}, provider, provider_session_id, settlement_cleanup_at`)
    .eq("id", payment.id)
    .maybeSingle<PaymentRow & { provider: string | null; provider_session_id: string | null; settlement_cleanup_at: string | null }>();
  if (freshErr) throw new Error(`stripe mark paid re-read: ${freshErr.message}`);
  const sameCharge =
    outcome.paymentIntentId != null && fresh?.provider_ref != null && fresh.provider_ref === outcome.paymentIntentId;
  if (sameCharge && fresh) {
    // THIS CHARGE IS ALREADY ON THE ROW. Whether that means "finished" is the ROW's own
    // recorded fact — never an inference from which delivery this is (review r6 — see the
    // header), and never an inference from its MONEY STATUS either (review r8):
    //   · MARKER SET: the settlement's cleanup is recorded as done. Nothing to do, quietly.
    //   · MARKER NULL: whoever flipped the row has not finished — it is still working, it
    //     was cut off, or it could not confirm everything closed. THIS delivery runs the
    //     settlement again, from the row as it is now, whatever delivery or event it is. The
    //     steps are idempotent, so running beside the other run changes nothing twice.
    //   · …AND THAT HOLDS FOR A ROW THAT HAS SINCE BEEN REFUNDED. Round r7 said "a row that
    //     is no longer `paid` has no order to tidy" and answered `already_advanced` — over an
    //     intent this settlement had voided and a checkout it had not managed to retire. A
    //     refund gives one charge back; it closes nothing. The settlement runs again and the
    //     row STAYS refunded: nothing in it writes the money status of a settled row (the
    //     flip is guarded on due / void, a refund on `paid`, the marker write names no status).
    if (settlementRecorded(fresh.status) && fresh.settlement_cleanup_at == null) {
      return settle(sb, {
        payment: { ...payment, kind: fresh.kind, amount_cents: fresh.amount_cents, status: fresh.status },
        quote,
        locationId,
        outcome,
        ctx,
        deps,
        notify,
        row: { id: fresh.id, quote_id: fresh.quote_id, provider_session_id: fresh.provider_session_id ?? null },
        settledAtMs,
        // The flip overwrote the status it found; a later run cannot know (see the header).
        wasVoid: null,
        resumed: true,
        rowStatus: fresh.status,
      });
    }
    return { result: "already_advanced", locationId };
  }

  // A DIFFERENT settlement got there first — staff marked it paid by hand, or it was paid
  // and refunded — and now Stripe has taken money for it as well. There is no row to flip,
  // and saying `already_advanced` would bury a charge nobody has recorded. Say it loudly —
  // and BEFORE the event is stamped, by every delivery that finds it: a finding is never
  // what a cut-off loses. Nothing below throws.
  const reasons: PaymentReviewReason[] = ["already_settled"];
  // …AND IF THAT EARLIER SETTLEMENT'S CLEANUP IS NOT RECORDED AS DONE, THIS DELIVERY RUNS IT
  // (review r6: whoever finds cleanup owed runs it). The usual way to get here is a hand mark
  // that was cut off after its flip: the hosted pages stayed payable, and the customer has
  // just paid one of them. The order's OTHER pages are closed now, not left for a third
  // charge. The row's own session is closed too unless it is the one this money came through.
  // Owed by the MARKER, whatever the money status (review r8): a row that was paid and has
  // since been refunded owes the same cleanup while its marker is NULL.
  let closed: ClosedCheckouts | null = null;
  if (fresh && settlementRecorded(fresh.status) && fresh.settlement_cleanup_at == null) {
    closed = await closeQuoteCheckouts(sb, {
      quoteId: fresh.quote_id,
      locationId,
      settledPaymentId: fresh.id,
      settledSessionId: fresh.provider_session_id ?? null,
      paidThroughSessionId: outcome.sessionId ?? null,
      retire: deps.retireSession,
    });
    if (closed.stillOpen.length > 0) reasons.push("sibling_checkout_open");
  }
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
      // Present only when this delivery ran the earlier settlement's unrecorded cleanup.
      ...(closed ? { closed_checkouts: closed } : {}),
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
  // THIS DELIVERY TOOK ON THAT CLEANUP, SO IT ANSWERS FOR IT (review r7). Checkouts it could
  // not confirm closed are still payable pages on an order that has now been paid twice:
  // `settlement_incomplete`, so Stripe sends this event again and the next delivery tries
  // again (and tells again — a finding is told at least once).
  if (closed && !settlementCleanupComplete(closed)) return { result: "settlement_incomplete", locationId };
  // A HAND settlement's cleanup has nothing more to it than those checkouts: recorded as done
  // when the pass left none open. A CARD settlement's has (its sibling void, its own report),
  // and its own event finishes it — so its marker is left for that event to find NULL.
  if (closed && fresh?.provider === "manual") {
    // A marker write that FAILED leaves the cleanup unrecorded: tried again, like any other.
    if ((await markSettlementCleanupDone(sb, fresh.id)) === "failed") return { result: "settlement_incomplete", locationId };
  }
  return { result: "paid_needs_review", locationId };
}

/**
 * THE REASONS THAT NAME UNFINISHED WORK ON THE ORDER, as opposed to a judgement of the
 * payment (review r8). They are the only ones told about a payment that has since been
 * refunded in full: an intent that could not be closed and a checkout that could not be
 * confirmed closed are still open whatever happened to this charge.
 */
const UNFINISHED_WORK_REASONS: ReadonlySet<PaymentReviewReason> = new Set<PaymentReviewReason>([
  "sibling_check_failed",
  "sibling_checkout_open",
]);

interface SettleInput {
  /** The payment as this delivery READ it (its `quote_id` is the revision it was read on). */
  payment: PaymentRow;
  /** The quote of that read. Re-read here when the row turns out to be on another revision. */
  quote: QuoteContext | null;
  locationId: string | null;
  outcome: CheckoutEventOutcome;
  ctx: StripeWebhookContext;
  deps: StripeWebhookDeps;
  notify: (args: NotifyPaidArgs) => Promise<void>;
  /** WHERE THE PAID ROW IS NOW and the session it names: what the flip returned, or — for a
   *  run that did not flip it — the re-read that showed this charge already on the row. */
  row: { id: string; quote_id: string; provider_session_id: string | null };
  settledAtMs: number;
  /** Was the intent `void` when it was paid? Null = this run did not flip it and cannot know. */
  wasVoid: boolean | null;
  /** True when ANOTHER run flipped the row and this one found its cleanup not recorded as
   *  done (review r5 / r6): a redelivery, an overlapping delivery, another event. */
  resumed: boolean;
  /** THE ROW'S MONEY STATUS AS THIS RUN FOUND IT (review r8): `paid` for the run that flipped
   *  it; for a run that did not, what the re-read said — `paid`, or `refunded` since. It
   *  decides what is SAID about the payment, never whether the cleanup runs. */
  rowStatus: string;
}

/**
 * EVERYTHING A SETTLEMENT DOES AFTER ITS ROW IS PAID: judge the order, void its other
 * deposit / full intent, close its other checkouts, tell people, and record the cleanup as
 * done on the payment row when — and only when — it is. Run by the delivery that flipped the
 * row and, identically, by ANY delivery that finds the charge on the row with its marker
 * still NULL (see the header). NEVER THROWS. Every write in it is idempotent.
 *
 * ── ON A ROW THAT HAS SINCE BEEN REFUNDED (review r8) ────────────────────────────────
 * The CLEANUP is the same, step for step — the other deposit / full intent voided, the
 * order's other checkouts closed, the marker written — because it is owed by the marker,
 * not by the money status, and the order must end where "settled, then refunded" would have
 * left it. It never writes this row's money status. What differs is only what is SAID:
 *   · THE PAYMENT IS NOT JUDGED AGAIN. Its amount, its timing, "another payment is already
 *     paid" are questions about money on the books, and this money was given back whole. A
 *     run that finds the row refunded tells a person only what is still OPEN on the order
 *     (`UNFINISHED_WORK_REASONS`) — and the email says the payment was refunded.
 *   · NO REFUND IS LOOKED FOR. A refund is applied to a `paid` row; there is none left here.
 *   · NO ORDINARY "PAYMENT RECEIVED". When nothing is open, the audit row is written
 *     (`row_status: "refunded"`, `resumed: true`, what was voided and closed) and nobody is
 *     mailed that a payment arrived which is no longer on the books.
 */
async function settle(sb: ServiceClient, input: SettleInput): Promise<Dispatched> {
  const { outcome, ctx, deps, locationId, row } = input;
  let quote = input.quote;
  const reasons: PaymentReviewReason[] = [];
  /** Is the money still on the books? False = refunded in full since (see the doc above). */
  const onTheBooks = input.rowStatus === "paid";
  // WHERE THE PAYMENT IS NOW (review r4). If a revise moved it between the read and the
  // flip, the order is judged as it stands on the revision the row is on — its price, its
  // deadline, whether it is still open — not on the one that was read.
  const readOnQuoteId = input.payment.quote_id;
  const moved = row.quote_id !== readOnQuoteId;
  const payment: PaymentRow = { ...input.payment, quote_id: row.quote_id };
  if (moved) {
    try {
      const now = await quoteOfPayment(sb, row.quote_id);
      if (!now) throw new Error("the revision the payment is on could not be found");
      quote = now;
    } catch (e) {
      console.error(`[stripe webhook] could not re-read the quote of ${payment.id} after a revise:`, e instanceof Error ? e.message : e);
      reasons.push("quote_recheck_failed");
    }
  }
  if (input.wasVoid === true) reasons.push("intent_was_void");
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
  const settledLate = quote != null && quoteTimeExpired(quote.status ?? "", quote.expires_at, input.settledAtMs);
  if (settledLate) reasons.push("paid_after_expiry");
  const siblings = await reviewSiblings(sb, payment);
  reasons.push(...siblings.reasons);
  // CLOSE WHAT CAN NO LONGER BE COLLECTED (review r3 — see the header). After the siblings
  // are voided, so a checkout attached a moment ago is found on a row this payment closed.
  // Never throws; what it could not confirm closed — or could not finish looking for — is a
  // reason for a person to look. It works from what the FLIP returned (review r4): the
  // session this row names is closed too unless it is the very session that was just paid.
  const closed: ClosedCheckouts = await closeQuoteCheckouts(sb, {
    quoteId: row.quote_id,
    locationId,
    settledPaymentId: payment.id,
    settledSessionId: row.provider_session_id ?? null,
    paidThroughSessionId: outcome.sessionId ?? null,
    retire: deps.retireSession,
  });
  if (closed.stillOpen.length > 0) reasons.push("sibling_checkout_open");
  // WAS THIS CHARGE ALREADY REFUNDED, AS FAR AS STRIPE HAS TOLD US? (review r6 — see
  // `refundsSeenFirst`.) Looked for now, told with everything else below, applied after that.
  // Not on a row that is already refunded (review r8): a refund moves a `paid` row, so there
  // is nothing left for one to be applied to.
  const earlierRefunds = onTheBooks
    ? await refundsSeenFirst(sb, outcome.paymentIntentId)
    : { events: [] as EarlierRefund[], failed: false, truncated: false };
  if (earlierRefunds.events.length > 0) reasons.push("refund_seen_first");
  if (earlierRefunds.failed || earlierRefunds.truncated) reasons.push("refund_check_failed");
  // A REFUNDED PAYMENT IS NOT JUDGED AGAIN (review r8 — see the doc above). Everything above
  // RAN — the sibling void and the checkout cleanup are the work this run is here for — but
  // of what it found, only what is still OPEN is told. Every other reason is a judgement of
  // money that was given back.
  if (!onTheBooks) {
    const open = reasons.filter((r) => UNFINISHED_WORK_REASONS.has(r));
    reasons.length = 0;
    reasons.push(...open);
  }

  const settledAt = new Date(input.settledAtMs).toISOString();
  const report = async (): Promise<void> => {
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
        // Present only when ANOTHER run flipped the row and this one found its cleanup not
        // recorded as done (review r5 / r6). `voided_sibling_ids` and `closed_checkouts`
        // below are then what THIS run did, and `needs_review` cannot include
        // `intent_was_void` (the flip overwrote the status it found).
        ...(input.resumed ? { resumed: true } : {}),
        // Present only when this run found the row no longer `paid` (review r8: refunded in
        // full since). It finished that settlement's cleanup; `needs_review` then names only
        // what is still open, and no "payment received" was mailed for it.
        ...(onTheBooks ? {} : { row_status: input.rowStatus }),
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
        // Present only when Stripe reported a refund of this charge before this payment was
        // recorded (review r6): the `charge.refunded` events now being applied to it.
        ...(earlierRefunds.events.length > 0 ? { refunds_seen_first: earlierRefunds.events.map((e) => e.eventId) } : {}),
      },
      ipAddress: null,
      userAgent: null,
    });

    // NO "PAYMENT RECEIVED" ABOUT A PAYMENT THAT WAS GIVEN BACK (review r8). The audit row
    // above is the record of what this run finished; a mail goes only when something is
    // still open, and then it says the payment was refunded.
    if (!onTheBooks && reasons.length === 0) return;
    // BEST-EFFORT, ALWAYS. A mail failure must never fail a webhook: the money has landed
    // and the row says so; the email is how a human hears about it sooner.
    try {
      await input.notify({
        paymentId: payment.id,
        quoteId: payment.quote_id,
        locationId,
        kind: payment.kind,
        amountCents: payment.amount_cents,
        reviewReasons: reasons,
        ...(onTheBooks ? {} : { refunded: true }),
      });
    } catch (e) {
      console.error(`[stripe webhook] paid-notify failed for ${payment.id}:`, e instanceof Error ? e.message : e);
    }
  };

  // THE REPORT AND THE MARKER (review r6 — see the header).
  const needsReview = reasons.length > 0;
  // A finding is told BEFORE anything says the settlement is finished, by every run that
  // finds it: if this run dies here, the marker is still NULL and the next one tells it again.
  if (needsReview) await report();
  // …and only THEN is a refund that was seen first applied (it can move the row to
  // `refunded`, after which no later run JUDGES this payment again — it only finishes the
  // cleanup, review r8 — so the finding had to be told first). Oldest first; each is the live
  // path's own `refund`.
  let refundsApplied = true;
  for (const earlier of earlierRefunds.events) {
    if (!(await applyEarlierRefund(sb, earlier, ctx))) refundsApplied = false;
  }
  // Is there NOTHING left for a later run? The order's other payments were read and every
  // sibling void landed, no checkout is still open / unlooked-at, and every refund Stripe
  // had already reported was looked for and applied. A reason that is only a JUDGEMENT of
  // the payment (its amount, its timing, a second payment) does not hold the cleanup open:
  // it was told above, and there is nothing a later run could do about it. Neither does a
  // look for earlier refunds that came back FULL (`truncated` — review r7): it was told, and
  // a later run would read the same page.
  const cleanupComplete = siblings.complete && settlementCleanupComplete(closed) && !earlierRefunds.failed && refundsApplied;
  // The marker: one compare-and-set, only over a cleanup that is complete. `lost` = another
  // run recorded it first (that run is the one that reports an ordinary payment). A row that
  // is no longer `paid` — a refund seen first has just been applied, or it was refunded before
  // this run began — takes the marker like any other (review r8): the cleanup it records was
  // done, and a row left NULL is a row some later delivery would have to work again.
  const mark = cleanupComplete ? await markSettlementCleanupDone(sb, payment.id) : null;
  // An ordinary payment is reported by the ONE run whose marker write landed (review r7: a
  // write that FAILED no longer reports — the redelivery it now causes does, when its own
  // write lands, so the team is still told once and not twice).
  if (!needsReview && mark === "won") await report();

  // THE ANSWER (review r7 — see the header). Until the row itself says nothing is owed, this
  // event is NOT finished: `settlement_incomplete`, which the route answers 500, so Stripe
  // sends the SAME event again and it runs this function again from the row as it then is.
  // The money was recorded above and is not in question; every write here is a guarded
  // compare-and-set, so the next run repeats none of them.
  if (mark !== "won" && mark !== "lost") return { result: "settlement_incomplete", locationId };
  return { result: needsReview ? "paid_needs_review" : "paid", locationId };
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
/** PostgREST / Postgres naming a missing column: 0333 (refunded_at, refunded_amount_cents) not applied yet. */
function refundColumnsMissing(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST204" || error.code === "42703";
}

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
    // Guarded on the row as it was read (review r5): still `paid`, and still carrying THIS
    // charge. The row was found by `provider_ref`, so the write is bound to the same fact —
    // a refund can only ever move the payment whose money it gives back. Not bound to a
    // revision on purpose: a refund is about a charge, and a paid row keeps its charge
    // wherever a revise carries it.
    //
    // WHEN and HOW MUCH (W26/B140, migration 0333): the flip stamps `refunded_at` — the event's own
    // `created`, never later than now (the `paid_at` rule) — and the charge's cumulative
    // `amount_refunded`, so the daily catering digest reports the refund on the day it happened.
    // Until 0333 is applied the columns do not exist: the SAME guarded flip is repeated with the
    // status alone (exactly the pre-0333 write), never skipped.
    const nowMs = Date.now();
    const refundedAt = new Date(outcome.createdSec != null ? Math.min(outcome.createdSec * 1000, nowMs) : nowMs).toISOString();
    let flip: { status: "refunded"; refunded_at?: string; refunded_amount_cents?: number | null } = {
      status: "refunded",
      refunded_at: refundedAt,
      refunded_amount_cents: outcome.amountCents ?? null,
    };
    for (;;) {
      const { error, count } = await sb
        .from("catering_payments")
        .update(flip, { count: "exact" })
        .eq("id", payment.id)
        .eq("status", "paid")
        .eq("provider_ref", outcome.paymentIntentId);
      if (error && "refunded_at" in flip && refundColumnsMissing(error)) {
        flip = { status: "refunded" };
        continue;
      }
      if (error) throw new Error(`stripe refund update: ${error.message}`);
      if (count === 0) return { result: "no_paid_row", locationId };
      break;
    }
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
 *
 * `refunded: true` (review r8) — a later run finished the settlement of a payment that has
 * since been refunded in full, and something on the order is STILL OPEN. Same person, same
 * channel; the subject and the first line say the payment was refunded, so nobody reads
 * "payment received" about money that is no longer on the books. It is only ever sent with
 * reasons (an ordinary notice is never sent about a refunded payment).
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
  refund_seen_first:
    "Stripe reported a refund of this charge before the payment itself was recorded here (the two notices arrived out of order). That refund has now been applied to this payment: check its status against the charge in Stripe.",
  refund_check_failed:
    "We could not check whether Stripe had already reported a refund of this charge. Look the charge up in Stripe and make sure this payment's status matches it.",
  quote_recheck_failed:
    "This order was revised while the payment was landing, and we could not re-read the new revision. Check the amount paid against what the current quote asks for.",
  sibling_checkout_open:
    "An online checkout for this order could not be confirmed closed, so the customer may still be able to pay it. Expire the order's checkout sessions in the Stripe dashboard and check this order for a second charge.",
};

/** The last line of a review notice about a payment that has since been refunded (review r8). */
const REFUNDED_CLOSING = "The refund was made in Stripe. What is listed above is still open on the order.";
/** …and its lead-in: the payment is settled history; the ORDER is what still needs the look. */
const REFUNDED_LEAD = "This order still needs a look:";

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
  const refunded = args.refunded === true;
  const subject = refunded
    ? `${TENANT_NAME}: ${money} ${args.kind} payment (since refunded) — NEEDS REVIEW`
    : `${TENANT_NAME}: ${money} ${args.kind} payment received${flagged ? " — NEEDS REVIEW" : ""}`;
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
      <p style="margin:16px 0 8px;"><strong>${refunded ? REFUNDED_LEAD : "This payment needs a review:"}</strong></p>
      <ul style="margin:0 0 0 18px;padding:0;">${reasons.map((r) => `<li>${escapeHtml(REVIEW_SENTENCE[r])}</li>`).join("")}</ul>
      <p style="margin:12px 0 0;">${refunded ? REFUNDED_CLOSING : "Nothing was refunded automatically."}</p>`
    : "";
  const reviewText = flagged
    ? `\n\n${refunded ? REFUNDED_LEAD : "This payment needs a review:"}\n${reasons.map((r) => `- ${REVIEW_SENTENCE[r]}`).join("\n")}\n${refunded ? REFUNDED_CLOSING : "Nothing was refunded automatically."}`
    : "";
  const bodyHtml = refunded
    ? `
      <p style="margin:0 0 16px;">A customer paid a <strong>${escapeHtml(args.kind)}</strong> of <strong>${escapeHtml(money)}</strong> for the event on <strong>${escapeHtml(dateLabel)}</strong>, and that payment has since been <strong>refunded in full</strong>.</p>
      <p style="margin:0;">Quote <code>${escapeHtml(args.quoteId)}</code> — the payment and its refund are recorded in CO-OPS.</p>${reviewHtml}
    `
    : `
      <p style="margin:0 0 16px;">A customer just paid a <strong>${escapeHtml(args.kind)}</strong> of <strong>${escapeHtml(money)}</strong> for the event on <strong>${escapeHtml(dateLabel)}</strong>.</p>
      <p style="margin:0;">Quote <code>${escapeHtml(args.quoteId)}</code> — the payment is recorded in CO-OPS.</p>${reviewHtml}
    `;
  const text = refunded
    ? `${money} ${args.kind} payment for the event on ${dateLabel} has since been refunded in full. Quote ${args.quoteId}: the payment and its refund are recorded in CO-OPS.${reviewText}${link ? `\n\n${link}` : ""}`
    : `${money} ${args.kind} payment received for the event on ${dateLabel}. Quote ${args.quoteId} is recorded in CO-OPS.${reviewText}${link ? `\n\n${link}` : ""}`;

  await sendEmail({
    to: user.email,
    from: teamFrom(),
    subject,
    html: link
      ? renderEmailLayout({
          preheader: subject,
          heading: refunded ? "Refunded payment — needs review" : flagged ? "Payment received — needs review" : "Payment received",
          bodyHtml,
          cta: { label: "OPEN THE PIPELINE", url: link },
          footerNote: "Sent automatically when the payment provider confirmed the charge.",
        })
      : `<p>${text.replace(/\n/g, "<br>")}</p>`,
    text,
  });
}
