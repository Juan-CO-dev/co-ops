/**
 * Catering customers directory — Wave 1 slice 1D.
 *
 * SERVER-ONLY. Service-role + app-layer authz (read L5 / write L6 + location lock),
 * consistent with lib/catering/pipeline.ts. `catering_customers` is a mutable directory
 * row (edit in place; deactivate via active=false, never DELETE — it has no updated_at/by
 * columns, so edits don't stamp a timestamp). Company grouping is a text rollup on the
 * `company` field (the full append-only identity/company-edge model, D19d, is Wave 2+).
 * The detail view surfaces the customer's pipeline leads, live quotes + order history.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, isAllLocationsAccess } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { normalizeEmail } from "@/lib/catering/companies";
import { loadCateringReader } from "@/lib/catering/ezcater-detail";
import { canReadCateringContact } from "@/lib/catering/ezcater-detail-shared";

export const CUSTOMER_READ_MIN = 5;
export const CUSTOMER_WRITE_MIN = 6;

/** Postgres unique_violation — `catering_customers_one_active_email` (0122). */
const PG_UNIQUE_VIOLATION = "23505";

export class CateringCustomerError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "CateringCustomerError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new CateringCustomerError(403, "forbidden", "Insufficient role level");
  }
}
function locActor(actor: AuthContext): { role: AuthContext["user"]["role"]; locations: string[] } {
  return { role: actor.user.role, locations: actor.locations };
}
function assertCanWrite(actor: AuthContext, primaryLocationId: string | null): void {
  requireLevel(actor, CUSTOMER_WRITE_MIN);
  if (primaryLocationId != null && !lockLocationContext(locActor(actor), primaryLocationId)) {
    throw new CateringCustomerError(403, "location_access_denied", "You do not manage that location");
  }
}
/** Read-scope `.or()` filter on primary_location_id (global + actor's locations), or null for L9+. */
function readScopeOr(actor: AuthContext): string | null {
  if (isAllLocationsAccess(locActor(actor))) return null;
  const ids = actor.locations;
  return ids.length === 0
    ? "primary_location_id.is.null"
    : `primary_location_id.is.null,primary_location_id.in.(${ids.join(",")})`;
}

export interface CateringCustomer {
  id: string;
  name: string;
  company: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  primaryLocationId: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
}

interface DbCustomerRow {
  id: string;
  name: string;
  company: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  primary_location_id: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  created_by: string | null;
}

const CUSTOMER_COLS =
  "id, name, company, contact_person, email, phone, primary_location_id, notes, active, created_at, created_by";

