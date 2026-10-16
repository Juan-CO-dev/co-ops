/**
 * The connected pages for a RECIPE and a MENU ITEM — the client-safe surface (catalog Phase 3b; spec §3,
 * §4, §6). View models the server fills (lib/catalog/recipe-item.ts, lib/catalog/menu-item-page.ts,
 * lib/catalog/shop-changes.ts) and the clients render; the deep links; what the version label says; and
 * the change requests a page may post, with the parsers the routes use. PURE: no I/O, no server imports.
 */
import type { RecipeLineFields } from "@/lib/recipe-line-shared";
import type { TranslationKey } from "@/lib/i18n/types";
import { parseRecipeLineOp, RECIPE_GLOBAL_WRITE_MIN, RECIPE_VERSION_ERROR_CODES, type RecipeLineChange, type RecipeLineOp } from "@/lib/recipe-versions-shared";
import { MENU_ITEM_SHOP_ERROR_CODES, parseMenuShopPatch, parseOptionalMenuName, type MenuShopPatch } from "@/lib/menu-item-shop-shared";
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
/**
 * Where a recipe row or a recipe READINESS warning opens (plan Task 11; lead decision "shop item warnings deep-link to
 * the shop's view"; CC note 12 #2):
 * - a list read for one shop (`/admin/recipes?location=`, `/admin/items?location=`) opens THAT shop's version on the
 *   catalog page, for everyone;
 * - the default's list opens the legacy builder only for who edits the default's lines there (MoO+,
 *   RECIPE_GLOBAL_WRITE_MIN); below that the builder's lines are read-only, so the row opens the catalog page (the
 *   remembered shop) — no dead end.
 */
