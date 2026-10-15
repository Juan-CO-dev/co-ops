/**
 * Prep-consumption engine (Item/Inventory Spine — production-in-prep fold). SERVER-ONLY,
 * service-role.
 *
 * EVERY READ IN THIS MODULE THROWS ON `error` (audit v2 P1-3, BC-032). This graph is the
 * inventory moat's foundation — depletion, ordering suggestions, readiness and counts all
 * compute on it — and a dropped `error` here does not produce an obvious failure, it
 * produces a SMALLER GRAPH: fewer recipes, fewer edges, a SKU with no pack basis, an item
 * with no par basis. Every consumer then reports a confident, plausible, wrong number, and
 * nothing downstream can tell that graph from a correct one. A partial recipe graph must
 * never exist, so a failed read is fatal to the whole build rather than survivable by it.
 * Recursively flattens an item's item_components recipe to leaf-SKU oz consumed
 * per par-unit, mirroring recipe-math's per-batch ÷ output-yield semantics (the divisor is
 * the output row's `yield` on the graph, not `recipes.batch_yield`) — but ACCUMULATING PER
 * LEAF SKU instead of summing. Returns oz-per-output-unit; callers scale. 0215's batch fold
 * (recordBatchProductionFromPrep below) reads the SAME graph and multiplies by that yield.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { skuContentOz, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import {
  asOfForBusinessDate, assertScopeToken, levelsBySku, packsFromVersions, pickVersionsAsOf, resolvePackLevels, unitsPerPackForScope,
  type PackPickWarning, type ResolvedPack, type ScopedLevelRow, type ScopedVersionRow, type VersionScope,
} from "@/lib/sku-versions-shared";
import {
  mergeResolvedInputs, pickLiveShopRecipeVersions, pickRecipeVersionsAsOf, recipeLineReplacements, versionIdsNeedingLines,
  type RecipeVersionLineRow, type RecipeVersionRow, type ResolvedRecipeInput,
} from "@/lib/recipe-versions-shared";
import {
  batchSkuOzForItemFromGraph,
  buildRecipeGraph,
  isSingleItemOutputFromGraph,
  perUnitSkuOzForItemFromGraph,
  perUnitSkuOzForMenuItemFromGraph,
  yieldForItemFromGraph,
  type GraphRecipe,
  type RecipeGraph,
} from "@/lib/prep-consumption-graph";
import { loadProductIndex } from "@/lib/products";
import { audit } from "@/lib/audit";
import type { RoleCode } from "@/lib/roles";

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

export async function loadMeasures(): Promise<Map<string, MeasureUnitFactor>> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("measure_units").select("label, dimension, to_base_factor").eq("active", true).returns<Array<{ label: string; dimension: "weight" | "volume" | "count"; to_base_factor: number | string }>>();
  // A missing unit is not a missing conversion — it is a SILENT ZERO. `toBaseFactor`
  // defaults to 0 below, so a dropped registry read turns every recipe quantity into 0 oz.
  if (error) throw new Error(`loadMeasures: ${error.message}`);
  return new Map((data ?? []).map((m) => [m.label, { dimension: m.dimension, toBaseFactor: num(m.to_base_factor) ?? 0 }]));
}

/**
 * The resolved packs (which version, whose) behind a graph's skuPack — remembered per graph so a
 * consumer of THAT graph never resolves the same packs a second time (chunk-3 review P3b). Kept off
 * the RecipeGraph type on purpose: the pure graph module stays I/O-free and its shape unchanged.
 */
const GRAPH_PACKS = new WeakMap<RecipeGraph, Map<string, ResolvedPack>>();
/** The packs loadRecipeGraph resolved for `graph` (empty for a graph it did not build). */
export function resolvedPacksOf(graph: RecipeGraph): ReadonlyMap<string, ResolvedPack> {
  return GRAPH_PACKS.get(graph) ?? new Map();
}

