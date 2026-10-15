/**
 * The connected ITEM PAGE for a bought item — the server half (catalog Phase 2b; spec §4, §5).
 * SERVER-ONLY, service role. Reads go through the 2a resolvers ONLY (pack: loadSkuPackResolution;
 * price: loadCurrentSkuPriceHeads/Prices; costs and depletion: loadRecipeGraph per shop; par lanes:
 * loadPackAwareOverlay, D3-stamped) — this module never picks a version.
 *
 * WHO (2a law, applied here):
 *   · every read, preview and write is a CATALOG act: catalogWriteRoleAllowed — level 7+ any role,
 *     at level 6 only AGM / prep / catering; the social media manager is refused (a ROLE check);
 *   · a shop is the actor's (a membership) or any active shop at MoO+ (catalogShopAllowed, D2);
 *   · a SHOP-OWNED SKU (vendor_items.location_id) has no other shop: no other shop previews, sees
 *     or saves a version of it (sku_owned_by_other_shop), a global preview lists only the owner, and
 *     below MoO only the owner's people reach its global value (skuOwnerAllowed).
 * WRITES (lead decision D4): the pack save is ONE transaction (apply_sku_pack_change, 0261) — the
 * version, every accepted par conversion bound to the value the person was shown, and the door
 * report — after the 2a gate and the par permissions have passed, and only if the preview the person
 * saw (its token) is still exactly what the server computes for that target now.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { AdminSkuError, loadMeasureUnits } from "@/lib/admin/skus";
import { loadRecipeGraph, loadSkuPackResolution } from "@/lib/prep-consumption";
import { loadPackAwareOverlay, type OverlayRow } from "@/lib/ordering";
import { loadCurrentSkuPriceHeads, loadCurrentSkuPrices } from "@/lib/admin/cost";
import {
  loadSkuPackVersionHistory, preparePackVersionWrite, rpcLevels, saveSkuPrice, SkuVersionError, versionErrorFromRpc,
} from "@/lib/admin/sku-versions";
import { loadMeasureLabels, loadMeasuresMap, PackChainError, validateSubmission, type PackChainLevelInput } from "@/lib/admin/pack-chain";
import { loadOpenPackChangeRequests, PackChangeRequestError } from "@/lib/pack-change-requests";
import { costPerOzFromGraph, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { perUnitSkuOzForItemFromGraph, perUnitSkuOzForMenuItemFromGraph, type GraphRecipe, type RecipeGraph } from "@/lib/prep-consumption-graph";
import { orderUnitLabel, perOrderUnitOz } from "@/lib/order-unit-shared";
import { resolveParSlot } from "@/lib/location-sku-shared";
import { parWriteColumns } from "@/lib/dynamic-pars-shared";
import { skuDataReadiness } from "@/lib/sku-data-readiness";
import { etBusinessDate } from "@/lib/counts-shared";
import { skuContentOz, skuCostPerOz, type RecipeInputSku } from "@/lib/recipe-math";
import { buildPackChain, formatChainDescriptor, type PackChainLevel, type PackChainSkuClass } from "@/lib/pack-chain-shared";
import {
  conversionKey, previewPackChange, previewPriceChange, previewToken, shopPriceStanding,
  type PackPreview, type ParConversion, type PreviewMenuItem, type PreviewOpenOrder, type PreviewRecipeLine,
  type PreviewShopState, type PreviewTarget, type PricePreview,
} from "@/lib/catalog/change-preview-shared";
import {
  assertScopeToken, catalogShopAllowed, catalogWriteRoleAllowed, FIRST_GLOBAL_WRITE_MIN, GLOBAL_VERSION_WRITE_MIN,
  skuOwnerAllowed, versionWriteGate, type VersionKind, type VersionScope,
} from "@/lib/sku-versions-shared";
import { PRICE_BASES, type PriceBasis, type SkuItemView } from "@/lib/catalog/sku-item-shared";

export class CatalogItemError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "CatalogItemError";
  }
}

/** The par floor (AGENTS.md Dynamic pars: level 7 is what "GM" means here). */
const PAR_WRITE_MIN = 7;
/** What the vendor's price is FOR: SKU identity, GM sets it first, MoO+ changes it. */
const BASIS_WRITE_MIN = 7;
const RECEIVABLE_PO = ["draft", "confirmed", "placed", "invoiced"];
const PRICE_HISTORY_ROWS = 12;

type Sb = ReturnType<typeof getServiceRoleClient>;
type Shop = { id: string; name: string };
type SkuRow = {
  id: string; name: string; item_number: string | null; vendor_id: string | null; product_id: string | null;
  location_id: string | null; active: boolean; sku_class: string | null; price_basis: string | null;
  avg_oz_per_each: number | string | null; pack_format: string | null; each_container_label: string | null;
  units_per_pack: number | null; each_size: number | string | null; each_measure: string | null;
  weekday_par: number | string | null; weekend_par: number | string | null; par_step: number | string | null;
  weight_class: string | null;
};
const SKU_COLUMNS =
  "id, name, item_number, vendor_id, product_id, location_id, active, sku_class, price_basis, avg_oz_per_each, pack_format, each_container_label, units_per_pack, each_size, each_measure, weekday_par, weekend_par, par_step, weight_class";

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function rethrow(e: unknown): never {
  if (e instanceof SkuVersionError || e instanceof PackChainError || e instanceof AdminSkuError || e instanceof PackChangeRequestError) {
    throw new CatalogItemError(e.status, e.code, e.message);
  }
  throw e;
}

const scopeOf = (t: PreviewTarget): VersionScope => (t.kind === "global" ? null : t.shopId);

