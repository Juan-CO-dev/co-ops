/**
 * Catering pipeline data layer — Wave 1 slice 1C.
 *
 * SERVER-ONLY. Service-role reads/writes; authorization is APP-LAYER (requireLevel +
 * lockLocationContext), consistent with lib/cash.ts and the admin lib. The lead row is
 * a MUTABLE CRM row (D3 — contact/date/headcount/notes edit in place); stage transitions
 * are APPEND-ONLY events in catering_pipeline_events (never edited/deleted; RLS on that
 * table is parent-anchored per 0113, but writes here go via service-role).
 *
 * Attribution is derivable without new columns: created_by = who ACQUIRED the lead,
 * lead_source = the SOURCE, and each catering_pipeline_events.actor_id = who WORKED that
 * stage move. The capacity signal (slice 1B) is computed on demand per lead, not for the
 * whole board (keeps the board loader lean).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel, type RoleCode } from "@/lib/roles";
import { lockLocationContext } from "@/lib/locations";
import { audit } from "@/lib/audit";
import { canReadCateringLead, loadCateringReader } from "./ezcater-detail";
import { canReadCateringContact } from "./ezcater-detail-shared";
import type { AuthContext } from "@/lib/session";
import { checkCateringCapacity, type CateringCapacityResult } from "@/lib/catering/capacity";
import { reservePrepDemand, consumePrepDemand, releasePrepDemand, assertQuoteReadyForPrep, PrepDemandNeedsRepairError } from "@/lib/catering/prep-demand";

// ── Stage vocabulary ─────────────────────────────────────────────────────────
import { PIPELINE_STAGES, type PipelineStage, canTransition, normalizeLeadEmail, normalizeLeadPhone } from "./pipeline-shared";
import { resolveOrCreateContact } from "./companies";
import { isLeadSource } from "./intake-shared";
import { ezcaterReopenTarget } from "@/lib/ezcater/lifecycle-shared";
// Client-safe stage vocabulary lives in pipeline-shared.ts; re-exported for
// existing server consumers.
export { PIPELINE_STAGES, type PipelineStage };
export function isPipelineStage(v: unknown): v is PipelineStage {
  return typeof v === "string" && (PIPELINE_STAGES as readonly string[]).includes(v);
}
/** Terminal stages — excluded from the follow-up queue. */
const TERMINAL_STAGES: PipelineStage[] = ["completed", "lost"];

// ── Authority floors ──────────────────────────────────────────────────────────
export const PIPELINE_READ_MIN = 5; // shift_lead+ may VIEW (open-decision: grant L5 view)
export const PIPELINE_WRITE_MIN = 6; // catering_mgr+ may EDIT (catering.pipeline.write)

export class CateringPipelineError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "CateringPipelineError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new CateringPipelineError(403, "forbidden", "Insufficient role level");
  }
}

/** New lead_source writes must come from the intake registry (legacy free text stays readable). */
function validateLeadSource(v: string | null | undefined): void {
  if (v != null && !isLeadSource(v)) {
    throw new CateringPipelineError(400, "invalid_source", "Unknown lead source");
  }
}

/** D-48: a lead phone is stored trimmed (empty → null); too long is refused WITHOUT the value. */
function leadPhone(v: string | null | undefined): string | null {
  const r = normalizeLeadPhone(v);
  if (!r.ok) throw new CateringPipelineError(400, "invalid_payload", "contactPhone is too long");
  return r.value;
}

/** The "order lead" must be an active staff member (level >= 3). */
async function requireAssignable(userId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("users").select("id, role, active")
    .eq("id", userId).maybeSingle<{ id: string; role: RoleCode; active: boolean }>();
  if (error) throw new Error(`pipeline assignable check: ${error.message}`);
  if (!data || !data.active || getRoleLevel(data.role) < 3) {
    throw new CateringPipelineError(400, "invalid_assignee", "Assignee must be an active staff member");
  }
}

/** LocationActor shape from the AuthContext for lockLocationContext / isAllLocationsAccess. */
function locActor(actor: AuthContext): { role: AuthContext["user"]["role"]; locations: string[] } {
  return { role: actor.user.role, locations: actor.locations };
}

/**
 * A supplied `customerId` is a WRITE TARGET (BC-022): it must name a contact the actor may
 * see — active, and homed at one of the actor's shops (or at no shop). Sibling of
 * requireAssignable, which already validates `assignedTo` right beside it; a bare uuid that
 * was only shape-checked let a lead be pinned to the other shop's customer and then have that
 * customer's email surfaced by searchPipeline's enrichment (audit v2 P3, 2026-09-01).
 * 400 `invalid_customer` (requireAssignable's shape) — a write-target rejection, not a 404.
 */
async function requireVisibleCustomer(actor: AuthContext, customerId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_customers")
    .select("id, active, primary_location_id")
    .eq("id", customerId)
    .maybeSingle<{ id: string; active: boolean; primary_location_id: string | null }>();
  if (error) throw new Error(`pipeline customer check: ${error.message}`);
  const visible =
    !!data &&
    data.active &&
    (data.primary_location_id == null || lockLocationContext(locActor(actor), data.primary_location_id));
  if (!visible) {
    throw new CateringPipelineError(400, "invalid_customer", "Customer not found");
  }
}

