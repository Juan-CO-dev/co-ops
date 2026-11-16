/**
 * Catering quotes data layer — Wave 1 slice 1E (the money surface).
 *
 * SERVER-ONLY. Service-role reads/writes; authorization is APP-LAYER (requireLevel +
 * lockLocationContext), consistent with lib/catering/pipeline.ts and lib/cash.ts.
 *
 * The quote is an APPEND-ONLY, VERSIONED priced document (D19 money discipline):
 *   - createQuote writes v1 (root_id NULL).
 *   - reviseQuote supersedes the current row (sets superseded_at) and inserts version+1
 *     sharing root_id. A revision recomputes against CURRENT pricing and resets to 'draft'.
 *   - The charge stack AND the bps rates used are SNAPSHOTTED onto the row at compute time,
 *     so a later pricing-rule change never retroactively alters a quote's math.
 *
 * The charge stack (D21) distinguishes gratuity from a service charge:
 *   - service charge = a mandatory house charge, ALWAYS in the tax base (the pricing KB has
 *     no tax_on_service_charge toggle — the common jurisdiction case).
 *   - gratuity = a tip; taxed only if tax_on_gratuity (default false).
 *   - delivery fee taxed per tax_on_delivery (default true).
 * All amounts are integer cents; all rates basis points. Totals are computed server-side
 * (never client-reduced — the GLOBAL server-side-SUM rule).
 */

import { portalOrigin } from "@/lib/portal/origin-shared";
import { acceptDeliveryRefusal } from "@/lib/portal/draft-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, isAllLocationsAccess } from "@/lib/locations";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { redactEmailAddresses } from "@/lib/email-redact";
import { escapeHtml } from "@/lib/email-templates/_layout";
import type { AuthContext } from "@/lib/session";
import { loadCateringReader } from "./ezcater-detail";
import { carryPaymentsToRevision, reconcileFamilyPayments, retireSessionFor, type CarryPaymentsResult } from "./payment-carry";
import { canReadCateringContact } from "./ezcater-detail-shared";
import { offerTakenUpInTime, quoteTimeExpired } from "@/lib/portal/payability-shared";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";
import { emailOrderUpdate, type OrderUpdateEmailOutcome } from "./order-update-email";
import { orderChanges } from "./order-update-email-shared";

export const QUOTE_READ_MIN = 5; // shift_lead+ may VIEW (a lead viewer sees its quote)
export const QUOTE_WRITE_MIN = 6; // catering_mgr+ may build/revise/send

const DEFAULT_EXPIRY_DAYS = 14; // D22 — a quote is valid for 14 days unless caller overrides

export const QUOTE_STATUSES = ["draft", "submitted", "sent", "accepted", "declined", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export function isQuoteStatus(v: unknown): v is QuoteStatus {
  return typeof v === "string" && (QUOTE_STATUSES as readonly string[]).includes(v);
}

export class CateringQuoteError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "CateringQuoteError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new CateringQuoteError(403, "forbidden", "Insufficient role level");
  }
}
function locActor(actor: AuthContext): { role: AuthContext["user"]["role"]; locations: string[] } {
  return { role: actor.user.role, locations: actor.locations };
}
function assertCanWrite(actor: AuthContext, locationId: string): void {
  requireLevel(actor, QUOTE_WRITE_MIN);
  if (!lockLocationContext(locActor(actor), locationId)) {
    throw new CateringQuoteError(403, "location_access_denied", "You do not manage that location");
  }
}
/** Read-scope `.or()` filter on location_id (actor's locations), or null for L9+. */
function readScopeOr(actor: AuthContext): string | null {
  if (isAllLocationsAccess(locActor(actor))) return null;
  const ids = actor.locations;
  // Quotes always carry a location; a user with no locations sees none. An empty IN list is
  // invalid PostgREST, so match against an impossible location id (zero rows) instead.
  return ids.length === 0
    ? "location_id.eq.00000000-0000-0000-0000-000000000000"
    : `location_id.in.(${ids.join(",")})`;
}
function canSeeLocation(actor: AuthContext, locationId: string): boolean {
  return isAllLocationsAccess(locActor(actor)) || actor.locations.includes(locationId);
}

// ── Charge stack (pure) — lives in quotes-shared.ts; re-exported for server consumers ──
import {
  computeChargeStack,
  lineTotalCents,
  type ChargeRates,
  type ChargeStack,
  reclassifyQuoteLineRefs,
  shouldLinkLead,
  mapQuoteParties,
  type QuoteParties,
  resolveQuoteLineKind,
  QUOTE_RESEND_MAX_DAYS,
} from "./quotes-shared";
import { isQuoteLineKind, type QuoteLineKind } from "./prep-demand-shared";
export { computeChargeStack, lineTotalCents, type ChargeRates, type ChargeStack, type QuoteParties };

// ── Pricing context ───────────────────────────────────────────────────────────
export interface DeliveryZone {
  id: string;
  slug: string;
  labelEn: string;
  labelEs: string | null;
  feeCents: number;
  minOrderCents: number | null;
}
export interface PricingContext {
  rates: ChargeRates;
  hasPricingRule: boolean;
  zones: DeliveryZone[];
}

interface DbPricingRow {
  tax_rate_bps: number;
  gratuity_bps: number;
  service_charge_bps: number;
  deposit_pct_bps: number;
  tax_on_delivery: boolean;
  tax_on_gratuity: boolean;
}

const ZERO_RATES: ChargeRates = {
  taxRateBps: 0,
  gratuityBps: 0,
  serviceChargeBps: 0,
  depositPctBps: 0,
  taxOnDelivery: true,
  taxOnGratuity: false,
};

/** Active pricing rule (or all-zero defaults) + active delivery zones for a location. */
export async function loadPricingContext(actor: AuthContext, locationId: string): Promise<PricingContext> {
  requireLevel(actor, QUOTE_READ_MIN);
  if (!canSeeLocation(actor, locationId)) {
    throw new CateringQuoteError(403, "location_access_denied", "You do not manage that location");
  }
  const sb = getServiceRoleClient();
  const [{ data: rule, error: rErr }, { data: zoneRows, error: zErr }] = await Promise.all([
    sb
      .from("catering_pricing_rules")
      .select("tax_rate_bps, gratuity_bps, service_charge_bps, deposit_pct_bps, tax_on_delivery, tax_on_gratuity")
      .eq("location_id", locationId)
      .eq("active", true)
      .maybeSingle<DbPricingRow>(),
    sb
      .from("catering_delivery_zones")
      .select("id, slug, label_en, label_es, fee_cents, min_order_cents")
      .eq("location_id", locationId)
      .eq("active", true)
      .order("display_order", { ascending: true })
      .returns<Array<{ id: string; slug: string; label_en: string; label_es: string | null; fee_cents: number; min_order_cents: number | null }>>(),
  ]);
  if (rErr) throw new Error(`loadPricingContext rule: ${rErr.message}`);
  if (zErr) throw new Error(`loadPricingContext zones: ${zErr.message}`);
  const rates: ChargeRates = rule
    ? {
        taxRateBps: rule.tax_rate_bps,
        gratuityBps: rule.gratuity_bps,
        serviceChargeBps: rule.service_charge_bps,
        depositPctBps: rule.deposit_pct_bps,
        taxOnDelivery: rule.tax_on_delivery,
        taxOnGratuity: rule.tax_on_gratuity,
      }
    : { ...ZERO_RATES };
  const zones: DeliveryZone[] = (zoneRows ?? []).map((z) => ({
    id: z.id,
    slug: z.slug,
    labelEn: z.label_en,
    labelEs: z.label_es,
    feeCents: z.fee_cents,
    minOrderCents: z.min_order_cents,
  }));
  return { rates, hasPricingRule: !!rule, zones };
}

// ── View types ────────────────────────────────────────────────────────────────
export interface QuoteItem {
  id: string;
  itemId: string | null;
  menuItemId: string | null;
  packageId: string | null;
  description: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  displayOrder: number;
  portion: "quarter" | "half" | "whole" | null;
  /** Migration 0251 — what part of a package the line is (NULL = a non-package line). */
  lineKind: QuoteLineKind | null;
  componentsListed: boolean | null;
}
export interface Quote {
  id: string;
  rootId: string | null;
  version: number;
  pipelineId: string | null;
  customerId: string | null;
  locationId: string;
  status: QuoteStatus;
  eventDate: string | null;
  headcount: number | null;
  isDelivery: boolean;
  deliveryZoneId: string | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceChargeCents: number;
  gratuityCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  taxRateBps: number;
  gratuityBps: number;
  serviceChargeBps: number;
  depositPctBps: number;
  taxOnDelivery: boolean;
  taxOnGratuity: boolean;
  expiresAt: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  sentAt: string | null;
  sentBy: string | null;
  supersededAt: string | null;
  /** Derived: a sent quote whose expiry has passed (not yet flipped to 'expired'). */
  isExpired: boolean;
}
export interface QuoteDetail {
  quote: Quote;
  items: QuoteItem[];
}