/**
 * Reads (the page and every preview): a catalog role (the social media manager is refused — a ROLE
 * check), and a shop the actor may act in (a membership, or MoO+ for any shop — D2). Pure, before I/O.
 */
function requireRead(actor: AuthContext, scope: VersionScope): void {
  if (!catalogWriteRoleAllowed(actor.role, actor.level)) throw new CatalogItemError(403, "forbidden");
  if (scope !== null && !catalogShopAllowed(actor, scope)) throw new CatalogItemError(404, "not_found");
}

/**
 * THE BIND for a version write (a BIND_PRIMITIVES name): 2a's versionWriteGate with the actor's ROLE,
 * level and shop allowance — pure, before any I/O. preparePackVersionWrite repeats it.
 */
function requireLocation(actor: AuthContext, kind: VersionKind, scope: VersionScope): { firstOnly: boolean } {
  const gate = versionWriteGate({ kind, role: actor.role, level: actor.level, scope, scopeAllowed: scope !== null && catalogShopAllowed(actor, scope) });
  if (!gate.ok) throw new CatalogItemError(gate.status, gate.code);
  return { firstOnly: gate.firstOnly };
}

/** 0259's owner rule: a shop-owned SKU has no other shop (the writers refuse it by this name too). */
function requireOwnerScope(row: SkuRow, scope: VersionScope): void {
  if (scope !== null && row.location_id !== null && row.location_id !== scope) throw new CatalogItemError(409, "sku_owned_by_other_shop");
}

/** Does a GLOBAL value exist yet — the first-value rule's question (the writers decide it again under the SKU lock). */
export async function globalValueExists(sb: Sb, skuId: string, kind: VersionKind): Promise<boolean> {
  const exists = kind === "pack"
    ? await sb.from("sku_pack_versions").select("id", { count: "exact", head: true }).eq("sku_id", skuId).is("location_id", null).eq("active", true)
    : await sb.from("vendor_price_history").select("id", { count: "exact", head: true }).eq("vendor_item_id", skuId).is("location_id", null);
  if (exists.error) throw new Error(`sku-item global gate: ${exists.error.message}`);
  return (exists.count ?? 0) > 0;
}

/**
 * A GLOBAL-target preview shows every shop's numbers for a save only MoO+ (or, for a SKU with no
 * global value yet, the first-value floor) can make — and below MoO only the owning shop's people
 * for a shop-owned SKU. Refused before any read where the level alone decides.
 */
async function requireGlobalTarget(actor: AuthContext, sb: Sb, row: SkuRow, kind: VersionKind): Promise<void> {
  if (actor.level >= GLOBAL_VERSION_WRITE_MIN) return;
  if (actor.level < FIRST_GLOBAL_WRITE_MIN[kind]) throw new CatalogItemError(403, "global_requires_moo");
  if (!skuOwnerAllowed(actor, row.location_id)) throw new CatalogItemError(404, "not_found");
  if (await globalValueExists(sb, row.id, kind)) throw new CatalogItemError(403, "global_requires_moo");
}

function basePackOf(row: SkuRow, levels: PackChainLevel[]): RecipeInputSku {
  return {
    packFormat: row.pack_format, eachContainerLabel: row.each_container_label,
    unitsPerPack: row.units_per_pack, eachSize: num(row.each_size), eachMeasure: row.each_measure,
    avgOzPerEach: num(row.avg_oz_per_each), packChain: levels.length > 0 ? levels : null,
  };
}

/** The writer's index-linked levels as chain levels with synthetic ids (for the hypothetical graph). */
function toChainLevels(levels: readonly PackChainLevelInput[]): PackChainLevel[] {
  return levels.map((l, i) => ({
    id: `new-${i}`, label: l.label.trim(), containsQty: l.containsQty,
    containsLevelId: l.containsIndex != null ? `new-${l.containsIndex}` : null,
    containsMeasureUnit: l.containsIndex != null ? null : (l.containsMeasureUnit ?? "").trim(),
    displayOrdinal: i,
  }));
}

function skuClassOf(v: string | null): PackChainSkuClass {
  return v === "packaging" || v === "cleaning" || v === "misc" ? v : "raw";
}

async function loadSkuRow(sb: Sb, skuId: string): Promise<SkuRow> {
  const { data: row, error } = await sb.from("vendor_items").select(SKU_COLUMNS).eq("id", skuId).maybeSingle<SkuRow>();
  if (error) throw new Error(`sku-item sku: ${error.message}`);
  if (!row) throw new CatalogItemError(404, "sku_not_found");
  return row;
}

async function loadActiveShops(sb: Sb): Promise<Shop[]> {
  const { data, error } = await sb.from("locations").select("id, name").eq("active", true).order("name").order("id").returns<Shop[]>();
  if (error) throw new Error(`sku-item shops: ${error.message}`);
  return data ?? [];
}

async function loadShop(sb: Sb, shopId: string): Promise<Shop> {
  const { data, error } = await sb.from("locations").select("id, name").eq("id", shopId).eq("active", true).maybeSingle<Shop>();
  if (error) throw new Error(`sku-item shop: ${error.message}`);
  if (!data) throw new CatalogItemError(404, "not_found");
  return data;
}

/** The shops a SKU can vary in: every active shop, or ONLY the owner for a shop-owned SKU. */
const reachableShops = (row: SkuRow, shops: readonly Shop[]): Shop[] =>
  row.location_id === null ? [...shops] : shops.filter((s) => s.id === row.location_id);

