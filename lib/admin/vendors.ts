/**
 * Admin vendor-directory data layer (Vendor Directory v2, Slice A).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level floor → assertStepUp)
 * AND re-checked here per-action (defense in depth; the lib is the authority).
 * Service-role bypasses RLS by design, consistent with lib/admin/users.ts and
 * lib/admin/templates.ts.
 *
 * Append-only: removals flip `active=false`, never DELETE. The last active
 * contact / ordering detail of a vendor cannot be removed (min-1 each).
 *
 * Schema (live, migrations 0090/0091/0092 + 0093 multi-classification):
 *   vendors            — name, category_id (FK→categories, nullable + now
 *                        VESTIGIAL — classification is via the join tables),
 *                        payment_terms, account_number, notes, active, audit.
 *                        Legacy single contact_/ordering_/category(text) cols
 *                        are VESTIGIAL — ignored here.
 *   categories         — slug (unique), label, label_es, active, display_order.
 *   order_types        — slug (unique), label, label_es, active, display_order.
 *                        Mirrors `categories` — the traditional supply view
 *                        (Produce / Dry Goods / Paper / …).
 *   vendor_categories  — vendor_id, category_id join (unique pair, NO `active`
 *                        column — set-membership hard rows; replace = delete the
 *                        rows not in the set + insert the new ones).
 *   vendor_order_types — vendor_id, order_type_id join (same shape as above).
 *   vendor_contacts    — vendor_id, name, email, phone, display_order, active.
 *   vendor_ordering_details — vendor_id, method (email|url|phone|portal|other),
 *                             value, label, display_order, active.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

// ── Authority floors (the lib is the authority per-action) ──────────────────
const READ_MIN = 6; // AGM+
const AGM_MIN = 6; // append contact / ordering
const GM_MIN = 7; // create vendor, edit/remove contact-ordering, notes
const MOO_MIN = 8; // edit core fields, deactivate vendor, add category

const ORDERING_METHODS = ["email", "url", "phone", "portal", "other"] as const;
export type OrderingMethod = (typeof ORDERING_METHODS)[number];

// ── Types ───────────────────────────────────────────────────────────────────
export interface CategoryView {
  id: string;
  slug: string;
  label: string;
  labelEs: string | null;
}

export interface OrderTypeView {
  id: string;
  slug: string;
  label: string;
  labelEs: string | null;
}

export interface VendorContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  displayOrder: number;
}

export interface VendorOrderingDetail {
  id: string;
  method: OrderingMethod;
  value: string;
  label: string | null;
  displayOrder: number;
}

export interface VendorView {
  id: string;
  name: string;
  paymentTerms: string | null;
  accountNumber: string | null;
  notes: string | null;
  active: boolean;
  /** Multi-classification (Vendor Directory v2.1): a vendor affects MULTIPLE
   *  categories AND has MULTIPLE order types. Each hydrated from its join table,
   *  ordered by the registry display_order. The vestigial vendors.category_id
   *  single FK is ignored — categories come from vendor_categories. */
  categories: Array<{ id: string; slug: string; label: string }>;
  orderTypes: Array<{ id: string; slug: string; label: string }>;
  contacts: VendorContact[];
  orderingDetails: VendorOrderingDetail[];
}

/** Typed error the routes map to jsonError(status, code). */
export class AdminVendorError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminVendorError";
  }
}

// ── Internal guards ──────────────────────────────────────────────────────────
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new AdminVendorError(403, "forbidden", "Insufficient role level for this action");
  }
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const e = email.trim().toLowerCase();
  return e || null;
}

function normalizeOptional(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t || null;
}

interface DbVendorRow {
  id: string;
  name: string;
  payment_terms: string | null;
  account_number: string | null;
  notes: string | null;
  active: boolean | null;
  category_id: string | null;
}
interface DbContactRow {
  id: string;
  vendor_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  display_order: number;
}
interface DbOrderingRow {
  id: string;
  vendor_id: string;
  method: string;
  value: string;
  label: string | null;
  display_order: number;
}
interface DbCategoryRow {
  id: string;
  slug: string;
  label: string;
  label_es: string | null;
}
interface DbOrderTypeRow {
  id: string;
  slug: string;
  label: string;
  label_es: string | null;
}
interface DbVendorCategoryRow {
  vendor_id: string;
  category_id: string;
}
interface DbVendorOrderTypeRow {
  vendor_id: string;
  order_type_id: string;
}

const VENDOR_COLS = "id, name, payment_terms, account_number, notes, active, category_id";

