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

/** The four dossier "issues" the Issues lens surfaces (spec §Issues lens). */
export type CatalogIssue = "no_recipe" | "no_sku_path" | "not_sold" | "toast_unmapped";

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

  return issues;
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
}