interface DbQuoteRow {
  id: string;
  root_id: string | null;
  version: number;
  pipeline_id: string | null;
  customer_id: string | null;
  location_id: string;
  status: string;
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

const QUOTE_COLS =
  "id, root_id, version, pipeline_id, customer_id, location_id, status, event_date, headcount, is_delivery, delivery_zone_id, subtotal_cents, delivery_fee_cents, service_charge_cents, gratuity_cents, tax_cents, total_cents, deposit_cents, tax_rate_bps, gratuity_bps, service_charge_bps, deposit_pct_bps, tax_on_delivery, tax_on_gratuity, expires_at, notes, created_at, created_by, sent_at, sent_by, superseded_at";
const ITEM_COLS =
  "id, item_id, menu_item_id, package_id, description, quantity, unit_price_cents, line_total_cents, display_order, portion, line_kind, components_listed";

function mapQuote(r: DbQuoteRow, now: number = Date.now()): Quote {
  const status: QuoteStatus = isQuoteStatus(r.status) ? r.status : "draft";
  const isExpired =
    status === "sent" && r.expires_at != null && Date.parse(r.expires_at) < now;
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
function mapItem(r: {
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
  line_kind?: string | null;
  components_listed?: boolean | null;
}): QuoteItem {
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

// ── Reads ───────────────────────────────────────────────────────────────────
/** All live (non-superseded) quotes the actor may view, most recent first. */
export async function loadQuoteBoard(actor: AuthContext): Promise<Quote[]> {
  requireLevel(actor, QUOTE_READ_MIN);
  const sb = getServiceRoleClient();
  let q = sb.from("catering_quotes").select(QUOTE_COLS).is("superseded_at", null);
  const scope = readScopeOr(actor);
  if (scope) q = q.or(scope);
  const { data, error } = await q.order("created_at", { ascending: false }).returns<DbQuoteRow[]>();
  if (error) throw new Error(`loadQuoteBoard: ${error.message}`);
  const now = Date.now();
  return (data ?? []).map((r) => mapQuote(r, now));
}

/** Live quotes for a pipeline lead (one per family), most recent first. */
export async function loadQuotesForLead(actor: AuthContext, pipelineId: string): Promise<Quote[]> {
  requireLevel(actor, QUOTE_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_quotes")
    .select(QUOTE_COLS)
    .eq("pipeline_id", pipelineId)
    .is("superseded_at", null)
    .order("created_at", { ascending: false })
    .returns<DbQuoteRow[]>();
  if (error) throw new Error(`loadQuotesForLead: ${error.message}`);
  const now = Date.now();
  return (data ?? []).filter((r) => canSeeLocation(actor, r.location_id)).map((r) => mapQuote(r, now));
}

/** One quote (any revision) + its line items. Null if not found / not visible. */
export async function loadQuote(actor: AuthContext, id: string): Promise<QuoteDetail | null> {
  requireLevel(actor, QUOTE_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: row, error } = await sb
    .from("catering_quotes")
    .select(QUOTE_COLS)
    .eq("id", id)
    .maybeSingle<DbQuoteRow>();
  if (error) throw new Error(`loadQuote: ${error.message}`);
  if (!row) return null;
  if (!canSeeLocation(actor, row.location_id)) return null;

  const { data: itemRows, error: iErr } = await sb
    .from("catering_quote_items")
    .select(ITEM_COLS)
    .eq("quote_id", id)
    .order("display_order", { ascending: true })
    .returns<Parameters<typeof mapItem>[0][]>();
  if (iErr) throw new Error(`loadQuote items: ${iErr.message}`);

  return { quote: mapQuote(row), items: (itemRows ?? []).map(mapItem) };
}

/**
 * Who a quote is for, for the staff quote page (B5 #35): the customer's name, company and
 * email and the linked lead's contact, company and event date.
 *
 * EACH SIDE IS AUTHORIZED ON ITS OWN (review P1). Passing loadQuote's gate proves the actor
 * may read the QUOTE's shop, not the customer's or the lead's: a quote at shop A can name a
 * customer homed at shop B (or a lead since transferred to B). Both sides go through the
 * catering contact policy (`canReadCateringContact`, fresh memberships, fail-closed): a
 * customer is shown only when it is global (no home shop) or homed at a shop the actor reads;
 * a lead only when it is global or at such a shop. Otherwise that side is omitted (null).
 * A failed side read degrades that side to null and is logged by error code only.
 */
export async function loadQuoteParties(
  actor: AuthContext,
  quote: Pick<Quote, "id" | "customerId" | "pipelineId">,
): Promise<QuoteParties> {
  if (!quote.customerId && !quote.pipelineId) return mapQuoteParties(null, null);
  const sb = getServiceRoleClient();
  const [reader, customer, lead] = await Promise.all([
    loadCateringReader(actor),
    quote.customerId
      ? sb
          .from("catering_customers")
          .select("id, name, company, email, primary_location_id")
          .eq("id", quote.customerId)
          .maybeSingle<{ id: string; name: string; company: string | null; email: string | null; primary_location_id: string | null }>()
      : Promise.resolve({ data: null, error: null }),
    quote.pipelineId
      ? sb
          .from("catering_pipeline")
          .select("id, contact_name, company, event_date, location_id")
          .eq("id", quote.pipelineId)
          .maybeSingle<{ id: string; contact_name: string; company: string | null; event_date: string | null; location_id: string | null }>()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (customer.error) console.error(`[catering] loadQuoteParties customer read failed for quote ${quote.id}: ${customer.error.code ?? "unknown"}`);
  if (lead.error) console.error(`[catering] loadQuoteParties lead read failed for quote ${quote.id}: ${lead.error.code ?? "unknown"}`);
  const c = !customer.error && customer.data && reader && canReadCateringContact(reader, customer.data.primary_location_id)
    ? customer.data : null;
  const l = !lead.error && lead.data && reader && canReadCateringContact(reader, lead.data.location_id)
    ? lead.data : null;
  // A client that exists but is not the viewer's to read (option b) is flagged, not shown.
  return mapQuoteParties(c, l, !customer.error && !!customer.data && c == null);
}

/**
 * Which customer a NEW quote may name (review P1 + Juan's option b, 2026-10-14):
 *   - one the actor may read (global, or homed at a shop the actor reads under the catering
 *     contact policy) and active; or
 *   - another shop's customer ATTACHED BY EMAIL: only when the server resolved it from the
 *     email the actor typed (`emailAttach`, never from a request body) and its saved email is
 *     that address. It may be deactivated (attached without reviving). Its contact data stays
 *     hidden on every read path.
 * Anything else — a raw `customerId` the actor cannot read (a crafted body), a missing or
 * deactivated one — is the SAME 400 `invalid_customer` (no existence oracle).
 */
async function assertQuoteCustomerAllowed(
  actor: AuthContext,
  customerId: string,
  emailAttach: { email: string } | null | undefined,
): Promise<void> {
  const sb = getServiceRoleClient();
  const [reader, { data, error }] = await Promise.all([
    loadCateringReader(actor),
    sb
      .from("catering_customers")
      .select("id, active, email, primary_location_id")
      .eq("id", customerId)
      .maybeSingle<{ id: string; active: boolean | null; email: string | null; primary_location_id: string | null }>(),
  ]);
  if (error) throw new Error(`quote customer check: ${error.message}`);
  if (!data || !reader) throw new CateringQuoteError(400, "invalid_customer", "That client is not available at this shop");
  if (canReadCateringContact(reader, data.primary_location_id)) {
    if (data.active === true || emailAttach) return; // a readable dormant row was revived by the resolver
    throw new CateringQuoteError(400, "invalid_customer", "That client is not available at this shop");
  }
  const typed = emailAttach?.email.trim().toLowerCase() ?? "";
  if (typed !== "" && (data.email ?? "").trim().toLowerCase() === typed) return;
  throw new CateringQuoteError(400, "invalid_customer", "That client is not available at this shop");
}

// ── Mutations ─────────────────────────────────────────────────────────────────
export interface QuoteLineInput {
  description?: string | null;
  itemId?: string | null;
  menuItemId?: string | null;
  packageId?: string | null;
  portion?: "quarter" | "half" | "whole" | null;
  quantity: number;
  unitPriceCents: number;
  displayOrder?: number;
  /** Migration 0251 — validated by resolveQuoteLineKind (unknown → 400). */
  lineKind?: unknown;
  componentsListed?: unknown;
}
export interface CreateQuoteInput {
  locationId: string;
  pipelineId?: string | null;
  customerId?: string | null;
  eventDate?: string | null;
  headcount?: number | null;
  isDelivery?: boolean;
  deliveryZoneId?: string | null;
  lines: QuoteLineInput[];
  notes?: string | null;
  expiresAt?: string | null;
  /**
   * SERVER-SET ONLY (the quotes POST route, after resolveOrCreateContact): the customer was
   * resolved from this typed email. Never read from a request body. It lets createQuote
   * attach another shop's customer by email (Juan, option b) while still refusing a raw
   * `customerId` the actor cannot read.
   */
  emailAttach?: { email: string } | null;
}

interface ResolvedLine {
  description: string | null;
  itemId: string | null;
  menuItemId: string | null;
  packageId: string | null;
  portion: "quarter" | "half" | "whole" | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  displayOrder: number;
  lineKind: QuoteLineKind | null;
  componentsListed: boolean | null;
}

/**
 * EVERY line check that can refuse a save, before anything stateful: the pure ones (quantity,
 * price, line kind — 409 `quote_lines_outdated` for a kind-less package line) and the catalog
 * reference read (400 `unknown_item` for an inactive or missing item / menu item). Read-only.
 * The quotes POST calls this BEFORE it resolves, creates or revives the customer, so a save
 * the lines will refuse changes nothing (Astra r4 + r5, BC-040/041). createQuote, reviseQuote
 * and previewQuote run the same checks again themselves.
 */
export async function preflightQuoteLines(lines: QuoteLineInput[]): Promise<void> {
  await verifyLineRefs(getServiceRoleClient(), resolveLines(lines));
}

/** Validate + freeze the line set (quantity>0, integer non-negative price, identified). */
function resolveLines(lines: QuoteLineInput[]): ResolvedLine[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new CateringQuoteError(400, "invalid_payload", "A quote needs at least one line");
  }
  return lines.map((l, i) => {
    const quantity = Number(l.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new CateringQuoteError(400, "invalid_payload", `Line ${i + 1}: quantity must be > 0`);
    }
    const unitPriceCents = Number(l.unitPriceCents);
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
      throw new CateringQuoteError(400, "invalid_payload", `Line ${i + 1}: unit price must be a non-negative integer (cents)`);
    }
    const itemId = l.itemId ?? null;
    const menuItemId = l.menuItemId ?? null;
    if (itemId != null && menuItemId != null) {
      throw new CateringQuoteError(400, "invalid_payload", `Line ${i + 1}: item and menu item are mutually exclusive`);
    }
    const description = l.description != null && l.description.trim().length > 0 ? l.description.trim() : null;
    if (description == null && itemId == null && menuItemId == null) {
      throw new CateringQuoteError(400, "invalid_payload", `Line ${i + 1}: needs a description or a menu reference`);
    }
    const packageId = l.packageId ?? null;
    const kind = resolveQuoteLineKind({ itemId, menuItemId, packageId, lineKind: l.lineKind, componentsListed: l.componentsListed });
    if (!kind.ok) {
      // A kind-less package line comes from a page loaded before the B7c deploy (or a client bug): never
      // guessed at — the manager reloads and the builder sends the kinds.
      if (kind.reason === "outdated") throw new CateringQuoteError(409, "quote_lines_outdated", `Line ${i + 1}: ${kind.message}`);
      throw new CateringQuoteError(400, "invalid_payload", `Line ${i + 1}: ${kind.message}`);
    }
    return {
      description,
      itemId,
      menuItemId,
      packageId,
      lineKind: kind.lineKind,
      componentsListed: kind.componentsListed,
      portion: l.portion ?? null,
      quantity,
      unitPriceCents,
      lineTotalCents: lineTotalCents(quantity, unitPriceCents),
      displayOrder: l.displayOrder ?? i,
    };
  });
}

/**
 * Put every line reference on the FK side it exists on, or refuse before any write.
 * `catering_quote_items.item_id` → items · `menu_item_id` → menu_items. The staff builder used to
 * send a menu item's id as `itemId` (fixed client-side in the same PR); a stale tab, a second
 * client, or a future regression would otherwise surface as an FK 500 AFTER the quote header is
 * inserted. One round trip for the ids the payload names; a reference on neither side names the
 * line as a 400 `unknown_item` instead of a raw constraint error.
 */
async function verifyLineRefs(sb: ReturnType<typeof getServiceRoleClient>, lines: ResolvedLine[]): Promise<ResolvedLine[]> {
  const ids = [...new Set(lines.flatMap((l) => [l.itemId, l.menuItemId].filter((v): v is string => v != null)))];
  if (ids.length === 0) return lines;
  const [items, menu] = await Promise.all([
    sb.from("items").select("id, location_id").in("id", ids).eq("active", true).returns<Array<{ id: string; location_id: string | null }>>(),
    sb.from("menu_items").select("id, location_id").in("id", ids).eq("active", true).returns<Array<{ id: string; location_id: string | null }>>(),
  ]);
  if (items.error) throw new Error(`verifyLineRefs items: ${items.error.message}`);
  if (menu.error) throw new Error(`verifyLineRefs menu_items: ${menu.error.message}`);
  // Catering is global-only, even for a quote at the entity's owning shop. Check both
  // FK sides before reclassification so a stale or crafted reference cannot bypass it.
  if ([...(items.data ?? []), ...(menu.data ?? [])].some(row => row.location_id != null)) {
    throw new CateringQuoteError(400, "catering_owned_item_refused", "Shop-only items must be shared before use in catering");
  }
  const r = reclassifyQuoteLineRefs(lines, {
    itemIds: new Set((items.data ?? []).map((x) => x.id)),
    menuItemIds: new Set((menu.data ?? []).map((x) => x.id)),
  });
  if (r.unknown.length > 0) {
    const u = r.unknown[0]!;
    throw new CateringQuoteError(400, "unknown_item", `Line ${u.index + 1}: ${u.field} ${u.id} is not a catalog item or a menu item`);
  }
  if (r.moved > 0) {
    console.warn(`[catering] verifyLineRefs: ${r.moved} line reference(s) were on the wrong side and were reclassified — a client is sending menu item ids as itemId (or vice versa)`);
  }
  return r.lines;
}

/** Resolve the delivery fee: 0 unless a zone (belonging to this active location) is chosen. */
async function resolveDeliveryFee(
  ctx: PricingContext,
  isDelivery: boolean,
  deliveryZoneId: string | null,
): Promise<number> {
  if (!isDelivery || deliveryZoneId == null) return 0;
  const zone = ctx.zones.find((z) => z.id === deliveryZoneId);
  if (!zone) throw new CateringQuoteError(400, "invalid_payload", "Delivery zone not found for this location");
  return zone.feeCents;
}

function defaultExpiry(): string {
  return new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

async function insertQuoteItems(
  sb: ReturnType<typeof getServiceRoleClient>,
  quoteId: string,
  lines: ResolvedLine[],
  actorId: string,
): Promise<void> {
  const { error } = await sb.from("catering_quote_items").insert(
    lines.map((l) => ({
      quote_id: quoteId,
      item_id: l.itemId,
      menu_item_id: l.menuItemId,
      package_id: l.packageId,
      description: l.description,
      portion: l.portion,
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
      line_total_cents: l.lineTotalCents,
      display_order: l.displayOrder,
      line_kind: l.lineKind,
      components_listed: l.componentsListed,
      created_by: actorId,
    })),
  );
  if (error) throw new Error(`insertQuoteItems: ${error.message}`);
}

/** Snapshot fields shared by create + revise (rates + computed stack + delivery). */
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

export interface QuotePreview {
  stack: ChargeStack;
  hasPricingRule: boolean;
  rates: ChargeRates;
  lineTotals: number[];
}

/**
 * Compute-only preview of the charge stack for a candidate line set — same validation +
 * math as createQuote, nothing persisted. The quote builder calls this as lines change so
 * the live breakdown is always the server's authoritative math (no client/server drift).
 */
export async function previewQuote(
  actor: AuthContext,
  input: { locationId: string; lines: QuoteLineInput[]; isDelivery?: boolean; deliveryZoneId?: string | null },
): Promise<QuotePreview> {
  if (!input.locationId) throw new CateringQuoteError(400, "invalid_payload", "locationId is required");
  assertCanWrite(actor, input.locationId);
  const lines = resolveLines(input.lines);
  const pricing = await loadPricingContext(actor, input.locationId);
  const deliveryFee = await resolveDeliveryFee(pricing, input.isDelivery ?? false, input.deliveryZoneId ?? null);
  const stack = computeChargeStack(lines.map((l) => l.lineTotalCents), deliveryFee, pricing.rates);
  return { stack, hasPricingRule: pricing.hasPricingRule, rates: pricing.rates, lineTotals: lines.map((l) => l.lineTotalCents) };
}

/** Coerce a JSON `lines` array into QuoteLineInput[] (shape only; resolveLines validates semantics). */
export function parseQuoteLinesFromBody(raw: unknown): QuoteLineInput[] {
  if (!Array.isArray(raw)) {
    throw new CateringQuoteError(400, "invalid_payload", "lines must be an array");
  }
  return raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      description: typeof o.description === "string" ? o.description : null,
      itemId: typeof o.itemId === "string" ? o.itemId : null,
      menuItemId: typeof o.menuItemId === "string" ? o.menuItemId : null,
      packageId: typeof o.packageId === "string" ? o.packageId : null,
      portion:
        o.portion === "quarter" || o.portion === "half" || o.portion === "whole"
          ? o.portion
          : null,
      quantity: Number(o.quantity),
      unitPriceCents: Number(o.unitPriceCents),
      displayOrder: typeof o.displayOrder === "number" ? o.displayOrder : undefined,
      lineKind: o.lineKind ?? null,
      componentsListed: o.componentsListed ?? null,
    };
  });
}

/**
 * Attach the quote's customer to its lead when the lead has none (B5 #34). The customer page
 * lists leads by `catering_pipeline.customer_id`, and a staff-typed lead never had one, so a
 * customer with a lead and a quote read "None yet".
 *
 * A SECOND WRITER ON `catering_pipeline`, kept narrow on purpose:
 *   - NULL-ONLY: the UPDATE is guarded `customer_id IS NULL`, so it never moves a lead from
 *     one customer to another (count 0 = someone linked it first; nothing to do).
 *   - LOCATION-BOUND: the UPDATE also matches the `location_id` that was authorized, so a
 *     transfer racing the write cannot let a shop-A actor change a shop-B lead.
 *   - Same scope as the lead-edit PATCH: the actor must be able to write the lead's shop, and
 *     the customer must be active and homed at no shop or one the actor holds.
 *   - Audited on the action the lead-edit PATCH already speaks (`catering.pipeline.edit`).
 *   - BEST-EFFORT: the quote is already committed. A failure here must not 500 the save (the
 *     manager would re-save and make a second quote); it is logged by id and error code only,
 *     never a contact value, and the next revise retries the link.
 *
 * Exported only so the behaviour spine can drive it directly; createQuote / reviseQuote are
 * its only callers.
 */
export async function linkLeadToCustomer(
  actor: AuthContext,
  args: { pipelineId: string | null; customerId: string | null; quoteId: string; context: "quote_create" | "quote_revise" },
): Promise<void> {
  if (!args.pipelineId || !args.customerId) return;
  try {
    const sb = getServiceRoleClient();
    const [{ data: lead, error: lErr }, { data: customer, error: cErr }] = await Promise.all([
      sb.from("catering_pipeline").select("id, customer_id, location_id").eq("id", args.pipelineId)
        .maybeSingle<{ id: string; customer_id: string | null; location_id: string | null }>(),
      sb.from("catering_customers").select("id, active, primary_location_id").eq("id", args.customerId)
        .maybeSingle<{ id: string; active: boolean; primary_location_id: string | null }>(),
    ]);
    if (lErr || cErr) throw new Error(`read failed: ${lErr?.code ?? cErr?.code ?? "unknown"}`);
    if (!lead || !customer) return;
    if (!shouldLinkLead({ pipelineId: lead.id, customerId: customer.id, leadCustomerId: lead.customer_id })) return;
    if (lead.location_id != null && !lockLocationContext(locActor(actor), lead.location_id)) return;
    if (!customer.active) return;
    if (customer.primary_location_id != null && !lockLocationContext(locActor(actor), customer.primary_location_id)) return;

    // Bind the write to the shop we AUTHORIZED (review P2): a transfer between the read and
    // this UPDATE changes location_id, the predicate stops matching, and nothing is written.
    let update = sb
      .from("catering_pipeline")
      .update({ customer_id: customer.id, updated_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", lead.id)
      .is("customer_id", null);
    update = lead.location_id == null ? update.is("location_id", null) : update.eq("location_id", lead.location_id);
    const { error: uErr, count } = await update;
    if (uErr) throw new Error(`update failed: ${uErr.code ?? "unknown"}`);
    // 0 rows = linked by someone else, or moved to another shop, in between. Leave it.
    if ((count ?? 0) === 0) return;

    void audit({
      actorId: actor.user.id,
      actorRole: actor.user.role,
      action: "catering.pipeline.edit",
      resourceTable: "catering_pipeline",
      resourceId: lead.id,
      metadata: { fields: ["customer_id"], context: args.context, quote_id: args.quoteId, customer_id: customer.id },
      ipAddress: null,
      userAgent: null,
    });
  } catch (e) {
    console.error(
      `[catering] could not link lead ${args.pipelineId} to the customer of quote ${args.quoteId} (${args.context}): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * A quote made FOR a lead is the lead's shop's quote (audit W05 / B011). 0225's insert trigger
 * (`catering_quotes_bind_location`) files a new quote under its lead's CURRENT shop whatever
 * `location_id` the insert carries — so authorizing and pricing at the body's `locationId` without
 * reading the lead let a quote be approved and priced under shop A's rules and land at shop B.
 * The quote's shop must therefore BE the lead's shop (a lead with no shop yet binds nothing).
 *
 * A lead id that names nothing gets the SAME answer as a lead at another shop: no existence oracle
 * (the stance `assertQuoteCustomerAllowed` takes for customers). Read-only.
 *
 * A transfer that commits between this read and the insert still moves the quote with its lead:
 * that is 0225's design ("bind outstanding obligations to its current shop"), identical to a quote
 * created a moment before the transfer.
 */
async function assertLeadAtQuoteShop(pipelineId: string | null | undefined, locationId: string): Promise<void> {
  if (!pipelineId) return;
  const { data: lead, error } = await getServiceRoleClient()
    .from("catering_pipeline")
    .select("id, location_id")
    .eq("id", pipelineId)
    .maybeSingle<{ id: string; location_id: string | null }>();
  if (error) throw new Error(`quote lead read failed: ${error.code ?? "unknown"}`);
  if (!lead || (lead.location_id != null && lead.location_id !== locationId)) {
    throw new CateringQuoteError(409, "lead_location_mismatch", "That lead belongs to another shop, or no longer exists");
  }
}

/**
 * The lead check that can refuse a NEW quote, before anything stateful: the actor may write the
 * quote's shop, and the lead (when there is one) is at that shop. The quotes POST calls this
 * BEFORE it resolves, creates or revives the customer, like `preflightQuoteLines`; createQuote
 * runs the same checks again itself.
 */
export async function preflightQuoteLead(
  actor: AuthContext,
  input: { locationId: string; pipelineId?: string | null },
): Promise<void> {
  assertCanWrite(actor, input.locationId);
  await assertLeadAtQuoteShop(input.pipelineId, input.locationId);
}

/** Create a draft quote (v1) — computes + freezes the charge stack, inserts header + lines. */
export async function createQuote(actor: AuthContext, input: CreateQuoteInput): Promise<{ id: string; version: number }> {
  const locationId = input.locationId;
  if (!locationId) throw new CateringQuoteError(400, "invalid_payload", "locationId is required");
  assertCanWrite(actor, locationId);
  // B011: the lead's shop IS the quote's shop — before pricing and before any write.
  await assertLeadAtQuoteShop(input.pipelineId, locationId);
  // Review P1 / option b: a quote names a customer the actor can read, or one attached by the
  // typed email (pre-existing gap: the route passed any body `customerId` through). Before any write.
  if (input.customerId) await assertQuoteCustomerAllowed(actor, input.customerId, input.emailAttach);

  const sb = getServiceRoleClient();
  const lines = await verifyLineRefs(sb, resolveLines(input.lines));
  const pricing = await loadPricingContext(actor, locationId);
  const isDelivery = input.isDelivery ?? false;
  const deliveryFee = await resolveDeliveryFee(pricing, isDelivery, input.deliveryZoneId ?? null);
  const stack = computeChargeStack(lines.map((l) => l.lineTotalCents), deliveryFee, pricing.rates);

  const { data: inserted, error } = await sb
    .from("catering_quotes")
    .insert({
      root_id: null,
      version: 1,
      pipeline_id: input.pipelineId ?? null,
      customer_id: input.customerId ?? null,
      location_id: locationId,
      status: "draft",
      event_date: input.eventDate ?? null,
      headcount: input.headcount ?? null,
      ...snapshotColumns(pricing.rates, stack, isDelivery, input.deliveryZoneId ?? null),
      expires_at: input.expiresAt ?? defaultExpiry(),
      notes: input.notes ?? null,
      created_by: actor.user.id,
    })
    .select("id, version")
    .single<{ id: string; version: number }>();
  if (error) throw new Error(`createQuote: ${error.message}`);

  try {
    await insertQuoteItems(sb, inserted.id, lines, actor.user.id);
  } catch (itemsErr) {
    // The header is live and EMPTY — a v1 draft with a non-zero snapshot total and no lines.
    // Unlike reviseQuote's strand B there is no prior revision to un-supersede, so retiring
    // the orphan is ONE compare-and-set write whose own failure leaves exactly today's state
    // (the orphan stands) — a repair that cannot produce a worse outcome than the fault.
    // Append-only: superseded, never deleted. The guide-walk sim (2026-09-08) made three of
    // these in a row from one mis-sided line reference.
    const msg = itemsErr instanceof Error ? itemsErr.message : String(itemsErr);
    const { error: supErr, count } = await sb
      .from("catering_quotes")
      .update({ superseded_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", inserted.id)
      .is("superseded_at", null);
    const retired = !supErr && (count ?? 0) === 1;
    if (!retired) {
      console.error(
        `[catering] createQuote could not retire empty draft ${inserted.id} after a failed line insert: ${supErr?.message ?? "no row matched"} — LIVE-CHECK: a live draft with total_cents > 0 and no catering_quote_items.`,
      );
    }
    await audit({
      actorId: actor.user.id,
      actorRole: actor.user.role,
      action: "catering.quote.create",
      resourceTable: "catering_quotes",
      resourceId: inserted.id,
      metadata: { outcome: "items_insert_failed", orphan_retired: retired, error: msg, location_id: locationId, lines: lines.length },
      ipAddress: null,
      userAgent: null,
    });
    throw itemsErr;
  }

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.quote.create",
    resourceTable: "catering_quotes",
    resourceId: inserted.id,
    metadata: { location_id: locationId, pipeline_id: input.pipelineId ?? null, total_cents: stack.totalCents, lines: lines.length },
    ipAddress: null,
    userAgent: null,
  });
  await linkLeadToCustomer(actor, {
    pipelineId: input.pipelineId ?? null,
    customerId: input.customerId ?? null,
    quoteId: inserted.id,
    context: "quote_create",
  });
  return { id: inserted.id, version: inserted.version };
}

export interface ReviseQuoteInput {
  eventDate?: string | null;
  headcount?: number | null;
  isDelivery?: boolean;
  deliveryZoneId?: string | null;
  lines: QuoteLineInput[];
  notes?: string | null;
  expiresAt?: string | null;
}

/**
 * Supersede the current revision and insert version+1 (recomputed against CURRENT pricing,
 * reset to 'draft'). Append-only: the prior row stays immutable. The payload is fully
 * validated + the new stack computed BEFORE the supersede UPDATE, which removes every
 * AVOIDABLE failure from below it.
 *
 * ── THE REVISION IS THE SAME ORDER (audit W02/B006) ──────────────────────────────────
 * Two things about the order are not the manager's to re-enter and were silently dropped:
 *   · `origin` — it drives the payment plan (self-serve = deposit required). Left to the
 *     column default, a revised self-serve order became a 'staff' quote.
 *   · THE PAYMENTS. `catering_payments.quote_id` names one revision row, so every payment
 *     stayed on the superseded row and the customer who had paid a deposit was shown none
 *     and asked to pay again. Once the new revision exists (after its items land, and also
 *     when they fail to — strand B below — because the revision is live either way), the
 *     family's payments are carried onto it (lib/catering/payment-carry.ts — read its header
 *     for what happens to each kind of row). That step is BEST-EFFORT by the same reasoning
 *     as strand B below: the revision is already live, so a failure is audited
 *     (`payments_carry_failed`), never turned into a failed request the manager retries
 *     into a 409. BEST-EFFORT IS NOT "PAYABLE ANYWAY" (review r1): the new revision is a
 *     draft, and every door it must pass to take money — `sendQuote`, an accept, the
 *     portal's pay gate — re-runs the carry and refuses while a payment is still stranded
 *     (`assertFamilyPaymentsReconciled` below).
 *
 * ── THE TWO STRANDS BELOW THE SUPERSEDE (audit v2, seat C5 finding F8 · BC-036) ──────
 * Validating early does NOT make an INSERT infallible, and this docstring used to promise
 * that it did. Three round trips, no transaction, two ways to strand:
 *
 *   A. THE HEADER INSERT FAILS. The family then has no `superseded_at IS NULL` row at
 *      all: `loadCurrentQuote` returns null, the pipeline surface shows no quote, and
 *      reviseQuote on the old id 409s `not_current` from here on — unrecoverable through
 *      this function. COMPENSATED below with lib/cash.ts's compare-and-set revert.
 *
 *   B. `insertQuoteItems` FAILS. The new revision is LIVE with zero line items and a
 *      non-zero snapshot total, so `resolveQuoteDemand` returns [] and prep demand
 *      silently reserves nothing for a real event. NOT rolled back, deliberately: undoing
 *      it means superseding the new revision AND un-superseding the old one — two more
 *      un-transactional writes whose own partial failure lands the family in strand A,
 *      the unrecoverable state this fix just closed. A repair path that can produce a
 *      worse outcome than the fault is not a repair. The correct fix is ONE RPC holding
 *      all three writes in a single transaction (migration 0188's shape for cash), which
 *      is an authored-and-gated migration plus a wiring PR, not a code change here.
 *      Meanwhile the failure is made QUERYABLE rather than silent — an audit row on the
 *      action this write already speaks, carrying `outcome: "items_insert_failed"`.
 *      LIVE-CHECK: a live revision with `total_cents > 0` and no `catering_quote_items`.
 */
export async function reviseQuote(actor: AuthContext, quoteId: string, input: ReviseQuoteInput): Promise<{ id: string; version: number; pipelineId: string | null }> {
  const sb = getServiceRoleClient();
  const { data: current, error: lErr } = await sb
    .from("catering_quotes")
    .select("id, root_id, version, location_id, pipeline_id, customer_id, origin, superseded_at")
    .eq("id", quoteId)
    .maybeSingle<{ id: string; root_id: string | null; version: number; location_id: string; pipeline_id: string | null; customer_id: string | null; origin: string | null; superseded_at: string | null }>();
  if (lErr) throw new Error(`reviseQuote load: ${lErr.message}`);
  if (!current) throw new CateringQuoteError(404, "not_found", "Quote not found");
  assertCanWrite(actor, current.location_id);
  if (current.superseded_at != null) {
    throw new CateringQuoteError(409, "not_current", "This quote revision has already been superseded");
  }
  // The revision carries the live revision's customer forward unchanged. createQuote is the
  // only door a customer comes in by (readable, or attached by typed email — option b), and a
  // revise neither picks a new one nor shows it, so there is nothing further to authorize here.

  // Validate + compute the new revision fully before touching the current row.
  const lines = await verifyLineRefs(sb, resolveLines(input.lines));
  const pricing = await loadPricingContext(actor, current.location_id);
  const isDelivery = input.isDelivery ?? false;
  const deliveryFee = await resolveDeliveryFee(pricing, isDelivery, input.deliveryZoneId ?? null);
  const stack = computeChargeStack(lines.map((l) => l.lineTotalCents), deliveryFee, pricing.rates);

  // Supersede the current revision (guard: exactly the still-live row). The stamp is a
  // VALUE, not written inline: the compensation below matches on the exact instant we
  // wrote, and a second `new Date()` would produce a different one and revert nothing.
  const supersededAt = new Date().toISOString();
  const { error: sErr, count } = await sb
    .from("catering_quotes")
    .update({ superseded_at: supersededAt }, { count: "exact" })
    .eq("id", quoteId)
    .is("superseded_at", null);
  if (sErr) throw new Error(`reviseQuote supersede: ${sErr.message}`);
  if (count === 0) throw new CateringQuoteError(409, "not_current", "Quote was concurrently superseded");

  const rootId = current.root_id ?? current.id;
  const { data: inserted, error: iErr } = await sb
    .from("catering_quotes")
    .insert({
      root_id: rootId,
      version: current.version + 1,
      pipeline_id: current.pipeline_id,
      customer_id: current.customer_id,
      location_id: current.location_id,
      status: "draft",
      // The order's origin is carried, never re-defaulted (see the header). Anything that is
      // not exactly 'self_serve' is 'staff', which is also the column's own CHECK vocabulary.
      origin: current.origin === "self_serve" ? "self_serve" : "staff",
      event_date: input.eventDate ?? null,
      headcount: input.headcount ?? null,
      ...snapshotColumns(pricing.rates, stack, isDelivery, input.deliveryZoneId ?? null),
      expires_at: input.expiresAt ?? defaultExpiry(),
      notes: input.notes ?? null,
      created_by: actor.user.id,
    })
    .select("id, version")
    .single<{ id: string; version: number }>();
  if (iErr) {
    // STRAND A — put the live revision back. The revert lifts OUR OWN stamp and nobody
    // else's: two revisers racing both read `current`, and an unfiltered revert would lift
    // the winner's supersede as well as ours. Rowcount-checked per the silent-UPDATE law.
    const { error: revertErr, count: reverted } = await sb
      .from("catering_quotes")
      .update({ superseded_at: null }, { count: "exact" })
      .eq("id", quoteId)
      .eq("superseded_at", supersededAt);
    if (revertErr || (reverted ?? 0) === 0) {
      console.error(
        `[catering] reviseQuote could not restore quote ${quoteId} after a failed revision insert: ${revertErr?.message ?? "no row matched our stamp"} — the family may have NO live revision. LIVE-CHECK: select coalesce(root_id, id) from catering_quotes where coalesce(root_id, id) = the family and superseded_at is null.`,
      );
    }
    throw new Error(`reviseQuote insert: ${iErr.message}`);
  }

  // PAYMENTS FOLLOW THE ORDER (see the header). Best-effort and re-runnable: the revision is
  // already live, so a failure here is recorded and healed by the next revise. NEVER throws.
  const carryPayments = async (): Promise<CarryPaymentsResult | null> => {
    try {
      const retire = await retireSessionFor(sb, current.location_id);
      return await carryPaymentsToRevision(
        sb,
        { rootId, newQuoteId: inserted.id, depositCents: stack.depositCents, totalCents: stack.totalCents },
        retire,
      );
    } catch (carryErr) {
      const message = carryErr instanceof Error ? carryErr.message : String(carryErr);
      console.error(
        `[catering] reviseQuote could not carry the payments of family ${rootId} onto revision ${inserted.id}: ${message}. LIVE-CHECK: select p.id, p.quote_id, p.status from catering_payments p join catering_quotes q on q.id = p.quote_id where coalesce(q.root_id, q.id) = the family and q.superseded_at is not null.`,
      );
      void audit({
        actorId: actor.user.id,
        actorRole: actor.user.role,
        action: "catering.quote.revise",
        resourceTable: "catering_quotes",
        resourceId: inserted.id,
        metadata: { outcome: "payments_carry_failed", from_quote_id: quoteId, root_id: rootId, version: inserted.version, error: message },
        ipAddress: null,
        userAgent: null,
      });
      return null;
    }
  };

  try {
    await insertQuoteItems(sb, inserted.id, lines, actor.user.id);
  } catch (itemsErr) {
    // The empty revision is still the LIVE one, so the family's payments belong on it: a
    // customer who paid must not also lose sight of the payment because the items failed.
    const carriedOnFailure = await carryPayments();
    // STRAND B — the new revision is live and EMPTY. Not rolled back (see the header); made
    // queryable instead. `catering.quote.revise` is already in the closed action vocabulary,
    // so the signal rides its metadata rather than inventing a name. Awaited because we
    // throw on the next line — audit() is fail-open and never throws.
    await audit({
      actorId: actor.user.id,
      actorRole: actor.user.role,
      action: "catering.quote.revise",
      resourceTable: "catering_quotes",
      resourceId: inserted.id,
      metadata: {
        outcome: "items_insert_failed",
        from_quote_id: quoteId,
        root_id: rootId,
        version: inserted.version,
        total_cents: stack.totalCents,
        expected_line_count: lines.length,
        error: itemsErr instanceof Error ? itemsErr.message : String(itemsErr),
        payments_carried: carriedOnFailure !== null,
        payments: carriedOnFailure,
      },
      ipAddress: null,
      userAgent: null,
    });
    throw itemsErr;
  }

  const carried = await carryPayments();

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.quote.revise",
    resourceTable: "catering_quotes",
    resourceId: inserted.id,
    metadata: {
      from_quote_id: quoteId,
      root_id: rootId,
      version: inserted.version,
      total_cents: stack.totalCents,
      // Which payment rows now belong to this revision, and the revision each one left —
      // the record of what a payment was ORIGINALLY raised against.
      payments_carried: carried !== null,
      payments: carried,
    },
    ipAddress: null,
    userAgent: null,
  });
  // A quote saved before this link existed (B5 #34) gets its lead linked on the next revise.
  await linkLeadToCustomer(actor, {
    pipelineId: current.pipeline_id,
    customerId: current.customer_id,
    quoteId: inserted.id,
    context: "quote_revise",
  });
  return { id: inserted.id, version: inserted.version, pipelineId: current.pipeline_id };
}

/**
 * THE DOOR RULE (review r1 of audit W02/B006): a revision whose family still has a payment
 * on an EARLIER revision may not be sent or accepted. The carry in `reviseQuote` is
 * best-effort; when it failed, the paid deposit stayed on the superseded row, every reader
 * keyed on the live quote id saw no payment, and the team could send a revision the
 * customer would be charged a second deposit on. So the carry is re-run here (idempotent —
 * it also heals a family orphaned before the carry existed) and, if a payment is STILL
 * stranded, the action is refused 409 `payments_unreconciled` before anything is written.
 *
 * Audited on `catering.quote.revise` — the action that already records which payments
 * moved onto a revision — with `outcome: "payments_reconciled"` or
 * `"payments_reconcile_failed"`. A quote that was never revised returns at once, having
 * read and written nothing.
 */
async function assertFamilyPaymentsReconciled(
  sb: ReturnType<typeof getServiceRoleClient>,
  actor: AuthContext,
  quote: { id: string; root_id: string | null; location_id: string; deposit_cents: number; total_cents: number },
  context: "send" | "accept" | "resend",
): Promise<void> {
  const outcome = await reconcileFamilyPayments(sb, {
    id: quote.id,
    rootId: quote.root_id ?? null,
    locationId: quote.location_id,
    depositCents: quote.deposit_cents,
    totalCents: quote.total_cents,
  });
  if (!outcome.attempted) return;
  // Awaited: on the refusal we throw on the next line (audit() is fail-open, never throws).
  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.quote.revise",
    resourceTable: "catering_quotes",
    resourceId: quote.id,
    metadata: {
      outcome: outcome.reconciled ? "payments_reconciled" : "payments_reconcile_failed",
      context,
      root_id: quote.root_id,
      stranded: outcome.stranded,
      payments: outcome.healed,
      error: outcome.error,
    },
    ipAddress: null,
    userAgent: null,
  });
  if (!outcome.reconciled) {
    throw new CateringQuoteError(
      409,
      "payments_unreconciled",
      "This order's earlier payments could not be moved onto this revision yet — try again in a moment",
    );
  }
}

/**
 * Transition a live quote's status (accept / decline / mark expired). Level-gated + audited.
 *
 * THE ORDER OF THE ACCEPT GATES (merge of audit W01 and W02; pinned by
 * tests/catering-quote-accept-gates-order.test.ts). The first one that refuses names the
 * refusal; nothing is written to the quote before the last one passes.
 *   1. `not_found` / write access / `not_current` — is this the live revision at all.
 *   2. `payments_unreconciled` (W02/B006) — the family's payments must be on THIS revision
 *      before anything reads "what was paid on this quote id". The expiry reading below does.
 *   3. `quote_expired` (W02/B037) — status `expired`, or the clock, unless a payment made in
 *      time took the offer up.
 *   4. `delivery_unavailable` / `below_delivery_minimum` / `delivery_fee_changed` (W01) — a
 *      self-serve delivery order re-checked against the shop's CURRENT zones. LAST on purpose:
 *      gates 2 and 3 decide whether this order may be accepted AT ALL, and this one's answer
 *      ("revise the quote") only helps on an order that otherwise could be. An order that
 *      passed the clock because it was paid in time is still held here.
 *   5. `status_changed` — the guarded write (silent-UPDATE law).
 * Declining or marking expired passes 1 and 5 only: they take no money and re-open nothing.
 */
export async function setQuoteStatus(actor: AuthContext, id: string, status: Extract<QuoteStatus, "accepted" | "declined" | "expired">): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: row, error: lErr } = await sb
    .from("catering_quotes")
    .select("id, root_id, location_id, status, superseded_at, expires_at, deposit_cents, total_cents, origin, is_delivery, delivery_zone_id, delivery_fee_cents, subtotal_cents")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      root_id: string | null;
      location_id: string;
      status: string;
      superseded_at: string | null;
      expires_at: string | null;
      deposit_cents: number;
      total_cents: number;
      origin: string;
      is_delivery: boolean;
      delivery_zone_id: string | null;
      delivery_fee_cents: number;
      subtotal_cents: number;
    }>();
  if (lErr) throw new Error(`setQuoteStatus load: ${lErr.message}`);
  if (!row) throw new CateringQuoteError(404, "not_found", "Quote not found");
  assertCanWrite(actor, row.location_id);
  if (row.superseded_at != null) throw new CateringQuoteError(409, "not_current", "Quote revision superseded");
  // An expired quote is not acceptable — the customer's price/terms window has closed, so the
  // path back to a sale is a revision, not an accept. Other transitions stay open on purpose
  // (declined → accepted is a legitimate manager reversal).
  // "Expired" is the clock as well as the status (audit W02/B037). Nothing sweeps
  // `expires_at`, so an open offer past its date still reads `sent` — or `submitted`: a
  // self-serve order gets the same window from `submitDraft` — and the board hid Accept
  // only on the first. This reads the ONE shared predicate the portal's pay gate reads
  // (lib/portal/payability-shared.ts), so the two cannot disagree: `accepted` is not judged
  // by the clock, so accepting a lapsed order used to re-open payment at its old price.
  if (status === "accepted") {
    // `accepted` is payable from the portal, so the family's payments must be on THIS
    // revision first (the door rule above) — and BEFORE the expiry reading below, which asks
    // "was anything paid on this quote id?". Declining or expiring a quote takes no money
    // and is not held.
    await assertFamilyPaymentsReconciled(sb, actor, row, "accept");
    let expired = row.status === "expired";
    if (!expired && quoteTimeExpired(row.status, row.expires_at)) {
      // An offer the customer PAID toward was taken up in time (the reading the customer's
      // own order list makes — lib/portal/account.ts rule 6). Confirming it re-opens
      // nothing: the portal's already-paid gate refuses a second payment on it. A failed
      // read refuses the accept rather than guessing.
      //
      // …"IN TIME" IS A FACT ABOUT THE PAYMENT, NOT ITS EXISTENCE (review r2). A checkout
      // opened before the date can be completed after it, and a payment can be marked paid
      // by hand any day; a paid row alone used to re-open the lapsed offer at its old price.
      // Only a payment whose `paid_at` is not after `expires_at` counts (`offerTakenUpInTime`).
      // A late one is already flagged for review (`paid_after_expiry`); it leaves this accept
      // refused, and the way forward is the one the refusal names — revise the quote (the
      // payment follows the revision) — or a refund.
      const { data: paidRows, error: pErr } = await sb
        .from("catering_payments")
        .select("id, status, paid_at")
        .eq("quote_id", id)
        .eq("status", "paid")
        .returns<Array<{ id: string; status: string; paid_at: string | null }>>();
      if (pErr) throw new Error(`setQuoteStatus payments: ${pErr.message}`);
      expired = !offerTakenUpInTime(
        row.expires_at,
        (paidRows ?? []).map((p) => ({ status: p.status, paidAt: p.paid_at ?? null })),
      );
    }
    if (expired) {
      throw new CateringQuoteError(409, "quote_expired", "This quote has expired — revise it before accepting");
    }
  }
  // A SELF-SERVE delivery order is re-checked on accept with the portal's own rule against the shop's
  // CURRENT zones (Juan 2026-11-15): the most expensive active zone, its fee, its minimum. An order the
  // portal would not take today (no zone, under the minimum, a fee that moved) is refused by name;
  // revising re-prices it with the zone staff choose.
  if (status === "accepted" && row.origin === "self_serve" && row.is_delivery) {
    const { data: zoneRows, error: zErr } = await sb
      .from("catering_delivery_zones")
      .select("id, fee_cents, min_order_cents")
      .eq("location_id", row.location_id)
      .eq("active", true)
      .returns<Array<{ id: string; fee_cents: number; min_order_cents: number | null }>>();
    if (zErr) throw new Error(`setQuoteStatus zones: ${zErr.message}`);
    const refusal = acceptDeliveryRefusal(
      { origin: row.origin, isDelivery: row.is_delivery, deliveryZoneId: row.delivery_zone_id, deliveryFeeCents: row.delivery_fee_cents, subtotalCents: row.subtotal_cents },
      (zoneRows ?? []).map((z) => ({ id: z.id, feeCents: z.fee_cents, minOrderCents: z.min_order_cents })),
    );
    if (refusal === "delivery_unavailable") throw new CateringQuoteError(409, refusal, "No active delivery zone at this shop — add one or revise the quote before accepting");
    if (refusal === "below_delivery_minimum") throw new CateringQuoteError(409, refusal, "This delivery order is under its zone's minimum — revise it before accepting");
    if (refusal === "delivery_fee_changed") throw new CateringQuoteError(409, refusal, "The delivery fee is out of date — revise the quote before accepting");
  }

  // Guard on the status the pre-read saw (silent-UPDATE law): count 0 means the status
  // changed between the read and the write, so the gates above were decided on stale state.
  const { error: uErr, count } = await sb
    .from("catering_quotes")
    .update({ status }, { count: "exact" })
    .eq("id", id)
    .eq("status", row.status)
    .is("superseded_at", null);
  if (uErr) throw new Error(`setQuoteStatus update: ${uErr.message}`);
  if (count === 0) throw new CateringQuoteError(409, "status_changed", "Quote status changed since it was loaded — reload and retry");

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.quote.status",
    resourceTable: "catering_quotes",
    resourceId: id,
    metadata: { from_status: row.status, to_status: status },
    ipAddress: null,
    userAgent: null,
  });
}

// ── Labels (D25) ──────────────────────────────────────────────────────────────
export interface LineAllergen {
  slug: string;
  labelEn: string;
  labelEs: string | null;
  presence: "contains" | "may_contain";
}
export interface LineAllergens {
  /** unknown = ad-hoc line, no menu reference; none_on_file = referenced but no data; listed = has data. */
  status: "listed" | "none_on_file" | "unknown";
  allergens: LineAllergen[];
}
export interface QuoteLabelData {
  quote: Quote;
  items: QuoteItem[];
  /** allergen resolution per quote-item id. Absent data is NEVER rendered as "safe" (D25). */
  allergensByItem: Record<string, LineAllergens>;
}

/**
 * Quote + line items + per-line allergen resolution for the print label surface (D25).
 * A safety artifact: a line with a menu reference but no allergen rows resolves to
 * `none_on_file`, and an ad-hoc line to `unknown` — the label renders an explicit
 * "verify before serving" warning for both. Absence is never rendered as safe.
 */
export async function loadLabelData(actor: AuthContext, quoteId: string): Promise<QuoteLabelData | null> {
  const detail = await loadQuote(actor, quoteId);
  if (!detail) return null;
  const sb = getServiceRoleClient();

  const itemIds = detail.items.map((i) => i.itemId).filter((v): v is string => v != null);
  const menuItemIds = detail.items.map((i) => i.menuItemId).filter((v): v is string => v != null);

  type AllergenRow = {
    item_id: string | null;
    menu_item_id: string | null;
    presence: "contains" | "may_contain";
    catering_allergen_types: { slug: string; label_en: string; label_es: string | null } | null;
  };
  let rows: AllergenRow[] = [];
  if (itemIds.length > 0 || menuItemIds.length > 0) {
    const filters: string[] = [];
    if (itemIds.length > 0) filters.push(`item_id.in.(${itemIds.join(",")})`);
    if (menuItemIds.length > 0) filters.push(`menu_item_id.in.(${menuItemIds.join(",")})`);
    const { data, error } = await sb
      .from("catering_allergens")
      .select("item_id, menu_item_id, presence, catering_allergen_types(slug, label_en, label_es)")
      .eq("active", true)
      .or(filters.join(","))
      .returns<AllergenRow[]>();
    if (error) throw new Error(`loadLabelData allergens: ${error.message}`);
    rows = data ?? [];
  }

  const allergensByItem: Record<string, LineAllergens> = {};
  for (const item of detail.items) {
    if (item.itemId == null && item.menuItemId == null) {
      allergensByItem[item.id] = { status: "unknown", allergens: [] };
      continue;
    }
    const matched = rows.filter(
      (r) => (item.itemId != null && r.item_id === item.itemId) || (item.menuItemId != null && r.menu_item_id === item.menuItemId),
    );
    const allergens: LineAllergen[] = matched
      .filter((r) => r.catering_allergen_types != null)
      .map((r) => ({
        slug: r.catering_allergen_types!.slug,
        labelEn: r.catering_allergen_types!.label_en,
        labelEs: r.catering_allergen_types!.label_es,
        presence: r.presence,
      }));
    allergensByItem[item.id] = {
      status: allergens.length > 0 ? "listed" : "none_on_file",
      allergens,
    };
  }

  return { quote: detail.quote, items: detail.items, allergensByItem };
}

export interface SendQuoteResult {
  emailed: boolean;
  /** Why `emailed` is false, when it is. `sent` when it is true. */
  emailOutcome: "sent" | "no_customer" | "no_address" | "send_failed";
  /** Null whenever `recipientHidden` — another shop's customer's address is never returned. */
  recipient: string | null;
  /** The quote's client is another shop's customer the sender may not read (option b). */
  recipientHidden: boolean;
  emailError: string | null;
}

/**
 * Mark a quote 'sent' + best-effort email the customer. STEP-UP IS ENFORCED AT THE ROUTE
 * (assertStepUp Tier B) — this lib assumes a pre-authorized actor. The email is best-effort:
 * until the Resend domain is verified it only actually delivers to Juan (see lib/email.ts),
 * so the send is a status transition + audit first, delivery second.
 */
export async function sendQuote(actor: AuthContext, id: string): Promise<SendQuoteResult> {
  const sb = getServiceRoleClient();
  const { data: row, error: lErr } = await sb
    .from("catering_quotes")
    .select("id, root_id, version, location_id, status, superseded_at, customer_id, total_cents, deposit_cents, expires_at, event_date, headcount")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      root_id: string | null;
      version: number | null;
      location_id: string;
      status: string;
      superseded_at: string | null;
      customer_id: string | null;
      total_cents: number;
      deposit_cents: number;
      expires_at: string | null;
      event_date: string | null;
      headcount: number | null;
    }>();
  if (lErr) throw new Error(`sendQuote load: ${lErr.message}`);
  if (!row) throw new CateringQuoteError(404, "not_found", "Quote not found");
  assertCanWrite(actor, row.location_id);
  if (row.superseded_at != null) throw new CateringQuoteError(409, "not_current", "Quote revision superseded");
  if (row.status !== "draft" && row.status !== "sent") {
    throw new CateringQuoteError(409, "invalid_status", "Only a draft or sent quote can be sent");
  }
  // SENDING IS WHAT MAKES A REVISION PAYABLE. Before the status moves and before any email
  // carries a pay link, the family's payments must be on THIS revision (the door rule).
  await assertFamilyPaymentsReconciled(sb, actor, row, "send");

  // The recipient is authorized BEFORE the status write and the email (`resolveQuoteRecipient`).
  const to = await resolveQuoteRecipient(sb, actor, row.customer_id, "sendQuote");

  const sentAt = new Date().toISOString();
  const { error: uErr, count } = await sb
    .from("catering_quotes")
    .update({ status: "sent", sent_at: sentAt, sent_by: actor.user.id }, { count: "exact" })
    .eq("id", id)
    .is("superseded_at", null)
    // Guarded on the status validated above (audit W22/B204; silent-UPDATE law, as setQuoteStatus):
    // a concurrent accept/decline that landed during the recipient read is not flipped back to
    // 'sent', and — because this throws before the email — the customer gets no re-send.
    .eq("status", row.status);
  if (uErr) throw new Error(`sendQuote update: ${uErr.message}`);
  if (count === 0) throw new CateringQuoteError(409, "status_changed", "Quote status changed since it was loaded — reload and retry");

  // A REVISION THE CUSTOMER ALREADY SAW (audit W22, owner decision W22-1: any order update → a customer email
  // showing old vs new). When this revision changes the date, guests or total of a version that was sent
  // before, the customer gets "Your catering order was updated" with the old → new lines INSTEAD of the generic
  // quote email — a NEW customer email that ships CLOSED (lib/catering/order-update-email-shared.ts). Whenever
  // it does not go out (any switch closed, nothing changed, a first send), the quote email below is exactly
  // today's.
  const orderUpdate = await emailRevisionUpdate(sb, row, sentAt);
  const sent = orderUpdate?.outcome === "sent"
    ? { emailed: true, emailOutcome: "sent" as const, recipient: to.recipientHidden ? null : (to.cust?.email ?? null), emailError: null }
    : await emailQuoteToCustomer(id, row.total_cents, row.customer_id, to);
  const { emailed, emailOutcome, recipient, emailError } = sent;
  const { recipientHidden } = to;

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.quote.send",
    resourceTable: "catering_quotes",
    resourceId: id,
    metadata: {
      emailed, email_outcome: emailOutcome, recipient, recipient_hidden: recipientHidden, email_error: emailError, total_cents: row.total_cents,
      ...(orderUpdate ? { order_update_email: orderUpdate.outcome, ...("reason" in orderUpdate ? { order_update_email_reason: orderUpdate.reason } : {}) } : {}),
    },
    ipAddress: null,
    userAgent: null,
  });
  return { emailed, emailOutcome, recipient, recipientHidden, emailError };
}

/**
 * The order-update email for a revision whose family was already SENT to the customer (W22). Null when this
 * is a first send or nothing the customer reads changed; otherwise the order-update outcome (never throws).
 * `sentAt` is the sent_at THIS send wrote: the persisted send occurrence the email is keyed by (fix round 1,
 * BC-061 — a key of the two revision ids alone made a second explicit send of one revision a provider no-op).
 */
async function emailRevisionUpdate(
  sb: ReturnType<typeof getServiceRoleClient>,
  row: { id: string; root_id: string | null; version: number | null; customer_id: string | null; total_cents: number; event_date: string | null; headcount: number | null },
  sentAt: string,
): Promise<OrderUpdateEmailOutcome | null> {
  if (!row.root_id || (row.version ?? 1) <= 1) return null;
  const { data: prev, error } = await sb
    .from("catering_quotes")
    .select("id, event_date, headcount, total_cents")
    .or(`id.eq.${row.root_id},root_id.eq.${row.root_id}`)
    .neq("id", row.id)
    .not("sent_at", "is", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; event_date: string | null; headcount: number | null; total_cents: number }>();
  if (error || !prev) return null;
  const changes = orderChanges(
    { eventDate: prev.event_date, headcount: prev.headcount, totalCents: prev.total_cents },
    { eventDate: row.event_date, headcount: row.headcount, totalCents: row.total_cents },
  );
  if (changes.length === 0) return null;
  return emailOrderUpdate(sb, { customerId: row.customer_id, quoteId: row.id, changes, idempotencyKey: `order-update:quote:${prev.id}:${row.id}:${sentAt}` });
}

// ── THE ONE QUOTE EMAIL PATH ────────────────────────────────────────────────────────
// `sendQuote` and `resendExpiredQuote` deliver the SAME message through the SAME two steps,
// so there is one place that decides who may be written to and one template. Nothing here
// is new behaviour: it is `sendQuote`'s own body, lifted out so a second caller cannot grow
// a second spelling of it. `sendEmail` (lib/email.ts) keeps every delivery switch it has.

interface QuoteRecipient {
  /** The customer row's contact, or null when the row is gone / the quote has no customer. */
  cust: { email: string | null; name: string | null } | null;
  /** The customer belongs to a shop this sender may not read: delivered to, never shown. */
  recipientHidden: boolean;
}

/**
 * Who a quote email goes to, and whether the sender may SEE that address.
 *
 * Review 2 (P1) + option b: the recipient is contact data at the CUSTOMER's shop, not the
 * quote's. It is authorized BEFORE the status write and the email. A customer the sender
 * may not read is another shop's customer attached by the email typed at creation (createQuote
 * admits no other way in): the quote is still DELIVERED to that customer, but the address is
 * never returned or logged — `recipient` stays null and `recipientHidden` says why. A
 * customer row that is simply gone keeps today's `no_address` outcome.
 */
async function resolveQuoteRecipient(
  sb: ReturnType<typeof getServiceRoleClient>,
  actor: AuthContext,
  customerId: string | null,
  caller: string,
): Promise<QuoteRecipient> {
  if (!customerId) return { cust: null, recipientHidden: false };
  const [reader, { data: c, error: cErr }] = await Promise.all([
    loadCateringReader(actor),
    sb
      .from("catering_customers")
      .select("email, name, primary_location_id")
      .eq("id", customerId)
      .maybeSingle<{ email: string | null; name: string | null; primary_location_id: string | null }>(),
  ]);
  if (cErr) throw new Error(`${caller} customer read: ${cErr.message}`);
  return {
    cust: c ? { email: c.email, name: c.name } : null,
    recipientHidden: !!c && !(reader && canReadCateringContact(reader, c.primary_location_id)),
  };
}

/** Best-effort customer email (only delivers to Juan until Resend DNS is verified). Never
 *  throws: `sendEmail` reports a failure as a value, and that outcome is what is returned. */
async function emailQuoteToCustomer(
  quoteId: string,
  totalCents: number,
  customerId: string | null,
  to: QuoteRecipient,
): Promise<Pick<SendQuoteResult, "emailed" | "emailOutcome" | "recipient" | "emailError">> {
  const { cust, recipientHidden } = to;
  let emailed = false;
  let emailOutcome: "sent" | "no_customer" | "no_address" | "send_failed" = "no_customer";
  let recipient: string | null = null;
  let emailError: string | null = null;
  if (customerId) {
    emailOutcome = "no_address";
    if (cust?.email) {
      recipient = recipientHidden ? null : cust.email;
      // Customer-supplied name is interpolated into email HTML → escape it (A-H2 stored-XSS-in-email).
      const safeName = escapeHtml(cust.name ?? "there");
      const total = (totalCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
      // Link to the shared customer review+pay surface (sign-in required). Only include it when
      // a portal origin or legacy NEXT_PUBLIC_APP_URL is set — never emit a broken `undefined/...` URL into a sent email.
      const appUrl = portalOrigin();
      const quoteUrl = appUrl ? `${appUrl}/order/quote/${quoteId}` : null;
      const htmlLink = quoteUrl
        ? `<p>View &amp; pay your quote: <a href="${quoteUrl}">${quoteUrl}</a> (sign-in required).</p>`
        : "";
      const textLink = quoteUrl ? `\n\nView & pay your quote: ${quoteUrl} (sign-in required).` : "";
      const res = await sendEmail({
        to: cust.email,
        subject: "Your catering quote from Compliments Only",
        html: `<p>Hi ${safeName},</p><p>Your catering quote is ready. Estimated total: <strong>${total}</strong>.</p>${htmlLink}<p>Our team will follow up shortly to confirm the details.</p>`,
        text: `Hi ${cust.name ?? "there"},\n\nYour catering quote is ready. Estimated total: ${total}.${textLink}\n\nOur team will follow up shortly to confirm the details.`,
      });
      if ("id" in res) {
        emailed = true;
        emailOutcome = "sent";
      } else {
        // Defence in depth: sendEmail already scrubs, but this string lands in an audit row.
        emailError = redactEmailAddresses(res.error);
        emailOutcome = "send_failed";
      }
    }
  }
  return { emailed, emailOutcome, recipient, emailError };
}

// ── Resend an EXPIRED quote with a new expiry (owner request, Juan 2026-11-15) ──────
// "Expired quotes should be able to be resent, not remade."

/** Who may resend an expired quote: EXACTLY who may send one. One name, so the two cannot
 *  drift; the shop bind (`assertCanWrite`) and the route's Tier B step-up are Send's too. */
export const QUOTE_RESEND_MIN = QUOTE_WRITE_MIN;

export { QUOTE_RESEND_MAX_DAYS };

export interface ResendQuoteResult extends SendQuoteResult {
  /** The expiry now in force. */
  expiresAt: string;
  /** The expiry it replaced (the one that had passed). */
  previousExpiresAt: string;
  /**
   * Paid payments on this quote that settled AFTER the old expiry (or cannot say when they
   * were paid). Each was flagged for review when it landed (`paid_after_expiry`,
   * lib/stripe/webhook.ts) and a new expiry does not un-flag it: the ids ride on this
   * action's audit row and the caller is told, so the person extending the offer is the
   * person reminded that money on it still needs a look.
   */
  latePaymentIds: string[];
}

/**
 * Give an EXPIRED open offer a new expiry and send it to the customer again.
 *
 * WHAT IT IS: the SAME quote — same id, same lines, same amounts, same payments. Nothing is
 * inserted, no revision is created, nothing is superseded, no payment row is written. One
 * column changes, `expires_at` (and, for a quote the team had sent, `sent_at` / `sent_by`,
 * exactly as pressing Send on a sent quote already rewrites them). A self-serve `submitted`
 * order stays `submitted`. Until now the only way back from an expired offer was a revise —
 * a new row, a new id, the payments carried across — for a quote in which nothing had changed.
 *
 * WHAT MAY BE RESENT: a live revision whose status is `sent` or `submitted` AND whose
 * `expires_at` has passed — the ONE shared clock rule (`quoteTimeExpired`,
 * lib/portal/payability-shared.ts) that the portal's pay gate and the staff accept read, so
 * "expired" means here what it means everywhere. Refused by name:
 *   · not expired yet            → 409 `not_expired` (Send already resends an open quote);
 *   · accepted / declined / draft / hand-marked `expired` → 409 `invalid_status`
 *     (accepted is not on the clock; declined and hand-expired are a person's decision, and
 *     this does not overrule one; a draft has never been offered);
 *   · a superseded revision      → 409 `not_current`.
 *
 * WHO: whoever may Send (`assertCanWrite`: the Send floor, bound to the quote's shop).
 * STEP-UP IS ENFORCED AT THE ROUTE (Tier B), as for Send — this lib assumes a pre-authorized
 * actor.
 *
 * THE DOOR RULE: a resend makes the quote PAYABLE again, so the family's payments must be on
 * THIS revision first (`assertFamilyPaymentsReconciled`) — the same door Send and Accept pass.
 *
 * THE WRITE IS A COMPARE-AND-SET ON THE ROW AS IT WAS READ: still this status, still the
 * live revision, still the expiry that was judged expired. A revise that superseded it, a
 * status change, or another resend that got there first matches nothing: 409
 * `status_changed`, nothing sent. (Two managers pressing Resend at once: one lands, one is
 * told to reload — the customer gets one email, the quote one new expiry.)
 *
 * AFTERWARDS payability and the staff accept follow the NEW expiry — they read `expires_at`,
 * and it is the only thing that moved. A payment that landed after the OLD expiry stays
 * what it was (see `ResendQuoteResult.latePaymentIds`): its row is untouched, its review
 * flag is history that is never rewritten, and this action's audit row names it.
 *
 * `now` is a parameter for tests; production passes nothing.
 */
export async function resendExpiredQuote(
  actor: AuthContext,
  id: string,
  input: { expiresAt: string },
  now: number = Date.now(),
): Promise<ResendQuoteResult> {
  const sb = getServiceRoleClient();
  const { data: row, error: lErr } = await sb
    .from("catering_quotes")
    .select("id, root_id, location_id, status, superseded_at, customer_id, total_cents, deposit_cents, expires_at")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      root_id: string | null;
      location_id: string;
      status: string;
      superseded_at: string | null;
      customer_id: string | null;
      total_cents: number;
      deposit_cents: number;
      expires_at: string | null;
    }>();
  if (lErr) throw new Error(`resendExpiredQuote load: ${lErr.message}`);
  if (!row) throw new CateringQuoteError(404, "not_found", "Quote not found");
  assertCanWrite(actor, row.location_id);

  // The new expiry: a real instant, in the future, and not absurdly far out — at most
  // `QUOTE_RESEND_MAX_DAYS` operational (ET) days from today, the bound the date picker shows.
  const nextMs = typeof input.expiresAt === "string" ? Date.parse(input.expiresAt) : NaN;
  const lastAllowedDay = etYmdMinusDays(etCalendarDate(new Date(now).toISOString()), -QUOTE_RESEND_MAX_DAYS);
  if (!Number.isFinite(nextMs) || nextMs <= now || etCalendarDate(new Date(nextMs).toISOString()) > lastAllowedDay) {
    throw new CateringQuoteError(400, "invalid_expiry", `The new expiry must be in the future and at most ${QUOTE_RESEND_MAX_DAYS} days out`);
  }
  const nextExpiresAt = new Date(nextMs).toISOString();

  if (row.superseded_at != null) throw new CateringQuoteError(409, "not_current", "Quote revision superseded");
  if (row.status !== "sent" && row.status !== "submitted") {
    throw new CateringQuoteError(409, "invalid_status", "Only a sent or submitted quote that has expired can be resent");
  }
  // `quoteTimeExpired` is false for a quote with no usable `expires_at`: nothing to extend.
  if (!quoteTimeExpired(row.status, row.expires_at, now) || row.expires_at == null) {
    throw new CateringQuoteError(409, "not_expired", "This quote has not expired — send it instead");
  }
  const previousExpiresAt = row.expires_at;

  // RESENDING IS WHAT MAKES THIS QUOTE PAYABLE AGAIN: the door rule, before anything moves.
  await assertFamilyPaymentsReconciled(sb, actor, row, "resend");

  // MONEY THAT LANDED AFTER THE OLD EXPIRY (see `ResendQuoteResult.latePaymentIds`). Read
  // before the write, against the expiry that is about to be replaced. A failed read refuses
  // the resend rather than extending an offer without knowing what is on it.
  const { data: paidRows, error: pErr } = await sb
    .from("catering_payments")
    .select("id, status, paid_at")
    .eq("quote_id", id)
    .eq("status", "paid")
    .returns<Array<{ id: string; status: string; paid_at: string | null }>>();
  if (pErr) throw new Error(`resendExpiredQuote payments: ${pErr.message}`);
  const oldDeadline = Date.parse(previousExpiresAt);
  const latePaymentIds = (paidRows ?? [])
    .filter((p) => {
      const at = p.paid_at ? Date.parse(p.paid_at) : NaN;
      return !Number.isFinite(at) || at > oldDeadline; // the complement of `offerTakenUpInTime`
    })
    .map((p) => p.id);

  const to = await resolveQuoteRecipient(sb, actor, row.customer_id, "resendExpiredQuote");

  // The compare-and-set (see the header). `sent_at` / `sent_by` move only for a quote the
  // team had sent; a self-serve `submitted` order was never "sent" and keeps both as they are.
  const patch: Record<string, unknown> = { expires_at: nextExpiresAt };
  if (row.status === "sent") {
    patch.sent_at = new Date(now).toISOString();
    patch.sent_by = actor.user.id;
  }
  const { error: uErr, count } = await sb
    .from("catering_quotes")
    .update(patch, { count: "exact" })
    .eq("id", id)
    .eq("status", row.status)
    .eq("expires_at", previousExpiresAt)
    .is("superseded_at", null);
  if (uErr) throw new Error(`resendExpiredQuote update: ${uErr.message}`);
  if (count === 0) {
    throw new CateringQuoteError(409, "status_changed", "Quote changed since it was loaded — reload and retry");
  }

  const { emailed, emailOutcome, recipient, emailError } = await emailQuoteToCustomer(id, row.total_cents, row.customer_id, to);
  const { recipientHidden } = to;

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.quote.resend",
    resourceTable: "catering_quotes",
    resourceId: id,
    metadata: {
      status: row.status,
      previous_expires_at: previousExpiresAt,
      expires_at: nextExpiresAt,
      // Still flagged: these settled after `previous_expires_at` (empty when none did).
      late_payment_ids: latePaymentIds,
      emailed,
      email_outcome: emailOutcome,
      recipient,
      recipient_hidden: recipientHidden,
      email_error: emailError,
      total_cents: row.total_cents,
    },
    ipAddress: null,
    userAgent: null,
  });
  return { emailed, emailOutcome, recipient, recipientHidden, emailError, expiresAt: nextExpiresAt, previousExpiresAt, latePaymentIds };
}
