/**
 * "WHAT THIS CHANGES" for recipes and menu items — PURE, client-safe (catalog Phase 3b; spec §4).
 * The server (lib/catalog/recipe-item.ts, lib/catalog/menu-item-page.ts) loads, per reached scope, the
 * graph before and after (3a's recipeOverrides) and the prices; this module turns them into the
 * deltas a person reads, and digests the preview into the token a save must present (2b's
 * previewToken: one spelling of the digest).
 *
 * LEAD DECISION: a preview binds the COMPLETE proposed change — the act, the target, the versions seen,
 * the lines after, every shop reached / untouched / returned, every number shown, and the dependency
 * snapshot (3a recipe_change_snapshot / menu_item_change_snapshot) taken BEFORE any number is computed.
 */
import type { RecipeGraph } from "@/lib/prep-consumption-graph";
import { rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { previewToken } from "@/lib/catalog/change-preview-shared";
import type { RecipeLineFields } from "@/lib/recipe-line-shared";
import { recipeLineTargetKey, type RecipeLineChange } from "@/lib/recipe-versions-shared";
import type { MenuPromoteField, RecipeChangeRequest, RecipeTarget } from "@/lib/catalog/recipe-item-shared";

export interface MenuCostDelta {
  menuItemId: string;
  name: string;
  nameEs: string | null;
  before: number | null;
  after: number | null;
  statusBefore: string;
  statusAfter: string;
}

export interface ScopeImpact {
  /** null = the global view ("everyone on the default"). */
  scope: string | null;
  scopeName: string | null;
  menu: MenuCostDelta[];
  /** Cost per unit of each prep item this recipe makes, before → after. */
  items: Array<{ itemId: string; name: string; before: number | null; after: number | null }>;
}

export interface RecipePreview {
  kind: RecipeChangeRequest["kind"];
  recipeId: string;
  target: RecipeTarget;
  changes: RecipeLineChange[];
  /** recipeLineTargetKey → display name. */
  names: Record<string, string>;
  reached: ScopeImpact[];
  untouched: Array<{ shopId: string; shopName: string }>;
  /** PROMOTE: the source shop, which goes back to the default in the same save (its food does not change). */
  returnedShop: { shopId: string; shopName: string } | null;
  /**
   * LEAD DECISION (provenance follows the content): a restore of PRE-adoption history (or Back to default) ends the
   * link — the shop whose recipe this shop stops following, named BEFORE saving; else null.
   */
  dropsLinkTo: string | null;
  /** Lines the save CARRIES that would not pass an add today — flagged, not refused (lead decision (b)). */
  flagged: Array<{ position: number; name: string; reason: string }>;
  expectedVersionId: string | null;
  basedOnVersionId: string | null;
  /** The dependency snapshot (3a recipe_change_snapshot) this preview was computed on — opaque; the token binds it, apply hands it to the writer. */
  snapshot: Record<string, unknown>;
  token: string;
}

interface Costed { graph: RecipeGraph; costPerOz: ReadonlyMap<string, number | null> }

/** Every sandwich whose cost or costing status moves, in the order given. Unmoved ones are left out. */
export function menuCostDeltas(
  menuIds: readonly string[],
  names: ReadonlyMap<string, { name: string; nameEs: string | null }>,
  before: Costed,
  after: Costed,
): MenuCostDelta[] {
  const out: MenuCostDelta[] = [];
  for (const id of menuIds) {
    const b = rollupMenuItemCost(before.graph, id, new Map(before.costPerOz));
    const a = rollupMenuItemCost(after.graph, id, new Map(after.costPerOz));
    const same = b.status === a.status && (b.cost === a.cost || (b.cost !== null && a.cost !== null && Math.abs(b.cost - a.cost) < 0.005));
    if (same) continue;
    const n = names.get(id);
    out.push({ menuItemId: id, name: n?.name ?? id, nameEs: n?.nameEs ?? null, before: b.cost, after: a.cost, statusBefore: b.status, statusAfter: a.status });
  }
  return out;
}

/** "Turkey 4 oz" — the line in plain words (the name from `names`, the amount through `fmt`). */
export function lineText(f: RecipeLineFields, names: Readonly<Record<string, string>>, fmt: (n: number) => string): string {
  const key = recipeLineTargetKey(f);
  return [names[key] ?? key, fmt(f.quantity), f.unit ?? ""].filter((s) => s !== "").join(" ");
}

/** Price and margin before and after a menu change (margin = price − food cost; null when either is unknown). */
export function menuPreviewMath(input: { before: number | null; after: number | null; cost: number | null }): { marginBefore: number | null; marginAfter: number | null } {
  const m = (p: number | null) => (p === null || input.cost === null ? null : Math.round((p - input.cost) * 100) / 100);
  return { marginBefore: m(input.before), marginAfter: m(input.after) };
}

export function recipePreviewToken(parts: unknown): string {
  return previewToken(["recipe", parts]);
}

export function menuPreviewToken(parts: unknown): string {
  return previewToken(["menu", parts]);
}

export interface MenuPreviewSide {
  name: string;
  nameEs: string | null;
  price: number | null;
  soldHere: boolean;
  /** true = this value is the default's (no own value at this shop). */
  inherits: { price: boolean; name: boolean };
}

/** A save's patch, normalized exactly as the writer stores it — what a menu token binds (Astra 3b r4#2). */
export function normalizeMenuPatch(p: { price: number | null; soldHere: boolean; nameOverride: string | null; nameOverrideEs: string | null }) {
  const text = (v: string | null) => (v === null ? null : v.trim() === "" ? null : v.trim());
  return { price: p.price, soldHere: p.soldHere, nameOverride: text(p.nameOverride), nameOverrideEs: text(p.nameOverrideEs) };
}

export interface MenuPreview {
  kind: "save" | "back_to_default" | "restore" | "promote";
  menuItemId: string;
  /** null = everyone (promote). */
  shopId: string | null;
  /** Each side in FULL (Astra 3b r4#2): both names, the price, sold here, and which values are inherited. */
  before: MenuPreviewSide;
  after: MenuPreviewSide;
  cost: number | null;
  marginBefore: number | null;
  marginAfter: number | null;
  /** Promote: the shops whose menu changes — FIELD BY FIELD, every shop inheriting ANY promoted field. */
  changedShops: Array<{ shopId: string; shopName: string }>;
  /** Promote: the source shop, which goes back to the default for the promoted fields in the same save. */
  returnedShop: { shopId: string; shopName: string } | null;
  /** Promote / any side with no Spanish name: Spanish users will see the English name (CC note 1 #2). */
  spanishFallsBackToEnglish: boolean;
  /** The dependency snapshot (3a menu_item_change_snapshot) this preview was computed on; the token binds it. */
  snapshot: Record<string, unknown>;
  expectedSettingId: string | null;
  expectedGlobal: { price: number | null; name: string; nameEs: string | null } | null;
  token: string;
}

/**
 * Which shops' menus a promote changes, FIELD BY FIELD (Astra 3b r1#4; the 0263 SQL predicate): a shop
 * changes when it inherits ANY promoted field. The source shop is excluded — its values ARE the promoted ones.
 */
export function menuPromoteChangedShops(input: {
  shops: ReadonlyArray<{ id: string; name: string }>;
  sourceShopId: string;
  fields: ReadonlyArray<MenuPromoteField>;
  live: ReadonlyArray<{ location_id: string; price: number | string | null; name_override: string | null }>;
}): Array<{ shopId: string; shopName: string }> {
  const ownPrice = new Set(input.live.filter((o) => o.price !== null).map((o) => o.location_id));
  const ownName = new Set(input.live.filter((o) => o.name_override !== null).map((o) => o.location_id));
  return input.shops
    .filter((s) => s.id !== input.sourceShopId)
    .filter((s) => (input.fields.includes("price") && !ownPrice.has(s.id)) || (input.fields.includes("name") && !ownName.has(s.id)))
    .map((s) => ({ shopId: s.id, shopName: s.name }));
}

/**
 * The strings the promote's Spanish name adds (en + es, pinned by tests/recipe-preview-shared.test.ts): the fallback,
 * the optional field, and the plain sentence for a promote refused AFTER the Spanish name was saved (CC note 2 #3;
 * MenuShopError.spanishNameSaved).
 */
export const MENU_PROMOTE_NAME_KEYS = [
  "catalog.menu.preview.name_es_fallback", "catalog.menu.promote.name_es_field", "catalog.menu.promote.es_saved_not_promoted",
] as const;

/**
 * THE NAMES A PROMOTE LEAVES (CC note 1 #2, superseding the GO's promote bullet). 0263's promote copies the
 * shop's RESOLVED name pair EXACTLY — "no Spanish name" included — so an English-only rename never resurrects
 * the old default's Spanish name. The optional "Spanish name" field (`typedNameEs`; blank = not typed) fills
 * it in the same step. When the Spanish name ends up empty the app shows the English one, and the preview says
 * so (`spanishFallsBackToEnglish` → "Spanish users will see the English name until you add one."). A price-only
 * promote leaves both names as they are.
 */
export function menuPromoteNames(input: {
  fields: ReadonlyArray<MenuPromoteField>;
  global: { name: string; nameEs: string | null };
  source: { nameOverride: string | null; nameOverrideEs: string | null };
  typedNameEs: string | null;
}): { before: { name: string; nameEs: string | null }; after: { name: string; nameEs: string | null }; spanishFallsBackToEnglish: boolean } {
  const before = { name: input.global.name, nameEs: input.global.nameEs };
  if (!input.fields.includes("name") || input.source.nameOverride === null) {
    return { before, after: { ...before }, spanishFallsBackToEnglish: before.nameEs === null };
  }
  const typed = input.typedNameEs?.trim() ? input.typedNameEs.trim() : null;
  const after = { name: input.source.nameOverride, nameEs: typed ?? input.source.nameOverrideEs };
  return { before, after, spanishFallsBackToEnglish: after.nameEs === null };
}
