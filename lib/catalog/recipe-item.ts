/**
 * The RECIPE PAGE — server half (catalog Phase 3b; spec §3, §4, §6). SERVER-ONLY, service role.
 *   loadRecipeItemView   — what the page shows for one recipe at one scope (global or a shop).
 *   computeRecipePreview — "What this changes" for ONE act (lines / restore / back to default / adopt /
 *                          promote) at its save target: every reached scope's graph before and after
 *                          (3a's recipeOverrides — a hypothetical ingredient resolves like a real one),
 *                          the sandwiches whose cost moves, the shops left untouched, and the token.
 *   applyRecipeChange    — recomputes the preview, refuses preview_stale on any difference, then calls
 *                          3a's gated writer with the preview's snapshot. The SQL compare-and-set stays the guard.
 * GATES LIVE HERE (house rule): a preview is offered only to someone who may SAVE that target
 * (recipeVersionWriteGate — the role rule refuses the social media manager, the shop bind runs before any I/O),
 * so a preview never shows a choice the save would refuse. The view takes the version-read rule (6+, by role).
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { loadRecipeGraph, loadSkuPackResolution } from "@/lib/prep-consumption";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph, rollupItemCost, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { loadRecipeBuilderCatalog } from "@/lib/admin/recipe-builder-data";
import { assertInputLineIsValid, RecipeError } from "@/lib/recipes";
import { catalogShopAllowed, type VersionScope } from "@/lib/sku-versions-shared";
import { lineFromRow, recipeLineKind, type RecipeLineFields, type RecipeLineRow } from "@/lib/recipe-line-shared";
import {
  addedLinePositions, applyRecipeLineOp, diffRecipeLineSets, recipeLineProblem, recipeLineTargetKey, recipeVersionReadAllowed,
  recipeVersionWriteGate, type RecipeVersionLineRow,
} from "@/lib/recipe-versions-shared";
import {
  RecipeVersionError, adoptRecipeVersion, loadRecipeChangeSnapshot, loadRecipeLiveSet, loadRecipeVersionHistory,
  promoteRecipeVersion, restoreRecipeVersion, retireShopRecipeVersion, saveRecipeLines,
} from "@/lib/admin/recipe-versions";
import { selectAllRows } from "@/lib/supabase-paginate";
import { menuCostDeltas, recipePreviewToken, type RecipePreview, type ScopeImpact } from "@/lib/catalog/recipe-preview-shared";
import { historyLinkEndedSource, recipeChangeTarget, scopedPickerSkus, type RecipeChangeRequest, type RecipeItemView } from "@/lib/catalog/recipe-item-shared";
import { computeShopNotices } from "@/lib/catalog/shop-changes";

type Sb = ReturnType<typeof getServiceRoleClient>;
type Named = { id: string; name: string };

export async function loadActiveShops(sb: Sb): Promise<Named[]> {
  const { data, error } = await sb.from("locations").select("id, name").eq("active", true).order("name", { ascending: true })
    .returns<Named[]>();
  if (error) throw new Error(`catalog shops: ${error.message}`);
  return data ?? [];
}

const none = <T>() => Promise.resolve({ data: [] as T[], error: null });

/** recipeLineTargetKey → display name (and SKU → vendor name) for every line given. */
export async function lineNames(sb: Sb, lines: readonly RecipeLineFields[]): Promise<{ names: Record<string, string>; vendorBySku: Map<string, string | null> }> {
  const ids = (k: "componentSkuId" | "componentItemId" | "componentProductId") =>
    [...new Set(lines.map((l) => l[k]).filter((v): v is string => v !== null))];
  const [skuIds, itemIds, productIds] = [ids("componentSkuId"), ids("componentItemId"), ids("componentProductId")];
  type SkuRow = { id: string; name: string; vendor_id: string | null };
  const [skus, items, products] = await Promise.all([
    skuIds.length ? sb.from("vendor_items").select("id, name, vendor_id").in("id", skuIds).returns<SkuRow[]>() : none<SkuRow>(),
    itemIds.length ? sb.from("items").select("id, name").in("id", itemIds).returns<Named[]>() : none<Named>(),
    productIds.length ? sb.from("products").select("id, name").in("id", productIds).returns<Named[]>() : none<Named>(),
  ]);
  for (const r of [skus, items, products]) if (r.error) throw new Error(`catalog line names: ${r.error.message}`);
  const vendorIds = [...new Set((skus.data ?? []).map((s) => s.vendor_id).filter((v): v is string => v !== null))];
  const vendors = vendorIds.length ? await sb.from("vendors").select("id, name").in("id", vendorIds).returns<Named[]>() : await none<Named>();
  if (vendors.error) throw new Error(`catalog vendor names: ${vendors.error.message}`);
  const vendorName = new Map((vendors.data ?? []).map((v) => [v.id, v.name]));
  const names: Record<string, string> = {};
  for (const s of skus.data ?? []) names[`sku:${s.id}`] = s.name;
  for (const i of items.data ?? []) names[`item:${i.id}`] = i.name;
  for (const p of products.data ?? []) names[`product:${p.id}`] = p.name;
  return { names, vendorBySku: new Map((skus.data ?? []).map((s) => [s.id, s.vendor_id ? (vendorName.get(s.vendor_id) ?? null) : null])) };
}

