/**
 * Shop versions of a SKU's pack chain and price — THE ONE RESOLVER, PURE (catalog Phase 2a,
 * migration 0259; spec 2026-10-15 §3). Client-safe: no I/O, no server imports.
 *
 * THE RULE, ONE PLACE PER KIND: every consumer gets "this shop's version IN FORCE if it has one,
 * else the global default". The loaders (lib/prep-consumption.ts for packs, lib/admin/cost.ts for
 * prices) read rows for {global ∪ this shop} and hand them HERE; no consumer ever picks a version
 * itself — the same law as product resolution (AGENTS.md "RESOLUTION HAPPENS ONCE").
 *
 *   scope null      → the global default only (rows with location_id NULL).
 *   scope "<shop>"  → that shop's version when it has one, else the global one. Another shop's
 *                     rows are never an answer for this one.
 *
 * TWO CLOCKS (D1). LIVE screens resolve NOW (the active rows). A PAST business date resolves AS OF
 * its last instant (pickVersionsAsOf over valid_from / valid_to), so a pack version made today never
 * re-resolves yesterday's rebuilt depletion. Receipts and counts keep the ounces they stored.
 *
 * Rows written before 0259 carry no location_id/version_id; they read as global, which is exactly
 * what they are — that is what makes the no-shop-version case byte-identical.
 */
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import { skuContentOz, type MeasureUnitFactor } from "@/lib/recipe-math";
import { operationalDayUtcRange } from "@/lib/operational-day";
import type { RoleCode } from "@/lib/roles";

/** null = the global default; otherwise a shop (locations.id). */
export type VersionScope = string | null;

/** The generated scope_key a global row carries (0259). */
export const NIL_SCOPE = "00000000-0000-0000-0000-000000000000";

/** A shop id that is safe to interpolate into a PostgREST `or=` filter. Throws otherwise. */
export function assertScopeToken(scope: string): string {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(scope)) throw new Error(`invalid version scope: ${JSON.stringify(scope)}`);
  return scope;
}

// ── Packs, live ───────────────────────────────────────────────────────────────

/** A sku_pack_levels row as the pack loaders select it (0259 columns optional). */
export interface ScopedLevelRow {
  id: string;
  sku_id: string;
  version_id?: string | null;
  location_id?: string | null;
  effective_from?: string | null;
  label: string;
  contains_qty: number | string;
  contains_level_id: string | null;
  contains_measure_unit: string | null;
  display_ordinal: number;
}

/**
 * The legacy FLAT pack a SKU had before its first global chain (0259 trigger
 * sku_pack_versions_flat_baseline). A version carrying one has no levels; a past business date
 * inside it resolves to these fields, never to today's (overwritten) flat mirror.
 */
export interface FlatPackSnapshot {
  pack_format: string | null;
  each_container_label: string | null;
  units_per_pack: number | null;
  each_size: number | string | null;
  each_measure: string | null;
}

/** One SKU's resolved chain: the levels, which version, whose, and since when. */
export interface ResolvedPack {
  levels: PackChainLevel[];
  versionId: string | null;
  /** null = the global default answered; a shop id = that shop's own version answered. */
  locationId: string | null;
  effectiveFrom: string | null;
  /** Set only on an as-of answer from a pre-chain baseline version: the flat pack in force then. */
  flat?: FlatPackSnapshot;
  /** Set only when a shop version's levels were missing and THIS (global) answer stood in for it. */
  fallbackFromVersionId?: string;
}

function numOrZero(v: number | string): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function toLevel(r: ScopedLevelRow): PackChainLevel {
  return {
    id: r.id, label: r.label, containsQty: numOrZero(r.contains_qty),
    containsLevelId: r.contains_level_id, containsMeasureUnit: r.contains_measure_unit,
    displayOrdinal: r.display_ordinal,
  };
}

