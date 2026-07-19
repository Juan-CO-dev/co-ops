/**
 * Portal draft lifecycle — 3a (the order artifact's server-backed working state).
 *
 * SERVER-ONLY. Service-role writes; the authorization boundary is the customer principal
 * (customer_id ownership), re-checked on EVERY op — a non-owned / non-draft / missing quote
 * yields a 404/409, never leaking another customer's order.
 *
 * The artifact = the pipeline LEAD (mutable intake details) + its current QUOTE (versioned priced
 * doc), linked by pipeline_id. Born at intake as status='draft', origin='self_serve'. While
 * 'draft', line edits happen IN PLACE (replace catering_quote_items + recompute the charge stack
 * on the same row — no version churn per keystroke). On submitDraft the draft flips to 'submitted'
 * and becomes immutable; any later edit goes through the append-only reviseQuote (W-later).
 *
 * STRICT SERVER PRICE AUTHORITY (D20): the client submits item/menu_item/package REFERENCES +
 * quantities + portion ONLY. Every unit price is resolved from loadPublicCateringMenu (W1a
 * derivation). A client-supplied price is never read. With 0 catering rows the flow is correctly
 * DORMANT (no cart resolves) — proven via scripts/3a-smoke.ts.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { computeChargeStack, lineTotalCents } from "@/lib/catering/quotes";
import type { ChargeRates, ChargeStack } from "@/lib/catering/quotes";
import { loadPublicCateringMenu, loadPublicPricingContext } from "./menu";
import type { CateringMenuItem } from "@/lib/catering/menu";
import { createPaymentDue } from "@/lib/catering/payments";
import { sendEmail } from "@/lib/email";
import { renderOrderConfirmationEmail } from "@/lib/email-templates/order-confirmation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The dedicated menu section the napkins/utensils add-on lives in (excluded from the shopping list). */
export const ADDON_SECTION = "Add-ons";
const DEFAULT_EXPIRY_DAYS = 14; // D22 — same validity window as staff quotes
/** Input bounds (A-H4) — a cart can't be an unbounded-insert / integer-overflow DoS. */
export const MAX_CART_LINES = 200;
export const MAX_LINE_QTY = 100000;

export class PortalDraftError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "PortalDraftError";
  }
}

// ── Types ───────────────────────────────────────────────────────────────────────

/** The intake payload captured at /order/start and carried on the magic-link token. */
export interface DraftIntake {
  locationId: string;
  contactName: string;
  email?: string | null;
  company?: string | null;
  eventDate?: string | null;
  headcount?: number | null;
  isDelivery: boolean;
  deliveryAddress?: string | null;
  contactPhone?: string | null;
  timeWindow?: string | null;
  eventType?: string | null;
  dietaryNotes?: string | null;
  eventName?: string | null;
  dropoffDoor?: string | null;
}

export type Portion = "quarter" | "half" | "whole";

/** A cart line reference (no price — D20). Exactly one of itemId / menuItemId. */
export interface DraftLineInput {
  itemId?: string | null;
  menuItemId?: string | null;
  packageId?: string | null;
  portion?: Portion | null;
  quantity: number;
}

export interface DraftItem {
  id: string;
  itemId: string | null;
  menuItemId: string | null;
  packageId: string | null;
  portion: Portion | null;
  description: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  displayOrder: number;
}

/** The lead's intake detail fields the review recap shows. */
export interface DraftLead {
  contactName: string;
  company: string | null;
  eventDate: string | null;
  headcount: number | null;
  contactPhone: string | null;
  deliveryAddress: string | null;
  timeWindow: string | null;
  eventType: string | null;
  dietaryNotes: string | null;
  eventName: string | null;
  dropoffDoor: string | null;
}

export interface DraftView {
  quoteId: string;
  pipelineId: string | null;
  locationId: string;
  status: string;
  isDelivery: boolean;
  deliveryZoneId: string | null;
  stack: ChargeStack;
  items: DraftItem[];
}

/** loadDraft's full payload: the build page's data (draft + real menu + lead intake + napkins add-on). */
export interface DraftLoad extends DraftView {
  lead: DraftLead | null;
  menu: CateringMenuItem[];
  addonNapkins: CateringMenuItem | null;
}