/**
 * A lead is writable when the actor is level >= WRITE_MIN AND either the lead is
 * global (location_id null) or the actor holds that location. Mirrors the scaffold
 * RLS (level >= 6 AND (location null OR location match)).
 */
function assertCanWriteLead(actor: AuthContext, leadLocationId: string | null): void {
  requireLevel(actor, PIPELINE_WRITE_MIN);
  if (leadLocationId != null && !lockLocationContext(locActor(actor), leadLocationId)) {
    throw new CateringPipelineError(403, "location_access_denied", "You do not manage that location");
  }
}

// ── View types ────────────────────────────────────────────────────────────────
export interface PipelineLead {
  id: string;
  customerId: string | null;
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
  stage: PipelineStage;
  leadSource: string | null;
  locationId: string | null;
  /**
   * The shop's NAME, read from the `locations` table (never derived from the code: prod codes
   * are crossed, EM = P Street and MEP = Capitol Hill). Null for a tenant-wide lead or a
   * location the name read could not resolve.
   */
  locationName: string | null;
  notes: string | null;
  followUpDate: string | null;
  estimatedRevenueCents: number | null;
  /** The "order lead" — the client-facing owner of this order (spec #2b). */
  assignedTo: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface DbLeadRow {
  id: string;
  customer_id: string | null;
  contact_name: string;
  company: string | null;
  event_date: string | null;
  headcount: number | null;
  contact_phone: string | null;
  delivery_address: string | null;
  time_window: string | null;
  event_type: string | null;
  dietary_notes: string | null;
  event_name: string | null;
  dropoff_door: string | null;
  stage: string;
  lead_source: string | null;
  location_id: string | null;
  notes: string | null;
  follow_up_date: string | null;
  estimated_revenue_cents: number | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

const LEAD_COLS =
  "id, customer_id, contact_name, company, event_date, headcount, contact_phone, delivery_address, time_window, event_type, dietary_notes, event_name, dropoff_door, stage, lead_source, location_id, notes, follow_up_date, estimated_revenue_cents, assigned_to, created_by, created_at, updated_at";

export function mapLead(r: DbLeadRow): PipelineLead {
  return {
    id: r.id,
    customerId: r.customer_id,
    contactName: r.contact_name,
    company: r.company,
    eventDate: r.event_date,
    headcount: r.headcount,
    contactPhone: r.contact_phone,
    deliveryAddress: r.delivery_address,
    timeWindow: r.time_window,
    eventType: r.event_type,
    dietaryNotes: r.dietary_notes,
    eventName: r.event_name,
    dropoffDoor: r.dropoff_door,
    stage: (isPipelineStage(r.stage) ? r.stage : "inquiry"),
    leadSource: r.lead_source,
    locationId: r.location_id,
    locationName: null,
    notes: r.notes,
    followUpDate: r.follow_up_date,
    estimatedRevenueCents: r.estimated_revenue_cents,
    assignedTo: r.assigned_to,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Stamp each lead with its shop's NAME from the `locations` table (one extra read over the
 * distinct location ids; no FK-embed dependency). The label is the table's name, never a map
 * in code and never derived from the location code.
 */
export async function withLocationNames<T extends PipelineLead>(
  sb: ReturnType<typeof getServiceRoleClient>,
  leads: T[],
): Promise<T[]> {
  const ids = [...new Set(leads.map((l) => l.locationId).filter((x): x is string => x != null))];
  if (ids.length === 0) return leads;
  const { data, error } = await sb
    .from("locations")
    .select("id, name")
    .in("id", ids)
    .returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`withLocationNames: ${error.message}`);
  const names = new Map((data ?? []).map((r) => [r.id, r.name]));
  return leads.map((l) => ({ ...l, locationName: l.locationId ? names.get(l.locationId) ?? null : null }));
}

/** Catering reads: catering manager and level 8+ see all shops; writes retain their own scope. */
async function readScopeOr(actor: AuthContext): Promise<string | null> {
  const reader = await loadCateringReader(actor);
  if (!reader || getRoleLevel(reader.role) < PIPELINE_READ_MIN) throw new CateringPipelineError(403, "forbidden");
  if (reader.role === "catering_mgr" || getRoleLevel(reader.role) >= 8) return null;
  const ids = reader.locations;
  return ids.length === 0
    ? "location_id.is.null"
    : `location_id.is.null,location_id.in.(${ids.join(",")})`;
}

// ── Reads ───────────────────────────────────────────────────────────────────
/** A board lead: the lead plus its current quote's status where the board needs it. */
export interface PipelineBoardLead extends PipelineLead {
  /**
   * Status of the lead's CURRENT quote (latest non-superseded) — loaded for Confirmed leads
   * only, for the D-46 "quote not accepted" chip; null for every other stage or no quote.
   */
  quoteStatus: string | null;
}

/** Ids per `.in()` read — keeps the request line well under the 414 found at ~220 ids. */
const QUOTE_STATUS_CHUNK = 100;
function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The current (latest non-superseded) quote status per lead id. Status only — no contact. */
async function currentQuoteStatuses(
  sb: ReturnType<typeof getServiceRoleClient>,
  leadIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < leadIds.length; i += QUOTE_STATUS_CHUNK) {
    const { data, error } = await sb
      .from("catering_quotes")
      .select("pipeline_id, status, created_at")
      .in("pipeline_id", leadIds.slice(i, i + QUOTE_STATUS_CHUNK))
      .is("superseded_at", null)
      .order("created_at", { ascending: false })
      .returns<Array<{ pipeline_id: string; status: string; created_at: string }>>();
    if (error) throw new Error(`currentQuoteStatuses: ${error.message}`);
    for (const r of data ?? []) if (!out.has(r.pipeline_id)) out.set(r.pipeline_id, r.status); // first seen = latest
  }
  return out;
}

/** All non-archived leads the actor may view, for the board (grouped client-side by stage). */
export async function loadPipelineBoard(actor: AuthContext): Promise<PipelineBoardLead[]> {
  requireLevel(actor, PIPELINE_READ_MIN);
  const sb = getServiceRoleClient();
  let q = sb.from("catering_pipeline").select(LEAD_COLS);
  const scope = await readScopeOr(actor);
  if (scope) q = q.or(scope);
  const { data, error } = await q.order("created_at", { ascending: false }).returns<DbLeadRow[]>();
  if (error) throw new Error(`loadPipelineBoard: ${error.message}`);
  const leads = await withLocationNames(sb, (data ?? []).map(mapLead));
  const confirmedIds = leads.filter((l) => l.stage === "confirmed").map((l) => l.id);
  const statuses = confirmedIds.length ? await currentQuoteStatuses(sb, confirmedIds) : new Map<string, string>();
  return leads.map((l) => ({ ...l, quoteStatus: statuses.get(l.id) ?? null }));
}

export interface PipelineSearchResult extends PipelineLead {
  email: string | null;
  quoteStatus: string | null;
  quoteTotalCents: number | null;
}

/**
 * Federated ilike search over leads + their customer (email/phone/name) + company name.
 * Location-scoped (readScopeOr) + injection-sanitized (mirrors lib/admin/users.ts listUsers).
 * Enriches each result with the customer email + the current (latest non-superseded) quote.
 */
export async function searchPipeline(actor: AuthContext, args: { query: string }): Promise<PipelineSearchResult[]> {
  requireLevel(actor, PIPELINE_READ_MIN);
  // A-WB4-01 filter-injection defense: strip PostgREST structural chars from the .or() term.
  const raw = args.query.trim().replace(/[,()\\"]/g, "");
  if (!raw) return [];
  const sb = getServiceRoleClient();
  const term = `%${raw}%`;

  // B5 review 3: a lead the actor may read can still point at ANOTHER shop's customer (a
  // transfer keeps customer_id; option b attaches by email). That customer's saved contact is
  // not the actor's: it may neither MATCH a search (or a typed email/phone would confirm it)
  // nor be RETURNED as the result's email. Same catering contact policy, fail-closed.
  const reader = await loadCateringReader(actor);
  const customerReadable = (primaryLocationId: string | null) =>
    !!reader && canReadCateringContact(reader, primaryLocationId);

  // W23/B208: no read here spends an unbounded id list in the request line (a broad term like
  // "gmail" put ~250 customer ids into one .or() and the gateway refused it), and none truncates
  // at the 1,000-row cap: id filters go in chunks of QUOTE_STATUS_CHUNK, row reads page, and every
  // enrichment read checks its error instead of silently dropping an email or a quote status.
  // 1. Customer ids matching email/phone/name, plus customers of companies whose name matches —
  //    readable customers only.
  const matchedCustomerIds = new Set<string>();
  const custRows = await selectAllRows<{ id: string; primary_location_id: string | null }>((from, to) => sb
    .from("catering_customers")
    .select("id, primary_location_id")
    .or(`email.ilike.${term},phone.ilike.${term},name.ilike.${term}`)
    .order("id", { ascending: true }).range(from, to)
    .returns<Array<{ id: string; primary_location_id: string | null }>>());
  for (const c of custRows) if (customerReadable(c.primary_location_id)) matchedCustomerIds.add(c.id);

  const compRows = await selectAllRows<{ id: string }>((from, to) => sb
    .from("catering_companies")
    .select("id")
    .ilike("name", term)
    .order("id", { ascending: true }).range(from, to)
    .returns<Array<{ id: string }>>());
  const companyIds = compRows.map((c) => c.id);
  for (const chunk of chunked(companyIds, QUOTE_STATUS_CHUNK)) {
    const compCust = await selectAllRows<{ id: string; primary_location_id: string | null }>((from, to) => sb
      .from("catering_customers")
      .select("id, primary_location_id")
      .in("company_id", chunk)
      .order("id", { ascending: true }).range(from, to)
      .returns<Array<{ id: string; primary_location_id: string | null }>>());
    for (const c of compCust) if (customerReadable(c.primary_location_id)) matchedCustomerIds.add(c.id);
  }

  // 2. Search leads: own text fields OR matched customer ids, location-scoped. The OR is split
  //    into one text query plus one query per customer-id chunk, each AND-ed with the same scope,
  //    then merged by id — the same row set as the single OR, without the unbounded list.
  const scope = await readScopeOr(actor);
  const textOr = [`contact_name.ilike.${term}`, `company.ilike.${term}`, `contact_phone.ilike.${term}`, `event_name.ilike.${term}`].join(",");
  const leadQuery = (customerIds: string[] | null) =>
    selectAllRows<DbLeadRow>((from, to) => {
      let q = sb.from("catering_pipeline").select(LEAD_COLS);
      if (scope) q = q.or(scope); // AND-ed with the identity filter below (two filters = AND)
      q = customerIds ? q.in("customer_id", customerIds) : q.or(textOr);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to).returns<DbLeadRow[]>();
    });
  const byId = new Map<string, DbLeadRow>();
  for (const r of await leadQuery(null)) byId.set(r.id, r);
  for (const chunk of chunked([...matchedCustomerIds], QUOTE_STATUS_CHUNK)) {
    for (const r of await leadQuery(chunk)) byId.set(r.id, r);
  }
  const leadRows = [...byId.values()].sort((a, b) =>
    a.created_at === b.created_at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : (a.created_at < b.created_at ? 1 : -1));
  const leads = await withLocationNames(sb, leadRows.map(mapLead));
  if (leads.length === 0) return [];

  // 3. Enrich: email (per customer) + current quote (latest non-superseded per lead).
  const custIds = [...new Set(leads.map((l) => l.customerId).filter((x): x is string => !!x))];
  const emailByCustomer = new Map<string, string | null>();
  for (const chunk of chunked(custIds, QUOTE_STATUS_CHUNK)) {
    const { data, error: eErr } = await sb.from("catering_customers").select("id, email, primary_location_id").in("id", chunk)
      .returns<Array<{ id: string; email: string | null; primary_location_id: string | null }>>();
    if (eErr) throw new Error(`searchPipeline emails: ${eErr.message}`);
    // An unreadable customer's email is omitted, never returned (review 3).
    for (const c of data ?? []) emailByCustomer.set(c.id, customerReadable(c.primary_location_id) ? c.email : null);
  }
  const leadIds = leads.map((l) => l.id);
  const quoteByLead = new Map<string, { status: string; total_cents: number }>();
  // A lead id sits in exactly one chunk, so "first seen per lead in created_at desc" holds per chunk.
  for (const chunk of chunked(leadIds, QUOTE_STATUS_CHUNK)) {
    const qRows = await selectAllRows<{ pipeline_id: string; status: string; total_cents: number; created_at: string }>((from, to) => sb
      .from("catering_quotes")
      .select("pipeline_id, status, total_cents, created_at")
      .in("pipeline_id", chunk)
      .is("superseded_at", null)
      .order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to)
      .returns<Array<{ pipeline_id: string; status: string; total_cents: number; created_at: string }>>());
    for (const qr of qRows) if (!quoteByLead.has(qr.pipeline_id)) quoteByLead.set(qr.pipeline_id, { status: qr.status, total_cents: qr.total_cents }); // first seen = latest (desc order)
  }

  return leads.map((l) => {
    const quote = quoteByLead.get(l.id);
    return {
      ...l,
      email: l.customerId ? (emailByCustomer.get(l.customerId) ?? null) : null,
      quoteStatus: quote?.status ?? null,
      quoteTotalCents: quote?.total_cents ?? null,
    };
  });
}

/** Leads with a follow-up due on/before `throughDate`, in non-terminal stages, soonest first. */
export async function loadFollowUps(actor: AuthContext, throughDate: string): Promise<PipelineLead[]> {
  requireLevel(actor, PIPELINE_READ_MIN);
  const sb = getServiceRoleClient();
  let q = sb
    .from("catering_pipeline")
    .select(LEAD_COLS)
    .not("follow_up_date", "is", null)
    .lte("follow_up_date", throughDate)
    .not("stage", "in", `(${TERMINAL_STAGES.join(",")})`);
  const scope = await readScopeOr(actor);
  if (scope) q = q.or(scope);
  const { data, error } = await q.order("follow_up_date", { ascending: true }).returns<DbLeadRow[]>();
  if (error) throw new Error(`loadFollowUps: ${error.message}`);
  return withLocationNames(sb, (data ?? []).map(mapLead));
}

/** One lead by id (scoped). Null if not found / not visible to the actor. */
export async function loadLead(actor: AuthContext, id: string): Promise<PipelineLead | null> {
  requireLevel(actor, PIPELINE_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("catering_pipeline").select(LEAD_COLS).eq("id", id).maybeSingle<DbLeadRow>();
  if (error) throw new Error(`loadLead: ${error.message}`);
  if (!data) return null;
  // Visibility: global, or in the actor's locations, or all-locations.
  if (!await canReadCateringLead(actor, data.location_id)) {
    return null;
  }
  return mapLead(data);
}

/** The Mode-A capacity signal for a lead's (location, event_date) — computed on demand. */
export async function leadCapacity(actor: AuthContext, id: string): Promise<CateringCapacityResult | null> {
  const lead = await loadLead(actor, id);
  if (!lead || lead.locationId == null || lead.eventDate == null) return null;
  return checkCateringCapacity({
    locationId: lead.locationId,
    eventDate: lead.eventDate,
    requestedCovers: lead.headcount ?? 0,
    excludePipelineId: lead.id,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────
export interface CreateLeadInput {
  contactName: string;
  company?: string | null;
  eventDate?: string | null;
  headcount?: number | null;
  contactPhone?: string | null;
  deliveryAddress?: string | null;
  timeWindow?: string | null;
  eventType?: string | null;
  dietaryNotes?: string | null;
  eventName?: string | null;
  dropoffDoor?: string | null;
  leadSource?: string | null;
  assignedTo?: string | null;
  locationId?: string | null;
  notes?: string | null;
  followUpDate?: string | null;
  customerId?: string | null;
  estimatedRevenueCents?: number | null;
  /**
   * B7c: the email typed on Add lead. A lead has no email column — the address resolves the
   * lead's CATERING CUSTOMER through the quote flow's own resolver (resolveOrCreateContact):
   * an existing customer is linked (another shop's is attached with its contact hidden —
   * Juan's option b), a readable deactivated one is revived, none → a new customer homed at
   * the lead's shop. Ignored when `customerId` is given. Never logged or echoed.
   */
  contactEmail?: string | null;
}

/** Create a new lead at stage 'inquiry' + its initial append-only stage event. */
export async function createLead(actor: AuthContext, input: CreateLeadInput): Promise<{ id: string }> {
  const locationId = input.locationId ?? null;
  assertCanWriteLead(actor, locationId);
  if (!input.contactName || input.contactName.trim().length === 0) {
    throw new CateringPipelineError(400, "invalid_payload", "contactName is required");
  }
  validateLeadSource(input.leadSource);
  const contactPhone = leadPhone(input.contactPhone);
  const email = normalizeLeadEmail(input.contactEmail);
  if (!email.ok) throw new CateringPipelineError(400, "invalid_email", "contactEmail is not a valid email");
  if (input.assignedTo != null) await requireAssignable(input.assignedTo);
  if (input.customerId != null) await requireVisibleCustomer(actor, input.customerId);

  // Every check above runs before this: resolving may CREATE a customer (append-only), so it
  // is the last step before the lead insert — the same order as the quotes route. The id is
  // server-resolved from the typed address, so a customer the actor cannot read (option b) is
  // linked without passing requireVisibleCustomer, which guards ids from a request body.
  let customerId = input.customerId ?? null;
  let customerVia: "id" | "email_existing" | "email_created" | null = customerId ? "id" : null;
  if (customerId == null && email.value != null) {
    const contact = await resolveOrCreateContact(actor, {
      email: email.value,
      name: input.contactName.trim(),
      company: input.company ?? null,
      primaryLocationId: locationId,
      via: "lead_capture",
    });
    customerId = contact.id;
    customerVia = contact.created ? "email_created" : "email_existing";
  }
  const sb = getServiceRoleClient();
  const { data: inserted, error } = await sb
    .from("catering_pipeline")
    .insert({
      contact_name: input.contactName.trim(),
      company: input.company ?? null,
      event_date: input.eventDate ?? null,
      headcount: input.headcount ?? null,
      contact_phone: contactPhone,
      delivery_address: input.deliveryAddress ?? null,
      time_window: input.timeWindow ?? null,
      event_type: input.eventType ?? null,
      dietary_notes: input.dietaryNotes ?? null,
      event_name: input.eventName ?? null,
      dropoff_door: input.dropoffDoor ?? null,
      stage: "inquiry",
      lead_source: input.leadSource ?? null,
      location_id: locationId,
      notes: input.notes ?? null,
      follow_up_date: input.followUpDate ?? null,
      customer_id: customerId,
      estimated_revenue_cents: input.estimatedRevenueCents ?? null,
      assigned_to: input.assignedTo ?? null,
      created_by: actor.user.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`createLead: ${error.message}`);

  const { error: evErr } = await sb.from("catering_pipeline_events").insert({
    pipeline_id: inserted.id,
    from_stage: null,
    to_stage: "inquiry",
    note: null,
    actor_id: actor.user.id,
  });
  if (evErr) throw new Error(`createLead event: ${evErr.message}`);

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.pipeline.create",
    resourceTable: "catering_pipeline",
    resourceId: inserted.id,
    // How the customer link was made — never the address itself.
    metadata: { location_id: locationId, lead_source: input.leadSource ?? null, customer_id: customerId, customer_via: customerVia },
    ipAddress: null,
    userAgent: null,
  });
  return { id: inserted.id };
}

/** Move a lead to a new stage: mutate the lead's stage + append a stage event. */
// ── W23/B126: reopen an un-cancelled ezCater lead ────────────────────────────────
/**
 * An ezCater order that was cancelled and then UN-cancelled left its lead in Lost for good: the
 * webhook flags `uncancelled_needs_human`, and the board refuses every move out of Lost
 * (`canTransition`, unchanged). This is the narrow human path: only an ezCater lead, only from
 * Lost, only when ezCater's un-cancel is newer than its last loss notification and the order is
 * no longer cancelled. Target (owner decision W23-1 a): Confirmed when ezCater says "accepted"
 * (re-reserving prep), else Inquiry. The 0330 RPC `reopen_ezcater_lead` re-checks all of it
 * under the provider lock and writes the stage + the pipeline event in one transaction.
 */
export async function loadEzcaterReopenTarget(sb: ReturnType<typeof getServiceRoleClient>, leadId: string): Promise<"confirmed" | "inquiry" | null> {
  const { data: lead, error } = await sb.from("catering_pipeline").select("id, stage, lead_source, external_ref")
    .eq("id", leadId).maybeSingle<{ id: string; stage: string; lead_source: string | null; external_ref: string | null }>();
  if (error) throw new Error(`loadEzcaterReopenTarget lead: ${error.message}`);
  if (!lead || lead.stage !== "lost" || lead.lead_source !== "ezcater" || !lead.external_ref) return null;
  const [order, events] = await Promise.all([
    sb.from("ezcater_orders").select("status, pending_event_key").eq("provider_uuid", lead.external_ref)
      .maybeSingle<{ status: string | null; pending_event_key: string | null }>(),
    sb.from("ezcater_events").select("event_key, received_at").eq("entity_id", lead.external_ref).eq("signature_valid", true)
      .in("event_key", ["cancelled", "rejected", "failed", "uncancelled"])
      .returns<Array<{ event_key: string; received_at: string }>>(),
  ]);
  if (order.error) throw new Error(`loadEzcaterReopenTarget order: ${order.error.message}`);
  if (events.error) throw new Error(`loadEzcaterReopenTarget events: ${events.error.message}`);
  const latest = (keys: string[]) => (events.data ?? []).filter((e) => keys.includes(e.event_key))
    .map((e) => e.received_at).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  return ezcaterReopenTarget({
    stage: lead.stage, leadSource: lead.lead_source, orderStatus: order.data?.status ?? null,
    pendingEventKey: order.data?.pending_event_key ?? null,
    lastLossAt: latest(["cancelled", "rejected", "failed"]), lastUncancelAt: latest(["uncancelled"]),
  });
}

const REOPEN_REFUSALS = new Set(["reopen_forbidden", "reopen_not_ezcater", "reopen_lead_moved", "reopen_not_lost", "reopen_no_uncancel", "reopen_still_cancelled"]);

export async function reopenEzcaterLead(actor: AuthContext, id: string): Promise<{ fromStage: "lost"; toStage: "confirmed" | "inquiry" }> {
  const sb = getServiceRoleClient();
  const { data: lead, error: lErr } = await sb.from("catering_pipeline").select("id, location_id")
    .eq("id", id).maybeSingle<{ id: string; location_id: string | null }>();
  if (lErr) throw new Error(`reopenEzcaterLead load: ${lErr.message}`);
  if (!lead) throw new CateringPipelineError(404, "not_found", "Lead not found");
  assertCanWriteLead(actor, lead.location_id); // before any write or RPC
  const expected = await loadEzcaterReopenTarget(sb, id);
  // Same B7c r5 rule as moveStage: never confirm a quote prep demand cannot read.
  if (expected === "confirmed") {
    try { await assertQuoteReadyForPrep(sb, id); }
    catch (e) {
      if (e instanceof PrepDemandNeedsRepairError) throw new CateringPipelineError(409, "quote_needs_repair", "This quote was saved during an app update and can't be used for prep yet");
      throw e;
    }
  }
  // Review r1 (BC-001/BC-007): the RPC re-checks, under the provider lock, that the lead is still at
  // the shop authorized above; a transfer committed in between is `reopen_lead_moved`, never a reopen
  // of another shop's order.
  const { data, error } = await sb.rpc("reopen_ezcater_lead", {
    p_lead_id: id, p_actor_id: actor.user.id, p_expected_location_id: lead.location_id,
  });
  if (error && ["PGRST202", "42883"].includes(String(error.code))) {
    throw new CateringPipelineError(503, "reopen_unavailable", "Reopen isn't available yet");
  }
  if (error && REOPEN_REFUSALS.has(error.message)) throw new CateringPipelineError(409, error.message);
  if (error || !data) throw new Error(`reopenEzcaterLead: ${error?.message ?? "no result"}`);
  const result = data as { from_stage: "lost"; to_stage: "confirmed" | "inquiry" };
  try {
    if (result.to_stage === "confirmed") await reservePrepDemand(actor, id);
  } catch (e) {
    void audit({
      actorId: actor.user.id, actorRole: actor.user.role, action: "catering.prep_demand.sync_failed",
      resourceTable: "catering_pipeline", resourceId: id,
      metadata: { to_stage: result.to_stage, error: e instanceof Error ? e.message : String(e) }, ipAddress: null, userAgent: null,
    });
  }
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "catering.pipeline.reopen",
    resourceTable: "catering_pipeline", resourceId: id,
    metadata: { from_stage: result.from_stage, to_stage: result.to_stage, reason: "ezcater_uncancelled" }, ipAddress: null, userAgent: null,
  });
  return { fromStage: result.from_stage, toStage: result.to_stage };
}

export async function moveStage(
  actor: AuthContext,
  args: { id: string; toStage: PipelineStage; note?: string | null },
): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: lead, error: lErr } = await sb
    .from("catering_pipeline")
    .select("id, stage, location_id")
    .eq("id", args.id)
    .maybeSingle<{ id: string; stage: string; location_id: string | null }>();
  if (lErr) throw new Error(`moveStage load: ${lErr.message}`);
  if (!lead) throw new CateringPipelineError(404, "not_found", "Lead not found");
  assertCanWriteLead(actor, lead.location_id);

