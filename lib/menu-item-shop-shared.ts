/**
 * A menu item's SHOP OVERLAY — THE ONE RULE, PURE (catalog Phase 3a, migration 0263; spec §3).
 * Client-safe. The global default is the menu_items row; a shop's live menu_item_shop_settings row
 * overrides it field by field: price (null = the global price), sold here (false = off the menu
 * here), name / name_es (null = the global name). Every consumer — the costing board's shop view, the
 * Toast matcher, the menu-item page — resolves through resolveMenuItemForShop and never reads the row.
 */
import { isValidMenuPrice } from "@/lib/toast/in-store-prices-shared";
import type { RoleCode } from "@/lib/roles";
import { GLOBAL_VERSION_WRITE_MIN, catalogWriteRoleAllowed } from "@/lib/sku-versions-shared";

/** A GM (7) sets its own shops' menu (spec §2: "menu items and prices"); MoO+ (8) any shop + promote. */
export const MENU_SHOP_WRITE_MIN = 7;
export const MENU_GLOBAL_WRITE_MIN = GLOBAL_VERSION_WRITE_MIN;
export const MENU_NAME_MAX = 120;

export interface MenuItemShopSettingRow {
  id: string;
  menu_item_id: string;
  location_id: string;
  based_on_setting_id: string | null;
  price: number | string | null;
  sold_here: boolean;
  name_override: string | null;
  name_override_es: string | null;
  valid_from: string;
  valid_to: string | null;
  active?: boolean | null;
  note?: string | null;
  created_by: string | null;
}

export interface MenuItemGlobal { id: string; name: string; nameEs: string | null; menuPrice: number | null }

export interface ResolvedMenuItem {
  id: string;
  name: string;
  /** null = no Spanish name for what this shop calls it (the UI falls back to `name`). */
  nameEs: string | null;
  /** The TYPED price here (the shop's, else the global one) — Toast prices and "same as" layer on top. */
  typedPrice: number | null;
  soldHere: boolean;
  settingId: string | null;
  overrides: { price: boolean; soldHere: boolean; name: boolean };
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

export function resolveMenuItemForShop(g: MenuItemGlobal, s: MenuItemShopSettingRow | null | undefined): ResolvedMenuItem {
  if (!s) {
    return { id: g.id, name: g.name, nameEs: g.nameEs, typedPrice: g.menuPrice, soldHere: true, settingId: null, overrides: { price: false, soldHere: false, name: false } };
  }
  const price = num(s.price);
  const renamed = s.name_override !== null;
  return {
    id: g.id,
    name: s.name_override ?? g.name,
    // A Spanish override wins; an English-only override has no Spanish twin (never the OLD global es name).
    nameEs: s.name_override_es ?? (renamed ? null : g.nameEs),
    typedPrice: price ?? g.menuPrice,
    soldHere: s.sold_here,
    settingId: s.id,
    overrides: { price: price !== null, soldHere: !s.sold_here, name: renamed || s.name_override_es !== null },
  };
}

export type MenuWriteRefusal = { ok: false; status: 403 | 404; code: "forbidden" | "not_found" | "global_requires_moo" };

/**
 * A shop overlay write: GM (7)+ AND the shop (catalogShopAllowed — MoO+ any shop). Decided before I/O. The
 * role rule (catalogWriteRoleAllowed) runs too, so the social media manager is refused by ROLE, never only
 * because today's floor happens to sit above level 6.
 */
export function menuShopWriteGate(input: { role: RoleCode; level: number; scopeAllowed: boolean }): { ok: true } | MenuWriteRefusal {
  if (!catalogWriteRoleAllowed(input.role, input.level)) return { ok: false, status: 403, code: "forbidden" };
  if (input.level < MENU_SHOP_WRITE_MIN) return { ok: false, status: 403, code: "forbidden" };
  if (!input.scopeAllowed) return { ok: false, status: 404, code: "not_found" };
  return { ok: true };
}

/** Promote a shop's price / name to everyone: MoO (8)+ only. */
export function menuPromoteGate(input: { role: RoleCode; level: number }): { ok: true } | MenuWriteRefusal {
  if (!catalogWriteRoleAllowed(input.role, input.level)) return { ok: false, status: 403, code: "forbidden" };
  if (input.level >= MENU_GLOBAL_WRITE_MIN) return { ok: true };
  return { ok: false, status: 403, code: input.level >= MENU_SHOP_WRITE_MIN ? "global_requires_moo" : "forbidden" };
}

/**
 * EVERY named refusal a menu-overlay write can return — 0263's 'menu_item_shop:<code>', the patch parser's and
 * the gates' — each with its OWN en + es message at `catalog.error.<code>` (tests/catalog-item-i18n.test.ts).
 * 'dependencies_busy' arrives as 0262's 'recipe_version:dependencies_busy' (the closure locks are 0262's).
 */
export const MENU_ITEM_SHOP_ERROR_CODES = [
  "invalid_payload", "menu_item_not_found", "dependencies_changed", "dependencies_busy", "location_not_found",
  "invalid_source", "invalid_price", "invalid_menu_price", "invalid_name", "empty_setting", "version_changed",
  "not_found", "not_live", "nothing_to_promote", "global_changed", "forbidden", "global_requires_moo",
] as const;
export type MenuItemShopErrorCode = (typeof MENU_ITEM_SHOP_ERROR_CODES)[number];

/** 'menu_item_shop:<code>' (a P0001 message from 0263) → the code; null when it is not one of ours. */
export function parseMenuItemShopRefusal(message: string): MenuItemShopErrorCode | null {
  const m = /menu_item_shop:([a-z_]+)/.exec(message) ?? /recipe_version:(dependencies_busy)/.exec(message);
  if (!m) return null;
  return (MENU_ITEM_SHOP_ERROR_CODES as readonly string[]).includes(m[1]!) ? (m[1] as MenuItemShopErrorCode) : null;
}

export interface MenuShopPatch { price: number | null; soldHere: boolean; nameOverride: string | null; nameOverrideEs: string | null }

export type MenuShopPatchParse =
  | { ok: true; patch: MenuShopPatch }
  | { ok: false; code: "invalid_payload" | "invalid_menu_price" | "invalid_name" | "empty_setting" };

/**
 * One optional menu name as typed: absent / blank = `value: null` (not typed); not text or over MENU_NAME_MAX
 * = `ok: false`. A DISCRIMINATED result (Astra 3b chunk-1 review P3): a string sentinel such as "bad" was also a
 * valid name, so the literal name "bad" was refused.
 */
export function parseOptionalMenuName(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false };
  const t = v.trim();
  if (t === "") return { ok: true, value: null };
  return t.length > MENU_NAME_MAX ? { ok: false } : { ok: true, value: t };
}

