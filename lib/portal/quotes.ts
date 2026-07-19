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
 * PAYMENT PROVIDER IS DEFERRED. `initiatePayment` only ensures a `catering_payments` deposit/full
 * intent exists in `status='due'` and audits the intent — no Stripe/Toast. It returns a stub.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { createPaymentDue } from "@/lib/catering/payments";
import { paymentPlan } from "@/lib/catering/payment-plan";
import type { Quote, QuoteItem, QuoteDetail } from "@/lib/catering/quotes";
import { isQuoteStatus } from "@/lib/catering/quotes";

/** 404-style error for the customer path (ownership failures surface as "not found"). */
export class PortalQuoteError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "PortalQuoteError";
  }
}

export type QuoteOrigin = "self_serve" | "staff";

/** QuoteDetail (shape reused) + the origin the payment plan is driven by. */
export interface PortalQuoteDetail extends QuoteDetail {
  origin: QuoteOrigin;
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

  const { data: itemRows, error: iErr } = await sb
    .from("catering_quote_items")
    .select(ITEM_COLS)
    .eq("quote_id", quoteId)
    .order("display_order", { ascending: true })
    .returns<DbItemRow[]>();
  if (iErr) throw new Error(`loadCustomerQuoteDetail items: ${iErr.message}`);

  return {
    quote: mapQuote(row),
    items: (itemRows ?? []).map(mapItem),
    origin: normalizeOrigin(row.origin),
  };
}

/**
 * Begin a payment for the customer's own quote. PAYMENT PROVIDER IS DEFERRED — this only
 * ensures a `catering_payments` intent exists for (quote, kind) in `status='due'` (the amount
 * is read from the quote's snapshot: deposit_cents for a deposit, total_cents for full) and
 * audits the intent. Returns a stub. Ownership is re-verified here — a quote the caller doesn't
 * own is a 404, never actionable.
 */
export async function initiatePayment(
  customerId: string,
  quoteId: string,
  kind: "deposit" | "full",
): Promise<{ ok: true; stub: true }> {
  const sb = getServiceRoleClient();
  const { data: row, error } = await sb
    .from("catering_quotes")
    .select("id, customer_id, origin, status, superseded_at, event_date, deposit_cents, total_cents")
    .eq("id", quoteId)
    .maybeSingle<{
      id: string;
      customer_id: string | null;
      origin: string;
      status: string;
      superseded_at: string | null;
      event_date: string | null;
      deposit_cents: number;
      total_cents: number;
    }>();
  if (error) throw new Error(`initiatePayment quote: ${error.message}`);
  // OWNERSHIP CHECK — the authorization boundary. Not owned (or missing) ⇒ 404, never actionable.
  if (!row || row.customer_id !== customerId) {
    throw new PortalQuoteError(404, "not_found", "Quote not found");
  }

  // PAYABILITY GATE — a superseded revision or a terminal quote (declined/expired) is not payable.
  if (row.superseded_at != null || row.status === "declined" || row.status === "expired") {
    throw new PortalQuoteError(409, "not_payable", "This quote can no longer be paid");
  }

  // PAYMENT-PLAN AUTHORITY — the requested kind must be an option the real money rules allow
  // for this quote (origin/lead-time/deposit-driven). This makes the stub enforce the same
  // authority a real provider will wire behind, so an invalid kind can never create an intent.
  const plan = paymentPlan({
    origin: normalizeOrigin(row.origin),
    eventDate: row.event_date,
    totalCents: row.total_cents,
    depositCents: row.deposit_cents,
  });
  if (!plan.options.some((o) => o.kind === kind)) {
    throw new PortalQuoteError(400, "invalid_payment_kind", "That payment option is not available for this quote");
  }

  const amountCents = kind === "deposit" ? row.deposit_cents : row.total_cents;

  // Idempotent-ish: reuse an existing due intent for this (quote, kind) — there is no unique
  // constraint on (quote_id, kind), so SELECT-then-INSERT rather than upsert. A benign race
  // (two taps) could create a second due row; acceptable for a deferred-provider stub.
  const { data: existing, error: exErr } = await sb
    .from("catering_payments")
    .select("id")
    .eq("quote_id", quoteId)
    .eq("kind", kind)
    .eq("status", "due")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (exErr) throw new Error(`initiatePayment existing: ${exErr.message}`);

  if (!existing) {
    await createPaymentDue(sb, {
      quoteId,
      customerId,
      kind,
      amountCents,
      createdBy: customerId,
    });
  }

  void audit({
    actorId: null,
    actorRole: null,
    action: "catering.order.pay_intent",
    resourceTable: "catering_quotes",
    resourceId: quoteId,
    metadata: { kind, amount_cents: amountCents, customer_id: customerId },
    ipAddress: null,
    userAgent: null,
  });

  return { ok: true, stub: true };
}