async function loadMenuItems(sb: Sb): Promise<PreviewMenuItem[]> {
  const { data, error } = await sb.from("menu_items").select("id, name, name_es").eq("active", true).order("name").order("id")
    .returns<Array<{ id: string; name: string; name_es: string | null }>>();
  if (error) throw new Error(`sku-item menu items: ${error.message}`);
  return (data ?? []).map((m) => ({ id: m.id, name: m.name, nameEs: m.name_es }));
}

async function loadDirectRecipeLines(sb: Sb, skuId: string): Promise<PreviewRecipeLine[]> {
  const { data: lines, error } = await sb.from("recipe_inputs").select("recipe_id, quantity, unit").eq("component_sku_id", skuId)
    .returns<Array<{ recipe_id: string; quantity: number | string; unit: string | null }>>();
  if (error) throw new Error(`sku-item recipe lines: ${error.message}`);
  const ids = [...new Set((lines ?? []).map((l) => l.recipe_id))];
  if (ids.length === 0) return [];
  const { data: recipes, error: rErr } = await sb.from("recipes").select("id, name").in("id", ids).eq("active", true)
    .returns<Array<{ id: string; name: string }>>();
  if (rErr) throw new Error(`sku-item recipes: ${rErr.message}`);
  const name = new Map((recipes ?? []).map((r) => [r.id, r.name]));
  return (lines ?? []).filter((l) => name.has(l.recipe_id))
    .map((l) => ({ recipeId: l.recipe_id, recipeName: name.get(l.recipe_id)!, quantity: num(l.quantity) ?? 0, unit: l.unit }));
}

/**
 * Orders not received yet for this SKU at this shop. The parent relation filters BEFORE the page
 * (status + shop on purchase_orders, one FK — an unambiguous service-role embed), and the result is
 * paged by a real column, so a long PO history can never push an open order off the first page.
 */
async function loadOpenOrders(sb: Sb, skuId: string, shop: Shop): Promise<PreviewOpenOrder[]> {
  type Row = { po_id: string; order_qty: number | string; order_unit_label: string | null; purchase_orders: { display_code: string; status: string } };
  const rows = await selectAllRows<Row>(async (from, to) => {
    const { data, error } = await sb.from("po_lines")
      .select("id, po_id, order_qty, order_unit_label, purchase_orders!inner(display_code, status, location_id)")
      .eq("sku_id", skuId).eq("purchase_orders.location_id", shop.id).in("purchase_orders.status", RECEIVABLE_PO)
      .order("id", { ascending: true }).range(from, to).returns<Row[]>();
    if (error) throw new Error(`sku-item open orders: ${error.message}`);
    return { data };
  });
  return rows.map((r) => ({
    poId: r.po_id, displayCode: r.purchase_orders.display_code, status: r.purchase_orders.status,
    orderQty: num(r.order_qty) ?? 0, orderUnitLabel: r.order_unit_label, shopId: shop.id, shopName: shop.name,
  }));
}

/** The shop a door report was filed for (null = no such report). */
export async function requestShop(sb: Sb, requestId: string): Promise<string | null> {
  const { data, error } = await sb.from("sku_pack_change_requests").select("id, location_id").eq("id", requestId)
    .maybeSingle<{ id: string; location_id: string }>();
  if (error) throw new Error(`sku-item request: ${error.message}`);
  return data?.location_id ?? null;
}

/** The newest price rows a scope sees (global ∪ that shop), newest first by real columns. */
export async function loadSkuPriceHistory(sb: Sb, skuId: string, scope: VersionScope): Promise<Array<{ id: string; unitPrice: number; effectiveDate: string; shop: boolean }>> {
  const base = sb.from("vendor_price_history").select("id, unit_price, effective_date, recorded_at, location_id").eq("vendor_item_id", skuId);
  const scoped = scope === null ? base.is("location_id", null) : base.or(`location_id.is.null,location_id.eq.${assertScopeToken(scope)}`);
  const { data, error } = await scoped.order("effective_date", { ascending: false }).order("recorded_at", { ascending: false })
    .order("id", { ascending: false }).limit(PRICE_HISTORY_ROWS)
    .returns<Array<{ id: string; unit_price: number | string; effective_date: string; location_id: string | null }>>();
  if (error) throw new Error(`sku-item prices: ${error.message}`);
  return (data ?? []).map((p) => ({ id: p.id, unitPrice: num(p.unit_price) ?? 0, effectiveDate: p.effective_date, shop: p.location_id != null }));
}

function slotsFrom(overlay: OverlayRow | null, row: SkuRow): PreviewShopState["slots"] {
  const global = { weekdayPar: num(row.weekday_par), weekendPar: num(row.weekend_par) };
  return (["weekday", "weekend"] as const).map((slot) => {
    const r = resolveParSlot(overlay, global, slot);
    return { slot, value: r.value, lane: r.lane };
  });
}

/** One shop as it stands today for this SKU — every number through the 2a resolvers, par lanes D3-stamped. */
async function loadShopState(sb: Sb, row: SkuRow, shop: Shop): Promise<PreviewShopState> {
  const [graph, packAware, heads, globalHeads, openOrders] = await Promise.all([
    loadRecipeGraph({ locationId: shop.id }),
    loadPackAwareOverlay(sb, shop.id, [row.id]),
    loadCurrentSkuPriceHeads([row.id], shop.id),
    loadCurrentSkuPriceHeads([row.id], null),
    loadOpenOrders(sb, row.id, shop),
  ]);
  const pack = packAware.packResolution.get(row.id) ?? null;
  const prices = await loadCurrentSkuPrices([...new Set([...graph.skuPack.keys(), row.id])], shop.id);
  const overlay = packAware.overlayBySku.get(row.id) ?? null;
  // The heads the real selection rule compares a new row against (Astra 2b r3#2); a shop has its
  // own price only when its live lane answered with a row of its own (shopPriceStanding).
  const standing = shopPriceStanding(heads.get(row.id) ?? null, globalHeads.get(row.id) ?? null);
  return {
    shopId: shop.id, shopName: shop.name,
    basePack: basePackOf(row, pack?.levels ?? []),
    ownPackVersion: pack?.locationId === shop.id,
    ...standing,
    graph, prices, slots: slotsFrom(overlay, row), openOrders,
  };
}