export function readinessRecipeHref(recipeId: string, shopScope: string | null, actorLevel: number): string {
  if (shopScope) return recipeItemHref(recipeId, { shopId: shopScope });
  return actorLevel >= RECIPE_GLOBAL_WRITE_MIN ? `/admin/recipes/${encodeURIComponent(recipeId)}` : recipeItemHref(recipeId);
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
 * A LINE'S IDENTITY ACROSS SAVES (Astra chunks 3-4 P2 #1). A shop save writes the whole set again with NEW
 * recipe_version_lines ids and records each kept line's previous id in source_line_id (0262). The lineage is that
 * chain walked back, nearest first; it stops at a line outside the map (the default's recipe_inputs id a fork copied,
 * or another shop's line an adopt copied) and never loops.
 */
export function lineLineage(lineId: string, sourceOf: ReadonlyMap<string, string | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>([lineId]);
  let cur = sourceOf.get(lineId) ?? null;
  while (cur !== null && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = sourceOf.get(cur) ?? null;
  }
  return out;
}
/** Is this the line an edit was opened on (by the id seen then — this line, or one it was copied from)? */
export function recipeLineMatches(l: { lineId: string; lineage: readonly string[] }, id: string): boolean {
  return l.lineId === id || l.lineage.includes(id);
}
/** A row key that survives a save: the line's oldest known ancestor (a duplicate falls back to the row id). */
export function recipeLineKeys(lines: ReadonlyArray<{ lineId: string; lineage: readonly string[] }>): string[] {
  const used = new Set<string>();
  return lines.map((l) => {
    const root = l.lineage[l.lineage.length - 1] ?? l.lineId;
    const key = used.has(root) ? l.lineId : root;
    used.add(key);
    return key;
  });
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
  /** The ids this line was copied from across saves, nearest first (lineLineage over source_line_id); [] for the default's lines. */
  lineage: string[];
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
  /** `shopsToEdit`: every shop this actor may change the recipe for — the way forward a read-only view offers ("Change it for <shop>"; no dead ends). */
  can: { editShop: boolean; editGlobal: boolean; shopsToEdit: Array<{ id: string; name: string }> };
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
    /** `shopId`: whose version this is (null = the default) — Restore is offered only for the default's or THIS shop's (never another shop's: that is adopt). */
    id: string; scope: "global" | "shop"; shopId: string | null; shopName: string | null; active: boolean; validFrom: string; validTo: string | null;
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
  /**
   * `promote`: may make a shop's own price / name everyone's (MoO+, menuPromoteGate — the role rule included).
   * `shopsToEdit`: every shop this actor may change the item for — the way forward a read-only view offers
   * ("Change it for <shop>"; no dead ends).
   */
  can: { editShop: boolean; promote: boolean; shopsToEdit: Array<{ id: string; name: string }> };
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

/**
 * THE PAGES' ONE REFUSAL-KEY MAP (CC note 5 #3: the recipe and menu item pages read alike). Each page words the
 * refusals it expects in its OWN family (`catalog.<page>.error.<code>`, Task 7); every other NAMED code falls back to
 * its `catalog.error.<code>` message, which tests/catalog-item-i18n.test.ts guarantees (house rule: every named refusal
 * has its own en + es message, never generic text). Only an unknown code gets the page's generic message.
 */
const PAGE_ERROR_FAMILIES = {
  recipe: {
    scoped: new Set<string>([
      "version_changed", "forbidden", "not_found", "global_requires_moo", "step_up_required", "step_up_stale", "preview_stale",
      "line_changed", "edge_not_found", "empty_recipe", "would_create_cycle", "recipe_inactive", "invalid_source", "not_live",
      "nothing_changed", "invalid_payload", "invalid_component", "invalid_quantity", "product_line_needs_measure_unit",
      "invalid_component_product", "invalid_lines", "recipe_not_found", "location_not_found",
      "dependencies_changed", "dependencies_busy", "product_line_invalid",
    ]),
    // 3a's restore_source_out_of_scope, readback_failed, global_cannot_retire, truncate_refused; promote_not_done → catalog.error.*
    named: new Set<string>([...RECIPE_VERSION_ERROR_CODES, ...RECIPE_PAGE_ERROR_CODES]),
  },
  menu: {
    scoped: new Set<string>([
      "forbidden", "not_found", "version_changed", "not_live", "global_changed", "nothing_to_promote", "invalid_menu_price",
      "invalid_name", "empty_setting", "invalid_source", "invalid_payload", "preview_stale", "step_up_required", "step_up_stale",
      "menu_item_not_found", "location_not_found", "global_requires_moo", "dependencies_changed", "dependencies_busy",
    ]),
    // 3a's invalid_price; the 3b page codes nothing_changed, promote_not_done → catalog.error.*
    named: new Set<string>([...MENU_ITEM_SHOP_ERROR_CODES, ...RECIPE_PAGE_ERROR_CODES]),
  },
} as const;
export type CatalogPage = keyof typeof PAGE_ERROR_FAMILIES;

/** The message key for a refusal on a catalog item page: `catalog.<page>.error.<code>`, else `catalog.error.<code>`, else generic. */
export function pageErrorKey(page: CatalogPage, code: string): TranslationKey {
  const f = PAGE_ERROR_FAMILIES[page];
  if (f.scoped.has(code)) return `catalog.${page}.error.${code}` as TranslationKey;
  if (f.named.has(code)) return `catalog.error.${code}` as TranslationKey;
  return `catalog.${page}.error.generic` as TranslationKey;
}
/** The recipe page's refusal key (pageErrorKey for "recipe"). */
export const recipeErrorKey = (code: string): TranslationKey => pageErrorKey("recipe", code);
/** The menu item page's refusal key (pageErrorKey for "menu") — the recipe page's twin. */
export const menuErrorKey = (code: string): TranslationKey => pageErrorKey("menu", code);

// ── The menu form's baseline (lead decision: a refresh keeps the draft's ORIGINAL baseline) ──

type MenuShopRow = Pick<MenuItemPageView["here"], "settingId" | "price" | "soldHere" | "nameOverride" | "nameOverrideEs">;
/** What the "At this shop" form holds: the typed text, exactly as the inputs show it. */
export interface MenuDraft { price: string; soldHere: boolean; name: string; nameEs: string }

/** The form for a committed shop row (blank = inherit the default). */
export function menuDraftFrom(h: Omit<MenuShopRow, "settingId">): MenuDraft {
  return { price: h.price === null ? "" : String(h.price), soldHere: h.soldHere, name: h.nameOverride ?? "", nameEs: h.nameOverrideEs ?? "" };
}
const sameDraft = (a: MenuDraft, b: MenuDraft) =>
  a.price.trim() === b.price.trim() && a.soldHere === b.soldHere && a.name.trim() === b.name.trim() && a.nameEs.trim() === b.nameEs.trim();

export type MenuRowMove =
  | { field: "price"; before: number | null; after: number | null }
  | { field: "soldHere"; before: boolean; after: boolean }
  | { field: "name" | "nameEs"; before: string | null; after: string | null };

/** Every field of this shop's row that moved between two committed reads (a new row id alone is not a move). */
export function menuRowMoves(was: MenuShopRow, now: MenuShopRow): MenuRowMove[] {
  const out: MenuRowMove[] = [];
  if (was.price !== now.price) out.push({ field: "price", before: was.price, after: now.price });
  if (was.soldHere !== now.soldHere) out.push({ field: "soldHere", before: was.soldHere, after: now.soldHere });
  if (was.nameOverride !== now.nameOverride) out.push({ field: "name", before: was.nameOverride, after: now.nameOverride });
  if (was.nameOverrideEs !== now.nameOverrideEs) out.push({ field: "nameEs", before: was.nameOverrideEs, after: now.nameOverrideEs });
  return out;
}

/**
 * When the committed row changes under the form (a router.refresh()): keep the person's draft — with its ORIGINAL
 * baseline, so the page can show what moved and offer "Start over from the new version" — only when they TYPED
 * something (the draft differs from the row they started from AND from the new one) and the shop's row really moved.
 * Otherwise the form follows the committed row (Astra 3b r1#6). `follow`: their own act just saved — always follow.
 */
export function keepMenuDraft(input: { draft: MenuDraft; was: MenuShopRow; now: MenuShopRow; follow: boolean }): boolean {
  if (input.follow) return false;
  if (sameDraft(input.draft, menuDraftFrom(input.was)) || sameDraft(input.draft, menuDraftFrom(input.now))) return false;
  return menuRowMoves(input.was, input.now).length > 0;
}

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

/**
 * WHAT A SHOP CHANGES PREVIEW WAS COMPUTED AGAINST (mirrors the pages' "Preview again", Astra chunks 3-4 P2 #2): every
 * field the row shows — the shop's lines against the default, its price, sold here and both names, the global values
 * it is compared with. When a refresh brings the row back different (another manager saved, the default moved) or not
 * at all, the open preview and its Save are dropped. Who made it is not part of what a preview binds.
 */
export function shopChangeRowRevision(row: ShopChangeRecipeRow | ShopChangeMenuRow): string {
  return JSON.stringify({ ...row, createdByName: null });
}