// ── Shared internals ──────────────────────────────────────────────────────────────

/** Max customer tip = 50% in bps (the UI offers ≤20%; this is a generous adversarial ceiling). */
const MAX_TIP_BPS = 5000;

/** Self-serve overrides the rule's gratuity with the customer's chosen tip. The tip is the ONE
 * customer-controlled rate on the money path (D20 owns every unit price), so it is validated at
 * this single chokepoint (A-H1): a non-integer, negative, NaN/Infinity, or out-of-range tip is a
 * clean 400 — never trusted into computeChargeStack, never depending on a DB CHECK backstop. */
function ratesWithTip(base: ChargeRates, tipBps: number | null | undefined): ChargeRates {
  if (tipBps == null) return { ...base, gratuityBps: 0 };
  if (!Number.isInteger(tipBps) || tipBps < 0 || tipBps > MAX_TIP_BPS) {
    throw new PortalDraftError(400, "invalid_tip", "Tip must be a whole number between 0 and 50%");
  }
  return { ...base, gratuityBps: tipBps };
}

/** EXACT snapshot column shape (rates + stack + delivery) — mirrors lib/catering/quotes.ts. */
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

interface DraftHeader {
  id: string;
  location_id: string;
  is_delivery: boolean;
  delivery_zone_id: string | null;
  pipeline_id: string | null;
}

/**
 * Load an OWNED, still-DRAFT quote header. Throws 404 if missing or not owned, 409 if not 'draft'.
 * The authorization boundary is customer_id.
 */
async function loadOwnedDraftHeader(
  sb: ReturnType<typeof getServiceRoleClient>,
  customerId: string,
  quoteId: string,
): Promise<DraftHeader> {
  if (!UUID_RE.test(quoteId)) throw new PortalDraftError(404, "not_found", "Draft not found");
  const { data: row, error } = await sb
    .from("catering_quotes")
    .select("id, customer_id, location_id, status, superseded_at, is_delivery, delivery_zone_id, pipeline_id")
    .eq("id", quoteId)
    .maybeSingle<{
      id: string; customer_id: string | null; location_id: string; status: string;
      superseded_at: string | null; is_delivery: boolean; delivery_zone_id: string | null; pipeline_id: string | null;
    }>();
  if (error) throw new Error(`loadOwnedDraftHeader: ${error.message}`);
  if (!row || row.customer_id !== customerId) throw new PortalDraftError(404, "not_found", "Draft not found");
  if (row.superseded_at != null || row.status !== "draft") {
    throw new PortalDraftError(409, "not_draft", "This order can no longer be edited");
  }
  return { id: row.id, location_id: row.location_id, is_delivery: row.is_delivery, delivery_zone_id: row.delivery_zone_id, pipeline_id: row.pipeline_id };
}

// ── Create (from intake, post-verify) ─────────────────────────────────────────────

/**
 * Create the order artifact from a verified customer's intake: a pipeline lead (stage 'inquiry',
 * lead_source 'portal', + intake detail fields) + a draft quote (status 'draft', origin
 * 'self_serve', 0 lines, all charges 0). Called from consumeMagicLink AFTER email verification —
 * never before (no unverified/competitor rows). Returns the draft handle the flow carries.
 */