/** The route's one parser. A patch that sets nothing is "back to default" — its own act (empty_setting). */
export function parseMenuShopPatch(raw: unknown): MenuShopPatchParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, code: "invalid_payload" };
  const b = raw as Record<string, unknown>;
  const price = b.price === undefined || b.price === null ? null : b.price;
  if (price !== null && !isValidMenuPrice(price)) return { ok: false, code: "invalid_menu_price" };
  const soldHere = b.soldHere === undefined ? true : b.soldHere;
  if (typeof soldHere !== "boolean") return { ok: false, code: "invalid_payload" };
  const n = parseOptionalMenuName(b.nameOverride);
  const nEs = parseOptionalMenuName(b.nameOverrideEs);
  if (!n.ok || !nEs.ok) return { ok: false, code: "invalid_name" };
  const name = n.value;
  const nameEs = nEs.value;
  if (price === null && soldHere && name === null && nameEs === null) return { ok: false, code: "empty_setting" };
  return { ok: true, patch: { price: price as number | null, soldHere, nameOverride: name, nameOverrideEs: nameEs } };
}

/**
 * The Toast matcher pool for ONE shop (lib/admin/toast-map.ts): a menu item off the menu here leaves the
 * pool; its name and price here are what the Toast menu is matched against. Prep items pass through.
 */
export function applyMenuOverlayToEntities<E extends { kind: "menu_item" | "item"; id: string; name: string; priceCents: number | null }>(
  entities: readonly E[],
  overlay: ReadonlyMap<string, MenuItemShopSettingRow>,
): E[] {
  const out: E[] = [];
  for (const e of entities) {
    const s = e.kind === "menu_item" ? overlay.get(e.id) : undefined;
    if (!s) { out.push(e); continue; }
    if (!s.sold_here) continue;
    const price = num(s.price);
    out.push({ ...e, name: s.name_override ?? e.name, priceCents: price !== null ? Math.round(price * 100) : e.priceCents });
  }
  return out;
}
