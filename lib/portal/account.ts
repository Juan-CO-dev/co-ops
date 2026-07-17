/**
 * Customer portal account home — Portal-4 (the customer's "your orders" data layer).
 *
 * SERVER-ONLY. Service-role reads (the portal tables are deny-all to end-users), but the
 * AUTHORIZATION BOUNDARY is the `customer_id` scope, NOT RLS: every read is filtered to
 * `customer_id = customerId` (the caller's own session id), so another customer's orders are
 * never loaded or leaked. Mirrors the ownership discipline in lib/portal/quotes.ts.
 *
 * We show a customer their LIVE (non-superseded) quotes that have left 'draft' — a draft is a
 * staff-internal working revision and is never a customer-facing order. Each order carries its
 * `catering_payments` rows and a CUSTOMER-FACING status computed from (quote.status, payments):
 * the customer sees "reserve your date", "pending our confirmation", "balance due", "all set",
 * etc. — the staff status vocabulary (draft/submitted/sent/accepted/declined/expired) is
 * translated into what the customer should DO next.
 *
 * Row→Quote mapping reuses the lib/portal/quotes.ts shape (Quote type from lib/catering/quotes.ts).
 * Payment view type is imported from lib/catering/payments.ts.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import type { Quote, QuoteStatus } from "@/lib/catering/quotes";
import { isQuoteStatus } from "@/lib/catering/quotes";
import type { Payment, PaymentKind, PaymentStatus } from "@/lib/catering/payments";

// ── View types ──────────────────────────────────────────────────────────────────

export type QuoteOrigin = "self_serve" | "staff";

/**
 * The staff `Quote` shape + the `origin` the payment plan / customer copy is driven by
 * (`origin` is present on the row since migration 0127 but absent from the staff Quote type).
 * Mirrors lib/portal/quotes.ts `PortalQuoteDetail`'s "extend Quote with origin" pattern.
 */
export interface PortalQuote extends Quote {
  origin: QuoteOrigin;
}

/** A customer-facing status derived from (quote.status, its payments). `payable` gates the pay CTA. */
export interface CustomerStatus {
  key:
    | "declined"
    | "expired"
    | "paid"
    | "balance_due"
    | "pending"
    | "reserve"
    | "review";
  label: string;
  tone: "action" | "pending" | "success" | "muted";
  payable: boolean;
}

export interface CustomerOrder {
  quote: PortalQuote;
  payments: Payment[];
  status: CustomerStatus;
}

export interface CustomerAccount {
  customer: { name: string | null; email: string | null; company: string | null } | null;
  orders: CustomerOrder[];
}

// ── Row shapes ────────────────────────────────────────────────────────────────────

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

const QUOTE_COLS =
  "id, root_id, version, pipeline_id, customer_id, location_id, status, origin, event_date, headcount, is_delivery, delivery_zone_id, subtotal_cents, delivery_fee_cents, service_charge_cents, gratuity_cents, tax_cents, total_cents, deposit_cents, tax_rate_bps, gratuity_bps, service_charge_bps, deposit_pct_bps, tax_on_delivery, tax_on_gratuity, expires_at, notes, created_at, created_by, sent_at, sent_by, superseded_at";
const PAYMENT_COLS =
  "id, quote_id, customer_id, kind, amount_cents, currency, status, provider, provider_ref, created_at, paid_at, created_by";

function normalizeOrigin(v: string): QuoteOrigin {
  return v === "self_serve" ? "self_serve" : "staff";
}

