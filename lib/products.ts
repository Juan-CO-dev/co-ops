/**
 * Product registry — SERVER layer (product identity above SKUs, migration 0179).
 *
 * SERVER-ONLY. Service-role client throughout; authorization is enforced
 * APP-LAYER by the calling routes AND re-checked here per-action (defense in
 * depth, the lib is the authority) — lib/admin/skus.ts is the shape this file
 * follows deliberately.
 *
 * A PRODUCT is the raw identity a recipe means ("HAM"), independent of which
 * vendor supplied it; member SKUs attach beneath it via vendor_items.product_id.
 * A SKU with product_id NULL is an implicit SINGLETON and needs no row here.
 * The PURE half — the resolution ladder, the recipe basis, the divergence
 * advisory — lives in lib/products-shared.ts and is imported, never re-derived:
 * one function decides which member a product means, forever.
 *
 * Append-only: a product retires via active = false, never DELETE. Detaching a
 * member nulls vendor_items.product_id (config, not history).
 *
 * MIGRATION GATE (M1): this module reads tables and columns that migration
 * 0179_product_identity.sql creates. Until the lead applies it, every loader
 * degrades to a named `products_schema_pending` (503) rather than a 500, and
 * /admin/products renders an honest "arrives with migration 0179" state. No
 * other surface imports this module, so the rest of the app is untouched.
 */

import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import {
  resolveProductMember,
  membersDisagreeOnUnitOz,
  type ProductMember,
} from "@/lib/products-shared";

// ── Authority floors (the lib is the authority per-action) ───────────────────
/** AGM+ — read the registry (the vendor_items read / cost-read floor). */
export const PRODUCT_READ_MIN = 6;
/** GM+ — create a product, attach/detach members, set a primary, set unit_oz.
 *  A product is SKU-registry-grade config, so it rides SKU_WRITE_MIN's floor
 *  (lib/admin/skus.ts). Lead ruling 2026-08-20: structural edits are 7. */
export const PRODUCT_WRITE_MIN = 7;

/** Typed error the routes map to jsonError(status, code). Mirrors AdminSkuError. */
export class ProductError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "ProductError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new ProductError(403, "forbidden", "Insufficient role level for this action");
  }
}

function normalizeOptional(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t || null;
}

/** numeric off PostgREST arrives as `number | string | null`. */
function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * Is this PostgREST error "the 0179 tables/columns do not exist yet"? The M1 gate
 * means a preview deploy can precede the migration by design, and a 500 on the
 * admin hub would be a lie about what is wrong. PostgREST reports an unknown
 * relation as PGRST205 (schema cache) and Postgres as 42P01 / 42703.
 */
function isSchemaPending(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  if (code === "PGRST205" || code === "PGRST204" || code === "42P01" || code === "42703") return true;
  const msg = (err.message ?? "").toLowerCase();
  return (
    msg.includes("could not find the table") ||
    msg.includes("could not find the 'product_id' column") ||
    (msg.includes("relation") && msg.includes("does not exist"))
  );
}

function throwIfSchemaPending(err: { code?: string | null; message?: string | null } | null, where: string): void {
  if (isSchemaPending(err)) {
    throw new ProductError(
      503,
      "products_schema_pending",
      `${where}: migration 0179_product_identity has not been applied yet`,
    );
  }
}

// ── Row / view types (the lib/admin/skus.ts pair pattern) ────────────────────

interface DbProductRow {
  id: string;
  name: string;
  name_es: string | null;
  notes: string | null;
  unit_oz: number | string | null;
  unit_oz_class: string | null;
  unit_oz_source_note: string | null;
  unit_oz_established_at: string | null;
  unit_oz_established_by: string | null;
  active: boolean | null;
}

interface DbMemberRow {
  id: string;
  name: string;
  vendor_id: string | null;
  product_id: string | null;
  active: boolean | null;
  avg_oz_per_each: number | string | null;
}

interface DbPrimaryRow {
  id: string;
  product_id: string;
  location_id: string | null;
  primary_sku_id: string;
  note: string | null;
}