/** Each SKU's LIVE chain for `scope` from ACTIVE rows of {global ∪ scope}; levels keep arrival order. */
export function resolvePackLevels(rows: readonly ScopedLevelRow[], scope: VersionScope): Map<string, ResolvedPack> {
  const global = new Map<string, ScopedLevelRow[]>();
  const shop = new Map<string, ScopedLevelRow[]>();
  const order: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const loc = r.location_id ?? null;
    let bucket: Map<string, ScopedLevelRow[]> | null = null;
    if (loc === null) bucket = global;
    else if (scope !== null && loc === scope) bucket = shop;
    if (!bucket) continue; // another shop's row: never this scope's answer
    const list = bucket.get(r.sku_id) ?? [];
    list.push(r);
    bucket.set(r.sku_id, list);
    if (!seen.has(r.sku_id)) { seen.add(r.sku_id); order.push(r.sku_id); }
  }
  const out = new Map<string, ResolvedPack>();
  for (const skuId of order) {
    const pick = shop.get(skuId) ?? global.get(skuId);
    if (!pick || pick.length === 0) continue;
    const head = pick[0]!;
    out.set(skuId, {
      levels: pick.map(toLevel), versionId: head.version_id ?? null,
      locationId: head.location_id ?? null, effectiveFrom: head.effective_from ?? null,
    });
  }
  return out;
}

/** The pre-0259 loader shape: skuId → chain levels. */
export function levelsBySku(resolved: ReadonlyMap<string, ResolvedPack>): Map<string, PackChainLevel[]> {
  return new Map([...resolved].map(([id, r]) => [id, r.levels]));
}

// ── Packs, as of an instant (D1) ──────────────────────────────────────────────

export interface ScopedVersionRow {
  id: string;
  sku_id: string;
  location_id: string | null;
  valid_from: string;
  valid_to: string | null;
  /** A pre-chain baseline (0259): the legacy flat pack in force over this version's dates. */
  flat_snapshot?: FlatPackSnapshot | null;
}

function inForceAt(v: ScopedVersionRow, at: number): boolean {
  return Date.parse(v.valid_from) <= at && (v.valid_to == null || at < Date.parse(v.valid_to));
}

/**
 * The version IN FORCE at `asOf` per SKU: this shop's (if one was in force then) beats the
 * global one. A retired shop version answers only inside its own dates — that is "back to
 * default", seen from the past.
 */
export function pickVersionsAsOf(versions: readonly ScopedVersionRow[], scope: VersionScope, asOf: string): Map<string, PickedVersion> {
  const at = Date.parse(asOf);
  const shop = new Map<string, ScopedVersionRow>();
  const global = new Map<string, ScopedVersionRow>();
  for (const v of versions) {
    if (!inForceAt(v, at)) continue;
    const bucket = v.location_id === null ? global : scope !== null && v.location_id === scope ? shop : null;
    if (!bucket) continue;
    const prior = bucket.get(v.sku_id);
    if (!prior || Date.parse(v.valid_from) > Date.parse(prior.valid_from)) bucket.set(v.sku_id, v);
  }
  const out = new Map<string, PickedVersion>();
  for (const [sku, v] of global) out.set(sku, v);
  // A shop pick carries the global version in force at the same instant, so packsFromVersions can
  // fall back to it (loudly) if the shop version's levels did not load.
  for (const [sku, v] of shop) out.set(sku, { ...v, globalFallback: global.get(sku) });
  return out;
}

/** A picked version; a SHOP pick also names the global version in force at the same instant. */
export type PickedVersion = ScopedVersionRow & { globalFallback?: ScopedVersionRow };

/**
 * A NAMED as-of resolution warning (chunk-1 review): a picked version whose levels are not in the
 * loaded set must never make the SKU vanish silently.
 *   shop_version_levels_missing   — the shop version had no loaded level; the global version in
 *                                   force then answered instead (fellBackToVersionId), or nothing
 *                                   could (null → the SKU rides the flat path, today's "no chain").
 *   global_version_levels_missing — the global version had no loaded level and no flat baseline;
 *                                   the SKU rides the flat path (today's "no chain" answer).
 */
