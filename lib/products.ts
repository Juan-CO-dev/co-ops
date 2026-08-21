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
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import { resolveActive } from "@/lib/location-sku-shared";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import type { AuthContext } from "@/lib/session";
import {
  resolveProductMember,
  productInputBasis,
  membersDisagreeOnUnitOz,
  type ProductMember,
  type ProductResolution,
  type ReceiptLot,
} from "@/lib/products-shared";
import type { ProductIndex } from "@/lib/prep-consumption-graph";

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

function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
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
  /**
   * ACTIVE recipes whose lines pin this product — the pre-flight the retire
   * affordance warns with (Juan's ruling A+, 2026-08-21): "N recipes still pin
   * this — they will read unresolved until re-pointed".
   *
   * Loaded here rather than fetched on demand so the warning is a fact the row
   * already holds when the manager reaches for the button, not a round-trip that
   * can fail mid-decision. Batched (two queries for the whole registry, the
   * loadRecipeGraph law) and ACTIVE-only, because a retired recipe's pin costs
   * nothing — loadRecipeGraph has filtered `recipes.active` since #272.
   */
  pinnedRecipes: Array<{ id: string; name: string }>;
}

const PRODUCT_COLS =
  "id, name, name_es, notes, unit_oz, unit_oz_class, unit_oz_source_note, unit_oz_established_at, unit_oz_established_by, active";

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * ACTIVE recipes that pin each of these products — the retire pre-flight's count.
 *
 * TWO batched queries for the whole registry (the loadRecipeGraph law): the pinning
 * `recipe_inputs` rows, then the recipes behind them filtered to `active`. Paged on
 * the inputs read because recipe_inputs is the row-cap-crossing table here, and a
 * truncated page would UNDER-report the warning — the one direction that matters,
 * since the whole point is not to let a manager retire an identity believing nothing
 * points at it.
 *
 * LABEL-TOLERANT, not label-only: a failure here would understate the consequences
 * of a retirement, so it THROWS rather than degrading to an empty list. The registry
 * page already renders a named pending state when a products read fails.
 */