function uniqueRecipes(graph: RecipeGraph): GraphRecipe[] {
  return [...new Set([...graph.byOutputItem.values(), ...graph.byOutputMenuItem.values()])];
}

function pinsSku(graph: RecipeGraph, r: GraphRecipe, skuId: string): boolean {
  return r.inputs.some((i) => i.componentSkuId === skuId
    || (i.componentProductId != null && graph.products.resolution.get(i.componentProductId)?.skuId === skuId));
}

// ── The page ────────────────────────────────────────────────────────────────

/**
 * The item page at `scope` (null = the global default). `shops` = the shops the page lets this actor
 * switch between; a shop-owned SKU lists only its owner.
 */
export async function loadSkuItemView(
  actor: AuthContext,
  skuId: string,
  scope: VersionScope,
  shops: Shop[],
): Promise<SkuItemView> {
  requireRead(actor, scope);
  const sb = getServiceRoleClient();
  const row = await loadSkuRow(sb, skuId);
  requireOwnerScope(row, scope);
  // Chunk-2 review P2-2: at GLOBAL scope (?location=global, or no shop the actor may see), below MoO
  // a shop-owned SKU is read only by its owner's people — a GM of shop A never reads shop B's item.
  if (scope === null && !skuOwnerAllowed(actor, row.location_id)) throw new CatalogItemError(404, "not_found");
  const [packs, globalPacks, graph, heads, globalHeads, packAware, menuItems, measureUnits, historyRows, requests, priceHistory] = await Promise.all([
    loadSkuPackResolution([skuId], scope),
    loadSkuPackResolution([skuId], null),
    loadRecipeGraph(scope === null ? undefined : { locationId: scope }),
    loadCurrentSkuPriceHeads([skuId], scope),
    loadCurrentSkuPriceHeads([skuId], null),
    scope === null ? Promise.resolve(null) : loadPackAwareOverlay(sb, scope, [skuId]),
    loadMenuItems(sb),
    loadMeasureUnits(actor).catch(rethrow),
    loadSkuPackVersionHistory(actor, skuId, scope).catch(rethrow),
    scope !== null ? loadOpenPackChangeRequests(actor, { locationIds: [scope], skuId }).catch(rethrow) : Promise.resolve([]),
    loadSkuPriceHistory(sb, skuId, scope),
  ]);
  const pack = packs.get(skuId) ?? null;
  const levels = pack?.levels ?? [];
  const basePack = basePackOf(row, levels);
  const prices = await loadCurrentSkuPrices([...new Set([...graph.skuPack.keys(), skuId])], scope);
  const measures = graph.measures;
  const usingRecipes = uniqueRecipes(graph).filter((r) => pinsSku(graph, r, skuId));
  const overlay = packAware?.overlayBySku.get(skuId) ?? null;

  const vendorRes = row.vendor_id
    ? await sb.from("vendors").select("id, name, active, order_days").eq("id", row.vendor_id)
        .maybeSingle<{ id: string; name: string; active: boolean; order_days: number[] | null }>()
    : { data: null, error: null };
  if (vendorRes.error) throw new Error(`sku-item vendor: ${vendorRes.error.message}`);
  const recipeRes = usingRecipes.length
    ? await sb.from("recipes").select("id, name").in("id", usingRecipes.map((r) => r.recipeId)).returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  if (recipeRes.error) throw new Error(`sku-item recipes: ${recipeRes.error.message}`);
  const rhythmRes = scope !== null && row.vendor_id
    ? await sb.from("vendor_delivery_rhythm").select("order_dow").eq("vendor_id", row.vendor_id).eq("location_id", scope).eq("active", true)
        .returns<Array<{ order_dow: number }>>()
    : { data: [] as Array<{ order_dow: number }>, error: null };
  if (rhythmRes.error) throw new Error(`sku-item rhythm: ${rhythmRes.error.message}`);
  const cutoffRes = row.vendor_id
    ? await sb.from("vendor_cutoffs").select("id, location_id").eq("vendor_id", row.vendor_id).eq("active", true)
        .returns<Array<{ id: string; location_id: string | null }>>()
    : { data: [] as Array<{ id: string; location_id: string | null }>, error: null };
  if (cutoffRes.error) throw new Error(`sku-item cutoffs: ${cutoffRes.error.message}`);
  const barcodeRes = await sb.from("sku_barcodes").select("code, level, taught_at").eq("sku_id", skuId).is("forgotten_at", null)
    .order("taught_at", { ascending: false }).order("code", { ascending: true })
    .returns<Array<{ code: string; level: "case" | "inner"; taught_at: string }>>();
  if (barcodeRes.error) throw new Error(`sku-item barcodes: ${barcodeRes.error.message}`);

  // Sourcing per shop: the member this shop buys (its own primary, else the global one).
  let product: SkuItemView["product"] = null;
  if (row.product_id) {
    const [{ data: prod, error: pErr }, { data: prims, error: prErr }] = await Promise.all([
      sb.from("products").select("id, name").eq("id", row.product_id).maybeSingle<{ id: string; name: string }>(),
      sb.from("product_primaries").select("location_id, primary_sku_id").eq("product_id", row.product_id)
        .returns<Array<{ location_id: string | null; primary_sku_id: string }>>(),
    ]);
    if (pErr) throw new Error(`sku-item product: ${pErr.message}`);
    if (prErr) throw new Error(`sku-item primaries: ${prErr.message}`);
    const primary = (prims ?? []).find((p) => p.location_id === scope) ?? (prims ?? []).find((p) => p.location_id === null) ?? null;
    let primarySkuName: string | null = null;
    if (primary && primary.primary_sku_id !== skuId) {
      const { data: ps, error: psErr } = await sb.from("vendor_items").select("name").eq("id", primary.primary_sku_id).maybeSingle<{ name: string }>();
      if (psErr) throw new Error(`sku-item primary name: ${psErr.message}`);
      primarySkuName = ps?.name ?? null;
    }
    if (prod) product = { id: prod.id, name: prod.name, primarySkuId: primary?.primary_sku_id ?? null, primarySkuName };
  }

  // Connections: recipes that pin it, and the sandwiches it reaches — costed at this scope.
  const costPerOz = costPerOzFromGraph(graph, prices);
  const reaching = menuItems.filter((m) => perUnitSkuOzForMenuItemFromGraph(graph, m.id).has(skuId));
  const recipeNames = new Map((recipeRes.data ?? []).map((r) => [r.id, r.name]));
  const unresolvedRecipes = usingRecipes.filter((r) => r.outputs.every((o) =>
    (o.outputItemId != null ? perUnitSkuOzForItemFromGraph(graph, o.outputItemId) : perUnitSkuOzForMenuItemFromGraph(graph, o.outputMenuItemId ?? "")).size === 0))
    .map((r) => recipeNames.get(r.recipeId) ?? r.recipeId);

  // What's missing — the readiness errands for THIS scope's pack, price and par (lanes D3-stamped).
  const slots = slotsFrom(overlay, row);
  const today = etBusinessDate(new Date().toISOString());
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekend = day === 5 || day === 6 || day === 0;
  const weekendPar = slots.find((s) => s.slot === "weekend")?.value ?? null;
  const par = weekend && weekendPar != null ? weekendPar : (slots.find((s) => s.slot === "weekday")?.value ?? null);
  const head = heads.get(skuId) ?? null;
  const cutoffs = (cutoffRes.data ?? []).filter((c) => scope === null || c.location_id === null || c.location_id === scope);
  const rhythmPresent = cutoffs.length > 0 && (scope === null || (rhythmRes.data ?? []).length > 0);
  const missing = skuDataReadiness({
    sku: { ...basePack, skuClass: row.sku_class ?? "raw", weightClass: row.weight_class },
    headPrice: head ? { value: head.value, effectiveDate: head.effectiveDate } : null,
    par, rhythmPresent, vendorActive: vendorRes.data?.active === true,
    unresolvedRecipes, asOf: today, measures,
  }).errands;

  const whoIds = [...new Set(historyRows.map((h) => h.createdBy).filter((v): v is string => v != null))];
  const whoRes = whoIds.length
    ? await sb.from("users").select("id, name").in("id", whoIds).returns<Array<{ id: string; name: string | null }>>()
    : { data: [] as Array<{ id: string; name: string | null }>, error: null };
  if (whoRes.error) throw new Error(`sku-item history names: ${whoRes.error.message}`);
  const who = new Map((whoRes.data ?? []).map((u) => [u.id, u.name]));

  const chainOrNull = levels.length > 0 ? levels : null;
  const orderDays = scope === null
    ? [...new Set(vendorRes.data?.order_days ?? [])].sort((a, b) => a - b)
    : [...new Set((rhythmRes.data ?? []).map((r) => r.order_dow))].sort((a, b) => a - b);
  const visibleShops = reachableShops(row, shops);
  const shopGate = scope === null ? null : versionWriteGate({ kind: "pack", role: actor.role, level: actor.level, scope, scopeAllowed: catalogShopAllowed(actor, scope) });

  return {
    sku: {
      id: row.id, name: row.name, itemNumber: row.item_number, active: row.active, skuClass: row.sku_class ?? "raw",
      priceBasis: (PRICE_BASES as readonly string[]).includes(row.price_basis ?? "") ? (row.price_basis as PriceBasis) : null,
      avgOzPerEach: num(row.avg_oz_per_each), packFormat: row.pack_format,
    },
    vendor: vendorRes.data ? { id: vendorRes.data.id, name: vendorRes.data.name, active: vendorRes.data.active } : null,
    product,
    shops: visibleShops,
    scope,
    scopeName: scope === null ? null : (visibleShops.find((s) => s.id === scope)?.name ?? null),
    can: {
      // The SAME gates the writers bind with (2a's versionWriteGate with the ROLE; D2's allowance; the
      // owner rule) — the page never offers a save its writer would refuse.
      editShop: shopGate?.ok === true,
      editGlobal: catalogWriteRoleAllowed(actor.role, actor.level) && actor.level >= GLOBAL_VERSION_WRITE_MIN,
      editPar: actor.level >= PAR_WRITE_MIN,
      editBasis: actor.level >= GLOBAL_VERSION_WRITE_MIN || (actor.level >= BASIS_WRITE_MIN && row.price_basis == null && skuOwnerAllowed(actor, row.location_id)),
    },
    pack: {
      levels, versionId: pack?.versionId ?? null, isShopVersion: pack?.locationId != null, effectiveFrom: pack?.effectiveFrom ?? null,
      globalVersionId: globalPacks.get(skuId)?.versionId ?? null,
      orderUnit: orderUnitLabel(row.pack_format, chainOrNull),
      orderUnitOz: perOrderUnitOz(basePack, chainOrNull, measures),
      descriptor: chainOrNull ? formatChainDescriptor(buildPackChain(levels)) : null,
    },
    price: {
      value: head?.value ?? null, effectiveDate: head?.effectiveDate ?? null, isShopLane: head?.laneId != null,
      globalValue: globalHeads.get(skuId)?.value ?? null,
      costPerOz: skuCostPerOz(head?.value ?? null, skuContentOz(basePack, measures)),
      history: priceHistory,
    },
    ordering: { slots: [...slots], orderDays, offHere: overlay?.activeOverride === false },
    counting: { unit: orderUnitLabel(row.pack_format, chainOrNull) },
    barcodes: (barcodeRes.data ?? []).map((b) => ({ code: b.code, level: b.level, taughtAt: b.taught_at })),
    connections: {
      uses: usingRecipes.map((r) => ({ id: r.recipeId, name: recipeNames.get(r.recipeId) ?? r.recipeId })),
      menuItems: reaching.map((m) => ({ id: m.id, name: m.name, nameEs: m.nameEs, cost: rollupMenuItemCost(graph, m.id, costPerOz).cost })),
    },
    missing,
    history: historyRows.map((h) => ({
      id: h.id, scope: h.locationId === null ? "global" : "shop", active: h.active, effectiveFrom: h.validFrom,
      retiredAt: h.validTo, who: h.createdBy ? (who.get(h.createdBy) ?? null) : null, labels: h.labels,
    })),
    openRequests: requests.map((r) => ({ id: r.id, filedBy: r.filedBy, filedAt: r.filedAt, note: r.note, proposal: r.proposal })),
    measures: measureUnits.map((m) => ({ label: m.label, dimension: m.dimension, toBaseFactor: m.toBaseFactor })),
  };
}

