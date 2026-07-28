/**
 * Items Master Catalog — CLIENT-SAFE shared surface (pure types + the issue
 * classifier; ZERO I/O, no server imports). Split so CatalogClient.tsx can
 * import the CatalogEntity TYPE and the classifier without dragging the
 * service-role catalog loader (lib/admin/catalog.ts) into the client bundle
 * (the *-shared law; the server module re-uses these types). Types erase, so
 * a type-only import is safe anywhere; classifyCatalogIssues is pure.
 *
 * Canonical reference: docs/superpowers/specs/2026-07-26-items-master-catalog-design.md
 */

export type CatalogKind = "item" | "menu_item" | "package";

/** The dossier "issues" the Issues lens surfaces (spec §Issues lens).
 *  `retype_suggested` (SKU Builder streamline 2026-07-27) flags a sold_as_is item
 *  that has gained a producing recipe — the auto-suggest-retype backfill rule
 *  (design §3): sold_as_is is reserved for items with NO producing recipe. */
export type CatalogIssue =
  | "no_recipe"
  | "no_sku_path"
  | "not_sold"
  | "toast_unmapped"
  | "retype_suggested";

// ── Taxonomy (The Master List, migration 0157) ───────────────────────────────

/** items.item_type — one label per registry item (Juan's floor vocabulary). */
export type ItemType = "prepped" | "on_hand" | "sold_as_is";

/** The three legal item_type values (mirrors migration 0157's CHECK). */
export const ITEM_TYPES: readonly ItemType[] = ["prepped", "on_hand", "sold_as_is"] as const;
export function isItemType(v: unknown): v is ItemType {
  return typeof v === "string" && (ITEM_TYPES as readonly string[]).includes(v);
}

/** vendor_items.sku_class — one label per SKU (0157). */
export type SkuClass = "raw" | "packaging" | "cleaning" | "misc";

/** The four legal sku_class values (mirrors migration 0157's CHECK). */
export const SKU_CLASSES: readonly SkuClass[] = ["raw", "packaging", "cleaning", "misc"] as const;
export function isSkuClass(v: unknown): v is SkuClass {
  return typeof v === "string" && (SKU_CLASSES as readonly string[]).includes(v);
}

/**
 * The nine taxonomy words a catalog entity can render as its type label. Derived
 * (NOT stored on menu_items): a menu_item with an active consumer build is
 * `made`; without one it's `retail` (anything we didn't make ourselves).
 * Packages keep the generic `package` word (they're compositions, not a taxon).
 */
export type CatalogType =
  | "prepped"
  | "on_hand"
  | "sold_as_is"
  | "raw"
  | "packaging"
  | "cleaning"
  | "misc"
  | "made"
  | "retail"
  | "package";

/**
 * Derive the taxonomy label for a catalog entity (pure — spec §1 Taxonomy):
 *  - item      → its stored item_type (prepped | on_hand | sold_as_is).
 *  - menu_item → made (has an active consumer build) else retail.
 *  - package   → the generic "package" word.
 *
 * `itemType` is required for kind "item" (stored on the row); `hasBuild`
 * governs the menu_item made-vs-retail split. Defaults keep a malformed input
 * from throwing — an item with no stored type reads "prepped" (the column
 * default), matching the DB.
 */
export function deriveCatalogType(input: {
  kind: CatalogKind;
  itemType?: ItemType | null;
  hasBuild?: boolean;
}): CatalogType {
  switch (input.kind) {
    case "item":
      return input.itemType ?? "prepped";
    case "menu_item":
      return input.hasBuild ? "made" : "retail";
    case "package":
      return "package";
  }
}

/** The minimal per-entity facts the pure classifier reasons over. */
export interface CatalogIssueInput {
  kind: CatalogKind;
  active: boolean;
  soldDirectly: boolean;
  sizesCount: number;
  usedInMenuItems: number;
  usedInPackages: number;
  hasRecipe: boolean;
  /** items only: true = readiness "ready" (SKU path complete); default true elsewhere. */
  readinessReady: boolean;
  /** count of ACTIVE + confirmed toast_menu_map GUIDs pointing at this entity. */
  toastGuids: number;
  /** items only: the stored item_type (0157). Drives retype_suggested; null for
   *  menu_items/packages (they carry no taxon). */
  itemType?: ItemType | null;
}

