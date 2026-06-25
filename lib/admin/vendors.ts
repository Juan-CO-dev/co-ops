/**
 * Admin vendor-directory data layer (Item/Inventory Spine — Vendor Directory slice).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level floor → assertStepUp)
 * and re-checked here for the column-level trivial/full split (defense in depth;
 * RLS can't do per-column gating — see AGENTS.md "vendors_update_trivial").
 * Service-role bypasses RLS by design, consistent with lib/admin/users.ts.
 *
 * Trivial/full split (locked in AGENTS.md):
 *   - Trivial — AGM+ (>=6): contact_person, contact_email, contact_phone,
 *     ordering_email, ordering_url, notes.
 *   - Full — GM+ (>=7): the above PLUS name, category, ordering_days,
 *     payment_terms, account_number, active.
 *   - Create + deactivate/reactivate — GM+ (>=7).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

export interface VendorView {
  id: string;
  name: string;
  category: string | null;
  contactPerson: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  orderingEmail: string | null;
  orderingUrl: string | null;
  orderingDays: string | null;
  paymentTerms: string | null;
  accountNumber: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Typed error the routes map to jsonError(status, code). */
export class AdminVendorError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminVendorError";
  }
}

export const VENDOR_READ_MIN_LEVEL = 6; // AGM+ may view the directory
export const VENDOR_FULL_MIN_LEVEL = 7; // GM+ for full-only columns + create + (de)activate

/**
 * Application-level field shapes the API may write. snake_case = DB column.
 * The split lists below partition these into trivial (AGM+) vs full-only (GM+).
 */
export interface VendorChanges {
  name?: string;
  category?: string | null;
  contact_person?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  ordering_email?: string | null;
  ordering_url?: string | null;
  ordering_days?: string | null;
  payment_terms?: string | null;
  account_number?: string | null;
  notes?: string | null;
  active?: boolean;
}

/** Columns AGM+ may edit. */
const TRIVIAL_COLS = [
  "contact_person",
  "contact_email",
  "contact_phone",
  "ordering_email",
  "ordering_url",
  "notes",
] as const;

/** Columns that require GM+ (full profile). `active` is full-only but is routed
 * through deactivateVendor for the distinct activate/deactivate audit action. */
const FULL_ONLY_COLS = [
  "name",
  "category",
  "ordering_days",
  "payment_terms",
  "account_number",
  "active",
] as const;

/** Email columns lowercased at write (AGENTS.md "always lowercase email at insert time"). */
const EMAIL_COLS = ["contact_email", "ordering_email"] as const;

const SELECT_COLS =
  "id, name, category, contact_person, contact_email, contact_phone, " +
  "ordering_email, ordering_url, ordering_days, payment_terms, account_number, " +
  "notes, active, created_at, updated_at";

interface DbVendorRow {
  id: string;
  name: string;
  category: string | null;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  ordering_email: string | null;
  ordering_url: string | null;
  ordering_days: string | null;
  payment_terms: string | null;
  account_number: string | null;
  notes: string | null;
  active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

function rowToView(r: DbVendorRow): VendorView {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    contactPerson: r.contact_person,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    orderingEmail: r.ordering_email,
    orderingUrl: r.ordering_url,
    orderingDays: r.ordering_days,
    paymentTerms: r.payment_terms,
    accountNumber: r.account_number,
    notes: r.notes,
    active: r.active ?? false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Normalize a nullable text field: trim, empty → null. */
function normText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** List all vendors (active + inactive), active first then alphabetical by name. */
export async function loadVendors(_actor: AuthContext): Promise<VendorView[]> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendors")
    .select(SELECT_COLS)
    .order("active", { ascending: false })
    .order("name", { ascending: true })
    .returns<DbVendorRow[]>();
  if (error) throw new Error(`loadVendors failed: ${error.message}`);
  return (data ?? []).map(rowToView);
}

export async function getVendor(_actor: AuthContext, id: string): Promise<VendorView | null> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendors")
    .select(SELECT_COLS)
    .eq("id", id)
    .maybeSingle<DbVendorRow>();
  if (error) throw new Error(`getVendor failed: ${error.message}`);
  return data ? rowToView(data) : null;
}

export interface CreateVendorInput {
  name: string;
  category?: string | null;
  contact_person?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  ordering_email?: string | null;
  ordering_url?: string | null;
  ordering_days?: string | null;
  payment_terms?: string | null;
  account_number?: string | null;
  notes?: string | null;
}

/** Create a vendor. GM+ only. */
export async function createVendor(
  actor: AuthContext,
  input: CreateVendorInput,
): Promise<{ id: string }> {
  if (getRoleLevel(actor.user.role) < VENDOR_FULL_MIN_LEVEL) {
    throw new AdminVendorError(403, "forbidden", "Creating a vendor requires GM+");
  }
  const name = (input.name ?? "").trim();
  if (!name) throw new AdminVendorError(400, "invalid_name", "Vendor name is required");

  const sb = getServiceRoleClient();
  const nowIso = new Date().toISOString();
  const insertRow = {
    name,
    category: normText(input.category),
    contact_person: normText(input.contact_person),
    contact_email: normText(input.contact_email)?.toLowerCase() ?? null,
    contact_phone: normText(input.contact_phone),
    ordering_email: normText(input.ordering_email)?.toLowerCase() ?? null,
    ordering_url: normText(input.ordering_url),
    ordering_days: normText(input.ordering_days),
    payment_terms: normText(input.payment_terms),
    account_number: normText(input.account_number),
    notes: normText(input.notes),
    active: true,
    created_by: actor.user.id,
    created_at: nowIso,
    updated_by: actor.user.id,
    updated_at: nowIso,
  };

  const { data: row, error } = await sb
    .from("vendors")
    .insert(insertRow)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`createVendor insert failed: ${error.message}`);
  if (!row) throw new Error("createVendor insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.create",
    resourceTable: "vendors",
    resourceId: row.id,
    metadata: { name, category: insertRow.category },
    ipAddress: null,
    userAgent: null,
  });

  return { id: row.id };
}

