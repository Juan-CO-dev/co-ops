/**
 * The connected pages for a RECIPE and a MENU ITEM — the client-safe surface (catalog Phase 3b; spec §3,
 * §4, §6). View models the server fills (lib/catalog/recipe-item.ts, lib/catalog/menu-item-page.ts,
 * lib/catalog/shop-changes.ts) and the clients render; the deep links; what the version label says; and
 * the change requests a page may post, with the parsers the routes use. PURE: no I/O, no server imports.
 */
import type { RecipeLineFields } from "@/lib/recipe-line-shared";
import { parseRecipeLineOp, type RecipeLineChange, type RecipeLineOp } from "@/lib/recipe-versions-shared";
import { parseMenuShopPatch, parseOptionalMenuName, type MenuShopPatch } from "@/lib/menu-item-shop-shared";
import type { RecipeNotice } from "@/lib/catalog/recipe-notices-shared";
import type { RecipeBuilderProduct, RecipeBuilderSku } from "@/components/admin/recipes/RecipeBuilder";
import type { PackChainLevel } from "@/lib/pack-chain-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

// ── Links ─────────────────────────────────────────────────────────────────────

function withShop(path: string, shopId: string | null | undefined): string {
  if (shopId === undefined) return path;
  return `${path}?location=${shopId === null ? "global" : encodeURIComponent(shopId)}`;
}
/** The recipe page; `shopId` null = the global default, undefined = the remembered shop. */
export function recipeItemHref(recipeId: string, opts: { shopId?: string | null } = {}): string {
  return withShop(`/admin/catalog/recipe/${encodeURIComponent(recipeId)}`, opts.shopId);
}
/** The menu-item page; `shopId` null = the global menu, undefined = the remembered shop. */
export function menuItemPageHref(menuItemId: string, opts: { shopId?: string | null } = {}): string {
  return withShop(`/admin/catalog/menu-item/${encodeURIComponent(menuItemId)}`, opts.shopId);
}
export const SHOP_CHANGES_HREF = "/admin/catalog/shop-changes";
export function noticesHref(shopId?: string | null): string {
  return withShop("/admin/catalog/notices", shopId);
}

/**
 * The shop whose recipe this History row's version STOPPED following, from what 0262 recorded on it
 * (`adoption_ended_from_version_id`: the replaced version on a restore's row, the row itself on a Back-to-default
 * retirement) — never inferred from based_on (Astra r7; lead decision: History reads only that column). Returns
 * that source shop's id, or null.
 */
export function historyLinkEndedSource(
  v: { adoptionEndedFromVersionId: string | null },
  byId: ReadonlyMap<string, { locationId: string | null; adoptedFromVersionId: string | null }>,
): string | null {
  if (!v.adoptionEndedFromVersionId) return null;
  const ended = byId.get(v.adoptionEndedFromVersionId);
  const source = ended?.adoptedFromVersionId ? byId.get(ended.adoptedFromVersionId) : undefined;
  return source?.locationId ?? null;
}

/**
 * Has the line changed under an open edit since its baseline was captured? (Astra 3b r5#1; lead decision:
 * a refresh keeps the draft's ORIGINAL baseline — when it moved, the page shows it and offers "Start over
 * from the new version".)
 */
export function lineEditStale(expected: RecipeLineFields, current: RecipeLineFields): boolean {
  const key = (f: RecipeLineFields) => JSON.stringify([f.componentSkuId, f.componentItemId, f.componentProductId, f.quantity,
    f.unit ?? null, f.eachContainerLabel ?? null, f.portioned]);
  return key(expected) !== key(current);
}

/**
 * THE PICKER SPEAKS THE SHOP'S PACK (Astra 3b r4#1): each SKU carries the chain this scope resolves (2a's one
 * resolver — the shop's own pack version, else the default's), so the line editor's unit choices (the chain's
 * labels) and its ounce conversion (ozForRecipeInput walks the chain first) are the ones the preview and the
 * graph use. No resolved chain = the SKU's flat fields, exactly as before.
 */