// ── Categories ────────────────────────────────────────────────────────────────
export async function loadCategories(actor: AuthContext): Promise<CategoryView[]> {
  requireLevel(actor, READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("categories")
    .select("id, slug, label, label_es")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<DbCategoryRow[]>();
  if (error) throw new Error(`loadCategories failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.label,
    labelEs: r.label_es,
  }));
}

/** Derive a stable slug from a label: trim, collapse whitespace, strip
 *  non-alphanumerics, PascalCase. Mirrors slugifySection in lib/admin/templates.ts. */
export function slugifyCategory(label: string): string {
  const token = label
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  if (!token) throw new AdminVendorError(400, "invalid_label", "Category label is empty after slugify");
  return token;
}

export async function addCategory(
  actor: AuthContext,
  args: { label: string; labelEs?: string | null },
): Promise<{ id: string; slug: string }> {
  requireLevel(actor, MOO_MIN);
  const label = args.label.trim();
  if (!label) throw new AdminVendorError(400, "invalid_label", "Label cannot be empty");
  const slug = slugifyCategory(label);
  const labelEs = normalizeOptional(args.labelEs);

  const sb = getServiceRoleClient();

  // Dup-guard on slug (stable system key).
  const { data: existing, error: eErr } = await sb
    .from("categories")
    .select("id")
    .eq("slug", slug)
    .maybeSingle<{ id: string }>();
  if (eErr) throw new Error(`addCategory dup check failed: ${eErr.message}`);
  if (existing) throw new AdminVendorError(409, "category_exists", "A category with that slug already exists");

  // display_order = max active + 1.
  const { data: maxRow, error: mErr } = await sb
    .from("categories")
    .select("display_order")
    .eq("active", true)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mErr) throw new Error(`addCategory max order failed: ${mErr.message}`);
  const displayOrder = (maxRow?.display_order ?? 0) + 1;

  const { data: inserted, error: iErr } = await sb
    .from("categories")
    .insert({
      slug,
      label,
      label_es: labelEs,
      active: true,
      display_order: displayOrder,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) throw new Error(`addCategory insert failed: ${iErr.message}`);
  if (!inserted) throw new Error("addCategory insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "category.create",
    resourceTable: "categories",
    resourceId: inserted.id,
    metadata: { slug, label, label_es: labelEs, display_order: displayOrder },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id, slug };
}

// ── Order types (mirrors categories exactly — the traditional supply view) ─────
export async function loadOrderTypes(actor: AuthContext): Promise<OrderTypeView[]> {
  requireLevel(actor, READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("order_types")
    .select("id, slug, label, label_es")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<DbOrderTypeRow[]>();
  if (error) throw new Error(`loadOrderTypes failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.label,
    labelEs: r.label_es,
  }));
}

export async function addOrderType(
  actor: AuthContext,
  args: { label: string; labelEs?: string | null },
): Promise<{ id: string; slug: string }> {
  requireLevel(actor, MOO_MIN);
  const label = args.label.trim();
  if (!label) throw new AdminVendorError(400, "invalid_label", "Label cannot be empty");
  const slug = slugifyCategory(label); // same slugify rule as categories
  const labelEs = normalizeOptional(args.labelEs);

  const sb = getServiceRoleClient();

  // Dup-guard on slug (stable system key).
  const { data: existing, error: eErr } = await sb
    .from("order_types")
    .select("id")
    .eq("slug", slug)
    .maybeSingle<{ id: string }>();
  if (eErr) throw new Error(`addOrderType dup check failed: ${eErr.message}`);
  if (existing) throw new AdminVendorError(409, "order_type_exists", "An order type with that slug already exists");

  // display_order = max active + 1.
  const { data: maxRow, error: mErr } = await sb
    .from("order_types")
    .select("display_order")
    .eq("active", true)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mErr) throw new Error(`addOrderType max order failed: ${mErr.message}`);
  const displayOrder = (maxRow?.display_order ?? 0) + 1;

  const { data: inserted, error: iErr } = await sb
    .from("order_types")
    .insert({
      slug,
      label,
      label_es: labelEs,
      active: true,
      display_order: displayOrder,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) throw new Error(`addOrderType insert failed: ${iErr.message}`);
  if (!inserted) throw new Error("addOrderType insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "order_type.create",
    resourceTable: "order_types",
    resourceId: inserted.id,
    metadata: { slug, label, label_es: labelEs, display_order: displayOrder },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id, slug };
}