// ── The previews ────────────────────────────────────────────────────────────

/**
 * "What this changes" for a proposed pack, for THE SAVE TARGET (D4): a shop → that shop; global →
 * every shop that can carry the SKU is loaded so the preview knows who rides the global pack and who
 * keeps its own. Validated exactly as the writer will. The token binds what was shown.
 */
export async function computePackPreview(actor: AuthContext, skuId: string, target: PreviewTarget, levels: PackChainLevelInput[]): Promise<PackPreview> {
  const scope = scopeOf(target);
  requireRead(actor, scope);
  if (target.kind === "global" && actor.level < FIRST_GLOBAL_WRITE_MIN.pack) throw new CatalogItemError(403, "global_requires_moo");
  if (levels.length === 0) throw new CatalogItemError(400, "empty_chain");
  const sb = getServiceRoleClient();
  const row = await loadSkuRow(sb, skuId);
  requireOwnerScope(row, scope);
  if (target.kind === "global") await requireGlobalTarget(actor, sb, row, "pack");
  const [labels, measures] = await Promise.all([loadMeasureLabels(), loadMeasuresMap()]);
  let validated: PackChainLevelInput[] = [];
  try { validated = validateSubmission(levels, labels, measures, num(row.avg_oz_per_each), skuClassOf(row.sku_class)); } catch (e) { rethrow(e); }
  // The snapshot covers what the save reaches: the shop, or EVERY active shop (0261 refuses a global
  // save whose snapshot misses one). The preview lists only the shops that can carry the SKU.
  const snapshotShops = target.kind === "shop" ? [await loadShop(sb, target.shopId)] : await loadActiveShops(sb);
  const shops = reachableShops(row, snapshotShops);
  // THE DEPENDENCY SNAPSHOT FIRST (2b r2#2): anything that moves after it — while the preview is being
  // computed, or before the save — makes the apply's re-take differ, and the save is refused.
  const { data: snapshot, error: snapErr } = await sb.rpc("sku_pack_change_snapshot", { p_sku: skuId, p_shops: snapshotShops.map((s) => s.id) });
  if (snapErr) throw new Error(`sku-item snapshot: ${snapErr.message}`);
  const [states, menuItems, recipeLines, targetPacks] = await Promise.all([
    Promise.all(shops.map((s) => loadShopState(sb, row, s))),
    loadMenuItems(sb),
    loadDirectRecipeLines(sb, skuId),
    loadSkuPackResolution([skuId], scope),
  ]);
  const tp = targetPacks.get(skuId) ?? null;
  // expected_live is the TARGET scope's OWN live version (a shop riding the global one has none);
  // a shop's first own version is based on the global version it replaces.
  const liveVersionId = tp != null && tp.locationId === scope ? tp.versionId : null;
  const basedOnVersionId = scope !== null && tp != null && tp.locationId === null ? tp.versionId : null;
  const body = previewPackChange({
    skuId, target, targetBasePack: basePackOf(row, tp?.levels ?? []), newChain: toChainLevels(validated),
    shops: states, globalPars: { weekday: num(row.weekday_par), weekend: num(row.weekend_par) },
    parStep: num(row.par_step), menuItems, recipeLines, liveVersionId, basedOnVersionId,
  });
  return {
    ...body, snapshot,
    token: previewToken({ kind: "pack", target, liveVersionId, basedOnVersionId, levels: rpcLevels(validated), conversions: body.conversions, snapshot }),
  };
}

