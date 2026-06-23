/**
 * Shared client helpers for the Prep Template admin UI (C.44 Module 3).
 *
 * `postJson` is reused from the User Management admin shared module — the
 * contract (POST/PATCH JSON, returns { ok:true } | { ok:false; code }) is
 * identical, so duplicating it would only invite drift. Only `resolveErrorKey`
 * is genuinely new here: it resolves codes against the templates i18n namespace.
 */

import type { TranslationKey } from "@/lib/i18n/types";

export { postJson } from "@/components/admin/users/shared";

const KNOWN = new Set([
  "forbidden",
  "template_not_found",
  "item_not_found",
  "location_not_found",
  "invalid_label",
  "invalid_par",
  "invalid_display_order",
  "invalid_min_role",
  "invalid_section",
  "section_not_found",
  "invalid_par_mode",
  "invalid_day_of_week",
  "already_global",
  "not_global",
  "invalid_payload",
  "item_unlinked",
  "not_a_prep_item",
  "step_up_required",
  "step_up_stale",
]);

export function resolveErrorKey(code: string): TranslationKey {
  const key = KNOWN.has(code) ? code : "generic";
  return `admin.templates.error.${key}` as TranslationKey;
}