// ── Vendor reads (hydrate categories + order types + active contacts/ordering) ─
async function hydrateVendors(rows: DbVendorRow[]): Promise<VendorView[]> {
  if (rows.length === 0) return [];
  const sb = getServiceRoleClient();
  const vendorIds = rows.map((r) => r.id);

  // ── Categories via the vendor_categories join (batched .in() over vendor ids).
  const { data: vcJoins, error: vcErr } = await sb
    .from("vendor_categories")
    .select("vendor_id, category_id")
    .in("vendor_id", vendorIds)
    .returns<DbVendorCategoryRow[]>();
  if (vcErr) throw new Error(`hydrateVendors vendor_categories failed: ${vcErr.message}`);
  const categoryIds = [...new Set((vcJoins ?? []).map((j) => j.category_id))];
  const catMap = new Map<string, DbCategoryRow>();
  if (categoryIds.length > 0) {
    const { data: cats, error: cErr } = await sb
      .from("categories")
      .select("id, slug, label, label_es")
      .in("id", categoryIds)
      .order("display_order", { ascending: true })
      .returns<DbCategoryRow[]>();
    if (cErr) throw new Error(`hydrateVendors categories failed: ${cErr.message}`);
    for (const c of cats ?? []) catMap.set(c.id, c);
  }

  // ── Order types via the vendor_order_types join.
  const { data: votJoins, error: votErr } = await sb
    .from("vendor_order_types")
    .select("vendor_id, order_type_id")
    .in("vendor_id", vendorIds)
    .returns<DbVendorOrderTypeRow[]>();
  if (votErr) throw new Error(`hydrateVendors vendor_order_types failed: ${votErr.message}`);
  const orderTypeIds = [...new Set((votJoins ?? []).map((j) => j.order_type_id))];
  const otMap = new Map<string, DbOrderTypeRow>();
  if (orderTypeIds.length > 0) {
    const { data: ots, error: otErr } = await sb
      .from("order_types")
      .select("id, slug, label, label_es")
      .in("id", orderTypeIds)
      .order("display_order", { ascending: true })
      .returns<DbOrderTypeRow[]>();
    if (otErr) throw new Error(`hydrateVendors order_types failed: ${otErr.message}`);
    for (const o of ots ?? []) otMap.set(o.id, o);
  }

  // Build per-vendor classification lists, ordered by the registry display_order
  // (catMap/otMap iteration order follows the ordered .in() fetch above).
  const categoriesByVendor = new Map<string, Array<{ id: string; slug: string; label: string }>>();
  for (const j of vcJoins ?? []) {
    const cat = catMap.get(j.category_id);
    if (!cat) continue;
    const arr = categoriesByVendor.get(j.vendor_id) ?? [];
    arr.push({ id: cat.id, slug: cat.slug, label: cat.label });
    categoriesByVendor.set(j.vendor_id, arr);
  }
  const orderTypesByVendor = new Map<string, Array<{ id: string; slug: string; label: string }>>();
  for (const j of votJoins ?? []) {
    const ot = otMap.get(j.order_type_id);
    if (!ot) continue;
    const arr = orderTypesByVendor.get(j.vendor_id) ?? [];
    arr.push({ id: ot.id, slug: ot.slug, label: ot.label });
    orderTypesByVendor.set(j.vendor_id, arr);
  }
  // Sort each vendor's lists by registry display_order via the map (Map preserves
  // insert order = the ordered registry fetch). Re-sort defensively by label-stable
  // ordering using the registry rows' position.
  const catOrder = new Map([...catMap.keys()].map((id, i) => [id, i] as const));
  const otOrder = new Map([...otMap.keys()].map((id, i) => [id, i] as const));
  for (const arr of categoriesByVendor.values()) {
    arr.sort((a, b) => (catOrder.get(a.id) ?? 0) - (catOrder.get(b.id) ?? 0));
  }
  for (const arr of orderTypesByVendor.values()) {
    arr.sort((a, b) => (otOrder.get(a.id) ?? 0) - (otOrder.get(b.id) ?? 0));
  }

  const { data: contacts, error: ctErr } = await sb
    .from("vendor_contacts")
    .select("id, vendor_id, name, email, phone, display_order")
    .in("vendor_id", vendorIds)
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<DbContactRow[]>();
  if (ctErr) throw new Error(`hydrateVendors contacts failed: ${ctErr.message}`);

  const { data: ordering, error: oErr } = await sb
    .from("vendor_ordering_details")
    .select("id, vendor_id, method, value, label, display_order")
    .in("vendor_id", vendorIds)
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<DbOrderingRow[]>();
  if (oErr) throw new Error(`hydrateVendors ordering failed: ${oErr.message}`);

  const contactsByVendor = new Map<string, VendorContact[]>();
  for (const c of contacts ?? []) {
    const arr = contactsByVendor.get(c.vendor_id) ?? [];
    arr.push({ id: c.id, name: c.name, email: c.email, phone: c.phone, displayOrder: c.display_order });
    contactsByVendor.set(c.vendor_id, arr);
  }
  const orderingByVendor = new Map<string, VendorOrderingDetail[]>();
  for (const o of ordering ?? []) {
    const arr = orderingByVendor.get(o.vendor_id) ?? [];
    arr.push({
      id: o.id,
      method: (ORDERING_METHODS as readonly string[]).includes(o.method)
        ? (o.method as OrderingMethod)
        : "other",
      value: o.value,
      label: o.label,
      displayOrder: o.display_order,
    });
    orderingByVendor.set(o.vendor_id, arr);
  }

  return rows.map((r) => {
    return {
      id: r.id,
      name: r.name,
      paymentTerms: r.payment_terms,
      accountNumber: r.account_number,
      notes: r.notes,
      active: r.active ?? true, // legacy null → active
      categories: categoriesByVendor.get(r.id) ?? [],
      orderTypes: orderTypesByVendor.get(r.id) ?? [],
      contacts: contactsByVendor.get(r.id) ?? [],
      orderingDetails: orderingByVendor.get(r.id) ?? [],
    };
  });
}

