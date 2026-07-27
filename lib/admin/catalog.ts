/**
 * Items Master Catalog server loader (piece 1). SERVER-ONLY, service-role
 * (admin authz is the calling page's — gate ≥ CATALOG_READ_MIN, mirrors
 * ITEMS_READ_MIN). Assembles the WHOLE items-universe routing dossier in a
 * FIXED number of batch queries + ONE recipe graph (the loadRecipeGraph law —
 * NO per-entity queries). Re-exports the client-safe types from catalog-shared.
 *
 * Canonical reference: docs/superpowers/specs/2026-07-26-items-master-catalog-design.md
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import {
  perUnitSkuOzForItemFromGraph,
  firstLevelItemConsumption,
} from "@/lib/prep-consumption-graph";
import { loadGraphReadiness } from "@/lib/admin/readiness-load";
import { classifyCatalogIssues, deriveCatalogType, isItemType, ITEM_TYPES } from "@/lib/admin/catalog-shared";
import type {
  CatalogEntity,
  CatalogEdgeRef,
  CatalogChecklistRef,
  ItemType,
} from "@/lib/admin/catalog-shared";

export {
  classifyCatalogIssues,
  deriveCatalogType,
  isItemType,
  isSkuClass,
  ITEM_TYPES,
  SKU_CLASSES,
} from "@/lib/admin/catalog-shared";
export type {
  CatalogEntity,
  CatalogEdges,
  CatalogEdgeRef,
  CatalogChecklistRef,
  CatalogEntityFlags,
  CatalogKind,
  CatalogIssue,
  CatalogIssueInput,
  CatalogType,
  ItemType,
  SkuClass,
} from "@/lib/admin/catalog-shared";

// ── item_type write (dossier editor) ─────────────────────────────────────────
export const ITEM_TYPE_WRITE_MIN = 7; // GM+ (Tier A) — mirrors the menu-flags floor

export class AdminCatalogError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminCatalogError";
  }
}

/**
 * Set a registry item's taxonomy type (0157). Items only (menu_items derive
 * made-vs-retail; packages have no taxon). Level floor ≥7 (Tier A is enforced
 * at the route, mirroring setCateringFlags); the UPDATE is count-checked and
 * audited. In-place additive — the item id + name are preserved.
 */
export async function setItemType(
  actor: AuthContext,
  args: { itemId: string; itemType: ItemType },
): Promise<void> {
  if (getRoleLevel(actor.user.role) < ITEM_TYPE_WRITE_MIN) {
    throw new AdminCatalogError(403, "forbidden", "Insufficient role level");
  }
  if (!isItemType(args.itemType)) {
    throw new AdminCatalogError(400, "invalid_item_type", "Unknown item type");
  }
  const sb = getServiceRoleClient();

  // Read the current value for the audit before-state (and to skip a no-op).
  const { data: cur, error: rErr } = await sb
    .from("items")
    .select("item_type")
    .eq("id", args.itemId)
    .maybeSingle<{ item_type: ItemType }>();
  if (rErr) throw new Error(`setItemType read failed: ${rErr.message}`);
  if (!cur) throw new AdminCatalogError(404, "item_not_found", "Item not found");
  if (cur.item_type === args.itemType) return; // no-op

  const { error, count } = await sb
    .from("items")
    .update(
      { item_type: args.itemType, updated_by: actor.user.id, updated_at: new Date().toISOString() },
      { count: "exact" },
    )
    .eq("id", args.itemId);
  if (error) throw new Error(`setItemType update failed: ${error.message}`);
  if (count === 0) throw new AdminCatalogError(404, "item_not_found", "Item not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "item.set_type",
    resourceTable: "items",
    resourceId: args.itemId,
    metadata: { before: { item_type: cur.item_type }, after: { item_type: args.itemType } },
    ipAddress: null,
    userAgent: null,
  });
}

export const CATALOG_READ_MIN = 6; // AGM+ view (mirrors ITEMS_READ_MIN)

/** Cap the number of leaf-SKU names displayed per item (dossier stays compact). */
const SKU_NAME_CAP = 8;

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function toCents(v: number | string | null): number | null {
  return v != null ? Math.round(Number(v) * 100) : null;
}