function mapQuote(r: DbQuoteRow, now: number = Date.now()): PortalQuote {
  const status: QuoteStatus = isQuoteStatus(r.status) ? r.status : "draft";
  const isExpired = status === "sent" && r.expires_at != null && Date.parse(r.expires_at) < now;
  return {
    origin: normalizeOrigin(r.origin),
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

// ── Customer-facing status ────────────────────────────────────────────────────────

/**
 * Translate (quote.status, its payments, origin) into what the CUSTOMER should do next.
 * Rules are evaluated in order — the first match wins:
 *   1. declined            → not available (muted)
 *   2. expired             → expired (muted)
 *   3. fully paid          → all set (a paid `full`, OR a paid `deposit` AND a paid `balance`)
 *   4. accepted + not paid → team-confirmed, balance due (payable)
 *   5. deposit/full paid   → deposit taken, pending our confirmation (not yet accepted)
 *   6. otherwise           → self_serve: reserve your date; staff: review & pay (both payable)
 *
 * `origin` is read from `quote.origin` (PortalQuote carries it — the staff Quote type drops it).
 */
export function customerOrderStatus(quote: PortalQuote, payments: Payment[]): CustomerStatus {
  if (quote.status === "declined") {
    return { key: "declined", label: "Not available", tone: "muted", payable: false };
  }
  if (quote.status === "expired") {
    return { key: "expired", label: "Expired", tone: "muted", payable: false };
  }

  const paid = (k: PaymentKind): boolean =>
    payments.some((p) => p.kind === k && p.status === "paid");
  const fullyPaid = paid("full") || (paid("deposit") && paid("balance"));

  if (fullyPaid) {
    return { key: "paid", label: "All set 🎉", tone: "success", payable: false };
  }
  if (quote.status === "accepted") {
    // Team-confirmed and not fully paid — the balance is now due.
    return { key: "balance_due", label: "Confirmed — balance due", tone: "action", payable: true };
  }
  if (paid("deposit") || paid("full")) {
    // A deposit (or a full payment not yet reconciled to fully-paid) exists, but the team
    // hasn't confirmed the order yet.
    return {
      key: "pending",
      label: "Deposit paid — pending our confirmation",
      tone: "pending",
      payable: false,
    };
  }

  // Submitted / sent with nothing paid — the customer's next action is to pay.
  // A self-serve order reserves its date with a deposit; a staff-built quote is ready to review.
  if (quote.origin === "self_serve") {
    return { key: "reserve", label: "Reserve your date — pay the deposit", tone: "action", payable: true };
  }
  return { key: "review", label: "Quote ready — review & pay", tone: "action", payable: true };
}

// ── Loader ──────────────────────────────────────────────────────────────────────

/**
 * Load a customer's account home: their profile + their live, non-draft orders (most recent
 * first), each with its payment intents and a customer-facing status.
 *
 * The `customer_id` scope IS the authorization boundary — every quote/payment read is filtered
 * to this customer's own rows, so no other customer's data is ever loaded.
 */
export async function loadCustomerAccount(customerId: string): Promise<CustomerAccount> {
  const sb = getServiceRoleClient();

  // Customer profile (the caller's own row).
  const { data: custRow, error: custErr } = await sb
    .from("catering_customers")
    .select("name, email, company")
    .eq("id", customerId)
    .maybeSingle<{ name: string | null; email: string | null; company: string | null }>();
  if (custErr) throw new Error(`loadCustomerAccount customer: ${custErr.message}`);
  const customer = custRow
    ? { name: custRow.name, email: custRow.email, company: custRow.company }
    : null;

  // LIVE, non-draft quotes owned by this customer, most recent first.
  // `.eq("customer_id", customerId)` is the authorization boundary.
  const { data: quoteRows, error: qErr } = await sb
    .from("catering_quotes")
    .select(QUOTE_COLS)
    .eq("customer_id", customerId)
    .is("superseded_at", null)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .returns<DbQuoteRow[]>();
  if (qErr) throw new Error(`loadCustomerAccount quotes: ${qErr.message}`);
  const rows = quoteRows ?? [];

  if (rows.length === 0) {
    return { customer, orders: [] };
  }

  // Payments for exactly this customer's quotes, in one scoped read.
  // Scope on `quote_id IN (the customer's own quote ids)` — those ids were just proven to belong
  // to this customer (loaded under the `customer_id` filter above), so this is authorization-safe
  // AND catches staff-created intents (e.g. a `balance` row) that carry a NULL `customer_id`,
  // which a `.eq("customer_id", …)` filter would silently drop and corrupt the fully-paid check.
  const quoteIds = rows.map((r) => r.id);
  const { data: paymentRows, error: pErr } = await sb
    .from("catering_payments")
    .select(PAYMENT_COLS)
    .in("quote_id", quoteIds)
    .order("created_at", { ascending: false })
    .returns<DbPaymentRow[]>();
  if (pErr) throw new Error(`loadCustomerAccount payments: ${pErr.message}`);

  const paymentsByQuote = new Map<string, Payment[]>();
  for (const pr of paymentRows ?? []) {
    const mapped = mapPayment(pr);
    const list = paymentsByQuote.get(mapped.quoteId);
    if (list) list.push(mapped);
    else paymentsByQuote.set(mapped.quoteId, [mapped]);
  }

  const now = Date.now();
  const orders: CustomerOrder[] = rows.map((r) => {
    const quote = mapQuote(r, now); // carries `origin` (PortalQuote)
    const payments = paymentsByQuote.get(quote.id) ?? [];
    const status = customerOrderStatus(quote, payments);
    return { quote, payments, status };
  });

  return { customer, orders };
}