export async function loadVendors(actor: AuthContext): Promise<VendorView[]> {
  requireLevel(actor, READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendors")
    .select(VENDOR_COLS)
    .order("name", { ascending: true })
    .returns<DbVendorRow[]>();
  if (error) throw new Error(`loadVendors failed: ${error.message}`);
  return hydrateVendors(data ?? []);
}

export async function getVendor(actor: AuthContext, id: string): Promise<VendorView | null> {
  requireLevel(actor, READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendors")
    .select(VENDOR_COLS)
    .eq("id", id)
    .maybeSingle<DbVendorRow>();
  if (error) throw new Error(`getVendor failed: ${error.message}`);
  if (!data) return null;
  const [view] = await hydrateVendors([data]);
  return view ?? null;
}

/** Validate a non-empty set of category ids: ≥1 required, all must exist+active.
 *  Returns the de-duplicated id list. (The singular assertCategoryExists was
 *  removed in v2.1 — category is now multi via the join, validated in bulk.) */
async function assertCategoriesExist(categoryIds: string[]): Promise<string[]> {
  const ids = [...new Set(categoryIds.filter((c) => typeof c === "string" && c))];
  if (ids.length === 0) {
    throw new AdminVendorError(400, "invalid_category", "At least one category is required");
  }
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("categories")
    .select("id")
    .in("id", ids)
    .eq("active", true)
    .returns<{ id: string }[]>();
  if (error) throw new Error(`assertCategoriesExist failed: ${error.message}`);
  const found = new Set((data ?? []).map((r) => r.id));
  for (const id of ids) {
    if (!found.has(id)) throw new AdminVendorError(400, "invalid_category", "Category not found or inactive");
  }
  return ids;
}

/** Validate a non-empty set of order_type ids: ≥1 required, all must exist+active.
 *  Returns the de-duplicated id list. */
async function assertOrderTypesExist(orderTypeIds: string[]): Promise<string[]> {
  const ids = [...new Set(orderTypeIds.filter((c) => typeof c === "string" && c))];
  if (ids.length === 0) {
    throw new AdminVendorError(400, "invalid_order_type", "At least one order type is required");
  }
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("order_types")
    .select("id")
    .in("id", ids)
    .eq("active", true)
    .returns<{ id: string }[]>();
  if (error) throw new Error(`assertOrderTypesExist failed: ${error.message}`);
  const found = new Set((data ?? []).map((r) => r.id));
  for (const id of ids) {
    if (!found.has(id)) throw new AdminVendorError(400, "invalid_order_type", "Order type not found or inactive");
  }
  return ids;
}

/** Load a vendor row (id only) or throw 404. */
async function requireVendorRow(id: string): Promise<{ id: string }> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendors")
    .select("id")
    .eq("id", id)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`requireVendorRow failed: ${error.message}`);
  if (!data) throw new AdminVendorError(404, "not_found", "Vendor not found");
  return data;
}

// ── Vendor create (GM+; seeds first contact + first ordering detail) ──────────
export interface CreateVendorInput {
  name: string;
  categoryIds: string[];
  orderTypeIds: string[];
  paymentTerms?: string | null;
  accountNumber?: string | null;
  notes?: string | null;
  firstContact: { name: string; email?: string | null; phone?: string | null };
  firstOrdering: { method: string; value: string; label?: string | null };
}