async function loadPinnedRecipesByProduct(
  sb: ReturnType<typeof getServiceRoleClient>,
  productIds: string[],
): Promise<Map<string, Array<{ id: string; name: string }>>> {
  const out = new Map<string, Array<{ id: string; name: string }>>();
  if (productIds.length === 0) return out;

  const pins = await selectAllRows<{ recipe_id: string; component_product_id: string | null }>(
    async (from, to) => {
      const { data, error } = await sb
        .from("recipe_inputs")
        .select("recipe_id, component_product_id")
        .in("component_product_id", productIds)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ recipe_id: string; component_product_id: string | null }>>();
      if (error) throw new Error(`loadPinnedRecipesByProduct pins: ${error.message}`);
      return { data };
    },
  );
  if (pins.length === 0) return out;

  // PAGED like the read above it, and for a sharper reason than symmetry: past the
  // 1000-row cap a truncated page drops real recipes out of `activeById`, and the
  // `name == null` branch below would then reclassify them as RETIRED. The warning
  // would UNDER-report — the one direction this function's header says must never
  // happen — and the undercount would ride into the audit row as fact.
  const recipeIds = [...new Set(pins.map((p) => p.recipe_id))];
  const recipeRows = await selectAllRows<{ id: string; name: string }>(async (from, to) => {
    const { data, error } = await sb
      .from("recipes")
      .select("id, name")
      .in("id", recipeIds)
      .eq("active", true)
      .order("id", { ascending: true })
      .range(from, to)
      .returns<Array<{ id: string; name: string }>>();
    if (error) throw new Error(`loadPinnedRecipesByProduct recipes: ${error.message}`);
    return { data };
  });
  const activeById = new Map(recipeRows.map((r) => [r.id, r.name]));

  // One entry per (product, recipe): a recipe pinning the same product on two
  // lines is still ONE recipe to go re-point, and "2 recipes" would be a lie.
  const seen = new Set<string>();
  for (const p of pins) {
    const productId = p.component_product_id;
    if (productId == null) continue;
    const name = activeById.get(p.recipe_id);
    if (name == null) continue; // retired recipe — its pin costs nothing (#272).
    const key = `${productId}:${p.recipe_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = out.get(productId) ?? [];
    list.push({ id: p.recipe_id, name });
    out.set(productId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * The whole registry in FIVE batch queries + one label lookup — never per-product
 * (the loadRecipeGraph law): products · member SKUs (`.in("product_id", ids)`) ·
 * product_primaries · the pinning recipe_inputs · the recipes behind them. Vendor names ride ONE batched vendors
 * read and degrade to null labels on failure rather than failing the page (the
 * loadCountFormData LABEL-ONLY precedent).
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

  const pinnedByProduct = await loadPinnedRecipesByProduct(sb, ids);

  return products.map((p) => {
    const mem = membersByProduct.get(p.id) ?? [];
    const prim = primariesByProduct.get(p.id) ?? [];
    const globalPrimarySkuId = prim.find((r) => r.locationId === null)?.primarySkuId ?? null;
    const resolution = resolveProductMember({
      productId: p.id,
      active: p.active ?? true,
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
      // NO_ACTIVE_MEMBER specifically, NOT `rung === "unresolved"` (2026-08-21).
      // Rung 0 makes a RETIRED product unresolved too, and badging that row "no
      // active member" would be an accusation against members that are usually
      // perfectly healthy — the retirement is the fact, and the row already carries
      // its own discontinued badge. One flag per fault.
      unresolved: resolution.reason === "no_active_member",
      membersDisagree: membersDisagreeOnUnitOz(mem),
      pinnedRecipes: pinnedByProduct.get(p.id) ?? [],
    };
  });
}

// ── The graph-time product index (Phase 3) ───────────────────────────────────

/** One product, fully resolved for ONE scope (a location, or the global default). */
export interface ProductIndexEntry {
  productId: string;
  name: string;
  /** `products.active`. False = RETIRED — `resolution` is already `unresolved`
   *  with reason `retired_product`; this is carried so a consumer can NAME the
   *  product it is refusing without a second read. */
  active: boolean;
  unitOz: number | null;
  /** Every member SKU, with `active` already resolved through this location's overlay. */
  members: ProductMemberView[];
  /** The primary designated for this scope: the location row, else the global row. */
  primarySkuId: string | null;
  /** True when the primary came from a LOCATION-specific row (not the global default). */
  primaryIsLocationSpecific: boolean;
  resolution: ProductResolution;
  /** The measure-only basis a product-pinned recipe line resolves through (D3). */
  basis: ReturnType<typeof productInputBasis>;
}

export interface ProductIndexLoad {
  /** The shape lib/prep-consumption-graph.ts consumes (resolution + basis). */
  index: ProductIndex;
  byProduct: Map<string, ProductIndexEntry>;
  /** member SKU id → its product id. The usage rollup (D9) reads exactly this. */
  productBySku: Map<string, string>;
}

const EMPTY_PRODUCT_INDEX: ProductIndexLoad = {
  index: { resolution: new Map(), basis: new Map() },
  byProduct: new Map(),
  productBySku: new Map(),
};

// ── Location scoping WITHOUT spending the delivery-id list in the request line ──
/**
 * The PostgREST embed that scopes a `vendor_delivery_items` read to one location.
 *
 * WHY THIS EXISTS. Both receipt readers below need "lines whose delivery belongs
 * to THIS location". The obvious spelling — read the location's delivery ids, then
 * `.in("delivery_id", ids)` — spends the whole id list in the GET request line, and
 * that list is UNBOUNDED BY DESIGN here (the lot shelf is the full receipt history;
 * a lot only leaves it by being eaten). At ~37 bytes per uuid against Kong's 8 KB
 * request line that is a hard 414/400 at ~220 deliveries — reachable within months
 * of near-daily receiving at two shops. It fails on page 0, with zero rows read, so
 * `selectAllRows` cannot help: paging the RESPONSE does nothing about the REQUEST.
 * `loadCountFormData` has no try/catch, so the 414 would 500 the whole count sheet.
 * (Arithmetic pinned in tests/supabase-paginate.test.ts.)
 *
 * The embed pushes the scoping into SQL, so the request line is CONSTANT in the
 * number of deliveries — the id list is never built, never sent, and the extra
 * paged scan of `vendor_deliveries` disappears with it.
 *
 * DISAMBIGUATED BY FK CONSTRAINT NAME, necessarily: `vendor_delivery_items` carries
 * TWO foreign keys to `vendor_deliveries` — the plain `delivery_id` FK and 0178's
 * composite `(delivery_id, vendor_id)` binding — so a bare
 * `vendor_deliveries!inner(...)` fails with PGRST201 "more than one relationship was
 * found" (verified against prod 2026-08-21, not inferred).
 *
 * ON THE HOUSE LAW "prefer two-step queries" (AGENTS.md): that law's stated hazard is
 * RLS — an embedded filter over a relation the caller cannot see behaves
 * unpredictably. Both readers here use the SERVICE-ROLE client, which bypasses RLS
 * entirely, so the hazard is not in play; the same-client precedent is
 * lib/checklists.ts's `checklist_templates!inner(type)`. Row-for-row parity with the
 * old two-step was verified live before the swap.
 */
const DELIVERY_AT_LOCATION_EMBED =
  "vendor_deliveries!vendor_delivery_items_delivery_id_fkey!inner(location_id)";
const DELIVERY_LOCATION_COLUMN = "vendor_deliveries.location_id";

/** ISO of the most recent receipt line per member SKU (rung 2's only input). */
async function loadLastReceivedAt(
  sb: ReturnType<typeof getServiceRoleClient>,
  skuIds: string[],
  locationId: string | null,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (skuIds.length === 0) return out;

  // PAGED (the PR #63 lesson): the delivery ledger crosses the 1000-row cap and a
  // truncated page would silently mis-rank rung 2 — the ladder would answer with a
  // stale member and nothing anywhere would say so. `id` (the PK) is the stable
  // total order paging needs; a max() per SKU is order-insensitive.
  //
  // Scoped to this location's deliveries by the embed above when we have one. With
  // NO location (the costing board — deviation D7) the honest analog is org-wide:
  // "most recently received" at org grain means by anybody, so the delivery join is
  // skipped entirely rather than silently reading one shop's ledger as if it were
  // both. A location with nothing ever received simply matches no lines — the same
  // empty map the old explicit early-return produced.
  const lines = await selectAllRows<{ vendor_item_id: string; created_at: string }>(
    async (from, to) => {
      // The embed rides along even with no location: `delivery_id` is NOT NULL with
      // an FK, so `!inner` matches every line and filters nothing — which keeps ONE
      // query shape instead of two divergent ones. Only the `.eq` is conditional.
      let q = sb.from("vendor_delivery_items")
        .select(`vendor_item_id, created_at, ${DELIVERY_AT_LOCATION_EMBED}`)
        .in("vendor_item_id", skuIds);
      if (locationId != null) q = q.eq(DELIVERY_LOCATION_COLUMN, locationId);
      const { data, error } = await q
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ vendor_item_id: string; created_at: string }>>();
      if (error) throw new Error(`loadLastReceivedAt lines: ${error.message}`);
      return { data };
    },
  );
  for (const l of lines) {
    const prev = out.get(l.vendor_item_id);
    if (prev == null || l.created_at > prev) out.set(l.vendor_item_id, l.created_at);
  }
  return out;
}

/**
 * Resolve a set of products for ONE scope — THE seam of the whole arc.
 *
 * ONE loader, consumed by lib/prep-consumption.ts (graph build) AND lib/ordering.ts
 * (the walk). There is deliberately no second copy: a second loader is a second
 * opinion about which vendor a product means, which is exactly what this layer was
 * built to end.
 *
 * NOT ROLE-GATED, on purpose: this is an internal resolution step inside a caller
 * that has already gated (loadMeasures / loadSkuPackChains take the same posture).
 * The user-facing registry read is `listProducts`, which gates at PRODUCT_READ_MIN.
 *
 * Queries: products · members · vendors (LABEL-ONLY, degrades) · primaries ·
 * location overlay (only with a location) · last-received (paged). All batched —
 * never per-product (the loadRecipeGraph law). `productIds` empty → ZERO queries,
 * which is why a system with no products pays nothing for this layer existing.
 *
 * A MEMBER's `active` is the location-RESOLVED value (`resolveActive(overlay,
 * global)`), so the ladder sees the same activation the order walk does.
 * Costing/counts read the per-location overlay through this path for the first time
 * (previously ordering-only).
 *
 * ── THE PRODUCTS READ IS NOT `.eq("active", true)`-FILTERED, DELIBERATELY ─────
 * (Juan's retirement ruling A+, 2026-08-21 — the reconciliation sim P1-9 asked for.)
 *
 * The obvious fix for "a retired product keeps costing" is a filter on this select,
 * the way #272 filtered `recipes.active` in loadRecipeGraph. It is the wrong shape
 * HERE, for two reasons:
 *
 *  1. A filtered-away product falls out of `byProduct` entirely, so the flatten
 *     poisons with NO NAME — indistinguishable from a product that resolved to
 *     nothing, or from a dangling id. The ruling asks for the opposite: an
 *     `unresolved` that says WHY. So the row is READ, `active` rides into the
 *     ladder, and rung 0 refuses it with `reason: "retired_product"`. The active
 *     filter still lands where resolution happens — it just lands INSIDE the pure
 *     resolver instead of in SQL, which is the only place that can name itself.
 *  2. `productBySku` (the D9 usage rollup) and the member list are still true facts
 *     about a retired identity, and the count sheet / order walk read them to
 *     LABEL rows. Dropping the entry would silently un-group those twins.
 *
 * HISTORICAL-REPLAY BOUNDARY (the same one #272 drew for inactive recipes): nothing
 * replays history through this loader. Every consumer — costing, counts, ordering,
 * the nightly depletion materialization — asks it what is true TODAY, and today a
 * retired identity is not something the kitchen buys. Ledger rows already written
 * against a member SKU keep their meaning; they are keyed by `vendor_items.id` and
 * never re-resolved. If a genuine as-of replay is ever needed, it needs an as-of
 * parameter and its own decision, not a silently permissive default here.
 */
export async function loadProductIndex(
  productIds: string[],
  locationId: string | null = null,
): Promise<ProductIndexLoad> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return EMPTY_PRODUCT_INDEX;
  const sb = getServiceRoleClient();

  const { data: productRows, error: pErr } = await sb
    .from("products")
    .select("id, name, unit_oz, active")
    .in("id", ids)
    .returns<Array<{ id: string; name: string; unit_oz: number | string | null; active: boolean | null }>>();
  throwIfSchemaPending(pErr, "loadProductIndex products");
  if (pErr) throw new Error(`loadProductIndex products failed: ${pErr.message}`);
  const products = productRows ?? [];
  if (products.length === 0) return EMPTY_PRODUCT_INDEX;
  const presentIds = products.map((p) => p.id);

  const { data: memberRows, error: mErr } = await sb
    .from("vendor_items")
    .select("id, name, vendor_id, product_id, active, avg_oz_per_each")
    .in("product_id", presentIds)
    .order("name", { ascending: true })
    .returns<DbMemberRow[]>();
  throwIfSchemaPending(mErr, "loadProductIndex members");
  if (mErr) throw new Error(`loadProductIndex members failed: ${mErr.message}`);
  const memberRowList = memberRows ?? [];
  const memberIds = memberRowList.map((m) => m.id);

  let primaryQuery = sb
    .from("product_primaries")
    .select("id, product_id, location_id, primary_sku_id, note")
    .in("product_id", presentIds);
  // The vendor_cutoffs "null = global" idiom (lib/ordering.ts loadOrderingAttention):
  // read the location row AND the global row, then let the location row win below.
  primaryQuery = locationId != null
    ? primaryQuery.or(`location_id.is.null,location_id.eq.${locationId}`)
    : primaryQuery.is("location_id", null);
  const { data: primaryRows, error: prErr } = await primaryQuery.returns<DbPrimaryRow[]>();
  throwIfSchemaPending(prErr, "loadProductIndex primaries");
  if (prErr) throw new Error(`loadProductIndex primaries failed: ${prErr.message}`);

  // Per-location activation overlay (0174). Without a location there is no overlay
  // to read and `active` reduces to the global column, byte-identical to before.
  const overlayBySku = new Map<string, boolean | null>();
  if (locationId != null && memberIds.length > 0) {
    const { data: ovRows, error: ovErr } = await sb
      .from("location_sku_settings")
      .select("sku_id, active_override")
      .eq("location_id", locationId)
      .in("sku_id", memberIds)
      .returns<Array<{ sku_id: string; active_override: boolean | null }>>();
    if (ovErr) throw new Error(`loadProductIndex overlay failed: ${ovErr.message}`);
    for (const r of ovRows ?? []) overlayBySku.set(r.sku_id, r.active_override);
  }

  // LABEL-ONLY (the listProducts precedent): a vendors failure leaves twins
  // unlabelled; it must never fail costing, ordering or the count sheet.
  const vendorIds = [...new Set(memberRowList.map((m) => m.vendor_id).filter((v): v is string => v !== null))];
  const vendorNameById = new Map<string, string>();
  if (vendorIds.length > 0) {
    const { data: vs, error: vErr } = await sb
      .from("vendors")
      .select("id, name")
      .in("id", vendorIds)
      .returns<Array<{ id: string; name: string }>>();
    if (vErr) console.error("[products] loadProductIndex vendor names lookup failed:", vErr.message);
    for (const v of vs ?? []) vendorNameById.set(v.id, v.name);
  }

  const lastReceived = await loadLastReceivedAt(sb, memberIds, locationId);

  const membersByProduct = new Map<string, ProductMemberView[]>();
  const productBySku = new Map<string, string>();
  for (const m of memberRowList) {
    if (m.product_id == null) continue;
    productBySku.set(m.id, m.product_id);
    const list = membersByProduct.get(m.product_id) ?? [];
    list.push({
      skuId: m.id,
      name: m.name,
      vendorId: m.vendor_id,
      vendorName: m.vendor_id != null ? vendorNameById.get(m.vendor_id) ?? null : null,
      active: resolveActive(overlayBySku.get(m.id) ?? null, m.active ?? true),
      avgOzPerEach: num(m.avg_oz_per_each),
      lastReceivedAt: lastReceived.get(m.id) ?? null,
    });
    membersByProduct.set(m.product_id, list);
  }

  const primariesByProduct = new Map<string, DbPrimaryRow[]>();
  for (const p of primaryRows ?? []) {
    const list = primariesByProduct.get(p.product_id) ?? [];
    list.push(p);
    primariesByProduct.set(p.product_id, list);
  }

  const resolution = new Map<string, ProductResolution>();
  const basis = new Map<string, ReturnType<typeof productInputBasis>>();
  const byProduct = new Map<string, ProductIndexEntry>();
  for (const p of products) {
    const members = membersByProduct.get(p.id) ?? [];
    const scopes = primariesByProduct.get(p.id) ?? [];
    // A location-specific row BEATS the global row (the house "null = global" idiom).
    const locationRow = locationId != null ? scopes.find((r) => r.location_id === locationId) : undefined;
    const globalRow = scopes.find((r) => r.location_id === null);
    const chosen = locationRow ?? globalRow ?? null;
    const productActive = p.active ?? true; // nullable in DB → null is active (skus.ts idiom)
    const res = resolveProductMember({
      productId: p.id,
      active: productActive,
      primarySkuId: chosen?.primary_sku_id ?? null,
      members,
    });
    const resolvedMember = res.skuId != null ? members.find((m) => m.skuId === res.skuId) ?? null : null;
    const b = productInputBasis({ productId: p.id, unitOz: num(p.unit_oz) }, resolvedMember);
    resolution.set(p.id, res);
    basis.set(p.id, b);
    byProduct.set(p.id, {
      productId: p.id,
      name: p.name,
      active: productActive,
      unitOz: num(p.unit_oz),
      members,
      primarySkuId: chosen?.primary_sku_id ?? null,
      primaryIsLocationSpecific: locationRow != null,
      resolution: res,
      basis: b,
    });
  }

  return { index: { resolution, basis }, byProduct, productBySku };
}

// ── Receipt lots (Phase 5 — the FIFO shelf under the count sheet) ────────────

export interface ProductLotLoad {
  /** productId → its members' receipt lots at this location, OLDEST FIRST. */
  lotsByProduct: Map<string, ReceiptLot[]>;
  /**
   * productId → receipt lines DROPPED because resolved_oz was NULL. A dropped line
   * is real stock the lot view cannot see, so the caller treats the product's FIFO
   * views as ADVISORY rather than presenting a split it knows is short
   * (buildProductOnHandRow's `lotsTainted`). Absent = zero. NEVER coerced to 0 oz —
   * the same taint discipline lib/counts.ts sumReceivedOzWindow already applies.
   */
  nullOzLotCountByProduct: Map<string, number>;
}

const EMPTY_LOT_LOAD: ProductLotLoad = {
  lotsByProduct: new Map(),
  nullOzLotCountByProduct: new Map(),
};

/**
 * Load the receipt LOTS behind a set of products at one location — the shelf the
 * FIFO functions in lib/products-shared.ts walk (spec: "Lot data already exists
 * (vendor_delivery_items are dated)"; nothing new is captured).
 *
 * Takes the member map the PRODUCT INDEX already built rather than re-querying
 * membership: a second membership read is a second opinion about which SKUs a
 * product means, which is exactly what this layer exists to end (the loadRecipeGraph
 * law). Callers pass `loadProductIndex(...).byProduct`'s member ids.
 *
 * `created_at` is the lot instant, deliberately: it is the true write instant, which
 * is what an anchor timestamp is comparable to (delivery_date is a bare date). CC
 * verified 2026-08-20 that zero of the live deliveries are backdated; if retro-entry
 * ever becomes practice, that is the moment to add an explicit received_at — not now.
 *
 * DB-COUPLED, so it stays off the vitest spine per the house law; the pure half it
 * feeds (remainingByLot / allocateProductCount / buildProductOnHandRow) is fully
 * pinned in tests/products-count-mode.test.ts and tests/products-fifo.test.ts.
 *
 * NOT ROLE-GATED, like loadProductIndex beside it: an internal resolution step inside
 * a caller that has already gated (loadCountFormData / loadOnHand both do).
 */
export async function loadProductLots(
  locationId: string,
  memberSkuIdsByProduct: ReadonlyMap<string, ReadonlyArray<string>>,
): Promise<ProductLotLoad> {
  const productOfSku = new Map<string, string>();
  for (const [productId, skuIds] of memberSkuIdsByProduct) {
    for (const skuId of skuIds) productOfSku.set(skuId, productId);
  }
  const skuIds = [...productOfSku.keys()];
  if (skuIds.length === 0) return EMPTY_LOT_LOAD;

  const sb = getServiceRoleClient();

  // PAGED (the PR #63 lesson): a truncated page drops real lots and silently
  // mis-attributes the FIFO split. Location scoping rides the EMBED rather than a
  // delivery-id `.in()` list — see DELIVERY_AT_LOCATION_EMBED for why that list was
  // a 414 waiting on the receiving ledger to grow. A location that has never
  // received simply matches no lines, which is the same empty result the old
  // explicit early-return produced.
  const lines = await selectAllRows<{
    id: string;
    vendor_item_id: string;
    created_at: string;
    resolved_oz: number | string | null;
  }>(async (from, to) => {
    const { data, error } = await sb
      .from("vendor_delivery_items")
      .select(`id, vendor_item_id, created_at, resolved_oz, ${DELIVERY_AT_LOCATION_EMBED}`)
      .in("vendor_item_id", skuIds)
      .eq(DELIVERY_LOCATION_COLUMN, locationId)
      .order("id", { ascending: true })
      .range(from, to)
      .returns<
        Array<{ id: string; vendor_item_id: string; created_at: string; resolved_oz: number | string | null }>
      >();
    if (error) throw new Error(`loadProductLots lines: ${error.message}`);
    return { data };
  });

  const lotsByProduct = new Map<string, ReceiptLot[]>();
  const nullOzLotCountByProduct = new Map<string, number>();
  for (const l of lines) {
    const productId = productOfSku.get(l.vendor_item_id);
    if (productId == null) continue; // defensive — the .in() filter already scoped it.
    const oz = num(l.resolved_oz);
    if (oz == null || oz <= 0) {
      // DROPPED AND REPORTED, never coerced to 0: a legacy line with no resolved_oz
      // is real stock the lot view cannot see, and a zero would silently hand that
      // stock to the other twin.
      nullOzLotCountByProduct.set(productId, (nullOzLotCountByProduct.get(productId) ?? 0) + 1);
      continue;
    }
    const list = lotsByProduct.get(productId) ?? [];
    list.push({ lotId: l.id, skuId: l.vendor_item_id, receivedAt: l.created_at, oz });
    lotsByProduct.set(productId, list);
  }
  return { lotsByProduct, nullOzLotCountByProduct };
}

/**
 * Append a `product.resolution_flip` audit row for every product whose resolved
 * member CHANGED since the last audited answer (spec: "every resolution flip writes
 * an audit row — 'why did ham cost move Tuesday' always has an answer").
 *
 * DELIBERATE PLACEMENT: this is called from the ONE writer that already runs once a
 * day per location (materializeDailyDepletion), NOT from loadRecipeGraph. The graph
 * loader is a hot read path on nine callers; audit() is fail-open but not free, and
 * a read that writes is the hazard loadCountsTileState was written to avoid. One row
 * per real flip, zero rows on a normal day.
 *
 * Fail-open like audit() itself: a flip row is forensic, never load-bearing, and it
 * must not be able to fail the nightly depletion materialization.
 */
export async function recordResolutionFlips(
  locationId: string,
  resolutions: ReadonlyMap<string, ProductResolution>,
): Promise<void> {
  if (resolutions.size === 0) return;
  try {
    const sb = getServiceRoleClient();
    const productIds = [...resolutions.keys()];
    // The last audited answer per (location, product). One batched read over the
    // flip rows for these products; newest first, first-seen-wins per product.
    //
    // `occurred_at` IS THE TIMESTAMP COLUMN ON audit_log — there is no `created_at`
    // (SIM-PI-3, 2026-08-21). The original spelling made this SELECT 400 on every
    // invocation, and because the function is fail-open and dispatched with `void`
    // from materializeDailyDepletion, the failure was completely silent: the
    // resolution-flip trail the spec promises ("why did ham cost move Tuesday always
    // has an answer") was never written even once. A schema-name mismatch inside a
    // fail-open path is invisible to a diff review and to a smoke; it took a sim run
    // through the real writer to surface it.
    //
    // The location filter now runs IN SQL rather than over the fetched page: with the
    // JS filter, one location's flip volume could evict the other's history out of the
    // 500-row window, and a product whose prior row fell off is re-seeded as a first
    // observation — losing exactly the event this trail exists to record. `id` breaks
    // an occurred_at tie so the first-seen-wins map below is fed a TOTAL order.
    const { data: priorRows, error } = await sb
      .from("audit_log")
      .select("resource_id, metadata, occurred_at")
      .eq("action", "product.resolution_flip")
      .in("resource_id", productIds)
      .filter("metadata->>location_id", "eq", locationId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(500)
      .returns<Array<{ resource_id: string; metadata: Record<string, unknown> | null; occurred_at: string }>>();
    if (error) {
      console.error("[products] recordResolutionFlips prior lookup failed:", error.message);
      return;
    }
    const lastTo = new Map<string, string | null>();
    for (const r of priorRows ?? []) {
      const meta = r.metadata ?? {};
      if (lastTo.has(r.resource_id)) continue; // newest wins (ordered desc).
      const to = meta["to_sku_id"];
      lastTo.set(r.resource_id, typeof to === "string" ? to : null);
    }

    for (const [productId, res] of resolutions) {
      const prior = lastTo.get(productId);
      // No history at all → nothing FLIPPED; the first observation is not a change.
      if (!lastTo.has(productId)) continue;
      if ((prior ?? null) === (res.skuId ?? null)) continue;
      await audit({
        actorId: null,
        actorRole: null,
        action: "product.resolution_flip",
        resourceTable: "products",
        resourceId: productId,
        metadata: {
          product_id: productId,
          location_id: locationId,
          from_sku_id: prior ?? null,
          to_sku_id: res.skuId,
          rung: res.rung,
          considered_sku_ids: res.consideredSkuIds,
        },
        ipAddress: null,
        userAgent: null,
      });
    }
    // First-ever observation per product: seed the trail so the NEXT change has a
    // "from". Seeded rows carry seed: true so an auditor never reads one as a flip.
    for (const [productId, res] of resolutions) {
      if (lastTo.has(productId)) continue;
      await audit({
        actorId: null,
        actorRole: null,
        action: "product.resolution_flip",
        resourceTable: "products",
        resourceId: productId,
        metadata: {
          product_id: productId,
          location_id: locationId,
          from_sku_id: null,
          to_sku_id: res.skuId,
          rung: res.rung,
          considered_sku_ids: res.consideredSkuIds,
          seed: true,
        },
        ipAddress: null,
        userAgent: null,
      });
    }
  } catch (err) {
    console.error("[products] recordResolutionFlips failed (fail-open):", err);
  }
}

/**
 * The entry point the daily depletion writer calls: resolve every PINNED product for
 * this location and append a flip row for anything that moved.
 *
 * Self-contained on purpose — deriveSalesConsumption is shared with the ADMIN READ
 * surface (lib/catering/toast-sales.ts salesConsumption), so the flip audit cannot
 * ride the graph load without turning a read into a write. Two cheap queries on the
 * nightly cron, and ZERO when no recipe line pins a product.
 *
 * Fail-open: forensic, never load-bearing.
 */
export async function recordResolutionFlipsForLocation(locationId: string): Promise<void> {
  try {
    const sb = getServiceRoleClient();
    const { data, error } = await sb
      .from("recipe_inputs")
      .select("component_product_id")
      .not("component_product_id", "is", null)
      .returns<Array<{ component_product_id: string | null }>>();
    if (error) {
      console.error("[products] recordResolutionFlipsForLocation pins lookup failed:", error.message);
      return;
    }
    const productIds = [...new Set((data ?? []).map((r) => r.component_product_id).filter((v): v is string => v != null))];
    if (productIds.length === 0) return;
    const { index } = await loadProductIndex(productIds, locationId);
    await recordResolutionFlips(locationId, index.resolution);
  } catch (err) {
    console.error("[products] recordResolutionFlipsForLocation failed (fail-open):", err);
  }
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

/**
 * Retire a product, or bring it back (`products.active`). Append-only: there is no
 * DELETE path, and history is untouched — every ledger row already written against a
 * member SKU keeps its exact meaning.
 *
 * ── IT NEVER HARD-BLOCKS (Juan's ruling A+, 2026-08-21) ──────────────────────
 * Pinned recipes do not refuse this write, and that is the point. Retiring a product
 * is Juan declaring a fact about the kitchen — we do not buy this any more — and the
 * system's job is to make the CONSEQUENCES visible, not to argue with reality. It is
 * the same count-beats-theory posture `count_exceeds_lots` took: the floor's
 * statement wins, and the ledger's disagreement becomes an advisory, not a veto.
 *
 * The consequence is real and it is loud: every pinned line resolves `unresolved`
 * with reason `retired_product` (rung 0), the costing board names the product in its
 * drawer, and the recipe builder badges the line "discontinued — needs re-point".
 * The pre-flight warning lives in the UI (which already holds `pinnedRecipes`); the
 * COUNT is recorded here, in the audit row, so the trail says what was known at the
 * moment the decision was made.
 */
export async function setProductActive(
  actor: AuthContext,
  args: { productId: string; active: boolean },
): Promise<{ pinnedRecipeCount: number }> {
  requireLevel(actor, PRODUCT_WRITE_MIN);
  const sb = getServiceRoleClient();

  const { data: before, error: bErr } = await sb
    .from("products")
    .select("id, name, active")
    .eq("id", args.productId)
    .maybeSingle<{ id: string; name: string; active: boolean | null }>();
  throwIfSchemaPending(bErr, "setProductActive lookup");
  if (bErr) throw new Error(`setProductActive lookup failed: ${bErr.message}`);
  if (!before) throw new ProductError(404, "not_found", "Product not found");

  // Read the pins BEFORE the write so the audit row records what was true at the
  // moment of the decision — a count taken afterwards answers a different question.
  const pinned = await loadPinnedRecipesByProduct(sb, [args.productId]);
  const pinnedRecipes = pinned.get(args.productId) ?? [];

  const { error, count } = await sb
    .from("products")
    .update(
      { active: args.active, updated_by: actor.user.id, updated_at: new Date().toISOString() },
      { count: "exact" },
    )
    .eq("id", args.productId);
  throwIfSchemaPending(error, "setProductActive");
  // The partial unique index on lower(name) WHERE active is what a restore can
  // collide with: someone created a new active product under the retired one's name.
  if (error?.code === "23505") {
    throw new ProductError(409, "duplicate_name", "An active product already uses that name");
  }
  if (error) throw new Error(`setProductActive failed: ${error.message}`);
  if (count === 0) throw new ProductError(404, "not_found", "Product not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "product.set_active",
    resourceTable: "products",
    resourceId: args.productId,
    metadata: {
      name: before.name,
      before_active: before.active ?? true,
      after_active: args.active,
      // The forensic half of "why did ham stop costing on Thursday": the recipes
      // that were pinning this identity when it was retired, named, not just counted.
      pinned_recipe_count: pinnedRecipes.length,
      pinned_recipe_ids: pinnedRecipes.map((r) => r.id),
    },
    ipAddress: null,
    userAgent: null,
  });

  return { pinnedRecipeCount: pinnedRecipes.length };
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
  // TENANCY BIND (2026-08-21 T0 sweep). `locationId` arrives from the client and was
  // shape-checked only, so a location-bound GM could designate the primary vendor for
  // a shop they are not assigned to — silently re-pointing THAT shop's resolution for
  // costing, counts and the order walk. The level gate is only half; the record has to
  // be bound too (the IDOR two-halves law). `null` is the GLOBAL default row and is
  // deliberately org-scope, so only a real location id is bound.
  if (args.locationId !== null && !lockLocationContext(actorLoc(actor), args.locationId)) {
    throw new ProductError(404, "not_found", "Location not found");
  }
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