async function loadSkuPack(skuIds: string[], scope: VersionScope, asOf: string | null = null, resolvedOut?: Map<string, ResolvedPack>): Promise<Map<string, RecipeInputSku>> {
  if (skuIds.length === 0) return new Map();
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("vendor_items")
    .select("id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("id", skuIds)
    .returns<Array<{ id: string; pack_format: string | null; each_container_label: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  // A SKU absent from this map has no pack basis, which reads downstream as "we cannot
  // weigh this" — the honest answer for a genuinely unweighed SKU and a lie for a
  // weighed one the read simply failed to return.
  if (error) throw new Error(`loadSkuPack: ${error.message}`);
  const packs = await loadSkuPackResolution(skuIds, scope, asOf);
  if (resolvedOut) for (const [id, r] of packs) resolvedOut.set(id, r);
  return new Map((data ?? []).map((s) => {
    const pack = packs.get(s.id);
    // A past date inside a PRE-CHAIN BASELINE (0259) reads the flat pack it preserved, not today's
    // overwritten mirror (Astra 2b r2#5). Every other answer reads the flat fields exactly as before.
    const f = pack?.flat;
    return [s.id, {
      packFormat: f ? f.pack_format : s.pack_format, eachContainerLabel: f ? f.each_container_label : s.each_container_label,
      unitsPerPack: f ? f.units_per_pack : s.units_per_pack, eachSize: num(f ? f.each_size : s.each_size), eachMeasure: f ? f.each_measure : s.each_measure,
      avgOzPerEach: num(s.avg_oz_per_each),
      packChain: pack && pack.levels.length > 0 ? pack.levels : null,
    }];
  }));
}

/**
 * The level columns every pack read selects. version_id / location_id / effective_from ride along
 * so THE ONE RESOLVER (lib/sku-versions-shared.ts) can choose "this shop's version, else the global
 * one" — no consumer ever chooses (catalog Phase 2a, 0259).
 */
const PACK_LEVEL_COLUMNS =
  "id, sku_id, version_id, location_id, effective_from, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal";
/** How many ids ride one `.in()` filter (the request-line budget, lib/supabase-paginate.ts). */
const ID_CHUNK = 100;

/**
 * THE PACK RESOLVER POINT (catalog Phase 2a). Chains for these SKUs as `scope` sees them — `null` =
 * the global default; a shop id = that shop's version, else the global one. LIVE by default; with
 * `asOf`, the versions IN FORCE at that instant (D1 — a past business date's packs). PAGED and
 * id-CHUNKED: {global ∪ shop} rows can exceed the row cap, and a truncated page would drop a leaf
 * and break a conversion silently. `scope` is REQUIRED so the compiler makes every caller decide.
 */
export async function loadSkuPackResolution(skuIds: string[], scope: VersionScope, asOf: string | null = null): Promise<Map<string, ResolvedPack>> {
  if (skuIds.length === 0) return new Map();
  if (asOf != null) return loadSkuPackResolutionAsOf(skuIds, scope, asOf);
  const sb = getServiceRoleClient();
  const rows: ScopedLevelRow[] = [];
  for (let i = 0; i < skuIds.length; i += ID_CHUNK) {
    const chunk = skuIds.slice(i, i + ID_CHUNK);
    rows.push(...await selectAllRows<ScopedLevelRow>(async (from, to) => {
      const base = sb.from("sku_pack_levels").select(PACK_LEVEL_COLUMNS).in("sku_id", chunk).eq("active", true);
      const scoped = scope == null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
      const { data, error } = await scoped
        .order("display_ordinal", { ascending: true }).order("id", { ascending: true })
        .range(from, to).returns<ScopedLevelRow[]>();
      // "No chain" is a MEANINGFUL answer (it routes the SKU to the legacy flat-field path), so a
      // swallowed failure would silently re-denominate every chained SKU in the graph.
      if (error) throw new Error(`loadSkuPackChains: ${error.message}`);
      return { data };
    }));
  }
  return resolvePackLevels(rows, scope);
}

/** D1: the versions in force at `asOf` (versions first, then exactly their levels; both paged). */
async function loadSkuPackResolutionAsOf(skuIds: string[], scope: VersionScope, asOf: string): Promise<Map<string, ResolvedPack>> {
  const sb = getServiceRoleClient();
  const versions: ScopedVersionRow[] = [];
  for (let i = 0; i < skuIds.length; i += ID_CHUNK) {
    const chunk = skuIds.slice(i, i + ID_CHUNK);
    versions.push(...await selectAllRows<ScopedVersionRow>(async (from, to) => {
      const base = sb.from("sku_pack_versions").select("id, sku_id, location_id, valid_from, valid_to, flat_snapshot").in("sku_id", chunk).lte("valid_from", asOf);
      const scoped = scope == null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
      const { data, error } = await scoped.order("id", { ascending: true }).range(from, to).returns<ScopedVersionRow[]>();
      if (error) throw new Error(`loadSkuPackChains as-of versions: ${error.message}`);
      return { data };
    }));
  }
  const picked = pickVersionsAsOf(versions, scope, asOf);
  // A shop pick's global fallback (the version in force at the same instant) loads too, so a shop
  // version whose levels are missing falls back to it instead of vanishing (chunk-1 review).
  const versionIds = [...new Set([...picked.values()]
    .flatMap((v) => [v, v.globalFallback])
    .filter((v): v is ScopedVersionRow => v != null && !v.flat_snapshot)
    .map((v) => v.id))];
  const levels: ScopedLevelRow[] = [];
  for (let i = 0; i < versionIds.length; i += ID_CHUNK) {
    const chunk = versionIds.slice(i, i + ID_CHUNK);
    levels.push(...await selectAllRows<ScopedLevelRow>(async (from, to) => {
      const { data, error } = await sb.from("sku_pack_levels").select(PACK_LEVEL_COLUMNS).in("version_id", chunk)
        .order("display_ordinal", { ascending: true }).order("id", { ascending: true })
        .range(from, to).returns<ScopedLevelRow[]>();
      if (error) throw new Error(`loadSkuPackChains as-of levels: ${error.message}`);
      return { data };
    }));
  }
  const warnings: PackPickWarning[] = [];
  const packs = packsFromVersions(picked, levels, warnings);
  // NAMED, never silent: a picked version with no loaded level is a data fault the log must show.
  for (const w of warnings) console.warn(`sku_pack_as_of_${w.code}`, { skuId: w.skuId, versionId: w.versionId, locationId: w.locationId, fellBackToVersionId: w.fellBackToVersionId, asOf });
  return packs;
}

/** Chain levels per SKU for `scope` (the pre-0259 return shape); missing entry = no chain. */
export async function loadSkuPackChains(skuIds: string[], scope: VersionScope, asOf: string | null = null): Promise<Map<string, PackChainLevel[]>> {
  return levelsBySku(await loadSkuPackResolution(skuIds, scope, asOf));
}

/**
 * EVERY live chain, grouped per SKU, as `scope` sees them (B9: the counts render needs chains for
 * nearly the whole catalog, and a ~200-id `.in()` list sits at the request-line ceiling). PAGED.
 */
export async function loadAllSkuPackResolution(scope: VersionScope): Promise<Map<string, ResolvedPack>> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<ScopedLevelRow>(async (from, to) => {
    const base = sb.from("sku_pack_levels").select(PACK_LEVEL_COLUMNS).eq("active", true);
    const scoped = scope == null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
    const { data, error } = await scoped
      .order("display_ordinal", { ascending: true }).order("id", { ascending: true })
      .range(from, to).returns<ScopedLevelRow[]>();
    if (error) throw new Error(`loadAllSkuPackChains: ${error.message}`);
    return { data };
  });
  return resolvePackLevels(rows, scope);
}

export async function loadAllSkuPackChains(scope: VersionScope): Promise<Map<string, PackChainLevel[]>> {
  return levelsBySku(await loadAllSkuPackResolution(scope));
}

/**
 * This shop's CURRENT pack epoch per SKU (0259 sku_pack_epochs; D3). A SKU with no row is at epoch 0
 * and is simply absent here. Chunked + paged like every pack read; throws on error (a swallowed
 * failure would read every epoch as 0 and resurrect stale machine pars).
 */
export async function loadShopPackEpochs(skuIds: string[], locationId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  for (let i = 0; i < skuIds.length; i += ID_CHUNK) {
    const chunk = skuIds.slice(i, i + ID_CHUNK);
    const rows = await selectAllRows<{ sku_id: string; epoch: number | string }>(async (from, to) => {
      const { data, error } = await sb.from("sku_pack_epochs").select("sku_id, epoch")
        .eq("location_id", assertScopeToken(locationId)).in("sku_id", chunk)
        .order("sku_id", { ascending: true }).range(from, to).returns<Array<{ sku_id: string; epoch: number | string }>>();
      if (error) throw new Error(`loadShopPackEpochs: ${error.message}`);
      return { data };
    });
    for (const r of rows) out.set(r.sku_id, Number(r.epoch));
  }
  return out;
}

/**
 * EVERY pack BOUNDARY (a version opening or closing) visible to `scope`, ascending, de-duplicated
 * (epoch ms). Between two consecutive boundaries nothing about the packs `scope` sees changes, so
 * every instant in that interval resolves to the SAME graph. Paged (one row per version).
 */
export async function loadPackBoundaries(scope: VersionScope): Promise<number[]> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<{ id: string; valid_from: string; valid_to: string | null }>(async (from, to) => {
    const base = sb.from("sku_pack_versions").select("id, valid_from, valid_to");
    const scoped = scope == null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
    const { data, error } = await scoped.order("id", { ascending: true }).range(from, to)
      .returns<Array<{ id: string; valid_from: string; valid_to: string | null }>>();
    if (error) throw new Error(`loadPackBoundaries: ${error.message}`);
    return { data };
  });
  const out = new Set<number>();
  for (const r of rows) {
    out.add(Date.parse(r.valid_from));
    if (r.valid_to != null) out.add(Date.parse(r.valid_to));
  }
  return [...out].filter(Number.isFinite).sort((x, y) => x - y);
}

