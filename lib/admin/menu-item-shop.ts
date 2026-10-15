/**
 * MENU ITEMS PER SHOP — the gated writers and the history read (catalog Phase 3a, 0263). SERVER-ONLY,
 * service role. The lib is the authority (spec §2): a GM (7) writes only its own shops' overlay, MoO
 * (8)+ any active shop (catalogShopAllowed) — decided HERE before any I/O (requireLocation). The
 * optimistic compare-and-set and the menu item row lock live in SQL. Every write is audited.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { assertScopeToken, catalogShopAllowed, catalogWriteRoleAllowed } from "@/lib/sku-versions-shared";
import { menuShopWriteGate, type MenuItemShopSettingRow, type MenuShopPatch } from "@/lib/menu-item-shop-shared";
import { MENU_SHOP_SETTING_COLUMNS } from "@/lib/menu-item-shop";

export class MenuShopError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "MenuShopError";
  }
}

/** THE BIND (a BIND_PRIMITIVES name): role + shop, before any I/O (the role rule refuses the social media manager). */
function requireLocation(actor: AuthContext, locationId: string): void {
  const gate = menuShopWriteGate({ role: actor.user.role, level: actor.level, scopeAllowed: catalogShopAllowed(actor, locationId) });
  if (!gate.ok) throw new MenuShopError(gate.status, gate.code);
}

const RPC_STATUS: Record<string, number> = {
  version_changed: 409, not_live: 409, global_changed: 409, dependencies_changed: 409, dependencies_busy: 409,
  invalid_price: 400, invalid_name: 400, empty_setting: 400, invalid_source: 400, invalid_payload: 400, nothing_to_promote: 400,
  menu_item_not_found: 404, location_not_found: 404, not_found: 404,
};

export function menuShopErrorFromRpc(message: string): never {
  // 'recipe_version:dependencies_busy' comes from 0262's closure locks, which the menu writers take too.
  const code = /(?:menu_item_shop|recipe_version):([a-z_]+)/.exec(message)?.[1];
  if (code && RPC_STATUS[code]) throw new MenuShopError(RPC_STATUS[code]!, code);
  throw new Error(`menu-shop rpc failed: ${message}`);
}

/**
 * THE DEPENDENCY SNAPSHOT (0263 menu_item_change_snapshot): the item, every shop's live row, the active
 * shops and the cost CLOSURE of every recipe that makes it at the scope shown (scoped, never a whole table).
 * A preview takes it before computing; every writer hands it to SQL, which takes the graph lock, the item row and
 * the closure locks, then re-takes it: `dependencies_changed` on any difference, `dependencies_busy` if busy.
 */
export type MenuChangeSnapshot = Record<string, unknown>;

/** The SCOPED snapshot (0263): `locationId` is the scope whose cost the preview shows (null = the default, a promote). */
export async function loadMenuChangeSnapshot(menuItemId: string, locationId: string | null): Promise<MenuChangeSnapshot> {
  const { data, error } = await getServiceRoleClient().rpc("menu_item_change_snapshot", { p_menu_item: menuItemId, p_location: locationId });
  if (error) throw new Error(`loadMenuChangeSnapshot: ${error.message}`);
  if (data == null || typeof data !== "object") throw new Error("loadMenuChangeSnapshot: no snapshot");
  return data as MenuChangeSnapshot;
}

async function writeSetting(
  actor: AuthContext,
  input: {
    menuItemId: string; locationId: string; expectedSettingId: string | null; patch: MenuShopPatch | null;
    restoredFromSettingId: string | null; note: string | null; snapshot?: MenuChangeSnapshot;
  },
): Promise<{ settingId: string; retiredSettingId: string | null }> {
  requireLocation(actor, input.locationId);
  const snapshot = input.snapshot ?? await loadMenuChangeSnapshot(input.menuItemId, input.locationId);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.rpc("save_menu_item_shop_setting", {
    p_menu_item: input.menuItemId, p_location: input.locationId,
    p_price: input.patch?.price ?? null, p_sold_here: input.patch?.soldHere ?? true,
    p_name: input.patch?.nameOverride ?? null, p_name_es: input.patch?.nameOverrideEs ?? null,
    p_expected: input.expectedSettingId, p_note: input.note, p_actor: actor.user.id, p_restored_from: input.restoredFromSettingId,
    p_snapshot: snapshot,
  });
  if (error) menuShopErrorFromRpc(error.message);
  const r = data as { setting_id: string; retired_setting_id: string | null };
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "menu_item.shop_setting_save", resourceTable: "menu_item_shop_settings", resourceId: r.setting_id,
    metadata: {
      menu_item_id: input.menuItemId, location_id: input.locationId, retired_setting_id: r.retired_setting_id,
      restored_from_setting_id: input.restoredFromSettingId, patch: input.patch,
    },
    ipAddress: null, userAgent: null,
  });
  return { settingId: r.setting_id, retiredSettingId: r.retired_setting_id };
}