/** What `recipeLineProblem` needs for these lines: which of their products are active, and the active measures. */
async function lineProblemContext(sb: Sb, lines: readonly RecipeLineFields[]): Promise<{ activeProductIds: Set<string>; activeMeasureLabels: Set<string> }> {
  const productIds = [...new Set(lines.map((f) => f.componentProductId).filter((v): v is string => v !== null))];
  const [products, measures] = await Promise.all([
    productIds.length ? sb.from("products").select("id").in("id", productIds).eq("active", true).returns<Array<{ id: string }>>() : none<{ id: string }>(),
    sb.from("measure_units").select("label").eq("active", true).returns<Array<{ label: string }>>(),
  ]);
  if (products.error) throw new Error(`catalog line flags products: ${products.error.message}`);
  if (measures.error) throw new Error(`catalog line flags measures: ${measures.error.message}`);
  return { activeProductIds: new Set((products.data ?? []).map((p) => p.id)), activeMeasureLabels: new Set((measures.data ?? []).map((m) => m.label)) };
}

function gateFor(actor: AuthContext, scope: VersionScope) {
  return recipeVersionWriteGate({ role: actor.user.role, level: actor.level, scope, scopeAllowed: scope !== null && catalogShopAllowed(actor, scope) });
}

type VersionHead = { id: string; recipe_id: string; location_id: string | null; active: boolean | null; adopted_from_version_id: string | null };
type LineRowWithId = RecipeLineRow & { id: string; display_order: number | null };

/** One version (any scope) with its lines, or null. The single-row read is bounded by its id; the lines are paged. */
async function versionWithLines(sb: Sb, versionId: string): Promise<(VersionHead & { lines: RecipeLineFields[] }) | null> {
  const { data: v, error } = await sb.from("recipe_versions").select("id, recipe_id, location_id, active, adopted_from_version_id").eq("id", versionId)
    .maybeSingle<VersionHead>();
  if (error) throw new Error(`catalog version: ${error.message}`);
  if (!v) return null;
  // Paged like every version line-set read (Astra 3a r1#6 / 3b r1#9).
  const rows = await selectAllRows<LineRowWithId>(async (from, to) => {
    const { data, error: lErr } = await sb.from("recipe_version_lines")
      .select("id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order")
      .eq("version_id", versionId).order("display_order", { ascending: true }).order("id", { ascending: true })
      .range(from, to).returns<LineRowWithId[]>();
    if (lErr) throw new Error(`catalog version lines: ${lErr.message}`);
    return { data };
  });
  return { ...v, lines: rows.map(lineFromRow) };
}