/** Build the normalized DB patch for a set of changes, lowercasing emails. */
function normalizeChanges(changes: VendorChanges): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (key === "name") {
      const n = (value as string).trim();
      if (!n) throw new AdminVendorError(400, "invalid_name", "Vendor name cannot be empty");
      patch.name = n;
    } else if (key === "active") {
      patch.active = Boolean(value);
    } else if ((EMAIL_COLS as readonly string[]).includes(key)) {
      patch[key] = normText(value as string | null)?.toLowerCase() ?? null;
    } else {
      patch[key] = normText(value as string | null);
    }
  }
  return patch;
}

/**
 * Update a vendor with the column-level trivial/full split enforced.
 * - touches any FULL_ONLY column → require GM+ (else 403 forbidden)
 * - trivial-only → AGM+ suffices
 * `active` changes are NOT handled here — route them through deactivateVendor
 * for the distinct activate/deactivate audit action.
 */
export async function updateVendor(
  actor: AuthContext,
  { id, changes }: { id: string; changes: VendorChanges },
): Promise<void> {
  const level = getRoleLevel(actor.user.role);
  const touched = Object.keys(changes).filter(
    (k) => (changes as Record<string, unknown>)[k] !== undefined,
  );
  if (touched.length === 0) return;

  if (touched.includes("active")) {
    throw new AdminVendorError(400, "invalid_payload", "Use the activate/deactivate path for `active`");
  }
  const knownCols = new Set<string>([...TRIVIAL_COLS, ...FULL_ONLY_COLS]);
  for (const k of touched) {
    if (!knownCols.has(k)) {
      throw new AdminVendorError(400, "invalid_payload", `Unknown column: ${k}`);
    }
  }

  const touchedFull = touched.some((k) => (FULL_ONLY_COLS as readonly string[]).includes(k));
  if (touchedFull && level < VENDOR_FULL_MIN_LEVEL) {
    throw new AdminVendorError(403, "forbidden", "Editing this field requires GM+");
  }
  if (level < VENDOR_READ_MIN_LEVEL) {
    throw new AdminVendorError(403, "forbidden", "Editing a vendor requires AGM+");
  }

  const before = await getVendor(actor, id);
  if (!before) throw new AdminVendorError(404, "vendor_not_found", "Vendor not found");

  const patch = normalizeChanges(changes);
  patch.updated_by = actor.user.id;
  patch.updated_at = new Date().toISOString();

  const sb = getServiceRoleClient();
  const { error, count } = await sb
    .from("vendors")
    .update(patch, { count: "exact" })
    .eq("id", id);
  if (error) throw new Error(`updateVendor failed: ${error.message}`);
  if (count === 0) throw new AdminVendorError(404, "vendor_not_found", "Vendor not found");

  // Build before/after of only the changed fields for the audit row.
  const changedKeys = Object.keys(patch).filter((k) => k !== "updated_by" && k !== "updated_at");
  const beforeRow = before as unknown as Record<string, unknown>;
  const beforeFields: Record<string, unknown> = {};
  const afterFields: Record<string, unknown> = {};
  // Map snake_case patch keys back to camelCase VendorView keys for before-state.
  const SNAKE_TO_CAMEL: Record<string, keyof VendorView> = {
    name: "name",
    category: "category",
    contact_person: "contactPerson",
    contact_email: "contactEmail",
    contact_phone: "contactPhone",
    ordering_email: "orderingEmail",
    ordering_url: "orderingUrl",
    ordering_days: "orderingDays",
    payment_terms: "paymentTerms",
    account_number: "accountNumber",
    notes: "notes",
  };
  for (const k of changedKeys) {
    const camel = SNAKE_TO_CAMEL[k];
    beforeFields[k] = camel ? beforeRow[camel] : null;
    afterFields[k] = patch[k];
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.full_profile_edit",
    resourceTable: "vendors",
    resourceId: id,
    metadata: {
      scope: touchedFull ? "full" : "trivial",
      fields: changedKeys,
      before: beforeFields,
      after: afterFields,
    },
    ipAddress: null,
    userAgent: null,
  });
}

/** Activate or deactivate a vendor (append-only — never DELETE). GM+ only. */
export async function deactivateVendor(
  actor: AuthContext,
  { id, active }: { id: string; active: boolean },
): Promise<void> {
  if (getRoleLevel(actor.user.role) < VENDOR_FULL_MIN_LEVEL) {
    throw new AdminVendorError(403, "forbidden", "Changing vendor active status requires GM+");
  }
  const before = await getVendor(actor, id);
  if (!before) throw new AdminVendorError(404, "vendor_not_found", "Vendor not found");

  const sb = getServiceRoleClient();
  const { error, count } = await sb
    .from("vendors")
    .update(
      { active, updated_by: actor.user.id, updated_at: new Date().toISOString() },
      { count: "exact" },
    )
    .eq("id", id);
  if (error) throw new Error(`deactivateVendor failed: ${error.message}`);
  if (count === 0) throw new AdminVendorError(404, "vendor_not_found", "Vendor not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: active ? "vendor.activate" : "vendor.deactivate",
    resourceTable: "vendors",
    resourceId: id,
    metadata: { from_active: before.active, to_active: active },
    ipAddress: null,
    userAgent: null,
  });
}