/**
 * The INTERVAL an instant falls in: -1 before the first boundary, k for [b_k, b_k+1), and the last
 * index for "after every boundary" (the live graph). Pure; boundaries ascending.
 */
export function packIntervalIndex(boundaries: readonly number[], at: number): number {
  let lo = 0, hi = boundaries.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (boundaries[mid]! <= at) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * EVERY RECIPE BOUNDARY (a recipe version opening or closing) visible to `scope`, ascending, de-duplicated
 * (epoch ms) — catalog Phase 3a, 0262. Baseline versions open on 2000-01-01, so with no edit since the migration
 * the only recipe boundary is that date and every later business date resolves to the live graph. Paged.
 */
export async function loadRecipeBoundaries(scope: VersionScope): Promise<number[]> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<{ id: string; valid_from: string; valid_to: string | null }>(async (from, to) => {
    const base = sb.from("recipe_versions").select("id, valid_from, valid_to");
    const scoped = scope == null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
    const { data, error } = await scoped.order("id", { ascending: true }).range(from, to)
      .returns<Array<{ id: string; valid_from: string; valid_to: string | null }>>();
    if (error) throw new Error(`loadRecipeBoundaries: ${error.message}`);
    return { data };
  });
  const out = new Set<number>();
  for (const r of rows) {
    out.add(Date.parse(r.valid_from));
    if (r.valid_to != null) out.add(Date.parse(r.valid_to));
  }
  return [...out].filter(Number.isFinite).sort((x, y) => x - y);
}

/** Pack ∪ recipe boundaries for `scope`, ascending and de-duplicated: the cuts between dated-graph intervals. */
export async function loadCatalogBoundaries(scope: VersionScope): Promise<number[]> {
  const [packs, recipes] = await Promise.all([loadPackBoundaries(scope), loadRecipeBoundaries(scope)]);
  return [...new Set([...packs, ...recipes])].sort((x, y) => x - y);
}

/**
 * THE RECIPE-VERSION RESOLVER POINT (catalog Phase 3a, 0262). recipe → the lines that REPLACE its
 * recipe_inputs for `scope` at `asOf`, decided by the pure rules in lib/recipe-versions-shared.ts:
 *   live, global ....... nothing to read — recipe_inputs IS the live global (zero queries);
 *   live, a shop ....... that shop's live versions (one read) and their lines (one read, when any);
 *   as of an instant ... the versions of {global ∪ scope} opened by then, the pick, then the lines of
 *                        every pick that is not the live global head.
 * PAGED (the 1000-row cap, ordered by real columns) and id-CHUNKED (the request-line budget). Fails loud:
 * a dropped read would silently put the default's lines where a shop's version belongs.
 */
