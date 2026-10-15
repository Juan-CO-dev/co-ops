/**
 * THE SHOP CHANGES LIST (MoO+, Cristian) and THE GM NOTICES read (catalog Phase 3b; spec §6).
 * SERVER-ONLY. The list: every LIVE shop recipe version and menu overlay — what changed against today's
 * global default, where, who, when — newest first. The notices: computeRecipeNotices over exactly the
 * versions a shop's notices can depend on (its adopted versions' sources; recent promotions).
 * GATES LIVE HERE (house rule): the list takes MoO+ AND the role rule; the notices take the shop write gate
 * (GM floor, role rule, shop bind) — the social media manager is refused by role, never only by level.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { selectAllRows } from "@/lib/supabase-paginate";
import { assertScopeToken, catalogShopAllowed, catalogWriteRoleAllowed, GLOBAL_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";
import { lineFromRow, type RecipeLineFields, type RecipeLineRow } from "@/lib/recipe-line-shared";
import { diffRecipeLineSets, recipeVersionWriteGate } from "@/lib/recipe-versions-shared";
import { RecipeVersionError } from "@/lib/admin/recipe-versions";
import { MENU_SHOP_SETTING_COLUMNS } from "@/lib/menu-item-shop";
import type { MenuItemShopSettingRow } from "@/lib/menu-item-shop-shared";
import {
  computeRecipeNotices, NEW_DEFAULT_NOTICE_DAYS, type NoticeDismissalRow, type NoticeVersionRow, type RecipeNotice,
} from "@/lib/catalog/recipe-notices-shared";
import type { ShopChangesView } from "@/lib/catalog/recipe-item-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;
const VERSION_COLUMNS = "id, recipe_id, location_id, valid_from, valid_to, active, adopted_from_version_id, promoted_from_version_id, based_on_version_id, created_by";
const LINE_COLUMNS = "id, version_id, recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order";
/** The id-list chunk for `.in()` reads (the request-line budget; 2a's ID_CHUNK). */
const ID_CHUNK = 100;
type VersionRow = NoticeVersionRow & { created_by: string | null };
type LineRow = RecipeLineRow & { id: string; version_id?: string; recipe_id?: string; display_order: number | null };

/**
 * EVERY READ HERE IS PAGED (stable order, `range`) AND EVERY ID LIST IS CHUNKED (Astra 3b r1#9): once the live
 * shop versions' lines pass the PostgREST 1000-row cap, a truncated read would make diffRecipeLineSets
 * report false additions and removals. `inChunks` runs one paged read per id chunk and concatenates.
 */
async function inChunks<T>(ids: readonly string[], read: (chunk: string[], from: number, to: number) => Promise<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    out.push(...await selectAllRows<T>((from, to) => read(chunk, from, to)));
  }
  return out;
}