/**
 * Classify a catalog entity's routing issues (pure). Rules (spec §Issues lens):
 *  - no_recipe     — items + menu_items lacking a producing/build recipe;
 *                    packages NEVER (they're compositions, not recipe outputs).
 *  - no_sku_path   — ITEMS only: has a recipe but readiness is not "ready"
 *                    (an unresolvable SKU path downstream).
 *  - not_sold      — ITEMS only: not sold_directly, no catering sizes, and used
 *                    by no menu_item or package → an orphan the catalog flags.
 *  - toast_unmapped— an ACTIVE sellable entity with 0 confirmed Toast GUIDs.
 *                    "Sellable" = a menu_item, a package, or a sold_directly
 *                    item (a prep item that is never itself sold isn't expected
 *                    to have a Toast GUID).
 *  - retype_suggested — ITEMS only: item_type is sold_as_is BUT the item has a
 *                    producing recipe. sold_as_is is reserved for items with no
 *                    producing recipe (design §3, Juan's vocabulary call) — a
 *                    recipe-produced seller should be retyped to prepped. Purely
 *                    advisory (a JOIN fact, not a mutation).
 */
export function classifyCatalogIssues(e: CatalogIssueInput): CatalogIssue[] {
  const issues: CatalogIssue[] = [];

  if (e.kind !== "package" && !e.hasRecipe) issues.push("no_recipe");

  if (e.kind === "item" && e.hasRecipe && !e.readinessReady) issues.push("no_sku_path");

  if (
    e.kind === "item" &&
    !e.soldDirectly &&
    e.sizesCount === 0 &&
    e.usedInMenuItems === 0 &&
    e.usedInPackages === 0
  ) {
    issues.push("not_sold");
  }

  const sellable = e.kind !== "item" || e.soldDirectly;
  if (e.active && sellable && e.toastGuids === 0) issues.push("toast_unmapped");

  if (e.kind === "item" && e.itemType === "sold_as_is" && e.hasRecipe) {
    issues.push("retype_suggested");
  }

  return issues;
}

// ── Role badges (SKU Builder streamline 2026-07-27, design §3) ────────────────

/**
 * A dual-role badge for a catalog item — a GRAPH FACT read at render time, never
 * a stored property, so it cannot drift (design §3). "sold" = sold_directly;
 * "used_in_builds" = the item is a recipe_inputs.component_item_id somewhere;
 * "made" = a producing recipe exists. Reads like a deli-pan label:
 * "Meatballs: made · sold · used in 3 builds".
 */
export type RoleBadge =
  | { role: "sold" }
  | { role: "used_in_builds"; count: number }
  | { role: "made" };

/** The graph facts deriveRoleBadges reasons over (all already loaded by the catalog). */
export interface RoleBadgeInput {
  soldDirectly: boolean;
  /** count of menu_items + parent items whose recipe consumes this item. */
  usedInBuilds: number;
  /** true when a producing recipe exists (graph.byOutputItem hit). */
  hasProducingRecipe: boolean;
}

/**
 * Derive the role badges for a catalog item (pure). Order is deli-label reading
 * order: what it IS (made) → how it's sold (sold) → how it's consumed (used in
 * N builds). Any subset can be empty (an on-hand raw that's only bought). Zero
 * schema — every input is a read-time graph fact.
 */
export function deriveRoleBadges(input: RoleBadgeInput): RoleBadge[] {
  const badges: RoleBadge[] = [];
  if (input.hasProducingRecipe) badges.push({ role: "made" });
  if (input.soldDirectly) badges.push({ role: "sold" });
  if (input.usedInBuilds > 0) badges.push({ role: "used_in_builds", count: input.usedInBuilds });
  return badges;
}

// ── Quick-pack → starter chain generation (SKU Builder streamline, design §1) ──

/** One index-linked chain level to persist (mirrors PackChainLevelInput on the
 *  pack-chain route; kept local so this pure module has zero server coupling). */
export interface StarterChainLevel {
  label: string;
  containsQty: number;
  containsIndex: number | null;
  containsMeasureUnit: string | null;
}

/** The quick-pack fields an unchained SKU can fill instead of building a chain. */
export interface QuickPackInput {
  /** How many of the each/inner container are in one pack (e.g. 6). null/1 → single-level. */
  unitsPerPack: number | null;
  /** Size of one each (e.g. 32). */
  eachSize: number | null;
  /** Measure-unit label of the each (e.g. "oz"). */
  eachMeasure: string | null;
  /** Free-text container/pack name (e.g. "Case"); falls back to a generic label. */
  packLabel?: string | null;
  /** Free-text each/inner name (e.g. "each"); falls back to a generic label. */
  eachLabel?: string | null;
}

/**
 * Generate a STARTER pack chain from quick-pack fields — ONLY when they are
 * filled enough to be meaningful (design §1: "generate a starter chain on save
 * ONLY when filled"). Returns null when the fields are bare (an unchained save
 * stays valid — the "add pack detail later" escape hatch).
 *
 * Rules:
 *  - Requires BOTH eachSize (> 0) AND a non-empty eachMeasure — the leaf's unit.
 *    Without them there is no convertible content, so no chain (returns null).
 *  - unitsPerPack > 1 → a 2-level chain: pack → unitsPerPack × each ; each →
 *    eachSize × measure.
 *  - unitsPerPack null/≤1 → a single leaf level: each → eachSize × measure.
 *
 * Labels default to generic container names when the caller doesn't supply them;
 * they are NEVER a measure-unit label (the chain's L1 namespace rule is enforced
 * downstream by replaceSkuPackChain — a caller passing "oz" as packLabel is
 * rejected there, not silently generated here).
 */
