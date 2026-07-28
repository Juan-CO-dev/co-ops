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
  /** Free-text container/pack name (e.g. "Case"); falls back to "pack". */
  packLabel?: string | null;
  /** Free-text each/inner name (e.g. "log"); falls back to "inner" — NEVER "each"
   *  (an active measure-unit label; see generateQuickPackChain's collision guard). */
  eachLabel?: string | null;
}

/** The default each/inner-level label for a generated starter chain. "inner"
 *  (NOT "each") is the SAME safe word seed 13 (scripts/seed/13-pack-chains.ts)
 *  adopted for exactly this class — "each" is an active measure_units label, so
 *  a generated leaf labeled "each" would collide with the chain's L1 namespace
 *  rule and replaceSkuPackChain would throw label_is_measure_unit. */
const DEFAULT_EACH_LABEL = "inner";
/** The default pack/case-level label for a 2-level generated starter chain. */
const DEFAULT_PACK_LABEL = "pack";

/**
 * Generate a STARTER pack chain from quick-pack fields — ONLY when they are
 * filled enough to be meaningful (design §1: "generate a starter chain on save
 * ONLY when filled"). Returns null when the fields are bare (an unchained save
 * stays valid — the "add pack detail later" escape hatch).
 *
 * Rules:
 *  - Requires BOTH eachSize (> 0) AND a non-empty eachMeasure — the leaf's unit.
 *    Without them there is no convertible content, so no chain (returns null).
 *  - unitsPerPack > 1 → a 2-level chain: pack → unitsPerPack × inner ; inner →
 *    eachSize × measure.
 *  - unitsPerPack null/≤1 → a single leaf level: inner → eachSize × measure.
 *
 * Labels default to safe generic container names ("inner"/"pack") when the caller
 * doesn't supply them — NEVER a measure-unit label (a generated "each" leaf would
 * collide with the active "each" measure unit; the L1 namespace rule enforced by
 * replaceSkuPackChain would then reject the whole chain AFTER createSku already
 * minted the SKU — a mint-then-destroy). To pre-empt that class entirely, pass
 * `measureLabels` (the loaded active measure_units labels): if ANY generated
 * label would collide (case-insensitive, trimmed) this returns null (a bare valid
 * unchained save) rather than emitting a chain that is guaranteed to be rejected
 * downstream.
 */
export function generateQuickPackChain(
  input: QuickPackInput,
  measureLabels?: ReadonlySet<string>,
): StarterChainLevel[] | null {
  const each = input.eachSize;
  const measure = (input.eachMeasure ?? "").trim();
  if (each == null || !Number.isFinite(each) || each <= 0 || measure === "") {
    return null; // not filled enough → no starter chain (bare save stays valid)
  }
  const eachLabel = (input.eachLabel ?? "").trim() || DEFAULT_EACH_LABEL;
  const units = input.unitsPerPack;

  const chain =
    units != null && Number.isFinite(units) && units > 1
      ? // 2-level: index 0 = pack (holds `units` of the inner at index 1);
        //          index 1 = inner (holds `each` of the measure unit).
        [
          { label: (input.packLabel ?? "").trim() || DEFAULT_PACK_LABEL, containsQty: units, containsIndex: 1, containsMeasureUnit: null },
          { label: eachLabel, containsQty: each, containsIndex: null, containsMeasureUnit: measure },
        ]
      : // Single leaf: inner → eachSize × measure.
        [{ label: eachLabel, containsQty: each, containsIndex: null, containsMeasureUnit: measure }];

  // Collision guard (mint-then-destroy prevention): if any GENERATED label equals
  // an active measure-unit label (trim+lowercase), replaceSkuPackChain would throw
  // label_is_measure_unit after the SKU was already minted. Bail to a bare valid
  // save instead of emitting a doomed chain.
  if (measureLabels && measureLabels.size > 0) {
    const measureLower = new Set<string>();
    for (const m of measureLabels) measureLower.add(m.trim().toLowerCase());
    for (const level of chain) {
      if (measureLower.has(level.label.trim().toLowerCase())) return null;
    }
  }

  return chain;
}

/**
 * Default level label for wizard depth `index` (0 = root). Distinct PER DEPTH —
 * a ≥2-level all-default chain must never repeat a label (UNIQUE(sku_id,label)
 * makes a repeat a loud `duplicate_label` rejection; adversarial review
 * 2026-07-28 traced the canonical case→log→oz raw chain failing on
 * "inner"/"inner") — and never a measure-unit word ("each"/"unit" — the BC
 * shadowing class, caught twice). Manager-typed labels can still collide; the
 * server rejects those loudly, which is acceptable — DEFAULTS must never.
 */
export function defaultWizardLevelLabel(index: number): string {
  if (index === 0) return "container";
  if (index === 1) return "inner";
  return `inner ${index}`;
}

// ── Flat-field derivation from a chain (SKU top-tier PR-B, sync-on-save) ───────

/** The legacy flat pack fields the 3 laggard consumers still read
 *  (readiness.skuPackComplete, sku-demand's skuContentOz-sans-chain,
 *  formatSkuPack). Derived from a saved chain so those consumers stay correct
 *  until PR-C migrates them to read the chain directly. avg_oz_per_each is NOT
 *  here — it's a SKU-level column the sync never touches. */