async function names(sb: Sb, table: "recipes" | "locations" | "users" | "menu_items" | "vendor_items" | "items" | "products", ids: string[]): Promise<Map<string, string>> {
  const rows = await inChunks<{ id: string; name: string }>([...new Set(ids)], async (chunk, from, to) => {
    const { data, error } = await sb.from(table).select("id, name").in("id", chunk).order("id", { ascending: true }).range(from, to)
      .returns<Array<{ id: string; name: string }>>();
    if (error) throw new Error(`shop changes ${table}: ${error.message}`);
    return { data };
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function loadShopChanges(actor: AuthContext): Promise<ShopChangesView> {
  // MoO+ AND the role rule, in the lib (house rule; the route is the outer layer).
  if (actor.level < GLOBAL_VERSION_WRITE_MIN || !catalogWriteRoleAllowed(actor.user.role, actor.level)) throw new RecipeVersionError(403, "forbidden");
  const sb = getServiceRoleClient();
  const vs = await selectAllRows<VersionRow>(async (from, to) => {
    const { data, error } = await sb.from("recipe_versions").select(VERSION_COLUMNS).not("location_id", "is", null).eq("active", true)
      .order("valid_from", { ascending: false }).order("id", { ascending: true }).range(from, to).returns<VersionRow[]>();
    if (error) throw new Error(`shop changes versions: ${error.message}`);
    return { data };
  });
  const recipeIds = [...new Set(vs.map((v) => v.recipe_id))];
  const adoptedIds = [...new Set(vs.map((v) => v.adopted_from_version_id).filter((x): x is string => x !== null))];
  const [shopLines, globalLines, adopted] = await Promise.all([
    inChunks<LineRow>(vs.map((v) => v.id), async (chunk, from, to) => {
      const { data, error } = await sb.from("recipe_version_lines").select(LINE_COLUMNS).in("version_id", chunk)
        .order("version_id", { ascending: true }).order("display_order", { ascending: true }).order("id", { ascending: true })
        .range(from, to).returns<LineRow[]>();
      if (error) throw new Error(`shop changes lines: ${error.message}`);
      return { data };
    }),
    // The global default's LIVE lines stay in recipe_inputs (3a judgment call 1).
    inChunks<LineRow>(recipeIds, async (chunk, from, to) => {
      const { data, error } = await sb.from("recipe_inputs")
        .select("id, recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order")
        .in("recipe_id", chunk).order("recipe_id", { ascending: true }).order("display_order", { ascending: true }).order("id", { ascending: true })
        .range(from, to).returns<LineRow[]>();
      if (error) throw new Error(`shop changes default lines: ${error.message}`);
      return { data };
    }),
    inChunks<{ id: string; location_id: string | null }>(adoptedIds, async (chunk, from, to) => {
      const { data, error } = await sb.from("recipe_versions").select("id, location_id").in("id", chunk)
        .order("id", { ascending: true }).range(from, to).returns<Array<{ id: string; location_id: string | null }>>();
      if (error) throw new Error(`shop changes adopted: ${error.message}`);
      return { data };
    }),
  ]);
  const byVersion = new Map<string, RecipeLineFields[]>();
  for (const l of shopLines) byVersion.set(l.version_id!, [...(byVersion.get(l.version_id!) ?? []), lineFromRow(l)]);
  const byRecipe = new Map<string, RecipeLineFields[]>();
  for (const l of globalLines) byRecipe.set(l.recipe_id!, [...(byRecipe.get(l.recipe_id!) ?? []), lineFromRow(l)]);
  const adoptedShop = new Map(adopted.map((a) => [a.id, a.location_id]));

  const ss = await selectAllRows<MenuItemShopSettingRow>(async (from, to) => {
    const { data, error } = await sb.from("menu_item_shop_settings").select(MENU_SHOP_SETTING_COLUMNS).eq("active", true)
      .order("valid_from", { ascending: false }).order("id", { ascending: true }).range(from, to).returns<MenuItemShopSettingRow[]>();
    if (error) throw new Error(`shop changes menu: ${error.message}`);
    return { data };
  });
  const menuIds = [...new Set(ss.map((s) => s.menu_item_id))];
  type MenuRow = { id: string; name: string; name_es: string | null; menu_price: number | string | null };
  const menu = await inChunks<MenuRow>(menuIds, async (chunk, from, to) => {
    const { data, error } = await sb.from("menu_items").select("id, name, name_es, menu_price").in("id", chunk)
      .order("id", { ascending: true }).range(from, to).returns<MenuRow[]>();
    if (error) throw new Error(`shop changes menu items: ${error.message}`);
    return { data };
  });
  const menuBy = new Map(menu.map((m) => [m.id, m]));

  const shopIds = [...new Set([...vs.map((v) => v.location_id!), ...ss.map((s) => s.location_id), ...[...adoptedShop.values()].filter((x): x is string => x !== null)])];
  const userIds = [...new Set([...vs.map((v) => v.created_by), ...ss.map((s) => s.created_by)].filter((u): u is string => u !== null))];
  const allLines = [...byVersion.values(), ...byRecipe.values()].flat();
  const ids = (k: "componentSkuId" | "componentItemId" | "componentProductId") => [...new Set(allLines.map((l) => l[k]).filter((v): v is string => typeof v === "string"))];
  const [recipeNames, shopNames, userNames, skuN, itemN, productN] = await Promise.all([
    names(sb, "recipes", recipeIds), names(sb, "locations", shopIds), names(sb, "users", userIds),
    names(sb, "vendor_items", ids("componentSkuId")), names(sb, "items", ids("componentItemId")), names(sb, "products", ids("componentProductId")),
  ]);
  const keyNames: Record<string, string> = {};
  for (const [id, name] of skuN) keyNames[`sku:${id}`] = name;
  for (const [id, name] of itemN) keyNames[`item:${id}`] = name;
  for (const [id, name] of productN) keyNames[`product:${id}`] = name;

  return {
    recipes: vs.map((v) => {
      const changes = diffRecipeLineSets(byRecipe.get(v.recipe_id) ?? [], byVersion.get(v.id) ?? []);
      const fromShop = v.adopted_from_version_id ? adoptedShop.get(v.adopted_from_version_id) ?? null : null;
      return {
        recipeId: v.recipe_id, recipeName: recipeNames.get(v.recipe_id) ?? v.recipe_id, versionId: v.id,
        shopId: v.location_id!, shopName: shopNames.get(v.location_id!) ?? "", validFrom: v.valid_from,
        createdByName: v.created_by ? (userNames.get(v.created_by) ?? null) : null,
        adoptedFromShopName: fromShop ? (shopNames.get(fromShop) ?? null) : null, changes, sameAsDefault: changes.length === 0,
      };
    }),
    menu: ss.map((s) => {
      const m = menuBy.get(s.menu_item_id);
      return {
        menuItemId: s.menu_item_id, menuItemName: m?.name ?? s.menu_item_id, settingId: s.id, shopId: s.location_id,
        shopName: shopNames.get(s.location_id) ?? "", validFrom: s.valid_from, createdByName: s.created_by ? (userNames.get(s.created_by) ?? null) : null,
        price: s.price === null ? null : Number(s.price), soldHere: s.sold_here, nameOverride: s.name_override, nameOverrideEs: s.name_override_es,
        global: { price: m?.menu_price == null ? null : Number(m.menu_price), name: m?.name ?? "", nameEs: m?.name_es ?? null },
      };
    }),
    names: keyNames,
  };
}

/**
 * The notices for ONE shop, actor-free (callers gate): the shop's live adopted versions and every
 * version of their source shops for those recipes; the global heads promoted within the window, the
 * versions they came from, and the global versions promoted FROM any source version (so "its version is
 * the default now" can be told apart from "it went back to the default"); the shop's dismissals. Paged.
 */
export async function computeShopNotices(sb: Sb, shopId: string, now: string): Promise<RecipeNotice[]> {
  const cutoff = new Date(Date.parse(now) - NEW_DEFAULT_NOTICE_DAYS * 86_400_000).toISOString();
  const paged = (label: string, q: (from: number, to: number) => PromiseLike<{ data: VersionRow[] | null; error: { message: string } | null }>) =>
    selectAllRows<VersionRow>(async (from, to) => {
      const { data, error } = await q(from, to);
      if (error) throw new Error(`shop notices ${label}: ${error.message}`);
      return { data };
    });
  const [mine, promoted, dismissals] = await Promise.all([
    paged("mine", (from, to) => sb.from("recipe_versions").select(VERSION_COLUMNS).eq("location_id", assertScopeToken(shopId)).eq("active", true)
      .order("id", { ascending: true }).range(from, to).returns<VersionRow[]>()),
    paged("promoted", (from, to) => sb.from("recipe_versions").select(VERSION_COLUMNS).is("location_id", null).eq("active", true)
      .not("promoted_from_version_id", "is", null).gte("valid_from", cutoff).order("id", { ascending: true }).range(from, to).returns<VersionRow[]>()),
    selectAllRows<NoticeDismissalRow>(async (from, to) => {
      const { data, error } = await sb.from("recipe_notice_dismissals").select("recipe_id, kind, seen_version_id").eq("location_id", shopId)
        .order("id", { ascending: true }).range(from, to).returns<NoticeDismissalRow[]>();
      if (error) throw new Error(`shop notices dismissals: ${error.message}`);
      return { data };
    }),
  ]);
  const sourceIds = [...new Set([...mine.map((v) => v.adopted_from_version_id), ...promoted.map((v) => v.promoted_from_version_id)].filter((x): x is string => x !== null))];
  const sources = await inChunks<VersionRow>(sourceIds, async (chunk, from, to) => {
    const { data, error } = await sb.from("recipe_versions").select(VERSION_COLUMNS).in("id", chunk).order("id", { ascending: true })
      .range(from, to).returns<VersionRow[]>();
    if (error) throw new Error(`shop notices sources: ${error.message}`);
    return { data };
  });
  const adoptedRecipes = [...new Set(mine.filter((v) => v.adopted_from_version_id).map((v) => v.recipe_id))];
  const sourceShops = [...new Set(sources.map((s) => s.location_id).filter((x): x is string => x !== null))];
  const sourceHistory = adoptedRecipes.length && sourceShops.length
    ? await inChunks<VersionRow>(adoptedRecipes, async (chunk, from, to) => {
        const { data, error } = await sb.from("recipe_versions").select(VERSION_COLUMNS).in("recipe_id", chunk).in("location_id", sourceShops)
          .order("id", { ascending: true }).range(from, to).returns<VersionRow[]>();
        if (error) throw new Error(`shop notices source history: ${error.message}`);
        return { data };
      })
    : [];
  // The global versions PROMOTED FROM any of those source versions (any age): a retired source that was
  // promoted reads "it is the default now", not "it went back to the default".
  const promotedFrom = await inChunks<VersionRow>([...new Set(sourceHistory.map((v) => v.id))], async (chunk, from, to) => {
    const { data, error } = await sb.from("recipe_versions").select(VERSION_COLUMNS).is("location_id", null).in("promoted_from_version_id", chunk)
      .order("id", { ascending: true }).range(from, to).returns<VersionRow[]>();
    if (error) throw new Error(`shop notices promoted from: ${error.message}`);
    return { data };
  });
  const versions = [...new Map([...mine, ...promoted, ...sources, ...sourceHistory, ...promotedFrom].map((v) => [v.id, v])).values()];
  const recipeIds = [...new Set(versions.map((v) => v.recipe_id))];
  const shopIds = [...new Set(versions.map((v) => v.location_id).filter((x): x is string => x !== null))];
  const [recipeNames, shopNames] = await Promise.all([names(sb, "recipes", recipeIds), names(sb, "locations", shopIds)]);
  return computeRecipeNotices({ shopId, versions, dismissals, recipeNames, shopNames, now });
}

/** The GM's notices page: its own shops (MoO+ any) — the shop write gate (GM floor, role rule, shop bind), in the lib. */
export async function loadShopNotices(actor: AuthContext, shopId: string): Promise<RecipeNotice[]> {
  const gate = recipeVersionWriteGate({ role: actor.user.role, level: actor.level, scope: shopId, scopeAllowed: catalogShopAllowed(actor, shopId) });
  if (!gate.ok) throw new RecipeVersionError(gate.status, gate.code);
  return computeShopNotices(getServiceRoleClient(), shopId, new Date().toISOString());
}
