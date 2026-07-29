/**
 * nav-parents — the single route→parent registry that powers <BackLink/>.
 *
 * ONE longest-prefix-match table maps any authenticated route to its logical
 * parent (href + i18n label key). This kills the wrong-target/duplicate
 * back-link disease: instead of five bespoke back components each hardcoding
 * one target, every back affordance derives its target from this map.
 *
 * Pure module (no React, no I/O) so the matcher is vitest-testable.
 *
 * MATCHING SEMANTICS
 * ------------------
 * A pathname is normalized (strip query/hash, strip a single trailing slash,
 * collapse to lowercase-insensitive segment compare) then matched against the
 * PATTERNS below by LONGEST PREFIX of concrete pattern segments. A pattern
 * segment written as `[seg]` (dynamic) matches any single concrete segment;
 * a literal segment must match exactly. The pattern with the most matched
 * segments wins; ties are impossible because patterns are distinct prefixes.
 *
 * An unknown / unmatched route falls back to /dashboard (the app root for
 * authenticated users) — a sensible universal parent.
 *
 * Label keys reference EXISTING en.json keys wherever possible (the admin
 * section labels, reports.page.title, receiving.page.title, nav.*) so this
 * registry adds no translation surface of its own.
 */

import type { TranslationKey } from "@/lib/i18n/types";

export interface NavParent {
  /** Absolute href of the parent route. */
  href: string;
  /** i18n key for the parent's display label (the back-link text). */
  labelKey: TranslationKey;
}

interface ParentRule {
  /** Route pattern, e.g. "/admin/recipes/[id]". Leading slash, no trailing slash. */
  pattern: string;
  parent: NavParent;
}

/**
 * The registry. Order is irrelevant — the matcher scores by matched-segment
 * count and picks the longest. Every rule is a PATTERN whose parent is where
 * "back" should land from a page matching that pattern.
 *
 * Coverage:
 *   - admin drill-ins → their section hub (recipes/[id]→/admin/recipes, etc.)
 *   - admin section hubs & stubs → /admin
 *   - admin catering sub-pages → /admin/catering
 *   - admin template-builder pages → /admin/checklist-templates
 *   - /admin root → /dashboard
 *   - operator drill-ins → their list (report detail→/reports, receiving/[id]→
 *     /operations/receiving, trends sub-pages→/reports/trends)
 *   - operator top pages & /operations/* & /lto → /dashboard
 *   - customer catering sub-pages → /catering
 */
const RULES: ParentRule[] = [
  // ─── Admin: drill-ins → their section hub ──────────────────────────────
  { pattern: "/admin/recipes/new", parent: { href: "/admin/recipes", labelKey: "admin.section.recipes" } },
  { pattern: "/admin/recipes/[id]", parent: { href: "/admin/recipes", labelKey: "admin.section.recipes" } },
  { pattern: "/admin/vendors/[id]", parent: { href: "/admin/vendors", labelKey: "admin.section.vendors" } },

  // ─── Admin: template-builder pages → the templates hub ─────────────────
  { pattern: "/admin/checklist-templates/[subtype]", parent: { href: "/admin/checklist-templates", labelKey: "admin.section.checklist-templates" } },

  // ─── Admin: catering sub-pages → the catering hub ──────────────────────
  // (any /admin/catering/* concrete segment → /admin/catering)
  { pattern: "/admin/catering/[section]", parent: { href: "/admin/catering", labelKey: "admin.section.catering" } },

  // ─── Admin: section hubs & stubs → the admin hub ───────────────────────
  { pattern: "/admin/[section]", parent: { href: "/admin", labelKey: "admin.back_to_hub" } },

  // ─── Admin root → dashboard ────────────────────────────────────────────
  { pattern: "/admin", parent: { href: "/dashboard", labelKey: "nav.dashboard" } },

  // ─── Operator: drill-ins → their list ──────────────────────────────────
  { pattern: "/reports/[type]/[id]", parent: { href: "/reports", labelKey: "reports.page.title" } },
  { pattern: "/reports/trends/team/[personId]", parent: { href: "/reports/trends", labelKey: "reports.trends.landing.title" } },
  { pattern: "/reports/trends/team", parent: { href: "/reports/trends", labelKey: "reports.trends.landing.title" } },
  { pattern: "/reports/trends/ops", parent: { href: "/reports/trends", labelKey: "reports.trends.landing.title" } },
  { pattern: "/reports/trends", parent: { href: "/reports", labelKey: "reports.page.title" } },
  { pattern: "/operations/receiving/[id]", parent: { href: "/operations/receiving", labelKey: "receiving.page.title" } },

  // ─── Customer catering sub-pages → the catering hub ────────────────────
  { pattern: "/catering/[section]", parent: { href: "/catering", labelKey: "nav.catering" } },
];

/** Default parent for any route with no more specific rule. */
export const DEFAULT_PARENT: NavParent = { href: "/dashboard", labelKey: "nav.dashboard" };

/** Normalize a pathname: strip query/hash, drop a single trailing slash. */
function normalizePath(pathname: string): string {
  let p = pathname.split(/[?#]/, 1)[0] ?? pathname;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/** True if a pattern segment matches a concrete segment. */
function segmentMatches(patternSeg: string, concreteSeg: string): boolean {
  if (patternSeg.startsWith("[") && patternSeg.endsWith("]")) return true; // dynamic
  return patternSeg === concreteSeg;
}

/**
 * Score a pattern against a concrete path (per-segment prefix; dynamic segments
 * match any concrete segment). Returns:
 *   { segments, literals } — matched-segment count and, of those, how many were
 *   LITERAL matches (used to break ties: a more-specific literal pattern beats
 *   an all-dynamic one of the same length, e.g. /reports/trends/ops beats
 *   /reports/[type]/[id]).
 * Returns null on no match.
 */
function prefixMatchScore(
  pattern: string,
  pathSegs: string[],
): { segments: number; literals: number } | null {
  const patSegs = pattern.split("/").filter(Boolean);
  if (patSegs.length > pathSegs.length) return null;
  let literals = 0;
  for (let i = 0; i < patSegs.length; i++) {
    const ps = patSegs[i];
    const cs = pathSegs[i];
    if (ps === undefined || cs === undefined) return null;
    if (!segmentMatches(ps, cs)) return null;
    if (!(ps.startsWith("[") && ps.endsWith("]"))) literals++;
  }
  return { segments: patSegs.length, literals };
}

/**
 * Resolve the parent (back-link target) for a given pathname via longest
 * concrete-prefix match. Ties on length are broken by literal specificity, so
 * a literal route always beats an all-dynamic one of equal depth. Unknown
 * routes → DEFAULT_PARENT (/dashboard).
 */
export function parentFor(pathname: string): NavParent {
  const path = normalizePath(pathname);
  const pathSegs = path.split("/").filter(Boolean);

  let best: NavParent | null = null;
  let bestSegments = -1;
  let bestLiterals = -1;

  for (const rule of RULES) {
    const score = prefixMatchScore(rule.pattern, pathSegs);
    if (score === null) continue;
    const better =
      score.segments > bestSegments ||
      (score.segments === bestSegments && score.literals > bestLiterals);
    if (better) {
      bestSegments = score.segments;
      bestLiterals = score.literals;
      best = rule.parent;
    }
  }

  return best ?? DEFAULT_PARENT;
}