export function scopedPickerSkus<S extends { id: string }>(
  skus: readonly S[],
  packs: ReadonlyMap<string, { levels: PackChainLevel[] }>,
): Array<S & { packChain: PackChainLevel[] | null }> {
  return skus.map((s) => {
    const levels = packs.get(s.id)?.levels ?? [];
    return { ...s, packChain: levels.length > 0 ? levels : null };
  });
}

/** A same-route shop switch remounts the page body (2b: useState survives a navigation otherwise). */
export function pageClientKey(kind: "recipe" | "menu", id: string, scope: string | null): string {
  return `${kind}:${id}:${scope ?? "global"}`;
}

/**
 * The COMMITTED revision of a menu item page's form (Astra 3b r1#6): this shop's live row and the global
 * values it inherits. MenuItemClient resets its fields whenever this moves (a save, Back to default,
 * Restore, a promote), so a retired price or "not sold here" never rides into the next save.
 */
export function menuFormRevision(view: Pick<MenuItemPageView, "item" | "here">): string {
  const h = view.here;
  return JSON.stringify([h.settingId, h.price, h.soldHere, h.nameOverride, h.nameOverrideEs, view.item.menuPrice, view.item.name, view.item.nameEs]);
}

// ── What the header says ──────────────────────────────────────────────────────

export type RecipeVersionLabel =
  | { kind: "global" }
  | { kind: "shop_default"; shop: string }
  | { kind: "shop_own"; shop: string }
  | { kind: "shop_adopted"; shop: string; from: string };

export function recipeVersionLabel(input: { scope: string | null; scopeName: string | null; hasOwn: boolean; adoptedFromShopName: string | null }): RecipeVersionLabel {
  if (input.scope === null) return { kind: "global" };
  const shop = input.scopeName ?? "";
  if (!input.hasOwn) return { kind: "shop_default", shop };
  return input.adoptedFromShopName ? { kind: "shop_adopted", shop, from: input.adoptedFromShopName } : { kind: "shop_own", shop };
}

// ── Change requests ───────────────────────────────────────────────────────────

export type RecipeTarget = { kind: "shop"; shopId: string } | { kind: "global" };

export type RecipeChangeRequest =
  | { kind: "lines"; target: RecipeTarget; op: RecipeLineOp }
  | { kind: "restore"; target: RecipeTarget; fromVersionId: string }
  | { kind: "back_to_default"; shopId: string }
  | { kind: "adopt"; shopId: string; sourceVersionId: string }
  | { kind: "promote"; sourceVersionId: string };

export type ChangeParse<T> = { ok: true; change: T } | { ok: false; code: string };

function parseTarget(raw: unknown): RecipeTarget | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (t.kind === "global") return { kind: "global" };
  if (t.kind === "shop" && isUuid(t.shopId)) return { kind: "shop", shopId: t.shopId };
  return null;
}

/** The routes' one parser for a recipe change. Every refusal is a named code with its own en + es message. */
export function parseRecipeChange(raw: unknown): ChangeParse<RecipeChangeRequest> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, code: "invalid_payload" };
  const b = raw as Record<string, unknown>;
  switch (b.kind) {
    case "lines": {
      const target = parseTarget(b.target);
      if (!target) return { ok: false, code: "invalid_payload" };
      const op = parseRecipeLineOp(b.op);
      if (!op.ok) return { ok: false, code: op.code };
      return { ok: true, change: { kind: "lines", target, op: op.op } };
    }
    case "restore": {
      const target = parseTarget(b.target);
      if (!target || !isUuid(b.fromVersionId)) return { ok: false, code: "invalid_payload" };
      return { ok: true, change: { kind: "restore", target, fromVersionId: b.fromVersionId } };
    }
    case "back_to_default":
      return isUuid(b.shopId) ? { ok: true, change: { kind: "back_to_default", shopId: b.shopId } } : { ok: false, code: "invalid_payload" };
    case "adopt":
      return isUuid(b.shopId) && isUuid(b.sourceVersionId)
        ? { ok: true, change: { kind: "adopt", shopId: b.shopId, sourceVersionId: b.sourceVersionId } }
        : { ok: false, code: "invalid_payload" };
    case "promote":
      return isUuid(b.sourceVersionId) ? { ok: true, change: { kind: "promote", sourceVersionId: b.sourceVersionId } } : { ok: false, code: "invalid_payload" };
    default:
      return { ok: false, code: "invalid_payload" };
  }
}