export async function loadRecipeLineOverlay(scope: VersionScope, asOf: string | null): Promise<Map<string, RecipeVersionLineRow[]>> {
  if (asOf == null && scope == null) return new Map();
  const sb = getServiceRoleClient();
  const versions = await selectAllRows<RecipeVersionRow>(async (from, to) => {
    const base = sb.from("recipe_versions").select("id, recipe_id, location_id, valid_from, valid_to, active");
    const scoped = asOf == null
      ? base.eq("location_id", assertScopeToken(scope as string)).eq("active", true)
      : (scope == null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`)).lte("valid_from", asOf);
    const { data, error } = await scoped.order("id", { ascending: true }).range(from, to).returns<RecipeVersionRow[]>();
    if (error) throw new Error(`loadRecipeLineOverlay versions: ${error.message}`);
    return { data };
  });
  const picked = asOf == null ? pickLiveShopRecipeVersions(versions, scope) : pickRecipeVersionsAsOf(versions, scope, asOf);
  const ids = versionIdsNeedingLines(picked);
  if (ids.length === 0) return new Map();
  const lines: RecipeVersionLineRow[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    lines.push(...await selectAllRows<RecipeVersionLineRow>(async (from, to) => {
      const { data, error } = await sb.from("recipe_version_lines")
        .select("id, version_id, recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order")
        .in("version_id", chunk)
        .order("display_order", { ascending: true }).order("id", { ascending: true })
        .range(from, to).returns<RecipeVersionLineRow[]>();
      if (error) throw new Error(`loadRecipeLineOverlay lines: ${error.message}`);
      return { data };
    }));
  }
  return recipeLineReplacements(picked, lines);
}

async function readAllRecipeInputs(sb: ReturnType<typeof getServiceRoleClient>, label: string): Promise<ResolvedRecipeInput[]> {
  return selectAllRows<ResolvedRecipeInput>(async (from, to) => {
    const { data, error } = await sb.from("recipe_inputs")
      .select("id, recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit")
      .order("id", { ascending: true }).range(from, to).returns<ResolvedRecipeInput[]>();
    if (error) throw new Error(`${label} inputs: ${error.message}`);
    return { data };
  });
}

/**
 * THE RECIPE LINES `scope` RESOLVES, for readers that need lines but not a flattened graph (catalog
 * Phase 3a, lead decision 4): readiness, the par advisories' demand sources, production's picker and its
 * conversion check, a location's product pins. The SAME rule as the graph — loadRecipeLineOverlay
 * decides; recipe_inputs answers wherever the live global head does. scope null = the global default.
 * The whole line table is read (the graph is ~60 recipes; an id `.in()` of every SKU is the 414 cliff
 * sim P1 #6 named) and filtered in memory by the caller. Paged; fails loud.
 */
export async function loadResolvedRecipeInputs(scope: VersionScope, asOf: string | null = null): Promise<ResolvedRecipeInput[]> {
  const sb = getServiceRoleClient();
  const [base, replacements] = await Promise.all([
    readAllRecipeInputs(sb, "loadResolvedRecipeInputs"),
    loadRecipeLineOverlay(scope, asOf),
  ]);
  return mergeResolvedInputs(base, replacements);
}

/**
 * THE SAME RESOLUTION FOR SEVERAL SCOPES AT ONCE (chunk-2 review P3c): recipe_inputs is read ONCE and each scope
 * gets its own overlay (one or two small reads), so a page that needs every shop's lines (the pack preview, the
 * hub's readiness) never re-reads the whole line table per shop. Keyed by scope id; the global default is "global".
 */
export async function loadResolvedRecipeInputsByScope(scopes: readonly VersionScope[]): Promise<Map<string, ResolvedRecipeInput[]>> {
  const sb = getServiceRoleClient();
  const unique = [...new Set(scopes.map((s) => s ?? null))];
  const [base, ...overlays] = await Promise.all([
    readAllRecipeInputs(sb, "loadResolvedRecipeInputsByScope"),
    ...unique.map((s) => loadRecipeLineOverlay(s, null)),
  ]);
  return new Map(unique.map((s, i) => [s ?? "global", mergeResolvedInputs(base, overlays[i]!)]));
}

/**
 * EVERY LIVE LINE IN ANY SCOPE: the global default's recipe_inputs plus every live shop version's lines
 * (catalog Phase 3a). For "is this used anywhere" answers that serve no single shop — the SKU list's
 * "used in", the items page's product links, "N recipes still pin this product" before a retire — so a
 * SKU or product only a shop's recipe uses is never reported unused. Paged, id-chunked, fails loud.
 */
export async function loadRecipeInputsAcrossScopes(): Promise<ResolvedRecipeInput[]> {
  const sb = getServiceRoleClient();
  const [base, shopVersions] = await Promise.all([
    readAllRecipeInputs(sb, "loadRecipeInputsAcrossScopes"),
    selectAllRows<{ id: string }>(async (from, to) => {
      const { data, error } = await sb.from("recipe_versions").select("id")
        .not("location_id", "is", null).eq("active", true)
        .order("id", { ascending: true }).range(from, to).returns<Array<{ id: string }>>();
      if (error) throw new Error(`loadRecipeInputsAcrossScopes versions: ${error.message}`);
      return { data };
    }),
  ]);
  const out = [...base];
  const ids = shopVersions.map((v) => v.id);
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    out.push(...await selectAllRows<ResolvedRecipeInput>(async (from, to) => {
      const { data, error } = await sb.from("recipe_version_lines")
        .select("id, recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit")
        .in("version_id", chunk).order("id", { ascending: true }).range(from, to).returns<ResolvedRecipeInput[]>();
      if (error) throw new Error(`loadRecipeInputsAcrossScopes lines: ${error.message}`);
      return { data };
    }));
  }
  return out;
}

/**
 * D1 — ONE graph per catalog INTERVAL (pack and, since 3a, recipe boundaries) for a shop, with the batch law kept (chunk-3 review P2a): every
 * business date whose last instant falls between the same two pack boundaries shares ONE as-of
 * graph, and every date after the last boundary IS the live graph (loaded once). So a 30-day window
 * with one boundary in it costs two graph loads, never thirty. Depletion (Toast and ezCater)
 * resolves through this, so yesterday's rebuilt sales use yesterday's packs. Product resolution is
 * unchanged (current, as before).
 */
export function createDatedGraphs(opts: { locationId: string | null; liveGraph?: RecipeGraph }): (businessDate: string) => Promise<RecipeGraph> {
  let live: Promise<RecipeGraph> | null = opts.liveGraph ? Promise.resolve(opts.liveGraph) : null;
  let bounds: Promise<number[]> | null = null;
  const byInterval = new Map<number, Promise<RecipeGraph>>();
  return async (businessDate: string) => {
    const asOf = asOfForBusinessDate(businessDate);
    // CATALOG PHASE 3a: recipe versions open and close too — the intervals are cut at every pack AND recipe
    // boundary, so two dates on opposite sides of a recipe edit never share a graph.
    bounds ??= loadCatalogBoundaries(opts.locationId);
    const b = await bounds;
    const at = Date.parse(asOf);
    const k = packIntervalIndex(b, at);
    if (b.length === 0 || k === b.length - 1) {
      live ??= loadRecipeGraph({ locationId: opts.locationId });
      return live;
    }
    let g = byInterval.get(k);
    // Any instant inside the interval resolves the same versions; the first date's asOf stands for all.
    if (!g) { g = loadRecipeGraph({ locationId: opts.locationId, asOf }); byInterval.set(k, g); }
    return g;
  };
}

/**
 * Per-item par BASIS: `oz_per_par_unit` (fan-out allocation weight) plus
 * `default_par_unit` (the label a recipe line may legitimately spell instead of
 * a measure — see itemRefParUnits' unknown-unit refusal). One query, both
 * fields; they come off the same row and are read by the same resolver.
 */
async function loadItemParBasis(
  itemIds: string[],
): Promise<Map<string, { ozPerParUnit: number | null; parUnitLabel: string | null }>> {
  if (itemIds.length === 0) return new Map();
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("items").select("id, oz_per_par_unit, default_par_unit").in("id", itemIds)
    .returns<Array<{ id: string; oz_per_par_unit: number | string | null; default_par_unit: string | null }>>();
  // A missing basis nulls the output's fan-out weight AND its par-unit label, which is how
  // a recipe line denominated in the item's own par unit becomes an unknown-unit refusal.
  if (error) throw new Error(`loadItemParBasis: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.id, {
    ozPerParUnit: num(r.oz_per_par_unit),
    parUnitLabel: r.default_par_unit,
  }]));
}

/**
 * Load the WHOLE recipe universe in a fixed number of queries (6), regardless of
 * how many items/menu_items are subsequently resolved (+1 when a product pin resolves
 * to a member SKU no recipe names directly — LRA-231). Replaces the former
 * per-recipe-node recursive loading (4+ queries per node — the N+1 the
 * 2026-07-23 council review flagged as a latent cliff for real catering volume).
 * The graph is small (dozens of recipes / a few hundred rows); resolution is
 * pure + in-memory via lib/prep-consumption-graph.ts. Loops (W4b sku-demand,
 * surplus, loadDerivedForItems) load ONE graph and resolve every line against it.
 *
 * PRODUCT PINS RESOLVE HERE, ONCE (0179). A recipe_inputs row may name a PRODUCT
 * instead of a vendor's SKU; lib/products.ts loadProductIndex runs the ONE ladder
 * (resolveProductMember) and builds each product's measure-only basis, and the graph
 * carries the ANSWER. Every downstream consumer keeps its SKU-keyed output and gains
 * failover for free — one seam, nine callers. The product reads are SKIPPED entirely
 * when no input names a product (`productIds.length === 0`), so the query count stays
 * at 6 for a system with no products and rises to 8-11 only where plurality exists.
 *
 * `opts.locationId` (deviation D7) scopes the resolution: the per-location primary
 * row, that location's activation overlay, and that location's receipt history.
 * Location-aware callers (toast-sales, sku-demand, surplus) pass theirs; costing,
 * catalog, toast-map, readiness and the scripts pass nothing and resolve against the
 * GLOBAL primary row — the honest org-level replacement cost the board prices at.
 *
 * `opts.versionLocationId` (catalog Phase 2a) chooses whose SHOP VERSIONS of pack chains the graph's
 * skuPack carries (default: `locationId`); `opts.asOf` chooses WHEN (default: now). Depletion for a
 * business date goes through createDatedGraphs, never through a bare live graph.
 *
 * RECIPES ARE VERSIONED TOO (catalog Phase 3a, 0262): the same `versionLocationId` chooses whose shop
 * recipe versions answer, and the same `asOf` chooses WHEN — loadRecipeLineOverlay is the one point
 * that decides; recipe_inputs answers wherever the live global head does. Query count stays FIXED:
 * +0 for the global live graph, +1–2 for a shop or a date, never per recipe.
 */