export async function createVendor(
  actor: AuthContext,
  input: CreateVendorInput,
): Promise<{ id: string }> {
  requireLevel(actor, GM_MIN);

  const name = input.name.trim();
  if (!name) throw new AdminVendorError(400, "invalid_name", "Vendor name is required");
  // ≥1 category AND ≥1 order type required; all ids must exist + be active.
  const categoryIds = await assertCategoriesExist(input.categoryIds ?? []);
  const orderTypeIds = await assertOrderTypesExist(input.orderTypeIds ?? []);

  const contactName = input.firstContact?.name?.trim() ?? "";
  if (!contactName) throw new AdminVendorError(400, "invalid_contact", "First contact name is required");

  const method = input.firstOrdering?.method;
  if (!(ORDERING_METHODS as readonly string[]).includes(method)) {
    throw new AdminVendorError(400, "invalid_method", "Ordering method must be one of email|url|phone|portal|other");
  }
  const orderingValue = input.firstOrdering?.value?.trim() ?? "";
  if (!orderingValue) throw new AdminVendorError(400, "invalid_ordering", "First ordering detail value is required");

  const sb = getServiceRoleClient();

  // Leave vendors.category_id NULL going forward — classification is via the
  // vendor_categories / vendor_order_types join tables.
  const { data: vendorRow, error: vErr } = await sb
    .from("vendors")
    .insert({
      name,
      category_id: null,
      payment_terms: normalizeOptional(input.paymentTerms),
      account_number: normalizeOptional(input.accountNumber),
      notes: normalizeOptional(input.notes),
      active: true,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (vErr) throw new Error(`createVendor vendor insert failed: ${vErr.message}`);
  if (!vendorRow) throw new Error("createVendor vendor insert returned no row");

  const { error: vcErr } = await sb.from("vendor_categories").insert(
    categoryIds.map((category_id) => ({
      vendor_id: vendorRow.id,
      category_id,
      created_by: actor.user.id,
    })),
  );
  if (vcErr) throw new Error(`createVendor vendor_categories insert failed: ${vcErr.message}`);

  const { error: votErr } = await sb.from("vendor_order_types").insert(
    orderTypeIds.map((order_type_id) => ({
      vendor_id: vendorRow.id,
      order_type_id,
      created_by: actor.user.id,
    })),
  );
  if (votErr) throw new Error(`createVendor vendor_order_types insert failed: ${votErr.message}`);

  const { error: cErr } = await sb.from("vendor_contacts").insert({
    vendor_id: vendorRow.id,
    name: contactName,
    email: normalizeEmail(input.firstContact.email),
    phone: normalizeOptional(input.firstContact.phone),
    display_order: 0,
    active: true,
    created_by: actor.user.id,
    updated_by: actor.user.id,
  });
  if (cErr) throw new Error(`createVendor first contact insert failed: ${cErr.message}`);

  const { error: oErr } = await sb.from("vendor_ordering_details").insert({
    vendor_id: vendorRow.id,
    method,
    value: orderingValue,
    label: normalizeOptional(input.firstOrdering.label),
    display_order: 0,
    active: true,
    created_by: actor.user.id,
    updated_by: actor.user.id,
  });
  if (oErr) throw new Error(`createVendor first ordering insert failed: ${oErr.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.create",
    resourceTable: "vendors",
    resourceId: vendorRow.id,
    metadata: {
      name,
      category_ids: categoryIds,
      order_type_ids: orderTypeIds,
      seeded_contact: true,
      seeded_ordering: true,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { id: vendorRow.id };
}

// ── Vendor core / notes / deactivate ──────────────────────────────────────────
export interface UpdateVendorCoreChanges {
  name?: string;
  paymentTerms?: string | null;
  accountNumber?: string | null;
}

export async function updateVendorCore(
  actor: AuthContext,
  args: { id: string; changes: UpdateVendorCoreChanges },
): Promise<void> {
  requireLevel(actor, MOO_MIN);
  await requireVendorRow(args.id);

  const update: Record<string, unknown> = {};
  const { changes } = args;
  if (changes.name !== undefined) {
    const n = changes.name.trim();
    if (!n) throw new AdminVendorError(400, "invalid_name", "Vendor name cannot be empty");
    update.name = n;
  }
  if (changes.paymentTerms !== undefined) update.payment_terms = normalizeOptional(changes.paymentTerms);
  if (changes.accountNumber !== undefined) update.account_number = normalizeOptional(changes.accountNumber);

  if (Object.keys(update).length === 0) return;
  // NOTE: category is no longer a core field — classification edits go through
  // setVendorCategories / setVendorOrderTypes (GM+).
  update.updated_by = actor.user.id;
  update.updated_at = new Date().toISOString();

  const sb = getServiceRoleClient();
  const { error } = await sb.from("vendors").update(update).eq("id", args.id);
  if (error) throw new Error(`updateVendorCore failed: ${error.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.full_profile_edit",
    resourceTable: "vendors",
    resourceId: args.id,
    metadata: { scope: "core", fields: Object.keys(update).filter((k) => k !== "updated_by" && k !== "updated_at") },
    ipAddress: null,
    userAgent: null,
  });
}

// ── Classification (GM+): replace the vendor's category / order-type set ──────
//
// These join tables have NO `active` column — they're set-membership HARD rows,
// not the append-only config pattern. Replacing the set therefore DELETEs the
// rows not in the new set + INSERTs the new ones. Hard-delete is acceptable here
// precisely because a join row carries no state of its own (no audit-relevant
// history beyond created_at/by); the forensic record lives on the
// vendor.full_profile_edit audit row below (before/after id sets).
export async function setVendorCategories(
  actor: AuthContext,
  args: { vendorId: string; categoryIds: string[] },
): Promise<void> {
  requireLevel(actor, GM_MIN);
  await requireVendorRow(args.vendorId);
  const desired = await assertCategoriesExist(args.categoryIds ?? []); // ≥1 enforced

  const sb = getServiceRoleClient();
  const { data: existingRows, error: exErr } = await sb
    .from("vendor_categories")
    .select("category_id")
    .eq("vendor_id", args.vendorId)
    .returns<{ category_id: string }[]>();
  if (exErr) throw new Error(`setVendorCategories load failed: ${exErr.message}`);
  const existing = new Set((existingRows ?? []).map((r) => r.category_id));
  const desiredSet = new Set(desired);

  const toAdd = desired.filter((id) => !existing.has(id));
  const toRemove = [...existing].filter((id) => !desiredSet.has(id));

  if (toRemove.length > 0) {
    const { error: dErr } = await sb
      .from("vendor_categories")
      .delete()
      .eq("vendor_id", args.vendorId)
      .in("category_id", toRemove);
    if (dErr) throw new Error(`setVendorCategories delete failed: ${dErr.message}`);
  }
  if (toAdd.length > 0) {
    const { error: aErr } = await sb.from("vendor_categories").insert(
      toAdd.map((category_id) => ({ vendor_id: args.vendorId, category_id, created_by: actor.user.id })),
    );
    if (aErr) throw new Error(`setVendorCategories insert failed: ${aErr.message}`);
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.full_profile_edit",
    resourceTable: "vendors",
    resourceId: args.vendorId,
    metadata: { scope: "categories", before: [...existing], after: desired },
    ipAddress: null,
    userAgent: null,
  });
}

export async function setVendorOrderTypes(
  actor: AuthContext,
  args: { vendorId: string; orderTypeIds: string[] },
): Promise<void> {
  requireLevel(actor, GM_MIN);
  await requireVendorRow(args.vendorId);
  const desired = await assertOrderTypesExist(args.orderTypeIds ?? []); // ≥1 enforced

  const sb = getServiceRoleClient();
  const { data: existingRows, error: exErr } = await sb
    .from("vendor_order_types")
    .select("order_type_id")
    .eq("vendor_id", args.vendorId)
    .returns<{ order_type_id: string }[]>();
  if (exErr) throw new Error(`setVendorOrderTypes load failed: ${exErr.message}`);
  const existing = new Set((existingRows ?? []).map((r) => r.order_type_id));
  const desiredSet = new Set(desired);

  const toAdd = desired.filter((id) => !existing.has(id));
  const toRemove = [...existing].filter((id) => !desiredSet.has(id));

  if (toRemove.length > 0) {
    const { error: dErr } = await sb
      .from("vendor_order_types")
      .delete()
      .eq("vendor_id", args.vendorId)
      .in("order_type_id", toRemove);
    if (dErr) throw new Error(`setVendorOrderTypes delete failed: ${dErr.message}`);
  }
  if (toAdd.length > 0) {
    const { error: aErr } = await sb.from("vendor_order_types").insert(
      toAdd.map((order_type_id) => ({ vendor_id: args.vendorId, order_type_id, created_by: actor.user.id })),
    );
    if (aErr) throw new Error(`setVendorOrderTypes insert failed: ${aErr.message}`);
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.full_profile_edit",
    resourceTable: "vendors",
    resourceId: args.vendorId,
    metadata: { scope: "order_types", before: [...existing], after: desired },
    ipAddress: null,
    userAgent: null,
  });
}