/** Where an act saves: back to default and adopt are a shop's; promote is everyone's. */
export function recipeChangeTarget(c: RecipeChangeRequest): RecipeTarget {
  if (c.kind === "lines" || c.kind === "restore") return c.target;
  if (c.kind === "promote") return { kind: "global" };
  return { kind: "shop", shopId: c.shopId };
}

export type MenuPromoteField = "price" | "name";
export type MenuChangeRequest =
  | { kind: "save"; shopId: string; patch: MenuShopPatch }
  | { kind: "back_to_default"; shopId: string }
  | { kind: "restore"; shopId: string; fromSettingId: string }
  /** `nameEs`: the optional "Spanish name" typed on the promote screen — present only when typed (CC note 1 #2). */
  | { kind: "promote"; settingId: string; fields: readonly MenuPromoteField[]; nameEs?: string };

/** The routes' one parser for a menu change. "Sold here" is never promoted (judgment call 8). */
export function parseMenuChange(raw: unknown): ChangeParse<MenuChangeRequest> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, code: "invalid_payload" };
  const b = raw as Record<string, unknown>;
  switch (b.kind) {
    case "save": {
      if (!isUuid(b.shopId)) return { ok: false, code: "invalid_payload" };
      const p = parseMenuShopPatch(b.patch);
      return p.ok ? { ok: true, change: { kind: "save", shopId: b.shopId, patch: p.patch } } : { ok: false, code: p.code };
    }
    case "back_to_default":
      return isUuid(b.shopId) ? { ok: true, change: { kind: "back_to_default", shopId: b.shopId } } : { ok: false, code: "invalid_payload" };
    case "restore":
      return isUuid(b.shopId) && isUuid(b.fromSettingId)
        ? { ok: true, change: { kind: "restore", shopId: b.shopId, fromSettingId: b.fromSettingId } }
        : { ok: false, code: "invalid_payload" };
    case "promote": {
      const fields: unknown[] = Array.isArray(b.fields) ? b.fields : [];
      const ok = fields.length > 0 && fields.length <= 2 && fields.every((f) => f === "price" || f === "name") && new Set(fields).size === fields.length;
      if (!ok || !isUuid(b.settingId)) return { ok: false, code: "invalid_payload" };
      // THE OPTIONAL SPANISH NAME IS PRESERVED (Astra chunk-1 review P2): validated by the lib's rule (blank = not
      // typed, max MENU_NAME_MAX) and carried to preview and apply; only with the name promoted, as the lib refuses.
      const es = parseOptionalMenuName(b.nameEs);
      if (!es.ok) return { ok: false, code: "invalid_name" };
      if (es.value !== null && !fields.includes("name")) return { ok: false, code: "invalid_payload" };
      return { ok: true, change: {
        kind: "promote", settingId: b.settingId, fields: fields as MenuPromoteField[], ...(es.value !== null ? { nameEs: es.value } : {}),
      } };
    }
    default:
      return { ok: false, code: "invalid_payload" };
  }
}

// ── View models ───────────────────────────────────────────────────────────────

export interface RecipeLineView {
  lineId: string;
  fields: RecipeLineFields;
  name: string;
  kind: "sku" | "item" | "product";
  vendorName: string | null;
  /** A shop version's line that differs from (or is absent in) the global default. */
  changedHere: boolean;
  /** Why this saved line would not pass an add today (lead decision (b): FLAGGED, may stay until fixed), or null. */
  problem: "invalid_component_product" | "product_line_needs_measure_unit" | null;
}