/** One member SKU as the registry renders it (a ProductMember + its label). */
export interface ProductMemberView extends ProductMember {
  /** vendor_items.name — the SKU's own label, e.g. "Ham, sliced 1oz". */
  name: string;
}

/** A primary designation. locationId null = the global default (the house idiom). */
export interface ProductPrimaryView {
  locationId: string | null;
  primarySkuId: string;
  note: string | null;
}

export interface ProductView {
  id: string;
  name: string;
  nameEs: string | null;
  notes: string | null;
  unitOz: number | null;
  unitOzClass: string | null;
  unitOzSourceNote: string | null;
  unitOzEstablishedAt: string | null;
  unitOzEstablishedBy: string | null;
  active: boolean;
  members: ProductMemberView[];
  primaries: ProductPrimaryView[];
  /** The global (location_id NULL) primary, else null. */
  globalPrimarySkuId: string | null;
  /**
   * No ACTIVE member at all — the honest `unresolved` rung of the ladder, decided
   * by resolveProductMember so the registry never forms a second opinion. (The
   * registry deliberately does NOT show which member a location resolves to: rung
   * 2 reads receipt history, which the graph-time loader supplies, not this list.)
   */
  unresolved: boolean;
  /** Active members disagree about what one unit weighs (advisory, D2/D3). */
  membersDisagree: boolean;
}

const PRODUCT_COLS =
  "id, name, name_es, notes, unit_oz, unit_oz_class, unit_oz_source_note, unit_oz_established_at, unit_oz_established_by, active";

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * The whole registry in THREE batch queries + one label lookup — never per-product
 * (the loadRecipeGraph law): products · member SKUs (`.in("product_id", ids)`) ·
 * product_primaries. Vendor names ride ONE batched vendors read and degrade to
 * null labels on failure rather than failing the page (the loadCountFormData
 * LABEL-ONLY precedent).
 */
export async function listProducts(actor: AuthContext): Promise<ProductView[]> {
  requireLevel(actor, PRODUCT_READ_MIN);
  const sb = getServiceRoleClient();

  const { data: productRows, error: pErr } = await sb
    .from("products")
    .select(PRODUCT_COLS)
    .order("active", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true })
    .returns<DbProductRow[]>();
  throwIfSchemaPending(pErr, "listProducts products");
  if (pErr) throw new Error(`listProducts products failed: ${pErr.message}`);
  const products = productRows ?? [];
  if (products.length === 0) return [];

  const ids = products.map((p) => p.id);

  const { data: memberRows, error: mErr } = await sb
    .from("vendor_items")
    .select("id, name, vendor_id, product_id, active, avg_oz_per_each")
    .in("product_id", ids)
    .order("name", { ascending: true })
    .returns<DbMemberRow[]>();
  throwIfSchemaPending(mErr, "listProducts members");
  if (mErr) throw new Error(`listProducts members failed: ${mErr.message}`);
  const members = memberRows ?? [];

  const { data: primaryRows, error: prErr } = await sb
    .from("product_primaries")
    .select("id, product_id, location_id, primary_sku_id, note")
    .in("product_id", ids)
    .returns<DbPrimaryRow[]>();
  throwIfSchemaPending(prErr, "listProducts primaries");
  if (prErr) throw new Error(`listProducts primaries failed: ${prErr.message}`);
  const primaries = primaryRows ?? [];

  // LABEL-ONLY: a vendors failure leaves the twin rows unlabelled, exactly as they
  // read before this surface existed. It must never fail the registry.
  const vendorIds = [...new Set(members.map((m) => m.vendor_id).filter((v): v is string => v !== null))];
  const vendorNameById = new Map<string, string>();
  if (vendorIds.length > 0) {
    const { data: vs, error: vErr } = await sb
      .from("vendors")
      .select("id, name")
      .in("id", vendorIds)
      .returns<Array<{ id: string; name: string }>>();
    if (vErr) console.error("[products] listProducts vendor names lookup failed:", vErr.message);
    for (const v of vs ?? []) vendorNameById.set(v.id, v.name);
  }

  const membersByProduct = new Map<string, ProductMemberView[]>();
  for (const m of members) {
    if (m.product_id == null) continue;
    const list = membersByProduct.get(m.product_id) ?? [];
    list.push({
      skuId: m.id,
      name: m.name,
      vendorId: m.vendor_id,
      vendorName: m.vendor_id != null ? vendorNameById.get(m.vendor_id) ?? null : null,
      active: m.active ?? true, // nullable in DB → treat null as active (skus.ts idiom)
      avgOzPerEach: num(m.avg_oz_per_each),
      // Receipt history is a graph-time load (Phase 3), not a registry read.
      lastReceivedAt: null,
    });
    membersByProduct.set(m.product_id, list);
  }

  const primariesByProduct = new Map<string, ProductPrimaryView[]>();
  for (const p of primaries) {
    const list = primariesByProduct.get(p.product_id) ?? [];
    list.push({ locationId: p.location_id, primarySkuId: p.primary_sku_id, note: p.note });
    primariesByProduct.set(p.product_id, list);
  }

  return products.map((p) => {
    const mem = membersByProduct.get(p.id) ?? [];
    const prim = primariesByProduct.get(p.id) ?? [];
    const globalPrimarySkuId = prim.find((r) => r.locationId === null)?.primarySkuId ?? null;
    const resolution = resolveProductMember({
      productId: p.id,
      primarySkuId: globalPrimarySkuId,
      members: mem,
    });
    return {
      id: p.id,
      name: p.name,
      nameEs: p.name_es,
      notes: p.notes,
      unitOz: num(p.unit_oz),
      unitOzClass: p.unit_oz_class,
      unitOzSourceNote: p.unit_oz_source_note,
      unitOzEstablishedAt: p.unit_oz_established_at,
      unitOzEstablishedBy: p.unit_oz_established_by,
      active: p.active ?? true,
      members: mem,
      primaries: prim,
      globalPrimarySkuId,
      unresolved: resolution.rung === "unresolved",
      membersDisagree: membersDisagreeOnUnitOz(mem),
    };
  });
}

