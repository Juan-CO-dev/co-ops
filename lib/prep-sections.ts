/**
 * Prep section → column conventions (C.44 Module 3 slice 2).
 *
 * CLIENT-SAFE: pure data + type-only imports (no DB, no server deps), so both
 * the server data layer (lib/admin/templates.ts) and the client Add form can
 * import it. The column convention per section is the canonical map documented
 * in lib/types.ts PrepColumn — single source so add + change-section agree.
 */

import type { PrepColumn, PrepSection } from "@/lib/types";

export const PREP_SECTIONS: readonly PrepSection[] = [
  "Veg",
  "Cooks",
  "Sides",
  "Sauces",
  "Slicing",
  "Misc",
];

const SECTION_COLUMNS: Record<PrepSection, PrepColumn[]> = {
  Veg: ["par", "on_hand", "back_up", "total"],
  Cooks: ["par", "on_hand", "total"],
  Sides: ["par", "portioned", "back_up", "total"],
  Sauces: ["par", "line", "back_up", "total"],
  Slicing: ["par", "line", "back_up", "total"],
  Misc: ["yes_no"],
};

/**
 * Columns for a section. Misc gains a free_text note column when includeNote.
 * Returns a fresh array each call (callers may store it on prep_meta).
 */
export function columnsForSection(section: PrepSection, includeNote = false): PrepColumn[] {
  const base = [...SECTION_COLUMNS[section]];
  if (section === "Misc" && includeNote) base.push("free_text");
  return base;
}

export function isPrepSectionName(v: unknown): v is PrepSection {
  return typeof v === "string" && (PREP_SECTIONS as readonly string[]).includes(v);
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