export interface PackPickWarning {
  code: "shop_version_levels_missing" | "global_version_levels_missing";
  skuId: string;
  versionId: string;
  locationId: string | null;
  fellBackToVersionId: string | null;
}

/**
 * The chains of exactly the picked versions (levels of any activity; history is append-only).
 * A shop version whose levels are missing falls back to the global version in force then and
 * pushes a named warning into `warnings` (when given) — never a silent disappearance.
 */
export function packsFromVersions(
  picked: ReadonlyMap<string, PickedVersion>,
  levels: readonly ScopedLevelRow[],
  warnings?: PackPickWarning[],
): Map<string, ResolvedPack> {
  const byVersion = new Map<string, ScopedLevelRow[]>();
  for (const l of levels) {
    if (l.version_id == null) continue;
    const list = byVersion.get(l.version_id) ?? [];
    list.push(l);
    byVersion.set(l.version_id, list);
  }
  const answer = (v: ScopedVersionRow): ResolvedPack | null => {
    if (v.flat_snapshot) {
      // A pre-chain baseline answers with the FLAT pack it preserved (Astra 2b r2#5).
      return { levels: [], versionId: v.id, locationId: v.location_id, effectiveFrom: v.valid_from, flat: v.flat_snapshot };
    }
    const rows = byVersion.get(v.id);
    if (!rows || rows.length === 0) return null;
    return { levels: rows.map(toLevel), versionId: v.id, locationId: v.location_id, effectiveFrom: v.valid_from };
  };
  const out = new Map<string, ResolvedPack>();
  for (const [sku, v] of picked) {
    const own = answer(v);
    if (own) { out.set(sku, own); continue; }
    if (v.location_id !== null) {
      const fb = v.globalFallback ? answer(v.globalFallback) : null;
      warnings?.push({ code: "shop_version_levels_missing", skuId: sku, versionId: v.id, locationId: v.location_id, fellBackToVersionId: fb ? fb.versionId : null });
      if (fb) out.set(sku, { ...fb, fallbackFromVersionId: v.id });
      continue;
    }
    warnings?.push({ code: "global_version_levels_missing", skuId: sku, versionId: v.id, locationId: null, fellBackToVersionId: null });
  }
  return out;
}

/**
 * A business date resolves at its LAST instant (ET), so a change made that day is that day's pack.
 * The last instant is the NEXT day's ET start minus 1 ms (chunk-3 review P3a) — never start + 24 h,
 * which is an hour short on the 25-hour fall-back day and an hour into the next day on the 23-hour
 * spring-forward day.
 */
export function asOfForBusinessDate(businessDate: string): string {
  const { endExclusiveIso } = operationalDayUtcRange(businessDate);
  return new Date(Date.parse(endExclusiveIso) - 1).toISOString();
}

// ── The two flat-path consumers ───────────────────────────────────────────────

/**
 * Content oz for MANUAL PRODUCTION and CATERING SURPLUS, which have always divided by the flat
 * mirror (vendor_items.units_per_pack × each_size × oz-per-measure) and never read a chain. The
 * GLOBAL answer stays exactly that (byte-identical; replaceSkuPackChain keeps the mirror synced
 * from the global chain). A SHOP version has no flat mirror, so its chain is its only truth.
 */
export function contentOzForScope(
  flat: { unitsPerPack: number | null; eachSize: number | null; eachMeasure: string | null; avgOzPerEach: number | null },
  resolved: ResolvedPack | undefined,
  measures: Map<string, MeasureUnitFactor>,
): number | null {
  if (resolved && resolved.locationId !== null) return skuContentOz({ ...flat, packChain: resolved.levels }, measures);
  return skuContentOz(flat, measures);
}

/**
 * Units per pack from the SAME selected pack the content came from (Astra 2a r2#1): prep's "each"
 * is content ÷ units, so mixing a shop chain's content with the global flat count mis-weighs every
 * each. A SHOP version answers from its chain (the product of the non-leaf quantities, root to leaf;
 * a one-level chain is 1 — deriveFlatFieldsFromChain's rule); the GLOBAL answer stays the flat
 * mirror, byte-for-byte. A malformed chain (no unique root, a cycle, no leaf) is null — never a guess.
 */