// ── Writers (GM+; every one: level → service-role write with an exact count →
//    404 on count 0 (the silent-UPDATE law) → audit) ───────────────────────────

export interface CreateProductInput {
  name: string;
  nameEs?: string | null;
  notes?: string | null;
}

export async function createProduct(
  actor: AuthContext,
  input: CreateProductInput,
): Promise<{ id: string }> {
  requireLevel(actor, PRODUCT_WRITE_MIN);
  const name = input.name.trim();
  if (!name) throw new ProductError(400, "invalid_name", "Product name is required");

  const sb = getServiceRoleClient();
  const { data: inserted, error } = await sb
    .from("products")
    .insert({
      name,
      name_es: normalizeOptional(input.nameEs),
      notes: normalizeOptional(input.notes),
      active: true,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  throwIfSchemaPending(error, "createProduct");
  // The partial unique index on lower(name) where active is the duplicate guard.
  if (error?.code === "23505") {
    throw new ProductError(409, "duplicate_name", "An active product already uses that name");
  }
  if (error) throw new Error(`createProduct insert failed: ${error.message}`);
  if (!inserted) throw new Error("createProduct insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "product.create",
    resourceTable: "products",
    resourceId: inserted.id,
    metadata: { name },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id };
}

/** Rows in product_primaries that name this SKU as primary (any scope). */
async function primaryScopesNaming(skuId: string): Promise<DbPrimaryRow[]> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("product_primaries")
    .select("id, product_id, location_id, primary_sku_id, note")
    .eq("primary_sku_id", skuId)
    .returns<DbPrimaryRow[]>();
  throwIfSchemaPending(error, "primaryScopesNaming");
  if (error) throw new Error(`primaryScopesNaming failed: ${error.message}`);
  return data ?? [];
}

async function loadSkuMembership(skuId: string): Promise<{ id: string; product_id: string | null }> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendor_items")
    .select("id, product_id")
    .eq("id", skuId)
    .maybeSingle<{ id: string; product_id: string | null }>();
  throwIfSchemaPending(error, "loadSkuMembership");
  if (error) throw new Error(`loadSkuMembership failed: ${error.message}`);
  if (!data) throw new ProductError(404, "sku_not_found", "SKU not found");
  return data;
}