/** "What this changes" for a new price, for THE SAVE TARGET (a shop → its lane; global → every shop without one). */
export async function computePricePreview(actor: AuthContext, skuId: string, target: PreviewTarget, newPrice: number, effectiveDate: string): Promise<PricePreview> {
  const scope = scopeOf(target);
  requireRead(actor, scope);
  if (target.kind === "global" && actor.level < FIRST_GLOBAL_WRITE_MIN.price) throw new CatalogItemError(403, "global_requires_moo");
  if (!Number.isFinite(newPrice) || newPrice <= 0) throw new CatalogItemError(400, "invalid_price");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(Date.parse(effectiveDate))) throw new CatalogItemError(400, "invalid_date");
  const sb = getServiceRoleClient();
  const row = await loadSkuRow(sb, skuId);
  requireOwnerScope(row, scope);
  if (target.kind === "global") await requireGlobalTarget(actor, sb, row, "price");
  const shops = reachableShops(row, target.kind === "shop" ? [await loadShop(sb, target.shopId)] : await loadActiveShops(sb));
  const [states, menuItems] = await Promise.all([Promise.all(shops.map((s) => loadShopState(sb, row, s))), loadMenuItems(sb)]);
  const body = previewPriceChange({ skuId, target, shops: states, newPrice, effectiveDate, menuItems });
  return {
    ...body,
    // The effective date is bound into the token: a save with any other date is a different change.
    token: previewToken({
      kind: "price", target, newPrice, effectiveDate,
      before: body.shops.map((s) => [s.shopId, s.price.before, s.becomesCurrent]), unaffected: body.unaffected.map((u) => u.shopId),
    }),
  };
}

