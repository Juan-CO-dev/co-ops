/**
 * The MENU ITEM PAGE — server half (catalog Phase 3b; spec §3 "menu items incl. shop price and sold
 * here", §4). SERVER-ONLY. The view, the preview of ONE act (save / back to default / restore / promote)
 * with this scope's food cost and the margin before → after, and apply-with-token over 3a's gated writers.
 * GATES LIVE HERE (house rule): menuShopWriteGate / menuPromoteGate take the ROLE (the social media manager
 * is refused) and the shop bind, before any I/O; the writers bind again.
 */
import { ownerVisible, ownerWriteCheck, shareGate } from "@/lib/catalog/shop-owned-shared";
import { updateMenuPrice, MenuPriceError } from "@/lib/admin/menu-prices";
import { isValidMenuPrice } from "@/lib/toast/in-store-prices-shared";
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { catalogShopAllowed, catalogWriteRoleAllowed, NIL_SCOPE, type VersionScope } from "@/lib/sku-versions-shared";
import { loadLiveMenuItemShopSettings, MENU_SHOP_SETTING_COLUMNS } from "@/lib/menu-item-shop";
import {
  menuPromoteGate, menuShopWriteGate, resolveMenuItemForShop, type MenuItemShopSettingRow, type ResolvedMenuItem,
} from "@/lib/menu-item-shop-shared";
import {
  MenuShopError, loadMenuChangeSnapshot, loadMenuItemShopHistory, promoteMenuItemShopSetting, restoreMenuItemShopSetting,
  retireMenuItemShopSetting, saveMenuItemShopSetting,
} from "@/lib/admin/menu-item-shop";
import {
  menuPreviewMath, menuPreviewToken, menuPromoteChangedShops, menuPromoteNames, normalizeMenuPatch, type MenuPreview, type MenuPreviewSide,
} from "@/lib/catalog/recipe-preview-shared";
import type { MenuChangeRequest, MenuItemPageView } from "@/lib/catalog/recipe-item-shared";
import { loadActiveShops } from "@/lib/catalog/recipe-item";

type Sb = ReturnType<typeof getServiceRoleClient>;
type MenuRow = { id: string; name: string; name_es: string | null; menu_price: number | string | null; section: string | null; active: boolean; location_id: string | null };