export interface DerivedFlatFields {
  /** Root (top) level label → vendor_items.pack_format. Null on a malformed chain. */
  packFormat: string | null;
  /** Product of every NON-leaf level's containsQty → vendor_items.units_per_pack.
   *  1 for a single-leaf chain (the legacy "1 for Each" convention — a null here
   *  would fail skuPackComplete + null out skuContentOz's flat path for a VALID
   *  depth-1 raw chain). Null only for a malformed chain. */
  unitsPerPack: number | null;
  /** Leaf level's containsQty → vendor_items.each_size. Null on a malformed chain. */
  eachSize: number | null;
  /** Leaf level's containsMeasureUnit → vendor_items.each_measure. Null on a malformed chain. */
  eachMeasure: string | null;
}

const EMPTY_FLAT: DerivedFlatFields = {
  packFormat: null,
  unitsPerPack: null,
  eachSize: null,
  eachMeasure: null,
};

/**
 * Derive the legacy flat pack fields from a chain (PURE — the sync-on-save
 * mechanism). Walks the chain root→leaf following the SAME index pointers the
 * pack-chain spine walks (never display order), collapsing the intermediate
 * container quantities into a single units_per_pack so the legacy flat-field
 * content-oz math reproduces the pointer walk byte-for-byte:
 *
 *   flat  = units_per_pack × each_size × ozPerMeasureUnit(each_measure, avg)
 *   walk  = (∏ non-leaf containsQty) × leaf.containsQty × ozPerLeafUnit(leaf_measure, avg)
 *
 * With packFormat←root label, unitsPerPack←∏(non-leaf qty), each_size←leaf qty,
 * each_measure←leaf measure the two expressions are identical for any LINEAR
 * chain. avg_oz_per_each is a SKU-level column and is left untouched by the sync.
 *
 * Operates on the index-linked StarterChainLevel[] the wizard/generator produce
 * (containsIndex = the array index of the level this one contains; a leaf has
 * containsMeasureUnit set and containsIndex null). Returns all-null (EMPTY_FLAT)
 * when the chain is empty, has no unique root, is cyclic/dangling, or the root
 * path doesn't terminate in a measure leaf — a wrong guess is never emitted
 * (the malformed chain is rejected by the write path anyway; this is defensive).
 */
export function deriveFlatFieldsFromChain(
  levels: readonly StarterChainLevel[],
): DerivedFlatFields {
  if (levels.length === 0) return EMPTY_FLAT;

  // Root = the single level no other level's containsIndex points at.
  const pointedAt = new Set<number>();
  for (const l of levels) {
    if (l.containsIndex != null) pointedAt.add(l.containsIndex);
  }
  const rootIdxs: number[] = [];
  for (let i = 0; i < levels.length; i++) {
    if (!pointedAt.has(i)) rootIdxs.push(i);
  }
  if (rootIdxs.length !== 1) return EMPTY_FLAT; // no unique root (multi-root / cycle)
  const rootIdx = rootIdxs[0]!;
  const root = levels[rootIdx]!;

  // Walk root→leaf, multiplying non-leaf quantities. Detect cycles + dangling
  // pointers (return all-null rather than loop forever or guess).
  let unitsProduct = 1;
  let sawNonLeaf = false;
  const seen = new Set<number>();
  let cur: StarterChainLevel | undefined = root;
  let curIdx = rootIdx;
  while (cur) {
    if (seen.has(curIdx)) return EMPTY_FLAT; // cycle
    seen.add(curIdx);
    if (cur.containsIndex != null) {
      // Non-leaf: fold its qty into units_per_pack, descend the pointer.
      const q = cur.containsQty;
      if (!Number.isFinite(q) || q <= 0) return EMPTY_FLAT;
      unitsProduct *= q;
      sawNonLeaf = true;
      const nextIdx: number = cur.containsIndex;
      const next: StarterChainLevel | undefined = levels[nextIdx];
      if (!next) return EMPTY_FLAT; // dangling pointer
      cur = next;
      curIdx = nextIdx;
      continue;
    }
    // Leaf: must terminate in a measure unit.
    const measure = (cur.containsMeasureUnit ?? "").trim();
    if (measure === "") return EMPTY_FLAT;
    const eachSize = cur.containsQty;
    if (!Number.isFinite(eachSize) || eachSize <= 0) return EMPTY_FLAT;
    return {
      packFormat: root.label.trim() || null,
      // Single-leaf chain (root IS the leaf) → 1, the legacy "1 for Each"
      // convention (lib/admin/skus.ts) — keeps skuPackComplete true and the
      // flat content-oz math (1 × each_size × ozPer) equal to the walk for a
      // valid depth-1 raw chain; else the collapsed container-qty product.
      unitsPerPack: sawNonLeaf ? unitsProduct : 1,
      eachSize,
      eachMeasure: measure,
    };
  }
  return EMPTY_FLAT; // unreachable (loop returns on leaf) — defensive
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
