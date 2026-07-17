/**
 * Portal order-submission engine — Portal-3 (the self-serve customer order path).
 *
 * SERVER-ONLY. Service-role writes; the authorization boundary is the customer
 * principal at the route layer (requireCustomerSession → customerId) — no staff
 * AuthContext exists here.
 *
 * STRICT SERVER-SIDE PRICE AUTHORITY (D20) — the load-bearing property:
 * the client submits item/package REFERENCES + quantities only. Every line's unit
 * price is resolved from the real menu (items.menu_price via loadPublicCateringMenu,
 * catering_packages.price_cents via loadPublicCateringPackages). A client-supplied
 * price is never read; a line referencing nothing (or an unknown id) is rejected.
 * With 0 menu rows in prod today, no cart can resolve — the engine is correctly
 * DORMANT until the menu/pricing data lands (proven via the seeded smoke).
 *
 * One coherent flow: throttle → load customer → resolve+price lines → charge stack
 * (computeChargeStack, same math as staff quotes) → insert pipeline lead
 * (lead_source='portal') → 'submitted' quote (origin='self_serve', full charge-stack
 * snapshot so later pricing changes never alter this order's math) → quote items →
 * catering_payments deposit 'due' row (self-serve plan is deposit-REQUIRED, amount =
 * the stack's snapshotted depositCents) → allowlist-gated confirmation email
 * (best-effort, never throws) → audit.
 *
 * Write ordering: lead → quote → items → payment. Every write checks `error`
 * (Supabase swallows). If a later step fails we throw — a partial lead without a
 * quote is a benign orphan staff can clean up; the customer retries. Acceptable v1.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { renderOrderConfirmationEmail } from "@/lib/email-templates/order-confirmation";
import { computeChargeStack, lineTotalCents } from "@/lib/catering/quotes";
import type { ChargeRates, ChargeStack } from "@/lib/catering/quotes";
import { createPaymentDue } from "@/lib/catering/payments";
import { loadPublicCateringMenu, loadPublicCateringPackages, loadPublicPricingContext } from "./menu";
import { checkAndRecord } from "./rate-limit";

const DEFAULT_EXPIRY_DAYS = 14; // D22 — same validity window as staff quotes

/** A canonical UUID (any version) — reject malformed location ids before they hit the DB. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PortalOrderError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "PortalOrderError";
  }
}

export interface SubmitLineInput {
  itemId?: string | null;
  packageId?: string | null;
  quantity: number;
  notes?: string | null;
}
export interface SubmitOrderInput {
  locationId: string;
  eventDate?: string | null;
  headcount?: number | null;
  isDelivery?: boolean;
  deliveryZoneId?: string | null;
  contactName: string;
  company?: string | null;
  notes?: string | null;
  lines: SubmitLineInput[];
}
export interface SubmitOrderResult {
  pipelineId: string;
  quoteId: string;
  paymentId: string;
  depositCents: number;
  totalCents: number;
}

/** Allowlist gate — mirrors lib/portal/magic-link.ts (not exported there; kept local). */
function allowlisted(email: string): boolean {
  const raw = process.env.PORTAL_MAGIC_LINK_ALLOWLIST ?? "juan@complimentsonlysubs.com";
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

function defaultExpiry(): string {
  return new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** Snapshot column shape — EXACTLY what quotes.ts snapshotColumns writes (rates + stack + delivery). */
function snapshotColumns(rates: ChargeRates, stack: ChargeStack, isDelivery: boolean, deliveryZoneId: string | null) {
  return {
    is_delivery: isDelivery,
    delivery_zone_id: deliveryZoneId,
    subtotal_cents: stack.subtotalCents,
    delivery_fee_cents: stack.deliveryFeeCents,
    service_charge_cents: stack.serviceChargeCents,
    gratuity_cents: stack.gratuityCents,
    tax_cents: stack.taxCents,
    total_cents: stack.totalCents,
    deposit_cents: stack.depositCents,
    tax_rate_bps: rates.taxRateBps,
    gratuity_bps: rates.gratuityBps,
    service_charge_bps: rates.serviceChargeBps,
    deposit_pct_bps: rates.depositPctBps,
    tax_on_delivery: rates.taxOnDelivery,
    tax_on_gratuity: rates.taxOnGratuity,
  };
}

/** A line whose price has been resolved from the SERVER-owned menu — never from input. */
interface ResolvedLine {
  itemId: string | null;
  packageId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  displayOrder: number;
}

function eventDateLabel(eventDate: string | null): string {
  if (!eventDate) return "your event";
  const t = Date.parse(`${eventDate}T00:00:00`);
  if (Number.isNaN(t)) return "your event";
  return new Date(t).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function centsToUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Submit a self-serve customer order: server-priced lead + 'submitted' quote +
 * deposit-due payment intent. `customerId` comes from the verified customer session
 * (Portal-2) — never from the request body.
 */
export async function submitOrder(customerId: string, input: SubmitOrderInput): Promise<SubmitOrderResult> {
  // 1 — shape validation. FAIL FAST before any DB insert — these all previously reached the DB
  // and 500'd (some after the lead insert = a stranded lead). A bad payload is a 400, no writes.
  if (!input.locationId || typeof input.locationId !== "string") {
    throw new PortalOrderError(400, "invalid_payload", "locationId is required");
  }
  if (!UUID_RE.test(input.locationId)) {
    throw new PortalOrderError(400, "invalid_location", "locationId must be a valid id");
  }
  if (!input.contactName || input.contactName.trim().length === 0) {
    throw new PortalOrderError(400, "invalid_payload", "contactName is required");
  }
  if (input.headcount != null && (!Number.isFinite(Number(input.headcount)) || Number(input.headcount) < 0)) {
    throw new PortalOrderError(400, "invalid_headcount", "headcount must be zero or greater");
  }
  if (input.eventDate != null && Number.isNaN(Date.parse(input.eventDate))) {
    throw new PortalOrderError(400, "invalid_event_date", "eventDate must be a valid YYYY-MM-DD date");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new PortalOrderError(400, "invalid_payload", "An order needs at least one line");
  }
  input.lines.forEach((l, i) => {
    const quantity = Number(l.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new PortalOrderError(400, "invalid_line", `Line ${i + 1}: quantity must be > 0`);
    }
  });

  // 2 — throttle (fixed window: 5 submissions / 15 min per customer).
  const allowed = await checkAndRecord(`order_submit:${customerId}`, 15 * 60, 5);
  if (!allowed) {
    throw new PortalOrderError(429, "rate_limited", "Too many order submissions — try again later");
  }

  // 3 — the owning customer must exist and be active.
  const sb = getServiceRoleClient();
  const { data: customer, error: cErr } = await sb
    .from("catering_customers")
    .select("id, name, email, active")
    .eq("id", customerId)
    .maybeSingle<{ id: string; name: string | null; email: string | null; active: boolean }>();
  if (cErr) throw new Error(`submitOrder customer: ${cErr.message}`);
  if (!customer || customer.active === false) {
    throw new PortalOrderError(404, "not_found", "Customer not found");
  }

  // 4 — SERVER PRICE AUTHORITY (D20): resolve + price every line from the real menu.
  // The input carries references + quantities ONLY; prices come from the lookup maps.
  const [menuItems, packages] = await Promise.all([
    loadPublicCateringMenu(),
    loadPublicCateringPackages(input.locationId),
  ]);
  const itemById = new Map(menuItems.map((m) => [m.id, m] as const));
  const packageById = new Map(packages.map((p) => [p.id, p] as const));

  const resolved: ResolvedLine[] = input.lines.map((l, i) => {
    const quantity = Number(l.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new PortalOrderError(400, "invalid_line", `Line ${i + 1}: quantity must be > 0`);
    }
    const itemId = l.itemId ?? null;
    const packageId = l.packageId ?? null;
    if (itemId != null && itemId !== "") {
      const item = itemById.get(itemId);
      if (!item) throw new PortalOrderError(400, "invalid_line", `Line ${i + 1}: unknown menu item`);
      const unitPriceCents = item.unitPriceCents; // server-owned price — NEVER from input
      return {
        itemId,
        packageId: null,
        description: item.name,
        quantity,
        unitPriceCents,
        lineTotalCents: lineTotalCents(quantity, unitPriceCents),
        displayOrder: i,
      };
    }
    if (packageId != null && packageId !== "") {
      const pkg = packageById.get(packageId);
      if (!pkg) throw new PortalOrderError(400, "invalid_line", `Line ${i + 1}: unknown package`);
      const unitPriceCents = pkg.priceCents; // server-owned price — NEVER from input
      return {
        itemId: null,
        packageId,
        description: pkg.labelEn,
        quantity,
        unitPriceCents,
        lineTotalCents: lineTotalCents(quantity, unitPriceCents),
        displayOrder: i,
      };
    }
    throw new PortalOrderError(400, "invalid_line", `Line ${i + 1}: needs an item or package reference`);
  });
  // Dormant-until-data guard: nothing resolvable ⇒ no order (with 0 menu rows this
  // engine can never produce a quote). Belt-and-suspenders after the per-line rejects.
  if (resolved.length === 0) {
    throw new PortalOrderError(400, "empty_cart", "Nothing in the cart could be resolved");
  }

  // 5 — pricing context + delivery fee + the one authoritative charge stack.
  const pricing = await loadPublicPricingContext(input.locationId);
  const isDelivery = input.isDelivery ?? false;
  const deliveryZoneId = input.deliveryZoneId ?? null;
  let deliveryFeeCents = 0;
  if (isDelivery && deliveryZoneId != null) {
    const zone = pricing.zones.find((z) => z.id === deliveryZoneId);
    if (!zone) throw new PortalOrderError(400, "invalid_payload", "Delivery zone not found for this location");
    deliveryFeeCents = zone.feeCents;
  }
  const stack = computeChargeStack(resolved.map((l) => l.lineTotalCents), deliveryFeeCents, pricing.rates);

  // 6 — pipeline lead (source='portal') + its initial append-only stage event.
  // created_by / actor_id are FKs → users(id); the customer principal is not a user ⇒ null.
  const { data: lead, error: leadErr } = await sb
    .from("catering_pipeline")
    .insert({
      contact_name: input.contactName.trim(),
      company: input.company ?? null,
      event_date: input.eventDate ?? null,
      headcount: input.headcount ?? null,
      stage: "inquiry",
      lead_source: "portal",
      location_id: input.locationId,
      customer_id: customerId,
      estimated_revenue_cents: stack.totalCents,
      created_by: null,
    })
    .select("id")
    .single<{ id: string }>();
  if (leadErr) throw new Error(`submitOrder lead: ${leadErr.message}`);

  const { error: evErr } = await sb.from("catering_pipeline_events").insert({
    pipeline_id: lead.id,
    from_stage: null,
    to_stage: "inquiry",
    note: null,
    actor_id: null,
  });
  if (evErr) throw new Error(`submitOrder lead event: ${evErr.message}`);

  // 7 — the 'submitted' quote: full charge-stack + rates snapshot (immutable money math).
  const { data: quote, error: qErr } = await sb
    .from("catering_quotes")
    .insert({
      root_id: null,
      version: 1,
      pipeline_id: lead.id,
      customer_id: customerId,
      location_id: input.locationId,
      status: "submitted",
      origin: "self_serve",
      event_date: input.eventDate ?? null,
      headcount: input.headcount ?? null,
      ...snapshotColumns(pricing.rates, stack, isDelivery, deliveryZoneId),
      expires_at: defaultExpiry(),
      notes: input.notes ?? null,
      created_by: null,
    })
    .select("id")
    .single<{ id: string }>();
  if (qErr) throw new Error(`submitOrder quote: ${qErr.message}`);

  const { error: itemsErr } = await sb.from("catering_quote_items").insert(
    resolved.map((l) => ({
      quote_id: quote.id,
      item_id: l.itemId,
      menu_item_id: null,
      package_id: l.packageId,
      description: l.description,
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
      line_total_cents: l.lineTotalCents,
      display_order: l.displayOrder,
      created_by: null, // FK → users(id); no staff actor on the portal path
    })),
  );
  if (itemsErr) throw new Error(`submitOrder items: ${itemsErr.message}`);

  // 8 — the deposit-due payment intent. Self-serve plan is deposit-REQUIRED
  // (lib/catering/payment-plan.ts): the amount is the stack's snapshotted depositCents.
  const { id: paymentId } = await createPaymentDue(sb, {
    quoteId: quote.id,
    customerId,
    kind: "deposit",
    amountCents: stack.depositCents,
    createdBy: customerId,
  });

  // 9 — best-effort confirmation email (allowlist-gated until Resend DNS verifies).
  // Never throws: sendEmail's contract is never-throw; the whole block is also guarded.
  try {
    if (customer.email && allowlisted(customer.email) && process.env.NEXT_PUBLIC_APP_URL) {
      const name = customer.name ?? customer.email;
      const dateLabel = eventDateLabel(input.eventDate ?? null);
      await sendEmail({
        to: customer.email,
        subject: "We got your catering order — Compliments Only",
        html: renderOrderConfirmationEmail({
          name,
          eventDateLabel: dateLabel,
          totalCents: stack.totalCents,
          depositCents: stack.depositCents,
        }),
        text:
          `Hi ${name},\n\nWe received your catering order for ${dateLabel}. ` +
          `Estimated total: ${centsToUsd(stack.totalCents)}. A ${centsToUsd(stack.depositCents)} deposit reserves the date.\n\n` +
          `We'll confirm within about 24 hours. If we're not able to do your date, your deposit is refunded in full.`,
      });
    }
  } catch (err) {
    console.error("[portal orders] confirmation email failed:", err instanceof Error ? err.message : String(err));
  }

  // 10 — audit (no staff actor; the customer id lives in metadata).
  void audit({
    actorId: null,
    actorRole: null,
    action: "catering.order.submit",
    resourceTable: "catering_quotes",
    resourceId: quote.id,
    metadata: {
      pipeline_id: lead.id,
      customer_id: customerId,
      total_cents: stack.totalCents,
      deposit_cents: stack.depositCents,
      lines: resolved.length,
    },
    ipAddress: null,
    userAgent: null,
  });

  return {
    pipelineId: lead.id,
    quoteId: quote.id,
    paymentId,
    depositCents: stack.depositCents,
    totalCents: stack.totalCents,
  };
}