export function unitsPerPackForScope(flatUnits: number | null, resolved: ResolvedPack | undefined): number | null {
  if (!resolved || resolved.locationId === null) return flatUnits;
  const levels = resolved.levels;
  const pointedAt = new Set(levels.map((l) => l.containsLevelId).filter((id): id is string => id != null));
  const roots = levels.filter((l) => !pointedAt.has(l.id));
  if (roots.length !== 1) return null;
  const byId = new Map(levels.map((l) => [l.id, l]));
  let cur: PackChainLevel | undefined = roots[0];
  let units = 1;
  const seen = new Set<string>();
  while (cur && cur.containsLevelId != null) {
    if (seen.has(cur.id) || !(cur.containsQty > 0)) return null;
    seen.add(cur.id);
    units *= cur.containsQty;
    cur = byId.get(cur.containsLevelId);
  }
  return cur ? units : null;
}

// ── Prices ────────────────────────────────────────────────────────────────────

/** A vendor_price_history row as the scoped loader selects it (0259 columns optional). */
export interface ScopedPriceRow {
  id?: string | null;
  vendor_item_id: string;
  unit_price: number | string;
  effective_date: string;
  recorded_at: string | null;
  location_id?: string | null;
  price_lane_id?: string | null;
}

export interface ResolvedPrice {
  value: number;
  priceId: string | null;
  /** null = the global head answered; a shop id = that shop's live lane answered. */
  locationId: string | null;
  laneId: string | null;
  effectiveDate: string;
}

function parsePrice(v: number | string): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * Current price per SKU from rows ordered NEWEST FIRST (effective_date, recorded_at, id — desc).
 * `liveLaneBySku` maps a SKU to this shop's LIVE lane id (empty for the global scope). A live lane
 * → the newest row OF THAT LANE (a lane with no row of its own falls back to the global head);
 * no lane → the newest GLOBAL row. The first PARSEABLE row wins — today's rule.
 */
export function resolveCurrentPrices(
  rowsNewestFirst: readonly ScopedPriceRow[],
  liveLaneBySku: ReadonlyMap<string, string>,
): Map<string, ResolvedPrice> {
  const out = new Map<string, ResolvedPrice>();
  const globalFallback = new Map<string, ResolvedPrice>();
  for (const r of rowsNewestFirst) {
    const value = parsePrice(r.unit_price);
    if (value == null) continue;
    const sku = r.vendor_item_id;
    const isGlobal = (r.location_id ?? null) === null;
    const resolved: ResolvedPrice = { value, priceId: r.id ?? null, locationId: r.location_id ?? null, laneId: r.price_lane_id ?? null, effectiveDate: r.effective_date };
    const lane = liveLaneBySku.get(sku);
    if (lane !== undefined) {
      if (r.price_lane_id === lane) { if (!out.has(sku)) out.set(sku, resolved); }
      else if (isGlobal && !globalFallback.has(sku)) globalFallback.set(sku, resolved);
    } else if (isGlobal && !out.has(sku)) {
      out.set(sku, resolved);
    }
  }
  for (const [sku, p] of globalFallback) if (!out.has(sku)) out.set(sku, p);
  return out;
}

/** Dollars → integer cents, float-safe (the purchase-order rule, one spelling). */
export function priceCentsFromDollars(dollars: number): number {
  return Math.round(Number((dollars * 100).toFixed(4)));
}

// ── The shop allowance and the write gates (spec §2; D2, D5) ─────────────────

/** AGM (6) / GM (7) write their OWN shop's version (pack, price). */
export const SHOP_VERSION_WRITE_MIN = 6;
/** MoO (8) and up write the global default and ANY shop's version. */
export const GLOBAL_VERSION_WRITE_MIN = 8;
/** Setting the FIRST global value of a SKU that has none keeps today's floors. */
export const FIRST_GLOBAL_WRITE_MIN = { pack: 7, price: 6 } as const;