  const fromStage = isPipelineStage(lead.stage) ? lead.stage : null;
  if (fromStage === args.toStage) return; // no-op

  // LEGAL MOVES ONLY. LEGAL_TRANSITIONS (pipeline-shared) existed since the ezCater lifecycle but
  // moveStage never consulted it — the board offered every other stage on one tap, so a Completed
  // lead could be dragged back to Inquiry and prep demand flipped with it (guide-walk sim, 2026-09-08).
  // canTransition is TOTAL: a legacy/unknown label on the row is refused, never guessed.
  if (fromStage === null || !canTransition(fromStage, args.toStage)) {
    throw new CateringPipelineError(409, "illegal_transition", `A lead cannot move from ${lead.stage} to ${args.toStage}`);
  }

  // B7c r5: a quote with a package line the pre-B7c server saved without its kind would reserve
  // ZERO package demand (Prep Demand never guesses). Refuse the confirm LOUDLY — before the stage
  // changes and before any demand row is touched — until the line is repaired (0252 header).
  if (args.toStage === "confirmed") {
    try {
      await assertQuoteReadyForPrep(sb, args.id);
    } catch (e) {
      if (e instanceof PrepDemandNeedsRepairError) {
        void audit({
          actorId: actor.user.id,
          actorRole: actor.user.role,
          action: "catering.prep_demand.sync_failed",
          resourceTable: "catering_pipeline",
          resourceId: args.id,
          metadata: { to_stage: args.toStage, outcome: "quote_needs_repair", quote_id: e.quoteId, line_ids: e.lineIds },
          ipAddress: null,
          userAgent: null,
        });
        throw new CateringPipelineError(409, "quote_needs_repair", "This quote was saved during an app update and can't be used for prep yet");
      }
      throw e;
    }
  }