// ── Apply ───────────────────────────────────────────────────────────────────

export interface ApplyPackChangeInput {
  skuId: string;
  target: PreviewTarget;
  levels: PackChainLevelInput[];
  /** The conversions the person accepted — each EXACTLY as the preview offered it (expected included). */
  conversions: ParConversion[];
  /** The door report this answers, if the job came from one. */
  requestId: string | null;
  /** The token of the preview the person saw — for THIS target. */
  previewToken: string;
}

/**
 * Save "It arrives differently now": the gates (2a's version gate with the ROLE; the par
 * permissions) before any I/O, then the door report's shop bound, then the preview recomputed for the
 * posted target (stale → 409), then ONE transaction (apply_sku_pack_change): the version, every
 * accepted conversion bound to its expected value, and the door report. Nothing half-applies.
 */
export async function applyPackChange(
  actor: AuthContext,
  input: ApplyPackChangeInput,
): Promise<{ versionId: string; retiredVersionId: string | null; parsConverted: number; requestApplied: boolean }> {
  const scope = scopeOf(input.target);
  // 1) THE BIND: 2a's version gate (role + shop), pure, before any I/O.
  requireLocation(actor, "pack", scope);
  // 2) Who may convert which par: GM+ (the par floor), and each converted SHOP par only where the
  //    actor may act (a membership, or MoO+ — D2). Pure, before any I/O.
  if (input.conversions.length > 0) {
    if (actor.level < PAR_WRITE_MIN) throw new CatalogItemError(403, "par_forbidden");
    for (const c of input.conversions) {
      if (c.locationId !== null && !catalogShopAllowed(actor, c.locationId)) throw new CatalogItemError(404, "not_found");
    }
  }
  // 3) 2a's full gate again (owner rule, first-only) and the chain validation.
  let prepared!: Awaited<ReturnType<typeof preparePackVersionWrite>>;
  try {
    prepared = await preparePackVersionWrite(actor, { skuId: input.skuId, scope, levels: input.levels });
  } catch (e) {
    rethrow(e);
  }
  const sb = getServiceRoleClient();
  // 4) A door report is answered only by someone who may act in ITS shop (the SQL binds it to the
  //    SKU and the save's reach; this binds it to the actor).
  if (input.requestId) {
    const shopOfRequest = await requestShop(sb, input.requestId);
    if (shopOfRequest === null || !catalogShopAllowed(actor, shopOfRequest)) throw new CatalogItemError(404, "not_found");
  }
  // 5) The save must present the preview it was shown, for THIS target, and accept only what it offered.
  const preview = await computePackPreview(actor, input.skuId, input.target, input.levels);
  if (preview.token !== input.previewToken) throw new CatalogItemError(409, "preview_stale");
  const offered = new Set(preview.conversions.map(conversionKey));
  for (const c of input.conversions) {
    if (!offered.has(conversionKey(c))) throw new CatalogItemError(409, "preview_stale");
  }
  // 6) ONE transaction.
  const { data, error } = await sb.rpc("apply_sku_pack_change", {
    p_sku: input.skuId, p_location: scope, p_levels: rpcLevels(prepared.levels),
    p_expected_live: preview.liveVersionId, p_based_on: preview.basedOnVersionId, p_note: null,
    p_actor: actor.user.id, p_first_only: prepared.firstOnly,
    p_par_changes: input.conversions.map((c) => {
      // A SHOP par's patch comes from THE one decider (parWriteColumns, kind "admin"): the human value,
      // and the machine lane + pin of that slot cleared. The global par is one column; SQL writes it.
      const eff = parWriteColumns({ kind: "admin", dayClass: c.slot, value: c.to });
      return {
        location_id: c.locationId, slot: c.slot, expected: c.expected, to: c.to,
        inherited: c.inherited === true, from: c.inherited === true ? (c.from ?? "global") : null,
        patch: c.locationId === null ? null : { ...eff.human, ...eff.autoLane },
      };
    }),
    p_request: input.requestId,
    // The snapshot of the preview recomputed just above (its token matched the person's): the RPC
    // re-takes it under the SKU lock and refuses any difference.
    p_snapshot: preview.snapshot,
  });
  if (error) {
    try { versionErrorFromRpc(error.message); } catch (e) { rethrow(e); }
  }
  const r = data as { version_id: string; retired_version_id: string | null; pars_converted: number; request_applied: boolean; mirror_synced: boolean | null };

  // The GLOBAL flat mirror was derived INSIDE the transaction (0259 sku_flat_mirror_apply via
  // save_sku_pack_version; Astra 2b r2#6) — nothing is synced after the lock is released.
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.pack_version_save", resourceTable: "sku_pack_versions", resourceId: r.version_id,
    metadata: {
      sku_id: input.skuId, location_id: scope, scope: scope === null ? "global" : "shop", via: "catalog_item_page",
      retired_version_id: r.retired_version_id, based_on_version_id: preview.basedOnVersionId ?? r.retired_version_id,
      first_only: prepared.firstOnly, labels: prepared.levels.map((l) => l.label.trim()), level_count: prepared.levels.length,
      flat_fields_synced: r.mirror_synced, pars_converted: r.pars_converted, request_id: input.requestId,
    },
    ipAddress: null, userAgent: null,
  });
  for (const c of input.conversions) {
    await audit({
      actorId: actor.user.id, actorRole: actor.user.role,
      action: "vendor_item.update", resourceTable: "vendor_items", resourceId: input.skuId,
      metadata: {
        scope: c.locationId === null ? "global_par" : "location_settings", location_id: c.locationId,
        inherited: c.inherited === true, from: c.inherited === true ? (c.from ?? "global") : null,
        edited_slots: [c.slot], before: c.expected, after: c.to, via: "pack_change_conversion", version_id: r.version_id,
      },
      ipAddress: null, userAgent: null,
    });
  }
  if (input.requestId) {
    await audit({
      actorId: actor.user.id, actorRole: actor.user.role,
      action: "sku.pack_change_request.resolve", resourceTable: "sku_pack_change_requests", resourceId: input.requestId,
      metadata: { sku_id: input.skuId, location_id: scope, outcome: "applied", version_id: r.version_id },
      ipAddress: null, userAgent: null,
    });
  }
  return { versionId: r.version_id, retiredVersionId: r.retired_version_id, parsConverted: r.pars_converted, requestApplied: r.request_applied };
}

