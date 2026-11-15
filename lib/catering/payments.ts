/**
 * Catering payments — the provider-agnostic payment seam (Portal-3, D3).
 *
 * SERVER-ONLY. Service-role reads/writes; authorization is APP-LAYER (requireLevel +
 * lockLocationContext), consistent with lib/catering/quotes.ts and lib/cash.ts.
 *
 * `catering_payments` is ONE row per payment intent with a status a future provider
 * (Stripe / Toast / other TBD) or a staff "mark paid" action advances. It is deliberately
 * NOT the full D19 settlement ledger — it is the wire-in point that lets the order-submission
 * flow record a deposit `due` today and a real provider replace the manual advance later.
 *
 *   createPaymentDue — the insert helper the customer submit flow calls (service-role;
 *     no staff actor exists for a customer-initiated payment intent).
 *   markPaymentPaid  — the staff seam-advance STUB: flips a `due` row to `paid`
 *     (guarded, so a concurrent/already-advanced row is a no-op → conflict), sets
 *     paid_at + provider='manual'. A real provider webhook replaces this.
 *   loadPaymentsForQuote — staff read of a quote's payment intents.
 *
 * The table has no location column, so location-gated actions load the owning quote's
 * location_id via the quote_id FK and gate on THAT (mirrors the quote's own location gate).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, isAllLocationsAccess } from "@/lib/locations";
import { audit } from "@/lib/audit";
import { closeQuoteCheckouts } from "@/lib/catering/payment-sessions";
import type { AuthContext } from "@/lib/session";

export const PAYMENT_READ_MIN = 5; // shift_lead+ may view a quote's payment intents
export const PAYMENT_WRITE_MIN = 6; // catering_mgr+ may mark a payment paid

export type PaymentKind = "deposit" | "balance" | "full";
export type PaymentStatus = "due" | "paid" | "refunded" | "void";

export class CateringPaymentError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "CateringPaymentError";
  }
}

export interface Payment {
  id: string;
  quoteId: string;
  customerId: string | null;
  kind: PaymentKind;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  provider: string | null;
  providerRef: string | null;
  createdAt: string;
  paidAt: string | null;
  createdBy: string | null;
}

interface DbPaymentRow {
  id: string;
  quote_id: string;
  customer_id: string | null;
  kind: string;
  amount_cents: number;
  currency: string;
  status: string;
  provider: string | null;
  provider_ref: string | null;
  created_at: string;
  paid_at: string | null;
  created_by: string | null;
}

const PAYMENT_COLS =
  "id, quote_id, customer_id, kind, amount_cents, currency, status, provider, provider_ref, created_at, paid_at, created_by";

function isPaymentKind(v: string): v is PaymentKind {
  return v === "deposit" || v === "balance" || v === "full";
}
function isPaymentStatus(v: string): v is PaymentStatus {
  return v === "due" || v === "paid" || v === "refunded" || v === "void";
}
function mapPayment(r: DbPaymentRow): Payment {
  return {
    id: r.id,
    quoteId: r.quote_id,
    customerId: r.customer_id,
    kind: isPaymentKind(r.kind) ? r.kind : "deposit",
    amountCents: r.amount_cents,
    currency: r.currency,
    status: isPaymentStatus(r.status) ? r.status : "due",
    provider: r.provider,
    providerRef: r.provider_ref,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    createdBy: r.created_by,
  };
}

// ── App-layer authorization (mirrors lib/catering/quotes.ts) ────────────────────
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new CateringPaymentError(403, "forbidden", "Insufficient role level");
  }
}
function locActor(actor: AuthContext): { role: AuthContext["user"]["role"]; locations: string[] } {
  return { role: actor.user.role, locations: actor.locations };
}
function assertCanWrite(actor: AuthContext, locationId: string): void {
  requireLevel(actor, PAYMENT_WRITE_MIN);
  if (!lockLocationContext(locActor(actor), locationId)) {
    throw new CateringPaymentError(403, "location_access_denied", "You do not manage that location");
  }
}
/** Read-scope location visibility (all-locations override for L7+, else assignment list). */
function canSeeLocation(actor: AuthContext, locationId: string): boolean {
  return isAllLocationsAccess(locActor(actor)) || actor.locations.includes(locationId);
}