  // Guard on the stage the pre-read saw (silent-UPDATE law): the event row below records
  // from_stage from that read, so an unguarded UPDATE would let a concurrent move write a
  // stale from_stage into the audit trail. count 0 = the lead moved since the read.
  const { error: uErr, count } = await sb
    .from("catering_pipeline")
    .update({ stage: args.toStage, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", args.id)
    .eq("stage", lead.stage);
  if (uErr) throw new Error(`moveStage update: ${uErr.message}`);
  if (count === 0) throw new CateringPipelineError(409, "stage_changed", "Lead stage changed since it was loaded — reload and retry");

  const { error: evErr } = await sb.from("catering_pipeline_events").insert({
    pipeline_id: args.id,
    from_stage: fromStage,
    to_stage: args.toStage,
    note: args.note ?? null,
    actor_id: actor.user.id,
  });
  if (evErr) throw new Error(`moveStage event: ${evErr.message}`);

  // W4a: propagate the stage change to the prep-demand ledger — best-effort; a demand-sync
  // failure must never break the operational stage move (it's audited + re-syncable instead).
  try {
    if (args.toStage === "confirmed") await reservePrepDemand(actor, args.id);
    else if (args.toStage === "out" || args.toStage === "completed") await consumePrepDemand(actor, args.id);
    else if (args.toStage === "lost" || args.toStage === "inquiry" || args.toStage === "quote_sent") await releasePrepDemand(actor, args.id);
  } catch (e) {
    void audit({
      actorId: actor.user.id,
      actorRole: actor.user.role,
      action: "catering.prep_demand.sync_failed",
      resourceTable: "catering_pipeline",
      resourceId: args.id,
      metadata: { to_stage: args.toStage, error: e instanceof Error ? e.message : String(e) },
      ipAddress: null,
      userAgent: null,
    });
  }

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.pipeline.stage_move",
    resourceTable: "catering_pipeline",
    resourceId: args.id,
    metadata: { from_stage: fromStage, to_stage: args.toStage },
    ipAddress: null,
    userAgent: null,
  });
}