export async function loadRecipeItemView(actor: AuthContext, recipeId: string, scope: VersionScope): Promise<RecipeItemView | null> {
  // The version-read rule (6+, by ROLE — the social media manager is refused), in the lib.
  if (!recipeVersionReadAllowed(actor.user.role, actor.level)) throw new RecipeVersionError(403, "forbidden");
  const sb = getServiceRoleClient();
  const shops = await loadActiveShops(sb);
  if (scope !== null && !shops.some((s) => s.id === scope)) throw new RecipeVersionError(404, "not_found");
  const { data: recipe, error: rErr } = await sb.from("recipes").select("id, name, name_es, recipe_type, active").eq("id", recipeId)
    .maybeSingle<{ id: string; name: string; name_es: string | null; recipe_type: "production" | "consumer" | null; active: boolean | null }>();
  if (rErr) throw new Error(`loadRecipeItemView recipe: ${rErr.message}`);
  if (!recipe) return null;

  const live = await loadRecipeLiveSet(recipeId, scope);
  const globalSet = scope === null || live.ridesDefault ? live : await loadRecipeLiveSet(recipeId, null);
  const all = await loadRecipeVersionHistory(actor, recipeId, scope, { allShops: true });
  const shopName = (id: string | null) => (id === null ? null : (shops.find((s) => s.id === id)?.name ?? null));
  const byId = new Map(all.map((v) => [v.id, v]));
  const ownLive = scope === null ? null : all.find((v) => v.locationId === scope && v.active) ?? null;
  const others = all.filter((v) => v.locationId !== null && v.locationId !== scope && v.active);

  const globalFields = globalSet.lines.map((l) => l.fields);
  const involved = [...live.lines.map((l) => l.fields), ...globalFields, ...others.flatMap((o) => o.lines)];
  const { names, vendorBySku } = await lineNames(sb, involved);
  const globalKeys = new Set(globalFields.map((f) => JSON.stringify(f)));

  // What it makes, and what that costs HERE.
  const { data: outs, error: oErr } = await sb.from("recipe_outputs").select("output_item_id, output_menu_item_id, yield").eq("recipe_id", recipeId)
    .returns<Array<{ output_item_id: string | null; output_menu_item_id: string | null; yield: number | string }>>();
  if (oErr) throw new Error(`loadRecipeItemView outputs: ${oErr.message}`);
  const outItemIds = (outs ?? []).map((o) => o.output_item_id).filter((v): v is string => v !== null);
  const outMenuIds = (outs ?? []).map((o) => o.output_menu_item_id).filter((v): v is string => v !== null);
  type MenuName = { id: string; name: string; name_es: string | null };
  const [itemRows, menuRows, graph] = await Promise.all([
    outItemIds.length ? sb.from("items").select("id, name").in("id", outItemIds).returns<Named[]>() : none<Named>(),
    outMenuIds.length ? sb.from("menu_items").select("id, name, name_es").in("id", outMenuIds).returns<MenuName[]>() : none<MenuName>(),
    loadRecipeGraph(scope === null ? undefined : { locationId: scope }),
  ]);
  for (const r of [itemRows, menuRows]) if (r.error) throw new Error(`loadRecipeItemView connections: ${r.error.message}`);
  // "USED IN" FROM THE SAME SCOPE-RESOLVED GRAPH (Astra 3b r1#7): a shop recipe that adds or drops this
  // prep item shows here exactly as that shop makes it — never the global recipe_inputs.
  const outItemSet = new Set(outItemIds);
  const usedInIds = [...new Set([...new Set([...graph.byOutputItem.values(), ...graph.byOutputMenuItem.values()])]
    .filter((r) => r.recipeId !== recipeId && r.inputs.some((i) => i.componentItemId != null && outItemSet.has(i.componentItemId)))
    .map((r) => r.recipeId))];
  const usedIn = usedInIds.length
    ? await sb.from("recipes").select("id, name").in("id", usedInIds).eq("active", true).order("name").returns<Named[]>()
    : await none<Named>();
  if (usedIn.error) throw new Error(`loadRecipeItemView used-in: ${usedIn.error.message}`);
  const costPerOz = costPerOzFromGraph(graph, await loadCurrentSkuPrices([...graph.skuPack.keys()], scope));
  const makes: RecipeItemView["makes"] = (outs ?? []).map((o) => {
    if (o.output_item_id) {
      return { kind: "item" as const, id: o.output_item_id, name: (itemRows.data ?? []).find((i) => i.id === o.output_item_id)?.name ?? "", nameEs: null,
        yield: Number(o.yield), costHere: rollupItemCost(graph, o.output_item_id, costPerOz).cost };
    }
    const m = (menuRows.data ?? []).find((x) => x.id === o.output_menu_item_id);
    return { kind: "menu_item" as const, id: o.output_menu_item_id!, name: m?.name ?? "", nameEs: m?.name_es ?? null,
      yield: Number(o.yield), costHere: rollupMenuItemCost(graph, o.output_menu_item_id!, costPerOz).cost };
  });

  const catalog = await loadRecipeBuilderCatalog();
  // The SHOP's packs for the picker (Astra 3b r4#1): 2a's resolver, paged and chunked, as of now.
  const pickerPacks = await loadSkuPackResolution(catalog.skus.map((s) => s.id), scope);
  const canEditShop = scope !== null && gateFor(actor, scope).ok;
  const notices = canEditShop && scope !== null
    ? (await computeShopNotices(sb, scope, new Date().toISOString())).filter((n) => n.recipeId === recipeId)
    : [];
  const adoptedFrom = ownLive?.adoptedFromVersionId ? byId.get(ownLive.adoptedFromVersionId) : undefined;
  const flagCtx = await lineProblemContext(sb, live.lines.map((l) => l.fields));

  return {
    recipe: { id: recipe.id, name: recipe.name, nameEs: recipe.name_es, recipeType: recipe.recipe_type === "production" ? "production" : "consumer", active: recipe.active !== false },
    shops, scope, scopeName: shopName(scope),
    can: { editShop: canEditShop, editGlobal: gateFor(actor, null).ok },
    version: {
      scopeVersionId: live.scopeVersionId, globalVersionId: live.globalVersionId, ridesDefault: live.ridesDefault,
      adoptedFromShopName: adoptedFrom ? shopName(adoptedFrom.locationId) : null,
      validFrom: ownLive?.validFrom ?? null,
    },
    lines: live.lines.map((l) => ({
      lineId: l.lineId!, fields: l.fields, name: names[recipeLineTargetKey(l.fields)] ?? recipeLineTargetKey(l.fields),
      kind: recipeLineKind(l.fields), vendorName: l.fields.componentSkuId ? (vendorBySku.get(l.fields.componentSkuId) ?? null) : null,
      changedHere: scope !== null && !live.ridesDefault && !globalKeys.has(JSON.stringify(l.fields)),
      problem: recipeLineProblem(l.fields, flagCtx),
    })),
    differsFromDefault: scope !== null && !live.ridesDefault ? diffRecipeLineSets(globalFields, live.lines.map((l) => l.fields)) : [],
    makes,
    usedIn: usedIn.data ?? [],
    vendors: [...new Set([...vendorBySku.values()].filter((v): v is string => v !== null))].sort(),
    otherShopVersions: others.map((o) => ({
      versionId: o.id, shopId: o.locationId!, shopName: shopName(o.locationId) ?? "", validFrom: o.validFrom, createdByName: o.createdByName,
      changes: diffRecipeLineSets(globalFields, o.lines),
    })),
    notices,
    history: all.filter((v) => v.locationId === null || v.locationId === scope).map((v) => ({
      id: v.id, scope: v.locationId === null ? "global" as const : "shop" as const, shopName: shopName(v.locationId), active: v.active,
      validFrom: v.validFrom, validTo: v.validTo, who: v.createdByName, note: v.note, lineCount: v.lines.length,
      promotedFromShopName: v.promotedFromVersionId ? shopName(byId.get(v.promotedFromVersionId)?.locationId ?? null) : null,
      adoptedFromShopName: v.adoptedFromVersionId ? shopName(byId.get(v.adoptedFromVersionId)?.locationId ?? null) : null,
      // The END of an adoption link is what 0262 RECORDED on this row (Astra r7) — never inferred from based_on.
      linkEndedFromShopName: shopName(historyLinkEndedSource(v, byId)),
    })),
    names,
    picker: {
      skus: scopedPickerSkus(catalog.skus, pickerPacks), items: catalog.items, products: catalog.products,
      measures: [...catalog.measures].map(([label, m]) => ({ label, dimension: m.dimension, toBaseFactor: m.toBaseFactor })),
      activeMeasureLabels: catalog.activeMeasureLabels,
    },
  };
}