function mapCustomer(r: DbCustomerRow): CateringCustomer {
  return {
    id: r.id,
    name: r.name,
    company: r.company,
    contactPerson: r.contact_person,
    email: r.email,
    phone: r.phone,
    primaryLocationId: r.primary_location_id,
    notes: r.notes,
    active: r.active,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────
export async function loadCustomers(actor: AuthContext): Promise<CateringCustomer[]> {
  requireLevel(actor, CUSTOMER_READ_MIN);
  const sb = getServiceRoleClient();
  let q = sb.from("catering_customers").select(CUSTOMER_COLS);
  const scope = readScopeOr(actor);
  if (scope) q = q.or(scope);
  const { data, error } = await q
    .order("company", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .returns<DbCustomerRow[]>();
  if (error) throw new Error(`loadCustomers: ${error.message}`);
  return (data ?? []).map(mapCustomer);
}

export interface CustomerHistoryLead {
  id: string;
  contactName: string;
  stage: string;
  eventDate: string | null;
  headcount: number | null;
}
export interface CustomerHistoryOrder {
  id: string;
  orderDate: string;
  amountCents: number | null;
  headcount: number | null;
}
export interface CustomerHistoryQuote {
  id: string;
  version: number;
  status: string;
  eventDate: string | null;
  totalCents: number;
}
export interface CustomerDetail {
  customer: CateringCustomer;
  leads: CustomerHistoryLead[];
  orders: CustomerHistoryOrder[];
  quotes: CustomerHistoryQuote[];
}

/**
 * The PostgREST `.or()` for a customer's leads (B5 #34): leads linked to the customer, plus
 * leads that one of the customer's quotes points at and that have NO customer yet. The second
 * half covers quotes saved before the quote save started linking the lead, without a backfill;
 * it never claims a lead that belongs to a different customer.
 */
export function customerLeadsFilter(customerId: string, quoteLeadIds: readonly string[]): string {
  const ids = [...new Set(quoteLeadIds)];
  return ids.length === 0
    ? `customer_id.eq.${customerId}`
    : `customer_id.eq.${customerId},and(id.in.(${ids.join(",")}),customer_id.is.null)`;
}

/** Keep only the leads whose shop the reader may read (global leads included). Pure. */
export function filterReadableLeads<T extends { location_id: string | null }>(
  reader: Parameters<typeof canReadCateringContact>[0] | null,
  leads: readonly T[],
): T[] {
  if (!reader) return [];
  return leads.filter((l) => canReadCateringContact(reader, l.location_id));
}

/** One customer + their pipeline leads + order history (scoped). Null if not visible. */
export async function loadCustomer(actor: AuthContext, id: string): Promise<CustomerDetail | null> {
  requireLevel(actor, CUSTOMER_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: row, error } = await sb
    .from("catering_customers")
    .select(CUSTOMER_COLS)
    .eq("id", id)
    .maybeSingle<DbCustomerRow>();
  if (error) throw new Error(`loadCustomer: ${error.message}`);
  if (!row) return null;
  if (
    row.primary_location_id != null &&
    !isAllLocationsAccess(locActor(actor)) &&
    !actor.locations.includes(row.primary_location_id)
  ) {
    return null;
  }

  // Live quotes for this customer (B5 #34), limited to the shops the actor can see — the same
  // location rule the quote board uses.
  let quoteQuery = sb
    .from("catering_quotes")
    .select("id, version, status, event_date, total_cents, pipeline_id, location_id")
    .eq("customer_id", id)
    .is("superseded_at", null);
  if (!isAllLocationsAccess(locActor(actor))) {
    quoteQuery = actor.locations.length === 0
      ? quoteQuery.eq("location_id", "00000000-0000-0000-0000-000000000000")
      : quoteQuery.in("location_id", actor.locations);
  }
  const { data: quotes, error: qErr } = await quoteQuery
    .order("created_at", { ascending: false })
    .returns<Array<{ id: string; version: number; status: string; event_date: string | null; total_cents: number; pipeline_id: string | null; location_id: string }>>();
  if (qErr) throw new Error(`loadCustomer quotes: ${qErr.message}`);
  const quoteLeadIds = (quotes ?? []).flatMap((q) => (q.pipeline_id ? [q.pipeline_id] : []));

  const [reader, { data: leadRows }, { data: orders }] = await Promise.all([
    loadCateringReader(actor),
    sb
      .from("catering_pipeline")
      .select("id, contact_name, stage, event_date, headcount, location_id")
      .or(customerLeadsFilter(id, quoteLeadIds))
      .order("created_at", { ascending: false })
      .returns<Array<{ id: string; contact_name: string; stage: string; event_date: string | null; headcount: number | null; location_id: string | null }>>(),
    sb
      .from("catering_orders")
      .select("id, order_date, amount_cents, headcount")
      .eq("customer_id", id)
      .order("order_date", { ascending: false })
      .returns<Array<{ id: string; order_date: string; amount_cents: number | null; headcount: number | null }>>(),
  ]);

  // Review P1: a customer's leads are listed by RELATIONSHIP (either branch of the filter),
  // but each lead is contact data at its OWN shop. A lead transferred to a shop the actor does
  // not read (or one a quote points at there) is dropped, under the same catering contact
  // policy the pipeline uses (fresh memberships; fail-closed: no reader, no leads).
  const leads = filterReadableLeads(reader, leadRows ?? []);

  return {
    customer: mapCustomer(row),
    leads: leads.map((l) => ({
      id: l.id,
      contactName: l.contact_name,
      stage: l.stage,
      eventDate: l.event_date,
      headcount: l.headcount,
    })),
    orders: (orders ?? []).map((o) => ({
      id: o.id,
      orderDate: o.order_date,
      amountCents: o.amount_cents,
      headcount: o.headcount,
    })),
    quotes: (quotes ?? []).map((q) => ({
      id: q.id,
      version: q.version,
      status: q.status,
      eventDate: q.event_date,
      totalCents: q.total_cents,
    })),
  };
}

// ── Mutations ───────────────────────────────────────────────────────────────
export interface CreateCustomerInput {
  name: string;
  company?: string | null;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  primaryLocationId?: string | null;
  notes?: string | null;
}

export async function createCustomer(actor: AuthContext, input: CreateCustomerInput): Promise<{ id: string }> {
  const primaryLocationId = input.primaryLocationId ?? null;
  assertCanWrite(actor, primaryLocationId);
  if (!input.name || input.name.trim().length === 0) {
    throw new CateringCustomerError(400, "invalid_payload", "name is required");
  }
  const sb = getServiceRoleClient();
  const { data: inserted, error } = await sb
    .from("catering_customers")
    .insert({
      name: input.name.trim(),
      company: input.company ?? null,
      contact_person: input.contactPerson ?? null,
      email: normalizeEmail(input.email ?? "") || null,
      phone: input.phone ?? null,
      primary_location_id: primaryLocationId,
      notes: input.notes ?? null,
      active: true,
      created_by: actor.user.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`createCustomer: ${error.message}`);

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.customer.create",
    resourceTable: "catering_customers",
    resourceId: inserted.id,
    metadata: { primary_location_id: primaryLocationId, company: input.company ?? null },
    ipAddress: null,
    userAgent: null,
  });
  return { id: inserted.id };
}

export interface EditCustomerInput {
  name?: string;
  company?: string | null;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export async function editCustomer(actor: AuthContext, id: string, input: EditCustomerInput): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: row, error: lErr } = await sb
    .from("catering_customers")
    .select("id, primary_location_id")
    .eq("id", id)
    .maybeSingle<{ id: string; primary_location_id: string | null }>();
  if (lErr) throw new Error(`editCustomer load: ${lErr.message}`);
  if (!row) throw new CateringCustomerError(404, "not_found", "Customer not found");
  assertCanWrite(actor, row.primary_location_id);

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (!input.name || input.name.trim().length === 0) {
      throw new CateringCustomerError(400, "invalid_payload", "name cannot be empty");
    }
    patch.name = input.name.trim();
  }
  if (input.company !== undefined) patch.company = input.company;
  if (input.contactPerson !== undefined) patch.contact_person = input.contactPerson;
  if (input.email !== undefined) patch.email = normalizeEmail(input.email ?? "") || null;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (Object.keys(patch).length === 0) return;

  const { error: uErr, count } = await sb
    .from("catering_customers")
    .update(patch, { count: "exact" })
    .eq("id", id);
  // Same partial index, same answer as setCustomerActive below: retyping an email that an
  // active row already owns is a claimed address, not a server fault. Mapped here too
  // because this is the OTHER way a row enters the constrained set (the flag named only
  // the reactivation path, but the two writers are one line apart and share the defect).
  if (uErr?.code === PG_UNIQUE_VIOLATION) {
    throw new CateringCustomerError(
      409,
      "email_taken",
      "Another active contact already uses that email address",
    );
  }
  if (uErr) throw new Error(`editCustomer update: ${uErr.message}`);
  if (count === 0) throw new CateringCustomerError(404, "not_found", "Customer not found");

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.customer.edit",
    resourceTable: "catering_customers",
    resourceId: id,
    metadata: { fields: Object.keys(patch) },
    ipAddress: null,
    userAgent: null,
  });
}