export function generateQuickPackChain(input: QuickPackInput): StarterChainLevel[] | null {
  const each = input.eachSize;
  const measure = (input.eachMeasure ?? "").trim();
  if (each == null || !Number.isFinite(each) || each <= 0 || measure === "") {
    return null; // not filled enough → no starter chain (bare save stays valid)
  }
  const eachLabel = (input.eachLabel ?? "").trim() || "each";
  const units = input.unitsPerPack;

  if (units != null && Number.isFinite(units) && units > 1) {
    const packLabel = (input.packLabel ?? "").trim() || "pack";
    // 2-level: index 0 = pack (holds `units` of the each at index 1);
    //          index 1 = each (holds `each` of the measure unit).
    return [
      { label: packLabel, containsQty: units, containsIndex: 1, containsMeasureUnit: null },
      { label: eachLabel, containsQty: each, containsIndex: null, containsMeasureUnit: measure },
    ];
  }

  // Single leaf: each → eachSize × measure.
  return [
    { label: eachLabel, containsQty: each, containsIndex: null, containsMeasureUnit: measure },
  ];
}

// ── SKU name-collision warning (SKU Builder streamline, design §1 dedupe) ──────

/** The minimal SKU fields the collision check reads (client-safe). */
export interface SkuNameCollisionCandidate {
  id: string;
  name: string;
  active: boolean;
}

/**
 * Find ACTIVE SKUs whose name collides with `name` (case-insensitive, trimmed),
 * excluding the SKU being edited (`selfId`). Pure — powers the NON-BLOCKING
 * name-collision warning on save (design §1: "11 dup pairs live"; dedupe is a
 * warning, never a hard gate). Returns the colliding candidates (so the UI can
 * name them); empty when the name is clean or blank.
 */
export function skuNameCollisions(
  name: string,
  skus: readonly SkuNameCollisionCandidate[],
  selfId?: string | null,
): SkuNameCollisionCandidate[] {
  const needle = name.trim().toLowerCase();
  if (needle === "") return [];
  return skus.filter(
    (s) => s.active && s.id !== selfId && s.name.trim().toLowerCase() === needle,
  );
}

// ── Assembled catalog entity (TYPE-only import for the client) ────────────────

/** One edge target rendered as a Link in the dossier. */
export interface CatalogEdgeRef {
  id: string;
  name: string;
}

/** A checklist that counts an item (active template item → active template). */
export interface CatalogChecklistRef {
  templateId: string;
  name: string;
  /** checklist_templates.type — the deep-link subtype (prep subtypes only). */
  type: string;
}

/** The batch-assembled routing dossier for one catalog entity. */
export interface CatalogEdges {
  /** items: producing recipe(s) → /admin/recipes/[id]. */
  producedBy: CatalogEdgeRef[];
  /** menu_items: the consumer build recipe → /admin/recipes/[id]. */
  build: CatalogEdgeRef | null;
  /** items: leaf SKU names (display-capped). */
  skuNames: string[];
  /** menu_items: first-level component item names. */
  componentItems: CatalogEdgeRef[];
  /** items: menu_items whose recipe consumes this item. */
  usedInMenuItems: CatalogEdgeRef[];
  /** items: parent items whose recipe consumes this item. */
  usedInItems: CatalogEdgeRef[];
  /** items/menu_items: packages that reference this entity (line or option). */
  packages: CatalogEdgeRef[];
  /** items: active checklists that count this item. */
  checklists: CatalogChecklistRef[];
  /** count of active+confirmed Toast GUIDs. */
  toastGuids: number;
  /** items: active catering size tiers. */
  sizesCount: number;
}

export interface CatalogEntityFlags {
  soldDirectly: boolean;
  cateringAvailable: boolean;
  cateringOnly: boolean;
  cateringPortionable: boolean | null;
}

export interface CatalogEntity {
  /** stable client key: `${kind}:${id}`. */
  key: string;
  kind: CatalogKind;
  id: string;
  name: string;
  nameEs: string | null;
  /** grouping bucket: prep/menu section, or the package's location name. */
  section: string | null;
  active: boolean;
  seasonal: boolean;
  flags: CatalogEntityFlags;
  serves: number | null;
  priceCents: number | null;
  edges: CatalogEdges;
  issues: CatalogIssue[];
  /** items only: the stored item_type (0157); null for menu_items/packages. */
  itemType: ItemType | null;
  /** The derived taxonomy label (the nine words) — see deriveCatalogType. */
  taxonType: CatalogType;
}