export async function updateVendorNotes(
  actor: AuthContext,
  args: { id: string; notes: string | null },
): Promise<void> {
  requireLevel(actor, GM_MIN);
  await requireVendorRow(args.id);
  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("vendors")
    .update({ notes: normalizeOptional(args.notes), updated_by: actor.user.id, updated_at: new Date().toISOString() })
    .eq("id", args.id);
  if (error) throw new Error(`updateVendorNotes failed: ${error.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.full_profile_edit",
    resourceTable: "vendors",
    resourceId: args.id,
    metadata: { scope: "notes" },
    ipAddress: null,
    userAgent: null,
  });
}

export async function deactivateVendor(
  actor: AuthContext,
  args: { id: string; active: boolean },
): Promise<void> {
  requireLevel(actor, MOO_MIN);
  await requireVendorRow(args.id);
  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("vendors")
    .update({ active: args.active, updated_by: actor.user.id, updated_at: new Date().toISOString() })
    .eq("id", args.id);
  if (error) throw new Error(`deactivateVendor failed: ${error.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: args.active ? "vendor.activate" : "vendor.deactivate",
    resourceTable: "vendors",
    resourceId: args.id,
    metadata: {},
    ipAddress: null,
    userAgent: null,
  });
}

// ── Contacts ──────────────────────────────────────────────────────────────────
export async function addVendorContact(
  actor: AuthContext,
  args: { vendorId: string; name: string; email?: string | null; phone?: string | null },
): Promise<{ id: string }> {
  requireLevel(actor, AGM_MIN);
  await requireVendorRow(args.vendorId);
  const name = args.name.trim();
  if (!name) throw new AdminVendorError(400, "invalid_contact", "Contact name is required");

  const sb = getServiceRoleClient();
  const { data: maxRow, error: mErr } = await sb
    .from("vendor_contacts")
    .select("display_order")
    .eq("vendor_id", args.vendorId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mErr) throw new Error(`addVendorContact max order failed: ${mErr.message}`);
  const displayOrder = (maxRow?.display_order ?? -1) + 1;

  const { data: inserted, error: iErr } = await sb
    .from("vendor_contacts")
    .insert({
      vendor_id: args.vendorId,
      name,
      email: normalizeEmail(args.email),
      phone: normalizeOptional(args.phone),
      display_order: displayOrder,
      active: true,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) throw new Error(`addVendorContact insert failed: ${iErr.message}`);
  if (!inserted) throw new Error("addVendorContact insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.contact_change",
    resourceTable: "vendor_contacts",
    resourceId: inserted.id,
    metadata: { op: "add", vendor_id: args.vendorId },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id };
}

export interface UpdateContactChanges {
  name?: string;
  email?: string | null;
  phone?: string | null;
}

async function requireContactRow(contactId: string): Promise<{ id: string; vendor_id: string }> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendor_contacts")
    .select("id, vendor_id")
    .eq("id", contactId)
    .maybeSingle<{ id: string; vendor_id: string }>();
  if (error) throw new Error(`requireContactRow failed: ${error.message}`);
  if (!data) throw new AdminVendorError(404, "not_found", "Contact not found");
  return data;
}