export async function loadRecipeGraph(opts?: {
  locationId?: string | null;
  versionLocationId?: string | null;
  asOf?: string | null;
  /** A preview's hypothetical lines (catalog Phase 3b): recipe → lines, winning over every version. */
  recipeOverrides?: ReadonlyMap<string, readonly RecipeVersionLineRow[]>;
}): Promise<RecipeGraph> {
  const locationId = opts?.locationId ?? null;
  // WHOSE SHOP VERSIONS, AND WHEN (catalog Phase 2a, 0259). `versionLocationId` defaults to the
  // product-resolution location, so every location-aware caller follows that shop's pack versions.
  // Capture paths pass ONLY versionLocationId: their ounces become the shop's while their product
  // resolution stays global exactly as today. `asOf` (D1) resolves the packs in force at an instant.
  const versionScope: VersionScope = opts?.versionLocationId !== undefined ? opts.versionLocationId : locationId;
  const asOf = opts?.asOf ?? null;
  const sb = getServiceRoleClient();
  const measures = await loadMeasures();
  const [{ data: recRows, error: recErr }, { data: inRows, error: inErr }, { data: outRows, error: outErr }] = await Promise.all([
    // ACTIVE ONLY (multi-vendor audit P5, second half — 2026-08-20). An inactive
    // recipe is a RETIRED one: `active = false` is how this codebase deactivates
    // config rows, and nothing else in the app treats a retired recipe as live
    // (lib/admin/readiness-load.ts has filtered on it since it shipped). Without
    // the filter, first-wins indexing plus created_at ordering handed the slot to
    // whichever producer was created FIRST — which is systematically the OLDER,
    // retired one. Live that was not hypothetical: the 2026-07-01 `Hot Peppers`
    // recipe (retired, Baldor, 512 oz) beat the active `Hot Peppers (portioned)`,
    // and the 2026-07-06 `AntiPasta2` (retired) beat `Antipasto Pasta
    // (approximate)`. A deactivated recipe was silently defining two items' costs
    // and depletion, and disagreeing with the readiness map about which recipe
    // even produces them.
    //
    // DETERMINISTIC ORDER still matters for the ACTIVE duplicates the filter
    // cannot resolve. buildRecipeGraph indexes producers FIRST-WINS per output, so
    // when two ACTIVE recipes produce the same item the winner is decided purely by
    // row order, and an unordered select gives no guarantee. Ordering makes that
    // repeatable, not correct — nothing here knows which producer is operationally
    // right, which is why duplicate ACTIVE producers now raise a readiness warning
    // (lib/readiness.ts, `duplicate_producers`). created_at is nullable, so `id`
    // (PK, never null) is the tiebreak that makes the order total rather than
    // merely mostly-stable.
    sb.from("recipes").select("id, batch_yield").eq("active", true)
      .order("created_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .returns<Array<{ id: string; batch_yield: number | string | null }>>(),
    sb.from("recipe_inputs").select("recipe_id, quantity, unit, component_sku_id, component_item_id, component_product_id")
      .returns<Array<{ recipe_id: string; quantity: number | string; unit: string | null; component_sku_id: string | null; component_item_id: string | null; component_product_id: string | null }>>(),
    sb.from("recipe_outputs").select("recipe_id, output_item_id, output_menu_item_id, yield")
      .returns<Array<{ recipe_id: string; output_item_id: string | null; output_menu_item_id: string | null; yield: number | string }>>(),
  ]);
  // FAIL LOUD, BEFORE ANY INDEXING. These three reads ARE the graph: a dropped recipes read
  // yields a graph with no producers ("nothing has a recipe"), a dropped inputs read yields
  // recipes that consume nothing (every cost 0, every depletion 0), and a dropped outputs
  // read yields recipes that produce nothing. All three are silent, all three are plausible,
  // and none of them is distinguishable downstream from a genuinely sparse catalog.
  for (const [label, err] of [
    ["recipes", recErr], ["recipe_inputs", inErr], ["recipe_outputs", outErr],
  ] as const) {
    if (err) throw new Error(`loadRecipeGraph ${label}: ${err.message}`);
  }
  // CATALOG PHASE 3a (0262): THE RECIPE LINES THIS SCOPE RESOLVES. A recipe whose answer is a shop
  // version (live, or in force at `asOf`) or an older global version gets THAT version's lines; every
  // other recipe keeps its recipe_inputs rows exactly as read above (the live global head IS
  // recipe_inputs). A preview's overrides win over both. Outputs and product resolution are untouched.
  const replacements = await loadRecipeLineOverlay(versionScope, asOf);
  for (const [recipeId, lines] of opts?.recipeOverrides ?? []) replacements.set(recipeId, [...lines]);
  const lineRows = [...(inRows ?? []), ...[...replacements.values()].flat()];
  const outputItemIds = [...new Set((outRows ?? []).filter((o) => o.output_item_id).map((o) => o.output_item_id!))];
  // Every SKU / product ANY resolved line names — the base rows first (so with no versions the order,
  // and the graph, are byte-identical), then a version's or a preview's additions.
  const skuIds = [...new Set(lineRows.filter((c) => c.component_sku_id).map((c) => c.component_sku_id!))];
  const productIds = [...new Set(lineRows.filter((c) => c.component_product_id).map((c) => c.component_product_id!))];
  const resolvedPacks = new Map<string, ResolvedPack>();
  const [parBasis, skuPack, productIndex] = await Promise.all([
    loadItemParBasis(outputItemIds),
    loadSkuPack(skuIds, versionScope, asOf, resolvedPacks),
    // Zero product-pinned rows → zero queries (loadProductIndex returns early).
    loadProductIndex(productIds, locationId),
  ]);
  // THE RESOLVED MEMBER IS A LEAF TOO (LRA-231, 2026-09-11). A product pin resolves to one
  // member SKU and the flatten emits THAT id as the leaf (productLineOz), but `skuIds` above
  // only names the SKUs recipes pin directly — so the member's pack never reached
  // `graph.skuPack`, and every consumer that prices a leaf off its pack (the menu costing
  // board's costPerOzFromGraph, computeSkuCostPerOz) saw a priced, packed Turkey as
  // "unpriced". Live: every deli sub on the board. One more query, only when a product
  // resolved to a member the recipes did not already name.
  const memberIds = [...new Set([...productIndex.index.resolution.values()]
    .map((r) => r.skuId)
    .filter((id): id is string => id != null && !skuPack.has(id)))];
  if (memberIds.length > 0) {
    for (const [id, pack] of await loadSkuPack(memberIds, versionScope, asOf, resolvedPacks)) skuPack.set(id, pack);
  }

  const inputsByRecipe = new Map<string, GraphRecipe["inputs"]>();
  for (const c of inRows ?? []) {
    if (replacements.has(c.recipe_id)) continue; // this scope answers with another version's lines (below)
    const list = inputsByRecipe.get(c.recipe_id) ?? [];
    list.push({ quantity: num(c.quantity) ?? 0, unit: c.unit, componentSkuId: c.component_sku_id, componentItemId: c.component_item_id, componentProductId: c.component_product_id });
    inputsByRecipe.set(c.recipe_id, list);
  }
  for (const [recipeId, lines] of replacements) {
    inputsByRecipe.set(recipeId, lines.map((c) => ({
      quantity: num(c.quantity) ?? 0, unit: c.unit, componentSkuId: c.component_sku_id,
      componentItemId: c.component_item_id, componentProductId: c.component_product_id,
    })));
  }
  const outputsByRecipe = new Map<string, GraphRecipe["outputs"]>();
  for (const o of outRows ?? []) {
    const list = outputsByRecipe.get(o.recipe_id) ?? [];
    const basis = o.output_item_id ? parBasis.get(o.output_item_id) : undefined;
    list.push({
      outputItemId: o.output_item_id, outputMenuItemId: o.output_menu_item_id,
      yield: num(o.yield) ?? 0,
      ozPerParUnit: basis?.ozPerParUnit ?? null,
      parUnitLabel: basis?.parUnitLabel ?? null,
    });
    outputsByRecipe.set(o.recipe_id, list);
  }
  const recipes: GraphRecipe[] = (recRows ?? []).map((r) => ({
    recipeId: r.id, batchYield: num(r.batch_yield),
    inputs: inputsByRecipe.get(r.id) ?? [], outputs: outputsByRecipe.get(r.id) ?? [],
  }));
  const graph = buildRecipeGraph(recipes, skuPack, measures, productIndex.index);
  GRAPH_PACKS.set(graph, resolvedPacks);
  return graph;
}

/** Per-one-unit leaf-SKU oz for an ITEM (one-shot; loops should loadRecipeGraph once and use the FromGraph variant). */
export async function perUnitSkuOzForItem(itemId: string, versionLocationId: VersionScope): Promise<Map<string, number>> {
  const graph = await loadRecipeGraph({ versionLocationId });
  return perUnitSkuOzForItemFromGraph(graph, itemId);
}

/**
 * Per-one-unit leaf-SKU oz for a MENU_ITEM (sub) — the sub-shop analog of perUnitSkuOzForItem.
 * One-shot wrapper; loops should loadRecipeGraph once and use the FromGraph variant.
 */
export async function perUnitSkuOzForMenuItem(menuItemId: string, versionLocationId: VersionScope): Promise<Map<string, number>> {
  const graph = await loadRecipeGraph({ versionLocationId });
  return perUnitSkuOzForMenuItemFromGraph(graph, menuItemId);
}

export async function skuConsumptionForItem(itemId: string, outputQty: number, versionLocationId: VersionScope): Promise<Map<string, number>> {
  if (!Number.isFinite(outputQty) || outputQty <= 0) return new Map();
  const perUnit = await perUnitSkuOzForItem(itemId, versionLocationId);
  const out = new Map<string, number>();
  for (const [sku, oz] of perUnit) out.set(sku, oz * outputQty);
  return out;
}

/** One leaf SKU's derived (per-one-output-unit) consumption, hydrated for the panel UI. */
export interface DerivedSku { skuId: string; skuName: string; perUnitOz: number; unitsPerPack: number | null; contentOz: number | null; }
/** A confirmed/edited consumption line coming back from the panel. */
export interface ConfirmedInput { skuId: string; qtyOz: number; qtyEntered: number | null; unitEntered: string | null; derivedOz: number | null; }
export interface RecordFromPrepInput {
  locationId: string; instanceId: string; templateItemId: string;
  outputItemId: string; outputQty: number;
  confirmedConsumption: ConfirmedInput[];
  source: "opening_p2" | "mid_day_p2";
}

/**
 * Per convertible item, the hydrated per-one-output-unit leaf-SKU consumption (for the
 * panel's live-scaled "Uses:" summary + editable rows). Items whose recipe is incomplete
 * (empty perUnitSkuOzForItem) map to [] = non-convertible (no panel). Batches the SKU
 * name/pack loads across all items.
 */
export async function loadDerivedForItems(itemIds: string[], versionLocationId: VersionScope): Promise<Map<string, DerivedSku[]>> {
  const out = new Map<string, DerivedSku[]>();
  const uniq = [...new Set(itemIds.filter(Boolean))];
  if (uniq.length === 0) return out;
  const sb = getServiceRoleClient();
  const graph = await loadRecipeGraph({ versionLocationId });
  const perItem = new Map<string, Map<string, number>>();
  const allSkuIds = new Set<string>();
  for (const id of uniq) {
    const m = perUnitSkuOzForItemFromGraph(graph, id);
    perItem.set(id, m);
    for (const sku of m.keys()) allSkuIds.add(sku);
  }
  const measures = graph.measures;
  const skuInfo = new Map<string, { name: string; unitsPerPack: number | null; contentOz: number | null }>();
  if (allSkuIds.size > 0) {
    const { data: skus } = await sb.from("vendor_items").select("id, name, units_per_pack, each_size, each_measure, avg_oz_per_each").in("id", [...allSkuIds])
      .returns<Array<{ id: string; name: string; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
    // The graph ALREADY resolved this shop's pack for every leaf (loadRecipeGraph's skuPack); a second
    // resolution would be a second read of the same answer (chunk-3 review P3b). Only a leaf the graph
    // has no pack for — never the case for a flattened leaf — falls back to the resolver.
    const resolved = resolvedPacksOf(graph);
    const missing = [...allSkuIds].filter((id) => !graph.skuPack.has(id));
    const fallback = missing.length > 0 ? await loadSkuPackResolution(missing, versionLocationId) : new Map<string, ResolvedPack>();
    for (const s of skus ?? []) {
      const pack = graph.skuPack.has(s.id) ? resolved.get(s.id) : fallback.get(s.id);
      const contentOz = skuContentOz({ unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each), packChain: pack && pack.levels.length > 0 ? pack.levels : null }, measures);
      skuInfo.set(s.id, { name: s.name, unitsPerPack: unitsPerPackForScope(s.units_per_pack, pack), contentOz });
    }
  }
  for (const id of uniq) {
    const m = perItem.get(id) ?? new Map();
    const list: DerivedSku[] = [];
    for (const [skuId, perUnitOz] of m) {
      const info = skuInfo.get(skuId);
      list.push({ skuId, skuName: info?.name ?? "(sku)", perUnitOz, unitsPerPack: info?.unitsPerPack ?? null, contentOz: info?.contentOz ?? null });
    }
    out.set(id, list);
  }
  return out;
}

/**
 * Record a prep conversion idempotently, keyed by (instanceId, templateItemId):
 * supersede any live production header for that key, then insert a fresh header +
 * one production_inputs line per confirmed SKU. Empty confirmedConsumption still
 * supersedes the prior (a corrected prep with no convertible inputs clears the old
 * depletion) and inserts nothing. Authorization is the CALLER's (the prep-save gate) —
 * this helper does NOT re-gate role.
 */
export async function recordProductionFromPrep(actor: { userId: string; role: RoleCode }, input: RecordFromPrepInput): Promise<{ productionId: string | null }> {
  const sb = getServiceRoleClient();
  // Check the supersede error: if it fails silently, the insert below lands a
  // SECOND live header for this key → double-counted depletion. (Backstopped at
  // the DB by the partial UNIQUE index productions_prep_live_idx, migration 0107,
  // which also makes a concurrent racing insert fail loudly rather than duplicate.)
  const { error: supErr } = await sb.from("productions").update({ superseded_at: new Date().toISOString() })
    .eq("instance_id", input.instanceId).eq("template_item_id", input.templateItemId)
    .is("superseded_at", null).is("revoked_at", null);
  if (supErr) throw new Error(`recordProductionFromPrep supersede: ${supErr.message}`);
  const positive = input.confirmedConsumption.filter((c) => Number.isFinite(c.qtyOz) && c.qtyOz > 0);
  if (positive.length === 0) return { productionId: null };
  const { data: hdr, error: hErr } = await sb.from("productions").insert({
    location_id: input.locationId, output_item_id: input.outputItemId, output_qty: input.outputQty,
    source: input.source, instance_id: input.instanceId, template_item_id: input.templateItemId, created_by: actor.userId,
  }).select("id").maybeSingle<{ id: string }>();
  if (hErr) throw new Error(`recordProductionFromPrep header: ${hErr.message}`);
  if (!hdr) throw new Error("recordProductionFromPrep header returned no row");
  const { error: lErr } = await sb.from("production_inputs").insert(positive.map((c) => ({
    production_id: hdr.id, input_sku_id: c.skuId, input_oz: c.qtyOz,
    qty_entered: c.qtyEntered, unit_entered: c.unitEntered, derived_oz: c.derivedOz,
  })));
  if (lErr) throw new Error(`recordProductionFromPrep lines: ${lErr.message}`);
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "production.recorded", resourceTable: "productions", resourceId: hdr.id, metadata: { source: input.source, instance_id: input.instanceId, template_item_id: input.templateItemId, output_item_id: input.outputItemId, output_qty: input.outputQty, sku_count: positive.length }, ipAddress: null, userAgent: null });
  return { productionId: hdr.id };
}

