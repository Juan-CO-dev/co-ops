/**
 * Multilingual database content resolver (per SPEC_AMENDMENTS.md C.38).
 *
 * Tactical helper for translating user-facing fields stored on
 * `checklist_template_items` (label, description, station). System-wide
 * multilingual database content (vendor items, recipes, training, prep
 * templates, etc.) is deferred to a dedicated architectural conversation.
 *
 * CRITICAL DISCIPLINE — system-key vs display-string separation:
 *
 *   The original `label` / `description` / `station` columns are the
 *   English source-of-truth AND the system-key for any matching/grouping
 *   logic. Examples that MUST match against the original (English) field:
 *     - `it.station === WALK_OUT_VERIFICATION_STATION` (Walk-Out gate)
 *     - station-grouping keys in the closing UI (per-station sections)
 *     - any future template-item matching by label or description
 *
 *   This resolver returns translated content for DISPLAY ONLY. Using
 *   resolved values as matching keys would break the Walk-Out gate
 *   (Spanish "Verificación de Salida" wouldn't equal English
 *   "Walk-Out Verification") and any future grouping/lookup logic.
 *
 *   Future translatable content (vendor items, recipes, etc.) must
 *   follow the same discipline: original field is system source-of-truth;
 *   translations override at render only.
 *
 * Resolution order: requested language → original column (en source).
 * Empty-string translations are treated as "translation present" (caller
 * may have intentionally translated to empty); only undefined / null fall
 * through to the original.
 */

import type { ChecklistTemplateItem } from "@/lib/types";
import type { Language } from "@/lib/i18n/types";

export interface ResolvedTemplateItemContent {
  label: string;
  description: string | null;
  station: string | null;
}

export function resolveTemplateItemContent(
  item: ChecklistTemplateItem,
  language: Language,
): ResolvedTemplateItemContent {
  // English is the source-of-truth; an explicit `en` translations entry
  // would only exist as an override (not in current production data).
  // For language='en' the column values ARE the answer — no lookup needed.
  if (language === "en") {
    return {
      label: item.label,
      description: item.description,
      station: item.station,
    };
  }

  const translated = item.translations?.[language];
  return {
    label: pickString(translated?.label, item.label),
    description: pickNullableString(translated?.description, item.description),
    station: pickNullableString(translated?.station, item.station),
  };
}

/** Returns the override when defined; falls back to the original otherwise. */
function pickString(override: string | undefined, fallback: string): string {
  return override !== undefined ? override : fallback;
}

/**
 * Returns the override when defined (allowing explicit null override → null);
 * falls back to the original otherwise. Distinguishes "not translated" (undefined)
 * from "translated to null" (explicit null) — the latter is an authored choice.
 */
function pickNullableString(
  override: string | null | undefined,
  fallback: string | null,
): string | null {
  return override !== undefined ? override : fallback;
}