/**
 * Attach a SKU to a product (vendor_items.product_id = productId).
 *
 * A SKU already attached elsewhere is a NAMED 409, not a silent re-parent — and a
 * SKU that some product_primaries row names is refused for the same reason detach
 * refuses it: the composite FK would reject the write anyway, and a named 409 is a
 * better error than a constraint violation surfacing as a 500.
 */
export async function attachMember(
  actor: AuthContext,
  args: { productId: string; skuId: string },
): Promise<void> {
  requireLevel(actor, PRODUCT_WRITE_MIN);
  const sb = getServiceRoleClient();

  const sku = await loadSkuMembership(args.skuId);
  if (sku.product_id === args.productId) return; // already a member — idempotent
  if (sku.product_id != null) {
    throw new ProductError(409, "already_member", "This SKU already belongs to another product");
  }
  const naming = await primaryScopesNaming(args.skuId);
  if (naming.length > 0) {
    throw new ProductError(409, "primary_must_be_reassigned", "Reassign the primary before moving this SKU");
  }

  const { error, count } = await sb
    .from("vendor_items")
    .update({ product_id: args.productId, updated_by: actor.user.id, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", args.skuId);
  throwIfSchemaPending(error, "attachMember");
  if (error?.code === "23503") {
    throw new ProductError(400, "invalid_product", "Product not found");
  }
  if (error) throw new Error(`attachMember failed: ${error.message}`);
  if (count === 0) throw new ProductError(404, "sku_not_found", "SKU not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "product.member_attach",
    resourceTable: "vendor_items",
    resourceId: args.skuId,
    metadata: { product_id: args.productId },
    ipAddress: null,
    userAgent: null,
  });
}

/**
 * Detach a SKU from its product (product_id → NULL, back to implicit singleton).
 * Refuses with 409 when a product_primaries row names it — see attachMember.
 */
export async function detachMember(
  actor: AuthContext,
  args: { skuId: string },
): Promise<void> {
  requireLevel(actor, PRODUCT_WRITE_MIN);
  const sb = getServiceRoleClient();

  const naming = await primaryScopesNaming(args.skuId);
  if (naming.length > 0) {
    throw new ProductError(409, "primary_must_be_reassigned", "Reassign the primary before detaching this SKU");
  }

  const { error, count } = await sb
    .from("vendor_items")
    .update({ product_id: null, updated_by: actor.user.id, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", args.skuId);
  throwIfSchemaPending(error, "detachMember");
  if (error) throw new Error(`detachMember failed: ${error.message}`);
  if (count === 0) throw new ProductError(404, "sku_not_found", "SKU not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "product.member_detach",
    resourceTable: "vendor_items",
    resourceId: args.skuId,
    metadata: {},
    ipAddress: null,
    userAgent: null,
  });
}

/**
 * Designate the primary member for a scope. `locationId` null = the GLOBAL default
 * (the vendor_cutoffs / vendor_items "null = global" idiom); a location row
 * overrides it for that shop.
 *
 * Read-then-write rather than an upsert: the scope UNIQUE is
 * `NULLS NOT DISTINCT (product_id, location_id)`, and a two-step keeps the write
 * off PostgREST's conflict-target inference for a NULL-bearing key. Membership is
 * DB-proven by the composite FK; the pre-check exists only so a non-member returns
 * a named 400 instead of a constraint 500.
 */
export async function setPrimary(
  actor: AuthContext,
  args: { productId: string; locationId: string | null; primarySkuId: string; note?: string | null },
): Promise<void> {
  requireLevel(actor, PRODUCT_WRITE_MIN);
  const sb = getServiceRoleClient();

  const sku = await loadSkuMembership(args.primarySkuId);
  if (sku.product_id !== args.productId) {
    throw new ProductError(400, "not_a_member", "That SKU is not a member of this product");
  }

  let existing = sb
    .from("product_primaries")
    .select("id")
    .eq("product_id", args.productId);
  existing = args.locationId === null ? existing.is("location_id", null) : existing.eq("location_id", args.locationId);
  const { data: row, error: exErr } = await existing.maybeSingle<{ id: string }>();
  throwIfSchemaPending(exErr, "setPrimary lookup");
  if (exErr) throw new Error(`setPrimary lookup failed: ${exErr.message}`);

  const note = normalizeOptional(args.note);
  if (row) {
    const { error, count } = await sb
      .from("product_primaries")
      .update(
        { primary_sku_id: args.primarySkuId, note, updated_by: actor.user.id, updated_at: new Date().toISOString() },
        { count: "exact" },
      )
      .eq("id", row.id);
    throwIfSchemaPending(error, "setPrimary update");
    if (error) throw new Error(`setPrimary update failed: ${error.message}`);
    if (count === 0) throw new ProductError(404, "primary_not_found", "Primary designation not found");
  } else {
    const { error } = await sb.from("product_primaries").insert({
      product_id: args.productId,
      location_id: args.locationId,
      primary_sku_id: args.primarySkuId,
      note,
      updated_by: actor.user.id,
    });
    throwIfSchemaPending(error, "setPrimary insert");
    if (error) throw new Error(`setPrimary insert failed: ${error.message}`);
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "product.primary_set",
    resourceTable: "product_primaries",
    resourceId: args.productId,
    metadata: { location_id: args.locationId, primary_sku_id: args.primarySkuId },
    ipAddress: null,
    userAgent: null,
  });
}

/**
 * Establish what ONE unit of the product weighs, with its provenance quartet.
 * The Phase-6 weigh session calls this same function — there is one writer for
 * products.unit_oz, not two. The audit row carries before/after (the weight board
 * reads the columns; audit_log stays the forensic trail).
 */
export async function setProductUnitOz(
  actor: AuthContext,
  args: { productId: string; unitOz: number | null; unitOzClass?: string | null; sourceNote?: string | null },
): Promise<void> {
  requireLevel(actor, PRODUCT_WRITE_MIN);
  if (args.unitOz !== null && (!Number.isFinite(args.unitOz) || args.unitOz <= 0)) {
    throw new ProductError(400, "invalid_unit_oz", "Unit oz must be a positive number");
  }
  const sb = getServiceRoleClient();

  const { data: before, error: bErr } = await sb
    .from("products")
    .select("id, unit_oz, unit_oz_class")
    .eq("id", args.productId)
    .maybeSingle<{ id: string; unit_oz: number | string | null; unit_oz_class: string | null }>();
  throwIfSchemaPending(bErr, "setProductUnitOz lookup");
  if (bErr) throw new Error(`setProductUnitOz lookup failed: ${bErr.message}`);
  if (!before) throw new ProductError(404, "not_found", "Product not found");

  const { error, count } = await sb
    .from("products")
    .update(
      {
        unit_oz: args.unitOz,
        unit_oz_class: normalizeOptional(args.unitOzClass),
        unit_oz_source_note: normalizeOptional(args.sourceNote),
        // NULL is the honest value when the weight is cleared: nobody established it.
        unit_oz_established_at: args.unitOz === null ? null : new Date().toISOString(),
        unit_oz_established_by: args.unitOz === null ? null : actor.user.id,
        updated_by: actor.user.id,
        updated_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("id", args.productId);
  throwIfSchemaPending(error, "setProductUnitOz");
  if (error) throw new Error(`setProductUnitOz failed: ${error.message}`);
  if (count === 0) throw new ProductError(404, "not_found", "Product not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "product.unit_oz_set",
    resourceTable: "products",
    resourceId: args.productId,
    metadata: {
      before_unit_oz: num(before.unit_oz),
      before_unit_oz_class: before.unit_oz_class,
      after_unit_oz: args.unitOz,
      after_unit_oz_class: normalizeOptional(args.unitOzClass),
    },
    ipAddress: null,
    userAgent: null,
  });
}