const num = (v: number | string | null): number | null => (v === null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function loadItem(sb: Sb, menuItemId: string): Promise<MenuRow | null> {
  const { data, error } = await sb.from("menu_items").select("id, name, name_es, menu_price, section, active, location_id").eq("id", menuItemId).maybeSingle<MenuRow>();
  if (error) throw new Error(`menu item: ${error.message}`);
  return data && data.active ? data : null;
}

async function costAt(menuItemId: string, scope: VersionScope): Promise<number | null> {
  const graph = await loadRecipeGraph(scope === null ? undefined : { locationId: scope });
  const costPerOz = costPerOzFromGraph(graph, await loadCurrentSkuPrices([...graph.skuPack.keys()], scope));
  return rollupMenuItemCost(graph, menuItemId, costPerOz).cost;
}

export async function loadMenuItemPageView(actor: AuthContext, menuItemId: string, scope: VersionScope): Promise<MenuItemPageView | null> {
  // Level 6 OPERATIONAL managers and up — a ROLE check (the social media manager is refused), in the lib.
  if (actor.level < 6 || !catalogWriteRoleAllowed(actor.user.role, actor.level)) throw new MenuShopError(403, "forbidden");
  const sb = getServiceRoleClient();
  const shops = await loadActiveShops(sb);
  if (scope !== null && !shops.some((s) => s.id === scope)) throw new MenuShopError(404, "not_found");
  const item = await loadItem(sb, menuItemId);
  if (!item || !ownerVisible(item.location_id, scope)) return null;
  const owner = item.location_id ?? null;
  if (owner !== null && !catalogShopAllowed(actor, owner)) return null;
  const ownedActor = { role: actor.user.role, level: actor.level, locations: actor.locations };
  const setting = scope === null || owner !== null ? undefined : (await loadLiveMenuItemShopSettings(scope)).get(menuItemId);
  const here = resolveMenuItemForShop({ id: item.id, name: item.name, nameEs: item.name_es, menuPrice: num(item.menu_price) }, setting);
  const toastQuery = sb.from("toast_menu_map").select("id").eq("menu_item_id", menuItemId).eq("active", true).eq("match_status", "confirmed");
  const [{ data: outs, error: oErr }, toast] = await Promise.all([
    sb.from("recipe_outputs").select("recipe_id").eq("output_menu_item_id", menuItemId).returns<Array<{ recipe_id: string }>>(),
    (scope === null ? toastQuery : toastQuery.eq("location_id", scope)).returns<Array<{ id: string }>>(),
  ]);
  if (oErr) throw new Error(`menu item recipe: ${oErr.message}`);
  if (toast.error) throw new Error(`menu item toast links: ${toast.error.message}`);
  const recipeIds = [...new Set((outs ?? []).map((o) => o.recipe_id))];
  const { data: recipes, error: rErr } = recipeIds.length
    ? await sb.from("recipes").select("id, name").in("id", recipeIds).eq("active", true).order("created_at", { ascending: true }).order("id", { ascending: true })
        .returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  if (rErr) throw new Error(`menu item recipes: ${rErr.message}`);
  const history = scope === null || owner !== null ? [] : await loadMenuItemShopHistory(actor, menuItemId, scope);
  return {
    owner: owner === null ? null : { locationId: owner, name: shops.find(s => s.id === owner)?.name ?? "" },
    item: { id: item.id, name: item.name, nameEs: item.name_es, menuPrice: num(item.menu_price), section: item.section },
    shops, scope, scopeName: scope === null ? null : (shops.find((s) => s.id === scope)?.name ?? null),
    can: {
      editShop: owner === null && scope !== null && writeGate(actor, scope),
      ...(owner !== null ? { editOwned: ownerWriteCheck(ownedActor, owner).ok, share: shareGate(ownedActor).ok } : {}),
      // Promote is everyone's (MoO+), the role rule included — the same gate computeMenuPreview runs.
      promote: owner === null && menuPromoteGate({ role: actor.user.role, level: actor.level }).ok,
      // No dead ends: the shops this actor may change the item for, offered wherever this view is read-only.
      shopsToEdit: owner === null ? shops.filter((s) => writeGate(actor, s.id)) : [],
    },
    here: {
      settingId: setting?.id ?? null, price: num(setting?.price ?? null), soldHere: setting?.sold_here ?? true,
      nameOverride: setting?.name_override ?? null, nameOverrideEs: setting?.name_override_es ?? null,
      name: here.name, nameEs: here.nameEs, typedPrice: here.typedPrice,
    },
    cost: await costAt(menuItemId, scope),
    recipe: recipes?.[0] ?? null,
    toastLinks: (toast.data ?? []).length,
    history: history.map((h) => ({
      id: h.id, active: h.active !== false && h.valid_to === null, validFrom: h.valid_from, validTo: h.valid_to, who: h.createdByName,
      price: num(h.price), soldHere: h.sold_here, nameOverride: h.name_override, nameOverrideEs: h.name_override_es,
    })),
  };
}

/** May this actor change the item for this shop? (the role rule and the shop bind — the lib's gate, as the writers run it) */
function writeGate(actor: AuthContext, shopId: string): boolean {
  return menuShopWriteGate({ role: actor.user.role, level: actor.level, scopeAllowed: catalogShopAllowed(actor, shopId) }).ok;
}

/** One setting row by id (bounded by its id). */
async function settingRow(sb: Sb, settingId: string): Promise<MenuItemShopSettingRow | null> {
  const { data, error } = await sb.from("menu_item_shop_settings").select(MENU_SHOP_SETTING_COLUMNS).eq("id", settingId).maybeSingle<MenuItemShopSettingRow>();
  if (error) throw new Error(`menu setting: ${error.message}`);
  return data;
}

function side(r: ResolvedMenuItem): MenuPreviewSide {
  return { name: r.name, nameEs: r.nameEs, price: r.typedPrice, soldHere: r.soldHere, inherits: { price: !r.overrides.price, name: !r.overrides.name } };
}

export async function computeMenuPreview(actor: AuthContext, menuItemId: string, change: MenuChangeRequest): Promise<MenuPreview> {
  if (change.kind === "owned_price") {
    const gate = ownerWriteCheck({ role: actor.user.role, level: actor.level, locations: actor.locations }, change.expectedOwner);
    if (!gate.ok) throw new MenuShopError(gate.status, gate.code);
    if (!isValidMenuPrice(change.price)) throw new MenuShopError(400, "invalid_menu_price");
    const item = await loadItem(getServiceRoleClient(), menuItemId);
    if (!item) throw new MenuShopError(404, "not_found");
    if (item.location_id !== change.expectedOwner) throw new MenuShopError(409, "ownership_changed");
    if (num(item.menu_price) !== change.expectedPrice) throw new MenuShopError(409, "menu_price_changed");
    const before: MenuPreviewSide = { name: item.name, nameEs: item.name_es, price: num(item.menu_price), soldHere: true, inherits: { price: false, name: false } };
    const after = { ...before, price: change.price };
    const cost = await costAt(menuItemId, change.expectedOwner);
    const math = menuPreviewMath({ before: before.price, after: after.price, cost });
    return { kind: "owned_price", menuItemId, shopId: change.expectedOwner, before, after, cost, ...math,
      changedShops: [], returnedShop: null, spanishFallsBackToEnglish: item.name_es === null,
      snapshot: {}, expectedSettingId: null, expectedGlobal: null,
      token: menuPreviewToken({ kind: change.kind, menuItemId, owner: change.expectedOwner, before, after, cost, ...math }) };
  }
  if (change.kind === "promote") {
    const gate = menuPromoteGate({ role: actor.user.role, level: actor.level });
    if (!gate.ok) throw new MenuShopError(gate.status, gate.code);
    // The lib's own rule for the optional Spanish name: only with the name promoted (named, before any I/O).
    if (change.nameEs !== undefined && !change.fields.includes("name")) throw new MenuShopError(400, "invalid_payload");
  } else {
    const gate = menuShopWriteGate({ role: actor.user.role, level: actor.level, scopeAllowed: catalogShopAllowed(actor, change.shopId) });
    if (!gate.ok) throw new MenuShopError(gate.status, gate.code);
  }
  const sb = getServiceRoleClient();
  // THE SCOPED DEPENDENCY SNAPSHOT FIRST (lead decision (a)): the item, its live shop rows, the active shops and
  // the cost closure at the scope whose cost is shown (a promote shows the default's: NIL_SCOPE, as the lib's
  // promote takes it). The token binds it with every number shown; the writer takes the same closure's locks.
  const item = await loadItem(sb, menuItemId);
  if (!item) throw new MenuShopError(404, "menu_item_not_found");
  if (!ownerVisible(item.location_id, change.kind === "promote" ? null : change.shopId)) throw new MenuShopError(404, "not_found");
  if (item.location_id != null) throw new MenuShopError(409, "menu_item_has_no_shop_settings");
  const snapshot = await loadMenuChangeSnapshot(menuItemId, change.kind === "promote" ? NIL_SCOPE : change.shopId);
  const g = { id: item.id, name: item.name, nameEs: item.name_es, menuPrice: num(item.menu_price) };

  if (change.kind === "promote") {
    const row = await settingRow(sb, change.settingId);
    if (!row || row.menu_item_id !== menuItemId || row.valid_to !== null || row.active === false) throw new MenuShopError(404, "not_found");
    const wantPrice = change.fields.includes("price");
    const wantName = change.fields.includes("name");
    if ((wantPrice && num(row.price) === null) || (wantName && row.name_override === null)) throw new MenuShopError(400, "nothing_to_promote");
    const shops = await loadActiveShops(sb);
    type Live = { id: string; location_id: string; price: number | string | null; name_override: string | null };
    const others = await selectAllRows<Live>(async (from, to) => {
      const { data, error } = await sb.from("menu_item_shop_settings").select("id, location_id, price, name_override")
        .eq("menu_item_id", menuItemId).eq("active", true).order("id", { ascending: true }).range(from, to).returns<Live[]>();
      if (error) throw new Error(`menu promote shops: ${error.message}`);
      return { data };
    });
    // THE NAMES ARE SHOWN TRUTHFULLY (CC note 1 #2): the shop's pair copied exactly — "no Spanish name" included,
    // never the old default's — plus the optional typed Spanish name; empty → "Spanish users will see the English name".
    const names = menuPromoteNames({
      fields: change.fields, global: { name: g.name, nameEs: g.nameEs },
      source: { nameOverride: row.name_override, nameOverrideEs: row.name_override_es }, typedNameEs: change.nameEs ?? null,
    });
    const after: MenuPreviewSide = {
      name: names.after.name, nameEs: names.after.nameEs,
      price: wantPrice ? num(row.price) : g.menuPrice, soldHere: true, inherits: { price: false, name: false },
    };
    const before: MenuPreviewSide = { name: g.name, nameEs: g.nameEs, price: g.menuPrice, soldHere: true, inherits: { price: false, name: false } };
    const cost = await costAt(menuItemId, null);
    const expectedGlobal = { price: g.menuPrice, name: g.name, nameEs: g.nameEs };
    // FIELD BY FIELD (Astra 3b r1#4) — the same predicate 0263 returns as changed_shops.
    const changedShops = menuPromoteChangedShops({ shops, sourceShopId: row.location_id, fields: change.fields, live: others });
    const returnedShop = { shopId: row.location_id, shopName: shops.find((s) => s.id === row.location_id)?.name ?? "" };
    const math = menuPreviewMath({ before: g.menuPrice, after: after.price, cost });
    return {
      kind: "promote", menuItemId, shopId: null, before, after, cost,
      ...math, changedShops, returnedShop, spanishFallsBackToEnglish: names.spanishFallsBackToEnglish,
      snapshot, expectedSettingId: change.settingId, expectedGlobal,
      // The COMPLETE change: the setting, the fields, the typed Spanish name, the global values seen, both sides,
      // the snapshot and every number and shop shown.
      token: menuPreviewToken({
        kind: "promote", menuItemId, settingId: change.settingId, fields: change.fields, nameEs: change.nameEs ?? null,
        expectedGlobal, before, after, snapshot, cost, margins: [math.marginBefore, math.marginAfter],
        changed: changedShops.map((c) => c.shopId), returned: returnedShop.shopId,
      }),
    };
  }

  const live = (await loadLiveMenuItemShopSettings(change.shopId)).get(menuItemId);
  const beforeResolved = resolveMenuItemForShop(g, live);
  let afterRow: MenuItemShopSettingRow | undefined;
  if (change.kind === "save") {
    const p = normalizeMenuPatch(change.patch);
    afterRow = {
      id: "preview", menu_item_id: menuItemId, location_id: change.shopId, based_on_setting_id: live?.id ?? null,
      price: p.price, sold_here: p.soldHere, name_override: p.nameOverride, name_override_es: p.nameOverrideEs,
      valid_from: new Date(0).toISOString(), valid_to: null, created_by: null,
    };
  } else if (change.kind === "restore") {
    const row = await settingRow(sb, change.fromSettingId);
    if (!row || row.menu_item_id !== menuItemId || row.location_id !== change.shopId) throw new MenuShopError(404, "not_found");
    afterRow = row;
  } else if (!live) {
    throw new MenuShopError(409, "not_live");
  }
  const afterResolved = resolveMenuItemForShop(g, afterRow);
  const cost = await costAt(menuItemId, change.shopId);
  const expectedSettingId = live?.id ?? null;
  const beforeView = side(beforeResolved);
  const afterView = side(afterResolved);
  const math = menuPreviewMath({ before: beforeResolved.typedPrice, after: afterResolved.typedPrice, cost });
  return {
    kind: change.kind, menuItemId, shopId: change.shopId, before: beforeView, after: afterView, cost,
    ...math, changedShops: [], returnedShop: null, spanishFallsBackToEnglish: afterView.nameEs === null,
    snapshot, expectedSettingId, expectedGlobal: null,
    // THE TOKEN BINDS THE COMPLETE PROPOSED CHANGE (Astra 3b r4#2): the normalized patch the writer will store
    // (every field — the Spanish name and "inherit" included), both full sides, the snapshot and every number shown.
    token: menuPreviewToken({
      kind: change.kind, menuItemId, shopId: change.shopId, expectedSettingId,
      patch: change.kind === "save" ? normalizeMenuPatch(change.patch) : null,
      source: change.kind === "restore" ? change.fromSettingId : null,
      before: beforeView, after: afterView, snapshot, cost, margins: [math.marginBefore, math.marginAfter],
    }),
  };
}

/**
 * Save EXACTLY the previewed menu act. A promote with a typed Spanish name runs chunk 1's two-step
 * promoteMenuItemShopSetting: if it then refuses, the MenuShopError carries `spanishNameSaved` (the shop's own
 * label changed and is in History; the promote did not happen — CC note 2 #3) for the route to pass on.
 */
export async function applyMenuChange(actor: AuthContext, menuItemId: string, change: MenuChangeRequest, token: string): Promise<{ ok: true }> {
  const preview = await computeMenuPreview(actor, menuItemId, change);
  if (preview.token !== token) throw new MenuShopError(409, "preview_stale");
  // The snapshot the matching token was computed on; SQL re-takes it under the menu item row lock.
  const snapshot = preview.snapshot;
  switch (change.kind) {
    case "owned_price":
      try { await updateMenuPrice(actor, menuItemId, change.price, change.expectedPrice, change.expectedOwner); }
      catch (error) { if (error instanceof MenuPriceError) throw new MenuShopError(error.status, error.code); throw error; }
      break;
    case "save":
      await saveMenuItemShopSetting(actor, { menuItemId, locationId: change.shopId, expectedSettingId: preview.expectedSettingId, patch: change.patch, snapshot });
      break;
    case "back_to_default":
      await retireMenuItemShopSetting(actor, { menuItemId, locationId: change.shopId, settingId: preview.expectedSettingId!, snapshot });
      break;
    case "restore":
      await restoreMenuItemShopSetting(actor, { menuItemId, locationId: change.shopId, fromSettingId: change.fromSettingId, expectedSettingId: preview.expectedSettingId, snapshot });
      break;
    case "promote":
      await promoteMenuItemShopSetting(actor, {
        menuItemId, settingId: change.settingId, fields: change.fields, expected: preview.expectedGlobal!, nameEs: change.nameEs ?? null, snapshot,
      });
      break;
  }
  return { ok: true };
}