export async function createDraftFromIntake(customerId: string, intake: DraftIntake): Promise<{ quoteId: string; pipelineId: string }> {
  if (!UUID_RE.test(intake.locationId)) throw new PortalDraftError(400, "invalid_location", "A valid location is required");
  if (!intake.contactName || intake.contactName.trim().length === 0) throw new PortalDraftError(400, "invalid_payload", "contactName is required");
  if (intake.headcount != null && (!Number.isFinite(Number(intake.headcount)) || Number(intake.headcount) < 0)) {
    throw new PortalDraftError(400, "invalid_headcount", "headcount must be zero or greater");
  }
  const sb = getServiceRoleClient();

  const { data: lead, error: leadErr } = await sb
    .from("catering_pipeline")
    .insert({
      contact_name: intake.contactName.trim(),
      company: intake.company ?? null,
      event_date: intake.eventDate ?? null,
      headcount: intake.headcount ?? null,
      contact_phone: intake.contactPhone ?? null,
      delivery_address: intake.deliveryAddress ?? null,
      time_window: intake.timeWindow ?? null,
      event_type: intake.eventType ?? null,
      dietary_notes: intake.dietaryNotes ?? null,
      event_name: intake.eventName ?? null,
      dropoff_door: intake.dropoffDoor ?? null,
      stage: "inquiry",
      lead_source: "portal",
      location_id: intake.locationId,
      customer_id: customerId,
      created_by: null,
    })
    .select("id")
    .single<{ id: string }>();
  if (leadErr) throw new Error(`createDraftFromIntake lead: ${leadErr.message}`);

  const { error: evErr } = await sb.from("catering_pipeline_events").insert({
    pipeline_id: lead.id, from_stage: null, to_stage: "inquiry", note: null, actor_id: null,
  });
  if (evErr) throw new Error(`createDraftFromIntake lead event: ${evErr.message}`);

  const { data: quote, error: qErr } = await sb
    .from("catering_quotes")
    .insert({
      root_id: null, version: 1, pipeline_id: lead.id, customer_id: customerId,
      location_id: intake.locationId, status: "draft", origin: "self_serve",
      event_date: intake.eventDate ?? null, headcount: intake.headcount ?? null,
      is_delivery: intake.isDelivery, created_by: null,
    })
    .select("id")
    .single<{ id: string }>();
  if (qErr) throw new Error(`createDraftFromIntake quote: ${qErr.message}`);

  void audit({
    actorId: null, actorRole: null, action: "catering.draft.create",
    resourceTable: "catering_quotes", resourceId: quote.id,
    metadata: { pipeline_id: lead.id, customer_id: customerId, location_id: intake.locationId }, ipAddress: null, userAgent: null,
  });
  return { quoteId: quote.id, pipelineId: lead.id };
}

// ── Load (build page data) ─────────────────────────────────────────────────────────

/** The build page's data: the owned draft (header + lines + stack) + the real menu + the lead's
 * intake fields + the napkins add-on. Null if not owned / not found (never leak). */
export async function loadDraft(customerId: string, quoteId: string): Promise<DraftLoad | null> {
  if (!UUID_RE.test(quoteId)) return null;
  const sb = getServiceRoleClient();
  const { data: row, error } = await sb
    .from("catering_quotes")
    .select("id, customer_id, pipeline_id, location_id, status, is_delivery, delivery_zone_id, subtotal_cents, delivery_fee_cents, service_charge_cents, gratuity_cents, tax_cents, total_cents, deposit_cents")
    .eq("id", quoteId)
    .maybeSingle<{
      id: string; customer_id: string | null; pipeline_id: string | null; location_id: string; status: string;
      is_delivery: boolean; delivery_zone_id: string | null; subtotal_cents: number; delivery_fee_cents: number;
      service_charge_cents: number; gratuity_cents: number; tax_cents: number; total_cents: number; deposit_cents: number;
    }>();
  if (error) throw new Error(`loadDraft quote: ${error.message}`);
  if (!row || row.customer_id !== customerId) return null;

  const [{ data: itemRows, error: iErr }, menuAll, lead] = await Promise.all([
    sb.from("catering_quote_items")
      .select("id, item_id, menu_item_id, package_id, description, quantity, unit_price_cents, line_total_cents, display_order, portion")
      .eq("quote_id", quoteId).order("display_order", { ascending: true })
      .returns<Array<{ id: string; item_id: string | null; menu_item_id: string | null; package_id: string | null; description: string | null; quantity: number; unit_price_cents: number; line_total_cents: number; display_order: number; portion: string | null }>>(),
    loadPublicCateringMenu(row.location_id),
    loadDraftLead(sb, row.pipeline_id),
  ]);
  if (iErr) throw new Error(`loadDraft items: ${iErr.message}`);

  const addonNapkins = menuAll.find((m) => m.section === ADDON_SECTION) ?? null;
  const menu = menuAll.filter((m) => m.section !== ADDON_SECTION);
  const items: DraftItem[] = (itemRows ?? []).map((r) => ({
    id: r.id, itemId: r.item_id, menuItemId: r.menu_item_id, packageId: r.package_id,
    portion: r.portion === "quarter" || r.portion === "half" || r.portion === "whole" ? r.portion : null,
    description: r.description, quantity: Number(r.quantity), unitPriceCents: r.unit_price_cents,
    lineTotalCents: r.line_total_cents, displayOrder: r.display_order,
  }));

  return {
    quoteId: row.id, pipelineId: row.pipeline_id, locationId: row.location_id, status: row.status,
    isDelivery: row.is_delivery, deliveryZoneId: row.delivery_zone_id,
    stack: {
      subtotalCents: row.subtotal_cents, deliveryFeeCents: row.delivery_fee_cents,
      serviceChargeCents: row.service_charge_cents, gratuityCents: row.gratuity_cents,
      taxCents: row.tax_cents, totalCents: row.total_cents, depositCents: row.deposit_cents,
    },
    items, lead, menu, addonNapkins,
  };
}

