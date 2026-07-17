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

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, isAllLocationsAccess } from "@/lib/locations";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import type { AuthContext } from "@/lib/session";

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

// ── Charge stack (pure, server-authoritative) ─────────────────────────────────
export interface ChargeRates {
  taxRateBps: number;
  gratuityBps: number;
  serviceChargeBps: number;
  depositPctBps: number;
  taxOnDelivery: boolean;
  taxOnGratuity: boolean;
}
export interface ChargeStack {
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceChargeCents: number;
  gratuityCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
}

/** basis-points of an integer-cents base, rounded half-up to the nearest cent. */
function bpsOf(baseCents: number, bps: number): number {
  return Math.round((baseCents * bps) / 10000);
}
/** A single line's frozen total: quantity × unit price, rounded to the nearest cent. */
export function lineTotalCents(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents);
}

/**
 * The one place quote money is computed. `lineTotals` are the per-line frozen totals
 * (already quantity×unit). Returns the full breakdown; the caller snapshots it + `rates`
 * onto the quote row so the math is immutable regardless of later pricing changes.
 */
export function computeChargeStack(
  lineTotals: number[],
  deliveryFeeCents: number,
  rates: ChargeRates,
): ChargeStack {
  const subtotalCents = lineTotals.reduce((s, n) => s + n, 0);
  const serviceChargeCents = bpsOf(subtotalCents, rates.serviceChargeBps);
  const gratuityCents = bpsOf(subtotalCents, rates.gratuityBps);
  const taxBase =
    subtotalCents +
    serviceChargeCents + // service charge is always in the tax base
    (rates.taxOnDelivery ? deliveryFeeCents : 0) +
    (rates.taxOnGratuity ? gratuityCents : 0);
  const taxCents = bpsOf(taxBase, rates.taxRateBps);
  const totalCents =
    subtotalCents + deliveryFeeCents + serviceChargeCents + gratuityCents + taxCents;
  const depositCents = bpsOf(totalCents, rates.depositPctBps);
  return {
    subtotalCents,
    deliveryFeeCents,
    serviceChargeCents,
    gratuityCents,
    taxCents,
    totalCents,
    depositCents,
  };
}

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
  "id, item_id, menu_item_id, package_id, description, quantity, unit_price_cents, line_total_cents, display_order";

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

// ── Mutations ─────────────────────────────────────────────────────────────────
export interface QuoteLineInput {
  description?: string | null;
  itemId?: string | null;
  menuItemId?: string | null;
  packageId?: string | null;
  quantity: number;
  unitPriceCents: number;
  displayOrder?: number;
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
}

interface ResolvedLine {
  description: string | null;
  itemId: string | null;
  menuItemId: string | null;
  packageId: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  displayOrder: number;
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
    return {
      description,
      itemId,
      menuItemId,
      packageId: l.packageId ?? null,
      quantity,
      unitPriceCents,
      lineTotalCents: lineTotalCents(quantity, unitPriceCents),
      displayOrder: l.displayOrder ?? i,
    };
  });
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
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
      line_total_cents: l.lineTotalCents,
      display_order: l.displayOrder,
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
      quantity: Number(o.quantity),
      unitPriceCents: Number(o.unitPriceCents),
      displayOrder: typeof o.displayOrder === "number" ? o.displayOrder : undefined,
    };
  });
}

/** Create a draft quote (v1) — computes + freezes the charge stack, inserts header + lines. */
export async function createQuote(actor: AuthContext, input: CreateQuoteInput): Promise<{ id: string; version: number }> {
  const locationId = input.locationId;
  if (!locationId) throw new CateringQuoteError(400, "invalid_payload", "locationId is required");
  assertCanWrite(actor, locationId);

  const lines = resolveLines(input.lines);
  const pricing = await loadPricingContext(actor, locationId);
  const isDelivery = input.isDelivery ?? false;
  const deliveryFee = await resolveDeliveryFee(pricing, isDelivery, input.deliveryZoneId ?? null);
  const stack = computeChargeStack(lines.map((l) => l.lineTotalCents), deliveryFee, pricing.rates);

  const sb = getServiceRoleClient();
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

  await insertQuoteItems(sb, inserted.id, lines, actor.user.id);

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
 * validated + the new stack computed BEFORE the supersede UPDATE, so a failed insert can't
 * strand the family without a live revision.
 */
export async function reviseQuote(actor: AuthContext, quoteId: string, input: ReviseQuoteInput): Promise<{ id: string; version: number }> {
  const sb = getServiceRoleClient();
  const { data: current, error: lErr } = await sb
    .from("catering_quotes")
    .select("id, root_id, version, location_id, pipeline_id, customer_id, superseded_at")
    .eq("id", quoteId)
    .maybeSingle<{ id: string; root_id: string | null; version: number; location_id: string; pipeline_id: string | null; customer_id: string | null; superseded_at: string | null }>();
  if (lErr) throw new Error(`reviseQuote load: ${lErr.message}`);
  if (!current) throw new CateringQuoteError(404, "not_found", "Quote not found");
  assertCanWrite(actor, current.location_id);
  if (current.superseded_at != null) {
    throw new CateringQuoteError(409, "not_current", "This quote revision has already been superseded");
  }

  // Validate + compute the new revision fully before touching the current row.
  const lines = resolveLines(input.lines);
  const pricing = await loadPricingContext(actor, current.location_id);
  const isDelivery = input.isDelivery ?? false;
  const deliveryFee = await resolveDeliveryFee(pricing, isDelivery, input.deliveryZoneId ?? null);
  const stack = computeChargeStack(lines.map((l) => l.lineTotalCents), deliveryFee, pricing.rates);

  // Supersede the current revision (guard: exactly the still-live row).
  const { error: sErr, count } = await sb
    .from("catering_quotes")
    .update({ superseded_at: new Date().toISOString() }, { count: "exact" })
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
      event_date: input.eventDate ?? null,
      headcount: input.headcount ?? null,
      ...snapshotColumns(pricing.rates, stack, isDelivery, input.deliveryZoneId ?? null),
      expires_at: input.expiresAt ?? defaultExpiry(),
      notes: input.notes ?? null,
      created_by: actor.user.id,
    })
    .select("id, version")
    .single<{ id: string; version: number }>();
  if (iErr) throw new Error(`reviseQuote insert: ${iErr.message}`);

  await insertQuoteItems(sb, inserted.id, lines, actor.user.id);

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.quote.revise",
    resourceTable: "catering_quotes",
    resourceId: inserted.id,
    metadata: { from_quote_id: quoteId, root_id: rootId, version: inserted.version, total_cents: stack.totalCents },
    ipAddress: null,
    userAgent: null,
  });
  return { id: inserted.id, version: inserted.version };
}