/**
 * LEAD DECISION (b) at preview time: every line the save ADDS or CREATES goes through the SAME validator the
 * writer runs (assertInputLineIsValid — so a preview never offers a save the writer would refuse), and a refusal
 * names WHICH line and WHY; a line it only CARRIES is flagged when it would no longer pass, never refused.
 */
async function judgeLines(
  sb: Sb, after: readonly RecipeLineFields[], added: ReadonlySet<number>, names: Readonly<Record<string, string>>,
): Promise<RecipePreview["flagged"]> {
  const nameOf = (f: RecipeLineFields) => names[recipeLineTargetKey(f)] ?? recipeLineTargetKey(f);
  for (const position of [...added].sort((a, b) => a - b)) {
    const f = after[position - 1]!;
    try {
      await assertInputLineIsValid(sb, f);
    } catch (e) {
      if (e instanceof RecipeError) {
        throw new RecipeVersionError(e.status, e.code, e.message, { position, name: nameOf(f), reason: e.code });
      }
      throw e;
    }
  }
  const ctx = await lineProblemContext(sb, after);
  const flagged: RecipePreview["flagged"] = [];
  after.forEach((f, i) => {
    if (added.has(i + 1)) return;
    const reason = recipeLineProblem(f, ctx);
    if (reason) flagged.push({ position: i + 1, name: nameOf(f), reason });
  });
  return flagged;
}