/** Save "Price changed" for THE previewed target: the bind, the token must still match, then 2a's gated writer. */
export async function applyPriceChange(
  actor: AuthContext,
  input: { skuId: string; target: PreviewTarget; unitPrice: number; effectiveDate: string; previewToken: string },
): Promise<{ priceId: string; laneId: string | null; laneCreated: boolean }> {
  requireLocation(actor, "price", scopeOf(input.target));
  // Recomputed WITH the posted date: a different date (or a head that moved) is a different token.
  const preview = await computePricePreview(actor, input.skuId, input.target, input.unitPrice, input.effectiveDate);
  if (preview.token !== input.previewToken) throw new CatalogItemError(409, "preview_stale");
  try {
    return await saveSkuPrice(actor, { skuId: input.skuId, scope: scopeOf(input.target), unitPrice: input.unitPrice, effectiveDate: input.effectiveDate });
  } catch (e) {
    rethrow(e);
  }
}

// ── Price basis (plain words; spec §9 "a plain-words field in Price") ──────

/**
 * What the vendor's price is FOR (vendor_items.price_basis, 0210). SKU identity, so GLOBAL: MoO+
 * changes it; a GM may set it the first time (when unset). A shop-owned SKU binds to its owner
 * (skuOwnerAllowed). Metadata only — it never reinterprets vendor_price_history.unit_price.
 */
export async function setSkuPriceBasis(actor: AuthContext, skuId: string, basis: PriceBasis | null): Promise<void> {
  if (actor.level < BASIS_WRITE_MIN || !catalogWriteRoleAllowed(actor.role, actor.level)) throw new CatalogItemError(403, "forbidden");
  if (basis !== null && !(PRICE_BASES as readonly string[]).includes(basis)) throw new CatalogItemError(400, "invalid_basis");
  const sb = getServiceRoleClient();
  const { data: row, error } = await sb.from("vendor_items").select("id, price_basis, location_id").eq("id", skuId)
    .maybeSingle<{ id: string; price_basis: string | null; location_id: string | null }>();
  if (error) throw new Error(`setSkuPriceBasis read: ${error.message}`);
  if (!row) throw new CatalogItemError(404, "sku_not_found");
  // THE BIND: a shop-owned SKU (a store copy) is that shop's (a membership, or MoO+ — D2).
  if (!skuOwnerAllowed(actor, row.location_id)) throw new CatalogItemError(404, "not_found");
  if (actor.level < GLOBAL_VERSION_WRITE_MIN && row.price_basis !== null) throw new CatalogItemError(403, "global_requires_moo");
  // Compare-and-set on the value just read: a concurrent change is 409 version_changed (the D5 posture).
  const base = sb.from("vendor_items").update({ price_basis: basis }, { count: "exact" }).eq("id", skuId);
  const { error: uErr, count } = await (row.price_basis === null ? base.is("price_basis", null) : base.eq("price_basis", row.price_basis));
  if (uErr) throw new Error(`setSkuPriceBasis update: ${uErr.message}`);
  if (count !== 1) throw new CatalogItemError(409, "version_changed");
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "sku.price_basis_set", resourceTable: "vendor_items", resourceId: skuId,
    metadata: { before: row.price_basis, after: basis, via: "catalog_item_page" },
    ipAddress: null, userAgent: null,
  });
}
