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
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, isAllLocationsAccess } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { checkCateringCapacity, type CateringCapacityResult } from "@/lib/catering/capacity";
import { reservePrepDemand, consumePrepDemand, releasePrepDemand } from "@/lib/catering/prep-demand";

// ── Stage vocabulary ─────────────────────────────────────────────────────────
export const PIPELINE_STAGES = ["inquiry", "quote_sent", "confirmed", "out", "completed", "lost"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
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

/** LocationActor shape from the AuthContext for lockLocationContext / isAllLocationsAccess. */
function locActor(actor: AuthContext): { role: AuthContext["user"]["role"]; locations: string[] } {
  return { role: actor.user.role, locations: actor.locations };
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
  notes: string | null;
  followUpDate: string | null;
  estimatedRevenueCents: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface DbLeadRow {
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
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

const LEAD_COLS =
  "id, customer_id, contact_name, company, event_date, headcount, contact_phone, delivery_address, time_window, event_type, dietary_notes, event_name, dropoff_door, stage, lead_source, location_id, notes, follow_up_date, estimated_revenue_cents, created_by, created_at, updated_at";

function mapLead(r: DbLeadRow): PipelineLead {
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
    notes: r.notes,
    followUpDate: r.follow_up_date,
    estimatedRevenueCents: r.estimated_revenue_cents,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The read-scope `.or()` filter string for the actor, or null when unrestricted (L9+ all-locations). */
function readScopeOr(actor: AuthContext): string | null {
  if (isAllLocationsAccess(locActor(actor))) return null;
  const ids = actor.locations;
  return ids.length === 0
    ? "location_id.is.null"
    : `location_id.is.null,location_id.in.(${ids.join(",")})`;
}

// ── Reads ───────────────────────────────────────────────────────────────────
/** All non-archived leads the actor may view, for the board (grouped client-side by stage). */
export async function loadPipelineBoard(actor: AuthContext): Promise<PipelineLead[]> {
  requireLevel(actor, PIPELINE_READ_MIN);
  const sb = getServiceRoleClient();
  let q = sb.from("catering_pipeline").select(LEAD_COLS);
  const scope = readScopeOr(actor);
  if (scope) q = q.or(scope);
  const { data, error } = await q.order("created_at", { ascending: false }).returns<DbLeadRow[]>();
  if (error) throw new Error(`loadPipelineBoard: ${error.message}`);
  return (data ?? []).map(mapLead);
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

  // 1. Customer ids matching email/phone/name, plus customers of companies whose name matches.
  const matchedCustomerIds = new Set<string>();
  const { data: custRows, error: cErr } = await sb
    .from("catering_customers")
    .select("id")
    .or(`email.ilike.${term},phone.ilike.${term},name.ilike.${term}`)
    .returns<Array<{ id: string }>>();
  if (cErr) throw new Error(`searchPipeline customers: ${cErr.message}`);
  for (const c of custRows ?? []) matchedCustomerIds.add(c.id);

  const { data: compRows, error: coErr } = await sb
    .from("catering_companies")
    .select("id")
    .ilike("name", term)
    .returns<Array<{ id: string }>>();
  if (coErr) throw new Error(`searchPipeline companies: ${coErr.message}`);
  const companyIds = (compRows ?? []).map((c) => c.id);
  if (companyIds.length) {
    const { data: compCust, error: ccErr } = await sb
      .from("catering_customers")
      .select("id")
      .in("company_id", companyIds)
      .returns<Array<{ id: string }>>();
    if (ccErr) throw new Error(`searchPipeline company customers: ${ccErr.message}`);
    for (const c of compCust ?? []) matchedCustomerIds.add(c.id);
  }

  // 2. Search leads: own text fields OR matched customer ids, location-scoped.
  const orParts = [`contact_name.ilike.${term}`, `company.ilike.${term}`, `contact_phone.ilike.${term}`, `event_name.ilike.${term}`];
  if (matchedCustomerIds.size) orParts.push(`customer_id.in.(${[...matchedCustomerIds].join(",")})`);
  let q = sb.from("catering_pipeline").select(LEAD_COLS);
  const scope = readScopeOr(actor);
  if (scope) q = q.or(scope); // AND-ed with the identity OR-group below (two .or() calls = AND of groups)
  q = q.or(orParts.join(","));
  const { data: leadRows, error } = await q.order("created_at", { ascending: false }).returns<DbLeadRow[]>();
  if (error) throw new Error(`searchPipeline leads: ${error.message}`);
  const leads = (leadRows ?? []).map(mapLead);
  if (leads.length === 0) return [];

  // 3. Enrich: email (per customer) + current quote (latest non-superseded per lead).
  const custIds = [...new Set(leads.map((l) => l.customerId).filter((x): x is string => !!x))];
  const emailByCustomer = new Map<string, string | null>();
  if (custIds.length) {
    const { data } = await sb.from("catering_customers").select("id, email").in("id", custIds).returns<Array<{ id: string; email: string | null }>>();
    for (const c of data ?? []) emailByCustomer.set(c.id, c.email);
  }
  const leadIds = leads.map((l) => l.id);
  const quoteByLead = new Map<string, { status: string; total_cents: number }>();
  const { data: qRows } = await sb
    .from("catering_quotes")
    .select("pipeline_id, status, total_cents, created_at")
    .in("pipeline_id", leadIds)
    .is("superseded_at", null)
    .order("created_at", { ascending: false })
    .returns<Array<{ pipeline_id: string; status: string; total_cents: number; created_at: string }>>();
  for (const qr of qRows ?? []) if (!quoteByLead.has(qr.pipeline_id)) quoteByLead.set(qr.pipeline_id, { status: qr.status, total_cents: qr.total_cents }); // first seen = latest (desc order)

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
  const scope = readScopeOr(actor);
  if (scope) q = q.or(scope);
  const { data, error } = await q.order("follow_up_date", { ascending: true }).returns<DbLeadRow[]>();
  if (error) throw new Error(`loadFollowUps: ${error.message}`);
  return (data ?? []).map(mapLead);
}

/** One lead by id (scoped). Null if not found / not visible to the actor. */
export async function loadLead(actor: AuthContext, id: string): Promise<PipelineLead | null> {
  requireLevel(actor, PIPELINE_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("catering_pipeline").select(LEAD_COLS).eq("id", id).maybeSingle<DbLeadRow>();
  if (error) throw new Error(`loadLead: ${error.message}`);
  if (!data) return null;
  // Visibility: global, or in the actor's locations, or all-locations.
  if (
    data.location_id != null &&
    !isAllLocationsAccess(locActor(actor)) &&
    !actor.locations.includes(data.location_id)
  ) {
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
  locationId?: string | null;
  notes?: string | null;
  followUpDate?: string | null;
  customerId?: string | null;
  estimatedRevenueCents?: number | null;
}

/** Create a new lead at stage 'inquiry' + its initial append-only stage event. */
export async function createLead(actor: AuthContext, input: CreateLeadInput): Promise<{ id: string }> {
  const locationId = input.locationId ?? null;
  assertCanWriteLead(actor, locationId);
  if (!input.contactName || input.contactName.trim().length === 0) {
    throw new CateringPipelineError(400, "invalid_payload", "contactName is required");
  }
  const sb = getServiceRoleClient();
  const { data: inserted, error } = await sb
    .from("catering_pipeline")
    .insert({
      contact_name: input.contactName.trim(),
      company: input.company ?? null,
      event_date: input.eventDate ?? null,
      headcount: input.headcount ?? null,
      contact_phone: input.contactPhone ?? null,
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
      customer_id: input.customerId ?? null,
      estimated_revenue_cents: input.estimatedRevenueCents ?? null,
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
    metadata: { location_id: locationId, lead_source: input.leadSource ?? null },
    ipAddress: null,
    userAgent: null,
  });
  return { id: inserted.id };
}

/** Move a lead to a new stage: mutate the lead's stage + append a stage event. */
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

  const { error: uErr, count } = await sb
    .from("catering_pipeline")
    .update({ stage: args.toStage, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", args.id);
  if (uErr) throw new Error(`moveStage update: ${uErr.message}`);
  if (count === 0) throw new CateringPipelineError(404, "not_found", "Lead not found");

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
  if (input.contactPhone !== undefined) patch.contact_phone = input.contactPhone;
  if (input.deliveryAddress !== undefined) patch.delivery_address = input.deliveryAddress;
  if (input.timeWindow !== undefined) patch.time_window = input.timeWindow;
  if (input.eventType !== undefined) patch.event_type = input.eventType;
  if (input.dietaryNotes !== undefined) patch.dietary_notes = input.dietaryNotes;
  if (input.eventName !== undefined) patch.event_name = input.eventName;
  if (input.dropoffDoor !== undefined) patch.dropoff_door = input.dropoffDoor;
  if (input.leadSource !== undefined) patch.lead_source = input.leadSource;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.followUpDate !== undefined) patch.follow_up_date = input.followUpDate;
  if (input.customerId !== undefined) patch.customer_id = input.customerId;
  if (input.estimatedRevenueCents !== undefined) patch.estimated_revenue_cents = input.estimatedRevenueCents;

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
    metadata: { fields: Object.keys(patch).filter((k) => k !== "updated_at") },
    ipAddress: null,
    userAgent: null,
  });
}