async function loadDraftLead(sb: ReturnType<typeof getServiceRoleClient>, pipelineId: string | null): Promise<DraftLead | null> {
  if (!pipelineId) return null;
  const { data, error } = await sb
    .from("catering_pipeline")
    .select("contact_name, company, event_date, headcount, contact_phone, delivery_address, time_window, event_type, dietary_notes, event_name, dropoff_door")
    .eq("id", pipelineId)
    .maybeSingle<{ contact_name: string; company: string | null; event_date: string | null; headcount: number | null; contact_phone: string | null; delivery_address: string | null; time_window: string | null; event_type: string | null; dietary_notes: string | null; event_name: string | null; dropoff_door: string | null }>();
  if (error) throw new Error(`loadDraftLead: ${error.message}`);
  if (!data) return null;
  return {
    contactName: data.contact_name, company: data.company, eventDate: data.event_date, headcount: data.headcount,
    contactPhone: data.contact_phone, deliveryAddress: data.delivery_address, timeWindow: data.time_window,
    eventType: data.event_type, dietaryNotes: data.dietary_notes, eventName: data.event_name, dropoffDoor: data.dropoff_door,
  };
}

// ── Line resolution (D20 server price authority) ───────────────────────────────────

interface ResolvedLine {
  itemId: string | null; menuItemId: string | null; packageId: string | null;
  portion: Portion | null; description: string; quantity: number;
  unitPriceCents: number; lineTotalCents: number; displayOrder: number;
}

/** Resolve + price every line from the SERVER-owned menu (D20). A client price is never read. */
async function resolveLines(locationId: string, lines: DraftLineInput[]): Promise<ResolvedLine[]> {
  if (lines.length > MAX_CART_LINES) throw new PortalDraftError(400, "too_many_lines", `A cart can have at most ${MAX_CART_LINES} lines`);
  const menu = await loadPublicCateringMenu(locationId);
  // items and menu_items are separate id spaces → key the lookup by `${kind}:${id}` (mirrors orders.ts).
  const byKey = new Map(menu.map((m) => [`${m.kind}:${m.id}`, m] as const));
  return lines.map((l, i) => {
    const quantity = Number(l.quantity);
    // Integer + bounded (A-H4): a fractional qty isn't meaningful for whole units, and a huge qty
    // overflows the integer-cents columns → 500 + partial write.
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_LINE_QTY) {
      throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: quantity must be a whole number between 1 and ${MAX_LINE_QTY}`);
    }
    const itemId = l.itemId ?? null;
    const menuItemId = l.menuItemId ?? null;
    if (itemId != null && itemId !== "") {
      const it = byKey.get(`item:${itemId}`);
      if (!it) throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: unknown item`);
      return { itemId, menuItemId: null, packageId: null, portion: null, description: it.name, quantity, unitPriceCents: it.unitPriceCents, lineTotalCents: lineTotalCents(quantity, it.unitPriceCents), displayOrder: i };
    }
    if (menuItemId != null && menuItemId !== "") {
      const sub = byKey.get(`menu_item:${menuItemId}`);
      if (!sub) throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: unknown sub`);
      const portion: Portion = l.portion ?? "whole";
      if (!sub.portionable && portion !== "whole") throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: item is not portioned`);
      const unitPriceCents = sub.portionable && sub.portionPricesCents ? sub.portionPricesCents[portion] : sub.unitPriceCents;
      return { itemId: null, menuItemId, packageId: null, portion: sub.portionable ? portion : null, description: sub.name, quantity, unitPriceCents, lineTotalCents: lineTotalCents(quantity, unitPriceCents), displayOrder: i };
    }
    throw new PortalDraftError(400, "invalid_line", `Line ${i + 1}: needs an item or sub reference`);
  });
}

