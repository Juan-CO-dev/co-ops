/**
 * HUB READINESS, ATTRIBUTED (catalog Phase 3a; lead decisions 4 and (c)). A recipe or item counts as "not ready"
 * when it is not ready for the default OR for any active shop — and the count says WHERE: one entry per scope
 * with failures, so "3 not ready" reads "1 in the default · 2 at P Street" and each entry links to that scope's list.
 * Pure: the caller loads one readiness map per scope (one graph read per scope, never per recipe).
 */
import type { Readiness } from "@/lib/readiness";

export interface ScopeReadiness {
  scope: string | null;
  scopeName: string | null;
  recipeReadiness: ReadonlyMap<string, Readiness>;
  itemReadiness: ReadonlyMap<string, Readiness>;
}

export interface ReadinessByScope { scope: string | null; scopeName: string | null; recipes: number; items: number }

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

export function attributeNotReady(perScope: readonly ScopeReadiness[]): { recipes: number; items: number; byScope: ReadinessByScope[] } {
  const bad = (m: ReadonlyMap<string, Readiness>) => [...m].filter(([, r]) => r.status !== "ready").map(([id]) => id);
  const allRecipes = new Set<string>();
  const allItems = new Set<string>();
  const byScope: ReadinessByScope[] = [];
  for (const s of perScope) {
    const r = bad(s.recipeReadiness);
    const i = bad(s.itemReadiness);
    r.forEach((id) => allRecipes.add(id));
    i.forEach((id) => allItems.add(id));
    if (r.length > 0 || i.length > 0) byScope.push({ scope: s.scope, scopeName: s.scopeName, recipes: r.length, items: i.length });
  }
  return { recipes: allRecipes.size, items: allItems.size, byScope };
}