/** Load the location_id of the quote that owns a payment (the location the payment gates on). */
async function loadPaymentQuoteContext(
  sb: ReturnType<typeof getServiceRoleClient>,
  paymentId: string,
  /** When set, the payment MUST belong to this quote (URL/body coherence on the
   *  money route — adversarial review cosmetic; the location gate remains the
   *  security authority). Mismatch → the same IDOR-safe 404. */
  expectedQuoteId?: string,
): Promise<{ status: string; locationId: string; quoteId: string }> {
  const { data: pay, error } = await sb
    .from("catering_payments")
    .select("id, status, quote_id")
    .eq("id", paymentId)
    .maybeSingle<{ id: string; status: string; quote_id: string }>();
  if (error) throw new Error(`loadPaymentQuoteContext payment: ${error.message}`);
  if (!pay) throw new CateringPaymentError(404, "not_found", "Payment not found");
  if (expectedQuoteId !== undefined && pay.quote_id !== expectedQuoteId) {
    throw new CateringPaymentError(404, "not_found", "Payment not found");
  }

  const { data: quote, error: qErr } = await sb
    .from("catering_quotes")
    .select("id, location_id")
    .eq("id", pay.quote_id)
    .maybeSingle<{ id: string; location_id: string }>();
  if (qErr) throw new Error(`loadPaymentQuoteContext quote: ${qErr.message}`);
  if (!quote) throw new CateringPaymentError(404, "not_found", "Payment's quote not found");

  return { status: pay.status, locationId: quote.location_id, quoteId: pay.quote_id };
}

// ── Writes ──────────────────────────────────────────────────────────────────────
export interface CreatePaymentDueInput {
  quoteId: string;
  customerId: string | null;
  kind: PaymentKind;
  amountCents: number;
  /** customer_id for portal-created intents; a user id for staff-created intents. */
  createdBy: string | null;
}

/**
 * Bring a still-`due` intent to the amount that is owed NOW. Guarded on `status = 'due'`:
 * returns false when the row was advanced in the meantime (the silent-UPDATE law — the
 * caller decides what a lost race means). THROWS on a write error.
 *
 * WHY THIS EXISTS (audit W02/B038). One due intent per (quote, kind) is the DB's rule
 * (0130), so an intent is REUSED rather than re-created — and it was reused at the amount
 * it was born with. A deposit intent raised at $150 was still $150 after the order grew to
 * a $200 deposit, and $150 is what the customer was sent to pay. The row's `amount_cents`
 * is the authority the webhook, the staff board and the reports all read, so the row is
 * what must move.
 *
 * ── NEVER UNDER AN OPEN CHECKOUT (review r1) ─────────────────────────────────────────
 * A due intent that points at a Checkout Session is priced by that session: the customer
 * can still pay it at the amount it was minted for. Re-pricing the row first is how $300
 * was captured on a row that said $200, and a $200 refund then read as a full one. So the
 * write is ALSO guarded on the session:
 *   · `retiredSessionId` null (the default): the row must hold NO session. A row that
 *     does is left exactly as it is and this returns false.
 *   · `retiredSessionId` set: the caller has ALREADY retired that session at Stripe. The
 *     row must still name it; the amount is written and the id cleared in the same UPDATE,
 *     so the row never says the new amount while pointing at the old checkout.
 *
 * ── AND ONLY ON THE REVISION THE AMOUNT WAS COMPUTED FROM (review r5) ────────────────
 * `amountCents` is a fact about ONE quote row: that revision's deposit, or its total. The
 * caller read it, then a manager's revise can land before this write: the carry
 * (payment-carry.ts) moves the intent to the new revision and prices it for THAT one. A
 * write guarded on `status` and the session alone still matched — the row was still due and
 * still held no session — and put the old revision's amount on the new revision's intent
 * ($200 over $300, which staff could then mark paid as the deposit). So the caller NAMES the
 * quote the amount came from (`quoteId`, required) and the write applies only while the
 * intent is still on it: the same compare-and-set every other write to a due intent makes.
 *
 * Returning false therefore means one of: not due any more; the row's checkout is not the
 * one you resolved; THE INTENT IS NO LONGER ON THE QUOTE YOU PRICED IT FOR. In every case
 * the row was left exactly as it is and the caller must not send anyone to pay.
 */
export async function syncDuePaymentAmount(
  sb: ReturnType<typeof getServiceRoleClient>,
  input: {
    paymentId: string;
    /** The quote row `amountCents` was computed from. The intent must still be on it. */
    quoteId: string;
    amountCents: number;
    /** See above. Omitted / null = the row must hold NO Checkout Session. */
    retiredSessionId?: string | null;
  },
): Promise<boolean> {
  const retiredSessionId = input.retiredSessionId ?? null;
  const base = sb
    .from("catering_payments")
    .update(
      retiredSessionId ? { amount_cents: input.amountCents, provider_session_id: null } : { amount_cents: input.amountCents },
      { count: "exact" },
    )
    .eq("id", input.paymentId)
    .eq("status", "due")
    .eq("quote_id", input.quoteId);
  const { error, count } = await (retiredSessionId
    ? base.eq("provider_session_id", retiredSessionId)
    : base.is("provider_session_id", null));
  if (error) throw new Error(`syncDuePaymentAmount: ${error.message}`);
  return (count ?? 0) > 0;
}