export async function computeRecipePreview(actor: AuthContext, recipeId: string, change: RecipeChangeRequest): Promise<RecipePreview> {
  const target = recipeChangeTarget(change);
  const scope: VersionScope = target.kind === "shop" ? target.shopId : null;
  const gate = gateFor(actor, scope);
  if (!gate.ok) throw new RecipeVersionError(gate.status, gate.code);
  const sb = getServiceRoleClient();
  const live = await loadRecipeLiveSet(recipeId, scope);
  if (!live.recipeActive) throw new RecipeVersionError(409, "recipe_inactive");
  const before = live.lines.map((l) => l.fields);
  let after: RecipeLineFields[];
  let sourceVersionId: string | null = null;
  let sourceShopId: string | null = null;
  let restoredAdoptedFrom: string | null = null;
  switch (change.kind) {
    case "lines": {
      const r = applyRecipeLineOp(live.lines, change.op);
      if (!r.ok) throw new RecipeVersionError(r.status, r.code);
      if (!r.changed) throw new RecipeVersionError(400, "nothing_changed");
      after = r.lines.map((l) => l.fields);
      break;
    }
    case "restore": {
      const v = await versionWithLines(sb, change.fromVersionId);
      if (!v || v.recipe_id !== recipeId || (v.location_id !== null && v.location_id !== scope)) throw new RecipeVersionError(404, "not_found");
      after = v.lines;
      sourceVersionId = v.id;
      restoredAdoptedFrom = v.adopted_from_version_id;
      break;
    }
    case "back_to_default": {
      if (live.ridesDefault || live.scopeVersionId === null) throw new RecipeVersionError(409, "not_live");
      after = (await loadRecipeLiveSet(recipeId, null)).lines.map((l) => l.fields);
      break;
    }
    case "adopt": {
      const v = await versionWithLines(sb, change.sourceVersionId);
      if (!v) throw new RecipeVersionError(404, "not_found");
      if (v.recipe_id !== recipeId || v.location_id === null || v.location_id === scope || v.active === false) throw new RecipeVersionError(400, "invalid_source");
      after = v.lines;
      sourceVersionId = v.id;
      break;
    }
    case "promote": {
      const v = await versionWithLines(sb, change.sourceVersionId);
      if (!v) throw new RecipeVersionError(404, "not_found");
      if (v.recipe_id !== recipeId || v.location_id === null || v.active === false) throw new RecipeVersionError(400, "invalid_source");
      after = v.lines;
      sourceVersionId = v.id;
      sourceShopId = v.location_id;
      break;
    }
  }

  // THE SCOPED DEPENDENCY SNAPSHOT (lead decision (a)), taken as soon as the set being written is known and BEFORE
  // any number is computed: every number below comes from a state no later than this one. The token binds it; the
  // writer re-derives the same closure (recipe, scope, these lines), locks it and re-checks it.
  const snapshot = await loadRecipeChangeSnapshot(recipeId, scope, after);

  // WHO IT REACHES: a shop target → that shop; a global target → the default itself and every active
  // shop riding it for this recipe. A shop with its own live version is untouched.
  const shops = await loadActiveShops(sb);
  let reachedScopes: VersionScope[];
  let untouched: RecipePreview["untouched"] = [];
  if (scope !== null) {
    reachedScopes = [scope];
  } else {
    // Paged and ordered like every read of these tables (at most one live version per shop, but no exception needed).
    const own = await selectAllRows<{ id: string; location_id: string }>(async (from, to) => {
      const { data, error } = await sb.from("recipe_versions").select("id, location_id").eq("recipe_id", recipeId).eq("active", true)
        .not("location_id", "is", null).order("id", { ascending: true }).range(from, to).returns<Array<{ id: string; location_id: string }>>();
      if (error) throw new Error(`computeRecipePreview shops: ${error.message}`);
      return { data };
    });
    const ownSet = new Set(own.map((r) => r.location_id));
    reachedScopes = [null, ...shops.filter((s) => !ownSet.has(s.id)).map((s) => s.id)];
    // PROMOTE: the source shop is neither reached (its food does not change) nor untouched — it RETURNS to
    // the default in the same save (lead decision 5), shown on its own line.
    untouched = shops.filter((s) => ownSet.has(s.id) && s.id !== sourceShopId).map((s) => ({ shopId: s.id, shopName: s.name }));
  }
  const returnedShop = change.kind === "promote" && sourceShopId !== null
    ? { shopId: sourceShopId, shopName: shops.find((s) => s.id === sourceShopId)?.name ?? "" }
    : null;
  // PROVENANCE FOLLOWS THE CONTENT (lead decision, Astra r6): restoring a version from BEFORE the adoption (it carries
  // no adoption pointer) — like going back to the default — ends this shop's link to the shop it adopted from. Said
  // plainly before saving. Restoring a version of the adopted lineage keeps the link (0262 copies its pointer), and
  // an EDIT of an adopted copy keeps it too (it carries the pointer), so only these two acts can drop it.
  let dropsLinkTo: string | null = null;
  if (scope !== null && live.scopeVersionId && (change.kind === "back_to_default" || (change.kind === "restore" && restoredAdoptedFrom === null))) {
    const current = await versionWithLines(sb, live.scopeVersionId);
    if (current?.adopted_from_version_id) {
      const src = await versionWithLines(sb, current.adopted_from_version_id);
      dropsLinkTo = src?.location_id ? (shops.find((s) => s.id === src.location_id)?.name ?? "") : null;
    }
  }

  type MenuName = { id: string; name: string; name_es: string | null };
  const { data: menu, error: mErr } = await sb.from("menu_items").select("id, name, name_es").eq("active", true).order("name").order("id")
    .returns<MenuName[]>();
  if (mErr) throw new Error(`computeRecipePreview menu: ${mErr.message}`);
  const menuIds = (menu ?? []).map((m) => m.id);
  const menuNames = new Map((menu ?? []).map((m) => [m.id, { name: m.name, nameEs: m.name_es }]));
  const { data: outs, error: oErr } = await sb.from("recipe_outputs").select("output_item_id").eq("recipe_id", recipeId).not("output_item_id", "is", null)
    .returns<Array<{ output_item_id: string }>>();
  if (oErr) throw new Error(`computeRecipePreview outputs: ${oErr.message}`);
  const outItemIds = (outs ?? []).map((o) => o.output_item_id);
  const { names } = await lineNames(sb, [...before, ...after]);
  // An EDIT may carry lines (counted with multiplicity); a COPIED set — restore, adopt, promote — carries nothing:
  // every line it copies is an addition (Astra 3a r3#3). Back to default writes no new line of its own.
  const added = new Set(change.kind === "lines" ? addedLinePositions(before, after)
    : change.kind === "back_to_default" ? [] : after.map((_, i) => i + 1));
  const flagged = await judgeLines(sb, after, added, names);
  const itemNames = outItemIds.length
    ? await sb.from("items").select("id, name").in("id", outItemIds).returns<Named[]>()
    : await none<Named>();
  if (itemNames.error) throw new Error(`computeRecipePreview items: ${itemNames.error.message}`);

  const overrideRows: RecipeVersionLineRow[] = after.map((f, i) => ({
    id: `preview-${i}`, version_id: "preview", recipe_id: recipeId,
    component_sku_id: f.componentSkuId, component_item_id: f.componentItemId, component_product_id: f.componentProductId,
    quantity: f.quantity, unit: f.unit, each_container_label: f.eachContainerLabel, portioned: f.portioned, display_order: i,
  }));
  const reached: ScopeImpact[] = [];
  for (const s of reachedScopes) {
    const opts = s === null ? {} : { locationId: s };
    const [gBefore, gAfter] = await Promise.all([
      loadRecipeGraph(opts),
      loadRecipeGraph({ ...opts, recipeOverrides: new Map([[recipeId, overrideRows]]) }),
    ]);
    const prices = await loadCurrentSkuPrices([...new Set([...gBefore.skuPack.keys(), ...gAfter.skuPack.keys()])], s);
    const cb = costPerOzFromGraph(gBefore, prices);
    const ca = costPerOzFromGraph(gAfter, prices);
    reached.push({
      scope: s, scopeName: s === null ? null : (shops.find((x) => x.id === s)?.name ?? null),
      menu: menuCostDeltas(menuIds, menuNames, { graph: gBefore, costPerOz: cb }, { graph: gAfter, costPerOz: ca }),
      items: outItemIds.map((id) => ({
        itemId: id, name: (itemNames.data ?? []).find((i) => i.id === id)?.name ?? id,
        before: rollupItemCost(gBefore, id, cb).cost, after: rollupItemCost(gAfter, id, ca).cost,
      })),
    });
  }

  const expectedVersionId = live.scopeVersionId;
  const basedOnVersionId = live.ridesDefault ? live.globalVersionId : null;
  // THE TOKEN BINDS THE COMPLETE PROPOSED CHANGE (lead decision; Astra 3b r1#3): the act as posted (a line edit's
  // op INCLUDING the baseline it was drafted against), the versions seen, the snapshot, the lines after, and every
  // number and shop shown. A price, a pack, a nested recipe or another shop's version that moved changes it.
  const token = recipePreviewToken({
    kind: change.kind, recipeId, target, op: change.kind === "lines" ? change.op : null,
    expectedVersionId, basedOnVersionId, sourceVersionId, snapshot,
    after: after.map((f) => [f.componentSkuId, f.componentItemId, f.componentProductId, f.quantity, f.unit, f.eachContainerLabel, f.portioned]),
    reached: reached.map((r) => ({
      scope: r.scope,
      menu: r.menu.map((m) => [m.menuItemId, m.before, m.after, m.statusBefore, m.statusAfter]),
      items: r.items.map((i) => [i.itemId, i.before, i.after]),
    })),
    untouched: untouched.map((u) => u.shopId), returnedShop: returnedShop?.shopId ?? null,
    flagged: flagged.map((f) => [f.position, f.reason]), dropsLinkTo,
  });
  return {
    kind: change.kind, recipeId, target, changes: diffRecipeLineSets(before, after), names, reached, untouched, returnedShop,
    flagged, dropsLinkTo, expectedVersionId, basedOnVersionId, token, snapshot,
  };
}

