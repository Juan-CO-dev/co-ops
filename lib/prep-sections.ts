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