/**
 * Insert a single `status='due'` payment intent (service-role; no staff actor).
 * `sb` is a passed-in getServiceRoleClient() instance so the caller (the submit flow)
 * can order this write within its own lead→quote→items→payment sequence.
 *
 * IDEMPOTENT ON THE (quote, kind) DUE INTENT, AND THE AMOUNT IS PART OF THAT: when a due
 * intent already exists it is returned at the amount this call asked for, re-priced if it
 * had drifted (see `syncDuePaymentAmount`). ONE EXCEPTION: an existing intent that points at
 * an open Checkout Session is returned AS IT IS. Its amount is what that checkout charges,
 * and this helper has no way to retire one; the pay path retires it and re-prices before a
 * new checkout is offered (lib/portal/quotes.ts `initiatePayment`).
 */
export async function createPaymentDue(
  sb: ReturnType<typeof getServiceRoleClient>,
  input: CreatePaymentDueInput,
): Promise<{ id: string }> {
  const { data, error } = await sb
    .from("catering_payments")
    .insert({
      quote_id: input.quoteId,
      customer_id: input.customerId,
      kind: input.kind,
      amount_cents: input.amountCents,
      status: "due",
      created_by: input.createdBy,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    // A-M6: a live 'due' intent for (quote_id, kind) already exists (partial unique index
    // catering_payments_one_due) — idempotent: reuse it rather than erroring on the race.
    if (error.code === "23505") {
      const { data: existing } = await sb
        .from("catering_payments")
        .select("id, amount_cents, provider_session_id")
        .eq("quote_id", input.quoteId)
        .eq("kind", input.kind)
        .eq("status", "due")
        .limit(1)
        .maybeSingle<{ id: string; amount_cents: number; provider_session_id: string | null }>();
      if (existing) {
        if (existing.amount_cents !== input.amountCents && !existing.provider_session_id) {
          let repriced: boolean;
          try {
            // Bound to the quote this call was asked about (review r5): `existing` was read
            // on `input.quoteId`, and `input.amountCents` is that quote's amount.
            repriced = await syncDuePaymentAmount(sb, { paymentId: existing.id, quoteId: input.quoteId, amountCents: input.amountCents });
          } catch (e) {
            throw new Error(`createPaymentDue re-price: ${e instanceof Error ? e.message : String(e)}`);
          }
          // Advanced, given a checkout, or moved to another revision between the read and
          // the write: it is no longer this quote's due intent to reuse at this amount.
          if (!repriced) throw new Error("createPaymentDue re-price: the existing intent is no longer due on this quote");
        }
        return { id: existing.id };
      }
    }
    throw new Error(`createPaymentDue: ${error.message}`);
  }
  return { id: data.id };
}

/**
 * Staff seam-advance STUB: flip a `due` payment to `paid`. Level-gated (>=6) + location-gated
 * via the owning quote. The `.eq("status","due")` guard makes the flip idempotent-safe — a
 * count of 0 means the row was already advanced (or not `due`), surfaced as a 409. A real
 * provider webhook replaces this manual advance.
 *
 * ── …AND THE QUOTE'S OPEN CHECKOUTS ARE CLOSED (review r3) ───────────────────────────
 * A payment recorded by hand is a settlement like any other, and a hosted Checkout Session
 * left open beside it is a second charge waiting to happen: the intent's own (the customer
 * paid by phone with the card page still open in a tab), or the other option's (a
 * full-amount checkout open while the deposit is marked paid). After the flip both are
 * retired at Stripe and their ids cleared (`closeQuoteCheckouts`). BEST-EFFORT, and it
 * never fails the mark: a person received real money and the record must say so. What
 * could not be confirmed closed keeps its id on its row and is named on the audit row
 * (`closed_checkouts.stillOpen`); if the customer does pay it, the webhook records and
 * flags that charge. The other intent itself is NOT voided here — whether a hand-recorded
 * deposit leaves a `full` intent to be marked later is the team's call.
 *
 * ── THE FLIP IS A COMPARE-AND-SET ON THE ROW AS READ, AND IT RETURNS THE ROW (review r4) ─
 * A manager's revise can land between this function's read and its flip: the carry
 * (payment-carry.ts) moves the payment onto the new revision — possibly re-priced — and a
 * customer can open a checkout for it there. A flip guarded on `id` + `status` alone still
 * landed, and the cleanup then looked for checkouts on the revision that had been READ: the
 * payment was recorded paid, its own hosted page stayed payable, and the audit row said
 * nothing was open. So:
 *   · the flip is guarded on the revision the row was read on as well (the same rule every
 *     carry write follows: a write to a due intent applies only to the row as it was read).
 *     A payment that moved in between is REFUSED — 409 `not_current`, "this quote was revised
 *     elsewhere, reload" — and nothing is recorded: the person was looking at a revision,
 *     and an amount, that no longer exist;
 *   · the flip RETURNS the row it wrote. The checkout that row names is closed from that
 *     value, and the order's other checkouts are found across the family — neither depends
 *     on the earlier read (`closeQuoteCheckouts`, which also documents the order of
 *     operations and why no lock is added).
 */
export async function markPaymentPaid(
  actor: AuthContext,
  paymentId: string,
  expectedQuoteId?: string,
): Promise<void> {
  const sb = getServiceRoleClient();
  const { status, locationId, quoteId } = await loadPaymentQuoteContext(sb, paymentId, expectedQuoteId);
  assertCanWrite(actor, locationId);
  if (status !== "due") {
    throw new CateringPaymentError(409, "not_due", "Only a due payment can be marked paid");
  }

  const { data: flipped, error } = await sb
    .from("catering_payments")
    .update({ status: "paid", paid_at: new Date().toISOString(), provider: "manual" })
    .eq("id", paymentId)
    .eq("status", "due")
    .eq("quote_id", quoteId)
    .select("id, quote_id, provider_session_id")
    .returns<Array<{ id: string; quote_id: string; provider_session_id: string | null }>>();
  if (error) throw new Error(`markPaymentPaid update: ${error.message}`);
  const paid = flipped?.[0];
  if (!paid) {
    // Nothing was written. Which of the two things happened decides what the person is told.
    const { data: now, error: nowErr } = await sb
      .from("catering_payments")
      .select("id, status, quote_id")
      .eq("id", paymentId)
      .maybeSingle<{ id: string; status: string; quote_id: string }>();
    if (nowErr) throw new Error(`markPaymentPaid re-read: ${nowErr.message}`);
    if (now?.status === "due" && now.quote_id !== quoteId) {
      throw new CateringPaymentError(409, "not_current", "The quote was revised — reload it and mark the payment on the current revision");
    }
    throw new CateringPaymentError(409, "not_due", "Payment was concurrently advanced or is not due");
  }

  // The money is recorded. Close the checkouts that could still take it a second time
  // (see the header) — from what the flip returned, never from the read above. Never throws.
  const closed = await closeQuoteCheckouts(sb, {
    quoteId: paid.quote_id,
    locationId,
    settledPaymentId: paymentId,
    settledSessionId: paid.provider_session_id ?? null,
  });

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.payment.mark_paid",
    resourceTable: "catering_payments",
    resourceId: paymentId,
    metadata: { location_id: locationId, provider: "manual", closed_checkouts: closed },
    ipAddress: null,
    userAgent: null,
  });
}