export async function updateVendorContact(
  actor: AuthContext,
  args: { contactId: string; changes: UpdateContactChanges },
): Promise<void> {
  requireLevel(actor, GM_MIN);
  const row = await requireContactRow(args.contactId);

  const update: Record<string, unknown> = {};
  const { changes } = args;
  if (changes.name !== undefined) {
    const n = changes.name.trim();
    if (!n) throw new AdminVendorError(400, "invalid_contact", "Contact name cannot be empty");
    update.name = n;
  }
  if (changes.email !== undefined) update.email = normalizeEmail(changes.email);
  if (changes.phone !== undefined) update.phone = normalizeOptional(changes.phone);
  if (Object.keys(update).length === 0) return;
  update.updated_by = actor.user.id;
  update.updated_at = new Date().toISOString();

  const sb = getServiceRoleClient();
  const { error } = await sb.from("vendor_contacts").update(update).eq("id", args.contactId);
  if (error) throw new Error(`updateVendorContact failed: ${error.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.contact_change",
    resourceTable: "vendor_contacts",
    resourceId: args.contactId,
    metadata: { op: "update", vendor_id: row.vendor_id, fields: Object.keys(update).filter((k) => k !== "updated_by" && k !== "updated_at") },
    ipAddress: null,
    userAgent: null,
  });
}

export async function removeVendorContact(
  actor: AuthContext,
  args: { contactId: string },
): Promise<void> {
  requireLevel(actor, GM_MIN);
  const row = await requireContactRow(args.contactId);

  const sb = getServiceRoleClient();
  // Count active contacts for this vendor — block removal of the last one.
  const { count, error: cErr } = await sb
    .from("vendor_contacts")
    .select("id", { count: "exact", head: true })
    .eq("vendor_id", row.vendor_id)
    .eq("active", true);
  if (cErr) throw new Error(`removeVendorContact count failed: ${cErr.message}`);
  if ((count ?? 0) <= 1) {
    throw new AdminVendorError(400, "last_contact", "Cannot remove the last active contact");
  }

  const { error } = await sb
    .from("vendor_contacts")
    .update({ active: false, updated_by: actor.user.id, updated_at: new Date().toISOString() })
    .eq("id", args.contactId)
    .eq("active", true);
  if (error) throw new Error(`removeVendorContact failed: ${error.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.contact_change",
    resourceTable: "vendor_contacts",
    resourceId: args.contactId,
    metadata: { op: "remove", vendor_id: row.vendor_id },
    ipAddress: null,
    userAgent: null,
  });
}