/** Save this shop's price / sold here / name here (a new row; the old one is closed, never deleted). */
export async function saveMenuItemShopSetting(
  actor: AuthContext,
  input: { menuItemId: string; locationId: string; expectedSettingId: string | null; patch: MenuShopPatch; note?: string | null; snapshot?: MenuChangeSnapshot },
): Promise<{ settingId: string; retiredSettingId: string | null }> {
  requireLocation(actor, input.locationId);
  return writeSetting(actor, { ...input, restoredFromSettingId: null, note: input.note ?? null });
}

/** Restore = a new row with an old row's values (copied in SQL). The source must be this shop's own history. */
export async function restoreMenuItemShopSetting(
  actor: AuthContext,
  input: { menuItemId: string; locationId: string; fromSettingId: string; expectedSettingId: string | null; snapshot?: MenuChangeSnapshot },
): Promise<{ settingId: string; retiredSettingId: string | null }> {
  requireLocation(actor, input.locationId);
  return writeSetting(actor, {
    menuItemId: input.menuItemId, locationId: input.locationId, expectedSettingId: input.expectedSettingId, patch: null,
    restoredFromSettingId: input.fromSettingId, note: "restored", snapshot: input.snapshot,
  });
}

/** Back to the global menu item at this shop: the live row is retired (valid_to stamped), never deleted. */
export async function retireMenuItemShopSetting(
  actor: AuthContext,
  input: { menuItemId: string; locationId: string; settingId: string; snapshot?: MenuChangeSnapshot },
): Promise<void> {
  requireLocation(actor, input.locationId);
  const snapshot = input.snapshot ?? await loadMenuChangeSnapshot(input.menuItemId, input.locationId);
  const sb = getServiceRoleClient();
  const { data: row, error: rErr } = await sb.from("menu_item_shop_settings").select("id, menu_item_id, location_id")
    .eq("id", input.settingId).maybeSingle<{ id: string; menu_item_id: string; location_id: string }>();
  if (rErr) throw new Error(`retireMenuItemShopSetting read: ${rErr.message}`);
  if (!row || row.menu_item_id !== input.menuItemId || row.location_id !== input.locationId) throw new MenuShopError(404, "not_found");
  const { error } = await sb.rpc("retire_menu_item_shop_setting", {
    p_setting: input.settingId, p_location: input.locationId, p_actor: actor.user.id, p_snapshot: snapshot,
  });
  if (error) menuShopErrorFromRpc(error.message);
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "menu_item.shop_setting_retire", resourceTable: "menu_item_shop_settings", resourceId: input.settingId,
    metadata: { menu_item_id: input.menuItemId, location_id: input.locationId }, ipAddress: null, userAgent: null,
  });
}

export interface MenuShopHistoryRow extends MenuItemShopSettingRow { createdByName: string | null }

/** Every overlay row of one menu item at one shop, newest first. Read floor 6, org-wide. */
export async function loadMenuItemShopHistory(actor: AuthContext, menuItemId: string, locationId: string): Promise<MenuShopHistoryRow[]> {
  // Level 6 OPERATIONAL managers and up — a role check, never level-only (2a: the social media manager is refused).
  if (actor.level < 6 || !catalogWriteRoleAllowed(actor.user.role, actor.level)) throw new MenuShopError(403, "forbidden");
  const sb = getServiceRoleClient();
  // Paged like every history read (Astra 3a r1#6).
  const data = await selectAllRows<MenuItemShopSettingRow>(async (from, to) => {
    const res = await sb.from("menu_item_shop_settings").select(MENU_SHOP_SETTING_COLUMNS)
      .eq("menu_item_id", menuItemId).eq("location_id", assertScopeToken(locationId))
      .order("valid_from", { ascending: false }).order("id", { ascending: false }).range(from, to).returns<MenuItemShopSettingRow[]>();
    if (res.error) throw new Error(`loadMenuItemShopHistory: ${res.error.message}`);
    return { data: res.data };
  });
  const userIds = [...new Set(data.map((r) => r.created_by).filter((u): u is string => u !== null))];
  const { data: users, error: uErr } = userIds.length === 0
    ? { data: [] as Array<{ id: string; name: string }>, error: null }
    : await sb.from("users").select("id, name").in("id", userIds).returns<Array<{ id: string; name: string }>>();
  if (uErr) throw new Error(`loadMenuItemShopHistory users: ${uErr.message}`);
  const nameBy = new Map((users ?? []).map((u) => [u.id, u.name]));
  return data.map((r) => ({ ...r, createdByName: r.created_by ? (nameBy.get(r.created_by) ?? null) : null }));
}