/** Resolve the delivery fee for a chosen zone (0 unless delivery + a valid zone for this location). */
async function resolveDeliveryFee(locationId: string, isDelivery: boolean, deliveryZoneId: string | null): Promise<number> {
  if (!isDelivery || deliveryZoneId == null) return 0;
  const pricing = await loadPublicPricingContext(locationId);
  const zone = pricing.zones.find((z) => z.id === deliveryZoneId);
  if (!zone) throw new PortalDraftError(400, "invalid_payload", "Delivery zone not found for this location");
  return zone.feeCents;
}

/** The draft's current persisted per-line totals (server-owned; never client-supplied). */
async function currentLineTotals(sb: ReturnType<typeof getServiceRoleClient>, quoteId: string): Promise<number[]> {
  const { data, error } = await sb.from("catering_quote_items").select("line_total_cents").eq("quote_id", quoteId).returns<Array<{ line_total_cents: number }>>();
  if (error) throw new Error(`currentLineTotals: ${error.message}`);
  return (data ?? []).map((r) => r.line_total_cents);
}

/** The napkins add-on menu item for a location (the first ADDON_SECTION row), or null. */
async function loadNapkinsAddon(locationId: string): Promise<CateringMenuItem | null> {
  const menu = await loadPublicCateringMenu(locationId);
  return menu.find((m) => m.section === ADDON_SECTION) ?? null;
}

// ── Set lines (build cart persistence, in place) ───────────────────────────────────

export interface SetLinesOpts { isDelivery?: boolean; deliveryZoneId?: string | null; tipBps?: number | null }

/** Replace the draft's lines + recompute + snapshot the charge stack IN PLACE (owned + 'draft'
 * only — no version churn). Returns the updated DraftView. */
export async function setDraftLines(customerId: string, quoteId: string, lines: DraftLineInput[], opts: SetLinesOpts = {}): Promise<DraftView> {
  const sb = getServiceRoleClient();
  const header = await loadOwnedDraftHeader(sb, customerId, quoteId);
  const isDelivery = opts.isDelivery ?? header.is_delivery;
  const deliveryZoneId = opts.deliveryZoneId !== undefined ? opts.deliveryZoneId : header.delivery_zone_id;

  // A-M3: ALL validation + the full charge stack are computed BEFORE any write — resolveLines
  // (bounds/refs), ratesWithTip (tip validation), and resolveDeliveryFee all throw here, before the
  // delete, so a bad payload can never leave the line items replaced with a stale snapshot. (Full
  // delete+insert+update transactional atomicity would need an RPC; the residual is only a sub-ms
  // concurrent-self-read window — tracked as an optional deeper fix.)
  const resolved = await resolveLines(header.location_id, lines);
  const pricing = await loadPublicPricingContext(header.location_id);
  const deliveryFee = await resolveDeliveryFee(header.location_id, isDelivery, deliveryZoneId);
  const rates = ratesWithTip(pricing.rates, opts.tipBps);
  const stack = computeChargeStack(resolved.map((l) => l.lineTotalCents), deliveryFee, rates);

  // Replace the line set (delete-then-insert; the quote stays the same row → no new version).
  const { error: delErr } = await sb.from("catering_quote_items").delete().eq("quote_id", quoteId);
  if (delErr) throw new Error(`setDraftLines delete: ${delErr.message}`);
  if (resolved.length > 0) {
    const { error: insErr } = await sb.from("catering_quote_items").insert(resolved.map((l) => ({
      quote_id: quoteId, item_id: l.itemId, menu_item_id: l.menuItemId, package_id: l.packageId,
      portion: l.portion, description: l.description, quantity: l.quantity,
      unit_price_cents: l.unitPriceCents, line_total_cents: l.lineTotalCents, display_order: l.displayOrder, created_by: null,
    })));
    if (insErr) throw new Error(`setDraftLines insert: ${insErr.message}`);
  }
  const { error: upErr } = await sb.from("catering_quotes")
    .update(snapshotColumns(rates, stack, isDelivery, deliveryZoneId))
    .eq("id", quoteId).eq("status", "draft");
  if (upErr) throw new Error(`setDraftLines update: ${upErr.message}`);

  return {
    quoteId, pipelineId: header.pipeline_id, locationId: header.location_id, status: "draft", isDelivery, deliveryZoneId, stack,
    items: resolved.map((l) => ({ id: `resolved-${l.displayOrder}`, itemId: l.itemId, menuItemId: l.menuItemId, packageId: l.packageId, portion: l.portion, description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, lineTotalCents: l.lineTotalCents, displayOrder: l.displayOrder })),
  };
}