export interface EditLeadInput {
  contactName?: string;
  company?: string | null;
  eventDate?: string | null;
  headcount?: number | null;
  contactPhone?: string | null;
  deliveryAddress?: string | null;
  timeWindow?: string | null;
  eventType?: string | null;
  dietaryNotes?: string | null;
  eventName?: string | null;
  dropoffDoor?: string | null;
  leadSource?: string | null;
  assignedTo?: string | null;
  notes?: string | null;
  followUpDate?: string | null;
  customerId?: string | null;
  estimatedRevenueCents?: number | null;
}

/** Edit a lead's mutable CRM fields in place (never stage — use moveStage). */
export async function editLead(actor: AuthContext, id: string, input: EditLeadInput): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: lead, error: lErr } = await sb
    .from("catering_pipeline")
    .select("id, location_id")
    .eq("id", id)
    .maybeSingle<{ id: string; location_id: string | null }>();
  if (lErr) throw new Error(`editLead load: ${lErr.message}`);
  if (!lead) throw new CateringPipelineError(404, "not_found", "Lead not found");
  assertCanWriteLead(actor, lead.location_id);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.contactName !== undefined) {
    if (!input.contactName || input.contactName.trim().length === 0) {
      throw new CateringPipelineError(400, "invalid_payload", "contactName cannot be empty");
    }
    patch.contact_name = input.contactName.trim();
  }
  if (input.company !== undefined) patch.company = input.company;
  if (input.eventDate !== undefined) patch.event_date = input.eventDate;
  if (input.headcount !== undefined) patch.headcount = input.headcount;
  if (input.contactPhone !== undefined) patch.contact_phone = leadPhone(input.contactPhone);
  if (input.deliveryAddress !== undefined) patch.delivery_address = input.deliveryAddress;
  if (input.timeWindow !== undefined) patch.time_window = input.timeWindow;
  if (input.eventType !== undefined) patch.event_type = input.eventType;
  if (input.dietaryNotes !== undefined) patch.dietary_notes = input.dietaryNotes;
  if (input.eventName !== undefined) patch.event_name = input.eventName;
  if (input.dropoffDoor !== undefined) patch.dropoff_door = input.dropoffDoor;
  if (input.leadSource !== undefined) {
    validateLeadSource(input.leadSource);
    patch.lead_source = input.leadSource;
  }
  if (input.assignedTo !== undefined) {
    if (input.assignedTo != null) await requireAssignable(input.assignedTo);
    patch.assigned_to = input.assignedTo;
  }
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.followUpDate !== undefined) patch.follow_up_date = input.followUpDate;
  if (input.customerId !== undefined) {
    if (input.customerId != null) await requireVisibleCustomer(actor, input.customerId);
    patch.customer_id = input.customerId;
  }
  if (input.estimatedRevenueCents !== undefined) patch.estimated_revenue_cents = input.estimatedRevenueCents;

  // Pre-read the current order lead: the attribution norm (spec #2b) is that
  // ONLY the assignee should edit — others may, but the audit row says so.
  const { data: beforeRow, error: bErr } = await sb
    .from("catering_pipeline").select("assigned_to")
    .eq("id", id).maybeSingle<{ assigned_to: string | null }>();
  if (bErr) throw new Error(`editLead pre-read: ${bErr.message}`);
  if (!beforeRow) throw new CateringPipelineError(404, "not_found", "Lead not found");

  const { error: uErr, count } = await sb
    .from("catering_pipeline")
    .update(patch, { count: "exact" })
    .eq("id", id);
  if (uErr) throw new Error(`editLead update: ${uErr.message}`);
  if (count === 0) throw new CateringPipelineError(404, "not_found", "Lead not found");

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.pipeline.edit",
    resourceTable: "catering_pipeline",
    resourceId: id,
    metadata: {
      fields: Object.keys(patch).filter((k) => k !== "updated_at"),
      ...(beforeRow.assigned_to != null && beforeRow.assigned_to !== actor.user.id
        ? { non_assignee_edit: true, order_lead: beforeRow.assigned_to }
        : {}),
      ...("assigned_to" in patch && patch.assigned_to !== beforeRow.assigned_to
        ? { assigned_to_changed: true, assigned_from: beforeRow.assigned_to, assigned_to: patch.assigned_to }
        : {}),
    },
    ipAddress: null,
    userAgent: null,
  });
}

// ── Assignable staff (spec #2b) ───────────────────────────────────────────────

export interface AssignableStaff { id: string; name: string }

/** Active staff (level >= 3) assignable as an order lead; also powers name display. */
export async function loadAssignableStaff(actor: AuthContext): Promise<AssignableStaff[]> {
  requireLevel(actor, PIPELINE_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("users").select("id, name, role, active")
    .eq("active", true).order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; role: RoleCode; active: boolean }>>();
  if (error) throw new Error(`loadAssignableStaff: ${error.message}`);
  return (data ?? []).filter((u) => getRoleLevel(u.role) >= 3).map((u) => ({ id: u.id, name: u.name }));
}