/** Reverse (revoke) the live production for a prep (instance, template_item). No-op if none live. */
export async function reverseProductionForPrep(actor: { userId: string; role: RoleCode }, args: { instanceId: string; templateItemId: string }): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: live } = await sb.from("productions").select("id").eq("instance_id", args.instanceId).eq("template_item_id", args.templateItemId).is("superseded_at", null).is("revoked_at", null).maybeSingle<{ id: string }>();
  if (!live) return;
  // Guard on revoked_at IS NULL (silent-UPDATE law): the row must still be live for THIS
  // call to be the one that revoked it. count 0 = a concurrent revoke won the race between
  // the read and the write — the row is already revoked AND already audited by that caller,
  // so returning without a second audit row is the idempotent outcome, not an error.
  const { error: rErr, count } = await sb.from("productions")
    .update({ revoked_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", live.id).is("revoked_at", null);
  if (rErr) throw new Error(`reverseProductionForPrep revoke: ${rErr.message}`);
  if (count === 0) return;
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "production.revoked", resourceTable: "productions", resourceId: live.id, metadata: { instance_id: args.instanceId, template_item_id: args.templateItemId }, ipAddress: null, userAgent: null });
}

// ─────────────────────────────────────────────────────────────────────────────
// 0215 batch vs bottle — the BATCH fold (plan S r4, rulings 3 / 5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per batch_mode item, the panel's rows as PER-BATCH quantities (`perUnitOz` holds the oz of
 * ONE whole batch here — the panel then scales by `batches`, not by bottles), plus the yield
 * the SAME graph carries for the item. Both come from one `loadRecipeGraph()` so the preview
 * and the fold cannot disagree about which recipe they are talking about. An item whose
 * recipe does not resolve is ABSENT from the map (the row BLOCKS; it never falls back to the
 * single-box engine).
 */
