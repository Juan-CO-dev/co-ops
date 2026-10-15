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
import { assertScopeToken, catalogShopAllowed, catalogWriteRoleAllowed, NIL_SCOPE } from "@/lib/sku-versions-shared";
import {
  menuPromoteGate, menuShopWriteGate, parseOptionalMenuName, type MenuItemShopSettingRow, type MenuShopPatch,
} from "@/lib/menu-item-shop-shared";
import { MENU_SHOP_SETTING_COLUMNS } from "@/lib/menu-item-shop";

export class MenuShopError extends Error {
  /**
   * A promote refused AFTER its optional Spanish name was already saved onto the source shop's own row (CC note 2
   * #3): that label change stands (recorded in History) but the promote did not happen. The page says so plainly
   * (`catalog.menu.promote.es_saved_not_promoted`). Null on every other refusal.
   */
  public spanishNameSaved: { settingId: string; locationId: string } | null = null;
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


/**
 * PROMOTE (MoO+): a shop's price and/or name becomes the global one (menu_items), under a compare-and-set on
 * the global values the preview showed and the dependency snapshot of the global view alone (NIL_SCOPE; 0263
 * takes the same). "Sold here" is never promoted. FIELD BY FIELD: a shop changes when it inherits ANY promoted
 * field. In the same transaction the source shop returns to the default for the promoted fields (lead decision 5).
 *
 * THE NAME PAIR IS COPIED EXACTLY (CC note 1 #2, superseding the GO's promote bullet): 0263 writes the shop's
 * name AND its Spanish name as they are — "no Spanish name" included, so an English-only rename never resurrects
 * the old default's Spanish name; the app then shows the English name to Spanish users and the preview says so.
 * THE OPTIONAL SPANISH NAME FIELD (`nameEs`): 0263's promote takes no Spanish-name parameter, so a typed Spanish
 * name is first saved onto the source shop's own row (an ordinary audited shop save, compare-and-set on the row
 * the preview showed), and THAT row is promoted — after re-checking that the preview's snapshot still held
 * before anything was written. Two transactions: if the promote then refuses, the shop keeps its new Spanish
 * name (its own label, recorded in History) and nothing else moved.
 */
export async function promoteMenuItemShopSetting(
  actor: AuthContext,
  input: {
    menuItemId: string; settingId: string; fields: ReadonlyArray<"price" | "name">; expected: { price: number | null; name: string; nameEs: string | null };
    /** The optional "Spanish name" field (blank = not typed); only with the name promoted. */
    nameEs?: string | null;
    snapshot?: MenuChangeSnapshot;
  },
): Promise<{ changedShops: string[]; returnedShop: string | null; promotedSettingId: string }> {
  const gate = menuPromoteGate({ role: actor.user.role, level: actor.level });
  if (!gate.ok) throw new MenuShopError(gate.status, gate.code);
  // A discriminated result (Astra chunk-1 review P3): the literal name "bad" is a name, not an error.
  const typed = parseOptionalMenuName(input.nameEs);
  if (!typed.ok) throw new MenuShopError(400, "invalid_name");
  const typedEs = typed.value;
  if (typedEs !== null && !input.fields.includes("name")) throw new MenuShopError(400, "invalid_payload");
  const sb = getServiceRoleClient();
  type SourceRow = {
    id: string; menu_item_id: string; location_id: string; price: number | string | null; sold_here: boolean;
    name_override: string | null; name_override_es: string | null; active: boolean | null;
  };
  const { data: row, error: rErr } = await sb.from("menu_item_shop_settings")
    .select("id, menu_item_id, location_id, price, sold_here, name_override, name_override_es, active")
    .eq("id", input.settingId).maybeSingle<SourceRow>();
  if (rErr) throw new Error(`promoteMenuItemShopSetting read: ${rErr.message}`);
  if (!row || row.menu_item_id !== input.menuItemId) throw new MenuShopError(404, "not_found");
  // The shop whose setting is promoted is bound like any write of it (MoO+ passes for every active shop).
  requireLocation(actor, row.location_id);

  let settingId = row.id;
  let snapshot = input.snapshot;
  /** Set the moment the Spanish name's own save COMMITS; from then on every failure says so (Astra chunk-2 review P2). */
  let spanishNameSaved: { settingId: string; locationId: string } | null = null;
  if (typedEs !== null && typedEs !== row.name_override_es) {
    if (row.active === false) throw new MenuShopError(409, "not_live");
    if (row.name_override === null) throw new MenuShopError(400, "nothing_to_promote");
    // Nothing is written on a moved preview: its snapshot must still hold BEFORE the Spanish name is saved.
    if (snapshot !== undefined) {
      const now = await loadMenuChangeSnapshot(input.menuItemId, NIL_SCOPE);
      if (JSON.stringify(now) !== JSON.stringify(snapshot)) throw new MenuShopError(409, "dependencies_changed");
    }
    const price = row.price === null ? null : Number(row.price);
    const saved = await writeSetting(actor, {
      menuItemId: input.menuItemId, locationId: row.location_id, expectedSettingId: row.id,
      patch: { price, soldHere: row.sold_here, nameOverride: row.name_override, nameOverrideEs: typedEs },
      restoredFromSettingId: null, note: "Spanish name added to promote",
    });
    settingId = saved.settingId;
    spanishNameSaved = { settingId, locationId: row.location_id };
  }

  // THE WHOLE POST-SAVE PATH (Astra chunk-2 review P2): the snapshot reload, the promote call and its answer. Once
  // the Spanish name has committed, ANY failure here — a named refusal, an un-named rpc error, a thrown read — answers
  // with the named partial result (the shop's label changed and is in History; the promote did not happen), never a
  // generic failure. With no Spanish-name step nothing was written, so a failure stays what it was.
  type PromoteResult = {
    changed_shops: string[] | null; before: Record<string, unknown>;
    returned_shop: string | null; retired_setting_id: string | null; remaining_setting_id: string | null;
  };
  let r: PromoteResult;
  try {
    if (spanishNameSaved !== null || snapshot === undefined) snapshot = await loadMenuChangeSnapshot(input.menuItemId, NIL_SCOPE);
    const { data, error } = await sb.rpc("promote_menu_item_shop_setting", {
      p_setting: settingId, p_fields: input.fields, p_expected_price: input.expected.price,
      p_expected_name: input.expected.name, p_expected_name_es: input.expected.nameEs, p_actor: actor.user.id,
      p_snapshot: snapshot,
    });
    if (error) menuShopErrorFromRpc(error.message);
    r = data as PromoteResult;
  } catch (e) {
    if (spanishNameSaved === null) throw e;
    // A named refusal keeps its own code (CC note 2 #3); anything else becomes the named `promote_not_done` — the
    // database's words stay server-side (the cause), never on the page.
    const named = e instanceof MenuShopError ? e : Object.assign(new MenuShopError(500, "promote_not_done"), { cause: e });
    named.spanishNameSaved = spanishNameSaved;
    throw named;
  }
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "menu_item.shop_setting_promote", resourceTable: "menu_items", resourceId: input.menuItemId,
    metadata: {
      setting_id: settingId, location_id: row.location_id, fields: input.fields, before: r.before, changed_shops: r.changed_shops ?? [],
      returned_shop: r.returned_shop, remaining_setting_id: r.remaining_setting_id,
      spanish_name_saved_from_setting_id: settingId !== row.id ? row.id : null,
    },
    ipAddress: null, userAgent: null,
  });
  return { changedShops: r.changed_shops ?? [], returnedShop: r.returned_shop ?? null, promotedSettingId: settingId };
}
