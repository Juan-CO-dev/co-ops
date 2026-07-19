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
): Promise<{ status: string; locationId: string }> {
  const { data: pay, error } = await sb
    .from("catering_payments")
    .select("id, status, quote_id")
    .eq("id", paymentId)
    .maybeSingle<{ id: string; status: string; quote_id: string }>();
  if (error) throw new Error(`loadPaymentQuoteContext payment: ${error.message}`);
  if (!pay) throw new CateringPaymentError(404, "not_found", "Payment not found");

  const { data: quote, error: qErr } = await sb
    .from("catering_quotes")
    .select("id, location_id")
    .eq("id", pay.quote_id)
    .maybeSingle<{ id: string; location_id: string }>();
  if (qErr) throw new Error(`loadPaymentQuoteContext quote: ${qErr.message}`);
  if (!quote) throw new CateringPaymentError(404, "not_found", "Payment's quote not found");

  return { status: pay.status, locationId: quote.location_id };
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
 * Insert a single `status='due'` payment intent (service-role; no staff actor).
 * `sb` is a passed-in getServiceRoleClient() instance so the caller (the submit flow)
 * can order this write within its own lead→quote→items→payment sequence.
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
        .select("id")
        .eq("quote_id", input.quoteId)
        .eq("kind", input.kind)
        .eq("status", "due")
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (existing) return { id: existing.id };
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
 */
export async function markPaymentPaid(actor: AuthContext, paymentId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { status, locationId } = await loadPaymentQuoteContext(sb, paymentId);
  assertCanWrite(actor, locationId);
  if (status !== "due") {
    throw new CateringPaymentError(409, "not_due", "Only a due payment can be marked paid");
  }

  const { error, count } = await sb
    .from("catering_payments")
    .update(
      { status: "paid", paid_at: new Date().toISOString(), provider: "manual" },
      { count: "exact" },
    )
    .eq("id", paymentId)
    .eq("status", "due");
  if (error) throw new Error(`markPaymentPaid update: ${error.message}`);
  if (count === 0) {
    throw new CateringPaymentError(409, "not_due", "Payment was concurrently advanced or is not due");
  }

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.payment.mark_paid",
    resourceTable: "catering_payments",
    resourceId: paymentId,
    metadata: { location_id: locationId, provider: "manual" },
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
