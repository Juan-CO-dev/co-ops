/**
 * Prep section → column conventions (C.44 Module 3 slice 2).
 *
 * CLIENT-SAFE: pure helpers + type-only imports (no DB, no server deps), so both
 * the server data layer (lib/admin/templates.ts) and the client Add form can
 * import it. The column convention is derived from a section's SHAPE
 * (shapeToColumns, migration 0086) — single source so add + change-section
 * agree. Section slug validity is checked against a runtime active-slug set
 * (isPrepSectionName), not a static union.
 */

import type { LineInputType, PrepColumn, PrepSectionShape } from "@/lib/types";

/**
 * Column set per input type — the single source for a line's columns (migration
 * 0086 moved this off the old hardcoded SECTION_COLUMNS map keyed by slug).
 * Numeric shapes always carry par + primary + back_up + total. yes_no carries
 * the toggle (+ free_text note when includeNote). free_text is a text-only
 * question line. Returns a fresh array. (Section shapes are a subset of
 * LineInputType, so this also serves the section-default case.)
 */
export function shapeToColumns(shape: LineInputType, includeNote = false): PrepColumn[] {
  switch (shape) {
    case "on_hand":   return ["par", "on_hand", "back_up", "total"];
    case "portioned": return ["par", "portioned", "back_up", "total"];
    case "line":      return ["par", "line", "back_up", "total"];
    case "yes_no":    return includeNote ? ["yes_no", "free_text"] : ["yes_no"];
    case "free_text": return ["free_text"];
  }
}

/**
 * A LINE's input type, derived from its prep_meta.columns (the per-line source
 * of truth — inverse of shapeToColumns). Used by the operator render to pick a
 * per-line control in mixed sections. CLIENT-SAFE (pure).
 */
export function shapeFromColumns(columns: PrepColumn[]): LineInputType {
  if (columns.includes("on_hand")) return "on_hand";
  if (columns.includes("portioned")) return "portioned";
  if (columns.includes("line")) return "line";
  if (columns.includes("yes_no")) return "yes_no";
  return "free_text"; // ["free_text"] or empty → text-only question
}

/**
 * Auto-total source fields for a numeric shape, or null for yes_no (no total).
 * primary = the operationally-always-reported field; secondary = back_up
 * (optional, treated as 0 when empty). Drives AmPrepForm.computeTotal + the
 * PrepRow read-only-total gate.
 */
export function totalSourcesForShape(
  shape: PrepSectionShape,
): { primary: "on_hand" | "portioned" | "line"; secondary: "back_up" } | null {
  switch (shape) {
    case "on_hand":   return { primary: "on_hand", secondary: "back_up" };
    case "portioned": return { primary: "portioned", secondary: "back_up" };
    case "line":      return { primary: "line", secondary: "back_up" };
    case "yes_no":    return null;
  }
}

/* ── THE CREATE / CONVERT AUTHORITY SPLIT (Phase-3 UX pair, report-A bug 4) ────
 *
 * Adding a prep line is AGM+ (≥6, the items POST route). Converting an existing
 * line's input type is MoO-adjacent (≥7, the items/[itemId]/input-type route) —
 * an asymmetry that only became reachable when the add form gained a shape
 * picker. A line created with a shape that DIVERGES from its section is
 * structurally the convert operation performed one step earlier, so it takes the
 * convert authority; a line created with the section's own shape is exactly
 * today's create and keeps today's door.
 *
 * Both halves — the client picker and the server enforcement inside addPrepItem —
 * read these predicates, so the offered options and the accepted options can
 * never drift apart. PURE + CLIENT-SAFE.
 */

/** Authority floor for creating a prep line that takes its SECTION's shape. */
export const CREATE_LINE_MIN_LEVEL = 6;
/** Authority floor for creating a prep line with a DIVERGENT shape (= the convert floor). */
export const DIVERGENT_LINE_MIN_LEVEL = 7;

/**
 * True when `requested` is a per-line shape the section does not itself carry.
 * `null`/`undefined` means "take the section's shape" (the pre-picker payload)
 * and is never divergent. `free_text` is always divergent — the section shape
 * CHECK (migration 0086) admits only the four numeric/yes_no shapes.
 */
export function isDivergentLineShape(
  sectionShape: PrepSectionShape,
  requested: LineInputType | null | undefined,
): boolean {
  if (requested == null) return false;
  return requested !== sectionShape;
}

/** The role level required to create a line of `requested` shape in this section. */
export function requiredLevelForLineShape(
  sectionShape: PrepSectionShape,
  requested: LineInputType | null | undefined,
): number {
  return isDivergentLineShape(sectionShape, requested) ? DIVERGENT_LINE_MIN_LEVEL : CREATE_LINE_MIN_LEVEL;
}

/** True iff an actor at `actorLevel` may create a line of `requested` shape here. */
export function canCreateLineWithShape(
  actorLevel: number,
  sectionShape: PrepSectionShape,
  requested: LineInputType | null | undefined,
): boolean {
  if (!Number.isFinite(actorLevel)) return false;
  return actorLevel >= requiredLevelForLineShape(sectionShape, requested);
}

/** True when `slug` is one of the active section slugs (runtime set, not a union). */
export function isPrepSectionName(slug: unknown, activeSlugs: ReadonlySet<string>): slug is string {
  return typeof slug === "string" && activeSlugs.has(slug);
}

/**
 * Resolve a section's display header from the DB-backed `sectionLabels` map
 * (slug → { en, es }), preferring the user's language. Falls back to the
 * caller-provided `fallback` (the existing station-translation-else-i18n-key
 * computation) when the slug has no DB entry. CLIENT-SAFE (pure).
 *
 * Sections First-Class (migration 0082): loaders surface editable per-slug
 * labels; the section header prefers them so a MoO+ rename renders everywhere.
 * Seeded labels equal today's display, so this is a no-op until a rename.
 */
export function resolveSectionLabel(
  sectionLabels: Record<string, { en: string; es: string | null }>,
  slug: string,
  language: string,
  fallback: string,
): string {
  const entry = sectionLabels[slug];
  if (!entry) return fallback;
  return (language === "es" ? entry.es : entry.en) ?? entry.en ?? fallback;
}

/**
 * Display label for a section slug from a PrepSectionDefn[] (the admin view's
 * `sections`), preferring the user's language. Falls back to the slug. Used by
 * the admin template surfaces (section headers + pickers) so a rename shows in
 * the admin, not just on operator reports. CLIENT-SAFE (pure).
 */
export function sectionLabelByLang(
  sections: ReadonlyArray<{ slug: string; labelEn: string; labelEs: string | null }>,
  slug: string,
  language: string,
): string {
  const s = sections.find((x) => x.slug === slug);
  if (!s) return slug;
  return (language === "es" ? s.labelEs : s.labelEn) ?? s.labelEn ?? slug;
}

/**
 * Ordered active section slugs (by displayOrder) from a loaded section list —
 * the runtime replacement for the removed static PREP_SECTIONS const. Callers
 * pass the `sections` they already loaded (loadPrepSections server-side, or the
 * `sections` prop client-side). CLIENT-SAFE (pure). Returns a fresh array.
 */
export function orderedSectionSlugs(
  sections: ReadonlyArray<{ slug: string; displayOrder: number }>,
): string[] {
  return [...sections].sort((a, b) => a.displayOrder - b.displayOrder).map((s) => s.slug);
}