/**
 * Flip a contact's `active` flag.
 *
 * REACTIVATION IS 23505-SAFE. `catering_customers_one_active_email` (0122) is a PARTIAL
 * unique index — `WHERE active AND email IS NOT NULL` — so it constrains ACTIVE rows only.
 * Flipping a deactivated contact back on therefore ENTERS the constrained set, and if some
 * other active row has since taken that email the UPDATE raises 23505. PR #303 stopped new
 * forks from being created; every pair already forked in prod still lands here, and an
 * unmapped 23505 came back as a bare `Error` → an unhandled 500 the operator reads as
 * "the app is broken" rather than "another contact owns this address".
 *
 * The typed 409 is the honest answer: the row is fine, the EMAIL is claimed, and the
 * remedy is a human one (merge the two contacts, or clear the email on one). Same posture
 * as `lib/catering/companies.ts`'s domain_taken and rate-rules' rate_rule_exists.
 */
export async function setCustomerActive(actor: AuthContext, id: string, active: boolean): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: row, error: lErr } = await sb
    .from("catering_customers")
    .select("id, primary_location_id")
    .eq("id", id)
    .maybeSingle<{ id: string; primary_location_id: string | null }>();
  if (lErr) throw new Error(`setCustomerActive load: ${lErr.message}`);
  if (!row) throw new CateringCustomerError(404, "not_found", "Customer not found");
  assertCanWrite(actor, row.primary_location_id);

  const { error: uErr, count } = await sb
    .from("catering_customers")
    .update({ active }, { count: "exact" })
    .eq("id", id);
  if (uErr?.code === PG_UNIQUE_VIOLATION) {
    throw new CateringCustomerError(
      409,
      "email_taken",
      "Another active contact already uses that email address",
    );
  }
  if (uErr) throw new Error(`setCustomerActive update: ${uErr.message}`);
  if (count === 0) throw new CateringCustomerError(404, "not_found", "Customer not found");

  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: active ? "catering.customer.activate" : "catering.customer.deactivate",
    resourceTable: "catering_customers",
    resourceId: id,
    metadata: { active },
    ipAddress: null,
    userAgent: null,
  });
}