export interface BatchDerived { yieldPerBatch: number; singleOutput: boolean; skus: DerivedSku[] }

async function hydrateSkuInfo(
  graph: RecipeGraph,
  skuIds: string[],
  scope: VersionScope,
): Promise<Map<string, { name: string; unitsPerPack: number | null; contentOz: number | null }>> {
  const skuInfo = new Map<string, { name: string; unitsPerPack: number | null; contentOz: number | null }>();
  if (skuIds.length === 0) return skuInfo;
  const sb = getServiceRoleClient();
  const { data: skus, error } = await sb.from("vendor_items").select("id, name, units_per_pack, each_size, each_measure, avg_oz_per_each").in("id", skuIds)
    .returns<Array<{ id: string; name: string; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  if (error) throw new Error(`hydrateSkuInfo: ${error.message}`);
  const packs = await loadSkuPackResolution(skuIds, scope);
  for (const s of skus ?? []) {
    const pack = packs.get(s.id);
    const contentOz = skuContentOz({ unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each), packChain: pack && pack.levels.length > 0 ? pack.levels : null }, graph.measures);
    skuInfo.set(s.id, { name: s.name, unitsPerPack: unitsPerPackForScope(s.units_per_pack, pack), contentOz });
  }
  return skuInfo;
}

export async function loadBatchDerivedForItems(itemIds: string[], locationId: string): Promise<Map<string, BatchDerived>> {
  const out = new Map<string, BatchDerived>();
  const uniq = [...new Set(itemIds.filter(Boolean))];
  if (uniq.length === 0) return out;
  const graph = await loadRecipeGraph({ locationId });
  const perItem = new Map<string, { yieldPerBatch: number; singleOutput: boolean; map: Map<string, number> }>();
  const allSkuIds = new Set<string>();
  for (const id of uniq) {
    const yieldPerBatch = yieldForItemFromGraph(graph, id);
    const m = batchSkuOzForItemFromGraph(graph, id);
    if (yieldPerBatch == null || m == null) continue;
    perItem.set(id, { yieldPerBatch, singleOutput: isSingleItemOutputFromGraph(graph, id), map: m });
    for (const sku of m.keys()) allSkuIds.add(sku);
  }
  const skuInfo = await hydrateSkuInfo(graph, [...allSkuIds], locationId);
  for (const [id, d] of perItem) {
    const skus: DerivedSku[] = [];
    for (const [skuId, perBatchOz] of d.map) {
      const info = skuInfo.get(skuId);
      skus.push({ skuId, skuName: info?.name ?? "(sku)", perUnitOz: perBatchOz, unitsPerPack: info?.unitsPerPack ?? null, contentOz: info?.contentOz ?? null });
    }
    out.set(id, { yieldPerBatch: d.yieldPerBatch, singleOutput: d.singleOutput, skus });
  }
  return out;
}