interface ItemRow {
  id: string; name: string; name_es: string | null; section: string | null;
  active: boolean; seasonal: boolean; sold_directly: boolean;
  catering_available: boolean; catering_only: boolean;
  serves: number | string | null; menu_price: number | string | null;
  item_type: ItemType;
}
interface MenuItemRow {
  id: string; name: string; name_es: string | null; section: string | null;
  active: boolean; seasonal: boolean; catering_available: boolean;
  catering_only: boolean; catering_portionable: boolean | null;
  serves: number | string | null; menu_price: number | string | null;
}
interface PackageRow {
  id: string; label_en: string; label_es: string | null; location_id: string | null;
  active: boolean; seasonal: boolean; serves: number | string | null;
  pricing_mode: string; price_cents: number;
}

export async function loadCatalogView(actor: AuthContext): Promise<CatalogEntity[]> {
  if (getRoleLevel(actor.user.role) < CATALOG_READ_MIN) throw new Error("forbidden");
  const sb = getServiceRoleClient();

  // ── Batch loads (fixed count; ALL rows incl. inactive — the catalog shows
  //    inactive with a badge, so no active filter on the three registries). ──
  const [
    { data: itemRows, error: iErr },
    { data: menuRows, error: mErr },
    { data: pkgRows, error: pErr },
    { data: locRows, error: lErr },
    { data: pkgLineRows, error: plErr },
    { data: pkgOptRows, error: poErr },
    { data: toastRows, error: tErr },
    { data: ctiRows, error: cErr },
    { data: sizeRows, error: szErr },
    { data: recipeRows, error: rErr },
    graph,
  ] = await Promise.all([
    // item_type rides the STAGED 0157 migration — the same gate as seasonal
    // (0156, also staged): this loader reads staged columns; both merge with
    // their migrations in this PR.
    sb.from("items").select("id, name, name_es, section, active, seasonal, sold_directly, catering_available, catering_only, serves, menu_price, item_type")
      .is("location_id", null).returns<ItemRow[]>(),
    sb.from("menu_items").select("id, name, name_es, section, active, seasonal, catering_available, catering_only, catering_portionable, serves, menu_price")
      .returns<MenuItemRow[]>(),
    sb.from("catering_packages").select("id, label_en, label_es, location_id, active, seasonal, serves, pricing_mode, price_cents")
      .returns<PackageRow[]>(),
    sb.from("locations").select("id, name").returns<Array<{ id: string; name: string }>>(),
    sb.from("catering_package_items").select("package_id, item_id, menu_item_id").eq("active", true)
      .returns<Array<{ package_id: string; item_id: string | null; menu_item_id: string | null }>>(),
    sb.from("catering_package_slot_options").select("package_item_id, item_id, menu_item_id").eq("active", true)
      .returns<Array<{ package_item_id: string; item_id: string | null; menu_item_id: string | null }>>(),
    sb.from("toast_menu_map").select("menu_item_id, item_id, package_id").eq("active", true).eq("match_status", "confirmed")
      .returns<Array<{ menu_item_id: string | null; item_id: string | null; package_id: string | null }>>(),
    sb.from("checklist_template_items").select("item_id, template_id").eq("active", true).not("item_id", "is", null)
      .returns<Array<{ item_id: string; template_id: string }>>(),
    sb.from("item_sizes").select("item_id").eq("active", true)
      .returns<Array<{ item_id: string }>>(),
    sb.from("recipes").select("id, name").returns<Array<{ id: string; name: string }>>(),
    loadRecipeGraph(),
  ]);
  for (const [label, err] of [
    ["items", iErr], ["menu_items", mErr], ["catering_packages", pErr], ["locations", lErr],
    ["package_items", plErr], ["slot_options", poErr], ["toast_menu_map", tErr],
    ["checklist_template_items", cErr], ["item_sizes", szErr], ["recipes", rErr],
  ] as const) {
    if (err) throw new Error(`loadCatalogView ${label}: ${err.message}`);
  }

  const items = itemRows ?? [];
  const menuItems = menuRows ?? [];
  const packages = pkgRows ?? [];
  const locationNameById = new Map((locRows ?? []).map((l) => [l.id, l.name]));
  const recipeNameById = new Map((recipeRows ?? []).map((r) => [r.id, r.name]));
  const itemNameById = new Map(items.map((r) => [r.id, r.name]));
  const menuNameById = new Map(menuItems.map((r) => [r.id, r.name]));

  // ── Readiness (items) — failure-open per house posture: default ready so the
  //    Issues lens never false-positives no_sku_path on a load error. ──
  const readyItemIds = new Set<string>();
  let readinessLoaded = false;
  try {
    const g = await loadGraphReadiness(actor);
    readinessLoaded = true;
    for (const [id, r] of g.itemReadiness) if (r.status === "ready") readyItemIds.add(id);
  } catch (e) {
    console.error("catalog readiness load failed (defaulting ready)", e);
  }
  const isReady = (itemId: string) => (readinessLoaded ? readyItemIds.has(itemId) : true);

  // ── Toast GUID counts per entity ──
  const toastByMenuItem = new Map<string, number>();
  const toastByItem = new Map<string, number>();
  const toastByPackage = new Map<string, number>();
  for (const r of toastRows ?? []) {
    if (r.menu_item_id) toastByMenuItem.set(r.menu_item_id, (toastByMenuItem.get(r.menu_item_id) ?? 0) + 1);
    else if (r.item_id) toastByItem.set(r.item_id, (toastByItem.get(r.item_id) ?? 0) + 1);
    else if (r.package_id) toastByPackage.set(r.package_id, (toastByPackage.get(r.package_id) ?? 0) + 1);
  }

  // ── item_sizes count per item ──
  const sizesByItem = new Map<string, number>();
  for (const s of sizeRows ?? []) sizesByItem.set(s.item_id, (sizesByItem.get(s.item_id) ?? 0) + 1);

  // ── checklists per item (join active template items → active templates) ──
  const activeTemplateById = new Map<string, { name: string; type: string }>();
  {
    const templateIds = [...new Set((ctiRows ?? []).map((r) => r.template_id))];
    if (templateIds.length > 0) {
      const { data: tplRows, error: tplErr } = await sb.from("checklist_templates")
        .select("id, name, type").in("id", templateIds).eq("active", true)
        .returns<Array<{ id: string; name: string; type: string }>>();
      if (tplErr) throw new Error(`loadCatalogView checklist_templates: ${tplErr.message}`);
      for (const t of tplRows ?? []) activeTemplateById.set(t.id, { name: t.name, type: t.type });
    }
  }
  const checklistsByItem = new Map<string, CatalogChecklistRef[]>();
  for (const r of ctiRows ?? []) {
    const tpl = activeTemplateById.get(r.template_id);
    if (!tpl) continue; // template inactive → out of play
    const arr = checklistsByItem.get(r.item_id) ?? [];
    if (!arr.some((c) => c.templateId === r.template_id)) {
      arr.push({ templateId: r.template_id, name: tpl.name, type: tpl.type });
    }
    checklistsByItem.set(r.item_id, arr);
  }

  // ── packages referencing an entity (fixed lines + choice options) ──
  const pkgsByItem = new Map<string, Set<string>>();
  const pkgsByMenuItem = new Map<string, Set<string>>();
  const lineToPackage = new Map<string, string>(); // package_item_id → package_id (for options)
  for (const line of pkgLineRows ?? []) {
    if (line.item_id) (pkgsByItem.get(line.item_id) ?? pkgsByItem.set(line.item_id, new Set()).get(line.item_id)!).add(line.package_id);
    if (line.menu_item_id) (pkgsByMenuItem.get(line.menu_item_id) ?? pkgsByMenuItem.set(line.menu_item_id, new Set()).get(line.menu_item_id)!).add(line.package_id);
  }
  // Options attach to a package_item; resolve its package via a second pass over lines.
  // catering_package_items has no id in our select, so re-load line ids → package.
  const { data: lineIdRows } = await sb.from("catering_package_items")
    .select("id, package_id").eq("active", true)
    .returns<Array<{ id: string; package_id: string }>>();
  for (const l of lineIdRows ?? []) lineToPackage.set(l.id, l.package_id);
  for (const opt of pkgOptRows ?? []) {
    const pkgId = lineToPackage.get(opt.package_item_id);
    if (!pkgId) continue;
    if (opt.item_id) (pkgsByItem.get(opt.item_id) ?? pkgsByItem.set(opt.item_id, new Set()).get(opt.item_id)!).add(pkgId);
    if (opt.menu_item_id) (pkgsByMenuItem.get(opt.menu_item_id) ?? pkgsByMenuItem.set(opt.menu_item_id, new Set()).get(opt.menu_item_id)!).add(pkgId);
  }
  const pkgLabelById = new Map(packages.map((p) => [p.id, p.label_en]));
  const packageRefs = (ids: Set<string> | undefined): CatalogEdgeRef[] =>
    ids ? [...ids].map((id) => ({ id, name: pkgLabelById.get(id) ?? "—" })) : [];

  // ── "Used in" edges via graph inputs scan: for each recipe input that is an
  //    item-ref, that recipe's OUTPUTS consume the referenced item. A menu_item
  //    output → the item is used in that menu_item; an item output → used in
  //    that parent item. (Batch, in-memory — no per-entity query.) ──
  const usedInMenuItemsByItem = new Map<string, Set<string>>();
  const usedInItemsByItem = new Map<string, Set<string>>();
  // Iterate the whole recipe universe once via the graph's byOutputItem/MenuItem
  // maps → the unique set of recipe nodes.
  const seenRecipes = new Set<string>();
  const allRecipeNodes = [
    ...graph.byOutputItem.values(),
    ...graph.byOutputMenuItem.values(),
  ];
  for (const node of allRecipeNodes) {
    if (seenRecipes.has(node.recipeId)) continue;
    seenRecipes.add(node.recipeId);
    const consumedItemIds = node.inputs
      .map((i) => i.componentItemId)
      .filter((v): v is string => v != null);
    if (consumedItemIds.length === 0) continue;
    for (const o of node.outputs) {
      if (o.outputMenuItemId) {
        for (const consumed of consumedItemIds) {
          (usedInMenuItemsByItem.get(consumed) ?? usedInMenuItemsByItem.set(consumed, new Set()).get(consumed)!).add(o.outputMenuItemId);
        }
      } else if (o.outputItemId) {
        for (const consumed of consumedItemIds) {
          if (consumed === o.outputItemId) continue; // self-loop guard
          (usedInItemsByItem.get(consumed) ?? usedInItemsByItem.set(consumed, new Set()).get(consumed)!).add(o.outputItemId);
        }
      }
    }
  }

  // ── SKU names for leaf keys (one .in() over the union of all items' leaves) ──
  const perItemSkuKeys = new Map<string, string[]>();
  const allSkuIds = new Set<string>();
  for (const it of items) {
    const keys = [...perUnitSkuOzForItemFromGraph(graph, it.id).keys()];
    perItemSkuKeys.set(it.id, keys);
    for (const k of keys) allSkuIds.add(k);
  }
  const skuNameById = new Map<string, string>();
  if (allSkuIds.size > 0) {
    const { data: viRows, error: viErr } = await sb.from("vendor_items")
      .select("id, name").in("id", [...allSkuIds])
      .returns<Array<{ id: string; name: string }>>();
    if (viErr) throw new Error(`loadCatalogView vendor_items: ${viErr.message}`);
    for (const v of viRows ?? []) skuNameById.set(v.id, v.name);
  }

  // ── producing recipe(s) per item (graph.byOutputItem is first-wins; scan the
  //    node's outputs to confirm this item is a genuine output). ──
  const edgeRefs = (ids: Set<string> | undefined, names: Map<string, string>): CatalogEdgeRef[] =>
    ids ? [...ids].map((id) => ({ id, name: names.get(id) ?? "—" })) : [];

  const entities: CatalogEntity[] = [];

  // Items
  for (const it of items) {
    const producing = graph.byOutputItem.get(it.id) ?? null;
    const hasRecipe = producing != null;
    const producedBy: CatalogEdgeRef[] = producing
      ? [{ id: producing.recipeId, name: recipeNameById.get(producing.recipeId) ?? "—" }]
      : [];
    const skuKeys = perItemSkuKeys.get(it.id) ?? [];
    const skuNames = skuKeys.slice(0, SKU_NAME_CAP).map((k) => skuNameById.get(k) ?? "—");
    const usedInMenu = edgeRefs(usedInMenuItemsByItem.get(it.id), menuNameById);
    const usedInItems = edgeRefs(usedInItemsByItem.get(it.id), itemNameById);
    const pkgs = packageRefs(pkgsByItem.get(it.id));
    const checklists = checklistsByItem.get(it.id) ?? [];
    const toastGuids = toastByItem.get(it.id) ?? 0;
    const sizesCount = sizesByItem.get(it.id) ?? 0;
    const readinessReady = isReady(it.id);
    const issues = classifyCatalogIssues({
      kind: "item", active: it.active, soldDirectly: it.sold_directly,
      sizesCount, usedInMenuItems: usedInMenu.length, usedInPackages: pkgs.length,
      hasRecipe, readinessReady, toastGuids,
    });
    entities.push({
      key: `item:${it.id}`, kind: "item", id: it.id, name: it.name, nameEs: it.name_es,
      section: it.section, active: it.active, seasonal: it.seasonal,
      flags: { soldDirectly: it.sold_directly, cateringAvailable: it.catering_available, cateringOnly: it.catering_only, cateringPortionable: null },
      serves: num(it.serves), priceCents: toCents(it.menu_price),
      edges: {
        producedBy, build: null, skuNames, componentItems: [],
        usedInMenuItems: usedInMenu, usedInItems, packages: pkgs, checklists,
        toastGuids, sizesCount,
      },
      issues,
      itemType: it.item_type,
      taxonType: deriveCatalogType({ kind: "item", itemType: it.item_type }),
    });
  }

  // Menu items
  for (const mi of menuItems) {
    const build = graph.byOutputMenuItem.get(mi.id) ?? null;
    const hasRecipe = build != null;
    const buildRef: CatalogEdgeRef | null = build
      ? { id: build.recipeId, name: recipeNameById.get(build.recipeId) ?? "—" }
      : null;
    const componentIds = [...firstLevelItemConsumption(graph, mi.id).keys()];
    const componentItems: CatalogEdgeRef[] = componentIds.map((id) => ({ id, name: itemNameById.get(id) ?? "—" }));
    const pkgs = packageRefs(pkgsByMenuItem.get(mi.id));
    const toastGuids = toastByMenuItem.get(mi.id) ?? 0;
    const issues = classifyCatalogIssues({
      kind: "menu_item", active: mi.active, soldDirectly: false,
      sizesCount: 0, usedInMenuItems: 0, usedInPackages: pkgs.length,
      hasRecipe, readinessReady: true, toastGuids,
    });
    entities.push({
      key: `menu_item:${mi.id}`, kind: "menu_item", id: mi.id, name: mi.name, nameEs: mi.name_es,
      section: mi.section, active: mi.active, seasonal: mi.seasonal,
      flags: { soldDirectly: false, cateringAvailable: mi.catering_available, cateringOnly: mi.catering_only, cateringPortionable: mi.catering_portionable },
      serves: num(mi.serves), priceCents: toCents(mi.menu_price),
      edges: {
        producedBy: [], build: buildRef, skuNames: [], componentItems,
        usedInMenuItems: [], usedInItems: [], packages: pkgs, checklists: [],
        toastGuids, sizesCount: 0,
      },
      issues,
      itemType: null,
      // made-vs-retail: an active consumer build → made; else retail (0157 §1).
      taxonType: deriveCatalogType({ kind: "menu_item", hasBuild: hasRecipe }),
    });
  }

  // Packages
  for (const p of packages) {
    const toastGuids = toastByPackage.get(p.id) ?? 0;
    // "__global__" is a sentinel the client translates (admin.catalog.section.global) — no display literal in logic (T0).
    const sectionLabel = p.location_id ? (locationNameById.get(p.location_id) ?? null) : "__global__";
    const issues = classifyCatalogIssues({
      kind: "package", active: p.active, soldDirectly: false,
      sizesCount: 0, usedInMenuItems: 0, usedInPackages: 0,
      hasRecipe: false, readinessReady: true, toastGuids,
    });
    entities.push({
      key: `package:${p.id}`, kind: "package", id: p.id, name: p.label_en, nameEs: p.label_es,
      section: sectionLabel, active: p.active, seasonal: p.seasonal,
      flags: { soldDirectly: false, cateringAvailable: true, cateringOnly: false, cateringPortionable: null },
      serves: num(p.serves), priceCents: p.price_cents,
      edges: {
        producedBy: [], build: null, skuNames: [], componentItems: [],
        usedInMenuItems: [], usedInItems: [], packages: [], checklists: [],
        toastGuids, sizesCount: 0,
      },
      issues,
      itemType: null,
      taxonType: deriveCatalogType({ kind: "package" }),
    });
  }

  return entities;
}