/**
 * CATALOG SHOP ALLOWANCE (D2): which shop's catalog versions an actor may write. MoO (8) and up —
 * any active shop (the database re-checks "active"); GM/AGM — only their memberships. Deliberately
 * NOT lockLocationContext (all shops at 9): the catalog is the org's, and Cristian runs it.
 */
export function catalogShopAllowed(actor: { level: number; locations: readonly string[] }, shopId: string): boolean {
  return actor.level >= GLOBAL_VERSION_WRITE_MIN || actor.locations.includes(shopId);
}

/**
 * THE OWNING-SHOP RULE for a GLOBAL write (Astra 2a r3#1). A SKU owned by ONE shop
 * (vendor_items.location_id — a store copy, a shop-only item) is that shop's business: below MoO
 * its global value (the first pack, the first price) may be set only by someone who works in that
 * shop. A SHARED SKU (location_id NULL) follows the first-value rule alone, decided in SQL under the
 * SKU lock. MoO+ any (catalogShopAllowed).
 */
export function skuOwnerAllowed(actor: { level: number; locations: readonly string[] }, ownerLocationId: string | null): boolean {
  return ownerLocationId === null || catalogShopAllowed(actor, ownerLocationId);
}

/** GM (7) and up: every role at that level writes the catalog (within the floors below). */
export const CATALOG_ANY_ROLE_MIN = 7;
/**
 * LEVEL 6 IS NOT ONE THING (lead decision, chunk-1 review). Catalog writes at level 6 belong to the
 * OPERATIONAL managers only — AGM, prep manager, catering manager. The social media manager shares
 * the level and is EXCLUDED: a role check, never level-only (AGENTS.md: level 6 also means
 * social_media_mgr).
 */
export const CATALOG_LEVEL6_WRITE_ROLES: readonly RoleCode[] = ["agm", "prep_mgr", "catering_mgr"];

/** May this role write the catalog at all? Level 7+ any role; level 6 the operational managers only. */
export function catalogWriteRoleAllowed(role: RoleCode, level: number): boolean {
  if (level >= CATALOG_ANY_ROLE_MIN) return true;
  if (level >= SHOP_VERSION_WRITE_MIN) return CATALOG_LEVEL6_WRITE_ROLES.includes(role);
  return false;
}

export type VersionKind = "pack" | "price";
export type VersionWriteRefusal = { ok: false; status: 403 | 404; code: "forbidden" | "not_found" | "global_requires_moo" };

/**
 * Decided from the actor and the scope alone, before any I/O. `scopeAllowed` is the caller's
 * catalogShopAllowed(actor, scope). A global write below MoO is `firstOnly`: the writer RPC refuses
 * it, under the SKU lock and in the same transaction as the insert, if a global value exists.
 */
export function versionWriteGate(input: {
  kind: VersionKind; role: RoleCode; level: number; scope: VersionScope; scopeAllowed: boolean;
}): { ok: true; firstOnly: boolean } | VersionWriteRefusal {
  if (input.scope !== null) {
    if (input.level < SHOP_VERSION_WRITE_MIN) return { ok: false, status: 403, code: "forbidden" };
    if (!catalogWriteRoleAllowed(input.role, input.level)) return { ok: false, status: 403, code: "forbidden" };
    if (!input.scopeAllowed) return { ok: false, status: 404, code: "not_found" };
    return { ok: true, firstOnly: false };
  }
  if (!catalogWriteRoleAllowed(input.role, input.level)) return { ok: false, status: 403, code: "forbidden" };
  if (input.level >= GLOBAL_VERSION_WRITE_MIN) return { ok: true, firstOnly: false };
  if (input.level >= FIRST_GLOBAL_WRITE_MIN[input.kind]) return { ok: true, firstOnly: true };
  return { ok: false, status: 403, code: "forbidden" };
}