/** Transition a live quote's status (accept / decline / mark expired). Level-gated + audited. */
export async function setQuoteStatus(actor: AuthContext, id: string, status: Extract<QuoteStatus, "accepted" | "declined" | "expired">): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: row, error: lErr } = await sb
    .from("catering_quotes")
    .select("id, location_id, status, superseded_at")
    .eq("id", id)
    .maybeSingle<{ id: string; location_id: string; status: string; superseded_at: string | null }>();
  if (lErr) throw new Error(`setQuoteStatus load: ${lErr.message}`);
  if (!row) throw new CateringQuoteError(404, "not_found", "Quote not found");
  assertCanWrite(actor, row.location_id);
  if (row.superseded_at != null) throw new CateringQuoteError(409, "not_current", "Quote revision superseded");

  const { error: uErr, count } = await sb
    .from("catering_quotes")
    .update({ status }, { count: "exact" })
    .eq("id", id)
    .is("superseded_at", null);
  if (uErr) throw new Error(`setQuoteStatus update: ${uErr.message}`);
  if (count === 0) throw new CateringQuoteError(404, "not_found", "Quote not found");

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
  recipient: string | null;
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
    .select("id, location_id, status, superseded_at, customer_id, total_cents, expires_at")
    .eq("id", id)
    .maybeSingle<{ id: string; location_id: string; status: string; superseded_at: string | null; customer_id: string | null; total_cents: number; expires_at: string | null }>();
  if (lErr) throw new Error(`sendQuote load: ${lErr.message}`);
  if (!row) throw new CateringQuoteError(404, "not_found", "Quote not found");
  assertCanWrite(actor, row.location_id);
  if (row.superseded_at != null) throw new CateringQuoteError(409, "not_current", "Quote revision superseded");
  if (row.status !== "draft" && row.status !== "sent") {
    throw new CateringQuoteError(409, "invalid_status", "Only a draft or sent quote can be sent");
  }

  const { error: uErr, count } = await sb
    .from("catering_quotes")
    .update({ status: "sent", sent_at: new Date().toISOString(), sent_by: actor.user.id }, { count: "exact" })
    .eq("id", id)
    .is("superseded_at", null);
  if (uErr) throw new Error(`sendQuote update: ${uErr.message}`);
  if (count === 0) throw new CateringQuoteError(404, "not_found", "Quote not found");

  // Best-effort customer email (only delivers to Juan until Resend DNS is verified).
  let emailed = false;
  let recipient: string | null = null;
  let emailError: string | null = null;
  if (row.customer_id) {
    const { data: cust } = await sb
      .from("catering_customers")
      .select("email, name")
      .eq("id", row.customer_id)
      .maybeSingle<{ email: string | null; name: string | null }>();
    if (cust?.email) {
      recipient = cust.email;
      const total = (row.total_cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
      // Link to the shared customer review+pay surface (sign-in required). Only include it when
      // NEXT_PUBLIC_APP_URL is set — never emit a broken `undefined/...` URL into a sent email.
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      const quoteUrl = appUrl ? `${appUrl}/order/quote/${id}` : null;
      const htmlLink = quoteUrl
        ? `<p>View &amp; pay your quote: <a href="${quoteUrl}">${quoteUrl}</a> (sign-in required).</p>`
        : "";
      const textLink = quoteUrl ? `\n\nView & pay your quote: ${quoteUrl} (sign-in required).` : "";
      const res = await sendEmail({
        to: cust.email,
        subject: "Your catering quote from Compliments Only",
        html: `<p>Hi ${cust.name ?? "there"},</p><p>Your catering quote is ready. Estimated total: <strong>${total}</strong>.</p>${htmlLink}<p>Our team will follow up shortly to confirm the details.</p>`,
        text: `Hi ${cust.name ?? "there"},\n\nYour catering quote is ready. Estimated total: ${total}.${textLink}\n\nOur team will follow up shortly to confirm the details.`,
      });
      if ("id" in res) emailed = true;
      else emailError = res.error;
    }
  }

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.quote.send",
    resourceTable: "catering_quotes",
    resourceId: id,
    metadata: { emailed, recipient, email_error: emailError, total_cents: row.total_cents },
    ipAddress: null,
    userAgent: null,
  });
  return { emailed, recipient, emailError };
}