// ── Reads ─────────────────────────────────────────────────────────────────────
/** All payment intents for a quote, most recent first. Staff read (>=5). */
export async function loadPaymentsForQuote(actor: AuthContext, quoteId: string): Promise<Payment[]> {
  requireLevel(actor, PAYMENT_READ_MIN);
  const sb = getServiceRoleClient();
  // Location gate: this table has no location column, so gate on the owning quote's location
  // (mirrors markPaymentPaid). A quote the actor can't see ⇒ 404, never leaked cross-location.
  const { data: quote, error: qErr } = await sb
    .from("catering_quotes")
    .select("id, location_id")
    .eq("id", quoteId)
    .maybeSingle<{ id: string; location_id: string }>();
  if (qErr) throw new Error(`loadPaymentsForQuote quote: ${qErr.message}`);
  if (!quote) throw new CateringPaymentError(404, "not_found", "Quote not found");
  if (!canSeeLocation(actor, quote.location_id)) {
    throw new CateringPaymentError(404, "not_found", "Quote not found");
  }
  const { data, error } = await sb
    .from("catering_payments")
    .select(PAYMENT_COLS)
    .eq("quote_id", quoteId)
    .order("created_at", { ascending: false })
    .returns<DbPaymentRow[]>();
  if (error) throw new Error(`loadPaymentsForQuote: ${error.message}`);
  return (data ?? []).map(mapPayment);
}
