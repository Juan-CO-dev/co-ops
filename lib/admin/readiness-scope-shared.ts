/**
 * HUB READINESS, ATTRIBUTED (catalog Phase 3a; lead decisions 4 and (c)). A recipe or item counts as "not ready"
 * when it is not ready for the default OR for any active shop — and the count says WHERE: one entry per scope
 * with failures, so "3 not ready" reads "1 in the default · 2 at P Street" and each entry links to that scope's list.
 * Pure: the caller loads one readiness map per scope (one graph read per scope, never per recipe).
 */
import type { Readiness } from "@/lib/readiness";
import type { TranslationParams } from "@/lib/i18n/types";

export interface ScopeReadiness {
  scope: string | null;
  scopeName: string | null;
  skuReadiness: ReadonlyMap<string, Readiness>;
  recipeReadiness: ReadonlyMap<string, Readiness>;
  itemReadiness: ReadonlyMap<string, Readiness>;
}

export interface ReadinessByScope { scope: string | null; scopeName: string | null; skus: number; recipes: number; items: number }

/**
 * WHERE a hub "N at P Street" entry links (Astra 3a r4#2): that scope's list, on the view that SHOWS that scope's
 * readiness. Items → the registry tab (the catalog tab's readiness is the default's); recipes → the list.
 */
export function readinessScopeHref(sectionId: string, href: string, scope: string | null): string {
  const location = `location=${scope ?? "global"}`;
  return sectionId === "items" ? `${href}?view=registry&${location}` : `${href}?${location}`;
}

/** The items page's first tab: the registry when asked, or when opened for a scope (a hub readiness link). */
export function itemsLandingView(params: { view?: string; location?: string }): "registry" | "catalog" {
  if (params.view === "registry") return "registry";
  if (params.view === "catalog") return "catalog";
  return params.location ? "registry" : "catalog";
}

export function attributeNotReady(perScope: readonly ScopeReadiness[]): { skus: number; recipes: number; items: number; byScope: ReadinessByScope[] } {
  const bad = (m: ReadonlyMap<string, Readiness>) => [...m].filter(([, r]) => r.status !== "ready").map(([id]) => id);
  const allRecipes = new Set<string>();
  const allItems = new Set<string>();
  const allSkus = new Set<string>();
  const byScope: ReadinessByScope[] = [];
  for (const s of perScope) {
    const k = bad(s.skuReadiness);
    const r = bad(s.recipeReadiness);
    const i = bad(s.itemReadiness);
    k.forEach((id) => allSkus.add(id));
    r.forEach((id) => allRecipes.add(id));
    i.forEach((id) => allItems.add(id));
    if (k.length > 0 || r.length > 0 || i.length > 0) byScope.push({ scope: s.scope, scopeName: s.scopeName, skus: k.length, recipes: r.length, items: i.length });
  }
  return { skus: allSkus.size, recipes: allRecipes.size, items: allItems.size, byScope };
}

/** One "where" entry under a hub card: its link, and its words — the default, or a shop by NAME (never a code). */
export interface ReadinessWhereEntry {
  scope: string | null;
  href: string;
  key: "readiness.hub.where_default" | "readiness.hub.where_shop";
  params: TranslationParams;
}

/**
 * THE HUB'S ATTRIBUTED COUNT, in reading order (catalog Phase 3b lead decision: "1 in the default · 2 at P Street"):
 * the default first when it has failures, then each shop with failures for this section, each linking to that
 * scope's list. The hub joins them with a dot.
 */
export function readinessWhereEntries(sectionId: "skus" | "recipes" | "items", href: string, byScope: readonly ReadinessByScope[]): ReadinessWhereEntry[] {
  const count = (b: ReadinessByScope) => sectionId === "skus" ? b.skus : sectionId === "recipes" ? b.recipes : b.items;
  return byScope.filter((b) => count(b) > 0).map((b): ReadinessWhereEntry => {
    const href_ = readinessScopeHref(sectionId, href, b.scope);
    return b.scope === null
      ? { scope: null, href: href_, key: "readiness.hub.where_default", params: { count: count(b) } }
      : { scope: b.scope, href: href_, key: "readiness.hub.where_shop", params: { shop: b.scopeName ?? "", count: count(b) } };
  });
}