// ── Ordering details ──────────────────────────────────────────────────────────
export async function addVendorOrderingDetail(
  actor: AuthContext,
  args: { vendorId: string; method: string; value: string; label?: string | null },
): Promise<{ id: string }> {
  requireLevel(actor, AGM_MIN);
  await requireVendorRow(args.vendorId);
  if (!(ORDERING_METHODS as readonly string[]).includes(args.method)) {
    throw new AdminVendorError(400, "invalid_method", "Ordering method must be one of email|url|phone|portal|other");
  }
  const value = args.value.trim();
  if (!value) throw new AdminVendorError(400, "invalid_ordering", "Ordering detail value is required");

  const sb = getServiceRoleClient();
  const { data: maxRow, error: mErr } = await sb
    .from("vendor_ordering_details")
    .select("display_order")
    .eq("vendor_id", args.vendorId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mErr) throw new Error(`addVendorOrderingDetail max order failed: ${mErr.message}`);
  const displayOrder = (maxRow?.display_order ?? -1) + 1;

  const { data: inserted, error: iErr } = await sb
    .from("vendor_ordering_details")
    .insert({
      vendor_id: args.vendorId,
      method: args.method,
      value,
      label: normalizeOptional(args.label),
      display_order: displayOrder,
      active: true,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) throw new Error(`addVendorOrderingDetail insert failed: ${iErr.message}`);
  if (!inserted) throw new Error("addVendorOrderingDetail insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.ordering_change",
    resourceTable: "vendor_ordering_details",
    resourceId: inserted.id,
    metadata: { op: "add", vendor_id: args.vendorId, method: args.method },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id };
}

export interface UpdateOrderingChanges {
  method?: string;
  value?: string;
  label?: string | null;
}

async function requireOrderingRow(detailId: string): Promise<{ id: string; vendor_id: string }> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendor_ordering_details")
    .select("id, vendor_id")
    .eq("id", detailId)
    .maybeSingle<{ id: string; vendor_id: string }>();
  if (error) throw new Error(`requireOrderingRow failed: ${error.message}`);
  if (!data) throw new AdminVendorError(404, "not_found", "Ordering detail not found");
  return data;
}

export async function updateVendorOrderingDetail(
  actor: AuthContext,
  args: { detailId: string; changes: UpdateOrderingChanges },
): Promise<void> {
  requireLevel(actor, GM_MIN);
  const row = await requireOrderingRow(args.detailId);

  const update: Record<string, unknown> = {};
  const { changes } = args;
  if (changes.method !== undefined) {
    if (!(ORDERING_METHODS as readonly string[]).includes(changes.method)) {
      throw new AdminVendorError(400, "invalid_method", "Ordering method must be one of email|url|phone|portal|other");
    }
    update.method = changes.method;
  }
  if (changes.value !== undefined) {
    const v = changes.value.trim();
    if (!v) throw new AdminVendorError(400, "invalid_ordering", "Ordering detail value cannot be empty");
    update.value = v;
  }
  if (changes.label !== undefined) update.label = normalizeOptional(changes.label);
  if (Object.keys(update).length === 0) return;
  update.updated_by = actor.user.id;
  update.updated_at = new Date().toISOString();

  const sb = getServiceRoleClient();
  const { error } = await sb.from("vendor_ordering_details").update(update).eq("id", args.detailId);
  if (error) throw new Error(`updateVendorOrderingDetail failed: ${error.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.ordering_change",
    resourceTable: "vendor_ordering_details",
    resourceId: args.detailId,
    metadata: { op: "update", vendor_id: row.vendor_id, fields: Object.keys(update).filter((k) => k !== "updated_by" && k !== "updated_at") },
    ipAddress: null,
    userAgent: null,
  });
}

export async function removeVendorOrderingDetail(
  actor: AuthContext,
  args: { detailId: string },
): Promise<void> {
  requireLevel(actor, GM_MIN);
  const row = await requireOrderingRow(args.detailId);

  const sb = getServiceRoleClient();
  const { count, error: cErr } = await sb
    .from("vendor_ordering_details")
    .select("id", { count: "exact", head: true })
    .eq("vendor_id", row.vendor_id)
    .eq("active", true);
  if (cErr) throw new Error(`removeVendorOrderingDetail count failed: ${cErr.message}`);
  if ((count ?? 0) <= 1) {
    throw new AdminVendorError(400, "last_ordering_detail", "Cannot remove the last active ordering detail");
  }

  const { error } = await sb
    .from("vendor_ordering_details")
    .update({ active: false, updated_by: actor.user.id, updated_at: new Date().toISOString() })
    .eq("id", args.detailId)
    .eq("active", true);
  if (error) throw new Error(`removeVendorOrderingDetail failed: ${error.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.ordering_change",
    resourceTable: "vendor_ordering_details",
    resourceId: args.detailId,
    metadata: { op: "remove", vendor_id: row.vendor_id },
    ipAddress: null,
    userAgent: null,
  });
}