export interface RecipeItemView {
  recipe: { id: string; name: string; nameEs: string | null; recipeType: "production" | "consumer"; active: boolean };
  shops: Array<{ id: string; name: string }>;
  scope: string | null;
  scopeName: string | null;
  can: { editShop: boolean; editGlobal: boolean };
  version: {
    scopeVersionId: string | null;
    globalVersionId: string | null;
    ridesDefault: boolean;
    adoptedFromShopName: string | null;
    validFrom: string | null;
  };
  lines: RecipeLineView[];
  /** A shop with its own version: how it differs from today's global default. */
  differsFromDefault: RecipeLineChange[];
  makes: Array<{ kind: "menu_item" | "item"; id: string; name: string; nameEs: string | null; yield: number; costHere: number | null }>;
  usedIn: Array<{ id: string; name: string }>;
  vendors: string[];
  otherShopVersions: Array<{ versionId: string; shopId: string; shopName: string; validFrom: string; createdByName: string | null; changes: RecipeLineChange[] }>;
  notices: RecipeNotice[];
  history: Array<{
    id: string; scope: "global" | "shop"; shopName: string | null; active: boolean; validFrom: string; validTo: string | null;
    who: string | null; note: string | null; lineCount: number; promotedFromShopName: string | null; adoptedFromShopName: string | null;
    /** This version ENDED the link to that shop's recipe (a restore from before the adoption, or Back to default). */
    linkEndedFromShopName: string | null;
  }>;
  /** recipeLineTargetKey → display name, for the line changes. */
  names: Record<string, string>;
  picker: {
    skus: RecipeBuilderSku[];
    items: Array<{ id: string; name: string }>;
    products: RecipeBuilderProduct[];
    measures: Array<{ label: string; dimension: "weight" | "volume" | "count"; toBaseFactor: number }>;
    activeMeasureLabels: string[];
  };
}

export interface MenuItemPageView {
  item: { id: string; name: string; nameEs: string | null; menuPrice: number | null; section: string | null };
  shops: Array<{ id: string; name: string }>;
  scope: string | null;
  scopeName: string | null;
  can: { editShop: boolean };
  here: {
    settingId: string | null; price: number | null; soldHere: boolean; nameOverride: string | null; nameOverrideEs: string | null;
    name: string; nameEs: string | null; typedPrice: number | null;
  };
  cost: number | null;
  recipe: { id: string; name: string } | null;
  toastLinks: number;
  history: Array<{ id: string; active: boolean; validFrom: string; validTo: string | null; who: string | null; price: number | null; soldHere: boolean; nameOverride: string | null; nameOverrideEs: string | null }>;
}

/**
 * The named refusals the 3b page libs add beyond 3a's (RECIPE_VERSION_ERROR_CODES / MENU_ITEM_SHOP_ERROR_CODES):
 * each has its OWN en + es message at `catalog.error.<code>` (tests/catalog-item-i18n.test.ts).
 */
export const RECIPE_PAGE_ERROR_CODES = ["preview_stale", "nothing_changed", "promote_not_done"] as const;

// ── The Shop changes list (MoO+, catalog Phase 3b) ────────────────────────────

export interface ShopChangeRecipeRow {
  recipeId: string;
  recipeName: string;
  versionId: string;
  shopId: string;
  shopName: string;
  validFrom: string;
  createdByName: string | null;
  adoptedFromShopName: string | null;
  changes: RecipeLineChange[];
  sameAsDefault: boolean;
}

export interface ShopChangeMenuRow {
  menuItemId: string;
  menuItemName: string;
  settingId: string;
  shopId: string;
  shopName: string;
  validFrom: string;
  createdByName: string | null;
  price: number | null;
  soldHere: boolean;
  nameOverride: string | null;
  nameOverrideEs: string | null;
  global: { price: number | null; name: string; nameEs: string | null };
}

export interface ShopChangesView {
  recipes: ShopChangeRecipeRow[];
  menu: ShopChangeMenuRow[];
  /** recipeLineTargetKey → display name, for every change listed. */
  names: Record<string, string>;
}