/** Save EXACTLY what the preview showed: recompute it, refuse preview_stale on any difference, then write. */
export async function applyRecipeChange(
  actor: AuthContext, recipeId: string, change: RecipeChangeRequest, token: string,
): Promise<{ versionId: string | null }> {
  const preview = await computeRecipePreview(actor, recipeId, change);
  if (preview.token !== token) throw new RecipeVersionError(409, "preview_stale");
  const scope: VersionScope = preview.target.kind === "shop" ? preview.target.shopId : null;
  // The SAME snapshot the matching token was computed on goes to the writer; SQL re-takes it under the
  // graph lock and refuses dependencies_changed if anything moved since (the 0261 pattern).
  const snapshot = preview.snapshot;
  switch (change.kind) {
    case "lines": {
      const r = await saveRecipeLines(actor, { recipeId, scope, expectedVersionId: preview.expectedVersionId, basedOnVersionId: preview.basedOnVersionId, op: change.op, snapshot });
      return { versionId: r.versionId };
    }
    case "restore": {
      const r = await restoreRecipeVersion(actor, { recipeId, scope, fromVersionId: change.fromVersionId, expectedVersionId: preview.expectedVersionId, basedOnVersionId: preview.basedOnVersionId, snapshot });
      return { versionId: r.versionId };
    }
    case "back_to_default": {
      await retireShopRecipeVersion(actor, { recipeId, versionId: preview.expectedVersionId!, locationId: change.shopId, snapshot });
      return { versionId: null };
    }
    case "adopt": {
      const r = await adoptRecipeVersion(actor, { recipeId, locationId: change.shopId, sourceVersionId: change.sourceVersionId, expectedVersionId: preview.expectedVersionId, basedOnVersionId: preview.basedOnVersionId, snapshot });
      return { versionId: r.versionId };
    }
    case "promote": {
      const r = await promoteRecipeVersion(actor, { recipeId, sourceVersionId: change.sourceVersionId, expectedGlobalVersionId: preview.expectedVersionId, snapshot });
      return { versionId: r.versionId };
    }
  }
}