export interface RecordBatchFromPrepInput {
  locationId: string; instanceId: string; templateItemId: string;
  outputItemId: string;
  /** Whole batches made this session (0 = no production; the prior header is superseded and nothing is inserted). */
  batches: number;
  /** Measured output in par units (Phase B's numerator). */
  cameOutTo: number;
  /** Confirmed/edited per-SKU consumption from the panel (per SESSION totals), or null = the derived default. */
  confirmedConsumption: ConfirmedInput[] | null;
  /** The session's first-save time — carried through every re-save (ruling E / Astra r2 #6). */
  producedAt: string;
  /** The MAKER (the session's first saver), not the editor (ruling 5). */
  madeBy: string;
  source: "opening_p2" | "mid_day_p2";
}

/**
 * The batch fold. ONE graph read: `yield` and the per-batch SKU map come from the same
 * `loadRecipeGraph()` call, so `output_qty = batches × yield` and the lines
 * `batches × batchSkuOz` describe the same recipe state (ruling 3 — never a separately read
 * yield multiplied into a division by another). Same supersede-then-insert seam as
 * recordProductionFromPrep (the 0107 unique live index is the backstop), same fail-open
 * posture at the call sites. LIMITATIONS, stated: the graph is still assembled from
 * separate queries; a failure after the header insert leaves a header without lines until
 * the next save heals it ("fold integrity check" is the filed follow-up).
 */
export async function recordBatchProductionFromPrep(
  actor: { userId: string; role: RoleCode },
  input: RecordBatchFromPrepInput,
): Promise<{ productionId: string | null; yieldAtTime: number | null }> {
  const sb = getServiceRoleClient();
  const graph = await loadRecipeGraph({ locationId: input.locationId });
  const yieldAtTime = yieldForItemFromGraph(graph, input.outputItemId);
  const perBatch = batchSkuOzForItemFromGraph(graph, input.outputItemId);
  if (yieldAtTime == null || perBatch == null || !isSingleItemOutputFromGraph(graph, input.outputItemId)) {
    throw new Error(`recordBatchProductionFromPrep: batch_recipe_unresolved for item ${input.outputItemId}`);
  }
  const { error: supErr } = await sb.from("productions").update({ superseded_at: new Date().toISOString() })
    .eq("instance_id", input.instanceId).eq("template_item_id", input.templateItemId)
    .is("superseded_at", null).is("revoked_at", null);
  if (supErr) throw new Error(`recordBatchProductionFromPrep supersede: ${supErr.message}`);
  if (!(input.batches > 0)) return { productionId: null, yieldAtTime };

  // Derived = batches × one batch, from THIS graph. A confirmed panel overrides qtyOz per SKU
  // (the prepper's actual-vs-theoretical, the fold's existing contract); derivedOz is always
  // this graph's number, and a SKU the recipe does not name is dropped and logged.
  const derived = new Map<string, number>();
  for (const [sku, oz] of perBatch) derived.set(sku, oz * input.batches);
  const lines: ConfirmedInput[] = [];
  if (input.confirmedConsumption === null) {
    for (const [skuId, oz] of derived) lines.push({ skuId, qtyOz: oz, qtyEntered: null, unitEntered: null, derivedOz: oz });
  } else {
    const seen = new Set<string>();
    for (const c of input.confirmedConsumption) {
      const d = derived.get(c.skuId);
      if (d === undefined) { console.warn(`recordBatchProductionFromPrep: confirmed SKU ${c.skuId} is not in the recipe; dropped`); continue; }
      seen.add(c.skuId);
      lines.push({ skuId: c.skuId, qtyOz: c.qtyOz, qtyEntered: c.qtyEntered, unitEntered: c.unitEntered, derivedOz: d });
    }
    for (const [skuId, oz] of derived) if (!seen.has(skuId)) lines.push({ skuId, qtyOz: oz, qtyEntered: null, unitEntered: null, derivedOz: oz });
  }
  const positive = lines.filter((c) => Number.isFinite(c.qtyOz) && c.qtyOz > 0);
  if (positive.length === 0) return { productionId: null, yieldAtTime };
  const outputQty = input.batches * yieldAtTime;
  const { data: hdr, error: hErr } = await sb.from("productions").insert({
    location_id: input.locationId, output_item_id: input.outputItemId, output_qty: outputQty,
    source: input.source, instance_id: input.instanceId, template_item_id: input.templateItemId, created_by: actor.userId,
    batches_made: input.batches, came_out_to: input.cameOutTo, yield_at_time: yieldAtTime,
    produced_at: input.producedAt, made_by: input.madeBy,
  }).select("id").maybeSingle<{ id: string }>();
  if (hErr) throw new Error(`recordBatchProductionFromPrep header: ${hErr.message}`);
  if (!hdr) throw new Error("recordBatchProductionFromPrep header returned no row");
  const { error: lErr } = await sb.from("production_inputs").insert(positive.map((c) => ({
    production_id: hdr.id, input_sku_id: c.skuId, input_oz: c.qtyOz,
    qty_entered: c.qtyEntered, unit_entered: c.unitEntered, derived_oz: c.derivedOz,
  })));
  if (lErr) throw new Error(`recordBatchProductionFromPrep lines: ${lErr.message}`);
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "production.recorded", resourceTable: "productions", resourceId: hdr.id, metadata: { source: input.source, instance_id: input.instanceId, template_item_id: input.templateItemId, output_item_id: input.outputItemId, output_qty: outputQty, batches_made: input.batches, came_out_to: input.cameOutTo, yield_at_time: yieldAtTime, made_by: input.madeBy, produced_at: input.producedAt, sku_count: positive.length }, ipAddress: null, userAgent: null });
  return { productionId: hdr.id, yieldAtTime };
}