// ── Preview (compute-only, review page) ────────────────────────────────────────────

export interface PreviewOpts { isDelivery?: boolean; deliveryZoneId?: string | null; tipBps?: number | null; napkins?: boolean }

/** Compute-only charge stack for the review page (owned + 'draft'). Reads the draft's CURRENT
 * persisted lines, optionally + the napkins add-on, applies the chosen tip/delivery — persists
 * NOTHING. Keeps the review breakdown server-authoritative (no client illustrative rates). */
export async function previewDraft(customerId: string, quoteId: string, opts: PreviewOpts = {}): Promise<ChargeStack> {
  const sb = getServiceRoleClient();
  const header = await loadOwnedDraftHeader(sb, customerId, quoteId);
  const lineTotals = await currentLineTotals(sb, quoteId);
  if (opts.napkins) {
    const napkins = await loadNapkinsAddon(header.location_id);
    if (napkins) lineTotals.push(lineTotalCents(1, napkins.unitPriceCents));
  }
  const pricing = await loadPublicPricingContext(header.location_id);
  const isDelivery = opts.isDelivery ?? header.is_delivery;
  const deliveryZoneId = opts.deliveryZoneId !== undefined ? opts.deliveryZoneId : header.delivery_zone_id;
  const deliveryFee = await resolveDeliveryFee(header.location_id, isDelivery, deliveryZoneId);
  return computeChargeStack(lineTotals, deliveryFee, ratesWithTip(pricing.rates, opts.tipBps));
}

// ── Submit (draft → submitted, the one completing click) ───────────────────────────

export interface SubmitOpts { isDelivery?: boolean; deliveryZoneId?: string | null; tipBps?: number | null; napkins?: boolean }
export interface SubmitResult { quoteId: string; depositCents: number; totalCents: number }

function defaultExpiry(): string { return new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86400 * 1000).toISOString(); }
function allowlisted(email: string): boolean {
  const raw = process.env.PORTAL_MAGIC_LINK_ALLOWLIST ?? "juan@complimentsonlysubs.com";
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}
function centsToUsd(cents: number): string { return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }); }
function eventDateLabel(d: string | null): string {
  if (!d) return "your event";
  const t = Date.parse(`${d}T00:00:00`);
  return Number.isNaN(t) ? "your event" : new Date(t).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** Complete the order: draft → 'submitted' (immutable), add napkins if toggled, freeze the
 * authoritative charge stack, create the deposit-due payment intent, best-effort confirm email,
 * audit. Owned + 'draft' only. Requires at least one line. */
export async function submitDraft(customerId: string, quoteId: string, opts: SubmitOpts = {}): Promise<SubmitResult> {
  const sb = getServiceRoleClient();
  const header = await loadOwnedDraftHeader(sb, customerId, quoteId);

  const baseLineTotals = await currentLineTotals(sb, quoteId);
  if (baseLineTotals.length === 0) throw new PortalDraftError(400, "empty_cart", "Your order is empty");

  // Resolve the napkins add-on price UP FRONT (to fold into the snapshot) but do NOT insert the line
  // yet — only the submit that WINS the atomic status flip may mutate line items or create a payment
  // (A-M4: two concurrent submits must not both append napkins onto a now-immutable quote).
  const napkins = opts.napkins ? await loadNapkinsAddon(header.location_id) : null;
  const napkinsTotal = napkins ? lineTotalCents(1, napkins.unitPriceCents) : null;
  const lineTotals = napkinsTotal != null ? [...baseLineTotals, napkinsTotal] : baseLineTotals;

  const pricing = await loadPublicPricingContext(header.location_id);
  const isDelivery = opts.isDelivery ?? header.is_delivery;
  const deliveryZoneId = opts.deliveryZoneId !== undefined ? opts.deliveryZoneId : header.delivery_zone_id;
  const deliveryFee = await resolveDeliveryFee(header.location_id, isDelivery, deliveryZoneId);
  const rates = ratesWithTip(pricing.rates, opts.tipBps);
  const stack = computeChargeStack(lineTotals, deliveryFee, rates);

  // ATOMIC CLAIM: flip draft → submitted with the final (napkins-inclusive) snapshot. Guard on
  // status='draft' — the LOSER of a double-submit gets count=0 → 409 having mutated NOTHING.
  const { error: upErr, count } = await sb.from("catering_quotes")
    .update({ status: "submitted", ...snapshotColumns(rates, stack, isDelivery, deliveryZoneId), expires_at: defaultExpiry() }, { count: "exact" })
    .eq("id", quoteId).eq("status", "draft");
  if (upErr) throw new Error(`submitDraft flip: ${upErr.message}`);
  if (count === 0) throw new PortalDraftError(409, "not_draft", "This order was already submitted");

  // WON the claim — now it is safe to append the napkins line (only one submitter reaches here).
  if (napkins) {
    const { error: nErr } = await sb.from("catering_quote_items").insert({
      quote_id: quoteId, item_id: napkins.id, menu_item_id: null, package_id: null, portion: null,
      description: napkins.name, quantity: 1, unit_price_cents: napkins.unitPriceCents,
      line_total_cents: lineTotalCents(1, napkins.unitPriceCents), display_order: baseLineTotals.length, created_by: null,
    });
    if (nErr) throw new Error(`submitDraft napkins: ${nErr.message}`);
  }

  // Deposit-due payment intent (self-serve is deposit-required).
  await createPaymentDue(sb, { quoteId, customerId, kind: "deposit", amountCents: stack.depositCents, createdBy: customerId });

  // Best-effort confirmation email (allowlist-gated; never throws).
  try {
    const { data: cust } = await sb.from("catering_customers").select("name, email").eq("id", customerId).maybeSingle<{ name: string | null; email: string | null }>();
    if (cust?.email && allowlisted(cust.email) && process.env.NEXT_PUBLIC_APP_URL) {
      const { data: qRow } = await sb.from("catering_quotes").select("event_date").eq("id", quoteId).maybeSingle<{ event_date: string | null }>();
      const name = cust.name ?? cust.email;
      const dateLabel = eventDateLabel(qRow?.event_date ?? null);
      await sendEmail({
        to: cust.email, subject: "We got your catering order — Compliments Only",
        html: renderOrderConfirmationEmail({ name, eventDateLabel: dateLabel, totalCents: stack.totalCents, depositCents: stack.depositCents }),
        text: `Hi ${name},\n\nWe received your catering order for ${dateLabel}. Estimated total: ${centsToUsd(stack.totalCents)}. A ${centsToUsd(stack.depositCents)} deposit reserves the date.\n\nWe'll confirm within about 24 hours. If we're not able to do your date, your deposit is refunded in full.`,
      });
    }
  } catch (err) {
    console.error("[portal draft] confirmation email failed:", err instanceof Error ? err.message : String(err));
  }

  void audit({
    actorId: null, actorRole: null, action: "catering.draft.submit",
    resourceTable: "catering_quotes", resourceId: quoteId,
    metadata: { customer_id: customerId, total_cents: stack.totalCents, deposit_cents: stack.depositCents, napkins: !!opts.napkins }, ipAddress: null, userAgent: null,
  });
  return { quoteId, depositCents: stack.depositCents, totalCents: stack.totalCents };
}
